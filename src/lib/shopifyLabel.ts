/**
 * Shopify-format label helpers.
 *
 * Produces the two strings Manuela pastes into Shopify product fields:
 *   1. German ingredient declaration with allergens wrapped in <strong>.
 *      Sub-ingredient flattening is handled upstream by buildXIngredientList.
 *   2. Tight nutrition line for Shopify's metafield format, all German.
 */

import type { IngredientListEntry } from "./ingredientList";
import type { NutritionData, NutrientKey } from "./nutrition";

/** HTML form: allergens wrapped in <strong>. Use for paste into Shopify
 *  rich-text fields and for `dangerouslySetInnerHTML` previews. */
export function buildShopifyIngredientHtml(entries: IngredientListEntry[]): string {
  if (entries.length === 0) return "";
  const parts = entries.map((e) =>
    e.allergens.length > 0
      ? `<strong>${escapeHtml(e.label)}</strong>`
      : escapeHtml(e.label),
  );
  return `Zutaten: ${parts.join(", ")}`;
}

/** Plain-text fallback (no bold). */
export function buildShopifyIngredientText(entries: IngredientListEntry[]): string {
  if (entries.length === 0) return "";
  return `Zutaten: ${entries.map((e) => e.label).join(", ")}`;
}

interface ShopifyNutritionField {
  key: NutrientKey;
  label: string;
  decimals: number;
}

/** Field order + German labels matching Manuela's Shopify metafield spec. */
const SHOPIFY_NUTRITION_FIELDS: ShopifyNutritionField[] = [
  { key: "energyKcal",   label: "Energie",          decimals: 2 },
  { key: "fat",          label: "Fett",             decimals: 2 },
  { key: "saturatedFat", label: "davon g. Fetts.",  decimals: 2 },
  { key: "carbohydrate", label: "Kohlenhydrate",    decimals: 2 },
  { key: "sugars",       label: "davon Zucker",     decimals: 2 },
  { key: "fibre",        label: "Ballaststoffe",    decimals: 2 },
  { key: "protein",      label: "Eiweiß",           decimals: 2 },
  { key: "salt",         label: "Salz",             decimals: 2 },
];

/**
 * Tight nutrition line, no separator between key/value pairs, e.g.:
 * `Energie,547.08Fett,35.55davon g. Fetts.,16.83Kohlenhydrate,51.58...`
 *
 * Missing values render as the empty string (e.g. `Salz,`) so the field is
 * still in position; pasting "0.00" would lie about ingredients without data.
 */
export function buildShopifyNutritionLine(per100g: NutritionData): string {
  return SHOPIFY_NUTRITION_FIELDS.map((f) => {
    const v = per100g[f.key];
    const num =
      typeof v === "number" && Number.isFinite(v) ? v.toFixed(f.decimals) : "";
    return `${f.label},${num}`;
  }).join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
