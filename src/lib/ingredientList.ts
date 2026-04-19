/**
 * Ingredient-list text helpers.
 *
 * Produce the ordered text-list of what's inside a filling / product /
 * collection, suitable for customer-facing ingredient labels. Distinct from
 * `nutrition.ts`, which produces numbers.
 *
 * Convention (EU FIC 1169/2011 and equivalents):
 *   - Ingredients listed in descending order of weight.
 *   - Compound ingredients may declare their sub-ingredients in parentheses.
 *   - Allergens emphasised (bolded) where present. We carry allergen IDs on
 *     each entry; the UI decides the emphasis style.
 */

import type { FillingIngredient, Ingredient, Mould, ProductFilling } from "@/types";
import {
  calculateShellWeightG,
  calculateFillingWeightPerCavityG,
  DEFAULT_SHELL_PERCENTAGE,
} from "@/lib/costCalculation";

/** One item on a rolled-up ingredient list. */
export interface IngredientListEntry {
  /** Display label. For compound ingredients whose parent has sub-ingredients,
   *  this is "Parent name (sub1, sub2, sub3)" in the order the user saved. */
  label: string;
  /** Total grams contributed by this ingredient (pre-sort key). */
  grams: number;
  /** Allergen IDs from the parent ingredient. The UI bolds the label when
   *  this array is non-empty. Allergens aren't tagged at the sub-ingredient
   *  level (per product rule, 2026-04-19). */
  allergens: string[];
}

/** Format one filling ingredient's parent as a label, folding in any
 *  sub-ingredients as "(sub1, sub2, …)". */
function labelFor(ing: Ingredient): string {
  const subs = ing.subIngredients ?? [];
  if (subs.length === 0) return ing.name;
  const subNames = subs.map((s) => s.name).filter((n) => n && n.trim().length > 0);
  if (subNames.length === 0) return ing.name;
  return `${ing.name} (${subNames.join(", ")})`;
}

/**
 * Roll up a filling's ingredient list, sorted by grams descending.
 *
 * No merging across rows: if the same ingredient is listed twice on a
 * filling (rare but allowed), each occurrence appears separately. The
 * caller can merge upstream if it matters.
 */
export function buildFillingIngredientList(
  fillingIngredients: FillingIngredient[],
  ingredientMap: Map<string, Ingredient>,
): IngredientListEntry[] {
  const entries: IngredientListEntry[] = [];
  for (const li of fillingIngredients) {
    const ing = ingredientMap.get(li.ingredientId);
    if (!ing) continue;
    entries.push({
      label: labelFor(ing),
      grams: li.amount,
      allergens: ing.allergens ?? [],
    });
  }
  return entries.sort((a, b) => b.grams - a.grams);
}

/** Input for `buildProductIngredientList`. Mirrors the weight-math inputs
 *  on `calculateProductNutrition` so the two helpers agree on grams. */
export interface ProductIngredientListInput {
  mould: Mould | null | undefined;
  productFillings: ProductFilling[];
  fillingIngredientsMap: Map<string, FillingIngredient[]>;
  ingredientMap: Map<string, Ingredient>;
  /** Shell chocolate ingredient (resolved from Product.shellIngredientId). */
  shellIngredient: Ingredient | null | undefined;
  /** Shell as % of total cavity weight (0–100). Default 37. */
  shellPercentage?: number;
  /** "percentage" (default) or "grams". */
  fillMode?: "percentage" | "grams";
}

/**
 * Roll up a product's ingredient list across shell + all fillings.
 *
 * Merges duplicates across fillings by ingredient id (customer-facing
 * labels merge — "Butter" from two fillings should appear once with
 * combined weight), and sorts descending by grams.
 *
 * Returns [] when no mould is set, since all weight math keys off the
 * mould cavity. Filling weights use the same logic as
 * `calculateProductNutrition`.
 */
export function buildProductIngredientList(input: ProductIngredientListInput): IngredientListEntry[] {
  const {
    mould, productFillings, fillingIngredientsMap, ingredientMap,
    shellIngredient,
    shellPercentage = DEFAULT_SHELL_PERCENTAGE,
    fillMode = "percentage",
  } = input;

  if (!mould) return [];

  // Merge by ingredient id across shell + all fillings
  const byId = new Map<string, { ing: Ingredient; grams: number }>();

  const bump = (ing: Ingredient, grams: number) => {
    if (!ing.id || grams <= 0) return;
    const cur = byId.get(ing.id);
    if (cur) cur.grams += grams;
    else byId.set(ing.id, { ing, grams });
  };

  // Shell (shell + cap, combined)
  if (shellIngredient && shellPercentage > 0) {
    bump(shellIngredient, calculateShellWeightG(mould, shellPercentage));
  }

  // Fillings — same weight model as `calculateProductNutrition`
  for (const rl of productFillings) {
    const lis = fillingIngredientsMap.get(rl.fillingId) ?? [];
    const fillingWeightG = fillMode === "grams" && rl.fillGrams != null
      ? rl.fillGrams
      : calculateFillingWeightPerCavityG(mould, rl.fillPercentage, shellPercentage);
    const fillingTotalProductG = lis.reduce((s, li) => s + li.amount, 0);
    if (fillingTotalProductG <= 0) continue;

    for (const li of lis) {
      const ing = ingredientMap.get(li.ingredientId);
      if (!ing) continue;
      const fraction = li.amount / fillingTotalProductG;
      bump(ing, fillingWeightG * fraction);
    }
  }

  const entries: IngredientListEntry[] = [];
  for (const { ing, grams } of byId.values()) {
    entries.push({
      label: labelFor(ing),
      grams,
      allergens: ing.allergens ?? [],
    });
  }
  return entries.sort((a, b) => b.grams - a.grams);
}
