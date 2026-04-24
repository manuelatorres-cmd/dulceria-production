"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { useOrder, useOrderItems, useProductsList, useProductLocationTotals, shipOnlineOrder } from "@/lib/hooks";
import { ArrowLeft, Printer, Truck } from "lucide-react";

export default function OnlineOrderPackingSlipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = use(params);
  const orderId = decodeURIComponent(idStr);
  const order = useOrder(orderId);
  const items = useOrderItems(orderId);
  const products = useProductsList(true);
  const locationTotals = useProductLocationTotals();
  const productById = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);

  if (order === undefined) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (order === null) {
    return (
      <div className="p-6">
        <Link href="/orders/online" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> Online orders
        </Link>
        <p className="mt-6 text-sm text-muted-foreground">Order not found.</p>
      </div>
    );
  }

  const shortfall = items.some((it) => {
    const avail = locationTotals.get(it.productId)?.production ?? 0;
    return it.quantity > avail;
  });
  const placed = order.createdAt ? new Date(order.createdAt) : null;
  const deadline = new Date(order.deadline);

  async function handleShip() {
    if (!confirm("Deduct these pieces from Production Storage and mark shipped?")) return;
    await shipOnlineOrder(orderId);
  }

  return (
    <div>
      <PageHeader title={`Packing slip · ${order.sourceRef ?? order.id}`} description={order.customerName ?? undefined} />
      <div className="px-4 pb-10 space-y-4 print:pb-0">
        {/* Toolbar — hidden on print */}
        <div className="flex items-center justify-between print:hidden">
          <Link href="/orders/online" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" /> Online orders
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1 rounded-sm border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary"
            >
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
            {order.status !== "done" && (
              <button
                onClick={handleShip}
                disabled={shortfall}
                title={shortfall ? "Short on stock — produce more before shipping" : undefined}
                className="inline-flex items-center gap-1 rounded-sm bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              >
                <Truck className="w-3.5 h-3.5" /> Mark shipped
              </button>
            )}
          </div>
        </div>

        {/* The sheet — everything below is the packing slip */}
        <div className="rounded-sm border border-border bg-card p-6 space-y-5 print:border-0 print:p-0 print:shadow-none">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Packing slip</p>
              <h1 className="text-2xl font-bold">{order.sourceRef ?? order.id}</h1>
              <p className="text-xs text-muted-foreground mt-1">
                {placed && <>Placed {placed.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} · </>}
                Ship by {deadline.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
              </p>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <p className="font-semibold text-foreground">Dulceria GmbH</p>
              <p>Lilienbrunngasse 5/1A</p>
              <p>1020 Wien, Austria</p>
            </div>
          </div>

          <div className="rounded-md bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">Ship to</p>
            <p className="text-sm font-semibold">{order.customerName ?? "—"}</p>
            {order.deliveryAddress && <p className="text-xs whitespace-pre-line">{order.deliveryAddress}</p>}
            {order.notes && <p className="text-[11px] text-muted-foreground mt-1">{order.notes}</p>}
          </div>

          <div>
            <h2 className="text-sm font-semibold text-primary mb-2">Items</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-1.5">Product</th>
                  <th className="py-1.5 text-right w-20">Qty</th>
                  <th className="py-1.5 text-right w-28 print:hidden">In production</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const product = productById.get(it.productId);
                  const avail = locationTotals.get(it.productId)?.production ?? 0;
                  const short = Math.max(0, it.quantity - avail);
                  return (
                    <tr key={it.id} className="border-b border-border/50">
                      <td className="py-1.5">{product?.name ?? it.productId}</td>
                      <td className="py-1.5 text-right tabular-nums">{it.quantity}</td>
                      <td className={`py-1.5 text-right tabular-nums print:hidden ${short > 0 ? "text-status-warn" : "text-muted-foreground"}`}>
                        {short > 0 ? `short ${short}` : avail}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="pt-3 border-t border-border text-[11px] text-muted-foreground">
            <p>Thanks for your order. Questions? manuela.torres@dulceria-gmbh.com</p>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @media print {
          body { background: white !important; }
          nav, aside, header, .print\\:hidden { display: none !important; }
          main { padding: 0 !important; }
        }
      `}</style>
    </div>
  );
}
