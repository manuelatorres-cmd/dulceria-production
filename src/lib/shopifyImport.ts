/**
 * Shopify order CSV parser — Phase 6 of the production planning system.
 *
 * Shopify's "Orders export" CSV emits ONE ROW PER LINE ITEM rather than
 * one row per order. The header includes fields that describe the
 * overall order (Name, Email, Paid at, Fulfillment Status, Shipping
 * Name, Shipping Street, Total, …) and fields that describe the line
 * item (Lineitem name, Lineitem quantity, Lineitem sku, Lineitem price).
 * Order-level fields are only populated on the first row of each order
 * — subsequent lineitem rows leave them blank.
 *
 * This parser groups rows by the `Name` column (the visible order id
 * like "#1001"), rolls order-level fields up from the first non-empty
 * value, and matches each line item against the user's internal
 * products. The import UI then previews every order + unresolved
 * lineitems before any writes happen.
 *
 * Pure function, no DB. Callers (`/orders/online/import` page) pass
 * the product list and get back a preview.
 */

import type { Product, Variant, VariantPackaging, Packaging } from "@/types";

export interface ShopifyLineItem {
  /** Product name as it appeared in the Shopify storefront. */
  name: string;
  quantity: number;
  /** Optional SKU. When present it's preferred over name matching. */
  sku?: string;
  /** Unit price paid (currency units). Optional — some exports omit it. */
  unitPrice?: number;
  /** Fulfillment status for this line item (Shopify's `Lineitem fulfillment status`). */
  fulfillmentStatus?: string;
  /** Which internal product the importer resolved this line to.
   *  undefined = unresolved (user must pick or skip). Mutually
   *  exclusive with `resolvedVariantId` — a line is either a single
   *  product or a variant SKU. */
  resolvedProductId?: string;
  /** Resolved variant + size when the line maps to a curated SKU
   *  (e.g. "8-piece Try It All"). Triggers addVariantToOrder on
   *  import → spawns derived production-demand orderItems. */
  resolvedVariantId?: string;
  resolvedVariantPackagingId?: string | null;
  /** Why we couldn't resolve the line — shown in the preview. */
  resolutionNote?: string;
}

export interface ShopifyParsedOrder {
  /** Shopify order name, e.g. "#1001". Used for dedup on re-imports. */
  name: string;
  email?: string;
  /** ISO timestamp from Shopify's `Paid at` or `Created at` column. */
  placedAt?: string;
  /** Shipping-name for the packing slip. */
  shippingName?: string;
  /** Flattened shipping address for the packing slip. */
  shippingAddress?: string;
  /** Phone — occasionally useful for delivery. */
  phone?: string;
  /** Overall order fulfillment status: "fulfilled", "unfulfilled", "partial", etc. */
  fulfillmentStatus?: string;
  lineItems: ShopifyLineItem[];
  /** Parse-time notes: unknown columns, missing headers, lineitem dropouts. */
  warnings: string[];
}

export interface ShopifyParseResult {
  orders: ShopifyParsedOrder[];
  /** Missing header columns against the expected Shopify shape. Only the
   *  absolute minimum is enforced (`Name`, `Lineitem quantity`, `Lineitem name`);
   *  everything else is optional. */
  missingRequiredColumns: string[];
  /** Column names in the file that don't match a recognised Shopify field.
   *  Shown as a soft warning — unknown columns are ignored. */
  unknownColumns: string[];
  /** Orders already in the DB (keyed by name) that the import should skip. */
  duplicateNames: string[];
}

// ---------------------------------------------------------------
// CSV tokeniser
// ---------------------------------------------------------------

/** Split one CSV row into cell values, respecting double-quoted fields
 *  that may contain commas and embedded "" escape sequences. */
