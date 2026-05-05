/**
 * Global produce-fresh consolidator.
 *
 * Pure function. Run by /plan's Regenerate button. Given every open
 * order's produce-fresh lines plus the current plan/link state,
 * computes the diff needed so exactly one CONSOLIDATED draft batch
 * exists per product, covering the total unlinked demand across every
 * contributing order line.
 *
 * Contrast with the (now-legacy) per-order reconciler at
 * src/lib/order-batch-reconciler.ts: that one ran on every order save
 * and spawned one batch per line. This one runs only on Regenerate,
 * never during saves, and merges lines from many orders into one
 * batch per product.
 *
 * ---------- Core rules ----------
 *
 * Eligible items: produce-fresh lines on orders with status in
 *   { pending, in_production }.
 *
 * For each eligible item, subtract any allocatedQuantity already
 * committed to an ACTIVE batch (a batch that's started production,
 * status = 'active'). Active batches are untouchable — their slice of
 * the line's demand is already "in the oven".
 *
 * The remaining per-item demand gets grouped by productId. Each
 * product with positive total demand becomes one batch:
 *   - moulds = ceil(totalDemand / mould.numberOfCavities)
 *   - totalPieces = moulds × cavities (surplus = totalPieces − totalDemand)
 *   - one orderPlanLinks row per contributing line, with
 *     allocatedQuantity = that line's remaining demand
 *
 * Existing DRAFT batches for a product are replaced: their old links
 * are dropped, a new consolidated set of links is inserted. Draft
 * batches for products with no remaining demand are cancelled.
 *
 * Active/done/cancelled/orphaned batches are never touched.
 *
 * ---------- What this function deliberately does NOT do ----------
 *
 *  - It does not consider stock availability. Take-from-stock vs
 *    produce-fresh is decided upfront by the operator on the order
 *    line; by the time Regenerate runs, borrow lines have already
 *    allocated and produce lines always produce (no stock substitution).
 *  - It does not run the scheduler. The caller runs buildSchedule
 *    after applying this diff.
 *  - It does not modify plans that are not in draft status. Running
 *    work is never rewritten.
 */

import type {
  Order, OrderItem, Product, Mould, ProductionPlan, PlanProduct,
  OrderPlanLink,
} from "@/types";

export interface GlobalReconcileInput {
  /** All orders with status ∈ { pending, in_production }. */
  openOrders: Order[];
  /** Every orderItem on those orders. The reconciler filters to
   *  produce-fresh lines itself. */
  openOrderItems: OrderItem[];
  /** Every product referenced by the eligible items — needed for
   *  mould sizing + batch naming. */
  products: Product[];
  /** Every mould referenced by those products' defaultMouldId. */
  moulds: Mould[];
  /** Every production plan, all statuses. The reconciler picks apart
   *  active (untouchable), draft (rebuildable), and the rest (ignored). */
  plans: ProductionPlan[];
  /** One row per plan for product identification + default mould. A
   *  consolidated batch holds exactly one planProduct (one product per
   *  batch); multi-product legacy batches are still parsed here. */
  planProducts: PlanProduct[];
  /** Every link currently in the DB. The reconciler distinguishes
   *  active-plan links (preserved + their pieces subtracted from
   *  demand) from draft-plan links (replaced wholesale). */
  links: OrderPlanLink[];
}

export interface ReconciledBatch {
  /** Placeholder id used to wire inserts together in the caller;
   *  resolved to a real uuid at insert time. */
  tempId: string;
  productId: string;
  productName: string;
  mouldId: string;
  moulds: number;          // number of mould fills
  totalPieces: number;     // moulds × cavities (≥ totalDemand)
  totalDemand: number;     // sum of allocatedQuantity across allocations
  surplus: number;         // totalPieces − totalDemand
  /** Contributing order lines and how many pieces each gets. */
  allocations: Array<{ orderItemId: string; allocatedQuantity: number }>;
  /** 'produce' (default) = full 8 steps, consolidates fresh demand.
   *  'packing' = schedules only steps flagged isPackingStep on
   *  productionSteps, used for borrow lines that need packing work
   *  but no production. Signalled downstream via the plan name
   *  suffix "— packing". */
  kind?: "produce" | "packing";
  /** When a cluster's mould count exceeds the mould.quantityOwned cap,
   *  the cluster is split into sequential sub-batches. The pair
   *  (splitIndex, splitTotal) is 1-based; downstream renames the plan
   *  "<base name> · {splitIndex}/{splitTotal}" so the chocolatier sees
   *  each round as its own tickable batch. Both null on uncapped
   *  products or when one batch fits within the cap. */
  splitIndex?: number;
  splitTotal?: number;
}

