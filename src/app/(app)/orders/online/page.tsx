"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/dulceria";
import {
  useOrders, useAllOrderItems, useProductsList,
  useProductLocationTotals, shipOnlineOrder,
} from "@/lib/hooks";
import { IconUpload as Upload, IconFileText as FileText, IconTruck as Truck, IconShoppingCart as ShoppingCart } from "@tabler/icons-react";

export default function OnlineOrdersPage() {
  const orders = useOrders();
  const items = useAllOrderItems();
  const products = useProductsList(true);
  const locationTotals = useProductLocationTotals();

  const productMap = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);

  const [deliveryFilter, setDeliveryFilter] = useState<"all" | "pickup" | "ship">("all");

  const onlineOrders = useMemo(
    () => orders
      .filter((o) => o.channel === "online" && (o.status === "pending" || o.status === "in_production"))
      .filter((o) => deliveryFilter === "all" || o.deliveryType === deliveryFilter)
      .sort((a, b) => a.deadline.localeCompare(b.deadline)),
    [orders, deliveryFilter],
  );

  const allOnline = useMemo(
    () => orders.filter((o) => o.channel === "online" && (o.status === "pending" || o.status === "in_production")),
    [orders],
  );
  const pickupCount = allOnline.filter((o) => o.deliveryType === "pickup").length;
  const shipCount = allOnline.filter((o) => o.deliveryType === "ship").length;

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
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader title="Online orders" meta="Shopify orders + production storage fulfilment" />

      <div className="px-4 pb-10 space-y-5">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {onlineOrders.length} open order{onlineOrders.length === 1 ? "" : "s"}
            {totalShort > 0 && ` · ${totalShort} pcs short across Production Storage`}
          </p>
          <div className="flex gap-2">
            <Link
              href="/orders/online/import"
              className="inline-flex items-center gap-1.5 rounded-sm bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium"
            >
              <Upload className="w-4 h-4" /> Import Shopify CSV
            </Link>
            <Link
              href="/orders/online/import-bonbons"
              className="inline-flex items-center gap-1.5 rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-3 py-1.5 text-sm font-medium hover:border-foreground/30"
            >
              <Upload className="w-4 h-4" /> Import box contents
            </Link>
          </div>
        </div>

        {/* Combined demand view */}
        {combinedDemand.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-primary flex items-center gap-1.5">
                <ShoppingCart className="w-4 h-4" /> What needs producing
              </h2>
            </div>
            <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] overflow-hidden">
              <div className="flex items-center px-3 py-1.5 bg-muted border-b border-[color:var(--ds-border-warm)] text-[10px] uppercase tracking-wide text-muted-foreground">
                <span className="flex-1">Product</span>
                <span className="w-20 text-right">Ordered</span>
                <span className="w-24 text-right">In production</span>
                <span className="w-20 text-right">Short</span>
              </div>
              {combinedDemand.map((row) => {
                const product = productMap.get(row.productId);
                const cls = row.short > 0 ? "text-status-warn" : "text-status-ok";
                return (
                  <div key={row.productId} className="flex items-center px-3 py-1.5 border-b border-[color:var(--ds-border-warm)] last:border-b-0 text-sm">
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
          <div className="flex items-baseline gap-3 mb-2 flex-wrap">
            <h2 className="text-sm font-semibold text-primary">Orders</h2>
            <div className="flex items-center gap-1.5">
              {(["all", "pickup", "ship"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setDeliveryFilter(k)}
                  className={
                    "text-[11.5px] px-2.5 py-0.5 rounded-full border transition " +
                    (deliveryFilter === k
                      ? "bg-foreground text-background border-foreground"
                      : "bg-[color:var(--ds-card-bg)] border-[color:var(--ds-border-warm)] text-foreground hover:border-foreground")
                  }
                >
                  {k === "all" ? `All (${allOnline.length})`
                    : k === "pickup" ? `Pickup (${pickupCount})`
                      : `Ship (${shipCount})`}
                </button>
              ))}
            </div>
          </div>
          {onlineOrders.length === 0 ? (
            <div className="rounded-sm border border-dashed border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-8 text-center">
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
                  <li key={o.id} className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold">
                            {o.sourceRef ? `${o.sourceRef} · ` : ""}{o.customerName || "Anonymous"}
                          </p>
                          <DeliveryPill type={o.deliveryType} />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {o.deliveryAddress ?? "No shipping address"}
                        </p>
                        <p className={`text-[11px] ${deadlineCls}`}>
                          {daysToDeadline < 0 ? "overdue" : daysToDeadline === 0 ? "today" : daysToDeadline === 1 ? "tomorrow" : `in ${daysToDeadline}d`}
                          {" · "}
                          deadline {deadline.toLocaleDateString("de-AT", { day: "numeric", month: "short" })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/orders/online/${encodeURIComponent(o.id!)}`}
                          className="inline-flex items-center gap-1 rounded-sm border border-[color:var(--ds-border-warm)] px-2.5 py-1 text-xs hover:border-primary hover:text-primary"
                        >
                          <FileText className="w-3 h-3" /> Packing slip
                        </Link>
                        <ShipButton orderId={o.id!} disabled={lineShortfall} />
                      </div>
                    </div>
                    <ul className="mt-2 divide-y divide-border rounded-md border border-[color:var(--ds-border-warm)]">
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

function DeliveryPill({ type }: { type?: string | null }) {
  const isShip = type === "ship";
  const isPickup = type === "pickup";
  if (!isShip && !isPickup) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full"
      style={
        isShip
          ? { background: "#eff5fb", color: "#4b6b8f", border: "1px solid #cfe0f0" }
          : { background: "#e3ebe6", color: "#2e4839", border: "1px solid #c8d4cc" }
      }
    >
      {isShip ? "🚚 Ship" : "🛍 Pickup"}
    </span>
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
