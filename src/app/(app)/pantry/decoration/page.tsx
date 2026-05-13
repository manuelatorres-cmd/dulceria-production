"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useDecorationMaterials,
  saveDecorationMaterial,
  useDecorationMaterialUsageCounts,
  useDecorationCategories,
  useDecorationCategoryUsageCounts,
  saveDecorationCategory,
  useShellDesigns,
  saveShellDesign,
} from "@/lib/hooks";
import {
  PageHeader,
  CategorySection,
  DecoSwatch,
  AddCard,
  DsButton,
  Section,
  type DecoStockVariant,
} from "@/components/dulceria";
import {
  IconPlus,
  IconCategory,
  IconSearch,
  IconPalette,
} from "@tabler/icons-react";
import { usePersistedFilters } from "@/lib/use-persisted-filters";
import { useNShortcut } from "@/lib/use-n-shortcut";
import {
  ListToolbar,
  FilterPanel,
  ArchiveFilterChip,
  QuickAddForm,
  EmptyState,
  ListItemCard,
} from "@/components/pantry";
import Link from "next/link";
import { DECORATION_APPLY_AT_OPTIONS, normalizeApplyAt, type ShellDesignApplyAt } from "@/types";

function nameToColor(name: string): string {
  if (!name.trim()) return "#d4a017";
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

type Tab = "materials" | "categories" | "designs";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "materials", label: "Materials" },
  { id: "categories", label: "Categories" },
  { id: "designs", label: "Designs" },
];

type StockFilter = "all" | DecoStockVariant;

const STOCK_FILTERS: Array<{ id: StockFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "in", label: "In stock" },
  { id: "low", label: "Low" },
  { id: "out", label: "Out" },
  { id: "ordered", label: "Ordered" },
];

function getStock(m: { lowStock?: boolean; outOfStock?: boolean; lowStockOrdered?: boolean }): DecoStockVariant {
  if (m.outOfStock) return "out";
  if (m.lowStock && m.lowStockOrdered) return "ordered";
  if (m.lowStock) return "low";
  return "in";
}

export default function DecorationPage() {
  const [tab, setTab] = usePersistedFilters("decoration-tab", { activeTab: "materials" as Tab });

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <DecoTabHeader activeTab={tab.activeTab} onSelect={(t) => setTab("activeTab", t)} />
      {tab.activeTab === "materials" && <MaterialsTab />}
      {tab.activeTab === "categories" && <CategoriesTab />}
      {tab.activeTab === "designs" && <DesignsTab />}
    </div>
  );
}

function DecoTabHeader({ activeTab, onSelect }: { activeTab: Tab; onSelect: (t: Tab) => void }) {
  const materials = useDecorationMaterials(false);
  const categories = useDecorationCategories(false);
  const designs = useShellDesigns(false);
  const counts = {
    materials: materials.length,
    categories: categories.length,
    designs: designs.length,
  };

  return (
    <>
      <DecoPageHeader />
      <div
        style={{
          padding: "0 32px",
          borderBottom: "0.5px solid var(--ds-border-warm)",
          display: "flex",
          gap: 24,
        }}
      >
        {TABS.map((t) => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              style={{
                padding: "10px 0",
                background: "transparent",
                border: "none",
                borderBottom: active ? "2px solid var(--ds-tier-quarter-focus)" : "2px solid transparent",
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                color: active ? "var(--ds-text-primary)" : "var(--ds-text-muted)",
                cursor: "pointer",
              }}
            >
              {t.label} ({counts[t.id]})
            </button>
          );
        })}
      </div>
    </>
  );
}

function DecoPageHeader() {
  const router = useRouter();
  const materials = useDecorationMaterials(false);
  const categories = useDecorationCategories(false);
  const designs = useShellDesigns(false);

  // Approximate counts for lustre/transfer types via category slug heuristic.
  const lustreCount = useMemo(
    () =>
      materials.filter((m) => {
        const t = (m.type ?? "").toLowerCase();
        return t.includes("lustre") || t.includes("dust") || t.includes("pigment");
      }).length,
    [materials],
  );
  const sheetCount = useMemo(
    () =>
      materials.filter((m) => {
        const t = (m.type ?? "").toLowerCase();
        return t.includes("sheet") || t.includes("transfer");
      }).length,
    [materials],
  );
  const colorCount = materials.length - lustreCount - sheetCount;

  async function handleAddMaterial() {
    const defaultSlug = categories[0]?.slug ?? "cocoa_butter";
    const id = await saveDecorationMaterial({
      name: "New material",
      type: defaultSlug as never,
      color: nameToColor("new"),
    });
    router.push(`/pantry/decoration/${encodeURIComponent(id)}?new=1`);
  }

  return (
    <PageHeader
      title="Decoration"
      meta={`Manage your decoration materials, material categories, and shell design techniques · ${colorCount} colors, ${lustreCount} lustre dusts, ${sheetCount} transfer sheets · ${designs.length} designs`}
      actions={
        <DsButton variant="primary" size="md" onClick={handleAddMaterial}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <IconPlus size={14} stroke={1.5} /> New material
          </span>
        </DsButton>
      }
    />
  );
}

