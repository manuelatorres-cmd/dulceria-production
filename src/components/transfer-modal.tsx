"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconArrowRight as ArrowRight, IconPackage as Package } from "@tabler/icons-react";
import { STOCK_LOCATION_LABELS, type StockLocation } from "@/types";
import type { Order } from "@/types";
import { DsModalShell, DsButton } from "@/components/dulceria";

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
    <DsModalShell
      open
      title="Move stock"
      subtitle={`${productName}${batchLabel ? ` · ${batchLabel}` : ""}`}
      icon={<Package size={15} />}
      busy={busy}
      onClose={onCancel}
      footer={
        <>
          <DsButton onClick={onCancel} disabled={busy}>Cancel</DsButton>
          <DsButton variant="primary" onClick={handleConfirm} disabled={!canConfirm || busy}>
            {busy ? "Moving…" : "Move"}
          </DsButton>
        </>
      }
    >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
            <p style={{ fontSize: 11, color: "var(--ds-semantic-warn)" }}>From and To can&apos;t be the same location.</p>
          )}
          {error && <p style={{ fontSize: 11, color: "var(--ds-tier-urgent)" }}>{error}</p>}
        </div>
    </DsModalShell>
  );
}
