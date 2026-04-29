"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import {
  useProductsList,
  saveStockTransfer,
  useStockTransfers,
  useCampaigns,
  useProductCategories,
} from "@/lib/hooks";
import { STOCK_TRANSFER_REASON_LABELS, type StockTransferReason } from "@/types";

const STOCK_OUT_REASONS: StockTransferReason[] = [
  "sold",
  "tasting",
  "gift",
  "event_sample",
  "staff",
  "waste",
];

/**
 * Stock-out log — bulk entry screen for everything that leaves shop
 * stock outside the normal order/box flows: walk-in singles (sold),
 * tastings, gifts/giveaways, event samples (booth), staff
 * consumption, and counter waste/breakage. Saves as stockTransfer
 * rows so the weekly sales report picks them up.
 */
export default function ShopBreakagePage() {
  const products = useProductsList();
  const transfers = useStockTransfers("product");
  const campaigns = useCampaigns();
  const categories = useProductCategories(true);

  const [reason, setReason] = useState<StockTransferReason>("sold");
  const [entries, setEntries] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const categoryNameById = useMemo(
    () => new Map(categories.map((c) => [c.id!, c.name])),
    [categories],
  );

  // Active market_event campaign — auto-tag event_sample / sold
  // notes with the booth name when one is in window.
  const activeMarketEvent = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    return campaigns.find(
      (c) => c.type === "market_event"
        && c.status !== "done" && c.status !== "cancelled"
        && c.startDate <= todayIso && c.endDate >= todayIso,
    );
  }, [campaigns]);

  const eligible = useMemo(
    () => products.filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name)),
    [products],
  );
  const visibleEligible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return eligible.filter((p) => {
      if (activeCategories.size > 0) {
        if (!p.productCategoryId || !activeCategories.has(p.productCategoryId)) return false;
      }
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [eligible, activeCategories, search]);
  const usedCategories = useMemo(() => {
    const ids = new Set<string>();
    for (const p of eligible) if (p.productCategoryId) ids.add(p.productCategoryId);
    return [...ids]
      .map((id) => ({ id, name: categoryNameById.get(id) ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [eligible, categoryNameById]);

  const totalEntered = Object.values(entries).reduce((s, n) => s + n, 0);

  async function save() {
    setSaving(true);
    setSavedMsg(null);
    try {
      const rows = Object.entries(entries).filter(([_, qty]) => qty > 0);
      const tag = activeMarketEvent && (reason === "event_sample" || reason === "sold")
        ? `[${activeMarketEvent.name}] `
        : "";
      const noteOut = (tag + (notes || "")).trim() || undefined;
      // Map reason → toLocation. Waste/breakage tracked separately;
      // everything else marked as 'consumed' (left the system).
      const toLoc = reason === "waste" ? "waste" : "consumed";
      for (const [productId, qty] of rows) {
        await saveStockTransfer({
          entityType: "product",
          entityId: productId,
          quantity: qty,
          fromLocationId: "store",
          toLocationId: toLoc,
          transferredAt: new Date(),
          reason,
          notes: noteOut,
        });
      }
      setSavedMsg(`Logged ${rows.length} entries, ${totalEntered} pieces.`);
      setEntries({});
      setNotes("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Stock out"
        accent="Shop"
        description="Anything leaving shop stock outside normal orders: walk-in sales, tastings, gifts, event samples, staff, breakage. Feeds the weekly sales report."
      />

      <section
        className="border border-border bg-card p-4 mb-4"
        style={{ borderRadius: 4 }}
      >
        <div className="flex flex-wrap gap-1.5 items-center">
          <label className="text-[10px] uppercase text-muted-foreground font-medium mr-2" style={{ letterSpacing: "0.12em" }}>
            Reason
          </label>
          {STOCK_OUT_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={
                "text-[11.5px] px-2.5 py-1 border " +
                (reason === r
                  ? "bg-foreground text-background border-foreground"
                  : "bg-card border-border text-foreground hover:border-foreground")
              }
              style={{ borderRadius: 3 }}
            >
              {STOCK_TRANSFER_REASON_LABELS[r]}
            </button>
          ))}
        </div>
        {activeMarketEvent && (reason === "event_sample" || reason === "sold") && (
          <p className="text-[11px] text-muted-foreground mt-2">
            Auto-tagging note with active market event: <b>{activeMarketEvent.name}</b>.
          </p>
        )}
      </section>

      <section
        className="border border-border bg-card p-4 mb-4"
        style={{ borderRadius: 4 }}
      >
        <h3
          className="text-[13px] mb-3"
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            letterSpacing: "-0.012em",
          }}
        >
          How many of each? <span className="text-muted-foreground text-[10.5px] font-normal">(skip products with zero)</span>
        </h3>

        {/* Category chip row + search — narrows the product list. */}
        {usedCategories.length > 0 && (
          <div className="space-y-2 mb-3">
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
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {visibleEligible.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-2 border border-border bg-muted px-3 py-1.5"
              style={{ borderRadius: 3 }}
            >
              <span
                className="text-[12.5px] flex-1 min-w-0 truncate"
                style={{
                  fontFamily: "var(--font-serif)",
                  fontWeight: 500,
                  letterSpacing: "-0.01em",
                }}
              >
                {p.name}
              </span>
              <input
                type="number"
                min={0}
                value={entries[p.id ?? ""] ?? ""}
                onChange={(e) => {
                  const v = Math.max(0, Number(e.target.value) || 0);
                  setEntries((prev) => {
                    const next = { ...prev };
                    if (v === 0) {
                      delete next[p.id ?? ""];
                    } else {
                      next[p.id ?? ""] = v;
                    }
                    return next;
                  });
                }}
                className="input text-right"
                style={{ maxWidth: 72, padding: "4px 8px" }}
                placeholder="0"
              />
            </li>
          ))}
        </ul>
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
          placeholder="e.g. customer dropped box, influencer visit"
        />
      </section>

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {totalEntered} pieces across {Object.keys(entries).length} products
        </span>
        <div className="flex items-center gap-3">
          {savedMsg ? (
            <span className="text-[11px] text-status-ok">{savedMsg}</span>
          ) : null}
          <button
            type="button"
            onClick={save}
            disabled={saving || totalEntered === 0}
            className="btn-primary"
          >
            {saving ? "Saving…" : "Log entries"}
          </button>
        </div>
      </div>

      <section
        className="mt-8 border border-border bg-card p-4"
        style={{ borderRadius: 4 }}
      >
        <h3
          className="text-[13px] mb-3"
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            letterSpacing: "-0.012em",
          }}
        >
          Recent log
        </h3>
        {transfers.length === 0 ? (
          <p
            className="text-muted-foreground italic text-[12.5px]"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Nothing logged yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {transfers
              .filter((t) => STOCK_OUT_REASONS.includes(t.reason as StockTransferReason))
              .slice(0, 30)
              .map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-3 text-[12px] px-3 py-1.5 bg-muted border border-border"
                  style={{ borderRadius: 3 }}
                >
                  <span className="tabular-nums font-medium">{Number(t.quantity)}</span>
                  <span className="text-muted-foreground">
                    {STOCK_TRANSFER_REASON_LABELS[t.reason as StockTransferReason] ?? t.reason}
                  </span>
                  {t.notes && (
                    <span className="text-muted-foreground text-[10.5px] truncate max-w-[200px]" title={t.notes}>
                      {t.notes}
                    </span>
                  )}
                  <span className="text-muted-foreground text-[10.5px] ml-auto tabular-nums">
                    {new Date(t.transferredAt).toLocaleString()}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}
