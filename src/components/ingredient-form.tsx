"use client";

import { useState, useEffect, useMemo } from "react";
import type { Ingredient, CompositionKey, SubIngredient } from "@/types";
import { getAllergensByRegion, COMPOSITION_FIELDS, migrateAllergens } from "@/types";
import { saveIngredient, useMarketRegion, useCurrencySymbol, useIngredientCategoryNames } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { ALL_NUTRIENT_FIELDS, getNutrientsByMarket, fillDerivedNutrition, type NutrientKey, type NutritionData } from "@/lib/nutrition";

const PURCHASE_UNITS = ["g", "kg", "ml", "L", "pcs"] as const;

// Grams per purchase unit for units where it's unambiguous
function autoGramsPerUnit(purchaseUnit: string): number | null {
  if (purchaseUnit === "kg") return 1000;
  return null;
}

interface IngredientFormProps {
  ingredient?: Ingredient;
  manufacturers?: string[];
  brands?: string[];
  vendors?: string[];
  sources?: string[];
  onSaved: () => void;
  onCancel: () => void;
  onDirtyChange?: (isDirty: boolean) => void;
  activeSection?: "details" | "composition" | "ingredients" | "allergens" | "pricing" | "nutrition" | "shell";
}

const emptyComp: Record<CompositionKey, string> = {
  cacaoFat: "",
  sugar: "",
  milkFat: "",
  water: "",
  solids: "",
  otherFats: "",
  alcohol: "",
};

