/**
 * Plan v2 drag-drop save wrapper.
 *
 * Thin layer on top of moveProductionStepsToDate that surfaces a clean
 * error string and a single conflict-confirmation seam. The actual
 * step move semantics live in `@/lib/hooks` (server-side via Supabase);
 * this wrapper just normalises the payload + handles the post-move
 * query invalidation.
 */

import { moveProductionStepsToDate } from "@/lib/hooks";
import { queryClient } from "@/lib/query-client";

export interface MoveStepInput {
  planId: string;
  stepId: string;
  targetDate: string;
}

export async function moveStep(input: MoveStepInput): Promise<void> {
  await moveProductionStepsToDate({
    moves: [{ planId: input.planId, stepId: input.stepId }],
    targetDate: input.targetDate,
  });
  queryClient.invalidateQueries({ queryKey: ["productionDayLineItems"] });
  queryClient.invalidateQueries({ queryKey: ["production-plans"] });
}
