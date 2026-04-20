/**
 * Ingredient-specific spreadsheet import config.
 *
 * Maps spreadsheet columns → Ingredient objects, validates composition +
 * required fields, and commits via a bulk insert (no price-history triggers —
 * these are fresh imports).
 */

import { supabase, newId } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import type { Ingredient, SubIngredient } from "@/types";
import { INGREDIENT_CATEGORIES } from "@/types";
import type { NutrientKey, NutritionData } from "@/lib/nutrition";
import type { ImportConfig, RowIssue } from "@/lib/spreadsheet-import";
import { toNum, toNumOpt, toStrOpt, toBoolOpt, toList, stripUndefined } from "@/lib/spreadsheet-import";

// ---------------------------------------------------------------------------
// Constants (shared with seed.ts — canonical source)
// ---------------------------------------------------------------------------

export const ALLERGEN_COLUMNS = [
  "gluten", "wheat",
  "crustaceans", "shellfish", "molluscs", "fish",
  "eggs", "milk", "peanuts", "soybeans", "sesame",
  "nuts_almonds", "nuts_hazelnuts", "nuts_walnuts", "nuts_cashews",
  "nuts_pecans", "nuts_brazil", "nuts_pistachios", "nuts_macadamia",
  "celery", "mustard", "sulphites", "lupin",
] as const;

const NUTRITION_COLUMNS: NutrientKey[] = [
  "energyKj", "energyKcal", "fat", "saturatedFat", "transFat",
  "cholesterolMg", "carbohydrate", "sugars", "addedSugars", "fibre",
  "protein", "salt", "sodium", "vitaminDMcg", "calciumMg",
  "ironMg", "potassiumMg",
];

// ---------------------------------------------------------------------------
// Template columns
// ---------------------------------------------------------------------------

export const INGREDIENT_TEMPLATE_COLUMNS = [
  // Core
  "name", "commercialName", "manufacturer", "brand", "vendor", "source", "category",
  // Purchase
  "purchaseCost", "purchaseDate", "purchaseQty", "purchaseUnit", "gramsPerUnit",
  // Notes
  "notes",
  // Composition
  "cacaoFat", "sugar", "milkFat", "water", "solids", "otherFats", "alcohol",
  // Flags
  "shellCapable", "pricingIrrelevant",
  // Sub-ingredients — pipe-separated names, e.g. "cocoa mass | sugar | milk powder"
  "subIngredients",
  // Allergens (22 boolean columns)
  ...ALLERGEN_COLUMNS.map((id) => `allergen_${id}`),
  // Nutrition (17 numeric columns)
  ...NUTRITION_COLUMNS.map((key) => `nut_${key}`),
];

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function parseNutritionColumns(row: Record<string, string>): NutritionData | undefined {
  const data: NutritionData = {};
  for (const key of NUTRITION_COLUMNS) {
    const val = toNumOpt(row[`nut_${key}`]);
    if (val !== undefined) data[key] = val;
  }
  return Object.keys(data).length > 0 ? data : undefined;
}

/** Look up an allergen value across tolerant header variants.
 *  Accepts `allergen_gluten`, `allergen_Gluten`, `ALLERGEN_GLUTEN`,
 *  `gluten`, `Gluten`, etc. — so users who stripped the prefix or
 *  changed casing in their CSV still get their allergen flags read. */
function readAllergenCell(row: Record<string, string>, id: string): string | undefined {
  const prefixed = `allergen_${id}`.toLowerCase();
  const bare = id.toLowerCase();
  for (const key in row) {
    const k = key.toLowerCase().trim();
    if (k === prefixed || k === bare) return row[key];
  }
  return undefined;
}

export function mapIngredientRow(row: Record<string, string>): Omit<Ingredient, "id"> {
  return {
    name: (row.name ?? "").trim(),
    commercialName: toStrOpt(row.commercialName),
    manufacturer: row.manufacturer || "",
    brand: toStrOpt(row.brand),
    vendor: toStrOpt(row.vendor),
    source: row.source || "",
    category: toStrOpt(row.category),
    cost: 0,
    purchaseCost: toNumOpt(row.purchaseCost),
    purchaseDate: toStrOpt(row.purchaseDate),
    purchaseQty: toNumOpt(row.purchaseQty),
    purchaseUnit: toStrOpt(row.purchaseUnit),
    gramsPerUnit: toNumOpt(row.gramsPerUnit),
    notes: row.notes || "",
    cacaoFat: toNum(row.cacaoFat),
    sugar: toNum(row.sugar),
    milkFat: toNum(row.milkFat),
    water: toNum(row.water),
    solids: toNum(row.solids),
    otherFats: toNum(row.otherFats),
    alcohol: toNumOpt(row.alcohol),
    allergens: ALLERGEN_COLUMNS.filter((id) => toBoolOpt(readAllergenCell(row, id)) === true),
    // Default to false when the cell is empty so we don't depend on the
    // DB `default false` clause firing. Some environments have reported
    // 23502 NOT-NULL violations on these columns — sending an explicit
    // boolean sidesteps the whole question.
    shellCapable: toBoolOpt(row.shellCapable) ?? false,
    pricingIrrelevant: toBoolOpt(row.pricingIrrelevant) ?? false,
    subIngredients: parseSubIngredients(row.subIngredients),
    nutrition: parseNutritionColumns(row),
  };
}

