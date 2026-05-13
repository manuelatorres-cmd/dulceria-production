"use client";

import { useMemo } from "react";
import {
  useOrders,
  useTodayProductionDay,
  useProductsList,
  useProductLocationTotals,
  useStockLocationMinimums,
  useAllIngredientStock,
  useCampaigns,
  useEquipment,
} from "@/lib/hooks";
import type { BadgeKey } from "./sidebar-config";
import type { BadgeVariant } from "@/components/layout/sidebar-subitem";

export interface BadgeData {
  count: number;
  variant: BadgeVariant;
}

export type SidebarBadgeMap = Partial<Record<BadgeKey, BadgeData | null>>;

/**
 * Sidebar live badge counts.
 *
 * Reads from existing hooks (no new endpoints). Hooks return [] / null
 * while loading; the badges naturally start hidden and pop in as data
 * arrives. No badge renders when its count is 0.
 */
export function useSidebarBadges(): SidebarBadgeMap {
  const orders = useOrders();
  const products = useProductsList(true);
  const productLocationTotals = useProductLocationTotals();
  const stockLocationMinimums = useStockLocationMinimums();
  const ingredientStock = useAllIngredientStock();
  const campaigns = useCampaigns();
  const equipment = useEquipment(false);
  const todayDay = useTodayProductionDay();

  return useMemo<SidebarBadgeMap>(() => {
    const todayMs = (() => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })();

    // ── orders.overdue ─────────────────────────────────────────
    const overdueOrders = orders.filter((o) => {
      if (
        o.status !== "pending" &&
        o.status !== "in_production" &&
        o.status !== "ready_to_pack"
      )
        return false;
      if (!o.deadline) return false;
      return new Date(o.deadline).getTime() < todayMs;
    });

    // ── picking.ready ──────────────────────────────────────────
    const pickingReady = orders.filter((o) => o.status === "ready_to_pack");

    // ── haccp.incomplete ───────────────────────────────────────
    let haccpTodos = 0;
    if (todayDay && !todayDay.closedAt) {
      const tempCheckDevices = equipment.filter((e) => e.requiresTempCheck);
      if (tempCheckDevices.length > 0 && !todayDay.tempLogComplete) haccpTodos++;
      if (!todayDay.cleaningComplete) haccpTodos++;
    }

    // ── stock.belowMin ─────────────────────────────────────────
    const minByProduct = new Map<string, number>();
    for (const m of stockLocationMinimums) {
      const cur = minByProduct.get(m.productId) ?? 0;
      minByProduct.set(m.productId, cur + (m.minimumUnits ?? 0));
    }
    let belowMin = 0;
    for (const product of products) {
      if (product.archived) continue;
      const totals = productLocationTotals.get(product.id!);
      const current =
        (totals?.store ?? 0) + (totals?.production ?? 0) + (totals?.freezer ?? 0);
      const minimum = minByProduct.get(product.id!) ?? 0;
      if (minimum > 0 && current < minimum) belowMin++;
    }

    // ── ingredients.short ──────────────────────────────────────
    const ingredientsShort = ingredientStock.filter(
      (i) =>
        typeof i.quantityG === "number" &&
        typeof i.lowStockThresholdG === "number" &&
        i.quantityG < (i.lowStockThresholdG ?? 0),
    ).length;

    // ── campaigns.urgent ───────────────────────────────────────
    // Active or planned campaigns whose endDate is within the next 3 days.
    const urgentCampaigns = campaigns.filter((c) => {
      if (c.status !== "planned" && c.status !== "active") return false;
      if (!c.endDate) return false;
      const end = new Date(c.endDate + "T23:59:59").getTime();
      if (Number.isNaN(end)) return false;
      const days = Math.ceil((end - todayMs) / 86_400_000);
      return days >= 0 && days <= 3;
    }).length;

    return {
      "orders.overdue":
        overdueOrders.length > 0
          ? { count: overdueOrders.length, variant: "urgent" }
          : null,
      "picking.ready":
        pickingReady.length > 0
          ? { count: pickingReady.length, variant: "ok" }
          : null,
      "haccp.incomplete":
        haccpTodos > 0 ? { count: haccpTodos, variant: "warn" } : null,
      "stock.belowMin":
        belowMin > 0
          ? { count: belowMin, variant: belowMin > 20 ? "urgent" : "warn" }
          : null,
      "ingredients.short":
        ingredientsShort > 0
          ? { count: ingredientsShort, variant: "warn" }
          : null,
      "campaigns.urgent":
        urgentCampaigns > 0
          ? { count: urgentCampaigns, variant: "warn" }
          : null,
    };
  }, [
    orders,
    products,
    productLocationTotals,
    stockLocationMinimums,
    ingredientStock,
    campaigns,
    equipment,
    todayDay,
  ]);
}
