"use client";

import { useMemo, useState } from "react";
import {
  useProductsList,
  useVariants,
  useIngredients,
  useFillings,
  useMouldsList,
  useAllVariantProducts,
  useProductFillingsForProducts,
  useFillingIngredientsForFillings,
} from "@/lib/hooks";
import {
  calculateProductNutrition,
  calculateVariantNutrition,
  type NutritionData,
} from "@/lib/nutrition";
import {
  buildProductIngredientList,
  buildVariantIngredientList,
  type ProductIngredientListInput,
} from "@/lib/ingredientList";
import { deriveShellPercentageFromGrams } from "@/lib/costCalculation";
import { DENSITY_G_PER_ML } from "@/lib/production";
import { DsButton, PageHeader } from "@/components/dulceria";

// ─── Handle → production-name mapping ────────────────────────────────

const PRALINES: ReadonlyArray<readonly [string, string]> = [
  ["apple-walnut", "Apple Walnut"],
  ["double-caramel", "Double Caramel"],
  ["double-cherry", "Double Cherry"],
  ["espresso-shot", "Espresso Shot"],
  ["ginger-gin", "Ginger Gin"],
  ["hazelnut-crunch", "Hazelnut Crunch"],
  ["lime-passionfruit", "Lime Passionfruit"],
  ["mango-chilli", "Mango Chilli"],
  ["nougat-crunch", "Nougat Crunch"],
  ["peanut-crunch", "Peanut Crunch"],
  ["peanutbutter-jelly", "Peanutbutter Jelly"],
  ["pistachio-white-chocolate", "Pistachio White Chocolate"],
  ["strawberry-cheesecake", "Strawberry Cheesecake"],
  ["strawberry-nougat", "Strawberry Nougat"],
  ["tiramisu", "Tiramisu"],
  ["white-chocolate-pumpkin", "White Chocolate Pumpkin"],
];

const BARS: ReadonlyArray<readonly [string, string]> = [
  ["lemon-strawberry-bar", "Lemon Strawberry Bar"],
  ["mozart-style-holographic", "Mozart Style Holographic"],
  ["nougat-crunch-bar", "Nougat Crunch Bar"],
  ["peanut-crunch-2026", "Peanut Crunch Bar"],
  ["pistachio-crunch-white-chocolate", "Pistachio Crunch White Chocolate"],
  ["pistachio-crunch", "Pistachio Crunch Bar"],
  ["pistachio-raspberry-crunch", "Pistachio Raspberry Crunch"],
  ["strawberry-lemon-bar", "Strawberry Lemon Bar"],
  ["strawberry-nougat-holographic", "Strawberry Nougat Holographic"],
];

const TOASTYS: ReadonlyArray<readonly [string, string]> = [
  ["dark-chocolate-mousse-toasty", "Dark Chocolate Mousse Toasty"],
  ["pistachio-raspberry-toasty", "Pistachio Raspberry Toasty"],
  ["strawberry-nougat-toasty-bar", "Strawberry Nougat Toasty"],
  ["salted-caramel-toasty", "White Chocolate Salted Caramel Toasty"],
];

const BOXES: ReadonlyArray<readonly [string, string]> = [
  ["bestseller", "Bestseller"],
  ["try-it-all-box", "Try it All"],
  ["fruit-lover", "Fruit Lover"],
  ["nut-lover", "Nut Lover"],
  ["mothersday-edition", "Mothersday Edition"],
];

// Allergen ID → German label. EU + legacy + US-only IDs covered.
const ALLERGEN_DE: Record<string, string> = {
  gluten: "Gluten",
  crustaceans: "Krebstiere",
  eggs: "Eier",
  fish: "Fisch",
  peanuts: "Erdnüsse",
  soybeans: "Soja",
  milk: "Milch",
  nuts_almonds: "Mandeln",
  nuts_hazelnuts: "Haselnüsse",
  nuts_walnuts: "Walnüsse",
  nuts_cashews: "Cashewnüsse",
  nuts_pecans: "Pekannüsse",
  nuts_brazil: "Paranüsse",
  nuts_pistachios: "Pistazien",
  nuts_macadamia: "Macadamianüsse",
  nuts_pine: "Pinienkerne",
  celery: "Sellerie",
  mustard: "Senf",
  sesame: "Sesam",
  sulphites: "Sulfite",
  lupin: "Lupinen",
  molluscs: "Weichtiere",
  alcohol: "Alkohol",
  lactose: "Laktose",
  nuts: "Nüsse",
  shellfish: "Schalentiere",
  wheat: "Weizen",
};

