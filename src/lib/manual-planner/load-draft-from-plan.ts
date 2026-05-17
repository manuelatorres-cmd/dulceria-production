/**
 * Rehydrate a parked productionPlans row (status='draft') back into a
 * DraftBatch ready for the ActiveDraftPanel. Reverse of saveDraftToPlan
 * — orderPlanLinks + poPlanLinks (mig 0094) replace the v1 notes-text
 * trail entirely.
 *
 * Called when the user clicks a parked card in the DraftsTray.
 */

import { supabase } from "@/lib/supabase";
import { assertOk, assertOkMaybe } from "@/lib/supabase-query";
import type {
  Mould,
  Order,
  OrderItem,
  OrderPlanLink,
  PlanProduct,
  PoPlanLink,
  Product,
  ProductionOrder,
  ProductionOrderItem,
  ProductionPlan,
} from "@/types";
import type {
  DraftAllocation,
  DraftBatch,
  SurplusDestination,
} from "./draft-state";

export async function loadDraftFromPlan(planId: string): Promise<DraftBatch> {
  const plan = assertOkMaybe(
    await supabase.from("productionPlans").select("*").eq("id", planId).maybeSingle(),
  ) as ProductionPlan | null;
  if (!plan) throw new Error(`Draft plan ${planId} not found.`);
  if (plan.status !== "draft") {
    throw new Error(
      `Plan ${planId} has status ${plan.status} — only 'draft' rows can be loaded into the editor.`,
    );
  }

  const planProductRows = assertOk(
    await supabase.from("planProducts").select("*").eq("planId", planId),
  ) as PlanProduct[];
  const pp = planProductRows[0];
  if (!pp) throw new Error(`Draft plan ${planId} has no planProducts row.`);

  const product = assertOkMaybe(
    await supabase.from("products").select("*").eq("id", pp.productId).maybeSingle(),
  ) as Product | null;
  if (!product) throw new Error(`Product ${pp.productId} for draft ${planId} not found.`);

  const mould = assertOkMaybe(
    await supabase.from("moulds").select("*").eq("id", pp.mouldId).maybeSingle(),
  ) as Mould | null;
  if (!mould) throw new Error(`Mould ${pp.mouldId} for draft ${planId} not found.`);

  const oplRows = assertOk(
    await supabase.from("orderPlanLinks").select("*").eq("planId", planId),
  ) as OrderPlanLink[];
  const pplRows = assertOk(
    await supabase.from("poPlanLinks").select("*").eq("planId", planId),
  ) as PoPlanLink[];

  // Order allocations: join orderItems → orders for customer/event label.
  const allocations: DraftAllocation[] = [];
  if (oplRows.length > 0) {
    const itemIds = oplRows.map((l) => l.orderItemId);
    const items = assertOk(
      await supabase.from("orderItems").select("*").in("id", itemIds),
    ) as OrderItem[];
    const orderIds = [...new Set(items.map((it) => it.orderId))];
    const orders = orderIds.length > 0
      ? assertOk(await supabase.from("orders").select("*").in("id", orderIds)) as Order[]
      : [];
    const itemById = new Map(items.map((it) => [it.id!, it]));
    const orderById = new Map(orders.map((o) => [o.id!, o]));
    for (const link of oplRows) {
      const item = itemById.get(link.orderItemId);
      const order = item ? orderById.get(item.orderId) : null;
      allocations.push({
        source: "order",
        parentId: link.orderItemId,
        qty: link.allocatedQuantity,
        label:
          order?.customerName ??
          order?.eventName ??
          order?.sourceRef ??
          "Order",
        dueDate: order?.deadline ? toIsoDate(order.deadline) : null,
      });
    }
  }

  // PO allocations: join productionOrderItems → productionOrders for label.
  if (pplRows.length > 0) {
    const poItemIds = pplRows.map((l) => l.productionOrderItemId);
    const poItems = assertOk(
      await supabase.from("productionOrderItems").select("*").in("id", poItemIds),
    ) as ProductionOrderItem[];
    const poIds = [...new Set(poItems.map((it) => it.productionOrderId))];
    const pos = poIds.length > 0
      ? assertOk(await supabase.from("productionOrders").select("*").in("id", poIds)) as ProductionOrder[]
      : [];
    const poItemById = new Map(poItems.map((it) => [it.id!, it]));
    const poById = new Map(pos.map((p) => [p.id!, p]));
    for (const link of pplRows) {
      const poItem = poItemById.get(link.productionOrderItemId);
      const po = poItem ? poById.get(poItem.productionOrderId) : null;
      allocations.push({
        source: "po",
        parentId: link.productionOrderItemId,
        qty: link.allocatedQuantity,
        label: po?.name ?? po?.channel ?? "PO",
        dueDate: po?.dueDate ? toIsoDate(po.dueDate) : null,
      });
    }
  }

  const totalDemand = allocations.reduce((s, a) => s + a.qty, 0);
  const mouldCount = pp.quantity;
  const totalPieces = mouldCount * (mould.numberOfCavities ?? 0);
  const surplus = Math.max(0, totalPieces - totalDemand);

  // surplusDestination: the DB column stores 'store'|'freezer'|'waste'|null.
  // The draft type also allows 'po-fill', which collapses to 'store' on
  // save — we can't reconstruct the original 'po-fill' intent here, so
  // round-trip lands on whichever the DB column carries.
  const surplusDestination = (plan.surplusDestination ?? null) as SurplusDestination;

  return {
    id: plan.id!,
    productId: pp.productId,
    productName: product.name,
    mouldId: pp.mouldId,
    mouldName: mould.name,
    numberOfCavities: mould.numberOfCavities ?? 0,
    mouldCount,
    totalPieces,
    totalDemand,
    surplus,
    surplusDestination,
    poFillPlanId: null,
    allocations,
    pinnedDate: null, // status='draft' rows are by definition unscheduled.
    notes: plan.notes ?? "",
    name: plan.name,
  };
}

function toIsoDate(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}
