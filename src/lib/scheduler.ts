/**
 * Batch-based forward-fill scheduler.
 *
 * Scheduling unit: a productionPlan (batch). Each batch has one or
 * more planProducts; products in the same category share a step list
 * and go through the workflow as one wave. Cross-category batches run
 * their waves sequentially on the same day-capacity budget.
 *
 * Timing model:
 *   - Regular steps:        totalActive = Σ activeMinPerMould × planProduct.quantity
 *   - Fixed-total steps:    totalActive = step.activeMinutes (flat, not scaled).
 *   - Waiting time:         flat per batch, never scaled by moulds.
 *
 * Day-overflow rule (bug 2 defensive check):
 *   A step whose totalActive ≤ the day's capacity must NEVER split
 *   across days. If it doesn't fit on the current day, the whole step
 *   rolls to the next working day. Only steps larger than a single
 *   day's capacity span — genuinely rare.
 *
 * Waits are the only thing that force a day break between steps.
 * A waiting time that would extend past end-of-day pushes the NEXT
 * step's active work onto the next working day; otherwise the wait is
 * absorbed same-day and the next step picks up right after.
 *
 * Scheduling order:
 *   Batches are processed earliest-deadline-first, where deadline is
 *   the minimum `orders.deadline` among orderItems with
 *   `linkedBatchId = plan.id`. Unlinked batches run after linked ones
 *   (their lack of a customer-deadline makes them de-facto low
 *   priority). Within a batch, waves are iterated in category-name
 *   order (stable, deterministic).
 *
 * Output rows (ProductionScheduleEntry) carry:
 *   - planId, planProductId         (for the Production link)
 *   - orderId                       (from the plan's sourceOrderId if any)
 *   - stepId, phase                 (which step)
 *   - startAt / endAt, durationMinutes
 *
 * Defensive final sort: (planId, stepSortOrder, startAt) — guarantees
 * visual display order matches production sequence even if stored data
 * was reshuffled or came from a prior algorithm.
 */

import type {
  Order, OrderItem, Product, ProductionStep, Person, PersonUnavailability,
  EventCalendarEntry, CapacityConfig, ProductionScheduleEntry, Mould,
  ProductionPlan, PlanProduct,
} from "@/types";
import { effectiveDailyCapacityMinutes } from "@/lib/capacity";

export interface SchedulerInput {
  /** Active production batches. Completed ones are skipped. */
  plans: ProductionPlan[];
  planProducts: PlanProduct[];
  products: Product[];
  productionSteps: ProductionStep[];
  moulds: Mould[];
  /** Used only to compute each batch's effective deadline — the
   *  earliest `orderItems.linkedBatchId = plan.id` deadline. */
  orders: Order[];
  orderItems: OrderItem[];
  config: CapacityConfig | null;
  people: Person[];
  unavailability: PersonUnavailability[];
  blockedDays: EventCalendarEntry[];
  /** productCategoryId → category name (productType key on steps). */
  categoryNameById: Map<string, string>;
}

export interface DailyCapacityRow {
  date: string;
  usedMinutes: number;
  availableMinutes: number;
  utilisationPercent: number;
  level: "ok" | "warn" | "critical" | "over";
  scheduleCount: number;
}

export interface SchedulerResult {
  entries: Omit<ProductionScheduleEntry, "id" | "createdAt" | "updatedAt">[];
  dailySummary: DailyCapacityRow[];
  warnings: string[];
  /** Batches that couldn't be fully scheduled. */
  unscheduledPlanIds: string[];
}

const MAX_WORKING_DAY_SEARCH = 365;

