/**
 * Box-builder CSV parser — pairs with the Shopify orders import.
 *
 * The box-builder app exports one row per chocolate per order, in the
 * shape:
 *
 *   Order Number,Lineitem name,Lineitem quantity
 *   #4413,"Apple Walnut x3",3
 *   #4413,"Strawberry Nougat x1",1
 *
 * The chocolate name often has a " xN" suffix that mirrors the
 * quantity column — we strip it and use the explicit Lineitem
 * quantity. Matching against internal products goes via canonical
 * name → aliases (case-insensitive trim). Order Number must match
 * an existing order's `sourceRef` (i.e. the Shopify Name #1001).
 *
 * Pure function. No DB. Caller (`/orders/online/import-bonbons`)
 * passes products and orders, gets back a preview.
 */

import type { Product } from "@/types";

export interface BoxContentLine {
  /** Cleaned chocolate name (suffix stripped). */
  name: string;
  quantity: number;
  resolvedProductId?: string;
  resolutionNote?: string;
  /** Original raw cell value from the CSV. */
  rawName: string;
}

export interface BoxContentOrder {
  /** Shopify order Name, e.g. "#4413". */
  orderRef: string;
  /** Internal order id once matched to an existing order. */
  orderId?: string;
  /** Why we couldn't pair. */
  matchNote?: string;
  lines: BoxContentLine[];
}

export interface BoxContentParseResult {
  orders: BoxContentOrder[];
  missingRequiredColumns: string[];
  unknownColumns: string[];
}

const REQUIRED_COLUMNS = ["Order Number", "Lineitem name", "Lineitem quantity"];

const KNOWN_COLUMNS = new Set([
  "Order Number",
  "Lineitem name",
  "Lineitem quantity",
  "Lineitem price",
  "Notes",
]);

export function parseCsvRow(row: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (inQuotes) {
      if (ch === '"') {
        if (row[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else {
      if (ch === ",") { out.push(cur); cur = ""; }
      else if (ch === '"') { inQuotes = true; }
      else { cur += ch; }
    }
  }
  out.push(cur);
  return out;
}

export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (row.length > 0) rows.push(parseCsvRow(row));
      row = "";
      // eat \r\n
      if (ch === "\r" && text[i + 1] === "\n") i++;
      continue;
    }
    row += ch;
  }
  if (row.length > 0) rows.push(parseCsvRow(row));
  return rows;
}

/** Strip a trailing " xN" qty marker (case-insensitive). */
export function stripQtySuffix(name: string): string {
  return name.replace(/\s+x\s*\d+\s*$/i, "").trim();
}

export interface ParseBoxContentsOptions {
  products: Product[];
  /** Map sourceRef → orderId so the importer can pair rows by Order Number. */
  ordersByRef: Map<string, string>;
}

export function parseBoxContentsCsv(
  text: string,
  opts: ParseBoxContentsOptions,
): BoxContentParseResult {
  const rows = parseCsvText(text);
  if (rows.length === 0) {
    return { orders: [], missingRequiredColumns: REQUIRED_COLUMNS, unknownColumns: [] };
  }
  const header = rows[0];
  const colIndex = new Map<string, number>();
  header.forEach((h, i) => colIndex.set(h.trim(), i));

  const missingRequiredColumns = REQUIRED_COLUMNS.filter((c) => !colIndex.has(c));
  const unknownColumns = header.map((h) => h.trim()).filter((h) => h && !KNOWN_COLUMNS.has(h));

  if (missingRequiredColumns.length > 0) {
    return { orders: [], missingRequiredColumns, unknownColumns };
  }

  const get = (row: string[], col: string): string => {
    const i = colIndex.get(col);
    if (i == null) return "";
    return row[i] ?? "";
  };

  const byName = new Map<string, Product>();
  for (const p of opts.products) {
    if (p.archived) continue;
    byName.set(p.name.toLowerCase().trim(), p);
    for (const alias of p.aliases ?? []) {
      if (alias.trim()) byName.set(alias.toLowerCase().trim(), p);
    }
  }

  const ordersByRef = new Map<string, BoxContentOrder>();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const orderRef = get(row, "Order Number").trim();
    const liNameRaw = get(row, "Lineitem name");
    const liQtyStr = get(row, "Lineitem quantity").trim();
    if (!orderRef && !liNameRaw && !liQtyStr) continue;
    if (!orderRef) continue;

    let order = ordersByRef.get(orderRef);
    if (!order) {
      const orderId = opts.ordersByRef.get(orderRef);
      order = {
        orderRef,
        orderId,
        matchNote: orderId ? undefined : `No imported order with sourceRef "${orderRef}" — import the Shopify CSV first.`,
        lines: [],
      };
      ordersByRef.set(orderRef, order);
    }

    if (!liNameRaw) continue;
    const cleanName = stripQtySuffix(liNameRaw);
    const qty = parseInt(liQtyStr, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      order.lines.push({
        name: cleanName,
        rawName: liNameRaw,
        quantity: 0,
        resolutionNote: `Invalid quantity "${liQtyStr}"`,
      });
      continue;
    }
    const matched = byName.get(cleanName.toLowerCase().trim());
    order.lines.push({
      name: cleanName,
      rawName: liNameRaw,
      quantity: qty,
      resolvedProductId: matched?.id,
      resolutionNote: matched ? undefined : `No product or alias matches "${cleanName}"`,
    });
  }

  return {
    orders: [...ordersByRef.values()],
    missingRequiredColumns: [],
    unknownColumns,
  };
}
