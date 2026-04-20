import { describe, it, expect } from "vitest";
import { computeQuoteCost, computeQuotePricing, checkQuoteFeasibility } from "./quoteMath";
import type { QuoteCostInputs } from "./quoteMath";

const productName = new Map<string, string>([
  ["p1", "Salted caramel bonbon"],
  ["p2", "Dark ganache bonbon"],
]);
const productUnitCost = new Map<string, number>([
  ["p1", 0.80],
  ["p2", 0.65],
]);
const productRetailPrice = new Map<string, number>([
  ["p1", 2.50],
  ["p2", 2.50],
]);
const packagingName = new Map<string, string>([["bx", "Gift box 9"]]);
const packagingUnitCost = new Map<string, number>([["bx", 1.20]]);

const baseInputs: QuoteCostInputs = {
  productUnitCost,
  productRetailPrice,
  productName,
  packagingUnitCost,
  packagingName,
  labourHours: 0,
  labourHourlyRate: 15,
};

describe("computeQuoteCost", () => {
  it("sums cost for a plain product line without packaging", () => {
    const breakdown = computeQuoteCost(
      [{ productId: "p1", quantity: 100 }],
      baseInputs,
    );
    expect(breakdown.ingredientsCost).toBe(80);
    expect(breakdown.packagingCost).toBe(0);
    expect(breakdown.totalCost).toBe(80);
    expect(breakdown.perLine).toHaveLength(1);
    expect(breakdown.perLine[0].lineCost).toBe(80);
  });

  it("adds packaging cost when a line has a packagingId but no box contents", () => {
    const breakdown = computeQuoteCost(
      [{ productId: "p1", quantity: 50, packagingId: "bx" }],
      baseInputs,
    );
    // 50 × 0.80 = 40 product + 50 × 1.20 = 60 packaging = 100
    expect(breakdown.ingredientsCost).toBe(40);
    expect(breakdown.packagingCost).toBe(60);
    expect(breakdown.totalCost).toBe(100);
  });

  it("handles a box line with mixed contents", () => {
    const breakdown = computeQuoteCost(
      [{
        quantity: 20,
        packagingId: "bx",
        boxContents: [
          { productId: "p1", pieces: 5 },
          { productId: "p2", pieces: 4 },
        ],
      }],
      baseInputs,
    );
    // Per box: 5 × 0.80 + 4 × 0.65 = 4 + 2.60 = 6.60 product + 1.20 packaging = 7.80
    // × 20 boxes = 132 product + 24 packaging = 156
    expect(breakdown.ingredientsCost).toBeCloseTo(132, 2);
    expect(breakdown.packagingCost).toBe(24);
    expect(breakdown.totalCost).toBeCloseTo(156, 2);
  });

  it("includes labour cost when hours > 0", () => {
    const breakdown = computeQuoteCost(
      [{ productId: "p1", quantity: 100 }],
      { ...baseInputs, labourHours: 4 },
    );
    expect(breakdown.labourCost).toBe(60);
    expect(breakdown.totalCost).toBe(140);
  });

  it("ignores zero/negative quantities", () => {
    const breakdown = computeQuoteCost(
      [{ productId: "p1", quantity: 0 }, { productId: "p2", quantity: -5 }],
      baseInputs,
    );
    expect(breakdown.totalCost).toBe(0);
    expect(breakdown.perLine).toHaveLength(0);
  });

  it("falls back to 0 unit cost when a product is missing from the map", () => {
    const breakdown = computeQuoteCost(
      [{ productId: "unknown", quantity: 10 }],
      baseInputs,
    );
    expect(breakdown.totalCost).toBe(0);
  });
});

describe("computeQuotePricing", () => {
  it("derives sellPrice from a target margin", () => {
    const result = computeQuotePricing(
      [{ productId: "p1", quantity: 100 }],
      baseInputs,
      { targetMarginPercent: 40 },
    );
    // cost 80, target 40% margin → sell = 80 / (1 - 0.4) = 133.33
    expect(result.sellPrice).toBeCloseTo(133.33, 2);
    expect(result.marginPercent).toBeCloseTo(40, 1);
  });

  it("computes margin from a given sell price", () => {
    const result = computeQuotePricing(
      [{ productId: "p1", quantity: 100 }],
      baseInputs,
      { sellPrice: 200 },
    );
    expect(result.sellPrice).toBe(200);
    expect(result.marginAbsolute).toBe(120);
    expect(result.marginPercent).toBeCloseTo(60, 1);
  });

  it("reports retailComparePct when every line has a retail price", () => {
    const result = computeQuotePricing(
      [{ productId: "p1", quantity: 100 }],
      baseInputs,
      { sellPrice: 200 },
    );
    // Retail = 100 × 2.50 = 250. Sell 200 → discount 20%.
    expect(result.retailTotal).toBe(250);
    expect(result.retailComparePct).toBeCloseTo(20, 1);
  });

  it("returns null retailComparePct when any product has no retail price", () => {
    const result = computeQuotePricing(
      [{ productId: "p1", quantity: 100 }],
      { ...baseInputs, productRetailPrice: new Map() },
      { sellPrice: 200 },
    );
    expect(result.retailComparePct).toBeNull();
  });

  it("safely handles a 100% margin target (no division by zero)", () => {
    const result = computeQuotePricing(
      [{ productId: "p1", quantity: 100 }],
      baseInputs,
      { targetMarginPercent: 100 },
    );
    // Capped to 99.99 → very high but finite sell price
    expect(Number.isFinite(result.sellPrice)).toBe(true);
    expect(result.sellPrice).toBeGreaterThan(baseInputs.productUnitCost.get("p1")! * 100);
  });
});

describe("checkQuoteFeasibility", () => {
  it("returns feasible=true when required hours fit in free hours", () => {
    const result = checkQuoteFeasibility({
      requiredHours: 10,
      dailyCapacityHours: 8,
      workingDaysToDeadline: 5,
      committedHoursToDeadline: 10,
      bufferPercent: 15,
    });
    // Available = 8 × 5 × (1-0.15) = 34h. Free = 34 - 10 = 24. Required 10 fits.
    expect(result.feasible).toBe(true);
    expect(result.freeHours).toBeCloseTo(24, 1);
    expect(result.shortHours).toBe(0);
    expect(result.peopleNeeded).toBe(0);
  });

  it("returns feasible=false and suggests helpers when short", () => {
    const result = checkQuoteFeasibility({
      requiredHours: 40,
      dailyCapacityHours: 8,
      workingDaysToDeadline: 3,
      committedHoursToDeadline: 0,
      bufferPercent: 15,
    });
    // Available = 24 × 0.85 = 20.4. Required 40 → short 19.6.
    expect(result.feasible).toBe(false);
    expect(result.shortHours).toBeGreaterThan(0);
    expect(result.peopleNeeded).toBeGreaterThanOrEqual(1);
    expect(result.note).toMatch(/helper|deadline/i);
  });

  it("handles zero capacity defensively", () => {
    const result = checkQuoteFeasibility({
      requiredHours: 10,
      dailyCapacityHours: 0,
      workingDaysToDeadline: 5,
      committedHoursToDeadline: 0,
      bufferPercent: 15,
    });
    expect(result.feasible).toBe(false);
    expect(result.peopleNeeded).toBe(0); // can't estimate with zero baseline
  });
});
