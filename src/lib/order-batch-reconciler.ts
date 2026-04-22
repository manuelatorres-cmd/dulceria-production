/**
 * Order → Batch reconciler.
 *
 * Pure function. Given the current state of an order and its linked
 * batches, computes the diff needed so the batches exactly fulfil the
 * order. Has no side effects — the caller applies the returned
 * actions against the database.
 *
 * ---------- Core rules ----------
 *
 * For each order line (order is pending or in_production):
 *   shortfall = desired − availableStock − existingAllocations
 *     where existingAllocations counts links to draft/active batches
 *     (done batches' pieces are already in stock; cancelled/orphaned
 *     don't count at all).
 *   If shortfall ≤ 0 → no new batch; existing links stay put.
 *   If shortfall > 0 → one new batch sized to
 *     moulds = ceil(shortfall / mould.numberOfCavities)
 *   and a new link with allocatedQuantity = shortfall.
 *
 * When a line is removed from the order (appears in existingLinks but
 * not in the current order items), its links are deleted and each
 * affected plan is cancelled (if draft), orphaned (if active), or left
 * alone (if done / cancelled / orphaned) — unless another order line
 * still holds a link to it, in which case the plan is untouched.
 *
 * When the order is cancelled, every link for every line is deleted
 * and plan status transitions follow the same draft→cancelled /
 * active→orphaned rule, again respecting shared plans.
 *
 * ---------- What this file deliberately does NOT do ----------
 *
 *  - It does not write to stock. `availableByProductId` is an input;
 *    the caller computes it. The allocation-ledger side of things
 *    lives in the stock-rewrite task.
 *  - It does not split a shortfall across multiple new batches. One
 *    line produces at most one new batch per reconcile call. The
 *    scheduler handles splitting *execution* across days.
 *  - It does not modify existing batches' moulds/products. If an
 *    existing draft batch produces too little for an updated line,
 *    the reconciler leaves it alone and adds a second batch. This
 *    keeps the reconciler safe to re-run after the operator has
 *    hand-edited a batch.
 */

import type {
  Order, OrderItem, Product, Mould, ProductionPlan, PlanProduct,
  OrderPlanLink,
} from "@/types";

export interface ReconcileInput {
  order: Order;
  /** Current order lines on this order. */
  orderItems: OrderItem[];
  products: Product[];
  moulds: Mould[];
  /** Every link currently attached to any of this order's items. */
  existingLinks: OrderPlanLink[];
  /** Plans referenced by existingLinks — needed for status decisions. */
  existingPlans: ProductionPlan[];
  /** planProducts for those plans — needed to know what each plan
   *  produces and how many pieces it's planned to yield. */
  existingPlanProducts: PlanProduct[];
  /** Pieces currently free to allocate (on-hand minus other-order
   *  allocations). Computed by the caller from stockLocations. */
  availableByProductId: Map<string, number>;
  /** Links that belong to OTHER orders but point to the same plans.
   *  Used to decide whether a plan should be cancelled/orphaned (only
   *  if no other order still depends on it). */
  otherLinks: OrderPlanLink[];
}

export interface ReconcileNewBatch {
  /** Short-lived placeholder the caller uses to wire plan-insert to
   *  link-insert after the plan gets its real id. */
  tempId: string;
  planName: string;
  planProducts: Array<{
    productId: string;
    mouldId: string;
    quantity: number; // moulds count
  }>;
  /** Order lines this batch fulfils and how many pieces each gets. */
  allocations: Array<{ orderItemId: string; allocatedQuantity: number }>;
}

export interface ReconcileDecision {
  newBatches: ReconcileNewBatch[];
  /** Existing links whose allocatedQuantity should change (e.g. line
   *  quantity grew and the existing batch covers part of it). */
  linksToUpdate: Array<{ linkId: string; allocatedQuantity: number }>;
  /** Link IDs to remove. */
  linksToDelete: string[];
  /** Plans that should transition to status='cancelled' (draft,
   *  un-started work). */
  plansToCancel: string[];
  /** Plans that should transition to status='orphaned' (active, in
   *  progress at cancel time — operator decides later). */
  plansToOrphan: string[];
  warnings: string[];
}

