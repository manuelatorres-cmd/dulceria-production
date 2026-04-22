"use client";

import {
  useProductionPlans, useProductsList, useMouldsList,
  useAllPlanProducts, useAllPlanStepStatuses, deleteProductionPlan,
  useAllProductionDayLineItems, useProductionDays, useProductionSteps,
  useCapacityConfig, usePeople, usePersonUnavailability, useBlockedDays,
  useOrders, useAllOrderItems, useAllOrderPlanLinks,
} from "@/lib/hooks";
import { effectiveDailyCapacityMinutes } from "@/lib/capacity";
import { PageHeader } from "@/components/page-header";
import { Calendar, Clock, Play, CheckCircle, Trash2, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState, useMemo } from "react";
import type { PlanProduct, PlanStepStatus, ProductionPlan } from "@/types";

const LEVEL_STYLE: Record<"ok" | "warn" | "critical" | "over", string> = {
  ok: "bg-status-ok-bg/40 text-status-ok",
  warn: "bg-status-warn-bg/40 text-status-warn",
  critical: "bg-destructive/10 text-destructive",
  over: "bg-destructive/20 text-destructive",
};

const DAY_STATUS_LABEL: Record<"draft" | "active" | "done", string> = {
  draft: "Planned",
  active: "In progress",
  done: "Closed",
};

