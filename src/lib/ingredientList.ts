/**
 * Ingredient-list text helpers.
 *
 * Produce the ordered text-list of what's inside a filling / product /
 * variant, suitable for customer-facing ingredient labels. Distinct from
 * `nutrition.ts`, which produces numbers.
 *
 * Convention (EU FIC 1169/2011 and equivalents):
 *   - Ingredients listed in descending order of weight.
 *   - Compound ingredients (those with a `subIngredients` breakdown) are
 *     flattened: only the sub-ingredient names appear on the final list,
 *     not the parent's commercial name. Rationale: legal labels declare
 *     what's actually in the product, not the SKU you bought.
 *   - Ingredients without a breakdown appear under their own name.
 *   - Duplicate names are merged — if "sugar" appears in two compound
 *     ingredients, it appears once with the combined weight.
 *   - Allergens emphasised (bolded) where any contributing parent carries
 *     the allergen. The UI decides the emphasis style.
 */

import type { FillingIngredient, Ingredient, Mould, ProductFilling } from "@/types";
import {
  calculateShellWeightG,
  calculateFillingWeightPerCavityG,
  DEFAULT_SHELL_PERCENTAGE,
} from "@/lib/costCalculation";

/** One item on a rolled-up ingredient list. */
export interface IngredientListEntry {
  /** Display label: a sub-ingredient name, or — for ingredients without
   *  a breakdown — the ingredient's own name. */
  label: string;
  /** Total grams contributed by parent ingredients mapping to this label.
   *  When a parent flattens into multiple subs, each sub inherits the
   *  parent's full weight (there's no per-sub percentage in the model). */
  grams: number;
  /** Allergen IDs unioned across every parent ingredient that contributes
   *  to this label. The UI bolds the label when this is non-empty. */
  allergens: string[];
}

/**
 * Roll up a filling's ingredient list, sorted by grams descending.
 *
 * Each filling ingredient is flattened into its sub-ingredient names
 * (or its own name if it has no breakdown). Duplicate names merge across
 * rows — the customer-facing label shows each declared ingredient once.
 */
export function buildFillingIngredientList(
  fillingIngredients: FillingIngredient[],
  ingredientMap: Map<string, Ingredient>,
): IngredientListEntry[] {
  const contributions: Contribution[] = [];
  for (const li of fillingIngredients) {
    if (!li.ingredientId) continue; // sub-filling line — not expanded here
    const ing = ingredientMap.get(li.ingredientId);
    if (!ing) continue;
    contributions.push({ ing, grams: li.amount });
  }
  return flattenAndDedup(contributions);
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
 * Each parent ingredient is flattened into its sub-ingredient names (or
 * its own name), and duplicate names merge so the same ingredient shows
 * once with the combined weight. Returns [] when no mould is set, since
 * all weight math keys off the mould cavity.
 */
export function buildProductIngredientList(input: ProductIngredientListInput): IngredientListEntry[] {
  const contributions: Contribution[] = [];
  accumulateProduct(contributions, input);
  return flattenAndDedup(contributions);
}

/**
 * Roll up a variant's ingredient list across every product in the
 * variant. Each product contributes its own shell + filling weights;
 * sub-ingredients are flattened and duplicates merge across every product.
 */
export function buildVariantIngredientList(
  perProduct: ProductIngredientListInput[],
): IngredientListEntry[] {
  const contributions: Contribution[] = [];
  for (const input of perProduct) accumulateProduct(contributions, input);
  return flattenAndDedup(contributions);
}

// ─── Internals ──────────────────────────────────────────────────────────────

/** One parent ingredient's contribution to the rolled-up list. */
type Contribution = { ing: Ingredient; grams: number };

/** Compute shell + filling ingredient contributions from one product. */
function accumulateProduct(out: Contribution[], input: ProductIngredientListInput): void {
  const {
    mould, productFillings, fillingIngredientsMap, ingredientMap,
    shellIngredient,
    shellPercentage = DEFAULT_SHELL_PERCENTAGE,
    fillMode = "percentage",
  } = input;

  if (!mould) return;

  if (shellIngredient && shellPercentage > 0) {
    out.push({ ing: shellIngredient, grams: calculateShellWeightG(mould, shellPercentage) });
  }

  for (const rl of productFillings) {
    const lis = fillingIngredientsMap.get(rl.fillingId) ?? [];
    const fillingWeightG = fillMode === "grams" && rl.fillGrams != null
      ? rl.fillGrams
      : calculateFillingWeightPerCavityG(mould, rl.fillPercentage, shellPercentage);
    const fillingTotalProductG = lis.reduce((s, li) => s + li.amount, 0);
    if (fillingTotalProductG <= 0) continue;

    for (const li of lis) {
      if (!li.ingredientId) continue; // sub-filling line — not expanded here
      const ing = ingredientMap.get(li.ingredientId);
      if (!ing) continue;
      const fraction = li.amount / fillingTotalProductG;
      out.push({ ing, grams: fillingWeightG * fraction });
    }
  }
}

/**
 * Flatten sub-ingredients, dedup by case-insensitive name, union allergens,
 * sum grams. Each parent ingredient either expands into its sub-ingredient
 * names (when the breakdown is present) or stays under its own name.
 *
 * When a parent flattens into N subs, each sub inherits the parent's full
 * weight — there are no per-sub percentages in the data model. If two
 * parents declare the same sub, their weights add.
 */
function flattenAndDedup(contributions: Contribution[]): IngredientListEntry[] {
  const byKey = new Map<string, { label: string; grams: number; allergens: Set<string> }>();

  for (const { ing, grams } of contributions) {
    if (grams <= 0) continue;

    const names = deriveDisplayNames(ing);
    const parentAllergens = ing.allergens ?? [];

    for (const name of names) {
      const key = name.toLowerCase();
      const cur = byKey.get(key);
      if (cur) {
        cur.grams += grams;
        for (const a of parentAllergens) cur.allergens.add(a);
      } else {
        byKey.set(key, {
          label: name,
          grams,
          allergens: new Set(parentAllergens),
        });
      }
    }
  }

  return [...byKey.values()]
    .map((v) => ({ label: v.label, grams: v.grams, allergens: [...v.allergens] }))
    .sort((a, b) => b.grams - a.grams);
}

/** Return the list of names this ingredient should appear under on the
 *  rolled-up list — its sub-ingredient names if a breakdown exists, or
 *  otherwise its own name. Empty/whitespace entries are dropped. */
function deriveDisplayNames(ing: Ingredient): string[] {
  const subs = (ing.subIngredients ?? [])
    .map((s) => s.name?.trim() ?? "")
    .filter((n) => n.length > 0);
  if (subs.length > 0) return subs;
  const parent = ing.name?.trim() ?? "";
  return parent.length > 0 ? [parent] : [];
}
