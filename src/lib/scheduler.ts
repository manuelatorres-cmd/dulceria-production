/**
 * Daily production scheduler.
 *
 * Output shape:
 *   productionDays — one entry per calendar date that has work
 *   lineItems      — one entry per (day, batch) with the step IDs
 *                    happening that day for that batch
 *
 * Scheduling unit is a productionPlan (batch). A batch's steps can
 * span multiple days. Step progress is tracked batch-globally via
 * planStepStatus (unchanged); this scheduler decides ONLY which
 * steps land on which day.
 *
 * ---------- Modes ----------
 *
 *   Forward-fill (inside merging window): for a batch whose linked
 *     deadline is within `mergingWindowWeeks`, walk forward from
 *     today, fill each day's remaining capacity before spilling to
 *     the next. Preferred because it packs existing near-term days
 *     densely, leaving later days free.
 *
 *   Reverse-schedule (outside merging window): for a batch whose
 *     linked deadline is farther than the merging window, anchor at
 *     `deadline − productionBufferDays` and walk backwards so all
 *     work lands as close to the deadline as possible (avoids
 *     starting a 4-week-out order today).
 *
 * ---------- Mould occupancy ----------
 *
 * A batch reserves its default mould from the moment its Polishing
 * step lands on a day through to the day its Unmoulding step ends.
 * Other batches using the same mould cannot overlap that span.
 * Tracked as an Array<{mouldId, from, to}> across days — cheap for
 * the batch counts we deal with.
 *
 * ---------- Day-level session locks ----------
 *
 * Once a batch's step is marked done on a day (via planStepStatus),
 * that session for that date is closed — the scheduler won't add
 * new work for the same stepId to that day. Drives cross-batch
 * session sharing without requiring an explicit "lock session"
 * action. When planStepStatus is empty (fresh draft), no locks
 * apply.
 *
 * ---------- Batch order of processing ----------
 *
 * Earliest linked-order deadline first. Tiebreak: larger batch
 * (totalPieces descending) — easier to place before small fillers
 * gobble up the best days.
 */

import type {
  Order, OrderItem, Product, ProductionStep, Person, PersonUnavailability,
  EventCalendarEntry, CapacityConfig, Mould,
  ProductionPlan, PlanProduct, OrderPlanLink, PlanStepStatus,
} from "@/types";
import { effectiveDailyCapacityMinutes } from "@/lib/capacity";

export interface DailyScheduleInput {
  /** Draft batches to schedule. Active/done/cancelled/orphaned are
   *  passed in but skipped by this scheduler — caller filters. */
  plans: ProductionPlan[];
  planProducts: PlanProduct[];
  products: Product[];
  productionSteps: ProductionStep[];
  moulds: Mould[];
  /** Used to derive per-batch effective deadline via orderPlanLinks. */
  orders: Order[];
  orderItems: OrderItem[];
  orderPlanLinks: OrderPlanLink[];
  config: CapacityConfig | null;
  people: Person[];
  unavailability: PersonUnavailability[];
  blockedDays: EventCalendarEntry[];
  categoryNameById: Map<string, string>;
  /** Existing step-status rows used for session locks. Optional —
   *  empty array behaves as "no locks". */
  planStepStatus?: PlanStepStatus[];
}

export interface ProposedProductionDay {
  date: string; // YYYY-MM-DD (local)
}

export interface ProposedLineItem {
  /** dateRef matches a ProposedProductionDay.date. Persistence layer
   *  resolves to a real productionDayId. */
  dateRef: string;
  planId: string;
  stepIds: string[];
  plannedMinutes: number;
  sortOrder: number;
}

export interface DailyScheduleResult {
  days: ProposedProductionDay[];
  lineItems: ProposedLineItem[];
  warnings: string[];
  unscheduledPlanIds: string[];
}

/** Time-of-day band kept for the dashboard strip + plan renderer.
 *  Local-hour based, timezone-safe. No timing info is produced by the
 *  scheduler any more; callers derive bands from day-start for display. */
export type TimeBand = "morning" | "midday" | "afternoon";

