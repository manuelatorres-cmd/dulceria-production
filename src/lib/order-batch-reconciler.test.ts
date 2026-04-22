import { describe, it, expect } from "vitest";
import { reconcileOrderBatches, type ReconcileInput } from "./order-batch-reconciler";
import type {
  Order, OrderItem, Product, Mould, ProductionPlan, PlanProduct,
  OrderPlanLink,
} from "@/types";

function mkOrder(status: Order["status"] = "pending", overrides: Partial<Order> = {}): Order {
  return {
    id: "o1", channel: "b2b", customerName: "Acme",
    deadline: new Date("2026-06-01T10:00:00Z").toISOString(),
    priority: "normal", status,
    ...overrides,
  } as Order;
}

function mkItem(id: string, productId: string, quantity: number): OrderItem {
  return { id, orderId: "o1", productId, quantity, sortOrder: 0 } as OrderItem;
}

function mkProduct(id: string, mouldId: string | undefined = "m1"): Product {
  return { id, name: id, defaultMouldId: mouldId, defaultBatchQty: 1 } as unknown as Product;
}

function mkMould(id: string, cavities: number): Mould {
  return { id, name: id, cavityWeightG: 10, numberOfCavities: cavities };
}

function mkPlan(id: string, status: ProductionPlan["status"] = "draft"): ProductionPlan {
  return {
    id, name: "B", status,
    createdAt: new Date(), updatedAt: new Date(),
  } as ProductionPlan;
}

function mkLink(orderItemId: string, planId: string, qty: number, id = `lk-${orderItemId}-${planId}`): OrderPlanLink {
  return { id, orderItemId, planId, allocatedQuantity: qty };
}

function baseInput(overrides: Partial<ReconcileInput> = {}): ReconcileInput {
  return {
    order: mkOrder(),
    orderItems: [],
    products: [],
    moulds: [],
    existingLinks: [],
    existingPlans: [],
    existingPlanProducts: [],
    availableByProductId: new Map(),
    otherLinks: [],
    ...overrides,
  };
}

describe("reconcileOrderBatches — active order, create", () => {
  it("creates one batch sized by mould for a fresh line with no stock", () => {
    const result = reconcileOrderBatches(baseInput({
      orderItems: [mkItem("i1", "p1", 100)],
      products: [mkProduct("p1", "m1")],
      moulds: [mkMould("m1", 40)],
    }));
    expect(result.newBatches).toHaveLength(1);
    const b = result.newBatches[0];
    expect(b.planProducts[0].quantity).toBe(3); // ceil(100/40)
    expect(b.allocations[0].allocatedQuantity).toBe(100);
    expect(b.allocations[0].orderItemId).toBe("i1");
  });

  it("skips batch creation when stock fully covers the line", () => {
    const result = reconcileOrderBatches(baseInput({
      orderItems: [mkItem("i1", "p1", 50)],
      products: [mkProduct("p1", "m1")],
      moulds: [mkMould("m1", 40)],
      availableByProductId: new Map([["p1", 60]]),
    }));
    expect(result.newBatches).toHaveLength(0);
    expect(result.linksToDelete).toHaveLength(0);
  });

  it("creates a batch for the shortfall when stock partially covers", () => {
    const result = reconcileOrderBatches(baseInput({
      orderItems: [mkItem("i1", "p1", 100)],
      products: [mkProduct("p1", "m1")],
      moulds: [mkMould("m1", 40)],
      availableByProductId: new Map([["p1", 30]]),
    }));
    expect(result.newBatches).toHaveLength(1);
    const b = result.newBatches[0];
    // shortfall = 70 → ceil(70/40) = 2 moulds = 80 pieces produced, 70 allocated
    expect(b.planProducts[0].quantity).toBe(2);
    expect(b.allocations[0].allocatedQuantity).toBe(70);
  });

  it("rounds up to whole moulds — shortfall 100, cavities 40 ⇒ 3 moulds", () => {
    const result = reconcileOrderBatches(baseInput({
      orderItems: [mkItem("i1", "p1", 100)],
      products: [mkProduct("p1", "m1")],
      moulds: [mkMould("m1", 40)],
    }));
    expect(result.newBatches[0].planProducts[0].quantity).toBe(3);
  });

  it("warns + skips batch when the product has no default mould", () => {
    const result = reconcileOrderBatches(baseInput({
      orderItems: [mkItem("i1", "p1", 100)],
      products: [mkProduct("p1", undefined)],
      moulds: [],
    }));
    expect(result.newBatches).toHaveLength(0);
    expect(result.warnings.some((w) => /mould/i.test(w))).toBe(true);
  });

  it("creates separate batches for separate lines", () => {
    const result = reconcileOrderBatches(baseInput({
      orderItems: [
        mkItem("i1", "p1", 40),
        mkItem("i2", "p2", 40),
      ],
      products: [mkProduct("p1", "m1"), mkProduct("p2", "m2")],
      moulds: [mkMould("m1", 20), mkMould("m2", 20)],
    }));
    expect(result.newBatches).toHaveLength(2);
    const productIds = result.newBatches.map((b) => b.planProducts[0].productId).sort();
    expect(productIds).toEqual(["p1", "p2"]);
  });
});

