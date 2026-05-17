/**
 * Spec MANUAL_PLANNER_WORKSPACE_BATCH1.md §3.9 / §4.7
 *
 * Split a pinned plan into two: keep `originalFills - fillsToMove` on
 * the original row, move `fillsToMove` onto a fresh productionPlans
 * row. Both rows share a `siblingGroupId` (mig 0096) so the peek
 * popover can offer "Merge with sibling".
 *
 * Allocations (orderPlanLinks + poPlanLinks) are redistributed
 * proportionally: each link's allocatedQuantity is split by
 * `floor(origQty * fillsToMove / totalFills)`. Rows with 0 left after
 * subtract are deleted; non-zero rows on the new plan are inserted.
 *
 * Out of scope (logged in commit / spec §8):
 *   - productionDayLineItems for the new plan (stage scheduling
 *     starts empty for split-derived plans)
 *   - manual per-allocation reassignment during split (proportional only)
 *
 * Only works on plans that have a planProducts row + valid mould.
 */

import { supabase, newId } from "@/lib/supabase";
import { assertOk, assertOkMaybe } from "@/lib/supabase-query";
import { queryClient } from "@/lib/query-client";
import type {
  OrderPlanLink,
  PlanProduct,
  PoPlanLink,
  ProductionPlan,
} from "@/types";

export type SplitTarget = { kind: "day"; date: string } | { kind: "pool" };

export interface SplitPlanResult {
  originalPlanId: string;
  newPlanId: string;
  siblingGroupId: string;
}

export async function splitPlan(
  planId: string,
  fillsToMove: number,
  target: SplitTarget,
): Promise<SplitPlanResult> {
  if (fillsToMove <= 0) throw new Error("fillsToMove must be > 0");

  const original = assertOkMaybe(
    await supabase.from("productionPlans").select("*").eq("id", planId).maybeSingle(),
  ) as ProductionPlan | null;
  if (!original) throw new Error(`Plan ${planId} not found.`);

  const origPp = assertOkMaybe(
    await supabase
      .from("planProducts")
      .select("*")
      .eq("planId", planId)
      .maybeSingle(),
  ) as PlanProduct | null;
  if (!origPp) throw new Error(`Plan ${planId} has no planProducts row.`);

  const totalFills = origPp.quantity;
  if (fillsToMove >= totalFills) {
    throw new Error(`Cannot split: fillsToMove (${fillsToMove}) must be < totalFills (${totalFills}).`);
  }

  const oplRows = assertOk(
    await supabase.from("orderPlanLinks").select("*").eq("planId", planId),
  ) as OrderPlanLink[];
  const pplRows = assertOk(
    await supabase.from("poPlanLinks").select("*").eq("planId", planId),
  ) as PoPlanLink[];

  // siblingGroupId: reuse if set, else mint a new one.
  const siblingGroupId = original.siblingGroupId ?? newId();
  if (!original.siblingGroupId) {
    const { error } = await supabase
      .from("productionPlans")
      .update({ siblingGroupId, updatedAt: new Date() })
      .eq("id", planId);
    if (error) throw error;
  }

  const newPlanId = newId();
  const newStatus = target.kind === "day" ? "active" : "draft";
  const newPinnedDate = target.kind === "day" ? target.date : null;
  const now = new Date();
  const { error: insertErr } = await supabase.from("productionPlans").insert({
    id: newPlanId,
    name: `${original.name} · split`,
    status: newStatus,
    pinnedDate: newPinnedDate,
    siblingGroupId,
    createdAt: now,
    updatedAt: now,
    surplusDestination: original.surplusDestination ?? null,
    notes: original.notes ?? null,
  });
  if (insertErr) throw insertErr;

  const { error: ppInsertErr } = await supabase.from("planProducts").insert({
    id: newId(),
    planId: newPlanId,
    productId: origPp.productId,
    mouldId: origPp.mouldId,
    quantity: fillsToMove,
    sortOrder: 0,
  });
  if (ppInsertErr) throw ppInsertErr;

  const { error: ppUpdErr } = await supabase
    .from("planProducts")
    .update({ quantity: totalFills - fillsToMove })
    .eq("id", origPp.id);
  if (ppUpdErr) throw ppUpdErr;

  // Allocation redistribution: floor(origQty * fillsToMove / totalFills)
  for (const link of oplRows) {
    const moveQty = Math.floor((link.allocatedQuantity * fillsToMove) / totalFills);
    if (moveQty <= 0) continue;
    const remaining = link.allocatedQuantity - moveQty;
    await supabase.from("orderPlanLinks").insert({
      id: newId(),
      orderItemId: link.orderItemId,
      planId: newPlanId,
      allocatedQuantity: moveQty,
      createdAt: now,
      updatedAt: now,
    });
    if (remaining <= 0) {
      await supabase.from("orderPlanLinks").delete().eq("id", link.id);
    } else {
      await supabase
        .from("orderPlanLinks")
        .update({ allocatedQuantity: remaining, updatedAt: now })
        .eq("id", link.id);
    }
  }
  for (const link of pplRows) {
    const moveQty = Math.floor((link.allocatedQuantity * fillsToMove) / totalFills);
    if (moveQty <= 0) continue;
    const remaining = link.allocatedQuantity - moveQty;
    await supabase.from("poPlanLinks").insert({
      id: newId(),
      productionOrderItemId: link.productionOrderItemId,
      planId: newPlanId,
      allocatedQuantity: moveQty,
      createdAt: now,
      updatedAt: now,
    });
    if (remaining <= 0) {
      await supabase.from("poPlanLinks").delete().eq("id", link.id);
    } else {
      await supabase
        .from("poPlanLinks")
        .update({ allocatedQuantity: remaining, updatedAt: now })
        .eq("id", link.id);
    }
  }

  queryClient.invalidateQueries({ queryKey: ["production-plans"] });
  queryClient.invalidateQueries({ queryKey: ["plan-products"] });
  queryClient.invalidateQueries({ queryKey: ["order-plan-links"] });
  queryClient.invalidateQueries({ queryKey: ["po-plan-links"] });

  return { originalPlanId: planId, newPlanId, siblingGroupId };
}
