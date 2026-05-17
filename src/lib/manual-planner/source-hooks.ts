"use client";

/**
 * Source-first manual planner hooks
 * (MANUAL_PLANNER_SOURCE_FIRST_BATCH.md §4.1–§4.3).
 *
 * Deliberate file split: putting these in `hooks.ts` (~14k lines)
 * makes diff review impossible. Same react-query patterns, same
 * supabase client, separate file. Commit message notes this
 * divergence from the spec template's "hooks.ts:LINES" wording.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import type {
  Campaign,
  Mould,
  Order,
  OrderItem,
  OrderPlanLink,
  PlanProduct,
  PoPlanLink,
  Product,
  ProductCategory,
  ProductionOrder,
  ProductionOrderItem,
  ProductionPlan,
  ProductionStep,
} from "@/types";
import type {
  SchedulableSource,
  ScheduledSourceCard,
  SourceItem,
  SourceKind,
} from "./source-types";
import { computeCombineMath } from "./combine-math";

const OPEN_ORDER_STATUSES = new Set<Order["status"]>([
  "pending",
  "in_production",
  "ready_to_pack",
]);
const OPEN_PO_STATUSES = new Set<ProductionOrder["status"]>([
  "pending",
  "in_production",
]);

const URGENT_HORIZON_DAYS = 3;

function dayDiff(iso: string, ref: Date): number {
  const d = new Date(iso + "T00:00:00").getTime();
  return Math.floor((d - ref.getTime()) / (24 * 60 * 60 * 1000));
}
function urgencyFor(due: string | null, ref: Date): "urgent" | "normal" {
  if (!due) return "normal";
  return dayDiff(due, ref) <= URGENT_HORIZON_DAYS ? "urgent" : "normal";
}

interface AllocationIndex {
  byOrderItem: Map<string, number>; // sum of allocated qty in active|done plans
  byPoItem: Map<string, number>;
}

async function loadAllocationIndex(): Promise<AllocationIndex> {
  const plans = assertOk(
    await supabase
      .from("productionPlans")
      .select("id, status")
      .in("status", ["active", "done"]),
  ) as Array<{ id: string; status: string }>;
  const planIds = new Set(plans.map((p) => p.id));
  if (planIds.size === 0) return { byOrderItem: new Map(), byPoItem: new Map() };
  const opl = assertOk(
    await supabase.from("orderPlanLinks").select("orderItemId, planId, allocatedQuantity"),
  ) as Array<Pick<OrderPlanLink, "orderItemId" | "planId" | "allocatedQuantity">>;
  const ppl = assertOk(
    await supabase.from("poPlanLinks").select("productionOrderItemId, planId, allocatedQuantity"),
  ) as Array<Pick<PoPlanLink, "productionOrderItemId" | "planId" | "allocatedQuantity">>;
  const byOrderItem = new Map<string, number>();
  const byPoItem = new Map<string, number>();
  for (const link of opl) {
    if (!planIds.has(link.planId)) continue;
    byOrderItem.set(link.orderItemId, (byOrderItem.get(link.orderItemId) ?? 0) + link.allocatedQuantity);
  }
  for (const link of ppl) {
    if (!planIds.has(link.planId)) continue;
    byPoItem.set(link.productionOrderItemId, (byPoItem.get(link.productionOrderItemId) ?? 0) + link.allocatedQuantity);
  }
  return { byOrderItem, byPoItem };
}

export function useSchedulableSources() {
  return useQuery({
    queryKey: ["schedulable-sources"],
    queryFn: async (): Promise<SchedulableSource[]> => {
      const now = new Date();
      const alloc = await loadAllocationIndex();

      const [poRows, poItemRows, orderRows, orderItemRows, campaignRows] =
        await Promise.all([
          supabase.from("productionOrders").select("*").in("status", [...OPEN_PO_STATUSES]),
          supabase.from("productionOrderItems").select("*"),
          supabase.from("orders").select("*").in("status", [...OPEN_ORDER_STATUSES]),
          supabase.from("orderItems").select("*"),
          supabase.from("campaigns").select("*").in("status", ["planned", "active"]),
        ]);
      const pos = assertOk(poRows) as ProductionOrder[];
      const poItems = assertOk(poItemRows) as ProductionOrderItem[];
      const orders = assertOk(orderRows) as Order[];
      const orderItems = assertOk(orderItemRows) as OrderItem[];
      const campaigns = assertOk(campaignRows) as Campaign[];

      const poById = new Map(pos.map((p) => [p.id!, p]));
      const orderById = new Map(orders.map((o) => [o.id!, o]));

      // 1) restock POs + campaigns share the productionOrderItems table.
      //    Group items by their PO; campaigns inherit dueDate from the PO.
      const itemsByPo = new Map<string, ProductionOrderItem[]>();
      for (const it of poItems) {
        const arr = itemsByPo.get(it.productionOrderId) ?? [];
        arr.push(it);
        itemsByPo.set(it.productionOrderId, arr);
      }

      const sources: SchedulableSource[] = [];

      // Restock POs (channel='restock')
      for (const po of pos.filter((p) => p.channel === "restock")) {
        const items = itemsByPo.get(po.id!) ?? [];
        const remainingItemCount = items.filter((it) => {
          const used = alloc.byPoItem.get(it.id!) ?? 0;
          return (it.targetUnits ?? 0) - used > 0;
        }).length;
        if (remainingItemCount === 0) continue;
        const due = po.dueDate ? String(po.dueDate).slice(0, 10) : null;
        sources.push({
          kind: "restock-po",
          id: po.id!,
          name: po.name ?? `Replen ${due ?? po.id!.slice(0, 6)}`,
          dueDate: due,
          itemCount: remainingItemCount,
          priority: urgencyFor(due, now),
        });
      }

      // Campaigns — group POs by campaignId, aggregate items.
      const campaignById = new Map(campaigns.map((c) => [c.id!, c]));
      const campaignItemCount = new Map<string, number>();
      const campaignDueDate = new Map<string, string>();
      for (const po of pos) {
        if (!po.campaignId) continue;
        const items = itemsByPo.get(po.id!) ?? [];
        const remaining = items.filter((it) => {
          const used = alloc.byPoItem.get(it.id!) ?? 0;
          return (it.targetUnits ?? 0) - used > 0;
        }).length;
        if (remaining === 0) continue;
        campaignItemCount.set(
          po.campaignId,
          (campaignItemCount.get(po.campaignId) ?? 0) + remaining,
        );
        const due = po.dueDate ? String(po.dueDate).slice(0, 10) : null;
        if (due) {
          const cur = campaignDueDate.get(po.campaignId);
          if (!cur || due < cur) campaignDueDate.set(po.campaignId, due);
        }
      }
      for (const [campaignId, itemCount] of campaignItemCount) {
        const c = campaignById.get(campaignId);
        if (!c) continue;
        const due = campaignDueDate.get(campaignId) ?? c.startDate ?? null;
        sources.push({
          kind: "campaign",
          id: campaignId,
          name: c.name,
          dueDate: due,
          itemCount,
          priority: urgencyFor(due, now),
        });
      }

      // Customer orders + Online bucket
      const itemsByOrder = new Map<string, OrderItem[]>();
      for (const it of orderItems) {
        const arr = itemsByOrder.get(it.orderId) ?? [];
        arr.push(it);
        itemsByOrder.set(it.orderId, arr);
      }
      let onlineBucketCount = 0;
      for (const order of orders) {
        const items = (itemsByOrder.get(order.id!) ?? []).filter((it) => {
          if (it.variantId) return false; // variant lines deferred (spec §8)
          if ((it.fulfilmentMode ?? "produce") !== "produce") return false;
          const used = alloc.byOrderItem.get(it.id!) ?? 0;
          return it.quantity - used > 0;
        });
        if (items.length === 0) continue;
        const due = order.deadline ? new Date(order.deadline).toISOString().slice(0, 10) : null;
        if (order.channel === "online" && !order.isolated) {
          onlineBucketCount += items.length;
          continue;
        }
        const label = order.customerName || order.eventName || order.sourceRef || "Anonymous";
        sources.push({
          kind: "customer-order",
          id: order.id!,
          name: label,
          dueDate: due,
          itemCount: items.length,
          isolated: !!order.isolated,
          priority: urgencyFor(due, now),
        });
      }
      if (onlineBucketCount > 0) {
        sources.push({
          kind: "online-bucket",
          id: "online-loose",
          name: "Online orders",
          dueDate: null,
          itemCount: onlineBucketCount,
          priority: "normal",
        });
      }

      // Sort: restock first, then campaigns by due, then customers by due, then online.
      sources.sort((a, b) => {
        const order: Record<SourceKind, number> = {
          "restock-po": 0,
          campaign: 1,
          "customer-order": 2,
          "online-bucket": 3,
        };
        if (order[a.kind] !== order[b.kind]) return order[a.kind] - order[b.kind];
        const aDue = a.dueDate ?? "9999-99-99";
        const bDue = b.dueDate ?? "9999-99-99";
        if (aDue !== bDue) return aDue.localeCompare(bDue);
        return a.name.localeCompare(b.name);
      });
      void poById;
      void orderById;
      return sources;
    },
  });
}

export function useSourceItems(selected: SchedulableSource[]) {
  const ids = selected.map((s) => `${s.kind}|${s.id}`).sort().join(",");
  return useQuery({
    queryKey: ["source-items", ids],
    enabled: selected.length > 0,
    queryFn: async (): Promise<SourceItem[]> => {
      const alloc = await loadAllocationIndex();
      const now = new Date();

      // Pull the products + moulds + categories used by any candidate item.
      const [productRows, mouldRows, categoryRows] = await Promise.all([
        supabase.from("products").select("*"),
        supabase.from("moulds").select("*"),
        supabase.from("productCategories").select("*"),
      ]);
      const products = assertOk(productRows) as Product[];
      const moulds = assertOk(mouldRows) as Mould[];
      const categories = assertOk(categoryRows) as ProductCategory[];
      const productById = new Map(products.map((p) => [p.id!, p]));
      const mouldById = new Map(moulds.map((m) => [m.id!, m]));
      const categoryById = new Map(categories.map((c) => [c.id!, c]));

      const out: SourceItem[] = [];

      function pushFromProductId({
        sourceKind, sourceId, sourceName, sourceItemId, sourceItemKind,
        productId, remainingQty, isolated, dueDate, priority,
      }: {
        sourceKind: SourceKind; sourceId: string; sourceName: string;
        sourceItemId: string; sourceItemKind: "orderItem" | "productionOrderItem";
        productId: string; remainingQty: number;
        isolated: boolean; dueDate: string | null; priority: "urgent" | "normal";
      }): void {
        if (remainingQty <= 0) return;
        const product = productById.get(productId);
        if (!product?.defaultMouldId) return;
        const mould = mouldById.get(product.defaultMouldId);
        if (!mould || !mould.numberOfCavities) return;
        const category = product.productCategoryId ? categoryById.get(product.productCategoryId) : null;
        out.push({
          sourceKind,
          sourceId,
          sourceName,
          productId,
          productName: product.name,
          productCategory: category?.name ?? "Other",
          mouldId: mould.id!,
          mouldName: mould.name,
          mouldCavities: mould.numberOfCavities,
          remainingQty,
          fillsNeeded: Math.max(1, Math.ceil(remainingQty / mould.numberOfCavities)),
          sourceItemId,
          sourceItemKind,
          isolated,
          dueDate,
          priority,
        });
      }

      // Fan-out per selected source kind.
      // 1) restock-po / campaign (productionOrderItems)
      const wantedPoIds = new Set<string>();
      for (const src of selected) {
        if (src.kind === "restock-po") wantedPoIds.add(src.id);
        if (src.kind === "campaign") {
          const pos = assertOk(
            await supabase
              .from("productionOrders")
              .select("id")
              .eq("campaignId", src.id),
          ) as Array<{ id: string }>;
          for (const p of pos) wantedPoIds.add(p.id);
        }
      }
      if (wantedPoIds.size > 0) {
        const poItemRows = assertOk(
          await supabase
            .from("productionOrderItems")
            .select("*")
            .in("productionOrderId", [...wantedPoIds]),
        ) as ProductionOrderItem[];
        const poRows = assertOk(
          await supabase
            .from("productionOrders")
            .select("*")
            .in("id", [...wantedPoIds]),
        ) as ProductionOrder[];
        const poById = new Map(poRows.map((p) => [p.id!, p]));
        for (const it of poItemRows) {
          const used = alloc.byPoItem.get(it.id!) ?? 0;
          const remaining = (it.targetUnits ?? 0) - used;
          if (remaining <= 0) continue;
          const po = poById.get(it.productionOrderId);
          if (!po) continue;
          // Decide what `source` this item rolls up to among the selected.
          const matchingSrc = selected.find(
            (src) =>
              (src.kind === "restock-po" && src.id === po.id) ||
              (src.kind === "campaign" && src.id === po.campaignId),
          );
          if (!matchingSrc) continue;
          const due = po.dueDate ? String(po.dueDate).slice(0, 10) : null;
          pushFromProductId({
            sourceKind: matchingSrc.kind,
            sourceId: matchingSrc.id,
            sourceName: matchingSrc.name,
            sourceItemId: it.id!,
            sourceItemKind: "productionOrderItem",
            productId: it.productId,
            remainingQty: remaining,
            isolated: false,
            dueDate: due,
            priority: urgencyFor(due, now),
          });
        }
      }

      // 2) customer-order / online-bucket
      const wantedOrderIds = new Set<string>();
      let onlineBucketSelected = false;
      for (const src of selected) {
        if (src.kind === "customer-order") wantedOrderIds.add(src.id);
        if (src.kind === "online-bucket") onlineBucketSelected = true;
      }
      if (onlineBucketSelected) {
        const onlineOrders = assertOk(
          await supabase
            .from("orders")
            .select("id")
            .eq("channel", "online")
            .neq("isolated", true)
            .in("status", [...OPEN_ORDER_STATUSES]),
        ) as Array<{ id: string }>;
        for (const o of onlineOrders) wantedOrderIds.add(o.id);
      }
      if (wantedOrderIds.size > 0) {
        const orderItemRows = assertOk(
          await supabase
            .from("orderItems")
            .select("*")
            .in("orderId", [...wantedOrderIds]),
        ) as OrderItem[];
        const orderRows = assertOk(
          await supabase
            .from("orders")
            .select("*")
            .in("id", [...wantedOrderIds]),
        ) as Order[];
        const orderById = new Map(orderRows.map((o) => [o.id!, o]));
        for (const it of orderItemRows) {
          if (it.variantId) continue; // variant lines deferred
          if ((it.fulfilmentMode ?? "produce") !== "produce") continue;
          const used = alloc.byOrderItem.get(it.id!) ?? 0;
          const remaining = it.quantity - used;
          if (remaining <= 0) continue;
          const order = orderById.get(it.orderId);
          if (!order) continue;
          // Match selected source — explicit customer-order, or online-bucket
          // if this is a non-isolated online order and bucket is selected.
          let matchingSrc: SchedulableSource | undefined;
          for (const src of selected) {
            if (src.kind === "customer-order" && src.id === order.id) {
              matchingSrc = src;
              break;
            }
            if (
              src.kind === "online-bucket" &&
              order.channel === "online" &&
              !order.isolated
            ) {
              matchingSrc = src;
              break;
            }
          }
          if (!matchingSrc) continue;
          const due = order.deadline ? new Date(order.deadline).toISOString().slice(0, 10) : null;
          pushFromProductId({
            sourceKind: matchingSrc.kind,
            sourceId: matchingSrc.id,
            sourceName: matchingSrc.name,
            sourceItemId: it.id!,
            sourceItemKind: "orderItem",
            productId: it.productId,
            remainingQty: remaining,
            isolated: !!order.isolated,
            dueDate: due,
            priority: urgencyFor(due, now),
          });
        }
      }

      // Sort: by mould cavity ↑, then product name.
      out.sort((a, b) => {
        if (a.mouldCavities !== b.mouldCavities) return a.mouldCavities - b.mouldCavities;
        return a.productName.localeCompare(b.productName);
      });
      return out;
    },
  });
}

export function useScheduledSources(weekStart: Date, weekEnd: Date) {
  const start = weekStart.toISOString().slice(0, 10);
  const end = weekEnd.toISOString().slice(0, 10);
  return useQuery({
    queryKey: ["scheduled-sources", start, end],
    queryFn: async (): Promise<ScheduledSourceCard[]> => {
      const planRows = assertOk(
        await supabase
          .from("productionPlans")
          .select("*")
          .gte("pinnedDate", start)
          .lte("pinnedDate", end)
          .in("status", ["active", "done"]),
      ) as ProductionPlan[];
      if (planRows.length === 0) return [];
      const planIds = planRows.map((p) => p.id!).filter(Boolean);
      const [planProductRows, oplRows, pplRows] = await Promise.all([
        supabase.from("planProducts").select("*").in("planId", planIds),
        supabase.from("orderPlanLinks").select("*").in("planId", planIds),
        supabase.from("poPlanLinks").select("*").in("planId", planIds),
      ]);
      const planProducts = assertOk(planProductRows) as PlanProduct[];
      const opl = assertOk(oplRows) as OrderPlanLink[];
      const ppl = assertOk(pplRows) as PoPlanLink[];

      const ppByPlan = new Map<string, PlanProduct>();
      for (const pp of planProducts) {
        if (!ppByPlan.has(pp.planId)) ppByPlan.set(pp.planId, pp);
      }

      // Resolve order ids → order rows for source labels
      const orderItemIds = [...new Set(opl.map((l) => l.orderItemId))];
      const poItemIds = [...new Set(ppl.map((l) => l.productionOrderItemId))];
      const orderItems = orderItemIds.length > 0
        ? assertOk(await supabase.from("orderItems").select("id, orderId").in("id", orderItemIds)) as Array<Pick<OrderItem, "id" | "orderId">>
        : [];
      const orderIds = [...new Set(orderItems.map((it) => it.orderId))];
      const orders = orderIds.length > 0
        ? assertOk(await supabase.from("orders").select("id, customerName, eventName, sourceRef, isolated, channel").in("id", orderIds)) as Array<Pick<Order, "id" | "customerName" | "eventName" | "sourceRef" | "isolated" | "channel">>
        : [];
      const poItems = poItemIds.length > 0
        ? assertOk(await supabase.from("productionOrderItems").select("id, productionOrderId").in("id", poItemIds)) as Array<Pick<ProductionOrderItem, "id" | "productionOrderId">>
        : [];
      const poIds = [...new Set(poItems.map((it) => it.productionOrderId))];
      const pos = poIds.length > 0
        ? assertOk(await supabase.from("productionOrders").select("id, name, dueDate, channel, campaignId").in("id", poIds)) as Array<Pick<ProductionOrder, "id" | "name" | "dueDate" | "channel" | "campaignId">>
        : [];
      const campaignIds = [...new Set(pos.map((p) => p.campaignId).filter((x): x is string => !!x))];
      const campaigns = campaignIds.length > 0
        ? assertOk(await supabase.from("campaigns").select("id, name").in("id", campaignIds)) as Array<Pick<Campaign, "id" | "name">>
        : [];

      const orderById = new Map(orders.map((o) => [o.id!, o]));
      const orderItemById = new Map(orderItems.map((it) => [it.id, it]));
      const poById = new Map(pos.map((p) => [p.id!, p]));
      const poItemById = new Map(poItems.map((it) => [it.id, it]));
      const campaignById = new Map(campaigns.map((c) => [c.id!, c]));

      // Productionstep active-minutes for the per-plan estimate.
      const productIds = [...new Set(planProducts.map((pp) => pp.productId))];
      const productRows = productIds.length > 0
        ? assertOk(await supabase.from("products").select("id, productCategoryId").in("id", productIds)) as Array<{ id: string; productCategoryId?: string }>
        : [];
      const productById = new Map(productRows.map((p) => [p.id, p]));
      const categoryIds = [...new Set(productRows.map((p) => p.productCategoryId).filter((x): x is string => !!x))];
      const categories = categoryIds.length > 0
        ? assertOk(await supabase.from("productCategories").select("id, name").in("id", categoryIds)) as Array<{ id: string; name: string }>
        : [];
      const categoryById = new Map(categories.map((c) => [c.id, c]));
      const productCategoryNames = [...new Set(categories.map((c) => c.name))];
      const stepRows = productCategoryNames.length > 0
        ? assertOk(
            await supabase
              .from("productionSteps")
              .select("activeMinutes, perBatch, productType, sortOrder")
              .in("productType", productCategoryNames),
          ) as Array<Pick<ProductionStep, "activeMinutes" | "perBatch" | "productType" | "sortOrder">>
        : [];
      const stepsByCategory = new Map<string, typeof stepRows>();
      for (const s of stepRows) {
        const arr = stepsByCategory.get(s.productType) ?? [];
        arr.push(s);
        stepsByCategory.set(s.productType, arr);
      }
      const mouldCavityByPlan = new Map<string, number>();
      for (const pp of planProducts) {
        // We don't need cavities for the active-minutes estimate (per-fill
        // multiplier comes from planProducts.quantity); but we need to know
        // if the step is perBatch so the multiplier is skipped.
        mouldCavityByPlan.set(pp.planId, pp.quantity);
      }

      // Bucket plans by (sourceKind, sourceId, pinnedDate).
      type Bucket = ScheduledSourceCard;
      const buckets = new Map<string, Bucket>();
      function ensure(key: string, init: Bucket): Bucket {
        const cur = buckets.get(key);
        if (cur) return cur;
        buckets.set(key, init);
        return init;
      }
      function activeMinutesForPlan(plan: ProductionPlan): number {
        const pp = ppByPlan.get(plan.id!);
        if (!pp) return 0;
        const product = productById.get(pp.productId);
        if (!product?.productCategoryId) return 0;
        const category = categoryById.get(product.productCategoryId);
        if (!category) return 0;
        const steps = stepsByCategory.get(category.name) ?? [];
        let mins = 0;
        for (const s of steps) {
          const a = Number(s.activeMinutes ?? 0);
          mins += s.perBatch ? a : a * pp.quantity;
        }
        return mins;
      }

      for (const plan of planRows) {
        if (!plan.pinnedDate || !plan.id) continue;
        const date = plan.pinnedDate.slice(0, 10);
        // Identify source via link rows
        let sourceKind: ScheduledSourceCard["sourceKind"] = "unscheduled";
        let sourceId = "unscheduled";
        let sourceName = "Unscheduled batch";
        let isolated = false;
        const ownOpl = opl.filter((l) => l.planId === plan.id);
        const ownPpl = ppl.filter((l) => l.planId === plan.id);
        if (ownPpl.length > 0) {
          const sample = poItemById.get(ownPpl[0].productionOrderItemId);
          const po = sample ? poById.get(sample.productionOrderId) : null;
          if (po) {
            if (po.campaignId && campaignById.get(po.campaignId)) {
              sourceKind = "campaign";
              sourceId = po.campaignId;
              sourceName = campaignById.get(po.campaignId)!.name;
            } else if (po.channel === "restock") {
              sourceKind = "restock-po";
              sourceId = po.id!;
              sourceName = po.name ?? "Replen";
            } else {
              sourceKind = "campaign";
              sourceId = po.id!;
              sourceName = po.name ?? "Campaign";
            }
          }
        } else if (ownOpl.length > 0) {
          const sampleItem = orderItemById.get(ownOpl[0].orderItemId);
          const order = sampleItem ? orderById.get(sampleItem.orderId) : null;
          if (order) {
            if (order.channel === "online" && !order.isolated) {
              sourceKind = "online-bucket";
              sourceId = "online-loose";
              sourceName = "Online orders";
            } else {
              sourceKind = "customer-order";
              sourceId = order.id!;
              sourceName = order.customerName || order.eventName || order.sourceRef || "Anonymous";
              isolated = !!order.isolated;
            }
          }
        }
        const key = `${sourceKind}|${sourceId}|${date}`;
        const bucket = ensure(key, {
          sourceKind,
          sourceId,
          sourceName,
          pinnedDate: date,
          planIds: [],
          batchCount: 0,
          totalActiveMinutes: 0,
          isolated,
        });
        bucket.planIds.push(plan.id);
        bucket.batchCount = bucket.planIds.length;
        bucket.totalActiveMinutes += activeMinutesForPlan(plan);
      }
      return [...buckets.values()].sort((a, b) => {
        if (a.pinnedDate !== b.pinnedDate) return a.pinnedDate.localeCompare(b.pinnedDate);
        return a.sourceName.localeCompare(b.sourceName);
      });
    },
  });
}

// Re-export so component consumers don't pull both `combine-math` and
// `source-types` separately.
export { computeCombineMath };
