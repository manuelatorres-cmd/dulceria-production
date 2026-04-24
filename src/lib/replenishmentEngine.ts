/**
 * Replenishment engine — pure functions only. No Supabase, no React.
 *
 * Job: given current stock, scheduled batches, and demand signals,
 * decide which products need a fresh batch within the planning horizon
 * and what size that batch should be.
 *
 * The engine never auto-places batches. It writes proposals to the
 * `replenishmentProposals` table; the user drags them onto the
 * calendar (or dismisses them).
 *
 * Inputs are plain objects so this file is unit-testable without any
 * runtime infrastructure.
 */

import type {
  Product,
  DailySellEstimate,
  ReplenishmentProposal,
  ReplenishmentReason,
  StockLocationMinimum,
} from "@/types";

/** A single product's projected stock per day, plus its triggers. */
export interface StockProjectionDay {
  /** ISO date 'YYYY-MM-DD'. */
  date: string;
  projected: number;
  scheduled: number;
  demand: number;
}

export interface StockProjection {
  productId: string;
  locationId: string;
  starting: number;
  min: number;
  target: number;
  days: StockProjectionDay[];
  /** Earliest day projected stock < min. Null when stock stays above min
   *  for the whole horizon. */
  firstShortfallDate: string | null;
  /** True when min is breached and a proposal should be raised. */
  triggers: boolean;
}

/** Existing scheduled batches (read from productionPlans + planProducts).
 *  Pure shape so the engine doesn't import the DB type directly. */
export interface ScheduledBatch {
  productId: string;
  locationId: string;
  /** ISO date 'YYYY-MM-DD' — the day the batch's pieces become
   *  available (after unmould + pack). */
  availableOn: string;
  quantity: number;
}

/** Open order line that draws stock on a specific date. */
export interface PendingDemand {
  productId: string;
  locationId: string;
  /** ISO date 'YYYY-MM-DD' — the day stock is consumed. */
  date: string;
  quantity: number;
}

/** Default planning horizon in days. */
export const DEFAULT_HORIZON_DAYS = 14;

/** Add `n` days to an ISO date 'YYYY-MM-DD'. */
export function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Get today's ISO date. Pulled into a helper so tests can stub it. */
export function todayISO(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Round a piece count up to the product's mould floor. */
export function roundToMouldFloor(needed: number, mouldFloor: number): number {
  if (mouldFloor <= 0) return Math.max(0, Math.ceil(needed));
  if (needed <= 0) return 0;
  return Math.ceil(needed / mouldFloor) * mouldFloor;
}

/** Resolve daily demand for a product at a location, blending the
 *  rolling sell rate with custom-box pulls. Returns 0 when no signal
 *  exists (treated as zero demand, never NaN). */
export function resolveDailyDemand(
  estimates: DailySellEstimate[],
  productId: string,
  locationId: string,
): number {
  const recent = estimates
    .filter((e) => e.productId === productId && e.locationId === locationId)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 1)[0];
  if (!recent) return 0;
  return Math.max(0, recent.rollingAvg30d) + Math.max(0, recent.customBoxPickCount);
}

/** Project stock per day across the horizon for a single product/location. */
export function projectStock(args: {
  productId: string;
  locationId: string;
  startingStock: number;
  min: number;
  target: number;
  /** ISO 'YYYY-MM-DD'. */
  startDate: string;
  horizonDays: number;
  dailyDemand: number;
  scheduledBatches: ScheduledBatch[];
  pendingDemand: PendingDemand[];
}): StockProjection {
  const days: StockProjectionDay[] = [];
  let runningStock = args.startingStock;
  let firstShortfallDate: string | null = null;

  for (let i = 0; i < args.horizonDays; i++) {
    const date = addDays(args.startDate, i);
    const scheduled = args.scheduledBatches
      .filter((b) => b.productId === args.productId && b.locationId === args.locationId && b.availableOn === date)
      .reduce((sum, b) => sum + b.quantity, 0);
    const orderDemand = args.pendingDemand
      .filter((d) => d.productId === args.productId && d.locationId === args.locationId && d.date === date)
      .reduce((sum, d) => sum + d.quantity, 0);

    const dayDemand = args.dailyDemand + orderDemand;
    runningStock = runningStock + scheduled - dayDemand;
    if (runningStock < args.min && firstShortfallDate === null) {
      firstShortfallDate = date;
    }
    days.push({ date, projected: runningStock, scheduled, demand: dayDemand });
  }

  return {
    productId: args.productId,
    locationId: args.locationId,
    starting: args.startingStock,
    min: args.min,
    target: args.target,
    days,
    firstShortfallDate,
    triggers: firstShortfallDate !== null,
  };
}

