/**
 * Thin wrapper around moveProductionStepsToDate for the Gantt's
 * drag-stage-to-new-day flow (spec MANUAL_PLANNER_WEEK_VIEW_GANTT.md §4.3).
 *
 * Reuses the existing helper which already handles:
 *   - splitting stepIds out of the source line item (deleting the row
 *     if empty after removal)
 *   - merging into the destination line item (creating it + the
 *     productionDays row if missing)
 *   - bulk operation in one call (used by group drags on /plan?view=weekly)
 *
 * Past-day guard: refuse silently if the target date is before today.
 */

import { moveProductionStepsToDate } from "@/lib/hooks";
import { queryClient } from "@/lib/query-client";

export interface MoveStageDayInput {
  planId: string;
  stepId: string;
  targetDate: string; // ISO yyyy-mm-dd
}

export async function moveStageDay(input: MoveStageDayInput): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  if (input.targetDate < today) return; // hard reject per spec §4.3
  await moveProductionStepsToDate({
    moves: [{ planId: input.planId, stepId: input.stepId }],
    targetDate: input.targetDate,
  });
  queryClient.invalidateQueries({ queryKey: ["productionDayLineItems"] });
  queryClient.invalidateQueries({ queryKey: ["production-day-line-items"] });
  queryClient.invalidateQueries({ queryKey: ["production-plans"] });
}