describe("reconcileOrderBatches — active order, existing links", () => {
  it("keeps existing draft batch that already covers the line — no new batch, no updates", () => {
    const result = reconcileOrderBatches(baseInput({
      orderItems: [mkItem("i1", "p1", 100)],
      products: [mkProduct("p1", "m1")],
      moulds: [mkMould("m1", 40)],
      existingLinks: [mkLink("i1", "pl1", 100)],
      existingPlans: [mkPlan("pl1", "draft")],
    }));
    expect(result.newBatches).toHaveLength(0);
    expect(result.linksToUpdate).toHaveLength(0);
    expect(result.linksToDelete).toHaveLength(0);
  });

  it("adds a second batch when the line quantity grows beyond the existing batch", () => {
    const result = reconcileOrderBatches(baseInput({
      orderItems: [mkItem("i1", "p1", 150)],
      products: [mkProduct("p1", "m1")],
      moulds: [mkMould("m1", 40)],
      existingLinks: [mkLink("i1", "pl1", 100)],
      existingPlans: [mkPlan("pl1", "draft")],
    }));
    expect(result.newBatches).toHaveLength(1);
    // New batch covers the shortfall of 50 pieces → ceil(50/40) = 2 moulds.
    expect(result.newBatches[0].planProducts[0].quantity).toBe(2);
    expect(result.newBatches[0].allocations[0].allocatedQuantity).toBe(50);
    // Existing link survives untouched.
    expect(result.linksToUpdate).toHaveLength(0);
    expect(result.linksToDelete).toHaveLength(0);
  });

  it("trims allocation when the line shrinks — no batch update, just smaller link", () => {
    const result = reconcileOrderBatches(baseInput({
      orderItems: [mkItem("i1", "p1", 60)],
      products: [mkProduct("p1", "m1")],
      moulds: [mkMould("m1", 40)],
      existingLinks: [mkLink("i1", "pl1", 100)],
      existingPlans: [mkPlan("pl1", "draft")],
    }));
    expect(result.newBatches).toHaveLength(0);
    expect(result.linksToUpdate).toEqual([{ linkId: "lk-i1-pl1", allocatedQuantity: 60 }]);
  });

  it("drops links to cancelled / orphaned plans and re-creates the batch", () => {
    const result = reconcileOrderBatches(baseInput({
      orderItems: [mkItem("i1", "p1", 100)],
      products: [mkProduct("p1", "m1")],
      moulds: [mkMould("m1", 40)],
      existingLinks: [mkLink("i1", "pl-dead", 100)],
      existingPlans: [mkPlan("pl-dead", "cancelled")],
    }));
    expect(result.linksToDelete).toEqual(["lk-i1-pl-dead"]);
    expect(result.newBatches).toHaveLength(1);
  });

  it("keeps link to a done batch and doesn't create a new one (pieces already in stock)", () => {
    const result = reconcileOrderBatches(baseInput({
      orderItems: [mkItem("i1", "p1", 100)],
      products: [mkProduct("p1", "m1")],
      moulds: [mkMould("m1", 40)],
      availableByProductId: new Map([["p1", 100]]), // done batch's pieces reached stock
      existingLinks: [mkLink("i1", "pl-done", 100)],
      existingPlans: [mkPlan("pl-done", "done")],
    }));
    expect(result.newBatches).toHaveLength(0);
    expect(result.linksToDelete).toHaveLength(0);
    expect(result.linksToUpdate).toHaveLength(0);
  });
});

