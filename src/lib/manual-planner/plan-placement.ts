/**
 * Spec MANUAL_PLANNER_WORKSPACE_BATCH1.md §4.9 / §4.10 / §4.11
 *
 * Single-field drag-flow primitives:
 *   - movePinnedToDay → existing pinned plan moves from one day to another
 *   - unpinToPool     → pinned plan → pool (status='draft', pinnedDate=null)
 *   - pinFromPool     → pool draft → pinned day (status='active', pinnedDate=<date>)
 *
 * `unpinToPool` deliberately keeps the plan's allocations + line items
 * intact — the operator is choosing to deschedule, not delete. The
 * `productionDayLineItems` rows stay on disk; when the plan gets
 * re-pinned they will reappear on whichever day they belonged to. If
 * the desired UX is "wipe stage assignments on unpin", layer that on
 * later.
 */

import { supabase } from "@/lib/supabase";
import { queryClient } from "@/lib/query-client";

function invalidate(): void {
  queryClient.invalidateQueries({ queryKey: ["production-plans"] });
  queryClient.invalidateQueries({ queryKey: ["productionDays"] });
  queryClient.invalidateQueries({ queryKey: ["productionDayLineItems"] });
  queryClient.invalidateQueries({ queryKey: ["production-day-line-items"] });
}

export async function movePinnedToDay(planId: string, toDate: string): Promise<void> {
  const { error } = await supabase
    .from("productionPlans")
    .update({ pinnedDate: toDate, updatedAt: new Date() })
    .eq("id", planId);
  if (error) throw error;
  invalidate();
}

export async function unpinToPool(planId: string): Promise<void> {
  const { error } = await supabase
    .from("productionPlans")
    .update({ status: "draft", pinnedDate: null, updatedAt: new Date() })
    .eq("id", planId);
  if (error) throw error;
  invalidate();
}

export async function pinFromPool(planId: string, toDate: string): Promise<void> {
  const { error } = await supabase
    .from("productionPlans")
    .update({ status: "active", pinnedDate: toDate, updatedAt: new Date() })
    .eq("id", planId);
  if (error) throw error;
  invalidate();
}
