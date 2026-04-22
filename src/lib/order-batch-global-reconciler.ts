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
  /** Borrow (take-from-stock) items still need packing work scheduled
   *  — the pieces exist in Store but they have to be boxed, ribboned,
   *  labelled. We consolidate them into packing-only batches per
   *  product, scheduled separately from the produce-fresh batches
   *  that make the pieces. */
  const borrowItems = openOrderItems.filter(
    (i) =>
      openOrderIds.has(i.orderId) &&
      i.fulfilmentMode === "borrow",
  );

  // Per-item: how much is already committed to an active batch? That
  // portion is already in production and shouldn't double-book into a
  // new batch.
  const activeAllocByItem = new Map<string, number>();
  for (const link of links) {
    if (!activePlanIds.has(link.planId)) continue;
    activeAllocByItem.set(
      link.orderItemId,
      (activeAllocByItem.get(link.orderItemId) ?? 0) + link.allocatedQuantity,
    );
  }

  // Group eligible items by productId, accumulating remaining demand.
  const demandByProduct = new Map<string, Array<{ itemId: string; remaining: number }>>();
  for (const item of eligibleItems) {
    const alreadyInActive = activeAllocByItem.get(item.id!) ?? 0;
    const remaining = Math.max(0, item.quantity - alreadyInActive);
    if (remaining <= 0) continue;
    const arr = demandByProduct.get(item.productId) ?? [];
    arr.push({ itemId: item.id!, remaining });
    demandByProduct.set(item.productId, arr);
  }

  // Existing DRAFT batches indexed by productId — at most one per
  // product in the steady state, but we tolerate >1 by keeping the
  // first and cancelling the rest.
  const draftBatchesByProduct = new Map<string, Array<ProductionPlan & { planProductId: string; productId: string; mouldId: string }>>();
  for (const plan of plans) {
    if (plan.status !== "draft") continue;
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
    linksToDelete: [],
    warnings: [],
  };

  let tempCounter = 0;

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

    const totalDemand = demands.reduce((s, d) => s + d.remaining, 0);
    const moulds = Math.ceil(totalDemand / mould.numberOfCavities);
    const totalPieces = moulds * mould.numberOfCavities;
    const allocations = demands.map((d) => ({ orderItemId: d.itemId, allocatedQuantity: d.remaining }));

    // Pick an existing draft batch for this product if one exists;
    // cancel any siblings to enforce one-draft-per-product.
    const existingDrafts = draftBatchesByProduct.get(productId) ?? [];
    const primary = existingDrafts[0];
    for (let i = 1; i < existingDrafts.length; i++) {
      const extra = existingDrafts[i];
      decision.plansToCancel.push(extra.id!);
      for (const link of links) {
        if (link.planId === extra.id && link.id) decision.linksToDelete.push(link.id);
      }
    }

    if (primary) {
      // Queue link replacement for the primary draft — old links go,
      // new consolidated set will be inserted.
      for (const link of links) {
        if (link.planId === primary.id && link.id) decision.linksToDelete.push(link.id);
      }
      decision.updateBatches.push({
        tempId: `__update_${tempCounter++}`,
        planId: primary.id!,
        planProductId: primary.planProductId,
        productId,
        productName: product.name,
        mouldId: mould.id!,
        moulds,
        totalPieces,
        totalDemand,
        surplus: totalPieces - totalDemand,
        allocations,
      });
    } else {
      decision.newBatches.push({
        tempId: `__new_${tempCounter++}`,
        productId,
        productName: product.name,
        mouldId: mould.id!,
        moulds,
        totalPieces,
        totalDemand,
        surplus: totalPieces - totalDemand,
        allocations,
      });
    }

    draftBatchesByProduct.delete(productId); // consumed
  }

  // ── Packing-only batches for borrow lines ────────────────────────
  //
  // Borrow items pull finished pieces from Store but still need
  // packing work (boxing, labels, ribbon). We consolidate per-product
  // into a "— packing" batch per regenerate pass. Draft packing
  // batches are rebuilt wholesale; active packing batches are left
  // alone by the upstream filters (status === 'draft').
  const borrowDemandByProduct = new Map<string, Array<{ itemId: string; remaining: number }>>();
  for (const item of borrowItems) {
    const alreadyInActive = activeAllocByItem.get(item.id!) ?? 0;
    const remaining = Math.max(0, item.quantity - alreadyInActive);
    if (remaining <= 0) continue;
    const arr = borrowDemandByProduct.get(item.productId) ?? [];
    arr.push({ itemId: item.id!, remaining });
    borrowDemandByProduct.set(item.productId, arr);
  }

  // Existing draft PACKING batches — detected by name suffix "— packing".
  // Kept separate from the produce-draft pool so the two consolidation
  // passes don't fight over the same plan row.
  const draftPackingByProduct = new Map<string, Array<ProductionPlan & { planProductId: string; productId: string; mouldId: string }>>();
  for (const plan of plans) {
    if (plan.status !== "draft") continue;
    if (!plan.name?.endsWith("— packing")) continue;
    const pp = planProductByPlan.get(plan.id!);
    if (!pp) continue;
    const arr = draftPackingByProduct.get(pp.productId) ?? [];
    arr.push({ ...plan, planProductId: pp.id!, productId: pp.productId, mouldId: pp.mouldId });
    draftPackingByProduct.set(pp.productId, arr);
  }
  // Pull packing drafts out of the produce-draft pool if they slipped
  // in (they have "— consolidated" not "— packing" in the produce pool,
  // so this is normally a no-op, but defensive against mis-named data).
  for (const productId of draftPackingByProduct.keys()) {
    draftBatchesByProduct.delete(productId);
  }

  for (const [productId, demands] of borrowDemandByProduct) {
    const product = productById.get(productId);
    if (!product) continue; // already warned above if missing
    // Packing batches don't drive a mould load — use the product's
    // default mould as a reference only so the planProduct row has a
    // valid FK. Scheduler recognises packing batches and skips mould
    // span recording for them.
    const mould = product.defaultMouldId ? mouldById.get(product.defaultMouldId) : undefined;
    if (!mould) continue; // skip if no mould at all; packing without a product-mould context is edge
    const totalDemand = demands.reduce((s, d) => s + d.remaining, 0);
    const allocations = demands.map((d) => ({ orderItemId: d.itemId, allocatedQuantity: d.remaining }));

    const existingDrafts = draftPackingByProduct.get(productId) ?? [];
    const primary = existingDrafts[0];
    for (let i = 1; i < existingDrafts.length; i++) {
      const extra = existingDrafts[i];
      decision.plansToCancel.push(extra.id!);
      for (const link of links) {
        if (link.planId === extra.id && link.id) decision.linksToDelete.push(link.id);
      }
    }

    if (primary) {
      for (const link of links) {
        if (link.planId === primary.id && link.id) decision.linksToDelete.push(link.id);
      }
      decision.updateBatches.push({
        tempId: `__update_${tempCounter++}`,
        planId: primary.id!,
        planProductId: primary.planProductId,
        productId,
        productName: product.name,
        mouldId: mould.id!,
        moulds: 1, // nominal — packing doesn't cast moulds
        totalPieces: totalDemand,
        totalDemand,
        surplus: 0,
        allocations,
        kind: "packing",
      });
    } else {
      decision.newBatches.push({
        tempId: `__new_${tempCounter++}`,
        productId,
        productName: product.name,
        mouldId: mould.id!,
        moulds: 1,
        totalPieces: totalDemand,
        totalDemand,
        surplus: 0,
        allocations,
        kind: "packing",
      });
    }
    draftPackingByProduct.delete(productId);
  }

  // Cancel leftover draft packing batches whose product no longer
  // has borrow demand.
  for (const [, extras] of draftPackingByProduct) {
    for (const plan of extras) {
      decision.plansToCancel.push(plan.id!);
      for (const link of links) {
        if (link.planId === plan.id && link.id) decision.linksToDelete.push(link.id);
      }
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
  // Dedup plansToCancel too — defensive.
  decision.plansToCancel = [...new Set(decision.plansToCancel)];

  return decision;
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
