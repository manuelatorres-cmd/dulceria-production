import { describe, it, expect } from "vitest";
import { computeWeeklyFillingNeeds } from "./weeklyFilling";
import type { Order, OrderItem, Product, ProductFilling, Filling, FillingIngredient, FillingCategory, Mould, FillingStock } from "@/types";

const NOW = new Date("2026-04-20T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function makeOrder(id: string, days: number, status: Order["status"] = "pending", extras: Partial<Order> = {}): Order {
  return {
    id,
    channel: "b2b",
    deadline: new Date(NOW.getTime() + days * DAY).toISOString(),
    priority: "normal",
    status,
    customerName: `Customer ${id}`,
    createdAt: NOW,
    updatedAt: NOW,
    ...extras,
  };
}

function makeItem(id: string, orderId: string, productId: string, quantity: number, sortOrder = 0): OrderItem {
  return { id, orderId, productId, quantity, sortOrder };
}

function makeProduct(id: string, name: string, mouldId: string, shellPct = 40, fillMode: "percentage" | "grams" = "percentage"): Product {
  return {
    id,
    name,
    shellPercentage: shellPct,
    fillMode,
    defaultMouldId: mouldId,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeMould(id: string, name: string, cavities: number, cavityWeightG: number): Mould {
  return {
    id,
    name,
    numberOfCavities: cavities,
    cavityWeightG,
    quantityOwned: 1,
    type: "bonbon",
    createdAt: NOW,
    updatedAt: NOW,
  } as Mould;
}

function makeFilling(id: string, name: string, category: string, shelfLifeWeeks?: number): Filling {
  return {
    id,
    name,
    category,
    source: "",
    description: "",
    allergens: [],
    instructions: "",
    shelfLifeWeeks,
  };
}

function makeCategory(name: string, shelfStable: boolean): FillingCategory {
  return { id: name, name, shelfStable, createdAt: NOW, updatedAt: NOW };
}

describe("computeWeeklyFillingNeeds", () => {
  const mouldA = makeMould("m1", "Bonbon A", 24, 10); // 24 cavities × 10g
  const productA = makeProduct("p1", "Caramel bonbon", "m1", 40, "percentage");
  const productB = makeProduct("p2", "Ganache bonbon", "m1", 40, "percentage");

  const fillingCaramel = makeFilling("f1", "Salted caramel", "Caramels & Syrups (Sugar-Based)", 4);
  const fillingGanache = makeFilling("f2", "Dark ganache", "Ganaches (Emulsions)", 3);

  const productFillingsA: ProductFilling[] = [
    { id: "pf1", productId: "p1", fillingId: "f1", sortOrder: 0, fillPercentage: 100 },
  ];
  const productFillingsB: ProductFilling[] = [
    { id: "pf2", productId: "p2", fillingId: "f2", sortOrder: 0, fillPercentage: 100 },
  ];

  // Recipe base weights for scaling
  const fillingIngredients: FillingIngredient[] = [
    { id: "fi1", fillingId: "f1", ingredientId: "sugar", amount: 100, unit: "g", sortOrder: 0 },
    { id: "fi2", fillingId: "f1", ingredientId: "cream", amount: 200, unit: "g", sortOrder: 1 },
    { id: "fi3", fillingId: "f2", ingredientId: "cream", amount: 150, unit: "g", sortOrder: 0 },
    { id: "fi4", fillingId: "f2", ingredientId: "choc", amount: 300, unit: "g", sortOrder: 1 },
  ];

  const categories: FillingCategory[] = [
    makeCategory("Caramels & Syrups (Sugar-Based)", false),
    makeCategory("Ganaches (Emulsions)", false),
  ];

  const baseInput = {
    productFillings: [...productFillingsA, ...productFillingsB],
    fillingIngredients,
    fillings: [fillingCaramel, fillingGanache],
    fillingCategories: categories,
    moulds: [mouldA],
    fillingStock: [] as FillingStock[],
    fillingBufferPercent: 10,
    now: NOW,
  };

  it("aggregates filling needs across two orders of the same product", () => {
    const orders = [makeOrder("o1", 3), makeOrder("o2", 5)];
    const orderItems = [makeItem("i1", "o1", "p1", 24), makeItem("i2", "o2", "p1", 48)];
    const result = computeWeeklyFillingNeeds({
      ...baseInput,
      orders,
      orderItems,
      products: [productA, productB],
    });
    expect(result.needs).toHaveLength(1);
    const caramel = result.needs[0];
    expect(caramel.fillingId).toBe("f1");
    // Shared across 2 orders
    expect(caramel.shared).toBe(true);
    expect(caramel.usedBy).toHaveLength(2);
    // 24+48 pieces → 1+2 moulds → (10ml × 24) × 0.6 × 1.2 g/ml × (1+2) moulds = 518.4g
    // Rounded per-batch then summed by consolidate.
    expect(caramel.requiredG).toBeGreaterThan(500);
    expect(caramel.requiredG).toBeLessThan(550);
    // No stock subtracted; buffer 10% applied
    expect(caramel.toCookG).toBe(caramel.requiredG);
    expect(caramel.toCookBufferedG).toBe(Math.round(caramel.requiredG * 1.1));
  });

  it("subtracts existing non-frozen filling stock", () => {
    const orders = [makeOrder("o1", 3)];
    const orderItems = [makeItem("i1", "o1", "p1", 24)];
    const stock: FillingStock[] = [
      { id: "s1", fillingId: "f1", remainingG: 100, madeAt: new Date(NOW.getTime() - 1 * DAY).toISOString(), createdAt: NOW.getTime() - 1 * DAY },
    ];
    const result = computeWeeklyFillingNeeds({
      ...baseInput,
      orders,
      orderItems,
      products: [productA],
      fillingStock: stock,
    });
    const caramel = result.needs[0];
    expect(caramel.availableG).toBe(100);
    expect(caramel.toCookG).toBe(caramel.requiredG - 100);
  });

  it("ignores frozen stock for subtraction but reports it", () => {
    const orders = [makeOrder("o1", 3)];
    const orderItems = [makeItem("i1", "o1", "p1", 24)];
    const stock: FillingStock[] = [
      { id: "s1", fillingId: "f1", remainingG: 200, madeAt: NOW.toISOString(), createdAt: NOW.getTime(), frozen: true },
    ];
    const result = computeWeeklyFillingNeeds({
      ...baseInput,
      orders,
      orderItems,
      products: [productA],
      fillingStock: stock,
    });
    const caramel = result.needs[0];
    expect(caramel.availableG).toBe(0);
    expect(caramel.frozenG).toBe(200);
    expect(caramel.toCookG).toBe(caramel.requiredG);
  });

  it("excludes orders outside the window", () => {
    const orders = [makeOrder("o1", 3), makeOrder("o-far", 14)];
    const orderItems = [makeItem("i1", "o1", "p1", 24), makeItem("i2", "o-far", "p1", 96)];
    const result = computeWeeklyFillingNeeds({
      ...baseInput,
      orders,
      orderItems,
      products: [productA],
    });
    expect(result.ordersInWindow).toHaveLength(1);
    expect(result.ordersInWindow[0].id).toBe("o1");
    // Only o1 contributes — o-far is past the 7-day window
    expect(result.needs[0].usedBy).toHaveLength(1);
  });

  it("excludes cancelled + done orders", () => {
    const orders = [
      makeOrder("o1", 3, "pending"),
      makeOrder("o2", 4, "cancelled"),
      makeOrder("o3", 5, "done"),
    ];
    const orderItems = [
      makeItem("i1", "o1", "p1", 24),
      makeItem("i2", "o2", "p1", 24),
      makeItem("i3", "o3", "p1", 24),
    ];
    const result = computeWeeklyFillingNeeds({
      ...baseInput,
      orders,
      orderItems,
      products: [productA],
    });
    expect(result.ordersInWindow).toHaveLength(1);
    expect(result.ordersInWindow[0].id).toBe("o1");
  });

  it("flags products without a default mould as unresolved", () => {
    const noMould: Product = { ...productA, id: "p-nomould", defaultMouldId: undefined };
    const orders = [makeOrder("o1", 3)];
    const orderItems = [makeItem("i1", "o1", "p-nomould", 24)];
    const result = computeWeeklyFillingNeeds({
      ...baseInput,
      orders,
      orderItems,
      products: [noMould],
    });
    expect(result.needs).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].reason).toMatch(/default mould/i);
  });

  it("sorts needs by earliest deadline ascending", () => {
    const orders = [makeOrder("o1", 5), makeOrder("o2", 2)];
    const orderItems = [
      makeItem("i1", "o1", "p1", 24),
      makeItem("i2", "o2", "p2", 24),
    ];
    const result = computeWeeklyFillingNeeds({
      ...baseInput,
      orders,
      orderItems,
      products: [productA, productB],
    });
    expect(result.needs.map((n) => n.fillingName)).toEqual(["Dark ganache", "Salted caramel"]);
  });

  it("cookByDate lands before earliest deadline", () => {
    const orders = [makeOrder("o1", 5)];
    const orderItems = [makeItem("i1", "o1", "p2", 24)];
    const result = computeWeeklyFillingNeeds({
      ...baseInput,
      orders,
      orderItems,
      products: [productA, productB],
    });
    const need = result.needs[0];
    expect(need.cookByDate.getTime()).toBeLessThanOrEqual(need.earliestDeadline.getTime());
  });
});