const EMPTY_DECISION: ReconcileDecision = {
  newBatches: [],
  linksToUpdate: [],
  linksToDelete: [],
  plansToCancel: [],
  plansToOrphan: [],
  warnings: [],
};

/** Statuses that mean the plan is still "live demand" — its allocated
 *  pieces should count against a line's shortfall. done plans have
 *  already entered stock; cancelled/orphaned plans don't count. */
const LIVE_PLAN_STATUSES = new Set<ProductionPlan["status"]>(["draft", "active"]);

export function reconcileOrderBatches(input: ReconcileInput): ReconcileDecision {
  const { order } = input;

  if (order.status === "cancelled") {
    return reconcileCancelled(input);
  }

  if (order.status === "pending" || order.status === "in_production") {
    return reconcileActive(input);
  }

  // "done" orders: nothing to do. Batches that delivered into the
  // order are history; re-reconciling shouldn't create more work.
  return { ...EMPTY_DECISION };
}

// ─── Active order (pending / in_production) ─────────────────────────

function reconcileActive(input: ReconcileInput): ReconcileDecision {
  const {
    orderItems, products, moulds, existingLinks, existingPlans,
    availableByProductId, otherLinks,
  } = input;

  const productById = new Map<string, Product>(products.map((p) => [p.id!, p]));
  const mouldById = new Map<string, Mould>(moulds.map((m) => [m.id!, m]));
  const planById = new Map<string, ProductionPlan>(existingPlans.map((p) => [p.id!, p]));

  const decision: ReconcileDecision = {
    newBatches: [],
    linksToUpdate: [],
    linksToDelete: [],
    plansToCancel: [],
    plansToOrphan: [],
    warnings: [],
  };

  const currentItemIds = new Set(orderItems.map((i) => i.id!));
  // Lines that were on the order but aren't anymore — their links go.
  const orphanedLinkOrderItems = new Set<string>();
  for (const link of existingLinks) {
    if (!currentItemIds.has(link.orderItemId)) {
      orphanedLinkOrderItems.add(link.orderItemId);
    }
  }

  let newBatchCounter = 0;

  for (const item of orderItems) {
    const product = productById.get(item.productId);
    if (!product) {
      decision.warnings.push(`Order line references unknown product ${item.productId}; skipping.`);
      continue;
    }
    const mouldId = product.defaultMouldId;
    const mould = mouldId ? mouldById.get(mouldId) : undefined;

    // Tally live (draft/active) and kept-for-history allocations.
    const linksForItem = existingLinks.filter((l) => l.orderItemId === item.id);
    let liveAllocated = 0;
    const linksToKeep: OrderPlanLink[] = [];
    for (const link of linksForItem) {
      const plan = planById.get(link.planId);
      const status = plan?.status ?? "draft";
      if (status === "cancelled" || status === "orphaned") {
        // Defunct batches — drop the link.
        if (link.id) decision.linksToDelete.push(link.id);
        continue;
      }
      // done batches contributed to stock already; their link stays as
      // a historical record but doesn't reduce the shortfall (stock
      // does that via availableByProductId).
      if (LIVE_PLAN_STATUSES.has(status)) {
        liveAllocated += link.allocatedQuantity;
      }
      linksToKeep.push(link);
    }

    const available = Math.max(0, availableByProductId.get(item.productId) ?? 0);
    const shortfall = Math.max(0, item.quantity - available - liveAllocated);

    if (shortfall === 0) {
      // Nothing to build; existing live allocations cover the gap
      // (or stock does). Trim over-allocations: if liveAllocated
      // exceeds what the line needs (e.g. line quantity just shrank),
      // reduce the largest link's allocatedQuantity. We don't modify
      // the batches themselves — the surplus will surface at unmould.
      if (liveAllocated > item.quantity) {
        trimAllocation(linksToKeep, item.quantity, decision);
      }
      continue;
    }

    // Need a new batch. Size it by the default mould.
    if (!mould || !mould.numberOfCavities || mould.numberOfCavities <= 0) {
      decision.warnings.push(
        `No valid default mould for "${product.name}" — set one in Products before confirming this order.`,
      );
      continue;
    }
    const mouldsNeeded = Math.ceil(shortfall / mould.numberOfCavities);
    const tempId = `__new_${newBatchCounter++}`;
    decision.newBatches.push({
      tempId,
      planName: batchNameFor(product.name, input.order),
      planProducts: [{
        productId: item.productId,
        mouldId: mould.id!,
        quantity: mouldsNeeded,
      }],
      allocations: [{
        orderItemId: item.id!,
        allocatedQuantity: shortfall,
      }],
    });
  }

  // Links whose order line disappeared: drop them, and propose
  // cancel/orphan for plans that now have no live demand.
  for (const link of existingLinks) {
    if (!orphanedLinkOrderItems.has(link.orderItemId)) continue;
    if (link.id) decision.linksToDelete.push(link.id);
  }
  proposePlanLifecycleTransitions(decision, existingLinks, existingPlans, otherLinks);

  return decision;
}

