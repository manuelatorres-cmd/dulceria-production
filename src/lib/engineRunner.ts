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
      .eq("status", "pending")
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

/** Upsert-if-newer logic: if an existing pending proposal for the
 *  same (product, location) already exists we overwrite its
 *  suggestedBatchSize + earliestNeededDate + reason, otherwise
 *  create a new row. */
async function upsertProposals(
  proposals: Array<Omit<ReplenishmentProposal, "id" | "createdAt" | "updatedAt">>,
  existing: ReplenishmentProposal[],
): Promise<{ written: number; updated: number }> {
  let written = 0;
  let updated = 0;

  const existingByKey = new Map<string, ReplenishmentProposal>();
  for (const p of existing) {
    existingByKey.set(`${p.productId}|${p.locationId ?? ""}`, p);
  }

  const rowsToUpsert: ReplenishmentProposal[] = proposals.map((p) => {
    const key = `${p.productId}|${p.locationId ?? ""}`;
    const existingRow = existingByKey.get(key);
    if (existingRow) {
      updated++;
      return {
        ...existingRow,
        suggestedBatchSize: p.suggestedBatchSize,
        earliestNeededDate: p.earliestNeededDate,
        priorityTier: p.priorityTier,
        reason: p.reason,
        status: "pending" as const,
      };
    }
    written++;
    return {
      id: newId(),
      ...p,
    };
  });

  if (rowsToUpsert.length === 0) return { written, updated };

  const { error } = await supabase
    .from("replenishmentProposals")
    .upsert(rowsToUpsert, { onConflict: "id" });
  if (error) throw error;
  return { written, updated };
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
  const { written, updated } = await upsertProposals(all, snap.existingProposals);

  queryClient.invalidateQueries({ queryKey: ["replenishmentProposals"] });

  return {
    proposalsConsidered: all.length,
    proposalsWritten: written,
    proposalsUpdated: updated,
    campaignsContributed: campaignProposals.length,
    ranAt: todayISO(),
  };
}
