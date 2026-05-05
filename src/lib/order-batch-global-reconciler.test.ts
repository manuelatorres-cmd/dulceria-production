import { describe, it, expect } from "vitest";
import {
  reconcileGlobalProduceDemand,
  assertNoTransferStep,
  type GlobalReconcileInput,
} from "./order-batch-global-reconciler";
import type {
  Order, OrderItem, Product, Mould, ProductionPlan, PlanProduct,
  OrderPlanLink,
} from "@/types";

function mkOrder(id: string, status: Order["status"] = "pending"): Order {
  return {
    id, channel: "b2b", customerName: id,
    deadline: new Date("2026-06-01T10:00:00Z").toISOString(),
    priority: "normal", status,
  } as Order;
}

function mkItem(id: string, orderId: string, productId: string, quantity: number, mode: "produce" | "borrow" = "produce"): OrderItem {
  return { id, orderId, productId, quantity, sortOrder: 0, fulfilmentMode: mode } as OrderItem;
}

function mkProduct(id: string, name = id, mouldId: string | undefined = "m1"): Product {
  return { id, name, defaultMouldId: mouldId, defaultBatchQty: 1 } as unknown as Product;
}

function mkMould(id: string, cavities: number, quantityOwned?: number): Mould {
  return { id, name: id, cavityWeightG: 10, numberOfCavities: cavities, quantityOwned };
}

function mkPlan(id: string, status: ProductionPlan["status"] = "draft"): ProductionPlan {
  return { id, name: id, status, createdAt: new Date(), updatedAt: new Date() } as ProductionPlan;
}

function mkPlanProduct(id: string, planId: string, productId: string, quantity = 1, mouldId = "m1"): PlanProduct {
  return { id, planId, productId, mouldId, quantity, sortOrder: 0 } as PlanProduct;
}

function mkLink(id: string, orderItemId: string, planId: string, allocatedQuantity: number): OrderPlanLink {
  return { id, orderItemId, planId, allocatedQuantity };
}

function baseInput(overrides: Partial<GlobalReconcileInput> = {}): GlobalReconcileInput {
  return {
    openOrders: [],
    openOrderItems: [],
    products: [],
    moulds: [],
    plans: [],
    planProducts: [],
    links: [],
    ...overrides,
  };
}

