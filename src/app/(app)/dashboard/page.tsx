"use client";

import { useMemo } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import {
  useOrders, useAllOrderItems, useProductsList, useProductionSchedule,
  useProductionSteps, useCapacityConfig, usePeople, usePersonUnavailability,
  useBlockedDays, useProductCategories, useMouldsList, useIngredients,
  updateScheduleStatus, useEquipment,
} from "@/lib/hooks";
import { buildSchedule } from "@/lib/scheduler";
import { capacityConfigStatus } from "@/lib/capacity";
import { equipmentReadiness } from "@/lib/equipment";
import { computeShoppingNeeds } from "@/lib/shopping-needs";
import { ORDER_CHANNEL_LABELS, ORDER_PRIORITY_LABELS, ORDER_STATUS_LABELS, type ProductFilling, type FillingIngredient, type ProductionScheduleEntry } from "@/types";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import { AlertTriangle, Clock, CheckCircle, Calendar, ShoppingCart } from "lucide-react";

const LEVEL_STYLE: Record<string, string> = {
  ok: "bg-status-ok-bg text-status-ok border-status-ok-edge",
  warn: "bg-status-warn-bg text-status-warn border-status-warn-edge",
  critical: "bg-destructive/10 text-destructive border-destructive/20",
  over: "bg-destructive text-white border-destructive",
};

