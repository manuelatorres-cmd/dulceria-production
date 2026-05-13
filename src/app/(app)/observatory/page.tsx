"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  useOrders,
  useQuotes,
  useProductionPlans,
  useProductsList,
} from "@/lib/hooks";
import {
  PageHeader,
  Section,
  StatCard,
  HubCard,
} from "@/components/dulceria";
import { IconTrendingUp, IconArrowRight } from "@tabler/icons-react";

function formatEuro(n: number): string {
  return "€" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function ObservatoryPage() {
  const orders = useOrders();
  const quotes = useQuotes();
  const plans = useProductionPlans();
  const products = useProductsList();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const mtdRevenue = useMemo(
    () =>
      orders
        .filter((o) => o.createdAt && new Date(o.createdAt) >= monthStart)
        .reduce((s, o) => s + (o.pricePaid ?? 0), 0),
    [orders, monthStart],
  );

  const prevMonthRevenue = useMemo(
    () =>
      orders
        .filter((o) => {
          if (!o.createdAt) return false;
          const d = new Date(o.createdAt);
          return d >= prevMonthStart && d < monthStart;
        })
        .reduce((s, o) => s + (o.pricePaid ?? 0), 0),
    [orders, prevMonthStart, monthStart],
  );

  const monthlyDelta = prevMonthRevenue
    ? Math.round(((mtdRevenue - prevMonthRevenue) / prevMonthRevenue) * 100)
    : null;

  const wonQuotes = quotes.filter((q) => q.status === "won").length;
  const sentQuotes = quotes.filter((q) => q.status === "sent").length;

  const monthPlans = plans.filter(
    (p) => p.status === "done" && p.completedAt && new Date(p.completedAt) >= monthStart,
  );

  const recentDoneBatches = useMemo(
    () =>
      [...plans]
        .filter((p) => p.status === "done")
        .sort(
          (a, b) =>
            new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime(),
        )
        .slice(0, 5),
    [plans],
  );

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title="Observatory"
        meta="Margins, trends, and production insights across the business"
      />

      <div style={{ padding: "16px 32px 40px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          <StatCard
            variant={monthlyDelta == null ? "default" : monthlyDelta >= 0 ? "ok" : "warn"}
            label="Revenue · MTD"
            value={formatEuro(mtdRevenue)}
            meta={
              monthlyDelta == null
                ? "first month of data"
                : `${monthlyDelta >= 0 ? "+" : ""}${monthlyDelta}% vs prev`
            }
            onClick={() => (window.location.href = "/reports/monthly")}
          />
          <StatCard
            variant="default"
            label="Quotes · open"
            value={sentQuotes}
            meta={`${wonQuotes} won ever`}
            onClick={() => (window.location.href = "/quotes")}
          />
          <StatCard
            variant="default"
            label="Batches · MTD"
            value={monthPlans.length}
            meta="completed this month"
            onClick={() => (window.location.href = "/stats")}
          />
          <StatCard
            variant="default"
            label="Products"
            value={products.length}
            meta="catalogue"
            onClick={() => (window.location.href = "/observatory/product-cost")}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
            gap: 12,
          }}
        >
          <Section
            title="Recent completed batches"
            action={
              <Link
                href="/production-brain/daily"
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: "var(--ds-text-muted)",
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
                className="hover:[color:var(--ds-text-primary)]"
              >
                Open <IconArrowRight size={11} stroke={1.5} />
              </Link>
            }
          >
            {recentDoneBatches.length === 0 ? (
              <p
                style={{
                  padding: "16px",
                  fontStyle: "italic",
                  fontFamily: "var(--font-serif)",
                  color: "var(--ds-text-muted)",
                  fontSize: 12,
                }}
              >
                No finished batches yet. Once you complete one it'll show up here.
              </p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {recentDoneBatches.map((p) => (
                  <li key={p.id} style={{ borderTop: "0.5px solid var(--ds-border-warm)" }}>
                    <Link
                      href={`/production/${p.id}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 16px",
                        textDecoration: "none",
                        color: "inherit",
                      }}
                      className="hover:bg-[color:var(--ds-card-bg-hover)]"
                    >
                      <IconTrendingUp
                        size={14}
                        stroke={1.5}
                        style={{ color: "var(--ds-text-muted)", flexShrink: 0 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {p.name ?? `Batch ${p.batchNumber ?? ""}`}
                        </p>
                        <p style={{ fontSize: 11, color: "var(--ds-text-muted)" }}>
                          {p.completedAt
                            ? new Date(p.completedAt).toLocaleDateString(undefined, {
                                day: "numeric",
                                month: "short",
                              })
                            : "—"}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="This month · highlights"
            action={
              <Link
                href="/reports/monthly"
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: "var(--ds-text-muted)",
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
                className="hover:[color:var(--ds-text-primary)]"
              >
                Open <IconArrowRight size={11} stroke={1.5} />
              </Link>
            }
          >
            <dl
              style={{
                padding: "12px 16px 16px",
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                rowGap: 12,
                columnGap: 16,
                margin: 0,
              }}
            >
              <Stat label="Orders this month">
                {orders.filter((o) => o.createdAt && new Date(o.createdAt) >= monthStart).length}
              </Stat>
              <Stat label="Orders last month">
                {
                  orders.filter((o) => {
                    if (!o.createdAt) return false;
                    const d = new Date(o.createdAt);
                    return d >= prevMonthStart && d < monthStart;
                  }).length
                }
              </Stat>
              <Stat label="Batches completed">{monthPlans.length}</Stat>
              <Stat label="Quotes sent">
                {quotes.filter((q) => q.createdAt && new Date(q.createdAt) >= monthStart).length}
              </Stat>
            </dl>
          </Section>
        </div>

        <Section title="Quick actions">
          <div
            style={{
              padding: 16,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            <HubCard
              href="/reports/monthly"
              icon="ChartHistogram"
              title="Monthly review"
              description="Revenue by channel, margin, yield"
            />
            <HubCard
              href="/pricing"
              icon="Tag"
              title="Pricing"
              description="Variant + box margin health"
            />
            <HubCard
              href="/stats"
              icon="ChartLine"
              title="Stats"
              description="Production trend per product"
            />
            <HubCard
              href="/observatory/product-cost"
              icon="Receipt"
              title="Product cost"
              description="Cost breakdown + comparable products"
            />
            <HubCard
              href="/imports"
              icon="FileUpload"
              title="CSV imports"
              description="Shopify + HelloCash sync"
            />
          </div>
        </Section>
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt
        style={{
          fontSize: 9,
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          color: "var(--ds-text-muted)",
          fontWeight: 600,
        }}
      >
        {label}
      </dt>
      <dd
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 22,
          fontWeight: 500,
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
          marginTop: 2,
          color: "var(--ds-text-primary)",
        }}
      >
        {children}
      </dd>
    </div>
  );
}
