"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useIngredients,
  saveIngredient,
  setIngredientLowStock,
  useIngredientCategories,
  useIngredientCategoryUsageCounts,
  saveIngredientCategory,
  useIngredientCategoryNames,
  useAllIngredientStock,
  adjustIngredientStock,
} from "@/lib/hooks";
import {
  PageHeader,
  CategorySection,
  DsButton,
  Section,
} from "@/components/dulceria";
import {
  IconPlus,
  IconCategory,
  IconSearch,
  IconFileImport,
  IconAlertTriangle,
  IconCheck,
  IconPackage,
  IconMinus,
} from "@tabler/icons-react";
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
import type { Ingredient } from "@/types";
import Link from "next/link";

type Tab = "ingredients" | "stock" | "categories";

const TABS: Array<{ id: Tab; label: string }> = [
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
  const [tab, setTab] = usePersistedFilters("ingredients-tab", { activeTab: "ingredients" as Tab });
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");

  useEffect(() => {
    if (tabParam === "ingredients" || tabParam === "stock" || tabParam === "categories") {
      if (tab.activeTab !== tabParam) setTab("activeTab", tabParam);
    }
  }, [tabParam]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      {tab.activeTab === "ingredients" && <IngredientsTab onTab={setTab} />}
      {tab.activeTab === "stock" && <StockTab onTab={setTab} />}
      {tab.activeTab === "categories" && <CategoriesTab onTab={setTab} />}
    </div>
  );
}

type SetTab = (key: "activeTab", val: Tab) => void;

type StockFilter = "all" | "in" | "low" | "out" | "ordered";

const STOCK_FILTERS: Array<{ id: StockFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "in", label: "In stock" },
  { id: "low", label: "Low" },
  { id: "out", label: "Out" },
  { id: "ordered", label: "Ordered" },
];

function hasComposition(ing: Ingredient): boolean {
  return (
    (ing.cacaoFat ?? 0) +
      (ing.sugar ?? 0) +
      (ing.milkFat ?? 0) +
      (ing.water ?? 0) +
      (ing.solids ?? 0) +
      (ing.otherFats ?? 0) +
      (ing.alcohol ?? 0) >
    0
  );
}

function getStockStatus(ing: {
  lowStock?: boolean;
  lowStockOrdered?: boolean;
  outOfStock?: boolean;
}): "in" | "low" | "out" | "ordered" {
  if (ing.outOfStock) return "out";
  if (ing.lowStock && ing.lowStockOrdered) return "ordered";
  if (ing.lowStock) return "low";
  return "in";
}

const STOCK_TINT: Record<"in" | "low" | "out" | "ordered", { bg: string; color: string; text: string }> = {
  in: { bg: "var(--ds-tint-ok)", color: "var(--ds-tier-positive)", text: "in stock" },
  low: { bg: "var(--ds-tint-warn)", color: "var(--ds-semantic-warn)", text: "low · order" },
  out: { bg: "var(--ds-tint-critical)", color: "var(--ds-tier-urgent)", text: "out" },
  ordered: { bg: "var(--ds-tint-info)", color: "var(--ds-tier-quarter-focus)", text: "ordered" },
};

function formatDate(iso?: Date | string): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
}

