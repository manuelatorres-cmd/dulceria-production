"use client";

import { use, useMemo, Fragment } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import {
  useOrder, useOrderItems, useProductsList, useProductLocationTotals, shipOnlineOrder,
  useOrderVariantLines, useVariants, useAllVariantPackagings, usePackagingList,
} from "@/lib/hooks";
import { ArrowLeft, Printer, Truck } from "lucide-react";

export default function OnlineOrderPackingSlipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = use(params);
  const orderId = decodeURIComponent(idStr);
  const order = useOrder(orderId);
  const items = useOrderItems(orderId);
  const variantLines = useOrderVariantLines(orderId);
  const variants = useVariants();
  const variantPackagings = useAllVariantPackagings();
  const packaging = usePackagingList(true);
  const products = useProductsList(true);
  const locationTotals = useProductLocationTotals();
  const productById = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const variantById = useMemo(() => new Map(variants.map((v) => [v.id!, v])), [variants]);
  const vpById = useMemo(() => new Map(variantPackagings.map((vp) => [vp.id!, vp])), [variantPackagings]);
  const packagingById = useMemo(() => new Map(packaging.map((p) => [p.id!, p])), [packaging]);
  // Group derived orderItems under their parent variantLine so the
  // packing slip reads as customer-facing SKUs, not raw chocolate
  // demand. Items without a variantId are loose products.
  const itemsByVariantLine = useMemo(() => {
    const m = new Map<string, typeof items>();
    const loose: typeof items = [];
    for (const it of items) {
      if (!it.variantId) {
        loose.push(it);
        continue;
      }
      // Match to the variantLine by variantId + variantPackagingId.
      const vl = variantLines.find(
        (l) => l.variantId === it.variantId
          && (l.variantPackagingId ?? null) === (it.variantPackagingId ?? null),
      );
      const key = vl?.id ?? `_orphan:${it.variantId}`;
      const arr = m.get(key) ?? [];
      arr.push(it);
      m.set(key, arr);
    }
    return { byLine: m, loose };
  }, [items, variantLines]);

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
                {placed && <>Placed {placed.toLocaleDateString("de-AT", { day: "numeric", month: "long", year: "numeric" })} · </>}
                Ship by {deadline.toLocaleDateString("de-AT", { day: "numeric", month: "long", year: "numeric" })}
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
            {variantLines.length === 0 && items.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No items on this order.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-1.5">Product</th>
                    <th className="py-1.5 text-right w-20">Qty</th>
                    <th className="py-1.5 text-right w-28 print:hidden">In production</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Variant lines (the customer-facing SKUs) — print as
                      one row each. Composition (chocolates inside) shown
                      as indented sub-rows for the picker. */}
                  {variantLines.map((vl) => {
                    const v = variantById.get(vl.variantId);
                    const vp = vl.variantPackagingId ? vpById.get(vl.variantPackagingId) : null;
                    const sizeLabel = vp?.packagingId
                      ? packagingById.get(vp.packagingId)?.name
                      : (vp ? "loose" : null);
                    const composition = itemsByVariantLine.byLine.get(vl.id ?? "") ?? [];
                    return (
                      <Fragment key={vl.id}>
                        <tr className="border-b border-border/50">
                          <td className="py-1.5 font-medium">
                            {v?.name ?? "Variant"}
                            {sizeLabel && <span className="text-muted-foreground"> · {sizeLabel}</span>}
                          </td>
                          <td className="py-1.5 text-right tabular-nums font-medium">{vl.quantity}</td>
                          <td className="py-1.5 text-right text-muted-foreground print:hidden text-[11px]">
                            {composition.length > 0 ? `${composition.length} chocolates` : "—"}
                          </td>
                        </tr>
                        {composition.map((it) => {
                          const product = productById.get(it.productId);
                          const avail = locationTotals.get(it.productId)?.production ?? 0;
                          const short = Math.max(0, it.quantity - avail);
                          return (
                            <tr key={it.id} className="border-b border-border/30 text-[12px]">
                              <td className="py-1 pl-4 text-muted-foreground">↳ {product?.name ?? it.productId}</td>
                              <td className="py-1 text-right tabular-nums text-muted-foreground">{it.quantity}</td>
                              <td className={`py-1 text-right tabular-nums print:hidden text-[11px] ${short > 0 ? "text-status-warn" : "text-muted-foreground"}`}>
                                {short > 0 ? `short ${short}` : avail}
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                  {/* Loose orderItems (bars, specials, single products
                      without a variant). */}
                  {itemsByVariantLine.loose.map((it) => {
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
            )}
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
