/**
 * Manual planner v2 — demand aggregation.
 *
 * Pure function: given open orders + open POs + plans + stock, produce a
 * per-product demand row used by the DemandPicker. Subtracts pieces
 * already linked to active or done plans so the picker shows what's
 * still actually needed.
 *
 * Variant-derived demand (orderVariantLines expanded via composition)
 * is intentionally excluded from this aggregator's clickable-line lists
 * — `OrderPlanLink` keys on `orderItemId`, not on variant lines, so we
 * can't allocate them via the existing link table. They flow into
 * totalDemand only when the underlying orderItem rows exist (which they
 * don't for variant lines). Documented in spec section "Honest deferred
 * items" → carried forward.
 */

import type {
  Order,
  OrderItem,
  OrderPlanLink,
  PlanProduct,
  PoPlanLink,
  Product,
  ProductionOrder,
  ProductionOrderItem,
  ProductionPlan,
  Mould,
} from "@/types";

export type UrgencyLevel = "none" | "soon" | "urgent" | "overdue";

export interface OrderDemandLine {
  orderItemId: string;
  orderId: string;
  customerName: string;
  channel: string;
  sourceRef?: string;
  /** Optional `orders.priority` so chips can filter on "urgent". */
  priority?: Order["priority"];
  remaining: number;
  /** Original order qty before subtracting active/done allocations. */
  originalQty: number;
  /** Already linked to active or done plans (informational). */
  alreadyAllocated: number;
  /** Qty linked to status='draft' plans (parked OR active drafts).
   *  Surfaces "X of Y left" pills without double-counting. */
  inDraftQty: number;
  dueDate: Date | null;
  urgency: UrgencyLevel;
}

export interface PoDemandLine {
  poItemId: string;
  productionOrderId: string;
  poName: string;
  channel: string; // restock / campaign_run
  remaining: number;
  originalQty: number;
  /** Qty linked to active+done plans via poPlanLinks (mig 0094). */
  alreadyAllocated: number;
  /** Qty linked to draft plans via poPlanLinks. */
  inDraftQty: number;
  dueDate: Date | null;
  urgency: UrgencyLevel;
}

export interface ProductDemand {
  productId: string;
  productName: string;
  /** Bucket label for category grouping (e.g. "3-cav · 40 pcs/run"). */
  category: string;
  /** Sort key within parent category — keeps grouping stable. */
  categorySort: number;
  mouldId: string | null;
  mouldName: string;
  numberOfCavities: number;
  quantityOwned: number;
  totalDemand: number;
  orderDemand: number;
  poDemand: number;
  currentStock: number;
  alreadyPlannedInDrafts: number;
  alreadyPlannedInActive: number;
  /** Sum of (orderPlanLinks + poPlanLinks).allocatedQuantity where the
   *  linked plan is status='draft'. Drives the "in draft" badge and
   *  the "X of Y left" pill in the demand list. */
  inDraftQty: number;
  /** How many distinct draft plans touch this product (for "in draft × 2"). */
  draftCount: number;
  urgencyLevel: UrgencyLevel;
  earliestDeadline: Date | null;
  orderItems: OrderDemandLine[];
  poItems: PoDemandLine[];
}

export interface AggregateDemandInput {
  orders: Order[];
  orderItems: OrderItem[];
  productionOrders: ProductionOrder[];
  productionOrderItems: ProductionOrderItem[];
  products: Product[];
  moulds: Mould[];
  plans: ProductionPlan[];
  planProducts: PlanProduct[];
  links: OrderPlanLink[];
  /** PO ↔ plan links — mig 0094. Used to subtract PO allocations from
   *  open-PO remaining and to track per-line inDraftQty. */
  poLinks?: PoPlanLink[];
  /** Loose-piece stock per product (sum of non-allocated locations). */
  stockByProduct: Map<string, number>;
  /** Today as ISO yyyy-mm-dd, used to compute urgency. Defaults to today. */
  todayIso?: string;
}

