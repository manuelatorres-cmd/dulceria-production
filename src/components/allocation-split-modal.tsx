"use client";

import { useEffect, useMemo, useState } from "react";
import { Warehouse, Snowflake, Trash2, AlertTriangle } from "lucide-react";

export type SurplusDestination = "store" | "freezer" | "waste";

export interface AllocationSplitOrderRow {
  orderPlanLinkId: string;
  orderId: string;
  orderLabel: string;   // customer or event name
  requested: number;    // current allocatedQuantity on the link
}

export interface AllocationSplitResult {
  perLink: Array<{ orderPlanLinkId: string; delivered: number }>;
  surplus: number;
  surplusDestination?: SurplusDestination;
}

/**
 * Post-unmould allocation split.
 *
 *   totalYield — how many pieces actually made it out of the moulds
 *     (captured by YieldModal in the previous step).
 *   orders     — one row per linked order with its current
 *     allocatedQuantity (the amount that batch had promised to that
 *     order before unmould).
 *
 * The operator distributes totalYield across the orders + a surplus
 * bucket. Defaults:
 *
 *   - If yield ≥ total committed: each order gets its full request,
 *     surplus absorbs the rest (→ operator picks destination).
 *   - If yield < total committed: each order gets a pro-rata trim of
 *     its request so the sum equals yield (surplus = 0). The
 *     operator can redistribute to prioritise specific orders, with
 *     per-row shortfall flags highlighting lines that fall short of
 *     their commitment.
 *
 * Save semantics handled by the caller:
 *   - UPDATE orderPlanLinks.allocatedQuantity to the delivered value.
 *   - SET productionPlans.surplusDestination if surplus > 0.
 *   - (Stock writes happen in the stock-rewrite task — this modal
 *     captures intent only.)
 */
export function AllocationSplitModal({
  totalYield, orders, onConfirm, onCancel,
}: {
  totalYield: number;
  orders: AllocationSplitOrderRow[];
  onConfirm: (result: AllocationSplitResult) => void | Promise<void>;
  onCancel: () => void;
}) {
  const totalRequested = useMemo(
    () => orders.reduce((s, o) => s + o.requested, 0),
    [orders],
  );
  const shortfallMode = totalYield < totalRequested;

  const [delivered, setDelivered] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    if (!shortfallMode) {
      // Every order fully satisfied; rest goes to surplus.
      for (const o of orders) out[o.orderPlanLinkId] = o.requested;
    } else if (totalRequested > 0) {
      // Pro-rata shrink so the initial split equals totalYield.
      let remaining = totalYield;
      for (let i = 0; i < orders.length; i++) {
        const o = orders[i];
        const share = i === orders.length - 1
          ? remaining
          : Math.round(totalYield * (o.requested / totalRequested));
        const clamped = Math.max(0, Math.min(share, o.requested));
        out[o.orderPlanLinkId] = clamped;
        remaining -= clamped;
      }
    } else {
      for (const o of orders) out[o.orderPlanLinkId] = 0;
    }
    return out;
  });

  const [surplusDestination, setSurplusDestination] = useState<SurplusDestination | undefined>();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const sumDelivered = useMemo(
    () => Object.values(delivered).reduce((s, n) => s + n, 0),
    [delivered],
  );
  const surplus = Math.max(0, totalYield - sumDelivered);
  const overDelivered = sumDelivered > totalYield;
  const needsDestination = surplus > 0 && !surplusDestination;
  const canConfirm = !overDelivered && !needsDestination;

  function setFor(linkId: string, value: number) {
    setDelivered((prev) => ({
      ...prev,
      [linkId]: Math.max(0, Math.min(value, totalYield)),
    }));
  }

  function handleConfirm() {
    if (!canConfirm) return;
    onConfirm({
      perLink: orders.map((o) => ({
        orderPlanLinkId: o.orderPlanLinkId,
        delivered: delivered[o.orderPlanLinkId] ?? 0,
      })),
      surplus,
      surplusDestination: surplus > 0 ? surplusDestination : undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onCancel} />
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-card shadow-xl overflow-hidden">
        <div className="bg-gradient-to-b from-amber-50 to-card px-5 pt-5 pb-3 border-b border-border">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-foreground">
              Split yield across orders
            </h3>
            <span className="text-sm tabular-nums font-medium">
              {totalYield} piece{totalYield === 1 ? "" : "s"}
            </span>
          </div>
          {shortfallMode && (
            <p className="text-xs text-status-warn mt-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Yield is {totalRequested - totalYield} short of the total committed ({totalRequested}).
              Decide which orders bear the shortfall.
            </p>
          )}
        </div>

        <ul className="px-5 py-3 space-y-3 max-h-72 overflow-y-auto">
          {orders.map((o) => {
            const v = delivered[o.orderPlanLinkId] ?? 0;
            const short = v < o.requested;
            return (
              <li key={o.orderPlanLinkId} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{o.orderLabel}</span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    requested {o.requested}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setFor(o.orderPlanLinkId, v - 1)}
                    className="w-7 h-7 rounded-full border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground text-sm"
                  >
                    &minus;
                  </button>
                  <input
                    type="number"
                    min={0}
                    max={totalYield}
                    value={v}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      setFor(o.orderPlanLinkId, isNaN(n) ? 0 : n);
                    }}
                    className="flex-1 h-8 rounded-md border border-border bg-card text-center text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    onClick={() => setFor(o.orderPlanLinkId, v + 1)}
                    className="w-7 h-7 rounded-full border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground text-sm"
                  >
                    +
                  </button>
                </div>
                {short && (
                  <p className="text-[11px] text-status-warn flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Falls {o.requested - v} short of the commitment to this order.
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        <div className="px-5 py-3 border-t border-border space-y-2 bg-muted/20">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Surplus</span>
            <span className="text-sm font-semibold tabular-nums">
              {surplus} piece{surplus === 1 ? "" : "s"}
            </span>
          </div>
          {surplus > 0 && (
            <div className="grid grid-cols-3 gap-1.5">
              <DestinationChoice
                icon={<Warehouse className="w-3.5 h-3.5" />}
                label="Store"
                active={surplusDestination === "store"}
                onClick={() => setSurplusDestination("store")}
              />
              <DestinationChoice
                icon={<Snowflake className="w-3.5 h-3.5" />}
                label="Freeze"
                active={surplusDestination === "freezer"}
                onClick={() => setSurplusDestination("freezer")}
              />
              <DestinationChoice
                icon={<Trash2 className="w-3.5 h-3.5" />}
                label="Waste"
                active={surplusDestination === "waste"}
                onClick={() => setSurplusDestination("waste")}
              />
            </div>
          )}
          {overDelivered && (
            <p className="text-[11px] text-destructive flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Allocated {sumDelivered} but only {totalYield} made it out. Reduce a row.
            </p>
          )}
        </div>

        <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-border px-4 py-2 text-sm"
          >
            Back
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            Save allocation
          </button>
        </div>
      </div>
    </div>
  );
}

function DestinationChoice({ icon, label, active, onClick }: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "border-border text-muted-foreground hover:border-primary hover:text-primary"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
