/**
 * Nutrition tracking: per-ingredient data entry (per 100g) and per-product aggregation.
 *
 * Supports four target markets with different mandatory nutrient sets:
 *   EU / UK  — FIC 1169/2011 (identical rules post-Brexit)
 *   US       — FDA Nutrition Facts (21 CFR 101.9, updated 2016)
 *   AU       — FSANZ Standard 1.2.8 (NIP)
 *
 * All values are stored per 100g on the ingredient. Product-level values are
 * computed by weighted aggregation across all fillings and their ingredients.
 */

import type { MarketRegion, Mould, ProductFilling, FillingIngredient, Filling, Ingredient } from "@/types";
import { calculateShellWeightG, calculateFillingWeightPerCavityG, DEFAULT_SHELL_PERCENTAGE } from "@/lib/costCalculation";

// ---------------------------------------------------------------------------
// Nutrition data shape — stored on Ingredient, all values per 100g
// ---------------------------------------------------------------------------

/** All possible nutrient keys. Every market uses a subset. */
export type NutrientKey =
  | "energyKj"
  | "energyKcal"
  | "fat"
  | "saturatedFat"
  | "transFat"
  | "cholesterolMg"
  | "carbohydrate"
  | "sugars"
  | "addedSugars"
  | "fibre"
  | "protein"
  | "sodium"
  | "salt"
  | "vitaminDMcg"
  | "calciumMg"
  | "ironMg"
  | "potassiumMg";

/** Nutrition data stored on an ingredient (all values per 100g) */
export type NutritionData = Partial<Record<NutrientKey, number>>;

// ---------------------------------------------------------------------------
// Nutrient metadata for display
// ---------------------------------------------------------------------------

export interface NutrientDef {
  key: NutrientKey;
  label: string;
  unit: string;
  /** Whether this nutrient is mandatory for the market */
  mandatory: boolean;
  /** Indentation level (0 = top-level, 1 = sub-nutrient) */
  indent: number;
  /** FDA Daily Value for %DV column (US only). undefined = no %DV shown */
  dailyValue?: number;
}

// ---------------------------------------------------------------------------
// Per-market nutrient definitions (display order matches regulatory format)
// ---------------------------------------------------------------------------

/** EU & UK — FIC 1169/2011 Nutrition Declaration */
const EU_UK_NUTRIENTS: NutrientDef[] = [
  { key: "energyKj",      label: "Energy",           unit: "kJ",   mandatory: true,  indent: 0 },
  { key: "energyKcal",    label: "Energy",           unit: "kcal", mandatory: true,  indent: 0 },
  { key: "fat",           label: "Fat",              unit: "g",    mandatory: true,  indent: 0 },
  { key: "saturatedFat",  label: "of which saturates", unit: "g",  mandatory: true,  indent: 1 },
  { key: "carbohydrate",  label: "Carbohydrate",     unit: "g",    mandatory: true,  indent: 0 },
  { key: "sugars",        label: "of which sugars",  unit: "g",    mandatory: true,  indent: 1 },
  { key: "fibre",         label: "Fibre",            unit: "g",    mandatory: false, indent: 0 },
  { key: "protein",       label: "Protein",          unit: "g",    mandatory: true,  indent: 0 },
  { key: "salt",          label: "Salt",             unit: "g",    mandatory: true,  indent: 0 },
];

