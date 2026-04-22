/**
 * Tests for the daily-production scheduler.
 *
 * These cover the scheduler in isolation — pure function, no DB. The
 * hooks layer maps the proposed days/lineItems to real productionDays
 * / productionDayLineItems rows at Regenerate time.
 *
 * Scenarios covered:
 *   1. Single-batch single-day forward-fill (fits).
 *   2. Single-batch multi-day spill (doesn't fit one day).
 *   3. Reverse-schedule for deadlines beyond the merging window.
 *   4. Forward-fill for deadlines inside the merging window.
 *   5. Mould occupancy across days between batches.
 *   6. Earliest-deadline-first ordering with tiebreak.
 *   7. Buffer days respected (no placement past deadline − buffer).
 *   8. Unscheduled on a step larger than any day.
 */

import { describe, it, expect } from "vitest";
import { buildDailySchedule, timeBandFor, type DailyScheduleInput } from "./scheduler";
import type {
  Order, OrderItem, Product, ProductionStep, Person, Mould, CapacityConfig,
  ProductionPlan, PlanProduct, OrderPlanLink,
} from "@/types";

// ── Scaffolding ─────────────────────────────────────────────────────

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysFromToday(n: number): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

function makeInput(overrides: Partial<DailyScheduleInput> = {}): DailyScheduleInput {
  const everyDay = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"] as Person["workingDays"];
  const people: Person[] = overrides.people ?? [
    { id: "u1", name: "Anna", defaultHoursPerDay: 8, workingDays: everyDay },
  ];
  const config: CapacityConfig = overrides.config ?? {
    capacityBufferPercent: 0,
    productionBufferDays: 2,
    mergingWindowWeeks: 2,
  };
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
    planStepStatus: [],
    ...overrides,
  };
}

function mkStep(
  name: string,
  productType: string,
  sortOrder: number,
  activeMinutes: number,
): ProductionStep {
  return {
    id: `step-${productType}-${name}`,
    productType, name, sortOrder,
    activeMinutes, waitingMinutes: 0,
  };
}

interface BatchArgs {
  planId: string;
  productId: string;
  categoryId: string;
  categoryName: string;
  mouldId: string;
  mouldCavities: number;
  quantity: number;
  deadline: Date;
  createdAt?: Date;
  steps: ProductionStep[];
  planStatus?: "draft" | "active";
}

function makeBatch(args: BatchArgs): {
  plan: ProductionPlan;
  planProduct: PlanProduct;
  product: Product;
  mould: Mould;
  order: Order;
  orderItem: OrderItem;
  link: OrderPlanLink;
} {
  return {
    plan: {
      id: args.planId, name: args.planId, status: args.planStatus ?? "draft",
      createdAt: args.createdAt ?? new Date("2024-01-01T00:00:00Z"),
      updatedAt: args.createdAt ?? new Date("2024-01-01T00:00:00Z"),
    },
    planProduct: {
      id: `pp-${args.planId}`, planId: args.planId, productId: args.productId,
      mouldId: args.mouldId, quantity: args.quantity, sortOrder: 0,
    } as unknown as PlanProduct,
    product: {
      id: args.productId, name: args.productId, productCategoryId: args.categoryId,
      defaultMouldId: args.mouldId, defaultBatchQty: 1,
    } as unknown as Product,
    mould: {
      id: args.mouldId, name: args.mouldId, cavityWeightG: 10,
      numberOfCavities: args.mouldCavities,
    } as unknown as Mould,
    order: {
      id: `o-${args.planId}`, channel: "b2b", status: "pending", priority: "normal",
      deadline: args.deadline.toISOString(), createdAt: new Date(), updatedAt: new Date(),
    } as unknown as Order,
    orderItem: {
      id: `oi-${args.planId}`, orderId: `o-${args.planId}`, productId: args.productId,
      quantity: args.quantity * args.mouldCavities, sortOrder: 0, fulfilmentMode: "produce",
    } as unknown as OrderItem,
    link: {
      id: `l-${args.planId}`, orderItemId: `oi-${args.planId}`, planId: args.planId,
      allocatedQuantity: args.quantity * args.mouldCavities,
    },
  };
}