const CSV_HEADER = [
  "handle",
  "ingredients_DE",
  "allergens_DE",
  "nutrition_per_100g",
  "family",
  "flavor_notes_DE",
  "contains_praline_handles",
  "launch_date",
  "limited_until",
];

// ─── Helpers ─────────────────────────────────────────────────────────

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function csvRow(cells: string[]): string {
  return cells.map(csvEscape).join(",");
}

function formatNutritionLine(per100g: NutritionData): string {
  const fmt = (k: keyof NutritionData, unit: string): string => {
    const v = per100g[k];
    if (typeof v !== "number" || !Number.isFinite(v)) return "";
    // Match values to label expectations: kcal as integer, grams 1 decimal.
    const rounded = unit === "kcal" ? Math.round(v) : Math.round(v * 10) / 10;
    return `${rounded} ${unit}`;
  };
  return [
    `Brennwert: ${fmt("energyKcal", "kcal")}`,
    `Fett: ${fmt("fat", "g")}`,
    `Kohlenhydrate: ${fmt("carbohydrate", "g")}`,
    `Zucker: ${fmt("sugars", "g")}`,
    `Eiweiß: ${fmt("protein", "g")}`,
    `Salz: ${fmt("salt", "g")}`,
  ].join(" | ");
}

function formatIngredientsLine(entries: { label: string }[]): string {
  return entries.map((e) => e.label).join(", ");
}

function formatAllergensDe(ids: Iterable<string>): string {
  const labels = new Set<string>();
  for (const id of ids) {
    const de = ALLERGEN_DE[id];
    if (de) labels.add(de);
  }
  return Array.from(labels).sort((a, b) => a.localeCompare(b, "de")).join(", ");
}

// ─── Component ───────────────────────────────────────────────────────