const DAY_STATUS_STYLE: Record<"draft" | "active" | "done", string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-primary/10 text-primary",
  done: "bg-status-ok/10 text-status-ok",
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

  function stepDoneFor(planId: string, stepId: string): boolean {
    const done = doneKeysByPlan.get(planId);
    if (!done) return false;
    for (const k of done) {
      if (k === stepId || k.startsWith(`${stepId}-`)) return true;
    }
    return false;
  }

  // Today's local ISO date.
  const todayIso = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }, []);

  // Filter: skip days that are in the past AND fully closed.
  const visibleDays = useMemo(() => {
    return productionDays
      .filter((d) => d.status !== "done" || d.date >= todayIso)
      .sort((a, b) => a.date.localeCompare(b.date));
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
    <div>
      <PageHeader
        title="Production"
        description="Daily view — today plus upcoming. Click a batch to check off steps."
      />

      <div className="px-4 pb-8 space-y-4">
        {visibleDays.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-6 text-center">
            <Calendar className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Nothing scheduled yet. Head to <Link href="/plan" className="text-primary hover:underline">/plan</Link> and click <span className="font-medium">Regenerate plan</span> once you have open orders.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {visibleDays.map((day) => {
              const items = (lineItemsByDay.get(day.id!) ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
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
                <section
                  key={day.id}
                  className={`rounded-lg border overflow-hidden ${
                    isToday ? "border-primary/40 bg-primary/5" : "border-border bg-card"
                  }`}
                >
                  <header className="px-4 py-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h2 className="text-sm font-semibold">
                        {formatDayLabel(day.date, todayIso)}
                      </h2>
                      <span className={`text-[10px] uppercase tracking-wide rounded-full px-2 py-0.5 ${DAY_STATUS_STYLE[day.status]}`}>
                        {DAY_STATUS_LABEL[day.status]}
                      </span>
                      {isToday && (
                        <span className="text-[10px] uppercase tracking-wide rounded-full bg-primary text-primary-foreground px-2 py-0.5">
                          Today
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground tabular-nums">
                        {items.length} batch{items.length === 1 ? "" : "es"}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 tabular-nums ${LEVEL_STYLE[level]}`}>
                        {used}/{avail} min · {Math.round(util)}%
                      </span>
                    </div>
                  </header>

                  {items.length === 0 ? (
                    <p className="px-4 py-3 text-xs text-muted-foreground">No batches on this day.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {items.map((li) => {
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

                        return (
                          <li key={li.id ?? `${li.productionDayId}-${li.planId}`} className="px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <Link
                                href={`/production/${encodeURIComponent(plan.id!)}`}
                                className="flex-1 min-w-0 group"
                              >
                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                  <span className="text-sm font-medium truncate">
                                    {productNames.length === 1 ? productNames[0] : `${productNames.length} products`}
                                  </span>
                                  {plan.batchNumber && (
                                    <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                      {plan.batchNumber}
                                    </span>
                                  )}
                                  {totalMoulds > 0 && (
                                    <span className="text-[11px] text-muted-foreground">
                                      {totalMoulds} mould{totalMoulds === 1 ? "" : "s"} · {totalPieces} pcs
                                    </span>
                                  )}
                                  <ChevronRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                                {orderRefs.length > 0 && (
                                  <p className="text-[11px] text-muted-foreground truncate mb-1">
                                    for {orderRefs.join(", ")}
                                  </p>
                                )}
                                {mouldSummary.length > 0 && (
                                  <p className="text-[11px] text-muted-foreground truncate mb-1">
                                    Mould: {mouldSummary.join(", ")}
                                  </p>
                                )}
                                <div className="flex flex-wrap gap-1 text-[10px]">
                                  {orderedStepIds.map((stepId) => {
                                    const step = stepById.get(stepId);
                                    const done = stepDoneFor(li.planId, stepId);
                                    return (
                                      <span
                                        key={stepId}
                                        className={`rounded-full border px-1.5 py-0.5 flex items-center gap-1 ${
                                          done
                                            ? "border-status-ok/40 bg-status-ok/10 text-status-ok"
                                            : "border-border bg-card text-muted-foreground"
                                        }`}
                                      >
                                        {done && <CheckCircle className="w-2.5 h-2.5" />}
                                        {step?.name ?? stepId}
                                      </span>
                                    );
                                  })}
                                </div>
                                <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">
                                  {stepsDone}/{orderedStepIds.length} steps · {li.plannedMinutes}m
                                </p>
                              </Link>
                              {plan.status === "draft" && (
                                <button
                                  onClick={(e) => { e.preventDefault(); setConfirmDeleteId(plan.id!); }}
                                  className="shrink-0 text-muted-foreground hover:text-destructive"
                                  aria-label="Delete batch"
                                  title="Delete batch"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}

        {/* Draft batches with no scheduled days yet — usually because
            the scheduler had warnings (no mould, missing steps, etc.). */}
        {unscheduledDrafts.length > 0 && (
          <section className="rounded-lg border border-status-warn/40 bg-status-warn-bg/20 p-3 space-y-2">
            <h2 className="text-sm font-semibold text-status-warn flex items-center gap-1.5">
              <Clock className="w-4 h-4" /> Drafts with nothing scheduled
            </h2>
            <ul className="space-y-1.5">
              {unscheduledDrafts.map((plan) => (
                <li key={plan.id} className="flex items-center justify-between text-xs">
                  <Link href={`/production/${encodeURIComponent(plan.id!)}`} className="flex-1 hover:underline truncate">
                    {plan.name}
                    {plan.batchNumber && (
                      <span className="ml-2 font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {plan.batchNumber}
                      </span>
                    )}
                  </Link>
                  <button
                    onClick={() => setConfirmDeleteId(plan.id!)}
                    className="text-muted-foreground hover:text-destructive ml-2"
                    aria-label="Delete batch"
                    title="Delete batch"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Delete confirmation */}
        {confirmDeleteId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmDeleteId(null)} />
            <div className="relative w-full max-w-sm rounded-2xl border border-border bg-card shadow-xl p-5 space-y-3">
              <h3 className="text-base font-bold">Delete batch?</h3>
              <p className="text-sm text-muted-foreground">
                This removes the batch and its scheduling. Step progress and stock movements remain. Deleting does NOT touch the orders it was serving.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="text-sm rounded-full border border-border px-3 py-1.5 hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(confirmDeleteId)}
                  className="text-sm rounded-full bg-destructive text-destructive-foreground px-3 py-1.5 hover:opacity-90"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatDayLabel(iso: string, todayIso: string): string {
  const d = new Date(iso + "T12:00:00");
  const today = new Date(todayIso + "T12:00:00");
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  const label = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  if (days === 0) return `Today · ${label}`;
  if (days === 1) return `Tomorrow · ${label}`;
  if (days === -1) return `Yesterday · ${label}`;
  if (days < 0) return `${-days} days ago · ${label}`;
  return `In ${days}d · ${label}`;
}
