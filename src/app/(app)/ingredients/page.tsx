"use client";

import { useState, useMemo, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { useIngredients, saveIngredient, setIngredientLowStock, useIngredientCategories, useIngredientCategoryUsageCounts, saveIngredientCategory, useIngredientCategoryNames, useAllIngredientStock, adjustIngredientStock } from "@/lib/hooks";
import { ALLERGEN_LIST, DIET_LIST, costPerGram, allergenLabel, allergenShortCode, isRealAllergen, type Ingredient } from "@/types";
import { Plus, Search, ChevronRight, ChevronDown, SlidersHorizontal, X, Package, Minus } from "lucide-react";
import Link from "next/link";
import { ListToolbar, FilterPanel, ArchiveFilterChip, QuickAddForm, EmptyState, ListItemCard, MultiSelectDropdown, LowStockFlagButton, StockBadge, GroupStockBadge } from "@/components/pantry";
import { usePersistedFilters } from "@/lib/use-persisted-filters";
import { useNShortcut } from "@/lib/use-n-shortcut";

const VALID_TAGS = new Set<string>([...ALLERGEN_LIST, ...DIET_LIST]);

function hasComposition(ing: { cacaoFat: number; sugar: number; milkFat: number; water: number; solids: number; otherFats: number; alcohol?: number }): boolean {
  return (ing.cacaoFat + ing.sugar + ing.milkFat + ing.water + ing.solids + ing.otherFats + (ing.alcohol ?? 0)) > 0;
}

function hasPricing(ing: Ingredient): boolean {
  return costPerGram(ing) !== null;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(date));
}

type StockFilter = "all" | "in-stock" | "low-stock" | "ordered" | "out-of-stock";
type CompositionFilter = "all" | "has" | "missing";
type PricingFilter = "all" | "has" | "missing";

function getStockStatus(ing: { lowStock?: boolean; lowStockOrdered?: boolean; outOfStock?: boolean }): "in-stock" | "low-stock" | "ordered" | "out-of-stock" {
  if (ing.outOfStock) return "out-of-stock";
  if (ing.lowStock && ing.lowStockOrdered) return "ordered";
  if (ing.lowStock) return "low-stock";
  return "in-stock";
}

type IngredientsMainTab = "ingredients" | "stock" | "categories";
const TABS: { id: IngredientsMainTab; label: string }[] = [
  { id: "ingredients", label: "Ingredients" },
  { id: "stock", label: "Stock" },
  { id: "categories", label: "Categories" },
];

export default function IngredientsPage() {
  return (
    <Suspense fallback={null}>
      <IngredientsPageInner />
    </Suspense>
  );
}

