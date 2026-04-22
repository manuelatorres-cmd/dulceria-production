"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import {
  useOrders, useAllOrderItems, useProductsList, useProductionSteps,
  useCapacityConfig, usePeople, usePersonUnavailability, useBlockedDays,
  useProductCategories, useMouldsList, useProductionPlans, useAllPlanProducts,
  useAllOrderPlanLinks, regenerateAllPlansAndSchedule,
  useAllProductionDayLineItems, useProductionDays, useAllPlanStepStatuses,
} from "@/lib/hooks";
import { capacityConfigStatus, effectiveDailyCapacityMinutes } from "@/lib/capacity";
import { RefreshCw, AlertTriangle, CheckCircle, Flame, Calendar } from "lucide-react";

const LEVEL_STYLE: Record<"ok" | "warn" | "critical" | "over", string> = {
  ok: "bg-status-ok-bg text-status-ok border-status-ok-edge",
  warn: "bg-status-warn-bg text-status-warn border-status-warn-edge",
  critical: "bg-destructive/10 text-destructive border-destructive/20",
  over: "bg-destructive text-white border-destructive",
};

export default function PlanPage() {
  const orders = useOrders();
  const orderItems = useAllOrderItems();
  const products = useProductsList(true);
  const productionSteps = useProductionSteps();
  const config = useCapacityConfig();
  const people = usePeople(false);
  const unavailability = usePersonUnavailability();
  const blockedDays = useBlockedDays();
  const categories = useProductCategories(true);
  const moulds = useMouldsList(true);
  const plans = useProductionPlans();
  const planProducts = useAllPlanProducts();
  const orderPlanLinks = useAllOrderPlanLinks();
  const lineItems = useAllProductionDayLineItems();
  const productionDays = useProductionDays(120);
  const stepStatuses = useAllPlanStepStatuses();

  const productMap = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const mouldMap = useMemo(() => new Map(moulds.map((m) => [m.id!, m])), [moulds]);
  const orderMap = useMemo(() => new Map(orders.map((o) => [o.id!, o])), [orders]);
  const planMap = useMemo(() => new Map(plans.map((p) => [p.id!, p])), [plans]);
  const stepById = useMemo(() => new Map(productionSteps.map((s) => [s.id!, s])), [productionSteps]);
  const dayById = useMemo(() => new Map(productionDays.map((d) => [d.id!, d])), [productionDays]);
  const planProductsByPlan = useMemo(() => {
    const m = new Map<string, typeof planProducts>();
    for (const pp of planProducts) {
      const arr = m.get(pp.planId) ?? [];
      arr.push(pp);
      m.set(pp.planId, arr);
    }
    return m;
  }, [planProducts]);

  // Earliest-linked-order label per batch.
  const batchOrderRef = useMemo(() => {
    const itemById = new Map(orderItems.map((oi) => [oi.id!, oi]));
    const best = new Map<string, { ref: string; deadline: string }>();
    for (const link of orderPlanLinks) {
      const item = itemById.get(link.orderItemId);
      if (!item) continue;
      const order = orderMap.get(item.orderId);
      if (!order) continue;
      const cur = best.get(link.planId);
      if (!cur || order.deadline < cur.deadline) {
        best.set(link.planId, {
          ref: order.customerName || order.eventName || order.sourceRef || "order",
          deadline: order.deadline,
        });
      }
    }
    return best;
  }, [orderItems, orderMap, orderPlanLinks]);

  // Step status lookup — stepId → done? for a given plan.
  const doneKeysByPlan = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const s of stepStatuses) {
      if (!s.done) continue;
      const set = m.get(s.planId) ?? new Set<string>();
      set.add(s.stepKey);
      m.set(s.planId, set);
    }
    return m;
  }, [stepStatuses]);
  function stepDoneFor(planId: string, stepId: string): boolean {
    const doneSet = doneKeysByPlan.get(planId);
    if (!doneSet) return false;
    for (const k of doneSet) {
      if (k === stepId || k.startsWith(`${stepId}-`)) return true;
    }
    return false;
  }

  // Per-date: used minutes, batch count, level.
  const daySummary = useMemo(() => {
    const usedByDay = new Map<string, number>();
    const batchesByDay = new Map<string, Set<string>>();
    for (const li of lineItems) {
      const day = dayById.get(li.productionDayId);
      if (!day) continue;
      usedByDay.set(day.date, (usedByDay.get(day.date) ?? 0) + li.plannedMinutes);
      const set = batchesByDay.get(day.date) ?? new Set<string>();
      set.add(li.planId);
      batchesByDay.set(day.date, set);
    }
    const warn = config?.warnThresholdPercent ?? 100;
    const critical = config?.criticalThresholdPercent ?? 100;
    return productionDays
      .filter((d) => usedByDay.has(d.date))
      .map((d) => {
        const dt = new Date(d.date + "T12:00:00");
        const avail = effectiveDailyCapacityMinutes(dt, config, people, unavailability, blockedDays);
        const used = usedByDay.get(d.date) ?? 0;
        const util = avail > 0 ? (used / avail) * 100 : 0;
        let level: "ok" | "warn" | "critical" | "over";
        if (avail === 0) level = used > 0 ? "over" : "ok";
        else if (used > avail) level = "over";
        else if (util >= critical) level = "critical";
        else if (util >= warn) level = "warn";
        else level = "ok";
        return {
          day: d,
          usedMinutes: used,
          availableMinutes: avail,
          utilisationPercent: Math.round(util),
          level,
          batchCount: batchesByDay.get(d.date)?.size ?? 0,
        };
      })
      .sort((a, b) => a.day.date.localeCompare(b.day.date));
  }, [lineItems, productionDays, dayById, config, people, unavailability, blockedDays]);

  const [regenerating, setRegenerating] = useState(false);
  const [lastResult, setLastResult] = useState<{ warnings: string[]; unscheduledPlanIds: string[]; count: number } | null>(null);
  const [regenerateError, setRegenerateError] = useState("");

  const configStatus = capacityConfigStatus(config, people);

  const categoryNameById = useMemo(
    () => new Map(categories.map((c) => [c.id!, c.name])),
    [categories],
  );

  async function handleRegenerate() {
    setRegenerating(true);
    setRegenerateError("");
    try {
      const result = await regenerateAllPlansAndSchedule({
        config, people, unavailability, blockedDays,
        productionSteps, categoryNameById,
      });
      setLastResult({
        warnings: result.warnings,
        unscheduledPlanIds: result.unscheduledPlanIds,
        count: result.scheduleCount,
      });
    } catch (err) {
      const raw: { message?: string; code?: string; details?: string; hint?: string } =
        err instanceof Error ? { message: err.message } : ((err as Record<string, string>) ?? {});
      const code = raw.code ? ` (code ${raw.code})` : "";
      const hint = raw.hint ? ` — ${raw.hint}` : "";
      setRegenerateError(`${raw.message || raw.details || "Regenerate failed"}${code}${hint}`);
      console.error("regenerate failed:", err);
    } finally {
      setRegenerating(false);
    }
  }

  const hasPlan = lineItems.length > 0;

  return (
    <div>
      <PageHeader
        title="Production Plan"
        description="Scheduled work per day. Regenerate to pick up order / capacity / step changes."
      />

      <div className="px-4 pb-8 space-y-4">
        {/* Pre-flight */}
        {!configStatus.isComplete && (
          <div className="flex items-start gap-2 rounded-md bg-status-warn-bg border border-status-warn-edge px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-status-warn shrink-0 mt-0.5" />
            <div className="text-xs text-status-warn">
              Capacity config incomplete: {configStatus.missing.join(", ")}.{" "}
              <Link href="/settings" className="underline">Go to Settings</Link>.
            </div>
          </div>
        )}
        {productionSteps.length === 0 && (
          <div className="flex items-start gap-2 rounded-md bg-status-warn-bg border border-status-warn-edge px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-status-warn shrink-0 mt-0.5" />
            <div className="text-xs text-status-warn">
              No production steps defined. Add them under{" "}
              <Link href="/settings" className="underline">Settings → Production Steps</Link>.
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm">
            <p className="text-muted-foreground">
              {lineItems.length} batch-day line item{lineItems.length !== 1 ? "s" : ""} across{" "}
              {daySummary.length} day{daySummary.length !== 1 ? "s" : ""}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/plan/fillings"
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:border-primary hover:text-primary transition-colors"
            >
              <Flame className="w-3.5 h-3.5" /> Filling cooking list
            </Link>
            <button
              onClick={handleRegenerate}
              disabled={regenerating || !configStatus.isComplete}
              className="flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? "animate-spin" : ""}`} />
              {regenerating ? "Regenerating…" : "Regenerate plan"}
            </button>
          </div>
        </div>

        {lastResult && (
          <div className="rounded-md bg-status-ok-bg border border-status-ok-edge px-3 py-2">
            <div className="flex items-start gap-2 text-xs text-status-ok">
              <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Plan regenerated: {lastResult.count} batch-day line item{lastResult.count !== 1 ? "s" : ""} saved.</span>
            </div>
          </div>
        )}

        {regenerateError && (
          <div className="rounded-md bg-status-alert-bg border border-status-alert-edge px-3 py-2">
            <div className="flex items-start gap-2 text-xs text-status-alert">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium">Regenerate failed — existing plan preserved.</p>
                <p className="mt-0.5 opacity-90">{regenerateError}</p>
              </div>
            </div>
          </div>
        )}

        {lastResult && lastResult.warnings.length > 0 && (
          <div className="rounded-md bg-status-warn-bg border border-status-warn-edge px-3 py-2 space-y-1">
            {lastResult.warnings.slice(0, 8).map((w, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-status-warn">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{w}</span>
              </div>
            ))}
            {lastResult.warnings.length > 8 && (
              <p className="text-xs text-status-warn">…and {lastResult.warnings.length - 8} more.</p>
            )}
          </div>
        )}

        {/* Per-day capacity summary */}
        {daySummary.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-primary mb-2">Capacity per day</h2>
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="flex items-center px-3 py-2 bg-muted/40 border-b border-border text-xs font-semibold text-muted-foreground">
                <span className="flex-1">Date</span>
                <span className="w-20 text-right">Batches</span>
                <span className="w-32 text-right">Used / Avail.</span>
                <span className="w-20 text-right">Util.</span>
              </div>
              {daySummary.map((row) => (
                <div
                  key={row.day.date}
                  className={`flex items-center px-3 py-1.5 text-sm border-b border-border last:border-b-0 ${
                    row.level === "over" || row.level === "critical" ? "bg-destructive/5" :
                    row.level === "warn" ? "bg-status-warn-bg/30" : ""
                  }`}
                >
                  <span className="flex-1 font-medium">{formatDayLabel(row.day.date)}</span>
                  <span className="w-20 text-right text-muted-foreground tabular-nums">{row.batchCount}</span>
                  <span className="w-32 text-right tabular-nums">
                    {row.usedMinutes} / {row.availableMinutes} min
                  </span>
                  <span className={`w-20 text-right text-xs font-medium rounded-full border px-2 py-0.5 ${LEVEL_STYLE[row.level]}`}>
                    {row.utilisationPercent}%
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Saved plan — per-day breakdown of batches and steps. */}
        {hasPlan ? (
          <section>
            <h2 className="text-sm font-semibold text-primary mb-2 flex items-center gap-1.5">
              <Calendar className="w-4 h-4" /> Saved plan
            </h2>
            <div className="space-y-3">
              {daySummary.map(({ day }) => {
                const dayLineItems = lineItems
                  .filter((li) => li.productionDayId === day.id)
                  .sort((a, b) => a.sortOrder - b.sortOrder);
                return (
                  <div key={day.id} className="rounded-lg border border-border bg-card overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b border-border">
                      <span className="text-sm font-medium">{formatDayLabel(day.date)}</span>
                      <span className="text-xs text-muted-foreground">
                        {dayLineItems.length} batch{dayLineItems.length !== 1 ? "es" : ""}
                      </span>
                    </div>
                    <ul className="divide-y divide-border">
                      {dayLineItems.map((li) => {
                        const plan = planMap.get(li.planId);
                        const pps = planProductsByPlan.get(li.planId) ?? [];
                        const productNames = [...new Set(
                          pps.map((pp) => productMap.get(pp.productId)?.name ?? pp.productId),
                        )];
                        const moulds = pps.reduce((s, pp) => s + pp.quantity, 0);
                        const orderRef = batchOrderRef.get(li.planId)?.ref;
                        const label = [
                          productNames.length === 1 ? productNames[0] : `${productNames.length} products`,
                          moulds > 0 ? `${moulds} mould${moulds === 1 ? "" : "s"}` : null,
                          orderRef ? `for ${orderRef}` : null,
                        ].filter(Boolean).join(" · ");
                        const orderedSteps = [...li.stepIds].sort((a, b) => {
                          const sa = stepById.get(a)?.sortOrder ?? 0;
                          const sb = stepById.get(b)?.sortOrder ?? 0;
                          return sa - sb;
                        });
                        return (
                          <li key={li.id ?? `${li.productionDayId}-${li.planId}`}>
                            <Link
                              href={plan?.id ? `/production/${encodeURIComponent(plan.id)}` : "#"}
                              className="block px-3 py-2 hover:bg-muted/20"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">
                                    {plan?.name ?? "Batch"}
                                    {plan?.batchNumber && (
                                      <span className="ml-2 font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                        {plan.batchNumber}
                                      </span>
                                    )}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground truncate">{label}</p>
                                  <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1 flex-wrap">
                                    {orderedSteps.map((stepId) => {
                                      const step = stepById.get(stepId);
                                      const done = stepDoneFor(li.planId, stepId);
                                      return (
                                        <span
                                          key={stepId}
                                          className={`rounded px-1.5 py-0.5 border ${
                                            done
                                              ? "border-status-ok/40 bg-status-ok/10 text-status-ok"
                                              : "border-border bg-card text-muted-foreground"
                                          }`}
                                        >
                                          {step?.name ?? stepId}
                                        </span>
                                      );
                                    })}
                                  </p>
                                </div>
                                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                                  {li.plannedMinutes}m
                                </span>
                              </div>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>
        ) : (
          <p className="text-sm text-muted-foreground py-6 text-center border border-dashed border-border rounded-lg">
            No plan saved yet. Click Regenerate to compute one from your open orders.
          </p>
        )}
      </div>
    </div>
  );
}

function formatDayLabel(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  const label = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  if (days === 0) return `${label} (today)`;
  if (days === 1) return `${label} (tomorrow)`;
  if (days < 0) return `${label} (${-days}d ago)`;
  return `${label} (in ${days}d)`;
}
