"use client";

import type { BadgeKey } from "./sidebar-config";
import type { BadgeVariant } from "@/components/layout/sidebar-subitem";

export interface BadgeData {
  count: number;
  variant: BadgeVariant;
}

export type SidebarBadgeMap = Partial<Record<BadgeKey, BadgeData | null>>;

/**
 * Sidebar badge counts.
 *
 * Phase 1+2 ships with an empty stub — no badges render. Phase 3 will
 * wire each key to a real query against existing hooks
 * (useOrders / useAllOrderItems / useStockLocationMinimums /
 *  useAllIngredientStock / useCampaigns / etc.) so the sidebar surfaces
 * live counts.
 */
export function useSidebarBadges(): SidebarBadgeMap {
  return {};
}