describe("reconcileGlobalProduceDemand — fresh consolidation", () => {
  it("sums produce-fresh demand across multiple orders into one batch per product", () => {
    const result = reconcileGlobalProduceDemand(baseInput({
      openOrders: [mkOrder("oA"), mkOrder("oB")],
      openOrderItems: [
        mkItem("iA1", "oA", "p1", 100),
        mkItem("iB1", "oB", "p1", 80),
      ],
      products: [mkProduct("p1", "Lime", "m1")],
      moulds: [mkMould("m1", 40)],
    }));
    expect(result.newBatches).toHaveLength(1);
    const b = result.newBatches[0];
    expect(b.productId).toBe("p1");
    // total demand 180, cavities 40 → ceil(180/40) = 5 moulds = 200 pieces
    expect(b.moulds).toBe(5);
    expect(b.totalPieces).toBe(200);
    expect(b.totalDemand).toBe(180);
    expect(b.surplus).toBe(20);
    expect(b.allocations).toEqual([
      { orderItemId: "iA1", allocatedQuantity: 100 },
      { orderItemId: "iB1", allocatedQuantity: 80 },
    ]);
  });

  it("creates separate batches for separate products", () => {
    const result = reconcileGlobalProduceDemand(baseInput({
      openOrders: [mkOrder("oA")],
      openOrderItems: [
        mkItem("iA1", "oA", "p1", 40),
        mkItem("iA2", "oA", "p2", 60),
      ],
      products: [mkProduct("p1", "Lime", "m1"), mkProduct("p2", "Mango", "m2")],
      moulds: [mkMould("m1", 20), mkMould("m2", 20)],
    }));
    expect(result.newBatches).toHaveLength(2);
    const byProduct = Object.fromEntries(result.newBatches.map((b) => [b.productId, b]));
    expect(byProduct.p1.moulds).toBe(2);
    expect(byProduct.p2.moulds).toBe(3);
  });

  it("borrow lines do NOT create batches — only produce-fresh does", () => {
    // Updated 2026-04-22: borrow-line packing is a fulfilment action
    // on the order (Mark as packed), not a scheduled batch. The
    // reconciler ignores borrow items entirely.
    const result = reconcileGlobalProduceDemand(baseInput({
      openOrders: [mkOrder("oA")],
      openOrderItems: [
        mkItem("iA1", "oA", "p1", 40, "produce"),
        mkItem("iA2", "oA", "p1", 20, "borrow"),
      ],
      products: [mkProduct("p1", "Lime", "m1")],
      moulds: [mkMould("m1", 40)],
    }));
    // Exactly one batch: produce-fresh for iA1 only.
    expect(result.newBatches).toHaveLength(1);
    expect(result.newBatches[0].totalDemand).toBe(40);
    expect(result.newBatches[0].kind).not.toBe("packing");
  });

  it("ignores closed orders (done / cancelled)", () => {
    const result = reconcileGlobalProduceDemand(baseInput({
      openOrders: [
        mkOrder("oA", "done"),
        mkOrder("oB", "cancelled"),
      ],
      openOrderItems: [
        mkItem("iA1", "oA", "p1", 40),
        mkItem("iB1", "oB", "p1", 30),
      ],
      products: [mkProduct("p1", "Lime", "m1")],
      moulds: [mkMould("m1", 40)],
    }));
    expect(result.newBatches).toHaveLength(0);
  });

  it("warns + skips a product that has no default mould", () => {
    const result = reconcileGlobalProduceDemand(baseInput({
      openOrders: [mkOrder("oA")],
      openOrderItems: [mkItem("iA1", "oA", "p1", 40)],
      products: [mkProduct("p1", "Lime", undefined)],
      moulds: [],
    }));
    expect(result.newBatches).toHaveLength(0);
    expect(result.warnings.some((w) => /mould/i.test(w))).toBe(true);
  });
});

describe("reconcileGlobalProduceDemand — mould-cap split", () => {
  it("splits a cluster into sequential sub-batches when demand exceeds quantityOwned moulds", () => {
    // 16 pieces of p1, 2 cavities/mould → 8 mould-fills total. Owner has
    // 4 physical moulds → split into two sub-batches of 4 moulds each.
    const result = reconcileGlobalProduceDemand(baseInput({
      openOrders: [mkOrder("oA")],
      openOrderItems: [mkItem("iA1", "oA", "p1", 16)],
      products: [mkProduct("p1", "XXL Heart", "m1")],
      moulds: [mkMould("m1", 2, 4)],
    }));
    expect(result.newBatches).toHaveLength(2);
    const [first, second] = result.newBatches;
    expect(first.moulds).toBe(4);
    expect(first.totalPieces).toBe(8);
    expect(first.splitIndex).toBe(1);
    expect(first.splitTotal).toBe(2);
    expect(second.moulds).toBe(4);
    expect(second.totalPieces).toBe(8);
    expect(second.splitIndex).toBe(2);
    expect(second.splitTotal).toBe(2);
    // The cluster's single 16-piece line is sliced 8/8 across the rounds.
    expect(first.allocations).toEqual([{ orderItemId: "iA1", allocatedQuantity: 8 }]);
    expect(second.allocations).toEqual([{ orderItemId: "iA1", allocatedQuantity: 8 }]);
  });

  it("does not split when demand fits within quantityOwned moulds", () => {
    // 8 pieces of p1, 2 cavities → 4 moulds. Owner has 4 → exactly one round.
    const result = reconcileGlobalProduceDemand(baseInput({
      openOrders: [mkOrder("oA")],
      openOrderItems: [mkItem("iA1", "oA", "p1", 8)],
      products: [mkProduct("p1", "XXL Heart", "m1")],
      moulds: [mkMould("m1", 2, 4)],
    }));
    expect(result.newBatches).toHaveLength(1);
    expect(result.newBatches[0].moulds).toBe(4);
    expect(result.newBatches[0].splitIndex).toBeUndefined();
    expect(result.newBatches[0].splitTotal).toBeUndefined();
  });

  it("treats quantityOwned 0/null as no cap (legacy behaviour)", () => {
    const result = reconcileGlobalProduceDemand(baseInput({
      openOrders: [mkOrder("oA")],
      openOrderItems: [mkItem("iA1", "oA", "p1", 200)],
      products: [mkProduct("p1", "Standard Truffle", "m1")],
      moulds: [mkMould("m1", 40)], // quantityOwned undefined
    }));
    expect(result.newBatches).toHaveLength(1);
    expect(result.newBatches[0].moulds).toBe(5);
  });
});

