"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useProductsList,
  saveProduct,
  useProductCategories,
  useProductCategoryUsageCounts,
  saveProductCategory,
  useProductProductionMap,
  useProductFillingsForProducts,
  useFillings,
} from "@/lib/hooks";
import {
  PageHeader,
  CategorySection,
  ProductCard,
  AddCard,
  DsButton,
  Section,
  type ProductStockVariant,
} from "@/components/dulceria";
import { allergenLabel, isRealAllergen } from "@/types";
import { IconPlus, IconSearch, IconCategory, IconFileImport } from "@tabler/icons-react";
import { usePersistedFilters } from "@/lib/use-persisted-filters";
import {
  ListToolbar,
  FilterPanel,
  ArchiveFilterChip,
  QuickAddForm,
  EmptyState,
  ListItemCard,
} from "@/components/pantry";
import { useNShortcut } from "@/lib/use-n-shortcut";
import { formatCategoryRange } from "@/lib/productCategories";

type Tab = "products" | "categories";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "products", label: "Products" },
  { id: "categories", label: "Categories" },
];

export default function ProductsPage() {
  return (
    <Suspense fallback={null}>
      <ProductsPageInner />
    </Suspense>
  );
}

function ProductsPageInner() {
  const [tab, setTab] = usePersistedFilters("products-tab", { activeTab: "products" as Tab });
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");

  useEffect(() => {
    if (tabParam === "products" || tabParam === "categories") {
      if (tab.activeTab !== tabParam) setTab("activeTab", tabParam);
    }
  }, [tabParam]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      {tab.activeTab === "products" ? (
        <ProductsTab onSwitchToCategories={() => setTab("activeTab", "categories")} />
      ) : (
        <CategoriesTab onSwitchToProducts={() => setTab("activeTab", "products")} />
      )}
    </div>
  );
}

