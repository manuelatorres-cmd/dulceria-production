"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  useOrders, useAllOrderItems, useProductsList,
  useAllProductionDayLineItems, useProductionDays,
  useProductionSteps, useCapacityConfig, usePeople, usePersonUnavailability,
  useBlockedDays, useProductCategories, useMouldsList, useIngredients,
  useEquipment,
  useProductLocationTotals, useStockLocationMinimums, useAllPlanProducts,
  useProductionPlans, useAllPlanStepStatuses, DEFAULT_LOCATION_MINIMUM,
  useFillings, useFillingCategories, useFillingStockItems,
  useCustomerFollowups, useCustomers,
  useTodayProductionDay, openProductionDay, closeProductionDay,
  saveTemperatureReadings, yesterdayTemperatureReadings,
  useAllIngredientStock,
  regenerateAllPlansAndSchedule,
  useCampaigns,
  useProductionOrders,
  useAllProductionOrderItems,
  type CloseProductionSummary,
} from "@/lib/hooks";
import { TemperatureLogModal } from "@/components/temperature-log-modal";
import { effectiveDailyCapacityMinutes } from "@/lib/capacity";
import { capacityConfigStatus } from "@/lib/capacity";
import { equipmentReadiness } from "@/lib/equipment";
import { phaseKeyFromStepName } from "@/lib/production";
import { computeShoppingNeeds } from "@/lib/shopping-needs";
import { computeWeeklyFillingNeeds } from "@/lib/weeklyFilling";
import {
  ORDER_CHANNEL_LABELS, ORDER_PRIORITY_LABELS,
  type ProductFilling, type FillingIngredient, type StockLocation,
  type ProductionPlan, type PlanStepStatus, type ProductionDayLineItem, type ProductionDay,
} from "@/types";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import { Play, Square } from "lucide-react";

/* ─── Style constants — iOS-glass direction (v5 palette, 2026-04-24).
   18 px outer card, 12 px inner panel, translucent white over the
   body gradient. Shadows are soft and diffuse for the Apple-vibe
   Manuela flagged on multiple references. */
const CARD = "bg-white/65 backdrop-blur-2xl border border-white/60 rounded-[18px] p-4 shadow-[0_1px_2px_rgba(16,18,24,0.04),0_8px_24px_rgba(16,18,24,0.05)]";
const CARD_TITLE = "text-[10px] tracking-[0.08em] uppercase text-muted-foreground font-semibold mb-3 flex items-center justify-between";
const INNER = "rounded-[12px] border border-border bg-muted/40";

type AlertTone = "blush" | "butter" | "sky" | "lilac" | "sage" | "mint" | "neutral";
const ALERT_TONE: Record<AlertTone, string> = {
  blush:   "bg-[var(--accent-blush-bg)] border-[var(--accent-blush-bg)] text-[var(--accent-blush-ink)]",
  butter:  "bg-[var(--accent-butter-bg)] border-[var(--accent-butter-bg)] text-[var(--accent-butter-ink)]",
  sky:     "bg-[var(--accent-sky-bg)] border-[var(--accent-sky-bg)] text-[var(--accent-sky-ink)]",
  lilac:   "bg-[var(--accent-lilac-bg)] border-[var(--accent-lilac-bg)] text-[var(--accent-lilac-ink)]",
  sage:    "bg-[var(--accent-sage-bg)] border-[var(--accent-sage-bg)] text-[var(--accent-sage-ink)]",
  mint:    "bg-[var(--accent-mint-bg)] border-[var(--accent-mint-bg)] text-[var(--accent-mint-ink)]",
  neutral: "bg-muted border-border text-foreground",
};

