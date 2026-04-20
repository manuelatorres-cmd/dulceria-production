/**
 * Order + quote rollups — labour hours, calculated price, and a
 * traffic-light feasibility signal.
 *
 * Pure functions: callers pass every input explicitly (product
 * unit costs, packaging unit costs, production step minutes per
 * product, packaging packing times, current stock per product,
 * capacity per day, days to deadline). The same helpers back the
 * order detail page, the /quotes/new calculator, and the What-If
 * quote flow — they all speak the same language about "how much
 * labour does this workload cost" and "can we hit the deadline".
 *
 * No React, no Supabase — easy to unit test.
 */

export interface OrderProductLine {
  productId: string;
  quantity: number;
  /** Pre-computed active production minutes per one piece of this
   *  product. Caller sums across every step in the product's category
   *  and divides by the default batch output. */
  activeMinutesPerUnit: number;
  /** Current ingredient + decoration cost for one piece (from the
   *  latest productCostSnapshot). */
  unitCost: number;
}

export interface OrderPackagingRollupLine {
  packagingId: string;
  quantity: number;
  /** Minutes of hands-on packing time per unit. */
  packingMinutesPerUnit: number;
  /** Cost per unit (latest PackagingOrder price). */
  unitCost: number;
}

export interface LabourHoursResult {
  productMinutes: number;
  packagingMinutes: number;
  totalMinutes: number;
  totalHours: number;
}

/** Sum every product and packaging line's minutes. A line with
 *  undefined / zero minutesPerUnit contributes nothing and shows up
 *  in the "data incomplete" list the caller can render. */
export function computeOrderLabourHours(
  products: OrderProductLine[],
  packaging: OrderPackagingRollupLine[],
): LabourHoursResult {
  const productMinutes = products.reduce(
    (acc, p) => acc + Math.max(0, (p.activeMinutesPerUnit || 0) * Math.max(0, p.quantity)),
    0,
  );
  const packagingMinutes = packaging.reduce(
    (acc, p) => acc + Math.max(0, (p.packingMinutesPerUnit || 0) * Math.max(0, p.quantity)),
    0,
  );
  const totalMinutes = productMinutes + packagingMinutes;
  return {
    productMinutes: round2(productMinutes),
    packagingMinutes: round2(packagingMinutes),
    totalMinutes: round2(totalMinutes),
    totalHours: round2(totalMinutes / 60),
  };
}

export interface OrderPriceResult {
  productsCost: number;
  packagingCost: number;
  labourCost: number;
  totalCost: number;
}

export function computeOrderCalculatedCost(
  products: OrderProductLine[],
  packaging: OrderPackagingRollupLine[],
  labour: LabourHoursResult,
  labourHourlyRate: number,
): OrderPriceResult {
  const productsCost = products.reduce(
    (acc, p) => acc + Math.max(0, p.unitCost || 0) * Math.max(0, p.quantity),
    0,
  );
  const packagingCost = packaging.reduce(
    (acc, p) => acc + Math.max(0, p.unitCost || 0) * Math.max(0, p.quantity),
    0,
  );
  const labourCost = Math.max(0, labour.totalHours) * Math.max(0, labourHourlyRate);
  return {
    productsCost: round2(productsCost),
    packagingCost: round2(packagingCost),
    labourCost: round2(labourCost),
    totalCost: round2(productsCost + packagingCost + labourCost),
  };
}

// ─── Feasibility traffic light ──────────────────────────────────

export type FeasibilitySeverity = "green" | "yellow" | "red";

export interface ProductStockState {
  productId: string;
  /** On-hand pieces in Production Storage (ready to fulfil from). */
  availablePieces: number;
  /** Realistic additional pieces producible before the order deadline,
   *  given current capacity. Caller computes. */
  producibleBeforeDeadlinePieces: number;
}

