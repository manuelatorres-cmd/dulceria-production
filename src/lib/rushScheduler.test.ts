import { describe, it, expect } from "vitest";
import {
  buildRushSlices,
  nextWorkday,
  placeRushSlices,
  planRush,
  suggestSliceSize,
  workableDays,
} from "./rushScheduler";
import type { Product } from "@/types";

const baseProduct: Product = {
  id: "p1",
  name: "Hazelnut bar",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("suggestSliceSize", () => {
  it("clamps to maxPerDay then rounds down to mould floor", () => {
    expect(suggestSliceSize({ totalQuantity: 1200, mouldFloor: 30, maxPerDay: 150 })).toBe(150);
    expect(suggestSliceSize({ totalQuantity: 200, mouldFloor: 40, maxPerDay: 150 })).toBe(120);
  });
  it("returns at least one mould of work", () => {
    expect(suggestSliceSize({ totalQuantity: 10, mouldFloor: 40, maxPerDay: 150 })).toBe(40);
  });
});

describe("buildRushSlices", () => {
  it("splits a big rush into per-day slices that sum to the total", () => {
    const slices = buildRushSlices({
      productId: "p1",
      quantity: 1200,
      mouldFloor: 30,
      maxPerDay: 150,
      minutesPerPiece: 1,
    });
    expect(slices).toHaveLength(8);
    expect(slices.reduce((s, x) => s + x.quantity, 0)).toBe(1200);
  });

  it("returns no slices for zero quantity", () => {
    expect(buildRushSlices({ productId: "p1", quantity: 0, mouldFloor: 40, maxPerDay: 100, minutesPerPiece: 1 })).toEqual([]);
  });
});

describe("workableDays", () => {
  it("skips weekends + closed dates", () => {
    const days = workableDays({
      fromISO: "2026-04-20", // Mon
      deadlineISO: "2026-04-26", // Sun
      closedDates: new Set(["2026-04-22"]),
    });
    expect(days).toEqual(["2026-04-20", "2026-04-21", "2026-04-23", "2026-04-24"]);
  });
});

describe("nextWorkday", () => {
  it("advances past weekend", () => {
    expect(nextWorkday("2026-04-25")).toBe("2026-04-27"); // Sat → Mon
  });
  it("respects closures", () => {
    expect(nextWorkday("2026-04-22", new Set(["2026-04-22"]))).toBe("2026-04-23");
  });
});

describe("placeRushSlices", () => {
  it("places slices on consecutive workdays when capacity is free", () => {
    const result = placeRushSlices({
      slices: [
        { productId: "p1", quantity: 150, minutes: 60 },
        { productId: "p1", quantity: 150, minutes: 60 },
      ],
      deadlineISO: "2026-04-30",
      startISO: "2026-04-21",
      capacity: [
        { date: "2026-04-21", availableMinutes: 120, usedMinutes: 0 },
        { date: "2026-04-22", availableMinutes: 120, usedMinutes: 0 },
      ],
      existingBlocks: [],
    });
    expect(result.placements).toHaveLength(2);
    expect(result.unfit).toHaveLength(0);
    expect(result.displacements).toHaveLength(0);
  });

  it("displaces tier-3 replen blocks to make room", () => {
    const result = placeRushSlices({
      slices: [{ productId: "p1", quantity: 150, minutes: 60 }],
      deadlineISO: "2026-04-30",
      startISO: "2026-04-21",
      capacity: [
        { date: "2026-04-21", availableMinutes: 60, usedMinutes: 30 },
        { date: "2026-04-22", availableMinutes: 60, usedMinutes: 0 },
      ],
      existingBlocks: [
        { id: "b-tier3", productId: "px", date: "2026-04-21", minutes: 30, kind: "tier-3-replen" },
      ],
    });
    expect(result.placements).toHaveLength(1);
    expect(result.placements[0].date).toBe("2026-04-21");
    expect(result.displacements).toHaveLength(1);
    expect(result.displacements[0].block.id).toBe("b-tier3");
    expect(result.displacements[0].to).toBe("2026-04-22");
  });

  it("never displaces campaign or rush blocks", () => {
    const result = placeRushSlices({
      slices: [{ productId: "p1", quantity: 150, minutes: 60 }],
      deadlineISO: "2026-04-30",
      startISO: "2026-04-21",
      capacity: [{ date: "2026-04-21", availableMinutes: 60, usedMinutes: 60 }],
      existingBlocks: [
        { id: "b-camp", productId: "px", date: "2026-04-21", minutes: 60, kind: "campaign" },
      ],
    });
    // No room left, no displaceable blocks → unfit.
    expect(result.placements).toHaveLength(0);
    expect(result.unfit).toHaveLength(1);
    expect(result.displacements).toHaveLength(0);
  });

  it("returns slices that cannot fit by deadline as unfit", () => {
    const result = placeRushSlices({
      slices: [
        { productId: "p1", quantity: 150, minutes: 60 },
        { productId: "p1", quantity: 150, minutes: 60 },
      ],
      deadlineISO: "2026-04-21",
      startISO: "2026-04-21",
      capacity: [{ date: "2026-04-21", availableMinutes: 60, usedMinutes: 0 }],
      existingBlocks: [],
    });
    expect(result.placements).toHaveLength(1);
    expect(result.unfit).toHaveLength(1);
  });
});

describe("planRush", () => {
  it("end-to-end places a 600-piece rush across multiple days", () => {
    const capacity = ["2026-04-21", "2026-04-22", "2026-04-23"].map((date) => ({
      date,
      availableMinutes: 200,
      usedMinutes: 0,
    }));
    const result = planRush({
      product: baseProduct,
      totalQuantity: 600,
      deadlineISO: "2026-04-23",
      startISO: "2026-04-21",
      capacity,
      existingBlocks: [],
      mouldFloor: 30,
      maxPerDay: 200,
      minutesPerPiece: 0.5,
    });
    expect(result.placements.reduce((s, p) => s + p.slice.quantity, 0)).toBe(600);
    expect(result.unfit).toHaveLength(0);
  });
});