/** US — FDA Nutrition Facts */
const US_NUTRIENTS: NutrientDef[] = [
  { key: "energyKcal",    label: "Calories",            unit: "kcal", mandatory: true,  indent: 0 },
  { key: "fat",           label: "Total Fat",           unit: "g",    mandatory: true,  indent: 0, dailyValue: 78 },
  { key: "saturatedFat",  label: "Saturated Fat",       unit: "g",    mandatory: true,  indent: 1, dailyValue: 20 },
  { key: "transFat",      label: "Trans Fat",           unit: "g",    mandatory: true,  indent: 1 },
  { key: "cholesterolMg", label: "Cholesterol",         unit: "mg",   mandatory: true,  indent: 0, dailyValue: 300 },
  { key: "sodium",        label: "Sodium",              unit: "mg",   mandatory: true,  indent: 0, dailyValue: 2300 },
  { key: "carbohydrate",  label: "Total Carbohydrate",  unit: "g",    mandatory: true,  indent: 0, dailyValue: 275 },
  { key: "fibre",         label: "Dietary Fiber",       unit: "g",    mandatory: true,  indent: 1, dailyValue: 28 },
  { key: "sugars",        label: "Total Sugars",        unit: "g",    mandatory: true,  indent: 1 },
  { key: "addedSugars",   label: "Incl. Added Sugars",  unit: "g",    mandatory: true,  indent: 2, dailyValue: 50 },
  { key: "protein",       label: "Protein",             unit: "g",    mandatory: true,  indent: 0 },
  { key: "vitaminDMcg",   label: "Vitamin D",           unit: "mcg",  mandatory: true,  indent: 0, dailyValue: 20 },
  { key: "calciumMg",     label: "Calcium",             unit: "mg",   mandatory: true,  indent: 0, dailyValue: 1300 },
  { key: "ironMg",        label: "Iron",                unit: "mg",   mandatory: true,  indent: 0, dailyValue: 18 },
  { key: "potassiumMg",   label: "Potassium",           unit: "mg",   mandatory: true,  indent: 0, dailyValue: 4700 },
];

/** Australia — FSANZ Nutrition Information Panel (NIP) */
const AU_NUTRIENTS: NutrientDef[] = [
  { key: "energyKj",      label: "Energy",           unit: "kJ",   mandatory: true,  indent: 0 },
  { key: "protein",       label: "Protein",          unit: "g",    mandatory: true,  indent: 0 },
  { key: "fat",           label: "Fat, total",       unit: "g",    mandatory: true,  indent: 0 },
  { key: "saturatedFat",  label: "– saturated",      unit: "g",    mandatory: true,  indent: 1 },
  { key: "carbohydrate",  label: "Carbohydrate",     unit: "g",    mandatory: true,  indent: 0 },
  { key: "sugars",        label: "– sugars",         unit: "g",    mandatory: true,  indent: 1 },
  { key: "sodium",        label: "Sodium",           unit: "mg",   mandatory: true,  indent: 0 },
];

/** Return the nutrient list for a market, including all fields (mandatory + optional) */
export function getNutrientsByMarket(market: MarketRegion): NutrientDef[] {
  switch (market) {
    case "US": return US_NUTRIENTS;
    case "AU": return AU_NUTRIENTS;
    case "CA": return US_NUTRIENTS;
    case "EU":
    case "UK":
    default:   return EU_UK_NUTRIENTS;
  }
}

/** Panel title per market */
export function getNutritionPanelTitle(market: MarketRegion): string {
  switch (market) {
    case "US": return "Nutrition Facts";
    case "AU": return "Nutrition Information Panel";
    case "CA": return "Nutrition Facts / Valeur nutritive";
    case "EU":
    case "UK":
    default:   return "Nutrition Declaration";
  }
}

// ---------------------------------------------------------------------------
// All editable nutrient fields (superset across all markets)
// Used for the ingredient edit form — we always collect everything
// ---------------------------------------------------------------------------

export interface EditableNutrientField {
  key: NutrientKey;
  label: string;
  unit: string;
  hint?: string;
  /** Group for visual layout */
  group: "energy" | "fats" | "carbs" | "protein" | "minerals";
}

