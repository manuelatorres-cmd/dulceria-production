/**
 * Hard-delete a parked productionPlans row. ON DELETE CASCADE on the
 * orderPlanLinks + poPlanLinks + planProducts FKs cleans the children.
 *
 * Guard: refuses to delete anything except status='draft' rows so a
 * misfired call from the DraftsTray can't wipe an active or done
 * batch.
 */

import { supabase } from "@/lib/supabase";
import { assertOkMaybe } from "@/lib/supabase-query";
import { queryClient } from "@/lib/query-client";
import type { ProductionPlan } from "@/types";

export async function deleteParkedDraft(planId: string): Promise<void> {
  const plan = assertOkMaybe(
    await supabase
      .from("productionPlans")
      .select("id, status")
      .eq("id", planId)
      .maybeSingle(),
  ) as Pick<ProductionPlan, "id" | "status"> | null;

  if (!plan) {
    // Nothing to delete; treat as success so the UI can clear stale
    // cards without erroring.
    return;
  }
  if (plan.status !== "draft") {
    throw new Error(
      `Refusing to delete plan ${planId}: status is '${plan.status}', not 'draft'.`,
    );
  }

  const { error } = await supabase.from("productionPlans").delete().eq("id", planId);
  if (error) throw error;

  queryClient.invalidateQueries({ queryKey: ["production-plans"] });
  queryClient.invalidateQueries({ queryKey: ["plan-products"] });
  queryClient.invalidateQueries({ queryKey: ["order-plan-links"] });
  queryClient.invalidateQueries({ queryKey: ["po-plan-links"] });
}