describe("reconcileGlobalProduceDemand — active-batch protection", () => {
  it("subtracts pieces already committed to an active batch from the line's remaining demand", () => {
    // Order wants 100 of p1; 60 already in a running batch. Reconciler
    // must only create a new batch for the remaining 40.
    const result = reconcileGlobalProduceDemand(baseInput({
      openOrders: [mkOrder("oA")],
      openOrderItems: [mkItem("iA1", "oA", "p1", 100)],
      products: [mkProduct("p1", "Lime", "m1")],
      moulds: [mkMould("m1", 40)],
      plans: [mkPlan("activePlan", "active")],
      planProducts: [mkPlanProduct("pp-active", "activePlan", "p1")],
      links: [mkLink("lk-active", "iA1", "activePlan", 60)],
    }));
    expect(result.newBatches).toHaveLength(1);
    expect(result.newBatches[0].totalDemand).toBe(40);
    // Active link is not in linksToDelete — active batch is preserved.
    expect(result.linksToDelete).not.toContain("lk-active");
  });

  it("produces zero batches when the active batch fully covers the line's demand", () => {
    const result = reconcileGlobalProduceDemand(baseInput({
      openOrders: [mkOrder("oA")],
      openOrderItems: [mkItem("iA1", "oA", "p1", 100)],
      products: [mkProduct("p1", "Lime", "m1")],
      moulds: [mkMould("m1", 40)],
      plans: [mkPlan("activePlan", "active")],
      planProducts: [mkPlanProduct("pp-active", "activePlan", "p1")],
      links: [mkLink("lk-active", "iA1", "activePlan", 100)],
    }));
    expect(result.newBatches).toHaveLength(0);
    expect(result.updateBatches).toHaveLength(0);
  });

  it("leaves active batches untouched even when they share a product with new demand", () => {
    const result = reconcileGlobalProduceDemand(baseInput({
      openOrders: [mkOrder("oA"), mkOrder("oB")],
      openOrderItems: [
        mkItem("iA1", "oA", "p1", 50), // covered by active
        mkItem("iB1", "oB", "p1", 40), // new
      ],
      products: [mkProduct("p1", "Lime", "m1")],
      moulds: [mkMould("m1", 40)],
      plans: [mkPlan("activePlan", "active")],
      planProducts: [mkPlanProduct("pp-active", "activePlan", "p1")],
      links: [mkLink("lk-active", "iA1", "activePlan", 50)],
    }));
    expect(result.newBatches).toHaveLength(1);
    expect(result.newBatches[0].totalDemand).toBe(40);
    expect(result.plansToCancel).not.toContain("activePlan");
  });
});