export const ALL_NUTRIENT_FIELDS: EditableNutrientField[] = [
  // Energy
  { key: "energyKj",      label: "Energy (kJ)",        unit: "kJ",   group: "energy", hint: "Per 100g. If you enter kcal, kJ will be auto-calculated." },
  { key: "energyKcal",    label: "Energy (kcal)",       unit: "kcal", group: "energy", hint: "Per 100g. If you enter kJ, kcal will be auto-calculated." },
  // Fats
  { key: "fat",           label: "Total fat",           unit: "g",    group: "fats" },
  { key: "saturatedFat",  label: "Saturated fat",       unit: "g",    group: "fats" },
  { key: "transFat",      label: "Trans fat",           unit: "g",    group: "fats",   hint: "Mandatory in US" },
  { key: "cholesterolMg", label: "Cholesterol",         unit: "mg",   group: "fats",   hint: "Mandatory in US" },
  // Carbs
  { key: "carbohydrate",  label: "Carbohydrate",        unit: "g",    group: "carbs" },
  { key: "sugars",        label: "Sugars",              unit: "g",    group: "carbs" },
  { key: "addedSugars",   label: "Added sugars",        unit: "g",    group: "carbs",  hint: "Mandatory in US" },
  { key: "fibre",         label: "Fibre",               unit: "g",    group: "carbs" },
  // Protein
  { key: "protein",       label: "Protein",             unit: "g",    group: "protein" },
  // Salt / Sodium
  { key: "salt",          label: "Salt",                unit: "g",    group: "minerals", hint: "EU/UK use salt (= sodium × 2.5)" },
  { key: "sodium",        label: "Sodium",              unit: "mg",   group: "minerals", hint: "US/AU use sodium" },
  // Vitamins & minerals (US mandatory)
  { key: "vitaminDMcg",   label: "Vitamin D",           unit: "mcg",  group: "minerals", hint: "Mandatory in US" },
  { key: "calciumMg",     label: "Calcium",             unit: "mg",   group: "minerals", hint: "Mandatory in US" },
  { key: "ironMg",        label: "Iron",                unit: "mg",   group: "minerals", hint: "Mandatory in US" },
  { key: "potassiumMg",   label: "Potassium",           unit: "mg",   group: "minerals", hint: "Mandatory in US" },
];

// ---------------------------------------------------------------------------
// Energy conversion
// ---------------------------------------------------------------------------

/** 1 kcal = 4.184 kJ (exact thermochemical definition) */
export const KJ_PER_KCAL = 4.184;

/** Convert kcal to kJ */
export function kcalToKj(kcal: number): number {
  return Math.round(kcal * KJ_PER_KCAL);
}

/** Convert kJ to kcal */
export function kjToKcal(kj: number): number {
  return Math.round(kj / KJ_PER_KCAL);
}

// ---------------------------------------------------------------------------
// Salt / Sodium conversion
// ---------------------------------------------------------------------------

/** Salt (g) = Sodium (mg) × 2.5 / 1000. EU/UK labels use salt; US/AU use sodium. */
export function sodiumMgToSaltG(sodiumMg: number): number {
  return (sodiumMg * 2.5) / 1000;
}

export function saltGToSodiumMg(saltG: number): number {
  return (saltG * 1000) / 2.5;
}

// ---------------------------------------------------------------------------
// Auto-fill derived fields
// ---------------------------------------------------------------------------

/**
 * Given partial nutrition data, fill in derived fields that can be calculated:
 * - energyKj from energyKcal (or vice versa) if one is missing
 * - salt from sodium (or vice versa) if one is missing
 *
 * Returns a new object; does not mutate the input.
 */
export function fillDerivedNutrition(data: NutritionData): NutritionData {
  const result = { ...data };

  // Energy cross-fill
  if (result.energyKcal != null && result.energyKj == null) {
    result.energyKj = kcalToKj(result.energyKcal);
  } else if (result.energyKj != null && result.energyKcal == null) {
    result.energyKcal = kjToKcal(result.energyKj);
  }

  // Salt/sodium cross-fill
  if (result.sodium != null && result.salt == null) {
    result.salt = Math.round(sodiumMgToSaltG(result.sodium) * 100) / 100;
  } else if (result.salt != null && result.sodium == null) {
    result.sodium = Math.round(saltGToSodiumMg(result.salt));
  }

  return result;
}

// ---------------------------------------------------------------------------
// Aggregation: ingredient-level → product-level
// ---------------------------------------------------------------------------

/**
 * A single ingredient's contribution to a product, with its weight in grams
 * and its per-100g nutrition data.
 */
export interface IngredientNutritionEntry {
  /** Weight of this ingredient in the product (grams) */
  amountG: number;
  /** Per-100g nutrition data for this ingredient */
  nutrition: NutritionData;
}

/**
 * Aggregate nutrition data across multiple ingredients.
 * Each ingredient contributes proportionally to its weight.
 *
 * Returns per-100g values for the combined mixture, plus the total weight.
 */
