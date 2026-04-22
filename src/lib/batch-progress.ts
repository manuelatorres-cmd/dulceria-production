/**
 * Batch phase progress — compute "Step N/8 Label" for a given batch
 * from its planStepStatus rows.
 *
 * Rules:
 *   - Each stepKey is prefixed with its phase id (polishing, colour,
 *     shell, filling, fill, cap, unmould, packing). We partition the
 *     batch's rows by that prefix.
 *   - The "current" phase is the first phase, in canonical order,
 *     that is NOT yet fully complete. A phase is complete when every
 *     planStepStatus row for it has done=true AND at least one row
 *     exists (no-rows means it hasn't been started and so is the
 *     current phase if everything before it is complete).
 *   - When every phase is complete, we return Packing at index 8.
 */

import { STEP_GROUP_ORDER, STEP_GROUP_DISPLAY_LABEL, type StepGroup } from "@/lib/production";
import type { PlanStepStatus } from "@/types";

export interface BatchPhaseProgress {
  /** 1-indexed: Polishing = 1, Painting = 2, …, Packing = 8. */
  index: number;
  total: number;        // always 8
  phase: StepGroup;
  label: string;        // operator-facing name
  done: boolean;        // true when every phase is complete
}

export function batchPhaseProgress(
  planId: string,
  stepStatuses: PlanStepStatus[],
): BatchPhaseProgress {
  const hasAnyByPhase = new Map<StepGroup, number>();
  const doneByPhase = new Map<StepGroup, number>();
  for (const s of stepStatuses) {
    if (s.planId !== planId) continue;
    const phaseId = s.stepKey.split("-")[0] as StepGroup;
    if (!STEP_GROUP_ORDER.includes(phaseId)) continue;
    hasAnyByPhase.set(phaseId, (hasAnyByPhase.get(phaseId) ?? 0) + 1);
    if (s.done) doneByPhase.set(phaseId, (doneByPhase.get(phaseId) ?? 0) + 1);
  }

  for (let i = 0; i < STEP_GROUP_ORDER.length; i++) {
    const phase = STEP_GROUP_ORDER[i];
    const total = hasAnyByPhase.get(phase) ?? 0;
    const done = doneByPhase.get(phase) ?? 0;
    // Phase is the "current" one when it has pending work — either no
    // rows recorded yet (never started) or at least one row still
    // open.
    if (total === 0 || done < total) {
      return {
        index: i + 1,
        total: STEP_GROUP_ORDER.length,
        phase,
        label: STEP_GROUP_DISPLAY_LABEL[phase],
        done: false,
      };
    }
  }
  // Every phase is fully complete.
  const last = STEP_GROUP_ORDER[STEP_GROUP_ORDER.length - 1];
  return {
    index: STEP_GROUP_ORDER.length,
    total: STEP_GROUP_ORDER.length,
    phase: last,
    label: STEP_GROUP_DISPLAY_LABEL[last],
    done: true,
  };
}
