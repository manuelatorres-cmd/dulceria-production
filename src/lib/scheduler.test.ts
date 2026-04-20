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

  it("perBatch step's total active is the fixed activeMinutes regardless of mould count", () => {
    // 4 products × 1 mould each = 4 moulds. A per-mould step at 60min
    // would charge 240min total. The same step flagged perBatch should
    // charge a fixed 60min — cooking the filling once covers the wave.
    const moulds: Mould[] = [
      { id: "m", name: "M", cavityWeightG: 10, numberOfCavities: 20 },
    ];
    const products = ["A", "B", "C", "D"].map((l) => ({
      id: `p${l}`,
      name: `P ${l}`,
      productCategoryId: catId,
      defaultMouldId: "m",
      defaultBatchQty: 1,
    })) as unknown as Product[];
    const order: Order = {
      id: "obatch", channel: "b2b", customerName: "X",
      deadline: baseDeadline, priority: "normal", status: "pending",
    } as Order;
    const orderItems: OrderItem[] = products.map((p, i) => ({
      id: `oi${i}`, orderId: "obatch", productId: p.id!, quantity: 20, sortOrder: i,
    })) as OrderItem[];
    const steps = [
      mkStep({ name: "Cooking", productType: "Moulded", activeMinutes: 60, waitingMinutes: 0, sortOrder: 0 }),
    ];
    steps[0].perBatch = true;

    const result = buildSchedule(makeInput({
      orders: [order], orderItems, products, moulds,
      productionSteps: steps, categoryNameById,
    }));

    const totalDur = result.entries.reduce((s, e) => s + e.durationMinutes, 0);
    expect(totalDur).toBe(60);
    // Still emits one row per product so the wave's traceability stays.
    expect(result.entries.length).toBe(4);
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

  it("sequences steps within the same day — earlier steps end where later steps start", () => {
    // Two steps, both small enough to fit on the deadline day. Reverse
    // pack: step 2 (Cap) lands at end-of-day; step 1 (Shell) ends where
    // step 2 starts. Distinct startAt times.
    const moulds: Mould[] = [{ id: "m", name: "M", cavityWeightG: 10, numberOfCavities: 10 }];
    const products = [{
      id: "p1", name: "P", productCategoryId: catId,
      defaultMouldId: "m", defaultBatchQty: 1,
    }] as unknown as Product[];
    const order: Order = {
      id: "oseq", channel: "b2b", customerName: "X",
      deadline: baseDeadline, priority: "normal", status: "pending",
    } as Order;
    const orderItems: OrderItem[] = [{
      id: "oi", orderId: "oseq", productId: "p1", quantity: 10, sortOrder: 0,
    }] as OrderItem[];
    const steps = [
      mkStep({ name: "Shell", productType: "Moulded", activeMinutes: 30, waitingMinutes: 0, sortOrder: 0 }),
      mkStep({ name: "Cap",   productType: "Moulded", activeMinutes: 60, waitingMinutes: 0, sortOrder: 1 }),
    ];
    const result = buildSchedule(makeInput({
      orders: [order], orderItems, products, moulds,
      productionSteps: steps, categoryNameById,
    }));

    const shell = result.entries.find((e) => e.phase === "Shell")!;
    const cap = result.entries.find((e) => e.phase === "Cap")!;
    expect(shell.startAt.slice(0, 10)).toBe(cap.startAt.slice(0, 10));
    // Shell ends at Cap's start (within a tolerance of seconds).
    expect(new Date(shell.endAt).getTime()).toBe(new Date(cap.startAt).getTime());
    expect(shell.startAt).not.toBe(cap.startAt);
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
