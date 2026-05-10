/**
 * Hour-by-hour breakdown for the day-detail drawer (phase 5).
 *
 * The DB stores plannedMinutes per (planId, day) but no per-step start
 * times — the scheduler treats each day as a fungible bucket. This
 * helper synthesises a sequential timeline by walking the day's line
 * items in plan order, then steps in sortOrder, summing durations from
 * a workshop start time.
 *
 * Workdays start at 09:00 by default. Caller can override when
 * capacityConfig adds an explicit workdayStart.
 */

import type { PlanProduct, ProductionDayLineItem, ProductionPlan, ProductionStep, Product } from "@/types";

export interface HourlyEntry {
  /** "09:00" — start time for this step. */
  startTime: string;
  /** Active minutes — passive steps render their waitingMinutes instead. */
  durationMinutes: number;
  step: ProductionStep | null;
  stepName: string;
  productName: string;
  planId: string;
  planName: string;
  isLocked: boolean;
  isPassive: boolean;
}

export interface HourlyBreakdownInput {
  date: string; // ISO yyyy-mm-dd (informational; entries are in start-of-day time)
  lineItems: ProductionDayLineItem[];
  plans: ProductionPlan[];
  planProducts: PlanProduct[];
  steps: ProductionStep[];
  products: Product[];
  /** "HH:MM" workshop start time. Defaults to "09:00". */
  workdayStart?: string;
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function formatHHMM(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function computeHourlyBreakdown(input: HourlyBreakdownInput): HourlyEntry[] {
  const { lineItems, plans, planProducts, steps, products } = input;
  const planById = new Map(plans.map((p) => [p.id!, p]));
  const stepById = new Map(steps.map((s) => [s.id!, s]));
  const productById = new Map(products.map((p) => [p.id!, p]));
  const ppByPlan = new Map<string, PlanProduct>();
  for (const pp of planProducts) {
    if (!ppByPlan.has(pp.planId)) ppByPlan.set(pp.planId, pp);
  }

  // Order: line items by plan name, then by sortOrder; steps by sortOrder.
  const orderedItems = lineItems
    .slice()
    .sort((a, b) => {
      const ap = planById.get(a.planId);
      const bp = planById.get(b.planId);
      const an = ap?.name ?? "";
      const bn = bp?.name ?? "";
      if (an !== bn) return an.localeCompare(bn);
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    });

  const out: HourlyEntry[] = [];
  let cursor = parseHHMM(input.workdayStart ?? "09:00");

  for (const li of orderedItems) {
    const plan = planById.get(li.planId);
    if (!plan) continue;
    if (plan.status === "done" || plan.status === "cancelled") continue;
    const pp = ppByPlan.get(li.planId);
    const product = pp ? productById.get(pp.productId) : undefined;
    const orderedStepIds = li.stepIds
      .slice()
      .sort((a, b) => (stepById.get(a)?.sortOrder ?? 0) - (stepById.get(b)?.sortOrder ?? 0));
    for (const stepId of orderedStepIds) {
      const step = stepById.get(stepId) ?? null;
      const passive =
        !!step && step.activeMinutes <= 0 && (step.waitingMinutes ?? 0) > 0;
      const duration = passive ? (step?.waitingMinutes ?? 0) : (step?.activeMinutes ?? 0);
      out.push({
        startTime: formatHHMM(cursor),
        durationMinutes: duration,
        step,
        stepName: step?.name ?? "Step",
        productName: product?.name ?? "—",
        planId: li.planId,
        planName: plan.name ?? "Batch",
        isLocked: !!plan.pinnedDate,
        isPassive: passive,
      });
      // Passive steps don't advance cursor — they happen overnight.
      if (!passive) cursor += duration;
    }
  }

  return out;
}