function ProductsTab({ onSwitchToCategories }: { onSwitchToCategories: () => void }) {
  const router = useRouter();
  const [f, setF] = usePersistedFilters("products-v2", {
    search: "",
    filterCategoryId: "",
    filterExcludeAllergens: [] as string[],
    showArchived: false,
  });

  const products = useProductsList(f.showArchived);
  const productionMap = useProductProductionMap();
  const productCategories = useProductCategories(true);
  const allFillings = useFillings();
  const allProductIds = useMemo(() => products.map((p) => p.id!).filter(Boolean), [products]);
  const productFillingsMap = useProductFillingsForProducts(allProductIds);

  const fillingNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of allFillings) if (l.id) m.set(l.id, l.name);
    return m;
  }, [allFillings]);

  const fillingAllergenMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of allFillings) if (l.id) m.set(l.id, l.allergens ?? []);
    return m;
  }, [allFillings]);

  const productAllergenMap = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const [pid, rl] of productFillingsMap) {
      const set = new Set<string>();
      for (const { fillingId } of rl) {
        for (const a of fillingAllergenMap.get(fillingId) ?? []) {
          if (isRealAllergen(a)) set.add(a);
        }
      }
      m.set(pid, set);
    }
    return m;
  }, [productFillingsMap, fillingAllergenMap]);

  const productFillingNamesMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [pid, rl] of productFillingsMap) {
      const names: string[] = [];
      for (const { fillingId } of rl) {
        const n = fillingNameMap.get(fillingId);
        if (n) names.push(n);
      }
      m.set(pid, names);
    }
    return m;
  }, [productFillingsMap, fillingNameMap]);

  const presentAllergens = useMemo(() => {
    const set = new Set<string>();
    for (const s of productAllergenMap.values()) for (const a of s) set.add(a);
    return Array.from(set).sort();
  }, [productAllergenMap]);

  const filterExcludeSet = useMemo(() => new Set(f.filterExcludeAllergens), [f.filterExcludeAllergens]);

  function toggleExclude(id: string) {
    const next = new Set(filterExcludeSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setF("filterExcludeAllergens", Array.from(next));
  }

  const filtered = useMemo(() => {
    const q = f.search.trim().toLowerCase();
    return products.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (f.filterCategoryId && p.productCategoryId !== f.filterCategoryId) return false;
      if (filterExcludeSet.size > 0) {
        const aller = productAllergenMap.get(p.id!) ?? new Set<string>();
        for (const a of filterExcludeSet) if (aller.has(a)) return false;
      }
      return true;
    });
  }, [products, f.search, f.filterCategoryId, filterExcludeSet, productAllergenMap]);

  const grouped = useMemo(() => {
    const catById = new Map(productCategories.map((c) => [c.id!, c]));
    const byCat = new Map<string, typeof filtered>();
    const other: typeof filtered = [];
    for (const p of filtered) {
      const cid = p.productCategoryId;
      if (!cid || !catById.has(cid)) other.push(p);
      else {
        const arr = byCat.get(cid) ?? [];
        arr.push(p);
        byCat.set(cid, arr);
      }
    }
    const groups: Array<{ id: string; name: string; products: typeof filtered }> = [];
    for (const c of productCategories) {
      const arr = byCat.get(c.id!);
      if (arr && arr.length > 0) {
        groups.push({ id: c.id!, name: c.name, products: arr });
      }
    }
    if (other.length > 0) groups.push({ id: "", name: "Uncategorised", products: other });
    return groups;
  }, [filtered, productCategories]);

  const lowStockCount = useMemo(() => {
    let n = 0;
    for (const p of products) {
      const info = productionMap.get(p.id!);
      if (!info?.inStock) n++;
    }
    return n;
  }, [products, productionMap]);

  function stockVariantFor(productId: string): { variant: ProductStockVariant; label: string } {
    const info = productionMap.get(productId);
    if (!info) return { variant: "out", label: "no batch" };
    return info.inStock
      ? { variant: "in", label: "in stock" }
      : { variant: "out", label: "out" };
  }

  async function handleAdd() {
    const id = await saveProduct({ name: "New product" });
    router.push(`/products/${encodeURIComponent(String(id))}?new=1`);
  }

  const total = products.length;
  const catCount = productCategories.filter((c) => !c.archived).length;

  return (
    <>
      <PageHeader
        title="Products"
        meta={`${total} products across ${catCount} categor${catCount === 1 ? "y" : "ies"}${
          lowStockCount > 0 ? ` · ${lowStockCount} out / low` : ""
        }`}
        actions={
          <>
            <DsButton variant="default" size="md" onClick={onSwitchToCategories}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <IconCategory size={14} stroke={1.5} /> Categories
              </span>
            </DsButton>
            <DsButton variant="default" size="md" onClick={() => router.push("/imports")}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <IconFileImport size={14} stroke={1.5} /> Import
              </span>
            </DsButton>
            <DsButton variant="primary" size="md" onClick={handleAdd}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <IconPlus size={14} stroke={1.5} /> New product
              </span>
            </DsButton>
          </>
        }
      />

      <div style={{ padding: "16px 32px 40px", display: "flex", flexDirection: "column", gap: 18 }}>
        <FiltersBar
          search={f.search}
          onSearchChange={(v) => setF("search", v)}
          categories={productCategories.filter((c) => !c.archived)}
          filterCategoryId={f.filterCategoryId}
          onCategoryChange={(id) => setF("filterCategoryId", id)}
          presentAllergens={presentAllergens}
          excludeAllergens={filterExcludeSet}
          onToggleAllergen={toggleExclude}
        />

        {grouped.length === 0 ? (
          <p
            style={{
              textAlign: "center",
              padding: "40px 0",
              fontFamily: "var(--font-serif)",
              fontSize: 14,
              color: "var(--ds-text-muted)",
            }}
          >
            {products.length === 0 ? "No products yet. Click New product to add the first." : "No products match the current filters."}
          </p>
        ) : (
          grouped.map((g) => {
            const lowCount = g.products.filter((p) => !productionMap.get(p.id!)?.inStock).length;
            return (
              <CategorySection
                key={g.id || "uncategorised"}
                title={g.name.charAt(0).toUpperCase() + g.name.slice(1)}
                count={`${g.products.length} product${g.products.length === 1 ? "" : "s"}${
                  lowCount > 0 ? ` · ${lowCount} out / low` : ""
                }`}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                    gap: 8,
                  }}
                >
                  {g.products.map((p) => {
                    const stock = stockVariantFor(p.id!);
                    const fillings = productFillingNamesMap.get(p.id!) ?? [];
                    const coatingText = p.coating
                      ? p.coating.charAt(0).toUpperCase() + p.coating.slice(1)
                      : null;
                    const recipe = [coatingText, ...fillings].filter((x): x is string => Boolean(x));
                    const aller = Array.from(productAllergenMap.get(p.id!) ?? []);
                    return (
                      <ProductCard
                        key={p.id}
                        href={`/products/${encodeURIComponent(p.id ?? "")}`}
                        name={p.name}
                        recipeIngredients={recipe}
                        allergens={aller}
                        stockVariant={stock.variant}
                        stockLabel={stock.label}
                        archived={p.archived}
                      />
                    );
                  })}
                  <AddCard
                    label={`new ${g.name.toLowerCase()} product`}
                    onClick={handleAdd}
                  />
                </div>
              </CategorySection>
            );
          })
        )}
      </div>
    </>
  );
}