/** Compute a single replenishment proposal for one product/location.
 *  Returns null if the product doesn't need attention. */
export function buildProposal(args: {
  product: Product;
  locationId: string;
  projection: StockProjection;
  mouldFloor: number;
  reason?: ReplenishmentReason;
}): Omit<ReplenishmentProposal, "id" | "createdAt" | "updatedAt"> | null {
  if (!args.projection.triggers || !args.projection.firstShortfallDate) return null;
  // Top-up to target, not just to min.
  const shortfallDay = args.projection.days.find((d) => d.date === args.projection.firstShortfallDate);
  const projectedAtShortfall = shortfallDay?.projected ?? 0;
  const topUp = Math.max(args.projection.target - projectedAtShortfall, args.mouldFloor);
  const suggestedBatchSize = roundToMouldFloor(topUp, args.mouldFloor);
  return {
    productId: args.product.id ?? "",
    suggestedBatchSize,
    earliestNeededDate: args.projection.firstShortfallDate,
    priorityTier: (args.product.priorityTier ?? 2) as 1 | 2 | 3,
    reason: args.reason ?? "auto-replen",
    status: "pending",
    locationId: args.locationId,
  };
}

/** Pull the per-location min/target for a product. Falls back to
 *  product.lowStockThreshold when no per-location row exists. */
export function getLocationMinimum(
  minimums: StockLocationMinimum[],
  productId: string,
  locationId: string,
  fallbackMin: number,
): { min: number; target: number } {
  const row = minimums.find(
    (m) => m.productId === productId && (m.location as unknown as string) === locationId,
  );
  if (!row) return { min: fallbackMin, target: fallbackMin };
  return { min: row.minimumUnits, target: row.maximumUnits ?? row.minimumUnits };
}

/** Top-level run: produces zero-or-more proposals across all products
 *  and locations. Caller persists the result via saveReplenishmentProposal. */
export function runReplenishmentEngine(args: {
  products: Product[];
  startDate?: string;
  horizonDays?: number;
  /** Per-product per-location starting stock. Map keyed by `${productId}|${locationId}`. */
  stockByKey: Map<string, number>;
  scheduledBatches: ScheduledBatch[];
  pendingDemand: PendingDemand[];
  estimates: DailySellEstimate[];
  minimums: StockLocationMinimum[];
  /** Locations to evaluate. Engine produces one projection per (product, location). */
  locations: string[];
  /** Pieces per mould per product. Map keyed by productId. Defaults to 40 when absent. */
  mouldFloorByProduct: Map<string, number>;
}): Array<Omit<ReplenishmentProposal, "id" | "createdAt" | "updatedAt">> {
  const startDate = args.startDate ?? todayISO();
  const horizon = args.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const out: Array<Omit<ReplenishmentProposal, "id" | "createdAt" | "updatedAt">> = [];

  for (const product of args.products) {
    if (!product.id || product.archived) continue;
    const mouldFloor = args.mouldFloorByProduct.get(product.id) ?? 40;
    for (const locationId of args.locations) {
      const startingStock = args.stockByKey.get(`${product.id}|${locationId}`) ?? 0;
      const { min, target } = getLocationMinimum(
        args.minimums,
        product.id,
        locationId,
        product.lowStockThreshold ?? 0,
      );
      if (min <= 0) continue; // no policy → skip
      const dailyDemand = resolveDailyDemand(args.estimates, product.id, locationId);
      const projection = projectStock({
        productId: product.id,
        locationId,
        startingStock,
        min,
        target,
        startDate,
        horizonDays: horizon,
        dailyDemand,
        scheduledBatches: args.scheduledBatches,
        pendingDemand: args.pendingDemand,
      });
      const proposal = buildProposal({
        product,
        locationId,
        projection,
        mouldFloor,
      });
      if (proposal) out.push(proposal);
    }
  }

  return out;
}
