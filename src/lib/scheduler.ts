/**
 * Batch-based scheduler.
 *
 * Scheduling unit: a productionPlan (batch). For each active batch we
 * sum the total active minutes across all its steps (across all waves)
 * and try to land the whole thing on ONE working day. If the batch
 * doesn't fit a single day, we fall back to packing it across
 * consecutive working days, preserving step order.
 *
 *   Pass 1 — single-day fit (common case):
 *     Walk candidate days forward from today up to deadline−buffer and
 *     pick the first day that fits totalActive+totalWait. Same-day
 *     grouping is a soft preference: if a candidate day already has
 *     another batch running one of our step types, prefer it (earliest
 *     grouping day wins). Otherwise take the first fitting day.
 *
 *   Pass 2 — multi-day fallback:
 *     Start from the first working day with capacity, pack step-by-step
 *     forward. Per-step no-split rule: a step whose totalActive ≤ a
 *     day's capacity must land on ONE day; if it doesn't fit the
 *     remaining capacity, roll the whole step to the next working day.
 *     Waits absorb same-day when they fit; otherwise they force the
 *     next step onto the next working day.
 *
 * Deadline cap (both passes):
 *     latestDay = `deadline − productionBufferDays` (working days).
 *     Default buffer is 2 when unset. A batch that can't land on or
 *     before latestDay is marked unscheduled with a warning; we don't
 *     place work past the deadline.
 *
 * Capacity source: `effectiveDailyCapacityMinutes(...)` — sums
 * per-person configured hours on that date (time-window if set, else
 * defaultHoursPerDay) minus unavailability and workshop-wide blocked
 * days, then applies the capacity buffer %. No hardcoded fallback.
 *
 * Scheduling order: earliest-deadline-first; unlinked batches last.
 * Within a batch, waves run in category-name order.
 *
 * Output rows (ProductionScheduleEntry) carry: planId, planProductId,
 * orderId, stepId, phase, startAt/endAt, durationMinutes.
 *
 * Defensive final sort: (planId, stepSortOrder, startAt) so the UI
 * shows steps in production sequence even if upstream rows got out of
 * order.
 */

import type {
  Order, OrderItem, Product, ProductionStep, Person, PersonUnavailability,
  EventCalendarEntry, CapacityConfig, ProductionScheduleEntry, Mould,
  ProductionPlan, PlanProduct, OrderPlanLink,
} from "@/types";
import { effectiveDailyCapacityMinutes } from "@/lib/capacity";