export interface GlobalReconcileDecision {
  /** Brand-new draft batches to create. */
  newBatches: ReconciledBatch[];
  /** Draft batches that already exist for a product with demand — we
   *  resize them and replace their links. Keeping the plan id avoids
   *  churning the scheduler output. */
  updateBatches: Array<ReconciledBatch & { planId: string; planProductId: string }>;
  /** Draft batches whose product has no remaining demand — cancel
   *  them (plan.status → 'cancelled') and drop their links. */
  plansToCancel: string[];
  /** Draft batches that should be DELETED outright (not just
   *  cancelled). Currently used to sweep legacy "— packing" drafts
   *  from the old packing-only model; those batches have no useful
   *  history to preserve and would clutter /plan and /production if
   *  left as cancelled rows. */
  plansToDelete: string[];
  /** Links to delete (belong to cancelled plans, or to draft plans
   *  whose links are about to be rebuilt). */
  linksToDelete: string[];
  warnings: string[];
}

const OPEN_ORDER_STATUSES = new Set<Order["status"]>(["pending", "in_production"]);

export function reconcileGlobalProduceDemand(
  input: GlobalReconcileInput,
): GlobalReconcileDecision {
  const { openOrders, openOrderItems, products, moulds, plans, planProducts, links } = input;

  const productById = new Map(products.map((p) => [p.id!, p]));
  const mouldById = new Map(moulds.map((m) => [m.id!, m]));
  const planById = new Map(plans.map((p) => [p.id!, p]));

  // Partition plans by lifecycle. Active + done + cancelled + orphaned
  // are never touched; only drafts are rebuildable.
  const draftPlanIds = new Set(plans.filter((p) => p.status === "draft").map((p) => p.id!));
  const activePlanIds = new Set(plans.filter((p) => p.status === "active").map((p) => p.id!));

  // planId → productId (for lookup when cancelling / updating).
  const planProductByPlan = new Map<string, PlanProduct>();
  for (const pp of planProducts) {
    // A draft batch produced by the consolidator has exactly one
    // planProduct. Legacy multi-product batches: take the first.
    if (!planProductByPlan.has(pp.planId)) {
      planProductByPlan.set(pp.planId, pp);
    }
  }

  // Only consider items belonging to open orders.
  const openOrderIds = new Set(
    openOrders.filter((o) => OPEN_ORDER_STATUSES.has(o.status)).map((o) => o.id!),
  );
  const eligibleItems = openOrderItems.filter(
    (i) =>
      openOrderIds.has(i.orderId) &&
      (i.fulfilmentMode ?? "produce") === "produce",
  );
  // Borrow (take-from-stock) items no longer create batches. Their
  // packing is a fulfilment action on the order, not production work
  // — handled by the "Mark as packed" button on the order detail
  // page (see markOrderAsPacked in hooks.ts). This reconciler only
  // cares about produce-fresh demand.

  // Per-item: how much is already committed to an in-flight or
  // already-completed batch. Active batches are mid-production. Done
  // batches have already shipped their allocations. Both count as
  // "fulfilled" so the reconciler doesn't spawn a fresh batch when
  // the demand is in fact already covered.
  const donePlanIds = new Set(plans.filter((p) => p.status === "done").map((p) => p.id!));
  const fulfilledPlanIds = new Set([...activePlanIds, ...donePlanIds]);
  const activeAllocByItem = new Map<string, number>();
  for (const link of links) {
    if (!fulfilledPlanIds.has(link.planId)) continue;
    activeAllocByItem.set(
      link.orderItemId,
      (activeAllocByItem.get(link.orderItemId) ?? 0) + link.allocatedQuantity,
    );
  }

  // Group eligible items by productId, accumulating remaining demand
  // alongside each contributing item's deadline. Deadline drives the
  // shelf-life-aware clustering below — items whose order deadlines
  // are too far apart can't share a batch (the chocolates would expire
  // before the latest order is fulfilled).
  const orderById = new Map(openOrders.map((o) => [o.id!, o]));
  const demandByProduct = new Map<
    string,
    Array<{ itemId: string; remaining: number; deadlineMs: number }>
  >();
  for (const item of eligibleItems) {
    const alreadyInActive = activeAllocByItem.get(item.id!) ?? 0;
    const remaining = Math.max(0, item.quantity - alreadyInActive);
    if (remaining <= 0) continue;
    const order = orderById.get(item.orderId);
    const deadlineMs = order?.deadline ? new Date(order.deadline).getTime() : 0;
    const arr = demandByProduct.get(item.productId) ?? [];
    arr.push({ itemId: item.id!, remaining, deadlineMs });
    demandByProduct.set(item.productId, arr);
  }

  // Existing DRAFT batches indexed by productId. Campaign-driven and
  // PO-driven plans are EXCLUDED — they're owned by their respective
  // seeders (`seedCampaignDrivenPlans`, `seedProductionOrderDrivenPlans`)
  // and carry deadlines tied to their source. Without this filter the
  // reconciler would repurpose a campaign plan as the home for an
  // online order's demand, polluting the campaign plan's deadline.
  const draftBatchesByProduct = new Map<string, Array<ProductionPlan & { planProductId: string; productId: string; mouldId: string }>>();
  for (const plan of plans) {
    if (plan.status !== "draft") continue;
    const name = plan.name ?? "";
    if (name.startsWith("Campaign:") || name.startsWith("PO:")) continue;
    const pp = planProductByPlan.get(plan.id!);
    if (!pp) continue;
    const arr = draftBatchesByProduct.get(pp.productId) ?? [];
    arr.push({ ...plan, planProductId: pp.id!, productId: pp.productId, mouldId: pp.mouldId });
    draftBatchesByProduct.set(pp.productId, arr);
  }

  const decision: GlobalReconcileDecision = {
    newBatches: [],
    updateBatches: [],
    plansToCancel: [],
    plansToDelete: [],
    linksToDelete: [],
    warnings: [],
  };

  let tempCounter = 0;

  // Hard cap: orders only consolidate into one batch when their
  // deadlines are within MAX_CLUSTER_GAP_DAYS of each other. Beyond
  // that, the chocolates would either expire before the latest order
  // or be uncomfortably old at delivery. Operator preference: keep
  // batches deadline-tight; surplus drift to shop store via the
  // surplusDestination at unmould-time. Default 3 days — explicit,
  // not derived from shelf life, so the rule reads the same regardless
  // of which product variant is involved.
  const MAX_CLUSTER_GAP_DAYS = 3;
  const MAX_CLUSTER_GAP_MS = MAX_CLUSTER_GAP_DAYS * 86_400_000;

  for (const [productId, demands] of demandByProduct) {
    const product = productById.get(productId);
    if (!product) {
      decision.warnings.push(`Product ${productId} referenced by an open order is missing.`);
      continue;
    }
    const mould = product.defaultMouldId ? mouldById.get(product.defaultMouldId) : undefined;
    if (!mould || !mould.numberOfCavities || mould.numberOfCavities <= 0) {
      decision.warnings.push(
        `No valid default mould for "${product.name}" — set one in Products before regenerating.`,
      );
      continue;
    }

    // Sort items by deadline ascending then split into clusters where
    // consecutive deadline gap exceeds the freshness window. Each
    // cluster becomes its own consolidated batch.
    // For clustering, clamp every past-deadline item to "today" so
    // multiple overdue orders all merge into one ASAP batch instead of
    // splitting into separate-day batches. The scheduler still reads
    // the real (past) deadline for ASAP placement; this is purely a
    // grouping rule.
    const todayMs = (() => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })();
    const clusterKey = (d: { deadlineMs: number }) => Math.max(d.deadlineMs, todayMs);
    const sorted = demands.slice().sort((a, b) => clusterKey(a) - clusterKey(b));
    const clusters: Array<typeof sorted> = [];
    for (const d of sorted) {
      const last = clusters[clusters.length - 1];
      if (!last) { clusters.push([d]); continue; }
      const earliest = clusterKey(last[0]);
      if (clusterKey(d) - earliest <= MAX_CLUSTER_GAP_MS) {
        last.push(d);
      } else {
        clusters.push([d]);
      }
    }

    // Match clusters to existing draft batches by best-fit on deadline:
    // sort drafts by their earliest linked-deadline (or creation time
    // as fallback) and pair index-by-index. Surplus drafts (no cluster)
    // are cancelled; surplus clusters spawn new batches.
    const existingDrafts = (draftBatchesByProduct.get(productId) ?? [])
      .slice()
      .sort((a, b) => {
        const da = earliestDraftDeadlineMs(a.id!, links, openOrderItems, orderById);
        const db = earliestDraftDeadlineMs(b.id!, links, openOrderItems, orderById);
        return da - db;
      });

    // Each cluster splits into 1+ sub-batches. When mould.quantityOwned
    // is set and the cluster's demand exceeds (cavities × quantityOwned),
    // the demand is sliced into successive sub-batches of at most
    // `quantityOwned` moulds each (FIFO across the cluster's order items).
    // Each sub-batch becomes its own plan, so the chocolatier ticks one
    // round at a time instead of marking eight moulds done in one click
    // when only four physical moulds exist.
    const cap = mould.quantityOwned && mould.quantityOwned > 0 ? mould.quantityOwned : null;
    const allSubBatches = clusters.flatMap((c) =>
      splitClusterByCap(c, mould.numberOfCavities, cap),
    );

    for (let i = 0; i < Math.max(allSubBatches.length, existingDrafts.length); i++) {
      const sb = allSubBatches[i];
      const draft = existingDrafts[i];

      if (sb && draft) {
        // Update existing draft with this sub-batch's allocations.
        for (const link of links) {
          if (link.planId === draft.id && link.id) decision.linksToDelete.push(link.id);
        }
        decision.updateBatches.push({
          tempId: `__update_${tempCounter++}`,
          planId: draft.id!,
          planProductId: draft.planProductId,
          productId,
          productName: product.name,
          mouldId: mould.id!,
          moulds: sb.moulds,
          totalPieces: sb.totalPieces,
          totalDemand: sb.totalDemand,
          surplus: sb.totalPieces - sb.totalDemand,
          allocations: sb.allocations,
          splitIndex: sb.splitIndex,
          splitTotal: sb.splitTotal,
        });
      } else if (sb) {
        // No matching draft → spawn a new batch for this sub-batch.
        decision.newBatches.push({
          tempId: `__new_${tempCounter++}`,
          productId,
          productName: product.name,
          mouldId: mould.id!,
          moulds: sb.moulds,
          totalPieces: sb.totalPieces,
          totalDemand: sb.totalDemand,
          surplus: sb.totalPieces - sb.totalDemand,
          allocations: sb.allocations,
          splitIndex: sb.splitIndex,
          splitTotal: sb.splitTotal,
        });
      } else if (draft) {
        // Surplus draft with no sub-batch → cancel.
        decision.plansToCancel.push(draft.id!);
        for (const link of links) {
          if (link.planId === draft.id && link.id) decision.linksToDelete.push(link.id);
        }
      }
    }

    draftBatchesByProduct.delete(productId); // consumed
  }

  // ── Legacy "— packing" draft sweep ───────────────────────────────
  //
  // The old packing-only batch concept has been removed (2026-04-22):
  // borrow-line packing is now a fulfilment action on the order
  // itself (Mark as packed), not a scheduled production batch. Any
  // remaining "— packing" drafts from the old model are cruft; sweep
  // them out of /plan and /production on this Regenerate by queuing
  // them for DELETE (not cancel — no history to preserve).
  for (const plan of plans) {
    if (plan.status !== "draft") continue;
    if (!plan.name?.endsWith("— packing")) continue;
    decision.plansToDelete.push(plan.id!);
    for (const link of links) {
      if (link.planId === plan.id && link.id) decision.linksToDelete.push(link.id);
    }
  }

  // Any draft batch left in the produce map has no demand for its product
  // anymore — cancel it.
  for (const [, extras] of draftBatchesByProduct) {
    for (const plan of extras) {
      decision.plansToCancel.push(plan.id!);
      for (const link of links) {
        if (link.planId === plan.id && link.id) decision.linksToDelete.push(link.id);
      }
    }
  }

  // Dedup linksToDelete (a link can only be queued once).
  decision.linksToDelete = [...new Set(decision.linksToDelete)];
  // Dedup plansToCancel + plansToDelete too — defensive.
  decision.plansToCancel = [...new Set(decision.plansToCancel)];
  decision.plansToDelete = [...new Set(decision.plansToDelete)];

  return decision;
}

