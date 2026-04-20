import { describe, it, expect } from "vitest";
import {
  computeOrderLabourHours,
  computeOrderCalculatedCost,
  checkOrderFeasibility,
} from "./orderRollup";

describe("computeOrderLabourHours", () => {
  it("sums product + packaging minutes", () => {
    const result = computeOrderLabourHours(
      [
        { productId: "p1", quantity: 20, activeMinutesPerUnit: 3, unitCost: 0 },
        { productId: "p2", quantity: 10, activeMinutesPerUnit: 5, unitCost: 0 },
      ],
      [
        { packagingId: "bx", quantity: 10, packingMinutesPerUnit: 2, unitCost: 0 },
      ],
    );
    expect(result.productMinutes).toBe(20 * 3 + 10 * 5);
    expect(result.packagingMinutes).toBe(10 * 2);
    expect(result.totalMinutes).toBe(130);
    expect(result.totalHours).toBeCloseTo(2.17, 2);
  });

  it("ignores missing per-unit minutes", () => {
    const result = computeOrderLabourHours(
      [{ productId: "p1", quantity: 50, activeMinutesPerUnit: 0, unitCost: 0 }],
      [],
    );
    expect(result.totalMinutes).toBe(0);
  });
});

describe("computeOrderCalculatedCost", () => {
  it("sums product + packaging + labour cost", () => {
    const labour = { productMinutes: 0, packagingMinutes: 0, totalMinutes: 60, totalHours: 1 };
    const result = computeOrderCalculatedCost(
      [{ productId: "p1", quantity: 10, activeMinutesPerUnit: 0, unitCost: 1.2 }],
      [{ packagingId: "bx", quantity: 10, packingMinutesPerUnit: 0, unitCost: 0.8 }],
      labour,
      15,
    );
    expect(result.productsCost).toBe(12);
    expect(result.packagingCost).toBe(8);
    expect(result.labourCost).toBe(15);
    expect(result.totalCost).toBe(35);
  });
});

describe("checkOrderFeasibility", () => {
  const productLines = [
    { productId: "p1", quantity: 30, activeMinutesPerUnit: 3, unitCost: 1 },
  ];

  it("green when stock covers + labour has slack", () => {
    const r = checkOrderFeasibility({
      productLines,
      stock: [{ productId: "p1", availablePieces: 30, producibleBeforeDeadlinePieces: 0 }],
      totalLabourHours: 1,
      dailyCapacityHours: 8,
      workingDaysToDeadline: 5,
      committedHoursToDeadline: 0,
    });
    expect(r.severity).toBe("green");
    expect(r.shortfalls).toHaveLength(0);
    expect(r.summary).toMatch(/fits/i);
  });

  it("red when any product is short", () => {
    const r = checkOrderFeasibility({
      productLines,
      stock: [{ productId: "p1", availablePieces: 10, producibleBeforeDeadlinePieces: 5 }],
      totalLabourHours: 1,
      dailyCapacityHours: 8,
      workingDaysToDeadline: 5,
      committedHoursToDeadline: 0,
    });
    expect(r.severity).toBe("red");
    expect(r.shortfalls[0].shortPieces).toBe(15);
  });

  it("red when labour overshoots capacity", () => {
    const r = checkOrderFeasibility({
      productLines,
      stock: [{ productId: "p1", availablePieces: 0, producibleBeforeDeadlinePieces: 30 }],
      totalLabourHours: 20,
      dailyCapacityHours: 2,
      workingDaysToDeadline: 2,
      committedHoursToDeadline: 0,
    });
    expect(r.severity).toBe("red");
    expect(r.shortHours).toBeGreaterThan(0);
  });

  it("yellow when labour fits but > 80 % utilisation", () => {
    const r = checkOrderFeasibility({
      productLines,
      stock: [{ productId: "p1", availablePieces: 30, producibleBeforeDeadlinePieces: 0 }],
      totalLabourHours: 9,
      dailyCapacityHours: 5,
      workingDaysToDeadline: 2,
      committedHoursToDeadline: 0,
    });
    expect(r.severity).toBe("yellow");
  });

  it("treats missing stock row as zero coverage", () => {
    const r = checkOrderFeasibility({
      productLines,
      stock: [],
      totalLabourHours: 0,
      dailyCapacityHours: 8,
      workingDaysToDeadline: 5,
      committedHoursToDeadline: 0,
    });
    expect(r.severity).toBe("red");
    expect(r.shortfalls[0].shortPieces).toBe(30);
  });
});