export function buildSchedule(input: SchedulerInput): SchedulerResult {
  const {
    plans, planProducts, products, productionSteps, moulds,
    orders, orderItems,
    config, people, unavailability, blockedDays, categoryNameById,
  } = input;

  const entries: SchedulerResult["entries"] = [];
  const warnings: string[] = [];
  const unscheduled = new Set<string>();

  const productMap = new Map<string, Product>(products.map((p) => [p.id!, p]));
  const mouldMap = new Map<string, Mould>(moulds.map((m) => [m.id!, m]));
  const stepsByType = groupBy(productionSteps, (s) => s.productType);
  const stepSortById = new Map(productionSteps.map((s) => [s.id!, s.sortOrder ?? 0]));
  const planProductsByPlan = groupBy(planProducts, (pp) => pp.planId);

  // Per-batch effective deadline: the earliest deadline of any order
  // line linked into this batch. Unlinked batches get Infinity so they
  // sort last (no customer pressure).
  const planDeadline = new Map<string, number>();
  const planOrderId = new Map<string, string>();
  const planOrderRef = new Map<string, string>();
  const orderById = new Map(orders.map((o) => [o.id!, o]));
  for (const oi of orderItems) {
    const batchId = oi.linkedBatchId;
    if (!batchId) continue;
    const order = orderById.get(oi.orderId);
    if (!order) continue;
    const t = new Date(order.deadline).getTime();
    const cur = planDeadline.get(batchId);
    if (cur === undefined || t < cur) {
      planDeadline.set(batchId, t);
      planOrderId.set(batchId, order.id!);
      planOrderRef.set(
        batchId,
        order.customerName || order.eventName || order.sourceRef || "",
      );
    }
  }

  const usedByDate = new Map<string, number>();
  const capacityByDate = new Map<string, number>();
  function capFor(d: Date): number {
    const key = isoDate(d);
    const cached = capacityByDate.get(key);
    if (cached !== undefined) return cached;
    const cap = effectiveDailyCapacityMinutes(d, config, people, unavailability, blockedDays);
    capacityByDate.set(key, cap);
    return cap;
  }

  const today = dateOnly(new Date());

  // Sort batches: earliest linked-deadline first, unlinked last.
  // Stable secondary order by createdAt.
  const schedulable = plans.filter((p) => p.status !== "done");
  const sorted = [...schedulable].sort((a, b) => {
    const da = planDeadline.get(a.id!) ?? Number.POSITIVE_INFINITY;
    const db = planDeadline.get(b.id!) ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ca - cb;
  });

  for (const plan of sorted) {
    const pps = planProductsByPlan.get(plan.id!) ?? [];
    if (pps.length === 0) continue;

    // Category-grouped waves. Products that reference a product with
    // no category (or unknown productId) are dropped with a warning.
    const wavesByType = new Map<string, Array<PlanProduct & { product: Product }>>();
    for (const pp of pps) {
      const product = productMap.get(pp.productId);
      if (!product) {
        warnings.push(`Batch "${plan.name}" references unknown product ${pp.productId}.`);
        unscheduled.add(plan.id!);
        continue;
      }
      const typeName = product.productCategoryId
        ? categoryNameById.get(product.productCategoryId)
        : undefined;
      if (!typeName) {
        warnings.push(`Product "${product.name}" in batch "${plan.name}" has no category — assign one in Products.`);
        unscheduled.add(plan.id!);
        continue;
      }
      const arr = wavesByType.get(typeName) ?? [];
      arr.push({ ...pp, product });
      wavesByType.set(typeName, arr);
    }

    // Iterate waves in category-name order. Each wave appends to the
    // shared cursor so a two-wave batch doesn't double-book the day.
    let cursor: Date | null = nextWorkingDay(today, capFor, /*inclusive*/ true);
    let cursorOffset = 0;
    if (!cursor) {
      unscheduled.add(plan.id!);
      warnings.push(`No working day available for batch "${plan.name}".`);
      continue;
    }

    for (const [typeName, waveProducts] of [...wavesByType.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const steps = (stepsByType.get(typeName) ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
      if (steps.length === 0) {
        warnings.push(`No production steps defined for category "${typeName}". Add them under Settings → Production Steps.`);
        unscheduled.add(plan.id!);
        continue;
      }

      for (const step of steps) {
        if (!cursor) break;

        const isBatchStep = !!step.perBatch;
        const totalActive = isBatchStep
          ? Math.max(0, Math.round(step.activeMinutes))
          : waveProducts.reduce(
              (s, wp) => s + Math.round(step.activeMinutes * wp.quantity),
              0,
            );
        const perProductMinutes = waveProducts.map((wp) => ({
          ...wp,
          minutes: isBatchStep
            ? Math.round(step.activeMinutes / Math.max(1, waveProducts.length))
            : Math.round(step.activeMinutes * wp.quantity),
        }));

        if (totalActive > 0) {
          // Reconcile cursor against any capacity other plans already
          // placed on this day.
          const dayCap = capFor(cursor);
          const dayUsed = usedByDate.get(isoDate(cursor)) ?? 0;
          if (cursorOffset < dayUsed) cursorOffset = dayUsed;

          // Defensive no-split rule: a step whose totalActive fits in a
          // single day's capacity must land on exactly ONE day. If it
          // doesn't fit in the remaining capacity here, roll the whole
          // step to the next working day (don't split across days).
          if (totalActive <= dayCap && cursorOffset + totalActive > dayCap) {
            const next = nextWorkingDay(cursor, capFor, /*inclusive*/ false);
            if (!next) {
              unscheduled.add(plan.id!);
              warnings.push(`Couldn't place "${step.name}" for batch "${plan.name}" — no working days left.`);
              cursor = null;
              break;
            }
            cursor = next;
            cursorOffset = usedByDate.get(isoDate(cursor)) ?? 0;
          }

          // Pack the step. For steps that fit in a single day after
          // the roll above, this loop runs exactly once. For the rare
          // step that exceeds a single day's capacity, it spans days.
          const slots: Array<{ date: Date; startOffsetMinutes: number; endOffsetMinutes: number }> = [];
          let remaining = totalActive;
          while (remaining > 0 && cursor) {
            const cap = capFor(cursor);
            const used = usedByDate.get(isoDate(cursor)) ?? 0;
            if (cursorOffset < used) cursorOffset = used;
            const free = Math.max(0, cap - cursorOffset);
            if (free > 0) {
              const take = Math.min(free, remaining);
              slots.push({
                date: new Date(cursor),
                startOffsetMinutes: cursorOffset,
                endOffsetMinutes: cursorOffset + take,
              });
              usedByDate.set(isoDate(cursor), (usedByDate.get(isoDate(cursor)) ?? 0) + take);
              cursorOffset += take;
              remaining -= take;
            }
            if (remaining > 0) {
              const next = nextWorkingDay(cursor, capFor, /*inclusive*/ false);
              if (!next) {
                unscheduled.add(plan.id!);
                warnings.push(`Couldn't fit "${step.name}" for batch "${plan.name}" — ${remaining} min unplaced.`);
                cursor = null;
                break;
              }
              cursor = next;
              cursorOffset = 0;
            }
          }

          emitRows({
            entries, slots, step, perProductMinutes, plan, orderIdForPlan: planOrderId.get(plan.id!),
          });
        }

        // Wait — flat per batch, never scaled. Only forces a day-break
        // when it would extend past end-of-day.
        const waitMin = Math.max(0, Math.round(step.waitingMinutes));
        if (waitMin > 0 && cursor) {
          const cap = capFor(cursor);
          if (cursorOffset + waitMin <= cap) {
            cursorOffset += waitMin;
          } else {
            const next = nextWorkingDay(cursor, capFor, /*inclusive*/ false);
            if (!next) {
              unscheduled.add(plan.id!);
              warnings.push(`Can't wait after "${step.name}" for batch "${plan.name}" — no working days left.`);
              cursor = null;
              break;
            }
            cursor = next;
            cursorOffset = 0;
          }
        }
      }
    }

    // Deadline check: warn if the wave's last active end is past the
    // earliest linked-order deadline.
    const deadlineMs = planDeadline.get(plan.id!);
    if (deadlineMs !== undefined) {
      const planEntries = entries.filter((e) => e.planId === plan.id);
      if (planEntries.length > 0) {
        const lastEnd = planEntries.reduce((m, e) => Math.max(m, new Date(e.endAt).getTime()), 0);
        if (lastEnd > deadlineMs) {
          unscheduled.add(plan.id!);
          warnings.push(
            `Batch "${plan.name}" finishes past the linked order deadline ${new Date(deadlineMs).toISOString().slice(0, 10)}.`,
          );
        }
      }
    }

    // Record the order ref on every entry for this batch so the UI
    // can label rows without a separate lookup. Stored via the
    // convenience "notes" field? Actually, leave to UI join.
    void planOrderRef;
  }

  // Defensive final ordering so the UI shows steps in production
  // sequence: group by batch, then by step sortOrder, then by start
  // time. Protects against stale/legacy rows whose startAt values
  // came from an older algorithm.
  entries.sort((a, b) => {
    const pa = a.planId ?? "";
    const pb = b.planId ?? "";
    if (pa !== pb) return pa.localeCompare(pb);
    const sa = stepSortById.get(a.stepId ?? "") ?? 0;
    const sb = stepSortById.get(b.stepId ?? "") ?? 0;
    if (sa !== sb) return sa - sb;
    return a.startAt.localeCompare(b.startAt);
  });

  const dailySummary = buildDailySummary(
    usedByDate, config, people, unavailability, blockedDays, entries,
  );

  return {
    entries,
    dailySummary,
    warnings,
    unscheduledPlanIds: [...unscheduled],
  };
}

function emitRows(args: {
  entries: SchedulerResult["entries"];
  slots: Array<{ date: Date; startOffsetMinutes: number; endOffsetMinutes: number }>;
  step: ProductionStep;
  perProductMinutes: Array<PlanProduct & { product: Product; minutes: number }>;
  plan: ProductionPlan;
  orderIdForPlan: string | undefined;
}): void {
  const { entries, slots, step, perProductMinutes, plan, orderIdForPlan } = args;
  if (slots.length === 0) return;

  slots.sort((a, b) => {
    const tDiff = a.date.getTime() - b.date.getTime();
    if (tDiff !== 0) return tDiff;
    return a.startOffsetMinutes - b.startOffsetMinutes;
  });
  const totalPlaced = slots.reduce((s, r) => s + (r.endOffsetMinutes - r.startOffsetMinutes), 0);
  for (const slot of slots) {
    const slotMin = slot.endOffsetMinutes - slot.startOffsetMinutes;
    const slotShare = totalPlaced > 0 ? slotMin / totalPlaced : 0;
    const dayStart = startOfDay(slot.date);
    const slotStart = new Date(dayStart.getTime() + slot.startOffsetMinutes * 60 * 1000);
    for (const pp of perProductMinutes) {
      const productMinutes = Math.round(pp.minutes * slotShare);
      if (productMinutes <= 0) continue;
      const end = new Date(slotStart.getTime() + productMinutes * 60 * 1000);
      entries.push({
        orderId: orderIdForPlan ?? plan.sourceOrderId,
        productId: pp.product.id!,
        mouldId: pp.mouldId || pp.product.defaultMouldId,
        planId: plan.id,
        planProductId: pp.id,
        stepId: step.id,
        phase: step.name,
        startAt: slotStart.toISOString(),
        endAt: end.toISOString(),
        durationMinutes: productMinutes,
        isActive: true,
        status: "pending",
      });
    }
  }
}

function buildDailySummary(
  usedByDate: Map<string, number>,
  config: CapacityConfig | null,
  people: Person[],
  unavailability: PersonUnavailability[],
  blockedDays: EventCalendarEntry[],
  entries: SchedulerResult["entries"],
): DailyCapacityRow[] {
  const dates = new Set<string>();
  for (const k of usedByDate.keys()) dates.add(k);
  for (const e of entries) dates.add(e.startAt.slice(0, 10));

  const rows: DailyCapacityRow[] = [];
  const warn = config?.warnThresholdPercent ?? 100;
  const critical = config?.criticalThresholdPercent ?? 100;

  for (const iso of [...dates].sort()) {
    const d = new Date(iso + "T12:00:00");
    const available = effectiveDailyCapacityMinutes(d, config, people, unavailability, blockedDays);
    const used = usedByDate.get(iso) ?? 0;
    const util = available > 0 ? (used / available) * 100 : 0;
    let level: DailyCapacityRow["level"];
    if (available === 0) level = used > 0 ? "over" : "ok";
    else if (used > available) level = "over";
    else if (util >= critical) level = "critical";
    else if (util >= warn) level = "warn";
    else level = "ok";

    const scheduleCount = entries.filter((e) => e.startAt.slice(0, 10) === iso).length;
    rows.push({ date: iso, usedMinutes: used, availableMinutes: available, utilisationPercent: Math.round(util), level, scheduleCount });
  }
  return rows;
}

function groupBy<T, K>(arr: T[], keyFn: (v: T) => K | undefined): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const v of arr) {
    const k = keyFn(v);
    if (k === undefined) continue;
    const list = m.get(k) ?? [];
    list.push(v);
    m.set(k, list);
  }
  return m;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateOnly(d: Date): Date {
  const out = new Date(d);
  out.setHours(12, 0, 0, 0);
  return out;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(8, 0, 0, 0);
  return out;
}

function nextWorkingDay(
  from: Date,
  capFor: (d: Date) => number,
  inclusive: boolean,
): Date | null {
  const probe = new Date(from);
  if (!inclusive) probe.setDate(probe.getDate() + 1);
  probe.setHours(12, 0, 0, 0);
  for (let i = 0; i < MAX_WORKING_DAY_SEARCH; i++) {
    if (capFor(probe) > 0) return probe;
    probe.setDate(probe.getDate() + 1);
  }
  return null;
}

/** Assign a time-of-day band (morning / midday / afternoon) to a
 *  scheduled start. Local-hour based, timezone-safe. */
export type TimeBand = "morning" | "midday" | "afternoon";

export function timeBandFor(startAt: string): TimeBand {
  const hour = new Date(startAt).getHours();
  if (hour < 11) return "morning";
  if (hour < 14) return "midday";
  return "afternoon";
}

export const TIME_BAND_LABEL: Record<TimeBand, string> = {
  morning: "Morning",
  midday: "Midday",
  afternoon: "Afternoon",
};
