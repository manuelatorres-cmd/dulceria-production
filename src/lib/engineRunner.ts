/**
 * Engine runner — ties the pure scheduling engines (replenishment,
 * campaign) to live Supabase data. Kept in its own file so the pure
 * engines in replenishmentEngine.ts / campaignScheduler.ts stay
 * unit-testable without pulling in Supabase.
 *
 * Runner is conservative:
 *   - Only writes proposals for products with a positive minimum
 *     (either a row in `locationStockMinimums`, or the legacy
 *     `stockLocationMinimums`, or a non-zero `lowStockThreshold`).
 *   - Upserts on (productId, status='pending', locationId) so re-running
 *     doesn't create duplicates.
 *   - Leaves `scheduled` / `dismissed` proposals untouched.
 */

import { supabase, newId } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import { queryClient } from "@/lib/query-client";
import type {
  Campaign,
  DailySellEstimate,
  Product,
  ReplenishmentProposal,
  StockLocationMinimum,
  LocationStockMinimum,
  Mould,
} from "@/types";
import {
  runReplenishmentEngine,
  todayISO,
  type PendingDemand,
  type ScheduledBatch,
} from "./replenishmentEngine";
import { runCampaignScheduler } from "./campaignScheduler";

export interface EngineRunSummary {
  proposalsConsidered: number;
  proposalsWritten: number;
  proposalsUpdated: number;
  /** Dismissed proposals revived because stock entered the critical
   *  zone. Surfaced in the dashboard summary so the user knows the
   *  engine overrode their silence for a good reason. */
  proposalsRevived: number;
  campaignsContributed: number;
  ranAt: string;
}

/** Location ids the runner evaluates against. Matches the legacy
 *  StockLocation union from the existing stock pipeline. */
const LOCATIONS = ["store", "production", "freezer"] as const;

/** Pull every moving part the engine needs in one batch. */
async function loadSnapshot() {
  const [
    products,
    mouldsRaw,
    estimates,
    locMinsNew,
    locMinsLegacy,
    stockLocationsRaw,
    planProductsRaw,
    campaigns,
    orderItemsRaw,
    ordersRaw,
    existingProposalsRaw,
  ] = await Promise.all([
    supabase.from("products").select("*").then((r) => assertOk(r) as Product[]),
    supabase.from("moulds").select("id, numberOfCavities").then(
      (r) => assertOk(r) as Array<Pick<Mould, "id" | "numberOfCavities">>,
    ),
    supabase.from("dailySellEstimates").select("*").then(
      (r) => assertOk(r) as DailySellEstimate[],
    ),
    supabase.from("locationStockMinimums").select("*").then(
      (r) => assertOk(r) as LocationStockMinimum[],
    ),
    supabase.from("stockLocationMinimums").select("*").then(
      (r) => assertOk(r) as StockLocationMinimum[],
    ),
    supabase.from("stockLocations").select("*").then(
      (r) =>
        assertOk(r) as Array<{
          planProductId: string;
          location: (typeof LOCATIONS)[number];
          quantity: number;
        }>,
    ),
    supabase.from("planProducts").select("id, productId").then(
      (r) => assertOk(r) as Array<{ id: string; productId: string }>,
    ),
    supabase
      .from("campaigns")
      .select("*")
      .in("status", ["planned", "active"])
      .then((r) => assertOk(r) as Campaign[]),
    supabase.from("orderItems").select("id, orderId, productId, quantity").then(
      (r) =>
        assertOk(r) as Array<{
          id: string;
          orderId: string;
          productId: string;
          quantity: number;
        }>,
    ),
    supabase
      .from("orders")
      .select("id, deadline, status")
      .in("status", ["pending", "in_production"])
      .then(
        (r) =>
          assertOk(r) as Array<{
            id: string;
            deadline: string;
            status: string;
          }>,
      ),
    supabase
      .from("replenishmentProposals")
      .select("*")
      .in("status", ["pending", "dismissed"])
      .then((r) => assertOk(r) as ReplenishmentProposal[]),
  ]);

  return {
    products,
    moulds: mouldsRaw,
    estimates,
    locMinsNew,
    locMinsLegacy,
    stockLocations: stockLocationsRaw,
    planProducts: planProductsRaw,
    campaigns,
    orderItems: orderItemsRaw,
    orders: ordersRaw,
    existingProposals: existingProposalsRaw,
  };
}

/** Read one side of the snapshot into a (productId, locationId) →
 *  piece-count map. */