describe("reconcileGlobalProduceDemand — draft rebuild", () => {
  it("rebuilds the existing draft batch rather than creating a duplicate", () => {
    // Draft batch already exists for p1; a new order arrived. Should
    // be an UPDATE, not a NEW.
    const result = reconcileGlobalProduceDemand(baseInput({
      openOrders: [mkOrder("oA"), mkOrder("oB")],
      openOrderItems: [
        mkItem("iA1", "oA", "p1", 40),
        mkItem("iB1", "oB", "p1", 60),
      ],
      products: [mkProduct("p1", "Lime", "m1")],
      moulds: [mkMould("m1", 40)],
      plans: [mkPlan("draftPlan", "draft")],
      planProducts: [mkPlanProduct("pp-draft", "draftPlan", "p1", 1)],
      links: [mkLink("lk-old", "iA1", "draftPlan", 40)],
    }));
    expect(result.newBatches).toHaveLength(0);
    expect(result.updateBatches).toHaveLength(1);
    const u = result.updateBatches[0];
    expect(u.planId).toBe("draftPlan");
    expect(u.totalDemand).toBe(100);
    expect(u.moulds).toBe(3); // ceil(100/40)
    // Old link gets dropped so the new consolidated set can be
    // inserted in its place.
    expect(result.linksToDelete).toContain("lk-old");
  });

  it("cancels a draft batch whose product no longer has any eligible demand", () => {
    const result = reconcileGlobalProduceDemand(baseInput({
      openOrders: [],
      openOrderItems: [],
      products: [mkProduct("p1", "Lime", "m1")],
      moulds: [mkMould("m1", 40)],
      plans: [mkPlan("draftPlan", "draft")],
      planProducts: [mkPlanProduct("pp-draft", "draftPlan", "p1")],
      links: [mkLink("lk-old", "iA1", "draftPlan", 40)],
    }));
    expect(result.plansToCancel).toContain("draftPlan");
    expect(result.linksToDelete).toContain("lk-old");
  });

  it("leaves done / cancelled / orphaned batches alone", () => {
    const result = reconcileGlobalProduceDemand(baseInput({
      openOrders: [],
      openOrderItems: [],
      products: [mkProduct("p1", "Lime", "m1")],
      moulds: [mkMould("m1", 40)],
      plans: [
        mkPlan("donePlan", "done"),
        mkPlan("cancelledPlan", "cancelled"),
        mkPlan("orphanedPlan", "orphaned"),
      ],
      planProducts: [
        mkPlanProduct("pp-done", "donePlan", "p1"),
        mkPlanProduct("pp-cancelled", "cancelledPlan", "p1"),
        mkPlanProduct("pp-orphaned", "orphanedPlan", "p1"),
      ],
      links: [],
    }));
    expect(result.plansToCancel).toEqual([]);
    expect(result.newBatches).toEqual([]);
  });

  it("collapses multiple sibling drafts for the same product down to one", () => {
    const result = reconcileGlobalProduceDemand(baseInput({
      openOrders: [mkOrder("oA")],
      openOrderItems: [mkItem("iA1", "oA", "p1", 40)],
      products: [mkProduct("p1", "Lime", "m1")],
      moulds: [mkMould("m1", 40)],
      plans: [mkPlan("draftA", "draft"), mkPlan("draftB", "draft")],
      planProducts: [
        mkPlanProduct("pp-A", "draftA", "p1"),
        mkPlanProduct("pp-B", "draftB", "p1"),
      ],
      links: [mkLink("lk-A", "iA1", "draftA", 40)],
    }));
    // One of the two drafts gets kept + resized; the other is cancelled.
    expect(result.updateBatches).toHaveLength(1);
    expect(result.plansToCancel).toHaveLength(1);
    expect(["draftA", "draftB"]).toContain(result.plansToCancel[0]);
  });
});

describe("assertNoTransferStep", () => {
  it("accepts the valid 8-phase step list", () => {
    expect(() => assertNoTransferStep([
      "Polishing", "Painting", "Shelling", "Filling Prep",
      "Filling", "Capping", "Unmoulding", "Packing",
    ])).not.toThrow();
  });
  it("throws when Transfer slips in", () => {
    expect(() => assertNoTransferStep(["Painting", "Transfer", "Shelling"])).toThrow(/Transfer/i);
  });
  it("throws on leading-whitespace or mixed case transfer", () => {
    expect(() => assertNoTransferStep(["  transfer sheet"])).toThrow();
    expect(() => assertNoTransferStep(["TRANSFER"])).toThrow();
  });
});
