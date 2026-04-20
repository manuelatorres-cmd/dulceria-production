"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import {
  useOrders, useAllOrderItems, useProductsList, useProductionSteps,
  useCapacityConfig, usePeople, usePersonUnavailability, useBlockedDays,
  useProductCategories, useMouldsList,
  useProductionSchedule, replaceProductionSchedule, updateScheduleStatus,
} from "@/lib/hooks";
import { buildSchedule } from "@/lib/scheduler";
import { capacityConfigStatus } from "@/lib/capacity";
import { RefreshCw, AlertTriangle, CheckCircle } from "lucide-react";
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
  const stored = useProductionSchedule();

  const productMap = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const mouldMap = useMemo(() => new Map(moulds.map((m) => [m.id!, m])), [moulds]);
  const orderMap = useMemo(() => new Map(orders.map((o) => [o.id!, o])), [orders]);
  const categoryNameById = useMemo(
    () => new Map(categories.map((c) => [c.id!, c.name])),
    [categories],
  );

  const [regenerating, setRegenerating] = useState(false);
  const [lastResult, setLastResult] = useState<{ warnings: string[]; unscheduledOrderIds: string[]; count: number } | null>(null);

  const configStatus = capacityConfigStatus(config, people);

  // Preview the schedule that WOULD result from current inputs (without writing)
  const preview = useMemo(
    () => buildSchedule({
      orders, orderItems, products, productionSteps,
      config, people, unavailability, blockedDays, categoryNameById,
    }),
    [orders, orderItems, products, productionSteps, config, people, unavailability, blockedDays, categoryNameById],
  );

  // Group stored schedule rows by date
  const storedByDate = useMemo(() => {
    const m = new Map<string, ProductionScheduleEntry[]>();
    for (const row of stored) {
      const date = row.startAt.slice(0, 10);
      const arr = m.get(date) ?? [];
      arr.push(row);
      m.set(date, arr);
    }
    return m;
  }, [stored]);

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      await replaceProductionSchedule(preview.entries);
      setLastResult({
        warnings: preview.warnings,
        unscheduledOrderIds: preview.unscheduledOrderIds,
        count: preview.entries.length,
      });
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
        <div className="flex items-center justify-between">
          <div className="text-sm">
            <p className="text-muted-foreground">
              {preview.entries.length} task{preview.entries.length !== 1 ? "s" : ""} would be scheduled from{" "}
              {orders.filter((o) => o.status === "pending" || o.status === "in_production").length} open order{orders.filter((o) => o.status === "pending" || o.status === "in_production").length !== 1 ? "s" : ""}.
            </p>
            {hasStored && (
              <p className="text-xs text-muted-foreground">
                Saved plan: {stored.length} task{stored.length !== 1 ? "s" : ""} across {storedByDate.size} day{storedByDate.size !== 1 ? "s" : ""}.
              </p>
            )}
          </div>
          <button
            onClick={handleRegenerate}
            disabled={regenerating || !configStatus.isComplete}
            className="flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? "animate-spin" : ""}`} />
            {regenerating ? "Regenerating…" : "Regenerate plan"}
          </button>
        </div>

        {lastResult && (
          <div className="rounded-md bg-status-ok-bg border border-status-ok-edge px-3 py-2">
            <div className="flex items-start gap-2 text-xs text-status-ok">
              <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Plan regenerated: {lastResult.count} task{lastResult.count !== 1 ? "s" : ""} saved.</span>
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

        {/* Saved daily tasks */}
        {hasStored ? (
          <section>
            <h2 className="text-sm font-semibold text-primary mb-2">Saved tasks</h2>
            <div className="space-y-3">
              {[...storedByDate.keys()].sort().map((date) => {
                const rows = storedByDate.get(date)!;
                const uniqueMoulds = new Set(rows.map((r) => r.mouldId).filter(Boolean) as string[]);
                return (
                  <div key={date} className="rounded-lg border border-border bg-card overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b border-border">
                      <span className="text-sm font-medium">{formatDayLabel(date)}</span>
                      <span className="text-xs text-muted-foreground">
                        {rows.length} task{rows.length !== 1 ? "s" : ""}
                        {uniqueMoulds.size > 0 && ` · ${uniqueMoulds.size} mould${uniqueMoulds.size !== 1 ? "s" : ""}`}
                      </span>
                    </div>
                    <ul className="divide-y divide-border">
                      {rows.map((row) => {
                        const product = productMap.get(row.productId);
                        const mould = row.mouldId ? mouldMap.get(row.mouldId) : undefined;
                        const order = row.orderId ? orderMap.get(row.orderId) : undefined;
                        return (
                          <li key={row.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                            <div className="flex-1 min-w-0">
                              <p className="truncate">
                                <span className="font-medium">{row.phase}</span>
                                <span className="text-muted-foreground"> · {product?.name ?? row.productId}</span>
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {row.durationMinutes} min
                                {mould && ` · ${mould.name}`}
                                {order && ` · ${order.customerName || order.eventName || "order"}`}
                              </p>
                            </div>
                            <select
                              value={row.status}
                              onChange={async (e) => {
                                if (row.id) await updateScheduleStatus(row.id, e.target.value as ProductionScheduleEntry["status"]);
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
            No plan saved yet. Click Regenerate to compute one from your open orders.
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
