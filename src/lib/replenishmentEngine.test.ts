import { describe, it, expect } from "vitest";
import {
  addDays,
  buildProposal,
  getLocationMinimum,
  projectStock,
  resolveDailyDemand,
  roundToMouldFloor,
  runReplenishmentEngine,
  todayISO,
} from "./replenishmentEngine";
import type { Product, DailySellEstimate, StockLocationMinimum } from "@/types";

const baseProduct = (overrides: Partial<Product> = {}): Product => ({
  id: "p1",
  name: "Pistachio bonbon",
  createdAt: new Date(),
  updatedAt: new Date(),
  priorityTier: 1,
  ...overrides,
});

describe("addDays", () => {
  it("advances ISO dates correctly across month boundaries", () => {
    expect(addDays("2026-04-29", 5)).toBe("2026-05-04");
  });
  it("handles negative offsets", () => {
    expect(addDays("2026-05-01", -3)).toBe("2026-04-28");
  });
});

describe("todayISO", () => {
  it("formats supplied date as YYYY-MM-DD", () => {
    const fixed = new Date(Date.UTC(2026, 3, 21, 12, 0, 0));
    expect(todayISO(fixed)).toBe("2026-04-21");
  });
});

describe("roundToMouldFloor", () => {
  it("rounds up to nearest multiple of mould floor", () => {
    expect(roundToMouldFloor(25, 40)).toBe(40);
    expect(roundToMouldFloor(41, 40)).toBe(80);
    expect(roundToMouldFloor(80, 40)).toBe(80);
  });
  it("returns 0 when needed is non-positive", () => {
    expect(roundToMouldFloor(0, 40)).toBe(0);
    expect(roundToMouldFloor(-3, 40)).toBe(0);
  });
  it("falls back to ceil when mouldFloor is 0", () => {
    expect(roundToMouldFloor(7.4, 0)).toBe(8);
  });
});

describe("resolveDailyDemand", () => {
  const estimates: DailySellEstimate[] = [
    {
      productId: "p1",
      locationId: "shop",
      date: "2026-04-20",
      soldCount: 8,
      customBoxPickCount: 2,
      rollingAvg30d: 7.5,
    },
    {
      productId: "p1",
      locationId: "shop",
      date: "2026-04-15",
      soldCount: 6,
      customBoxPickCount: 1,
      rollingAvg30d: 6.0,
    },
  ];

  it("uses the most recent estimate for the product/location pair", () => {
    expect(resolveDailyDemand(estimates, "p1", "shop")).toBeCloseTo(7.5 + 2);
  });
  it("returns 0 when no signal present", () => {
    expect(resolveDailyDemand(estimates, "p1", "production")).toBe(0);
    expect(resolveDailyDemand(estimates, "missing", "shop")).toBe(0);
  });
  it("clamps negative components to 0", () => {
    const odd: DailySellEstimate[] = [
      {
        productId: "p1",
        locationId: "shop",
        date: "2026-04-20",
        soldCount: 0,
        customBoxPickCount: -1,
        rollingAvg30d: -3,
      },
    ];
    expect(resolveDailyDemand(odd, "p1", "shop")).toBe(0);
  });
});

describe("projectStock", () => {
  it("counts down stock across the horizon and surfaces shortfall date", () => {
    const projection = projectStock({
      productId: "p1",
      locationId: "shop",
      startingStock: 100,
      min: 30,
      target: 80,
      startDate: "2026-04-21",
      horizonDays: 5,
      dailyDemand: 20,
      scheduledBatches: [],
      pendingDemand: [],
    });
    expect(projection.days[0].projected).toBe(80);
    expect(projection.days[4].projected).toBe(0);
    expect(projection.firstShortfallDate).toBe("2026-04-24"); // day 4 = 20
    expect(projection.triggers).toBe(true);
  });

  it("respects scheduled batches that arrive within horizon", () => {
    const projection = projectStock({
      productId: "p1",
      locationId: "shop",
      startingStock: 60,
      min: 30,
      target: 80,
      startDate: "2026-04-21",
      horizonDays: 5,
      dailyDemand: 10,
      scheduledBatches: [
        { productId: "p1", locationId: "shop", availableOn: "2026-04-23", quantity: 50 },
      ],
      pendingDemand: [],
    });
    // Day 0: 50, day 1: 40, day 2: +50 -10 = 80, day 3: 70, day 4: 60.
    expect(projection.days[2].projected).toBe(80);
    expect(projection.firstShortfallDate).toBeNull();
    expect(projection.triggers).toBe(false);
  });

  it("includes pending order demand on a specific day", () => {
    const projection = projectStock({
      productId: "p1",
      locationId: "shop",
      startingStock: 50,
      min: 10,
      target: 80,
      startDate: "2026-04-21",
      horizonDays: 4,
      dailyDemand: 0,
      scheduledBatches: [],
      pendingDemand: [
        { productId: "p1", locationId: "shop", date: "2026-04-22", quantity: 45 },
      ],
    });
    expect(projection.days[1].projected).toBe(5);
    expect(projection.firstShortfallDate).toBe("2026-04-22");
  });
});

