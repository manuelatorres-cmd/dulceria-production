"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import {
  useProductsList, useFillings, usePackagingList, useIngredients,
  useStockAdjustments, applyStockAdjustments,
} from "@/lib/hooks";
import {
  STOCK_ADJUSTMENT_ITEM_TYPES, STOCK_ADJUSTMENT_ITEM_TYPE_LABELS,
  STOCK_ADJUSTMENT_REASONS, STOCK_ADJUSTMENT_REASON_LABELS,
  STOCK_LOCATIONS, STOCK_LOCATION_LABELS,
  type StockAdjustmentItemType, type StockAdjustmentReason,
  type StockLocation,
} from "@/types";
import { ArrowLeft, Plus, Trash2, CheckCircle, AlertTriangle, Save } from "lucide-react";

interface DraftRow {
  key: string;
  itemType: StockAdjustmentItemType;
  itemId: string;
  location: StockLocation;
  deltaQty: string;
  reason: StockAdjustmentReason;
  note: string;
}

let rowKeyCounter = 0;
const nextKey = () => `row-${++rowKeyCounter}`;

function emptyRow(preset: Partial<DraftRow> = {}): DraftRow {
  return {
    key: nextKey(),
    itemType: preset.itemType ?? "ingredient",
    itemId: preset.itemId ?? "",
    // Default to Store — finished pieces the chocolatier adds to
    // opening balance are front-of-shop ready. Production Storage is
    // for pieces just unmoulded and waiting to move out.
    location: preset.location ?? "store",
    deltaQty: preset.deltaQty ?? "",
    reason: preset.reason ?? "opening_balance",
    note: preset.note ?? "",
  };
}

