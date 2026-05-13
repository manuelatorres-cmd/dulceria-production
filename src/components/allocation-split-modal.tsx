"use client";

import { useEffect, useMemo, useState } from "react";
import { IconBuildingWarehouse as Warehouse, IconSnowflake as Snowflake, IconTrash as Trash2, IconAlertTriangle as AlertTriangle } from "@tabler/icons-react";

export type SurplusDestination = "store" | "freezer" | "waste";

export interface AllocationSplitOrderRow {
  orderPlanLinkId: string;
  orderId: string;
  orderLabel: string;   // customer or event name
  requested: number;    // current allocatedQuantity on the link
}

export interface AllocationSplitPoRow {
  productionOrderItemId: string;
  productionOrderId: string;
  productId: string;
  poLabel: string;      // "PO Maca · Hazelnut Crunch"
  requested: number;    // targetUnits on the PO item
}

export interface AllocationSplitResult {
  perLink: Array<{ orderPlanLinkId: string; delivered: number }>;
  perPo?: Array<{
    productionOrderItemId: string;
    productionOrderId: string;
    productId: string;
    delivered: number;
  }>;
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
  totalYield, orders, poItems = [], onConfirm, onCancel,
}: {
  totalYield: number;
  orders: AllocationSplitOrderRow[];
  poItems?: AllocationSplitPoRow[];
  onConfirm: (result: AllocationSplitResult) => void | Promise<void>;
  onCancel: () => void;
}) {
  // Treat order rows + PO rows uniformly inside the splitter — each
  // gets its own delivered count, plus a kind discriminator so the
  // confirm result can route to the right tagging path.
  type AnyRow =
    | { kind: "order"; key: string; row: AllocationSplitOrderRow }
    | { kind: "po"; key: string; row: AllocationSplitPoRow };
  const allRows = useMemo<AnyRow[]>(() => [
    ...orders.map((o) => ({ kind: "order" as const, key: `o:${o.orderPlanLinkId}`, row: o })),
    ...poItems.map((p) => ({ kind: "po" as const, key: `p:${p.productionOrderItemId}`, row: p })),
  ], [orders, poItems]);

  const totalRequested = useMemo(
    () => allRows.reduce((s, r) => s + r.row.requested, 0),
    [allRows],
  );
  const shortfallMode = totalYield < totalRequested;

  const [delivered, setDelivered] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    if (!shortfallMode) {
      for (const r of allRows) out[r.key] = r.row.requested;
    } else if (totalRequested > 0) {
      let remaining = totalYield;
      for (let i = 0; i < allRows.length; i++) {
        const r = allRows[i];
        const share = i === allRows.length - 1
          ? remaining
          : Math.round(totalYield * (r.row.requested / totalRequested));
        const clamped = Math.max(0, Math.min(share, r.row.requested));
        out[r.key] = clamped;
        remaining -= clamped;
      }
    } else {
      for (const r of allRows) out[r.key] = 0;
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
  // Overproduction vs. plain surplus: if the batch yielded MORE than
  // the committed request (not just more than currently allocated),
  // we surface a distinct warning at the top. Keeps the operator
  // from silently absorbing 20 extras into default Store without a
  // conscious decision.
  const isOverproduction = totalYield > totalRequested;
  const overproductionAmount = Math.max(0, totalYield - totalRequested);

  function setFor(key: string, value: number) {
    setDelivered((prev) => ({
      ...prev,
      [key]: Math.max(0, Math.min(value, totalYield)),
    }));
  }

  function handleConfirm() {
    if (!canConfirm) return;
    onConfirm({
      perLink: orders.map((o) => ({
        orderPlanLinkId: o.orderPlanLinkId,
        delivered: delivered[`o:${o.orderPlanLinkId}`] ?? 0,
      })),
      perPo: poItems.length > 0
        ? poItems.map((p) => ({
            productionOrderItemId: p.productionOrderItemId,
            productionOrderId: p.productionOrderId,
            productId: p.productId,
            delivered: delivered[`p:${p.productionOrderItemId}`] ?? 0,
          }))
        : undefined,
      surplus,
      surplusDestination: surplus > 0 ? surplusDestination : undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onCancel} />
      <div className="relative w-full max-w-lg rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] shadow-xl overflow-hidden">
        <div className="bg-gradient-to-b from-amber-50 to-card px-5 pt-5 pb-3 border-b border-[color:var(--ds-border-warm)]">
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
          {isOverproduction && (
            <div className="mt-2 rounded-md border border-amber-400 bg-amber-100/80 px-2.5 py-1.5 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-900 leading-snug">
                <span className="font-semibold">Overproduction:</span>{" "}
                {overproductionAmount} extra piece{overproductionAmount === 1 ? "" : "s"} beyond what's committed
                ({totalRequested}). Pick a destination for the surplus below — don't leave it silent.
              </p>
            </div>
          )}
        </div>

        <ul className="px-5 py-3 space-y-3 max-h-72 overflow-y-auto">
          {allRows.map((r) => {
            const v = delivered[r.key] ?? 0;
            const short = v < r.row.requested;
            const label = r.kind === "order" ? r.row.orderLabel : r.row.poLabel;
            const tagText = r.kind === "order" ? "ORDER" : "PO";
            const tagBg = r.kind === "order" ? "rgba(43,108,176,0.15)" : "rgba(74,107,91,0.15)";
            const tagInk = r.kind === "order" ? "#2b6cb0" : "#2e4839";
            return (
              <li key={r.key} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate flex items-center gap-1.5">
                    <span
                      className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-[4px]"
                      style={{ background: tagBg, color: tagInk, letterSpacing: "0.08em" }}
                    >
                      {tagText}
                    </span>
                    <span className="truncate">{label}</span>
                  </span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    requested {r.row.requested}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setFor(r.key, v - 1)}
                    className="w-7 h-7 rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] flex items-center justify-center text-muted-foreground hover:text-foreground text-sm"
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
                      setFor(r.key, isNaN(n) ? 0 : n);
                    }}
                    className="flex-1 h-8 rounded-md border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] text-center text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    onClick={() => setFor(r.key, v + 1)}
                    className="w-7 h-7 rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] flex items-center justify-center text-muted-foreground hover:text-foreground text-sm"
                  >
                    +
                  </button>
                </div>
                {short && (
                  <p className="text-[11px] text-status-warn flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Falls {r.row.requested - v} short of the commitment.
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        <div className={`px-5 py-3 border-t space-y-2 ${
          needsDestination
            ? "bg-amber-50 border-amber-300"
            : "bg-muted/20 border-[color:var(--ds-border-warm)]"
        }`}>
          <div className="flex items-center justify-between">
            <span className={`text-sm font-medium flex items-center gap-1.5 ${needsDestination ? "text-amber-900" : ""}`}>
              {needsDestination && <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />}
              Surplus
              {needsDestination && <span className="text-[10px] uppercase tracking-wide text-amber-700">— decide</span>}
            </span>
            <span className={`text-sm font-semibold tabular-nums ${needsDestination ? "text-amber-900" : ""}`}>
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

        <div className="px-5 py-4 border-t border-[color:var(--ds-border-warm)] flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[4px] border border-[color:var(--ds-border-warm)] px-4 py-2 text-sm"
          >
            Back
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="rounded-[4px] bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
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
          : "border-[color:var(--ds-border-warm)] text-muted-foreground hover:border-primary hover:text-primary"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