export function parseCsvRow(row: string): string[] {
  const out: string[] = [];
  let i = 0;
  let current = "";
  let inQuotes = false;
  while (i < row.length) {
    const ch = row[i];
    if (inQuotes) {
      if (ch === '"') {
        if (row[i + 1] === '"') { current += '"'; i += 2; continue; }
        inQuotes = false;
        i++; continue;
      }
      current += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { out.push(current); current = ""; i++; continue; }
    current += ch; i++;
  }
  out.push(current);
  return out.map((c) => c.trim());
}

/** Split the full CSV text into rows, preserving quoted newlines. */
export function parseCsvText(text: string): string[][] {
  // Normalise line endings, then walk character-by-character so that
  // newlines inside quoted cells don't break the row count.
  const normalised = text.replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row = "";
  let inQuotes = false;
  for (let i = 0; i < normalised.length; i++) {
    const ch = normalised[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      row += ch; continue;
    }
    if (ch === "\n" && !inQuotes) {
      if (row.length > 0) rows.push(parseCsvRow(row));
      row = "";
      continue;
    }
    row += ch;
  }
  if (row.length > 0) rows.push(parseCsvRow(row));
  return rows;
}

// ---------------------------------------------------------------
// Shopify column index
// ---------------------------------------------------------------

const KNOWN_COLUMNS = new Set([
  "Name",
  "Email",
  "Financial Status",
  "Paid at",
  "Fulfillment Status",
  "Fulfilled at",
  "Accepts Marketing",
  "Currency",
  "Subtotal",
  "Shipping",
  "Taxes",
  "Total",
  "Discount Code",
  "Discount Amount",
  "Shipping Method",
  "Created at",
  "Lineitem quantity",
  "Lineitem name",
  "Lineitem price",
  "Lineitem compare at price",
  "Lineitem sku",
  "Lineitem requires shipping",
  "Lineitem taxable",
  "Lineitem fulfillment status",
  "Billing Name",
  "Billing Street",
  "Billing Address1",
  "Billing Address2",
  "Billing Company",
  "Billing City",
  "Billing Zip",
  "Billing Province",
  "Billing Country",
  "Billing Phone",
  "Shipping Name",
  "Shipping Street",
  "Shipping Address1",
  "Shipping Address2",
  "Shipping Company",
  "Shipping City",
  "Shipping Zip",
  "Shipping Province",
  "Shipping Country",
  "Shipping Phone",
  "Notes",
  "Note Attributes",
  "Cancelled at",
  "Payment Method",
  "Payment Reference",
  "Refunded Amount",
  "Vendor",
  "Id",
  "Tags",
  "Risk Level",
  "Source",
  "Lineitem discount",
  "Tax 1 Name",
  "Tax 1 Value",
  "Phone",
]);

const REQUIRED_COLUMNS = ["Name", "Lineitem name", "Lineitem quantity"];

// ---------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------

export interface ParseShopifyOptions {
  products: Product[];
  /** Variants + their sizes available for matching. When a Lineitem
   *  name matches a variant alias / canonical name first, we resolve
   *  to a variant instead of a product. Pre-built sizes keep the
   *  match O(1). */
  variants?: Variant[];
  variantPackagings?: VariantPackaging[];
  /** Packaging rows (capacity + name) used to auto-pick a size from
   *  the line item name when the variant has multiple. E.g. "Box of 4"
   *  in the Lineitem name → match the variantPackaging whose
   *  packaging.capacity = 4. */
  packagings?: Packaging[];
  /** Order names (Shopify "Name" field) already in the database — rows
   *  whose Name matches are still parsed (so the user sees them) but
   *  flagged as duplicates so the import step skips them. */
  existingOrderNames?: Set<string>;
}

export function parseShopifyCsv(text: string, opts: ParseShopifyOptions): ShopifyParseResult {
  const rows = parseCsvText(text);
  if (rows.length === 0) {
    return { orders: [], missingRequiredColumns: REQUIRED_COLUMNS, unknownColumns: [], duplicateNames: [] };
  }
  const header = rows[0];
  const colIndex = new Map<string, number>();
  header.forEach((h, i) => colIndex.set(h, i));

  const missingRequiredColumns = REQUIRED_COLUMNS.filter((c) => !colIndex.has(c));
  const unknownColumns = header.filter((h) => h && !KNOWN_COLUMNS.has(h));

  if (missingRequiredColumns.length > 0) {
    return { orders: [], missingRequiredColumns, unknownColumns, duplicateNames: [] };
  }

  const get = (row: string[], col: string): string => {
    const i = colIndex.get(col);
    if (i == null) return "";
    return row[i] ?? "";
  };

  // Build product lookup maps up-front so match is O(1) per lineitem.
  // Aliases (Shopify storefront titles, German labels, etc.) are
  // matched alongside the canonical name — auto-built from prior
  // manual mappings.
  const byName = new Map<string, Product>();
  const bySku = new Map<string, Product>();
  for (const p of opts.products) {
    if (!p.archived) {
      byName.set(p.name.toLowerCase().trim(), p);
      for (const alias of p.aliases ?? []) {
        if (alias.trim()) byName.set(alias.toLowerCase().trim(), p);
      }
      const sku = (p as unknown as { sku?: string }).sku;
      if (sku) bySku.set(sku.toLowerCase().trim(), p);
    }
  }

  // Variant lookup: canonical name + aliases → variant (default to
  // the variant's only / first size). Variants take precedence over
  // products when both could match — Shopify SKUs typically map to
  // bundled boxes, not individual chocolates.
  const variants = opts.variants ?? [];
  const variantPackagings = opts.variantPackagings ?? [];
  const packagings = opts.packagings ?? [];
  const packagingById = new Map(packagings.map((p) => [p.id!, p]));
  const vpsByVariant = new Map<string, VariantPackaging[]>();
  for (const vp of variantPackagings) {
    const arr = vpsByVariant.get(vp.variantId) ?? [];
    arr.push(vp);
    vpsByVariant.set(vp.variantId, arr);
  }
  const byVariantName = new Map<string, { variant: Variant; sizes: VariantPackaging[] }>();
  for (const v of variants) {
    if (!v.id) continue;
    const sizes = vpsByVariant.get(v.id) ?? [];
    const entry = { variant: v, sizes };
    byVariantName.set(v.name.toLowerCase().trim(), entry);
    for (const alias of v.aliases ?? []) {
      if (alias.trim()) byVariantName.set(alias.toLowerCase().trim(), entry);
    }
  }

  /** Pick the right variant size for a line item name. If the variant
   *  has only one size → pick it. If multiple → look for an integer in
   *  the line name (e.g. "Box of 4", "Pralinen 8er", "16 piece gift")
   *  and match it to a packaging.capacity. Falls back to null when
   *  ambiguous so the operator can resolve in the preview UI. */
  function pickSize(sizes: VariantPackaging[], lineName: string): string | null {
    if (sizes.length === 0) return null;
    if (sizes.length === 1) return sizes[0].id ?? null;
    // Collect every integer in the line name. Common patterns:
    //   "Box of 4", "8er", "Box of 16 Pralinen", "4 piece gift"
    const numbers = [...lineName.matchAll(/\b(\d+)\b/g)]
      .map((m) => parseInt(m[1], 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    for (const n of numbers) {
      const matches = sizes.filter((vp) => {
        const pkg = vp.packagingId ? packagingById.get(vp.packagingId) : undefined;
        return pkg?.capacity === n;
      });
      if (matches.length === 1) return matches[0].id ?? null;
    }
    return null;
  }

  const ordersByName = new Map<string, ShopifyParsedOrder>();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = get(row, "Name").trim();
    if (!name) continue; // skip blank trailing rows

    let order = ordersByName.get(name);
    if (!order) {
      order = { name, lineItems: [], warnings: [] };
      ordersByName.set(name, order);
    }

    // Roll up order-level fields from whichever row carries them.
    const rollup = (cur: string | undefined, col: string): string | undefined => {
      if (cur) return cur;
      const v = get(row, col);
      return v ? v : cur;
    };
    order.email = rollup(order.email, "Email");
    order.placedAt = rollup(order.placedAt, "Paid at") ?? rollup(order.placedAt, "Created at");
    order.shippingName = rollup(order.shippingName, "Shipping Name");
    order.phone = rollup(order.phone, "Shipping Phone") ?? rollup(order.phone, "Phone");
    order.fulfillmentStatus = rollup(order.fulfillmentStatus, "Fulfillment Status");

    // Flatten shipping address from Shopify's split columns.
    const addrParts = [
      get(row, "Shipping Address1") || get(row, "Shipping Street"),
      get(row, "Shipping Address2"),
      get(row, "Shipping City"),
      get(row, "Shipping Zip"),
      get(row, "Shipping Province"),
      get(row, "Shipping Country"),
    ].filter((s) => s && s.length > 0);
    if (!order.shippingAddress && addrParts.length > 0) {
      order.shippingAddress = addrParts.join(", ");
    }

    // Line item (rows with empty Lineitem name are order-level only — skip them).
    const liName = get(row, "Lineitem name");
    const liQtyStr = get(row, "Lineitem quantity");
    if (!liName && !liQtyStr) continue;
    const liQty = parseInt(liQtyStr, 10);
    if (!Number.isFinite(liQty) || liQty <= 0) {
      order.warnings.push(`Row ${r + 1}: skipped "${liName || "(unknown)"}" — invalid quantity`);
      continue;
    }
    const liSku = get(row, "Lineitem sku").trim() || undefined;
    const liPriceStr = get(row, "Lineitem price");
    const liPrice = liPriceStr ? parseFloat(liPriceStr) : undefined;
    const liFulfillStatus = get(row, "Lineitem fulfillment status").trim() || undefined;

    // Resolve against variants first (curated SKUs), then products.
    let resolvedProduct: Product | undefined;
    let resolvedVariantEntry: { variant: Variant; packagingId: string | null } | undefined;
    let resolutionNote: string | undefined;

    const normalized = liName.toLowerCase().trim();
    let variantHit = byVariantName.get(normalized);
    if (!variantHit) {
      const dashIdx = normalized.indexOf(" - ");
      if (dashIdx > 0) {
        const base = normalized.slice(0, dashIdx).trim();
        variantHit = byVariantName.get(base);
      }
    }
    if (variantHit) {
      resolvedVariantEntry = {
        variant: variantHit.variant,
        packagingId: pickSize(variantHit.sizes, liName),
      };
    }

    if (!resolvedVariantEntry) {
      if (liSku) {
        resolvedProduct = bySku.get(liSku.toLowerCase());
        if (!resolvedProduct) resolutionNote = `No product with SKU "${liSku}"`;
      }
      if (!resolvedProduct) {
        resolvedProduct = byName.get(normalized);
        if (!resolvedProduct) {
          const dashIdx = normalized.indexOf(" - ");
          if (dashIdx > 0) {
            const base = normalized.slice(0, dashIdx).trim();
            resolvedProduct = byName.get(base);
          }
        }
        if (!resolvedProduct && !resolutionNote) {
          resolutionNote = `No product or variant named "${liName}"`;
        }
      }
    }

    order.lineItems.push({
      name: liName,
      quantity: liQty,
      sku: liSku,
      unitPrice: liPrice != null && Number.isFinite(liPrice) ? liPrice : undefined,
      fulfillmentStatus: liFulfillStatus,
      resolvedProductId: resolvedProduct?.id,
      resolvedVariantId: resolvedVariantEntry?.variant.id,
      resolvedVariantPackagingId: resolvedVariantEntry?.packagingId,
      resolutionNote: (resolvedProduct || resolvedVariantEntry) ? undefined : resolutionNote,
    });
  }

  const duplicateNames: string[] = [];
  const orders = Array.from(ordersByName.values());
  for (const o of orders) {
    if (opts.existingOrderNames?.has(o.name)) duplicateNames.push(o.name);
  }

  return {
    orders,
    missingRequiredColumns: [],
    unknownColumns,
    duplicateNames,
  };
}