export function aggregateNutrition(entries: IngredientNutritionEntry[]): {
  per100g: NutritionData;
  totalWeightG: number;
} {
  const totalWeightG = entries.reduce((sum, e) => sum + e.amountG, 0);
  if (totalWeightG === 0) return { per100g: {}, totalWeightG: 0 };

  const per100g: NutritionData = {};
  const keys: NutrientKey[] = ALL_NUTRIENT_FIELDS.map(f => f.key);

  for (const key of keys) {
    let weightedSum = 0;
    let hasAnyData = false;

    for (const entry of entries) {
      const val = entry.nutrition[key];
      if (val != null) {
        hasAnyData = true;
        // val is per 100g of the ingredient; scale to the actual amount used
        weightedSum += (val / 100) * entry.amountG;
      }
    }

    if (hasAnyData) {
      // Scale back to per 100g of the mixture
      per100g[key] = roundNutrient(key, (weightedSum / totalWeightG) * 100);
    }
  }

  return { per100g: fillDerivedNutrition(per100g), totalWeightG };
}

// ---------------------------------------------------------------------------
// Filling-level nutrition: aggregate a filling's ingredients directly
// ---------------------------------------------------------------------------

export interface FillingNutritionResult {
  /** Nutrition per 100g of the filling mixture */
  per100g: NutritionData;
  /** Total weight of all the filling's ingredients in grams (sum of amounts) */
  totalWeightG: number;
  /** How many of the filling's ingredients have nutrition data */
  ingredientsWithData: number;
  /** Total ingredients on the filling */
  ingredientsTotal: number;
  warnings: string[];
}

/**
 * Calculate nutrition for a single filling from its ingredient list.
 *
 * Ingredients contribute proportionally to their amount in grams. Entries
 * with non-gram units (e.g. counts) are skipped with a warning — filling
 * ingredients almost always sit in g/kg/ml/L and the weighted aggregation
 * requires a consistent mass basis.
 */
export function calculateFillingNutrition(
  fillingIngredients: FillingIngredient[],
  ingredientMap: Map<string, Ingredient>,
): FillingNutritionResult {
  const warnings: string[] = [];
  const entries: IngredientNutritionEntry[] = [];
  let ingredientsTotal = 0;
  let ingredientsWithData = 0;

  for (const li of fillingIngredients) {
    const ing = ingredientMap.get(li.ingredientId);
    if (!ing) continue;
    ingredientsTotal += 1;

    const amountG = toGramsForNutrition(li.amount, li.unit);
    if (amountG == null) {
      warnings.push(`"${ing.name}" uses unit "${li.unit}" — skipped (nutrition needs a mass/volume amount).`);
      continue;
    }

    if (!ing.nutrition || !hasNutritionData(ing.nutrition)) {
      warnings.push(`"${ing.name}" has no nutrition data.`);
      continue;
    }

    ingredientsWithData += 1;
    entries.push({
      amountG,
      nutrition: fillDerivedNutrition(ing.nutrition),
    });
  }

  const { per100g, totalWeightG } = aggregateNutrition(entries);
  return { per100g, totalWeightG, ingredientsWithData, ingredientsTotal, warnings };
}

/** Convert a filling-ingredient amount to grams for nutrition weighting.
 *  Treats ml as g (1:1) — close enough for per-100g nutrition rollup. */
function toGramsForNutrition(amount: number, unit: string): number | null {
  if (unit === "g" || unit === "ml") return amount;
  if (unit === "kg" || unit === "L") return amount * 1000;
  return null;
}

// ---------------------------------------------------------------------------
// Product-level nutrition: shell + cap + fill fillings (mirrors costCalculation)
// ---------------------------------------------------------------------------

