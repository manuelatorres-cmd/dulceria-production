import type { Product, ProductFilling, Filling } from "@/types";

export interface EffectiveShelfLife {
  /** Resolved shelf life in weeks. Null if no source provides one. */
  weeks: number | null;
  /** "filling" → derived from the soonest-expiring filling.
   *  "manual"  → product.shelfLifeWeeks override.
   *  "none"    → neither source provided a value. */
  source: "filling" | "manual" | "none";
  /** When `source === "filling"`, the filling row that drove the value. */
  bottleneckFilling?: { id: string; name: string; weeks: number };
}

/**
 * Derive a product's effective shelf life from its assigned fillings.
 *
 * Rule: the product is only as fresh as its fastest-expiring filling.
 * We pick the minimum non-null `shelfLifeWeeks` across all fillings
 * linked to the product via `productFillings`. When none of the
 * fillings carry a shelf-life value (or the product has no fillings),
 * we fall back to the manual `product.shelfLifeWeeks` override so
 * legacy products without filling data keep working.
 *
 * Manuela measures water activity on every filling and tags a shelf
 * life there — surfacing it here makes the product number trustworthy
 * without manual upkeep.
 */
export function getEffectiveProductShelfLife(
  product: Pick<Product, "shelfLifeWeeks">,
  productFillings: ProductFilling[],
  fillings: Filling[],
): EffectiveShelfLife {
  const fillingById = new Map(fillings.map((f) => [f.id!, f]));
  let bottleneck: { id: string; name: string; weeks: number } | null = null;
  for (const pf of productFillings) {
    const filling = fillingById.get(pf.fillingId);
    if (!filling) continue;
    const w = filling.shelfLifeWeeks;
    if (w == null || w <= 0) continue;
    if (!bottleneck || w < bottleneck.weeks) {
      bottleneck = { id: filling.id!, name: filling.name, weeks: w };
    }
  }
  if (bottleneck) {
    return { weeks: bottleneck.weeks, source: "filling", bottleneckFilling: bottleneck };
  }
  const manual = parseFloat(String(product.shelfLifeWeeks ?? ""));
  if (Number.isFinite(manual) && manual > 0) {
    return { weeks: manual, source: "manual" };
  }
  return { weeks: null, source: "none" };
}
