/**
 * Customer analytics — pure maths for the CRM dashboard widgets.
 *
 * Derives lifetime value, average order value, order frequency, last
 * order date, and a simple seasonal-pattern suggestion from an order
 * history. The callers pass orders + order items + product unit prices
 * (or explicit line values); we don't reach into the DB.
 *
 * Order value is computed as Σ(quantity × unitPrice) for every order
 * item. unitPrice falls back to `productRetailPrice` when the item
 * itself has no price — matches how shop orders are priced.
 */

import type { Order, OrderItem } from "@/types";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CustomerAnalyticsInput {
  customerId: string;
  orders: Order[];
  orderItems: OrderItem[];
  /** productId → default unit price for fallback when orderItem.unitPrice
   *  isn't set. Pass an empty map to skip the fallback. */
  productRetailPrice?: Map<string, number>;
  /** "now" injection for deterministic tests. Defaults to new Date(). */
  now?: Date;
}

export interface CustomerAnalytics {
  orderCount: number;
  /** Cumulative value of every non-cancelled order. */
  lifetimeValue: number;
  averageOrderValue: number;
  /** Milliseconds between consecutive orders (median). null when 0 or 1 orders. */
  medianDaysBetweenOrders: number | null;
  lastOrderAt: Date | null;
  daysSinceLastOrder: number | null;
  /** True when lifetimeValue > 0 AND average margin flagged as thin — the
   *  profitability-flag signal from handover §9. Margin data is optional;
   *  absent ⇒ unflagged. */
  lowProfitability: boolean;
  /** One-off seasonal suggestion: "Customer ordered on this date last
   *  year — consider a follow-up N weeks before." null when no pattern. */
  seasonalSuggestion: SeasonalSuggestion | null;
}

export interface SeasonalSuggestion {
  /** Date of the prior-year order that triggered the suggestion. */
  referenceOrderAt: Date;
  /** Suggested follow-up due date — two weeks before the upcoming
   *  anniversary of the reference order. */
  suggestedFollowupOn: Date;
  note: string;
}

export interface CustomerAnalyticsOptions {
  /** Margin threshold below which the customer is flagged as low
   *  profitability. Expressed as decimal margin % — 0.2 = 20%. Default: null
   *  (no flagging when margin data isn't available). */
  thinMarginThreshold?: number | null;
  /** Map of orderId → margin % (0–100) if the caller wants profitability
   *  flagging. Omitted ⇒ no flag. */
  orderMarginPercent?: Map<string, number>;
}

/** Line value for a single order item, favouring the item's `unitPrice`
 *  when present, otherwise the productRetailPrice fallback. */
function itemValue(item: OrderItem, retail?: Map<string, number>): number {
  const price = item.unitPrice ?? retail?.get(item.productId);
  if (price == null) return 0;
  return price * Math.max(0, item.quantity);
}

/** Median of a numeric array. Returns null for empty input. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeCustomerAnalytics(
  input: CustomerAnalyticsInput,
  options: CustomerAnalyticsOptions = {},
): CustomerAnalytics {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();

  const customerOrders = input.orders
    .filter((o) => o.customerId === input.customerId && o.status !== "cancelled")
    .sort((a, b) => new Date(a.createdAt ?? a.deadline).getTime() - new Date(b.createdAt ?? b.deadline).getTime());

  const itemsByOrder = new Map<string, OrderItem[]>();
  for (const item of input.orderItems) {
    const arr = itemsByOrder.get(item.orderId) ?? [];
    arr.push(item);
    itemsByOrder.set(item.orderId, arr);
  }

  let lifetimeValue = 0;
  const orderValues: number[] = [];
  for (const order of customerOrders) {
    const items = itemsByOrder.get(order.id!) ?? [];
    const value = items.reduce((acc, it) => acc + itemValue(it, input.productRetailPrice), 0);
    lifetimeValue += value;
    orderValues.push(value);
  }

  const lastOrderAt = customerOrders.length > 0
    ? new Date(customerOrders[customerOrders.length - 1].createdAt ?? customerOrders[customerOrders.length - 1].deadline)
    : null;
  const daysSinceLastOrder = lastOrderAt
    ? Math.floor((nowMs - lastOrderAt.getTime()) / DAY_MS)
    : null;

  // Gaps between consecutive orders in days; median smooths out outliers.
  const gaps: number[] = [];
  for (let i = 1; i < customerOrders.length; i++) {
    const prev = new Date(customerOrders[i - 1].createdAt ?? customerOrders[i - 1].deadline).getTime();
    const cur = new Date(customerOrders[i].createdAt ?? customerOrders[i].deadline).getTime();
    gaps.push((cur - prev) / DAY_MS);
  }
  const medianDaysBetweenOrders = median(gaps);

  // Low-profitability flag: average margin across available margin data
  // below threshold. When no margin data → not flagged.
  let lowProfitability = false;
  if (options.orderMarginPercent && options.thinMarginThreshold != null) {
    const margins = customerOrders
      .map((o) => options.orderMarginPercent!.get(o.id!))
      .filter((m): m is number => m != null);
    if (margins.length > 0) {
      const avg = margins.reduce((s, m) => s + m, 0) / margins.length;
      lowProfitability = avg < options.thinMarginThreshold;
    }
  }

  // Seasonal suggestion: an order whose next anniversary falls inside the
  // LOOKAHEAD window triggers a "follow up 2 weeks before the anniversary"
  // reminder. If we're already past the 2-weeks-before mark but the
  // anniversary itself is still upcoming, the suggestion is due today.
  let seasonalSuggestion: SeasonalSuggestion | null = null;
  const LOOKAHEAD_DAYS = 60;
  const TWO_WEEKS_MS = 14 * DAY_MS;
  const upcomingYearEnd = nowMs + LOOKAHEAD_DAYS * DAY_MS;
  for (const order of customerOrders) {
    const orderAt = new Date(order.createdAt ?? order.deadline);
    // Next anniversary strictly after today.
    const anniv = new Date(now.getFullYear(), orderAt.getMonth(), orderAt.getDate(), 12, 0, 0);
    if (anniv.getTime() <= nowMs) anniv.setFullYear(anniv.getFullYear() + 1);
    if (anniv.getTime() > upcomingYearEnd) continue;
    // Target = 2 weeks before the anniversary; clamp to "today" when we're
    // already past that mark (still worth surfacing the reminder).
    const targetMs = Math.max(nowMs, anniv.getTime() - TWO_WEEKS_MS);
    const suggested = new Date(targetMs);
    seasonalSuggestion = {
      referenceOrderAt: orderAt,
      suggestedFollowupOn: suggested,
      note: `Customer ordered on ${orderAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} — follow up ~2 weeks before the anniversary (${suggested.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}).`,
    };
  }

  return {
    orderCount: customerOrders.length,
    lifetimeValue: Math.round(lifetimeValue * 100) / 100,
    averageOrderValue: customerOrders.length > 0
      ? Math.round((lifetimeValue / customerOrders.length) * 100) / 100
      : 0,
    medianDaysBetweenOrders,
    lastOrderAt,
    daysSinceLastOrder,
    lowProfitability,
    seasonalSuggestion,
  };
}
