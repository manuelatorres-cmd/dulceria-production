/**
 * Weekly filling consolidation — Phase 5 of the production planning system.
 *
 * Aggregates filling requirements across ALL open orders that fall within a
 * deadline window (default 7 days), groups by filling, subtracts what's
 * already available in `fillingStock`, applies the global filling buffer %,
 * and returns a cooking list with per-order attribution plus a suggested
 * "cook by" date.
 *
 * This is the pre-production view: it runs before any productionPlan exists
 * for an order. The unit is an *order item* (productId + pieces) rather than
 * a planProduct. We synthesise planProducts on the fly from each order's
 * items so we can reuse `calculateFillingAmounts` / `consolidateSharedFillings`
 * from src/lib/production.ts — the same maths the production wizard runs, just
 * fed from orders instead of the wizard's own plan.
 *
 * Pure function, no React / no DB. Everything comes in as arguments; callers
 * (the /plan/fillings page) load the data via existing hooks.
 */

import {
  calculateFillingAmounts,
  consolidateSharedFillings,
  type FillingAmount,
  type ConsolidatedFilling,
} from "@/lib/production";
import type {
  Filling, FillingCategory, FillingIngredient, FillingStock,
  Mould, Order, OrderItem, PlanProduct, Product, ProductFilling,
  Campaign, ProductionOrder, ProductionOrderItem,
} from "@/types";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface WeeklyFillingInput {
  orders: Order[];
  orderItems: OrderItem[];
  products: Product[];
  productFillings: ProductFilling[];
  fillingIngredients: FillingIngredient[];
  fillings: Filling[];
  /** Configurable category metadata — `shelfStable` flag drives the weight
   *  calculation path in `calculateFillingAmounts`. */
  fillingCategories: FillingCategory[];
  moulds: Mould[];
  /** Current `fillingStock` rows. Non-frozen availability is subtracted from
   *  required weight; frozen stock is reported separately (informational). */
  fillingStock: FillingStock[];
  /** Global overproduction buffer, 0–100. Falls back to 0 when undefined. */
  fillingBufferPercent?: number;
  /** Deadline window end (inclusive). Orders with deadlines after this are
   *  excluded. Defaults to now + 7 days. */
  windowEnd?: Date;
  /** Optional "now" injection for deterministic tests. */
  now?: Date;
  /** Internal-demand sources. Without these, the cook list only saw
   *  customer orders — so refill/replen POs (Hazelnut Caramel,
   *  Kalamansi etc) and campaign targets never showed up. */
  campaigns?: Campaign[];
  productionOrders?: ProductionOrder[];
  productionOrderItems?: ProductionOrderItem[];
}

/** One row of the weekly cooking list. */
export interface WeeklyFillingNeed {
  fillingId: string;
  fillingName: string;
  category: string;
  /** Sum of grams required across every contributing order. */
  requiredG: number;
  /** Grams available in `fillingStock` (non-frozen, not superseded). */
  availableG: number;
  /** Grams available in the freezer (informational — not subtracted). */
  frozenG: number;
  /** Remaining to cook after subtracting `availableG`, floored at 0. */
  toCookG: number;
  /** `toCookG` scaled by (1 + buffer%). */
  toCookBufferedG: number;
  /** True when two or more orders need this filling. */
  shared: boolean;
  /** Orders / products contributing to this need. */
  usedBy: Array<{
    orderId: string;
    orderLabel: string;
    productName: string;
    deadline: Date;
    weightG: number;
  }>;
  /** Earliest deadline among contributing orders. */
  earliestDeadline: Date;
  /** Suggested day to finish cooking this filling by, based on the earliest
   *  deadline and the filling's shelf-life window (or 2 days before the
   *  deadline when shelf life is unspecified). */
  cookByDate: Date;
  /** Shelf life in weeks, if set on the filling. */
  shelfLifeWeeks?: number;
  /** Free-form instructions (drying/resting/cooking notes) copied from the
   *  filling definition so the cooking list is self-contained. */
  instructions?: string;
  /** Scaled ingredient amounts for `toCookBufferedG`. */
  scaledIngredients: Array<{ ingredientId: string; amount: number; unit: string }>;
}

