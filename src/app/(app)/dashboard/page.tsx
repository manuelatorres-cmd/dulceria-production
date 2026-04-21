"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import {
  useOrders, useAllOrderItems, useProductsList, useProductionSchedule,
  useProductionSteps, useCapacityConfig, usePeople, usePersonUnavailability,
  useBlockedDays, useProductCategories, useMouldsList, useIngredients,
  useEquipment,
  useProductLocationTotals, useStockLocationMinimums, useAllPlanProducts,
  useProductionPlans, useAllPlanStepStatuses, DEFAULT_LOCATION_MINIMUM,
  useFillings, useFillingCategories, useFillingStockItems,
  useCustomerFollowups, useCustomers, completeCustomerFollowup,
  useTodayProductionDay, openProductionDay, closeProductionDay,
  saveTemperatureReadings, yesterdayTemperatureReadings,
  type CloseProductionSummary,
} from "@/lib/hooks";
import { TemperatureLogModal } from "@/components/temperature-log-modal";
import { buildSchedule, timeBandFor, TIME_BAND_LABEL } from "@/lib/scheduler";
import { capacityConfigStatus } from "@/lib/capacity";
import { equipmentReadiness } from "@/lib/equipment";
import { computeShoppingNeeds } from "@/lib/shopping-needs";
import { computeWeeklyFillingNeeds } from "@/lib/weeklyFilling";
import { ORDER_CHANNEL_LABELS, ORDER_PRIORITY_LABELS, ORDER_STATUS_LABELS, STOCK_LOCATION_SHORT_LABELS, type ProductFilling, type FillingIngredient, type ProductionScheduleEntry, type StockLocation, type ProductionPlan, type PlanStepStatus } from "@/types";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import { AlertTriangle, Clock, CheckCircle, Calendar, ShoppingCart, Flame, Users, Play, Square, Thermometer } from "lucide-react";

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
  const allPlans = useProductionPlans();
  const allPlanProducts = useAllPlanProducts();

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
      plans: allPlans, planProducts: allPlanProducts,
      orders, orderItems, products, productionSteps: steps, moulds,
      config, people, unavailability, blockedDays, categoryNameById,
    });
    // Keep today + next 7 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 7);
    const cutoffIso = toIsoDate(cutoff);
    return preview.dailySummary.filter((d) => d.date >= todayIso && d.date <= cutoffIso);
  }, [allPlans, allPlanProducts, orders, orderItems, products, steps, moulds, config, people, unavailability, blockedDays, categoryNameById, todayIso]);

  // Production day — Open + Close Production actions and HACCP temperature log
  const todayDay = useTodayProductionDay();
  const tempCheckDevices = useMemo(() => equipment.filter((e) => e.requiresTempCheck && !e.archived), [equipment]);
  const [tempModalOpen, setTempModalOpen] = useState(false);
  const [previousReadings, setPreviousReadings] = useState<Map<string, number>>(new Map());
  const [closeSummary, setCloseSummary] = useState<CloseProductionSummary | null>(null);
  const [busyDayAction, setBusyDayAction] = useState<"opening" | "closing" | null>(null);

  // Dismiss the production-day prompt for the current local day. The
  // banner reappears tomorrow on reload — it's a daily nudge, not a
  // hard dependency.
  const productionBannerKey = `dashboard:productionDay:dismissed:${todayIso}`;
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(productionBannerKey) === "1";
  });
  function dismissBanner() {
    if (typeof window !== "undefined") window.localStorage.setItem(productionBannerKey, "1");
    setBannerDismissed(true);
  }
  // Show the banner only when there's something actionable: an open
  // day's pending temp log, or (no day yet AND user has temp-check
  // equipment to log) — otherwise the prompt is noise.
  const hasActionableProductionState = (todayDay && !todayDay.closedAt && tempCheckDevices.length > 0 && !todayDay.tempLogComplete)
    || (!todayDay && tempCheckDevices.length > 0);
  const showProductionBanner = hasActionableProductionState && !bannerDismissed;

  async function handleOpenProduction() {
    setBusyDayAction("opening");
    try {
      await openProductionDay();
      if (tempCheckDevices.length > 0) {
        setPreviousReadings(await yesterdayTemperatureReadings());
        setTempModalOpen(true);
      }
    } finally {
      setBusyDayAction(null);
    }
  }

  async function handleCloseProduction() {
    if (!confirm("Close today's production? Unfinished steps will carry forward to tomorrow.")) return;
    setBusyDayAction("closing");
    try {
      const summary = await closeProductionDay();
      setCloseSummary(summary);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to close production");
    } finally {
      setBusyDayAction(null);
    }
  }

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

  // Stock — below minimum by (product, location)
  const locationTotals = useProductLocationTotals();
  const locationMinimums = useStockLocationMinimums();
  const lowStock = useMemo(() => {
    const minByKey = new Map<string, number>();
    for (const m of locationMinimums) {
      minByKey.set(`${m.productId}:${m.location}`, m.minimumUnits);
    }
    const relevant: StockLocation[] = ["store", "production"];
    const rows: Array<{ productId: string; productName: string; location: StockLocation; quantity: number; minimum: number }> = [];
    for (const [productId, totals] of locationTotals) {
      const product = productMap.get(productId);
      if (!product) continue;
      for (const loc of relevant) {
        const minimum = minByKey.get(`${productId}:${loc}`) ?? DEFAULT_LOCATION_MINIMUM;
        const qty = totals[loc] ?? 0;
        if (qty < minimum) {
          rows.push({ productId, productName: product.name, location: loc, quantity: qty, minimum });
        }
      }
    }
    return rows.sort((a, b) => (a.quantity / Math.max(1, a.minimum)) - (b.quantity / Math.max(1, b.minimum)));
  }, [locationTotals, locationMinimums, productMap]);

  // Customer follow-ups — due today or overdue + soon (next 14 days)
  const followups = useCustomerFollowups();
  const customersAll = useCustomers(true);
  const customerByIdDash = useMemo(() => new Map(customersAll.map((c) => [c.id!, c])), [customersAll]);
  const todayIsoStr = todayIso;
  const upcomingFollowups = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 14);
    const cutoffIso = toIsoDate(cutoff);
    return followups
      .filter((f) => !f.completedAt && f.dueDate <= cutoffIso)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [followups]);
  const overdueFollowups = upcomingFollowups.filter((f) => f.dueDate < todayIsoStr);

  // Filling cooking list — next 7 days
  const fillingsList = useFillings(true);
  const fillingCategoriesList = useFillingCategories(true);
  const fillingStockItems = useFillingStockItems();
  const weeklyFilling = useMemo(() => {
    const windowEnd = new Date();
    windowEnd.setDate(windowEnd.getDate() + 7);
    return computeWeeklyFillingNeeds({
      orders,
      orderItems,
      products,
      productFillings,
      fillingIngredients,
      fillings: fillingsList,
      fillingCategories: fillingCategoriesList,
      moulds,
      fillingStock: fillingStockItems,
      fillingBufferPercent: config?.fillingBufferPercent,
      windowEnd,
    });
  }, [orders, orderItems, products, productFillings, fillingIngredients, fillingsList, fillingCategoriesList, moulds, fillingStockItems, config?.fillingBufferPercent]);
  const fillingsToCook = weeklyFilling.needs.filter((n) => n.toCookBufferedG > 0);

  // Expiry — batches whose sell-by falls within the configured warn window.
  const planById = useMemo(() => new Map(allPlans.map((p) => [p.id!, p])), [allPlans]);
  const expiryWarn = useMemo(() => {
    const days = config?.stockExpiryWarnDays;
    if (days == null || days < 0) return [];
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const WEEK = 7 * DAY;
    const rows: Array<{ planProductId: string; productName: string; batchNumber?: string; sellBy: Date; remainingDays: number; pieces: number }> = [];
    for (const pb of allPlanProducts) {
      if (pb.stockStatus === "gone") continue;
      const pieces = (pb.currentStock ?? pb.actualYield ?? 0) + (pb.frozenQty ?? 0);
      if (pieces <= 0) continue;
      const product = productMap.get(pb.productId);
      if (!product?.shelfLifeWeeks) continue;
      const plan = planById.get(pb.planId);
      if (!plan?.completedAt) continue;
      const completed = new Date(plan.completedAt).getTime();
      const shelfWeeks = parseFloat(product.shelfLifeWeeks);
      if (!Number.isFinite(shelfWeeks) || shelfWeeks <= 0) continue;
      const sellByMs = pb.defrostedAt && pb.preservedShelfLifeDays != null
        ? pb.defrostedAt + pb.preservedShelfLifeDays * DAY
        : completed + shelfWeeks * WEEK;
      const remainingDays = Math.round((sellByMs - now) / DAY);
      if (remainingDays <= days) {
        rows.push({
          planProductId: pb.id!,
          productName: product.name,
          batchNumber: plan.batchNumber,
          sellBy: new Date(sellByMs),
          remainingDays,
          pieces,
        });
      }
    }
    return rows.sort((a, b) => a.remainingDays - b.remainingDays);
  }, [allPlanProducts, productMap, planById, config?.stockExpiryWarnDays]);

  // Alert list (top banner)
  const alerts: { level: "warn" | "critical"; text: string; href: string }[] = [];
  if (!configStatus.isComplete) alerts.push({ level: "warn", text: `Capacity config incomplete (${configStatus.missing.length} missing)`, href: "/settings" });
  if (!equipReady.isComplete && equipReady.incompleteCount > 0) alerts.push({ level: "warn", text: `${equipReady.incompleteCount} equipment item${equipReady.incompleteCount > 1 ? "s" : ""} missing quantity or throughput`, href: "/settings" });
  if (!hasSteps) alerts.push({ level: "warn", text: "No production steps defined", href: "/settings" });
  if (overdue.length > 0) alerts.push({ level: "critical", text: `${overdue.length} order${overdue.length > 1 ? "s" : ""} past deadline`, href: "/orders" });
  if (warnOrCritical.length > 0) alerts.push({ level: warnOrCritical.some((d) => d.level !== "warn") ? "critical" : "warn", text: `${warnOrCritical.length} day${warnOrCritical.length > 1 ? "s" : ""} over capacity threshold in the next week`, href: "/plan" });
  if (shortages.length > 0) alerts.push({ level: "warn", text: `${shortages.length} ingredient${shortages.length > 1 ? "s" : ""} short for open orders`, href: "/shopping" });
  if (lowStock.length > 0) alerts.push({ level: "warn", text: `${lowStock.length} product/location below minimum`, href: "/stock" });
  if (expiryWarn.length > 0) alerts.push({ level: expiryWarn.some((r) => r.remainingDays <= 0) ? "critical" : "warn", text: `${expiryWarn.length} batch${expiryWarn.length > 1 ? "es" : ""} approaching sell-by`, href: "/stock" });
  if (overdueFollowups.length > 0) alerts.push({ level: "warn", text: `${overdueFollowups.length} overdue follow-up${overdueFollowups.length > 1 ? "s" : ""}`, href: "/customers" });
  if (todayDay && !todayDay.closedAt && tempCheckDevices.length > 0 && !todayDay.tempLogComplete) {
    alerts.push({ level: "warn", text: "Daily temperature log not completed", href: "/" });
  }

  return (
    <div>
      <PageHeader title="Dashboard" description={new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} />

      <div className="px-4 pb-8 space-y-6">
        {/* Production day controls — shown only when there's something
            HACCP-actionable (open day with pending temp log, or no day
            yet and the user actually has temp-check equipment). The
            user can also dismiss for the rest of today. */}
        {showProductionBanner && (
          <section className="rounded-lg border border-border bg-card p-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${
                !todayDay
                  ? "bg-muted-foreground"
                  : todayDay.closedAt
                    ? "bg-muted-foreground"
                    : "bg-status-ok"
              }`} />
              <div>
                <p className="text-sm font-semibold">
                  {!todayDay
                    ? "Production day not opened"
                    : "Temperatures pending"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {tempCheckDevices.length} device{tempCheckDevices.length === 1 ? "" : "s"} need a check today
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {todayDay && !todayDay.closedAt && (
                <button
                  onClick={async () => {
                    setPreviousReadings(await yesterdayTemperatureReadings());
                    setTempModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-status-warn-edge bg-status-warn-bg text-status-warn px-3 py-1.5 text-xs font-medium"
                >
                  <Thermometer className="w-3.5 h-3.5" /> Log temperatures
                </button>
              )}
              {!todayDay && (
                <button
                  onClick={handleOpenProduction}
                  disabled={busyDayAction === "opening"}
                  className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" /> Open production
                </button>
              )}
              <button
                onClick={dismissBanner}
                className="text-muted-foreground hover:text-foreground p-1"
                title="Hide for today"
                aria-label="Hide for today"
              >
                ×
              </button>
            </div>
          </section>
        )}

        {/* Compact close-production control — surfaced inline when
            production is open but the banner is hidden / not actionable. */}
        {todayDay && !todayDay.closedAt && !showProductionBanner && (
          <div className="flex justify-end">
            <button
              onClick={handleCloseProduction}
              disabled={busyDayAction === "closing"}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary disabled:opacity-50"
            >
              <Square className="w-3 h-3" /> Close production day
            </button>
          </div>
        )}

        {/* Today's production — unified widget: shows scheduled phases for
            today joined to their productionPlan + live step-status so the
            user sees exactly what's pending, in progress, or done without
            having to visit the batch page. Replaces the old split
            "Today's tasks" + "Today's production" lists which drew from
            different sources and drifted out of sync. */}
        <TodaysProductionSection
          schedule={schedule}
          productMap={productMap}
          orders={orders}
        />

        {/* Close Production summary */}
        {closeSummary && (
          <section className="rounded-lg border border-status-ok-edge bg-status-ok-bg p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-status-ok">Production closed</p>
                <p className="text-xs text-foreground/80 mt-0.5">
                  {closeSummary.stepsCompleted} step{closeSummary.stepsCompleted === 1 ? "" : "s"} completed
                  {closeSummary.piecesProduced > 0 && ` · ${closeSummary.piecesProduced} pieces produced`}
                  {closeSummary.batchesRun > 0 && ` · ${closeSummary.batchesRun} batch${closeSummary.batchesRun === 1 ? "" : "es"} run`}
                </p>
                {closeSummary.stepsCarriedForward > 0 && (
                  <p className="text-xs text-foreground/80 mt-0.5">
                    {closeSummary.stepsCarriedForward} unfinished step{closeSummary.stepsCarriedForward === 1 ? "" : "s"} carried forward to tomorrow.
                  </p>
                )}
                {closeSummary.carriedDeadlineAffected.length > 0 && (
                  <div className="mt-2 rounded-md bg-status-warn-bg border border-status-warn-edge px-2.5 py-1.5 text-[11px] text-status-warn">
                    <p className="font-medium">Deadlines at risk:</p>
                    <ul className="mt-0.5 space-y-0.5">
                      {closeSummary.carriedDeadlineAffected.map((o) => (
                        <li key={o.orderId}>
                          {o.orderName} · due {new Date(o.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <button onClick={() => setCloseSummary(null)} className="text-xs text-muted-foreground hover:text-foreground">Dismiss</button>
            </div>
          </section>
        )}

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

        {/* Customer follow-ups */}
        {upcomingFollowups.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-primary flex items-center gap-1.5">
                <Users className="w-4 h-4" /> Follow-ups
              </h2>
              <Link href="/customers" className="text-xs text-primary hover:underline">All customers →</Link>
            </div>
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {upcomingFollowups.slice(0, 6).map((f) => {
                const overdue = f.dueDate < todayIsoStr;
                const customer = customerByIdDash.get(f.customerId);
                return (
                  <li key={f.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <button
                      onClick={() => completeCustomerFollowup(f.id!, true)}
                      className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${overdue ? "border-status-alert" : "border-border"}`}
                      aria-label="Mark follow-up complete"
                    >
                      <CheckCircle className="w-3 h-3 opacity-0" />
                    </button>
                    <Link
                      href={f.customerId ? `/customers/${encodeURIComponent(f.customerId)}` : "/customers"}
                      className="flex-1 min-w-0 hover:underline"
                    >
                      <p className="truncate">{f.subject}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {customer?.companyName ?? "—"}
                        {" · "}
                        <span className={overdue ? "text-status-alert" : ""}>
                          due {new Date(f.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                        </span>
                      </p>
                    </Link>
                  </li>
                );
              })}
              {upcomingFollowups.length > 6 && (
                <li className="px-3 py-2 text-xs text-muted-foreground text-center">
                  +{upcomingFollowups.length - 6} more
                </li>
              )}
            </ul>
          </section>
        )}

        {/* Filling cooking list — next 7 days */}
        {fillingsToCook.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-primary flex items-center gap-1.5">
                <Flame className="w-4 h-4" /> Fillings to cook — next 7 days
              </h2>
              <Link href="/plan/fillings" className="text-xs text-primary hover:underline">Full list →</Link>
            </div>
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {fillingsToCook.slice(0, 5).map((need) => {
                const daysToCook = Math.round((need.cookByDate.getTime() - Date.now()) / 86_400_000);
                const cls = daysToCook <= 0 ? "text-status-alert" : daysToCook <= 2 ? "text-status-warn" : "text-muted-foreground";
                return (
                  <li key={need.fillingId} className="flex items-center px-3 py-2 text-sm gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="truncate">
                        <span className="font-medium">{need.fillingName}</span>
                        {need.shared && (
                          <span className="ml-1.5 text-[10px] text-primary">· shared</span>
                        )}
                      </p>
                      <p className={`text-[11px] ${cls}`}>
                        cook by {need.cookByDate.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                      </p>
                    </div>
                    <span className="text-xs font-medium tabular-nums shrink-0">
                      {need.toCookBufferedG >= 1000 ? `${(need.toCookBufferedG / 1000).toFixed(1)} kg` : `${need.toCookBufferedG} g`}
                    </span>
                  </li>
                );
              })}
              {fillingsToCook.length > 5 && (
                <li className="px-3 py-2 text-xs text-muted-foreground text-center">
                  +{fillingsToCook.length - 5} more
                </li>
              )}
            </ul>
          </section>
        )}

        {/* Stock below minimum */}
        {lowStock.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-primary flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> Stock below minimum
              </h2>
              <Link href="/stock" className="text-xs text-primary hover:underline">Stock page →</Link>
            </div>
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {lowStock.slice(0, 6).map((row) => (
                <li key={`${row.productId}:${row.location}`} className="flex items-center px-3 py-2 text-sm">
                  <span className="flex-1 truncate">{row.productName}</span>
                  <span className="text-xs text-muted-foreground mr-3">{STOCK_LOCATION_SHORT_LABELS[row.location]}</span>
                  <span className="text-xs font-medium text-status-warn tabular-nums">{row.quantity} / {row.minimum} pcs</span>
                </li>
              ))}
              {lowStock.length > 6 && (
                <li className="px-3 py-2 text-xs text-muted-foreground text-center">
                  +{lowStock.length - 6} more
                </li>
              )}
            </ul>
          </section>
        )}

        {/* Expiry warnings */}
        {expiryWarn.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-primary flex items-center gap-1.5">
                <Clock className="w-4 h-4" /> Approaching sell-by
              </h2>
              <Link href="/stock" className="text-xs text-primary hover:underline">Stock page →</Link>
            </div>
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {expiryWarn.slice(0, 6).map((row) => {
                const expired = row.remainingDays <= 0;
                return (
                  <li key={row.planProductId} className="flex items-center px-3 py-2 text-sm">
                    <div className="flex-1 min-w-0">
                      <p className="truncate">{row.productName}</p>
                      {row.batchNumber && (
                        <p className="font-mono text-[10px] text-muted-foreground">{row.batchNumber}</p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground mr-3 tabular-nums">{row.pieces} pcs</span>
                    <span className={`text-xs font-medium tabular-nums ${expired ? "text-status-alert" : "text-status-warn"}`}>
                      {expired ? "expired" : `${row.remainingDays}d left`}
                    </span>
                  </li>
                );
              })}
              {expiryWarn.length > 6 && (
                <li className="px-3 py-2 text-xs text-muted-foreground text-center">
                  +{expiryWarn.length - 6} more
                </li>
              )}
            </ul>
          </section>
        )}

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

      {/* HACCP temperature log popup */}
      {tempModalOpen && todayDay && (
        <TemperatureLogModal
          devices={tempCheckDevices}
          previousReadings={previousReadings}
          onSave={async (entries) => {
            await saveTemperatureReadings(entries, todayDay.id!);
            setTempModalOpen(false);
          }}
          onSnooze={async () => {
            // Snooze for today: close the popup. The dashboard banner keeps
            // reminding via the persistent "Log temperatures" button, and the
            // top-banner alert fires on the next page load. Reason is kept in
            // a local-only memo for now (no schema hook yet).
            setTempModalOpen(false);
          }}
        />
      )}
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

// ─── Today's production ─────────────────────────────────────────

/** Map a scheduler phase label (ProductionStep.name — user-defined
 *  per category) to the planStepStatus key prefix used in the batch
 *  checklist. The batch checklist is generated by production.ts
 *  generateSteps() and uses fixed group prefixes — the scheduler
 *  works off arbitrary step names, so we match on keywords. When a
 *  phase doesn't map cleanly (e.g. a custom "Cooling" step), status
 *  falls back to "not started" and the user opens the batch to see
 *  detail — still better than a misleading green tick. */
function phaseToCheckListPrefix(phase: string): string | null {
  const p = phase.toLowerCase();
  if (p.includes("colour") || p.includes("color") || p.includes("paint")) return "color";
  if (p.includes("shell") || p.includes("temper")) return "shell";
  if (p.includes("filling") && !/\bfill\b/.test(p)) return "filling";
  if (p.includes("fill")) return "fill";
  if (p.includes("cap")) return "cap";
  if (p.includes("unmould") || p.includes("unmold") || p.includes("polish")) return "unmould";
  if (p.includes("pack")) return "packing";
  return null;
}

type PhaseStatus = "not_started" | "in_progress" | "done";

function phaseStatusForPlan(
  phase: string,
  planId: string,
  planProductIdsByPlan: Map<string, string[]>,
  doneKeysByPlan: Map<string, Set<string>>,
): PhaseStatus {
  const prefix = phaseToCheckListPrefix(phase);
  const ppids = planProductIdsByPlan.get(planId) ?? [];
  const doneSet = doneKeysByPlan.get(planId) ?? new Set<string>();
  if (!prefix || ppids.length === 0) return "not_started";
  // Count planProducts that have at least one done key under this phase's
  // prefix. "Done" across the wave means every planProduct has marked
  // something under this phase — partial = in progress.
  let touched = 0;
  for (const id of ppids) {
    const matched = [...doneSet].some(
      (k) => k === `${prefix}-${id}` || k.startsWith(`${prefix}-${id}-`),
    );
    if (matched) touched++;
  }
  if (touched === 0) return "not_started";
  if (touched >= ppids.length) return "done";
  return "in_progress";
}

const PHASE_STATUS_LABEL: Record<PhaseStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  done: "Done",
};