export function timeBandFor(isoOrDate: string | Date): TimeBand {
  const hour = (isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate)).getHours();
  if (hour < 11) return "morning";
  if (hour < 14) return "midday";
  return "afternoon";
}

export const TIME_BAND_LABEL: Record<TimeBand, string> = {
  morning: "Morning",
  midday: "Midday",
  afternoon: "Afternoon",
};

const DEFAULT_BUFFER_DAYS = 2;
const DEFAULT_MERGING_WINDOW_WEEKS = 2;
const MAX_WORKING_DAY_SEARCH = 365;

// Internal: per-batch flat step descriptor.
interface FlatStep {
  stepId: string;
  stepSortOrder: number;
  typeName: string;
  activeMinutes: number;
  /** Marks Polishing / Unmoulding steps so we can compute mould span. */
  isMouldLockStart: boolean;
  isMouldLockEnd: boolean;
}

// Internal: per-day accumulator.
interface DayState {
  date: string;
  capacity: number;
  used: number;
  // For each planId on this day, the stepIds placed (in sortOrder).
  placements: Map<string, { stepIds: string[]; minutes: number; sortOrder: number }>;
  // Session-lock fingerprint: stepIds whose sessions are closed for this day.
  lockedStepIds: Set<string>;
}

interface MouldSpan {
  mouldId: string;
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  planId: string;
}