export default function StockAdjustPage() {
  const products = useProductsList(true);
  const fillings = useFillings(true);
  const packaging = usePackagingList(true);
  const ingredients = useIngredients(true);
  const recent = useStockAdjustments({ limit: 15 });

  const [rows, setRows] = useState<DraftRow[]>(() => [emptyRow()]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ applied: number; total: number; error?: string } | null>(null);

  const itemsByType = useMemo(() => {
    const byType: Record<StockAdjustmentItemType, Array<{ id: string; name: string; hint?: string }>> = {
      product: products
        .filter((p) => !p.archived)
        .map((p) => ({ id: p.id!, name: p.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      filling: fillings
        .filter((f) => !f.archived && !f.supersededAt)
        .map((f) => ({ id: f.id!, name: f.name, hint: "(grams)" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      packaging: packaging
        .filter((p) => !p.archived)
        .map((p) => ({ id: p.id!, name: p.name, hint: "(units)" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      ingredient: ingredients
        .filter((i) => !i.archived)
        .map((i) => ({ id: i.id!, name: i.name, hint: "(grams)" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
    return byType;
  }, [products, fillings, packaging, ingredients]);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const type of STOCK_ADJUSTMENT_ITEM_TYPES) {
      for (const it of itemsByType[type]) m.set(`${type}:${it.id}`, it.name);
    }
    return m;
  }, [itemsByType]);

  function updateRow(key: string, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((r) => r.key === key ? { ...r, ...patch } : r));
  }

  function removeRow(key: string) {
    setRows((prev) => prev.length === 1 ? [emptyRow()] : prev.filter((r) => r.key !== key));
  }

  function addRow() {
    // Copy the previous row's item type + reason so repeated entries
    // are faster (opening balance of a dozen ingredients in a row).
    const last = rows[rows.length - 1];
    setRows((prev) => [...prev, emptyRow({
      itemType: last?.itemType,
      reason: last?.reason,
      location: last?.location,
    })]);
  }

  const validRows = useMemo(() => rows.filter((r) => {
    if (!r.itemId) return false;
    const n = parseFloat(r.deltaQty);
    return Number.isFinite(n) && n !== 0;
  }), [rows]);
  const canSave = validRows.length > 0 && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setResult(null);
    try {
      const inputs = validRows.map((r) => ({
        itemType: r.itemType,
        itemId: r.itemId,
        location: r.itemType === "product" ? r.location : undefined,
        deltaQty: parseFloat(r.deltaQty),
        reason: r.reason,
        note: r.note.trim() || undefined,
      }));
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
        // Clear the form so the user can start a fresh batch.
        setRows([emptyRow()]);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title="Stock adjustment" description="Opening balance, recounts, breakage — one audit log" />
      <div className="px-4 pb-10 space-y-5">
        <Link href="/stock" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to stock
        </Link>

        <section className="rounded-sm border border-border bg-card p-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Enter real stock that the app doesn&apos;t know about yet. Positive
            quantity adds, negative removes. Each row is saved as a permanent
            audit entry — reversals happen with a new opposite adjustment,
            nothing is ever deleted.
          </p>
          <p className="text-[11px] text-muted-foreground">
            Product quantities are pieces · filling / ingredient quantities are
            grams · packaging quantities are units.
          </p>
        </section>

        {/* Draft rows */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-primary">Adjustments</h2>
            <p className="text-xs text-muted-foreground">
              {validRows.length} ready · {rows.length - validRows.length} incomplete
            </p>
          </div>
          <ul className="space-y-2">
            {rows.map((row, idx) => {
              const items = itemsByType[row.itemType];
              const needsLocation = row.itemType === "product";
              return (
                <li key={row.key} className="rounded-sm border border-border bg-card p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-muted-foreground">Row {idx + 1}</span>
                    <button
                      onClick={() => removeRow(row.key)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remove row"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                    {/* Item type */}
                    <div>
                      <label className="label">Type</label>
                      <select
                        value={row.itemType}
                        onChange={(e) => updateRow(row.key, {
                          itemType: e.target.value as StockAdjustmentItemType,
                          itemId: "",
                        })}
                        className="input text-sm"
                      >
                        {STOCK_ADJUSTMENT_ITEM_TYPES.map((t) => (
                          <option key={t} value={t}>{STOCK_ADJUSTMENT_ITEM_TYPE_LABELS[t]}</option>
                        ))}
                      </select>
                    </div>
                    {/* Item */}
                    <div className="sm:col-span-2">
                      <label className="label">Item</label>
                      <select
                        value={row.itemId}
                        onChange={(e) => updateRow(row.key, { itemId: e.target.value })}
                        className="input text-sm"
                      >
                        <option value="">— pick —</option>
                        {items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.name}{it.hint ? ` ${it.hint}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    {/* Location (products only) */}
                    {needsLocation ? (
                      <div>
                        <label className="label">Location</label>
                        <select
                          value={row.location}
                          onChange={(e) => updateRow(row.key, { location: e.target.value as StockLocation })}
                          className="input text-sm"
                        >
                          {STOCK_LOCATIONS.filter((l) => l !== "allocated").map((l) => (
                            <option key={l} value={l}>{STOCK_LOCATION_LABELS[l]}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div />
                    )}
                    {/* Delta qty */}
                    <div>
                      <label className="label">Qty (+/-)</label>
                      <input
                        type="number"
                        step="any"
                        value={row.deltaQty}
                        onChange={(e) => updateRow(row.key, { deltaQty: e.target.value })}
                        placeholder="e.g. 24 or -3"
                        className="input text-sm"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label className="label">Reason</label>
                      <select
                        value={row.reason}
                        onChange={(e) => updateRow(row.key, { reason: e.target.value as StockAdjustmentReason })}
                        className="input text-sm"
                      >
                        {STOCK_ADJUSTMENT_REASONS.map((r) => (
                          <option key={r} value={r}>{STOCK_ADJUSTMENT_REASON_LABELS[r]}</option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label">Note (optional)</label>
                      <input
                        type="text"
                        value={row.note}
                        onChange={(e) => updateRow(row.key, { note: e.target.value })}
                        placeholder="e.g. counted Mon morning"
                        className="input text-sm"
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={addRow}
              className="inline-flex items-center gap-1 rounded-sm border border-border bg-card px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary"
            >
              <Plus className="w-3.5 h-3.5" /> Add row
            </button>
            <div className="flex-1" />
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="inline-flex items-center gap-1 rounded-sm bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {saving
                ? "Saving…"
                : `Save ${validRows.length} adjustment${validRows.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </section>

        {result && (
          result.error ? (
            <div className="rounded-md bg-status-alert-bg border border-status-alert-edge px-3 py-2">
              <div className="flex items-start gap-2 text-xs text-status-alert">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium">
                    Applied {result.applied} of {result.total} adjustments before hitting an error.
                  </p>
                  <p className="mt-0.5 opacity-90">{result.error}</p>
                  <p className="mt-1 text-muted-foreground">
                    The successful rows are already saved. Fix the failing row and re-save.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-md bg-status-ok-bg border border-status-ok-edge px-3 py-2">
              <div className="flex items-start gap-2 text-xs text-status-ok">
                <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Saved {result.applied} adjustment{result.applied === 1 ? "" : "s"}. Stock totals + dashboard alerts are already updated.
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
            <ul className="divide-y divide-border rounded-sm border border-border bg-card">
              {recent.map((adj) => {
                const name = nameById.get(`${adj.itemType}:${adj.itemId}`) ?? adj.itemId;
                const delta = Number(adj.deltaQty);
                return (
                  <li key={adj.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <div className="flex-1 min-w-0">
                      <p className="truncate">
                        <span className="font-medium">{name}</span>
                        <span className="text-muted-foreground text-xs">
                          {" · "}{STOCK_ADJUSTMENT_ITEM_TYPE_LABELS[adj.itemType]}
                          {adj.location ? ` · ${STOCK_LOCATION_LABELS[adj.location]}` : ""}
                        </span>
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {STOCK_ADJUSTMENT_REASON_LABELS[adj.reason]}
                        {adj.note ? ` · ${adj.note}` : ""}
                        {" · "}
                        {new Date(adj.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
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