function assemble(batches: ReturnType<typeof makeBatch>[], extraSteps: ProductionStep[] = []): Partial<DailyScheduleInput> {
  const categoryNameById = new Map<string, string>();
  for (const b of batches) {
    const catId = b.product.productCategoryId!;
    categoryNameById.set(catId, catId.replace(/^cat-/, ""));
  }
  return {
    plans: batches.map((b) => b.plan),
    planProducts: batches.map((b) => b.planProduct),
    products: [...new Map(batches.map((b) => [b.product.id!, b.product])).values()],
    moulds:   [...new Map(batches.map((b) => [b.mould.id!, b.mould])).values()],
    orders:   batches.map((b) => b.order),
    orderItems: batches.map((b) => b.orderItem),
    orderPlanLinks: batches.map((b) => b.link),
    productionSteps: extraSteps,
    categoryNameById,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("buildDailySchedule — single batch, forward-fill", () => {
  it("packs a small batch into a single day", () => {
    const steps = [
      mkStep("Polishing", "Moulded", 1, 30),
      mkStep("Painting",  "Moulded", 2, 30),
      mkStep("Shelling",  "Moulded", 3, 30),
    ];
    const batch = makeBatch({
      planId: "plan-1", productId: "prod-1",
      categoryId: "cat-Moulded", categoryName: "Moulded",
      mouldId: "m-1", mouldCavities: 10, quantity: 1,
      deadline: daysFromToday(5), steps,
    });
    const input = makeInput({
      ...assemble([batch], steps),
      productionSteps: steps,
    } as Partial<DailyScheduleInput>);

    const out = buildDailySchedule(input);
    expect(out.unscheduledPlanIds).toEqual([]);
    expect(out.days.length).toBe(1);
    expect(out.lineItems.length).toBe(1);
    const li = out.lineItems[0];
    expect(li.planId).toBe("plan-1");
    expect(li.stepIds).toEqual(steps.map((s) => s.id));
    expect(li.plannedMinutes).toBe(90);
  });

  it("spills to a second day when total minutes exceed one-day capacity", () => {
    // 8h capacity = 480 min. Three 200-min steps = 600 total → must spill.
    const steps = [
      mkStep("Polishing", "Moulded", 1, 200),
      mkStep("Painting",  "Moulded", 2, 200),
      mkStep("Shelling",  "Moulded", 3, 200),
    ];
    const batch = makeBatch({
      planId: "plan-1", productId: "prod-1",
      categoryId: "cat-Moulded", categoryName: "Moulded",
      mouldId: "m-1", mouldCavities: 1, quantity: 1,
      deadline: daysFromToday(7), steps,
    });
    const input = makeInput({
      ...assemble([batch], steps),
      productionSteps: steps,
    } as Partial<DailyScheduleInput>);

    const out = buildDailySchedule(input);
    expect(out.unscheduledPlanIds).toEqual([]);
    expect(out.days.length).toBeGreaterThan(1);
    const total = out.lineItems.reduce((s, li) => s + li.plannedMinutes, 0);
    expect(total).toBe(600);
    // Step order preserved across days: first day starts with Polishing.
    const firstDayItem = out.lineItems.find((li) => li.dateRef === out.days[0].date);
    expect(firstDayItem?.stepIds[0]).toBe("step-Moulded-Polishing");
    // Last day ends with Shelling.
    const lastDay = out.days[out.days.length - 1].date;
    const lastItem = out.lineItems.find((li) => li.dateRef === lastDay);
    expect(lastItem?.stepIds[lastItem.stepIds.length - 1]).toBe("step-Moulded-Shelling");
  });
});

describe("buildDailySchedule — reverse-schedule beyond merging window", () => {
  it("places work near the deadline when deadline is outside the window", () => {
    // Merging window 2 weeks (14 days). Deadline 30 days out → reverse.
    const steps = [
      mkStep("Polishing", "Moulded", 1, 30),
      mkStep("Painting",  "Moulded", 2, 30),
    ];
    const batch = makeBatch({
      planId: "plan-1", productId: "prod-1",
      categoryId: "cat-Moulded", categoryName: "Moulded",
      mouldId: "m-1", mouldCavities: 10, quantity: 1,
      deadline: daysFromToday(30), steps,
    });
    const input = makeInput({
      ...assemble([batch], steps),
      productionSteps: steps,
    } as Partial<DailyScheduleInput>);

    const out = buildDailySchedule(input);
    expect(out.unscheduledPlanIds).toEqual([]);
    expect(out.days.length).toBe(1);
    const scheduledDate = out.days[0].date;
    const today = toIso(daysFromToday(0));
    // Reverse-schedule should push the work well past today.
    const diff = (new Date(scheduledDate).getTime() - new Date(today).getTime()) / 86_400_000;
    expect(diff).toBeGreaterThan(14);
    // And land on or before deadline − buffer (28 days from today).
    const latest = toIso(daysFromToday(28));
    expect(scheduledDate <= latest).toBe(true);
  });

  it("uses forward-fill when deadline is inside the window", () => {
    const steps = [
      mkStep("Polishing", "Moulded", 1, 30),
    ];
    const batch = makeBatch({
      planId: "plan-1", productId: "prod-1",
      categoryId: "cat-Moulded", categoryName: "Moulded",
      mouldId: "m-1", mouldCavities: 10, quantity: 1,
      deadline: daysFromToday(5), steps,
    });
    const input = makeInput({
      ...assemble([batch], steps),
      productionSteps: steps,
    } as Partial<DailyScheduleInput>);

    const out = buildDailySchedule(input);
    expect(out.unscheduledPlanIds).toEqual([]);
    // Forward-fill lands on today (or the first working day from today).
    expect(out.days[0].date).toBe(toIso(daysFromToday(0)));
  });
});

describe("buildDailySchedule — mould occupancy", () => {
  it("prevents two batches from sharing the same mould on overlapping days", () => {
    // Both batches need the same mould and span ≥ 2 days. The second
    // batch (earlier deadline? no — same deadline, same created) must
    // land AFTER the first batch's span ends.
    const steps = [
      mkStep("Polishing",  "Moulded", 1, 250),
      mkStep("Unmoulding", "Moulded", 2, 250),
    ];
    const batch1 = makeBatch({
      planId: "plan-A", productId: "prod-1",
      categoryId: "cat-Moulded", categoryName: "Moulded",
      mouldId: "m-shared", mouldCavities: 1, quantity: 1,
      deadline: daysFromToday(10),
      createdAt: new Date("2024-01-01T00:00:00Z"),
      steps,
    });
    const batch2 = makeBatch({
      planId: "plan-B", productId: "prod-2",
      categoryId: "cat-Moulded", categoryName: "Moulded",
      mouldId: "m-shared", mouldCavities: 1, quantity: 1,
      deadline: daysFromToday(10),
      createdAt: new Date("2024-01-02T00:00:00Z"),
      steps,
    });
    const input = makeInput({
      ...assemble([batch1, batch2], steps),
      productionSteps: steps,
    } as Partial<DailyScheduleInput>);

    const out = buildDailySchedule(input);
    expect(out.unscheduledPlanIds).toEqual([]);

    const daysA = out.lineItems.filter((li) => li.planId === "plan-A").map((li) => li.dateRef);
    const daysB = out.lineItems.filter((li) => li.planId === "plan-B").map((li) => li.dateRef);

    // No date should appear in both.
    const overlap = daysA.filter((d) => daysB.includes(d));
    expect(overlap).toEqual([]);
  });

  it("allows different moulds to run on the same day", () => {
    const steps = [mkStep("Polishing", "Moulded", 1, 60)];
    const batch1 = makeBatch({
      planId: "plan-A", productId: "prod-1",
      categoryId: "cat-Moulded", categoryName: "Moulded",
      mouldId: "m-alpha", mouldCavities: 1, quantity: 1,
      deadline: daysFromToday(5),
      createdAt: new Date("2024-01-01T00:00:00Z"),
      steps,
    });
    const batch2 = makeBatch({
      planId: "plan-B", productId: "prod-2",
      categoryId: "cat-Moulded", categoryName: "Moulded",
      mouldId: "m-beta", mouldCavities: 1, quantity: 1,
      deadline: daysFromToday(5),
      createdAt: new Date("2024-01-02T00:00:00Z"),
      steps,
    });
    const input = makeInput({
      ...assemble([batch1, batch2], steps),
      productionSteps: steps,
    } as Partial<DailyScheduleInput>);

    const out = buildDailySchedule(input);
    // Both batches share today (different moulds).
    const today = toIso(daysFromToday(0));
    expect(out.lineItems.filter((li) => li.dateRef === today).length).toBe(2);
  });
});

describe("buildDailySchedule — batch ordering", () => {
  it("places the earliest-deadline batch first", () => {
    const steps = [mkStep("Polishing", "Moulded", 1, 300)];
    const batchFar = makeBatch({
      planId: "plan-FAR", productId: "prod-1",
      categoryId: "cat-Moulded", categoryName: "Moulded",
      mouldId: "m-1", mouldCavities: 1, quantity: 1,
      deadline: daysFromToday(10),
      createdAt: new Date("2024-01-01T00:00:00Z"),
      steps,
    });
    const batchNear = makeBatch({
      planId: "plan-NEAR", productId: "prod-2",
      categoryId: "cat-Moulded", categoryName: "Moulded",
      mouldId: "m-1", mouldCavities: 1, quantity: 1,
      deadline: daysFromToday(5),
      createdAt: new Date("2024-01-02T00:00:00Z"),
      steps,
    });
    const input = makeInput({
      ...assemble([batchFar, batchNear], steps),
      productionSteps: steps,
    } as Partial<DailyScheduleInput>);

    const out = buildDailySchedule(input);
    expect(out.unscheduledPlanIds).toEqual([]);
    const earliestNearDate = out.lineItems
      .filter((li) => li.planId === "plan-NEAR")
      .map((li) => li.dateRef).sort()[0];
    const earliestFarDate = out.lineItems
      .filter((li) => li.planId === "plan-FAR")
      .map((li) => li.dateRef).sort()[0];
    // Near batch gets placed before the far batch (same mould → no
    // overlap, so near gets today, far gets day-2+).
    expect(earliestNearDate < earliestFarDate).toBe(true);
  });
});

describe("buildDailySchedule — unscheduleable cases", () => {
  it("flags a batch whose single step exceeds any day's capacity", () => {
    const steps = [mkStep("Polishing", "Moulded", 1, 10_000)];
    const batch = makeBatch({
      planId: "plan-BIG", productId: "prod-1",
      categoryId: "cat-Moulded", categoryName: "Moulded",
      mouldId: "m-1", mouldCavities: 1, quantity: 1,
      deadline: daysFromToday(5), steps,
    });
    const input = makeInput({
      ...assemble([batch], steps),
      productionSteps: steps,
    } as Partial<DailyScheduleInput>);

    const out = buildDailySchedule(input);
    expect(out.unscheduledPlanIds).toContain("plan-BIG");
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it("skips active / done plans", () => {
    const steps = [mkStep("Polishing", "Moulded", 1, 30)];
    const activeBatch = makeBatch({
      planId: "plan-act", productId: "prod-1",
      categoryId: "cat-Moulded", categoryName: "Moulded",
      mouldId: "m-1", mouldCavities: 1, quantity: 1,
      deadline: daysFromToday(5), steps,
      planStatus: "active",
    });
    const input = makeInput({
      ...assemble([activeBatch], steps),
      productionSteps: steps,
    } as Partial<DailyScheduleInput>);

    const out = buildDailySchedule(input);
    expect(out.days.length).toBe(0);
    expect(out.lineItems.length).toBe(0);
    expect(out.unscheduledPlanIds).toEqual([]);
  });
});

describe("timeBandFor", () => {
  it("categorises local-hour times into bands", () => {
    expect(timeBandFor(new Date("2025-06-01T09:00:00"))).toBe("morning");
    expect(timeBandFor(new Date("2025-06-01T12:00:00"))).toBe("midday");
    expect(timeBandFor(new Date("2025-06-01T17:00:00"))).toBe("afternoon");
  });
});
