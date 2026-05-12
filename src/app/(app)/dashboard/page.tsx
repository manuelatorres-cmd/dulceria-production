"use client";

/**
 * Main dashboard — Dulceria production app.
 *
 * Spec: docs/MAIN_DASHBOARD_REDESIGN_SPEC.md (replaces legacy iOS-glass
 * dashboard wholesale per explicit no-defer instruction).
 *
 * Layout:
 *   PageHeader
 *   6-card ZoneCard grid (production / orders / stock / week / compliance / campaigns)
 *   Pipeline strip (horizontal StepPill flow)
 *   2-column body:
 *     left  → NeedsAttention (AttentionItem) + UpcomingDeadlines (ListRow)
 *     right → Next7Days (MiniDay) + StockSnapshot (ListRow) + ActiveCampaigns (ListRow)
 *
 * All data flows from existing hooks. No new endpoints.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useOrders,
  useAllOrderItems,
  useProductsList,
  useAllProductionDayLineItems,
  useProductionDays,
  useProductionSteps,
  useCapacityConfig,
  usePeople,
  usePersonUnavailability,
  useBlockedDays,
  useAllPlanProducts,
  useProductionPlans,
  useAllPlanStepStatuses,
  useProductLocationTotals,
  useStockLocationMinimums,
  useCampaigns,
  useAllIngredientStock,
  useTodayProductionDay,
  closeProductionDay,
  regenerateAllPlansAndSchedule,
  useFillings,
  useFillingStockItems,
  useEquipment,
  useProductCategories,
  useMouldsList,
  type CloseProductionSummary,
} from "@/lib/hooks";
import { capacityConfigStatus, effectiveDailyCapacityMinutes } from "@/lib/capacity";
import { phaseKeyFromStepName } from "@/lib/production";
import type { ProductionDayLineItem, ProductionStep, PlanStepStatus } from "@/types";
import {
  PageHeader,
  ZoneCard,
  StepPill,
  MiniDay,
  Section,
  ListRow,
  AttentionItem,
  StatusTag,
  DsButton,
  type ZoneVariant,
  type StepPillStatus,
  type MiniDayVariant,
  type ListRowTier,
  type AttentionVariant,
} from "@/components/dulceria";
import {
  IconAlertTriangle,
  IconClipboardCheck,
  IconChefHat,
  IconThermometer,
  IconCircleCheck,
} from "@tabler/icons-react";

// ─── Helpers ─────────────────────────────────────────────────────────

function isoForDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function pluralBatches(n: number): string {
  return `${n} batch${n === 1 ? "" : "es"}`;
}

function formatTimeHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ─── Page ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const orders = useOrders();
  const orderItems = useAllOrderItems();
  const products = useProductsList(true);
  const steps = useProductionSteps();
  const config = useCapacityConfig();
  const people = usePeople(false);
  const unavailability = usePersonUnavailability();
  const blockedDays = useBlockedDays();
  const planProducts = useAllPlanProducts();
  const productionPlans = useProductionPlans();
  const planStepStatuses = useAllPlanStepStatuses();
  const lineItems = useAllProductionDayLineItems();
  const productionDays = useProductionDays(30);
  const productLocationTotals = useProductLocationTotals();
  const stockLocationMinimums = useStockLocationMinimums();
  const campaigns = useCampaigns();
  const ingredientStock = useAllIngredientStock();
  const todayDay = useTodayProductionDay();
  const fillings = useFillings();
  const fillingStock = useFillingStockItems();
  const equipment = useEquipment(false);
  const productCategories = useProductCategories(true);
  const moulds = useMouldsList(true);

  const configStatus = capacityConfigStatus(config, people);

  // Ticking clock — refresh every minute so the header time stays current.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const todayIso = useMemo(() => isoForDate(now), [now]);

  // Lookup maps
  const productById = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const stepById = useMemo(() => new Map(steps.map((s) => [s.id!, s])), [steps]);
  const planById = useMemo(() => new Map(productionPlans.map((p) => [p.id!, p])), [productionPlans]);
  const planProductByPlan = useMemo(() => {
    const m = new Map<string, (typeof planProducts)[number]>();
    for (const pp of planProducts) if (!m.has(pp.planId)) m.set(pp.planId, pp);
    return m;
  }, [planProducts]);
  const mouldById = useMemo(() => new Map(moulds.map((m) => [m.id!, m])), [moulds]);
  const categoryById = useMemo(
    () => new Map(productCategories.map((c) => [c.id!, c])),
    [productCategories],
  );
  const productionDayDateById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of productionDays) if (d.id && d.date) m.set(d.id, d.date.slice(0, 10));
    return m;
  }, [productionDays]);

  // ─── Today's pipeline ────────────────────────────────────────────
  // Group by step phase across all batches on today's productionDay.
  const pipelineData = useMemo(() => {
    const todayLineItems = lineItems.filter(
      (li) => productionDayDateById.get(li.productionDayId) === todayIso,
    );

    interface PhaseSlot {
      name: string; // display name (Polish, Shell, Fill, ...)
      sortOrder: number;
      totalMoulds: number;
      doneMoulds: number;
      activeMinutes: number;
      hasInProgress: boolean;
    }
    const byPhase = new Map<string, PhaseSlot>();

    for (const li of todayLineItems) {
      const plan = planById.get(li.planId);
      if (!plan) continue;
      if (plan.status === "cancelled") continue;
      const pp = planProductByPlan.get(li.planId);
      const mouldCount = pp?.quantity ?? 0;
      const doneSet = new Set<string>();
      for (const s of planStepStatuses) {
        if (s.planId === li.planId && s.done) doneSet.add(s.stepKey);
      }
      for (const stepId of li.stepIds) {
        const step = stepById.get(stepId);
        if (!step) continue;
        const phaseKey = phaseKeyFromStepName(step.name) ?? step.name;
        const cur =
          byPhase.get(phaseKey) ?? {
            name: step.name,
            sortOrder: step.sortOrder ?? 9999,
            totalMoulds: 0,
            doneMoulds: 0,
            activeMinutes: 0,
            hasInProgress: false,
          };
        cur.totalMoulds += mouldCount;
        cur.activeMinutes += step.activeMinutes ?? 0;
        const isDone =
          doneSet.has(phaseKey) ||
          [...doneSet].some((k) => k.startsWith(`${phaseKey}-`));
        if (isDone) cur.doneMoulds += mouldCount;
        else cur.hasInProgress = true;
        if (step.sortOrder != null && step.sortOrder < cur.sortOrder)
          cur.sortOrder = step.sortOrder;
        byPhase.set(phaseKey, cur);
      }
    }

    const ordered = Array.from(byPhase.values()).sort((a, b) => a.sortOrder - b.sortOrder);
    return {
      todayLineItems,
      phases: ordered,
    };
  }, [lineItems, productionDayDateById, todayIso, planById, planProductByPlan, planStepStatuses, stepById]);

  const todayBatchPlanIds = useMemo(() => {
    const s = new Set<string>();
    for (const li of pipelineData.todayLineItems) s.add(li.planId);
    return s;
  }, [pipelineData.todayLineItems]);

  const todayProductNames = useMemo(() => {
    const names = new Set<string>();
    for (const planId of todayBatchPlanIds) {
      const pp = planProductByPlan.get(planId);
      if (!pp) continue;
      const product = productById.get(pp.productId);
      if (product?.name) names.add(product.name);
    }
    return Array.from(names);
  }, [todayBatchPlanIds, planProductByPlan, productById]);

  const todayProductsString = useMemo(() => {
    if (todayProductNames.length === 0) return "no products";
    const shown = todayProductNames.slice(0, 2).join(", ");
    const more = todayProductNames.length > 2 ? ` +${todayProductNames.length - 2}` : "";
    return shown + more;
  }, [todayProductNames]);

  // ─── Production zone ─────────────────────────────────────────────
  const productionZone = useMemo(() => {
    const phases = pipelineData.phases;
    if (phases.length === 0) {
      return {
        stepsDone: 0,
        stepsTotal: 0,
        status: "idle",
        statusVariant: "info" as ZoneVariant,
        accentVariant: "info" as ZoneVariant,
        currentStepName: "—",
        currentStepPct: 0,
      };
    }
    const stepsDone = phases.filter(
      (p) => p.totalMoulds > 0 && p.doneMoulds >= p.totalMoulds,
    ).length;
    const active = phases.find((p) => p.totalMoulds > p.doneMoulds);
    if (active) {
      const pct =
        active.totalMoulds > 0 ? Math.round((active.doneMoulds / active.totalMoulds) * 100) : 0;
      return {
        stepsDone,
        stepsTotal: phases.length,
        status: "in progress",
        statusVariant: (pct > 75 ? "ok" : "warn") as ZoneVariant,
        accentVariant: (pct > 75 ? "ok" : "warn") as ZoneVariant,
        currentStepName: active.name,
        currentStepPct: pct,
      };
    }
    return {
      stepsDone,
      stepsTotal: phases.length,
      status: "done for today",
      statusVariant: "ok" as ZoneVariant,
      accentVariant: "ok" as ZoneVariant,
      currentStepName: "all complete",
      currentStepPct: 100,
    };
  }, [pipelineData.phases]);

  // ─── Orders zone ─────────────────────────────────────────────────
  const ordersZone = useMemo(() => {
    const open = orders.filter(
      (o) => o.status === "pending" || o.status === "in_production" || o.status === "ready_to_pack",
    );
    const overdue = open.filter((o) => {
      if (!o.deadline) return false;
      const d = new Date(o.deadline);
      return d < new Date(todayIso + "T00:00:00");
    });
    const oldest = overdue
      .map((o) => new Date(o.deadline).getTime())
      .reduce((min, t) => Math.min(min, t), Number.POSITIVE_INFINITY);
    const oldestDays = Number.isFinite(oldest)
      ? Math.floor((new Date(todayIso + "T00:00:00").getTime() - oldest) / 86_400_000)
      : 0;
    return { overdueCount: overdue.length, totalOpen: open.length, oldestDays, overdue };
  }, [orders, todayIso]);

  // ─── Stock zone ──────────────────────────────────────────────────
  const stockZone = useMemo(() => {
    const minByProduct = new Map<string, number>();
    for (const m of stockLocationMinimums) {
      const cur = minByProduct.get(m.productId) ?? 0;
      minByProduct.set(m.productId, cur + (m.minimumUnits ?? 0));
    }
    let belowMin = 0;
    const productStock: Array<{ productId: string; name: string; current: number; minimum: number; deficit: number }> = [];
    for (const product of products) {
      if (product.archived) continue;
      const totals = productLocationTotals.get(product.id!);
      const current =
        (totals?.store ?? 0) + (totals?.production ?? 0) + (totals?.freezer ?? 0);
      const minimum = minByProduct.get(product.id!) ?? 0;
      if (minimum > 0 && current < minimum) belowMin++;
      productStock.push({
        productId: product.id!,
        name: product.name ?? "Unnamed",
        current,
        minimum,
        deficit: minimum - current,
      });
    }
    const ingredientsShort = ingredientStock.filter(
      (i) =>
        typeof i.quantityG === "number" &&
        typeof i.lowStockThresholdG === "number" &&
        i.quantityG < (i.lowStockThresholdG ?? 0),
    ).length;
    return { belowMinCount: belowMin, ingredientsShortCount: ingredientsShort, productStock };
  }, [products, stockLocationMinimums, productLocationTotals, ingredientStock]);

  // ─── This-week zone ──────────────────────────────────────────────
  const weekData = useMemo(() => {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const items: Array<{
      iso: string;
      dayName: string;
      dayNum: number;
      isToday: boolean;
      capacityPct: number;
      capacityVariant: MiniDayVariant;
      batchCount: number;
    }> = [];
    const warn = config?.warnThresholdPercent ?? 75;
    const critical = config?.criticalThresholdPercent ?? 90;
    let totalBatches = 0;
    let peak: { iso: string; pct: number; batches: number } | null = null;
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = isoForDate(d);
      const dayLi = lineItems.filter(
        (li) => productionDayDateById.get(li.productionDayId) === iso,
      );
      const used = dayLi.reduce((s, li) => s + (li.plannedMinutes ?? 0), 0);
      const cap = effectiveDailyCapacityMinutes(
        d,
        config,
        people,
        unavailability,
        blockedDays,
      );
      const pct = cap > 0 ? Math.round((used / cap) * 100) : 0;
      const variant: MiniDayVariant =
        cap === 0 || pct > critical ? "over" : pct > warn ? "warn" : "ok";
      const batchSet = new Set<string>();
      for (const li of dayLi) batchSet.add(li.planId);
      const batches = batchSet.size;
      totalBatches += batches;
      if (!peak || batches > peak.batches) peak = { iso, pct, batches };
      items.push({
        iso,
        dayName: d.toLocaleDateString("de-AT", { weekday: "short" }),
        dayNum: d.getDate(),
        isToday: iso === todayIso,
        capacityPct: pct,
        capacityVariant: variant,
        batchCount: batches,
      });
    }
    const peakDayLabel = peak
      ? new Date(peak.iso + "T00:00:00").toLocaleDateString("de-AT", { weekday: "short" })
      : "—";
    return { days: items, totalBatches, peakDayLabel, peakPct: peak?.pct ?? 0 };
  }, [now, lineItems, productionDayDateById, config, people, unavailability, blockedDays, todayIso]);

  // ─── Compliance zone ─────────────────────────────────────────────
  const complianceZone = useMemo(() => {
    const todos: Array<{ label: string; severity: "warn" | "info" }> = [];
    const tempCheckDevices = equipment.filter((e) => e.requiresTempCheck);
    if (todayDay && !todayDay.closedAt) {
      if (tempCheckDevices.length > 0 && !todayDay.tempLogComplete) {
        todos.push({ label: "Temperature log", severity: "warn" });
      }
      if (!todayDay.cleaningComplete) {
        todos.push({ label: "Cleaning checklist", severity: "warn" });
      }
    }
    return { todoCount: todos.length, primaryTodo: todos[0]?.label ?? null, tempCheckDevices };
  }, [equipment, todayDay]);

  // ─── Campaigns zone ──────────────────────────────────────────────
  const campaignsZone = useMemo(() => {
    const active = campaigns.filter((c) => c.status === "planned" || c.status === "active");
    const running = active.filter((c) => c.status === "active");
    return { total: active.length, running: running.length, active };
  }, [campaigns]);

  // ─── Attention items ─────────────────────────────────────────────
  const fillingsToCook = useMemo(() => {
    // Light heuristic: fillings that have line items on today's production day
    // but no current `fillingStock` row with remainingG > 0.
    const usedToday = new Set<string>();
    // Fillings linked to today's plans (via planProducts.productId → product.shellFillingId).
    for (const planId of todayBatchPlanIds) {
      const pp = planProductByPlan.get(planId);
      const product = pp ? productById.get(pp.productId) : undefined;
      if (product?.shellFillingId) usedToday.add(product.shellFillingId);
    }
    const stockByFilling = new Map<string, number>();
    for (const fs of fillingStock) {
      const cur = stockByFilling.get(fs.fillingId) ?? 0;
      stockByFilling.set(fs.fillingId, cur + (fs.remainingG ?? 0));
    }
    const missing = Array.from(usedToday).filter((id) => (stockByFilling.get(id) ?? 0) <= 0);
    const names = missing
      .map((id) => fillings.find((f) => f.id === id)?.name)
      .filter((n): n is string => !!n);
    return { count: missing.length, names };
  }, [todayBatchPlanIds, planProductByPlan, productById, fillingStock, fillings]);

  const attentionItems = useMemo(() => {
    const out: Array<{
      id: string;
      variant: AttentionVariant;
      title: string;
      detail: string;
      href: string;
      actionLabel: string;
      icon: "alert" | "check" | "chef" | "thermo";
    }> = [];

    if (ordersZone.overdueCount > 0) {
      out.push({
        id: "overdue-orders",
        variant: "critical",
        title: `${ordersZone.overdueCount} order${ordersZone.overdueCount === 1 ? "" : "s"} past deadline`,
        detail:
          ordersZone.oldestDays > 0
            ? `Oldest ${ordersZone.oldestDays} day${ordersZone.oldestDays === 1 ? "" : "s"} overdue. Re-schedule or contact customer.`
            : "Re-schedule or contact customer.",
        href: "/orders",
        actionLabel: "open orders",
        icon: "alert",
      });
    }
    if (stockZone.ingredientsShortCount > 0) {
      out.push({
        id: "ingredients-short",
        variant: "warn",
        title: `${stockZone.ingredientsShortCount} ingredient${stockZone.ingredientsShortCount === 1 ? "" : "s"} short`,
        detail: "Place a supplier order.",
        href: "/shopping",
        actionLabel: "shopping list",
        icon: "alert",
      });
    }
    if (stockZone.belowMinCount > 30) {
      out.push({
        id: "below-min",
        variant: "warn",
        title: `${stockZone.belowMinCount} products below minimum`,
        detail: "Production storage thinning — consider replenishment.",
        href: "/stock",
        actionLabel: "stock",
        icon: "alert",
      });
    }
    if (fillingsToCook.count > 0) {
      out.push({
        id: "fillings-to-cook",
        variant: "info",
        title: `${fillingsToCook.count} filling${fillingsToCook.count === 1 ? "" : "s"} to cook today`,
        detail: fillingsToCook.names.slice(0, 3).join(" · ") || "no stock on hand",
        href: "/plan/fillings",
        actionLabel: "filling plan",
        icon: "chef",
      });
    }
    if (
      complianceZone.tempCheckDevices.length > 0 &&
      todayDay &&
      !todayDay.closedAt &&
      !todayDay.tempLogComplete
    ) {
      out.push({
        id: "temp-log",
        variant: "warn",
        title: "Temperature log not completed",
        detail: `${complianceZone.tempCheckDevices.length} device${complianceZone.tempCheckDevices.length === 1 ? "" : "s"} need a check.`,
        href: "/production-brain/haccp",
        actionLabel: "log",
        icon: "thermo",
      });
    }
    if (out.length === 0) {
      out.push({
        id: "all-clear",
        variant: "positive",
        title: "All clear",
        detail: "No urgent items — keep going.",
        href: "/production-brain/dashboard",
        actionLabel: "details",
        icon: "check",
      });
    }
    return out;
  }, [ordersZone, stockZone, fillingsToCook, complianceZone, todayDay]);

  // ─── Upcoming deadlines list ─────────────────────────────────────
  const upcomingDeadlines = useMemo(() => {
    const todayMs = new Date(todayIso + "T00:00:00").getTime();
    const open = orders
      .filter(
        (o) => o.status === "pending" || o.status === "in_production" || o.status === "ready_to_pack",
      )
      .map((o) => {
        const due = o.deadline ? new Date(o.deadline) : null;
        const dueMs = due ? due.getTime() : Number.POSITIVE_INFINITY;
        const daysOverdue = due ? Math.floor((todayMs - dueMs) / 86_400_000) : 0;
        const orderId = o.id!;
        const items = orderItems.filter((it) => it.orderId === orderId);
        const totalPieces = items.reduce((s, it) => s + (it.quantity ?? 0), 0);
        const topProducts = items
          .map((it) => productById.get(it.productId)?.name)
          .filter((n): n is string => !!n)
          .slice(0, 2);
        return {
          id: orderId,
          customerName: o.customerName ?? o.eventName ?? o.sourceRef ?? "Anonymous",
          orderNumber: o.sourceRef ?? "",
          dueDate: due,
          daysOverdue,
          totalPieces,
          topProducts,
        };
      })
      .filter((row) => row.dueDate != null);
    open.sort((a, b) => {
      if (a.daysOverdue !== b.daysOverdue) return b.daysOverdue - a.daysOverdue;
      const at = a.dueDate?.getTime() ?? 0;
      const bt = b.dueDate?.getTime() ?? 0;
      return at - bt;
    });
    return open.slice(0, 5);
  }, [orders, orderItems, productById, todayIso]);

  // ─── Stock snapshot (top 5 by severity) ──────────────────────────
  const stockSnapshot = useMemo(() => {
    type Row = {
      productId: string;
      name: string;
      current: number;
      minimum: number;
      severity: "urgent" | "warn" | "ok";
      severityRank: number;
      deficit: number;
    };
    const rows: Row[] = stockZone.productStock.map((s) => {
      let severity: "urgent" | "warn" | "ok";
      let rank: number;
      if (s.minimum > 0 && s.current === 0) {
        severity = "urgent";
        rank = 0;
      } else if (s.minimum > 0 && s.current < s.minimum / 2) {
        severity = "urgent";
        rank = 1;
      } else if (s.minimum > 0 && s.current < s.minimum) {
        severity = "warn";
        rank = 2;
      } else {
        severity = "ok";
        rank = 3;
      }
      return {
        productId: s.productId,
        name: s.name,
        current: s.current,
        minimum: s.minimum,
        severity,
        severityRank: rank,
        deficit: s.deficit,
      };
    });
    rows.sort((a, b) => {
      if (a.severityRank !== b.severityRank) return a.severityRank - b.severityRank;
      return b.deficit - a.deficit;
    });
    return rows.slice(0, 5);
  }, [stockZone.productStock]);

  // ─── Active campaigns (top 3 by urgency) ─────────────────────────
  const activeCampaignsRows = useMemo(() => {
    const todayMs = new Date(todayIso + "T00:00:00").getTime();
    type Row = {
      id: string;
      name: string;
      status: string;
      daysToDeadline: number;
      batchCount: number;
      deadlineLabel: string;
    };
    const rows: Row[] = campaignsZone.active.map((c) => {
      const end = c.endDate ? new Date(c.endDate + "T00:00:00").getTime() : Number.POSITIVE_INFINITY;
      const days = end !== Number.POSITIVE_INFINITY ? Math.ceil((end - todayMs) / 86_400_000) : 9999;
      // Count plans whose name encodes this campaign.
      const tokens = [`Campaign: ${c.name}`, `${c.name} —`];
      const batchCount = productionPlans.filter((p) =>
        tokens.some((t) => (p.name ?? "").includes(t)),
      ).length;
      return {
        id: c.id!,
        name: c.name,
        status: c.status,
        daysToDeadline: days,
        batchCount,
        deadlineLabel: c.endDate
          ? new Date(c.endDate + "T00:00:00").toLocaleDateString("de-AT", {
              day: "numeric",
              month: "short",
            })
          : "no date",
      };
    });
    rows.sort((a, b) => {
      if (a.daysToDeadline !== b.daysToDeadline) return a.daysToDeadline - b.daysToDeadline;
      return b.batchCount - a.batchCount;
    });
    return rows.slice(0, 3);
  }, [campaignsZone.active, productionPlans, todayIso]);

  // ─── Header meta line ────────────────────────────────────────────
  const dateLabel = useMemo(
    () =>
      now.toLocaleDateString("de-AT", {
        weekday: "short",
        day: "numeric",
        month: "short",
      }),
    [now],
  );
  const timeLabel = useMemo(() => formatTimeHHMM(now), [now]);
  const batchesScheduledToday = todayBatchPlanIds.size;
  const currentStepText =
    productionZone.status === "in progress"
      ? ` · ${productionZone.currentStepName} in progress`
      : "";

  // ─── Close production day action ─────────────────────────────────
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  async function handleCloseDay() {
    if (!todayDay || todayDay.closedAt) return;
    if (!confirm("Close today's production? Unfinished steps carry forward.")) return;
    setClosing(true);
    setCloseError(null);
    try {
      const summary: CloseProductionSummary = await closeProductionDay();
      if (summary.stepsCarriedForward > 0 && configStatus.isComplete && steps.length > 0) {
        const categoryNameById = new Map(
          productCategories.map((c) => [c.id!, c.name]),
        );
        regenerateAllPlansAndSchedule({
          config,
          people,
          unavailability,
          blockedDays,
          productionSteps: steps,
          categoryNameById,
        }).catch((e) => console.warn("post-close auto-regen failed", e));
      }
    } catch (e) {
      setCloseError(e instanceof Error ? e.message : String(e));
    } finally {
      setClosing(false);
    }
  }

  // ─── Pipeline render meta ───────────────────────────────────────
  const pipelineEndTime = useMemo(() => {
    const totalActiveMinutes = pipelineData.phases.reduce(
      (s, p) => s + p.activeMinutes,
      0,
    );
    if (totalActiveMinutes <= 0) return "—";
    const end = new Date(now);
    end.setMinutes(end.getMinutes() + totalActiveMinutes);
    return formatTimeHHMM(end);
  }, [pipelineData.phases, now]);

  // ─── Pipeline step pills ─────────────────────────────────────────
  const pipelinePills = useMemo(() => {
    return pipelineData.phases.map((phase, idx) => {
      let status: StepPillStatus;
      if (phase.totalMoulds > 0 && phase.doneMoulds >= phase.totalMoulds) status = "done";
      else if (phase.doneMoulds > 0 || phase.hasInProgress) status = "in_progress";
      else status = "pending";
      const meta =
        status === "done"
          ? "done"
          : status === "in_progress"
          ? "in progress"
          : "pending";
      return {
        key: `${phase.name}:${idx}`,
        name: phase.name,
        progress: `${phase.doneMoulds}/${phase.totalMoulds}`,
        meta,
        status,
        isLast: idx === pipelineData.phases.length - 1,
      };
    });
  }, [pipelineData.phases]);

  // ─── Header badges ───────────────────────────────────────────────
  const urgentBadgeCount = ordersZone.overdueCount;
  const attentionBadgeCount = attentionItems.filter((a) => a.variant !== "positive").length;

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title="Welcome back"
        meta={`${dateLabel} · ${timeLabel} · ${pluralBatches(batchesScheduledToday)} scheduled${currentStepText}`}
        badges={
          <>
            {urgentBadgeCount > 0 && (
              <StatusTag kind="overdue">{urgentBadgeCount} urgent</StatusTag>
            )}
            {attentionBadgeCount > 0 && (
              <StatusTag kind="pending">{attentionBadgeCount} attention</StatusTag>
            )}
          </>
        }
        actions={
          <DsButton
            variant="default"
            size="md"
            onClick={handleCloseDay}
            disabled={closing || !todayDay || !!todayDay?.closedAt}
          >
            {closing ? "Closing…" : todayDay?.closedAt ? "Day closed" : "Close production day"}
          </DsButton>
        }
      />

      <div style={{ padding: "16px 32px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
        {closeError && (
          <div
            style={{
              padding: "10px 14px",
              border: "0.5px solid var(--ds-tier-urgent)",
              background: "var(--ds-tint-critical)",
              color: "var(--ds-tier-urgent)",
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            Close day failed: {closeError}
          </div>
        )}

        {/* ── 6 zone cards ─────────────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
            gap: 12,
          }}
        >
          <ZoneCard
            label="Production"
            status={productionZone.status}
            statusVariant={productionZone.statusVariant}
            accentVariant={productionZone.accentVariant}
            value={
              <>
                {productionZone.stepsDone}
                <span style={{ fontSize: 16, color: "var(--ds-text-muted)", fontWeight: 400 }}>
                  /{productionZone.stepsTotal}
                </span>
              </>
            }
            subtitle={
              productionZone.stepsTotal === 0
                ? "nothing scheduled today"
                : `${productionZone.currentStepName} · ${productionZone.currentStepPct}%`
            }
            href="/plan?view=weekly"
          />
          <ZoneCard
            label="Orders"
            status={ordersZone.overdueCount > 0 ? "overdue" : "all current"}
            statusVariant={ordersZone.overdueCount > 0 ? "urgent" : "ok"}
            accentVariant={ordersZone.overdueCount > 0 ? "urgent" : "info"}
            value={ordersZone.overdueCount > 0 ? ordersZone.overdueCount : ordersZone.totalOpen}
            subtitle={
              ordersZone.overdueCount > 0
                ? `oldest ${ordersZone.oldestDays} day${ordersZone.oldestDays === 1 ? "" : "s"}`
                : `${ordersZone.totalOpen} open order${ordersZone.totalOpen === 1 ? "" : "s"}`
            }
            href="/orders"
          />
          <ZoneCard
            label="Stock"
            status={stockZone.belowMinCount > 30 ? "attention" : "stable"}
            statusVariant={stockZone.belowMinCount > 30 ? "warn" : "ok"}
            accentVariant={stockZone.belowMinCount > 30 ? "warn" : "info"}
            value={stockZone.belowMinCount}
            subtitle={`below min · ${stockZone.ingredientsShortCount} ingr. short`}
            href="/stock"
          />
          <ZoneCard
            label="This week"
            status="on track"
            statusVariant="info"
            accentVariant="info"
            value={weekData.totalBatches}
            subtitle={`batches · peak ${weekData.peakDayLabel} ${weekData.peakPct}%`}
            href="/plan?view=weekly"
          />
          <ZoneCard
            label="Compliance"
            status={complianceZone.todoCount > 0 ? `${complianceZone.todoCount} todo` : "all clear"}
            statusVariant={complianceZone.todoCount > 0 ? "warn" : "ok"}
            accentVariant={complianceZone.todoCount > 0 ? "warn" : "ok"}
            value={complianceZone.todoCount}
            subtitle={complianceZone.primaryTodo ? `${complianceZone.primaryTodo} incomplete` : "logs up to date"}
            href="/production-brain/haccp"
          />
          <ZoneCard
            label="Campaigns"
            status={campaignsZone.running > 0 ? "running" : "idle"}
            statusVariant={campaignsZone.running > 0 ? "ok" : "info"}
            accentVariant={campaignsZone.running > 0 ? "ok" : "info"}
            value={campaignsZone.total}
            subtitle="planned + running"
            href="/campaigns"
          />
        </div>

        {/* ── Today's pipeline ─────────────────────────────────── */}
        <section
          style={{
            background: "var(--ds-card-bg)",
            border: "0.5px solid var(--ds-border-warm)",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "12px 18px 8px",
              borderBottom: "0.5px solid var(--ds-border-warm)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span
              className="text-ds-card-title"
              style={{ fontSize: 16, fontFamily: "var(--font-serif)", fontWeight: 600 }}
            >
              Today's pipeline
            </span>
            <span className="text-ds-meta">
              {pluralBatches(batchesScheduledToday)} · {todayProductsString} · ends ~{pipelineEndTime} ·{" "}
              <Link
                href="/plan?view=weekly"
                style={{ color: "var(--ds-tier-quarter-focus)", textDecoration: "none" }}
              >
                full schedule →
              </Link>
            </span>
          </div>
          <div
            style={{
              padding: "14px 18px",
              display: pipelinePills.length === 0 ? "block" : "grid",
              gridTemplateColumns: `repeat(${Math.max(1, pipelinePills.length)}, minmax(0, 1fr))`,
              gap: 14,
            }}
          >
            {pipelinePills.length === 0 ? (
              <p className="text-ds-meta">No batches scheduled today.</p>
            ) : (
              pipelinePills.map((p) => (
                <StepPill
                  key={p.key}
                  name={p.name}
                  progress={p.progress}
                  meta={p.meta}
                  status={p.status}
                  isLast={p.isLast}
                  onClick={() => router.push("/plan?view=weekly")}
                />
              ))
            )}
          </div>
        </section>

        {/* ── Body grid ────────────────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Section
              title="Needs attention"
              action={`${attentionItems.length} item${attentionItems.length === 1 ? "" : "s"}`}
            >
              <div style={{ padding: "0 16px 12px" }}>
                {attentionItems.map((item) => {
                  const Icon =
                    item.icon === "alert"
                      ? IconAlertTriangle
                      : item.icon === "chef"
                      ? IconChefHat
                      : item.icon === "thermo"
                      ? IconThermometer
                      : item.icon === "check"
                      ? IconCircleCheck
                      : IconClipboardCheck;
                  return (
                    <AttentionItem
                      key={item.id}
                      icon={<Icon size={14} stroke={1.5} />}
                      variant={item.variant}
                      title={item.title}
                      detail={item.detail}
                      action={
                        <Link
                          href={item.href}
                          style={{
                            fontSize: 11,
                            color: "var(--ds-tier-quarter-focus)",
                            textDecoration: "none",
                          }}
                        >
                          {item.actionLabel} →
                        </Link>
                      }
                    />
                  );
                })}
              </div>
            </Section>

            <Section
              title="Upcoming deadlines"
              action={
                <Link
                  href="/orders"
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  all orders →
                </Link>
              }
              noBody
            >
              {upcomingDeadlines.length === 0 ? (
                <p className="text-ds-meta" style={{ padding: "16px 20px" }}>
                  No deadlines on file.
                </p>
              ) : (
                upcomingDeadlines.map((row) => {
                  const tier: ListRowTier = row.daysOverdue > 0 ? "urgent" : "default";
                  const title = (
                    <>
                      <span>{row.customerName}</span>
                      {row.orderNumber && (
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--ds-text-muted)",
                            tabSize: 1,
                          }}
                        >
                          #{row.orderNumber}
                        </span>
                      )}
                    </>
                  );
                  const meta = `${row.totalPieces} pcs${row.topProducts.length > 0 ? " · " + row.topProducts.join(", ") : ""}`;
                  const side =
                    row.daysOverdue > 0 ? (
                      <span
                        style={{
                          color: "var(--ds-tier-urgent)",
                          fontWeight: 500,
                          fontSize: 11,
                        }}
                      >
                        {row.daysOverdue}d overdue
                      </span>
                    ) : (
                      <span className="text-ds-meta">
                        {row.dueDate?.toLocaleDateString("de-AT", { day: "numeric", month: "short" })}
                      </span>
                    );
                  return (
                    <ListRow
                      key={row.id}
                      tier={tier}
                      title={title}
                      meta={meta}
                      side={side}
                      onClick={() => router.push(`/orders/${row.id}`)}
                    />
                  );
                })
              )}
            </Section>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Section
              title="Next 7 days"
              action={
                <Link href="/plan?view=weekly" style={{ color: "inherit", textDecoration: "none" }}>
                  full plan →
                </Link>
              }
            >
              <div
                style={{
                  padding: "0 18px 12px",
                  display: "grid",
                  gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                  gap: 6,
                }}
              >
                {weekData.days.map((d) => (
                  <MiniDay
                    key={d.iso}
                    label={d.dayName}
                    num={d.dayNum}
                    isToday={d.isToday}
                    capacityPct={d.capacityPct}
                    capacityVariant={d.capacityVariant}
                    batchCount={d.batchCount}
                    onClick={() => router.push(`/production-brain/daily?date=${d.iso}`)}
                  />
                ))}
              </div>
            </Section>

            <Section
              title="Stock snapshot"
              action={
                <Link href="/stock" style={{ color: "inherit", textDecoration: "none" }}>
                  full stock →
                </Link>
              }
              noBody
            >
              {stockSnapshot.length === 0 ? (
                <p className="text-ds-meta" style={{ padding: "16px 20px" }}>
                  Stock data unavailable.
                </p>
              ) : (
                stockSnapshot.map((row) => {
                  const tier: ListRowTier =
                    row.severity === "urgent"
                      ? "urgent"
                      : row.severity === "warn"
                      ? "active"
                      : "default";
                  const kind =
                    row.severity === "urgent"
                      ? "overdue"
                      : row.severity === "warn"
                      ? "pending"
                      : "ready";
                  return (
                    <ListRow
                      key={row.productId}
                      tier={tier}
                      title={row.name}
                      meta={`${row.current} in stock${row.minimum > 0 ? ` · min ${row.minimum}` : ""}`}
                      side={
                        <StatusTag kind={kind as "overdue" | "pending" | "ready"}>
                          {row.severity === "urgent" ? "critical" : row.severity === "warn" ? "low" : "ok"}
                        </StatusTag>
                      }
                      onClick={() => router.push("/stock")}
                    />
                  );
                })
              )}
            </Section>

            <Section
              title="Active campaigns"
              action={
                <Link href="/campaigns" style={{ color: "inherit", textDecoration: "none" }}>
                  all {campaignsZone.total} →
                </Link>
              }
              noBody
            >
              {activeCampaignsRows.length === 0 ? (
                <p className="text-ds-meta" style={{ padding: "16px 20px" }}>
                  No active campaigns.
                </p>
              ) : (
                activeCampaignsRows.map((row) => {
                  const urgent = row.daysToDeadline >= 0 && row.daysToDeadline < 3;
                  const tier: ListRowTier = urgent ? "urgent" : "default";
                  const side =
                    row.daysToDeadline >= 0 && row.daysToDeadline < 7 ? (
                      <span
                        style={{
                          color: urgent ? "var(--ds-tier-urgent)" : "var(--ds-text-primary)",
                          fontWeight: 500,
                          fontSize: 11,
                        }}
                      >
                        {row.daysToDeadline}d left
                      </span>
                    ) : (
                      <span className="text-ds-meta">{row.deadlineLabel}</span>
                    );
                  return (
                    <ListRow
                      key={row.id}
                      tier={tier}
                      title={row.name}
                      meta={`${pluralBatches(row.batchCount)} · ${row.status}`}
                      side={side}
                      onClick={() => router.push(`/campaigns/${row.id}`)}
                    />
                  );
                })
              )}
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

// Silence unused-warning lint for hooks fetched purely to keep the data
// graph hot — moulds + mouldById are referenced in commented-out future
// computations but kept imported so the cache is warm.
void useMouldsList;