export interface ProductNutritionInput {
  mould: Mould | null | undefined;
  productFillings: ProductFilling[];
  fillingIngredientsMap: Map<string, FillingIngredient[]>;
  ingredientMap: Map<string, Ingredient>;
  /** Shell chocolate ingredient (resolved from Product.shellIngredientId). */
  shellIngredient: Ingredient | null | undefined;
  /** Shell as % of total cavity weight (0–100). Default 37.
   *  In grams mode, pass the derived value from `deriveShellPercentageFromGrams`. */
  shellPercentage?: number;
  /** "percentage" (default) or "grams". In grams mode, each ProductFilling's
   *  `fillGrams` is used directly instead of computing weight from fillPercentage. */
  fillMode?: "percentage" | "grams";
}

export interface ProductNutritionResult {
  /** Nutrition per single product (1 cavity) */
  perProduct: NutritionData;
  /** Nutrition per 100g of product */
  per100g: NutritionData;
  /** Total weight of one product in grams */
  productWeightG: number;
  /** How many of the total ingredients have nutrition data */
  ingredientsWithData: number;
  /** Total unique ingredients in the product */
  ingredientsTotal: number;
  warnings: string[];
}

/**
 * Calculate the nutrition for a single product (1 cavity), accounting for:
 * - Shell weight (shell chocolate × shellPercentage%)
 * - Fill fillings, each scaled by fillPercentage; within each filling,
 *   ingredients contribute proportionally to their product amount
 *
 * All ingredient nutrition data is per 100g. We convert to actual grams,
 * then sum across all components.
 */
