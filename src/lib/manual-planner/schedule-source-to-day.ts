/**
 * Spec MANUAL_PLANNER_SOURCE_FIRST_BATCH.md §4.5–§4.6
 *
 * One-shot action: take the operator's checked items + the picked day,
 * write all productionPlans + planProducts + orderPlanLinks +
 * poPlanLinks rows.
 *
 * Multi-product per plan note (spec §9):
 *   planProducts is many-to-one with productionPlans (mig 0001), so
 *   multiple rows per plan are allowed at the schema level. v1 still
 *   creates ONE plan per (productId, mouldId) combine — so a mould
 *   group of N distinct products becomes N plans sharing the same
 *   pinnedDate. Avoids the Plan(week) "1 plan = 1 product" assumption
 *   risk noted in spec §9. If that ever changes, switch to a single
 *   plan + N planProducts rows here.
 *
 * Past-day handling (spec §9):
 *   The Schedule action's UI handles the confirm prompt; this helper
 *   accepts an optional `historical` flag — when true, status='done'
 *   + completedAt=now instead of status='active'.
 *
 * Allocation rounding:
 *   Per-item portion of batch output = item.fillsNeeded × cavities,
 *   capped at item.remainingQty. The link row's allocatedQuantity =
 *   that capped figure. Surplus (batch yield > sum of allocations)
 *   absorbs the rounding, which is fine — surplusDestination defaults
 *   to 'store'.
 */

import { supabase, newId } from "@/lib/supabase";
import { queryClient } from "@/lib/query-client";
import { saveProductionPlan, savePlanProduct, saveOrderPlanLink, savePoPlanLink } from "@/lib/hooks";
import type { SourceItem } from "./source-types";

export interface ScheduleResult {
  createdPlanIds: string[];
}

export interface ScheduleSourceToDayOptions {
  historical?: boolean;
  surplusDestination?: "store" | "freezer" | "waste";
}

export function generateBatchName(itemsInBatch: SourceItem[]): string {
  if (itemsInBatch.length === 0) return "Batch";
  const sourceName = itemsInBatch[0].sourceName.slice(0, 24);
  const productNames = [...new Set(itemsInBatch.map((it) => it.productName))];
  if (productNames.length === 1) {
    return `${productNames[0]} · ${sourceName}`;
  }
  return `${productNames[0]} + ${productNames.length - 1} more · ${itemsInBatch[0].mouldName} · ${sourceName}`;
}

export async function scheduleSourceToDay(
  items: SourceItem[],
  date: string,
  options: ScheduleSourceToDayOptions = {},
): Promise<ScheduleResult> {
  if (items.length === 0) return { createdPlanIds: [] };

  // Group items: one plan per (productId, mouldId) combine.
  // Mould-group items sharing a product collapse into the same plan.
  const groups = new Map<string, SourceItem[]>();
  for (const it of items) {
    const key = `${it.productId}|${it.mouldId}`;
    const arr = groups.get(key) ?? [];
    arr.push(it);
    groups.set(key, arr);
  }

  const createdPlanIds: string[] = [];
  const now = new Date();

  for (const [, groupItems] of groups) {
    const head = groupItems[0];
    const fills = groupItems.reduce((s, it) => s + it.fillsNeeded, 0);
    const batchOutput = fills * head.mouldCavities;

    // productionPlans insert via helper (so batchNumber gets generated).
    const planId = await saveProductionPlan({
      name: generateBatchName(groupItems),
      status: options.historical ? "done" : "active",
      pinnedDate: options.historical ? null : date,
      completedAt: options.historical ? now : undefined,
      surplusDestination: options.surplusDestination ?? "store",
      createdAt: now,
      updatedAt: now,
    });

    await savePlanProduct({
      planId,
      productId: head.productId,
      mouldId: head.mouldId,
      quantity: fills,
      sortOrder: 0,
    });

    // Allocation rows. Each item's allocatedQuantity = min(its remainingQty,
    // its share of batch output). Sum across items ≤ batchOutput; surplus
    // absorbs any rounding.
    const totalRemaining = groupItems.reduce((s, it) => s + it.remainingQty, 0);
    let budget = batchOutput;
    for (const it of groupItems) {
      if (budget <= 0) break;
      const share = totalRemaining > 0
        ? Math.min(it.remainingQty, Math.floor((it.remainingQty / totalRemaining) * batchOutput))
        : 0;
      const allocatedQuantity = Math.max(0, Math.min(it.remainingQty, share || it.remainingQty));
      if (allocatedQuantity <= 0) continue;
      budget -= allocatedQuantity;
      try {
        if (it.sourceItemKind === "orderItem") {
          await saveOrderPlanLink({
            orderItemId: it.sourceItemId,
            planId,
            allocatedQuantity,
          });
        } else {
          await savePoPlanLink({
            productionOrderItemId: it.sourceItemId,
            planId,
            allocatedQuantity,
          });
        }
      } catch (e) {
        console.warn(`schedule-source link write failed for ${it.productName}:`, e);
      }
    }

    createdPlanIds.push(planId);
  }

  queryClient.invalidateQueries({ queryKey: ["production-plans"] });
  queryClient.invalidateQueries({ queryKey: ["plan-products"] });
  queryClient.invalidateQueries({ queryKey: ["order-plan-links"] });
  queryClient.invalidateQueries({ queryKey: ["po-plan-links"] });
  queryClient.invalidateQueries({ queryKey: ["schedulable-sources"] });
  queryClient.invalidateQueries({ queryKey: ["source-items"] });
  queryClient.invalidateQueries({ queryKey: ["scheduled-sources"] });

  return { createdPlanIds };
}