export default function DashboardPage() {
  // Core data
  const orders = useOrders();
  const orderItems = useAllOrderItems();
  const products = useProductsList(true);
  const moulds = useMouldsList(true);
  const ingredients = useIngredients(true);
  const equipment = useEquipment(true);
  const steps = useProductionSteps();
  const config = useCapacityConfig();
  const people = usePeople(false);
  const unavailability = usePersonUnavailability();
  const blockedDays = useBlockedDays();
  const categories = useProductCategories(true);
  const schedule = useProductionSchedule();

  const productMap = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const mouldMap = useMemo(() => new Map(moulds.map((m) => [m.id!, m])), [moulds]);
  const categoryNameById = useMemo(() => new Map(categories.map((c) => [c.id!, c.name])), [categories]);

  // Product fillings + filling ingredients (for shopping rollup)
  const { data: productFillings = [] } = useQuery({
    queryKey: ["product-fillings", "all-for-dashboard"],
    queryFn: async () => assertOk(await supabase.from("productFillings").select("*")) as ProductFilling[],
  });
  const { data: fillingIngredients = [] } = useQuery({
    queryKey: ["filling-ingredients", "all-for-dashboard"],
    queryFn: async () => assertOk(await supabase.from("fillingIngredients").select("*")) as FillingIngredient[],
  });
  const fiByFilling = useMemo(() => {
    const m = new Map<string, FillingIngredient[]>();
    for (const li of fillingIngredients) {
      const arr = m.get(li.fillingId) ?? [];
      arr.push(li);
      m.set(li.fillingId, arr);
    }
    return m;
  }, [fillingIngredients]);

  // Derived alerts
  const configStatus = capacityConfigStatus(config, people);
  const equipReady = equipmentReadiness(equipment);
  const hasSteps = steps.length > 0;

  // Today + upcoming
  const todayIso = toIsoDate(new Date());
  const todayTasks = useMemo(
    () => schedule.filter((s) => s.startAt.slice(0, 10) === todayIso),
    [schedule, todayIso],
  );

  // Upcoming deadlines (next 14 days, open orders only)
  const in14 = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 14);
    const cutoffIso = cutoff.toISOString();
    return orders
      .filter((o) => (o.status === "pending" || o.status === "in_production") && o.deadline <= cutoffIso)
      .sort((a, b) => a.deadline.localeCompare(b.deadline));
  }, [orders]);

  const overdue = useMemo(
    () => orders.filter((o) =>
      (o.status === "pending" || o.status === "in_production") &&
      new Date(o.deadline) < new Date(todayIso + "T00:00:00"),
    ),
    [orders, todayIso],
  );

  // Capacity preview for next 7 working days
  const capacityPreview = useMemo(() => {
    const preview = buildSchedule({
      orders, orderItems, products, productionSteps: steps,
      config, people, unavailability, blockedDays, categoryNameById,
    });
    // Keep today + next 7 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 7);
    const cutoffIso = toIsoDate(cutoff);
    return preview.dailySummary.filter((d) => d.date >= todayIso && d.date <= cutoffIso);
  }, [orders, orderItems, products, steps, config, people, unavailability, blockedDays, categoryNameById, todayIso]);

  // Capacity alerts from the preview
  const warnOrCritical = capacityPreview.filter((d) => d.level === "warn" || d.level === "critical" || d.level === "over");

  // Shopping shortages
  const shopping = useMemo(
    () => computeShoppingNeeds({
      orders, orderItems, products, moulds,
      productFillings, fillingIngredientsByFillingId: fiByFilling, ingredients, config,
    }),
    [orders, orderItems, products, moulds, productFillings, fiByFilling, ingredients, config],
  );
  const shortages = shopping.rows.filter((r) => r.shortageG > 0);

  // Alert list (top banner)
  const alerts: { level: "warn" | "critical"; text: string; href: string }[] = [];
  if (!configStatus.isComplete) alerts.push({ level: "warn", text: `Capacity config incomplete (${configStatus.missing.length} missing)`, href: "/settings" });
  if (!equipReady.isComplete && equipReady.incompleteCount > 0) alerts.push({ level: "warn", text: `${equipReady.incompleteCount} equipment item${equipReady.incompleteCount > 1 ? "s" : ""} missing quantity or throughput`, href: "/settings" });
  if (!hasSteps) alerts.push({ level: "warn", text: "No production steps defined", href: "/settings" });
  if (overdue.length > 0) alerts.push({ level: "critical", text: `${overdue.length} order${overdue.length > 1 ? "s" : ""} past deadline`, href: "/orders" });
  if (warnOrCritical.length > 0) alerts.push({ level: warnOrCritical.some((d) => d.level !== "warn") ? "critical" : "warn", text: `${warnOrCritical.length} day${warnOrCritical.length > 1 ? "s" : ""} over capacity threshold in the next week`, href: "/plan" });
  if (shortages.length > 0) alerts.push({ level: "warn", text: `${shortages.length} ingredient${shortages.length > 1 ? "s" : ""} short for open orders`, href: "/shopping" });

  return (
    <div>
      <PageHeader title="Dashboard" description={new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} />

      <div className="px-4 pb-8 space-y-6">
        {/* Alerts */}
        {alerts.length > 0 ? (
          <section className="space-y-2">
            {alerts.map((a, i) => (
              <Link
                key={i}
                href={a.href}
                className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
                  a.level === "critical" ? "bg-destructive/10 border-destructive/20 text-destructive" : "bg-status-warn-bg border-status-warn-edge text-status-warn"
                }`}
              >
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="flex-1">{a.text}</span>
                <span className="text-xs opacity-70">→</span>
              </Link>
            ))}
          </section>
        ) : (
          <section>
            <div className="flex items-center gap-2 rounded-md bg-status-ok-bg border border-status-ok-edge px-3 py-2 text-xs text-status-ok">
              <CheckCircle className="w-4 h-4" /> No active alerts — the workshop is on track.
            </div>
          </section>
        )}

        {/* Today's tasks */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-primary flex items-center gap-1.5">
              <Clock className="w-4 h-4" /> Today's tasks
            </h2>
            <Link href="/plan" className="text-xs text-primary hover:underline">View plan →</Link>
          </div>
          {todayTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3 text-center border border-dashed border-border rounded-lg">
              No tasks scheduled for today.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {todayTasks.map((row) => {
                const product = productMap.get(row.productId);
                const mould = row.mouldId ? mouldMap.get(row.mouldId) : undefined;
                return (
                  <li key={row.id} className="flex items-center gap-2 px-3 py-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${row.status === "done" ? "bg-status-ok" : row.status === "in_progress" ? "bg-status-warn" : row.status === "blocked" ? "bg-destructive" : "bg-muted-foreground"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">
                        <span className="font-medium">{row.phase}</span>
                        <span className="text-muted-foreground"> · {product?.name ?? row.productId}</span>
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {row.durationMinutes} min{mould && ` · ${mould.name}`}
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
          )}
        </section>

        {/* Capacity — next 7 days */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-primary flex items-center gap-1.5">
              <Calendar className="w-4 h-4" /> Capacity — next 7 days
            </h2>
            <Link href="/plan" className="text-xs text-primary hover:underline">Full plan →</Link>
          </div>
          {capacityPreview.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3 text-center border border-dashed border-border rounded-lg">
              No scheduled work in the next week.
            </p>
          ) : (
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              {capacityPreview.map((row) => (
                <div key={row.date} className={`flex items-center px-3 py-1.5 text-sm border-b border-border last:border-b-0 ${row.level === "over" || row.level === "critical" ? "bg-destructive/5" : row.level === "warn" ? "bg-status-warn-bg/30" : ""}`}>
                  <span className="flex-1 font-medium">{formatDayLabel(row.date)}</span>
                  <span className="w-16 text-right text-xs text-muted-foreground">{row.scheduleCount} task{row.scheduleCount !== 1 ? "s" : ""}</span>
                  <span className="w-32 text-right tabular-nums text-xs text-muted-foreground">{row.usedMinutes} / {row.availableMinutes} min</span>
                  <span className={`w-16 text-right text-xs font-medium rounded-full border px-2 py-0.5 ${LEVEL_STYLE[row.level]}`}>{row.utilisationPercent}%</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Upcoming deadlines */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-primary flex items-center gap-1.5">
              <Calendar className="w-4 h-4" /> Upcoming deadlines
            </h2>
            <Link href="/orders" className="text-xs text-primary hover:underline">All orders →</Link>
          </div>
          {in14.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3 text-center border border-dashed border-border rounded-lg">
              Nothing due in the next 14 days.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {in14.slice(0, 10).map((order) => {
                const days = Math.round((new Date(order.deadline).getTime() - new Date(todayIso + "T00:00:00").getTime()) / 86_400_000);
                const isOverdue = days < 0;
                return (
                  <li key={order.id}>
                    <Link href={`/orders/${encodeURIComponent(order.id!)}`} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {order.customerName || order.eventName || "(unnamed)"}
                          <span className="ml-2 text-xs text-muted-foreground">{ORDER_CHANNEL_LABELS[order.channel]} · {ORDER_PRIORITY_LABELS[order.priority]}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">{ORDER_STATUS_LABELS[order.status]}</p>
                      </div>
                      <div className={`text-right shrink-0 text-xs ${isOverdue ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                        {isOverdue ? "overdue" : days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days}d`}
                        <p>{new Date(order.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Shopping shortages */}
        {shortages.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-primary flex items-center gap-1.5">
                <ShoppingCart className="w-4 h-4" /> Stock shortages
              </h2>
              <Link href="/shopping" className="text-xs text-primary hover:underline">Shopping list →</Link>
            </div>
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {shortages.slice(0, 5).map((row) => (
                <li key={row.ingredientId} className="flex items-center px-3 py-2 text-sm">
                  <Link href={`/ingredients/${encodeURIComponent(row.ingredientId)}`} className="flex-1 truncate hover:underline">
                    {row.name}
                  </Link>
                  <span className="text-xs text-muted-foreground mr-3 tabular-nums">need {formatGrams(row.neededG)}</span>
                  <span className="text-xs font-medium text-destructive tabular-nums">short {formatGrams(row.shortageG)}</span>
                </li>
              ))}
              {shortages.length > 5 && (
                <li className="px-3 py-2 text-xs text-muted-foreground text-center">
                  +{shortages.length - 5} more on the shopping list
                </li>
              )}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function formatDayLabel(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
function formatGrams(g: number): string {
  if (g >= 1000) return `${(g / 1000).toFixed(1)} kg`;
  return `${Math.round(g)} g`;
}
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
