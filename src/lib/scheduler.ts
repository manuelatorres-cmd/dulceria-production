/**
 * Reverse scheduler — mould-wave model.
 *
 * The workshop makes chocolates in *waves*: every product in an order
 * that shares a category goes through the same mould flow together.
 * The team tempers everyone's shell chocolate, shells every mould,
 * fills every mould, caps, rests, unmoulds, polishes, packs — in that
 * order, one step at a time, not one product at a time.
 *
 * A previous version scheduled each product's full step chain
 * serially before starting the next product. That spread a realistic
 * one-day run across eight days because every "temper" landed on its
 * own day. The fix is to treat the unit of scheduling as *a step
 * across the whole wave*, not *a product's entire chain*.
 *
 * Rules (mirrors the spec):
 *   1. Group order lines by productCategoryId — each category is one
 *      wave within the order.
 *   2. For each step in the wave: total active minutes =
 *      Σ (step.activeMinutes × mouldsNeeded_p) for every product p in
 *      the wave. mouldsNeeded = ceil(item.quantity / mould.cavities).
 *   3. Daily capacity budget consumes active minutes only. Waiting
 *      time adds calendar time between steps but never consumes the
 *      people-hours budget.
 *   4. Reverse packing: the last step ends by the order deadline;
 *      earlier steps finish before the next step's start minus the
 *      current step's waiting window. A step overflowing one day rolls
 *      back into the previous working day, respecting blocked days +
 *      unavailability.
 *   5. Per-product rows are emitted one per (product, day-slot). All
 *      products in a wave share the same startAt within a slot — they
 *      run concurrently on their own moulds. Each row's
 *      durationMinutes is the product's share so the daily capacity
 *      tally stays correct (Σ durations = total step active minutes).
 *
 * Borrow lines (fulfilmentMode === 'borrow') are skipped entirely
 * here — pralines come out of Store stock already finished. Packing-
 * step filtering for borrow lines runs elsewhere when the engine
 * wires into a wave (not yet implemented in this rewrite).
 *
 * Simplifying assumptions still in place:
 *   - Wave time is bucketed by working day; within a day everything
 *     starts at 08:00. Wall-clock precision is not needed for the
 *     capacity / day-grouping view the /plan + /production pages show.
 *   - Waiting windows bump the "next step" back by one working day
 *     when the window is long (≥ 4h), otherwise they're absorbed in
 *     the same day. Overnight rests (shell cooling, cap setting) model
 *     correctly this way; short rests don't introduce phantom days.
 */

import type {
  Order, OrderItem, Product, ProductionStep, Person, PersonUnavailability,
  EventCalendarEntry, CapacityConfig, ProductionScheduleEntry, Mould,
} from "@/types";
import { effectiveDailyCapacityMinutes } from "@/lib/capacity";

