// Lab adapter for the app's Ingredient model.
// The Ingredient type (src/types) already stores composition as percentages
// (cacaoFat/sugar/milkFat/water/solids/otherFats — must sum to 100). This
// module exposes helpers that turn those into the fractions the lab engine
// expects, and groups ingredients by category for the calculator UI.

import type { Ingredient } from "@/types";

export type Component =
  | "cacaoFat"
  | "milkFat"
  | "otherFat"
  | "sugar"
  | "water"
  | "solids";

export const COMPONENT_LABEL: Record<Component, string> = {
  cacaoFat: "Cacao fat",
  milkFat: "Milk fat",
  otherFat: "Other fat",
  sugar: "Sugar",
  water: "Water",
  solids: "Dry mass",
};

export const COMPONENT_ORDER: Component[] = ["water", "sugar", "cacaoFat", "milkFat", "solids", "otherFat"];

/** Sum of the six % fields. Used to detect ingredients with missing composition. */
export function compositionSum(ing: Ingredient): number {
  return (
    (ing.cacaoFat || 0) +
    (ing.sugar || 0) +
    (ing.milkFat || 0) +
    (ing.water || 0) +
    (ing.solids || 0) +
    (ing.otherFats || 0)
  );
}

/** Fraction (0–1) of each component, ready for weight-based math.
 *  If the ingredient's composition isn't filled, returns all zeros — the
 *  caller should detect missingComposition() and warn the user. */
export function asFractions(ing: Ingredient): Record<Component, number> {
  return {
    cacaoFat: (ing.cacaoFat || 0) / 100,
    milkFat: (ing.milkFat || 0) / 100,
    otherFat: (ing.otherFats || 0) / 100,
    sugar: (ing.sugar || 0) / 100,
    water: (ing.water || 0) / 100,
    solids: (ing.solids || 0) / 100,
  };
}

export function missingComposition(ing: Ingredient): boolean {
  return compositionSum(ing) < 1; // <1% — effectively unset
}

/** Group app ingredients by `category` for grouped <select> dropdowns.
 *  Archived ingredients are filtered upstream by useIngredients(). */
export function groupByCategory(ingredients: Ingredient[]): Array<[string, Ingredient[]]> {
  const order = [
    "Liquids",
    "Sugars",
    "Chocolate",
    "Fats",
    "Nuts / Nut Pastes / Pralines",
    "Alcohol",
    "Flavors & Additives",
    "Infusions",
    "Essential Oils",
    "Extra",
  ];
  const groups: Record<string, Ingredient[]> = {};
  const uncategorised: Ingredient[] = [];

  for (const ing of ingredients) {
    const cat = ing.category;
    if (!cat) {
      uncategorised.push(ing);
      continue;
    }
    groups[cat] ||= [];
    groups[cat].push(ing);
  }

  const result: Array<[string, Ingredient[]]> = [];
  for (const cat of order) {
    if (groups[cat]?.length) {
      result.push([cat, sortByName(groups[cat])]);
      delete groups[cat];
    }
  }
  // any remaining (custom) categories
  for (const [cat, list] of Object.entries(groups)) {
    if (list.length) result.push([cat, sortByName(list)]);
  }
  if (uncategorised.length) result.push(["Uncategorised", sortByName(uncategorised)]);
  return result;
}

function sortByName(list: Ingredient[]): Ingredient[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

/** Filter ingredients to those whose category is in the allowed list.
 *  Used by the recipe-template slot picker. */
export function ingredientsForCategories(ingredients: Ingredient[], allowed: string[]): Ingredient[] {
  return sortByName(ingredients.filter((i) => i.category && allowed.includes(i.category)));
}