const OPEN_ORDER_STATUSES = new Set<Order["status"]>(["pending", "in_production", "ready_to_pack"]);
const OPEN_PO_STATUSES = new Set<ProductionOrder["status"]>(["pending", "in_production"]);

const DAY_MS = 1000 * 60 * 60 * 24;

function urgencyFor(due: Date | null, todayMs: number): UrgencyLevel {
  if (!due) return "none";
  const dueMs = due.getTime();
  if (Number.isNaN(dueMs)) return "none";
  if (dueMs < todayMs) return "overdue";
  const diffDays = Math.floor((dueMs - todayMs) / DAY_MS);
  if (diffDays <= 3) return "urgent";
  if (diffDays <= 7) return "soon";
  return "none";
}

function maxUrgency(a: UrgencyLevel, b: UrgencyLevel): UrgencyLevel {
  const rank = { overdue: 3, urgent: 2, soon: 1, none: 0 } as const;
  return rank[a] >= rank[b] ? a : b;
}

function categoryFor(mould: Mould | undefined): { label: string; sort: number } {
  if (!mould) return { label: "Unassigned", sort: 9999 };
  const cav = mould.numberOfCavities ?? 0;
  // Group key — mould name + cavity count. Keeps "Bar mould" separate from
  // "3-cav mould" even if names collide; visual label includes pcs/run.
  const label = `${mould.name} · ${cav} pcs/run`;
  return { label, sort: cav };
}

