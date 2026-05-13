"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/dulceria";
import {
  useProductsList, useFillings, usePackagingList, useIngredients,
  useVariants, useAllVariantPackagings,
  useStockAdjustments, applyStockAdjustments,
  useProductLocationTotals,
  useFillingStockItems,
  useProductCategories,
} from "@/lib/hooks";
import {
  STOCK_ADJUSTMENT_REASONS, STOCK_ADJUSTMENT_REASON_LABELS,
  STOCK_LOCATIONS, STOCK_LOCATION_LABELS,
  type StockAdjustmentItemType, type StockAdjustmentReason,
  type StockLocation,
} from "@/types";
import { IconArrowLeft as ArrowLeft, IconDeviceFloppy as Save, IconCircleCheck as CheckCircle, IconAlertTriangle as AlertTriangle, IconSearch as Search, IconX as X } from "@tabler/icons-react";

/**
 * Stock adjustment — bulk-list flavour.
 *
 * Top settings: Type · Location · Reason · Note. Common to every row
 * the operator enters in this batch.
 *
 * Below: searchable, alphabetical list of items matching the type.
 * Tag chips for products / label chips for variants narrow the list.
 * Each row shows current stock and a delta input. Save applies every
 * non-zero row using the common settings.
 *
 * "Finished product" type folds variants in alongside products so
 * pre-assembled boxes (e.g. Mother's Day editions) live in the same
 * list — each row tags itself as Product or Box.
 */

type UiType = "product" | "variant" | "filling" | "packaging" | "ingredient";

const UI_TYPE_LABELS: Record<UiType, string> = {
  product:    "Finished product",
  variant:    "Box / variant",
  filling:    "Filling",
  packaging:  "Packaging",
  ingredient: "Ingredient",
};

interface Row {
  id: string;             // product/variantPackaging/filling/packaging/ingredient id
  itemType: StockAdjustmentItemType; // backend item type
  name: string;
  current: number;        // currently on hand at the chosen location
  unit: string;           // "pcs" / "g" / "units"
  tags: string[];         // products: tags · variants: labels · others: []
  isVariant: boolean;
}

