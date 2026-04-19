/**
 * Product spreadsheet import config — with name resolution for shell
 * ingredient, default mould, product category, and fillings.
 *
 * `shellDesign` (JSONB decoration steps) is intentionally skipped — too
 * complex to encode in a spreadsheet cell. Users edit decoration steps in
 * the app after import.
 */

import { supabase, newId } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import type { Product, ProductFilling, Filling, Mould, Ingredient, ProductCategory, FillMode } from "@/types";
import type { ImportConfig, RowIssue } from "@/lib/spreadsheet-import";
import { toStrOpt, toNumOpt, toBoolOpt, toList } from "@/lib/spreadsheet-import";

export const PRODUCT_TEMPLATE_COLUMNS = [
  "name",
  "productCategory",    // category name — resolved to productCategoryId
  "shellIngredient",    // ingredient name — resolved to shellIngredientId (must have shellCapable=true)
  "shellPercentage",    // 0–100
  "fillMode",           // "percentage" (default) or "grams"
  "defaultMould",       // mould name — resolved to defaultMouldId
  "defaultBatchQty",
  "shelfLifeWeeks",
  "lowStockThreshold",
  "vegan",
  "popularity",         // 1–5
  "tags",               // pipe-separated
  "notes",
  // Fillings in "percentage" mode: "<fillingName>:<fillPercentage> | …" (must sum to 100)
  // Fillings in "grams" mode:     "<fillingName>:<fillGrams>g | …"
  "fillings",
];

/** One product ready to import, plus its resolved product-filling join rows. */
export interface ProductImportRow {
  product: Omit<Product, "id" | "createdAt" | "updatedAt">;
  fillings: ResolvedProductFilling[];
  /** Issues picked up during name resolution — bubble into validation. */
  resolutionIssues: RowIssue[];
}

interface ResolvedProductFilling {
  fillingId: string;
  fillPercentage: number;
  fillGrams?: number;
  sortOrder: number;
}

/** Parse `"<name>:<number>[unit]"` — unit optional; `g` indicates grams mode.
 *  Returns null on shape error. */
function parseFillingSegment(segment: string): { name: string; value: number; isGrams: boolean } | null {
  const colonAt = segment.indexOf(":");
  if (colonAt < 0) return null;
  const name = segment.slice(0, colonAt).trim();
  const rest = segment.slice(colonAt + 1).trim();
  if (!name || !rest) return null;
  const m = rest.match(/^([0-9]*\.?[0-9]+)\s*(g)?$/i);
  if (!m) return null;
  const value = parseFloat(m[1]);
  const isGrams = !!m[2];
  if (isNaN(value) || value < 0) return null;
  return { name, value, isGrams };
}

export function buildFillingNameLookup(fillings: Filling[]): Map<string, Filling> {
  const m = new Map<string, Filling>();
  // Prefer current (non-superseded) versions when multiple share a name
  for (const f of fillings) {
    if (f.supersededAt) continue;
    m.set(f.name.toLowerCase().trim(), f);
  }
  // Fall back to any version if no current one was found
  for (const f of fillings) {
    const key = f.name.toLowerCase().trim();
    if (!m.has(key)) m.set(key, f);
  }
  return m;
}

export function buildMouldNameLookup(moulds: Mould[]): Map<string, Mould> {
  const m = new Map<string, Mould>();
  for (const mould of moulds) m.set(mould.name.toLowerCase().trim(), mould);
  return m;
}

export function buildIngredientNameLookup(ingredients: Ingredient[]): Map<string, Ingredient> {
  const m = new Map<string, Ingredient>();
  for (const ing of ingredients) m.set(ing.name.toLowerCase().trim(), ing);
  return m;
}

export function buildProductCategoryLookup(cats: ProductCategory[]): Map<string, ProductCategory> {
  const m = new Map<string, ProductCategory>();
  for (const c of cats) m.set(c.name.toLowerCase().trim(), c);
  return m;
}

export interface ProductImportLookups {
  ingredients: Map<string, Ingredient>;
  fillings: Map<string, Filling>;
  moulds: Map<string, Mould>;
  productCategories: Map<string, ProductCategory>;
}

