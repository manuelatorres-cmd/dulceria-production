"use client";

import { useSearchParams } from "next/navigation";

/**
 * Cross-section navigation context.
 *
 * Pages link to detail pages in *other* sidebar sections (Workshop ↔ Pantry,
 * etc.). Without context, Back on the detail page lands on its list (or on
 * `router.back()` which breaks after save-redirects). We pass `?from=<code>`
 * on every cross-section link; the destination's Back button reads it and
 * routes back to the *exact* source page with a friendly label, and the
 * sidebar stays scoped to the source section.
 *
 * Add new codes here as new flows appear. Each code maps to:
 *   - href:     where Back should go
 *   - label:    what the Back button reads ("Back to <label>")
 *   - section:  which sidebar section to keep highlighted while in the detail
 *
 * Codes are short identifiers so URLs stay readable. Keep them stable —
 * existing links in the wild rely on them.
 */
export type FromCode =
  | "picking"
  | "plan"
  | "daily"
  | "planner"
  | "workshop"
  | "shop"
  | "campaigns"
  | "production"
  | "production-products"
  | "production-orders"
  | "orders"
  | "products"
  | "variants"
  | "ingredients"
  | "fillings"
  | "packaging"
  | "moulds"
  | "pantry"
  | "customers"
  | "quotes"
  | "subscriptions"
  | "dashboard"
  | "stock";

type FromEntry = {
  href: (id?: string) => string;
  label: string;
  /** Sidebar section route prefix used by side-nav.getActiveSection. */
  section: string;
};

const FROM_TABLE: Record<FromCode, FromEntry> = {
  picking: { href: () => "/picking", label: "Picking", section: "/picking" },
  plan: { href: () => "/plan", label: "Plan", section: "/plan" },
  daily: { href: () => "/production-brain/daily", label: "Today", section: "/production-brain" },
  planner: { href: () => "/production-brain/planner", label: "Planner", section: "/production-brain" },
  workshop: { href: () => "/workshop", label: "Workshop", section: "/workshop" },
  shop: { href: () => "/shop", label: "Shop", section: "/shop" },
  campaigns: { href: (id) => (id ? `/campaigns/${encodeURIComponent(id)}` : "/campaigns"), label: "Campaign", section: "/campaigns" },
  production: { href: (id) => (id ? `/production/${encodeURIComponent(id)}` : "/production"), label: "Batch", section: "/production" },
  "production-products": { href: (id) => (id ? `/production/${encodeURIComponent(id)}/products` : "/production"), label: "Batch products", section: "/production" },
  "production-orders": { href: (id) => (id ? `/production-orders/${encodeURIComponent(id)}` : "/production-orders"), label: "Production order", section: "/production-orders" },
  orders: { href: (id) => (id ? `/orders/${encodeURIComponent(id)}` : "/orders"), label: "Order", section: "/orders" },
  products: { href: (id) => (id ? `/products/${encodeURIComponent(id)}` : "/products"), label: "Product", section: "/products" },
  variants: { href: (id) => (id ? `/variants/${encodeURIComponent(id)}` : "/variants"), label: "Variant", section: "/variants" },
  ingredients: { href: (id) => (id ? `/ingredients/${encodeURIComponent(id)}` : "/ingredients"), label: "Ingredient", section: "/ingredients" },
  fillings: { href: (id) => (id ? `/fillings/${encodeURIComponent(id)}` : "/fillings"), label: "Filling", section: "/fillings" },
  packaging: { href: (id) => (id ? `/packaging/${encodeURIComponent(id)}` : "/packaging"), label: "Packaging", section: "/packaging" },
  moulds: { href: (id) => (id ? `/moulds/${encodeURIComponent(id)}` : "/moulds"), label: "Mould", section: "/moulds" },
  pantry: { href: () => "/pantry", label: "Pantry", section: "/pantry" },
  customers: { href: (id) => (id ? `/customers/${encodeURIComponent(id)}` : "/customers"), label: "Customer", section: "/customers" },
  quotes: { href: (id) => (id ? `/quotes/${encodeURIComponent(id)}` : "/quotes"), label: "Quote", section: "/quotes" },
  subscriptions: { href: (id) => (id ? `/subscriptions/${encodeURIComponent(id)}` : "/subscriptions"), label: "Subscription", section: "/subscriptions" },
  dashboard: { href: () => "/dashboard", label: "Dashboard", section: "/dashboard" },
  stock: { href: () => "/stock", label: "Stock", section: "/stock" },
};

/** Append `?from=<code>` (and optional `&fromId=<id>`) to an internal href. */
export function withFrom(href: string, from: FromCode, fromId?: string): string {
  const sep = href.includes("?") ? "&" : "?";
  const idPart = fromId ? `&fromId=${encodeURIComponent(fromId)}` : "";
  return `${href}${sep}from=${from}${idPart}`;
}

/**
 * Build a query-string fragment to append onto a generated href without a
 * trailing `?` collision. Useful when constructing template literals like
 * `` `/products/${id}${fromSuffix}` ``.
 *
 * Returns "" when `from` is not provided so the caller can stay terse.
 */
export function fromSuffix(from?: FromCode | null, fromId?: string): string {
  if (!from) return "";
  const idPart = fromId ? `&fromId=${encodeURIComponent(fromId)}` : "";
  return `?from=${from}${idPart}`;
}

/** Resolve a `from` code (and optional `fromId`) into back-button props.
 *  Also accepts legacy URL-form values (e.g. `from=/products/abc?tab=history`)
 *  so older callers keep working — these become a generic "Back" link. */
export function resolveBack(from: string | null | undefined, fromId?: string | null): { href: string; label: string } | null {
  if (!from) return null;
  // Legacy URL form: from is a literal path. Display generic "Back".
  if (from.startsWith("/")) return { href: from, label: "Back" };
  const entry = FROM_TABLE[from as FromCode];
  if (!entry) return null;
  return { href: entry.href(fromId ?? undefined), label: entry.label };
}

/** Map a `from` code to its sidebar section route prefix (for side-nav). */
export function sectionForFrom(from: string | null | undefined): string | null {
  if (!from) return null;
  const entry = FROM_TABLE[from as FromCode];
  return entry?.section ?? null;
}

/**
 * Hook for detail pages. Reads `?from=` and returns `{ href, label }` to use
 * on the Back button. When no `from` present, returns the supplied fallback
 * so the existing list-page back still works.
 */
export function useBackHref(fallbackHref: string, fallbackLabel: string = "Back"): { href: string; label: string } {
  const sp = useSearchParams();
  const from = sp.get("from");
  const fromId = sp.get("fromId");
  const resolved = resolveBack(from, fromId);
  if (resolved) return resolved;
  return { href: fallbackHref, label: fallbackLabel };
}