function buildStockMap(
  stockRows: Awaited<ReturnType<typeof loadSnapshot>>["stockLocations"],
  planProducts: Awaited<ReturnType<typeof loadSnapshot>>["planProducts"],
): Map<string, number> {
  const productByBatch = new Map(planProducts.map((b) => [b.id, b.productId] as const));
  const m = new Map<string, number>();
  for (const row of stockRows) {
    const productId = productByBatch.get(row.planProductId);
    if (!productId) continue;
    const key = `${productId}|${row.location}`;
    m.set(key, (m.get(key) ?? 0) + row.quantity);
  }
  return m;
}

/** Use `locationStockMinimums` if any row exists for the (product, loc)
 *  pair; otherwise fall back to the legacy channel-based
 *  `stockLocationMinimums`. */
function mergeMinimums(
  locNew: LocationStockMinimum[],
  locLegacy: StockLocationMinimum[],
): StockLocationMinimum[] {
  const merged: StockLocationMinimum[] = [...locLegacy];
  for (const row of locNew) {
    if (row.entityType !== "product") continue;
    merged.push({
      productId: row.entityId,
      location: row.locationId as unknown as StockLocationMinimum["location"],
      minimumUnits: row.minQuantity,
      maximumUnits: row.targetQuantity,
      updatedAt: row.updatedAt ?? new Date(),
    });
  }
  return merged;
}

/** Mould floor = numberOfCavities of the product's defaultMouldId.
 *  Falls back to 40 when missing. */
function buildMouldFloorMap(
  products: Product[],
  moulds: Array<Pick<Mould, "id" | "numberOfCavities">>,
): Map<string, number> {
  const cavByMould = new Map<string, number>();
  for (const m of moulds) {
    if (m.id) cavByMould.set(m.id, m.numberOfCavities ?? 40);
  }
  const out = new Map<string, number>();
  for (const p of products) {
    if (!p.id) continue;
    const floor = p.defaultMouldId
      ? cavByMould.get(p.defaultMouldId) ?? 40
      : 40;
    out.set(p.id, floor);
  }
  return out;
}

function buildPendingDemand(
  orders: Awaited<ReturnType<typeof loadSnapshot>>["orders"],
  orderItems: Awaited<ReturnType<typeof loadSnapshot>>["orderItems"],
): PendingDemand[] {
  const deadlineByOrder = new Map(orders.map((o) => [o.id, o.deadline] as const));
  const out: PendingDemand[] = [];
  for (const item of orderItems) {
    const deadline = deadlineByOrder.get(item.orderId);
    if (!deadline) continue;
    out.push({
      productId: item.productId,
      locationId: "store",
      date: deadline.slice(0, 10),
      quantity: item.quantity,
    });
  }
  return out;
}

/** Upsert-if-newer logic. For each computed proposal:
 *    - If an existing row (pending or dismissed) for the same
 *      (product, location) exists, update its fields.
 *    - Dismissed rows get revived to 'pending' only when the projection
 *      entered the critical zone (stock already below the minimum on
 *      the earliest-needed date). Non-critical cases keep the dismiss
 *      honoured until its 2-day quiet window expires.
 *    - Otherwise insert a new row.
 *
 *  Return counts include a revived figure for the dashboard summary.
 */
