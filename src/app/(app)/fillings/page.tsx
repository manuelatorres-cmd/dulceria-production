"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useFillings,
  saveFilling,
  useAllFillingStatuses,
  useFillingCategories,
  useFillingCategoryUsageCounts,
  saveFillingCategory,
  useProductsList,
  useProductFillingsForProducts,
} from "@/lib/hooks";
import { DEFAULT_FILLING_STATUSES, isRealAllergen } from "@/types";
import {
  PageHeader,
  CategorySection,
  FillingCard,
  AddCard,
  DsButton,
  Section,
  normalizeFillingStatus,
  type FillingStatus,
} from "@/components/dulceria";
import {
  ListToolbar,
  FilterPanel,
  ArchiveFilterChip,
  QuickAddForm,
  EmptyState,
  ListItemCard,
} from "@/components/pantry";
import { CategoryPicker } from "@/components/category-picker";
import { IconPlus, IconCategory, IconSearch } from "@tabler/icons-react";
import { usePersistedFilters } from "@/lib/use-persisted-filters";
import { useNShortcut } from "@/lib/use-n-shortcut";

type Tab = "fillings" | "categories";

export default function FillingsPage() {
  return (
    <Suspense fallback={null}>
      <FillingsPageInner />
    </Suspense>
  );
}

function FillingsPageInner() {
  const [tab, setTab] = usePersistedFilters("fillings-tab", { activeTab: "fillings" as Tab });
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");

  useEffect(() => {
    if (tabParam === "fillings" || tabParam === "categories") {
      if (tab.activeTab !== tabParam) setTab("activeTab", tabParam);
    }
  }, [tabParam]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      {tab.activeTab === "fillings" ? (
        <FillingsTab onSwitchToCategories={() => setTab("activeTab", "categories")} />
      ) : (
        <CategoriesTab onSwitchToFillings={() => setTab("activeTab", "fillings")} />
      )}
    </div>
  );
}

type StatusFilter = "all" | FillingStatus;

const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "confirmed", label: "Confirmed" },
  { id: "testing", label: "Testing" },
  { id: "to-try", label: "To try" },
];

function FillingsTab({ onSwitchToCategories }: { onSwitchToCategories: () => void }) {
  const router = useRouter();
  const [f, setF] = usePersistedFilters("fillings-v2", {
    search: "",
    filterStatus: "all" as StatusFilter,
    filterCategory: "",
    showArchived: false,
  });

  const fillings = useFillings(f.showArchived);
  const allCategories = useFillingCategories();
  const products = useProductsList();
  const allProductIds = useMemo(() => products.map((p) => p.id!).filter(Boolean), [products]);
  const productFillingsMap = useProductFillingsForProducts(allProductIds);

  const productNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products) if (p.id) m.set(p.id, p.name);
    return m;
  }, [products]);

  /** fillingId → product names */
  const usedInByFilling = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [pid, rows] of productFillingsMap) {
      const name = productNameById.get(pid);
      if (!name) continue;
      for (const { fillingId } of rows) {
        const arr = m.get(fillingId) ?? [];
        if (!arr.includes(name)) arr.push(name);
        m.set(fillingId, arr);
      }
    }
    for (const arr of m.values()) arr.sort();
    return m;
  }, [productFillingsMap, productNameById]);

  const filtered = useMemo(() => {
    const q = f.search.trim().toLowerCase();
    return fillings.filter((l) => {
      if (q && !l.name.toLowerCase().includes(q) && !(l.category ?? "").toLowerCase().includes(q)) return false;
      if (f.filterStatus !== "all") {
        const norm = normalizeFillingStatus(l.status);
        if (norm !== f.filterStatus) return false;
      }
      if (f.filterCategory && l.category !== f.filterCategory) return false;
      return true;
    });
  }, [fillings, f.search, f.filterStatus, f.filterCategory]);

  const grouped = useMemo(() => {
    const byCategory = new Map<string, typeof filtered>();
    const uncategorized: typeof filtered = [];
    for (const l of filtered) {
      if (!l.category) {
        uncategorized.push(l);
      } else {
        const arr = byCategory.get(l.category) ?? [];
        arr.push(l);
        byCategory.set(l.category, arr);
      }
    }
    const groups: Array<{ id: string; label: string; list: typeof filtered }> = [];
    const seen = new Set<string>();
    for (const cat of allCategories) {
      const arr = byCategory.get(cat.name);
      if (arr && arr.length > 0) {
        groups.push({ id: cat.name, label: cat.name, list: arr });
        seen.add(cat.name);
      }
    }
    const orphans = [...byCategory.keys()].filter((k) => !seen.has(k)).sort();
    for (const k of orphans) {
      groups.push({ id: k, label: k, list: byCategory.get(k)! });
    }
    if (uncategorized.length > 0) {
      groups.push({ id: "", label: "Uncategorized", list: uncategorized });
    }
    return groups;
  }, [filtered, allCategories]);

  async function handleAdd() {
    const id = await saveFilling({
      name: "New filling",
      category: "",
      source: "",
      description: "",
      allergens: [],
      instructions: "",
    });
    router.push(`/fillings/${encodeURIComponent(String(id))}?new=1`);
  }

  const total = fillings.length;
  const byStatus = useMemo(() => {
    const m: Record<FillingStatus, number> = { confirmed: 0, testing: 0, "to-try": 0, unknown: 0 };
    for (const l of fillings) m[normalizeFillingStatus(l.status)]++;
    return m;
  }, [fillings]);

  return (
    <>
      <PageHeader
        title="Fillings"
        meta={`${total} fillings across ${allCategories.length} categor${allCategories.length === 1 ? "y" : "ies"} · ${byStatus.confirmed} confirmed, ${byStatus.testing} testing, ${byStatus["to-try"]} to try`}
        actions={
          <>
            <DsButton variant="default" size="md" onClick={onSwitchToCategories}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <IconCategory size={14} stroke={1.5} /> Categories
              </span>
            </DsButton>
            <DsButton variant="primary" size="md" onClick={handleAdd}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <IconPlus size={14} stroke={1.5} /> New filling
              </span>
            </DsButton>
          </>
        }
      />

      <div style={{ padding: "16px 32px 40px", display: "flex", flexDirection: "column", gap: 18 }}>
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
              value={f.search}
              onChange={(e) => setF("search", e.target.value)}
              placeholder="Search fillings…"
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

          <PillRow
            label="Status"
            options={STATUS_FILTERS.map((s) => ({ id: s.id, label: s.label }))}
            isActive={(id) => f.filterStatus === id}
            onSelect={(id) => setF("filterStatus", id as StatusFilter)}
          />
          {allCategories.length > 0 && (
            <PillRow
              label="Category"
              options={[
                { id: "", label: "All" },
                ...allCategories.map((c) => ({ id: c.name, label: c.name.split(" (")[0] })),
              ]}
              isActive={(id) => f.filterCategory === id}
              onSelect={(id) => setF("filterCategory", id)}
            />
          )}
        </div>

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
            {fillings.length === 0 ? "No fillings yet." : "No fillings match the filters."}
          </p>
        ) : (
          grouped.map((g) => (
            <CategorySection
              key={g.id || "uncategorised"}
              title={g.label}
              count={`${g.list.length} filling${g.list.length === 1 ? "" : "s"}`}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                  gap: 12,
                }}
              >
                {g.list.map((l) => {
                  const status = normalizeFillingStatus(l.status);
                  const usedIn = l.id ? usedInByFilling.get(l.id) ?? [] : [];
                  const aller = (l.allergens ?? []).filter(isRealAllergen);
                  return (
                    <FillingCard
                      key={l.id}
                      href={`/fillings/${encodeURIComponent(l.id ?? "")}`}
                      name={l.name}
                      status={status}
                      usedInProducts={usedIn}
                      allergens={aller}
                      archived={l.archived}
                    />
                  );
                })}
                <AddCard label={`new ${g.label.toLowerCase()}`} onClick={handleAdd} />
              </div>
            </CategorySection>
          ))
        )}
      </div>
    </>
  );
}

