"use client";

import Link from "next/link";
import { useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import {
  useProductionPlans,
  useOrders,
  useCampaigns,
  useProductsList,
  useAllPlanProducts,
} from "@/lib/hooks";
import {
  ClipboardList,
  CalendarDays,
  Zap,
  Megaphone,
  ArrowRight,
  Plus,
  Package,
} from "lucide-react";

export default function WorkshopPage() {
  const plans = useProductionPlans();
  const orders = useOrders();
  const campaigns = useCampaigns(["planned", "active"]);
  const products = useProductsList();
  const planProducts = useAllPlanProducts();

  const productsById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products) if (p.id) m.set(p.id, p.name);
    return m;
  }, [products]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in7 = new Date(today);
  in7.setDate(in7.getDate() + 7);

  const activeBatches = useMemo(
    () => plans.filter((p) => p.status === "active"),
    [plans],
  );
  const draftBatches = useMemo(
    () => plans.filter((p) => p.status === "draft"),
    [plans],
  );

  const openOrders = useMemo(
    () =>
      orders.filter(
        (o) => o.status !== "done" && o.status !== "cancelled",
      ),
    [orders],
  );

  const rushOrders = useMemo(
    () => openOrders.filter((o) => o.timeSensitive || o.priority === "urgent"),
    [openOrders],
  );

  const next7 = useMemo(() => {
    return openOrders
      .filter((o) => {
        const d = new Date(o.deadline);
        return d >= today && d <= in7;
      })
      .sort(
        (a, b) =>
          new Date(a.deadline).getTime() - new Date(b.deadline).getTime(),
      )
      .slice(0, 6);
  }, [openOrders, today, in7]);

  return (
    <div>
      <PageHeader
        title="Workshop"
        description="Today's batches, upcoming deadlines, campaigns — everything running through production."
      />

      <div className="px-4 pb-10 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi
            label="Active batches"
            value={activeBatches.length}
            sub={`${draftBatches.length} waiting`}
            icon={<ClipboardList className="w-4 h-4" />}
            href="/production-brain/daily"
          />
          <Kpi
            label="Due in 7 days"
            value={next7.length}
            sub={`${openOrders.length} open total`}
            icon={<CalendarDays className="w-4 h-4" />}
            href="/orders"
          />
          <Kpi
            label="Rush"
            value={rushOrders.length}
            sub={rushOrders.length === 0 ? "clear" : "time-sensitive"}
            icon={<Zap className="w-4 h-4" />}
            accent={rushOrders.length > 0 ? "warn" : "ok"}
            href="/orders?rush=1"
          />
          <Kpi
            label="Campaigns"
            value={campaigns.length}
            sub="planned + running"
            icon={<Megaphone className="w-4 h-4" />}
            href="/campaigns"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <DashCard title="Active batches" href="/production-brain/daily">
            {activeBatches.length === 0 && draftBatches.length === 0 ? (
              <EmptyLine text="No active or draft batches. Start one from the planner." />
            ) : (
              <ul className="divide-y divide-border">
                {[...activeBatches, ...draftBatches].slice(0, 6).map((p) => {
                  const lines = planProducts.filter(
                    (pp) => pp.planId === p.id,
                  );
                  const summary = lines
                    .slice(0, 2)
                    .map(
                      (pp) =>
                        `${productsById.get(pp.productId) ?? "?"} ×${pp.quantity}`,
                    )
                    .join(", ");
                  return (
                    <li key={p.id}>
                      <Link
                        href={`/production/${p.id}`}
                        className="flex items-center gap-3 px-1 py-2 hover:bg-muted/30 rounded-sm"
                      >
                        <StatusDot status={p.status} />
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium truncate">
                            {p.name ?? `Batch ${p.batchNumber ?? ""}`}
                          </p>
                          {summary && (
                            <p className="text-[11px] text-muted-foreground truncate">
                              {summary}
                              {lines.length > 2
                                ? ` +${lines.length - 2} more`
                                : ""}
                            </p>
                          )}
                        </div>
                        <span className="text-[10.5px] uppercase text-muted-foreground tracking-wider">
                          {p.status ?? "draft"}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </DashCard>

          <DashCard title="Deadlines · next 7 days" href="/orders">
            {next7.length === 0 ? (
              <EmptyLine text="No deadlines in the next week." />
            ) : (
              <ul className="divide-y divide-border">
                {next7.map((o) => {
                  const d = new Date(o.deadline);
                  const daysOff = Math.round(
                    (d.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
                  );
                  return (
                    <li key={o.id}>
                      <Link
                        href={`/orders/${o.id}`}
                        className="flex items-center gap-3 px-1 py-2 hover:bg-muted/30 rounded-sm"
                      >
                        <div className="w-10 shrink-0 text-center">
                          <div
                            className="text-[10px] uppercase text-muted-foreground"
                            style={{ letterSpacing: "0.08em" }}
                          >
                            {d.toLocaleDateString(undefined, {
                              month: "short",
                            })}
                          </div>
                          <div
                            className="text-[16px] font-semibold leading-tight"
                            style={{ fontFamily: "var(--font-serif)" }}
                          >
                            {d.getDate()}
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium truncate">
                            {o.customerName ?? o.eventName ?? "Order"}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate capitalize">
                            {o.channel} · {o.priority}
                            {o.timeSensitive ? " · rush" : ""}
                          </p>
                        </div>
                        <span
                          className={
                            "text-[10.5px] tabular-nums " +
                            (daysOff <= 1
                              ? "text-status-alert"
                              : daysOff <= 3
                                ? "text-status-warn"
                                : "text-muted-foreground")
                          }
                        >
                          {daysOff === 0
                            ? "today"
                            : daysOff === 1
                              ? "tomorrow"
                              : `${daysOff}d`}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
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
  value: number;
  sub: string;
  icon: React.ReactNode;
  href: string;
  accent?: "warn" | "ok";
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
            accent === "warn"
              ? "text-status-warn"
              : accent === "ok"
                ? "text-status-ok"
                : "text-muted-foreground"
          }
        >
          {icon}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className="text-[28px] leading-none tabular-nums"
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            letterSpacing: "-0.02em",
          }}
        >
          {value}
        </span>
        <span className="text-[11px] text-muted-foreground">{sub}</span>
      </div>
    </Link>
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

function StatusDot({ status }: { status?: string }) {
  const cls =
    status === "active"
      ? "bg-status-ok"
      : status === "draft"
        ? "bg-muted-foreground/40"
        : "bg-muted-foreground/20";
  return <span className={`inline-block w-2 h-2 rounded-full ${cls}`} />;
}

function QuickActions() {
  const actions = [
    { href: "/orders/new", label: "New order", icon: Plus },
    {
      href: "/production-brain/planner",
      label: "Planner",
      icon: CalendarDays,
    },
    { href: "/stock", label: "Stock", icon: Package },
    { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {actions.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          className="border border-border bg-muted hover:bg-card hover:border-foreground px-3 py-3 flex items-center gap-2 text-[12.5px]"
          style={{
            borderRadius: 3,
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            letterSpacing: "-0.01em",
          }}
        >
          <a.icon className="w-4 h-4 text-muted-foreground" />
          {a.label}
        </Link>
      ))}
    </div>
  );
}
