"use client";

import Link from "next/link";
import { useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import {
  useOrders,
  useQuotes,
  useProductionPlans,
  useProductsList,
} from "@/lib/hooks";
import {
  Euro,
  TrendingUp,
  FileText,
  BarChart3,
  ArrowRight,
  Scale,
} from "lucide-react";

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

  const mtdRevenue = useMemo(() => {
    return orders
      .filter((o) => {
        if (!o.createdAt) return false;
        return new Date(o.createdAt) >= monthStart;
      })
      .reduce((s, o) => s + (o.pricePaid ?? 0), 0);
  }, [orders, monthStart]);

  const prevMonthRevenue = useMemo(() => {
    return orders
      .filter((o) => {
        if (!o.createdAt) return false;
        const d = new Date(o.createdAt);
        return d >= prevMonthStart && d < monthStart;
      })
      .reduce((s, o) => s + (o.pricePaid ?? 0), 0);
  }, [orders, prevMonthStart, monthStart]);

  const monthlyDelta = prevMonthRevenue
    ? Math.round(((mtdRevenue - prevMonthRevenue) / prevMonthRevenue) * 100)
    : null;

  const wonQuotes = quotes.filter((q) => q.status === "won").length;
  const sentQuotes = quotes.filter((q) => q.status === "sent").length;

  const monthPlans = plans.filter((p) => {
    if (p.status !== "done") return false;
    if (!p.completedAt) return false;
    return new Date(p.completedAt) >= monthStart;
  });

  const recentDoneBatches = useMemo(
    () =>
      [...plans]
        .filter((p) => p.status === "done")
        .sort(
          (a, b) =>
            new Date(b.completedAt ?? 0).getTime() -
            new Date(a.completedAt ?? 0).getTime(),
        )
        .slice(0, 5),
    [plans],
  );

  return (
    <div>
      <PageHeader
        title="Observatory"
        description="Margins, trends, and production insights across the business."
      />

      <div className="px-4 pb-10 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi
            label="Revenue · MTD"
            value={formatEuro(mtdRevenue)}
            sub={
              monthlyDelta == null
                ? "first month of data"
                : `${monthlyDelta >= 0 ? "+" : ""}${monthlyDelta}% vs prev`
            }
            icon={<Euro className="w-4 h-4" />}
            href="/reports/monthly"
            accent={
              monthlyDelta == null
                ? undefined
                : monthlyDelta >= 0
                  ? "ok"
                  : "warn"
            }
          />
          <Kpi
            label="Quotes · open"
            value={sentQuotes}
            sub={`${wonQuotes} won ever`}
            icon={<FileText className="w-4 h-4" />}
            href="/quotes"
          />
          <Kpi
            label="Batches · MTD"
            value={monthPlans.length}
            sub="completed this month"
            icon={<Scale className="w-4 h-4" />}
            href="/stats"
          />
          <Kpi
            label="Products"
            value={products.length}
            sub="catalogue"
            icon={<BarChart3 className="w-4 h-4" />}
            href="/observatory/product-cost"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <DashCard title="Recent completed batches" href="/production-brain/daily">
            {recentDoneBatches.length === 0 ? (
              <EmptyLine text="No finished batches yet. Once you complete one it'll show up here." />
            ) : (
              <ul className="divide-y divide-border">
                {recentDoneBatches.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/production/${p.id}`}
                      className="flex items-center gap-3 px-1 py-2 hover:bg-muted/30 rounded-sm"
                    >
                      <TrendingUp className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium truncate">
                          {p.name ?? `Batch ${p.batchNumber ?? ""}`}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {p.completedAt
                            ? new Date(p.completedAt).toLocaleDateString(
                                undefined,
                                { day: "numeric", month: "short" },
                              )
                            : "—"}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </DashCard>

          <DashCard title="This month · highlights" href="/reports/monthly">
            <dl className="grid grid-cols-2 gap-y-3 gap-x-4 py-1">
              <Stat label="Orders this month">
                {
                  orders.filter(
                    (o) =>
                      o.createdAt && new Date(o.createdAt) >= monthStart,
                  ).length
                }
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
                {
                  quotes.filter(
                    (q) =>
                      q.createdAt && new Date(q.createdAt) >= monthStart,
                  ).length
                }
              </Stat>
            </dl>
          </DashCard>
        </div>

        <QuickActions />
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  icon,
  href,
  accent,
}: {
  label: string;
  value: string | number;
  sub: string;
  icon: React.ReactNode;
  href: string;
  accent?: "warn" | "alert" | "ok";
}) {
  return (
    <Link
      href={href}
      className="block border border-border bg-card hover:border-foreground transition-colors px-3 py-3"
      style={{ borderRadius: 4 }}
    >
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-[10px] uppercase text-muted-foreground"
          style={{ letterSpacing: "0.12em" }}
        >
          {label}
        </span>
        <span
          className={
            accent === "alert"
              ? "text-status-alert"
              : accent === "warn"
                ? "text-status-warn"
                : accent === "ok"
                  ? "text-status-ok"
                  : "text-muted-foreground"
          }
        >
          {icon}
        </span>
      </div>
      <div
        className="text-[26px] leading-none tabular-nums"
        style={{
          fontFamily: "var(--font-serif)",
          fontWeight: 500,
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </div>
      <div className="text-[10.5px] text-muted-foreground mt-1 truncate">
        {sub}
      </div>
    </Link>
  );
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt
        className="text-[9.5px] uppercase text-muted-foreground"
        style={{ letterSpacing: "0.12em" }}
      >
        {label}
      </dt>
      <dd
        className="text-[20px] tabular-nums"
        style={{
          fontFamily: "var(--font-serif)",
          fontWeight: 500,
          letterSpacing: "-0.02em",
        }}
      >
        {children}
      </dd>
    </div>
  );
}

function DashCard({
  title,
  href,
  children,
}: {
  title: string;
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="border border-border bg-card"
      style={{ borderRadius: 4 }}
    >
      <header className="px-4 pt-3 pb-2 flex items-center justify-between">
        <h3
          className="text-[13px]"
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </h3>
        {href && (
          <Link
            href={href}
            className="text-[10.5px] uppercase text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            style={{ letterSpacing: "0.1em" }}
          >
            Open <ArrowRight className="w-3 h-3" />
          </Link>
        )}
      </header>
      <div className="px-4 pb-3">{children}</div>
    </section>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <p
      className="text-[12px] text-muted-foreground italic py-4"
      style={{ fontFamily: "var(--font-serif)" }}
    >
      {text}
    </p>
  );
}

function QuickActions() {
  const actions = [
    { href: "/reports/monthly", label: "Monthly review" },
    { href: "/pricing", label: "Pricing" },
    { href: "/stats", label: "Stats" },
    { href: "/observatory/product-cost", label: "Product Cost" },
    { href: "/imports", label: "CSV imports" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      {actions.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          className="border border-border bg-muted hover:bg-card hover:border-foreground px-3 py-3 text-[12.5px]"
          style={{
            borderRadius: 3,
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            letterSpacing: "-0.01em",
          }}
        >
          {a.label}
        </Link>
      ))}
    </div>
  );
}
