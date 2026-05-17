/**
 * Spec MANUAL_PLANNER_WORKSPACE_BATCH.md §3.7 / §4.5
 *
 * Drag a parked-draft pool card directly onto a day → write
 * `status='active' + pinnedDate=<iso>` to the DB, then refetch.
 * Bypasses the load-into-localStorage path used by the drafts-tray
 * drag (that flow exists for "edit this draft first").
 *
 * Also seeds productionDayLineItems for the pinned day so the
 * Plan(week) page sees the stage assignments immediately. v1 places
 * every step for the product's category on `pinnedDate` itself, same
 * rule as saveDraftToPlan.
 */

import { supabase, newId } from "@/lib/supabase";
import { assertOk, assertOkMaybe } from "@/lib/supabase-query";
import { queryClient } from "@/lib/query-client";
import type {
  PlanProduct,
  Product,
  ProductCategory,
  ProductionStep,
} from "@/types";

export async function pinPoolCardToDay(planId: string, pinnedDate: string): Promise<void> {
  // 1. Flip plan to active + pinned.
  const { error: planErr } = await supabase
    .from("productionPlans")
    .update({ status: "active", pinnedDate, updatedAt: new Date() })
    .eq("id", planId);
  if (planErr) throw planErr;

  // 2. Look up the product so we know which steps to seed.
  const pp = assertOkMaybe(
    await supabase
      .from("planProducts")
      .select("productId")
      .eq("planId", planId)
      .maybeSingle(),
  ) as Pick<PlanProduct, "productId"> | null;
  if (!pp) {
    queryClient.invalidateQueries({ queryKey: ["production-plans"] });
    return;
  }
  const product = assertOkMaybe(
    await supabase
      .from("products")
      .select("id, productCategoryId")
      .eq("id", pp.productId)
      .maybeSingle(),
  ) as Pick<Product, "id" | "productCategoryId"> | null;
  if (!product?.productCategoryId) {
    queryClient.invalidateQueries({ queryKey: ["production-plans"] });
    return;
  }
  const category = assertOkMaybe(
    await supabase
      .from("productCategories")
      .select("id, name")
      .eq("id", product.productCategoryId)
      .maybeSingle(),
  ) as Pick<ProductCategory, "id" | "name"> | null;
  if (!category) {
    queryClient.invalidateQueries({ queryKey: ["production-plans"] });
    return;
  }

  const steps = assertOk(
    await supabase
      .from("productionSteps")
      .select("id, name, activeMinutes, sortOrder")
      .eq("productType", category.name),
  ) as Array<Pick<ProductionStep, "id" | "name" | "activeMinutes" | "sortOrder">>;

  if (steps.length > 0) {
    const stepIds = steps
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((s) => s.id!)
      .filter(Boolean);
    const plannedMinutes = steps.reduce(
      (sum, s) => sum + Number(s.activeMinutes ?? 0),
      0,
    );

    // 3. Ensure productionDays row.
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
      const { error: dayErr } = await supabase.from("productionDays").insert({
        id: productionDayId,
        date: pinnedDate,
        status: "draft",
      });
      if (dayErr) throw dayErr;
    }

    // 4. Merge into productionDayLineItems.
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
      await supabase
        .from("productionDayLineItems")
        .update({ stepIds: merged, plannedMinutes, updatedAt: new Date() })
        .eq("id", existingLi.id);
    } else {
      await supabase.from("productionDayLineItems").insert({
        id: newId(),
        productionDayId,
        planId,
        stepIds,
        plannedMinutes,
        sortOrder: 0,
      });
    }
  }

  queryClient.invalidateQueries({ queryKey: ["production-plans"] });
  queryClient.invalidateQueries({ queryKey: ["productionDays"] });
  queryClient.invalidateQueries({ queryKey: ["productionDayLineItems"] });
  queryClient.invalidateQueries({ queryKey: ["production-day-line-items"] });
}
