/**
 * Save a manual-planner DraftBatch to the DB as a productionPlans row.
 *
 * Two save modes, controlled by `options.status`:
 *   - 'draft'  → park for later. pinnedDate forced to null regardless
 *                of input. Editor clears so the user can start a new
 *                draft; the parked card appears in the DraftsTray.
 *   - 'active' → commit + pin. pinnedDate is required (ISO yyyy-mm-dd)
 *                and persists on the productionPlans row so the
 *                scheduler treats it as locked.
 *
 * Writes:
 *   - productionPlans (status, pinnedDate, surplusDestination, name, notes)
 *   - planProducts    (productId, mouldId, quantity = mouldCount)
 *   - orderPlanLinks  (one per source='order' allocation)
 *   - poPlanLinks     (one per source='po' allocation — mig 0094)
 *
 * No more PO-as-notes-text trail: every allocation has a typed FK row.
 */

import {
  saveProductionPlan,
  savePlanProduct,
  saveOrderPlanLink,
  savePoPlanLink,
} from "@/lib/hooks";
import { supabase, newId } from "@/lib/supabase";
import { assertOk, assertOkMaybe } from "@/lib/supabase-query";
import { queryClient } from "@/lib/query-client";
import type { ProductCategory, Product, ProductionStep } from "@/types";
import type { DraftBatch } from "./draft-state";

export interface SaveDraftOptions {
  status: "draft" | "active";
  /** Required when status === 'active'. Ignored (forced null) when 'draft'. */
  pinnedDate?: string | null;
}

export interface SaveDraftResult {
  planId: string;
  warnings: string[];
}

export async function saveDraftToPlan(
  draft: DraftBatch,
  options: SaveDraftOptions,
): Promise<SaveDraftResult> {
  // Hard rule (2026-05-17): no zero-allocation drafts. Earlier path
  // allowed parking when surplusDestination was set with no allocations,
  // which spawned "0 lines · +200 surplus" orphans visible in the tray.
  // Save must carry real demand or it shouldn't exist.
  if (draft.allocations.length === 0) {
    throw new Error("Cannot save empty draft — add at least one allocation first.");
  }
  if (options.status === "active" && !options.pinnedDate) {
    throw new Error("Cannot save & pin: no pinned date.");
  }

  const now = new Date();
  const pinnedDate = options.status === "draft" ? null : options.pinnedDate ?? null;
  const notes = draft.notes.trim() ? draft.notes.trim() : undefined;

  const planId = await saveProductionPlan({
    name: draft.name,
    status: options.status,
    notes,
    pinnedDate,
    surplusDestination:
      draft.surplusDestination === "po-fill"
        ? "store"
        : draft.surplusDestination ?? undefined,
    createdAt: now,
    updatedAt: now,
  });

  await savePlanProduct({
    planId,
    productId: draft.productId,
    mouldId: draft.mouldId,
    quantity: draft.mouldCount,
    sortOrder: 0,
  });

  const warnings: string[] = [];
  for (const a of draft.allocations) {
    if (!a.parentId) continue;
    try {
      if (a.source === "order") {
        await saveOrderPlanLink({
          orderItemId: a.parentId,
          planId,
          allocatedQuantity: a.qty,
        });
      } else {
        await savePoPlanLink({
          productionOrderItemId: a.parentId,
          planId,
          allocatedQuantity: a.qty,
        });
      }
    } catch (e) {
      warnings.push(
        `${a.source === "order" ? "OrderPlanLink" : "PoPlanLink"} for ${a.label}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Seed productionDayLineItems for the pinned day. Per
  // MANUAL_PLANNER_WEEK_VIEW_GANTT.md §4.4 v1, every step for the
  // product's category lands on `pinnedDate` itself. The user then drags
  // chips in the Gantt to spread the workload across days.
  if (options.status === "active" && pinnedDate) {
    try {
      await seedLineItemsForPinnedDay({ planId, productId: draft.productId, pinnedDate });
      queryClient.invalidateQueries({ queryKey: ["productionDayLineItems"] });
      queryClient.invalidateQueries({ queryKey: ["production-day-line-items"] });
      queryClient.invalidateQueries({ queryKey: ["productionDays"] });
    } catch (e) {
      warnings.push(
        `Seed line items for ${pinnedDate}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return { planId, warnings };
}

/**
 * Insert (or merge into) the productionDayLineItems row for the pinned
 * day. All productionSteps matching the product's category are placed
 * on this single day. Creates the productionDays row if missing.
 */
async function seedLineItemsForPinnedDay({
  planId,
  productId,
  pinnedDate,
}: {
  planId: string;
  productId: string;
  pinnedDate: string;
}): Promise<void> {
  // 1. Resolve product → category name → step list.
  const product = assertOkMaybe(
    await supabase
      .from("products")
      .select("id, productCategoryId")
      .eq("id", productId)
      .maybeSingle(),
  ) as Pick<Product, "id" | "productCategoryId"> | null;
  if (!product?.productCategoryId) return; // no category → no steps to seed

  const category = assertOkMaybe(
    await supabase
      .from("productCategories")
      .select("id, name")
      .eq("id", product.productCategoryId)
      .maybeSingle(),
  ) as Pick<ProductCategory, "id" | "name"> | null;
  if (!category) return;

  const steps = assertOk(
    await supabase
      .from("productionSteps")
      .select("id, name, activeMinutes, sortOrder")
      .eq("productType", category.name),
  ) as Array<Pick<ProductionStep, "id" | "name" | "activeMinutes" | "sortOrder">>;
  if (steps.length === 0) return;

  const stepIds = steps
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((s) => s.id!)
    .filter(Boolean);
  const plannedMinutes = steps.reduce(
    (sum, s) => sum + Number(s.activeMinutes ?? 0),
    0,
  );

  // 2. Ensure productionDays row.
  const existingDay = assertOkMaybe(
    await supabase
      .from("productionDays")
      .select("id")
      .eq("date", pinnedDate)
      .maybeSingle(),
  ) as { id: string } | null;
  let productionDayId: string;
  if (existingDay) {
    productionDayId = existingDay.id;
  } else {
    productionDayId = newId();
    const { error } = await supabase.from("productionDays").insert({
      id: productionDayId,
      date: pinnedDate,
      status: "draft",
    });
    if (error) throw error;
  }

  // 3. Merge into productionDayLineItems for (plan, day). UNIQUE
  //    constraint on (productionDayId, planId) means we must either
  //    update an existing row or insert a fresh one.
  const existingLi = assertOkMaybe(
    await supabase
      .from("productionDayLineItems")
      .select("id, stepIds")
      .eq("planId", planId)
      .eq("productionDayId", productionDayId)
      .maybeSingle(),
  ) as { id: string; stepIds: string[] | null } | null;

  if (existingLi) {
    const merged = [...new Set([...(existingLi.stepIds ?? []), ...stepIds])];
    const { error } = await supabase
      .from("productionDayLineItems")
      .update({ stepIds: merged, plannedMinutes, updatedAt: new Date() })
      .eq("id", existingLi.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("productionDayLineItems").insert({
      id: newId(),
      productionDayId,
      planId,
      stepIds,
      plannedMinutes,
      sortOrder: 0,
    });
    if (error) throw error;
  }
}
