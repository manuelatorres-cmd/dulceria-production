import { describe, it, expect } from "vitest";
import { buildSchedule, type SchedulerInput } from "./scheduler";
import type {
  Order, OrderItem, Product, ProductionStep, Person, Mould, CapacityConfig,
} from "@/types";

// Build an input scaffold with sensible defaults. Tests tweak only
// what they care about. Every person works every day so day-of-week
// doesn't leak into test expectations.
function makeInput(overrides: Partial<SchedulerInput> = {}): SchedulerInput {
  const everyDay = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as Person["workingDays"];
  const people: Person[] = overrides.people ?? [
    { id: "u1", name: "Anna", defaultHoursPerDay: 8, workingDays: everyDay },
  ];
  const config: CapacityConfig = overrides.config ?? { capacityBufferPercent: 0 };
  return {
    orders: [],
    orderItems: [],
    products: [],
    productionSteps: [],
    moulds: [],
    config,
    people,
    unavailability: [],
    blockedDays: [],
    categoryNameById: new Map(),
    ...overrides,
  };
}

function mkStep(
  partial: Pick<ProductionStep, "name" | "productType" | "activeMinutes" | "waitingMinutes" | "sortOrder">,
): ProductionStep {
  return { id: `step-${partial.name}`, ...partial };
}