export interface OrderFeasibilityInput {
  productLines: OrderProductLine[];
  stock: ProductStockState[];
  /** Labour hours the full order needs — sum of every product's
   *  active time plus packing. */
  totalLabourHours: number;
  /** Daily production capacity in hours (peopleCount × hoursPerPerson
   *  × buffer %). */
  dailyCapacityHours: number;
  /** Working days between today and the deadline (blocked days
   *  excluded). */
  workingDaysToDeadline: number;
  /** Hours already committed to other orders across those working
   *  days — from productionSchedule. */
  committedHoursToDeadline: number;
}

export interface ProductShortfall {
  productId: string;
  required: number;
  available: number;
  producible: number;
  /** Pieces the order will be short by — a positive number means we
   *  can't satisfy the demand even with fresh production. */
  shortPieces: number;
}

export interface OrderFeasibilityResult {
  severity: FeasibilitySeverity;
  shortfalls: ProductShortfall[];
  availableHours: number;
  freeHours: number;
  shortHours: number;
  summary: string;
}

/** Pure feasibility signal. Three buckets:
 *  - green: every product has enough on-hand stock OR fits in the
 *           producible window AND labour hours fit in the capacity
 *           budget with room to spare (≤ 80 %).
 *  - yellow: fits in capacity but with < 20 % slack, or one or more
 *           products need a "cut it fine" production run right up
 *           to the deadline.
 *  - red: any product has a pieces shortfall OR labour exceeds
 *           available capacity.
 */
export function checkOrderFeasibility(input: OrderFeasibilityInput): OrderFeasibilityResult {
  const stockByProduct = new Map(input.stock.map((s) => [s.productId, s] as const));

  const shortfalls: ProductShortfall[] = [];
  for (const line of input.productLines) {
    const s = stockByProduct.get(line.productId) ?? {
      productId: line.productId,
      availablePieces: 0,
      producibleBeforeDeadlinePieces: 0,
    };
    const required = Math.max(0, line.quantity);
    const coverage = s.availablePieces + s.producibleBeforeDeadlinePieces;
    const shortPieces = Math.max(0, required - coverage);
    if (shortPieces > 0) {
      shortfalls.push({
        productId: line.productId,
        required,
        available: s.availablePieces,
        producible: s.producibleBeforeDeadlinePieces,
        shortPieces,
      });
    }
  }

  const availableHours = round2(input.dailyCapacityHours * Math.max(0, input.workingDaysToDeadline));
  const freeHours = round2(Math.max(0, availableHours - Math.max(0, input.committedHoursToDeadline)));
  const shortHours = round2(Math.max(0, Math.max(0, input.totalLabourHours) - freeHours));

  let severity: FeasibilitySeverity = "green";
  if (shortfalls.length > 0 || shortHours > 0) {
    severity = "red";
  } else if (availableHours > 0 && Math.max(0, input.totalLabourHours) > availableHours * 0.8) {
    severity = "yellow";
  }

  const summary = buildSummary(severity, shortfalls, shortHours, freeHours, input.totalLabourHours);

  return { severity, shortfalls, availableHours, freeHours, shortHours, summary };
}

function buildSummary(
  severity: FeasibilitySeverity,
  shortfalls: ProductShortfall[],
  shortHours: number,
  freeHours: number,
  totalLabourHours: number,
): string {
  if (severity === "red") {
    if (shortfalls.length > 0 && shortHours > 0) {
      return `${shortfalls.length} product${shortfalls.length === 1 ? "" : "s"} short + ${shortHours}h over capacity`;
    }
    if (shortfalls.length > 0) {
      return `${shortfalls.length} product${shortfalls.length === 1 ? "" : "s"} can't be produced in time`;
    }
    return `${shortHours}h over available capacity`;
  }
  if (severity === "yellow") {
    return `Tight — needs ${totalLabourHours}h of ${Math.max(0, freeHours + shortHours)}h available`;
  }
  return `Fits with ${round2(freeHours - totalLabourHours)}h to spare`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
