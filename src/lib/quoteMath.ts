/**
 * Quote calculator — pure maths for the B2B pricing calculator.
 *
 * Callers supply every cost input explicitly (per-product unit cost,
 * packaging unit cost, labour hours, labour rate). This library never
 * reaches into the DB or performs its own lookups — that keeps it
 * unit-testable and prevents surprise coupling to the app's data
 * layer.
 *
 * Two entry points:
 *   computeQuoteCost      cost breakdown for a set of quote items
 *   computeQuotePricing   wraps computeQuoteCost with sell-price + margin
 *                         arithmetic, including margin→price solving
 */

import type { QuoteItem, QuoteCostBreakdown } from "@/types";

/** Per-product cost inputs collected by the calling component from
 *  existing hooks (ingredient cost map, decoration material cost,
 *  retail price on variants). Kept lean — the calculator doesn't
 *  care where the numbers came from. */
export interface QuoteCostInputs {
  /** productId → cost per piece (ingredients + decoration). */
  productUnitCost: Map<string, number>;
  /** productId → current retail piece price for the "vs retail" discount
   *  comparison. Optional: absent products fall back to the sell price. */
  productRetailPrice?: Map<string, number>;
  /** productId → name for per-line labels. */
  productName: Map<string, string>;
  /** packagingId → cost per unit (latest order price). */
  packagingUnitCost: Map<string, number>;
  /** packagingId → display name for per-line labels. */
  packagingName: Map<string, string>;
  /** Labour hours to include in the quote. */
  labourHours: number;
  /** Labour rate per hour in the same currency as the costs. */
  labourHourlyRate: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Compute the cost breakdown for a list of quote items. */
export function computeQuoteCost(
  items: QuoteItem[],
  inputs: QuoteCostInputs,
): QuoteCostBreakdown {
  const perLine: QuoteCostBreakdown["perLine"] = [];
  let ingredientsCost = 0;
  let decorationCost = 0; // kept separate from ingredients in case callers
                          // want to split — for now both fold into productUnitCost
  let packagingCost = 0;

  for (const item of items) {
    const qty = Math.max(0, Math.round(item.quantity || 0));
    if (qty === 0) continue;

    // A quote line can be one of:
    //   (a) a plain product line (productId + quantity)
    //   (b) a box line (packagingId + contents[])
    //   (c) a packaging-only line (rare — handled as (b) with empty contents)
    const packagingUnitCost = item.packagingId
      ? (inputs.packagingUnitCost.get(item.packagingId) ?? 0)
      : 0;

    if (item.boxContents && item.boxContents.length > 0) {
      // Box line: per-box product cost = sum(pieces × unitCost), then ×
      // number of boxes. Packaging cost adds N × packagingUnitCost.
      const perBoxProductCost = item.boxContents.reduce((acc, c) => {
        const unit = inputs.productUnitCost.get(c.productId) ?? 0;
        return acc + c.pieces * unit;
      }, 0);
      const lineProductCost = perBoxProductCost * qty;
      const linePackagingCost = packagingUnitCost * qty;
      ingredientsCost += lineProductCost;
      packagingCost += linePackagingCost;
      perLine.push({
        productId: undefined,
        label: item.packagingId
          ? (inputs.packagingName.get(item.packagingId) ?? "Packaging") + " box"
          : "Box",
        quantity: qty,
        unitCost: round2(perBoxProductCost + packagingUnitCost),
        lineCost: round2(lineProductCost + linePackagingCost),
      });
    } else if (item.productId) {
      const unit = inputs.productUnitCost.get(item.productId) ?? 0;
      const lineCost = unit * qty;
      ingredientsCost += lineCost;
      if (packagingUnitCost > 0) {
        packagingCost += packagingUnitCost * qty;
      }
      perLine.push({
        productId: item.productId,
        label: inputs.productName.get(item.productId) ?? "Product",
        quantity: qty,
        unitCost: round2(unit + packagingUnitCost),
        lineCost: round2(lineCost + packagingUnitCost * qty),
      });
    }
  }

  const labourCost = Math.max(0, inputs.labourHours) * Math.max(0, inputs.labourHourlyRate);
  const totalCost = ingredientsCost + decorationCost + packagingCost + labourCost;

  return {
    ingredientsCost: round2(ingredientsCost),
    decorationCost: round2(decorationCost),
    packagingCost: round2(packagingCost),
    labourCost: round2(labourCost),
    totalCost: round2(totalCost),
    perLine,
  };
}

export interface QuotePricingOptions {
  /** Desired sell price for the whole quote. Mutually exclusive with
   *  `targetMarginPercent` — pass the one the UI has in hand. */
  sellPrice?: number;
  /** Desired margin % (0–100). If set, the returned `sellPrice` is
   *  solved so that `(sellPrice - totalCost) / sellPrice * 100 === margin`. */
  targetMarginPercent?: number;
}

export interface QuotePricingResult {
  breakdown: QuoteCostBreakdown;
  sellPrice: number;
  marginAbsolute: number;
  marginPercent: number;
  /** When every item has a retail price, the % discount vs retail for the
   *  whole quote: (retailTotal - sellPrice) / retailTotal × 100. Positive
   *  means the quote is below retail (a discount); negative means above
   *  retail (a premium). null when no retail data is available. */
  retailComparePct: number | null;
  /** Sum of retail prices × quantities for every line. null when any line
   *  is missing its retail input. */
  retailTotal: number | null;
}

export function computeQuotePricing(
  items: QuoteItem[],
  inputs: QuoteCostInputs,
  options: QuotePricingOptions,
): QuotePricingResult {
  const breakdown = computeQuoteCost(items, inputs);

  // Retail comparison — only reported when every product line has a
  // retail price in the lookup. Box lines use the contents' retail
  // prices. Lines without productId or retail data disqualify the whole
  // comparison (leaving retailComparePct null) rather than silently
  // under-counting.
  let retailTotal = 0;
  let retailComplete = true;
  for (const item of items) {
    const qty = Math.max(0, Math.round(item.quantity || 0));
    if (qty === 0) continue;
    if (item.boxContents && item.boxContents.length > 0) {
      for (const c of item.boxContents) {
        const r = inputs.productRetailPrice?.get(c.productId);
        if (r == null) { retailComplete = false; break; }
        retailTotal += r * c.pieces * qty;
      }
      if (!retailComplete) break;
    } else if (item.productId) {
      const r = inputs.productRetailPrice?.get(item.productId);
      if (r == null) { retailComplete = false; break; }
      retailTotal += r * qty;
    } else {
      retailComplete = false;
      break;
    }
  }

  // Resolve sell price: target margin wins when both are present (the UI
  // hides the price input in target-margin mode).
  let sellPrice: number;
  if (options.targetMarginPercent != null) {
    const m = Math.max(0, Math.min(99.99, options.targetMarginPercent));
    const denom = 1 - m / 100;
    // If denom is zero (100% margin target) we can't solve — fall back to
    // the cost so the UI can show a ∞-margin warning rather than NaN.
    sellPrice = denom <= 0 ? breakdown.totalCost : round2(breakdown.totalCost / denom);
  } else {
    sellPrice = Math.max(0, round2(options.sellPrice ?? breakdown.totalCost));
  }

  const marginAbsolute = round2(sellPrice - breakdown.totalCost);
  const marginPercent = sellPrice > 0
    ? round2((marginAbsolute / sellPrice) * 100)
    : 0;

  const retailComparePct = retailComplete && retailTotal > 0
    ? round2(((retailTotal - sellPrice) / retailTotal) * 100)
    : null;

  return {
    breakdown,
    sellPrice,
    marginAbsolute,
    marginPercent,
    retailComparePct,
    retailTotal: retailComplete ? round2(retailTotal) : null,
  };
}

// ─── Feasibility ──────────────────────────────────────────────────────────

export interface FeasibilityInput {
  /** Labour hours the quote will add. */
  requiredHours: number;
  /** Daily capacity in hours (peopleCount × hoursPerPersonPerDay × workingDays%). */
  dailyCapacityHours: number;
  /** Working days between "now" and the quote deadline (exclusive of
   *  blocked days / holidays). */
  workingDaysToDeadline: number;
  /** Already-committed hours across those working days (sum of existing
   *  productionSchedule active minutes). */
  committedHoursToDeadline: number;
  /** Capacity buffer % (0–100) from capacityConfig. */
  bufferPercent: number;
}

export interface FeasibilityResult {
  feasible: boolean;
  /** Total capacity hours available to the deadline after applying buffer. */
  availableHours: number;
  /** Committed hours already allocated. */
  committedHours: number;
  /** Hours that would be free for the new order. */
  freeHours: number;
  /** Required - free; positive means short on capacity. */
  shortHours: number;
  /** Extra people needed for one working day to close the gap, or 0 if fine. */
  peopleNeeded: number;
  /** Earliest deadline at which `requiredHours` would fit without overtime. */
  earliestFeasibleDaysFromNow: number | null;
  note: string;
}

export function checkQuoteFeasibility(input: FeasibilityInput): FeasibilityResult {
  const bufferMult = Math.max(0, Math.min(1, 1 - Math.max(0, input.bufferPercent) / 100));
  const availableHoursRaw = input.dailyCapacityHours * input.workingDaysToDeadline;
  const availableHours = round2(availableHoursRaw * bufferMult);
  const committedHours = Math.max(0, round2(input.committedHoursToDeadline));
  const freeHours = round2(Math.max(0, availableHours - committedHours));
  const requiredHours = Math.max(0, input.requiredHours);
  const shortHours = round2(Math.max(0, requiredHours - freeHours));
  const feasible = shortHours === 0;

  // Simple people estimate: extra-hours needed ÷ hoursPerPersonPerDay.
  // Callers pass `dailyCapacityHours` already, but not `hoursPerPerson`,
  // so we approximate a full day = dailyCapacityHours / max(1, days).
  const effectiveDailyCapacity = input.workingDaysToDeadline > 0
    ? input.dailyCapacityHours
    : 0;
  const peopleNeeded = feasible || effectiveDailyCapacity <= 0
    ? 0
    : Math.ceil(shortHours / effectiveDailyCapacity);

  // Earliest feasible deadline: how many extra working days at current
  // capacity would clear the shortfall? Negative / zero → already fine.
  const earliestFeasibleDaysFromNow = feasible
    ? input.workingDaysToDeadline
    : input.dailyCapacityHours > 0
      ? Math.ceil((committedHours + requiredHours) / (input.dailyCapacityHours * bufferMult))
      : null;

  let note: string;
  if (feasible) {
    note = `Fits with ${round2(freeHours - requiredHours)}h to spare at current capacity.`;
  } else {
    const dayWord = peopleNeeded === 1 ? "day" : "days";
    note = `Needs ${shortHours}h more than available — either add ${peopleNeeded} helper${peopleNeeded === 1 ? "" : "s"} for one ${dayWord} or push the deadline to ~${earliestFeasibleDaysFromNow} working days from now.`;
  }

  return {
    feasible,
    availableHours,
    committedHours,
    freeHours,
    shortHours,
    peopleNeeded,
    earliestFeasibleDaysFromNow,
    note,
  };
}
