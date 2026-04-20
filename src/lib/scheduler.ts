/**
 * Reverse scheduler — pure logic.
 *
 * Input: open orders + their line items + products + production steps +
 * per-day capacity (people + unavailability + blocked days). Output: one
 * `ProductionScheduleEntry` per step per order-line, placed on calendar
 * dates working backwards from each order's deadline so the last step
 * finishes by the deadline day.
 *
 * Simplifying assumptions (v1):
 *   - Every step's active time scales linearly with quantity (activeMinutes
 *     is per-mould × quantity worth of mould-fills). Waiting time is fixed
 *     per step (a resting window, not per-mould).
 *   - Active time books against the per-day people-hours budget. The
 *     scheduler won't stuff more minutes into a day than `effectiveDailyCapacityMinutes`
 *     allows. When a day is full, remaining minutes roll to the previous
 *     working day.
 *   - Waiting time only affects the calendar position of the next step
 *     (you can't start step N+1 until the waiting window has elapsed);
 *     it doesn't eat capacity.
 *   - Equipment + mould allocation is NOT done at this layer. Schedule
 *     rows land with `mouldId` = product.defaultMouldId and `equipmentId`
 *     undefined. §5+ work can assign specific instances later.
 *
 * This is deliberately minimal — enough to produce a daily view + capacity
 * alerts without getting tangled in equipment/mould bin-packing up front.
 */

import type {
  Order, OrderItem, Product, ProductionStep, Person, PersonUnavailability,
  EventCalendarEntry, CapacityConfig, ProductionScheduleEntry,
} from "@/types";
import { effectiveDailyCapacityMinutes } from "@/lib/capacity";

export interface SchedulerInput {
  orders: Order[];
  orderItems: OrderItem[];
  products: Product[];
  productionSteps: ProductionStep[];
  config: CapacityConfig | null;
  people: Person[];
  unavailability: PersonUnavailability[];
  blockedDays: EventCalendarEntry[];
  /** Category name lookup by productCategoryId — lets us map a product
   *  to its productType string (what productionSteps key off). */
  categoryNameById: Map<string, string>;
}

export interface DailyCapacityRow {
  /** ISO date string ("YYYY-MM-DD"). */
  date: string;
  /** Total active minutes scheduled for this day. */
  usedMinutes: number;
  /** Active minutes budget from `effectiveDailyCapacityMinutes`. */
  availableMinutes: number;
  /** usedMinutes / availableMinutes × 100. 0 when availableMinutes is 0. */
  utilisationPercent: number;
  level: "ok" | "warn" | "critical" | "over";
  scheduleCount: number;
}

export interface SchedulerResult {
  entries: Omit<ProductionScheduleEntry, "id" | "createdAt" | "updatedAt">[];
  dailySummary: DailyCapacityRow[];
  warnings: string[];
  /** Orders that couldn't be scheduled (missing product / steps / etc.). */
  unscheduledOrderIds: string[];
}

/**
 * Build a full schedule from the current order set. Pure — caller writes
 * entries to Supabase via `saveProductionSchedule`.
 */
