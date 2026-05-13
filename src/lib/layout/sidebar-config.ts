/**
 * Sidebar nav tree — single source of truth.
 *
 * Spec: docs/SIDEBAR_REDESIGN_SPEC.md
 * Hrefs verified against docs/SIDEBAR_INVENTORY_2026-05-13.md.
 *
 * Corrections applied vs the draft in the spec (mismatches flagged
 * against the inventory):
 *   /decoration              → /pantry/decoration
 *   /shop/transfer-in        → /shop/transfer
 *   /shop/stock-out          → /shop/breakage
 *   /shop/monthly-count      → /shop/count
 *   /price-lists             → /pricing/lists
 *   /observatory/sales       → /reports/sales
 *   /observatory/monthly     → /reports/monthly
 *   /observatory/stats       → /stats
 *   /observatory/pricing     → /pricing
 *   /observatory/imports     → /imports
 *   /lab/audit               → /audit
 */

export type BadgeKey =
  | "orders.overdue"
  | "picking.ready"
  | "haccp.incomplete"
  | "stock.belowMin"
  | "ingredients.short"
  | "campaigns.urgent";

export interface SidebarSubItem {
  label: string;
  href: string;
  icon: string;            // Tabler icon name (resolved at render time)
  badgeKey?: BadgeKey;
}

export interface SidebarSubGroup {
  /** Empty string = no visible group heading. */
  label: string;
  items: SidebarSubItem[];
}

export interface SidebarSpace {
  id: string;
  label: string;
  icon: string;
  /** Route to navigate to when the space row is clicked directly
   *  (vs the chevron toggle). */
  defaultHref: string;
  groups: SidebarSubGroup[];
}

