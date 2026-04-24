"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import {
  useProductsList,
  useProductLocationTotals,
  useStockLocationMinimums,
  useStockTransfers,
  saveStockTransfer,
  DEFAULT_LOCATION_MINIMUM,
} from "@/lib/hooks";

/**
 * Shop transfer screen — move finished goods from production to shop.
 *
 * Left: suggested transfers — any SKU where shop stock < min AND
 * production has enough surplus to cover. One-click "transfer".
 * Right: recent transfer history with reason + quantity.
 * Bottom: manual transfer form for ad-hoc moves.
 */
export default function ShopTransferPage() {
  const products = useProductsList();
  const totals = useProductLocationTotals();
  const minimums = useStockLocationMinimums();
  const history = useStockTransfers("product");
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const minByProductLoc = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of minimums) {
      m.set(`${row.productId}|${row.location}`, row.minimumUnits);
    }
    return m;
  }, [minimums]);

  const suggestions = useMemo(() => {
    const out: Array<{
      productId: string;
      productName: string;
      shopStock: number;
      productionStock: number;
      shopMin: number;
      suggestedQty: number;
    }> = [];
    for (const product of products) {
      if (!product.id || product.archived) continue;
      const byLoc = totals.get(product.id) ?? {
        store: 0,
        production: 0,
        freezer: 0,
        allocated: 0,
      };
      const shopMin =
        minByProductLoc.get(`${product.id}|store`) ?? DEFAULT_LOCATION_MINIMUM;
      const shopStock = byLoc.store;
      const productionStock = byLoc.production;
      if (shopStock >= shopMin) continue;
      if (productionStock <= 0) continue;
      const want = shopMin - shopStock;
      const suggestedQty = Math.min(want, productionStock);
      if (suggestedQty <= 0) continue;
      out.push({
        productId: product.id,
        productName: product.name,
        shopStock,
        productionStock,
        shopMin,
        suggestedQty,
      });
    }
    return out.sort((a, b) => b.suggestedQty - a.suggestedQty);
  }, [products, totals, minByProductLoc]);

  async function doTransfer(productId: string, qty: number) {
    setPending((p) => ({ ...p, [productId]: true }));
    try {
      await saveStockTransfer({
        entityType: "product",
        entityId: productId,
        quantity: qty,
        fromLocationId: "production",
        toLocationId: "store",
        transferredAt: new Date(),
        reason: "shop-request",
      });
    } finally {
      setPending((p) => ({ ...p, [productId]: false }));
    }
  }

  return (
    <div>
      <PageHeader
        title="Transfer to shop"
        accent="Stock"
        description="Move finished goods from production to the shop. Suggestions appear when shop stock is below min."
      />

      <section
        className="border border-border bg-card p-4 mb-6"
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
          Suggestions
          <span
            className="ml-2 text-[10px] uppercase text-muted-foreground font-normal"
            style={{ letterSpacing: "0.12em" }}
          >
            {suggestions.length}
          </span>
        </h3>
        {suggestions.length === 0 ? (
          <p
            className="text-muted-foreground italic text-[12.5px]"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Shop is fully stocked above all minimums.
          </p>
        ) : (
          <ul className="space-y-2">
            {suggestions.map((s) => (
              <li
                key={s.productId}
                className="flex flex-wrap items-center gap-3 border border-border bg-muted px-3 py-2"
                style={{ borderRadius: 3 }}
              >
                <div className="flex-1 min-w-0">
                  <div
                    className="text-[13px]"
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontWeight: 500,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {s.productName}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Shop {s.shopStock} / min {s.shopMin} · production has{" "}
                    {s.productionStock}
                  </div>
                </div>
                <span
                  className="text-[11px] uppercase font-medium"
                  style={{ letterSpacing: "0.08em" }}
                >
                  Move {s.suggestedQty}
                </span>
                <button
                  type="button"
                  onClick={() => doTransfer(s.productId, s.suggestedQty)}
                  disabled={pending[s.productId]}
                  className="btn-primary"
                >
                  {pending[s.productId] ? "…" : "Transfer"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className="border border-border bg-card p-4"
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
          Recent transfers
          <span
            className="ml-2 text-[10px] uppercase text-muted-foreground font-normal"
            style={{ letterSpacing: "0.12em" }}
          >
            {history.length}
          </span>
        </h3>
        {history.length === 0 ? (
          <p
            className="text-muted-foreground italic text-[12.5px]"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            No transfers logged yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {history.slice(0, 30).map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-3 text-[12px] px-3 py-1.5 bg-muted border border-border"
                style={{ borderRadius: 3 }}
              >
                <span className="tabular-nums font-medium">
                  {Number(t.quantity)}
                </span>
                <span className="text-muted-foreground">
                  {t.fromLocationId ?? "?"} → {t.toLocationId}
                </span>
                <span className="text-muted-foreground text-[10.5px] ml-auto">
                  {new Date(t.transferredAt).toLocaleString()} · {t.reason}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