export default function ShopifyExportPage() {
  const allProducts = useProductsList(true);
  const allVariants = useVariants();
  const allIngredients = useIngredients(true);
  const allFillings = useFillings(true);
  const allMoulds = useMouldsList(true);
  const allVariantProducts = useAllVariantProducts();

  // Product IDs we'll need filling data for: every praline/bar/toasty product
  // matched by name, plus every product contained in any box variant.
  const productMatchMap = useMemo(() => {
    const byName = new Map<string, string>();
    for (const p of allProducts) {
      if (p.name) byName.set(p.name.toLowerCase(), p.id!);
    }
    return byName;
  }, [allProducts]);

  const variantMatchMap = useMemo(() => {
    const byName = new Map<string, string>();
    for (const v of allVariants) {
      if (v.name) byName.set(v.name.toLowerCase(), v.id!);
    }
    return byName;
  }, [allVariants]);

  // Reverse: production-name → shopify-handle (for praline handles inside boxes)
  const productNameToHandle = useMemo(() => {
    const m = new Map<string, string>();
    for (const [handle, name] of PRALINES) m.set(name.toLowerCase(), handle);
    return m;
  }, []);

  const directProductIds = useMemo(() => {
    const ids: string[] = [];
    for (const list of [PRALINES, BARS, TOASTYS]) {
      for (const [, name] of list) {
        const id = productMatchMap.get(name.toLowerCase());
        if (id) ids.push(id);
      }
    }
    return ids;
  }, [productMatchMap]);

  const boxVariantIds = useMemo(() => {
    return BOXES
      .map(([, name]) => variantMatchMap.get(name.toLowerCase()))
      .filter((v): v is string => !!v);
  }, [variantMatchMap]);

  const boxProductIds = useMemo(() => {
    const set = new Set<string>();
    for (const vp of allVariantProducts) {
      if (boxVariantIds.includes(vp.variantId)) set.add(vp.productId);
    }
    return Array.from(set);
  }, [allVariantProducts, boxVariantIds]);

  const allRelevantProductIds = useMemo(
    () => Array.from(new Set([...directProductIds, ...boxProductIds])),
    [directProductIds, boxProductIds],
  );

  const productFillingsMap = useProductFillingsForProducts(allRelevantProductIds);

  const fillingIds = useMemo(() => {
    const set = new Set<string>();
    for (const pid of allRelevantProductIds) {
      for (const pf of productFillingsMap.get(pid) ?? []) set.add(pf.fillingId);
    }
    return Array.from(set);
  }, [allRelevantProductIds, productFillingsMap]);

  const fillingIngredientsMap = useFillingIngredientsForFillings(fillingIds);

  // Look-up maps
  const productMap = useMemo(
    () => new Map(allProducts.map((p) => [p.id!, p])),
    [allProducts],
  );
  const ingredientMap = useMemo(
    () => new Map(allIngredients.map((i) => [i.id!, i])),
    [allIngredients],
  );
  const fillingMap = useMemo(
    () => new Map(allFillings.map((f) => [f.id!, f])),
    [allFillings],
  );
  const mouldMap = useMemo(
    () => new Map(allMoulds.map((m) => [m.id!, m])),
    [allMoulds],
  );

  /** Build the helper input for one product, or null if mould is missing. */
  function inputForProduct(productId: string): ProductIngredientListInput | null {
    const product = productMap.get(productId);
    if (!product) return null;
    const mould = product.defaultMouldId ? mouldMap.get(product.defaultMouldId) : null;
    if (!mould) return null;
    const productFillings = productFillingsMap.get(productId) ?? [];
    const shellIngredient = product.shellIngredientId
      ? ingredientMap.get(product.shellIngredientId) ?? null
      : null;

    let shellPercentage = product.shellPercentage ?? 37;
    if (product.fillMode === "grams") {
      const totalFillGrams = productFillings.reduce((s, pf) => s + (pf.fillGrams ?? 0), 0);
      shellPercentage = deriveShellPercentageFromGrams(
        mould.cavityWeightG,
        totalFillGrams,
        DENSITY_G_PER_ML,
      );
    }

    return {
      mould,
      productFillings,
      fillingIngredientsMap,
      ingredientMap,
      shellIngredient,
      shellPercentage,
      fillMode: product.fillMode,
    };
  }

  /** Allergen IDs contributed by shell ingredient + each filling's allergens. */
  function allergenIdsForProduct(productId: string): string[] {
    const product = productMap.get(productId);
    if (!product) return [];
    const ids = new Set<string>();
    if (product.shellIngredientId) {
      const shell = ingredientMap.get(product.shellIngredientId);
      if (shell?.allergens) for (const a of shell.allergens) ids.add(a);
    }
    for (const pf of productFillingsMap.get(productId) ?? []) {
      const f = fillingMap.get(pf.fillingId);
      if (f?.allergens) for (const a of f.allergens) ids.add(a);
    }
    return Array.from(ids);
  }

  const { rows, missing } = useMemo(() => {
    const rows: string[] = [CSV_HEADER.join(",")];
    const missing: { handle: string; expectedName: string; kind: string }[] = [];

    // Pralines, bars, toastys — same shape: product-backed.
    const productSections: Array<{
      kind: string;
      list: ReadonlyArray<readonly [string, string]>;
    }> = [
      { kind: "praline", list: PRALINES },
      { kind: "bar", list: BARS },
      { kind: "toasty", list: TOASTYS },
    ];

    for (const section of productSections) {
      for (const [handle, name] of section.list) {
        const productId = productMatchMap.get(name.toLowerCase());
        if (!productId) {
          missing.push({ handle, expectedName: name, kind: section.kind });
          rows.push(csvRow([handle, "", "", "", "", "", "", "", ""]));
          continue;
        }
        const input = inputForProduct(productId);
        const ingredientList = input ? buildProductIngredientList(input) : [];
        const nutrition = input
          ? calculateProductNutrition(input)
          : { per100g: {} as NutritionData };
        const ingredientsDe = formatIngredientsLine(ingredientList);
        const allergensDe = formatAllergensDe(allergenIdsForProduct(productId));
        const nutritionLine = ingredientList.length > 0
          ? formatNutritionLine(nutrition.per100g)
          : "";
        rows.push(csvRow([
          handle,
          ingredientsDe,
          allergensDe,
          nutritionLine,
          "", // family
          "", // flavor_notes_DE
          "", // contains_praline_handles
          "", // launch_date
          "", // limited_until
        ]));
      }
    }

    // Boxes — variant-backed roll-up across contained products.
    for (const [handle, name] of BOXES) {
      const variantId = variantMatchMap.get(name.toLowerCase());
      if (!variantId) {
        missing.push({ handle, expectedName: name, kind: "box" });
        rows.push(csvRow([handle, "", "", "", "", "", "", "", ""]));
        continue;
      }

      const containedProductIds = allVariantProducts
        .filter((vp) => vp.variantId === variantId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((vp) => vp.productId);

      const inputs = containedProductIds
        .map((pid) => inputForProduct(pid))
        .filter((i): i is ProductIngredientListInput => i !== null);

      const ingredientList = inputs.length > 0
        ? buildVariantIngredientList(inputs)
        : [];

      const perProductNutrition = inputs.map((i) => calculateProductNutrition(i));
      const variantNutrition = inputs.length > 0
        ? calculateVariantNutrition(perProductNutrition)
        : { per100g: {} as NutritionData };

      // Allergen union across contained products
      const allergenIds = new Set<string>();
      for (const pid of containedProductIds) {
        for (const id of allergenIdsForProduct(pid)) allergenIds.add(id);
      }

      // Praline handles inside this box
      const containedHandles: string[] = [];
      for (const pid of containedProductIds) {
        const p = productMap.get(pid);
        if (!p?.name) continue;
        const h = productNameToHandle.get(p.name.toLowerCase());
        if (h) containedHandles.push(h);
      }

      rows.push(csvRow([
        handle,
        formatIngredientsLine(ingredientList),
        formatAllergensDe(allergenIds),
        ingredientList.length > 0 ? formatNutritionLine(variantNutrition.per100g) : "",
        "", // family — empty for boxes
        "", // flavor_notes_DE
        containedHandles.join(", "),
        "", // launch_date
        "", // limited_until
      ]));
    }

    return { rows, missing };
  }, [
    productMatchMap,
    variantMatchMap,
    productMap,
    ingredientMap,
    fillingMap,
    mouldMap,
    productFillingsMap,
    fillingIngredientsMap,
    allVariantProducts,
    productNameToHandle,
  ]);

  const csv = useMemo(() => rows.join("\n"), [rows]);

  const [copied, setCopied] = useState(false);

  function downloadCsv(): void {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shopify-metadata-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function copyCsv(): Promise<void> {
    await navigator.clipboard.writeText(csv);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const totalRows = rows.length - 1; // minus header

  return (
    <div className="px-4 py-4 max-w-4xl mx-auto">
      <PageHeader title="Shopify metadata export" meta="CSV for praline/bar/toasty/box metadata migration" />

      <div className="rounded-[6px] border border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4 mb-4">
        <div className="text-sm mb-2">
          {totalRows} rows ready · {missing.length} unmatched
        </div>
        <div className="flex gap-2">
          <DsButton onClick={downloadCsv} variant="primary">
            Download CSV
          </DsButton>
          <DsButton onClick={copyCsv} variant="default">
            {copied ? "Copied" : "Copy to clipboard"}
          </DsButton>
        </div>
      </div>

      {missing.length > 0 && (
        <div className="rounded-[6px] border border-[color:var(--ds-semantic-warn)] bg-[color:var(--ds-card-bg)] p-4 mb-4">
          <div className="text-sm font-semibold mb-2">Unmatched names — emitted with empty fields</div>
          <ul className="text-xs space-y-1">
            {missing.map((m) => (
              <li key={m.handle}>
                <span className="font-mono">{m.handle}</span> ({m.kind}) — expected production name: <code>{m.expectedName}</code>
              </li>
            ))}
          </ul>
          <div className="mt-2 text-xs text-muted-foreground">
            Fix: either rename the row in the production DB to match, or tell Claude the actual stored name to update the mapping.
          </div>
        </div>
      )}

      <div className="rounded-[6px] border border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-3">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Preview
        </div>
        <pre className="text-[11px] leading-relaxed font-mono whitespace-pre overflow-auto max-h-[500px]">
{csv}
        </pre>
      </div>
    </div>
  );
}
