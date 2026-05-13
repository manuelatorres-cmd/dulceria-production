"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconArrowRight as ArrowRight, IconPackage as Package } from "@tabler/icons-react";
import { STOCK_LOCATION_LABELS, type StockLocation } from "@/types";
import type { Order } from "@/types";

/** Per-batch transfer dialog. Shows the current per-location distribution of
 *  a single batch, lets the user move a quantity from one location to another,
 *  and optionally attach an order when moving into 'allocated'. */
export function TransferModal({
  batchLabel,
  productName,
  distribution,
  openOrders,
  defaultFrom = "production",
  onConfirm,
  onCancel,
}: {
  batchLabel?: string;
  productName: string;
  /** Current quantity per location for this batch. */
  distribution: Record<StockLocation, number>;
  /** Only used when `to === 'allocated'`. */
  openOrders: Order[];
  defaultFrom?: StockLocation;
  onConfirm: (args: {
    from: StockLocation;
    to: StockLocation;
    quantity: number;
    orderId?: string;
    notes?: string;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  // Pick an initial from-location that actually has stock, falling back to the
  // requested default.
  const initialFrom = useMemo<StockLocation>(() => {
    if (distribution[defaultFrom] > 0) return defaultFrom;
    const firstNonEmpty = (Object.keys(distribution) as StockLocation[]).find(
      (l) => distribution[l] > 0,
    );
    return firstNonEmpty ?? defaultFrom;
  }, [distribution, defaultFrom]);

  const [from, setFrom] = useState<StockLocation>(initialFrom);
  const [to, setTo] = useState<StockLocation>(() =>
    initialFrom === "production" ? "store" : "production",
  );
  const [qty, setQty] = useState<string>(() => String(distribution[initialFrom] ?? 0));
  const [orderId, setOrderId] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const qtyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    qtyRef.current?.focus();
    qtyRef.current?.select();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);

  const available = distribution[from] ?? 0;
  const qtyNum = parseInt(qty, 10);
  const invalidQty = !Number.isFinite(qtyNum) || qtyNum <= 0 || qtyNum > available;
  const sameLocation = from === to;
  const needsOrder = to === "allocated" && !orderId;
  const canConfirm = !invalidQty && !sameLocation && !needsOrder;

  async function handleConfirm() {
    if (!canConfirm) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm({
        from,
        to,
        quantity: qtyNum,
        orderId: to === "allocated" ? orderId : undefined,
        notes: notes.trim() || undefined,
      });
      // Caller closes the modal on success.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transfer failed");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={busy ? undefined : onCancel} />
      <div className="relative w-full max-w-md mx-4 mb-4 sm:mb-0 rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] shadow-xl overflow-hidden">
        <div className="bg-gradient-to-b from-amber-50 to-card px-5 pt-5 pb-3">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-[4px] bg-primary/10 flex items-center justify-center">
              <Package className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-foreground truncate">Move stock</h3>
              <p className="text-xs text-muted-foreground truncate">
                {productName}{batchLabel ? ` · ${batchLabel}` : ""}
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 space-y-3">
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">From</label>
              <select
                value={from}
                onChange={(e) => {
                  const next = e.target.value as StockLocation;
                  setFrom(next);
                  const avail = distribution[next] ?? 0;
                  if (!Number.isFinite(parseInt(qty, 10)) || parseInt(qty, 10) > avail) {
                    setQty(String(avail));
                  }
                }}
                className="input text-sm"
              >
                {(Object.keys(STOCK_LOCATION_LABELS) as StockLocation[]).map((loc) => (
                  <option key={loc} value={loc} disabled={(distribution[loc] ?? 0) === 0}>
                    {STOCK_LOCATION_LABELS[loc]} ({distribution[loc] ?? 0})
                  </option>
                ))}
              </select>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground mb-2.5" />
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">To</label>
              <select
                value={to}
                onChange={(e) => setTo(e.target.value as StockLocation)}
                className="input text-sm"
              >
                {(Object.keys(STOCK_LOCATION_LABELS) as StockLocation[]).map((loc) => (
                  <option key={loc} value={loc}>{STOCK_LOCATION_LABELS[loc]}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Quantity</label>
            <input
              ref={qtyRef}
              type="number"
              min={1}
              max={available}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
              className="input text-sm"
            />
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {available} available in {STOCK_LOCATION_LABELS[from]}
            </p>
          </div>

          {to === "allocated" && (
            <div>
              <label className="block text-[11px] text-muted-foreground mb-1">Order</label>
              <select
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                className="input text-sm"
              >
                <option value="">Select order…</option>
                {openOrders.map((o) => (
                  <option key={o.id} value={o.id!}>
                    {(o.customerName || o.eventName || "Order")}
                    {" · "}
                    {new Date(o.deadline).toLocaleDateString("de-AT", { day: "numeric", month: "short" })}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. for tomorrow's market"
              className="input text-sm"
            />
          </div>

          {sameLocation && (
            <p className="text-[11px] text-status-warn">From and To can&apos;t be the same location.</p>
          )}
          {error && <p className="text-[11px] text-status-alert">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-[color:var(--ds-border-warm)] flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm || busy}
            className="rounded-[4px] bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {busy ? "Moving…" : "Move"}
          </button>
        </div>
      </div>
    </div>
  );
}
