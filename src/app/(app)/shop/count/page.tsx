"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import {
  useProductsList,
  useProductLocationTotals,
  useProductCategories,
  applyStockAdjustments,
} from "@/lib/hooks";

/**
 * Monthly physical inventory count — reconciles system stock with
 * what's actually on the shelves. Manuela walks through the shop,
 * enters actual counts, saves. Differences go through
 * `applyStockAdjustments` so real productStock totals move (not just
 * an audit row).
 *
 * Kept intentionally simple: no partial drafts, no wizard. One screen,
 * click Save to commit all entries.
 */
export default function MonthlyCountPage() {
  const products = useProductsList();
  const totals = useProductLocationTotals();
  const categories = useProductCategories(true);

  const [counts, setCounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const categoryNameById = useMemo(
    () => new Map(categories.map((c) => [c.id!, c.name])),
    [categories],
  );

  const eligible = useMemo(
    () => products.filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name)),
    [products],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return eligible.filter((p) => {
      if (activeCategories.size > 0) {
        if (!p.productCategoryId || !activeCategories.has(p.productCategoryId)) return false;
      }
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [eligible, activeCategories, search]);

  // Categories used in the eligible product set — chip pool.
  const usedCategories = useMemo(() => {
    const ids = new Set<string>();
    for (const p of eligible) if (p.productCategoryId) ids.add(p.productCategoryId);
    return [...ids]
      .map((id) => ({ id, name: categoryNameById.get(id) ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [eligible, categoryNameById]);

  const variances = useMemo(() => {
    return eligible.map((p) => {
      const system = totals.get(p.id ?? "")?.store ?? 0;
      const rawCount = counts[p.id ?? ""];
      const counted = rawCount === undefined || rawCount === "" ? null : Number(rawCount);
      const variance = counted === null ? 0 : counted - system;
      return { product: p, system, counted, variance };
    });
  }, [eligible, counts, totals]);

  const totalVariance = variances.reduce((s, v) => s + Math.abs(v.variance), 0);
  const entered = variances.filter((v) => v.counted !== null).length;

  async function save() {
    setSaving(true);
    setSavedMsg(null);
    setSaveError(null);
    try {
      const inputs = variances
        .filter((v) => v.counted !== null && v.variance !== 0)
        .map((v) => ({
          itemType: "product" as const,
          itemId: v.product.id ?? "",
          location: "store" as const,
          deltaQty: v.variance,
          reason: "correction" as const,
          note: notes
            ? `${notes} (monthly count ${v.variance > 0 ? "+" : ""}${v.variance})`
            : `Monthly count reconciliation (${v.variance > 0 ? "+" : ""}${v.variance})`,
        }));
      const result = await applyStockAdjustments(inputs);
      if (result.failed) {
        setSaveError(`Stopped at "${result.failed.itemId}" after ${result.applied} adjustments. ${result.error instanceof Error ? result.error.message : ""}`);
        return;
      }
      setSavedMsg(`Reconciled ${result.applied} product${result.applied === 1 ? "" : "s"}, ${totalVariance} pieces total. Stock totals updated.`);
      setCounts({});
      setNotes("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Monthly inventory count"
        accent="Shop"
        description="Walk through the shop with a tablet, enter actuals, save. Variances auto-create adjustment transfers so the system reflects reality."
      />

      {/* Category chip row + search — narrows the count table. */}
      {usedCategories.length > 0 && (
        <div className="px-4 mb-3 space-y-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            {usedCategories.map((c) => {
              const active = activeCategories.has(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    setActiveCategories((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.id)) next.delete(c.id);
                      else next.add(c.id);
                      return next;
                    });
                  }}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors capitalize ${
                    active
                      ? "bg-foreground text-background"
                      : "bg-card text-muted-foreground border border-border hover:border-foreground"
                  }`}
                >
                  {c.name}
                </button>
              );
            })}
            {activeCategories.size > 0 && (
              <button
                onClick={() => setActiveCategories(new Set())}
                className="text-[11px] text-muted-foreground hover:text-foreground underline"
              >
                Clear
              </button>
            )}
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="input"
          />
        </div>
      )}

      <section
        className="border border-border bg-card p-4 mb-4"
        style={{ borderRadius: 4 }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left">
                {["Product", "System", "Count", "Variance"].map((h) => (
                  <th
                    key={h}
                    className="py-2 pr-4 text-[10px] uppercase text-muted-foreground font-medium"
                    style={{ letterSpacing: "0.1em" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {variances.filter((v) => visible.some((p) => p.id === v.product.id)).map((v) => (
                <tr
                  key={v.product.id}
                  className="border-t border-border/60"
                >
                  <td
                    className="py-2 pr-4"
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontWeight: 500,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {v.product.name}
                  </td>
                  <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                    {v.system}
                  </td>
                  <td className="py-2 pr-4">
                    <input
                      type="number"
                      min={0}
                      placeholder="—"
                      value={counts[v.product.id ?? ""] ?? ""}
                      onChange={(e) =>
                        setCounts((prev) => ({
                          ...prev,
                          [v.product.id ?? ""]: e.target.value,
                        }))
                      }
                      className="input"
                      style={{ maxWidth: 90, padding: "3px 8px" }}
                    />
                  </td>
                  <td className="py-2 pr-4 tabular-nums">
                    {v.counted === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : v.variance === 0 ? (
                      <span className="text-status-ok">0</span>
                    ) : (
                      <span
                        className={
                          v.variance > 0 ? "text-status-warn" : "text-status-alert"
                        }
                      >
                        {v.variance > 0 ? "+" : ""}
                        {v.variance}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section
        className="border border-border bg-card p-4 mb-4"
        style={{ borderRadius: 4 }}
      >
        <label className="label">Notes (optional)</label>
        <textarea
          className="input"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. pre-Easter stocktake 2026-03"
        />
      </section>

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {entered} counted · {totalVariance} pieces total variance
        </span>
        <div className="flex items-center gap-3">
          {saveError ? (
            <span className="text-[11px] text-status-alert">{saveError}</span>
          ) : savedMsg ? (
            <span className="text-[11px] text-status-ok">{savedMsg}</span>
          ) : null}
          <button
            type="button"
            onClick={save}
            disabled={saving || entered === 0}
            className="btn-primary"
          >
            {saving ? "Saving…" : "Reconcile"}
          </button>
        </div>
      </div>
    </div>
  );
}
