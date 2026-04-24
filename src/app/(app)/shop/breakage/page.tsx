"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import {
  useProductsList,
  saveStockTransfer,
  useStockTransfers,
} from "@/lib/hooks";

/**
 * Weekly breakage + tasting log — bulk entry screen.
 *
 * Manuela opens once a week, enters rough counts for products given
 * as tastings or broken at the counter. Saves as stockTransfer rows
 * with reason 'tasting' or 'waste' so the analytics feed picks up
 * the true sell-through + waste %.
 */
export default function ShopBreakagePage() {
  const products = useProductsList();
  const transfers = useStockTransfers("product");

  const [reason, setReason] = useState<"tasting" | "waste" | "gift">("tasting");
  const [entries, setEntries] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const eligible = useMemo(
    () => products.filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name)),
    [products],
  );

  const totalEntered = Object.values(entries).reduce((s, n) => s + n, 0);

  async function save() {
    setSaving(true);
    setSavedMsg(null);
    try {
      const rows = Object.entries(entries).filter(([_, qty]) => qty > 0);
      for (const [productId, qty] of rows) {
        await saveStockTransfer({
          entityType: "product",
          entityId: productId,
          quantity: qty,
          fromLocationId: "store",
          toLocationId: reason === "waste" ? "waste" : "consumed",
          transferredAt: new Date(),
          reason,
          notes: notes || undefined,
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
        title="Breakage & tastings"
        accent="Shop"
        description="End-of-week roll-up of what was given away (free tastings, gifts) or broken at the counter. Feeds waste % + sell-rate analytics."
      />

      <section
        className="border border-border bg-card p-4 mb-4"
        style={{ borderRadius: 4 }}
      >
        <div className="flex flex-wrap gap-3 items-baseline">
          <label className="text-[10px] uppercase text-muted-foreground font-medium" style={{ letterSpacing: "0.12em" }}>
            Reason
          </label>
          {(["tasting", "waste", "gift"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={
                "text-[11.5px] px-2.5 py-1 border capitalize " +
                (reason === r
                  ? "bg-foreground text-background border-foreground"
                  : "bg-card border-border text-foreground hover:border-foreground")
              }
              style={{ borderRadius: 3 }}
            >
              {r}
            </button>
          ))}
        </div>
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
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {eligible.map((p) => (
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
              .filter((t) => ["tasting", "waste", "gift"].includes(t.reason))
              .slice(0, 20)
              .map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-3 text-[12px] px-3 py-1.5 bg-muted border border-border"
                  style={{ borderRadius: 3 }}
                >
                  <span className="tabular-nums font-medium">{Number(t.quantity)}</span>
                  <span className="text-muted-foreground capitalize">{t.reason}</span>
                  <span className="text-muted-foreground text-[10.5px] ml-auto">
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
