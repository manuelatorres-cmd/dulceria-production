/**
 * Bulk-move every plan that has line items on a given source date to a
 * new target date. Used by the day-detail drawer's "Reschedule day"
 * action — sick day / shop closed scenarios.
 *
 * Capacity check on the target day is intentionally NOT enforced here
 * (spec deferred item §3). The drawer surfaces the action with a
 * confirm; the user accepts the consequences.
 */

import { moveProductionPlansToDate } from "@/lib/hooks";
import { queryClient } from "@/lib/query-client";
import type { ProductionDay, ProductionDayLineItem } from "@/types";

export interface RescheduleDayInput {
  sourceDate: string;
  targetDate: string;
  /** Whether the moved plans should be pinned to the target date. */
  pin: boolean;
  productionDays: ProductionDay[];
  lineItems: ProductionDayLineItem[];
}

export async function rescheduleDay(input: RescheduleDayInput): Promise<{ moved: number }> {
  const dayId = input.productionDays.find(
    (d) => d.date && d.date.slice(0, 10) === input.sourceDate,
  )?.id;
  if (!dayId) return { moved: 0 };
  const planIds = Array.from(
    new Set(
      input.lineItems
        .filter((li) => li.productionDayId === dayId)
        .map((li) => li.planId),
    ),
  );
  if (planIds.length === 0) return { moved: 0 };
  await moveProductionPlansToDate({
    planIds,
    targetDate: input.targetDate,
    pin: input.pin,
  });
  queryClient.invalidateQueries({ queryKey: ["productionDayLineItems"] });
  queryClient.invalidateQueries({ queryKey: ["production-plans"] });
  return { moved: planIds.length };
}
