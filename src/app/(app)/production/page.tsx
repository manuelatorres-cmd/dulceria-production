"use client";

import {
  useProductionPlans, useProductsList, useMouldsList,
  useAllPlanProducts, useAllPlanStepStatuses, deleteProductionPlan,
  useAllProductionDayLineItems, useProductionDays, useProductionSteps,
  useCapacityConfig, usePeople, usePersonUnavailability, useBlockedDays,
  useOrders, useAllOrderItems, useAllOrderPlanLinks,
} from "@/lib/hooks";
import { effectiveDailyCapacityMinutes } from "@/lib/capacity";
import { planStepDoneById } from "@/lib/production";
import { PageHeader, Section, ListRow, StatusTag, DsDialog, type ListRowTier, type StatusTagKind } from "@/components/dulceria";
import { IconCalendar as Calendar, IconClock as Clock, IconCircleCheck as CheckCircle, IconTrash as Trash2, IconChevronRight as ChevronRight } from "@tabler/icons-react";
import Link from "next/link";
import { useState, useMemo } from "react";
import type { PlanProduct, PlanStepStatus, ProductionPlan } from "@/types";

const LEVEL_COLOR: Record<"ok" | "warn" | "critical" | "over", string> = {
  ok: "var(--ds-tier-positive)",
  warn: "var(--ds-semantic-warn)",
  critical: "var(--ds-tier-urgent)",
  over: "var(--ds-tier-urgent)",
};

const DAY_STATUS_LABEL: Record<"draft" | "active" | "done", string> = {
  draft: "Planned",
  active: "In progress",
  done: "Closed",
};

const DAY_STATUS_TAG: Record<"draft" | "active" | "done", StatusTagKind> = {
  draft: "neutral",
  active: "scheduled",
  done: "done",
};

