/**
 * Spec MANUAL_PLANNER_WORKSPACE_BATCH.md §3.2 + §4.2
 *
 * For each productId chosen by the user inside a campaign-view group,
 * spawn a parked draft:
 *   - productionPlans row (status='draft', pinnedDate=null,
 *     name='{campaignName} · {productName}')
 *   - planProducts row (productId, defaultMouldId, quantity = ceil(target/cavities))
 *   - poPlanLinks row per productionOrderItem of that campaign+product
 *
 * If a draft already exists for (campaignId, productId), skip + report.
 * Skip = draft whose name starts with the campaign name and whose
 * planProducts.productId matches.
 */

import { supabase, newId } from "@/lib/supabase";
import { assertOk, assertOkMaybe } from "@/lib/supabase-query";
import { queryClient } from "@/lib/query-client";
import { saveProductionPlan, savePlanProduct, savePoPlanLink } from "@/lib/hooks";
import type {
  Campaign,
  Mould,
  PlanProduct,
  Product,
  ProductionOrder,
  ProductionOrderItem,
  ProductionPlan,
} from "@/types";

export interface BuildDraftsFromCampaignResult {
  built: Array<{ planId: string; productId: string; productName: string }>;
  skipped: Array<{ productId: string; productName: string; reason: string }>;
}

export async function buildDraftsFromCampaign(
  campaignId: string,
  productIds: string[],
): Promise<BuildDraftsFromCampaignResult> {
  if (productIds.length === 0) {
    return { built: [], skipped: [] };
  }

  const campaign = assertOkMaybe(
    await supabase.from("campaigns").select("*").eq("id", campaignId).maybeSingle(),
  ) as Campaign | null;
  if (!campaign) throw new Error(`Campaign ${campaignId} not found.`);

  const pos = assertOk(
    await supabase.from("productionOrders").select("*").eq("campaignId", campaignId),
  ) as ProductionOrder[];
  const poIds = pos.map((p) => p.id!).filter(Boolean);
  const poItems = poIds.length > 0
    ? assertOk(
        await supabase.from("productionOrderItems").select("*").in("productionOrderId", poIds),
      ) as ProductionOrderItem[]
    : [];

  const products = assertOk(
    await supabase.from("products").select("*").in("id", productIds),
  ) as Product[];
  const productById = new Map(products.map((p) => [p.id!, p]));

  const mouldIds = [...new Set(products.map((p) => p.defaultMouldId).filter(Boolean) as string[])];
  const moulds = mouldIds.length > 0
    ? assertOk(await supabase.from("moulds").select("*").in("id", mouldIds)) as Mould[]
    : [];
  const mouldById = new Map(moulds.map((m) => [m.id!, m]));

  // Detect existing drafts for this campaign: planProducts.productId in the
  // requested list AND productionPlans whose name starts with the campaign
  // name and status='draft'.
  const existingPlans = assertOk(
    await supabase
      .from("productionPlans")
      .select("id, name, status")
      .ilike("name", `${campaign.name} · %`)
      .eq("status", "draft"),
  ) as Array<Pick<ProductionPlan, "id" | "name" | "status">>;
  const existingPlanIds = existingPlans.map((p) => p.id!).filter(Boolean);
  const existingPlanProducts = existingPlanIds.length > 0
    ? assertOk(
        await supabase
          .from("planProducts")
          .select("planId, productId")
          .in("planId", existingPlanIds),
      ) as Array<Pick<PlanProduct, "planId" | "productId">>
    : [];
  const alreadyHaveDraftForProduct = new Set(
    existingPlanProducts.map((pp) => pp.productId),
  );

  const built: BuildDraftsFromCampaignResult["built"] = [];
  const skipped: BuildDraftsFromCampaignResult["skipped"] = [];

  for (const productId of productIds) {
    const product = productById.get(productId);
    if (!product) {
      skipped.push({ productId, productName: productId.slice(0, 8), reason: "product not found" });
      continue;
    }
    if (alreadyHaveDraftForProduct.has(productId)) {
      skipped.push({ productId, productName: product.name, reason: "already in draft" });
      continue;
    }
    if (!product.defaultMouldId) {
      skipped.push({ productId, productName: product.name, reason: "no default mould set" });
      continue;
    }
    const mould = mouldById.get(product.defaultMouldId);
    const cavities = mould?.numberOfCavities ?? 0;
    if (!mould || cavities <= 0) {
      skipped.push({ productId, productName: product.name, reason: "mould has 0 cavities" });
      continue;
    }

    // Sum the campaign's PO line targets for this product.
    const matchingItems = poItems.filter((it) => it.productId === productId);
    const targetUnits = matchingItems.reduce((s, it) => s + (it.targetUnits ?? 0), 0);
    if (targetUnits <= 0) {
      skipped.push({ productId, productName: product.name, reason: "campaign has no target for this product" });
      continue;
    }

    const mouldCount = Math.max(1, Math.ceil(targetUnits / cavities));

    const planId = await saveProductionPlan({
      name: `${campaign.name} · ${product.name}`,
      status: "draft",
      pinnedDate: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await savePlanProduct({
      planId,
      productId,
      mouldId: mould.id!,
      quantity: mouldCount,
      sortOrder: 0,
    });

    for (const it of matchingItems) {
      await savePoPlanLink({
        productionOrderItemId: it.id!,
        planId,
        allocatedQuantity: it.targetUnits,
      });
    }

    built.push({ planId, productId, productName: product.name });
  }

  queryClient.invalidateQueries({ queryKey: ["production-plans"] });
  queryClient.invalidateQueries({ queryKey: ["plan-products"] });
  queryClient.invalidateQueries({ queryKey: ["po-plan-links"] });

  return { built, skipped };
}

/** True if the campaign already has any parked drafts whose name matches
 *  its naming convention. Used by the campaign-view UI to show how many
 *  drafts already exist before the user clicks "Build". */
export async function countCampaignDrafts(campaignId: string): Promise<number> {
  const campaign = assertOkMaybe(
    await supabase.from("campaigns").select("name").eq("id", campaignId).maybeSingle(),
  ) as { name: string } | null;
  if (!campaign) return 0;
  const rows = assertOk(
    await supabase
      .from("productionPlans")
      .select("id", { count: "exact" })
      .ilike("name", `${campaign.name} · %`)
      .eq("status", "draft"),
  ) as Array<{ id: string }>;
  return rows.length;
}