export function buildDailySchedule(input: DailyScheduleInput): DailyScheduleResult {
  const {
    plans, planProducts, products, productionSteps, moulds,
    orders, orderItems, orderPlanLinks,
    config, people, unavailability, blockedDays, categoryNameById,
    planStepStatus = [],
  } = input;

  const warnings: string[] = [];
  const unscheduled = new Set<string>();

  const productById = new Map(products.map((p) => [p.id!, p]));
  const mouldById = new Map(moulds.map((m) => [m.id!, m]));
  const stepById = new Map(productionSteps.map((s) => [s.id!, s]));
  const planProductsByPlan = groupBy(planProducts, (pp) => pp.planId);
  const stepsByType = groupBy(productionSteps, (s) => s.productType);
  const orderById = new Map(orders.map((o) => [o.id!, o]));
  const orderItemById = new Map(orderItems.map((oi) => [oi.id!, oi]));

  // Per-batch effective deadline from its linked orders.
  const planDeadline = new Map<string, number>();
  for (const link of orderPlanLinks) {
    const item = orderItemById.get(link.orderItemId);
    if (!item) continue;
    const order = orderById.get(item.orderId);
    if (!order) continue;
    const t = new Date(order.deadline).getTime();
    const cur = planDeadline.get(link.planId);
    if (cur === undefined || t < cur) planDeadline.set(link.planId, t);
  }

  // Per-batch total pieces (tiebreak on sort).
  const planTotalPieces = new Map<string, number>();
  for (const pp of planProducts) {
    const mould = pp.mouldId ? mouldById.get(pp.mouldId) : undefined;
    const cavities = mould?.numberOfCavities ?? 0;
    const pieces = cavities * pp.quantity;
    planTotalPieces.set(pp.planId, (planTotalPieces.get(pp.planId) ?? 0) + pieces);
  }

  // Only schedule DRAFT batches. Active batches are in-flight and
  // owned by the operator's physical work; done/cancelled/orphaned are
  // inert. Active batches still count against mould occupancy though,
  // so we record their spans (from existing lineItems — fed by caller
  // via a future extension). For this first pass, we only schedule
  // drafts against a fresh mould-busy set; the caller ensures the
  // mould-busy state matches reality by passing active-batch line
  // items separately if needed.
  const schedulable = plans.filter((p) => p.status === "draft");

  // Build flat steps per batch + skip batches with malformed data.
  const flatByPlan = new Map<string, FlatStep[]>();
  const planMouldId = new Map<string, string>();

  for (const plan of schedulable) {
    const pps = planProductsByPlan.get(plan.id!) ?? [];
    if (pps.length === 0) {
      // Draft with no products — nothing to schedule, skip silently.
      continue;
    }

    // All planProducts in a batch share one mould in the new
    // consolidated model. Take the first; warn if they diverge.
    const mouldIds = [...new Set(pps.map((pp) => pp.mouldId).filter(Boolean))];
    if (mouldIds.length === 0) {
      warnings.push(`Batch "${plan.name}" has no mould assigned — skipped.`);
      unscheduled.add(plan.id!);
      continue;
    }
    if (mouldIds.length > 1) {
      warnings.push(`Batch "${plan.name}" has multiple moulds — consolidated model expects one; using ${mouldIds[0]}.`);
    }
    planMouldId.set(plan.id!, mouldIds[0]!);

    // Derive the category (productType) from the first product. All
    // products in a consolidated batch are the same product, so same
    // category. If missing, skip.
    const firstProduct = productById.get(pps[0].productId);
    if (!firstProduct) {
      warnings.push(`Batch "${plan.name}" references unknown product — skipped.`);
      unscheduled.add(plan.id!);
      continue;
    }
    const typeName = firstProduct.productCategoryId
      ? categoryNameById.get(firstProduct.productCategoryId)
      : undefined;
    if (!typeName) {
      warnings.push(`Product "${firstProduct.name}" has no category — assign one under Products.`);
      unscheduled.add(plan.id!);
      continue;
    }
    const allSteps = (stepsByType.get(typeName) ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder);
    if (allSteps.length === 0) {
      warnings.push(`No production steps defined for category "${typeName}".`);
      unscheduled.add(plan.id!);
      continue;
    }

    // Packing-only batches (created by the reconciler for borrow
    // order lines) run only the steps flagged isPackingStep on
    // productionSteps. Identified by the "— packing" suffix the
    // reconciler writes to the plan name.
    const isPackingOnly = (plan.name ?? "").trim().endsWith("— packing");
    const steps = isPackingOnly
      ? allSteps.filter((s) => s.isPackingStep)
      : allSteps;
    if (steps.length === 0) {
      // Packing-only batch but no step is flagged isPackingStep — warn
      // and skip so the user knows to tick the Packing step flag in
      // Settings → Production Steps.
      if (isPackingOnly) {
        warnings.push(
          `Batch "${plan.name}" has nothing to schedule — mark at least one step as "Packing step" in Settings to pack borrow-from-stock lines.`,
        );
      }
      unscheduled.add(plan.id!);
      continue;
    }

    // Total quantity drives per-step active-minutes scaling. Shared
    // across the wave (single product per batch in the new model).
    const totalQty = pps.reduce((s, pp) => s + pp.quantity, 0);

    const flat: FlatStep[] = steps.map((step) => {
      const isBatchStep = !!step.perBatch;
      const active = isBatchStep
        ? Math.max(0, Math.round(step.activeMinutes))
        : Math.max(0, Math.round(step.activeMinutes * totalQty));
      const nameLower = step.name.toLowerCase();
      return {
        stepId: step.id!,
        stepSortOrder: step.sortOrder,
        typeName,
        activeMinutes: active,
        isMouldLockStart: nameLower.includes("polish"),
        isMouldLockEnd: nameLower.includes("unmould") || nameLower.includes("unmold"),
      };
    });
    flatByPlan.set(plan.id!, flat);
  }

  // Sort schedulable batches: earliest deadline, then larger batch first.
  const sortedPlans = schedulable
    .filter((p) => flatByPlan.has(p.id!))
    .sort((a, b) => {
      const da = planDeadline.get(a.id!) ?? Number.POSITIVE_INFINITY;
      const db = planDeadline.get(b.id!) ?? Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      const pa = planTotalPieces.get(a.id!) ?? 0;
      const pb = planTotalPieces.get(b.id!) ?? 0;
      if (pa !== pb) return pb - pa; // larger batch first
      const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return ca - cb;
    });

  // Capacity cache.
  const capacityCache = new Map<string, number>();
  function capFor(date: string): number {
    const cached = capacityCache.get(date);
    if (cached !== undefined) return cached;
    const d = new Date(date + "T12:00:00");
    const cap = effectiveDailyCapacityMinutes(d, config, people, unavailability, blockedDays);
    capacityCache.set(date, cap);
    return cap;
  }

  // Accumulator state.
  const days = new Map<string, DayState>();
  const mouldSpans: MouldSpan[] = [];

  // Seed day-level session locks from existing planStepStatus. The
  // rule: if a step is marked done for any batch, that step's session
  // is closed for every day that same step is currently scheduled on.
  // At scheduler time (regenerating drafts), drafts have no status rows
  // yet, so this mostly matters for mid-lifecycle reruns.
  const lockedStepsByDate = new Map<string, Set<string>>();
  const activePlanIds = new Set(plans.filter((p) => p.status === "active").map((p) => p.id!));
  for (const s of planStepStatus) {
    if (!s.done) continue;
    if (!activePlanIds.has(s.planId)) continue;
    // Without productionDayLineItems for active plans, we can't map
    // step→date precisely. Future extension: pass lineItems in and
    // look up the date. For now, session locks only bind once we also
    // have lineItems to key against; a later pass will wire this.
    // Placeholder: no-op. Keep the variable so tests can assert on it.
    void lockedStepsByDate;
  }

  const bufferDays = Math.max(0, Math.round(config?.productionBufferDays ?? DEFAULT_BUFFER_DAYS));
  const mergingWindowWeeks = (config?.mergingWindowWeeks ?? DEFAULT_MERGING_WINDOW_WEEKS) as 1 | 2 | 4;
  const mergingWindowDays = mergingWindowWeeks * 7;
  const todayIso = toIsoDate(new Date());

  for (const plan of sortedPlans) {
    const flat = flatByPlan.get(plan.id!)!;
    const mouldId = planMouldId.get(plan.id!)!;
    const deadlineMs = planDeadline.get(plan.id!);

    // Mode decision.
    const daysToDeadline = deadlineMs !== undefined
      ? Math.round((deadlineMs - new Date(todayIso + "T00:00:00").getTime()) / 86_400_000)
      : Number.POSITIVE_INFINITY;
    const mode: "forward" | "reverse" =
      daysToDeadline <= mergingWindowDays ? "forward" : "reverse";

    // latestDay = deadline − bufferDays (working days). When the
    // deadline is already in the past or would push the latest day
    // before today, we don't block placement — we schedule ASAP and
    // warn that the deadline is already unreachable. Blocking an
    // overdue batch from being scheduled meant ALL batches sharing
    // that batch (via the earliest-linked-deadline rule) went to
    // "unscheduled", even when some of their other orders had lots
    // of runway left.
    let latestDay: string | null = null;
    if (deadlineMs !== undefined) {
      const deadlineDate = new Date(deadlineMs);
      const probe = new Date(deadlineDate);
      probe.setHours(12, 0, 0, 0);
      let remaining = bufferDays;
      let found: string | null = null;
      for (let i = 0; i < MAX_WORKING_DAY_SEARCH; i++) {
        if (bufferDays === 0) {
          if (capFor(toIsoDate(probe)) > 0) { found = toIsoDate(probe); break; }
          probe.setDate(probe.getDate() - 1);
        } else {
          probe.setDate(probe.getDate() - 1);
          if (capFor(toIsoDate(probe)) > 0) {
            remaining--;
            if (remaining === 0) { found = toIsoDate(probe); break; }
          }
        }
      }
      latestDay = found;
      if (!latestDay || latestDay < todayIso) {
        // Overdue: soft-fail the deadline cap, schedule ASAP, warn.
        warnings.push(
          `Batch "${plan.name}" is past its earliest linked deadline — scheduling ASAP (will finish after deadline).`,
        );
        latestDay = null;
      }
    }

    // Reverse mode needs a concrete anchor. If latestDay dropped to
    // null (e.g. buffer couldn't find enough working days before
    // today), fall back to forward-fill from today.
    const effectiveMode: "forward" | "reverse" =
      mode === "reverse" && latestDay ? "reverse" : "forward";
    const mouldConflictLog: Array<{ date: string; blockedBy: string }> = [];
    // Packing-only batches bypass the mould-availability check — they
    // don't use the mould, they just pack pieces out of stock.
    const packingOnly = (plan.name ?? "").trim().endsWith("— packing");
    const effectiveMouldId = packingOnly ? "__packing_no_mould__" : mouldId;
    // Mould capacity = how many physical copies of this mould the user
    // owns. A 30-cavity square mould that the user owns 60 of can serve
    // up to 60 concurrent batches. quantityOwned defaults to 1 when the
    // mould record doesn't carry it.
    const mouldRecord = mouldById.get(mouldId);
    const mouldCapacity = packingOnly
      ? Number.MAX_SAFE_INTEGER
      : Math.max(1, mouldRecord?.quantityOwned ?? 1);
    const placement = effectiveMode === "forward"
      ? placeForward(flat, effectiveMouldId, mouldCapacity, plan.id!, todayIso, latestDay, days, mouldSpans, capFor, lockedStepsByDate, packingOnly ? undefined : mouldConflictLog)
      : placeReverse(flat, effectiveMouldId, mouldCapacity, plan.id!, latestDay!, todayIso, days, mouldSpans, capFor, lockedStepsByDate);
    // Surface mould-sharing conflicts: if placement got bumped off
    // earlier days because another batch was already using the mould,
    // emit a warning with the other batch's name. This is why two
    // batches on "different products" sometimes land on separate days:
    // they share a default mould in /products.
    if (mouldConflictLog.length > 0) {
      const uniqueBlockers = [...new Set(mouldConflictLog.map((c) => c.blockedBy))];
      const blockerNames = uniqueBlockers.map((pid) => {
        const p = plans.find((x) => x.id === pid);
        return p?.name ?? pid;
      });
      warnings.push(
        `Batch "${plan.name}" shares a mould with ${blockerNames.join(", ")} — scheduled for the next mould-free day.`,
      );
    }

    if (!placement) {
      unscheduled.add(plan.id!);
      warnings.push(`Couldn't place batch "${plan.name}" — no fitting day sequence (mould / capacity / window).`);
      continue;
    }

    // Commit: update accumulators.
    let polishDay: string | null = null;
    let unmouldDay: string | null = null;
    for (const p of placement) {
      const state = days.get(p.date) ?? {
        date: p.date, capacity: capFor(p.date), used: 0,
        placements: new Map(), lockedStepIds: new Set(),
      };
      state.used += p.minutes;
      state.placements.set(plan.id!, {
        stepIds: p.stepIds,
        minutes: p.minutes,
        sortOrder: state.placements.size,
      });
      days.set(p.date, state);
      // Track mould span.
      if (p.stepIds.some((sid) => flat.find((f) => f.stepId === sid)?.isMouldLockStart)) {
        if (!polishDay || p.date < polishDay) polishDay = p.date;
      }
      if (p.stepIds.some((sid) => flat.find((f) => f.stepId === sid)?.isMouldLockEnd)) {
        if (!unmouldDay || p.date > unmouldDay) unmouldDay = p.date;
      }
    }
    // Packing-only batches don't drive mould occupancy — they just
    // box pre-made pieces. Skip recording a span so they don't push
    // same-mould produce batches off their day.
    const isPackingBatch = (plan.name ?? "").trim().endsWith("— packing");
    if (!isPackingBatch) {
      if (polishDay && unmouldDay && mouldId) {
        mouldSpans.push({
          mouldId,
          from: polishDay,
          to: unmouldDay,
          planId: plan.id!,
        });
      } else if (placement.length > 0 && mouldId) {
        // Fallback: lock the entire placed span even if we didn't detect
        // polishing / unmoulding by name (custom step labels).
        mouldSpans.push({
          mouldId,
          from: placement[0].date,
          to: placement[placement.length - 1].date,
          planId: plan.id!,
        });
      }
    }
  }

  // Build output.
  const dayList = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  const productionDaysOut: ProposedProductionDay[] = dayList.map((d) => ({ date: d.date }));
  const lineItemsOut: ProposedLineItem[] = [];
  for (const d of dayList) {
    const entries = [...d.placements.entries()]
      .sort((a, b) => a[1].sortOrder - b[1].sortOrder);
    for (const [planId, pl] of entries) {
      const steps = [...pl.stepIds].sort((a, b) => {
        const sa = (stepById.get(a)?.sortOrder ?? 0);
        const sb = (stepById.get(b)?.sortOrder ?? 0);
        return sa - sb;
      });
      lineItemsOut.push({
        dateRef: d.date,
        planId,
        stepIds: steps,
        plannedMinutes: pl.minutes,
        sortOrder: pl.sortOrder,
      });
    }
  }

  return {
    days: productionDaysOut,
    lineItems: lineItemsOut,
    warnings,
    unscheduledPlanIds: [...unscheduled],
  };
}

