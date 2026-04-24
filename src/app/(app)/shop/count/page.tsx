"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import {
  useProductsList,
  useProductLocationTotals,
  saveStockTransfer,
} from "@/lib/hooks";

/**
 * Monthly physical inventory count — reconciles system stock with
 * what's actually on the shelves. Manuela walks through the shop,
 * enters actual counts, saves. Differences are logged as adjustment
 * transfers (reason='manual') with the variance as quantity.
 *
 * Kept intentionally simple: no partial drafts, no wizard. One screen,
 * click Save to commit all entries.
 */
export default function MonthlyCountPage() {
  const products = useProductsList();
  const totals = useProductLocationTotals();

  const [counts, setCounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const eligible = useMemo(
    () => products.filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name)),
    [products],
  );

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
    try {
      for (const v of variances) {
        if (v.counted === null || v.variance === 0) continue;
        await saveStockTransfer({
          entityType: "product",
          entityId: v.product.id ?? "",
          quantity: Math.abs(v.variance),
          fromLocationId: v.variance > 0 ? "count-adjust-in" : "store",
          toLocationId: v.variance > 0 ? "store" : "count-adjust-out",
          transferredAt: new Date(),
          reason: "manual",
          notes:
            notes ||
            `Monthly count reconciliation (${v.variance > 0 ? "+" : ""}${v.variance})`,
        });
      }
      setSavedMsg(`Logged ${entered} counts, ${totalVariance} pieces reconciled.`);
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
              {variances.map((v) => (
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
          {savedMsg ? (
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
