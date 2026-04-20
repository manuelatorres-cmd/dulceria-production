/**
 * Order-pricing helpers — resolve unit price, split VAT, compute
 * gross margin.
 *
 * Pure: no React, no Supabase. The order page injects every input
 * (customer, products, collection, per-customer overrides, app
 * defaults) so these functions stay unit-testable.
 *
 * Vocabulary
 * ----------
 * "Net" means "excluding VAT". Every unit price and line total on
 * orders is stored net — the gross value is derived. VAT rates are
 * expressed as percents (10 = 10 %).
 *
 * Pricing hierarchy (highest priority first):
 *   1. customerProductPrices — per-customer + per-product override
 *   2. collection (as price list) — customer.defaultPriceListId +
 *      collectionProducts.unitPrice
 *   3. customer.defaultDiscountPercent applied against the retail
 *      price (see step 4)
 *   4. product retail price from the latest collection that lists it
 *      (existing behaviour in the quote flow)
 *   5. null — caller renders "— price missing" and blocks save
 */

import { DEFAULT_FOOD_VAT_RATE } from "@/types";

// ─── Pricing hierarchy ─────────────────────────────────────────────

export interface ResolveUnitPriceInput {
  productId: string;
  /** When null, only default-list + retail fall back. */
  customerId?: string;
  /** All rows in customerProductPrices for the current customer. */
  customerProductPrices: Array<{ productId: string; unitPrice: number }>;
  /** The customer's defaultPriceListId (a collection id) — null if none. */
  customerPriceListId?: string;
  /** Every collectionProducts row that could be relevant — the caller
   *  supplies the already-loaded table; the helper filters by
   *  collectionId + productId. */
  priceListEntries: Array<{ collectionId: string; productId: string; unitPrice?: number }>;
  /** The customer's blanket discount (percent 0..100), or null. */
  customerDiscountPercent?: number;
  /** The product's catalogue retail price (from the latest collection
   *  snapshot that lists it, or wherever the UI gets it). */
  retailPrice?: number;
}

export type PriceSource =
  | "customerProductPrice"
  | "priceList"
  | "discountedRetail"
  | "retail"
  | "none";

export interface ResolvedUnitPrice {
  unitPrice: number | null;
  source: PriceSource;
}

export function resolveUnitPrice(input: ResolveUnitPriceInput): ResolvedUnitPrice {
  // 1. Per-customer product price.
  if (input.customerId) {
    const hit = input.customerProductPrices.find((p) => p.productId === input.productId);
    if (hit) return { unitPrice: hit.unitPrice, source: "customerProductPrice" };
  }

  // 2. Customer's default price list (a Collection).
  if (input.customerPriceListId) {
    const hit = input.priceListEntries.find(
      (e) => e.collectionId === input.customerPriceListId && e.productId === input.productId,
    );
    if (hit && hit.unitPrice != null) return { unitPrice: hit.unitPrice, source: "priceList" };
  }

  // 3. Discount % applied to retail.
  if (
    input.retailPrice != null
    && input.customerDiscountPercent != null
    && input.customerDiscountPercent > 0
  ) {
    const disc = Math.max(0, Math.min(100, input.customerDiscountPercent));
    const price = input.retailPrice * (1 - disc / 100);
    return { unitPrice: round2(price), source: "discountedRetail" };
  }

  // 4. Retail.
  if (input.retailPrice != null) {
    return { unitPrice: input.retailPrice, source: "retail" };
  }

  // 5. No data.
  return { unitPrice: null, source: "none" };
}

// ─── VAT split ─────────────────────────────────────────────────────

export interface VatBreakdown {
  net: number;
  vat: number;
  gross: number;
  rate: number;
}

/** Resolve the effective VAT rate for a single line. Line override
 *  beats item default, which beats the app default. */
export function effectiveVatRate(
  lineOverride?: number,
  itemDefault?: number,
): number {
  if (lineOverride != null && Number.isFinite(lineOverride)) return Math.max(0, lineOverride);
  if (itemDefault != null && Number.isFinite(itemDefault)) return Math.max(0, itemDefault);
  return DEFAULT_FOOD_VAT_RATE;
}

/** Given a net line total + rate, produce { net, vat, gross }. */
export function computeVatFromNet(net: number, ratePercent: number): VatBreakdown {
  const safeNet = Math.max(0, net);
  const safeRate = Math.max(0, ratePercent);
  const vat = round2(safeNet * safeRate / 100);
  return { net: round2(safeNet), vat, gross: round2(safeNet + vat), rate: safeRate };
}

/** Given a gross line total + rate, back out net. Used by the price-paid
 *  toggle when the user enters the gross amount. */
export function computeVatFromGross(gross: number, ratePercent: number): VatBreakdown {
  const safeGross = Math.max(0, gross);
  const safeRate = Math.max(0, ratePercent);
  const net = round2(safeGross / (1 + safeRate / 100));
  const vat = round2(safeGross - net);
  return { net, vat, gross: round2(safeGross), rate: safeRate };
}

/** Aggregate VAT for a set of lines, each with its own rate. Returns
 *  one VatBreakdown per rate (so the UI can render "VAT 10 %: €X,
 *  VAT 20 %: €Y" when the order mixes rates). */
export function aggregateVatByRate(
  lines: Array<{ net: number; rate: number }>,
): VatBreakdown[] {
  const byRate = new Map<number, number>();
  for (const l of lines) {
    const safeNet = Math.max(0, l.net);
    const safeRate = Math.max(0, l.rate);
    byRate.set(safeRate, (byRate.get(safeRate) ?? 0) + safeNet);
  }
  const out: VatBreakdown[] = [];
  for (const [rate, net] of byRate) out.push(computeVatFromNet(net, rate));
  return out.sort((a, b) => a.rate - b.rate);
}

// ─── Gross margin ─────────────────────────────────────────────────

export interface MarginResult {
  /** Net price paid − total cost (including labour). */
  profit: number;
  /** profit / pricePaidNet, percent. */
  marginPercent: number | null;
}

/** Gross margin in the spec's sense: (priceNet − totalCost) / priceNet.
 *  `totalCost` includes ingredients, packaging, and labour. When
 *  priceNet ≤ 0 the margin is null so the UI can show "—". */
export function computeOrderMargin(priceNet: number, totalCost: number): MarginResult {
  const profit = round2(priceNet - totalCost);
  if (priceNet <= 0) return { profit, marginPercent: null };
  return { profit, marginPercent: round2((profit / priceNet) * 100) };
}

// ─── Helpers ──────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