function MaterialsTab() {
  const router = useRouter();
  const [f, setF] = usePersistedFilters("decoration-v2", {
    search: "",
    filterType: "",
    filterStock: "all" as StockFilter,
    showArchived: false,
  });
  const materials = useDecorationMaterials(f.showArchived);
  const categories = useDecorationCategories();
  const usage = useDecorationMaterialUsageCounts();

  const labelBySlug = useMemo(
    () => new Map(categories.map((c) => [c.slug, c.name])),
    [categories],
  );

  const filtered = useMemo(() => {
    const q = f.search.trim().toLowerCase();
    return materials.filter((m) => {
      if (q && !m.name.toLowerCase().includes(q) && !(m.manufacturer ?? "").toLowerCase().includes(q)) return false;
      if (f.filterType && m.type !== f.filterType) return false;
      if (f.filterStock !== "all" && getStock(m) !== f.filterStock) return false;
      return true;
    });
  }, [materials, f.search, f.filterType, f.filterStock]);

  const grouped = useMemo(() => {
    const slugOrder = categories.map((c) => c.slug);
    const allSlugs = new Set(slugOrder);
    for (const m of filtered) {
      if (!allSlugs.has(m.type)) {
        slugOrder.push(m.type);
        allSlugs.add(m.type);
      }
    }
    return slugOrder
      .map((slug) => ({
        slug,
        label: labelBySlug.get(slug) ?? slug,
        list: filtered.filter((m) => m.type === slug),
      }))
      .filter((g) => g.list.length > 0);
  }, [filtered, categories, labelBySlug]);

  async function handleAdd() {
    const defaultSlug = categories[0]?.slug ?? "cocoa_butter";
    const id = await saveDecorationMaterial({
      name: "New material",
      type: defaultSlug as never,
      color: nameToColor("new"),
    });
    router.push(`/pantry/decoration/${encodeURIComponent(id)}?new=1`);
  }

  return (
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
            placeholder="Search materials…"
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
          label="Stock"
          options={STOCK_FILTERS.map((s) => ({ id: s.id, label: s.label }))}
          isActive={(id) => f.filterStock === id}
          onSelect={(id) => setF("filterStock", id as StockFilter)}
        />
        {categories.length > 0 && (
          <PillRow
            label="Type"
            options={[
              { id: "", label: "All" },
              ...categories.map((c) => ({ id: c.slug, label: c.name })),
            ]}
            isActive={(id) => f.filterType === id}
            onSelect={(id) => setF("filterType", id)}
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
          {materials.length === 0 ? "No materials yet." : "No materials match the filters."}
        </p>
      ) : (
        grouped.map((g) => (
          <CategorySection
            key={g.slug}
            title={g.label}
            count={`${g.list.length} item${g.list.length === 1 ? "" : "s"}`}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                gap: 10,
              }}
            >
              {g.list.map((m) => {
                const stock = getStock(m);
                const productCount = usage.get(m.id!) ?? 0;
                return (
                  <DecoSwatch
                    key={m.id}
                    href={`/pantry/decoration/${encodeURIComponent(m.id ?? "")}`}
                    name={m.name}
                    brand={m.manufacturer}
                    productCount={productCount}
                    colorHex={m.color}
                    type={g.label}
                    stockVariant={stock}
                    archived={m.archived}
                  />
                );
              })}
              <AddCard label="new color" onClick={handleAdd} aspect="swatch" />
            </div>
          </CategorySection>
        ))
      )}
    </div>
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