export interface SchedulerInput {
  /** Active production batches. Completed ones are skipped. */
  plans: ProductionPlan[];
  planProducts: PlanProduct[];
  products: Product[];
  productionSteps: ProductionStep[];
  moulds: Mould[];
  /** Used only to compute each batch's effective deadline — via the
   *  orderPlanLinks → orderItems → orders chain. */
  orders: Order[];
  orderItems: OrderItem[];
  /** Many-to-many links between order lines and batches. The earliest
   *  linked-order deadline wins the deadline per batch. */
  orderPlanLinks: OrderPlanLink[];
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
const DEFAULT_BUFFER_DAYS = 2;

/** A single step's contribution inside a batch's flat sequence. */
interface FlatStep {
  step: ProductionStep;
  typeName: string;
  activeMinutes: number;
  waitMinutes: number;
  perProductMinutes: Array<PlanProduct & { product: Product; minutes: number }>;
}

export function buildSchedule(input: SchedulerInput): SchedulerResult {
  const {
    plans, planProducts, products, productionSteps, moulds,
    orders, orderItems, orderPlanLinks,
    config, people, unavailability, blockedDays, categoryNameById,
  } = input;

  const entries: SchedulerResult["entries"] = [];
  const warnings: string[] = [];
  const unscheduled = new Set<string>();

  const productMap = new Map<string, Product>(products.map((p) => [p.id!, p]));
  const stepsByType = groupBy(productionSteps, (s) => s.productType);
  const stepSortById = new Map(productionSteps.map((s) => [s.id!, s.sortOrder ?? 0]));
  const planProductsByPlan = groupBy(planProducts, (pp) => pp.planId);

  // Per-batch effective deadline: earliest deadline of any order line
  // linked into this batch. Unlinked batches get Infinity (low priority).
  const planDeadline = new Map<string, number>();
  const planOrderId = new Map<string, string>();
  const orderById = new Map(orders.map((o) => [o.id!, o]));
  const orderItemById = new Map(orderItems.map((oi) => [oi.id!, oi]));
  for (const link of orderPlanLinks) {
    const item = orderItemById.get(link.orderItemId);
    if (!item) continue;
    const order = orderById.get(item.orderId);
    if (!order) continue;
    const t = new Date(order.deadline).getTime();
    const cur = planDeadline.get(link.planId);
    if (cur === undefined || t < cur) {
      planDeadline.set(link.planId, t);
      planOrderId.set(link.planId, order.id!);
    }
  }

  const usedByDate = new Map<string, number>();
  const capacityByDate = new Map<string, number>();
  /** productType keys (category names) scheduled on each date — used as
   *  the soft-grouping signal when placing subsequent batches. */
  const stepTypesByDate = new Map<string, Set<string>>();

  function capFor(d: Date): number {
    const key = isoDate(d);
    const cached = capacityByDate.get(key);
    if (cached !== undefined) return cached;
    const cap = effectiveDailyCapacityMinutes(d, config, people, unavailability, blockedDays);
    capacityByDate.set(key, cap);
    return cap;
  }

  const bufferDays = Math.max(0, Math.round(config?.productionBufferDays ?? DEFAULT_BUFFER_DAYS));
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

    // Group plan products by category → waves. Products referencing
    // missing categories/products are dropped with a warning.
    const wavesByType = new Map<string, Array<PlanProduct & { product: Product }>>();
    let waveSetupFailed = false;
    for (const pp of pps) {
      const product = productMap.get(pp.productId);
      if (!product) {
        warnings.push(`Batch "${plan.name}" references unknown product ${pp.productId}.`);
        unscheduled.add(plan.id!);
        waveSetupFailed = true;
        continue;
      }
      const typeName = product.productCategoryId
        ? categoryNameById.get(product.productCategoryId)
        : undefined;
      if (!typeName) {
        warnings.push(`Product "${product.name}" in batch "${plan.name}" has no category — assign one in Products.`);
        unscheduled.add(plan.id!);
        waveSetupFailed = true;
        continue;
      }
      const arr = wavesByType.get(typeName) ?? [];
      arr.push({ ...pp, product });
      wavesByType.set(typeName, arr);
    }
    if (waveSetupFailed) continue;

    // Flatten: waves (alphabetical by category) → steps (sortOrder) →
    // one FlatStep per step. This is the sequence the scheduler places.
    const flat: FlatStep[] = [];
    let flattenFailed = false;
    for (const [typeName, waveProducts] of [...wavesByType.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const steps = (stepsByType.get(typeName) ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
      if (steps.length === 0) {
        warnings.push(`No production steps defined for category "${typeName}". Add them under Settings → Production Steps.`);
        unscheduled.add(plan.id!);
        flattenFailed = true;
        break;
      }
      for (const step of steps) {
        const isBatchStep = !!step.perBatch;
        const active = isBatchStep
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
        const wait = Math.max(0, Math.round(step.waitingMinutes));
        flat.push({ step, typeName, activeMinutes: active, waitMinutes: wait, perProductMinutes });
      }
    }
    if (flattenFailed) continue;

    const totalActive = flat.reduce((s, f) => s + f.activeMinutes, 0);
    const totalWait = flat.reduce((s, f) => s + f.waitMinutes, 0);
    if (totalActive === 0) continue; // Nothing to schedule.

    // Compute latestDay from deadline and buffer.
    const deadlineMs = planDeadline.get(plan.id!);
    let latestDay: Date | null = null;
    if (deadlineMs !== undefined) {
      latestDay = latestWorkingDayForDeadline(new Date(deadlineMs), bufferDays, capFor);
      if (!latestDay || latestDay.getTime() < today.getTime()) {
        unscheduled.add(plan.id!);
        warnings.push(
          `Batch "${plan.name}" deadline ${new Date(deadlineMs).toISOString().slice(0, 10)} leaves no room — scheduler needs ≥ ${bufferDays} working day${bufferDays === 1 ? "" : "s"} before it.`,
        );
        continue;
      }
    }

    const batchTypeSet = new Set<string>(flat.map((f) => f.typeName));

    // ─── Pass 1: single-day fit ─────────────────────────────────────
    // The whole batch (active + waits) has to fit within one day's
    // remaining capacity AND its total span (active+wait) has to be
    // short enough that no inter-step wait crosses end-of-day.
    const singleDaySpan = totalActive + totalWait;
    const fitDay = findSingleDayFit({
      today, latestDay, singleDaySpan, totalActive,
      capFor, usedByDate, stepTypesByDate, batchTypeSet,
    });

    if (fitDay) {
      placeOnSingleDay(
        fitDay, flat, plan, planOrderId.get(plan.id!),
        entries, usedByDate, stepTypesByDate,
      );
      continue;
    }

    // ─── Pass 2: multi-day fallback ─────────────────────────────────
    let cursor: Date | null = nextWorkingDay(today, capFor, /*inclusive*/ true);
    let cursorOffset = 0;
    if (!cursor) {
      unscheduled.add(plan.id!);
      warnings.push(`No working day available for batch "${plan.name}".`);
      continue;
    }

    let overflowedDeadline = false;
    for (const { step, typeName, activeMinutes, waitMinutes, perProductMinutes } of flat) {
      if (!cursor) break;

      if (activeMinutes > 0) {
        const dayCap = capFor(cursor);
        const dayUsed = usedByDate.get(isoDate(cursor)) ?? 0;
        if (cursorOffset < dayUsed) cursorOffset = dayUsed;

        // No-split rule: step that fits in a day but not in remaining
        // capacity rolls to the next working day entirely.
        if (activeMinutes <= dayCap && cursorOffset + activeMinutes > dayCap) {
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

        if (latestDay && cursor.getTime() > latestDay.getTime()) {
          overflowedDeadline = true;
        }

        const slots: Array<{ date: Date; startOffsetMinutes: number; endOffsetMinutes: number }> = [];
        let remaining = activeMinutes;
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
            usedByDate.set(isoDate(cursor), used + take);
            addStepType(stepTypesByDate, isoDate(cursor), typeName);
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
            if (latestDay && cursor.getTime() > latestDay.getTime()) {
              overflowedDeadline = true;
            }
          }
        }

        emitRows({
          entries, slots, step, perProductMinutes, plan,
          orderIdForPlan: planOrderId.get(plan.id!),
        });
      }

      // Wait — flat per batch. Only forces a day break when it would
      // extend past end-of-day.
      if (waitMinutes > 0 && cursor) {
        const cap = capFor(cursor);
        if (cursorOffset + waitMinutes <= cap) {
          cursorOffset += waitMinutes;
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
          if (latestDay && cursor.getTime() > latestDay.getTime()) {
            overflowedDeadline = true;
          }
        }
      }
    }

    if (overflowedDeadline) {
      unscheduled.add(plan.id!);
      warnings.push(
        `Batch "${plan.name}" doesn't fit within the ${bufferDays}-day buffer before its deadline — consider splitting it or moving the deadline.`,
      );
    }

    // Additional safety: warn if any emitted row ends past the raw
    // deadline (shouldn't happen after the latestDay cap, but catches
    // edge cases like a deadline earlier in the same day as latestDay).
    if (deadlineMs !== undefined) {
      const planEntries = entries.filter((e) => e.planId === plan.id);
      if (planEntries.length > 0) {
        const lastEnd = planEntries.reduce((m, e) => Math.max(m, new Date(e.endAt).getTime()), 0);
        if (lastEnd > deadlineMs && !overflowedDeadline) {
          unscheduled.add(plan.id!);
          warnings.push(
            `Batch "${plan.name}" finishes past the linked order deadline ${new Date(deadlineMs).toISOString().slice(0, 10)}.`,
          );
        }
      }
    }
  }

  // Defensive final ordering: step sortOrder within a batch, then start
  // time. Protects against stale rows whose startAt came from older
  // algorithms.
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

/**
 * Walk today → latestDay looking for a working day where the whole
 * batch fits. The "singleDaySpan" includes waits because every step
 * (including inter-step waits) has to fit within the day. Same-step
 * grouping is a soft preference: if we find a fitting day that already
 * has one of our step types scheduled, stop there (earliest grouping
 * day wins). Otherwise return the first fitting day.
 */
function findSingleDayFit(args: {
  today: Date;
  latestDay: Date | null;
  singleDaySpan: number;
  totalActive: number;
  capFor: (d: Date) => number;
  usedByDate: Map<string, number>;
  stepTypesByDate: Map<string, Set<string>>;
  batchTypeSet: Set<string>;
}): Date | null {
  const { today, latestDay, singleDaySpan, totalActive, capFor, usedByDate, stepTypesByDate, batchTypeSet } = args;

  const probe = new Date(today);
  probe.setHours(12, 0, 0, 0);
  let firstFit: Date | null = null;

  for (let i = 0; i < MAX_WORKING_DAY_SEARCH; i++) {
    if (latestDay && probe.getTime() > latestDay.getTime()) break;
    const cap = capFor(probe);
    if (cap > 0 && cap >= singleDaySpan) {
      const used = usedByDate.get(isoDate(probe)) ?? 0;
      const free = cap - used;
      // The remaining day must hold the full active work; waits can
      // overlap with other batches' active time without double-booking
      // (only activeMinutes consumes capacity), so gate on totalActive
      // for the free check and on singleDaySpan for the cap check.
      if (free >= totalActive) {
        if (firstFit === null) firstFit = new Date(probe);
        const types = stepTypesByDate.get(isoDate(probe));
        if (types && hasIntersection(types, batchTypeSet)) {
          return new Date(probe);
        }
      }
    }
    probe.setDate(probe.getDate() + 1);
  }
  return firstFit;
}

/**
 * Place all steps of a batch on a single day, sequentially. Starts at
 * the day's current used offset so we stack after any earlier batch.
 */
function placeOnSingleDay(
  day: Date,
  flat: FlatStep[],
  plan: ProductionPlan,
  orderIdForPlan: string | undefined,
  entries: SchedulerResult["entries"],
  usedByDate: Map<string, number>,
  stepTypesByDate: Map<string, Set<string>>,
): void {
  let offset = usedByDate.get(isoDate(day)) ?? 0;
  let activeUsed = 0;

  for (const { step, typeName, activeMinutes, waitMinutes, perProductMinutes } of flat) {
    if (activeMinutes > 0) {
      emitRows({
        entries,
        slots: [{
          date: new Date(day),
          startOffsetMinutes: offset,
          endOffsetMinutes: offset + activeMinutes,
        }],
        step,
        perProductMinutes,
        plan,
        orderIdForPlan,
      });
      offset += activeMinutes;
      activeUsed += activeMinutes;
      addStepType(stepTypesByDate, isoDate(day), typeName);
    }
    offset += waitMinutes;
  }

  // Only active minutes count against daily capacity. Waits are
  // wall-clock time the workshop stays open but the operator is free.
  usedByDate.set(isoDate(day), (usedByDate.get(isoDate(day)) ?? 0) + activeUsed);
}

function addStepType(map: Map<string, Set<string>>, key: string, type: string): void {
  const set = map.get(key) ?? new Set<string>();
  set.add(type);
  map.set(key, set);
}

function hasIntersection(a: Set<string>, b: Set<string>): boolean {
  for (const v of a) if (b.has(v)) return true;
  return false;
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

/**
 * Step back `bufferDays` working days from the deadline, so the
 * returned date is the latest day on which active work may land.
 *   bufferDays = 0 → deadline day itself, rolled back to nearest
 *                    working day if needed.
 *   bufferDays = N → the N-th working day before the deadline.
 * Returns null if we can't find enough working days.
 */
function latestWorkingDayForDeadline(
  deadline: Date,
  bufferDays: number,
  capFor: (d: Date) => number,
): Date | null {
  const probe = dateOnly(deadline);
  if (bufferDays <= 0) {
    for (let i = 0; i < MAX_WORKING_DAY_SEARCH; i++) {
      if (capFor(probe) > 0) return probe;
      probe.setDate(probe.getDate() - 1);
    }
    return null;
  }
  let remaining = bufferDays;
  for (let i = 0; i < MAX_WORKING_DAY_SEARCH; i++) {
    probe.setDate(probe.getDate() - 1);
    if (capFor(probe) > 0) {
      remaining--;
      if (remaining === 0) return new Date(probe);
    }
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