/** Parse a pipe-separated sub-ingredient cell into a `SubIngredient[]`.
 *  Only names are captured — percentages aren't exposed in the UI. */
function parseSubIngredients(val: string | undefined): SubIngredient[] | undefined {
  const names = toList(val);
  if (names.length === 0) return undefined;
  return names.map((name) => ({ name }));
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export function validateIngredientRow(data: Omit<Ingredient, "id">): RowIssue[] {
  const issues: RowIssue[] = [];

  // Required: name
  if (!data.name) {
    issues.push({ field: "name", message: "Name is required", severity: "error" });
  }

  // Category: warn if unrecognised (still importable)
  if (data.category && !(INGREDIENT_CATEGORIES as readonly string[]).includes(data.category)) {
    issues.push({
      field: "category",
      message: `Unknown category "${data.category}"`,
      severity: "warning",
    });
  }

  // Composition sum check
  const compSum =
    data.cacaoFat + data.sugar + data.milkFat + data.water + data.solids + data.otherFats + (data.alcohol ?? 0);
  if (compSum > 0 && Math.abs(compSum - 100) > 0.5) {
    issues.push({
      field: "composition",
      message: `Composition sums to ${compSum.toFixed(1)}% (expected 100%)`,
      severity: "warning",
    });
  }

  // Purchase pricing: warn if partial
  const hasCost = data.purchaseCost != null && data.purchaseCost > 0;
  const hasGrams = data.gramsPerUnit != null && data.gramsPerUnit > 0;
  if (hasCost && !hasGrams) {
    issues.push({
      field: "gramsPerUnit",
      message: "purchaseCost set but gramsPerUnit missing — cost per gram can't be calculated",
      severity: "warning",
    });
  }
  if (!hasCost && hasGrams) {
    issues.push({
      field: "purchaseCost",
      message: "gramsPerUnit set but purchaseCost missing — cost per gram can't be calculated",
      severity: "warning",
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const ingredientImportConfig: ImportConfig<Omit<Ingredient, "id">> = {
  entityName: "ingredient",
  templateColumns: INGREDIENT_TEMPLATE_COLUMNS,
  mapRow: mapIngredientRow,
  validateRow: (data, _rowIndex) => validateIngredientRow(data),
  dedupKey: (data) => `${data.name.toLowerCase().trim()}::${(data.manufacturer || "").toLowerCase().trim()}`,
  commitBatch: async (items) => {
    if (items.length === 0) return 0;

    // Auto-create any category string used in the batch that isn't
    // already in ingredientCategories. Without this, ingredients land
    // with a category string that has no matching row in the categories
    // table — the edit form's dropdown stays empty and category chips
    // on the list page don't show, even though the rows themselves are
    // correctly grouped.
    const usedCategories = Array.from(new Set(
      items
        .map((i) => (i.category ?? "").trim())
        .filter((c) => c.length > 0),
    ));
    if (usedCategories.length > 0) {
      const existing = assertOk(
        await supabase.from("ingredientCategories").select("name"),
      ) as { name: string }[];
      const existingNames = new Set(existing.map((e) => e.name.toLowerCase().trim()));
      const toCreate = usedCategories.filter(
        (c) => !existingNames.has(c.toLowerCase().trim()),
      );
      if (toCreate.length > 0) {
        const now = new Date();
        const rows = toCreate.map((name) => ({
          id: newId(),
          name,
          archived: false,
          createdAt: now,
          updatedAt: now,
        }));
        const { error: catErr } = await supabase
          .from("ingredientCategories")
          .insert(rows);
        if (catErr) throw catErr;
      }
    }

    const withIds = items.map((item) => stripUndefined({ ...item, id: newId() }));
    const { error } = await supabase.from("ingredients").insert(withIds);
    if (error) throw error;
    return items.length;
  },
};

// ---------------------------------------------------------------------------
// Existing keys loader (for dedup)
// ---------------------------------------------------------------------------

export async function getExistingIngredientKeys(): Promise<Set<string>> {
  const all = assertOk(await supabase.from("ingredients").select("name, manufacturer")) as {
    name: string;
    manufacturer: string | null;
  }[];
  return new Set(all.map((i) => `${i.name.toLowerCase().trim()}::${(i.manufacturer || "").toLowerCase().trim()}`));
}
