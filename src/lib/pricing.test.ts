import { describe, it, expect } from "vitest";
import {
  resolveUnitPrice,
  effectiveVatRate,
  computeVatFromNet,
  computeVatFromGross,
  aggregateVatByRate,
  computeOrderMargin,
} from "./pricing";

// ─── resolveUnitPrice ─────────────────────────────────────────────

describe("resolveUnitPrice", () => {
  const base = {
    productId: "p1",
    customerProductPrices: [],
    priceListEntries: [],
  };

  it("picks per-customer product price first", () => {
    const r = resolveUnitPrice({
      ...base,
      customerId: "c1",
      customerProductPrices: [{ productId: "p1", unitPrice: 5.5 }],
      priceListEntries: [{ variantId: "l1", productId: "p1", unitPrice: 7 }],
      customerPriceListId: "l1",
      retailPrice: 10,
    });
    expect(r.unitPrice).toBe(5.5);
    expect(r.source).toBe("customerProductPrice");
  });

  it("falls through to price list when no per-customer override", () => {
    const r = resolveUnitPrice({
      ...base,
      customerId: "c1",
      priceListEntries: [{ variantId: "l1", productId: "p1", unitPrice: 7 }],
      customerPriceListId: "l1",
      retailPrice: 10,
    });
    expect(r.unitPrice).toBe(7);
    expect(r.source).toBe("priceList");
  });

  it("skips price list when entry exists but unitPrice is null", () => {
    const r = resolveUnitPrice({
      ...base,
      customerId: "c1",
      priceListEntries: [{ variantId: "l1", productId: "p1" }],
      customerPriceListId: "l1",
      retailPrice: 10,
      customerDiscountPercent: 20,
    });
    expect(r.unitPrice).toBe(8); // 10 × 0.8
    expect(r.source).toBe("discountedRetail");
  });

  it("applies discount % when no list match", () => {
    const r = resolveUnitPrice({
      ...base,
      customerId: "c1",
      retailPrice: 10,
      customerDiscountPercent: 15,
    });
    expect(r.unitPrice).toBe(8.5);
    expect(r.source).toBe("discountedRetail");
  });

  it("falls back to retail when no customer / list / discount", () => {
    const r = resolveUnitPrice({ ...base, retailPrice: 10 });
    expect(r.unitPrice).toBe(10);
    expect(r.source).toBe("retail");
  });

  it("returns null when nothing is known", () => {
    const r = resolveUnitPrice({ ...base });
    expect(r.unitPrice).toBeNull();
    expect(r.source).toBe("none");
  });

  it("clamps insane discount %", () => {
    const r = resolveUnitPrice({
      ...base,
      customerId: "c1",
      retailPrice: 10,
      customerDiscountPercent: 150,
    });
    expect(r.unitPrice).toBe(0);
  });
});

// ─── effectiveVatRate ─────────────────────────────────────────────

describe("effectiveVatRate", () => {
  it("returns override when provided", () => {
    expect(effectiveVatRate(20, 10)).toBe(20);
  });
  it("falls back to item default", () => {
    expect(effectiveVatRate(undefined, 20)).toBe(20);
  });
  it("falls back to food default (10%)", () => {
    expect(effectiveVatRate()).toBe(10);
  });
  it("treats 0 as an explicit override, not missing", () => {
    expect(effectiveVatRate(0, 10)).toBe(0);
  });
});

// ─── VAT splits ───────────────────────────────────────────────────

describe("computeVatFromNet", () => {
  it("splits simple case", () => {
    const r = computeVatFromNet(100, 10);
    expect(r).toEqual({ net: 100, vat: 10, gross: 110, rate: 10 });
  });
  it("handles 0 %", () => {
    expect(computeVatFromNet(50, 0)).toEqual({ net: 50, vat: 0, gross: 50, rate: 0 });
  });
  it("rounds to 2 decimals", () => {
    // 19.99 × 10 % = 1.999 → 2.00
    expect(computeVatFromNet(19.99, 10)).toEqual({ net: 19.99, vat: 2.00, gross: 21.99, rate: 10 });
  });
});

describe("computeVatFromGross", () => {
  it("backs out net from gross + rate", () => {
    const r = computeVatFromGross(110, 10);
    expect(r).toEqual({ net: 100, vat: 10, gross: 110, rate: 10 });
  });
  it("handles 0 %", () => {
    expect(computeVatFromGross(50, 0)).toEqual({ net: 50, vat: 0, gross: 50, rate: 0 });
  });
});

// ─── aggregateVatByRate ───────────────────────────────────────────

describe("aggregateVatByRate", () => {
  it("sums lines sharing the same rate", () => {
    const r = aggregateVatByRate([
      { net: 100, rate: 10 },
      { net: 50, rate: 10 },
    ]);
    expect(r).toEqual([{ net: 150, vat: 15, gross: 165, rate: 10 }]);
  });
  it("splits by rate and sorts ascending", () => {
    const r = aggregateVatByRate([
      { net: 100, rate: 20 },
      { net: 100, rate: 10 },
      { net: 50, rate: 20 },
    ]);
    expect(r).toHaveLength(2);
    expect(r[0].rate).toBe(10);
    expect(r[1].rate).toBe(20);
    expect(r[0].net).toBe(100);
    expect(r[1].net).toBe(150);
  });
});

// ─── computeOrderMargin ───────────────────────────────────────────

describe("computeOrderMargin", () => {
  it("computes gross margin percent", () => {
    // Profit = 80; margin = 80 / 100 = 80 %.
    expect(computeOrderMargin(100, 20)).toEqual({ profit: 80, marginPercent: 80 });
  });
  it("handles a loss (negative margin)", () => {
    expect(computeOrderMargin(50, 80)).toEqual({ profit: -30, marginPercent: -60 });
  });
  it("returns null margin on zero price", () => {
    expect(computeOrderMargin(0, 20)).toEqual({ profit: -20, marginPercent: null });
  });
});