// ─── Cancelled order ────────────────────────────────────────────────

function reconcileCancelled(input: ReconcileInput): ReconcileDecision {
  const decision: ReconcileDecision = {
    newBatches: [],
    linksToUpdate: [],
    linksToDelete: [],
    plansToCancel: [],
    plansToOrphan: [],
    warnings: [],
  };
  for (const link of input.existingLinks) {
    if (link.id) decision.linksToDelete.push(link.id);
  }
  proposePlanLifecycleTransitions(decision, input.existingLinks, input.existingPlans, input.otherLinks);
  return decision;
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * For each plan referenced by a link we're deleting, decide if the
 * plan itself should transition status. Skip plans that are still
 * serving other orders (otherLinks), plans already in a terminal
 * state (done/cancelled/orphaned), and plans we're not deleting links
 * from.
 */
function proposePlanLifecycleTransitions(
  decision: ReconcileDecision,
  existingLinks: OrderPlanLink[],
  existingPlans: ProductionPlan[],
  otherLinks: OrderPlanLink[],
): void {
  const planById = new Map<string, ProductionPlan>(existingPlans.map((p) => [p.id!, p]));
  const linksByPlan = new Map<string, OrderPlanLink[]>();
  for (const link of existingLinks) {
    if (!link.id || !decision.linksToDelete.includes(link.id)) continue;
    const arr = linksByPlan.get(link.planId) ?? [];
    arr.push(link);
    linksByPlan.set(link.planId, arr);
  }
  const otherByPlan = new Map<string, boolean>();
  for (const link of otherLinks) {
    otherByPlan.set(link.planId, true);
  }

  for (const [planId] of linksByPlan) {
    if (otherByPlan.get(planId)) continue; // Shared — leave alone.
    const plan = planById.get(planId);
    if (!plan) continue;
    switch (plan.status) {
      case "draft":
        decision.plansToCancel.push(planId);
        break;
      case "active":
        decision.plansToOrphan.push(planId);
        break;
      // done / cancelled / orphaned: leave as-is.
    }
  }
}

/**
 * Reduce links' allocatedQuantity so the total equals `target`.
 * Emits updates for any link whose allocation changes; links hitting
 * zero become deletes. Preserves order — we reduce the smallest
 * allocations first so the largest batch (likely the most committed)
 * stays most intact.
 */
function trimAllocation(
  links: OrderPlanLink[],
  target: number,
  decision: ReconcileDecision,
): void {
  const sorted = [...links].sort((a, b) => a.allocatedQuantity - b.allocatedQuantity);
  let total = sorted.reduce((s, l) => s + l.allocatedQuantity, 0);
  for (const link of sorted) {
    if (total <= target) break;
    const reduceBy = Math.min(link.allocatedQuantity, total - target);
    const newQty = link.allocatedQuantity - reduceBy;
    total -= reduceBy;
    if (!link.id) continue;
    if (newQty === 0) {
      decision.linksToDelete.push(link.id);
    } else if (newQty !== link.allocatedQuantity) {
      decision.linksToUpdate.push({ linkId: link.id, allocatedQuantity: newQty });
    }
  }
}

function batchNameFor(productName: string, order: Order): string {
  const ref = order.customerName || order.eventName || order.sourceRef || "order";
  return `${productName} — ${ref}`;
}