async function upsertProposals(
  proposals: Array<Omit<ReplenishmentProposal, "id" | "createdAt" | "updatedAt">>,
  existing: ReplenishmentProposal[],
  criticalKeys: Set<string>,
): Promise<{ written: number; updated: number; revived: number }> {
  let written = 0;
  let updated = 0;
  let revived = 0;

  const existingByKey = new Map<string, ReplenishmentProposal>();
  for (const p of existing) {
    existingByKey.set(`${p.productId}|${p.locationId ?? ""}`, p);
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const rowsToUpsert: ReplenishmentProposal[] = [];

  for (const p of proposals) {
    const key = `${p.productId}|${p.locationId ?? ""}`;
    const existingRow = existingByKey.get(key);
    const critical = criticalKeys.has(key);

    if (existingRow) {
      // Dismissed rows stay dismissed unless critical override kicks in
      // or their quiet window has expired. Respect that here.
      if (existingRow.status === "dismissed") {
        const expired =
          !existingRow.dismissedUntil || existingRow.dismissedUntil <= todayIso;
        if (!expired && !critical) continue;
        revived++;
        rowsToUpsert.push({
          ...existingRow,
          suggestedBatchSize: p.suggestedBatchSize,
          earliestNeededDate: p.earliestNeededDate,
          priorityTier: p.priorityTier,
          reason: p.reason,
          status: "pending",
          dismissedUntil: undefined,
        });
        continue;
      }

      updated++;
      rowsToUpsert.push({
        ...existingRow,
        suggestedBatchSize: p.suggestedBatchSize,
        earliestNeededDate: p.earliestNeededDate,
        priorityTier: p.priorityTier,
        reason: p.reason,
        status: "pending",
      });
      continue;
    }

    written++;
    rowsToUpsert.push({
      id: newId(),
      ...p,
    });
  }

  if (rowsToUpsert.length === 0) return { written, updated, revived };

  const { error } = await supabase
    .from("replenishmentProposals")
    .upsert(rowsToUpsert, { onConflict: "id" });
  if (error) throw error;
  return { written, updated, revived };
}

/** Entry point — call this from a button handler. */
export async function runEngine(): Promise<EngineRunSummary> {
  const snap = await loadSnapshot();
  const stockByKey = buildStockMap(snap.stockLocations, snap.planProducts);
  const minimums = mergeMinimums(snap.locMinsNew, snap.locMinsLegacy);
  const mouldFloor = buildMouldFloorMap(snap.products, snap.moulds);
  const productsById = new Map<string, Product>();
  for (const p of snap.products) if (p.id) productsById.set(p.id, p);

  // No scheduled batches plumbed yet — phase 3 planner wiring fills this in.
  const scheduledBatches: ScheduledBatch[] = [];
  const pendingDemand = buildPendingDemand(snap.orders, snap.orderItems);

  const replenProposals = runReplenishmentEngine({
    products: snap.products,
    stockByKey,
    scheduledBatches,
    pendingDemand,
    estimates: snap.estimates,
    minimums,
    locations: [...LOCATIONS],
    mouldFloorByProduct: mouldFloor,
  });

  const campaignProposals = runCampaignScheduler({
    campaigns: snap.campaigns,
    productsById,
    mouldFloorByProduct: mouldFloor,
  });

  const all = [...replenProposals, ...campaignProposals];

  // Flag (product, location) pairs where stock is already at or below
  // zero on the earliest-needed date. Those cross the critical-stock
  // override that un-dismisses a silenced proposal.
  const criticalKeys = new Set<string>();
  for (const p of replenProposals) {
    const loc = p.locationId ?? "";
    const currentStock = stockByKey.get(`${p.productId}|${loc}`) ?? 0;
    if (currentStock <= 0) {
      criticalKeys.add(`${p.productId}|${loc}`);
    }
  }

  const { written, updated, revived } = await upsertProposals(
    all,
    snap.existingProposals,
    criticalKeys,
  );

  // Surface tier-1 or revived proposals into the notification center
  // so Manuela sees them in the bell without opening the planner.
  // Deduped by (type, entityId) per the notifications primary key so
  // re-runs don't spam.
  const notifRows: Array<{
    id: string;
    type: "replenishment_proposal";
    urgency: "critical" | "high" | "normal";
    status: "open";
    title: string;
    body?: string;
    entityType: "product";
    entityId: string;
    adminOnly: boolean;
    actionLabel?: string;
  }> = [];
  const productsByIdMap = new Map<string, Product>();
  for (const p of snap.products) if (p.id) productsByIdMap.set(p.id, p);
  for (const p of all) {
    const product = productsByIdMap.get(p.productId);
    if (!product) continue;
    const isTier1 = p.priorityTier === 1;
    const isCritical = criticalKeys.has(`${p.productId}|${p.locationId ?? ""}`);
    if (!isTier1 && !isCritical) continue;
    notifRows.push({
      id: newId(),
      type: "replenishment_proposal",
      urgency: isCritical ? "critical" : "high",
      status: "open",
      title: `${product.name} · restock needed`,
      body: `Projected below min ${p.earliestNeededDate}. Suggested batch ${p.suggestedBatchSize} pcs.`,
      entityType: "product",
      entityId: p.productId,
      adminOnly: false,
      actionLabel: "Open planner",
    });
  }
  if (notifRows.length > 0) {
    const { error: notifErr } = await supabase
      .from("notifications")
      .insert(notifRows);
    if (notifErr) console.warn("notification insert failed:", notifErr);
  }

  queryClient.invalidateQueries({ queryKey: ["replenishmentProposals"] });
  queryClient.invalidateQueries({ queryKey: ["notifications"] });

  return {
    proposalsConsidered: all.length,
    proposalsWritten: written,
    proposalsUpdated: updated,
    proposalsRevived: revived,
    campaignsContributed: campaignProposals.length,
    ranAt: todayISO(),
  };
}
