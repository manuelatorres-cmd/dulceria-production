import { describe, it, expect } from "vitest";
import {
  buildCampaignProposals,
  resolveRampStart,
  runCampaignScheduler,
  spreadAcrossDays,
} from "./campaignScheduler";
import type { Campaign, Product } from "@/types";

const baseProduct = (overrides: Partial<Product> = {}): Product => ({
  id: "p1",
  name: "Praline egg",
  createdAt: new Date(),
  updatedAt: new Date(),
  priorityTier: 2,
  ...overrides,
});

const baseCampaign = (overrides: Partial<Campaign> = {}): Campaign => ({
  name: "Easter 2026",
  type: "seasonal",
  startDate: "2026-04-01",
  endDate: "2026-04-28",
  productIds: ["p1", "p2"],
  status: "active",
  targetTotalUnits: 200,
  ...overrides,
});

describe("spreadAcrossDays", () => {
  it("spreads units across days respecting mould floor", () => {
    const slots = spreadAcrossDays({ totalUnits: 120, daysAvailable: 4, mouldFloor: 40 });
    expect(slots.reduce((s, x) => s + x, 0)).toBe(120);
    expect(slots.every((q) => q % 40 === 0)).toBe(true);
  });
  it("returns empty array when no days available", () => {
    expect(spreadAcrossDays({ totalUnits: 100, daysAvailable: 0, mouldFloor: 40 })).toEqual([]);
  });
});

describe("resolveRampStart", () => {
  it("uses productionStartDate when provided", () => {
    expect(
      resolveRampStart(baseCampaign({ productionStartDate: "2026-03-15" })),
    ).toBe("2026-03-15");
  });
  it("falls back to start - default ramp days when missing", () => {
    expect(resolveRampStart(baseCampaign({ startDate: "2026-04-01" }))).toBe("2026-03-18");
  });
});

describe("buildCampaignProposals", () => {
  it("emits one proposal per product in the campaign", () => {
    const productsById = new Map<string, Product>([
      ["p1", baseProduct({ id: "p1" })],
      ["p2", baseProduct({ id: "p2" })],
    ]);
    const proposals = buildCampaignProposals({
      campaign: baseCampaign(),
      productsById,
      mouldFloorByProduct: new Map([
        ["p1", 40],
        ["p2", 40],
      ]),
    });
    expect(proposals).toHaveLength(2);
    expect(proposals[0].reason).toBe("campaign-prep");
    expect(proposals[0].suggestedBatchSize % 40).toBe(0);
  });

  it("skips done or cancelled campaigns", () => {
    expect(
      buildCampaignProposals({
        campaign: baseCampaign({ status: "done" }),
        productsById: new Map(),
        mouldFloorByProduct: new Map(),
      }),
    ).toHaveLength(0);
    expect(
      buildCampaignProposals({
        campaign: baseCampaign({ status: "cancelled" }),
        productsById: new Map(),
        mouldFloorByProduct: new Map(),
      }),
    ).toHaveLength(0);
  });

  it("respects perProductTargets when provided", () => {
    const productsById = new Map<string, Product>([["p1", baseProduct({ id: "p1" })]]);
    const proposals = buildCampaignProposals({
      campaign: baseCampaign({ productIds: ["p1"], targetTotalUnits: undefined }),
      productsById,
      mouldFloorByProduct: new Map([["p1", 40]]),
      perProductTargets: new Map([["p1", 90]]),
    });
    expect(proposals).toHaveLength(1);
    expect(proposals[0].suggestedBatchSize).toBe(120); // ceil(90/40)*40
  });
});

describe("runCampaignScheduler", () => {
  it("aggregates proposals across multiple campaigns", () => {
    const productsById = new Map<string, Product>([
      ["p1", baseProduct({ id: "p1" })],
      ["p2", baseProduct({ id: "p2" })],
    ]);
    const out = runCampaignScheduler({
      campaigns: [
        baseCampaign({ productIds: ["p1"], targetTotalUnits: 100 }),
        baseCampaign({ name: "Mother's Day", startDate: "2026-05-01", endDate: "2026-05-11", productIds: ["p2"], targetTotalUnits: 80 }),
      ],
      productsById,
      mouldFloorByProduct: new Map([
        ["p1", 40],
        ["p2", 40],
      ]),
    });
    expect(out).toHaveLength(2);
  });
});
