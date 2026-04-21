"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import {
  useOrders, useAllOrderItems, useProductsList, useProductionSteps,
  useCapacityConfig, usePeople, usePersonUnavailability, useBlockedDays,
  useProductCategories, useMouldsList, useProductionPlans, useAllPlanProducts,
  useProductionSchedule, replaceProductionSchedule, updateScheduleStatus,
} from "@/lib/hooks";
import { buildSchedule, timeBandFor, TIME_BAND_LABEL } from "@/lib/scheduler";
import { capacityConfigStatus } from "@/lib/capacity";
import { RefreshCw, AlertTriangle, CheckCircle, Flame } from "lucide-react";
import type { ProductionScheduleEntry } from "@/types";

const LEVEL_STYLE = {
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
  const stored = useProductionSchedule();

  const productMap = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const mouldMap = useMemo(() => new Map(moulds.map((m) => [m.id!, m])), [moulds]);
  const orderMap = useMemo(() => new Map(orders.map((o) => [o.id!, o])), [orders]);
  const planMap = useMemo(() => new Map(plans.map((p) => [p.id!, p])), [plans]);
  const planProductsByPlan = useMemo(() => {
    const m = new Map<string, typeof planProducts>();
    for (const pp of planProducts) {
      const arr = m.get(pp.planId) ?? [];
      arr.push(pp);
      m.set(pp.planId, arr);
    }
    return m;
  }, [planProducts]);
  // Earliest-linked-order label per batch — powers "[N moulds] — [Order ref]".
  const batchOrderRef = useMemo(() => {
    const best = new Map<string, { ref: string; deadline: string }>();
    for (const oi of orderItems) {
      if (!oi.linkedBatchId) continue;
      const order = orderMap.get(oi.orderId);
      if (!order) continue;
      const cur = best.get(oi.linkedBatchId);
      if (!cur || order.deadline < cur.deadline) {
        best.set(oi.linkedBatchId, {
          ref: order.customerName || order.eventName || order.sourceRef || "order",
          deadline: order.deadline,
        });
      }
    }
    return best;
  }, [orderItems, orderMap]);
  const categoryNameById = useMemo(
    () => new Map(categories.map((c) => [c.id!, c.name])),
    [categories],
  );

  const [regenerating, setRegenerating] = useState(false);
  const [lastResult, setLastResult] = useState<{ warnings: string[]; unscheduledPlanIds: string[]; count: number } | null>(null);
  const [regenerateError, setRegenerateError] = useState("");

  const configStatus = capacityConfigStatus(config, people);

  // Preview the schedule that WOULD result from current inputs (without writing)
  const preview = useMemo(
    () => buildSchedule({
      plans, planProducts, orders, orderItems, products, productionSteps, moulds,
      config, people, unavailability, blockedDays, categoryNameById,
    }),
    [plans, planProducts, orders, orderItems, products, productionSteps, moulds, config, people, unavailability, blockedDays, categoryNameById],
  );

  // Group stored schedule rows into (date → planId → entries). Each
  // resulting (date, planId) pair renders as ONE row on the plan view:
  // "[Product] — [N] moulds — [Order ref]", with the band derived
  // from the earliest entry's startAt.
  const batchesByDate = useMemo(() => {
    // date → planId → entries
    const m = new Map<string, Map<string, ProductionScheduleEntry[]>>();
    for (const row of stored) {
      const date = row.startAt.slice(0, 10);
      const planId = row.planId ?? row.orderId ?? "__unassigned";
      const byPlan = m.get(date) ?? new Map<string, ProductionScheduleEntry[]>();
      const arr = byPlan.get(planId) ?? [];
      arr.push(row);
      byPlan.set(planId, arr);
      m.set(date, byPlan);
    }
    return m;
  }, [stored]);

  async function handleRegenerate() {
    setRegenerating(true);
    setRegenerateError("");
    try {
      await replaceProductionSchedule(preview.entries);
      setLastResult({
        warnings: preview.warnings,
        unscheduledPlanIds: preview.unscheduledPlanIds,
        count: preview.entries.length,
      });
    } catch (err) {
      // Surface the real Postgres error — previously this was a
      // silent promise rejection. Supabase throws PostgrestError as a
      // plain object, not an Error instance, so read the shape defensively.
      const raw: { message?: string; code?: string; details?: string; hint?: string } =
        err instanceof Error ? { message: err.message } : ((err as Record<string, string>) ?? {});
      const code = raw.code ? ` (code ${raw.code})` : "";
      const hint = raw.hint ? ` — ${raw.hint}` : "";
      setRegenerateError(`${raw.message || raw.details || "Regenerate failed"}${code}${hint}`);
      console.error("replaceProductionSchedule failed:", err);
    } finally {
      setRegenerating(false);
    }
  }

  const hasStored = stored.length > 0;

  return (
    <div>
      <PageHeader
        title="Production Plan"
        description="Reverse-scheduled tasks from open orders. Regenerate to pick up order / capacity / step changes."
      />

      <div className="px-4 pb-8 space-y-4">
        {/* Pre-flight status */}
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
              {preview.entries.length} task{preview.entries.length !== 1 ? "s" : ""} would be scheduled from{" "}
              {plans.filter((p) => p.status !== "done").length} active batch{plans.filter((p) => p.status !== "done").length !== 1 ? "es" : ""}.
            </p>
            {hasStored && (
              <p className="text-xs text-muted-foreground">
                Saved plan: {stored.length} task{stored.length !== 1 ? "s" : ""} across {batchesByDate.size} day{batchesByDate.size !== 1 ? "s" : ""}.
              </p>
            )}
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
              <span>Plan regenerated: {lastResult.count} task{lastResult.count !== 1 ? "s" : ""} saved.</span>
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

        {/* Scheduler warnings */}
        {preview.warnings.length > 0 && (
          <div className="rounded-md bg-status-warn-bg border border-status-warn-edge px-3 py-2 space-y-1">
            {preview.warnings.slice(0, 8).map((w, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-status-warn">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{w}</span>
              </div>
            ))}
            {preview.warnings.length > 8 && (
              <p className="text-xs text-status-warn">…and {preview.warnings.length - 8} more.</p>
            )}
          </div>
        )}

        {/* Daily capacity summary (from preview — shows what regeneration would create) */}
        {preview.dailySummary.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-primary mb-2">Capacity per day (preview)</h2>
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="flex items-center px-3 py-2 bg-muted/40 border-b border-border text-xs font-semibold text-muted-foreground">
                <span className="flex-1">Date</span>
                <span className="w-20 text-right">Tasks</span>
                <span className="w-32 text-right">Used / Avail.</span>
                <span className="w-20 text-right">Util.</span>
              </div>
              {preview.dailySummary.map((row) => (
                <div
                  key={row.date}
                  className={`flex items-center px-3 py-1.5 text-sm border-b border-border last:border-b-0 ${
                    row.level === "over" || row.level === "critical" ? "bg-destructive/5" :
                    row.level === "warn" ? "bg-status-warn-bg/30" : ""
                  }`}
                >
                  <span className="flex-1 font-medium">{formatDayLabel(row.date)}</span>
                  <span className="w-20 text-right text-muted-foreground tabular-nums">{row.scheduleCount}</span>
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

        {/* Saved plan — one row per active batch per day, labelled
            "[Product] — [N] moulds — [Order ref]". The time band comes
            from the batch's earliest phase that day; subsequent phases
            are rolled into a "Phase → Phase → …" trail. */}
        {hasStored ? (
          <section>
            <h2 className="text-sm font-semibold text-primary mb-2">Saved plan</h2>
            <div className="space-y-3">
              {[...batchesByDate.keys()].sort().map((date) => {
                const byPlan = batchesByDate.get(date)!;
                // Sort batches within the day by earliest phase startAt.
                const batchRows = [...byPlan.entries()]
                  .map(([planId, entries]) => {
                    entries.sort((a, b) => a.startAt.localeCompare(b.startAt));
                    return { planId, entries };
                  })
                  .sort((a, b) => a.entries[0].startAt.localeCompare(b.entries[0].startAt));
                return (
                  <div key={date} className="rounded-lg border border-border bg-card overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b border-border">
                      <span className="text-sm font-medium">{formatDayLabel(date)}</span>
                      <span className="text-xs text-muted-foreground">
                        {batchRows.length} batch{batchRows.length !== 1 ? "es" : ""}
                      </span>
                    </div>
                    <ul className="divide-y divide-border">
                      {batchRows.map(({ planId, entries }) => {
                        const plan = planMap.get(planId);
                        const pps = plan ? (planProductsByPlan.get(planId) ?? []) : [];
                        const productNames = Array.from(new Set(
                          pps.length > 0
                            ? pps.map((pp) => productMap.get(pp.productId)?.name ?? pp.productId)
                            : entries.map((e) => productMap.get(e.productId)?.name ?? e.productId),
                        ));
                        const totalMoulds = pps.reduce((s, pp) => s + pp.quantity, 0);
                        const firstEntry = entries[0];
                        const band = TIME_BAND_LABEL[timeBandFor(firstEntry.startAt)];
                        const phaseSeq = Array.from(new Set(entries.map((e) => e.phase)));
                        const orderRef = batchOrderRef.get(planId)?.ref
                          ?? (firstEntry.orderId ? orderMap.get(firstEntry.orderId)?.customerName : undefined)
                          ?? null;
                        const batchLabel = [
                          productNames.length === 1
                            ? productNames[0]
                            : `${productNames.length} products`,
                          totalMoulds > 0 ? `${totalMoulds} mould${totalMoulds === 1 ? "" : "s"}` : null,
                          orderRef,
                        ].filter(Boolean).join(" — ");
                        return (
                          <li key={planId} className="flex items-center gap-2 px-3 py-2 text-sm">
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted rounded px-1.5 py-0.5 shrink-0">
                              {band}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="truncate">
                                <Link
                                  href={plan ? `/production/${encodeURIComponent(plan.id!)}` : "/production"}
                                  className="font-medium hover:underline"
                                >
                                  {plan?.name ?? batchLabel}
                                </Link>
                                {plan && productNames.length > 0 && (
                                  <span className="text-muted-foreground"> — {batchLabel}</span>
                                )}
                              </p>
                              <p className="text-[11px] text-muted-foreground truncate">
                                {phaseSeq.join(" → ")}
                                {productNames.length > 1 && ` · ${productNames.join(", ")}`}
                              </p>
                            </div>
                            <select
                              value={firstEntry.status}
                              onChange={async (e) => {
                                if (firstEntry.id) await updateScheduleStatus(firstEntry.id, e.target.value as ProductionScheduleEntry["status"]);
                              }}
                              className="input !w-auto text-xs !py-1"
                            >
                              <option value="pending">Pending</option>
                              <option value="in_progress">In progress</option>
                              <option value="done">Done</option>
                              <option value="skipped">Skipped</option>
                              <option value="blocked">Blocked</option>
                            </select>
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
            No plan saved yet. Click Regenerate to compute one from your active batches.
          </p>
        )}
      </div>
    </div>
  );
}

function formatDayLabel(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