export function calculateProductNutrition(input: ProductNutritionInput): ProductNutritionResult {
  const {
    mould, productFillings, fillingIngredientsMap, ingredientMap,
    shellIngredient,
    shellPercentage = DEFAULT_SHELL_PERCENTAGE,
    fillMode = "percentage",
  } = input;
  const warnings: string[] = [];

  if (!mould) {
    warnings.push("No default mould set — cannot calculate nutrition.");
    return { perProduct: {}, per100g: {}, productWeightG: 0, ingredientsWithData: 0, ingredientsTotal: 0, warnings };
  }

  // Collect all weighted entries (actual grams per product + per-100g nutrition)
  const entries: IngredientNutritionEntry[] = [];
  const allIngredientIds = new Set<string>();
  const ingredientIdsWithData = new Set<string>();

  // --- Shell (combined shell + cap) ---
  if (shellPercentage > 0) {
    const shellWeightG = calculateShellWeightG(mould, shellPercentage);

    if (shellIngredient?.nutrition && hasNutritionData(shellIngredient.nutrition)) {
      allIngredientIds.add(shellIngredient.id!);
      ingredientIdsWithData.add(shellIngredient.id!);
      entries.push({
        amountG: shellWeightG,
        nutrition: fillDerivedNutrition(shellIngredient.nutrition),
      });
    } else if (shellIngredient) {
      allIngredientIds.add(shellIngredient.id!);
      warnings.push(`Shell chocolate "${shellIngredient.name}" has no nutrition data.`);
    } else {
      warnings.push("No shell chocolate set — shell nutrition excluded.");
    }
  }

  // --- Fill fillings ---
  for (const rl of productFillings) {
    const lis = fillingIngredientsMap.get(rl.fillingId) ?? [];
    const fillingWeightG = fillMode === "grams" && rl.fillGrams != null
      ? rl.fillGrams
      : calculateFillingWeightPerCavityG(mould, rl.fillPercentage, shellPercentage);
    const fillingTotalProductG = lis.reduce((s, li) => s + li.amount, 0);

    for (const li of lis) {
      allIngredientIds.add(li.ingredientId);
      const ing = ingredientMap.get(li.ingredientId);
      if (!ing?.nutrition || !hasNutritionData(ing.nutrition)) continue;

      ingredientIdsWithData.add(li.ingredientId);
      const fraction = fillingTotalProductG > 0 ? li.amount / fillingTotalProductG : 0;
      const ingredientGrams = fillingWeightG * fraction;

      entries.push({
        amountG: ingredientGrams,
        nutrition: fillDerivedNutrition(ing.nutrition),
      });
    }
  }

  const { per100g, totalWeightG } = aggregateNutrition(entries);
  const perProduct = scaleToServing(per100g, totalWeightG);

  return {
    perProduct,
    per100g,
    productWeightG: totalWeightG,
    ingredientsWithData: ingredientIdsWithData.size,
    ingredientsTotal: allIngredientIds.size,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Collection-level nutrition: weighted aggregation across products
// ---------------------------------------------------------------------------

export interface CollectionNutritionResult {
  /** Nutrition per 100g of the collection's combined product weight */
  per100g: NutritionData;
  /** Sum of product weights across every product contributing data */
  totalWeightG: number;
  /** How many products contributed nutrition data */
  productsWithData: number;
  /** Total products in the collection */
  productsTotal: number;
}

/**
 * Aggregate nutrition across a collection's products, weighted by each
 * product's weight. Products with no nutrition data (empty per100g) or
 * zero weight are excluded from the roll-up.
 *
 * Takes the per-product results from `calculateProductNutrition` so the
 * weight math stays in one place — callers compute per-product nutrition
 * once (useful for the UI anyway) and feed the results in.
 */
export function calculateCollectionNutrition(
  perProduct: ProductNutritionResult[],
): CollectionNutritionResult {
  const entries: IngredientNutritionEntry[] = [];
  let productsWithData = 0;

  for (const r of perProduct) {
    if (r.productWeightG <= 0) continue;
    if (Object.keys(r.per100g).length === 0) continue;
    productsWithData += 1;
    entries.push({ amountG: r.productWeightG, nutrition: r.per100g });
  }

  const { per100g, totalWeightG } = aggregateNutrition(entries);
  return {
    per100g,
    totalWeightG,
    productsWithData,
    productsTotal: perProduct.length,
  };
}

/**
 * Scale a per-100g nutrition data object to a given serving size in grams.
 */
export function scaleToServing(per100g: NutritionData, servingG: number): NutritionData {
  const result: NutritionData = {};
  for (const [key, val] of Object.entries(per100g)) {
    if (val != null) {
      result[key as NutrientKey] = roundNutrient(key as NutrientKey, (val / 100) * servingG);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Formatting & rounding
// ---------------------------------------------------------------------------

/** Round a nutrient value to an appropriate number of decimal places */
function roundNutrient(key: NutrientKey, value: number): number {
  // Energy values: round to nearest integer
  if (key === "energyKj" || key === "energyKcal") return Math.round(value);
  // Milligram and microgram values: round to 1 decimal
  if (key.endsWith("Mg") || key.endsWith("Mcg")) return Math.round(value * 10) / 10;
  // Gram values: round to 1 decimal
  return Math.round(value * 10) / 10;
}

/**
 * Format a nutrient value for display.
 * Returns "–" if the value is null/undefined (no data entered).
 */
export function formatNutrientValue(value: number | undefined, unit: string): string {
  if (value == null) return "–";
  // Energy: no decimal
  if (unit === "kJ" || unit === "kcal") return `${Math.round(value)} ${unit}`;
  // Milligrams/micrograms: 1 decimal
  if (unit === "mg" || unit === "mcg") return `${value.toFixed(1)} ${unit}`;
  // Grams: 1 decimal
  return `${value.toFixed(1)} ${unit}`;
}

/**
 * Calculate %DV for a nutrient. Returns undefined if no daily value defined
 * or the value is null.
 */
export function percentDailyValue(value: number | undefined, dailyValue: number | undefined): number | undefined {
  if (value == null || dailyValue == null || dailyValue === 0) return undefined;
  return Math.round((value / dailyValue) * 100);
}

// ---------------------------------------------------------------------------
// Completeness check
// ---------------------------------------------------------------------------

/**
 * Check whether an ingredient has any nutrition data entered.
 */
export function hasNutritionData(nutrition: NutritionData | undefined): boolean {
  if (!nutrition) return false;
  return Object.values(nutrition).some(v => v != null && v > 0);
}

/**
 * Check which mandatory nutrients are missing for a given market.
 * Returns the list of missing NutrientDef entries.
 */
export function getMissingMandatoryNutrients(
  nutrition: NutritionData | undefined,
  market: MarketRegion,
): NutrientDef[] {
  if (!nutrition) return getNutrientsByMarket(market).filter(n => n.mandatory);
  return getNutrientsByMarket(market).filter(
    n => n.mandatory && nutrition[n.key] == null,
  );
}
