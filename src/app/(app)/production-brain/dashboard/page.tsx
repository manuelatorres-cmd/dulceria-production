"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import {
  useReplenishmentProposals,
  useCampaigns,
  useOrders,
  useProductionPlans,
  useProductsList,
  usePeople,
} from "@/lib/hooks";
import { runEngine, type EngineRunSummary } from "@/lib/engineRunner";
import type { ReplenishmentProposal } from "@/types";

/**
 * Production Brain · Dashboard (phase 1 scaffold)
 *
 * Strategic overview — what's happening now, what's coming this week.
 * Reads live data from the new tables; falls back gracefully when empty
 * because phase 1 ships with no seed data.
 */
export default function ProductionBrainDashboardPage() {
  const proposals = useReplenishmentProposals(["pending"]);
  const campaigns = useCampaigns(["active", "planned"]);
  const orders = useOrders();
  const plans = useProductionPlans();
  const products = useProductsList();
  const people = usePeople();

  const [engineRunning, setEngineRunning] = useState(false);
  const [engineSummary, setEngineSummary] = useState<EngineRunSummary | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);

  async function handleRunEngine() {
    setEngineRunning(true);
    setEngineError(null);
    try {
      const summary = await runEngine();
      setEngineSummary(summary);
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : String(err));
    } finally {
      setEngineRunning(false);
    }
  }

  const productsById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products) if (p.id) m.set(p.id, p.name);
    return m;
  }, [products]);

  const openOrderCount = orders.filter(
    (o) => o.status === "pending" || o.status === "in_production",
  ).length;
  const rushCount = orders.filter(
    (o) => (o.status === "pending" || o.status === "in_production") && o.timeSensitive,
  ).length;
  const activeBatches = plans.filter((p) => p.status === "active").length;
  const activeStaff = people.filter((p) => !p.archived).length;

  return (
    <div>
      <PageHeader
        title="Production Brain — Dashboard"
        description="Strategic overview: pipeline, alerts, replenishment proposals, capacity outlook."
      />

      {/* Engine controls */}
      <section className="flex flex-wrap items-center gap-3 mb-5">
        <button
          type="button"
          onClick={handleRunEngine}
          disabled={engineRunning}
          className="btn-primary"
        >
          {engineRunning ? "Running…" : "Run scheduling engine"}
        </button>
        {engineSummary ? (
          <p className="text-xs text-muted-foreground">
            Last run {engineSummary.ranAt} · {engineSummary.proposalsWritten}{" "}
            new · {engineSummary.proposalsUpdated} updated
            {engineSummary.proposalsRevived > 0 ? (
              <>
                {" · "}
                <span className="text-status-alert font-medium">
                  {engineSummary.proposalsRevived} revived (critical stock)
                </span>
              </>
            ) : null}
            {" · "}
            {engineSummary.campaignsContributed} from campaigns
          </p>
        ) : null}
        {engineError ? (
          <p className="text-xs text-status-alert">Engine error: {engineError}</p>
        ) : null}
      </section>

      {/* KPI strip */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KPI label="Active batches" value={activeBatches.toString()} hint={`${plans.length} total plans`} />
        <KPI
          label="Open orders"
          value={openOrderCount.toString()}
          hint={`${rushCount} rush · ${orders.length} total`}
        />
        <KPI
          label="Replenishment proposals"
          value={proposals.length.toString()}
          hint={proposals.length === 0 ? "engine quiet" : "drag to schedule"}
        />
        <KPI
          label="Active campaigns"
          value={campaigns.filter((c) => c.status === "active").length.toString()}
          hint={`${campaigns.length} scheduled`}
        />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Active pipeline */}
        <section className="lg:col-span-2 rounded-sm border border-border bg-card p-4">
          <SectionHeader>Active pipeline</SectionHeader>
          {plans.length === 0 ? (
            <Empty>No production plans yet.</Empty>
          ) : (
            <ul className="space-y-2">
              {plans.slice(0, 6).map((plan) => (
                <li
                  key={plan.id}
                  className="rounded-sm bg-muted px-3 py-2 text-sm flex items-center justify-between"
                >
                  <span className="font-medium">
                    {plan.name ?? `Batch ${plan.batchNumber ?? plan.id?.slice(0, 6)}`}
                  </span>
                  <span className="text-xs text-muted-foreground capitalize">
                    {plan.status ?? "draft"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Replenishment proposals + alerts */}
        <section className="rounded-sm border border-border bg-card p-4">
          <SectionHeader>Replenishment proposals</SectionHeader>
          {proposals.length === 0 ? (
            <Empty>No proposals from engine. Run replenishment job to populate.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {proposals.slice(0, 8).map((p) => (
                <ProposalRow key={p.id} proposal={p} productName={productsById.get(p.productId)} />
              ))}
            </ul>
          )}

          <SectionHeader className="mt-5">Active campaigns</SectionHeader>
          {campaigns.length === 0 ? (
            <Empty>No campaigns yet. Create one in /production-brain/planner.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {campaigns.slice(0, 6).map((c) => (
                <li
                  key={c.id}
                  className="rounded-md border border-border bg-muted px-2 py-1.5 text-xs flex items-center justify-between"
                >
                  <span>
                    <strong>{c.name}</strong>{" "}
                    <span className="text-muted-foreground">
                      {c.startDate} → {c.endDate}
                    </span>
                  </span>
                  <span className="text-[10px] text-muted-foreground capitalize">{c.status}</span>
                </li>
              ))}
            </ul>
          )}

          <SectionHeader className="mt-5">Staff today</SectionHeader>
          {people.length === 0 ? (
            <Empty>No people configured yet.</Empty>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {people
                .filter((p) => !p.archived)
                .slice(0, 8)
                .map((p) => (
                  <li
                    key={p.id}
                    className="px-2.5 py-1 rounded-full text-xs bg-muted border border-border"
                  >
                    {p.name}
                  </li>
                ))}
            </ul>
          )}
          <p className="text-[10px] text-muted-foreground mt-3">
            Showing {activeStaff} active people across the team.
          </p>
        </section>
      </div>
    </div>
  );
}

function SectionHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={
        "uppercase tracking-wider text-[10px] text-muted-foreground font-semibold mb-3 " +
        (className ?? "")
      }
    >
      {children}
    </h3>
  );
}

function KPI({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-sm border border-border bg-card px-4 py-3">
      <div className="uppercase tracking-wider text-[10px] text-muted-foreground font-semibold">
        {label}
      </div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {hint ? <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div> : null}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground italic">{children}</p>;
}

function ProposalRow({
  proposal,
  productName,
}: {
  proposal: ReplenishmentProposal;
  productName?: string;
}) {
  const tierColor =
    proposal.priorityTier === 1
      ? "bg-status-alert-bg text-status-alert"
      : proposal.priorityTier === 2
        ? "bg-status-warn-bg text-status-warn"
        : "bg-muted text-muted-foreground";
  return (
    <li className="rounded-md border border-border bg-muted/60 px-2 py-1.5 text-xs flex items-center justify-between">
      <span className="truncate">
        <strong>{productName ?? proposal.productId.slice(0, 8)}</strong>{" "}
        <span className="text-muted-foreground">
          · earliest {proposal.earliestNeededDate}
        </span>
      </span>
      <span className={"text-[10px] px-1.5 py-0.5 rounded " + tierColor}>
        T{proposal.priorityTier} · {proposal.suggestedBatchSize}
      </span>
    </li>
  );
}