function CategoriesTab() {
  const router = useRouter();
  const [f, setF] = usePersistedFilters("decoration-categories", {
    search: "",
    showFilters: false,
    showArchived: false,
  });
  const categories = useDecorationCategories(f.showArchived);
  const usageCounts = useDecorationCategoryUsageCounts();
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
    const slug = newName.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    const id = await saveDecorationCategory({ name: newName.trim(), slug });
    setNewName("");
    setShowAdd(false);
    router.push(`/pantry/decoration/categories/${encodeURIComponent(id)}?new=1`);
  }

  return (
    <div style={{ padding: "16px 32px 40px" }}>
      <Section
        title="Material categories"
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
            searchAriaLabel="Search decoration categories"
            onAdd={() => setShowAdd(true)}
            addAriaLabel="Add decoration category"
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
              <ArchiveFilterChip value={f.showArchived} onChange={(v) => setF("showArchived", v)} />
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
              emptyMessage="No categories yet."
              filteredMessage="No categories match."
            />
          ) : (
            <ul style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {filtered.map((c) => {
                const usage = usageCounts.get(c.slug) ?? 0;
                return (
                  <ListItemCard
                    key={c.id}
                    href={`/pantry/decoration/categories/${encodeURIComponent(c.id!)}`}
                    archived={c.archived}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm truncate">{c.name}</span>
                        {c.archived && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            Archived
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {usage === 0 ? "No materials" : `${usage} material${usage === 1 ? "" : "s"}`}
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
  );
}

function DesignsTab() {
  const router = useRouter();
  const [f, setF] = usePersistedFilters("decoration-designs", {
    search: "",
    showFilters: false,
    showArchived: false,
  });
  const designs = useShellDesigns(f.showArchived);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newApplyAt, setNewApplyAt] = useState<ShellDesignApplyAt>("colour");
  useNShortcut(() => setShowAdd(true), showAdd);

  const filtered = useMemo(() => {
    const q = f.search.trim().toLowerCase();
    return designs.filter((d) => !q || d.name.toLowerCase().includes(q));
  }, [designs, f.search]);

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!newName.trim()) return;
    const id = await saveShellDesign({ name: newName.trim(), defaultApplyAt: newApplyAt });
    setNewName("");
    setNewApplyAt("on_mould");
    setShowAdd(false);
    router.push(`/pantry/decoration/designs/${encodeURIComponent(id)}?new=1`);
  }

  return (
    <div style={{ padding: "16px 32px 40px" }}>
      <Section
        title="Shell designs"
        action={
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            style={{ fontSize: 12, color: "var(--ds-tier-quarter-focus)", fontWeight: 500 }}
          >
            + new design
          </button>
        }
      >
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <ListToolbar
            search={f.search}
            onSearchChange={(v) => setF("search", v)}
            searchPlaceholder="Search designs…"
            searchAriaLabel="Search shell designs"
            onAdd={() => setShowAdd(true)}
            addAriaLabel="Add shell design"
            addTitle="Add design (n)"
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
              <ArchiveFilterChip value={f.showArchived} onChange={(v) => setF("showArchived", v)} />
            </FilterPanel>
          )}
          {showAdd && (
            <QuickAddForm
              onSubmit={handleAdd}
              onCancel={() => {
                setShowAdd(false);
                setNewName("");
                setNewApplyAt("colour");
              }}
              submitLabel="Create design"
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
                    setNewApplyAt("colour");
                  }
                }}
                placeholder="Design name…"
                aria-label="Design name"
                className="input w-full"
                autoFocus
                required
              />
              <select
                value={newApplyAt}
                onChange={(e) => setNewApplyAt(e.target.value as ShellDesignApplyAt)}
                className="input w-full"
                aria-label="Production step"
              >
                {DECORATION_APPLY_AT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </QuickAddForm>
          )}
          {filtered.length === 0 ? (
            <EmptyState
              hasData={designs.length > 0}
              emptyMessage="No designs yet."
              filteredMessage="No designs match."
            />
          ) : (
            <ul style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {filtered.map((d) => {
                const label =
                  DECORATION_APPLY_AT_OPTIONS.find((o) => o.value === normalizeApplyAt(d.defaultApplyAt))?.label ??
                  "Colour";
                return (
                  <ListItemCard
                    key={d.id}
                    href={`/pantry/decoration/designs/${encodeURIComponent(d.id!)}`}
                    archived={d.archived}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm truncate">{d.name}</span>
                        {d.archived && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            Archived
                          </span>
                        )}
                        <span className="text-[11px] text-muted-foreground bg-muted/60 rounded px-1.5 py-0.5 shrink-0">
                          {label}
                        </span>
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
  );
}