export default function StockAdjustPage() {
  const router = useRouter();
  const products = useProductsList(true);
  const variants = useVariants();
  const variantPackagings = useAllVariantPackagings();
  const fillings = useFillings(true);
  const packaging = usePackagingList(true);
  const ingredients = useIngredients(true);
  const productCategories = useProductCategories(true);
  const recent = useStockAdjustments({ limit: 15 });
  const productTotals = useProductLocationTotals();
  const fillingStockItems = useFillingStockItems();

  // ── top settings ──
  const [uiType, setUiType] = useState<UiType>("product");
  const [location, setLocation] = useState<StockLocation>("store");
  const [reason, setReason] = useState<StockAdjustmentReason>("opening_balance");
  const [note, setNote] = useState("");

  // ── per-row state ──
  const [search, setSearch] = useState("");
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [deltas, setDeltas] = useState<Record<string, string>>({});

  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ applied: number; total: number; error?: string } | null>(null);

  // Build the list of rows for the active uiType.
  const categoryNameById = useMemo(
    () => new Map(productCategories.map((c) => [c.id!, c.name])),
    [productCategories],
  );
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    if (uiType === "product") {
      // Products only — variant boxes live under their own type now.
      for (const p of products) {
        if (p.archived || !p.id) continue;
        const t = productTotals.get(p.id);
        const current = t?.[location] ?? 0;
        // Category folds into the chip pool so filtering by "moulded"
        // catches every product in that category, not just the ones
        // explicitly tagged. Same lower-case key space as tags.
        const explicitTags = (p.tags ?? []).map((s) => s.toLowerCase().trim()).filter(Boolean);
        const catName = p.productCategoryId
          ? categoryNameById.get(p.productCategoryId)?.toLowerCase().trim()
          : undefined;
        const tags = catName ? [...new Set([...explicitTags, catName])] : explicitTags;
        out.push({
          id: p.id,
          itemType: "product",
          name: p.name,
          current,
          unit: "pcs",
          tags,
          isVariant: false,
        });
      }
    } else if (uiType === "variant") {
      const variantById = new Map(variants.map((v) => [v.id!, v]));
      const packagingMap = new Map(packaging.map((pk) => [pk.id!, pk]));
      for (const vp of variantPackagings) {
        if (!vp.id) continue;
        const v = variantById.get(vp.variantId);
        if (!v) continue;
        const sizeName = vp.packagingId
          ? packagingMap.get(vp.packagingId)?.name ?? "size"
          : "loose";
        out.push({
          id: vp.id,
          itemType: "variant",
          name: `${v.name} · ${sizeName}`,
          current: vp.quantityOnHand ?? 0,
          unit: "boxes",
          tags: (v.labels ?? []).map((s) => s.toLowerCase().trim()).filter(Boolean),
          isVariant: true,
        });
      }
    } else if (uiType === "filling") {
      // Sum remaining grams per filling.
      const sumByFilling = new Map<string, number>();
      for (const fs of fillingStockItems) {
        sumByFilling.set(fs.fillingId, (sumByFilling.get(fs.fillingId) ?? 0) + Number(fs.remainingG ?? 0));
      }
      for (const f of fillings) {
        if (f.archived || f.supersededAt || !f.id) continue;
        out.push({
          id: f.id,
          itemType: "filling",
          name: f.name,
          current: Math.round(sumByFilling.get(f.id) ?? 0),
          unit: "g",
          tags: [],
          isVariant: false,
        });
      }
    } else if (uiType === "packaging") {
      for (const p of packaging) {
        if (p.archived || !p.id) continue;
        out.push({
          id: p.id,
          itemType: "packaging",
          name: p.name,
          current: p.quantityOnHand ?? 0,
          unit: "units",
          tags: [],
          isVariant: false,
        });
      }
    } else if (uiType === "ingredient") {
      for (const i of ingredients) {
        if (i.archived || !i.id) continue;
        out.push({
          id: i.id,
          itemType: "ingredient",
          name: i.name,
          current: Math.round(Number(i.currentStockG ?? 0)),
          unit: "g",
          tags: [],
          isVariant: false,
        });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [uiType, location, products, variants, variantPackagings, packaging, fillings, fillingStockItems, ingredients, productTotals, categoryNameById]);

  // Pool of available tags / labels for the current type.
  const knownTags = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) for (const t of r.tags) {
      const key = t.trim();
      if (key && !seen.has(key)) seen.set(key, key);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  function toggleTag(tag: string) {
    const next = new Set(activeTags);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    setActiveTags(next);
  }

  // Apply search + tag filters.
  const visibleRows = useMemo(() => {
    const q = search.toLowerCase().trim();
    return rows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q)) return false;
      if (activeTags.size > 0) {
        const hit = r.tags.some((t) => activeTags.has(t));
        if (!hit) return false;
      }
      return true;
    });
  }, [rows, search, activeTags]);

  // Reset state when the type switches — different list, different ids.
  function changeType(t: UiType) {
    setUiType(t);
    setActiveTags(new Set());
    setSearch("");
    setDeltas({});
  }

  // Count of non-zero entered deltas in the visible set.
  const enteredCount = useMemo(() => {
    let n = 0;
    for (const r of rows) {
      const raw = deltas[r.id];
      if (raw == null || raw === "") continue;
      const parsed = parseFloat(raw);
      if (Number.isFinite(parsed) && parsed !== 0) n++;
    }
    return n;
  }, [deltas, rows]);

  async function handleSave() {
    if (enteredCount === 0 || saving) return;
    setSaving(true);
    setResult(null);
    try {
      const inputs = rows
        .map((r) => {
          const raw = deltas[r.id];
          if (raw == null || raw === "") return null;
          const parsed = parseFloat(raw);
          if (!Number.isFinite(parsed) || parsed === 0) return null;
          return {
            itemType: r.itemType,
            itemId: r.id,
            location: r.itemType === "product" ? location : undefined,
            deltaQty: parsed,
            reason,
            note: note.trim() || undefined,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x != null);
      const outcome = await applyStockAdjustments(inputs);
      if (outcome.failed) {
        const err = outcome.error as { message?: string; code?: string } | undefined;
        const code = err?.code ? ` (code ${err.code})` : "";
        setResult({
          applied: outcome.applied,
          total: inputs.length,
          error: `Stopped at row ${outcome.applied + 1}: ${err?.message ?? "unknown error"}${code}`,
        });
      } else {
        setResult({ applied: outcome.applied, total: inputs.length });
        setDeltas({});
      }
    } finally {
      setSaving(false);
    }
  }

  const showLocation = uiType === "product"; // location only meaningful for products

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader title="Stock adjustment" meta="Bulk-enter opening balances, recounts, breakage · one audit log" />
      <div className="px-4 pb-10 space-y-4">
        <button onClick={() => router.back()} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>

        {/* Common settings */}
        <section className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="label">Type</label>
              <select
                value={uiType}
                onChange={(e) => changeType(e.target.value as UiType)}
                className="input text-sm"
              >
                {(["product", "variant", "filling", "packaging", "ingredient"] as UiType[]).map((t) => (
                  <option key={t} value={t}>{UI_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            {showLocation && (
              <div>
                <label className="label">Location</label>
                <select
                  value={location}
                  onChange={(e) => setLocation(e.target.value as StockLocation)}
                  className="input text-sm"
                >
                  {STOCK_LOCATIONS.filter((l) => l !== "allocated").map((l) => (
                    <option key={l} value={l}>{STOCK_LOCATION_LABELS[l]}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="label">Reason</label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value as StockAdjustmentReason)}
                className="input text-sm"
              >
                {STOCK_ADJUSTMENT_REASONS.map((r) => (
                  <option key={r} value={r}>{STOCK_ADJUSTMENT_REASON_LABELS[r]}</option>
                ))}
              </select>
            </div>
            <div className={showLocation ? "" : "sm:col-span-2"}>
              <label className="label">Note (optional)</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. opening balance Mon morning"
                className="input text-sm"
              />
            </div>
          </div>
        </section>

        {/* Search + tag/label filters */}
        <section className="space-y-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${UI_TYPE_LABELS[uiType].toLowerCase()}…`}
              className="input pl-9"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          {knownTags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground font-medium mr-1">
                {uiType === "product" ? "Tags / Labels" : "Tags"}
              </span>
              {knownTags.map((tag) => {
                const active = activeTags.has(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors capitalize ${
                      active
                        ? "bg-accent text-accent-foreground"
                        : "bg-card text-muted-foreground border border-[color:var(--ds-border-warm)] hover:bg-muted"
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
              {activeTags.size > 0 && (
                <button
                  onClick={() => setActiveTags(new Set())}
                  className="text-[11px] text-muted-foreground hover:text-foreground underline"
                >
                  Clear
                </button>
              )}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            {visibleRows.length} item{visibleRows.length === 1 ? "" : "s"} shown
            {enteredCount > 0 && ` · ${enteredCount} pending adjustment${enteredCount === 1 ? "" : "s"}`}
            {showLocation && ` · current shown for ${STOCK_LOCATION_LABELS[location].toLowerCase()}`}
          </p>
        </section>

        {/* Item list — like monthly count */}
        <section className="rounded-[6px] border border-[color:var(--ds-border-warm)] overflow-hidden">
          {visibleRows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground italic text-center">
              No items match. Adjust filters or change type.
            </p>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Item</th>
                  <th className="text-right px-2 py-2 w-20">Current</th>
                  <th className="text-right px-2 py-2 w-24">Delta (+/-)</th>
                  <th className="text-right px-3 py-2 w-20">After</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => {
                  const raw = deltas[r.id] ?? "";
                  const parsed = parseFloat(raw);
                  const valid = raw !== "" && Number.isFinite(parsed);
                  const after = valid ? r.current + parsed : null;
                  return (
                    <tr key={r.id} className="border-t border-[color:var(--ds-border-warm)]">
                      <td className="px-3 py-1.5">
                        <span className="truncate">{r.name}</span>
                        {r.isVariant && (
                          <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[var(--accent-lilac-bg)] text-[var(--accent-lilac-ink)]">
                            box
                          </span>
                        )}
                      </td>
                      <td className="text-right px-2 py-1.5 tabular-nums text-muted-foreground">
                        {r.current} {r.unit}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <input
                          type="number"
                          step="any"
                          value={raw}
                          onChange={(e) => setDeltas((d) => ({ ...d, [r.id]: e.target.value }))}
                          className="input"
                          style={{ maxWidth: 90, padding: "2px 6px", textAlign: "right" }}
                          placeholder="0"
                        />
                      </td>
                      <td className={`text-right px-3 py-1.5 tabular-nums ${after != null && after < 0 ? "text-status-alert" : "text-muted-foreground"}`}>
                        {valid && parsed !== 0 ? (after ?? 0) : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {/* Save bar */}
        <div className="flex items-center justify-between gap-3 pt-2">
          <span className="text-[11px] text-muted-foreground">
            {enteredCount} adjustment{enteredCount === 1 ? "" : "s"} pending
          </span>
          <button
            onClick={handleSave}
            disabled={enteredCount === 0 || saving}
            className="inline-flex items-center gap-1.5 rounded-sm bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? "Saving…" : `Save ${enteredCount} adjustment${enteredCount === 1 ? "" : "s"}`}
          </button>
        </div>

        {result && (
          result.error ? (
            <div className="rounded-md bg-status-alert-bg border border-status-alert-edge px-3 py-2">
              <div className="flex items-start gap-2 text-xs text-status-alert">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium">
                    Applied {result.applied} of {result.total} before hitting an error.
                  </p>
                  <p className="mt-0.5 opacity-90">{result.error}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-md bg-status-ok-bg border border-status-ok-edge px-3 py-2">
              <div className="flex items-start gap-2 text-xs text-status-ok">
                <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Saved {result.applied} adjustment{result.applied === 1 ? "" : "s"}.
                </span>
              </div>
            </div>
          )
        )}

        {/* Recent adjustments */}
        <section>
          <h2 className="text-sm font-semibold text-primary mb-2">Recent adjustments</h2>
          {recent.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No adjustments logged yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)]">
              {recent.map((adj) => {
                const delta = Number(adj.deltaQty);
                return (
                  <li key={adj.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-[12.5px]">
                        <span className="font-medium">{adj.itemId.slice(0, 8)}…</span>
                        <span className="text-muted-foreground text-[11px]">
                          {" · "}{adj.itemType}
                          {adj.location ? ` · ${STOCK_LOCATION_LABELS[adj.location]}` : ""}
                        </span>
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {STOCK_ADJUSTMENT_REASON_LABELS[adj.reason]}
                        {adj.note ? ` · ${adj.note}` : ""}
                        {" · "}
                        {new Date(adj.createdAt).toLocaleDateString("de-AT", { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    </div>
                    <span
                      className={`text-sm font-medium tabular-nums shrink-0 ${delta > 0 ? "text-status-ok" : "text-status-alert"}`}
                    >
                      {delta > 0 ? "+" : ""}{delta}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