export function buildProductImportConfig(lookups: ProductImportLookups): ImportConfig<ProductImportRow> {
  function mapRow(row: Record<string, string>): ProductImportRow {
    const resolutionIssues: RowIssue[] = [];
    const fillModeStr = toStrOpt(row.fillMode);
    const fillMode: FillMode =
      fillModeStr === "grams" || fillModeStr === "percentage" ? fillModeStr : "percentage";

    // Resolve shell ingredient
    const shellName = toStrOpt(row.shellIngredient);
    let shellIngredientId: string | undefined;
    if (shellName) {
      const ing = lookups.ingredients.get(shellName.toLowerCase());
      if (!ing?.id) {
        resolutionIssues.push({
          field: "shellIngredient",
          message: `Shell ingredient "${shellName}" not found`,
          severity: "error",
        });
      } else if (!ing.shellCapable) {
        resolutionIssues.push({
          field: "shellIngredient",
          message: `"${shellName}" is not marked shellCapable`,
          severity: "warning",
        });
        shellIngredientId = ing.id;
      } else {
        shellIngredientId = ing.id;
      }
    }

    // Resolve default mould
    const mouldName = toStrOpt(row.defaultMould);
    let defaultMouldId: string | undefined;
    if (mouldName) {
      const mould = lookups.moulds.get(mouldName.toLowerCase());
      if (!mould?.id) {
        resolutionIssues.push({
          field: "defaultMould",
          message: `Mould "${mouldName}" not found`,
          severity: "error",
        });
      } else {
        defaultMouldId = mould.id;
      }
    }

    // Resolve product category
    const catName = toStrOpt(row.productCategory);
    let productCategoryId: string | undefined;
    if (catName) {
      const cat = lookups.productCategories.get(catName.toLowerCase());
      if (!cat?.id) {
        resolutionIssues.push({
          field: "productCategory",
          message: `Product category "${catName}" not found`,
          severity: "error",
        });
      } else {
        productCategoryId = cat.id;
      }
    }

    // Resolve fillings
    const fillings: ResolvedProductFilling[] = [];
    const segments = toList(row.fillings);
    segments.forEach((seg, i) => {
      const parsed = parseFillingSegment(seg);
      if (!parsed) {
        resolutionIssues.push({
          field: "fillings",
          message: `Could not parse "${seg}" — expected "<name>:<number>" or "<name>:<grams>g"`,
          severity: "error",
        });
        return;
      }
      const filling = lookups.fillings.get(parsed.name.toLowerCase());
      if (!filling?.id) {
        resolutionIssues.push({
          field: "fillings",
          message: `Filling "${parsed.name}" not found`,
          severity: "error",
        });
        return;
      }
      if (fillMode === "grams" && !parsed.isGrams) {
        resolutionIssues.push({
          field: "fillings",
          message: `Filling "${parsed.name}" needs a grams value (e.g. "${parsed.name}:12g") when fillMode is grams`,
          severity: "warning",
        });
      }
      fillings.push({
        fillingId: filling.id,
        fillPercentage: fillMode === "percentage" ? parsed.value : 0,
        fillGrams: fillMode === "grams" ? parsed.value : undefined,
        sortOrder: i,
      });
    });

    const product: Omit<Product, "id" | "createdAt" | "updatedAt"> = {
      name: (row.name ?? "").trim(),
      productCategoryId,
      shellIngredientId,
      shellPercentage: toNumOpt(row.shellPercentage),
      fillMode,
      defaultMouldId,
      defaultBatchQty: toNumOpt(row.defaultBatchQty),
      shelfLifeWeeks: toStrOpt(row.shelfLifeWeeks),
      lowStockThreshold: toNumOpt(row.lowStockThreshold),
      vegan: toBoolOpt(row.vegan),
      popularity: toNumOpt(row.popularity),
      tags: toList(row.tags).length > 0 ? toList(row.tags) : undefined,
      notes: toStrOpt(row.notes),
    };

    return { product, fillings, resolutionIssues };
  }

  function validateRow(row: ProductImportRow): RowIssue[] {
    const issues: RowIssue[] = [...row.resolutionIssues];
    if (!row.product.name) {
      issues.push({ field: "name", message: "Name is required", severity: "error" });
    }
    if (row.product.fillMode === "percentage" && row.fillings.length > 0) {
      const total = row.fillings.reduce((s, f) => s + f.fillPercentage, 0);
      if (Math.abs(total - 100) > 0.5) {
        issues.push({
          field: "fillings",
          message: `Fill percentages sum to ${total.toFixed(1)}% (expected 100%)`,
          severity: "warning",
        });
      }
    }
    if (row.product.popularity != null && (row.product.popularity < 1 || row.product.popularity > 5)) {
      issues.push({
        field: "popularity",
        message: "Popularity should be between 1 and 5",
        severity: "warning",
      });
    }
    return issues;
  }

  async function commitBatch(items: ProductImportRow[]): Promise<number> {
    if (items.length === 0) return 0;
    const insertedIds: string[] = [];
    const now = new Date();
    const productInserts: (Omit<Product, "id" | "createdAt" | "updatedAt"> & { id: string; createdAt: Date; updatedAt: Date })[] = [];
    const fillingInserts: (Omit<ProductFilling, "id"> & { id: string })[] = [];

    for (const item of items) {
      const productId = newId();
      insertedIds.push(productId);
      productInserts.push({ ...item.product, id: productId, createdAt: now, updatedAt: now });
      for (const rf of item.fillings) {
        fillingInserts.push({
          id: newId(),
          productId,
          fillingId: rf.fillingId,
          sortOrder: rf.sortOrder,
          fillPercentage: rf.fillPercentage,
          fillGrams: rf.fillGrams,
        });
      }
    }

    const { error: pErr } = await supabase.from("products").insert(productInserts);
    if (pErr) throw pErr;

    if (fillingInserts.length > 0) {
      const { error: fErr } = await supabase.from("productFillings").insert(fillingInserts);
      if (fErr) {
        // Best-effort rollback so we don't leave orphan products
        await supabase.from("products").delete().in("id", insertedIds);
        throw fErr;
      }
    }

    return items.length;
  }

  return {
    entityName: "product",
    templateColumns: PRODUCT_TEMPLATE_COLUMNS,
    mapRow,
    validateRow: (data) => validateRow(data),
    dedupKey: (data) => data.product.name.toLowerCase().trim(),
    commitBatch,
  };
}

export async function getExistingProductKeys(): Promise<Set<string>> {
  const all = assertOk(await supabase.from("products").select("name")) as { name: string }[];
  return new Set(all.map((p) => p.name.toLowerCase().trim()));
}