export default function DashboardPage() {
  // ─── data hooks ────────────────────────────────────────────────────
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
  const lineItems = useAllProductionDayLineItems();
  const productionDaysAll = useProductionDays(120);
  const allPlans = useProductionPlans();
  const allPlanProducts = useAllPlanProducts();

  const productMap = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const mouldMap = useMemo(() => new Map(moulds.map((m) => [m.id!, m])), [moulds]);
  const categoryNameById = useMemo(() => new Map(categories.map((c) => [c.id!, c.name])), [categories]);
  void mouldMap;

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

  const configStatus = capacityConfigStatus(config, people);
  const equipReady = equipmentReadiness(equipment);
  const hasSteps = steps.length > 0;

  const todayIso = toIsoDate(new Date());

  // ─── KPI + signal derivations ──────────────────────────────────────
  const openOrders = useMemo(
    () => orders.filter((o) => o.status === "pending" || o.status === "in_production"),
    [orders],
  );
  const rushCount = useMemo(() => openOrders.filter((o) => o.priority === "urgent").length, [openOrders]);

  const overdue = useMemo(
    () => openOrders.filter((o) => new Date(o.deadline) < new Date(todayIso + "T00:00:00")),
    [openOrders, todayIso],
  );

  const in14 = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 14);
    const cutoffIso = cutoff.toISOString();
    return [...openOrders]
      .filter((o) => o.deadline <= cutoffIso)
      .sort((a, b) => a.deadline.localeCompare(b.deadline));
  }, [openOrders]);

  const todayDay = useTodayProductionDay();
  const tempCheckDevices = useMemo(() => equipment.filter((e) => e.requiresTempCheck && !e.archived), [equipment]);

  const todaysLineItems = useMemo(() => {
    if (!todayDay?.id) return [] as ProductionDayLineItem[];
    return lineItems
      .filter((li) => li.productionDayId === todayDay.id)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [lineItems, todayDay?.id]);

  const planById = useMemo(() => new Map(allPlans.map((p) => [p.id!, p])), [allPlans]);

  const todaysPlans = useMemo(() => {
    const seen = new Set<string>();
    const out: ProductionPlan[] = [];
    for (const li of todaysLineItems) {
      if (seen.has(li.planId)) continue;
      seen.add(li.planId);
      const p = planById.get(li.planId);
      if (p) out.push(p);
    }
    return out;
  }, [todaysLineItems, planById]);

  // 7-day capacity preview
  const capacityPreview = useMemo(() => {
    const dayDateById = new Map(productionDaysAll.map((d) => [d.id!, d.date]));
    const usedByDate = new Map<string, number>();
    for (const li of lineItems) {
      const date = dayDateById.get(li.productionDayId);
      if (!date) continue;
      usedByDate.set(date, (usedByDate.get(date) ?? 0) + li.plannedMinutes);
    }
    // Always show next 7 calendar days starting today, even if no work scheduled.
    const days: { date: string }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      days.push({ date: toIsoDate(d) });
    }
    const warn = config?.warnThresholdPercent ?? 100;
    const critical = config?.criticalThresholdPercent ?? 100;
    return days.map(({ date }) => {
      const d = new Date(date + "T12:00:00");
      const avail = effectiveDailyCapacityMinutes(d, config, people, unavailability, blockedDays);
      const used = usedByDate.get(date) ?? 0;
      const util = avail > 0 ? (used / avail) * 100 : 0;
      let level: "ok" | "warn" | "critical" | "over" | "closed";
      if (avail === 0) level = "closed";
      else if (used > avail) level = "over";
      else if (util >= critical) level = "critical";
      else if (util >= warn) level = "warn";
      else level = "ok";
      // Plans scheduled that date.
      const planIdsThatDay = new Set<string>();
      for (const li of lineItems) {
        if (dayDateById.get(li.productionDayId) === date) planIdsThatDay.add(li.planId);
      }
      return { date, usedMinutes: used, availableMinutes: avail, utilisationPercent: Math.round(util), level, batchCount: planIdsThatDay.size };
    });
  }, [lineItems, productionDaysAll, config, people, unavailability, blockedDays]);

  const weekAvgUtil = useMemo(() => {
    const used = capacityPreview.reduce((s, d) => s + d.usedMinutes, 0);
    const avail = capacityPreview.reduce((s, d) => s + d.availableMinutes, 0);
    return avail > 0 ? Math.round((used / avail) * 100) : 0;
  }, [capacityPreview]);
  const peakUtil = useMemo(() => Math.max(0, ...capacityPreview.filter((d) => d.level !== "closed").map((d) => d.utilisationPercent)), [capacityPreview]);

  // Ingredient stock (used by both shopping shortages + low-stock list).
  const ingredientStock = useAllIngredientStock();
  const campaignsForShopping = useCampaigns();
  const productionOrdersForShopping = useProductionOrders();
  const productionOrderItemsForShopping = useAllProductionOrderItems();

  // Shopping shortages
  const shopping = useMemo(
    () => computeShoppingNeeds({
      orders, orderItems, products, moulds,
      productFillings, fillingIngredientsByFillingId: fiByFilling, ingredients, config,
      ingredientStock,
      campaigns: campaignsForShopping,
      productionOrders: productionOrdersForShopping,
      productionOrderItems: productionOrderItemsForShopping,
    }),
    [orders, orderItems, products, moulds, productFillings, fiByFilling, ingredients, config, ingredientStock, campaignsForShopping, productionOrdersForShopping, productionOrderItemsForShopping],
  );
  const shortages = shopping.rows.filter((r) => r.shortageG > 0);

  const ingredientMap = useMemo(() => new Map(ingredients.map((i) => [i.id!, i])), [ingredients]);
  const lowIngredients = useMemo(() => {
    return ingredientStock
      .filter((s) => s.lowStockThresholdG != null && Number(s.quantityG) < Number(s.lowStockThresholdG))
      .map((s) => ({
        ingredientId: s.ingredientId,
        name: ingredientMap.get(s.ingredientId)?.name ?? s.ingredientId,
        quantityG: Number(s.quantityG),
        thresholdG: Number(s.lowStockThresholdG ?? 0),
      }))
      .sort((a, b) => (a.quantityG / a.thresholdG) - (b.quantityG / b.thresholdG));
  }, [ingredientStock, ingredientMap]);

  // Stock below minimum
  const locationTotals = useProductLocationTotals();
  const locationMinimums = useStockLocationMinimums();
  const lowStock = useMemo(() => {
    const minByKey = new Map<string, number>();
    for (const m of locationMinimums) minByKey.set(`${m.productId}:${m.location}`, m.minimumUnits);
    const relevant: StockLocation[] = ["store", "production"];
    const rows: Array<{ productId: string; productName: string; location: StockLocation; quantity: number; minimum: number }> = [];
    for (const [productId, totals] of locationTotals) {
      const product = productMap.get(productId);
      if (!product) continue;
      for (const loc of relevant) {
        const minimum = minByKey.get(`${productId}:${loc}`) ?? DEFAULT_LOCATION_MINIMUM;
        const qty = totals[loc] ?? 0;
        if (qty < minimum) rows.push({ productId, productName: product.name, location: loc, quantity: qty, minimum });
      }
    }
    return rows;
  }, [locationTotals, locationMinimums, productMap]);

  // Customer follow-ups
  const followups = useCustomerFollowups();
  const customersAll = useCustomers(true);
  void customersAll;
  const overdueFollowups = useMemo(
    () => followups.filter((f) => !f.completedAt && f.dueDate < todayIso),
    [followups, todayIso],
  );

  // Filling cooking list
  const fillingsList = useFillings(true);
  const fillingCategoriesList = useFillingCategories(true);
  const fillingStockItems = useFillingStockItems();
  const weeklyFilling = useMemo(() => {
    const windowEnd = new Date();
    windowEnd.setDate(windowEnd.getDate() + 7);
    return computeWeeklyFillingNeeds({
      orders, orderItems, products, productFillings, fillingIngredients,
      fillings: fillingsList, fillingCategories: fillingCategoriesList,
      moulds, fillingStock: fillingStockItems,
      fillingBufferPercent: config?.fillingBufferPercent, windowEnd,
    });
  }, [orders, orderItems, products, productFillings, fillingIngredients, fillingsList, fillingCategoriesList, moulds, fillingStockItems, config?.fillingBufferPercent]);
  const fillingsToCook = weeklyFilling.needs.filter((n) => n.toCookBufferedG > 0);

  // Expiry — batches close to sell-by
  const expiryWarn = useMemo(() => {
    const days = config?.stockExpiryWarnDays;
    if (days == null || days < 0) return [] as Array<{ id: string; productName: string; remainingDays: number }>;
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const WEEK = 7 * DAY;
    const rows: Array<{ id: string; productName: string; remainingDays: number }> = [];
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
      if (remainingDays <= days) rows.push({ id: pb.id!, productName: product.name, remainingDays });
    }
    return rows.sort((a, b) => a.remainingDays - b.remainingDays);
  }, [allPlanProducts, productMap, planById, config?.stockExpiryWarnDays]);

  // ─── alerts triage list (right column) ─────────────────────────────
  type Triage = { tone: AlertTone; title: string; detail: string; href: string; cta?: string };
  const triage: Triage[] = [];
  if (overdue.length > 0) triage.push({
    tone: "blush", title: `${overdue.length} order${overdue.length > 1 ? "s" : ""} past deadline`,
    detail: "Re-schedule or contact customer.", href: "/orders", cta: "Open orders",
  });
  const tightDays = capacityPreview.filter((d) => d.level === "warn" || d.level === "critical" || d.level === "over");
  if (tightDays.length > 0) triage.push({
    tone: tightDays.some((d) => d.level !== "warn") ? "blush" : "butter",
    title: `${tightDays.length} day${tightDays.length > 1 ? "s" : ""} over capacity in next week`,
    detail: `Peak ${peakUtil}%. Consider re-merging or moving steps.`, href: "/plan", cta: "Open plan",
  });
  if (shortages.length > 0) triage.push({
    tone: "butter", title: `${shortages.length} ingredient${shortages.length > 1 ? "s" : ""} short`,
    detail: "Open orders are short upstream. Place a supplier order.", href: "/shopping", cta: "Shopping list",
  });
  if (lowIngredients.length > 0) triage.push({
    tone: "butter", title: `${lowIngredients.length} ingredient${lowIngredients.length > 1 ? "s" : ""} below threshold`,
    detail: lowIngredients.slice(0, 3).map((l) => l.name).join(" · "), href: "/shopping", cta: "Restock",
  });
  if (lowStock.length > 0) triage.push({
    tone: "butter", title: `${lowStock.length} product/location below minimum`,
    detail: "Production Store thinning out — consider a replen batch.", href: "/stock", cta: "Stock page",
  });
  if (expiryWarn.length > 0) triage.push({
    tone: expiryWarn.some((r) => r.remainingDays <= 0) ? "blush" : "butter",
    title: `${expiryWarn.length} batch${expiryWarn.length > 1 ? "es" : ""} approaching sell-by`,
    detail: expiryWarn.slice(0, 2).map((e) => `${e.productName} · ${e.remainingDays <= 0 ? "expired" : `${e.remainingDays}d`}`).join(" · "),
    href: "/stock", cta: "Stock page",
  });
  if (overdueFollowups.length > 0) triage.push({
    tone: "lilac", title: `${overdueFollowups.length} overdue follow-up${overdueFollowups.length > 1 ? "s" : ""}`,
    detail: "Customers waiting on a reply.", href: "/customers", cta: "Customers",
  });
  if (fillingsToCook.length > 0) triage.push({
    tone: "sky", title: `${fillingsToCook.length} filling${fillingsToCook.length > 1 ? "s" : ""} to cook this week`,
    detail: fillingsToCook.slice(0, 2).map((f) => f.fillingName).join(" · "), href: "/plan/fillings", cta: "Cook plan",
  });
  if (!configStatus.isComplete) triage.push({
    tone: "neutral", title: "Capacity config incomplete",
    detail: `${configStatus.missing.length} field${configStatus.missing.length > 1 ? "s" : ""} missing.`, href: "/settings", cta: "Settings",
  });
  if (!equipReady.isComplete && equipReady.incompleteCount > 0) triage.push({
    tone: "neutral", title: `${equipReady.incompleteCount} equipment item${equipReady.incompleteCount > 1 ? "s" : ""} incomplete`,
    detail: "Quantity or throughput missing.", href: "/settings", cta: "Settings",
  });
  if (!hasSteps) triage.push({
    tone: "neutral", title: "No production steps defined",
    detail: "Set them up before scheduling.", href: "/settings", cta: "Settings",
  });
  if (todayDay && !todayDay.closedAt && tempCheckDevices.length > 0 && !todayDay.tempLogComplete) triage.push({
    tone: "butter", title: "Daily temperature log not completed",
    detail: `${tempCheckDevices.length} device${tempCheckDevices.length === 1 ? "" : "s"} need a check.`, href: "/dashboard", cta: "Log now",
  });

  // ─── HACCP / production day controls ───────────────────────────────
  const [tempModalOpen, setTempModalOpen] = useState(false);
  const [previousReadings, setPreviousReadings] = useState<Map<string, number>>(new Map());
  const [closeSummary, setCloseSummary] = useState<CloseProductionSummary | null>(null);
  const [busyDayAction, setBusyDayAction] = useState<"opening" | "closing" | null>(null);

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
      // When work carries forward, today's plan no longer reflects reality.
      // Re-run the scheduler in the background so tomorrow's day-view is
      // fresh without requiring a manual Regenerate click.
      if (summary.stepsCarriedForward > 0 && configStatus.isComplete && steps.length > 0) {
        regenerateAllPlansAndSchedule({
          config, people, unavailability, blockedDays,
          productionSteps: steps, categoryNameById,
        }).catch((e) => console.warn("post-close auto-regen failed", e));
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to close production");
    } finally {
      setBusyDayAction(null);
    }
  }

  // ─── Auto-regen once per local day when the plan looks stale ──────
  // Triggers if there's an overdue order OR open orders but no plan
  // today. Writes the trigger date to localStorage so repeat dashboard
  // visits in the same day don't thrash the scheduler.
  const autoRegenTriedRef = useRef(false);
  const AUTO_REGEN_KEY = "dulceria.dashboard.lastAutoRegen";
  useEffect(() => {
    if (autoRegenTriedRef.current) return;
    if (typeof window === "undefined") return;
    if (!configStatus.isComplete || steps.length === 0) return;
    const last = window.localStorage.getItem(AUTO_REGEN_KEY);
    if (last === todayIso) return;
    const needsIt = overdue.length > 0 || (openOrders.length > 0 && todaysPlans.length === 0);
    if (!needsIt) { window.localStorage.setItem(AUTO_REGEN_KEY, todayIso); return; }
    autoRegenTriedRef.current = true;
    (async () => {
      try {
        await regenerateAllPlansAndSchedule({
          config, people, unavailability, blockedDays,
          productionSteps: steps, categoryNameById,
        });
        window.localStorage.setItem(AUTO_REGEN_KEY, todayIso);
      } catch (e) {
        console.warn("daily auto-regen failed", e);
      }
    })();
  }, [
    todayIso, configStatus.isComplete, steps.length,
    overdue.length, todaysPlans.length, openOrders.length,
    config, people, unavailability, blockedDays, steps, categoryNameById,
  ]);

  // ─── derived header pills ──────────────────────────────────────────
  const inProgressBatches = todaysPlans.filter((p) => p.status === "active").length;
  const dateLabel = new Date().toLocaleDateString("de-AT", { weekday: "short", day: "numeric", month: "short" });

  return (
    <div className="px-3 sm:px-5 pt-5 pb-10 max-w-[1700px] mx-auto">
      {/* ─── Top bar — date + at-a-glance pills ───────────────────── */}
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <h1
          className="text-[26px] tracking-[-0.025em]"
          style={{ fontFamily: "var(--font-serif)", fontWeight: 400 }}
        >
          Welcome back
        </h1>
        <span className="text-[12px] text-muted-foreground">{dateLabel}</span>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {inProgressBatches > 0 && (
            <Pill tone="mint">{inProgressBatches} batch{inProgressBatches === 1 ? "" : "es"} in progress</Pill>
          )}
          {triage.filter((t) => t.tone === "blush").length > 0 && (
            <Pill tone="blush">{triage.filter((t) => t.tone === "blush").length} urgent</Pill>
          )}
          {triage.filter((t) => t.tone === "butter").length > 0 && (
            <Pill tone="butter">{triage.filter((t) => t.tone === "butter").length} attention</Pill>
          )}
          {todayDay && !todayDay.closedAt && (
            <button
              onClick={handleCloseProduction}
              disabled={busyDayAction === "closing"}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/30 disabled:opacity-50"
            >
              <Square className="w-3 h-3" /> Close production day
            </button>
          )}
          {!todayDay && tempCheckDevices.length > 0 && (
            <button
              onClick={handleOpenProduction}
              disabled={busyDayAction === "opening"}
              className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-3 py-1 text-[11px] font-medium disabled:opacity-50"
            >
              <Play className="w-3 h-3" /> Open production
            </button>
          )}
        </div>
      </div>

      {/* ─── KPI strip ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Kpi
          tint="sky"
          label="Open orders"
          value={openOrders.length}
          delta={`${rushCount} rush · ${overdue.length} overdue`}
        />
        <Kpi
          tint="mint"
          label="Batches today"
          value={todaysPlans.length}
          valueSmall={inProgressBatches > 0 ? `${inProgressBatches} live` : undefined}
          delta={todaysLineItems.length > 0 ? `${todaysLineItems.length} step block${todaysLineItems.length === 1 ? "" : "s"}` : "nothing scheduled"}
        />
        <Kpi
          tint="butter"
          label="Capacity next 7d"
          value={`${weekAvgUtil}`}
          valueSmall="%"
          delta={peakUtil > 0 ? `peak ${peakUtil}%` : "—"}
        />
        <Kpi
          tint={triage.filter((t) => t.tone === "blush").length > 0 ? "blush" : triage.length > 0 ? "peach" : "sage"}
          label="Attention"
          value={triage.length}
          delta={triage.length === 0 ? "all clear" : `${triage.filter((t) => t.tone === "blush").length} urgent`}
        />
      </div>

      {/* ─── close-production summary toast ───────────────────────── */}
      {closeSummary && (
        <div className={`${CARD} mb-4`} style={{ borderColor: "var(--accent-mint-bg)", background: "var(--accent-mint-bg)" }}>
          <div className="flex items-start justify-between gap-3">
            <div className="text-[12px]" style={{ color: "var(--accent-mint-ink)" }}>
              <p className="font-semibold mb-0.5">Production closed</p>
              <p>
                {closeSummary.stepsCompleted} step{closeSummary.stepsCompleted === 1 ? "" : "s"} completed
                {closeSummary.piecesProduced > 0 && ` · ${closeSummary.piecesProduced} pieces`}
                {closeSummary.batchesRun > 0 && ` · ${closeSummary.batchesRun} batch${closeSummary.batchesRun === 1 ? "" : "es"}`}
              </p>
              {closeSummary.stepsCarriedForward > 0 && (
                <p className="mt-0.5">{closeSummary.stepsCarriedForward} step{closeSummary.stepsCarriedForward === 1 ? "" : "s"} carried forward.</p>
              )}
            </div>
            <button onClick={() => setCloseSummary(null)} className="text-xs text-muted-foreground hover:text-foreground">Dismiss</button>
          </div>
        </div>
      )}

      {/* ─── main 2-col layout ────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-3 mb-4">
        {/* LEFT — today's pipeline */}
        <section className={CARD}>
          <h3 className={CARD_TITLE}>
            <span>Today’s pipeline</span>
            <span className="text-[10px] tracking-normal normal-case text-muted-foreground font-normal">
              {todaysPlans.length === 0 ? "nothing scheduled" : `${todaysPlans.length} batch${todaysPlans.length === 1 ? "" : "es"}`}
              {" · "}
              <Link href="/production" className="underline-offset-2 hover:underline">full schedule →</Link>
            </span>
          </h3>
          {todaysPlans.length === 0 ? (
            <div className={`${INNER} px-4 py-8 text-center text-sm text-muted-foreground`}>
              No batches scheduled for today.{" "}
              <Link href="/plan" className="underline-offset-2 hover:underline text-foreground">Open plan</Link> to add some.
            </div>
          ) : (
            <StepGroupedPipeline
              todaysLineItems={todaysLineItems}
              planById={planById}
              productMap={productMap}
              steps={steps}
              orders={orders}
              allPlanProducts={allPlanProducts}
            />
          )}
        </section>

        {/* RIGHT — alerts & attention */}
        <section className={CARD}>
          <h3 className={CARD_TITLE}>
            <span>Attention</span>
            <span className="text-[10px] tracking-normal normal-case text-muted-foreground font-normal">
              {triage.length === 0 ? "all clear" : `${triage.length} item${triage.length === 1 ? "" : "s"}`}
            </span>
          </h3>
          {triage.length === 0 ? (
            <div className={`${INNER} px-4 py-8 text-center text-sm`} style={{ color: "var(--accent-mint-ink)" }}>
              ✓ Workshop is on track.
            </div>
          ) : (
            <ul className="space-y-2">
              {triage.map((t, i) => (
                <li key={i} className={`rounded-[10px] border p-3 ${ALERT_TONE[t.tone]}`}>
                  <p className="text-[12px] font-semibold leading-tight">{t.title}</p>
                  <p className="text-[11px] mt-0.5 opacity-80 leading-snug">{t.detail}</p>
                  {t.cta && (
                    <Link
                      href={t.href}
                      className="mt-2 inline-block rounded-md bg-card border border-border text-foreground text-[10px] px-2 py-0.5 hover:border-foreground/30"
                    >
                      {t.cta} →
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ─── upcoming deadlines + 7-day strip ─────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-3">
        {/* 7-day strategic strip */}
        <section className={CARD}>
          <h3 className={CARD_TITLE}>
            <span>This week · next 7 days</span>
            <Link href="/plan" className="text-[10px] tracking-normal normal-case font-normal underline-offset-2 hover:underline">full plan →</Link>
          </h3>
          <div className="grid grid-cols-7 gap-1.5">
            {capacityPreview.map((d) => {
              const dt = new Date(d.date + "T12:00:00");
              const isToday = d.date === todayIso;
              const dayLabel = dt.toLocaleDateString("de-AT", { weekday: "short" });
              const dayNum = dt.getDate();
              const barFill = d.level === "closed" ? 0 : Math.min(100, d.utilisationPercent);
              const barColor =
                d.level === "over" || d.level === "critical" ? "var(--accent-blush-ink)" :
                d.level === "warn" ? "var(--accent-butter-ink)" :
                d.level === "closed" ? "var(--color-border)" :
                "var(--accent-mint-ink)";
              return (
                <div
                  key={d.date}
                  className={`rounded-[10px] border p-2 min-h-[88px] text-[10.5px] ${isToday ? "border-foreground bg-card" : "border-border bg-muted/40"}`}
                >
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="font-semibold text-[11px]">{dayLabel} {dayNum}</span>
                    <span className="text-[9px] text-muted-foreground tabular-nums">
                      {d.level === "closed" ? "closed" : `${d.utilisationPercent}%`}
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-border overflow-hidden">
                    <i className="block h-full" style={{ width: `${barFill}%`, background: barColor }} />
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {d.batchCount === 0 ? "—" : `${d.batchCount} batch${d.batchCount === 1 ? "" : "es"}`}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Upcoming deadlines */}
        <section className={CARD}>
          <h3 className={CARD_TITLE}>
            <span>Upcoming deadlines</span>
            <Link href="/orders" className="text-[10px] tracking-normal normal-case font-normal underline-offset-2 hover:underline">all orders →</Link>
          </h3>
          {in14.length === 0 ? (
            <div className={`${INNER} px-4 py-6 text-center text-sm text-muted-foreground`}>
              Nothing due in the next 14 days.
            </div>
          ) : (
            <ul className="space-y-1">
              {in14.slice(0, 6).map((order) => {
                const days = Math.round((new Date(order.deadline).getTime() - new Date(todayIso + "T00:00:00").getTime()) / 86_400_000);
                const isOverdue = days < 0;
                const tone =
                  isOverdue || days <= 1 ? "text-[var(--accent-blush-ink)]" :
                  days <= 3 ? "text-[var(--accent-butter-ink)]" :
                  "text-muted-foreground";
                const label = isOverdue ? "overdue" : days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days}d`;
                return (
                  <li key={order.id}>
                    <Link
                      href={`/orders/${encodeURIComponent(order.id!)}`}
                      className="flex items-center gap-3 rounded-[8px] px-2 py-1.5 hover:bg-muted/40"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-[12.5px] truncate">
                          <span className="font-medium">{order.customerName || order.eventName || "(unnamed)"}</span>
                          <span className="ml-1.5 text-[10px] text-muted-foreground">
                            {ORDER_CHANNEL_LABELS[order.channel]} · {ORDER_PRIORITY_LABELS[order.priority]}
                          </span>
                        </p>
                      </div>
                      <span className={`text-[11px] font-medium tabular-nums ${tone}`}>{label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* HACCP popup */}
      {tempModalOpen && todayDay && (
        <TemperatureLogModal
          devices={tempCheckDevices}
          previousReadings={previousReadings}
          onSave={async (entries) => {
            await saveTemperatureReadings(entries, todayDay.id!);
            setTempModalOpen(false);
          }}
          onSnooze={async () => setTempModalOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────

function Pill({ tone, children }: { tone: AlertTone; children: React.ReactNode }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium border ${ALERT_TONE[tone]}`}>
      {children}
    </span>
  );
}

function Kpi({ label, value, valueSmall, delta, deltaTone = "neutral", tint = "mint" }: {
  label: string;
  value: string | number;
  valueSmall?: string;
  delta?: string;
  deltaTone?: "up" | "down" | "warn" | "neutral";
  tint?: "mint" | "butter" | "blush" | "peach" | "sky" | "lilac" | "sage";
}) {
  const dt =
    deltaTone === "up" ? "text-[var(--accent-mint-ink)]" :
    deltaTone === "down" ? "text-[var(--accent-blush-ink)]" :
    deltaTone === "warn" ? "text-[var(--accent-butter-ink)]" :
    "text-muted-foreground";
  const tintBg = `var(--accent-${tint}-bg)`;
  const tintInk = `var(--accent-${tint}-ink)`;
  return (
    <div
      className="rounded-[18px] p-4 border shadow-[0_1px_2px_rgba(16,18,24,0.04),0_4px_16px_rgba(16,18,24,0.04)]"
      style={{
        background: tintBg,
        borderColor: tintBg,
      }}
    >
      <p
        className="text-[10px] tracking-[0.07em] uppercase font-semibold mb-1 opacity-80"
        style={{ color: tintInk }}
      >
        {label}
      </p>
      <p
        className="text-[26px] font-semibold tabular-nums leading-none"
        style={{ letterSpacing: "-0.02em", color: tintInk }}
      >
        {value}
        {valueSmall && (
          <span className="text-[13px] ml-1 font-medium opacity-70" style={{ color: tintInk }}>
            {valueSmall}
          </span>
        )}
      </p>
      {delta && <p className={`mt-1.5 text-[10.5px] ${dt}`} style={{ color: tintInk, opacity: 0.75 }}>{delta}</p>}
    </div>
  );
}

/** Step-grouped today's pipeline. One card per workshop step that has
 *  work today. Shows total moulds × done × pending + a list of
 *  contributing batches (expand-toggle). Replaces the per-batch list
 *  on the welcome dashboard so Manuela sees the whole day at one
 *  glance, organised by what she does next. */
function StepGroupedPipeline({
  todaysLineItems, planById, productMap, steps, orders, allPlanProducts,
}: {
  todaysLineItems: ProductionDayLineItem[];
  planById: Map<string, ProductionPlan>;
  productMap: Map<string, import("@/types").Product>;
  steps: import("@/types").ProductionStep[];
  orders: ReturnType<typeof useOrders>;
  allPlanProducts: ReturnType<typeof useAllPlanProducts>;
}) {
  const allStepStatuses = useAllPlanStepStatuses();

  const planProductsByPlan = useMemo(() => {
    const m = new Map<string, typeof allPlanProducts>();
    for (const pp of allPlanProducts) {
      const arr = m.get(pp.planId) ?? [];
      arr.push(pp);
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

  const orderById = new Map(orders.map((o) => [o.id!, o]));
  const orderedSteps = [...steps].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  // Aggregate per step: which batches touch it today, total mould
  // instances, how many already done.
  type Row = {
    planId: string;
    productLabel: string;
    batchLabel: string;
    totalMoulds: number;
    doneMoulds: number;
    tags: string[];
  };
  type StepGroup = {
    stepId: string;
    name: string;
    rows: Row[];
    totalMoulds: number;
    doneMoulds: number;
  };

  const groups: StepGroup[] = [];
  for (const step of orderedSteps) {
    const planIdsForStep = new Set<string>();
    for (const li of todaysLineItems) {
      if (li.stepIds.includes(step.id!)) planIdsForStep.add(li.planId);
    }
    if (planIdsForStep.size === 0) continue;

    const rows: Row[] = [];
    for (const planId of planIdsForStep) {
      const plan = planById.get(planId);
      if (!plan) continue;
      const pps = planProductsByPlan.get(planId) ?? [];
      const productNames = [...new Set(pps.map((pp) => productMap.get(pp.productId)?.name ?? pp.productId))];
      const order = plan.sourceOrderId ? orderById.get(plan.sourceOrderId) : undefined;
      const totalMoulds = pps.reduce((s, pp) => s + pp.quantity, 0);
      // Resolve the step's phase key once per step so the per-pp loop
      // checks against the wizard's actual `polishing-<ppId>` /
      // `colour-<ppId>-N` keys instead of the raw stepId UUID (which
      // never matched and made the dashboard report 0 done forever).
      const phase = phaseKeyFromStepName(step.name);
      const doneSet = doneKeysByPlan.get(planId) ?? new Set<string>();
      let doneMoulds = 0;
      if (phase) {
        for (const pp of pps) {
          const ppId = pp.id ?? "";
          const phaseDone = [...doneSet].some(
            (k) => k === phase
              || k === `${phase}-${ppId}`
              || k.startsWith(`${phase}-${ppId}-`)
              || k.startsWith(`${phase}-`),
          );
          if (phaseDone) doneMoulds += pp.quantity;
        }
      }
      // Pull tags from all referenced products' `tags`. Dedup.
      const tagSet = new Set<string>();
      for (const pp of pps) for (const t of (productMap.get(pp.productId)?.tags ?? [])) tagSet.add(t);
      rows.push({
        planId,
        productLabel: productNames.length === 1 ? productNames[0] : `${productNames.length} products`,
        batchLabel: plan.name || order?.customerName || order?.eventName || "Batch",
        totalMoulds,
        doneMoulds,
        tags: [...tagSet],
      });
    }
    rows.sort((a, b) => a.productLabel.localeCompare(b.productLabel));
    const totalMoulds = rows.reduce((s, r) => s + r.totalMoulds, 0);
    const doneMoulds = rows.reduce((s, r) => s + r.doneMoulds, 0);
    groups.push({ stepId: step.id!, name: step.name, rows, totalMoulds, doneMoulds });
  }

  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground italic px-3 py-4">Nothing scheduled for today.</p>;
  }

  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
      {groups.map((g) => (
        <StepCard key={g.stepId} group={g} />
      ))}
    </ul>
  );
}

function StepCard({ group }: {
  group: {
    stepId: string;
    name: string;
    rows: Array<{ planId: string; productLabel: string; batchLabel: string; totalMoulds: number; doneMoulds: number; tags: string[] }>;
    totalMoulds: number;
    doneMoulds: number;
  };
}) {
  const [open, setOpen] = useState(false);
  const pct = group.totalMoulds > 0 ? Math.round((group.doneMoulds / group.totalMoulds) * 100) : 0;
  const status: "done" | "in_progress" | "not_started" =
    pct === 100 ? "done" : pct > 0 ? "in_progress" : "not_started";
  const tone =
    status === "done" ? "bg-[var(--accent-mint-bg)]" :
    status === "in_progress" ? "bg-[var(--accent-butter-bg)]" :
    "bg-muted/40";
  const ink =
    status === "done" ? "var(--accent-mint-ink)" :
    status === "in_progress" ? "var(--accent-butter-ink)" :
    "var(--color-foreground)";
  const barFill =
    status === "done" ? "var(--accent-mint-ink)" :
    status === "in_progress" ? "var(--accent-butter-ink)" :
    "var(--color-border)";

  // Bubble unique tags up to the card header.
  const tagSet = new Set<string>();
  for (const r of group.rows) for (const t of r.tags) tagSet.add(t);
  const tags = [...tagSet].slice(0, 3);

  return (
    <li className={`rounded-[14px] ${tone} p-3.5 transition-shadow hover:shadow-[0_2px_8px_rgba(16,18,24,0.05)]`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left"
      >
        <div className="flex items-baseline justify-between gap-2 mb-1.5">
          <h4
            className="text-[16px] tracking-[-0.015em]"
            style={{ fontFamily: "var(--font-serif)", fontWeight: 500, color: ink }}
          >
            {group.name}
          </h4>
          <span className="text-[10px] uppercase tracking-[0.06em]" style={{ color: ink, opacity: 0.7 }}>
            {open ? "hide" : "show"}
          </span>
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {tags.map((t) => (
              <span
                key={t}
                className="rounded-full bg-white/50 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.05em]"
                style={{ color: ink }}
              >
                {t}
              </span>
            ))}
          </div>
        )}
        <p className="text-[13px] tabular-nums" style={{ color: ink }}>
          <span className="font-semibold">{group.doneMoulds} / {group.totalMoulds}</span>
          <span className="text-[11px] ml-1 opacity-75">moulds · {pct}%</span>
        </p>
        <div className="h-1 mt-1.5 rounded-full bg-white/40 overflow-hidden">
          <i className="block h-full" style={{ width: `${pct}%`, background: barFill }} />
        </div>
        <p className="text-[10.5px] mt-1.5 opacity-80" style={{ color: ink }}>
          {group.rows.length} batch{group.rows.length === 1 ? "" : "es"}
          {group.rows.length > 0 && (
            <span className="ml-1">· {group.rows.slice(0, 2).map((r) => r.productLabel).join(", ")}{group.rows.length > 2 ? ` +${group.rows.length - 2}` : ""}</span>
          )}
        </p>
      </button>
      {open && (
        <ul className="mt-3 space-y-1.5">
          {group.rows.map((r) => {
            const rowPct = r.totalMoulds > 0 ? Math.round((r.doneMoulds / r.totalMoulds) * 100) : 0;
            return (
              <li key={r.planId}>
                <Link
                  href={`/production/${encodeURIComponent(r.planId)}`}
                  className="flex items-center gap-3 rounded-[10px] bg-white/60 backdrop-blur-sm border border-white/40 px-3 py-2 hover:bg-white/80"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] font-medium truncate" style={{ color: ink }}>
                      {r.productLabel}
                    </p>
                    <p className="text-[10px] truncate opacity-70" style={{ color: ink }}>{r.batchLabel}</p>
                  </div>
                  <span className="text-[11px] tabular-nums shrink-0" style={{ color: ink }}>
                    {r.doneMoulds} / {r.totalMoulds}
                    <span className="opacity-60 ml-1">{rowPct}%</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

// Legacy per-batch list — kept for reference but no longer rendered.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function PipelineList({
  todaysLineItems, planById, productMap, steps, orders, allPlanProducts,
}: {
  todaysLineItems: ProductionDayLineItem[];
  planById: Map<string, ProductionPlan>;
  productMap: Map<string, import("@/types").Product>;
  steps: import("@/types").ProductionStep[];
  orders: ReturnType<typeof useOrders>;
  allPlanProducts: ReturnType<typeof useAllPlanProducts>;
}) {
  const allStepStatuses = useAllPlanStepStatuses();

  const planProductsByPlan = useMemo(() => {
    const m = new Map<string, typeof allPlanProducts>();
    for (const pp of allPlanProducts) {
      const arr = m.get(pp.planId) ?? [];
      arr.push(pp);
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

  // One row per unique plan (batch). Step-bar shows full-pipeline progress.
  const planIds: string[] = [];
  const seen = new Set<string>();
  for (const li of todaysLineItems) {
    if (seen.has(li.planId)) continue;
    seen.add(li.planId);
    planIds.push(li.planId);
  }

  const orderById = new Map(orders.map((o) => [o.id!, o]));
  const orderedSteps = [...steps].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  return (
    <ul className="space-y-2">
      {planIds.map((pid) => {
        const plan = planById.get(pid)!;
        const pps = planProductsByPlan.get(pid) ?? [];
        const productNames = [...new Set(pps.map((pp) => productMap.get(pp.productId)?.name ?? pp.productId))];
        const order = plan.sourceOrderId ? orderById.get(plan.sourceOrderId) : undefined;
        const totalPieces = pps.reduce((s, pp) => s + (pp.actualYield ?? 0), 0);
        const doneSet = doneKeysByPlan.get(pid) ?? new Set<string>();

        // For each global step, derive: done / now / pending.
        // Resolve via phase-key prefix-match — comparing the bare
        // stepId UUID against doneSet (which holds wizard-style keys
        // like "polishing-<ppId>") never matched.
        const stepStates = orderedSteps.map((s) => {
          const phase = phaseKeyFromStepName(s.name);
          const done = phase
            ? [...doneSet].some((k) => k === phase || k.startsWith(`${phase}-`))
            : false;
          return { id: s.id!, name: s.name, done };
        });
        // "now" = first pending step after the last done step.
        const lastDoneIdx = stepStates.reduce((acc, s, i) => (s.done ? i : acc), -1);
        const nowIdx = lastDoneIdx + 1 < stepStates.length ? lastDoneIdx + 1 : -1;

        const productLabel = productNames.length === 1
          ? productNames[0]
          : `${productNames.length} products`;
        const batchLabel = plan.name || order?.customerName || order?.eventName || "Batch";

        return (
          <li key={pid} className={`${INNER} bg-muted/30 px-3 py-2.5`}>
            <Link href={`/production/${encodeURIComponent(pid)}`} className="block">
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-[12.5px] font-semibold truncate">
                  {productLabel}
                  {totalPieces > 0 && (
                    <span className="text-muted-foreground font-normal ml-1.5 text-[11px]">· {totalPieces} pcs</span>
                  )}
                  {plan.batchNumber && (
                    <span className="text-muted-foreground font-mono ml-1.5 text-[10px]">{plan.batchNumber}</span>
                  )}
                </p>
                <span className="text-[10px] text-muted-foreground shrink-0 truncate max-w-[40%]" title={batchLabel}>{batchLabel}</span>
              </div>
              <div className="flex gap-[2px] mb-1">
                {stepStates.map((s, i) => (
                  <div
                    key={s.id}
                    className="flex-1 h-1.5 rounded-[2px]"
                    style={{
                      background:
                        s.done ? "var(--accent-mint-ink)" :
                        i === nowIdx ? "var(--accent-butter-ink)" :
                        "var(--color-border)",
                    }}
                  />
                ))}
              </div>
              <div className="flex justify-between text-[9.5px] text-muted-foreground gap-1">
                {stepStates.map((s, i) => (
                  <span key={s.id} className={i === nowIdx ? "text-foreground font-medium" : ""} title={s.name}>
                    {abbrev(s.name)}
                  </span>
                ))}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// ─── helpers ────────────────────────────────────────────────────────

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function abbrev(name: string): string {
  // First three letters of step name. Keep "Cap" / "Fil" / "Pol" readable.
  return name.slice(0, 3);
}