export function buildSchedule(input: SchedulerInput): SchedulerResult {
  const {
    orders, orderItems, products, productionSteps,
    config, people, unavailability, blockedDays, categoryNameById,
  } = input;

  const entries: SchedulerResult["entries"] = [];
  const warnings: string[] = [];
  const unscheduled = new Set<string>();

  const productMap = new Map<string, Product>(products.map((p) => [p.id!, p]));
  const itemsByOrder = groupBy(orderItems, (i) => i.orderId);
  const stepsByType = groupBy(productionSteps, (s) => s.productType);

  // Book-keeping: minutes consumed per ISO date
  const usedByDate = new Map<string, number>();

  // Only schedule orders that are pending or in_production
  const scheduleable = orders.filter((o) => o.status === "pending" || o.status === "in_production");

  // Process by deadline — earliest first so later deadlines can still find capacity
  const sorted = [...scheduleable].sort((a, b) => a.deadline.localeCompare(b.deadline));

  for (const order of sorted) {
    const items = itemsByOrder.get(order.id!) ?? [];
    if (items.length === 0) {
      warnings.push(`Order "${order.customerName ?? order.eventName ?? order.id}" has no product lines — nothing to schedule.`);
      continue;
    }

    const deadline = new Date(order.deadline);

    for (const item of items) {
      const product = productMap.get(item.productId);
      if (!product) {
        unscheduled.add(order.id!);
        warnings.push(`Order "${order.customerName ?? order.id}" references unknown product ${item.productId}.`);
        continue;
      }

      const productType = product.productCategoryId
        ? categoryNameById.get(product.productCategoryId)
        : undefined;
      if (!productType) {
        unscheduled.add(order.id!);
        warnings.push(`Product "${product.name}" has no category — no step list available. Assign a category in Products.`);
        continue;
      }

      const allSteps = (stepsByType.get(productType) ?? []).sort((a, b) => a.sortOrder - b.sortOrder);
      if (allSteps.length === 0) {
        unscheduled.add(order.id!);
        warnings.push(`No production steps defined for category "${productType}". Add them under Settings → Production Steps.`);
        continue;
      }

      // Borrow lines come straight out of Store stock — the full
      // production cycle already ran on the replenishment order. Only
      // packing-into-boxes for this specific order remains, so filter
      // the step list to isPackingStep=true. If no packing steps are
      // defined, the line is treated as needing zero work.
      const isBorrow = item.fulfilmentMode === "borrow";
      const steps = isBorrow ? allSteps.filter((s) => s.isPackingStep) : allSteps;
      if (isBorrow && steps.length === 0) {
        // Nothing to schedule — borrow from Store with no packing work
        // defined is still a valid "green" line; don't warn, just skip.
        continue;
      }

      // Walk steps in reverse: last step ends by deadline, earlier steps
      // finish before the next step's start (minus waiting window).
      let nextStartDate = dateOnly(deadline);
      const reverseSteps = [...steps].reverse();

      for (const step of reverseSteps) {
        const activeTotal = step.activeMinutes * item.quantity;
        const waiting = step.waitingMinutes;
        let remaining = activeTotal;
        const placed: { date: Date; minutes: number }[] = [];

        // Fit `activeTotal` minutes into working days walking backward
        // from `nextStartDate` (the day after which the waiting window
        // would start for the following step).
        let probe = new Date(nextStartDate);
        let safety = 365;
        while (remaining > 0 && safety-- > 0) {
          const available = effectiveDailyCapacityMinutes(probe, config, people, unavailability, blockedDays);
          if (available > 0) {
            const iso = isoDate(probe);
            const used = usedByDate.get(iso) ?? 0;
            const free = Math.max(0, available - used);
            if (free > 0) {
              const take = Math.min(free, remaining);
              placed.push({ date: new Date(probe), minutes: take });
              usedByDate.set(iso, used + take);
              remaining -= take;
            }
          }
          if (remaining > 0) {
            probe.setDate(probe.getDate() - 1);
          }
        }

        if (remaining > 0) {
          warnings.push(`Couldn't fit all "${step.name}" minutes for "${product.name}" before order "${order.customerName ?? order.id}" deadline — ${remaining} min overflowed.`);
          unscheduled.add(order.id!);
        }

        // Emit schedule rows. Earliest placed date becomes the new
        // `nextStartDate` minus the waiting window for the previous step.
        placed.sort((a, b) => a.date.getTime() - b.date.getTime());
        for (const slot of placed) {
          const start = startOfDay(slot.date);
          const end = new Date(start.getTime() + slot.minutes * 60 * 1000);
          entries.push({
            orderId: order.id,
            productId: product.id!,
            mouldId: product.defaultMouldId,
            stepId: step.id,
            phase: step.name,
            startAt: start.toISOString(),
            endAt: end.toISOString(),
            durationMinutes: Math.round(slot.minutes),
            isActive: true,
            status: "pending",
          });
        }

        // Earliest placed date becomes the anchor for the next (earlier) step.
        // Apply waiting time by rolling nextStartDate back by the ceil of
        // (waiting minutes / (24 × 60)) days — coarse, but enough to keep
        // resting windows visible on the daily view.
        if (placed.length > 0) {
          nextStartDate = startOfDay(placed[0].date);
        }
        if (waiting > 0) {
          const waitingDays = Math.max(1, Math.ceil(waiting / (24 * 60)));
          nextStartDate.setDate(nextStartDate.getDate() - waitingDays);
        } else {
          // Even without waiting, step N+1 starts after step N — keep going backwards
          nextStartDate.setDate(nextStartDate.getDate() - 1);
        }
      }
    }
  }

  // Build daily summary covering today → max scheduled date
  const dailySummary = buildDailySummary(
    usedByDate, config, people, unavailability, blockedDays, entries,
  );

  return {
    entries,
    dailySummary,
    warnings,
    unscheduledOrderIds: [...unscheduled],
  };
}

function buildDailySummary(
  usedByDate: Map<string, number>,
  config: CapacityConfig | null,
  people: Person[],
  unavailability: PersonUnavailability[],
  blockedDays: EventCalendarEntry[],
  entries: SchedulerResult["entries"],
): DailyCapacityRow[] {
  // Collect every date with either scheduled work or a starting "today"
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