const PHASE_STATUS_STYLE: Record<PhaseStatus, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-primary/10 text-primary",
  done: "bg-status-ok/15 text-status-ok",
};

function TodaysProductionSection({
  schedule, productMap, orders,
}: {
  schedule: ProductionScheduleEntry[];
  productMap: Map<string, import("@/types").Product>;
  orders: ReturnType<typeof useOrders>;
}) {
  const plans = useProductionPlans();
  const allPlanProducts = useAllPlanProducts();
  const allStepStatuses = useAllPlanStepStatuses();

  // "Today" is the local-time day, not the UTC day. Reading
  // startAt.slice(0,10) on an ISO string gives UTC; we'd silently miss
  // entries whose local day differs from UTC (e.g., late-evening CEST).
  const todays = useMemo(() => {
    const todayLocal = localIsoDate(new Date());
    return schedule
      .filter((s) => localIsoDate(new Date(s.startAt)) === todayLocal)
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
  }, [schedule]);

  const orderById = useMemo(() => new Map(orders.map((o) => [o.id!, o])), [orders]);

  // Every scheduled row now carries planId directly (from the batch-
  // based scheduler). Older rows — written before the rewrite — only
  // carry orderId, so we keep a secondary orderId→plan lookup as a
  // fallback for legacy entries still sitting in the table.
  const planById = useMemo(
    () => new Map(plans.map((p) => [p.id!, p])),
    [plans],
  );
  const planByOrderId = useMemo(() => {
    const m = new Map<string, ProductionPlan>();
    for (const p of plans) if (p.sourceOrderId) m.set(p.sourceOrderId, p);
    return m;
  }, [plans]);
  function planForEntry(e: ProductionScheduleEntry): ProductionPlan | undefined {
    if (e.planId) return planById.get(e.planId);
    if (e.orderId) return planByOrderId.get(e.orderId);
    return undefined;
  }

  const planProductIdsByPlan = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const pp of allPlanProducts) {
      const arr = m.get(pp.planId) ?? [];
      arr.push(pp.id!);
      m.set(pp.planId, arr);
    }
    return m;
  }, [allPlanProducts]);

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

  // One row per (batch, phase) scheduled today — the scheduler emits
  // one entry per product per slot, but the checklist lives at the
  // batch/phase level. Collapse on that granularity.
  const rows = useMemo(() => {
    const m = new Map<string, { plan: ProductionPlan; head: ProductionScheduleEntry; items: ProductionScheduleEntry[] }>();
    for (const e of todays) {
      const plan = planForEntry(e);
      if (!plan) continue;
      const key = `${plan.id}|${e.phase}`;
      const entry = m.get(key);
      if (entry) entry.items.push(e);
      else m.set(key, { plan, head: e, items: [e] });
    }
    return [...m.values()].sort(
      (a, b) => a.head.startAt.localeCompare(b.head.startAt),
    );
  // planForEntry closes over planById/planByOrderId via `planById` which
  // is memoed; including both sources keeps the memo reactive.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todays, planById, planByOrderId]);

  if (rows.length === 0) return null;

  const doneCount = rows.filter(({ plan, head }) =>
    phaseStatusForPlan(head.phase, plan.id!, planProductIdsByPlan, doneKeysByPlan) === "done",
  ).length;

  return (
    <section className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-primary flex items-center gap-1.5">
          <Clock className="w-4 h-4" /> Today&apos;s production
        </h2>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {doneCount}/{rows.length} done
        </span>
      </div>
      <ul className="divide-y divide-border">
        {rows.map(({ plan, head, items }) => {
          const order = head.orderId ? orderById.get(head.orderId) : undefined;
          const status = phaseStatusForPlan(
            head.phase, plan.id!, planProductIdsByPlan, doneKeysByPlan,
          );
          const band = TIME_BAND_LABEL[timeBandFor(head.startAt)];
          const minutes = items.reduce((s, e) => s + e.durationMinutes, 0);
          const productNames = Array.from(new Set(
            items.map((e) => productMap.get(e.productId)?.name ?? e.productId),
          ));
          const productLabel = productNames.length === 1
            ? productNames[0]
            : `${productNames.length} products`;
          const batchLabel = plan.name || order?.customerName || order?.eventName || "Batch";
          return (
            <li key={`${plan.id}|${head.phase}`} className="flex items-center gap-3 px-1 py-1.5 text-sm">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted rounded px-1.5 py-0.5 shrink-0">
                {band}
              </span>
              <div className="flex-1 min-w-0">
                <Link
                  href={`/production/${encodeURIComponent(plan.id!)}`}
                  className="block truncate hover:underline"
                >
                  <span className="font-medium">{head.phase}</span>
                  <span className="text-muted-foreground"> — {batchLabel}</span>
                </Link>
                <p className="text-[11px] text-muted-foreground truncate">
                  {productLabel} · {minutes}m
                  {productNames.length > 1 && ` · ${productNames.join(", ")}`}
                </p>
              </div>
              <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full shrink-0 ${PHASE_STATUS_STYLE[status]}`}>
                {PHASE_STATUS_LABEL[status]}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="pt-1 text-right">
        <Link href="/production" className="text-[11px] text-primary hover:underline">
          Full schedule →
        </Link>
      </div>
    </section>
  );
}

function localIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