export function IngredientForm({ ingredient, manufacturers = [], brands = [], vendors = [], sources = [], onSaved, onCancel, onDirtyChange, activeSection }: IngredientFormProps) {
  const sec = activeSection ?? "details";
  const sym = useCurrencySymbol();
  const ingredientCategoryNames = useIngredientCategoryNames();
  const [name, setName] = useState("");
  const [commercialName, setCommercialName] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [brand, setBrand] = useState("");
  const [vendor, setVendor] = useState("");
  const [source, setSource] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [comp, setComp] = useState<Record<CompositionKey, string>>({ ...emptyComp });
  const [allergens, setAllergens] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const region = useMarketRegion();
  const activeAllergens = getAllergensByRegion(region);
  const [pricingIrrelevant, setPricingIrrelevant] = useState(false);
  const [shellCapable, setShellCapable] = useState(false);
  const [subIngredients, setSubIngredients] = useState<SubIngredient[]>([]);

  // Purchase pricing
  const [purchaseCost, setPurchaseCost] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [purchaseQty, setPurchaseQty] = useState("1");
  const [purchaseUnit, setPurchaseUnit] = useState("g");
  // Default "1000" only for new ingredients; existing values are loaded via useEffect below
  const [gramsPerUnit, setGramsPerUnit] = useState(() => (ingredient?.gramsPerUnit != null ? String(ingredient.gramsPerUnit) : "1000"));
  // Track whether the user has manually edited gramsPerUnit — if so, don't auto-fill on unit change
  const [gramsPerUnitTouched, setGramsPerUnitTouched] = useState(() => ingredient?.gramsPerUnit != null);
  // Purchase-log extras (Phase 8)
  const [defaultVatRate, setDefaultVatRate] = useState("");
  const [purchaseSupplier, setPurchaseSupplier] = useState("");
  const [purchaseVatRate, setPurchaseVatRate] = useState("");
  const [purchaseInvoice, setPurchaseInvoice] = useState("");
  const [updateDefault, setUpdateDefault] = useState(true);

  // Nutrition — local string state per field for editing
  const [nutritionStr, setNutritionStr] = useState<Record<string, string>>({});

  useEffect(() => {
    if (ingredient) {
      onDirtyChange?.(false);
      setName(ingredient.name);
      setCommercialName(ingredient.commercialName ?? "");
      setManufacturer(ingredient.manufacturer);
      setBrand(ingredient.brand ?? "");
      setVendor(ingredient.vendor ?? "");
      setSource(ingredient.source);
      setNotes(ingredient.notes);
      setCategory(ingredient.category ?? "");
      setComp({
        cacaoFat: String(ingredient.cacaoFat),
        sugar: String(ingredient.sugar),
        milkFat: String(ingredient.milkFat),
        water: String(ingredient.water),
        solids: String(ingredient.solids),
        otherFats: String(ingredient.otherFats),
        alcohol: String(ingredient.alcohol ?? 0),
      });
      setAllergens(migrateAllergens(ingredient.allergens));
      setPricingIrrelevant(ingredient.pricingIrrelevant ?? false);
      setShellCapable(ingredient.shellCapable ?? false);
      setSubIngredients(ingredient.subIngredients ?? []);
      setPurchaseCost(ingredient.purchaseCost != null ? String(ingredient.purchaseCost) : "");
      setPurchaseDate(ingredient.purchaseDate ?? new Date().toISOString().split("T")[0]);
      setPurchaseQty(ingredient.purchaseQty != null ? String(ingredient.purchaseQty) : "1");
      setPurchaseUnit(ingredient.purchaseUnit ?? "g");
      setGramsPerUnit(ingredient.gramsPerUnit != null ? String(ingredient.gramsPerUnit) : "");
      setGramsPerUnitTouched(ingredient.gramsPerUnit != null);
      setDefaultVatRate(ingredient.defaultVatRate != null ? String(ingredient.defaultVatRate) : "");
      // Purchase extras are per-purchase — default VAT seeds the line, supplier prefills from the
      // ingredient's vendor (last purchased-from).
      setPurchaseSupplier(ingredient.vendor ?? "");
      setPurchaseVatRate(ingredient.defaultVatRate != null ? String(ingredient.defaultVatRate) : "");
      setPurchaseInvoice("");
      setUpdateDefault(true);
      // Nutrition
      const nStr: Record<string, string> = {};
      if (ingredient.nutrition) {
        for (const f of ALL_NUTRIENT_FIELDS) {
          const v = ingredient.nutrition[f.key];
          if (v != null) nStr[f.key] = String(v);
        }
      }
      setNutritionStr(nStr);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingredient?.id]);

  // Auto-fill gramsPerUnit when purchaseUnit changes, but only if the user
  // hasn't manually entered a value — prevents overwriting data the user has typed
  useEffect(() => {
    if (gramsPerUnitTouched) return;
    const auto = autoGramsPerUnit(purchaseUnit);
    if (auto !== null) setGramsPerUnit(String(auto));
  }, [purchaseUnit, gramsPerUnitTouched]);

  const compTotal = useMemo(() => {
    return COMPOSITION_FIELDS.reduce((sum, f) => {
      const v = parseFloat(comp[f.key]);
      return sum + (isNaN(v) ? 0 : v);
    }, 0);
  }, [comp]);

  const compValid = Math.abs(compTotal - 100) < 0.1;
  const compEmpty = COMPOSITION_FIELDS.every((f) => !comp[f.key] || comp[f.key] === "0");

  function toggleAllergen(a: string) {
    setAllergens((prev) =>
      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]
    );
    onDirtyChange?.(true);
  }

  function setCompField(key: CompositionKey, value: string) {
    setComp((prev) => ({ ...prev, [key]: value }));
  }

  // Derived cost per gram for preview
  const derivedCostPerGram = useMemo(() => {
    const cost = parseFloat(purchaseCost);
    const qtyVal = parseFloat(purchaseQty);
    const gpuVal = parseFloat(gramsPerUnit);
    if (!cost || !qtyVal || qtyVal <= 0 || !gpuVal || gpuVal <= 0) return null;
    return cost / (qtyVal * gpuVal);
  }, [purchaseCost, purchaseQty, gramsPerUnit]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    // Composition should sum to 100%, but we accept partial/off-by-X
    // data as a warning (matching the CSV import) rather than blocking
    // every other field from being saved. The total is displayed in
    // red above the composition inputs so the user sees the issue.
    setSaving(true);
    setSaveError("");
    try {
      // Build nutrition data from local string state
      const nutritionData: NutritionData = {};
      let hasAnyNutrition = false;
      for (const f of ALL_NUTRIENT_FIELDS) {
        const v = parseFloat(nutritionStr[f.key] ?? "");
        if (!isNaN(v)) {
          nutritionData[f.key] = v;
          hasAnyNutrition = true;
        }
      }
      const filledNutrition = hasAnyNutrition ? fillDerivedNutrition(nutritionData) : undefined;

      const defaultVatNum = parseFloat(defaultVatRate);
      const purchaseVatNum = parseFloat(purchaseVatRate);
      await saveIngredient({
        ...(ingredient?.id ? { id: ingredient.id } : {}),
        name: name.trim(),
        commercialName: commercialName.trim() || undefined,
        manufacturer: manufacturer.trim(),
        brand: brand.trim() || undefined,
        // When the user types a new supplier into the per-purchase field,
        // promote it to the ingredient's default vendor as long as
        // "update default" is on. Otherwise keep the existing vendor.
        vendor: updateDefault
          ? (purchaseSupplier.trim() || vendor.trim() || undefined)
          : (vendor.trim() || undefined),
        source: source.trim(),
        category: category || undefined,
        cost: 0, // legacy field kept for compatibility
        notes: notes.trim(),
        // Both booleans persist as real booleans. Previously we collapsed
        // `false` to `undefined`, which on update caused Supabase to
        // serialise null into the payload — and both columns are NOT NULL
        // in the schema, so the DB rejected every edit.
        pricingIrrelevant,
        shellCapable,
        subIngredients: subIngredients.length > 0
          ? subIngredients
              .map((s) => ({ name: s.name.trim(), percentage: s.percentage }))
              .filter((s) => s.name.length > 0)
          : undefined,
        purchaseCost: parseFloat(purchaseCost) || undefined,
        purchaseDate: purchaseDate || undefined,
        purchaseQty: parseFloat(purchaseQty) || undefined,
        purchaseUnit: purchaseUnit || undefined,
        gramsPerUnit: parseFloat(gramsPerUnit) || undefined,
        defaultVatRate: Number.isFinite(defaultVatNum) && defaultVatNum >= 0 ? defaultVatNum : undefined,
        cacaoFat: parseFloat(comp.cacaoFat) || 0,
        sugar: parseFloat(comp.sugar) || 0,
        milkFat: parseFloat(comp.milkFat) || 0,
        water: parseFloat(comp.water) || 0,
        solids: parseFloat(comp.solids) || 0,
        otherFats: parseFloat(comp.otherFats) || 0,
        alcohol: parseFloat(comp.alcohol) || 0,
        allergens,
        nutrition: filledNutrition,
      }, {
        updateDefault,
        purchaseExtras: {
          supplier: purchaseSupplier.trim() || undefined,
          vatRatePercent: Number.isFinite(purchaseVatNum) && purchaseVatNum >= 0 ? purchaseVatNum : undefined,
          invoiceNumber: purchaseInvoice.trim() || undefined,
        },
      });

      onSaved();
    } catch (err) {
      // Surface the real reason so a failed save isn't silent. Supabase
      // throws PostgrestError as a plain object, not an Error instance,
      // so read the shape defensively.
      const raw: { message?: string; code?: string; details?: string } =
        err instanceof Error ? { message: err.message } : ((err as Record<string, string>) ?? {});
      const code = raw.code ? ` (code ${raw.code})` : "";
      setSaveError(`${raw.message || raw.details || "Save failed"}${code}`);
      console.error("saveIngredient failed:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      onChange={() => onDirtyChange?.(true)}
      onKeyDown={(e) => {
        // Pressing Enter in any single-line input shouldn't save the form —
        // it should just move focus to the next field (the normal tab flow).
        // Textareas keep their default Enter-for-newline behaviour; the
        // explicit Update button still works as the way to save.
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          const form = e.currentTarget;
          const fields = Array.from(
            form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
              "input, textarea, select",
            ),
          ).filter((el) => !el.disabled && el.type !== "hidden");
          const i = fields.indexOf(e.target);
          const next = fields[i + 1];
          if (next) next.focus();
        }
      }}
      className="space-y-4"
    >
      {sec === "details" && (
        <>
          <div>
            <label className="label">Commercial name</label>
            <input
              type="text"
              value={commercialName}
              onChange={(e) => setCommercialName(e.target.value)}
              className="input"
              placeholder="e.g. Guanaja 70%"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Manufacturer</label>
              <input
                type="text"
                list="manufacturer-list"
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
                className="input"
                placeholder="e.g. Valrhona"
              />
              {manufacturers.length > 0 && (
                <datalist id="manufacturer-list">
                  {manufacturers.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              )}
            </div>
            <div>
              <label className="label">Source</label>
              <input
                type="text"
                list="source-list"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="input"
                placeholder="e.g. Keylink"
              />
              {sources.length > 0 && (
                <datalist id="source-list">
                  {sources.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Brand</label>
              <input
                type="text"
                list="brand-list"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="input"
                placeholder="e.g. Guanaja"
              />
              {brands.length > 0 && (
                <datalist id="brand-list">
                  {brands.map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
              )}
            </div>
            <div>
              <label className="label">Vendor</label>
              <input
                type="text"
                list="vendor-list"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                className="input"
                placeholder="e.g. Chocolate Trading Co"
              />
              {vendors.length > 0 && (
                <datalist id="vendor-list">
                  {vendors.map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
              )}
            </div>
          </div>

          <div>
            <label className="label">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="input"
            >
              <option value="">— select —</option>
              {ingredientCategoryNames.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="input resize-none"
              placeholder="Any additional notes..."
            />
          </div>
        </>
      )}

      {sec === "shell" && (
        <fieldset className="space-y-4">
          <legend className="text-sm font-medium mb-1">Shell chocolate</legend>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={shellCapable}
              onChange={(e) => { setShellCapable(e.target.checked); onDirtyChange?.(true); }}
              className="rounded border-border"
            />
            Can be used as shell chocolate
            <span className="text-xs text-muted-foreground">(couverture)</span>
          </label>
        </fieldset>
      )}

      {sec === "composition" && (
        <fieldset>
          <legend className="text-sm font-medium mb-1">Composition (%)</legend>
          <p className={cn(
            "text-xs mb-2",
            compEmpty ? "text-muted-foreground" : compValid ? "text-status-ok" : "text-destructive"
          )}>
            Total: {compTotal.toFixed(1)}%{!compEmpty && !compValid && " — must equal 100%"}
          </p>
          <div className="grid grid-cols-3 gap-3">
            {COMPOSITION_FIELDS.map((f) => (
              <div key={f.key}>
                <label className="label">{f.label}</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={comp[f.key]}
                  onChange={(e) => setCompField(f.key, e.target.value)}
                  className="input"
                />
              </div>
            ))}
          </div>
        </fieldset>
      )}

      {sec === "ingredients" && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium mb-1">Sub-ingredients</legend>
          <p className="text-xs text-muted-foreground">
            Optional. Used to compose ingredient-list text at filling / product / variant
            level. Enter sub-ingredients in descending order of quantity (EU labelling
            convention); the order you save here is the order they&apos;ll appear on
            rolled-up ingredient lists.
          </p>

          {subIngredients.length > 0 && (
            <div className="space-y-2">
              {subIngredients.map((s, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <div className="flex flex-col shrink-0">
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() => {
                        setSubIngredients((prev) => {
                          const next = [...prev];
                          [next[i - 1], next[i]] = [next[i], next[i - 1]];
                          return next;
                        });
                        onDirtyChange?.(true);
                      }}
                      className="px-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground leading-none"
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={i === subIngredients.length - 1}
                      onClick={() => {
                        setSubIngredients((prev) => {
                          const next = [...prev];
                          [next[i], next[i + 1]] = [next[i + 1], next[i]];
                          return next;
                        });
                        onDirtyChange?.(true);
                      }}
                      className="px-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground leading-none"
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                  </div>
                  <input
                    type="text"
                    value={s.name}
                    onChange={(e) => {
                      setSubIngredients((prev) =>
                        prev.map((row, j) => (j === i ? { ...row, name: e.target.value } : row)),
                      );
                      onDirtyChange?.(true);
                    }}
                    placeholder="e.g. Cocoa mass"
                    className="input flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setSubIngredients((prev) => prev.filter((_, j) => j !== i));
                      onDirtyChange?.(true);
                    }}
                    className="p-2 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted transition-colors shrink-0"
                    aria-label="Remove sub-ingredient"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setSubIngredients((prev) => [...prev, { name: "" }]);
              onDirtyChange?.(true);
            }}
            className="text-sm text-primary hover:underline"
          >
            + Add sub-ingredient
          </button>
        </fieldset>
      )}

      {sec === "allergens" && (
        <fieldset>
          <legend className="text-sm font-medium mb-3">Allergens</legend>
          <p className="text-xs text-muted-foreground mb-3">Tick all that apply to this ingredient</p>

          <div className="space-y-1 mb-4">
            {activeAllergens.filter(a => !a.group).map((a) => (
              <label key={a.id} className="flex items-start gap-2.5 cursor-pointer py-1 group">
                <input
                  type="checkbox"
                  checked={allergens.includes(a.id)}
                  onChange={() => toggleAllergen(a.id)}
                  className="mt-0.5 shrink-0 accent-[var(--color-primary)]"
                />
                <span className="flex-1 min-w-0">
                  <span className={`text-sm ${allergens.includes(a.id) ? "font-semibold text-foreground" : "text-foreground"}`}>{a.label}</span>
                  {a.hint && <span className="text-xs text-muted-foreground ml-1.5">{a.hint}</span>}
                </span>
              </label>
            ))}
          </div>

          <div className="border border-border rounded-sm overflow-hidden">
            <div className="px-3 py-2 bg-muted/50 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-foreground uppercase tracking-wide">Tree nuts</span>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    const nutIds = activeAllergens.filter(a => a.group === "nuts").map(a => a.id);
                    setAllergens(prev => [...new Set([...prev, ...nutIds])]);
                    onDirtyChange?.(true);
                  }}
                  className="text-xs text-primary hover:underline"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const nutIds = new Set(activeAllergens.filter(a => a.group === "nuts").map(a => a.id));
                    setAllergens(prev => prev.filter(a => !nutIds.has(a)));
                    onDirtyChange?.(true);
                  }}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  None
                </button>
              </div>
            </div>
            <div className="p-3 grid grid-cols-2 gap-x-4 gap-y-1">
              {activeAllergens.filter(a => a.group === "nuts").map((a) => (
                <label key={a.id} className="flex items-center gap-2 cursor-pointer py-0.5">
                  <input
                    type="checkbox"
                    checked={allergens.includes(a.id)}
                    onChange={() => toggleAllergen(a.id)}
                    className="shrink-0 accent-[var(--color-primary)]"
                  />
                  <span className={`text-sm ${allergens.includes(a.id) ? "font-semibold text-foreground" : "text-foreground"}`}>{a.label}</span>
                </label>
              ))}
            </div>
          </div>
        </fieldset>
      )}

      {sec === "pricing" && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Purchase pricing</legend>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Purchase qty</label>
              <input
                type="number"
                step="any"
                min="0"
                value={purchaseQty}
                onChange={(e) => setPurchaseQty(e.target.value)}
                className="input"
                placeholder="1"
              />
            </div>
            <div>
              <label className="label">Purchase unit</label>
              <select
                value={purchaseUnit}
                onChange={(e) => setPurchaseUnit(e.target.value)}
                className="input"
              >
                {PURCHASE_UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
            <div>
              <label
                className="label"
                title="Net weight in grams of a single unit (from packaging). For liquids, use density: water ≈ 1000 g/L, milk ≈ 1030, cream 35% ≈ 995, honey ≈ 1420, oil ≈ 920."
              >
                g per unit
              </label>
              <input
                type="number"
                step="any"
                min="0"
                value={gramsPerUnit}
                onChange={(e) => { setGramsPerUnit(e.target.value); setGramsPerUnitTouched(true); }}
                className="input"
                placeholder="e.g. 1000"
                title="Net weight in grams of a single unit (from packaging). For liquids, use density: water ≈ 1000 g/L, milk ≈ 1030, cream 35% ≈ 995, honey ≈ 1420, oil ≈ 920."
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Price excl. VAT ({sym})</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={purchaseCost}
                onChange={(e) => setPurchaseCost(e.target.value)}
                className="input"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="label">Price last updated</label>
              <input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="input"
              />
            </div>
          </div>

          {derivedCostPerGram !== null && (
            <div className="rounded-md bg-primary/5 border border-primary/20 px-3 py-2 flex items-baseline gap-2">
              <span className="text-xs text-muted-foreground">Cost per gram:</span>
              <span className="text-sm font-semibold text-primary">
                {sym}{derivedCostPerGram < 0.01
                  ? derivedCostPerGram.toFixed(4)
                  : derivedCostPerGram.toFixed(3)}
                /g
              </span>
              {purchaseDate && (
                <span className="text-xs text-muted-foreground ml-auto">
                  updated {new Date(purchaseDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              )}
            </div>
          )}

          {/* Purchase log extras (Phase 8) */}
          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border">
            <div>
              <label className="label">Supplier</label>
              <input
                value={purchaseSupplier}
                onChange={(e) => setPurchaseSupplier(e.target.value)}
                placeholder="Keylink, local, …"
                className="input"
              />
            </div>
            <div>
              <label className="label">VAT % (this purchase)</label>
              <input
                type="number" min={0} max={100} step={0.5}
                value={purchaseVatRate}
                onChange={(e) => setPurchaseVatRate(e.target.value)}
                placeholder="10"
                className="input"
              />
            </div>
            <div>
              <label className="label">Invoice #</label>
              <input
                value={purchaseInvoice}
                onChange={(e) => setPurchaseInvoice(e.target.value)}
                placeholder="optional"
                className="input"
              />
            </div>
          </div>
          {parseFloat(purchaseCost) > 0 && parseFloat(purchaseVatRate) > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Gross ≈ {sym}
              {(parseFloat(purchaseCost) * (1 + parseFloat(purchaseVatRate) / 100)).toFixed(2)}
            </p>
          )}

          <div>
            <label className="label">Default VAT rate (this ingredient)</label>
            <input
              type="number" min={0} max={100} step={0.5}
              value={defaultVatRate}
              onChange={(e) => setDefaultVatRate(e.target.value)}
              placeholder="10"
              className="input w-24"
            />
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Pre-fills the VAT field on future purchases for this ingredient.
            </p>
          </div>

          <label className="flex items-center gap-2 cursor-pointer pt-1 border-t border-border">
            <input
              type="checkbox"
              checked={updateDefault}
              onChange={(e) => setUpdateDefault(e.target.checked)}
              className="rounded border-border"
            />
            <span className="text-xs">
              <span className="font-medium">Update default price</span>
              <span className="block text-muted-foreground">
                When ticked, advances the pricing-tab defaults to this purchase. A purchase log
                entry is always appended regardless — cost calculations track history.
              </span>
            </span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={pricingIrrelevant}
              onChange={(e) => setPricingIrrelevant(e.target.checked)}
              className="rounded border-border"
            />
            <span className="text-xs text-muted-foreground">Not relevant for pricing (e.g. water, salt) — treated as zero cost</span>
          </label>
        </fieldset>
      )}

      {sec === "nutrition" && (
        <NutritionFormSection
          region={region}
          nutritionStr={nutritionStr}
          setNutritionStr={setNutritionStr}
          onDirtyChange={onDirtyChange}
        />
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="btn-primary flex-1 py-2"
        >
          {saving ? "Saving..." : ingredient?.id ? "Update" : "Add Ingredient"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary px-4 py-2"
        >
          Cancel
        </button>
      </div>
      {saveError && (
        <p className="text-xs text-status-alert pt-1">{saveError}</p>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Nutrition form section — shows market-relevant fields, extras collapsible
// ---------------------------------------------------------------------------

function NutritionFormSection({
  region,
  nutritionStr,
  setNutritionStr,
  onDirtyChange,
}: {
  region: import("@/types").MarketRegion;
  nutritionStr: Record<string, string>;
  setNutritionStr: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onDirtyChange?: (isDirty: boolean) => void;
}) {
  const marketNutrients = getNutrientsByMarket(region);
  const marketKeys = new Set(marketNutrients.map(n => n.key));
  const marketFields = ALL_NUTRIENT_FIELDS.filter(f => marketKeys.has(f.key));

  const groupLabels: Record<string, string> = {
    energy: "Energy",
    fats: "Fats",
    carbs: "Carbohydrates",
    protein: "Protein",
    minerals: "Salt, sodium & minerals",
  };

  const groups = [...new Set(marketFields.map(f => f.group))];

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium mb-1">Nutrition (per 100g)</legend>
      <p className="text-xs text-muted-foreground mb-3">
        Enter values per 100g. Energy and salt/sodium are auto-derived when you fill one side.
      </p>

      {groups.map(group => {
        const groupFields = marketFields.filter(f => f.group === group);
        if (groupFields.length === 0) return null;
        return (
          <div key={group}>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{groupLabels[group]}</h3>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {groupFields.map(f => (
                <div key={f.key}>
                  <label className="label">
                    {f.label} <span className="text-muted-foreground font-normal">({f.unit})</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={nutritionStr[f.key] ?? ""}
                    onChange={(e) => {
                      setNutritionStr(prev => ({ ...prev, [f.key]: e.target.value }));
                      onDirtyChange?.(true);
                    }}
                    className="input"
                    placeholder="0"
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}
