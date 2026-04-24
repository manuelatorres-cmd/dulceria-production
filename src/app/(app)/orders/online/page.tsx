"use client";

import { useMemo } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import {
  useOrders, useAllOrderItems, useProductsList,
  useProductLocationTotals, shipOnlineOrder,
} from "@/lib/hooks";
import { Upload, FileText, Truck, ShoppingCart } from "lucide-react";

export default function OnlineOrdersPage() {
  const orders = useOrders();
  const items = useAllOrderItems();
  const products = useProductsList(true);
  const locationTotals = useProductLocationTotals();

  const productMap = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);

  const onlineOrders = useMemo(
    () => orders
      .filter((o) => o.channel === "online" && (o.status === "pending" || o.status === "in_production"))
      .sort((a, b) => a.deadline.localeCompare(b.deadline)),
    [orders],
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

  // Combined demand: each product's total ordered across all open online
  // orders vs what's available in Production Storage right now.
  const combinedDemand = useMemo(() => {
    const demand = new Map<string, number>();
    for (const o of onlineOrders) {
      for (const it of itemsByOrder.get(o.id!) ?? []) {
        demand.set(it.productId, (demand.get(it.productId) ?? 0) + it.quantity);
      }
    }
    return Array.from(demand.entries())
      .map(([productId, needed]) => {
        const totals = locationTotals.get(productId);
        const available = totals?.production ?? 0;
        const short = Math.max(0, needed - available);
        return { productId, needed, available, short };
      })
      .sort((a, b) => b.short - a.short);
  }, [onlineOrders, itemsByOrder, locationTotals]);

  const totalShort = combinedDemand.reduce((a, r) => a + r.short, 0);

  return (
    <div>
      <PageHeader title="Online orders" description="Shopify orders + production storage fulfilment" />

      <div className="px-4 pb-10 space-y-5">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {onlineOrders.length} open order{onlineOrders.length === 1 ? "" : "s"}
            {totalShort > 0 && ` · ${totalShort} pcs short across Production Storage`}
          </p>
          <Link
            href="/orders/online/import"
            className="inline-flex items-center gap-1.5 rounded-sm bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium"
          >
            <Upload className="w-4 h-4" /> Import Shopify CSV
          </Link>
        </div>

        {/* Combined demand view */}
        {combinedDemand.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-primary flex items-center gap-1.5">
                <ShoppingCart className="w-4 h-4" /> What needs producing
              </h2>
            </div>
            <div className="rounded-sm border border-border bg-card overflow-hidden">
              <div className="flex items-center px-3 py-1.5 bg-muted/30 border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                <span className="flex-1">Product</span>
                <span className="w-20 text-right">Ordered</span>
                <span className="w-24 text-right">In production</span>
                <span className="w-20 text-right">Short</span>
              </div>
              {combinedDemand.map((row) => {
                const product = productMap.get(row.productId);
                const cls = row.short > 0 ? "text-status-warn" : "text-status-ok";
                return (
                  <div key={row.productId} className="flex items-center px-3 py-1.5 border-b border-border last:border-b-0 text-sm">
                    <span className="flex-1 truncate">{product?.name ?? row.productId}</span>
                    <span className="w-20 text-right tabular-nums">{row.needed}</span>
                    <span className="w-24 text-right tabular-nums">{row.available}</span>
                    <span className={`w-20 text-right tabular-nums ${cls}`}>{row.short > 0 ? row.short : "—"}</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Per-order list */}
        <section>
          <h2 className="text-sm font-semibold text-primary mb-2">Orders</h2>
          {onlineOrders.length === 0 ? (
            <div className="rounded-sm border border-dashed border-border bg-card p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No open online orders. Import a Shopify CSV to get started.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {onlineOrders.map((o) => {
                const lines = itemsByOrder.get(o.id!) ?? [];
                const deadline = new Date(o.deadline);
                const daysToDeadline = Math.round((deadline.getTime() - Date.now()) / 86_400_000);
                const deadlineCls = daysToDeadline < 0
                  ? "text-status-alert"
                  : daysToDeadline <= 2
                    ? "text-status-warn"
                    : "text-muted-foreground";
                const lineShortfall = lines.some((it) => {
                  const avail = locationTotals.get(it.productId)?.production ?? 0;
                  return it.quantity > avail;
                });
                return (
                  <li key={o.id} className="rounded-sm border border-border bg-card p-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">
                          {o.sourceRef ? `${o.sourceRef} · ` : ""}{o.customerName || "Anonymous"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {o.deliveryAddress ?? "No shipping address"}
                        </p>
                        <p className={`text-[11px] ${deadlineCls}`}>
                          {daysToDeadline < 0 ? "overdue" : daysToDeadline === 0 ? "today" : daysToDeadline === 1 ? "tomorrow" : `in ${daysToDeadline}d`}
                          {" · "}
                          deadline {deadline.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/orders/online/${encodeURIComponent(o.id!)}`}
                          className="inline-flex items-center gap-1 rounded-sm border border-border px-2.5 py-1 text-xs hover:border-primary hover:text-primary"
                        >
                          <FileText className="w-3 h-3" /> Packing slip
                        </Link>
                        <ShipButton orderId={o.id!} disabled={lineShortfall} />
                      </div>
                    </div>
                    <ul className="mt-2 divide-y divide-border rounded-md border border-border">
                      {lines.map((it) => {
                        const avail = locationTotals.get(it.productId)?.production ?? 0;
                        const short = Math.max(0, it.quantity - avail);
                        const product = productMap.get(it.productId);
                        return (
                          <li key={it.id} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                            <span className="flex-1 truncate">{product?.name ?? it.productId}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">× {it.quantity}</span>
                            <span className={`text-xs tabular-nums w-24 text-right ${short > 0 ? "text-status-warn" : "text-status-ok"}`}>
                              {short > 0 ? `short ${short}` : `available ${avail}`}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
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

function ShipButton({ orderId, disabled }: { orderId: string; disabled: boolean }) {
  async function handleClick() {
    if (!confirm("Deduct these pieces from Production Storage and mark the order shipped?")) return;
    await shipOnlineOrder(orderId);
  }
  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      title={disabled ? "Not enough stock in Production Storage" : "Deduct pieces and mark shipped"}
      className="inline-flex items-center gap-1 rounded-sm bg-primary text-primary-foreground px-2.5 py-1 text-xs font-medium disabled:opacity-50"
    >
      <Truck className="w-3 h-3" /> Ship
    </button>
  );
}
