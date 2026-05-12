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
  IconClipboardList as ClipboardList,
  IconCalendarMonth as CalendarDays,
  IconBolt as Zap,
  IconSpeakerphone as Megaphone,
  IconArrowRight as ArrowRight,
  IconPlus as Plus,
  IconPackage as Package,
} from "@tabler/icons-react";
import { BackButton } from "@/components/back-button";
import {
  StatCard,
  type StatCardVariant,
  ListRow,
  type ListRowTier,
  AttentionItem,
  type AttentionVariant,
} from "@/components/dulceria";

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
      orders.filter((o) => o.status !== "done" && o.status !== "cancelled"),
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
      <div className="px-4 pt-4">
        <BackButton />
      </div>
      <PageHeader
        title="Workshop"
        description="Today's batches, upcoming deadlines, campaigns — everything running through production."
      />

      <div className="px-4 pb-10 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <DsKpi
            label="Active batches"
            value={activeBatches.length}
            sub={`${draftBatches.length} waiting`}
            href="/production-brain/daily"
            variant="active"
          />
          <DsKpi
            label="Due in 7 days"
            value={next7.length}
            sub={`${openOrders.length} open total`}
            href="/orders"
            variant="default"
          />
          <DsKpi
            label="Rush"
            value={rushOrders.length}
            sub={rushOrders.length === 0 ? "clear" : "time-sensitive"}
            href="/orders?rush=1"
            variant={rushOrders.length > 0 ? "urgent" : "ok"}
          />
          <DsKpi
            label="Campaigns"
            value={campaigns.length}
            sub="planned + running"
            href="/campaigns"
            variant="ok"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <DashCard title="Active batches" href="/production-brain/daily">
            {activeBatches.length === 0 && draftBatches.length === 0 ? (
              <EmptyLine text="No active or draft batches. Start one from the planner." />
            ) : (
              <div>
                {[...activeBatches, ...draftBatches].slice(0, 6).map((p) => {
                  const lines = planProducts.filter((pp) => pp.planId === p.id);
                  const summary = lines
                    .slice(0, 2)
                    .map(
                      (pp) =>
                        `${productsById.get(pp.productId) ?? "?"} ×${pp.quantity}`,
                    )
                    .join(", ");
                  const isActive = p.status === "active";
                  const tier: ListRowTier = isActive ? "positive" : "parked";
                  return (
                    <Link
                      key={p.id}
                      href={`/production/${p.id}?from=workshop`}
                      style={{ color: "inherit", textDecoration: "none" }}
                    >
                      <ListRow
                        tier={tier}
                        title={
                          <>
                            <span>
                              {p.name ?? `Batch ${p.batchNumber ?? ""}`}
                            </span>
                          </>
                        }
                        meta={
                          summary
                            ? `${summary}${lines.length > 2 ? ` +${lines.length - 2} more` : ""}`
                            : undefined
                        }
                        side={
                          <span
                            style={{
                              fontSize: 11,
                              textTransform: "uppercase",
                              letterSpacing: "0.08em",
                              color: "var(--ds-text-muted)",
                            }}
                          >
                            {p.status ?? "draft"}
                          </span>
                        }
                      />
                    </Link>
                  );
                })}
              </div>
            )}
          </DashCard>

          <DashCard title="Deadlines · next 7 days" href="/orders">
            {next7.length === 0 ? (
              <EmptyLine text="No deadlines in the next week." />
            ) : (
              <div>
                {next7.map((o) => {
                  const d = new Date(o.deadline);
                  const daysOff = Math.round(
                    (d.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
                  );
                  const variant: AttentionVariant =
                    daysOff <= 1 ? "critical" : daysOff <= 3 ? "warn" : "info";
                  const dayLabel =
                    daysOff === 0
                      ? "today"
                      : daysOff === 1
                      ? "tomorrow"
                      : `${daysOff}d`;
                  const dateLabel = d.toLocaleDateString(undefined, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  });
                  return (
                    <Link
                      key={o.id}
                      href={`/orders/${o.id}?from=workshop`}
                      style={{ color: "inherit", textDecoration: "none" }}
                    >
                      <AttentionItem
                        variant={variant}
                        title={
                          <span>
                            {o.customerName ?? o.eventName ?? "Order"}
                            <span
                              style={{
                                marginLeft: 8,
                                fontWeight: 400,
                                color: "var(--ds-text-muted)",
                                fontSize: 11,
                              }}
                            >
                              {dateLabel} · {dayLabel}
                            </span>
                          </span>
                        }
                        detail={
                          <span style={{ textTransform: "capitalize" }}>
                            {o.channel} · {o.priority}
                            {o.timeSensitive ? " · rush" : ""}
                          </span>
                        }
                      />
                    </Link>
                  );
                })}
              </div>
            )}
          </DashCard>
        </div>

        <QuickActions />
      </div>
    </div>
  );
}

function DsKpi({
  label,
  value,
  sub,
  href,
  variant,
}: {
  label: string;
  value: number;
  sub: string;
  href: string;
  variant: StatCardVariant;
}) {
  // Wrapping StatCard in Link preserves right-click open-in-new-tab.
  return (
    <Link href={href} style={{ color: "inherit", textDecoration: "none" }}>
      <StatCard label={label} value={value} meta={sub} variant={variant} />
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
      style={{
        background: "var(--ds-card-bg)",
        border: "0.5px solid var(--ds-border-warm)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <header
        style={{
          padding: "14px 20px 10px",
          borderBottom: "0.5px solid var(--ds-border-warm)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
        }}
      >
        <h3
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 16,
            fontWeight: 600,
            color: "var(--ds-text-primary)",
          }}
        >
          {title}
        </h3>
        {href && (
          <Link
            href={href}
            style={{
              fontSize: 12,
              color: "var(--ds-text-muted)",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            Open <ArrowRight className="w-3 h-3" />
          </Link>
        )}
      </header>
      <div>{children}</div>
    </section>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <p
      style={{
        padding: "16px 20px",
        fontSize: 12,
        color: "var(--ds-text-muted)",
        fontStyle: "italic",
      }}
    >
      {text}
    </p>
  );
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
          style={{
            border: "0.5px solid var(--ds-border-warm)",
            background: "var(--ds-card-bg)",
            color: "var(--ds-text-primary)",
            padding: "10px 14px",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            borderRadius: 4,
            textDecoration: "none",
            letterSpacing: "-0.01em",
          }}
          className="hover:bg-[color:var(--ds-card-bg-hover)]"
        >
          <a.icon className="w-4 h-4" style={{ color: "var(--ds-text-muted)" }} />
          {a.label}
        </Link>
      ))}
    </div>
  );
}

// Legacy helpers retained as harmless leftovers — `ClipboardList`,
// `Zap`, `Megaphone`, etc. icon imports are intentionally kept in case
// downstream PRs reuse them on this page.
void ClipboardList;
void Zap;