function IngredientsTab({ onTab }: { onTab: SetTab }) {
  const router = useRouter();
  const [f, setF] = usePersistedFilters("ingredients-v2", {
    search: "",
    filterStock: "all" as StockFilter,
    filterCategory: "",
    showArchived: false,
  });

  const ingredients = useIngredients(f.showArchived);
  const categoryNames = useIngredientCategoryNames();

  const filtered = useMemo(() => {
    const q = f.search.trim().toLowerCase();
    return ingredients.filter((i) => {
      if (q && !i.name.toLowerCase().includes(q) && !(i.manufacturer ?? "").toLowerCase().includes(q)) return false;
      if (f.filterStock !== "all" && getStockStatus(i) !== f.filterStock) return false;
      if (f.filterCategory && (i.category || "Uncategorised") !== f.filterCategory) return false;
      return true;
    });
  }, [ingredients, f.search, f.filterStock, f.filterCategory]);

  const grouped = useMemo(() => {
    const order = ["Uncategorised", ...categoryNames];
    const m = new Map<string, typeof filtered>();
    for (const i of filtered) {
      const key = i.category || "Uncategorised";
      const arr = m.get(key) ?? [];
      arr.push(i);
      m.set(key, arr);
    }
    const groups: Array<{ id: string; label: string; list: typeof filtered }> = [];
    for (const cat of order) {
      const arr = m.get(cat);
      if (arr && arr.length > 0) groups.push({ id: cat, label: cat, list: arr });
    }
    for (const [k, arr] of m) {
      if (!order.includes(k)) groups.push({ id: k, label: k, list: arr });
    }
    return groups;
  }, [filtered, categoryNames]);

  const total = ingredients.length;
  const shortCount = ingredients.filter((i) => i.lowStock || i.outOfStock).length;
  const missingComposition = ingredients.filter((i) => !hasComposition(i)).length;

  async function handleAdd() {
    const id = await saveIngredient({
      name: "New ingredient",
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

  return (
    <>
      <PageHeader
        title="Ingredients"
        meta={`${total} ingredients · ${shortCount} short · ${missingComposition} missing composition`}
        actions={
          <>
            <DsButton variant="default" size="md" onClick={() => onTab("activeTab", "categories")}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <IconCategory size={14} stroke={1.5} /> Categories
              </span>
            </DsButton>
            <DsButton variant="default" size="md" onClick={() => onTab("activeTab", "stock")}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <IconPackage size={14} stroke={1.5} /> Stock
              </span>
            </DsButton>
            <DsButton variant="default" size="md" onClick={() => router.push("/imports")}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <IconFileImport size={14} stroke={1.5} /> Import composition
              </span>
            </DsButton>
            <DsButton variant="primary" size="md" onClick={handleAdd}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <IconPlus size={14} stroke={1.5} /> New ingredient
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
              placeholder="Search ingredients…"
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
          {categoryNames.length > 0 && (
            <PillRow
              label="Category"
              options={[
                { id: "", label: "All" },
                { id: "Uncategorised", label: "Uncategorised" },
                ...categoryNames.map((c) => ({ id: c, label: c })),
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
            {ingredients.length === 0 ? "No ingredients yet." : "No ingredients match the filters."}
          </p>
        ) : (
          grouped.map((g) => {
            const shortHere = g.list.filter((i) => i.lowStock || i.outOfStock).length;
            return (
              <CategorySection
                key={g.id}
                title={g.label}
                count={`${g.list.length} ingredient${g.list.length === 1 ? "" : "s"}${
                  shortHere > 0 ? ` · ${shortHere} short` : ""
                }`}
              >
                <IngredientTable list={g.list} />
              </CategorySection>
            );
          })
        )}
      </div>
    </>
  );
}

function IngredientTable({ list }: { list: Ingredient[] }) {
  return (
    <div
      style={{
        background: "var(--ds-card-bg)",
        border: "0.5px solid var(--ds-border-warm)",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "280px minmax(0, 1fr) 120px 120px 110px",
          gap: 0,
          padding: "8px 12px",
          background: "var(--ds-card-bg-hover)",
          borderBottom: "0.5px solid var(--ds-border-warm)",
          fontSize: 9,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--ds-text-muted)",
          fontWeight: 600,
        }}
      >
        <span>Ingredient</span>
        <span>Supplier · composition</span>
        <span>Last updated</span>
        <span>Stock</span>
        <span style={{ textAlign: "right" }}>Action</span>
      </div>
      <ul style={{ display: "flex", flexDirection: "column" }}>
        {list.map((ing) => (
          <IngredientRow key={ing.id} ing={ing} />
        ))}
      </ul>
    </div>
  );
}

function IngredientRow({ ing }: { ing: Ingredient }) {
  const stock = getStockStatus(ing);
  const tint = STOCK_TINT[stock];
  const composition = hasComposition(ing);
  const accent =
    stock === "out"
      ? "var(--ds-tier-urgent)"
      : stock === "low"
      ? "var(--ds-semantic-warn)"
      : "transparent";

  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "280px minmax(0, 1fr) 120px 120px 110px",
        gap: 0,
        alignItems: "center",
        padding: "10px 12px",
        borderBottom: "0.5px solid var(--ds-border-warm)",
        borderLeft: `2px solid ${accent}`,
      }}
    >
      <Link
        href={`/ingredients/${encodeURIComponent(ing.id ?? "")}`}
        style={{ minWidth: 0, color: "var(--ds-text-primary)", textDecoration: "none" }}
      >
        <strong style={{ fontSize: 13, fontWeight: 500, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {ing.name}
          {ing.archived && (
            <span style={{ marginLeft: 6, fontSize: 9, color: "var(--ds-text-muted)", fontWeight: 400 }}>
              archived
            </span>
          )}
        </strong>
        {ing.commercialName && (
          <span
            style={{
              fontSize: 11,
              color: "var(--ds-text-muted)",
              fontStyle: "italic",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              display: "block",
            }}
          >
            {ing.commercialName}
          </span>
        )}
      </Link>
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span
          style={{
            fontSize: 11,
            color: "var(--ds-text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {ing.manufacturer || "—"}
        </span>
        <span style={{ fontSize: 10, display: "inline-flex", alignItems: "center", gap: 4 }}>
          {composition ? (
            <>
              <IconCheck size={10} stroke={2} style={{ color: "var(--ds-tier-positive)" }} />
              <span style={{ color: "var(--ds-tier-positive)" }}>composition complete</span>
            </>
          ) : (
            <>
              <IconAlertTriangle size={10} stroke={2} style={{ color: "var(--ds-semantic-warn)" }} />
              <span style={{ color: "var(--ds-semantic-warn)" }}>no composition — add data</span>
            </>
          )}
        </span>
      </div>
      <span style={{ fontSize: 11, color: "var(--ds-text-muted)", fontVariantNumeric: "tabular-nums" }}>
        {formatDate(ing.updatedAt)}
      </span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          padding: "3px 8px",
          borderRadius: 3,
          background: tint.bg,
          color: tint.color,
          width: "fit-content",
        }}
      >
        {tint.text}
      </span>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Link
          href={`/ingredients/${encodeURIComponent(ing.id ?? "")}`}
          style={{
            fontSize: 11,
            padding: "3px 8px",
            border: "0.5px solid var(--ds-border-warm)",
            borderRadius: 4,
            background: "var(--ds-card-bg)",
            color: "var(--ds-text-muted)",
            textDecoration: "none",
          }}
        >
          edit
        </Link>
      </div>
    </li>
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

// ─── Stock tab (preserved from legacy) ───────────────────────────────────────

type StockTabFilter = "all" | "low" | "zero";

function StockTab({ onTab }: { onTab: SetTab }) {
  const ingredients = useIngredients(false);
  const stockRows = useAllIngredientStock();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StockTabFilter>("all");

  const stockByIngredient = useMemo(() => {
    const m = new Map<string, (typeof stockRows)[number]>();
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
          qty <= 0 ? "zero" : threshold != null && qty < threshold ? "low" : "ok";
        return { ing, qty, threshold, level };
      })
      .filter((r) => {
        if (filter === "low") return r.level === "low" || r.level === "zero";
        if (filter === "zero") return r.level === "zero";
        return true;
      })
      .sort((a, b) => {
        const score: Record<typeof a.level, number> = { zero: 0, low: 1, ok: 2 };
        if (score[a.level] !== score[b.level]) return score[a.level] - score[b.level];
        return a.ing.name.localeCompare(b.ing.name);
      });
  }, [ingredients, stockByIngredient, search, filter]);

  const lowCount = rows.filter((r) => r.level === "low" || r.level === "zero").length;

  return (
    <>
      <PageHeader
        title="Ingredient stock"
        meta={`${rows.length} tracked · ${lowCount} low or out`}
        actions={
          <DsButton variant="default" size="md" onClick={() => onTab("activeTab", "ingredients")}>
            ← Back to ingredients
          </DsButton>
        }
      />
      <div style={{ padding: "16px 32px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              border: "0.5px solid var(--ds-border-warm)",
              background: "var(--ds-card-bg)",
              borderRadius: 14,
              minWidth: 240,
            }}
          >
            <IconSearch size={13} stroke={1.5} style={{ color: "var(--ds-text-muted)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ingredients"
              style={{ fontSize: 12, border: "none", background: "transparent", outline: "none", flex: 1 }}
            />
          </div>
          <PillRow
            label="Filter"
            options={[
              { id: "all", label: "All" },
              { id: "low", label: `Low / out (${lowCount})` },
              { id: "zero", label: "Out only" },
            ]}
            isActive={(id) => filter === id}
            onSelect={(id) => setFilter(id as StockTabFilter)}
          />
        </div>
        {rows.length === 0 ? (
          <p style={{ textAlign: "center", padding: "32px 0", color: "var(--ds-text-muted)", fontSize: 13 }}>
            {search ? "No matches." : "No ingredients tracked."}
          </p>
        ) : (
          <ul
            style={{
              background: "var(--ds-card-bg)",
              border: "0.5px solid var(--ds-border-warm)",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            {rows.map((r) => (
              <StockRow key={r.ing.id} ingredientId={r.ing.id!} name={r.ing.name} qty={r.qty} threshold={r.threshold} level={r.level} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function StockRow({
  ingredientId,
  name,
  qty,
  threshold,
  level,
}: {
  ingredientId: string;
  name: string;
  qty: number;
  threshold: number | null;
  level: "zero" | "low" | "ok";
}) {
  const [open, setOpen] = useState<null | "receive" | "waste" | "recount">(null);
  const [input, setInput] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  function close() {
    setOpen(null);
    setInput("");
    setNotes("");
  }

  async function handleSubmit() {
    const n = parseFloat(input);
    if (!Number.isFinite(n)) return;
    setSaving(true);
    try {
      if (open === "receive") {
        await adjustIngredientStock({ ingredientId, deltaG: n, reason: "receive", notes: notes || undefined });
      } else if (open === "waste") {
        await adjustIngredientStock({ ingredientId, deltaG: -Math.abs(n), reason: "waste", notes: notes || undefined });
      } else if (open === "recount") {
        await adjustIngredientStock({ ingredientId, deltaG: n - qty, reason: "recount", notes: notes || undefined });
      }
      close();
    } finally {
      setSaving(false);
    }
  }

  const levelTint =
    level === "zero"
      ? { bg: "var(--ds-tint-critical)", color: "var(--ds-tier-urgent)", text: "out" }
      : level === "low"
      ? { bg: "var(--ds-tint-warn)", color: "var(--ds-semantic-warn)", text: "low" }
      : { bg: "var(--ds-tint-ok)", color: "var(--ds-tier-positive)", text: "ok" };

  return (
    <li style={{ padding: "10px 14px", borderBottom: "0.5px solid var(--ds-border-warm)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Link
          href={`/ingredients/${encodeURIComponent(ingredientId)}`}
          style={{ flex: 1, minWidth: 0, color: "var(--ds-text-primary)", textDecoration: "none" }}
        >
          <p style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {name}
          </p>
          <p style={{ fontSize: 10, color: "var(--ds-text-muted)" }}>
            {threshold != null ? `threshold ${formatGrams(threshold)}` : "no threshold"}
          </p>
        </Link>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: "uppercase",
            padding: "3px 8px",
            borderRadius: 3,
            background: levelTint.bg,
            color: levelTint.color,
          }}
        >
          {levelTint.text}
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            width: 84,
            textAlign: "right",
          }}
        >
          {formatGrams(qty)}
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          <RowBtn onClick={() => setOpen(open === "receive" ? null : "receive")} title="Receive">
            <IconPlus size={11} stroke={1.5} /> Receive
          </RowBtn>
          <RowBtn onClick={() => setOpen(open === "recount" ? null : "recount")} title="Recount">
            Recount
          </RowBtn>
          <RowBtn onClick={() => setOpen(open === "waste" ? null : "waste")} title="Waste">
            <IconMinus size={11} stroke={1.5} /> Waste
          </RowBtn>
        </div>
      </div>
      {open && (
        <div
          style={{
            marginTop: 8,
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "end",
            padding: 8,
            border: "0.5px solid var(--ds-border-warm)",
            background: "var(--ds-card-bg-hover)",
            borderRadius: 6,
          }}
        >
          <Field label={open === "recount" ? "New total (g)" : open === "receive" ? "Amount (g)" : "Waste (g)"}>
            <input
              type="number"
              step="1"
              min="0"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="input"
              style={{ width: 100 }}
              autoFocus
            />
          </Field>
          <Field label="Notes (optional)" flex>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={open === "receive" ? "supplier / batch" : open === "waste" ? "reason" : "physical count"}
              className="input"
            />
          </Field>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={handleSubmit}
              disabled={saving || !input}
              style={{
                padding: "5px 12px",
                fontSize: 11,
                fontWeight: 500,
                background: "var(--ds-tier-quarter-focus)",
                color: "#ffffff",
                border: "none",
                borderRadius: 4,
                opacity: saving || !input ? 0.5 : 1,
              }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={close}
              style={{
                padding: "5px 12px",
                fontSize: 11,
                background: "transparent",
                border: "0.5px solid var(--ds-border-warm)",
                borderRadius: 4,
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function RowBtn({ onClick, title, children }: { onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "3px 8px",
        fontSize: 11,
        border: "0.5px solid var(--ds-border-warm)",
        borderRadius: 4,
        background: "var(--ds-card-bg)",
        color: "var(--ds-text-primary)",
      }}
    >
      {children}
    </button>
  );
}

function Field({ label, children, flex }: { label: string; children: React.ReactNode; flex?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: flex ? 1 : undefined, minWidth: flex ? 160 : undefined }}>
      <label
        style={{
          fontSize: 9,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--ds-text-muted)",
          fontWeight: 600,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function formatGrams(g: number): string {
  if (g >= 1000) return `${(g / 1000).toFixed(g >= 10_000 ? 1 : 2)} kg`;
  return `${Math.round(g)} g`;
}

// ─── Categories tab ──────────────────────────────────────────────────────────

function CategoriesTab({ onTab }: { onTab: SetTab }) {
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

  const filtered = useMemo(() => {
    const q = f.search.trim().toLowerCase();
    return categories.filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [categories, f.search]);

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!newName.trim()) return;
    const id = await saveIngredientCategory({ name: newName.trim() });
    setNewName("");
    setShowAdd(false);
    router.push(`/ingredients/categories/${encodeURIComponent(id)}?new=1`);
  }

  return (
    <>
      <PageHeader
        title="Ingredient categories"
        meta={`${categories.filter((c) => !c.archived).length} categories`}
        actions={
          <DsButton variant="default" size="md" onClick={() => onTab("activeTab", "ingredients")}>
            ← Back to ingredients
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
              searchAriaLabel="Search ingredient categories"
              onAdd={() => setShowAdd(true)}
              addAriaLabel="Add ingredient category"
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
                emptyMessage="No ingredient categories yet."
                filteredMessage="No categories match."
              />
            ) : (
              <ul style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
                            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              Archived
                            </span>
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
        </Section>
      </div>
    </>
  );
}
