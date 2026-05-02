"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useOrders, useAllOrderItems, useProductsList, markOrderAsPacked, saveOrder } from "@/lib/hooks";
import { ORDER_CHANNEL_LABELS } from "@/types";
import type { OrderStatus } from "@/types";
import { Package, AlertTriangle, Check, ExternalLink } from "lucide-react";

/**
 * Picking — bulk pack-and-ship view for orders that already have stock
 * allocated. The intake step (Shopify import or native form) auto-flips
 * order.status to 'ready_to_pack' once every borrow line has matching
 * allocated stockLocations rows; this page just lists those orders so
 * the operator can clear them in batch without drilling into each.
 *
 * Click "Pack & ship" → markOrderAsPacked drains allocated → 'sold',
 * deducts packaging, then status flips to 'done'. Errors per-order are
 * shown inline; one failure doesn't block the rest.
 */
export default function PickingPage() {
  const orders = useOrders();
  const items = useAllOrderItems();
  const products = useProductsList();
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Record<string, { pieces: number; warnings: string[] }>>({});

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id!, p])),
    [products],
  );
  const itemsByOrder = useMemo(() => {
    const m = new Map<string, typeof items>();
    for (const it of items) {
      const arr = m.get(it.orderId) ?? [];
      arr.push(it);
      m.set(it.orderId, arr);
    }
    return m;
  }, [items]);

  // Show ready_to_pack first, then borrow-only pending orders (in case
  // refresh hasn't promoted yet) — operator can still pack those if
  // intake skipped the auto-flip.
  const ready = useMemo(() => {
    return orders
      .filter((o) => o.status === "ready_to_pack")
      .sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""));
  }, [orders]);

  async function handlePack(orderId: string) {
    setBusy((b) => ({ ...b, [orderId]: true }));
    setErrors((e) => ({ ...e, [orderId]: "" }));
    try {
      const result = await markOrderAsPacked(orderId);
      // Promote to 'done' once stock + packaging are off the books.
      const ord = orders.find((o) => o.id === orderId);
      if (ord) {
        await saveOrder({ ...ord, status: "done" });
      }
      setDone((d) => ({
        ...d,
        [orderId]: { pieces: result.piecesMoved, warnings: result.warnings },
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrors((er) => ({ ...er, [orderId]: msg }));
    } finally {
      setBusy((b) => ({ ...b, [orderId]: false }));
    }
  }

  return (
    <div className="px-6 py-5 max-w-5xl mx-auto">
      <div className="flex items-baseline gap-3 mb-4">
        <h1
          className="text-3xl"
          style={{ fontFamily: "var(--font-serif)", fontWeight: 400, letterSpacing: "-0.02em" }}
        >
          Picking
        </h1>
        <p className="text-sm text-muted-foreground">
          Orders ready to pack — stock already allocated. Click to ship.
        </p>
      </div>

      {ready.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <Package className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No orders ready to pack. New online imports + B2B / event orders with allocated
            stock will appear here automatically.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {ready.map((o) => {
            const orderItems = itemsByOrder.get(o.id!) ?? [];
            const totalPieces = orderItems.reduce((s, it) => s + (it.quantity ?? 0), 0);
            const isBusy = busy[o.id!] ?? false;
            const err = errors[o.id!];
            const completed = done[o.id!];
            return (
              <li
                key={o.id}
                className={
                  "rounded-lg border p-3 flex items-start gap-3 transition " +
                  (completed
                    ? "border-status-ok-bg bg-status-ok-bg/30"
                    : err
                    ? "border-status-blush-bg bg-status-blush-bg/30"
                    : "border-border bg-card")
                }
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-[13px] font-medium">
                      {o.customerName ?? o.sourceRef ?? "Anonymous"}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      · {ORDER_CHANNEL_LABELS[o.channel] ?? o.channel}
                    </span>
                    {o.sourceRef && (
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        · {o.sourceRef}
                      </span>
                    )}
                    {o.deadline && (
                      <span className="text-[11px] text-muted-foreground">
                        · due {new Date(o.deadline).toLocaleDateString("de-AT", { day: "numeric", month: "short" })}
                      </span>
                    )}
                    <Link
                      href={`/orders/${o.id}`}
                      className="ml-auto text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                    >
                      open <ExternalLink className="w-3 h-3" />
                    </Link>
                  </div>
                  <p className="text-[12px] text-muted-foreground mt-0.5">
                    {orderItems.length} line{orderItems.length === 1 ? "" : "s"} ·{" "}
                    {totalPieces} piece{totalPieces === 1 ? "" : "s"}
                  </p>
                  <ul className="mt-1.5 text-[12px] space-y-0.5">
                    {orderItems.slice(0, 5).map((it, i) => (
                      <li key={i} className="text-muted-foreground">
                        {it.quantity}× {productById.get(it.productId)?.name ?? it.productId.slice(0, 8)}
                      </li>
                    ))}
                    {orderItems.length > 5 && (
                      <li className="text-muted-foreground/70">
                        + {orderItems.length - 5} more
                      </li>
                    )}
                  </ul>
                  {err && (
                    <p className="text-[11px] text-status-blush mt-1.5 flex items-start gap-1">
                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                      {err}
                    </p>
                  )}
                  {completed && (
                    <p className="text-[11px] text-status-ok mt-1.5 flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      Packed · {completed.pieces} pcs moved
                      {completed.warnings.length > 0 && ` · ${completed.warnings.length} warning(s)`}
                    </p>
                  )}
                </div>
                {!completed && (
                  <button
                    type="button"
                    onClick={() => handlePack(o.id!)}
                    disabled={isBusy}
                    className="rounded-full px-3 py-1.5 text-xs font-medium bg-foreground text-background hover:opacity-90 disabled:opacity-50 shrink-0"
                  >
                    {isBusy ? "Packing…" : "Pack & ship"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
