"use client";

/**
 * Resolve sidebar icon names (from sidebar-config) to actual Tabler
 * icon components. Sidebar-config keeps icons as plain strings so the
 * config stays serialisable + readable; this map does the binding at
 * render time.
 */

import {
  IconHome,
  IconClipboard,
  IconClipboardList,
  IconBook,
  IconShoppingBag,
  IconShoppingCart,
  IconUsers,
  IconChartBar,
  IconChartLine,
  IconFlask,
  IconList,
  IconListCheck,
  IconListNumbers,
  IconPackage,
  IconCalendar,
  IconCalendarEvent,
  IconLayoutGrid,
  IconLayoutBoardSplit,
  IconEdit,
  IconBox,
  IconSettings,
  IconAlertTriangle,
  IconRocket,
  IconTag,
  IconDroplet,
  IconLayersIntersect,
  IconBrush,
  IconCreditCard,
  IconArrowDown,
  IconArrowUp,
  IconFileText,
  IconRefresh,
  IconTrendingUp,
  IconCurrencyEuro,
  IconCalculator,
  IconUpload,
  IconShieldCheck,
  IconDeviceTv,
  type Icon as TablerIcon,
} from "@tabler/icons-react";

export const ICON_BY_NAME: Record<string, TablerIcon> = {
  home: IconHome,
  clipboard: IconClipboard,
  "clipboard-list": IconClipboardList,
  book: IconBook,
  "shopping-bag": IconShoppingBag,
  "shopping-cart": IconShoppingCart,
  users: IconUsers,
  "chart-bar": IconChartBar,
  "chart-line": IconChartLine,
  flask: IconFlask,
  list: IconList,
  "list-check": IconListCheck,
  "list-numbers": IconListNumbers,
  package: IconPackage,
  calendar: IconCalendar,
  "calendar-event": IconCalendarEvent,
  "layout-grid": IconLayoutGrid,
  "layout-board-split": IconLayoutBoardSplit,
  edit: IconEdit,
  box: IconBox,
  settings: IconSettings,
  "alert-triangle": IconAlertTriangle,
  rocket: IconRocket,
  tag: IconTag,
  droplet: IconDroplet,
  layers: IconLayersIntersect,
  brush: IconBrush,
  "credit-card": IconCreditCard,
  "arrow-down": IconArrowDown,
  "arrow-up": IconArrowUp,
  "file-text": IconFileText,
  refresh: IconRefresh,
  "trending-up": IconTrendingUp,
  "currency-euro": IconCurrencyEuro,
  calculator: IconCalculator,
  upload: IconUpload,
  "shield-check": IconShieldCheck,
  "device-tv": IconDeviceTv,
};

export function SidebarIcon({
  name,
  size,
}: {
  name: string;
  size: number;
}) {
  const Icon = ICON_BY_NAME[name];
  if (!Icon) return <span aria-hidden style={{ width: size, height: size, display: "inline-block" }} />;
  return <Icon size={size} stroke={1.5} />;
}