export interface SchedulerInput {
  orders: Order[];
  orderItems: OrderItem[];
  products: Product[];
  productionSteps: ProductionStep[];
  moulds: Mould[];
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

/** Waiting windows at or above this threshold (in minutes) force the
 *  next step onto the previous working day when reverse-packing. Below
 *  the threshold, waiting is absorbed inside the same day — same-day
 *  rests (short cooling / drying) don't add calendar days. */
const LONG_WAIT_MINUTES = 240;

/** Build a full schedule from the current order set. Pure — caller writes
 *  entries to Supabase via `replaceProductionSchedule`. */
export function buildSchedule(input: SchedulerInput): SchedulerResult {
  const {
    orders, orderItems, products, productionSteps, moulds,
    config, people, unavailability, blockedDays, categoryNameById,
  } = input;

  const entries: SchedulerResult["entries"] = [];
  const warnings: string[] = [];
  const unscheduled = new Set<string>();

  const productMap = new Map<string, Product>(products.map((p) => [p.id!, p]));
  const mouldMap = new Map<string, Mould>(moulds.map((m) => [m.id!, m]));
  const itemsByOrder = groupBy(orderItems, (i) => i.orderId);
  const stepsByType = groupBy(productionSteps, (s) => s.productType);

  const usedByDate = new Map<string, number>();

  const scheduleable = orders.filter((o) => o.status === "pending" || o.status === "in_production");
  const sorted = [...scheduleable].sort((a, b) => a.deadline.localeCompare(b.deadline));

  for (const order of sorted) {
    const items = (itemsByOrder.get(order.id!) ?? [])
      .filter((i) => (i.fulfilmentMode ?? "produce") === "produce");
    if (items.length === 0) {
      // Either an empty order or a 100 %-borrow order — nothing to
      // produce either way. Don't warn for borrow-only orders; they're
      // intentionally empty on the production board.
      continue;
    }

    const deadline = dateOnly(new Date(order.deadline));

    // Group items into per-category waves. The productType used as the
    // productionSteps key is the category name.
    const wavesByType = new Map<string, OrderItem[]>();
    for (const item of items) {
      const product = productMap.get(item.productId);
      if (!product) {
        unscheduled.add(order.id!);
        warnings.push(`Order "${order.customerName ?? order.id}" references unknown product ${item.productId}.`);
        continue;
      }
      const typeName = product.productCategoryId
        ? categoryNameById.get(product.productCategoryId)
        : undefined;
      if (!typeName) {
        unscheduled.add(order.id!);
        warnings.push(`Product "${product.name}" has no category — no step list available. Assign a category in Products.`);
        continue;
      }
      const arr = wavesByType.get(typeName) ?? [];
      arr.push(item);
      wavesByType.set(typeName, arr);
    }

    for (const [typeName, waveItems] of wavesByType) {
      const steps = (stepsByType.get(typeName) ?? []).sort((a, b) => a.sortOrder - b.sortOrder);
      if (steps.length === 0) {
        unscheduled.add(order.id!);
        warnings.push(`No production steps defined for category "${typeName}". Add them under Settings → Production Steps.`);
        continue;
      }

      // Pre-compute mould count per product. Borrow filtering already
      // happened — everyone in the wave is produce-fresh.
      const waveLines = waveItems.map((item) => {
        const product = productMap.get(item.productId)!;
        const mould = product.defaultMouldId ? mouldMap.get(product.defaultMouldId) : undefined;
        const cavities = mould?.numberOfCavities ?? 0;
        const mouldsNeeded = cavities > 0 ? Math.ceil(item.quantity / cavities) : 1;
        return { item, product, mouldsNeeded };
      });

      // Reverse-pack the wave. `nextStartDay` is the day the next step
      // (the one AFTER the one we're about to place) starts on.
      let nextStartDay = deadline;

      for (let stepIdx = steps.length - 1; stepIdx >= 0; stepIdx--) {
        const step = steps[stepIdx];

        // Long waits force step N onto the previous working day —
        // "shell chocolate has to set overnight" and similar.
        let activeEndDay = new Date(nextStartDay);
        if (step.waitingMinutes >= LONG_WAIT_MINUTES) {
          activeEndDay.setDate(activeEndDay.getDate() - 1);
        }

        // Per-product active minutes for this step.
        const perProductMinutes = waveLines.map((w) => ({
          ...w,
          minutes: Math.round(step.activeMinutes * w.mouldsNeeded),
        }));
        const totalActive = perProductMinutes.reduce((s, r) => s + r.minutes, 0);
        if (totalActive === 0) {
          // Zero-duration step (edge case — fully-manual step with
          // activeMinutes=0). Don't emit rows, just roll the clock.
          // nextStartDay stays put for the previous step.
          continue;
        }

        // Pack totalActive minutes into working days ending at
        // activeEndDay and rolling back through earlier working days.
        let remaining = totalActive;
        const slots: Array<{ date: Date; minutes: number }> = [];
        const probe = new Date(activeEndDay);
        let safety = 365;
        while (remaining > 0 && safety-- > 0) {
          const available = effectiveDailyCapacityMinutes(
            probe, config, people, unavailability, blockedDays,
          );
          if (available > 0) {
            const iso = isoDate(probe);
            const used = usedByDate.get(iso) ?? 0;
            const free = Math.max(0, available - used);
            if (free > 0) {
              const take = Math.min(free, remaining);
              slots.push({ date: new Date(probe), minutes: take });
              usedByDate.set(iso, used + take);
              remaining -= take;
            }
          }
          if (remaining > 0) {
            probe.setDate(probe.getDate() - 1);
          }
        }

        if (remaining > 0) {
          warnings.push(
            `Couldn't fit all "${step.name}" minutes for order "${order.customerName ?? order.id}" — ${remaining} min overflowed.`,
          );
          unscheduled.add(order.id!);
        }

        // Emit per-(product × slot) rows. Within a slot every product
        // row shares startAt — visually concurrent on /production —
        // and its duration is that product's share of the slot's
        // placed minutes, proportional to the product's share of the
        // step's total.
        slots.sort((a, b) => a.date.getTime() - b.date.getTime());
        const totalPlaced = slots.reduce((s, r) => s + r.minutes, 0);
        for (const slot of slots) {
          const slotShare = totalPlaced > 0 ? slot.minutes / totalPlaced : 0;
          const start = startOfDay(slot.date);
          for (const pp of perProductMinutes) {
            const productMinutes = Math.round(pp.minutes * slotShare);
            if (productMinutes <= 0) continue;
            const end = new Date(start.getTime() + productMinutes * 60 * 1000);
            entries.push({
              orderId: order.id,
              productId: pp.product.id!,
              mouldId: pp.product.defaultMouldId,
              stepId: step.id,
              phase: step.name,
              startAt: start.toISOString(),
              endAt: end.toISOString(),
              durationMinutes: productMinutes,
              isActive: true,
              status: "pending",
            });
          }
        }

        // Previous step must end before this step's active starts.
        if (slots.length > 0) {
          nextStartDay = startOfDay(slots[0].date);
        }
      }
    }
  }

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