/**
 * Forward-fill: start from `todayIso`, pack steps in sortOrder across
 * consecutive working days until all are placed or `latestDay` is
 * reached. Returns null if the batch can't fit.
 */
function placeForward(
  flat: FlatStep[],
  mouldId: string,
  mouldCapacity: number,
  planId: string,
  todayIso: string,
  latestDay: string | null,
  days: Map<string, DayState>,
  mouldSpans: MouldSpan[],
  capFor: (date: string) => number,
  lockedStepsByDate: Map<string, Set<string>>,
  /** Out-param collecting mould-conflict hits per date, so the caller
   *  can emit a warning explaining why a batch got bumped to a later
   *  day than it "should" fit on. */
  mouldConflictLog?: Array<{ date: string; blockedBy: string }>,
): Array<{ date: string; stepIds: string[]; minutes: number }> | null {
  const result: Array<{ date: string; stepIds: string[]; minutes: number }> = [];
  let stepIdx = 0;
  let cursor = todayIso;

  // Ensure cursor is a working day.
  cursor = advanceToWorkingDay(cursor, capFor);

  while (stepIdx < flat.length) {
    if (latestDay && cursor > latestDay) return null;

    // Mould availability check for this date.
    const conflictSpan = firstConflictingSpan(mouldId, cursor, cursor, planId, mouldSpans, mouldCapacity);
    if (conflictSpan) {
      if (mouldConflictLog) mouldConflictLog.push({ date: cursor, blockedBy: conflictSpan.planId });
      cursor = advanceDay(cursor);
      cursor = advanceToWorkingDay(cursor, capFor);
      continue;
    }

    const cap = capFor(cursor);
    const existing = days.get(cursor);
    const used = existing?.used ?? 0;
    let remaining = cap - used;
    const locked = lockedStepsByDate.get(cursor) ?? new Set<string>();

    const stepsToday: string[] = [];
    let minutesToday = 0;

    while (stepIdx < flat.length) {
      const s = flat[stepIdx];
      if (locked.has(s.stepId)) break; // session locked, spill
      if (s.activeMinutes > remaining) break; // no room today
      stepsToday.push(s.stepId);
      minutesToday += s.activeMinutes;
      remaining -= s.activeMinutes;
      stepIdx++;
    }

    if (stepsToday.length > 0) {
      result.push({ date: cursor, stepIds: stepsToday, minutes: minutesToday });
    } else if (stepIdx < flat.length && flat[stepIdx].activeMinutes > cap) {
      // A single step is larger than any day's capacity — unplaceable.
      return null;
    }

    cursor = advanceDay(cursor);
    cursor = advanceToWorkingDay(cursor, capFor);
  }

  return result;
}