export default function ProductionPage() {
  const plans = useProductionPlans();
  const products = useProductsList(true);
  const moulds = useMouldsList(true);
  const allPlanProducts = useAllPlanProducts();
  const allStepStatuses = useAllPlanStepStatuses();
  const lineItems = useAllProductionDayLineItems();
  const productionDays = useProductionDays(60);
  const productionSteps = useProductionSteps();
  const config = useCapacityConfig();
  const people = usePeople(false);
  const unavailability = usePersonUnavailability();
  const blockedDays = useBlockedDays();
  const orders = useOrders();
  const orderItems = useAllOrderItems();
  const orderPlanLinks = useAllOrderPlanLinks();

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const mouldMap = useMemo(() => new Map(moulds.map((m) => [m.id!, m])), [moulds]);
  const planMap = useMemo(() => new Map(plans.map((p) => [p.id!, p])), [plans]);
  const stepById = useMemo(() => new Map(productionSteps.map((s) => [s.id!, s])), [productionSteps]);
  const orderMap = useMemo(() => new Map(orders.map((o) => [o.id!, o])), [orders]);
  const orderItemById = useMemo(() => new Map(orderItems.map((oi) => [oi.id!, oi])), [orderItems]);
  const planProductsByPlan = useMemo(() => {
    const m = new Map<string, PlanProduct[]>();
    for (const pp of allPlanProducts) {
      const arr = m.get(pp.planId) ?? [];
      arr.push(pp);
      m.set(pp.planId, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return m;
  }, [allPlanProducts]);
  const linksByPlan = useMemo(() => {
    const m = new Map<string, typeof orderPlanLinks>();
    for (const link of orderPlanLinks) {
      const arr = m.get(link.planId) ?? [];
      arr.push(link);
      m.set(link.planId, arr);
    }
    return m;
  }, [orderPlanLinks]);

  const doneKeysByPlan = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const s of allStepStatuses as PlanStepStatus[]) {
      if (!s.done) continue;
      const set = m.get(s.planId) ?? new Set<string>();
      set.add(s.stepKey);
      m.set(s.planId, set);
    }
    return m;
  }, [allStepStatuses]);

  // Use the shared phase-key helper. Comparing the bare stepId UUID
  // against doneKeys (e.g. "polishing-<planProductId>") never matched
  // → all steps rendered as not done. Now resolves stepId → step.name
  // → phaseKey → prefix-match.
  function stepDoneFor(planId: string, stepId: string): boolean {
    return planStepDoneById(stepId, planId, stepById, doneKeysByPlan);
  }

  // Today's local ISO date.
  const todayIso = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }, []);

  // Visible days = today + future. Past rows (HACCP-only days with no
  // scheduled work, stale drafts, old closed days) are hidden from the
  // forward-looking production view. If there's no row for today yet
  // we synthesise a placeholder so today always appears at the top.
  const visibleDays = useMemo(() => {
    const rows = productionDays
      .filter((d) => d.date >= todayIso)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!rows.some((d) => d.date === todayIso)) {
      // Synthesise today. No id means we skip DB-bound actions; the
      // render just uses date for keying. Real row is created the
      // moment Open Production or Regenerate runs.
      rows.unshift({
        date: todayIso,
        status: "draft",
        tempLogComplete: false,
        cleaningComplete: false,
      });
    }
    return rows;
  }, [productionDays, todayIso]);

  // Line items grouped per day (already sorted by sortOrder at hook).
  const lineItemsByDay = useMemo(() => {
    const m = new Map<string, typeof lineItems>();
    for (const li of lineItems) {
      const arr = m.get(li.productionDayId) ?? [];
      arr.push(li);
      m.set(li.productionDayId, arr);
    }
    return m;
  }, [lineItems]);

  async function handleDelete(planId: string) {
    try {
      await deleteProductionPlan(planId);
      setConfirmDeleteId(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete batch");
    }
  }

  // Draft batches that exist but have no scheduled days (e.g. newly
  // created by Regenerate but with warnings). Surfaced as a small list
  // so they don't get lost.
  const unscheduledDrafts = useMemo(() => {
    const scheduledPlanIds = new Set(lineItems.map((li) => li.planId));
    return plans.filter((p) => p.status === "draft" && !scheduledPlanIds.has(p.id!));
  }, [plans, lineItems]);

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader title="Production" meta="Daily view — today plus upcoming. Click a batch to check off steps." />

      <div style={{ padding: "16px 32px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
        {visibleDays.length === 0 ? (
          <Section title="Nothing scheduled">
            <p style={{ padding: "16px 20px", fontSize: 13, color: "var(--ds-text-muted)", textAlign: "center" }}>
              <Calendar size={20} style={{ display: "block", margin: "0 auto 8px", color: "var(--ds-text-muted)" }} />
              Nothing scheduled yet. Head to{" "}
              <Link href="/plan" style={{ color: "var(--ds-tier-quarter-focus)", textDecoration: "underline" }}>/plan</Link>{" "}
              and click <strong style={{ color: "var(--ds-text-primary)", fontWeight: 500 }}>Regenerate plan</strong> once you have open orders.
            </p>
          </Section>
        ) : (
          visibleDays.map((day) => {
            const items = (day.id ? lineItemsByDay.get(day.id) ?? [] : []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
            const dayDate = new Date(day.date + "T12:00:00");
            const avail = effectiveDailyCapacityMinutes(dayDate, config, people, unavailability, blockedDays);
            const used = items.reduce((s, li) => s + li.plannedMinutes, 0);
            const util = avail > 0 ? (used / avail) * 100 : 0;
            const level: "ok" | "warn" | "critical" | "over" =
              avail === 0 && used > 0 ? "over"
              : used > avail ? "over"
              : util >= (config?.criticalThresholdPercent ?? 100) ? "critical"
              : util >= (config?.warnThresholdPercent ?? 100) ? "warn"
              : "ok";
            const isToday = day.date === todayIso;
            return (
              <Section
                key={day.id ?? day.date}
                title={
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span>{formatDayLabel(day.date, todayIso)}</span>
                    <StatusTag kind={DAY_STATUS_TAG[day.status]}>{DAY_STATUS_LABEL[day.status]}</StatusTag>
                    {isToday && <StatusTag kind="ready">Today</StatusTag>}
                  </span>
                }
                action={
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11 }}>
                    <span style={{ color: "var(--ds-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                      {items.length} batch{items.length === 1 ? "" : "es"}
                    </span>
                    <span style={{
                      padding: "2px 8px", borderRadius: 12,
                      border: `0.5px solid ${LEVEL_COLOR[level]}`,
                      color: LEVEL_COLOR[level],
                      fontVariantNumeric: "tabular-nums", fontWeight: 500,
                    }}>
                      {used}/{avail} min · {Math.round(util)}%
                    </span>
                  </span>
                }
                noBody
              >
                {items.length === 0 ? (
                  <p style={{ padding: "12px 20px", fontSize: 12, color: "var(--ds-text-muted)", fontStyle: "italic" }}>
                    No batches on this day.
                  </p>
                ) : (
                  items.map((li) => {
                    const plan = planMap.get(li.planId);
                    if (!plan) return null;
                    const pps = planProductsByPlan.get(li.planId) ?? [];
                    const productNames = [...new Set(pps.map((pp) => productMap.get(pp.productId)?.name ?? pp.productId))];
                    const totalMoulds = pps.reduce((s, pp) => s + pp.quantity, 0);
                    const mouldSummary = pps.map((pp) => mouldMap.get(pp.mouldId ?? "")?.name).filter(Boolean);
                    const totalPieces = pps.reduce((s, pp) => {
                      const cavities = mouldMap.get(pp.mouldId ?? "")?.numberOfCavities ?? 0;
                      return s + cavities * pp.quantity;
                    }, 0);
                    const links = linksByPlan.get(li.planId) ?? [];
                    const orderRefs = [...new Set(
                      links.map((l) => {
                        const item = orderItemById.get(l.orderItemId);
                        const order = item ? orderMap.get(item.orderId) : undefined;
                        return order?.customerName ?? order?.eventName ?? null;
                      }).filter(Boolean) as string[],
                    )];
                    const orderedStepIds = [...li.stepIds].sort((a, b) => {
                      const sa = stepById.get(a)?.sortOrder ?? 0;
                      const sb = stepById.get(b)?.sortOrder ?? 0;
                      return sa - sb;
                    });
                    const stepsDone = orderedStepIds.filter((sid) => stepDoneFor(li.planId, sid)).length;
                    const allStepsDone = stepsDone === orderedStepIds.length && orderedStepIds.length > 0;
                    const tier: ListRowTier = plan.status === "done" ? "done"
                      : plan.status === "cancelled" ? "parked"
                      : allStepsDone ? "positive"
                      : stepsDone > 0 ? "active"
                      : "default";

                    return (
                      <Link
                        key={li.id ?? `${li.productionDayId}-${li.planId}`}
                        href={`/production/${encodeURIComponent(plan.id!)}`}
                        style={{ display: "block", color: "inherit", textDecoration: "none" }}
                      >
                        <ListRow
                          tier={tier}
                          title={
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span>{productNames.length === 1 ? productNames[0] : `${productNames.length} products`}</span>
                              {plan.batchNumber && (
                                <span style={{
                                  fontFamily: "var(--font-mono, monospace)", fontSize: 10,
                                  color: "var(--ds-text-muted)",
                                  background: "var(--ds-card-bg-hover, rgba(0,0,0,0.04))",
                                  padding: "1px 6px", borderRadius: 4,
                                }}>
                                  {plan.batchNumber}
                                </span>
                              )}
                              {totalMoulds > 0 && (
                                <span style={{ fontSize: 11, fontWeight: 400, color: "var(--ds-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                                  · {totalMoulds} mould{totalMoulds === 1 ? "" : "s"} · {totalPieces} pcs
                                </span>
                              )}
                            </span>
                          }
                          meta={
                            <>
                              {orderRefs.length > 0 && (
                                <span>for {orderRefs.join(", ")}</span>
                              )}
                              {orderRefs.length > 0 && mouldSummary.length > 0 && " · "}
                              {mouldSummary.length > 0 && (
                                <span>Mould: {mouldSummary.join(", ")}</span>
                              )}
                            </>
                          }
                          secondary={
                            <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
                              {orderedStepIds.map((stepId) => {
                                const step = stepById.get(stepId);
                                const done = stepDoneFor(li.planId, stepId);
                                return (
                                  <span
                                    key={stepId}
                                    style={{
                                      display: "inline-flex", alignItems: "center", gap: 3,
                                      padding: "1px 6px", borderRadius: 4, fontSize: 10,
                                      border: `0.5px solid ${done ? "var(--ds-tier-positive)" : "var(--ds-border-warm)"}`,
                                      background: done ? "var(--ds-tint-ok, rgba(78,165,138,0.08))" : "var(--ds-card-bg)",
                                      color: done ? "var(--ds-tier-positive)" : "var(--ds-text-muted)",
                                    }}
                                  >
                                    {done && <CheckCircle size={10} />}
                                    {step?.name ?? stepId}
                                  </span>
                                );
                              })}
                            </span>
                          }
                          side={
                            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                              <span style={{ fontSize: 11, color: "var(--ds-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                                {stepsDone}/{orderedStepIds.length} steps · {li.plannedMinutes}m
                              </span>
                              {plan.status === "draft" && (
                                <button
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmDeleteId(plan.id!); }}
                                  aria-label="Delete batch"
                                  title="Delete batch"
                                  style={{
                                    padding: 4, background: "transparent", border: "none",
                                    color: "var(--ds-text-muted)", cursor: "pointer",
                                  }}
                                  className="hover:[color:var(--ds-tier-urgent)]"
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                              <ChevronRight size={12} style={{ color: "var(--ds-text-muted)", opacity: 0.5 }} />
                            </span>
                          }
                        />
                      </Link>
                    );
                  })
                )}
              </Section>
            );
          })
        )}

        {/* Draft batches with no scheduled days yet — surfaced so they
            don't get lost when the scheduler had warnings. */}
        {unscheduledDrafts.length > 0 && (
          <Section
            title={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--ds-semantic-warn)" }}>
                <Clock size={14} /> Drafts with nothing scheduled
              </span>
            }
            noBody
          >
            {unscheduledDrafts.map((plan) => (
              <ListRow
                key={plan.id}
                tier="parked"
                title={
                  <Link
                    href={`/production/${encodeURIComponent(plan.id!)}`}
                    style={{ color: "inherit", textDecoration: "none" }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <span>{plan.name}</span>
                      {plan.batchNumber && (
                        <span style={{
                          fontFamily: "var(--font-mono, monospace)", fontSize: 10,
                          color: "var(--ds-text-muted)",
                          background: "var(--ds-card-bg-hover, rgba(0,0,0,0.04))",
                          padding: "1px 6px", borderRadius: 4,
                        }}>
                          {plan.batchNumber}
                        </span>
                      )}
                    </span>
                  </Link>
                }
                side={
                  <button
                    onClick={() => setConfirmDeleteId(plan.id!)}
                    aria-label="Delete batch"
                    title="Delete batch"
                    style={{
                      padding: 4, background: "transparent", border: "none",
                      color: "var(--ds-text-muted)", cursor: "pointer",
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                }
              />
            ))}
          </Section>
        )}
      </div>

      <DsDialog
        open={!!confirmDeleteId}
        title="Delete batch?"
        description="This removes the batch and its scheduling. Step progress and stock movements remain. Deleting does NOT touch the orders it was serving."
        tone="destructive"
        confirmLabel="Delete"
        onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}

function formatDayLabel(iso: string, todayIso: string): string {
  const d = new Date(iso + "T12:00:00");
  const today = new Date(todayIso + "T12:00:00");
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  const label = d.toLocaleDateString("de-AT", { weekday: "long", day: "numeric", month: "long" });
  if (days === 0) return `Today · ${label}`;
  if (days === 1) return `Tomorrow · ${label}`;
  if (days === -1) return `Yesterday · ${label}`;
  if (days < 0) return `${-days} days ago · ${label}`;
  return `In ${days}d · ${label}`;
}