/** Slice a cluster into sequential sub-batches when the demand needs
 *  more mould-fills than the chocolatier physically owns. Each sub-batch
 *  consumes up to `cap` mould-fills (= cap × cavities pieces) of the
 *  cluster's demand, drawn FIFO across the cluster's order items. When
 *  `cap` is null, returns a single sub-batch carrying the whole cluster.
 *  Sub-batches are tagged with (splitIndex, splitTotal) only when more
 *  than one is produced — single-batch clusters keep both fields null
 *  so plan names stay clean. */
function splitClusterByCap(
  cluster: Array<{ itemId: string; remaining: number }>,
  cavities: number,
  cap: number | null,
): Array<{
  moulds: number;
  totalPieces: number;
  totalDemand: number;
  allocations: Array<{ orderItemId: string; allocatedQuantity: number }>;
  splitIndex?: number;
  splitTotal?: number;
}> {
  const totalDemand = cluster.reduce((s, d) => s + d.remaining, 0);
  if (totalDemand <= 0) return [];
  const totalMoulds = Math.ceil(totalDemand / cavities);
  const effCap = cap && cap > 0 ? cap : totalMoulds;
  const splitTotal = Math.ceil(totalMoulds / effCap);

  const mouldChunks: number[] = [];
  let mouldsLeft = totalMoulds;
  while (mouldsLeft > 0) {
    const take = Math.min(effCap, mouldsLeft);
    mouldChunks.push(take);
    mouldsLeft -= take;
  }

  // Track each item's still-unallocated demand as we walk through the
  // chunks. FIFO across the cluster keeps the allocation deterministic
  // and respects the deadline-sort that put the earliest item first.
  const remaining = cluster.map((d) => ({ itemId: d.itemId, left: d.remaining }));
  let cursor = 0;
  const out: Array<{
    moulds: number;
    totalPieces: number;
    totalDemand: number;
    allocations: Array<{ orderItemId: string; allocatedQuantity: number }>;
    splitIndex?: number;
    splitTotal?: number;
  }> = [];
  let splitIdx = 1;
  for (const m of mouldChunks) {
    const piecesCap = m * cavities;
    let remainingPieces = piecesCap;
    const allocations: Array<{ orderItemId: string; allocatedQuantity: number }> = [];
    while (remainingPieces > 0 && cursor < remaining.length) {
      const r = remaining[cursor];
      if (r.left <= 0) {
        cursor++;
        continue;
      }
      const take = Math.min(r.left, remainingPieces);
      allocations.push({ orderItemId: r.itemId, allocatedQuantity: take });
      r.left -= take;
      remainingPieces -= take;
      if (r.left === 0) cursor++;
    }
    const subDemand = allocations.reduce((s, a) => s + a.allocatedQuantity, 0);
    out.push({
      moulds: m,
      totalPieces: piecesCap,
      totalDemand: subDemand,
      allocations,
      splitIndex: splitTotal > 1 ? splitIdx : undefined,
      splitTotal: splitTotal > 1 ? splitTotal : undefined,
    });
    splitIdx++;
  }
  return out;
}