describe("mould-wave scheduler", () => {
  const catId = "cat-moulded";
  const categoryNameById = new Map([[catId, "Moulded"]]);
  const baseDeadline = new Date("2026-05-15T18:00:00").toISOString();

  it("consolidates four products into one wave per step, fitting in a single working day", () => {
    // 4 products × 20 pieces each = 80 pieces total, 20-cavity mould
    // → 1 mould per product, 4 moulds in the wave.
    // 2 steps at 10 min active per mould, 0 waiting.
    // Total wave active time = 2 steps × 4 moulds × 10 min = 80 min.
    // With 8h (480 min) daily capacity, the whole order fits in ONE day.
    const moulds: Mould[] = [
      { id: "m", name: "20-cavity", cavityWeightG: 10, numberOfCavities: 20 },
    ];
    const products = ["A", "B", "C", "D"].map((l) => ({
      id: `p${l}`,
      name: `Praline ${l}`,
      productCategoryId: catId,
      defaultMouldId: "m",
      defaultBatchQty: 1,
    })) as unknown as Product[];
    const order: Order = {
      id: "o1", channel: "b2b", customerName: "Test",
      deadline: baseDeadline, priority: "normal", status: "pending",
    } as Order;
    const orderItems: OrderItem[] = products.map((p, i) => ({
      id: `oi${i}`, orderId: "o1", productId: p.id!, quantity: 20, sortOrder: i,
    })) as OrderItem[];
    const steps = [
      mkStep({ name: "Temper", productType: "Moulded", activeMinutes: 10, waitingMinutes: 0, sortOrder: 0 }),
      mkStep({ name: "Shell",  productType: "Moulded", activeMinutes: 10, waitingMinutes: 0, sortOrder: 1 }),
    ];
    const result = buildSchedule(makeInput({
      orders: [order], orderItems, products, moulds,
      productionSteps: steps, categoryNameById,
    }));

    const days = new Set(result.entries.map((e) => e.startAt.slice(0, 10)));
    expect(days.size).toBe(1);
    // Sanity: we emit one row per (step × product) — 2 steps × 4 products.
    expect(result.entries.length).toBe(8);
    // Sum of durations = total active minutes consumed.
    const totalDur = result.entries.reduce((s, e) => s + e.durationMinutes, 0);
    expect(totalDur).toBe(80);
  });

  it("long waiting window forces the preceding step onto an earlier day", () => {
    // Step 1: short active, LONG wait (overnight) → step 2 on deadline day,
    // step 1 must land on the day before.
    const moulds: Mould[] = [{ id: "m", name: "M", cavityWeightG: 10, numberOfCavities: 10 }];
    const products: Product[] = [{
      id: "p1", name: "P", productCategoryId: catId,
      defaultMouldId: "m", defaultBatchQty: 1,
    }] as unknown as Product[];
    const order: Order = {
      id: "o2", channel: "b2b", customerName: "X",
      deadline: baseDeadline, priority: "normal", status: "pending",
    } as Order;
    const orderItems: OrderItem[] = [{
      id: "oi", orderId: "o2", productId: "p1", quantity: 10, sortOrder: 0,
    }] as OrderItem[];
    const steps = [
      mkStep({ name: "Shell", productType: "Moulded", activeMinutes: 10, waitingMinutes: 720, sortOrder: 0 }),
      mkStep({ name: "Cap",   productType: "Moulded", activeMinutes: 10, waitingMinutes: 0,   sortOrder: 1 }),
    ];
    const result = buildSchedule(makeInput({
      orders: [order], orderItems, products, moulds,
      productionSteps: steps, categoryNameById,
    }));

    const byStep = new Map(result.entries.map((e) => [e.phase, e.startAt.slice(0, 10)] as const));
    expect(byStep.get("Shell")).toBeDefined();
    expect(byStep.get("Cap")).toBeDefined();
    expect(byStep.get("Shell")).not.toBe(byStep.get("Cap"));
  });

  it("borrow lines skip the wave entirely", () => {
    const moulds: Mould[] = [{ id: "m", name: "M", cavityWeightG: 10, numberOfCavities: 10 }];
    const products: Product[] = [{
      id: "p1", name: "P", productCategoryId: catId,
      defaultMouldId: "m", defaultBatchQty: 1,
    }] as unknown as Product[];
    const order: Order = {
      id: "o3", channel: "b2b", customerName: "X",
      deadline: baseDeadline, priority: "normal", status: "pending",
    } as Order;
    const orderItems: OrderItem[] = [{
      id: "oi", orderId: "o3", productId: "p1", quantity: 10, sortOrder: 0,
      fulfilmentMode: "borrow",
    }] as OrderItem[];
    const steps = [
      mkStep({ name: "Shell", productType: "Moulded", activeMinutes: 10, waitingMinutes: 0, sortOrder: 0 }),
    ];
    const result = buildSchedule(makeInput({
      orders: [order], orderItems, products, moulds,
      productionSteps: steps, categoryNameById,
    }));
    expect(result.entries).toHaveLength(0);
  });

  it("spills a step across days when its active minutes exceed daily capacity", () => {
    // Wave needs 600 min active for step 1. Capacity 480 min/day (8h × 1 person).
    // Should split across two days — 480 on day N, 120 on day N-1.
    const moulds: Mould[] = [{ id: "m", name: "M", cavityWeightG: 10, numberOfCavities: 5 }];
    const products: Product[] = [{
      id: "p1", name: "P", productCategoryId: catId,
      defaultMouldId: "m", defaultBatchQty: 1,
    }] as unknown as Product[];
    const order: Order = {
      id: "o4", channel: "b2b", customerName: "X",
      deadline: baseDeadline, priority: "normal", status: "pending",
    } as Order;
    // 60 moulds (300 pieces / 5 cavities). 10 min per mould × 60 = 600 min.
    const orderItems: OrderItem[] = [{
      id: "oi", orderId: "o4", productId: "p1", quantity: 300, sortOrder: 0,
    }] as OrderItem[];
    const steps = [
      mkStep({ name: "Temper", productType: "Moulded", activeMinutes: 10, waitingMinutes: 0, sortOrder: 0 }),
    ];
    const result = buildSchedule(makeInput({
      orders: [order], orderItems, products, moulds,
      productionSteps: steps, categoryNameById,
    }));

    const days = new Set(result.entries.map((e) => e.startAt.slice(0, 10)));
    expect(days.size).toBe(2);
    const totalDur = result.entries.reduce((s, e) => s + e.durationMinutes, 0);
    expect(totalDur).toBe(600);
  });
});