function FiltersBar({
  search,
  onSearchChange,
  categories,
  filterCategoryId,
  onCategoryChange,
  presentAllergens,
  excludeAllergens,
  onToggleAllergen,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  categories: ReturnType<typeof useProductCategories>;
  filterCategoryId: string;
  onCategoryChange: (id: string) => void;
  presentAllergens: string[];
  excludeAllergens: Set<string>;
  onToggleAllergen: (id: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          border: "0.5px solid var(--ds-border-warm)",
          background: "var(--ds-card-bg)",
          borderRadius: 14,
          maxWidth: 360,
        }}
      >
        <IconSearch size={13} stroke={1.5} style={{ color: "var(--ds-text-muted)" }} />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search products…"
          style={{
            fontSize: 12,
            border: "none",
            background: "transparent",
            outline: "none",
            flex: 1,
            color: "var(--ds-text-primary)",
          }}
        />
      </div>

      {categories.length > 0 && (
        <PillRow
          label="Category"
          options={[
            { id: "", label: "All" },
            ...categories.map((c) => ({
              id: c.id!,
              label: c.name.charAt(0).toUpperCase() + c.name.slice(1),
            })),
          ]}
          selected={(id) => filterCategoryId === id}
          onSelect={onCategoryChange}
        />
      )}

      {presentAllergens.length > 0 && (
        <PillRow
          label="Avoid"
          options={presentAllergens.map((a) => ({ id: a, label: allergenLabel(a) }))}
          selected={(id) => excludeAllergens.has(id)}
          onSelect={onToggleAllergen}
          multi
        />
      )}
    </div>
  );
}