function PillRow({
  label,
  options,
  isActive,
  onSelect,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  isActive: (id: string) => boolean;
  onSelect: (id: string) => void;
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
        const active = isActive(o.id);
        return (
          <button
            key={o.id || "all"}
            type="button"
            onClick={() => onSelect(o.id)}
            style={{
              padding: "3px 10px",
              fontSize: 11,
              border: `0.5px solid ${active ? "var(--ds-tier-quarter-focus)" : "var(--ds-border-warm)"}`,
              background: active ? "var(--ds-tier-quarter-focus)" : "var(--ds-card-bg)",
              color: active ? "#ffffff" : "var(--ds-text-muted)",
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

function CategoriesTab({ onSwitchToFillings }: { onSwitchToFillings: () => void }) {
  const router = useRouter();
  const [f, setF] = usePersistedFilters("filling-categories", {
    search: "",
    showFilters: false,
    showArchived: false,
  });

  const categories = useFillingCategories(f.showArchived);
  const usageCounts = useFillingCategoryUsageCounts();
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newShelfStable, setNewShelfStable] = useState(false);
  useNShortcut(() => setShowAdd(true), showAdd);

  const filtered = useMemo(() => {
    const q = f.search.trim().toLowerCase();
    return categories.filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [categories, f.search]);

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!newName.trim()) return;
    const id = await saveFillingCategory({ name: newName.trim(), shelfStable: newShelfStable });
    setNewName("");
    setNewShelfStable(false);
    setShowAdd(false);
    router.push(`/fillings/categories/${encodeURIComponent(id)}?new=1`);
  }

  return (
    <>
      <PageHeader
        title="Filling categories"
        meta={`${categories.filter((c) => !c.archived).length} categories`}
        actions={
          <DsButton variant="default" size="md" onClick={onSwitchToFillings}>
            ← Back to fillings
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
              searchAriaLabel="Search filling categories"
              onAdd={() => setShowAdd(true)}
              addAriaLabel="Add filling category"
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
                  setNewShelfStable(false);
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
                      setNewShelfStable(false);
                    }
                  }}
                  placeholder="Category name…"
                  aria-label="Category name"
                  className="input w-full"
                  autoFocus
                  required
                />
                <label className="flex items-start gap-2 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newShelfStable}
                    onChange={(e) => setNewShelfStable(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">Shelf-stable</span>
                    <span className="block text-xs text-muted-foreground">
                      Production wizard asks for a batch multiplier instead of scaling to moulds.
                    </span>
                  </span>
                </label>
              </QuickAddForm>
            )}
            {filtered.length === 0 ? (
              <EmptyState
                hasData={categories.length > 0}
                emptyMessage="No filling categories yet."
                filteredMessage="No categories match."
              />
            ) : (
              <ul style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {filtered.map((c) => {
                  const usage = usageCounts.get(c.name) ?? 0;
                  return (
                    <ListItemCard
                      key={c.id}
                      href={`/fillings/categories/${encodeURIComponent(c.id!)}`}
                      archived={c.archived}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm truncate">{c.name}</span>
                          {c.shelfStable && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                              Shelf-stable
                            </span>
                          )}
                          {c.archived && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              Archived
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {usage === 0 ? "No fillings" : `${usage} filling${usage === 1 ? "" : "s"}`}
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
