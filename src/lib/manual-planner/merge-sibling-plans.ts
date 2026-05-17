/**
 * Spec MANUAL_PLANNER_WORKSPACE_BATCH1.md §3.10 / §4.8
 *
 * Inverse of splitPlan. Two plans that share a siblingGroupId merge
 * back into one. The survivor:
 *   - has the earlier pinnedDate (or active wins over draft if mixed)
 *   - absorbs the other plan's planProducts.quantity (mould fills)
 *   - absorbs every link, summing matching orderItemId / poItemId
 *
 * The other plan is deleted (FK cascades clear its link rows).
 * If the survivor is the only remaining plan with that siblingGroupId,
 * the column is cleared.
 *
 * Distinct from mergeDrafts in merge-drafts.ts:
 *   - mergeDrafts is for build-phase active+parked drafts targeting
 *     the same mould; result lands in localStorage.
 *   - mergeSiblingPlans is for pinned/scheduled siblings created via
 *     splitPlan; result is a DB-only mutation.
 */

import { supabase } from "@/lib/supabase";
import { assertOk, assertOkMaybe } from "@/lib/supabase-query";
import { queryClient } from "@/lib/query-client";
import type {
  OrderPlanLink,
  PlanProduct,
  PoPlanLink,
  ProductionPlan,
} from "@/types";

export async function mergeSiblingPlans(planAId: string, planBId: string): Promise<string> {
  const [a, b] = await Promise.all([
    supabase.from("productionPlans").select("*").eq("id", planAId).maybeSingle(),
    supabase.from("productionPlans").select("*").eq("id", planBId).maybeSingle(),
  ]);
  const planA = assertOkMaybe(a) as ProductionPlan | null;
  const planB = assertOkMaybe(b) as ProductionPlan | null;
  if (!planA || !planB) throw new Error("One or both plans not found.");
  if (!planA.siblingGroupId || planA.siblingGroupId !== planB.siblingGroupId) {
    throw new Error("Plans don't share a siblingGroupId — not siblings.");
  }

  const [ppA, ppB] = await Promise.all([
    supabase.from("planProducts").select("*").eq("planId", planAId).maybeSingle(),
    supabase.from("planProducts").select("*").eq("planId", planBId).maybeSingle(),
  ]);
  const planProductA = assertOkMaybe(ppA) as PlanProduct | null;
  const planProductB = assertOkMaybe(ppB) as PlanProduct | null;
  if (!planProductA || !planProductB) throw new Error("planProducts row missing for one of the siblings.");
  if (planProductA.productId !== planProductB.productId) {
    throw new Error("Siblings have different productIds — refuse to merge.");
  }
  if (planProductA.mouldId !== planProductB.mouldId) {
    throw new Error("Siblings have different mouldIds — refuse to merge.");
  }

  // Pick survivor: earlier pinnedDate wins, ties broken by status='active'.
  const survivor =
    planA.pinnedDate && planB.pinnedDate && planA.pinnedDate < planB.pinnedDate
      ? planA
      : planA.pinnedDate && planB.pinnedDate && planB.pinnedDate < planA.pinnedDate
        ? planB
        : planA.status === "active" && planB.status !== "active"
          ? planA
          : planB.status === "active" && planA.status !== "active"
            ? planB
            : planA;
  const merged = survivor.id === planA.id ? planB : planA;
  const survivorPp = survivor.id === planA.id ? planProductA : planProductB;
  const mergedPp = merged.id === planA.id ? planProductA : planProductB;

  const now = new Date();

  // Sum quantities on survivor's planProducts.
  await supabase
    .from("planProducts")
    .update({ quantity: survivorPp.quantity + mergedPp.quantity })
    .eq("id", survivorPp.id);

  // Allocations: sum into survivor.
  const survivorOpl = assertOk(
    await supabase.from("orderPlanLinks").select("*").eq("planId", survivor.id),
  ) as OrderPlanLink[];
  const mergedOpl = assertOk(
    await supabase.from("orderPlanLinks").select("*").eq("planId", merged.id),
  ) as OrderPlanLink[];
  const survivorByOrderItem = new Map(survivorOpl.map((l) => [l.orderItemId, l]));
  for (const link of mergedOpl) {
    const match = survivorByOrderItem.get(link.orderItemId);
    if (match) {
      await supabase
        .from("orderPlanLinks")
        .update({
          allocatedQuantity: match.allocatedQuantity + link.allocatedQuantity,
          updatedAt: now,
        })
        .eq("id", match.id);
    } else {
      await supabase.from("orderPlanLinks").insert({
        id: link.id ?? undefined,
        orderItemId: link.orderItemId,
        planId: survivor.id!,
        allocatedQuantity: link.allocatedQuantity,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  const survivorPpl = assertOk(
    await supabase.from("poPlanLinks").select("*").eq("planId", survivor.id),
  ) as PoPlanLink[];
  const mergedPpl = assertOk(
    await supabase.from("poPlanLinks").select("*").eq("planId", merged.id),
  ) as PoPlanLink[];
  const survivorByPo = new Map(survivorPpl.map((l) => [l.productionOrderItemId, l]));
  for (const link of mergedPpl) {
    const match = survivorByPo.get(link.productionOrderItemId);
    if (match) {
      await supabase
        .from("poPlanLinks")
        .update({
          allocatedQuantity: match.allocatedQuantity + link.allocatedQuantity,
          updatedAt: now,
        })
        .eq("id", match.id);
    } else {
      await supabase.from("poPlanLinks").insert({
        id: link.id ?? undefined,
        productionOrderItemId: link.productionOrderItemId,
        planId: survivor.id!,
        allocatedQuantity: link.allocatedQuantity,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // Drop merged-from plan (FK cascades remove its leftover links + planProducts).
  await supabase.from("productionPlans").delete().eq("id", merged.id!);

  // Check: if survivor is the only plan left in this siblingGroupId, clear.
  const stillInGroup = assertOk(
    await supabase
      .from("productionPlans")
      .select("id")
      .eq("siblingGroupId", survivor.siblingGroupId!),
  ) as Array<{ id: string }>;
  if (stillInGroup.length <= 1) {
    await supabase
      .from("productionPlans")
      .update({ siblingGroupId: null, updatedAt: now })
      .eq("id", survivor.id!);
  }

  queryClient.invalidateQueries({ queryKey: ["production-plans"] });
  queryClient.invalidateQueries({ queryKey: ["plan-products"] });
  queryClient.invalidateQueries({ queryKey: ["order-plan-links"] });
  queryClient.invalidateQueries({ queryKey: ["po-plan-links"] });

  return survivor.id!;
}
