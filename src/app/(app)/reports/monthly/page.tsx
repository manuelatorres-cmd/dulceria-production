"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/dulceria";
import {
  useOrders,
  useAllOrderItems,
  useProductsList,
  useProductionPlans,
  useAllPlanProducts,
  useAllLatestProductCosts,
} from "@/lib/hooks";

/**
 * Monthly review dashboard. Auto-generates a snapshot for a given
 * month across the five priority metrics:
 *   1. Revenue by channel
 *   2. Gross margin per product (top 10)
 *   3. Yield % actual vs target per product
 *   4. Filling waste % (coming next commit once waste log exists)
 *   5. Cost of waste (coming next commit)
 *
 * Shows side-by-side comparison with previous month for every
 * metric that has history.
 */
export default function MonthlyReviewPage() {
  const now = new Date();
  const [yearMonth, setYearMonth] = useState<string>(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
  );

  const orders = useOrders();
  const orderItems = useAllOrderItems();
  const products = useProductsList();
  const plans = useProductionPlans();
  const planProducts = useAllPlanProducts();
  const productCosts = useAllLatestProductCosts();

  const [year, month] = useMemo(() => {
    const [y, m] = yearMonth.split("-");
    return [Number(y), Number(m)];
  }, [yearMonth]);

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));
  const prevStart = new Date(Date.UTC(year, month - 2, 1));
  const prevEnd = new Date(Date.UTC(year, month - 1, 1));

  const productsById = useMemo(() => {
    const m = new Map<string, typeof products[number]>();
    for (const p of products) if (p.id) m.set(p.id, p);
    return m;
  }, [products]);

  const ordersThisMonth = useMemo(
    () => filterOrdersByDeadline(orders, monthStart, monthEnd),
    [orders, monthStart, monthEnd],
  );
  const ordersPrevMonth = useMemo(
    () => filterOrdersByDeadline(orders, prevStart, prevEnd),
    [orders, prevStart, prevEnd],
  );

  // Revenue by channel
  const revenueByChannel = useMemo(
    () => computeRevenueByChannel(ordersThisMonth, orderItems),
    [ordersThisMonth, orderItems],
  );
  const revenueByChannelPrev = useMemo(
    () => computeRevenueByChannel(ordersPrevMonth, orderItems),
    [ordersPrevMonth, orderItems],
  );

  // Margin per product (top 10)
  const productMargins = useMemo(
    () => computeProductMargins(ordersThisMonth, orderItems, productsById, productCosts),
    [ordersThisMonth, orderItems, productsById, productCosts],
  );

  // Yield % per product
  const yieldByProduct = useMemo(
    () => computeYield(plans, planProducts, productsById, monthStart, monthEnd),
    [plans, planProducts, productsById, monthStart, monthEnd],
  );

  const totalRevenue = revenueByChannel.reduce((s, r) => s + r.gross, 0);
  const prevRevenue = revenueByChannelPrev.reduce((s, r) => s + r.gross, 0);

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title="Monthly review"
        meta="Auto-generated snapshot · pick any month to scan key metrics vs month before"
      />

      <div style={{ padding: "16px 32px 40px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="flex items-center gap-3">
        <label className="text-[10px] uppercase text-muted-foreground" style={{ letterSpacing: "0.12em" }}>
          Month
        </label>
        <input
          type="month"
          value={yearMonth}
          onChange={(e) => setYearMonth(e.target.value)}
          className="input"
          style={{ maxWidth: 160 }}
        />
      </div>

      {/* Revenue summary */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Kpi
          label="Total revenue"
          value={fmtEur(totalRevenue)}
          prev={prevRevenue > 0 ? fmtEur(prevRevenue) : undefined}
          delta={prevRevenue > 0 ? (totalRevenue - prevRevenue) / prevRevenue : undefined}
        />
        <Kpi
          label="Orders"
          value={ordersThisMonth.length.toString()}
          prev={ordersPrevMonth.length.toString()}
        />
        <Kpi
          label="Batches produced"
          value={plans
            .filter((p) => p.status === "done" && isInMonth(p.updatedAt, monthStart, monthEnd))
            .length.toString()}
        />
      </section>

      {/* Revenue by channel */}
      <ReportSection title="Revenue by channel">
        {revenueByChannel.length === 0 ? (
          <EmptyText>No revenue booked this month yet.</EmptyText>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left">
                {["Channel", "Orders", "Gross", "vs prev"].map((h) => (
                  <th
                    key={h}
                    className="py-2 text-[10px] uppercase text-muted-foreground font-medium"
                    style={{ letterSpacing: "0.1em" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {revenueByChannel.map((row) => {
                const prev = revenueByChannelPrev.find((r) => r.channel === row.channel);
                const delta = prev && prev.gross > 0 ? (row.gross - prev.gross) / prev.gross : undefined;
                return (
                  <tr key={row.channel} className="border-t border-border/60">
                    <td className="py-2 capitalize">{row.channel}</td>
                    <td className="py-2 tabular-nums">{row.orderCount}</td>
                    <td className="py-2 tabular-nums">{fmtEur(row.gross)}</td>
                    <td className="py-2">
                      {delta === undefined ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <DeltaPill delta={delta} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </ReportSection>

      {/* Margin per product */}
      <ReportSection title="Margin per product · top 10">
        {productMargins.length === 0 ? (
          <EmptyText>No priced orders this month.</EmptyText>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left">
                {["Product", "Qty sold", "Gross", "Margin %"].map((h) => (
                  <th
                    key={h}
                    className="py-2 text-[10px] uppercase text-muted-foreground font-medium"
                    style={{ letterSpacing: "0.1em" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {productMargins.slice(0, 10).map((m) => (
                <tr key={m.productId} className="border-t border-border/60">
                  <td
                    className="py-2"
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontWeight: 500,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {m.productName}
                  </td>
                  <td className="py-2 tabular-nums">{m.qty}</td>
                  <td className="py-2 tabular-nums">{fmtEur(m.gross)}</td>
                  <td className="py-2 tabular-nums">
                    {m.marginPct === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span
                        className={
                          m.marginPct < 30
                            ? "text-status-alert"
                            : m.marginPct < 50
                              ? "text-status-warn"
                              : "text-status-ok"
                        }
                      >
                        {m.marginPct.toFixed(0)}%
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportSection>

      {/* Yield per product */}
      <ReportSection title="Yield actual vs target">
        {yieldByProduct.length === 0 ? (
          <EmptyText>No batches completed this month.</EmptyText>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left">
                {["Product", "Target", "Actual", "%"].map((h) => (
                  <th
                    key={h}
                    className="py-2 text-[10px] uppercase text-muted-foreground font-medium"
                    style={{ letterSpacing: "0.1em" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {yieldByProduct.map((y) => (
                <tr key={y.productId} className="border-t border-border/60">
                  <td
                    className="py-2"
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontWeight: 500,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {y.productName}
                  </td>
                  <td className="py-2 tabular-nums">{y.target}</td>
                  <td className="py-2 tabular-nums">{y.actual}</td>
                  <td className="py-2 tabular-nums">
                    <span
                      className={
                        y.pct < 90
                          ? "text-status-alert"
                          : y.pct < 97
                            ? "text-status-warn"
                            : "text-status-ok"
                      }
                    >
                      {y.pct.toFixed(0)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportSection>

      <ReportSection title="Coming next">
        <ul className="text-[12.5px] text-muted-foreground list-disc pl-5 space-y-1">
          <li>Filling waste % (once waste log is tracked per cook day)</li>
          <li>Cost of waste (scrapped + contamination + near-expiry writeoffs)</li>
          <li>Year-over-year comparison when 12 months of history exist</li>
        </ul>
      </ReportSection>
      </div>
    </div>
  );
}

function filterOrdersByDeadline<T extends { deadline?: string; status?: string }>(
  orders: T[],
  start: Date,
  end: Date,
): T[] {
  return orders.filter((o) => {
    if (!o.deadline) return false;
    const d = new Date(o.deadline).getTime();
    return (
      d >= start.getTime() &&
      d < end.getTime() &&
      o.status !== "cancelled"
    );
  });
}

function computeRevenueByChannel<T extends { id?: string; channel: string }>(
  orders: T[],
  items: Array<{ orderId: string; unitPrice?: number; quantity: number }>,
) {
  const byChannel = new Map<string, { gross: number; orderCount: number }>();
  const orderIds = new Set(orders.map((o) => o.id).filter(Boolean));
  const byOrder = new Map<string, T>();
  for (const o of orders) if (o.id) byOrder.set(o.id, o);
  for (const item of items) {
    if (!orderIds.has(item.orderId)) continue;
    const order = byOrder.get(item.orderId);
    if (!order) continue;
    const price = item.unitPrice ?? 0;
    const revenue = price * item.quantity;
    const existing = byChannel.get(order.channel) ?? { gross: 0, orderCount: 0 };
    byChannel.set(order.channel, {
      gross: existing.gross + revenue,
      orderCount: existing.orderCount,
    });
  }
  for (const o of orders) {
    const existing = byChannel.get(o.channel) ?? { gross: 0, orderCount: 0 };
    byChannel.set(o.channel, { gross: existing.gross, orderCount: existing.orderCount + 1 });
  }
  return Array.from(byChannel.entries())
    .map(([channel, stats]) => ({ channel, ...stats }))
    .sort((a, b) => b.gross - a.gross);
}

function computeProductMargins(
  orders: Array<{ id?: string }>,
  items: Array<{ orderId: string; productId: string; unitPrice?: number; quantity: number }>,
  productsById: Map<string, { id?: string; name: string }>,
  productCosts: Map<string, number>,
) {
  const orderIds = new Set(orders.map((o) => o.id).filter(Boolean));
  const byProduct = new Map<string, { qty: number; gross: number }>();
  for (const item of items) {
    if (!orderIds.has(item.orderId)) continue;
    const price = item.unitPrice ?? 0;
    const existing = byProduct.get(item.productId) ?? { qty: 0, gross: 0 };
    byProduct.set(item.productId, {
      qty: existing.qty + item.quantity,
      gross: existing.gross + price * item.quantity,
    });
  }
  return Array.from(byProduct.entries())
    .map(([productId, stats]) => {
      const product = productsById.get(productId);
      // Margin requires both a known cost-per-product AND non-zero gross.
      // If no cost snapshot exists for this product, marginPct is null and
      // the UI renders `—`. Never invent numbers.
      const cost = productCosts.get(productId);
      let marginPct: number | null = null;
      if (typeof cost === "number" && cost >= 0 && stats.qty > 0 && stats.gross > 0) {
        const totalCost = cost * stats.qty;
        marginPct = ((stats.gross - totalCost) / stats.gross) * 100;
      }
      return {
        productId,
        productName: product?.name ?? productId.slice(0, 8),
        qty: stats.qty,
        gross: stats.gross,
        marginPct,
      };
    })
    .sort((a, b) => b.gross - a.gross);
}

function computeYield(
  plans: Array<{ id?: string; status?: string; updatedAt?: Date }>,
  planProducts: Array<{ planId: string; productId: string; quantity: number; actualYield?: number }>,
  productsById: Map<string, { id?: string; name: string }>,
  monthStart: Date,
  monthEnd: Date,
) {
  const donePlanIds = new Set(
    plans
      .filter(
        (p) =>
          p.status === "done" &&
          p.updatedAt &&
          isInMonth(p.updatedAt, monthStart, monthEnd) &&
          p.id,
      )
      .map((p) => p.id!),
  );
  const byProduct = new Map<string, { target: number; actual: number }>();
  for (const pp of planProducts) {
    if (!donePlanIds.has(pp.planId)) continue;
    const existing = byProduct.get(pp.productId) ?? { target: 0, actual: 0 };
    byProduct.set(pp.productId, {
      target: existing.target + pp.quantity,
      actual: existing.actual + (pp.actualYield ?? pp.quantity),
    });
  }
  return Array.from(byProduct.entries())
    .map(([productId, stats]) => ({
      productId,
      productName: productsById.get(productId)?.name ?? productId.slice(0, 8),
      target: stats.target,
      actual: stats.actual,
      pct: stats.target > 0 ? (stats.actual / stats.target) * 100 : 0,
    }))
    .sort((a, b) => a.pct - b.pct);
}

function isInMonth(
  date: Date | string | undefined,
  monthStart: Date,
  monthEnd: Date,
): boolean {
  if (!date) return false;
  const t = (date instanceof Date ? date : new Date(date)).getTime();
  return t >= monthStart.getTime() && t < monthEnd.getTime();
}

function fmtEur(n: number): string {
  return new Intl.NumberFormat("de-AT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

function Kpi({
  label,
  value,
  prev,
  delta,
}: {
  label: string;
  value: string;
  prev?: string;
  delta?: number;
}) {
  return (
    <div
      className="border border-border bg-card px-4 py-3"
      style={{ borderRadius: 4 }}
    >
      <div
        className="text-[10px] uppercase text-muted-foreground font-medium"
        style={{ letterSpacing: "0.12em" }}
      >
        {label}
      </div>
      <div
        className="text-[22px] tabular-nums"
        style={{
          fontFamily: "var(--font-serif)",
          fontWeight: 500,
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </div>
      {prev !== undefined ? (
        <div className="text-[10.5px] text-muted-foreground flex items-center gap-2">
          <span>Prev {prev}</span>
          {delta !== undefined ? <DeltaPill delta={delta} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function DeltaPill({ delta }: { delta: number }) {
  const up = delta >= 0;
  return (
    <span
      className={
        "text-[10px] uppercase font-medium " +
        (up ? "text-status-ok" : "text-status-alert")
      }
      style={{ letterSpacing: "0.1em" }}
    >
      {up ? "▲" : "▼"} {Math.abs(delta * 100).toFixed(1)}%
    </span>
  );
}

function ReportSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="mb-5 border border-border bg-card p-4"
      style={{ borderRadius: 4 }}
    >
      <h3
        className="text-[14px] mb-3"
        style={{
          fontFamily: "var(--font-serif)",
          fontWeight: 500,
          letterSpacing: "-0.012em",
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-muted-foreground italic text-[12.5px]"
      style={{ fontFamily: "var(--font-serif)" }}
    >
      {children}
    </p>
  );
}
