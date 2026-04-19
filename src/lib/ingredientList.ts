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

import type { FillingIngredient, Ingredient } from "@/types";

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