function PillRow({
  label,
  options,
  selected,
  onSelect,
  multi,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  selected: (id: string) => boolean;
  onSelect: (id: string) => void;
  multi?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--ds-text-muted)",
          fontWeight: 600,
          marginRight: 4,
        }}
      >
        {label}
      </span>
      {options.map((o) => {
        const active = selected(o.id);
        return (
          <button
            key={o.id || "all"}
            type="button"
            onClick={() => onSelect(o.id)}
            style={{
              padding: "3px 10px",
              fontSize: 11,
              border: `0.5px solid ${active ? "var(--ds-tier-quarter-focus)" : "var(--ds-border-warm)"}`,
              background: active ? (multi ? "var(--ds-tint-critical)" : "var(--ds-tier-quarter-focus)") : "var(--ds-card-bg)",
              color: active ? (multi ? "var(--ds-tier-urgent)" : "#ffffff") : "var(--ds-text-muted)",
              borderRadius: 12,
              cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function CategoriesTab({ onSwitchToProducts }: { onSwitchToProducts: () => void }) {
  const router = useRouter();
  const [f, setF] = usePersistedFilters("product-categories", {
    search: "",
    showFilters: false,
    showArchived: false,
  });
  const categories = useProductCategories(f.showArchived);
  const usageCounts = useProductCategoryUsageCounts();

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  useNShortcut(() => setShowAdd(true), showAdd);

  const filtered = useMemo(() => {
    const q = f.search.trim().toLowerCase();
    return categories.filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [categories, f.search]);

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!newName.trim()) return;
    const id = await saveProductCategory({
      name: newName.trim(),
      shellPercentMin: 15,
      shellPercentMax: 50,
      defaultShellPercent: 30,
    });
    setNewName("");
    setShowAdd(false);
    router.push(`/products/categories/${encodeURIComponent(id)}?new=1`);
  }

  return (
    <>
      <PageHeader
        title="Product categories"
        meta={`${categories.filter((c) => !c.archived).length} categories`}
        actions={
          <DsButton variant="default" size="md" onClick={onSwitchToProducts}>
            ← Back to products
          </DsButton>
        }
      />
      <div style={{ padding: "16px 32px 40px" }}>
        <Section
          title="Categories"
          action={
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              style={{ fontSize: 12, color: "var(--ds-tier-quarter-focus)", fontWeight: 500 }}
            >
              + new category
            </button>
          }
        >
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <ListToolbar
              search={f.search}
              onSearchChange={(v) => setF("search", v)}
              searchPlaceholder="Search categories…"
              searchAriaLabel="Search product categories"
              onAdd={() => setShowAdd(true)}
              addAriaLabel="Add product category"
              addTitle="Add category (n)"
              showFilters
              filterPanelOpen={f.showFilters}
              onToggleFilters={() => setF("showFilters", !f.showFilters)}
              activeFilterCount={f.showArchived ? 1 : 0}
            />
            {f.showFilters && (
              <FilterPanel
                activeFilterCount={f.showArchived ? 1 : 0}
                onClearAll={() => setF("showArchived", false)}
              >
                <ArchiveFilterChip
                  value={f.showArchived}
                  onChange={(v) => setF("showArchived", v)}
                />
              </FilterPanel>
            )}
            {showAdd && (
              <QuickAddForm
                onSubmit={handleAdd}
                onCancel={() => {
                  setShowAdd(false);
                  setNewName("");
                }}
                submitLabel="Create category"
                canSubmit={!!newName.trim()}
              >
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setShowAdd(false);
                      setNewName("");
                    }
                  }}
                  placeholder="Category name…"
                  aria-label="Category name"
                  className="input w-full"
                  autoFocus
                  required
                />
              </QuickAddForm>
            )}
            {filtered.length === 0 ? (
              <EmptyState
                hasData={categories.length > 0}
                emptyMessage="No product categories yet."
                filteredMessage="No categories match."
              />
            ) : (
              <ul style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {filtered.map((c) => {
                  const usage = usageCounts.get(c.id!) ?? 0;
                  return (
                    <ListItemCard
                      key={c.id}
                      href={`/products/categories/${encodeURIComponent(c.id!)}`}
                      archived={c.archived}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm capitalize truncate">{c.name}</span>
                          {c.archived && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              Archived
                            </span>
                          )}
                          <span className="text-[11px] font-mono text-muted-foreground bg-muted rounded px-1.5 py-0.5 shrink-0">
                            shell {formatCategoryRange(c)}
                          </span>
                          <span className="text-[11px] text-muted-foreground/80 shrink-0">
                            default {c.defaultShellPercent}%
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {usage === 0 ? "Not in use" : `${usage} product${usage === 1 ? "" : "s"}`}
                        </div>
                      </div>
                    </ListItemCard>
                  );
                })}
              </ul>
            )}
          </div>
        </Section>
      </div>
    </>
  );
}
