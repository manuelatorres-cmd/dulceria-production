import { describe, it, expect } from "vitest";
import { computeCustomerAnalytics } from "./customerAnalytics";
import type { Order, OrderItem } from "@/types";

const NOW = new Date("2026-04-20T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function order(id: string, customerId: string | undefined, daysAgo: number, status: Order["status"] = "done"): Order {
  return {
    id,
    channel: "b2b",
    customerId,
    customerName: "Test",
    deadline: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
    priority: "normal",
    status,
    createdAt: new Date(NOW.getTime() - daysAgo * DAY),
    updatedAt: NOW,
  };
}

function item(id: string, orderId: string, productId: string, quantity: number, unitPrice?: number): OrderItem {
  return { id, orderId, productId, quantity, sortOrder: 0, unitPrice };
}

describe("computeCustomerAnalytics", () => {
  const retail = new Map<string, number>([["p1", 2.5], ["p2", 3]]);

  it("returns empty stats for a customer with no orders", () => {
    const result = computeCustomerAnalytics({
      customerId: "c1", orders: [], orderItems: [], productRetailPrice: retail, now: NOW,
    });
    expect(result.orderCount).toBe(0);
    expect(result.lifetimeValue).toBe(0);
    expect(result.averageOrderValue).toBe(0);
    expect(result.lastOrderAt).toBeNull();
    expect(result.daysSinceLastOrder).toBeNull();
    expect(result.medianDaysBetweenOrders).toBeNull();
    expect(result.seasonalSuggestion).toBeNull();
  });

  it("sums lifetime value using unitPrice, with retail fallback", () => {
    const orders = [order("o1", "c1", 30), order("o2", "c1", 5)];
    const items = [
      item("i1", "o1", "p1", 10, 2),     // 20
      item("i2", "o1", "p2", 4, undefined), // retail 3 × 4 = 12
      item("i3", "o2", "p1", 20, 2.25),  // 45
    ];
    const result = computeCustomerAnalytics({
      customerId: "c1", orders, orderItems: items, productRetailPrice: retail, now: NOW,
    });
    expect(result.orderCount).toBe(2);
    expect(result.lifetimeValue).toBe(77);
    expect(result.averageOrderValue).toBe(38.5);
  });

  it("excludes cancelled orders from analytics", () => {
    const orders = [
      order("o1", "c1", 30, "done"),
      order("o2", "c1", 10, "cancelled"),
    ];
    const items = [item("i1", "o1", "p1", 10, 2), item("i2", "o2", "p1", 100, 2)];
    const result = computeCustomerAnalytics({
      customerId: "c1", orders, orderItems: items, productRetailPrice: retail, now: NOW,
    });
    expect(result.orderCount).toBe(1);
    expect(result.lifetimeValue).toBe(20);
  });

  it("computes lastOrderAt and daysSinceLastOrder", () => {
    const orders = [order("o1", "c1", 10)];
    const result = computeCustomerAnalytics({
      customerId: "c1", orders, orderItems: [], now: NOW,
    });
    expect(result.daysSinceLastOrder).toBe(10);
  });

  it("reports median days between orders when 2+ exist", () => {
    const orders = [
      order("o1", "c1", 90),
      order("o2", "c1", 60),
      order("o3", "c1", 30),
    ];
    const result = computeCustomerAnalytics({
      customerId: "c1", orders, orderItems: [], now: NOW,
    });
    // Gaps are 30 and 30; median = 30
    expect(result.medianDaysBetweenOrders).toBe(30);
  });

  it("flags lowProfitability when average margin < threshold", () => {
    const orders = [order("o1", "c1", 30), order("o2", "c1", 10)];
    const margins = new Map([["o1", 10], ["o2", 15]]);
    const result = computeCustomerAnalytics(
      { customerId: "c1", orders, orderItems: [], now: NOW },
      { thinMarginThreshold: 20, orderMarginPercent: margins },
    );
    expect(result.lowProfitability).toBe(true);
  });

  it("suggests a seasonal follow-up when an anniversary is coming up", () => {
    // Order 355 days ago (just over a year back); anniversary in ~10 days.
    const orders = [order("o1", "c1", 355)];
    const result = computeCustomerAnalytics({
      customerId: "c1", orders, orderItems: [], now: NOW,
    });
    expect(result.seasonalSuggestion).not.toBeNull();
    expect(result.seasonalSuggestion!.note).toMatch(/follow up/i);
  });

  it("returns null seasonalSuggestion when the anniversary is too far away", () => {
    // Order 180 days ago — next anniversary is 185 days away, outside the 60-day window.
    const orders = [order("o1", "c1", 180)];
    const result = computeCustomerAnalytics({
      customerId: "c1", orders, orderItems: [], now: NOW,
    });
    expect(result.seasonalSuggestion).toBeNull();
  });

  it("ignores orders for other customers", () => {
    const orders = [order("o1", "c1", 30), order("o2", "c2", 10)];
    const items = [item("i1", "o1", "p1", 10, 2), item("i2", "o2", "p1", 50, 2)];
    const result = computeCustomerAnalytics({
      customerId: "c1", orders, orderItems: items, productRetailPrice: retail, now: NOW,
    });
    expect(result.orderCount).toBe(1);
    expect(result.lifetimeValue).toBe(20);
  });
});