describe("reconcileOrderBatches — active order, removed lines", () => {
  it("deletes links for a removed line and cancels its draft batch", () => {
    const result = reconcileOrderBatches(baseInput({
      // Order now has only i1; i2 was removed but its link still exists.
      orderItems: [mkItem("i1", "p1", 40)],
      products: [mkProduct("p1", "m1"), mkProduct("p2", "m2")],
      moulds: [mkMould("m1", 40), mkMould("m2", 20)],
      existingLinks: [
        mkLink("i1", "pl1", 40),
        mkLink("i2", "pl2", 40, "lk-i2"),
      ],
      existingPlans: [mkPlan("pl1", "draft"), mkPlan("pl2", "draft")],
    }));
    expect(result.linksToDelete).toContain("lk-i2");
    expect(result.plansToCancel).toContain("pl2");
    expect(result.plansToOrphan).not.toContain("pl2");
  });

  it("orphans (not cancels) a batch that was already active when its line was removed", () => {
    const result = reconcileOrderBatches(baseInput({
      orderItems: [],
      products: [mkProduct("p1", "m1")],
      moulds: [mkMould("m1", 40)],
      existingLinks: [mkLink("i1", "pl1", 40)],
      existingPlans: [mkPlan("pl1", "active")],
    }));
    expect(result.plansToOrphan).toEqual(["pl1"]);
    expect(result.plansToCancel).toEqual([]);
  });

  it("leaves a shared plan alone when this order's link is dropped but another order still links to it", () => {
    const result = reconcileOrderBatches(baseInput({
      orderItems: [],
      products: [mkProduct("p1", "m1")],
      moulds: [mkMould("m1", 40)],
      existingLinks: [mkLink("i1", "pl-shared", 40)],
      existingPlans: [mkPlan("pl-shared", "draft")],
      otherLinks: [mkLink("other-item", "pl-shared", 40, "lk-other")],
    }));
    expect(result.linksToDelete).toEqual(["lk-i1-pl-shared"]);
    expect(result.plansToCancel).toEqual([]);
    expect(result.plansToOrphan).toEqual([]);
  });
});

describe("reconcileOrderBatches — cancelled order", () => {
  it("deletes all links and cancels draft batches", () => {
    const result = reconcileOrderBatches(baseInput({
      order: mkOrder("cancelled"),
      orderItems: [mkItem("i1", "p1", 40)],
      products: [mkProduct("p1", "m1")],
      moulds: [mkMould("m1", 40)],
      existingLinks: [mkLink("i1", "pl1", 40)],
      existingPlans: [mkPlan("pl1", "draft")],
    }));
    expect(result.linksToDelete).toEqual(["lk-i1-pl1"]);
    expect(result.plansToCancel).toEqual(["pl1"]);
  });

  it("orphans active batches instead of cancelling", () => {
    const result = reconcileOrderBatches(baseInput({
      order: mkOrder("cancelled"),
      orderItems: [],
      products: [mkProduct("p1", "m1")],
      moulds: [mkMould("m1", 40)],
      existingLinks: [mkLink("i1", "pl-active", 40)],
      existingPlans: [mkPlan("pl-active", "active")],
    }));
    expect(result.plansToOrphan).toEqual(["pl-active"]);
    expect(result.plansToCancel).toEqual([]);
  });

  it("doesn't touch a plan shared with another uncancelled order", () => {
    const result = reconcileOrderBatches(baseInput({
      order: mkOrder("cancelled"),
      orderItems: [],
      products: [mkProduct("p1", "m1")],
      moulds: [mkMould("m1", 40)],
      existingLinks: [mkLink("i1", "pl-shared", 40)],
      existingPlans: [mkPlan("pl-shared", "draft")],
      otherLinks: [mkLink("other-item", "pl-shared", 40, "lk-other")],
    }));
    expect(result.plansToCancel).toEqual([]);
    expect(result.linksToDelete).toEqual(["lk-i1-pl-shared"]);
  });

  it("leaves done batches alone (already delivered pieces)", () => {
    const result = reconcileOrderBatches(baseInput({
      order: mkOrder("cancelled"),
      orderItems: [],
      products: [mkProduct("p1", "m1")],
      moulds: [mkMould("m1", 40)],
      existingLinks: [mkLink("i1", "pl-done", 40)],
      existingPlans: [mkPlan("pl-done", "done")],
    }));
    expect(result.plansToCancel).toEqual([]);
    expect(result.plansToOrphan).toEqual([]);
    expect(result.linksToDelete).toEqual(["lk-i1-pl-done"]);
  });
});

describe("reconcileOrderBatches — done order", () => {
  it("returns an empty decision — nothing to do", () => {
    const result = reconcileOrderBatches(baseInput({
      order: mkOrder("done"),
      orderItems: [mkItem("i1", "p1", 40)],
      products: [mkProduct("p1", "m1")],
      moulds: [mkMould("m1", 40)],
    }));
    expect(result.newBatches).toEqual([]);
    expect(result.linksToDelete).toEqual([]);
    expect(result.plansToCancel).toEqual([]);
  });
});