export const SIDEBAR_CONFIG: SidebarSpace[] = [
  {
    id: "workshop",
    label: "Workshop",
    icon: "clipboard",
    defaultHref: "/workshop",
    groups: [
      {
        label: "Work queue",
        items: [
          { label: "Orders", href: "/orders", icon: "list", badgeKey: "orders.overdue" },
          { label: "Picking", href: "/picking", icon: "package", badgeKey: "picking.ready" },
          { label: "Production orders", href: "/production-orders", icon: "clipboard-list" },
        ],
      },
      {
        label: "Schedule",
        items: [
          { label: "Calendar (month)", href: "/calendar", icon: "calendar" },
          { label: "Plan (week)", href: "/plan?view=weekly", icon: "layout-grid" },
          { label: "Daily", href: "/production-brain/daily", icon: "calendar-event" },
        ],
      },
      {
        label: "Planning tools",
        items: [
          { label: "Planner (replen)", href: "/production-brain/planner", icon: "layout-board-split" },
          { label: "Manual planner", href: "/production-brain/manual", icon: "edit" },
          { label: "Needed vs stock", href: "/production-brain/needed", icon: "list-check" },
        ],
      },
      {
        label: "Resources",
        items: [
          { label: "Stock", href: "/stock", icon: "box", badgeKey: "stock.belowMin" },
          { label: "Equipment", href: "/production-brain/equipment", icon: "settings" },
          { label: "HACCP", href: "/production-brain/haccp", icon: "alert-triangle", badgeKey: "haccp.incomplete" },
        ],
      },
      {
        label: "Campaigns",
        items: [
          { label: "Campaigns", href: "/campaigns", icon: "rocket", badgeKey: "campaigns.urgent" },
        ],
      },
    ],
  },
  {
    id: "pantry",
    label: "Pantry",
    icon: "book",
    defaultHref: "/pantry",
    groups: [
      {
        label: "Catalog",
        items: [
          { label: "Products", href: "/products", icon: "package" },
          { label: "Variants", href: "/variants", icon: "tag" },
        ],
      },
      {
        label: "Recipe building blocks",
        items: [
          { label: "Ingredients", href: "/ingredients", icon: "droplet", badgeKey: "ingredients.short" },
          { label: "Fillings", href: "/fillings", icon: "layers" },
          { label: "Decoration", href: "/pantry/decoration", icon: "brush" },
        ],
      },
      {
        label: "Production materials",
        items: [
          { label: "Moulds", href: "/moulds", icon: "layout-grid" },
          { label: "Packaging", href: "/packaging", icon: "box" },
        ],
      },
    ],
  },
  {
    id: "shop",
    label: "Shop",
    icon: "shopping-bag",
    defaultHref: "/shop",
    groups: [
      {
        label: "",
        items: [
          { label: "Overview", href: "/shop", icon: "home" },
        ],
      },
      {
        label: "Daily operations",
        items: [
          { label: "Counter (custom box)", href: "/shop/counter", icon: "credit-card" },
          { label: "Daily count", href: "/shop/daily-count", icon: "list" },
        ],
      },
      {
        label: "Stock movements",
        items: [
          { label: "Transfer in", href: "/shop/transfer", icon: "arrow-down" },
          { label: "Stock out", href: "/shop/breakage", icon: "arrow-up" },
          { label: "Monthly count", href: "/shop/count", icon: "list-numbers" },
        ],
      },
    ],
  },
  {
    id: "customers",
    label: "Customers",
    icon: "users",
    defaultHref: "/customers",
    groups: [
      {
        label: "",
        items: [
          { label: "Customer list", href: "/customers", icon: "users" },
          { label: "Quotes", href: "/quotes", icon: "file-text" },
          { label: "Price lists", href: "/pricing/lists", icon: "list" },
          { label: "Subscriptions", href: "/subscriptions", icon: "refresh" },
        ],
      },
    ],
  },
  {
    id: "observatory",
    label: "Observatory",
    icon: "chart-bar",
    defaultHref: "/observatory",
    groups: [
      {
        label: "Performance",
        items: [
          { label: "Sales (weekly)", href: "/reports/sales", icon: "trending-up" },
          { label: "Monthly review", href: "/reports/monthly", icon: "calendar" },
          { label: "Stats", href: "/stats", icon: "chart-line" },
        ],
      },
      {
        label: "Economics",
        items: [
          { label: "Pricing (cost + margin)", href: "/pricing", icon: "currency-euro" },
          { label: "Product cost", href: "/observatory/product-cost", icon: "calculator" },
        ],
      },
      {
        label: "Data",
        items: [
          { label: "CSV imports", href: "/imports", icon: "upload" },
        ],
      },
    ],
  },
  {
    id: "lab",
    label: "Lab",
    icon: "flask",
    defaultHref: "/lab",
    groups: [
      {
        label: "",
        items: [
          { label: "Data audit", href: "/audit", icon: "shield-check" },
          { label: "Product Lab", href: "/lab", icon: "flask" },
        ],
      },
    ],
  },
];

export const UTILITY_ITEMS: SidebarSubItem[] = [
  { label: "Shopping", href: "/shopping", icon: "shopping-cart" },
  { label: "Workshop wall", href: "/wall", icon: "device-tv" },
  { label: "Settings", href: "/settings", icon: "settings" },
];

/** Strip a query string off an href for path comparison. Routes in the
 *  config sometimes include `?view=weekly` etc. */
export function hrefPathname(href: string): string {
  const q = href.indexOf("?");
  return q >= 0 ? href.slice(0, q) : href;
}

/** True when `pathname` matches the item href (exact or prefix). */
export function isItemActive(pathname: string, href: string): boolean {
  const target = hrefPathname(href);
  if (target === "/") return pathname === "/";
  return pathname === target || pathname.startsWith(target + "/");
}

/** True when `pathname` falls inside any item of the given space. */
export function isInSpace(pathname: string, space: SidebarSpace): boolean {
  return space.groups.some((g) =>
    g.items.some((i) => isItemActive(pathname, i.href)),
  );
}