/** Earliest deadline among all order items currently linked to a
 *  draft plan. Returned as an epoch-ms number so callers can sort
 *  drafts cheaply. Plans with no live links return Infinity. */
function earliestDraftDeadlineMs(
  planId: string,
  links: OrderPlanLink[],
  openOrderItems: OrderItem[],
  orderById: Map<string, Order>,
): number {
  const itemById = new Map(openOrderItems.map((i) => [i.id!, i]));
  let best = Number.POSITIVE_INFINITY;
  for (const link of links) {
    if (link.planId !== planId) continue;
    const item = itemById.get(link.orderItemId);
    if (!item) continue;
    const order = orderById.get(item.orderId);
    if (!order?.deadline) continue;
    const t = new Date(order.deadline).getTime();
    if (t < best) best = t;
  }
  return best;
}

/**
 * Defensive assertion: ensure nothing in the scheduler or default
 * generators can slip a step named "Transfer" into a plan. Called by
 * callers that produce step lists; throws if violated.
 */
export function assertNoTransferStep(stepNames: readonly string[]): void {
  for (const n of stepNames) {
    if (/^transfer\b/i.test(n.trim())) {
      throw new Error(
        `Step "${n}" looks like a Transfer step — Transfer was removed from the step list. ` +
        `Transfer sheets are a decoration material applied during Capping, not a step.`,
      );
    }
  }
}
