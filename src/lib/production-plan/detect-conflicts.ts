/**
 * Soft-conflict detection for plan v2 drag-drop.
 *
 * The reconciler already enforces hard constraints; this helper raises
 * UI warnings ahead of the save call so the user can confirm or cancel.
 *
 * Returns `[]` when nothing is wrong. Caller surfaces the messages in
 * a confirm dialog. None of these are showstoppers — only the "closed
 * day" check is treated as a hard reject (and that's enforced earlier
 * by the droppable's `disabled` flag).
 */

import type { Mould, PlanProduct, ProductionDayLineItem, ProductionPlan } from "@/types";

export type ConflictKind = "capacity" | "mould" | "dependency";

export interface DetectedConflict {
  kind: ConflictKind;
  message: string;
}

export interface DetectConflictsInput {
  /** ISO yyyy-mm-dd of the day the step is being moved to. */
  targetDate: string;
  /** plannedMinutes of the step being moved. */
  movedMinutes: number;
  /** planId the moved step belongs to — excluded from mould overlap check. */
  movingPlanId: string;
  /** planProductId of the moving plan, used for mould lookup. */
  movingMouldId: string | null;
  /** Sum of plannedMinutes already on the target day. */
  existingUsedMinutes: number;
  /** Effective daily capacity in minutes. */
  capacityMinutes: number;
  /** Warn / critical thresholds (percent). */
  warnPercent: number;
  criticalPercent: number;
  /** Other lineItems on the target day — used for mould double-book. */
  targetDayLineItems: ProductionDayLineItem[];
  /** All plans (status filter applied by caller). */
  plans: ProductionPlan[];
  /** All planProducts. */
  planProducts: PlanProduct[];
  moulds: Mould[];
}

export function detectConflicts(input: DetectConflictsInput): DetectedConflict[] {
  const out: DetectedConflict[] = [];

  // ── Capacity overflow ──────────────────────────────────────────
  if (input.capacityMinutes > 0) {
    const projected = input.existingUsedMinutes + input.movedMinutes;
    const pct = (projected / input.capacityMinutes) * 100;
    if (pct > input.criticalPercent) {
      out.push({
        kind: "capacity",
        message: `Day will be at ${Math.round(pct)}% capacity after the move (over ${input.criticalPercent}% threshold).`,
      });
    } else if (pct > input.warnPercent) {
      out.push({
        kind: "capacity",
        message: `Day will be at ${Math.round(pct)}% capacity after the move (over warn threshold).`,
      });
    }
  }

  // ── Mould double-booking ───────────────────────────────────────
  if (input.movingMouldId) {
    const mould = input.moulds.find((m) => m.id === input.movingMouldId);
    const cap = Math.max(1, mould?.quantityOwned ?? 1);
    const planById = new Map(input.plans.map((p) => [p.id!, p]));
    const ppByPlan = new Map<string, PlanProduct>();
    for (const pp of input.planProducts) {
      if (!ppByPlan.has(pp.planId)) ppByPlan.set(pp.planId, pp);
    }
    const mouldUsersOnDay = new Set<string>();
    for (const li of input.targetDayLineItems) {
      if (li.planId === input.movingPlanId) continue;
      const pp = ppByPlan.get(li.planId);
      if (!pp || pp.mouldId !== input.movingMouldId) continue;
      const plan = planById.get(li.planId);
      if (!plan) continue;
      if (plan.status === "done" || plan.status === "cancelled") continue;
      mouldUsersOnDay.add(li.planId);
    }
    if (mouldUsersOnDay.size + 1 > cap) {
      out.push({
        kind: "mould",
        message: `${mould?.name ?? "Mould"} already booked by ${mouldUsersOnDay.size} other plan${mouldUsersOnDay.size === 1 ? "" : "s"} on the target day (cap ${cap}).`,
      });
    }
  }

  return out;
}