describe("buildProposal", () => {
  it("returns null when projection does not trigger", () => {
    const projection = projectStock({
      productId: "p1",
      locationId: "shop",
      startingStock: 200,
      min: 30,
      target: 80,
      startDate: "2026-04-21",
      horizonDays: 3,
      dailyDemand: 5,
      scheduledBatches: [],
      pendingDemand: [],
    });
    expect(
      buildProposal({ product: baseProduct(), locationId: "shop", projection, mouldFloor: 40 }),
    ).toBeNull();
  });

  it("rounds suggested batch size up to mould floor and tops up to target", () => {
    const projection = projectStock({
      productId: "p1",
      locationId: "shop",
      startingStock: 50,
      min: 30,
      target: 80,
      startDate: "2026-04-21",
      horizonDays: 5,
      dailyDemand: 10,
      scheduledBatches: [],
      pendingDemand: [],
    });
    const proposal = buildProposal({
      product: baseProduct(),
      locationId: "shop",
      projection,
      mouldFloor: 40,
    });
    expect(proposal).not.toBeNull();
    if (proposal) {
      expect(proposal.suggestedBatchSize % 40).toBe(0);
      expect(proposal.priorityTier).toBe(1);
      expect(proposal.reason).toBe("auto-replen");
    }
  });
});

describe("getLocationMinimum", () => {
  const minimums: StockLocationMinimum[] = [
    {
      productId: "p1",
      location: "shop" as unknown as StockLocationMinimum["location"],
      minimumUnits: 30,
      maximumUnits: 80,
      updatedAt: new Date(),
    },
  ];

  it("returns the per-location row when present", () => {
    expect(getLocationMinimum(minimums, "p1", "shop")).toEqual({ min: 30, target: 80 });
  });
  it("returns 0/0 when no row matches", () => {
    expect(getLocationMinimum(minimums, "p2", "shop")).toEqual({ min: 0, target: 0 });
  });
});

describe("runReplenishmentEngine", () => {
  it("produces one proposal per (product, location) when projection triggers", () => {
    const products: Product[] = [baseProduct({ id: "p1" })];
    const out = runReplenishmentEngine({
      products,
      startDate: "2026-04-21",
      horizonDays: 5,
      stockByKey: new Map([["p1|shop", 50]]),
      scheduledBatches: [],
      pendingDemand: [],
      estimates: [
        {
          productId: "p1",
          locationId: "shop",
          date: "2026-04-20",
          soldCount: 12,
          customBoxPickCount: 0,
          rollingAvg30d: 12,
        },
      ],
      minimums: [
        {
          productId: "p1",
          location: "shop" as unknown as StockLocationMinimum["location"],
          minimumUnits: 30,
          updatedAt: new Date(),
        },
      ],
      locations: ["shop"],
      mouldFloorByProduct: new Map([["p1", 40]]),
    });
    expect(out).toHaveLength(1);
    expect(out[0].productId).toBe("p1");
    expect(out[0].locationId).toBe("shop");
  });

  it("skips archived products", () => {
    const products: Product[] = [baseProduct({ id: "p1", archived: true })];
    const out = runReplenishmentEngine({
      products,
      startDate: "2026-04-21",
      horizonDays: 5,
      stockByKey: new Map([["p1|shop", 0]]),
      scheduledBatches: [],
      pendingDemand: [],
      estimates: [],
      minimums: [
        {
          productId: "p1",
          location: "shop" as unknown as StockLocationMinimum["location"],
          minimumUnits: 30,
          updatedAt: new Date(),
        },
      ],
      locations: ["shop"],
      mouldFloorByProduct: new Map(),
    });
    expect(out).toHaveLength(0);
  });

  it("skips products with no min policy", () => {
    const products: Product[] = [baseProduct({ id: "p1" })];
    const out = runReplenishmentEngine({
      products,
      startDate: "2026-04-21",
      horizonDays: 5,
      stockByKey: new Map(),
      scheduledBatches: [],
      pendingDemand: [],
      estimates: [],
      minimums: [],
      locations: ["shop"],
      mouldFloorByProduct: new Map(),
    });
    expect(out).toHaveLength(0);
  });
});