/**
 * Reverse-schedule: start from `latestDay`, place steps in reverse
 * sortOrder across working days backwards until all placed or
 * `earliestDay` (today) is hit. Returns null if the batch can't fit.
 *
 * The result is returned in chronological order (Polish → Unmould),
 * matching forward-fill's shape.
 */
function placeReverse(
  flat: FlatStep[],
  mouldId: string,
  mouldCapacity: number,
  planId: string,
  latestDay: string,
  earliestDay: string,
  days: Map<string, DayState>,
  mouldSpans: MouldSpan[],
  capFor: (date: string) => number,
  lockedStepsByDate: Map<string, Set<string>>,
): Array<{ date: string; stepIds: string[]; minutes: number }> | null {
  const reverseFlat = [...flat].reverse();
  const result: Array<{ date: string; stepIds: string[]; minutes: number }> = [];
  let stepIdx = 0;
  let cursor = latestDay;

  cursor = retreatToWorkingDay(cursor, capFor);

  while (stepIdx < reverseFlat.length) {
    if (cursor < earliestDay) return null;

    if (mouldConflicts(mouldId, cursor, cursor, planId, mouldSpans, mouldCapacity)) {
      cursor = retreatDay(cursor);
      cursor = retreatToWorkingDay(cursor, capFor);
      continue;
    }

    const cap = capFor(cursor);
    const existing = days.get(cursor);
    const used = existing?.used ?? 0;
    let remaining = cap - used;
    const locked = lockedStepsByDate.get(cursor) ?? new Set<string>();

    const stepsToday: string[] = []; // collected in reverse order
    let minutesToday = 0;

    while (stepIdx < reverseFlat.length) {
      const s = reverseFlat[stepIdx];
      if (locked.has(s.stepId)) break;
      if (s.activeMinutes > remaining) break;
      stepsToday.push(s.stepId);
      minutesToday += s.activeMinutes;
      remaining -= s.activeMinutes;
      stepIdx++;
    }

    if (stepsToday.length > 0) {
      // stepsToday is reverse-ordered (latest step first). Re-sort to
      // chronological within the day when emitting.
      result.unshift({ date: cursor, stepIds: stepsToday.reverse(), minutes: minutesToday });
    } else if (stepIdx < reverseFlat.length && reverseFlat[stepIdx].activeMinutes > cap) {
      return null;
    }

    cursor = retreatDay(cursor);
    cursor = retreatToWorkingDay(cursor, capFor);
  }

  return result;
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Mould availability respects physical inventory. A mould definition
 * has `quantityOwned` — if the user owns 60 copies of the same mould
 * (realistic for small chocolatiers with mass-production squares),
 * up to 60 batches can run concurrently on the same mouldId.
 *
 * `mouldCapacity` defaults to 1 when the mould record doesn't carry
 * `quantityOwned`.
 */
function mouldConflicts(
  mouldId: string,
  from: string,
  to: string,
  excludePlanId: string,
  spans: MouldSpan[],
  mouldCapacity: number,
): boolean {
  return firstConflictingSpan(mouldId, from, to, excludePlanId, spans, mouldCapacity) !== null;
}

function firstConflictingSpan(
  mouldId: string,
  from: string,
  to: string,
  excludePlanId: string,
  spans: MouldSpan[],
  mouldCapacity: number,
): MouldSpan | null {
  // Count concurrent occupants of this mould on the proposed span.
  // If the count has room (< capacity), no conflict. Otherwise return
  // one of the blocking spans so callers can report it.
  let overlapping: MouldSpan[] = [];
  for (const s of spans) {
    if (s.mouldId !== mouldId) continue;
    if (s.planId === excludePlanId) continue;
    if (s.to < from || s.from > to) continue;
    overlapping.push(s);
  }
  if (overlapping.length < Math.max(1, mouldCapacity)) return null;
  return overlapping[0];
}

function advanceDay(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return toIsoDate(d);
}

function retreatDay(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() - 1);
  return toIsoDate(d);
}

function advanceToWorkingDay(iso: string, capFor: (d: string) => number): string {
  let cursor = iso;
  for (let i = 0; i < MAX_WORKING_DAY_SEARCH; i++) {
    if (capFor(cursor) > 0) return cursor;
    cursor = advanceDay(cursor);
  }
  return cursor;
}

function retreatToWorkingDay(iso: string, capFor: (d: string) => number): string {
  let cursor = iso;
  for (let i = 0; i < MAX_WORKING_DAY_SEARCH; i++) {
    if (capFor(cursor) > 0) return cursor;
    cursor = retreatDay(cursor);
  }
  return cursor;
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
