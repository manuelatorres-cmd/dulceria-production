/**
 * Spec MANUAL_PLANNER_WORKSPACE_BATCH.md §4.3
 *
 * Combine two drafts targeting the same mould into one. Allocations
 * from `otherPlanId` are merged into `activeDraft` (localStorage), the
 * other plan + its links are deleted from DB.
 *
 * Validation:
 *   - Both must share the same `mouldId`. Throws otherwise.
 *
 * After this call:
 *   - localStorage active draft has every allocation from both sources,
 *     duplicates merged by (source, parentId).
 *   - DB row for `otherPlanId` (and its orderPlanLinks / poPlanLinks
 *     children via CASCADE) is gone.
 */

import { supabase } from "@/lib/supabase";
import { queryClient } from "@/lib/query-client";
import { loadDraftFromPlan } from "./load-draft-from-plan";
import {
  type DraftAllocation,
  type DraftBatch,
  recomputeBatchTotals,
} from "./draft-state";

export async function mergeDrafts(
  activeDraft: DraftBatch,
  otherPlanId: string,
): Promise<DraftBatch> {
  const other = await loadDraftFromPlan(otherPlanId);
  if (other.mouldId !== activeDraft.mouldId) {
    throw new Error(
      `Cannot merge: drafts use different moulds (${activeDraft.mouldName} vs ${other.mouldName}).`,
    );
  }

  // Merge allocations by (source, parentId) so a duplicate line picks
  // up the larger qty rather than double-counting.
  const byKey = new Map<string, DraftAllocation>();
  for (const a of activeDraft.allocations) {
    byKey.set(`${a.source}|${a.parentId}`, { ...a });
  }
  for (const a of other.allocations) {
    const key = `${a.source}|${a.parentId}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.qty += a.qty;
    } else {
      byKey.set(key, { ...a });
    }
  }
  const merged: DraftBatch = recomputeBatchTotals({
    ...activeDraft,
    allocations: [...byKey.values()],
    notes:
      [activeDraft.notes.trim(), other.notes.trim()].filter(Boolean).join("\n") ||
      activeDraft.notes,
  });

  // Drop the other plan + its links via cascade.
  const { error } = await supabase.from("productionPlans").delete().eq("id", otherPlanId);
  if (error) throw error;

  queryClient.invalidateQueries({ queryKey: ["production-plans"] });
  queryClient.invalidateQueries({ queryKey: ["plan-products"] });
  queryClient.invalidateQueries({ queryKey: ["order-plan-links"] });
  queryClient.invalidateQueries({ queryKey: ["po-plan-links"] });

  return merged;
}