export interface WeeklyFillingResult {
  windowStart: Date;
  windowEnd: Date;
  /** Open orders within the window that contributed to this rollup. */
  ordersInWindow: Order[];
  /** One entry per unique filling, sorted by earliest deadline (cook-first). */
  needs: WeeklyFillingNeed[];
  /** Orders-with-deadline within the window but for which no filling could
   *  be computed (e.g. product without a default mould). Useful as a warning
   *  list so the UI can surface "3 order items couldn't be consolidated". */
  unresolved: Array<{ orderId: string; productId: string; reason: string }>;
}

function orderLabel(order: Order): string {
  return order.customerName || order.eventName || "Order";
}

export function computeWeeklyFillingNeeds(input: WeeklyFillingInput): WeeklyFillingResult {
  const now = input.now ?? new Date();
  const windowStart = now;
  const windowEnd = input.windowEnd ?? new Date(now.getTime() + 7 * DAY_MS);
  const windowEndMs = windowEnd.getTime();

  const OPEN_STATUSES = new Set(["pending", "in_production"]);
  const ordersInWindow = input.orders
    .filter((o) => OPEN_STATUSES.has(o.status) && new Date(o.deadline).getTime() <= windowEndMs)
    .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
  const orderIdSet = new Set(ordersInWindow.map((o) => o.id!));
  const itemsInWindow = input.orderItems.filter((oi) => orderIdSet.has(oi.orderId));

  // Maps used by both the synthetic planProduct build and the filling call.
  const productById = new Map(input.products.map((p) => [p.id!, p] as const));
  const productNames = new Map(input.products.map((p) => [p.id!, p.name] as const));
  const mouldById = new Map(input.moulds.map((m) => [m.id!, m] as const));
  const fillingById = new Map(input.fillings.map((f) => [f.id!, f] as const));
  const shelfStableSet = new Set(
    input.fillingCategories.filter((c) => c.shelfStable).map((c) => c.name),
  );

  const productFillingsMap = new Map<string, ProductFilling[]>();
  for (const pf of input.productFillings) {
    const arr = productFillingsMap.get(pf.productId) ?? [];
    arr.push(pf);
    productFillingsMap.set(pf.productId, arr);
  }
  const fillingIngredientsMap = new Map<string, FillingIngredient[]>();
  for (const fi of input.fillingIngredients) {
    const arr = fillingIngredientsMap.get(fi.fillingId) ?? [];
    arr.push(fi);
    fillingIngredientsMap.set(fi.fillingId, arr);
  }

  const unresolved: WeeklyFillingResult["unresolved"] = [];

  // Construct synthetic planProducts keyed by a stable string so we can trace
  // each back to its contributing order after consolidation.
  const syntheticPlanProducts: PlanProduct[] = [];
  const syntheticIdToOrder = new Map<string, { order: Order; productId: string; pieces: number }>();

  for (const item of itemsInWindow) {
    const product = productById.get(item.productId);
    if (!product) {
      unresolved.push({ orderId: item.orderId, productId: item.productId, reason: "Product not found" });
      continue;
    }
    const mouldId = product.defaultMouldId;
    const mould = mouldId ? mouldById.get(mouldId) : undefined;
    if (!mould) {
      unresolved.push({ orderId: item.orderId, productId: item.productId, reason: "Product has no default mould — set one to include in cooking lists" });
      continue;
    }
    const cavities = mould.numberOfCavities;
    if (!cavities || cavities <= 0) {
      unresolved.push({ orderId: item.orderId, productId: item.productId, reason: "Mould has no cavity count" });
      continue;
    }
    // pieces → number of mould units (rounded up so we don't short-cook)
    const quantity = Math.max(1, Math.ceil(item.quantity / cavities));
    const syntheticId = `wkf-${item.id}`;
    const order = ordersInWindow.find((o) => o.id === item.orderId)!;
    syntheticIdToOrder.set(syntheticId, { order, productId: item.productId, pieces: item.quantity });
    syntheticPlanProducts.push({
      id: syntheticId,
      planId: "weekly-filling-synthetic",
      productId: item.productId,
      mouldId: mould.id!,
      quantity,
      sortOrder: 0,
    });
  }

  // PO-driven demand: every productionOrderItem on a pending /
  // in_production PO (replen, internal) whose due date falls within
  // the cook window contributes a synthetic planProduct so its
  // fillings show up in the cook list. Without this, replen-only
  // products (Hazelnut Caramel, Kalamansi etc) never appeared.
  const todayMs = now.getTime();
  for (const po of input.productionOrders ?? []) {
    if (po.status !== "pending" && po.status !== "in_production") continue;
    const dueMs = po.dueDate ? new Date(`${po.dueDate}T12:00:00`).getTime() : todayMs;
    if (dueMs > windowEndMs) continue;
    const items = (input.productionOrderItems ?? []).filter((it) => it.productionOrderId === po.id);
    for (const it of items) {
      const product = productById.get(it.productId);
      if (!product) continue;
      const mouldId = product.defaultMouldId;
      const mould = mouldId ? mouldById.get(mouldId) : undefined;
      if (!mould || !mould.numberOfCavities || mould.numberOfCavities <= 0) continue;
      const quantity = Math.max(1, Math.ceil(it.targetUnits / mould.numberOfCavities));
      const syntheticId = `wkf-po-${it.id}`;
      // Map back to a synthetic "order" for the usedBy display so the
      // operator sees which PO is driving the demand.
      const fakeOrder: Order = {
        id: `po:${po.id}`,
        channel: "shop",
        customerName: po.name ?? `PO · ${po.dueDate}`,
        deadline: po.dueDate ? `${po.dueDate}T12:00:00.000Z` : new Date(windowEndMs).toISOString(),
        priority: "normal",
        status: "pending",
      };
      syntheticIdToOrder.set(syntheticId, { order: fakeOrder, productId: it.productId, pieces: it.targetUnits });
      syntheticPlanProducts.push({
        id: syntheticId,
        planId: "weekly-filling-synthetic",
        productId: it.productId,
        mouldId: mould.id!,
        quantity,
        sortOrder: 0,
      });
    }
  }

  // Campaign productTargets — same expansion. Use startDate as the
  // demand date (production runs ramp toward go-live).
  for (const c of input.campaigns ?? []) {
    if (c.status !== "planned" && c.status !== "active") continue;
    const startMs = c.startDate ? new Date(`${c.startDate}T12:00:00`).getTime() : todayMs;
    if (startMs > windowEndMs) continue;
    const targets = c.productTargets ?? {};
    for (const [pid, units] of Object.entries(targets)) {
      const product = productById.get(pid);
      if (!product || units <= 0) continue;
      const mouldId = product.defaultMouldId;
      const mould = mouldId ? mouldById.get(mouldId) : undefined;
      if (!mould || !mould.numberOfCavities || mould.numberOfCavities <= 0) continue;
      const quantity = Math.max(1, Math.ceil(units / mould.numberOfCavities));
      const syntheticId = `wkf-camp-${c.id}-${pid}`;
      const fakeOrder: Order = {
        id: `campaign:${c.id}`,
        channel: "shop",
        customerName: `Campaign · ${c.name}`,
        deadline: c.startDate ? `${c.startDate}T12:00:00.000Z` : new Date(windowEndMs).toISOString(),
        priority: "normal",
        status: "pending",
      };
      syntheticIdToOrder.set(syntheticId, { order: fakeOrder, productId: pid, pieces: units });
      syntheticPlanProducts.push({
        id: syntheticId,
        planId: "weekly-filling-synthetic",
        productId: pid,
        mouldId: mould.id!,
        quantity,
        sortOrder: 0,
      });
    }
  }

  const fillingAmounts: FillingAmount[] = calculateFillingAmounts(
    syntheticPlanProducts,
    productNames,
    productFillingsMap,
    fillingIngredientsMap,
    fillingById,
    mouldById,
    {}, // no fillingOverrides at the weekly level — wizard handles multipliers per plan
    {}, // no previous-batch overrides at this level
    productById,
    shelfStableSet,
  );

  // Stock lookups — sum non-frozen remaining per filling (consumable now) and
  // frozen remaining (informational).
  const availableByFilling = new Map<string, number>();
  const frozenByFilling = new Map<string, number>();
  for (const s of input.fillingStock) {
    if (s.remainingG <= 0) continue;
    if (s.frozen) {
      frozenByFilling.set(s.fillingId, (frozenByFilling.get(s.fillingId) ?? 0) + s.remainingG);
    } else {
      availableByFilling.set(s.fillingId, (availableByFilling.get(s.fillingId) ?? 0) + s.remainingG);
    }
  }

  // Consolidate synthetic amounts into per-filling totals.
  const consolidated: ConsolidatedFilling[] = consolidateSharedFillings(fillingAmounts);

  const bufferPct = Math.max(0, Math.min(100, input.fillingBufferPercent ?? 0));
  const bufferMult = 1 + bufferPct / 100;
  const WEEK = 7 * DAY_MS;

  const needs: WeeklyFillingNeed[] = consolidated.map((c) => {
    const filling = fillingById.get(c.fillingId);
    const available = availableByFilling.get(c.fillingId) ?? 0;
    const frozen = frozenByFilling.get(c.fillingId) ?? 0;
    const toCook = Math.max(0, c.totalWeightG - available);
    const toCookBuffered = Math.round(toCook * bufferMult);

    // Map synthetic usedBy entries back to their originating orders.
    const usedBy: WeeklyFillingNeed["usedBy"] = c.usedBy.map((u) => {
      const meta = syntheticIdToOrder.get(u.planProductId);
      const order = meta?.order;
      return {
        orderId: order?.id ?? "",
        orderLabel: order ? orderLabel(order) : u.productName,
        productName: u.productName,
        deadline: order ? new Date(order.deadline) : new Date(windowEndMs),
        weightG: u.weightG,
      };
    });
    // Dedup + sum per (order, product) so two items in the same order don't
    // show up twice in the usedBy display.
    const merged = new Map<string, WeeklyFillingNeed["usedBy"][number]>();
    for (const u of usedBy) {
      const key = `${u.orderId}:${u.productName}`;
      const prior = merged.get(key);
      if (prior) {
        prior.weightG += u.weightG;
      } else {
        merged.set(key, { ...u });
      }
    }
    const mergedUsedBy = Array.from(merged.values()).sort(
      (a, b) => a.deadline.getTime() - b.deadline.getTime(),
    );
    const earliestDeadline = mergedUsedBy[0]?.deadline ?? new Date(windowEndMs);

    const shelfLifeWeeks = filling?.shelfLifeWeeks;
    // Cook-by heuristic: at minimum 2 days before the earliest deadline, but
    // never earlier than the available shelf life allows. If the filling has a
    // short shelf life (e.g. 1 week), we can't cook it more than that many
    // days before the deadline or it'll expire before the batch is made.
    const daysBefore = shelfLifeWeeks && shelfLifeWeeks > 0
      ? Math.min(Math.floor(shelfLifeWeeks * 7) - 1, 2)
      : 2;
    const cookByDate = new Date(earliestDeadline.getTime() - Math.max(0, daysBefore) * DAY_MS);

    return {
      fillingId: c.fillingId,
      fillingName: c.fillingName,
      category: filling?.category ?? "",
      requiredG: c.totalWeightG,
      availableG: Math.min(available, c.totalWeightG),
      frozenG: frozen,
      toCookG: toCook,
      toCookBufferedG: toCookBuffered,
      shared: mergedUsedBy.length > 1,
      usedBy: mergedUsedBy,
      earliestDeadline,
      cookByDate,
      shelfLifeWeeks,
      instructions: filling?.instructions,
      scaledIngredients: c.scaledIngredients.map((si) => ({
        ingredientId: si.ingredientId,
        // Rescale from the consolidated required weight to the buffered
        // to-cook weight so the ingredient list reflects what you actually
        // measure out today.
        amount: c.totalWeightG > 0
          ? Math.round(si.amount * (toCookBuffered / c.totalWeightG) * 10) / 10
          : 0,
        unit: si.unit,
      })),
    };
  });

  needs.sort((a, b) => a.earliestDeadline.getTime() - b.earliestDeadline.getTime());

  // Deterministic tie-breaker on unresolved — sort by orderId then productId
  // so snapshot tests stay stable.
  unresolved.sort((a, b) => a.orderId.localeCompare(b.orderId) || a.productId.localeCompare(b.productId));

  return {
    windowStart,
    windowEnd,
    ordersInWindow,
    needs,
    unresolved,
  };
}