export function aggregateDemandByProduct(input: AggregateDemandInput): ProductDemand[] {
  const todayIso = input.todayIso ?? new Date().toISOString().slice(0, 10);
  const todayMs = new Date(todayIso + "T00:00:00").getTime();

  const productById = new Map(input.products.map((p) => [p.id!, p]));
  const mouldById = new Map(input.moulds.map((m) => [m.id!, m]));
  const orderById = new Map(input.orders.map((o) => [o.id!, o]));
  const poById = new Map(input.productionOrders.map((p) => [p.id!, p]));
  const planById = new Map(input.plans.map((p) => [p.id!, p]));

  // Orders that are still open (production-relevant).
  const openOrderIds = new Set(
    input.orders.filter((o) => OPEN_ORDER_STATUSES.has(o.status)).map((o) => o.id!),
  );

  // Subtract pieces already linked to ACTIVE or DONE plans (those are
  // mid-production or shipped). Demand is what's still missing.
  const activePlanIds = new Set(
    input.plans.filter((p) => p.status === "active").map((p) => p.id!),
  );
  const donePlanIds = new Set(
    input.plans.filter((p) => p.status === "done").map((p) => p.id!),
  );
  const draftPlanIds = new Set(
    input.plans.filter((p) => p.status === "draft").map((p) => p.id!),
  );
  const fulfilledPlanIds = new Set([...activePlanIds, ...donePlanIds]);
  const allocByItem = new Map<string, number>();
  const inDraftByItem = new Map<string, number>();
  for (const link of input.links) {
    if (fulfilledPlanIds.has(link.planId)) {
      allocByItem.set(
        link.orderItemId,
        (allocByItem.get(link.orderItemId) ?? 0) + link.allocatedQuantity,
      );
    } else if (draftPlanIds.has(link.planId)) {
      inDraftByItem.set(
        link.orderItemId,
        (inDraftByItem.get(link.orderItemId) ?? 0) + link.allocatedQuantity,
      );
    }
  }

  // PO links: same allocation/inDraft split, keyed by productionOrderItemId.
  const poLinks = input.poLinks ?? [];
  const allocByPoItem = new Map<string, number>();
  const inDraftByPoItem = new Map<string, number>();
  // Per-product roll-up: how many draft plans touch this product +
  // total in-draft qty across order + po lines.
  const draftPlanIdsByProduct = new Map<string, Set<string>>();
  const inDraftQtyByProduct = new Map<string, number>();
  for (const link of poLinks) {
    if (fulfilledPlanIds.has(link.planId)) {
      allocByPoItem.set(
        link.productionOrderItemId,
        (allocByPoItem.get(link.productionOrderItemId) ?? 0) + link.allocatedQuantity,
      );
    } else if (draftPlanIds.has(link.planId)) {
      inDraftByPoItem.set(
        link.productionOrderItemId,
        (inDraftByPoItem.get(link.productionOrderItemId) ?? 0) + link.allocatedQuantity,
      );
    }
  }

  // Already-planned tally per product, split by active vs draft.
  const plannedActiveByProduct = new Map<string, number>();
  const plannedDraftByProduct = new Map<string, number>();
  for (const pp of input.planProducts) {
    const plan = planById.get(pp.planId);
    if (!plan) continue;
    if (plan.status !== "active" && plan.status !== "draft") continue;
    if (pp.actualYield != null) continue; // already produced — counted in stock instead
    const mould = mouldById.get(pp.mouldId);
    const cav = mould?.numberOfCavities ?? 0;
    const expected = pp.quantity * cav;
    if (expected <= 0) continue;
    const target = plan.status === "active" ? plannedActiveByProduct : plannedDraftByProduct;
    target.set(pp.productId, (target.get(pp.productId) ?? 0) + expected);

    // Track draft-plan presence per product for "in draft × N" badges.
    if (plan.status === "draft" && plan.id) {
      const set = draftPlanIdsByProduct.get(pp.productId) ?? new Set<string>();
      set.add(plan.id);
      draftPlanIdsByProduct.set(pp.productId, set);
    }
  }

  // Per-product demand accumulation.
  type Working = ProductDemand & { earliestDeadlineMs: number };
  const working = new Map<string, Working>();

  function ensureRow(productId: string): Working {
    const existing = working.get(productId);
    if (existing) return existing;
    const product = productById.get(productId);
    const mouldId = product?.defaultMouldId ?? null;
    const mould = mouldId ? mouldById.get(mouldId) : undefined;
    const cat = categoryFor(mould);
    const row: Working = {
      productId,
      productName: product?.name ?? productId.slice(0, 8),
      category: cat.label,
      categorySort: cat.sort,
      mouldId,
      mouldName: mould?.name ?? "—",
      numberOfCavities: mould?.numberOfCavities ?? 0,
      quantityOwned: mould?.quantityOwned ?? 1,
      totalDemand: 0,
      orderDemand: 0,
      poDemand: 0,
      currentStock: input.stockByProduct.get(productId) ?? 0,
      alreadyPlannedInDrafts: plannedDraftByProduct.get(productId) ?? 0,
      alreadyPlannedInActive: plannedActiveByProduct.get(productId) ?? 0,
      inDraftQty: 0,
      draftCount: draftPlanIdsByProduct.get(productId)?.size ?? 0,
      urgencyLevel: "none",
      earliestDeadline: null,
      earliestDeadlineMs: Number.POSITIVE_INFINITY,
      orderItems: [],
      poItems: [],
    };
    working.set(productId, row);
    return row;
  }

  // A — orders.
  for (const item of input.orderItems) {
    if (!openOrderIds.has(item.orderId)) continue;
    if ((item.fulfilmentMode ?? "produce") !== "produce") continue;
    if (item.variantId) continue; // variant-derived items: see file header.
    const order = orderById.get(item.orderId);
    if (!order) continue;
    const alreadyAllocated = allocByItem.get(item.id ?? "") ?? 0;
    const inDraftQty = inDraftByItem.get(item.id ?? "") ?? 0;
    const remaining = Math.max(0, item.quantity - alreadyAllocated - inDraftQty);
    if (remaining <= 0 && inDraftQty === 0) continue;

    const due = order.deadline ? new Date(order.deadline) : null;
    const urgency = urgencyFor(due, todayMs);
    const row = ensureRow(item.productId);
    row.orderItems.push({
      orderItemId: item.id!,
      orderId: order.id!,
      customerName: order.customerName ?? order.eventName ?? order.sourceRef ?? "Anonymous",
      channel: order.channel,
      sourceRef: order.sourceRef,
      priority: order.priority,
      remaining,
      originalQty: item.quantity,
      alreadyAllocated,
      inDraftQty,
      dueDate: due,
      urgency,
    });
    row.orderDemand += remaining;
    row.totalDemand += remaining;
    row.inDraftQty += inDraftQty;
    inDraftQtyByProduct.set(item.productId, (inDraftQtyByProduct.get(item.productId) ?? 0) + inDraftQty);
    row.urgencyLevel = maxUrgency(row.urgencyLevel, urgency);
    if (due) {
      const ms = due.getTime();
      if (!Number.isNaN(ms) && ms < row.earliestDeadlineMs) {
        row.earliestDeadlineMs = ms;
        row.earliestDeadline = due;
      }
    }
  }

  // B — production orders.
  const openPoIds = new Set(
    input.productionOrders.filter((p) => OPEN_PO_STATUSES.has(p.status)).map((p) => p.id!),
  );
  for (const it of input.productionOrderItems) {
    if (!openPoIds.has(it.productionOrderId)) continue;
    const po = poById.get(it.productionOrderId);
    if (!po) continue;
    // PO links land in poPlanLinks (mig 0094). Subtract both fulfilled
    // and in-draft allocations so the picker shows true remaining.
    const alreadyAllocated = allocByPoItem.get(it.id ?? "") ?? 0;
    const inDraftQty = inDraftByPoItem.get(it.id ?? "") ?? 0;
    const remaining = Math.max(0, it.targetUnits - alreadyAllocated - inDraftQty);
    if (remaining <= 0 && inDraftQty === 0) continue;
    const due = po.dueDate ? new Date(po.dueDate) : null;
    const urgency = urgencyFor(due, todayMs);
    const row = ensureRow(it.productId);
    row.poItems.push({
      poItemId: it.id!,
      productionOrderId: po.id!,
      poName: po.name ?? po.channel,
      channel: po.channel,
      remaining,
      originalQty: it.targetUnits,
      alreadyAllocated,
      inDraftQty,
      dueDate: due,
      urgency,
    });
    row.poDemand += remaining;
    row.totalDemand += remaining;
    row.inDraftQty += inDraftQty;
    inDraftQtyByProduct.set(it.productId, (inDraftQtyByProduct.get(it.productId) ?? 0) + inDraftQty);
    row.urgencyLevel = maxUrgency(row.urgencyLevel, urgency);
    if (due) {
      const ms = due.getTime();
      if (!Number.isNaN(ms) && ms < row.earliestDeadlineMs) {
        row.earliestDeadlineMs = ms;
        row.earliestDeadline = due;
      }
    }
  }

  // Sort each product's lines by deadline ascending, nulls last.
  const out: ProductDemand[] = [];
  for (const row of working.values()) {
    row.orderItems.sort((a, b) => sortByDue(a.dueDate, b.dueDate));
    row.poItems.sort((a, b) => sortByDue(a.dueDate, b.dueDate));
    // Finalise per-product draftCount from the per-product set built above.
    row.draftCount = draftPlanIdsByProduct.get(row.productId)?.size ?? 0;
    // Strip the working-only field.
    const { earliestDeadlineMs: _omit, ...rest } = row;
    out.push(rest);
  }
  // Default order: highest demand first within each category.
  out.sort((a, b) => {
    if (a.categorySort !== b.categorySort) return a.categorySort - b.categorySort;
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    if (b.totalDemand !== a.totalDemand) return b.totalDemand - a.totalDemand;
    return a.productName.localeCompare(b.productName);
  });
  return out;
}

function sortByDue(a: Date | null, b: Date | null): number {
  if (a && b) return a.getTime() - b.getTime();
  if (a) return -1;
  if (b) return 1;
  return 0;
}