function IngredientsPageInner() {
  const [tab, setTab] = usePersistedFilters("ingredients-tab", { activeTab: "ingredients" as IngredientsMainTab });
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");

  // URL param wins over sessionStorage (so "Back" links from a category detail land on the right tab)
  useEffect(() => {
    if (tabParam === "ingredients" || tabParam === "stock" || tabParam === "categories") {
      if (tab.activeTab !== tabParam) setTab("activeTab", tabParam);
    }
  }, [tabParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeTab = tab.activeTab;

  return (
    <div>
      <PageHeader title="Ingredients" description="Your ingredient library and the categories that group them" />

      <div className="px-4 mb-3">
        <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab("activeTab", id)}
              className={`px-3.5 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === id
                  ? "bg-accent text-accent-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "ingredients" && <IngredientsTab />}
      {activeTab === "stock" && <IngredientsStockTab />}
      {activeTab === "categories" && <IngredientCategoriesTab />}
    </div>
  );
}

function IngredientsTab() {
  const router = useRouter();
  const [f, setF] = usePersistedFilters("ingredients", {
    search: "",
    showFilters: false,
    filterStock: "all" as StockFilter,
    filterCategories: [] as string[],
    filterManufacturers: [] as string[],
    filterComposition: "all" as CompositionFilter,
    filterPricing: "all" as PricingFilter,
    filterAllergens: [] as string[],
    filterExcludeAllergens: [] as string[],
    filterAllergenData: "all" as "all" | "none",
    showArchived: false,
  });
  const ingredients = useIngredients(f.showArchived);
  const categoryNames = useIngredientCategoryNames();
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  useNShortcut(() => setShowAdd(true), showAdd);

  const CATEGORY_ORDER = useMemo(() => ["Uncategorised", ...categoryNames], [categoryNames]);

  const filterCategoriesSet = useMemo(() => new Set(f.filterCategories), [f.filterCategories]);
  const filterManufacturersSet = useMemo(() => new Set(f.filterManufacturers), [f.filterManufacturers]);
  const filterAllergensSet = useMemo(() => new Set(f.filterAllergens), [f.filterAllergens]);
  const filterExcludeAllergensSet = useMemo(() => new Set(f.filterExcludeAllergens), [f.filterExcludeAllergens]);

  // Derive unique manufacturers from current records
  const allManufacturers = useMemo(() => {
    const set = new Set<string>();
    for (const i of ingredients) if (i.manufacturer) set.add(i.manufacturer);
    return Array.from(set).sort();
  }, [ingredients]);

  // Derive allergens present in at least one ingredient
  const presentAllergenIds = useMemo(() => {
    const set = new Set<string>();
    for (const i of ingredients) for (const a of i.allergens) set.add(a);
    return Array.from(set).sort();
  }, [ingredients]);

  const activeFilterCount =
    (f.filterStock !== "all" ? 1 : 0) +
    (filterCategoriesSet.size > 0 ? 1 : 0) +
    (filterManufacturersSet.size > 0 ? 1 : 0) +
    (f.filterComposition !== "all" ? 1 : 0) +
    (f.filterPricing !== "all" ? 1 : 0) +
    (filterAllergensSet.size > 0 ? 1 : 0) +
    (filterExcludeAllergensSet.size > 0 ? 1 : 0) +
    (f.filterAllergenData !== "all" ? 1 : 0) +
    (f.showArchived ? 1 : 0);

  const filtered = useMemo(() => {
    return ingredients.filter((i) => {
      if (f.search && !i.name.toLowerCase().includes(f.search.toLowerCase()) && !(i.manufacturer ?? "").toLowerCase().includes(f.search.toLowerCase())) return false;
      if (f.filterStock === "low-stock" && (!i.lowStock || i.outOfStock)) return false;
      else if (f.filterStock !== "low-stock" && f.filterStock !== "all" && getStockStatus(i) !== f.filterStock) return false;
      if (filterCategoriesSet.size > 0 && !filterCategoriesSet.has(i.category || "Uncategorised")) return false;
      if (filterManufacturersSet.size > 0 && !filterManufacturersSet.has(i.manufacturer ?? "")) return false;
      if (f.filterComposition === "has" && !hasComposition(i)) return false;
      if (f.filterComposition === "missing" && hasComposition(i)) return false;
      if (f.filterPricing === "has" && !hasPricing(i)) return false;
      if (f.filterPricing === "missing" && hasPricing(i)) return false;
      if (filterAllergensSet.size > 0 && !i.allergens.some((a) => filterAllergensSet.has(a))) return false;
      if (filterExcludeAllergensSet.size > 0 && i.allergens.some((a) => filterExcludeAllergensSet.has(a))) return false;
      if (f.filterAllergenData === "none" && i.allergens.length > 0) return false;
      return true;
    });
  }, [ingredients, f.search, f.filterStock, filterCategoriesSet, filterManufacturersSet, f.filterComposition, f.filterPricing, filterAllergensSet, filterExcludeAllergensSet, f.filterAllergenData]);

  const grouped = useMemo(() => {
    // Single pass: bucket by category name.
    const byCategory = new Map<string, typeof filtered>();
    for (const i of filtered) {
      const key = i.category || "Uncategorised";
      const arr = byCategory.get(key);
      if (arr) arr.push(i);
      else byCategory.set(key, [i]);
    }
    // Show categories from DB order first, then any unrecognised categories at the end
    const ordered = CATEGORY_ORDER
      .map((cat) => ({ category: cat, items: byCategory.get(cat) ?? [] }))
      .filter(({ items }) => items.length > 0);
    // Catch ingredients with category names not in the DB (e.g. custom categories from pre-migration)
    for (const [cat, items] of byCategory) {
      if (!CATEGORY_ORDER.includes(cat)) {
        ordered.push({ category: cat, items });
      }
    }
    return ordered;
  }, [filtered, CATEGORY_ORDER]);

  function toggleCategory(cat: string) {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }

  function toggleFilterCategory(cat: string) {
    const next = new Set(filterCategoriesSet);
    if (next.has(cat)) next.delete(cat); else next.add(cat);
    setF("filterCategories", Array.from(next));
  }

  function toggleFilterAllergen(allergen: string) {
    const next = new Set(filterAllergensSet);
    if (next.has(allergen)) next.delete(allergen); else next.add(allergen);
    setF("filterAllergens", Array.from(next));
  }

  function toggleExcludeAllergen(allergen: string) {
    const next = new Set(filterExcludeAllergensSet);
    if (next.has(allergen)) next.delete(allergen); else next.add(allergen);
    setF("filterExcludeAllergens", Array.from(next));
  }

  function clearFilters() {
    setF("filterStock", "all");
    setF("filterCategories", []);
    setF("filterManufacturers", []);
    setF("filterComposition", "all");
    setF("filterPricing", "all");
    setF("filterAllergens", []);
    setF("filterExcludeAllergens", []);
    setF("filterAllergenData", "all");
    setF("showArchived", false);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const id = await saveIngredient({
      name: newName.trim(),
      manufacturer: "",
      source: "",
      cost: 0,
      notes: "",
      cacaoFat: 0,
      sugar: 0,
      milkFat: 0,
      water: 0,
      solids: 0,
      otherFats: 0,
      allergens: [],
    });
    router.push(`/ingredients/${encodeURIComponent(String(id))}?new=1`);
  }

  const STOCK_OPTIONS: { value: StockFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "in-stock", label: "In stock" },
    { value: "low-stock", label: "Low stock" },
    { value: "out-of-stock", label: "Out of stock" },
    { value: "ordered", label: "Ordered" },
  ];

  return (
    <div className="px-4 space-y-3 pb-6">
      <div className="flex gap-2">
        <div className="flex-1 relative min-w-0">
          <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={f.search}
            onChange={(e) => setF("search", e.target.value)}
            placeholder="Search name or manufacturer…"
            aria-label="Search ingredients"
            className="input !pl-9"
          />
        </div>
        <button
          onClick={() => setF("showFilters", !f.showFilters)}
          className={`relative rounded-sm border p-2 transition-colors ${f.showFilters ? "bg-primary text-primary-foreground border-primary" : "border-border bg-background"}`}
          aria-label="Filters"
        >
          <SlidersHorizontal className="w-5 h-5" />
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-sm bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setShowAdd(true)}
          title="Add ingredient (n)"
          className="rounded-sm bg-accent text-accent-foreground p-2"
          aria-label="Add ingredient"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      {/* Quick filters — most-used dimensions under the search bar.
          Per baseline pattern (feedback_filter_ux_pattern.md). */}
      {(categoryNames.length > 0) && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground font-medium mr-1">Stock</span>
            {STOCK_OPTIONS.filter((o) => o.value !== "all").map(({ value, label }) => {
              const active = f.filterStock === value;
              return (
                <button
                  key={value}
                  onClick={() => setF("filterStock", active ? "all" : value)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                    active
                      ? "bg-accent text-accent-foreground"
                      : "bg-card text-muted-foreground border border-border hover:bg-muted"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {categoryNames.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground font-medium mr-1">Category</span>
              {categoryNames.map((c) => {
                const active = filterCategoriesSet.has(c);
                return (
                  <button
                    key={c}
                    onClick={() => toggleFilterCategory(c)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize transition-colors ${
                      active
                        ? "bg-accent text-accent-foreground"
                        : "bg-card text-muted-foreground border border-border hover:bg-muted"
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {f.showFilters && (
        <div className="rounded-sm border border-border bg-card p-3 space-y-3">
          {/* Stock status */}
          <div>
            <p className="text-xs text-muted-foreground mb-1">Stock status</p>
            <div className="flex flex-wrap gap-1">
              {STOCK_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setF("filterStock", f.filterStock === value ? "all" : value)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${f.filterStock === value && value !== "all" ? "bg-accent text-accent-foreground" : value === "all" && f.filterStock === "all" ? "bg-accent text-accent-foreground" : "border border-border"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Category */}
          <div>
            <p className="text-xs text-muted-foreground mb-1">Category</p>
            <MultiSelectDropdown
              placeholder="All categories"
              options={["Uncategorised", ...categoryNames]}
              selected={filterCategoriesSet}
              onToggle={toggleFilterCategory}
            />
          </div>

          {/* Manufacturer */}
          {allManufacturers.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Manufacturer</p>
              <MultiSelectDropdown
                placeholder="All manufacturers"
                options={allManufacturers}
                selected={filterManufacturersSet}
                onToggle={(m) => {
                  const next = new Set(filterManufacturersSet);
                  if (next.has(m)) next.delete(m); else next.add(m);
                  setF("filterManufacturers", Array.from(next));
                }}
              />
            </div>
          )}

          {/* Composition */}
          <div>
            <p className="text-xs text-muted-foreground mb-1">Composition data</p>
            <div className="flex gap-1">
              {(["all", "has", "missing"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setF("filterComposition", f.filterComposition === v ? "all" : v)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${f.filterComposition === v ? "bg-accent text-accent-foreground" : "border border-border"}`}
                >
                  {v === "all" ? "Any" : v === "has" ? "Has composition" : "Missing"}
                </button>
              ))}
            </div>
          </div>

          {/* Pricing */}
          <div>
            <p className="text-xs text-muted-foreground mb-1">Pricing data</p>
            <div className="flex gap-1">
              {(["all", "has", "missing"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setF("filterPricing", f.filterPricing === v ? "all" : v)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${f.filterPricing === v ? "bg-accent text-accent-foreground" : "border border-border"}`}
                >
                  {v === "all" ? "Any" : v === "has" ? "Has pricing" : "Missing pricing"}
                </button>
              ))}
            </div>
          </div>

          {/* Contains allergen */}
          {presentAllergenIds.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Contains allergen</p>
              <div className="flex flex-wrap gap-1">
                {presentAllergenIds.map((id) => (
                  <button
                    key={id}
                    onClick={() => toggleFilterAllergen(id)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${filterAllergensSet.has(id) ? "bg-accent text-accent-foreground" : "border border-border"}`}
                  >
                    {allergenLabel(id)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Exclude allergens */}
          {presentAllergenIds.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Exclude allergens</p>
              <div className="flex flex-wrap gap-1">
                {presentAllergenIds.map((id) => (
                  <button
                    key={id}
                    onClick={() => toggleExcludeAllergen(id)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${filterExcludeAllergensSet.has(id) ? "bg-destructive text-destructive-foreground" : "border border-border"}`}
                  >
                    {allergenLabel(id)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Allergen data */}
          <div>
            <p className="text-xs text-muted-foreground mb-1">Allergen data</p>
            <div className="flex gap-1">
              <button
                onClick={() => setF("filterAllergenData", f.filterAllergenData === "none" ? "all" : "none")}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${f.filterAllergenData === "none" ? "bg-accent text-accent-foreground" : "border border-border"}`}
              >
                No allergens recorded
              </button>
            </div>
          </div>

          {/* Archived */}
          <ArchiveFilterChip
            value={f.showArchived}
            onChange={(v) => setF("showArchived", v)}
          />

          {activeFilterCount > 0 && (
            <button
              onClick={clearFilters}
              className="text-xs text-muted-foreground flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Clear all filters
            </button>
          )}
        </div>
      )}

      {showAdd && (
        <form onSubmit={handleAdd} className="rounded-sm border border-border bg-card p-3 space-y-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Ingredient name…"
            aria-label="Ingredient name"
            required
            autoFocus
            className="input"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!newName.trim()}
              className="btn-primary flex-1 py-2"
            >
              Create Ingredient
            </button>
            <button
              type="button"
              onClick={() => { setShowAdd(false); setNewName(""); }}
              className="btn-secondary px-4 py-2"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {filtered.length === 0 ? (
        <p className="text-muted-foreground text-sm py-8 text-center">
          {ingredients.length === 0
            ? "No ingredients yet. Tap + to add your first."
            : "No ingredients match your filters."}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-end gap-3">
            <button onClick={() => setCollapsedCategories(new Set(grouped.map((g) => g.category)))} className="text-xs text-muted-foreground">Collapse all</button>
            <button onClick={() => setCollapsedCategories(new Set())} className="text-xs text-muted-foreground">Expand all</button>
          </div>
          {grouped.map(({ category, items }) => {
            const isCollapsed = !f.search && activeFilterCount === 0 && collapsedCategories.has(category);
            return (
              <div key={category}>
                <button
                  onClick={() => toggleCategory(category)}
                  aria-expanded={!isCollapsed}
                  className="flex items-center gap-2 w-full text-left mb-2"
                >
                  <ChevronDown aria-hidden="true" className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                  <h2 className="text-sm font-semibold text-primary">{category}</h2>
                  <span className="text-xs text-muted-foreground">({items.length})</span>
                  <GroupStockBadge
                    outCount={items.filter((i) => i.outOfStock).length}
                    lowCount={items.filter((i) => i.lowStock && !i.outOfStock).length}
                  />
                </button>
                {!isCollapsed && (
                  <ul className="space-y-2 ml-6">
                    {items.map((ing) => {
                      const stockStatus = getStockStatus(ing);
                      return (
                        <li
                          key={ing.id}
                          className={`rounded-sm border bg-card ${stockStatus === "out-of-stock" ? "border-status-alert-edge" : stockStatus === "low-stock" ? "border-status-warn-edge" : ing.archived ? "border-border/50 opacity-60" : "border-border"}`}
                          style={{ contentVisibility: "auto", containIntrinsicSize: "0 64px" }}
                        >
                          <div className="flex items-center min-w-0">
                            <Link
                              href={`/ingredients/${encodeURIComponent(ing.id ?? '')}`}
                              className="flex items-center gap-3 p-3 min-w-0 flex-1"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-baseline gap-1.5 flex-wrap">
                                  <h3 className="font-medium text-sm">
                                    {ing.name}
                                    {ing.archived && (
                                      <span className="ml-1.5 text-[10px] font-normal text-muted-foreground align-middle">archived</span>
                                    )}
                                  </h3>
                                  {ing.commercialName && (
                                    <span className="text-xs text-muted-foreground italic truncate">{ing.commercialName}</span>
                                  )}
                                  {!ing.archived && <StockBadge status={stockStatus} />}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                  {ing.manufacturer && (
                                    <span className="text-xs text-muted-foreground">{ing.manufacturer}</span>
                                  )}
                                  {ing.manufacturer && (hasComposition(ing) || ing.updatedAt) && (
                                    <span className="text-muted-foreground/40 text-xs">·</span>
                                  )}
                                  {hasComposition(ing) ? (
                                    <span className="text-[10px] font-medium text-success bg-success-muted px-1.5 py-0.5 rounded-full">composition ✓</span>
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground/60">no composition</span>
                                  )}
                                  {hasPricing(ing) ? null : (
                                    <span className="text-[10px] text-status-warn bg-status-warn-bg px-1.5 py-0.5 rounded-full">no pricing</span>
                                  )}
                                  {ing.updatedAt && (
                                    <>
                                      <span className="text-muted-foreground/40 text-xs">·</span>
                                      <span className="text-[10px] text-muted-foreground">{formatDate(ing.updatedAt)}</span>
                                    </>
                                  )}
                                </div>
                                {/* Allergen codes — EU-FIC short letters
                                    (A=Gluten, G=Milk, H=Tree nuts, …).
                                    Only real allergens are bold; diet
                                    tags (vegan) are skipped. */}
                                {(() => {
                                  const realAllergens = ing.allergens.filter((a) => isRealAllergen(a));
                                  if (realAllergens.length === 0) return null;
                                  // De-dup short codes (several tree-nut
                                  // IDs all collapse to "H", etc.).
                                  const codes = [
                                    ...new Set(realAllergens.map((a) => allergenShortCode(a)).filter(Boolean) as string[]),
                                  ];
                                  return (
                                    <p className="mt-1 text-[11px] font-bold tracking-[0.08em] text-primary">
                                      {codes.join(", ")}
                                    </p>
                                  );
                                })()}
                              </div>
                              <ChevronRight aria-hidden="true" className="w-4 h-4 text-muted-foreground shrink-0" />
                            </Link>
                            <LowStockFlagButton
                              flagged={ing.lowStock}
                              itemName={ing.name}
                              onFlag={() => setIngredientLowStock(ing.id!, true)}
                              onUnflag={() => setIngredientLowStock(ing.id!, false)}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function IngredientCategoriesTab() {
  const router = useRouter();
  const [f, setF] = usePersistedFilters("ingredient-categories", {
    search: "",
    showFilters: false,
    showArchived: false,
  });

  const categories = useIngredientCategories(f.showArchived);
  const usageCounts = useIngredientCategoryUsageCounts();

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");

  useNShortcut(() => setShowAdd(true), showAdd);

  const activeFilterCount = (f.showArchived ? 1 : 0);

  const filtered = useMemo(() => {
    return categories.filter((c) => {
      if (f.search && !c.name.toLowerCase().includes(f.search.toLowerCase())) return false;
      return true;
    });
  }, [categories, f.search]);

  function clearFilters() {
    setF("showArchived", false);
  }

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!newName.trim()) return;
    const id = await saveIngredientCategory({
      name: newName.trim(),
    });
    setNewName("");
    setShowAdd(false);
    router.push(`/ingredients/categories/${encodeURIComponent(id)}?new=1`);
  }

  return (
    <div className="px-4 space-y-3 pb-6">
      <ListToolbar
        search={f.search}
        onSearchChange={(v) => setF("search", v)}
        searchPlaceholder="Search categories…"
        searchAriaLabel="Search ingredient categories"
        onAdd={() => setShowAdd(true)}
        addAriaLabel="Add ingredient category"
        addTitle="Add category (n)"
        showFilters
        filterPanelOpen={f.showFilters}
        onToggleFilters={() => setF("showFilters", !f.showFilters)}
        activeFilterCount={activeFilterCount}
      />

      {f.showFilters && (
        <FilterPanel activeFilterCount={activeFilterCount} onClearAll={clearFilters}>
          <ArchiveFilterChip
            value={f.showArchived}
            onChange={(v) => setF("showArchived", v)}
          />
        </FilterPanel>
      )}

      {showAdd && (
        <QuickAddForm
          onSubmit={handleAdd}
          onCancel={() => { setShowAdd(false); setNewName(""); }}
          submitLabel="Create Category"
          canSubmit={!!newName.trim()}
        >
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { setShowAdd(false); setNewName(""); } }}
            placeholder="Category name (e.g. Emulsifiers)…"
            aria-label="Category name"
            className="input w-full"
            autoFocus
            required
          />
        </QuickAddForm>
      )}

      {filtered.length === 0 && (
        <EmptyState
          hasData={categories.length > 0}
          emptyMessage="No ingredient categories yet. Tap + to add your first."
          filteredMessage="No categories match your search."
        />
      )}

      {filtered.length > 0 && (
        <ul className="space-y-2">
          {filtered.map((c) => {
            const usage = usageCounts.get(c.name) ?? 0;
            return (
              <ListItemCard
                key={c.id}
                href={`/ingredients/categories/${encodeURIComponent(c.id!)}`}
                archived={c.archived}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">{c.name}</span>
                    {c.archived && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Archived</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {usage === 0 ? "Not in use" : `${usage} ingredient${usage === 1 ? "" : "s"}`}
                  </div>
                </div>
              </ListItemCard>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── Stock tab ─────────────────────────────────────────────────────────
// Per-ingredient stock view. Shows grams on hand, low-stock threshold,
// last movement, plus inline receive / recount / waste quick-adjust
// buttons. Goes through `adjustIngredientStock` so every change writes
// an audit row in ingredientStockMovements. Search + low-stock-only
// filter for fast triage.

type StockTabFilter = "all" | "low" | "zero";

function IngredientsStockTab() {
  const ingredients = useIngredients(false);
  const stockRows = useAllIngredientStock();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StockTabFilter>("all");

  const stockByIngredient = useMemo(() => {
    const m = new Map<string, typeof stockRows[number]>();
    for (const s of stockRows) m.set(s.ingredientId, s);
    return m;
  }, [stockRows]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ingredients
      .filter((ing) => !q || ing.name.toLowerCase().includes(q))
      .map((ing) => {
        const stock = stockByIngredient.get(ing.id!);
        const qty = Number(stock?.quantityG ?? 0);
        const threshold = stock?.lowStockThresholdG != null ? Number(stock.lowStockThresholdG) : null;
        const level: "zero" | "low" | "ok" =
          qty <= 0 ? "zero" :
          threshold != null && qty < threshold ? "low" :
          "ok";
        return { ing, qty, threshold, level };
      })
      .filter((r) => {
        if (filter === "low") return r.level === "low" || r.level === "zero";
        if (filter === "zero") return r.level === "zero";
        return true;
      })
      .sort((a, b) => {
        // zero first, then low, then alpha.
        const score: Record<typeof a.level, number> = { zero: 0, low: 1, ok: 2 };
        if (score[a.level] !== score[b.level]) return score[a.level] - score[b.level];
        return a.ing.name.localeCompare(b.ing.name);
      });
  }, [ingredients, stockByIngredient, search, filter]);

  const lowCount = rows.filter((r) => r.level === "low" || r.level === "zero").length;

  return (
    <div className="px-4 pb-8 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ingredients"
            className="input pl-9"
          />
        </div>
        <div className="flex items-center gap-1">
          {(["all", "low", "zero"] as StockTabFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filter === f ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {f === "all" ? "All" : f === "low" ? `Low / out (${lowCount})` : "Out only"}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-border bg-card/50 px-6 py-10 text-center">
          <Package className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm font-medium">{search ? "No matches" : "No ingredients"}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {search ? "Try a different search term." : "Add ingredients first, then receive stock here."}
          </p>
        </div>
      ) : (
        <ul className="rounded-[14px] border border-border bg-card divide-y divide-border overflow-hidden">
          {rows.map((r) => (
            <StockRow
              key={r.ing.id}
              ingredientId={r.ing.id!}
              name={r.ing.name}
              qty={r.qty}
              threshold={r.threshold}
              level={r.level}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function StockRow({
  ingredientId, name, qty, threshold, level,
}: {
  ingredientId: string;
  name: string;
  qty: number;
  threshold: number | null;
  level: "zero" | "low" | "ok";
}) {
  const [openAdjust, setOpenAdjust] = useState<null | "receive" | "waste" | "recount">(null);
  const [input, setInput] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  function close() {
    setOpenAdjust(null);
    setInput("");
    setNotes("");
  }

  async function handleSubmit() {
    const n = parseFloat(input);
    if (!Number.isFinite(n)) return;
    setSaving(true);
    try {
      if (openAdjust === "receive") {
        await adjustIngredientStock({
          ingredientId,
          deltaG: n, // grams — matches the unit used everywhere else in the app
          reason: "receive",
          notes: notes || undefined,
        });
      } else if (openAdjust === "waste") {
        await adjustIngredientStock({
          ingredientId,
          deltaG: -Math.abs(n),
          reason: "waste",
          notes: notes || undefined,
        });
      } else if (openAdjust === "recount") {
        // set absolute — delta = target - current
        await adjustIngredientStock({
          ingredientId,
          deltaG: n - qty,
          reason: "recount",
          notes: notes || undefined,
        });
      }
      close();
    } finally {
      setSaving(false);
    }
  }

  const qtyLabel = formatGrams(qty);
  const thresholdLabel = threshold != null ? `threshold ${formatGrams(threshold)}` : "no threshold";
  const levelPill =
    level === "zero" ? "bg-[var(--accent-blush-bg)] text-[var(--accent-blush-ink)]" :
    level === "low"  ? "bg-[var(--accent-butter-bg)] text-[var(--accent-butter-ink)]" :
                       "bg-[var(--accent-mint-bg)] text-[var(--accent-mint-ink)]";
  const levelLabel = level === "zero" ? "out" : level === "low" ? "low" : "ok";

  return (
    <li className="px-3 py-2.5">
      <div className="flex items-center gap-3">
        <Link
          href={`/ingredients/${encodeURIComponent(ingredientId)}`}
          className="flex-1 min-w-0 hover:underline-offset-2 hover:underline"
        >
          <p className="text-sm font-medium truncate">{name}</p>
          <p className="text-[11px] text-muted-foreground">{thresholdLabel}</p>
        </Link>
        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${levelPill}`}>{levelLabel}</span>
        <span className="tabular-nums text-sm font-semibold w-24 text-right">{qtyLabel}</span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setOpenAdjust(openAdjust === "receive" ? null : "receive")}
            className="flex items-center gap-1 rounded-sm border border-border bg-card px-2 py-1 text-[11px] hover:border-foreground/30"
            title="Receive / intake"
          >
            <Plus className="w-3 h-3" /> Receive
          </button>
          <button
            onClick={() => setOpenAdjust(openAdjust === "recount" ? null : "recount")}
            className="flex items-center gap-1 rounded-sm border border-border bg-card px-2 py-1 text-[11px] hover:border-foreground/30"
            title="Set exact stock (from a physical count)"
          >
            Recount
          </button>
          <button
            onClick={() => setOpenAdjust(openAdjust === "waste" ? null : "waste")}
            className="flex items-center gap-1 rounded-sm border border-border bg-card px-2 py-1 text-[11px] hover:border-foreground/30"
            title="Log waste / disposal"
          >
            <Minus className="w-3 h-3" /> Waste
          </button>
        </div>
      </div>
      {openAdjust && (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-[10px] border border-border bg-muted/30 p-2">
          <div className="flex flex-col">
            <label className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
              {openAdjust === "recount" ? "New total (g)" : openAdjust === "receive" ? "Amount (g)" : "Waste (g)"}
            </label>
            <input
              type="number"
              step="1"
              min="0"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="input w-28"
              autoFocus
            />
          </div>
          <div className="flex flex-col flex-1 min-w-[160px]">
            <label className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={openAdjust === "receive" ? "supplier / batch" : openAdjust === "waste" ? "reason" : "physical count"}
              className="input"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleSubmit}
              disabled={saving || !input}
              className="rounded-sm bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={close}
              className="rounded-sm border border-border px-3 py-1.5 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function formatGrams(g: number): string {
  if (g >= 1000) return `${(g / 1000).toFixed(g >= 10_000 ? 1 : 2)} kg`;
  return `${Math.round(g)} g`;
}
