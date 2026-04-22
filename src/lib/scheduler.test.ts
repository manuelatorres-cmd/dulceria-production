import { describe, it, expect } from "vitest";
import { buildSchedule, timeBandFor, type SchedulerInput } from "./scheduler";
import type {
  Order, OrderItem, Product, ProductionStep, Person, Mould, CapacityConfig,
  ProductionPlan, PlanProduct, OrderPlanLink,
} from "@/types";

// Scaffold with sensible defaults. Tests override only what they care
// about. Every person works every day so day-of-week doesn't leak into
// expectations.
function makeInput(overrides: Partial<SchedulerInput> = {}): SchedulerInput {
  const everyDay = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as Person["workingDays"];
  const people: Person[] = overrides.people ?? [
    { id: "u1", name: "Anna", defaultHoursPerDay: 8, workingDays: everyDay },
  ];
  const config: CapacityConfig = overrides.config ?? { capacityBufferPercent: 0 };
  return {
    plans: [],
    planProducts: [],
    orders: [],
    orderItems: [],
    orderPlanLinks: [],
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

function toIsoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function mkStep(
  partial: Pick<ProductionStep, "name" | "productType" | "activeMinutes" | "waitingMinutes" | "sortOrder"> & { perBatch?: boolean },
): ProductionStep {
  return { id: `step-${partial.name}`, ...partial };
}

// A convenience scenario: one batch (plan) with `products` planProducts,
// optionally linked to a parent order for the deadline comparison.
function makeBatchScenario(args: {
  planId?: string;
  products: Array<{ id: string; quantity: number; cavities?: number }>;
  steps: ProductionStep[];
  deadline?: string;
}): {
  plans: ProductionPlan[];
  planProducts: PlanProduct[];
  orders: Order[];
  orderItems: OrderItem[];
  orderPlanLinks: OrderPlanLink[];
  products: Product[];
  moulds: Mould[];
  productionSteps: ProductionStep[];
  categoryNameById: Map<string, string>;
} {
  const catId = "cat-moulded";
  const categoryNameById = new Map([[catId, "Moulded"]]);
  const mouldId = "m-default";
  const defaultCavities = args.products[0]?.cavities ?? 10;
  const moulds: Mould[] = [{
    id: mouldId, name: "M", cavityWeightG: 10, numberOfCavities: defaultCavities,
  }];
  const products: Product[] = args.products.map((p) => ({
    id: p.id, name: p.id, productCategoryId: catId,
    defaultMouldId: mouldId, defaultBatchQty: 1,
  })) as unknown as Product[];
  const planId = args.planId ?? "plan-1";
  const plans: ProductionPlan[] = [{
    id: planId, name: "Test batch", status: "draft",
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
  } as ProductionPlan];
  const planProducts: PlanProduct[] = args.products.map((p, i) => ({
    id: `pp-${p.id}`,
    planId,
    productId: p.id,
    mouldId,
    quantity: p.quantity,
    sortOrder: i,
  } as PlanProduct));

  const orders: Order[] = args.deadline ? [{
    id: "o1", channel: "b2b", customerName: "X",
    deadline: args.deadline, priority: "normal", status: "pending",
  } as Order] : [];
  const orderItems: OrderItem[] = args.deadline ? args.products.map((p, i) => ({
    id: `oi-${p.id}`,
    orderId: "o1",
    productId: p.id,
    quantity: p.quantity,
    sortOrder: i,
  } as OrderItem)) : [];
  const orderPlanLinks: OrderPlanLink[] = args.deadline ? args.products.map((p) => ({
    id: `lk-${p.id}`,
    orderItemId: `oi-${p.id}`,
    planId,
    allocatedQuantity: p.quantity,
  })) : [];

  return {
    plans,
    planProducts,
    orders,
    orderItems,
    orderPlanLinks,
    products,
    moulds,
    productionSteps: args.steps,
    categoryNameById,
  };
}

describe("batch-based scheduler", () => {
  const deadline = new Date("2026-05-15T18:00:00").toISOString();

  it("consolidates four products into one wave per step, fitting in a single working day", () => {
    // 4 products × 20 pieces / 20-cavity mould = 1 mould each → 4 moulds total.
    // 2 steps × 10min active per mould → 80min total. Fits in 480min day.
    const scenario = makeBatchScenario({
      products: ["A", "B", "C", "D"].map((id) => ({ id: `p${id}`, quantity: 1, cavities: 20 })),
      steps: [
        mkStep({ name: "Temper", productType: "Moulded", activeMinutes: 10, waitingMinutes: 0, sortOrder: 0 }),
        mkStep({ name: "Shell",  productType: "Moulded", activeMinutes: 10, waitingMinutes: 0, sortOrder: 1 }),
      ],
      deadline,
    });
    const result = buildSchedule(makeInput(scenario));

    const days = new Set(result.entries.map((e) => e.startAt.slice(0, 10)));
    expect(days.size).toBe(1);
    expect(result.entries.length).toBe(8); // 2 steps × 4 products
    const totalDur = result.entries.reduce((s, e) => s + e.durationMinutes, 0);
    expect(totalDur).toBe(80);
    // Every entry carries the planId.
    for (const e of result.entries) expect(e.planId).toBe("plan-1");
  });

  it("a long waiting window pushes the next step onto the next working day", () => {
    // 720min wait after Shell can't fit same-day → Cap next day.
    const scenario = makeBatchScenario({
      products: [{ id: "p1", quantity: 1, cavities: 10 }],
      steps: [
        mkStep({ name: "Shell", productType: "Moulded", activeMinutes: 10, waitingMinutes: 720, sortOrder: 0 }),
        mkStep({ name: "Cap",   productType: "Moulded", activeMinutes: 10, waitingMinutes: 0,   sortOrder: 1 }),
      ],
      deadline,
    });
    const result = buildSchedule(makeInput(scenario));
    const byStep = new Map(result.entries.map((e) => [e.phase, e.startAt.slice(0, 10)] as const));
    expect(byStep.get("Shell")).not.toBe(byStep.get("Cap"));
  });

  it("perBatch step's total active is flat, regardless of mould count", () => {
    const scenario = makeBatchScenario({
      products: ["A", "B", "C", "D"].map((id) => ({ id: `p${id}`, quantity: 1, cavities: 20 })),
      steps: [
        (() => {
          const s = mkStep({ name: "Cooking", productType: "Moulded", activeMinutes: 60, waitingMinutes: 0, sortOrder: 0 });
          s.perBatch = true;
          return s;
        })(),
      ],
      deadline,
    });
    const result = buildSchedule(makeInput(scenario));
    const totalDur = result.entries.reduce((s, e) => s + e.durationMinutes, 0);
    expect(totalDur).toBe(60);
    expect(result.entries.length).toBe(4);
  });

  it("sequences steps within the same day — earlier ends where later starts", () => {
    const scenario = makeBatchScenario({
      products: [{ id: "p1", quantity: 1, cavities: 10 }],
      steps: [
        mkStep({ name: "Shell", productType: "Moulded", activeMinutes: 30, waitingMinutes: 0, sortOrder: 0 }),
        mkStep({ name: "Cap",   productType: "Moulded", activeMinutes: 60, waitingMinutes: 0, sortOrder: 1 }),
      ],
      deadline,
    });
    const result = buildSchedule(makeInput(scenario));
    const shell = result.entries.find((e) => e.phase === "Shell")!;
    const cap = result.entries.find((e) => e.phase === "Cap")!;
    expect(shell.startAt.slice(0, 10)).toBe(cap.startAt.slice(0, 10));
    expect(new Date(shell.endAt).getTime()).toBe(new Date(cap.startAt).getTime());
    expect(shell.startAt).not.toBe(cap.startAt);
  });

  it("emits steps in ascending sortOrder — A earliest, C latest", () => {
    const scenario = makeBatchScenario({
      products: [{ id: "p1", quantity: 1, cavities: 10 }],
      steps: [
        mkStep({ name: "A", productType: "Moulded", activeMinutes: 20, waitingMinutes: 0, sortOrder: 0 }),
        mkStep({ name: "B", productType: "Moulded", activeMinutes: 20, waitingMinutes: 0, sortOrder: 1 }),
        mkStep({ name: "C", productType: "Moulded", activeMinutes: 20, waitingMinutes: 0, sortOrder: 2 }),
      ],
      deadline,
    });
    const result = buildSchedule(makeInput(scenario));
    const byPhase = Object.fromEntries(result.entries.map((e) => [e.phase, e]));
    expect(byPhase.A.startAt < byPhase.B.startAt).toBe(true);
    expect(byPhase.B.startAt < byPhase.C.startAt).toBe(true);
  });

  it("small steps never split across days regardless of long waits", () => {
    // The defensive no-split rule (bug-2 fix): a step whose total
    // active duration is ≤ daily capacity lands on exactly ONE day.
    // 5min steps with huge waits should roll to new days ONLY between
    // steps, never within a step.
    const scenario = makeBatchScenario({
      products: [{ id: "p1", quantity: 1, cavities: 10 }],
      steps: [
        mkStep({ name: "A", productType: "Moulded", activeMinutes: 5, waitingMinutes: 720, sortOrder: 0 }),
        mkStep({ name: "B", productType: "Moulded", activeMinutes: 5, waitingMinutes: 720, sortOrder: 1 }),
        mkStep({ name: "C", productType: "Moulded", activeMinutes: 5, waitingMinutes: 0,   sortOrder: 2 }),
      ],
      deadline,
    });
    const result = buildSchedule(makeInput(scenario));
    // Each phase shows up on exactly one day.
    const daysByPhase = new Map<string, Set<string>>();
    for (const e of result.entries) {
      const set = daysByPhase.get(e.phase) ?? new Set<string>();
      set.add(e.startAt.slice(0, 10));
      daysByPhase.set(e.phase, set);
    }
    for (const [phase, days] of daysByPhase) {
      expect(days.size, `phase ${phase} spans ${days.size} days`).toBe(1);
    }
  });

  it("last step stays on the current day when it fits remaining capacity", () => {
    // Short waits between steps absorb same-day; the final Pack step
    // should land on the same day as the prior step.
    const scenario = makeBatchScenario({
      products: [{ id: "p1", quantity: 1, cavities: 10 }],
      steps: [
        mkStep({ name: "Prep",   productType: "Moulded", activeMinutes: 30, waitingMinutes: 30, sortOrder: 0 }),
        mkStep({ name: "Middle", productType: "Moulded", activeMinutes: 30, waitingMinutes: 30, sortOrder: 1 }),
        mkStep({ name: "Pack",   productType: "Moulded", activeMinutes: 10, waitingMinutes: 0,  sortOrder: 2 }),
      ],
      deadline,
    });
    const result = buildSchedule(makeInput(scenario));
    const byPhase = Object.fromEntries(result.entries.map((e) => [e.phase, e]));
    expect(byPhase.Prep.startAt.slice(0, 10)).toBe(byPhase.Pack.startAt.slice(0, 10));
  });

  it("forward-fill: short wave lands on today when there's no deadline pressure", () => {
    const farDeadline = new Date();
    farDeadline.setMonth(farDeadline.getMonth() + 1);
    const scenario = makeBatchScenario({
      products: [{ id: "p1", quantity: 1, cavities: 10 }],
      steps: [
        mkStep({ name: "Temper", productType: "Moulded", activeMinutes: 20, waitingMinutes: 0, sortOrder: 0 }),
        mkStep({ name: "Shell",  productType: "Moulded", activeMinutes: 20, waitingMinutes: 0, sortOrder: 1 }),
      ],
      deadline: farDeadline.toISOString(),
    });
    const result = buildSchedule(makeInput(scenario));
    const days = new Set(result.entries.map((e) => e.startAt.slice(0, 10)));
    expect(days.size).toBe(1);
    expect([...days][0]).toBe(toIsoLocal(new Date()));
  });

  it("skips plans that have no planProducts", () => {
    const scenario = makeBatchScenario({
      products: [],
      steps: [],
    });
    const result = buildSchedule(makeInput(scenario));
    expect(result.entries).toHaveLength(0);
  });

  it("skips plans whose product has no category (warns)", () => {
    const planId = "plan-nocat";
    const plans: ProductionPlan[] = [{ id: planId, name: "Stray", status: "draft" } as ProductionPlan];
    const planProducts: PlanProduct[] = [{
      id: "pp-1", planId, productId: "p1", mouldId: "m", quantity: 1, sortOrder: 0,
    } as PlanProduct];
    const products: Product[] = [{
      id: "p1", name: "P", defaultMouldId: "m", defaultBatchQty: 1,
    } as unknown as Product];
    const moulds: Mould[] = [{ id: "m", name: "M", cavityWeightG: 10, numberOfCavities: 10 }];
    const result = buildSchedule(makeInput({
      plans, planProducts, products, moulds,
    }));
    expect(result.entries).toHaveLength(0);
    expect(result.unscheduledPlanIds).toContain(planId);
  });

  it("populates planId + planProductId + stepId on every emitted row", () => {
    const scenario = makeBatchScenario({
      products: [{ id: "p1", quantity: 1, cavities: 10 }],
      steps: [
        mkStep({ name: "Shell", productType: "Moulded", activeMinutes: 10, waitingMinutes: 0, sortOrder: 0 }),
      ],
      deadline,
    });
    const result = buildSchedule(makeInput(scenario));
    expect(result.entries.length).toBeGreaterThan(0);
    for (const e of result.entries) {
      expect(e.planId).toBe("plan-1");
      expect(e.planProductId).toBe("pp-p1");
      expect(e.stepId).toBe("step-Shell");
    }
  });

  it("batch exceeding one day's capacity splits across consecutive working days, step order preserved", () => {
    // Day cap = 8h × 60 = 480min. Two steps of 400min each → second must
    // roll to the next day (can't fit 800min in one day).
    const scenario = makeBatchScenario({
      products: [{ id: "p1", quantity: 1, cavities: 10 }],
      steps: [
        mkStep({ name: "A", productType: "Moulded", activeMinutes: 400, waitingMinutes: 0, sortOrder: 0 }),
        mkStep({ name: "B", productType: "Moulded", activeMinutes: 400, waitingMinutes: 0, sortOrder: 1 }),
      ],
      deadline,
    });
    const result = buildSchedule(makeInput(scenario));
    const byPhase = Object.fromEntries(result.entries.map((e) => [e.phase, e]));
    // Different days.
    expect(byPhase.A.startAt.slice(0, 10)).not.toBe(byPhase.B.startAt.slice(0, 10));
    // Step order preserved.
    expect(byPhase.A.startAt < byPhase.B.startAt).toBe(true);
  });

  it("deadline within buffer window marks batch unscheduled", () => {
    // Deadline today with a 2-day buffer leaves no room.
    const todayIso = new Date().toISOString();
    const scenario = makeBatchScenario({
      products: [{ id: "p1", quantity: 1, cavities: 10 }],
      steps: [
        mkStep({ name: "Shell", productType: "Moulded", activeMinutes: 10, waitingMinutes: 0, sortOrder: 0 }),
      ],
      deadline: todayIso,
    });
    const result = buildSchedule(makeInput({
      ...scenario,
      config: { capacityBufferPercent: 0, productionBufferDays: 2 },
    }));
    expect(result.unscheduledPlanIds).toContain("plan-1");
    expect(result.warnings.some((w) => /buffer|deadline/i.test(w))).toBe(true);
  });

  it("configurable productionBufferDays: with buffer=0 a same-day deadline still schedules", () => {
    // Deadline end-of-today, buffer 0 → latestDay = today. Short batch
    // fits and lands on today.
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 0, 0);
    const scenario = makeBatchScenario({
      products: [{ id: "p1", quantity: 1, cavities: 10 }],
      steps: [
        mkStep({ name: "Shell", productType: "Moulded", activeMinutes: 10, waitingMinutes: 0, sortOrder: 0 }),
      ],
      deadline: endOfToday.toISOString(),
    });
    const result = buildSchedule(makeInput({
      ...scenario,
      config: { capacityBufferPercent: 0, productionBufferDays: 0 },
    }));
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries[0].startAt.slice(0, 10)).toBe(toIsoLocal(new Date()));
  });

  it("soft same-step grouping: second batch with overlapping step type lands on the same day as the first", () => {
    // Two separate batches, same category. Each ~40min active; both
    // fit today. The scheduler should prefer placing batch-2 on the
    // same day as batch-1 (the one batch-1 landed on) for grouping.
    const farDeadline = new Date();
    farDeadline.setMonth(farDeadline.getMonth() + 1);

    const catId = "cat-moulded";
    const categoryNameById = new Map([[catId, "Moulded"]]);
    const mouldId = "m-default";
    const moulds: Mould[] = [{ id: mouldId, name: "M", cavityWeightG: 10, numberOfCavities: 10 }];
    const products: Product[] = ["p1", "p2"].map((id) => ({
      id, name: id, productCategoryId: catId,
      defaultMouldId: mouldId, defaultBatchQty: 1,
    })) as unknown as Product[];
    const plans: ProductionPlan[] = [
      { id: "plan-A", name: "A", status: "draft", createdAt: new Date("2024-01-01T00:00:00Z") },
      { id: "plan-B", name: "B", status: "draft", createdAt: new Date("2024-01-02T00:00:00Z") },
    ] as ProductionPlan[];
    const planProducts: PlanProduct[] = [
      { id: "pp-A", planId: "plan-A", productId: "p1", mouldId, quantity: 1, sortOrder: 0 } as PlanProduct,
      { id: "pp-B", planId: "plan-B", productId: "p2", mouldId, quantity: 1, sortOrder: 0 } as PlanProduct,
    ];
    const orders: Order[] = [
      { id: "oA", channel: "b2b", customerName: "X", deadline: farDeadline.toISOString(), priority: "normal", status: "pending" } as Order,
      { id: "oB", channel: "b2b", customerName: "Y", deadline: farDeadline.toISOString(), priority: "normal", status: "pending" } as Order,
    ];
    const orderItems: OrderItem[] = [
      { id: "oi-A", orderId: "oA", productId: "p1", quantity: 1, sortOrder: 0 } as OrderItem,
      { id: "oi-B", orderId: "oB", productId: "p2", quantity: 1, sortOrder: 0 } as OrderItem,
    ];
    const orderPlanLinks: OrderPlanLink[] = [
      { id: "lk-A", orderItemId: "oi-A", planId: "plan-A", allocatedQuantity: 1 },
      { id: "lk-B", orderItemId: "oi-B", planId: "plan-B", allocatedQuantity: 1 },
    ];
    const steps: ProductionStep[] = [
      mkStep({ name: "Shell", productType: "Moulded", activeMinutes: 20, waitingMinutes: 0, sortOrder: 0 }),
      mkStep({ name: "Cap",   productType: "Moulded", activeMinutes: 20, waitingMinutes: 0, sortOrder: 1 }),
    ];

    const result = buildSchedule(makeInput({
      plans, planProducts, orders, orderItems, orderPlanLinks, products, moulds,
      productionSteps: steps, categoryNameById,
    }));

    const daysA = new Set(result.entries.filter((e) => e.planId === "plan-A").map((e) => e.startAt.slice(0, 10)));
    const daysB = new Set(result.entries.filter((e) => e.planId === "plan-B").map((e) => e.startAt.slice(0, 10)));
    expect(daysA.size).toBe(1);
    expect(daysB.size).toBe(1);
    // Same-day grouping.
    expect([...daysA][0]).toBe([...daysB][0]);
  });
});

describe("timeBandFor", () => {
  const isoAt = (hour: number, minute: number): string => {
    const d = new Date();
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
  };

  it("before 11:00 → morning", () => {
    expect(timeBandFor(isoAt(8, 0))).toBe("morning");
    expect(timeBandFor(isoAt(10, 59))).toBe("morning");
  });
  it("11:00 to 13:59 → midday", () => {
    expect(timeBandFor(isoAt(11, 0))).toBe("midday");
    expect(timeBandFor(isoAt(13, 30))).toBe("midday");
  });
  it("14:00 onward → afternoon", () => {
    expect(timeBandFor(isoAt(14, 0))).toBe("afternoon");
    expect(timeBandFor(isoAt(17, 30))).toBe("afternoon");
  });
});
