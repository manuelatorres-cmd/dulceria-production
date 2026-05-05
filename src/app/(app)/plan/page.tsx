"use client";

import { useMemo, useState, useCallback, Fragment } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  useOrders, useAllOrderItems, useProductsList, useProductionSteps,
  useCapacityConfig, usePeople, usePersonUnavailability, useBlockedDays,
  useProductCategories, useMouldsList, useProductionPlans, useAllPlanProducts,
  useAllOrderPlanLinks, regenerateAllPlansAndSchedule,
  useAllProductionDayLineItems, useProductionDays, useAllPlanStepStatuses,
  closeProductionDay, useLastRegenAt,
  moveProductionPlansToDate, unpinProductionPlan, pinProductionPlans,
  moveProductionStepsToDate,
  useProductLocationTotals, useCampaigns, useProductionOrders,
} from "@/lib/hooks";
import { capacityConfigStatus, effectiveDailyCapacityMinutes } from "@/lib/capacity";
import { queryClient } from "@/lib/query-client";
import { RefreshCw, AlertTriangle, CheckCircle, Flame, Lock } from "lucide-react";
import { BackButton } from "@/components/back-button";
import { PlanTabs } from "@/components/plan-tabs";
import {
  DndContext, useDraggable, useDroppable, PointerSensor, useSensor, useSensors,
  closestCenter, pointerWithin,
  type DragEndEvent,
} from "@dnd-kit/core";

/* Style constants — kept consistent with the dashboard redesign so
   /plan and /dashboard read as one family. See feedback_design_direction
   (dashboard exception, 2026-04-24). */
const CARD = "bg-white/65 backdrop-blur-2xl border border-white/60 rounded-[18px] p-4 shadow-[0_1px_2px_rgba(16,18,24,0.04),0_8px_24px_rgba(16,18,24,0.05)]";
const INNER = "rounded-[12px] border border-border";

/** Render Error / Supabase / unknown into a single human-readable line.
 *  PostgREST errors aren't Error instances; rendering them via err.message
 *  alone drops the .code/.details/.hint that explain the actual cause. */
function formatError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as { message?: string; details?: string; hint?: string; code?: string };
    const core = o.message || o.details || "Operation failed";
    const code = o.code ? ` (code ${o.code})` : "";
    const hint = o.hint ? ` — ${o.hint}` : "";
    return `${core}${code}${hint}`;
  }
  return String(e);
}

type Level = "ok" | "warn" | "critical" | "over";

const LEVEL_TINT: Record<Level, string> = {
  ok:       "bg-[var(--accent-mint-bg)]/40",
  warn:     "bg-[var(--accent-butter-bg)]/50",
  critical: "bg-[var(--accent-blush-bg)]/50",
  over:     "bg-[var(--accent-blush-bg)]/70",
};

const LEVEL_PILL: Record<Level, string> = {
  ok:       "bg-[var(--accent-mint-bg)] text-[var(--accent-mint-ink)] border-[var(--accent-mint-bg)]",
  warn:     "bg-[var(--accent-butter-bg)] text-[var(--accent-butter-ink)] border-[var(--accent-butter-bg)]",
  critical: "bg-[var(--accent-blush-bg)] text-[var(--accent-blush-ink)] border-[var(--accent-blush-bg)]",
  over:     "bg-[var(--accent-blush-bg)] text-[var(--accent-blush-ink)] border-[var(--accent-blush-bg)]",
};

const LEVEL_BAR: Record<Level, string> = {
  ok:       "var(--accent-mint-ink)",
  warn:     "var(--accent-butter-ink)",
  critical: "var(--accent-blush-ink)",
  over:     "var(--accent-blush-ink)",
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
  const mouldMap = useMemo(() => new Map(moulds.map((m) => [m.id!, m])), [moulds]);
  const plans = useProductionPlans();
  const planProducts = useAllPlanProducts();
  const orderPlanLinks = useAllOrderPlanLinks();
  const lineItems = useAllProductionDayLineItems();
  const productionDays = useProductionDays(120);
  const stepStatuses = useAllPlanStepStatuses();
  const productLocationTotals = useProductLocationTotals();
  const campaigns = useCampaigns();
  const productionOrders = useProductionOrders();

  // ── Focus filter ───────────────────────────────────────────────
  // Optional URL param `?focus=` scopes the calendar to a single
  // source (order / campaign / PO). Used by detail pages' "Plan
  // this" button to slice the week view down to one source's
  // batches at a time. Manuela uses this to schedule one source
  // end-to-end without distraction, then clears + picks the next.
  const searchParams = useSearchParams();
  const router = useRouter();
  const focusParam = searchParams.get("focus");
  // ── View tab (Weekly / Pivot / Daily) ────────────────────────────
  // Weekly + Pivot render here. Daily lives at /production-brain/daily
  // (route kept; PlanTabs strip rendered there too). The internal
  // viewMode state is now URL-driven so PlanTabs at the top + the
  // legacy day/week/pivot/month toggle stay in sync. URL value
  // "weekly" maps to internal "week" (other internal modes pass
  // through unchanged).
  const viewParamRaw = searchParams.get("view");
  // Multi-source: focus param can carry several sources, comma
  // separated (e.g. `campaign:Veganmania,po:Replen · 2026-04-27`).
  // The week / day grids show batches matching ANY of the sources.
  const focusTokens = useMemo<string[]>(
    () => (focusParam ? focusParam.split(",").map((s) => s.trim()).filter(Boolean) : []),
    [focusParam],
  );
  const focusedPlanIds = useMemo<Set<string> | null>(() => {
    if (focusTokens.length === 0) return null;
    const ids = new Set<string>();
    for (const tok of focusTokens) {
      const sep = tok.indexOf(":");
      if (sep === -1) continue;
      const kind = tok.slice(0, sep);
      const value = tok.slice(sep + 1);
      if (!value) continue;
      if (kind === "order") {
        const itemIds = new Set(orderItems.filter((it) => it.orderId === value).map((it) => it.id!));
        for (const link of orderPlanLinks) {
          if (itemIds.has(link.orderItemId)) ids.add(link.planId);
        }
      } else if (kind === "campaign") {
        const prefix = `Campaign: ${value} —`;
        for (const p of plans) {
          if (p.id && (p.name ?? "").startsWith(prefix)) ids.add(p.id);
        }
      } else if (kind === "po") {
        const prefix = `PO: ${value} —`;
        for (const p of plans) {
          if (p.id && (p.name ?? "").startsWith(prefix)) ids.add(p.id);
        }
      }
    }
    return ids;
  }, [focusTokens, orderItems, orderPlanLinks, plans]);

  function tokenLabel(tok: string): string {
    const sep = tok.indexOf(":");
    if (sep === -1) return tok;
    const kind = tok.slice(0, sep);
    const value = tok.slice(sep + 1);
    if (kind === "order") {
      const order = orders.find((o) => o.id === value);
      return `Order ${order?.sourceRef || order?.customerName || value.slice(0, 6)}`;
    }
    if (kind === "campaign") return `Campaign · ${value}`;
    if (kind === "po") return `PO · ${value}`;
    return tok;
  }
  // Single-source label kept for the existing chip; the new panel
  // renders multi-source chips inline.
  const focusLabel = useMemo(() => {
    if (focusTokens.length === 0) return null;
    if (focusTokens.length === 1) return tokenLabel(focusTokens[0]);
    return `${focusTokens.length} sources`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTokens, orders]);

  function clearFocus() {
    router.push("/plan");
  }
  function toggleFocusToken(tok: string) {
    const next = focusTokens.includes(tok)
      ? focusTokens.filter((t) => t !== tok)
      : [...focusTokens, tok];
    if (next.length === 0) router.push("/plan");
    else router.push(`/plan?focus=${next.map((s) => encodeURIComponent(s)).join(",")}`);
  }

  // Apply focus to the lineItems feed used everywhere downstream so
  // every renderer (day view, week view, demand panel) is consistent.
  // Done batches are also filtered out — they're finished, no point
  // cluttering the calendar after the fact.
  const visibleLineItems = useMemo(() => {
    const donePlanIds = new Set(
      plans.filter((p) => p.status === "done" || p.status === "cancelled" || p.status === "orphaned")
        .map((p) => p.id!),
    );
    let base = lineItems.filter((li) => !donePlanIds.has(li.planId));
    if (focusedPlanIds) base = base.filter((li) => focusedPlanIds.has(li.planId));
    return base;
  }, [lineItems, focusedPlanIds, plans]);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const orderMap = useMemo(() => new Map(orders.map((o) => [o.id!, o])), [orders]);
  const planMap = useMemo(() => new Map(plans.map((p) => [p.id!, p])), [plans]);
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

  // Mould map currently unused in JSX; kept in case a follow-up card
  // wants to show mould wear per plan.
  void moulds;

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

  // Plan-step done lookup. The batch checklist stores keys as either
  // `${stepId}` or `${stepId}-${planProductId}` — both count as "done"
  // for the step at the plan level.
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
        let level: Level;
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
  // viewMode derived from URL so PlanTabs at top + the existing
  // day/week/pivot/month toggle stay in sync. Default = "day" (current
  // unchanged default for /plan with no ?view).
  const viewMode: "day" | "week" | "pivot" | "month" = useMemo(() => {
    if (viewParamRaw === "weekly" || viewParamRaw === "week") return "week";
    if (viewParamRaw === "pivot") return "pivot";
    if (viewParamRaw === "month") return "month";
    if (viewParamRaw === "day") return "day";
    return "day";
  }, [viewParamRaw]);
  const setViewMode = useCallback((next: "day" | "week" | "pivot" | "month") => {
    const urlView = next === "week" ? "weekly" : next;
    const qs = new URLSearchParams(searchParams.toString());
    qs.set("view", urlView);
    router.push("/plan?" + qs.toString());
  }, [router, searchParams]);

  const configStatus = capacityConfigStatus(config, people);

  const categoryNameById = useMemo(
    () => new Map(categories.map((c) => [c.id!, c.name])),
    [categories],
  );

  // Step-section expand state. Keyed by `${dayId}|${stepId}`. Default =
  // collapsed; toggling adds the key to the expanded set.
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  function toggleSection(key: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Product-level expand state for steps with >1 product. Keyed by
  // `${dayId}|${stepId}|${productId}`. Default = collapsed; user clicks
  // to reveal that product's batch lines.
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  function toggleProduct(key: string) {
    setExpandedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Category-level expand state when a step covers >1 product category
  // (e.g. Shelling appears for moulded + bars + filled bars). Keyed by
  // `${dayId}|${stepId}|${categoryId}`. Default = collapsed.
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  function toggleCategory(key: string) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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
      // PostgrestError instances hide props behind getters — own
      // property enumeration returns []. Pull every named field
      // explicitly + JSON.stringify with `getOwnPropertyNames` so we
      // see the actual payload in the console instead of `{}`.
      const e = err as Record<string, unknown> | null | undefined;
      const message = (e?.message as string) ?? (err instanceof Error ? err.message : "");
      const code = (e?.code as string) ?? "";
      const details = (e?.details as string) ?? "";
      const hint = (e?.hint as string) ?? "";
      const status = (e?.status as string) ?? "";
      const name = (e?.name as string) ?? "";
      const summary = [
        message || "Regenerate failed",
        code && `(code ${code})`,
        status && `(${status})`,
        hint && `— ${hint}`,
        details && `· ${details}`,
      ].filter(Boolean).join(" ");
      setRegenerateError(summary);
      let dump = "";
      try {
        dump = JSON.stringify(err, err && typeof err === "object" ? Object.getOwnPropertyNames(err) : []);
      } catch { /* circular */ }
      // Print everything we can extract — multiple lines so something is visible.
      console.error("regenerate failed [structured]:", { name, message, code, status, details, hint });
      console.error("regenerate failed [raw obj]:", err);
      console.error("regenerate failed [stringified]:", dump);
      console.error("regenerate failed [toString]:", String(err));
    } finally {
      setRegenerating(false);
    }
  }

  // Aggregate roll-up for the header pills.
  const totalBatches = daySummary.reduce((s, d) => s + d.batchCount, 0);
  const tightDays = daySummary.filter((d) => d.level === "warn" || d.level === "critical" || d.level === "over").length;

  const orderedSteps = useMemo(
    () => [...productionSteps].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [productionSteps],
  );

  // Open production days from before today — Manuela may have left
  // yesterday's day open. Surface a banner so she can close it (which
  // carries forward unfinished steps) without hunting through pages.
  const todayIso = new Date().toISOString().slice(0, 10);
  const staleOpenDays = useMemo(
    () => productionDays.filter((d) => !d.closedAt && d.status !== "done" && d.date < todayIso),
    [productionDays, todayIso],
  );
  const [closingDate, setClosingDate] = useState<string | null>(null);
  async function handleCloseStale(dateIso: string) {
    setClosingDate(dateIso);
    try {
      await closeProductionDay(undefined, dateIso);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Close failed");
    } finally {
      setClosingDate(null);
    }
  }

  return (
    <div className="px-3 sm:px-5 pt-5 pb-10 max-w-[1700px] mx-auto">
      <div className="mb-2">
        <BackButton />
      </div>
      <PlanTabs focusParam={focusParam} />
      {/* ─── Header row: title + summary pills + controls ─────────── */}
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <h1
          className="text-[26px] tracking-[-0.025em]"
          style={{ fontFamily: "var(--font-serif)", fontWeight: 400 }}
        >
          Production plan
        </h1>
        <span className="text-[12px] text-muted-foreground">
          {totalBatches} batch{totalBatches === 1 ? "" : "es"} · {daySummary.length} day{daySummary.length === 1 ? "" : "s"}
        </span>
        {focusLabel && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#e3ebe6] text-[#2e4839] text-[11px] font-medium border border-[#c8d4cc]">
            Focus: {focusLabel}
            <button
              type="button"
              onClick={clearFocus}
              className="opacity-60 hover:opacity-100 leading-none text-[14px]"
              title="Clear focus filter"
            >
              ×
            </button>
          </span>
        )}
        {/* Focus picker — scope the calendar to one source. */}
        <select
          value={focusParam ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) router.push("/plan");
            else router.push(`/plan?focus=${encodeURIComponent(v)}`);
          }}
          className="text-[11.5px] rounded-full border border-border bg-card px-2.5 py-1 hover:border-foreground"
        >
          <option value="">Focus on…</option>
          {campaigns.length > 0 && (
            <optgroup label="Campaigns">
              {campaigns
                .filter((c) => c.status !== "done" && c.status !== "cancelled")
                .map((c) => (
                  <option key={c.id} value={`campaign:${c.name}`}>
                    {c.name}
                  </option>
                ))}
            </optgroup>
          )}
          {productionOrders.length > 0 && (
            <optgroup label="Production orders">
              {productionOrders
                .filter((po) => po.status !== "done" && po.status !== "cancelled")
                .map((po) => (
                  <option key={po.id} value={`po:${po.name ?? po.dueDate}`}>
                    {po.name ?? po.dueDate}
                  </option>
                ))}
            </optgroup>
          )}
          {orders.length > 0 && (
            <optgroup label="Orders">
              {orders
                .filter((o) => o.status === "pending" || o.status === "in_production")
                .slice(0, 50)
                .map((o) => (
                  <option key={o.id} value={`order:${o.id}`}>
                    {o.sourceRef ? `${o.sourceRef} · ` : ""}{o.customerName || o.eventName || "(unnamed)"}
                  </option>
                ))}
            </optgroup>
          )}
        </select>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {tightDays > 0 && (
            <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${LEVEL_PILL.warn}`}>
              {tightDays} tight day{tightDays === 1 ? "" : "s"}
            </span>
          )}
          {/* View toggle */}
          <div className="inline-flex items-center rounded-full border border-border bg-card overflow-hidden text-[11px]">
            {(["day", "week", "pivot", "month"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={
                  "px-3 py-1 transition-colors " +
                  (viewMode === m
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {m === "day" ? "Day" : m === "week" ? "Week" : m === "pivot" ? "Pivot" : "Month"}
              </button>
            ))}
          </div>
          <Link
            href="/plan/fillings"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[11px] text-foreground hover:border-foreground/30 transition-colors"
          >
            <Flame className="w-3 h-3" /> Filling cooking list
          </Link>
          <div className="flex flex-col items-end">
            <button
              onClick={handleRegenerate}
              disabled={regenerating || !configStatus.isComplete}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-3 py-1 text-[11px] font-medium disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${regenerating ? "animate-spin" : ""}`} />
              {regenerating ? "Regenerating…" : "Regenerate plan"}
            </button>
            <LastRegenLine />
          </div>
        </div>
      </div>

      {/* ─── Stale open production day(s) ─────────────────────────── */}
      {staleOpenDays.length > 0 && (
        <div className="mb-3 space-y-2">
          {staleOpenDays.map((d) => (
            <Banner
              key={d.id}
              tone="butter"
              icon={<AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
            >
              <div className="text-xs flex flex-wrap items-center gap-2 leading-snug">
                <span>
                  Production day for <strong>{d.date}</strong> is still open. Close it to carry unfinished steps forward.
                </span>
                <button
                  onClick={() => handleCloseStale(d.date)}
                  disabled={closingDate === d.date}
                  className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-3 py-1 text-[11px] font-medium disabled:opacity-50"
                >
                  {closingDate === d.date ? "Closing…" : "Close day"}
                </button>
              </div>
            </Banner>
          ))}
        </div>
      )}

      {/* ─── Pre-flight + result banners ─────────────────────────── */}
      <div className="space-y-2 mb-4">
        {!configStatus.isComplete && (
          <Banner tone="butter" icon={<AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}>
            <p className="text-xs leading-snug">
              Capacity config incomplete: {configStatus.missing.join(", ")}.{" "}
              <Link href="/settings" className="underline-offset-2 hover:underline font-medium">Go to Settings</Link>.
            </p>
          </Banner>
        )}
        {productionSteps.length === 0 && (
          <Banner tone="butter" icon={<AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}>
            <p className="text-xs leading-snug">
              No production steps defined. Add them under{" "}
              <Link href="/settings" className="underline-offset-2 hover:underline font-medium">Settings → Production Steps</Link>.
            </p>
          </Banner>
        )}
        {lastResult && (
          <Banner tone="mint" icon={<CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />}>
            <p className="text-xs leading-snug">
              Plan regenerated: {lastResult.count} batch-day line item{lastResult.count !== 1 ? "s" : ""} saved.
            </p>
          </Banner>
        )}
        {regenerateError && (
          <Banner tone="blush" icon={<AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}>
            <div className="text-xs">
              <p className="font-semibold leading-snug">Regenerate failed — existing plan preserved.</p>
              <p className="mt-0.5 opacity-90 leading-snug">{regenerateError}</p>
            </div>
          </Banner>
        )}
        {lastResult && lastResult.warnings.length > 0 && (
          <GroupedWarnings warnings={lastResult.warnings} />
        )}
      </div>

      {/* ─── Demand by urgency — minimum-must-do view per order. ─── */}
      <DemandByUrgency
        orders={orders}
        orderItems={orderItems}
        products={products}
        productLocationTotals={productLocationTotals}
        orderPlanLinks={orderPlanLinks}
      />

      {/* ─── Scheduled · 14 days — multi-select source filter. ────── */}
      <ScheduledPanel
        plans={plans}
        lineItems={lineItems}
        productionDays={productionDays}
        orders={orders}
        orderItems={orderItems}
        orderPlanLinks={orderPlanLinks}
        focusTokens={focusTokens}
        toggleFocusToken={toggleFocusToken}
      />

      {/* ─── Calendar — one card per scheduled day ───────────────── */}
      {daySummary.length === 0 ? (
        <div className={`${CARD} text-center py-10`}>
          <p className="text-sm text-muted-foreground">
            No plan saved yet. Click <span className="font-medium text-foreground">Regenerate plan</span> to compute one from your open orders.
          </p>
        </div>
      ) : viewMode === "week" ? (
        <WeekView
          daySummary={daySummary}
          lineItems={visibleLineItems}
          dayById={dayById}
          orderedSteps={orderedSteps}
          planMap={planMap}
          planProductsByPlan={planProductsByPlan}
          productMap={productMap}
          batchOrderRef={batchOrderRef}
          stepDoneFor={stepDoneFor}
          expandedSections={expandedSections}
          toggleSection={toggleSection}
          expandedProducts={expandedProducts}
          toggleProduct={toggleProduct}
          expandedCategories={expandedCategories}
          toggleCategory={toggleCategory}
          categoryNameById={categoryNameById}
          orderPlanLinks={orderPlanLinks}
          orderItems={orderItems}
          orders={orders}
          focusTokens={focusTokens}
          doneKeysByPlan={doneKeysByPlan}
        />
      ) : viewMode === "pivot" ? (
        <PivotView
          plans={plans}
          lineItems={visibleLineItems}
          productionDays={productionDays}
          orderedSteps={orderedSteps}
          planProductsByPlan={planProductsByPlan}
          productMap={productMap}
          orderPlanLinks={orderPlanLinks}
          orderItems={orderItems}
          orders={orders}
          campaigns={campaigns}
          doneKeysByPlan={doneKeysByPlan}
          focusTokens={focusTokens}
        />
      ) : viewMode === "month" ? (
        <MonthView
          plans={plans}
          lineItems={visibleLineItems}
          productionDays={productionDays}
          orderedSteps={orderedSteps}
          planProductsByPlan={planProductsByPlan}
          productMap={productMap}
          orderPlanLinks={orderPlanLinks}
          orderItems={orderItems}
          orders={orders}
          campaigns={campaigns}
          doneKeysByPlan={doneKeysByPlan}
          focusTokens={focusTokens}
          blockedDays={blockedDays}
          config={config}
        />
      ) : (
        <div className="space-y-3">
          {(() => {
            // Hide past-dated rows EXCEPT those still carrying live
            // batches (active and not yet completed). Yesterday's
            // batch that didn't finish stays visible — labelled
            // "carrying over" via the row's natural date label —
            // until it's marked done or rescheduled.
            const todayIso = new Date().toISOString().slice(0, 10);
            return daySummary.filter((d) => {
              if (d.day.date >= todayIso) return true;
              const dayLineItems = lineItems.filter((li) => li.productionDayId === d.day.id);
              const hasLiveBatch = dayLineItems.some((li) => {
                const plan = planMap.get(li.planId);
                return plan && plan.status !== "done" && plan.status !== "cancelled" && !plan.completedAt;
              });
              return hasLiveBatch;
            });
          })().map((row) => {
            const dayLineItems = visibleLineItems
              .filter((li) => li.productionDayId === row.day.id)
              .sort((a, b) => a.sortOrder - b.sortOrder);
            // One pipeline row per unique plan (batch), not per line item.
            const seenPlans = new Set<string>();
            const uniquePlans: typeof dayLineItems = [];
            for (const li of dayLineItems) {
              if (seenPlans.has(li.planId)) continue;
              seenPlans.add(li.planId);
              uniquePlans.push(li);
            }
            const totalMinutes = dayLineItems.reduce((s, li) => s + li.plannedMinutes, 0);

            // Mould-pool reservation for this day: sum the number of
            // mould instances each scheduled batch needs. Compare to
            // total moulds Manuela physically owns across the workshop.
            // When reserved > owned → the day requires sequencing
            // (run first N, unmould, refill the pool, run rest).
            const reservedByMould = new Map<string, number>();
            for (const planId of seenPlans) {
              const pps = planProductsByPlan.get(planId) ?? [];
              for (const pp of pps) {
                if (!pp.mouldId) continue;
                reservedByMould.set(
                  pp.mouldId,
                  (reservedByMould.get(pp.mouldId) ?? 0) + pp.quantity,
                );
              }
            }
            // Per-mould-type breakdown sorted by tightest first.
            const mouldUsage = [...reservedByMould.entries()]
              .map(([mouldId, used]) => {
                const m = mouldMap.get(mouldId);
                const owned = Math.max(1, m?.quantityOwned ?? 1);
                return {
                  mouldId,
                  name: m?.name ?? "—",
                  used,
                  owned,
                  short: used > owned,
                };
              })
              .sort((a, b) => (b.short === a.short ? b.used - a.used : b.short ? 1 : -1));
            const tightCount = mouldUsage.filter((m) => m.short).length;

            return (
              <section key={row.day.id} id={`day-${row.day.date}`} className={`${CARD} !p-5 scroll-mt-4`}>
                {/* Day header: date, util pill, capacity bar */}
                <div className="flex flex-wrap items-baseline gap-3 mb-4">
                  <h2
                    className="text-[24px] tracking-[-0.025em]"
                    style={{ fontFamily: "var(--font-serif)", fontWeight: 400, letterSpacing: "-0.02em" }}
                  >
                    {formatDayLabel(row.day.date)}
                  </h2>
                  <span className="text-[12px] text-muted-foreground">
                    {row.batchCount} batch{row.batchCount === 1 ? "" : "es"} · {row.usedMinutes} / {row.availableMinutes} min
                  </span>
                  <span className={`ml-auto rounded-full px-3 py-0.5 text-[11px] font-medium ${LEVEL_PILL[row.level]}`}>
                    {row.level === "over" ? "over capacity" : `${row.utilisationPercent}%`}
                  </span>
                </div>

                {/* Mould-pool readout — total reserved vs owned, plus a
                    "phase needed" pill when any single mould type is
                    over-booked. Click to expand the per-mould list. */}
                {mouldUsage.length > 0 && (
                  <MouldPoolReadout
                    tightCount={tightCount}
                    mouldUsage={mouldUsage}
                  />
                )}

                {/* Capacity bar */}
                <div className={`h-1 rounded-full bg-border overflow-hidden mb-3 ${LEVEL_TINT[row.level]}`}>
                  <i
                    className="block h-full"
                    style={{
                      width: `${Math.min(100, row.utilisationPercent)}%`,
                      background: LEVEL_BAR[row.level],
                    }}
                  />
                </div>

                {/* Per-day workload grouped by which step is scheduled
                    THAT day for each batch. A batch on day X for steps
                    [polish, paint] appears in both Polish and Paint
                    sections. Reads as a per-step workload for the day. */}
                {(() => {
                  type BatchEntry = {
                    planId: string;
                    planName: string;
                    batchNumber?: string;
                    mouldCount: number;
                    orderRef?: string;
                    plannedMinutes: number;
                    lineItemId: string;
                  };
                  type Group = {
                    productId: string;
                    productName: string;
                    batches: BatchEntry[];
                  };
                  // Helper: build a group entry from a line item.
                  function buildEntry(li: typeof dayLineItems[number]): { productId: string; productName: string; entry: BatchEntry } | null {
                    const plan = planMap.get(li.planId);
                    const pps = planProductsByPlan.get(li.planId) ?? [];
                    if (pps.length === 0) return null;
                    const orderRef = batchOrderRef.get(li.planId)?.ref;
                    const primary = pps[0];
                    const productId = pps.length === 1
                      ? primary.productId
                      : `_mixed:${li.planId}`;
                    const productName = pps.length === 1
                      ? productMap.get(primary.productId)?.name ?? primary.productId
                      : `Mixed (${pps.length} products)`;
                    const mouldCount = pps.reduce((s, pp) => s + pp.quantity, 0);
                    return {
                      productId,
                      productName,
                      entry: {
                        planId: li.planId,
                        planName: plan?.name ?? "Batch",
                        batchNumber: plan?.batchNumber,
                        mouldCount,
                        orderRef,
                        plannedMinutes: li.plannedMinutes,
                        lineItemId: li.id ?? `${li.productionDayId}-${li.planId}`,
                      },
                    };
                  }

                  // Bucket batches by every stepId scheduled for THIS day.
                  // Skip steps whose phase is already ticked done for the
                  // plan — same filter the week + pivot views use, so all
                  // three render the same set of pending work and a tick
                  // on /production immediately removes the step here too.
                  type StepBucket = { stepId: string; stepName: string; productType: string; sortOrder: number; groups: Map<string, Group> };
                  const stepBuckets = new Map<string, StepBucket>();
                  for (const li of dayLineItems) {
                    const built = buildEntry(li);
                    if (!built) continue;
                    const stepIds = li.stepIds.length > 0 ? li.stepIds : [];
                    if (stepIds.length === 0) continue;
                    for (const stepId of stepIds) {
                      const stepRow = orderedSteps.find((s) => s.id === stepId);
                      if (!stepRow) continue;
                      if (planStepIsDone(stepRow.name, li.planId, doneKeysByPlan)) continue;
                      const bucket = stepBuckets.get(stepId) ?? {
                        stepId,
                        stepName: stepRow.name,
                        productType: stepRow.productType,
                        sortOrder: stepRow.sortOrder ?? 0,
                        groups: new Map<string, Group>(),
                      };
                      const g = bucket.groups.get(built.productId) ?? {
                        productId: built.productId,
                        productName: built.productName,
                        batches: [],
                      };
                      g.batches.push(built.entry);
                      bucket.groups.set(built.productId, g);
                      stepBuckets.set(stepId, bucket);
                    }
                  }
                  if (stepBuckets.size === 0) {
                    return (
                      <p className="text-[12px] text-muted-foreground italic px-3 py-2">
                        No batches scheduled — products may be missing default moulds.
                      </p>
                    );
                  }
                  const orderedBuckets = [...stepBuckets.values()].sort((a, b) => a.sortOrder - b.sortOrder);

                  // v6 layout B — surfaces are white-glass; phase identity
                  // lives only in `ink` (small text + a 3px left stripe on
                  // chip cards). Old gradient-wash bg retired.
                  function tintFor(stepName: string): { bg: string; ink: string } {
                    const n = stepName.toLowerCase();
                    const surface = "rgba(255,255,255,0.65)";
                    if (n.includes("polish"))   return { bg: surface, ink: "#8a7030" };
                    if (n.includes("paint") || n.includes("colour") || n.includes("color"))
                                                return { bg: surface, ink: "#9b4f48" };
                    if (n.includes("shell") || n.includes("temper"))
                                                return { bg: surface, ink: "#9a6640" };
                    if (n.includes("prep"))     return { bg: surface, ink: "#6a4d89" };
                    if (n.includes("fill"))     return { bg: surface, ink: "#4b6b8f" };
                    if (n.includes("cap"))      return { bg: surface, ink: "#5c7050" };
                    if (n.includes("unmould") || n.includes("unmold"))
                                                return { bg: surface, ink: "#4a7a5e" };
                    if (n.includes("pack"))     return { bg: surface, ink: "#9a6640" };
                    return { bg: surface, ink: "#1c1d1f" };
                  }

                  // Mega-grouping: when a step name (e.g. "Polishing")
                  // appears multiple times because the workshop defines
                  // it per category (one Polishing step row per
                  // moulded / bars / filled-bars category), roll the
                  // siblings under a single outer toggle. Click the
                  // mega toggle → reveals the per-category step rows;
                  // click each → reveals the products / batches.
                  const megaGroups = new Map<string, typeof orderedBuckets>();
                  for (const b of orderedBuckets) {
                    const arr = megaGroups.get(b.stepName) ?? [];
                    arr.push(b);
                    megaGroups.set(b.stepName, arr);
                  }
                  const orderedMega = [...megaGroups.entries()]
                    .map(([name, list]) => ({ name, list }))
                    .sort((a, b) => a.list[0].sortOrder - b.list[0].sortOrder);

                  function renderStepSection(bucket: StepBucket, opts?: { compactHeader?: boolean }) {
                    const tint = tintFor(bucket.stepName);
                    const groupsArr = [...bucket.groups.values()];
                    const totalMoulds = groupsArr.reduce(
                      (s, g) => s + g.batches.reduce((s2, b) => s2 + b.mouldCount, 0),
                      0,
                    );
                    const sectionKey = `${row.day.id}|${bucket.stepId}`;
                    const expanded = expandedSections.has(sectionKey);
                    // When rendered inside a mega-group, header reads
                    // just the category (e.g. "Moulded") since the
                    // outer toggle already names the step.
                    const headerLabel = opts?.compactHeader
                      ? (bucket.productType || bucket.stepName)
                      : bucket.stepName;
                    return (
                      <section
                        key={bucket.stepId}
                        className="rounded-[12px] p-3"
                        style={{ background: tint.bg }}
                      >
                            <button
                              type="button"
                              onClick={() => toggleSection(sectionKey)}
                              className="w-full flex items-baseline gap-2 mb-2 text-left transition hover:opacity-80"
                              style={{ color: tint.ink }}
                              aria-expanded={expanded}
                            >
                              <span className="text-[12px] opacity-70 shrink-0">
                                {expanded ? "▾" : "▸"}
                              </span>
                              <span
                                style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 15, letterSpacing: "-0.012em" }}
                              >
                                {headerLabel}
                              </span>
                              <span className="text-[10.5px] tabular-nums opacity-75">
                                {groupsArr.length} product{groupsArr.length === 1 ? "" : "s"} · {totalMoulds} mould{totalMoulds === 1 ? "" : "s"}
                              </span>
                            </button>
                            {expanded && (() => {
                              // Partition groups by product category. When a step
                              // spans >1 category (e.g. Shelling for moulded +
                              // bars + filled bars), render an extra category
                              // layer; otherwise drop straight to product list.
                              type Cat = { catId: string; catName: string; groups: typeof groupsArr };
                              const byCat = new Map<string, Cat>();
                              for (const g of groupsArr) {
                                const prod = productMap.get(g.productId);
                                const catId = prod?.productCategoryId ?? "_uncat";
                                const catName = catId === "_uncat"
                                  ? "Uncategorised"
                                  : (categoryNameById.get(catId) ?? catId);
                                const e = byCat.get(catId) ?? { catId, catName, groups: [] };
                                e.groups.push(g);
                                byCat.set(catId, e);
                              }

                              function renderProductsList(groups: typeof groupsArr) {
                                if (groups.length === 1) {
                                  return (
                                    <BatchGroupRow
                                      key={groups[0].productId}
                                      group={groups[0]}
                                      orderedSteps={orderedSteps}
                                      stepDoneFor={stepDoneFor}
                                      dayLineItems={dayLineItems}
                                    />
                                  );
                                }
                                return groups
                                  .slice()
                                  .sort((a, b) => a.productName.localeCompare(b.productName))
                                  .map((g) => {
                                    const productKey = `${row.day.id}|${bucket.stepId}|${g.productId}`;
                                    const expanded = expandedProducts.has(productKey);
                                    const gMoulds = g.batches.reduce((s, b) => s + b.mouldCount, 0);
                                    return (
                                      <li
                                        key={g.productId}
                                        className="rounded-[10px] overflow-hidden bg-white/40 border border-white/55"
                                      >
                                        <button
                                          type="button"
                                          onClick={() => toggleProduct(productKey)}
                                          className="w-full flex items-baseline gap-2 px-3 py-1.5 text-left transition hover:opacity-90"
                                          aria-expanded={expanded}
                                        >
                                          <span className="opacity-60 text-[11px] shrink-0">
                                            {expanded ? "▾" : "▸"}
                                          </span>
                                          <span
                                            className="flex-1 min-w-0 truncate"
                                            style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 14, letterSpacing: "-0.012em" }}
                                          >
                                            {g.productName}
                                          </span>
                                          <span className="text-[10.5px] tabular-nums opacity-70 shrink-0">
                                            {g.batches.length} batch{g.batches.length === 1 ? "" : "es"} · {gMoulds} mould{gMoulds === 1 ? "" : "s"}
                                          </span>
                                        </button>
                                        {expanded && (
                                          <ul className="space-y-1.5 px-2 pb-2">
                                            <BatchGroupRow
                                              group={g}
                                              orderedSteps={orderedSteps}
                                              stepDoneFor={stepDoneFor}
                                              dayLineItems={dayLineItems}
                                            />
                                          </ul>
                                        )}
                                      </li>
                                    );
                                  });
                              }

                              if (byCat.size <= 1) {
                                return (
                                  <ul className="space-y-1.5">
                                    {renderProductsList(groupsArr)}
                                  </ul>
                                );
                              }

                              const cats = [...byCat.values()].sort((a, b) => a.catName.localeCompare(b.catName));
                              return (
                                <ul className="space-y-1.5">
                                  {cats.map((c) => {
                                    const catKey = `${row.day.id}|${bucket.stepId}|cat:${c.catId}`;
                                    const expanded = expandedCategories.has(catKey);
                                    const cMoulds = c.groups.reduce(
                                      (s, g) => s + g.batches.reduce((s2, b) => s2 + b.mouldCount, 0),
                                      0,
                                    );
                                    return (
                                      <li
                                        key={c.catId}
                                        className="rounded-[10px] overflow-hidden bg-white/30 border border-white/55"
                                      >
                                        <button
                                          type="button"
                                          onClick={() => toggleCategory(catKey)}
                                          className="w-full flex items-baseline gap-2 px-3 py-1.5 text-left transition hover:opacity-90"
                                          aria-expanded={expanded}
                                        >
                                          <span className="opacity-60 text-[11px] shrink-0">
                                            {expanded ? "▾" : "▸"}
                                          </span>
                                          <span
                                            className="flex-1 min-w-0 truncate capitalize"
                                            style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 14, letterSpacing: "-0.012em" }}
                                          >
                                            {bucket.stepName} — {c.catName}
                                          </span>
                                          <span className="text-[10.5px] tabular-nums opacity-70 shrink-0">
                                            {c.groups.length} product{c.groups.length === 1 ? "" : "s"} · {cMoulds} mould{cMoulds === 1 ? "" : "s"}
                                          </span>
                                        </button>
                                        {expanded && (
                                          <ul className="space-y-1.5 px-2 pb-2">
                                            {renderProductsList(c.groups)}
                                          </ul>
                                        )}
                                      </li>
                                    );
                                  })}
                                </ul>
                              );
                            })()}
                          </section>
                        );
                  }

                  return (
                    <div className="columns-1 md:columns-2 xl:columns-3 gap-3 [&>section]:break-inside-avoid [&>section]:mb-3">
                      {orderedMega.map(({ name, list }) => {
                        if (list.length === 1) {
                          return renderStepSection(list[0]);
                        }
                        // Multiple step rows share this name → wrap in a
                        // single outer toggle. Inner step sections use
                        // compact (category-only) headers.
                        const tint = tintFor(name);
                        const megaKey = `${row.day.id}|stepname:${name}`;
                        const megaExpanded = expandedSections.has(megaKey);
                        const totalMoulds = list.reduce(
                          (s, b) => s + [...b.groups.values()]
                            .reduce((s2, g) => s2 + g.batches.reduce((s3, x) => s3 + x.mouldCount, 0), 0),
                          0,
                        );
                        const totalProducts = list.reduce(
                          (s, b) => s + b.groups.size, 0,
                        );
                        return (
                          <section
                            key={`mega:${name}`}
                            className="rounded-[12px] p-3"
                            style={{ background: tint.bg }}
                          >
                            <button
                              type="button"
                              onClick={() => toggleSection(megaKey)}
                              className="w-full flex items-baseline gap-2 mb-2 text-left transition hover:opacity-80"
                              style={{ color: tint.ink }}
                              aria-expanded={megaExpanded}
                            >
                              <span className="text-[12px] opacity-70 shrink-0">
                                {megaExpanded ? "▾" : "▸"}
                              </span>
                              <span
                                style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 15, letterSpacing: "-0.012em" }}
                              >
                                {name}
                              </span>
                              <span className="text-[10.5px] tabular-nums opacity-75">
                                {list.length} categor{list.length === 1 ? "y" : "ies"} · {totalProducts} product{totalProducts === 1 ? "" : "s"} · {totalMoulds} mould{totalMoulds === 1 ? "" : "s"}
                              </span>
                            </button>
                            {megaExpanded && (
                              <div className="space-y-2">
                                {list.map((b) => renderStepSection(b, { compactHeader: true }))}
                              </div>
                            )}
                          </section>
                        );
                      })}
                    </div>
                  );
                })()}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Week view ──────────────────────────────────────────────────────

/** 7-column weekly grid (Mon–Sun) of the week containing today.
 *  Each column = one day's step buckets stacked. Closed/non-scheduled
 *  days are hatched empty cells. Reuses the same step-bucket logic
 *  + collapse state as the day view, so toggling a step in week
 *  view stays toggled when the user switches back to day view. */
function WeekView(props: {
  daySummary: ReturnType<typeof Array<unknown>>;
  lineItems: import("@/types").ProductionDayLineItem[];
  dayById: Map<string, import("@/types").ProductionDay>;
  orderedSteps: import("@/types").ProductionStep[];
  planMap: Map<string, import("@/types").ProductionPlan>;
  planProductsByPlan: Map<string, import("@/types").PlanProduct[]>;
  productMap: Map<string, { name: string; productCategoryId?: string }>;
  batchOrderRef: Map<string, { ref: string; deadline: string }>;
  stepDoneFor: (planId: string, stepId: string) => boolean;
  expandedSections: Set<string>;
  toggleSection: (key: string) => void;
  expandedProducts: Set<string>;
  toggleProduct: (key: string) => void;
  expandedCategories: Set<string>;
  toggleCategory: (key: string) => void;
  categoryNameById: Map<string, string>;
  orderPlanLinks: import("@/types").OrderPlanLink[];
  orderItems: import("@/types").OrderItem[];
  orders: import("@/types").Order[];
  focusTokens: string[];
  doneKeysByPlan: Map<string, Set<string>>;
}) {
  const {
    daySummary, lineItems, dayById, orderedSteps, planMap, planProductsByPlan,
    productMap, batchOrderRef, stepDoneFor,
    expandedSections, toggleSection, expandedProducts, toggleProduct,
    expandedCategories, toggleCategory, categoryNameById,
    orderPlanLinks, orderItems, orders, focusTokens, doneKeysByPlan,
  } = props;

  // Map a productionStep.name to the semantic phase key the wizard
  // writes ("polishing", "colour", etc) so we can prefix-match the
  // doneKeysByPlan set built upstream from planStepStatus rows.
  function phaseKeyForStepName(name: string): string | null {
    const n = (name ?? "").toLowerCase().trim();
    if (n.includes("polish")) return "polishing";
    if (n.includes("paint") || n.includes("colour") || n.includes("color")) return "colour";
    if (n.includes("shell") || n.includes("temper")) return "shell";
    if (n.includes("filling prep") || n === "prep" || n.startsWith("prep")) return "filling";
    if (n.includes("fill")) return "fill";
    if (n.includes("cap")) return "cap";
    if (n.includes("unmould") || n.includes("unmold")) return "unmould";
    if (n.includes("pack")) return "packing";
    return null;
  }
  function isStepDoneForPlan(stepName: string, planId: string): boolean {
    const phase = phaseKeyForStepName(stepName);
    if (!phase) return false;
    const set = doneKeysByPlan.get(planId);
    if (!set) return false;
    for (const k of set) {
      if (k === phase || k.startsWith(`${phase}-`)) return true;
    }
    return false;
  }
  type DaySummaryEntry = (typeof daySummary)[number] & { day: { id: string; date: string }; level: string; usedMinutes: number; availableMinutes: number; utilisationPercent: number; batchCount: number };

  // Pending drop the user is confirming. label = human-friendly text
  // shown in the modal. When `stepIds` is set, the drop only moves
  // those specific steps for those plans (step-level migration).
  // When absent, the drop moves the whole plan(s).
  const [pendingDrop, setPendingDrop] = useState<
    | { planIds: string[]; targetDate: string; label: string; sourceDate: string; stepIds?: string[] }
    | null
  >(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(e: DragEndEvent) {
    if (!e.over) return;
    const overId = String(e.over.id);
    if (!overId.startsWith("day:")) return;
    const targetDate = overId.slice(4);
    const data = e.active.data.current as
      | { planIds: string[]; label: string; sourceDate: string; stepIds?: string[] }
      | undefined;
    if (!data || data.planIds.length === 0) return;
    if (data.sourceDate === targetDate) return;
    setPendingDrop({ ...data, targetDate });
  }

  async function applyDrop(pin: boolean) {
    if (!pendingDrop) return;
    try {
      if (pendingDrop.stepIds && pendingDrop.stepIds.length > 0) {
        // Step-level move: only the dragged step migrates, plan's other
        // steps stay where they are. Locking is plan-level today, so
        // applying a "lock" on a step-only drop pins the WHOLE plan to
        // the target date — call out in the modal label.
        const moves: Array<{ planId: string; stepId: string }> = [];
        for (const planId of pendingDrop.planIds) {
          for (const stepId of pendingDrop.stepIds) {
            moves.push({ planId, stepId });
          }
        }
        await moveProductionStepsToDate({ moves, targetDate: pendingDrop.targetDate });
        if (pin) {
          await pinProductionPlans(pendingDrop.planIds, pendingDrop.targetDate);
        }
      } else {
        await moveProductionPlansToDate({
          planIds: pendingDrop.planIds,
          targetDate: pendingDrop.targetDate,
          pin,
        });
      }
    } catch (err) {
      console.error("[week] move failed:", err);
      alert(`Move failed: ${formatError(err)}`);
    } finally {
      setPendingDrop(null);
    }
  }

  // Anchor week start (Mon) of week containing today. Render TWO weeks
  // (current + next) so a 14-day rolling window is visible at once.
  const today = new Date();
  const dow = today.getDay() === 0 ? 7 : today.getDay(); // Sun=7
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow - 1));
  function buildWeek(offsetDays: number) {
    const out: { date: string; label: string; iso: string }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + offsetDays + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const label = d.toLocaleDateString("de-AT", { weekday: "short" });
      out.push({ date: iso, label, iso });
    }
    return out;
  }
  // Row 1 = current week, but trim past days. We keep yesterday for
  // "what was scheduled but didn't run" awareness, and drop everything
  // older. Past slots render as blank placeholders so the day-of-week
  // columns stay aligned with row 2 (next week).
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const earliestVisibleIso = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
  const week1Full = buildWeek(0);
  const week1 = week1Full.filter((d) => d.date >= earliestVisibleIso);
  const week2 = buildWeek(7);
  const allDays = [...week1, ...week2];

  const summaryByDate = new Map<string, DaySummaryEntry>();
  for (const ds of daySummary as DaySummaryEntry[]) {
    summaryByDate.set(ds.day.date, ds);
  }

  const PINK_INK = "#2e4839";
  const LEVEL_BAR_LOCAL: Record<string, string> = {
    ok: "#4a7a5e",
    warn: "#8a7030",
    critical: PINK_INK,
    over: PINK_INK,
  };

  // ── Drag/drop sub-components — local to WeekView so closures hold. ──

  function DayDrop({ date, children }: { date: string; children: React.ReactNode }) {
    const { isOver, setNodeRef } = useDroppable({ id: `day:${date}` });
    return (
      <div
        ref={setNodeRef}
        className={
          "transition rounded-[12px] " +
          (isOver ? "ring-2 ring-[#4a6b5b] ring-offset-1" : "")
        }
      >
        {children}
      </div>
    );
  }

  function DragHandle({
    id, payload, title,
  }: {
    id: string;
    payload: { planIds: string[]; label: string; sourceDate: string; stepIds?: string[] };
    title?: string;
  }) {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data: payload });
    return (
      <span
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        title={title ?? "Drag to move"}
        onClick={(e) => e.stopPropagation()}
        className={`shrink-0 px-1 select-none text-[11px] opacity-40 hover:opacity-90 ${isDragging ? "opacity-100" : ""}`}
        style={{ cursor: "grab", touchAction: "none" }}
      >
        ⋮⋮
      </span>
    );
  }

  function tintFor(stepName: string): { bg: string; ink: string } {
    const n = stepName.toLowerCase();
    if (n.includes("polish"))   return { bg: "#fdf8e2", ink: "#8a7030" };
    if (n.includes("paint") || n.includes("colour") || n.includes("color"))
                                return { bg: "#fdeeea", ink: "#9b4f48" };
    if (n.includes("shell") || n.includes("temper"))
                                return { bg: "#fdf1e2", ink: "#9a6640" };
    if (n.includes("prep"))     return { bg: "#f3eef6", ink: "#6a4d89" };
    if (n.includes("fill"))     return { bg: "#eff5fb", ink: "#4b6b8f" };
    if (n.includes("cap"))      return { bg: "#eff3ec", ink: "#5c7050" };
    if (n.includes("unmould") || n.includes("unmold"))
                                return { bg: "#f1faf4", ink: "#4a7a5e" };
    if (n.includes("pack"))     return { bg: "#fdf1e2", ink: "#9a6640" };
    return { bg: "rgba(245,243,239,0.7)", ink: "#1c1d1f" };
  }

  // ── Weekly stats over the visible 14-day window ──
  const visibleSummaries = allDays
    .map((d) => summaryByDate.get(d.date))
    .filter((x): x is DaySummaryEntry => !!x);
  const w1Summaries = week1.map((d) => summaryByDate.get(d.date)).filter((x): x is DaySummaryEntry => !!x);
  const w2Summaries = week2.map((d) => summaryByDate.get(d.date)).filter((x): x is DaySummaryEntry => !!x);
  const totalBatches = visibleSummaries.reduce((s, d) => s + d.batchCount, 0);
  const totalUsed = visibleSummaries.reduce((s, d) => s + d.usedMinutes, 0);
  const totalAvail = visibleSummaries.reduce((s, d) => s + d.availableMinutes, 0);
  const weekUtil = totalAvail > 0 ? Math.round((totalUsed / totalAvail) * 100) : 0;
  const tightDays = visibleSummaries.filter((d) => d.level === "warn" || d.level === "critical" || d.level === "over").length;
  const peakDay = visibleSummaries.slice().sort((a, b) => b.batchCount - a.batchCount)[0];
  const w1Batches = w1Summaries.reduce((s, d) => s + d.batchCount, 0);
  const w2Batches = w2Summaries.reduce((s, d) => s + d.batchCount, 0);

  function renderDayColumn(d: { date: string; label: string }) {
    const ds = summaryByDate.get(d.date);
    if (!ds) {
      return (
        <div key={d.date} className="flex flex-col gap-1 min-w-0">
          <div className="px-1 pt-1 pb-1.5 flex items-baseline gap-1">
            <h3 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 14 }}>
              {d.label}
            </h3>
            <span className="text-[10.5px] text-muted-foreground tabular-nums">
              {d.date.slice(8, 10)}.{d.date.slice(5, 7)}.
            </span>
          </div>
          <DayDrop date={d.date}>
            <div
              className="rounded-[12px] border border-dashed border-border text-center py-4 text-[10.5px] text-muted-foreground"
              style={{
                backgroundImage: "repeating-linear-gradient(45deg, rgba(0,0,0,0.02), rgba(0,0,0,0.02) 6px, rgba(0,0,0,0.04) 6px, rgba(0,0,0,0.04) 12px)",
              }}
            >
              closed
            </div>
          </DayDrop>
        </div>
      );
    }
    return (
      <DayDrop key={d.date} date={d.date}>
        {renderActiveDayColumn(d, ds)}
      </DayDrop>
    );
  }

  return (
    <div>
      {/* Weekly stats — replaces the old per-day strip; numbers cover
          the full 14-day visible window. */}
      <div className="rounded-[18px] border border-white/60 bg-white/55 backdrop-blur-2xl shadow-[0_1px_2px_rgba(16,18,24,0.04),0_8px_24px_rgba(16,18,24,0.05)] p-4 mb-3 grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div>
          <p className="text-[10px] uppercase text-muted-foreground" style={{ letterSpacing: "0.12em" }}>
            Window
          </p>
          <p className="mt-1" style={{ fontFamily: "var(--font-serif)", fontSize: 18, fontWeight: 500, letterSpacing: "-0.012em" }}>
            14 days
          </p>
          <p className="text-[10.5px] text-muted-foreground tabular-nums">
            {week1[0].date.slice(8, 10)}.{week1[0].date.slice(5, 7)} – {week2[6].date.slice(8, 10)}.{week2[6].date.slice(5, 7)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground" style={{ letterSpacing: "0.12em" }}>
            Batches
          </p>
          <p className="mt-1 tabular-nums" style={{ fontFamily: "var(--font-serif)", fontSize: 22, fontWeight: 500, lineHeight: 1.05, letterSpacing: "-0.012em" }}>
            {totalBatches}
          </p>
          <p className="text-[10.5px] text-muted-foreground tabular-nums">
            wk1 {w1Batches} · wk2 {w2Batches}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground" style={{ letterSpacing: "0.12em" }}>
            Capacity
          </p>
          <p className="mt-1 tabular-nums" style={{ fontFamily: "var(--font-serif)", fontSize: 22, fontWeight: 500, lineHeight: 1.05, letterSpacing: "-0.012em" }}>
            {weekUtil}%
          </p>
          <p className="text-[10.5px] text-muted-foreground tabular-nums">
            {totalUsed} / {totalAvail} min
          </p>
          <div className="h-[3px] rounded-sm mt-1 overflow-hidden" style={{ background: "rgba(0,0,0,0.05)" }}>
            <div style={{ width: `${Math.min(100, weekUtil)}%`, height: "100%", background: weekUtil >= 100 ? "#2e4839" : weekUtil >= 80 ? "#8a7030" : "#4a7a5e" }} />
          </div>
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground" style={{ letterSpacing: "0.12em" }}>
            Tight days
          </p>
          <p
            className="mt-1 tabular-nums"
            style={{
              fontFamily: "var(--font-serif)", fontSize: 22, fontWeight: 500, lineHeight: 1.05, letterSpacing: "-0.012em",
              color: tightDays > 0 ? "#9b4f48" : "#1c1d1f",
            }}
          >
            {tightDays}
          </p>
          <p className="text-[10.5px] text-muted-foreground">
            ≥ warn threshold
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground" style={{ letterSpacing: "0.12em" }}>
            Peak day
          </p>
          {peakDay ? (
            <>
              <p className="mt-1 tabular-nums" style={{ fontFamily: "var(--font-serif)", fontSize: 18, fontWeight: 500, lineHeight: 1.05, letterSpacing: "-0.012em" }}>
                {new Date(peakDay.day.date).toLocaleDateString("de-AT", { weekday: "short", day: "2-digit", month: "2-digit" })}
              </p>
              <p className="text-[10.5px] text-muted-foreground tabular-nums">
                {peakDay.batchCount} batches · {peakDay.utilisationPercent}%
              </p>
            </>
          ) : (
            <p className="mt-1 text-[12px] text-muted-foreground italic">no scheduled days</p>
          )}
        </div>
      </div>

      {/* Two-week grid wrapped in DnD context. Drag step / category /
          product / batch chips into another day → confirmation modal
          asks whether to lock placement. Row 1 keeps Mon–Sun columns
          but past days render as blank placeholders so the day-of-week
          alignment with row 2 (next week) is preserved. */}
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-7 gap-2 items-start mb-3">
          {week1Full.map((d) =>
            d.date < earliestVisibleIso
              ? <div key={`placeholder:${d.date}`} aria-hidden="true" />
              : renderDayColumn(d),
          )}
        </div>
        <div className="grid grid-cols-7 gap-2 items-start">
          {week2.map((d) => renderDayColumn(d))}
        </div>
      </DndContext>

      {/* Drop confirmation modal */}
      {pendingDrop && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setPendingDrop(null)}
        >
          <div
            className="rounded-[18px] border border-white/60 bg-white p-5 max-w-md w-full mx-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              className="text-[20px] mb-1"
              style={{ fontFamily: "var(--font-serif)", fontWeight: 500, letterSpacing: "-0.012em" }}
            >
              Move to {new Date(pendingDrop.targetDate).toLocaleDateString("de-AT", { weekday: "long", day: "2-digit", month: "2-digit" })}?
            </h3>
            <p className="text-[12.5px] text-muted-foreground mb-3">
              {pendingDrop.label} → {pendingDrop.planIds.length} batch{pendingDrop.planIds.length === 1 ? "" : "es"}
            </p>
            {(() => {
              // Show every order whose items are linked to the dragged
              // batches. If focus is on one order and the batch also
              // serves OTHER orders, surface them so Manuela knows the
              // move ripples beyond the focused source.
              const itemById = new Map(orderItems.map((it) => [it.id!, it]));
              const orderById = new Map(orders.map((o) => [o.id!, o]));
              const affected = new Map<string, { ref: string; deadline: string }>();
              for (const link of orderPlanLinks) {
                if (!pendingDrop.planIds.includes(link.planId)) continue;
                const item = itemById.get(link.orderItemId);
                if (!item) continue;
                const order = orderById.get(item.orderId);
                if (!order) continue;
                affected.set(order.id!, {
                  ref: order.sourceRef || order.customerName || order.eventName || order.id!.slice(0, 6),
                  deadline: order.deadline,
                });
              }
              const focusOrderIds = new Set(
                focusTokens
                  .filter((t) => t.startsWith("order:"))
                  .map((t) => t.slice("order:".length)),
              );
              const others = [...affected.entries()].filter(([oid]) => !focusOrderIds.has(oid));
              if (affected.size === 0) return null;
              return (
                <div className="rounded-[10px] border border-[#fdf8e2] bg-[#fef9e6] px-3 py-2 mb-4">
                  <p className="text-[11px] uppercase tracking-wider text-[#8a7030] font-medium mb-1">
                    Also affects {affected.size} order{affected.size === 1 ? "" : "s"}
                  </p>
                  <ul className="text-[11.5px] space-y-0.5">
                    {[...affected.entries()].map(([oid, o]) => {
                      const isOtherFocus = focusOrderIds.size > 0 && !focusOrderIds.has(oid);
                      return (
                        <li key={oid} className={isOtherFocus ? "text-[#9b4f48] font-medium" : ""}>
                          {o.ref}
                          {o.deadline && (
                            <span className="opacity-65 ml-1">
                              · due {new Date(o.deadline).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit" })}
                            </span>
                          )}
                          {isOtherFocus && <span className="ml-1 text-[10px]">⚠ outside focus</span>}
                        </li>
                      );
                    })}
                  </ul>
                  {others.length > 0 && focusOrderIds.size > 0 && (
                    <p className="text-[10.5px] text-[#9b4f48] mt-1.5">
                      ⚠ This batch also fulfils orders outside your current focus. Moving it shifts production for them too.
                    </p>
                  )}
                </div>
              );
            })()}
            <p className="text-[11.5px] text-muted-foreground mb-4">
              {pendingDrop.stepIds && pendingDrop.stepIds.length > 0
                ? "Step-only move — the batch's other steps stay on their current days. Locking pins the whole batch to the target date so regenerate respects the placement."
                : "Locking pins the batch to this date. Regenerate will respect the lock and not move it back."}
            </p>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => applyDrop(true)}
                className="rounded-full bg-[#4a6b5b] text-white px-4 py-1.5 text-[12px] font-medium inline-flex items-center gap-1.5 hover:bg-[#3d5b4d]"
              >
                <Lock className="w-3.5 h-3.5" /> Move + lock
              </button>
              <button
                onClick={() => applyDrop(false)}
                className="rounded-full bg-foreground text-background px-4 py-1.5 text-[12px] font-medium"
              >
                Move (unlocked)
              </button>
              <button
                onClick={() => setPendingDrop(null)}
                className="rounded-full border border-border px-4 py-1.5 text-[12px]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <span className="hidden">{stepDoneFor.toString().slice(0, 0)}{toggleCategory.toString().slice(0, 0)}{Array.from(expandedCategories).join("")}{Array.from(categoryNameById.keys()).join("")}{LEVEL_BAR_LOCAL.ok}</span>
    </div>
  );

  function renderActiveDayColumn(d: { date: string; label: string }, ds: DaySummaryEntry) {
    return (() => {
          // Build step buckets for this day, mirroring the day-view logic.
          type Group = { productId: string; productName: string; batches: Array<{ planId: string; planName: string; batchNumber?: string; mouldCount: number; orderRef?: string; plannedMinutes: number; lineItemId: string }> };
          type StepBucket = { stepId: string; stepName: string; productType: string; sortOrder: number; groups: Map<string, Group> };
          const dayLineItems = lineItems.filter((li) => li.productionDayId === ds.day.id);
          const stepBuckets = new Map<string, StepBucket>();
          for (const li of dayLineItems) {
            const pps = planProductsByPlan.get(li.planId) ?? [];
            if (pps.length === 0) continue;
            const plan = planMap.get(li.planId);
            const orderRef = batchOrderRef.get(li.planId)?.ref;
            const primary = pps[0];
            const productId = pps.length === 1 ? primary.productId : `_mixed:${li.planId}`;
            const productName = pps.length === 1
              ? productMap.get(primary.productId)?.name ?? primary.productId
              : `Mixed (${pps.length} products)`;
            const mouldCount = pps.reduce((s, pp) => s + pp.quantity, 0);
            const entry = {
              planId: li.planId,
              planName: plan?.name ?? "Batch",
              batchNumber: plan?.batchNumber,
              mouldCount,
              orderRef,
              plannedMinutes: li.plannedMinutes,
              lineItemId: li.id ?? `${li.productionDayId}-${li.planId}`,
            };
            for (const stepId of li.stepIds ?? []) {
              const stepRow = orderedSteps.find((s) => s.id === stepId);
              if (!stepRow) continue;
              // Skip already-completed (planId, step) pairs so the
              // week view shows only outstanding work. Match phase
              // keys via the productionStep name; the wizard ticks
              // semantic keys ("polishing-<ppId>") which we'd never
              // match on stepId UUID otherwise.
              if (isStepDoneForPlan(stepRow.name, li.planId)) continue;
              const bucket = stepBuckets.get(stepId) ?? {
                stepId,
                stepName: stepRow.name,
                productType: stepRow.productType,
                sortOrder: stepRow.sortOrder ?? 0,
                groups: new Map<string, Group>(),
              };
              const g = bucket.groups.get(productId) ?? { productId, productName, batches: [] };
              g.batches.push(entry);
              bucket.groups.set(productId, g);
              stepBuckets.set(stepId, bucket);
            }
          }
          const orderedBuckets = [...stepBuckets.values()].sort((a, b) => a.sortOrder - b.sortOrder);

          // Mega-group by stepName (e.g. roll the 3 Polishings).
          const megaGroups = new Map<string, StepBucket[]>();
          for (const b of orderedBuckets) {
            const arr = megaGroups.get(b.stepName) ?? [];
            arr.push(b);
            megaGroups.set(b.stepName, arr);
          }
          const orderedMega = [...megaGroups.entries()]
            .map(([name, list]) => ({ name, list }))
            .sort((a, b) => a.list[0].sortOrder - b.list[0].sortOrder);

          return (
            <div key={d.date} className="flex flex-col gap-1 min-w-0">
              <div className="px-1 pt-1 pb-1.5 flex items-baseline gap-1">
                <h3 style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 14 }}>
                  {d.label}
                </h3>
                <span className="text-[10.5px] text-muted-foreground tabular-nums">
                  {d.date.slice(8, 10)}.{d.date.slice(5, 7)}.
                </span>
                <span
                  className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full"
                  style={{
                    background: ds.level === "ok" ? "#f1faf4" : ds.level === "warn" ? "#fdf8e2" : "#fdeeea",
                    color: LEVEL_BAR_LOCAL[ds.level],
                  }}
                >
                  {ds.utilisationPercent}%
                </span>
              </div>

              <div className="rounded-[12px] border border-white/60 bg-white/55 p-2 space-y-1.5 min-h-[60px]">
                {orderedMega.length === 0 ? (
                  <p className="text-[10.5px] text-muted-foreground italic px-1 py-2 text-center">
                    No batches
                  </p>
                ) : (
                  orderedMega.map(({ name, list }) => {
                    if (list.length === 1) {
                      const b = list[0];
                      const tint = tintFor(b.stepName);
                      const groupsArr = [...b.groups.values()];
                      const totalMoulds = groupsArr.reduce(
                        (s, g) => s + g.batches.reduce((s2, x) => s2 + x.mouldCount, 0),
                        0,
                      );
                      const sectionKey = `${ds.day.id}|${b.stepId}`;
                      const expanded = expandedSections.has(sectionKey);
                      const stepPlanIds = [...new Set(groupsArr.flatMap((g) => g.batches.map((bb) => bb.planId)))];
                      return (
                        <div key={b.stepId} className="rounded-[8px] px-2 py-1" style={{ background: tint.bg, color: tint.ink, borderLeft: `3px solid ${tint.ink}` }}>
                          <div className="w-full flex items-baseline gap-1.5">
                            <DragHandle
                              id={`step:${ds.day.id}:${b.stepId}`}
                              payload={{
                                planIds: stepPlanIds,
                                stepIds: [b.stepId],
                                label: `${b.stepName} · ${stepPlanIds.length} batch${stepPlanIds.length === 1 ? "" : "es"} · step only`,
                                sourceDate: d.date,
                              }}
                              title="Drag step to move only this step (other steps stay)"
                            />
                            <button
                              type="button"
                              onClick={() => toggleSection(sectionKey)}
                              className="flex-1 min-w-0 flex items-baseline gap-1.5 text-left"
                            >
                              <span className="text-[10px] opacity-70">{expanded ? "▾" : "▸"}</span>
                              <span className="truncate" style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 12 }}>
                                {b.stepName}
                              </span>
                              <span className="ml-auto text-[10px] tabular-nums opacity-75 shrink-0">
                                {groupsArr.length}·{totalMoulds}m
                              </span>
                            </button>
                            {(() => {
                              const allPinned = stepPlanIds.every((pid) => !!planMap.get(pid)?.pinnedDate);
                              return (
                                <button
                                  type="button"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    try {
                                      if (allPinned) {
                                        for (const pid of stepPlanIds) await unpinProductionPlan(pid);
                                      } else {
                                        await pinProductionPlans(stepPlanIds);
                                      }
                                    } catch (err) {
                                      alert(err instanceof Error ? err.message : "Toggle failed");
                                    }
                                  }}
                                  title={allPinned ? "Unlock all batches in this step" : "Lock all batches in this step to current day"}
                                  className={allPinned ? "text-[#2e4839] hover:opacity-70" : "opacity-60 hover:opacity-100"}
                                >
                                  <Lock className="w-3 h-3" />
                                </button>
                              );
                            })()}
                          </div>
                          {expanded && (
                            <ul className="mt-1.5 space-y-1">
                              {groupsArr.map((g) => {
                                const productKey = `${ds.day.id}|${b.stepId}|${g.productId}`;
                                const pExpanded = expandedProducts.has(productKey);
                                const gMoulds = g.batches.reduce((s, x) => s + x.mouldCount, 0);
                                const productPlanIds = [...new Set(g.batches.map((bb) => bb.planId))];
                                return (
                                  <li key={g.productId} className="rounded-[6px] bg-white/55 border border-white/60 px-1.5 py-1">
                                    <div className="w-full flex items-baseline gap-1">
                                      <DragHandle
                                        id={`prod:${ds.day.id}:${b.stepId}:${g.productId}`}
                                        payload={{
                                          planIds: productPlanIds,
                                          stepIds: [b.stepId],
                                          label: `${g.productName} · step ${b.stepName} only`,
                                          sourceDate: d.date,
                                        }}
                                        title="Drag product to move only this step"
                                      />
                                      <button onClick={() => toggleProduct(productKey)} className="flex-1 min-w-0 flex items-baseline gap-1 text-left">
                                        <span className="text-[9px] opacity-60">{pExpanded ? "▾" : "▸"}</span>
                                        <span className="truncate text-[11px]" style={{ fontFamily: "var(--font-serif)", fontWeight: 500 }}>
                                          {g.productName}
                                        </span>
                                        <span className="ml-auto text-[9.5px] tabular-nums opacity-70 shrink-0">{gMoulds}m</span>
                                      </button>
                                      {(() => {
                                        const allPinned = productPlanIds.every((pid) => !!planMap.get(pid)?.pinnedDate);
                                        return (
                                          <button
                                            type="button"
                                            onClick={async (e) => {
                                              e.stopPropagation();
                                              try {
                                                if (allPinned) {
                                                  for (const pid of productPlanIds) await unpinProductionPlan(pid);
                                                } else {
                                                  await pinProductionPlans(productPlanIds);
                                                }
                                              } catch (err) {
                                                alert(err instanceof Error ? err.message : "Toggle failed");
                                              }
                                            }}
                                            title={allPinned ? `Unlock all ${g.productName} batches` : `Lock all ${g.productName} batches to current day`}
                                            className={allPinned ? "text-[#2e4839] hover:opacity-70" : "opacity-60 hover:opacity-100"}
                                          >
                                            <Lock className="w-3 h-3" />
                                          </button>
                                        );
                                      })()}
                                    </div>
                                    {pExpanded && (
                                      <ul className="mt-1 space-y-0.5 text-[10px]">
                                        {g.batches.map((bb) => {
                                          const planRow = planMap.get(bb.planId);
                                          const pinned = !!planRow?.pinnedDate;
                                          return (
                                            <li key={bb.lineItemId} className="flex items-baseline justify-between gap-1 px-1">
                                              <DragHandle
                                                id={`batch:${ds.day.id}:${bb.lineItemId}`}
                                                payload={{ planIds: [bb.planId], label: bb.batchNumber ?? bb.planName, sourceDate: d.date }}
                                                title="Drag batch to move"
                                              />
                                              <span className="truncate flex-1 min-w-0">{bb.batchNumber ?? bb.planName}</span>
                                              <button
                                                type="button"
                                                onClick={async (e) => {
                                                  e.stopPropagation();
                                                  try {
                                                    if (pinned) await unpinProductionPlan(bb.planId);
                                                    else await pinProductionPlans([bb.planId]);
                                                  } catch (err) {
                                                    alert(err instanceof Error ? err.message : "Toggle failed");
                                                  }
                                                }}
                                                title={pinned ? `Pinned to ${planRow?.pinnedDate} — click to unpin` : "Click to lock to current day"}
                                                className={pinned ? "text-[#2e4839] hover:opacity-70" : "opacity-60 hover:opacity-100"}
                                              >
                                                <Lock className="w-3 h-3" />
                                              </button>
                                              <span className="tabular-nums opacity-70">{bb.mouldCount}m</span>
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      );
                    }
                    // Mega — multiple step rows under same name (e.g. Polishing × 3 categories)
                    const tint = tintFor(name);
                    const megaKey = `${ds.day.id}|stepname:${name}`;
                    const megaExpanded = expandedSections.has(megaKey);
                    const totalMoulds = list.reduce(
                      (s, b) => s + [...b.groups.values()].reduce((s2, g) => s2 + g.batches.reduce((s3, x) => s3 + x.mouldCount, 0), 0),
                      0,
                    );
                    const megaPlanIds = [...new Set(list.flatMap((b) => [...b.groups.values()].flatMap((g) => g.batches.map((x) => x.planId))))];
                    return (
                      <div key={`mega:${name}`} className="rounded-[8px] px-2 py-1" style={{ background: tint.bg, color: tint.ink, borderLeft: `3px solid ${tint.ink}` }}>
                        <div className="w-full flex items-baseline gap-1.5">
                          <DragHandle
                            id={`mega:${ds.day.id}:${name}`}
                            payload={{
                              planIds: megaPlanIds,
                              stepIds: list.map((b) => b.stepId),
                              label: `${name} · ${megaPlanIds.length} batch${megaPlanIds.length === 1 ? "" : "es"} · step only`,
                              sourceDate: d.date,
                            }}
                            title="Drag step (all categories) to move only this step"
                          />
                          <button onClick={() => toggleSection(megaKey)} className="flex-1 min-w-0 flex items-baseline gap-1.5 text-left">
                            <span className="text-[10px] opacity-70">{megaExpanded ? "▾" : "▸"}</span>
                            <span className="truncate" style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 12 }}>
                              {name}
                            </span>
                            <span className="ml-auto text-[10px] tabular-nums opacity-75 shrink-0">
                              {list.length}cat·{totalMoulds}m
                            </span>
                          </button>
                          {(() => {
                            const allPinned = megaPlanIds.every((pid) => !!planMap.get(pid)?.pinnedDate);
                            return (
                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  try {
                                    if (allPinned) {
                                      for (const pid of megaPlanIds) await unpinProductionPlan(pid);
                                    } else {
                                      await pinProductionPlans(megaPlanIds);
                                    }
                                  } catch (err) {
                                    alert(err instanceof Error ? err.message : "Toggle failed");
                                  }
                                }}
                                title={allPinned ? `Unlock all ${name.toLowerCase()} batches` : `Lock all ${name.toLowerCase()} batches to current day`}
                                className={allPinned ? "text-[#2e4839] hover:opacity-70" : "opacity-60 hover:opacity-100"}
                              >
                                <Lock className="w-3 h-3" />
                              </button>
                            );
                          })()}
                        </div>
                        {megaExpanded && (
                          <div className="mt-1.5 space-y-1">
                            {list.map((b) => {
                              const groupsArr = [...b.groups.values()];
                              const sectionKey = `${ds.day.id}|${b.stepId}`;
                              const innerExpanded = expandedSections.has(sectionKey);
                              const innerMoulds = groupsArr.reduce((s, g) => s + g.batches.reduce((s2, x) => s2 + x.mouldCount, 0), 0);
                              const innerPlanIds = [...new Set(groupsArr.flatMap((g) => g.batches.map((x) => x.planId)))];
                              return (
                                <div key={b.stepId} className="rounded-[6px] bg-white/55 border border-white/60 px-1.5 py-1">
                                  <div className="w-full flex items-baseline gap-1">
                                    <DragHandle
                                      id={`cat:${ds.day.id}:${b.stepId}`}
                                      payload={{
                                        planIds: innerPlanIds,
                                        stepIds: [b.stepId],
                                        label: `${b.stepName} — ${b.productType || ""} · ${innerPlanIds.length} batch${innerPlanIds.length === 1 ? "" : "es"} · step only`,
                                        sourceDate: d.date,
                                      }}
                                      title="Drag category step to move only this step"
                                    />
                                    <button onClick={() => toggleSection(sectionKey)} className="flex-1 min-w-0 flex items-baseline gap-1 text-left">
                                      <span className="text-[9px] opacity-60">{innerExpanded ? "▾" : "▸"}</span>
                                      <span className="truncate text-[11px] capitalize" style={{ fontFamily: "var(--font-serif)", fontWeight: 500 }}>
                                        {b.productType || b.stepName}
                                      </span>
                                      <span className="ml-auto text-[9.5px] tabular-nums opacity-70 shrink-0">
                                        {groupsArr.length}·{innerMoulds}m
                                      </span>
                                    </button>
                                    {(() => {
                                      const allPinned = innerPlanIds.every((pid) => !!planMap.get(pid)?.pinnedDate);
                                      return (
                                        <button
                                          type="button"
                                          onClick={async (e) => {
                                            e.stopPropagation();
                                            try {
                                              if (allPinned) {
                                                for (const pid of innerPlanIds) await unpinProductionPlan(pid);
                                              } else {
                                                await pinProductionPlans(innerPlanIds);
                                              }
                                            } catch (err) {
                                              alert(err instanceof Error ? err.message : "Toggle failed");
                                            }
                                          }}
                                          title={allPinned ? "Unlock all batches in this category step" : "Lock all batches in this category step to current day"}
                                          className={allPinned ? "text-[#2e4839] hover:opacity-70" : "opacity-60 hover:opacity-100"}
                                        >
                                          <Lock className="w-3 h-3" />
                                        </button>
                                      );
                                    })()}
                                  </div>
                                  {innerExpanded && (
                                    <ul className="mt-1 space-y-1 text-[10px]">
                                      {groupsArr.map((g) => {
                                        const gPlanIds = [...new Set(g.batches.map((x) => x.planId))];
                                        const productKey = `${ds.day.id}|${b.stepId}|${g.productId}`;
                                        const pExpanded = expandedProducts.has(productKey);
                                        const gMoulds = g.batches.reduce((s, x) => s + x.mouldCount, 0);
                                        return (
                                          <li key={g.productId} className="rounded-[5px] bg-white/55 border border-white/60 px-1 py-0.5">
                                            <div className="w-full flex items-baseline gap-1">
                                              <DragHandle
                                                id={`prod:${ds.day.id}:${b.stepId}:${g.productId}`}
                                                payload={{
                                                  planIds: gPlanIds,
                                                  stepIds: [b.stepId],
                                                  label: `${g.productName} · step ${b.stepName} only`,
                                                  sourceDate: d.date,
                                                }}
                                                title="Drag product to move only this step"
                                              />
                                              <button onClick={() => toggleProduct(productKey)} className="flex-1 min-w-0 flex items-baseline gap-1 text-left">
                                                <span className="text-[9px] opacity-60">{pExpanded ? "▾" : "▸"}</span>
                                                <span className="truncate" style={{ fontFamily: "var(--font-serif)", fontWeight: 500 }}>
                                                  {g.productName}
                                                </span>
                                                <span className="ml-auto tabular-nums opacity-70 shrink-0">{gMoulds}m</span>
                                              </button>
                                              {(() => {
                                                const allPinned = gPlanIds.every((pid) => !!planMap.get(pid)?.pinnedDate);
                                                return (
                                                  <button
                                                    type="button"
                                                    onClick={async (e) => {
                                                      e.stopPropagation();
                                                      try {
                                                        if (allPinned) {
                                                          for (const pid of gPlanIds) await unpinProductionPlan(pid);
                                                        } else {
                                                          await pinProductionPlans(gPlanIds);
                                                        }
                                                      } catch (err) {
                                                        alert(err instanceof Error ? err.message : "Toggle failed");
                                                      }
                                                    }}
                                                    title={allPinned ? `Unlock all ${g.productName} batches` : `Lock all ${g.productName} batches to current day`}
                                                    className={allPinned ? "text-[#2e4839] hover:opacity-70" : "opacity-60 hover:opacity-100"}
                                                  >
                                                    <Lock className="w-3 h-3" />
                                                  </button>
                                                );
                                              })()}
                                            </div>
                                            {pExpanded && (
                                              <ul className="mt-0.5 space-y-0.5 pl-2">
                                                {g.batches.map((bb) => {
                                                  const planRow = planMap.get(bb.planId);
                                                  const pinned = !!planRow?.pinnedDate;
                                                  return (
                                                    <li key={bb.lineItemId} className="flex items-baseline gap-1">
                                                      <DragHandle
                                                        id={`batch:${ds.day.id}:${bb.lineItemId}`}
                                                        payload={{ planIds: [bb.planId], label: bb.batchNumber ?? bb.planName, sourceDate: d.date }}
                                                        title="Drag batch to move"
                                                      />
                                                      <span className="truncate flex-1 min-w-0">{bb.batchNumber ?? bb.planName}</span>
                                                      <button
                                                        type="button"
                                                        onClick={async (e) => {
                                                          e.stopPropagation();
                                                          try {
                                                            if (pinned) await unpinProductionPlan(bb.planId);
                                                            else await pinProductionPlans([bb.planId]);
                                                          } catch (err) {
                                                            alert(err instanceof Error ? err.message : "Toggle failed");
                                                          }
                                                        }}
                                                        title={pinned ? `Pinned to ${planRow?.pinnedDate} — click to unpin` : "Click to lock to current day"}
                                                        className={pinned ? "text-[#2e4839] hover:opacity-70" : "opacity-60 hover:opacity-100"}
                                                      >
                                                        <Lock className="w-3 h-3" />
                                                      </button>
                                                      <span className="tabular-nums opacity-70">{bb.mouldCount}m</span>
                                                    </li>
                                                  );
                                                })}
                                              </ul>
                                            )}
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
    })();
  }
}

// ─── subcomponents ──────────────────────────────────────────────────

/** Scheduled · 14 days — every source (order / campaign / PO) that has
 *  at least one batch scheduled in the visible 2-week window, grouped
 *  by source type, each with a checkbox toggling its inclusion in the
 *  multi-source focus filter. Manuela uses this to plan multiple
 *  sources side-by-side without losing context. */
function ScheduledPanel({
  plans, lineItems, productionDays, orders, orderItems, orderPlanLinks,
  focusTokens, toggleFocusToken,
}: {
  plans: import("@/types").ProductionPlan[];
  lineItems: import("@/types").ProductionDayLineItem[];
  productionDays: import("@/types").ProductionDay[];
  orders: import("@/types").Order[];
  orderItems: import("@/types").OrderItem[];
  orderPlanLinks: import("@/types").OrderPlanLink[];
  focusTokens: string[];
  toggleFocusToken: (tok: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  // Compute a 14-day window starting from yesterday (matches week view).
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const winStart = new Date(today);
  winStart.setDate(today.getDate() - 1);
  const winEnd = new Date(today);
  winEnd.setDate(today.getDate() + 13);
  const winStartIso = `${winStart.getFullYear()}-${String(winStart.getMonth() + 1).padStart(2, "0")}-${String(winStart.getDate()).padStart(2, "0")}`;
  const winEndIso = `${winEnd.getFullYear()}-${String(winEnd.getMonth() + 1).padStart(2, "0")}-${String(winEnd.getDate()).padStart(2, "0")}`;

  // Plan ids that have at least one lineItem in the window.
  const dayInWindow = new Map<string, string>(); // dayId → date
  for (const d of productionDays) {
    if (d.id && d.date >= winStartIso && d.date <= winEndIso) dayInWindow.set(d.id, d.date);
  }
  const scheduledPlanIds = new Set<string>();
  const planEarliestDate = new Map<string, string>();
  for (const li of lineItems) {
    const d = dayInWindow.get(li.productionDayId);
    if (!d) continue;
    scheduledPlanIds.add(li.planId);
    const cur = planEarliestDate.get(li.planId);
    if (!cur || d < cur) planEarliestDate.set(li.planId, d);
  }

  // Group scheduled plans by source. For order-driven plans (consolidated /
  // orderPlanLinks), one entry per contributing order. For campaign /
  // PO-prefixed plans, one entry per campaign / PO.
  type Source = {
    token: string;       // canonical focus token (campaign:Veganmania etc)
    label: string;       // display label
    kind: "campaign" | "po" | "order";
    batchCount: number;
    earliestDate: string;
  };
  const sources = new Map<string, Source>();
  function bump(token: string, label: string, kind: Source["kind"], date: string) {
    const cur = sources.get(token);
    if (cur) {
      cur.batchCount += 1;
      if (date < cur.earliestDate) cur.earliestDate = date;
    } else {
      sources.set(token, { token, label, kind, batchCount: 1, earliestDate: date });
    }
  }

  const itemById = new Map(orderItems.map((i) => [i.id!, i]));
  const orderById = new Map(orders.map((o) => [o.id!, o]));
  for (const planId of scheduledPlanIds) {
    const plan = plans.find((p) => p.id === planId);
    if (!plan) continue;
    const date = planEarliestDate.get(planId) ?? "";
    const name = plan.name ?? "";
    if (name.startsWith("Campaign: ")) {
      const rest = name.slice("Campaign: ".length);
      const dash = rest.indexOf(" — ");
      const cName = dash > 0 ? rest.slice(0, dash) : rest;
      bump(`campaign:${cName}`, `Campaign · ${cName}`, "campaign", date);
    } else if (name.startsWith("PO: ")) {
      const rest = name.slice("PO: ".length);
      const dash = rest.indexOf(" — ");
      const poName = dash > 0 ? rest.slice(0, dash) : rest;
      bump(`po:${poName}`, `PO · ${poName}`, "po", date);
    } else {
      // Order-driven (consolidated) — find linked orders.
      const orderIds = new Set<string>();
      for (const link of orderPlanLinks) {
        if (link.planId !== planId) continue;
        const item = itemById.get(link.orderItemId);
        if (item) orderIds.add(item.orderId);
      }
      for (const oid of orderIds) {
        const order = orderById.get(oid);
        if (!order) continue;
        const ref = order.sourceRef ? `${order.sourceRef}` : (order.customerName || order.eventName || oid.slice(0, 6));
        bump(`order:${oid}`, `Order ${ref}`, "order", date);
      }
    }
  }

  const grouped = {
    campaign: [...sources.values()].filter((s) => s.kind === "campaign").sort((a, b) => a.earliestDate.localeCompare(b.earliestDate)),
    po: [...sources.values()].filter((s) => s.kind === "po").sort((a, b) => a.earliestDate.localeCompare(b.earliestDate)),
    order: [...sources.values()].filter((s) => s.kind === "order").sort((a, b) => a.earliestDate.localeCompare(b.earliestDate)),
  };

  if (sources.size === 0) return null;

  const KIND_TINT: Record<Source["kind"], { bg: string; ink: string }> = {
    campaign: { bg: "#fdf8e2", ink: "#8a7030" },
    po: { bg: "#eff5fb", ink: "#4b6b8f" },
    order: { bg: "#e3ebe6", ink: "#2e4839" },
  };
  const KIND_LABEL: Record<Source["kind"], string> = {
    campaign: "Campaigns",
    po: "Production orders",
    order: "Orders",
  };

  function renderSection(kind: Source["kind"]) {
    const list = grouped[kind];
    if (list.length === 0) return null;
    const tint = KIND_TINT[kind];
    return (
      <div className="space-y-1">
        <p className="text-[10.5px] uppercase text-muted-foreground" style={{ letterSpacing: "0.12em" }}>
          {KIND_LABEL[kind]} · {list.length}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {list.map((s) => {
            const checked = focusTokens.includes(s.token);
            return (
              <button
                key={s.token}
                type="button"
                onClick={() => toggleFocusToken(s.token)}
                className={
                  "inline-flex items-baseline gap-1.5 text-[11px] px-2.5 py-1 rounded-full border transition " +
                  (checked
                    ? "bg-foreground text-background border-foreground"
                    : "border-white/60 hover:opacity-90")
                }
                style={!checked ? { background: tint.bg, color: tint.ink } : undefined}
                title={`Earliest day · ${s.earliestDate}`}
              >
                <span>{checked ? "☑" : "☐"}</span>
                <span className="truncate max-w-[200px]">{s.label}</span>
                <span className="opacity-65 tabular-nums">{s.batchCount}b</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Build "shared-batch" groups for orders. Two orders belong to the
  // same group when they share at least one production plan in the
  // visible window. Standalone orders end up in singleton groups.
  // Implemented as a tiny union-find over orderIds.
  function renderOrderGroups() {
    const orderSources = grouped.order;
    if (orderSources.length === 0) return null;
    const orderIdSet = new Set(orderSources.map((s) => s.token.slice("order:".length)));
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      let p = parent.get(x) ?? x;
      while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p;
      parent.set(x, p);
      return p;
    };
    const union = (a: string, b: string) => {
      const pa = find(a); const pb = find(b);
      if (pa !== pb) parent.set(pa, pb);
    };
    for (const oid of orderIdSet) parent.set(oid, oid);

    // Per-plan, link every pair of contributing orders.
    const ordersByPlan = new Map<string, Set<string>>();
    for (const link of orderPlanLinks) {
      if (!scheduledPlanIds.has(link.planId)) continue;
      const item = itemById.get(link.orderItemId);
      if (!item) continue;
      if (!orderIdSet.has(item.orderId)) continue;
      const set = ordersByPlan.get(link.planId) ?? new Set<string>();
      set.add(item.orderId);
      ordersByPlan.set(link.planId, set);
    }
    for (const oids of ordersByPlan.values()) {
      const arr = [...oids];
      for (let i = 1; i < arr.length; i++) union(arr[0], arr[i]);
    }
    // Also track shared plans per group for the column subtitle.
    const sharedPlansByRoot = new Map<string, Set<string>>();
    for (const [planId, oids] of ordersByPlan) {
      if (oids.size < 2) continue;
      for (const oid of oids) {
        const root = find(oid);
        const set = sharedPlansByRoot.get(root) ?? new Set<string>();
        set.add(planId);
        sharedPlansByRoot.set(root, set);
      }
    }

    // Group sources by root.
    const groupsByRoot = new Map<string, Source[]>();
    for (const src of orderSources) {
      const oid = src.token.slice("order:".length);
      const root = find(oid);
      const arr = groupsByRoot.get(root) ?? [];
      arr.push(src);
      groupsByRoot.set(root, arr);
    }
    const groups = [...groupsByRoot.values()].map((arr) => ({
      orders: arr.sort((a, b) => a.earliestDate.localeCompare(b.earliestDate)),
      sharedPlanCount: sharedPlansByRoot.get(find(arr[0].token.slice("order:".length)))?.size ?? 0,
    }));
    // Bigger groups (more shared) first; then by earliest date.
    groups.sort((a, b) => {
      if (a.orders.length !== b.orders.length) return b.orders.length - a.orders.length;
      return a.orders[0].earliestDate.localeCompare(b.orders[0].earliestDate);
    });

    const tint = KIND_TINT.order;
    return (
      <div className="space-y-1">
        <p className="text-[10.5px] uppercase text-muted-foreground" style={{ letterSpacing: "0.12em" }}>
          Orders · {orderSources.length} · grouped by shared batches
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {groups.map((g, idx) => {
            const isShared = g.orders.length > 1;
            return (
              <div
                key={idx}
                className="rounded-[10px] border border-white/60 p-2"
                style={{ background: isShared ? tint.bg : "rgba(255,255,255,0.55)" }}
              >
                <p className="text-[10px] uppercase mb-1 opacity-75 flex items-center gap-1.5" style={{ letterSpacing: "0.08em", color: isShared ? tint.ink : "#8a8780" }}>
                  {isShared
                    ? <>Shared · {g.orders.length} orders · {g.sharedPlanCount} batch{g.sharedPlanCount === 1 ? "" : "es"}</>
                    : <>Solo</>}
                </p>
                <div className="flex flex-wrap gap-1">
                  {g.orders.map((s) => {
                    const checked = focusTokens.includes(s.token);
                    return (
                      <button
                        key={s.token}
                        type="button"
                        onClick={() => toggleFocusToken(s.token)}
                        className={
                          "inline-flex items-baseline gap-1.5 text-[10.5px] px-2 py-0.5 rounded-full border transition " +
                          (checked
                            ? "bg-foreground text-background border-foreground"
                            : "border-white/60 bg-white/55 hover:opacity-90 text-foreground")
                        }
                        title={`Earliest day · ${s.earliestDate}`}
                      >
                        <span>{checked ? "☑" : "☐"}</span>
                        <span className="truncate max-w-[150px]">{s.label}</span>
                        <span className="opacity-60 tabular-nums">{s.batchCount}b</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <section className="bg-white/65 backdrop-blur-2xl border border-white/60 rounded-[18px] p-4 shadow-[0_1px_2px_rgba(16,18,24,0.04),0_8px_24px_rgba(16,18,24,0.05)] mb-4">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-baseline justify-between gap-2 text-left"
      >
        <div className="flex items-baseline gap-2">
          <span className="text-[10.5px] opacity-70">{collapsed ? "▸" : "▾"}</span>
          <h2
            className="text-[18px]"
            style={{ fontFamily: "var(--font-serif)", fontWeight: 500, letterSpacing: "-0.012em" }}
          >
            Scheduled · 14 days
          </h2>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {sources.size} source{sources.size === 1 ? "" : "s"}
          </span>
        </div>
        {focusTokens.length > 0 && (
          <span className="text-[11px] text-[#2e4839]">
            {focusTokens.length} selected
          </span>
        )}
      </button>
      {!collapsed && (
        <div className="mt-3 space-y-3">
          <p className="text-[11.5px] text-muted-foreground -mt-1">
            Tick any source to filter the calendar to those batches. Multi-select supported.
          </p>
          {renderOrderGroups()}
          {renderSection("campaign")}
          {renderSection("po")}
        </div>
      )}
    </section>
  );
}

/** Demand-by-urgency view — the minimum must-do list per product
 *  derived from open order deadlines. Shows overdue / today /
 *  tomorrow / this week buckets, total need, current production
 *  stock, and the net pieces still to produce. Per-product row
 *  expands to show the contributing orders so the operator can
 *  decide whether to make ALL of a batch or only enough to
 *  cover the soonest deadline.
 *
 *  Time-pinned orders (deadline carries hours/minutes) are flagged
 *  with a clock icon — these typically need to be ready by an exact
 *  pickup time, so they jump up the priority list. */
function DemandByUrgency({
  orders, orderItems, products, productLocationTotals, orderPlanLinks,
}: {
  orders: import("@/types").Order[];
  orderItems: import("@/types").OrderItem[];
  products: ReturnType<typeof useProductsList>;
  productLocationTotals: ReturnType<typeof useProductLocationTotals>;
  orderPlanLinks: import("@/types").OrderPlanLink[];
}) {
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);

  // All channels present in current open orders (incl. replenishment
  // child-orders flagged via channel === "shop"). Computed from data
  // so the chip row stays in sync.
  const channels = useMemo(() => {
    const s = new Set<string>();
    for (const o of orders) {
      if (o.status === "done" || o.status === "cancelled") continue;
      s.add(o.channel ?? "other");
    }
    return [...s].sort();
  }, [orders]);

  const CHANNEL_LABEL: Record<string, string> = {
    online: "Online",
    b2b: "B2B",
    event: "Event",
    shop: "Replen",
    walkin: "Walk-in",
    other: "Other",
  };
  const CHANNEL_TINT: Record<string, { bg: string; ink: string }> = {
    online: { bg: "#e3ebe6", ink: "#2e4839" },
    b2b: { bg: "#eff5fb", ink: "#4b6b8f" },
    event: { bg: "#fdf8e2", ink: "#8a7030" },
    shop: { bg: "#f1faf4", ink: "#4a7a5e" },
    walkin: { bg: "#f3eef6", ink: "#6a4d89" },
    other: { bg: "rgba(0,0,0,0.05)", ink: "#1c1d1f" },
  };

  // Map orderId → set of plan ids linked via the (orderItem → plan)
  // graph. Used by the defer button to find which production batches
  // need to slide a day, instead of touching the customer's deadline.
  const planIdsByOrderId = useMemo(() => {
    const itemById = new Map(orderItems.map((oi) => [oi.id!, oi]));
    const m = new Map<string, Set<string>>();
    for (const link of orderPlanLinks) {
      const item = itemById.get(link.orderItemId);
      if (!item) continue;
      const set = m.get(item.orderId) ?? new Set<string>();
      set.add(link.planId);
      m.set(item.orderId, set);
    }
    return m;
  }, [orderItems, orderPlanLinks]);

  async function handleDefer(orderId: string) {
    if (busyOrderId) return;
    const planIds = [...(planIdsByOrderId.get(orderId) ?? [])];
    if (planIds.length === 0) {
      alert("No production batches linked to this order yet — run Regenerate first to create them.");
      return;
    }
    if (!confirm(`Push this order's ${planIds.length} batch${planIds.length === 1 ? "" : "es"} to tomorrow + lock so regenerate keeps it there?`)) return;
    setBusyOrderId(orderId);
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const iso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
      await moveProductionPlansToDate({ planIds, targetDate: iso, pin: true });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not defer");
    } finally {
      setBusyOrderId(null);
    }
  }

  // Time-of-day check — Shopify imports often only carry a date, in
  // which case the time component is "00:00:00". Treat those as
  // date-only. Anything later than midnight = explicit pickup time.
  function hasExplicitTime(deadline: string): boolean {
    const d = new Date(deadline);
    return d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
  }

  const productById = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const todayIso = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowIso = tomorrow.toISOString().slice(0, 10);
  const weekEnd = new Date();
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndIso = weekEnd.toISOString().slice(0, 10);

  type Bucket = "overdue" | "today" | "tomorrow" | "week" | "later";
  type Demand = {
    productId: string;
    productName: string;
    overdue: number;
    today: number;
    tomorrow: number;
    week: number;
    later: number;
    total: number;
    stock: number;
    netNeeded: number;
    hasTimedSoon: boolean;
    contributors: Array<{
      orderId: string;
      orderRef: string;
      qty: number;
      deadline: string;
      hasTime: boolean;
      bucket: Bucket;
    }>;
  };

  const orderById = useMemo(() => new Map(orders.map((o) => [o.id!, o])), [orders]);

  type OrderRow = {
    orderId: string;
    orderRef: string;
    channel: string;
    deadline: string;
    bucket: Bucket;
    hasTime: boolean;
    totalQty: number;
    productLines: Array<{ productId: string; productName: string; qty: number; stock: number }>;
  };

  // Each card = one ORDER (the unit Manuela actually moves around).
  // Inside the card we list which products contribute + qty so the
  // total still tells her how much chocolate today actually means.
  const orderRows = useMemo<OrderRow[]>(() => {
    const byOrder = new Map<string, OrderRow>();
    for (const item of orderItems) {
      const order = orderById.get(item.orderId);
      if (!order) continue;
      if (order.status === "done" || order.status === "cancelled") continue;
      if ((item.fulfilmentMode ?? "produce") !== "produce") continue;
      if (channelFilter !== "all" && (order.channel ?? "other") !== channelFilter) continue;
      const product = productById.get(item.productId);
      if (!product) continue;
      const dueIso = (order.deadline ?? "").slice(0, 10);
      if (!dueIso) continue;
      let bucket: Bucket;
      if (dueIso < todayIso) bucket = "overdue";
      else if (dueIso === todayIso) bucket = "today";
      else if (dueIso === tomorrowIso) bucket = "tomorrow";
      else if (dueIso <= weekEndIso) bucket = "week";
      else bucket = "later";
      let row = byOrder.get(order.id!);
      if (!row) {
        row = {
          orderId: order.id!,
          orderRef: order.customerName || order.eventName || order.sourceRef || "order",
          channel: order.channel ?? "other",
          deadline: order.deadline,
          bucket,
          hasTime: hasExplicitTime(order.deadline),
          totalQty: 0,
          productLines: [],
        };
        byOrder.set(order.id!, row);
      }
      const t = productLocationTotals.get(item.productId);
      row.productLines.push({
        productId: item.productId,
        productName: product.name,
        qty: item.quantity,
        stock: t?.production ?? 0,
      });
      row.totalQty += item.quantity;
    }
    const out = [...byOrder.values()].filter((r) => r.totalQty > 0);
    out.sort((a, b) => {
      const tier = (r: OrderRow) =>
        r.bucket === "overdue" ? 0 : r.bucket === "today" ? 1 : r.bucket === "tomorrow" ? 2 : r.bucket === "week" ? 3 : 4;
      const ta = tier(a); const tb = tier(b);
      if (ta !== tb) return ta - tb;
      return a.deadline.localeCompare(b.deadline);
    });
    return out;
  }, [orderItems, productById, productLocationTotals, orderById, todayIso, tomorrowIso, weekEndIso, channelFilter]);

  // Per-product totals across the visible orders — kept so Manuela
  // still sees aggregate need ("how much strawberry total this week").
  const productTotals = useMemo(() => {
    const m = new Map<string, { name: string; qty: number; stock: number; net: number }>();
    for (const o of orderRows) {
      for (const line of o.productLines) {
        const cur = m.get(line.productId);
        if (cur) cur.qty += line.qty;
        else m.set(line.productId, { name: line.productName, qty: line.qty, stock: line.stock, net: 0 });
      }
    }
    for (const v of m.values()) v.net = Math.max(0, v.qty - v.stock);
    return [...m.values()].sort((a, b) => b.net - a.net);
  }, [orderRows]);

  // Per-channel counts for chip row (always computed across ALL
  // channels regardless of current filter).
  const channelCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const item of orderItems) {
      const order = orderById.get(item.orderId);
      if (!order) continue;
      if (order.status === "done" || order.status === "cancelled") continue;
      if ((item.fulfilmentMode ?? "produce") !== "produce") continue;
      const k = order.channel ?? "other";
      c.set(k, (c.get(k) ?? 0) + 1);
    }
    return c;
  }, [orderItems, orderById]);

  if (orderRows.length === 0) return null;

  const totalOverdue = orderRows.filter((r) => r.bucket === "overdue").reduce((s, r) => s + r.totalQty, 0);
  const totalToday = orderRows.filter((r) => r.bucket === "today").reduce((s, r) => s + r.totalQty, 0);
  const totalNet = productTotals.reduce((s, p) => s + p.net, 0);

  return (
    <section className="bg-white/65 backdrop-blur-2xl border border-white/60 rounded-[18px] p-4 shadow-[0_1px_2px_rgba(16,18,24,0.04),0_8px_24px_rgba(16,18,24,0.05)] mb-4">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-baseline justify-between gap-3 text-left"
      >
        <div className="flex items-baseline gap-2">
          <span className="text-[10.5px] opacity-70">{collapsed ? "▸" : "▾"}</span>
          <h2
            className="text-[20px]"
            style={{ fontFamily: "var(--font-serif)", fontWeight: 500, letterSpacing: "-0.012em" }}
          >
            Must do — by urgency
          </h2>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          {totalOverdue > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-[#fdeeea] text-[#9b4f48] tabular-nums">
              {totalOverdue} overdue
            </span>
          )}
          {totalToday > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-[#fdf8e2] text-[#8a7030] tabular-nums">
              {totalToday} today
            </span>
          )}
          <span className="px-2 py-0.5 rounded-full bg-[#f1faf4] text-[#4a7a5e] tabular-nums">
            {totalNet} pcs to produce
          </span>
        </div>
      </button>

      {!collapsed && (
        <p className="text-[11.5px] text-muted-foreground mt-2">
          Net pieces still needed after stock. Fix-time orders flagged with a clock. Filter by channel below.
        </p>
      )}

      {!collapsed && (<>
      {/* Channel chip row — slice the demand by channel. */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {(["all", ...channels] as string[]).map((c) => {
          const active = channelFilter === c;
          const count = c === "all"
            ? [...channelCounts.values()].reduce((s, n) => s + n, 0)
            : channelCounts.get(c) ?? 0;
          const label = c === "all" ? "All" : (CHANNEL_LABEL[c] ?? c);
          const tint = c === "all" ? null : CHANNEL_TINT[c];
          return (
            <button
              key={c}
              onClick={() => setChannelFilter(c)}
              className={
                "text-[11px] px-2.5 py-0.5 rounded-full border transition " +
                (active
                  ? "bg-foreground text-background border-foreground"
                  : "bg-card border-border text-foreground hover:border-foreground")
              }
              style={!active && tint ? { background: tint.bg, color: tint.ink, borderColor: tint.bg } : undefined}
            >
              {label} <span className="tabular-nums opacity-75 ml-0.5">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Per-product totals strip — at-a-glance "how much chocolate
          total" across the visible orders. Compact pill row. */}
      {productTotals.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3 -mt-1">
          {productTotals.map((p) => (
            <span
              key={p.name}
              className="inline-flex items-baseline gap-1 text-[10.5px] rounded-full px-2 py-0.5 border border-white/60"
              style={{ background: "rgba(255,255,255,0.65)", borderLeft: p.net > 0 ? "3px solid #4a6b5b" : undefined }}
              title={`${p.qty} ordered · ${p.stock} in stock · make ${p.net}`}
            >
              <span className="truncate max-w-[120px]" style={{ fontFamily: "var(--font-serif)", fontWeight: 500 }}>
                {p.name}
              </span>
              <span className="tabular-nums opacity-80">
                {p.net > 0 ? `make ${p.net}` : "✓"}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Compact ORDER cards — each card = an order Manuela can defer
          as a unit. Inside: date + time + tiny product-line chips +
          total qty. Tight 3–4 col grid. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
        {orderRows.map((o) => {
          const surface = "rgba(255,255,255,0.65)";
          const tint = o.bucket === "overdue"
            ? { bg: surface, ink: "#9b4f48" }
            : o.bucket === "today"
              ? { bg: surface, ink: "#8a7030" }
              : o.bucket === "tomorrow"
                ? { bg: surface, ink: "#4b6b8f" }
                : { bg: surface, ink: "#1c1d1f" };
          const channelTint = CHANNEL_TINT[o.channel] ?? CHANNEL_TINT.other;
          const date = new Date(o.deadline);
          const dateStr = date.toLocaleDateString("de-AT", { weekday: "short", day: "2-digit", month: "2-digit" });
          const timeStr = o.hasTime ? date.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" }) : null;
          const busy = busyOrderId === o.orderId;
          return (
            <div
              key={o.orderId}
              className="rounded-[12px] border border-white/60 p-2.5"
              style={{ background: tint.bg, color: tint.ink, borderLeft: `3px solid ${tint.ink}` }}
            >
              {/* Header: customer + total */}
              <div className="flex items-baseline gap-1.5">
                <Link
                  href={`/orders/${encodeURIComponent(o.orderId)}?from=plan`}
                  className="flex-1 min-w-0 truncate hover:underline"
                  style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 13.5, letterSpacing: "-0.01em" }}
                >
                  {o.orderRef}
                </Link>
                <span className="tabular-nums shrink-0" style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 16 }}>
                  {o.totalQty}
                </span>
                <span className="text-[9.5px] opacity-65 shrink-0">pcs</span>
              </div>

              {/* Sub-line: channel chip + deadline */}
              <div className="flex items-center gap-1.5 mt-0.5 text-[10.5px]">
                <span
                  className="px-1.5 py-0 rounded-full"
                  style={{ background: channelTint.bg, color: channelTint.ink, fontSize: 9, letterSpacing: "0.08em" }}
                >
                  {(CHANNEL_LABEL[o.channel] ?? o.channel).toUpperCase()}
                </span>
                <span className="tabular-nums">
                  {dateStr}{timeStr && <span className="ml-0.5 font-medium">· {timeStr}</span>}
                </span>
                {o.hasTime && (o.bucket === "overdue" || o.bucket === "today" || o.bucket === "tomorrow") && (
                  <span className="text-[10px]" title="Has fix-time pickup">🕒</span>
                )}
              </div>

              {/* Product lines — tiny pill list inline */}
              <div className="flex flex-wrap gap-1 mt-1.5">
                {o.productLines.map((line) => (
                  <span
                    key={line.productId}
                    className="inline-flex items-baseline gap-0.5 text-[10px] rounded-full bg-white/55 border border-white/60 px-1.5 py-0"
                    title={`${line.productName} · ${line.qty} pcs (stock ${line.stock})`}
                  >
                    <span className="truncate max-w-[110px]">{line.productName}</span>
                    <span className="tabular-nums opacity-75">×{line.qty}</span>
                  </span>
                ))}
              </div>

              {/* Footer: defer button */}
              <div className="mt-1.5 flex">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleDefer(o.orderId)}
                  title="Move this order's batches to tomorrow + lock"
                  className="ml-auto text-[10px] px-2 py-0.5 rounded-full border border-white/60 bg-white/55 hover:bg-white/80 transition disabled:opacity-50"
                >
                  {busy ? "…" : "→ tomorrow"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      </>)}
    </section>
  );
}

/** Group regenerate warnings by their normalised pattern so a long
 *  list of "Batch X past deadline" lines reads as one collapsed
 *  block with a batch-name list, not a wall of near-duplicates. */
function MouldPoolReadout({
  tightCount, mouldUsage,
}: {
  tightCount: number;
  mouldUsage: Array<{ mouldId: string; name: string; used: number; owned: number; short: boolean }>;
}) {
  // Only meaningful comparison is per-mould-type; cross-type totals
  // (e.g. "31 / 135 owned") add up apples and oranges and confused
  // the user. Headline now just calls out short types; details show
  // each mould's used/owned line.
  const [open, setOpen] = useState(tightCount > 0);
  const types = mouldUsage.length;
  const tone = tightCount > 0
    ? "bg-[var(--accent-blush-bg)] text-[var(--accent-blush-ink)]"
    : "bg-[var(--accent-mint-bg)] text-[var(--accent-mint-ink)]";

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between gap-2 rounded-[10px] px-3 py-1.5 text-[11px] ${tone}`}
      >
        <span className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold">Mould pool</span>
          {tightCount > 0 ? (
            <>
              <span className="tabular-nums">
                {tightCount} of {types} mould type{types === 1 ? "" : "s"} over-booked
              </span>
              <span className="rounded-full bg-white/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em]">
                phase needed
              </span>
            </>
          ) : (
            <span className="tabular-nums">
              {types} mould type{types === 1 ? "" : "s"} fit
            </span>
          )}
        </span>
        <span className="text-[10px] opacity-80">{open ? "hide" : "show"}</span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {mouldUsage.map((m) => (
            <li
              key={m.mouldId}
              className={`flex items-center gap-3 rounded-[8px] px-3 py-1.5 text-[11px] ${
                m.short
                  ? "bg-[var(--accent-blush-bg)]/40 text-[var(--accent-blush-ink)]"
                  : "bg-muted/40 text-foreground"
              }`}
            >
              <span className="flex-1 truncate">{m.name}</span>
              <span className="tabular-nums">
                {m.used} / {m.owned} {m.used === 1 ? "instance" : "instances"}
              </span>
              {m.short && (
                <span className="text-[10px] uppercase tracking-[0.06em] font-medium">
                  needs {m.used - m.owned} more · sequence
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GroupedWarnings({ warnings }: { warnings: string[] }) {
  const groups = new Map<string, { template: string; names: string[]; rest: string[] }>();
  const ungrouped: string[] = [];

  for (const w of warnings) {
    // Pattern 1: `Batch "X" is past its earliest linked deadline — scheduling ASAP (will finish after deadline).`
    const m1 = w.match(/^Batch\s+"([^"]+)"\s+is past its earliest linked deadline(.*)$/);
    if (m1) {
      const key = "past-deadline";
      const g = groups.get(key) ?? { template: "past deadline — scheduling ASAP", names: [], rest: [] };
      g.names.push(m1[1]);
      groups.set(key, g);
      continue;
    }
    // Pattern 2: `Batch "X" could not be placed within capacity — ...`
    const m2 = w.match(/^Batch\s+"([^"]+)"\s+(.+)$/);
    if (m2) {
      const tailKey = m2[2].slice(0, 40); // bucket by tail similarity
      const key = `batch:${tailKey}`;
      const g = groups.get(key) ?? { template: m2[2], names: [], rest: [] };
      g.names.push(m2[1]);
      groups.set(key, g);
      continue;
    }
    ungrouped.push(w);
  }

  return (
    <Banner tone="butter" icon={<AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}>
      <div className="text-xs space-y-2 leading-snug">
        {[...groups.values()].map((g, i) => (
          <div key={i}>
            <p className="font-semibold">
              {g.names.length} batch{g.names.length === 1 ? "" : "es"} {g.template}
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {g.names.slice(0, 12).map((n) => (
                <span
                  key={n}
                  className="rounded-full bg-card border border-border px-2 py-0.5 text-[10.5px] text-foreground"
                >
                  {n}
                </span>
              ))}
              {g.names.length > 12 && (
                <span className="text-[10.5px] opacity-70 self-center">
                  +{g.names.length - 12} more
                </span>
              )}
            </div>
          </div>
        ))}
        {ungrouped.length > 0 && (
          <ul className="space-y-0.5">
            {ungrouped.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}
            {ungrouped.length > 8 && (
              <li className="opacity-70">…and {ungrouped.length - 8} more.</li>
            )}
          </ul>
        )}
      </div>
    </Banner>
  );
}

function Banner({
  tone, icon, children,
}: {
  tone: "butter" | "mint" | "blush";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const cls =
    tone === "butter" ? "bg-[var(--accent-butter-bg)] text-[var(--accent-butter-ink)]" :
    tone === "mint"   ? "bg-[var(--accent-mint-bg)] text-[var(--accent-mint-ink)]" :
                        "bg-[var(--accent-blush-bg)] text-[var(--accent-blush-ink)]";
  return (
    <div className={`${INNER} flex items-start gap-2 px-3 py-2 ${cls}`} style={{ borderColor: "transparent" }}>
      {icon}
      <div className="flex-1">{children}</div>
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────

function formatDayLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  const label = d.toLocaleDateString("de-AT", { weekday: "long", day: "numeric", month: "long" });
  if (days === 0) return `${label} · today`;
  if (days === 1) return `${label} · tomorrow`;
  if (days < 0) return `${label} · ${-days}d ago`;
  return `${label} · in ${days}d`;
}

function abbrev(name: string): string {
  return name.slice(0, 3);
}

function BatchGroupRow({
  group, orderedSteps, stepDoneFor, dayLineItems,
}: {
  group: {
    productId: string;
    productName: string;
    batches: Array<{
      planId: string;
      planName: string;
      batchNumber?: string;
      mouldCount: number;
      orderRef?: string;
      plannedMinutes: number;
      lineItemId: string;
    }>;
  };
  orderedSteps: import("@/types").ProductionStep[];
  stepDoneFor: (planId: string, stepId: string) => boolean;
  dayLineItems: import("@/types").ProductionDayLineItem[];
}) {
  const [open, setOpen] = useState(false);
  const totalMoulds = group.batches.reduce((s, b) => s + b.mouldCount, 0);
  const totalMinutes = group.batches.reduce((s, b) => s + b.plannedMinutes, 0);
  const orderRefs = [...new Set(group.batches.map((b) => b.orderRef).filter(Boolean) as string[])];
  const isSingle = group.batches.length === 1;

  // Aggregated step state across all batches in group:
  //   done = all batches done at this step
  //   nowIdx = first index where any batch is in_progress (last-done + 1)
  //   scheduled = any batch has it scheduled today
  const aggStepStates = orderedSteps.map((s) => {
    const allDone = group.batches.every((b) => stepDoneFor(b.planId, s.id!));
    const someDone = group.batches.some((b) => stepDoneFor(b.planId, s.id!));
    const scheduled = group.batches.some((b) =>
      dayLineItems.some((x) => x.planId === b.planId && x.stepIds.includes(s.id!)),
    );
    return { id: s.id!, name: s.name, allDone, someDone, scheduled };
  });
  const lastAllDoneIdx = aggStepStates.reduce((acc, s, i) => (s.allDone ? i : acc), -1);
  const nowIdx = lastAllDoneIdx + 1 < aggStepStates.length ? lastAllDoneIdx + 1 : -1;

  // Pastel tint by status — done = mint, in-progress = butter, scheduled = sky, idle = neutral.
  const allDone = aggStepStates.every((s) => s.allDone);
  const anyDone = aggStepStates.some((s) => s.allDone || s.someDone);
  const tint = (() => {
    if (allDone) return { bg: "#f1faf4", ink: "#4a7a5e", bar: "#4a7a5e" };
    if (anyDone) return { bg: "#fdf8e2", ink: "#8a7030", bar: "#8a7030" };
    return { bg: "rgba(245,243,239,0.7)", ink: "#1c1d1f", bar: "#bdbcc1" };
  })();
  const doneSteps = aggStepStates.filter((s) => s.allDone).length;
  const totalSteps = aggStepStates.length;
  const pct = totalSteps === 0 ? 0 : Math.round((doneSteps / totalSteps) * 100);
  const currentStepName = nowIdx >= 0 ? aggStepStates[nowIdx].name : (allDone ? "Done" : "—");

  // Single-batch row — one line with everything inline.
  if (isSingle) {
    const b = group.batches[0];
    return (
      <li>
        <Link
          href={`/production/${encodeURIComponent(b.planId)}?from=plan`}
          className="flex items-center gap-3 rounded-[10px] px-3 py-2 transition hover:opacity-90 border border-transparent hover:border-foreground/15"
          style={{ background: tint.bg, color: tint.ink, borderLeft: `3px solid ${tint.ink}` }}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1.5 truncate">
              <span
                className="truncate"
                style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 15, letterSpacing: "-0.012em" }}
              >
                {group.productName}
              </span>
              <span className="text-[11px] opacity-65 tabular-nums">· {totalMoulds} mould{totalMoulds === 1 ? "" : "s"}</span>
              {b.batchNumber && <span className="text-[10px] opacity-50 font-mono">· {b.batchNumber}</span>}
            </div>
            <div className="text-[10.5px] opacity-65 truncate mt-0.5">
              {allDone ? "Done" : `Now: ${currentStepName}`}
              {orderRefs.length > 0 && ` · for ${orderRefs.join(", ")}`}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden sm:block w-16 h-[3px] bg-white/45 rounded-sm overflow-hidden">
              <span className="block h-full" style={{ background: tint.bar, width: `${pct}%` }} />
            </span>
            <span className="text-[10.5px] tabular-nums opacity-75 w-10 text-right">{totalMinutes}m</span>
            <span className="text-[12px] opacity-50">›</span>
          </div>
        </Link>
      </li>
    );
  }

  return (
    <li className="rounded-[10px] overflow-hidden border border-transparent" style={{ background: tint.bg, color: tint.ink, borderLeft: `3px solid ${tint.ink}` }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-3 py-2 text-left transition hover:opacity-90"
      >
        <span className="opacity-60 text-[12px] shrink-0">{open ? "▾" : "▸"}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5 truncate">
            <span
              className="truncate"
              style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 15, letterSpacing: "-0.012em" }}
            >
              {group.productName}
            </span>
            <span className="text-[11px] opacity-65 tabular-nums">
              · {totalMoulds} mould{totalMoulds === 1 ? "" : "s"} · {group.batches.length} batches
            </span>
          </div>
          <div className="text-[10.5px] opacity-65 truncate mt-0.5">
            {allDone ? "All batches done" : `Now: ${currentStepName}`}
            {orderRefs.length > 0 && ` · for ${orderRefs.join(", ")}`}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="hidden sm:block w-16 h-[3px] bg-white/45 rounded-sm overflow-hidden">
            <span className="block h-full" style={{ background: tint.bar, width: `${pct}%` }} />
          </span>
          <span className="text-[10.5px] tabular-nums opacity-75 w-10 text-right">{totalMinutes}m</span>
        </div>
      </button>

      {open && (
        <ul className="border-t border-white/40 bg-white/30">
          {group.batches.map((b) => (
            <li key={b.lineItemId}>
              <Link
                href={`/production/${encodeURIComponent(b.planId)}?from=plan`}
                className="block px-3 py-2 hover:bg-white/60 transition border-b border-white/30 last:border-b-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11.5px] font-medium truncate" style={{ color: "#1c1d1f" }}>
                      {b.batchNumber ?? b.planName}
                      <span className="opacity-65 font-normal ml-1.5 text-[10.5px]">
                        · {b.mouldCount} mould{b.mouldCount === 1 ? "" : "s"}
                      </span>
                    </p>
                    {b.orderRef && (
                      <p className="text-[10.5px] opacity-70 truncate" style={{ color: "#1c1d1f" }}>for {b.orderRef}</p>
                    )}
                  </div>
                  <span className="text-[10.5px] tabular-nums shrink-0 opacity-70" style={{ color: "#1c1d1f" }}>
                    {b.plannedMinutes}m
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function LastRegenLine() {
  const t = useLastRegenAt();
  if (!t) return <span className="text-[10px] text-muted-foreground mt-1 italic">never regenerated</span>;
  const ms = Date.now() - t.getTime();
  const min = Math.floor(ms / 60_000);
  const rel = min < 1 ? "just now"
    : min < 60 ? `${min} min ago`
    : min < 60 * 24 ? `${Math.floor(min / 60)}h ago`
    : `${Math.floor(min / 60 / 24)}d ago`;
  const abs = t.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
  return (
    <span className="text-[10px] text-muted-foreground mt-1 tabular-nums">
      Last update {abs} · {rel}
    </span>
  );
}

// ─── Shared step-done helper ───────────────────────────────────────
// Single source of truth for "is this step's phase already ticked
// done for this plan?". Maps the productionStep.name down to the
// semantic phase key (polishing / colour / shell / fill / cap /
// unmould / packing) the wizard writes into planStepStatus, then
// prefix-matches against the done-key set.
//
// Every read surface (day view, week view, pivot view, /production,
// /production-brain/daily) must funnel through this so a tick on
// any of them shows the same state on all the others.
function planPhaseKeyForStepName(name: string): string | null {
  const n = (name ?? "").toLowerCase().trim();
  if (n.includes("polish")) return "polishing";
  if (n.includes("paint") || n.includes("colour") || n.includes("color")) return "colour";
  if (n.includes("shell") || n.includes("temper")) return "shell";
  if (n.includes("filling prep") || n === "prep" || n.startsWith("prep")) return "filling";
  if (n.includes("fill")) return "fill";
  if (n.includes("cap")) return "cap";
  if (n.includes("unmould") || n.includes("unmold")) return "unmould";
  if (n.includes("pack")) return "packing";
  return null;
}
function planStepIsDone(stepName: string, planId: string, doneKeysByPlan: Map<string, Set<string>>): boolean {
  const phase = planPhaseKeyForStepName(stepName);
  if (!phase) return false;
  const set = doneKeysByPlan.get(planId);
  if (!set) return false;
  for (const k of set) {
    if (k === phase || k.startsWith(`${phase}-`)) return true;
  }
  return false;
}

// ─── Pivot view sub-components ─────────────────────────────────────
// Hoisted to module scope so React doesn't unmount/remount them on
// every PivotView render — that was the reason drag never armed:
// dnd-kit's useDraggable registration was being torn down between
// pointer-down and the activation distance threshold.

function PivotPill({
  id, payload, children, style, title, onClick,
}: {
  id: string;
  payload: { planIds: string[]; stepIds: string[]; sourceDate: string; label: string };
  children: React.ReactNode;
  style?: React.CSSProperties;
  title?: string;
  onClick?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, data: payload });
  // Visual feedback: translate the pill with the cursor while
  // dragging. Without this nothing visibly moves and the operator
  // assumes drag isn't responding. zIndex lifts the pill above
  // sibling table cells.
  const dragTransform = transform
    ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
    : undefined;
  return (
    <span
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      title={title}
      draggable={false}
      onClick={(e) => {
        // dnd-kit only fires onClick when distance < activation threshold,
        // so a real drag never reaches here. A genuine click toggles the
        // expanded panel below the row.
        e.stopPropagation();
        onClick?.();
      }}
      style={{
        ...style,
        cursor: isDragging ? "grabbing" : "grab",
        touchAction: "none",
        userSelect: "none",
        transform: dragTransform,
        zIndex: isDragging ? 50 : undefined,
        position: isDragging ? "relative" : undefined,
        // While dragging, let the cursor "see through" the pill so
        // pointer-based collision detection picks up the destination
        // droppable underneath instead of the pill itself. Without
        // this, dropping on another cell registered as "over nothing".
        pointerEvents: isDragging ? "none" : undefined,
        opacity: isDragging ? 0.85 : style?.opacity ?? 1,
        boxShadow: isDragging ? "0 6px 18px rgba(0,0,0,0.18)" : undefined,
      }}
    >
      {children}
    </span>
  );
}

function PivotCellDrop({
  iso, children,
}: {
  iso: string;
  children: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `pivot-day:${iso}` });
  return (
    <div
      ref={setNodeRef}
      style={{
        minHeight: 48,
        height: "100%",
        width: "100%",
        borderRadius: 8,
        padding: 4,
        background: isOver ? "rgba(246,198,203,0.45)" : "transparent",
        outline: isOver ? "2px solid #4a6b5b" : undefined,
        outlineOffset: isOver ? -1 : undefined,
        transition: "background-color 80ms ease, outline-color 80ms ease",
      }}
    >
      {children}
    </div>
  );
}

// ─── Pivot view ────────────────────────────────────────────────────
//
// Source × Day pivot. Rows = sources (orders / campaigns / POs).
// Columns = 14 days starting today. Cells = step-phase pills of any
// scheduled batch for that source on that day. Layout makes
// "what does Hofer #4415 need from me this week?" readable across
// a single row. See plan-week-mockups.html · idea 2 ("Pivot").
function PivotView(props: {
  plans: import("@/types").ProductionPlan[];
  lineItems: import("@/types").ProductionDayLineItem[];
  productionDays: import("@/types").ProductionDay[];
  orderedSteps: import("@/types").ProductionStep[];
  planProductsByPlan: Map<string, import("@/types").PlanProduct[]>;
  productMap: Map<string, { name: string; productCategoryId?: string }>;
  orderPlanLinks: import("@/types").OrderPlanLink[];
  orderItems: import("@/types").OrderItem[];
  orders: import("@/types").Order[];
  campaigns: import("@/types").Campaign[];
  doneKeysByPlan: Map<string, Set<string>>;
  focusTokens: string[];
}) {
  const {
    plans, lineItems, productionDays, orderedSteps,
    orderPlanLinks, orderItems, orders, campaigns,
    doneKeysByPlan, focusTokens,
  } = props;

  // ── Phase key from step name (mirrors WeekView). ────────────────
  function phaseKeyForStepName(name: string): string | null {
    const n = (name ?? "").toLowerCase().trim();
    if (n.includes("polish")) return "polishing";
    if (n.includes("paint") || n.includes("colour") || n.includes("color")) return "colour";
    if (n.includes("shell") || n.includes("temper")) return "shell";
    if (n.includes("filling prep") || n === "prep" || n.startsWith("prep")) return "filling";
    if (n.includes("fill")) return "fill";
    if (n.includes("cap")) return "cap";
    if (n.includes("unmould") || n.includes("unmold")) return "unmould";
    if (n.includes("pack")) return "packing";
    return null;
  }
  function isPhaseDoneForPlan(phase: string, planId: string): boolean {
    const set = doneKeysByPlan.get(planId);
    if (!set) return false;
    for (const k of set) {
      if (k === phase || k.startsWith(`${phase}-`)) return true;
    }
    return false;
  }

  const PHASE_ORDER = ["polishing", "colour", "shell", "filling", "fill", "cap", "unmould", "packing"];
  const PHASE_LABEL: Record<string, string> = {
    polishing: "Polish", colour: "Paint", shell: "Shell", filling: "Prep",
    fill: "Fill", cap: "Cap", unmould: "Unmould", packing: "Pack",
  };
  const PHASE_TINT: Record<string, { bg: string; ink: string }> = {
    polishing: { bg: "rgba(255,255,255,0.65)", ink: "#8a7030" },
    colour:    { bg: "rgba(255,255,255,0.65)", ink: "#9b4f48" },
    shell:     { bg: "rgba(255,255,255,0.65)", ink: "#9a6640" },
    filling:   { bg: "rgba(255,255,255,0.65)", ink: "#735a78" },
    fill:      { bg: "rgba(255,255,255,0.65)", ink: "#4b6b8f" },
    cap:       { bg: "rgba(255,255,255,0.65)", ink: "#5c7050" },
    unmould:   { bg: "rgba(255,255,255,0.65)", ink: "#4a7a5e" },
    packing:   { bg: "rgba(255,255,255,0.65)", ink: "#9b4f48" },
  };
  const SRC_COLOR: Record<"order" | "campaign" | "po", string> = {
    order: "#2b6cb0", campaign: "#6a3a8c", po: "#2e4839",
  };

  // ── 14-day window starting today (matches WeekView convention). ─
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const days: { iso: string; label: string; dd: string }[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const label = d.toLocaleDateString("de-AT", { weekday: "short" });
    const dd = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
    days.push({ iso, label, dd });
  }
  const winEndIso = days[days.length - 1].iso;

  const dayIdToIso = new Map<string, string>();
  for (const d of productionDays) {
    if (d.id) dayIdToIso.set(d.id, d.date);
  }
  const stepById = new Map(orderedSteps.map((s) => [s.id!, s]));

  // ── Build sources (campaign/PO/order) similar to ScheduledPanel. ─
  type SrcKind = "order" | "campaign" | "po";
  type Source = {
    token: string;
    label: string;
    sub: string;     // deadline / customer / size info
    kind: SrcKind;
    planIds: Set<string>;
    earliestIso: string;
    deadlineIso?: string;
    isOverdue: boolean;
    isShared: boolean;
  };

  const itemById = new Map(orderItems.map((i) => [i.id!, i]));
  const orderById = new Map(orders.map((o) => [o.id!, o]));
  const campaignByName = new Map(campaigns.map((c) => [c.name, c]));

  const sources = new Map<string, Source>();
  function ensureSrc(token: string, label: string, sub: string, kind: SrcKind, deadline?: string) {
    const cur = sources.get(token);
    if (cur) return cur;
    const fresh: Source = {
      token, label, sub, kind,
      planIds: new Set(),
      earliestIso: "9999-12-31",
      deadlineIso: deadline,
      isOverdue: !!deadline && deadline < todayIso,
      isShared: false,
    };
    sources.set(token, fresh);
    return fresh;
  }

  // First pass: determine which plans are in window.
  const planEarliestIso = new Map<string, string>();
  for (const li of lineItems) {
    const dayIso = dayIdToIso.get(li.productionDayId);
    if (!dayIso) continue;
    if (dayIso < todayIso || dayIso > winEndIso) continue;
    const cur = planEarliestIso.get(li.planId);
    if (!cur || dayIso < cur) planEarliestIso.set(li.planId, dayIso);
  }

  // Second pass: bind plans to sources.
  for (const planId of planEarliestIso.keys()) {
    const plan = plans.find((p) => p.id === planId);
    if (!plan) continue;
    const earliest = planEarliestIso.get(planId)!;
    const name = plan.name ?? "";
    if (name.startsWith("Campaign: ")) {
      const rest = name.slice("Campaign: ".length);
      const dash = rest.indexOf(" — ");
      const cName = dash > 0 ? rest.slice(0, dash) : rest;
      const camp = campaignByName.get(cName);
      const deadline = camp?.startDate;
      const src = ensureSrc(`campaign:${cName}`, `Camp · ${cName}`, deadline ? `due ${deadline}` : "", "campaign", deadline);
      src.planIds.add(planId);
      if (earliest < src.earliestIso) src.earliestIso = earliest;
    } else if (name.startsWith("PO: ")) {
      const rest = name.slice("PO: ".length);
      const dash = rest.indexOf(" — ");
      const poName = dash > 0 ? rest.slice(0, dash) : rest;
      // ProductionPlan has no own due date; PO sub line falls back to
      // plain "shop refill" tag — earliest scheduled day already
      // surfaces below the label as fallback subtitle.
      const src = ensureSrc(`po:${poName}`, `PO · ${poName}`, "shop refill", "po", undefined);
      src.planIds.add(planId);
      if (earliest < src.earliestIso) src.earliestIso = earliest;
    } else {
      // Order-driven; one row per linked order.
      const linkedOrderIds = new Set<string>();
      for (const link of orderPlanLinks) {
        if (link.planId !== planId) continue;
        const item = itemById.get(link.orderItemId);
        if (item) linkedOrderIds.add(item.orderId);
      }
      for (const oid of linkedOrderIds) {
        const order = orderById.get(oid);
        if (!order) continue;
        const ref = order.sourceRef ? `${order.sourceRef}` : (order.customerName || order.eventName || oid.slice(0, 6));
        // Order.deadline is a timestamptz string; trim to ISO date
        // (YYYY-MM-DD) so it lines up with the day grid keys.
        const deadline = order.deadline ? order.deadline.slice(0, 10) : undefined;
        const sub = order.customerName ? order.customerName : (deadline ? `due ${deadline}` : "");
        const src = ensureSrc(`order:${oid}`, `Order ${ref}`, sub, "order", deadline);
        src.planIds.add(planId);
        if (earliest < src.earliestIso) src.earliestIso = earliest;
      }
    }
  }

  // Mark sources that share a plan with another source.
  const sourcesByPlan = new Map<string, Set<string>>();
  for (const [token, src] of sources) {
    for (const pid of src.planIds) {
      const set = sourcesByPlan.get(pid) ?? new Set();
      set.add(token);
      sourcesByPlan.set(pid, set);
    }
  }
  for (const [pid, tokSet] of sourcesByPlan) {
    void pid;
    if (tokSet.size > 1) {
      for (const tok of tokSet) {
        const s = sources.get(tok);
        if (s) s.isShared = true;
      }
    }
  }

  // ── Sort: shared first, then overdue, then earliest, then label. ─
  const allSources = [...sources.values()].sort((a, b) => {
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    if (a.isShared !== b.isShared) return a.isShared ? -1 : 1;
    if (a.earliestIso !== b.earliestIso) return a.earliestIso.localeCompare(b.earliestIso);
    return a.label.localeCompare(b.label);
  });

  // ── Filter when focus is set: only show sources matching tokens. ─
  const focusedSources = focusTokens.length > 0
    ? allSources.filter((s) => focusTokens.includes(s.token))
    : allSources;

  // ── Build pivot cell map: token + dayIso → phase data. ──────────
  // Each phase entry tracks stepIds + planIds powering that pill so
  // drag-drop has a precise payload to move (plan-step pairs) instead
  // of guessing from the source's full plan list.
  type PhaseStat = {
    count: number;
    minutes: number;
    stepIds: Set<string>;
    planIds: Set<string>;
  };
  type Cell = { phases: Map<string, PhaseStat> };
  const cells = new Map<string, Cell>(); // key = token|iso

  for (const src of allSources) {
    for (const pid of src.planIds) {
      for (const li of lineItems) {
        if (li.planId !== pid) continue;
        const dayIso = dayIdToIso.get(li.productionDayId);
        if (!dayIso || dayIso < todayIso || dayIso > winEndIso) continue;
        const cellKey = `${src.token}|${dayIso}`;
        const cell = cells.get(cellKey) ?? { phases: new Map() };
        const stepIds: string[] = li.stepIds ?? [];
        for (const sid of stepIds) {
          const step = stepById.get(sid);
          if (!step) continue;
          const phase = phaseKeyForStepName(step.name);
          if (!phase) continue;
          const cur = cell.phases.get(phase) ?? {
            count: 0, minutes: 0, stepIds: new Set<string>(), planIds: new Set<string>(),
          };
          cur.count += 1;
          cur.minutes += Math.round(li.plannedMinutes / Math.max(1, stepIds.length));
          cur.stepIds.add(sid);
          cur.planIds.add(pid);
          cell.phases.set(phase, cur);
        }
        cells.set(cellKey, cell);
      }
    }
  }

  // ── Drag-drop wiring ────────────────────────────────────────────
  // Pill drag → cell drop. Payload carries plan-step pairs so the
  // server-side move call (moveProductionStepsToDate) only migrates
  // the dragged phase's stepIds, leaving the source's other phases
  // where they are. Mirrors WeekView's step-level drop semantics.
  // distance: 2 = pointer must travel >2px before drag arms. Lower
  // than the WeekView's 4 because pivot pills are smaller targets and
  // a longer threshold made drag feel unresponsive.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 2 } }));

  async function handleDragEnd(e: DragEndEvent) {
    if (!e.over) {
      console.warn("[pivot] drag ended over nothing");
      return;
    }
    const overId = String(e.over.id);
    if (!overId.startsWith("pivot-day:")) {
      console.warn("[pivot] drag ended over non-day target", overId);
      return;
    }
    const targetDate = overId.slice("pivot-day:".length);
    const data = e.active.data.current as
      | { planIds: string[]; stepIds: string[]; sourceDate: string; label: string }
      | undefined;
    if (!data || data.planIds.length === 0 || data.stepIds.length === 0) return;
    if (data.sourceDate === targetDate) return;

    // Apply the move immediately. The earlier modal-confirm pattern
    // was eating drops on the pivot — between dnd-kit, the table's
    // overflow scroll and the focus toggle the modal sometimes never
    // reached the user, so the drop fired but nothing persisted.
    // Direct apply with optimistic refetch keeps the action one
    // gesture. Lock is a separate affordance via the lock icon.
    const moves: Array<{ planId: string; stepId: string }> = [];
    for (const planId of data.planIds) {
      for (const stepId of data.stepIds) {
        moves.push({ planId, stepId });
      }
    }
    console.log(`[pivot] drop OK · ${data.label} → ${targetDate} · ${moves.length} (planId,stepId) pairs`);
    try {
      await moveProductionStepsToDate({ moves, targetDate });
      console.log(`[pivot] moveProductionStepsToDate completed`);
      await queryClient.invalidateQueries({ queryKey: ["production-day-line-items"] });
      await queryClient.invalidateQueries({ queryKey: ["production-days"] });
      // Force the pivot to wait for the refetch before re-rendering.
      // Without this, the cells map is recomputed from stale cache and
      // the pill snaps back into its original day until the next tick.
      await queryClient.refetchQueries({ queryKey: ["production-day-line-items"] });
      console.log(`[pivot] refetch done — UI should now reflect new day`);
    } catch (err) {
      console.error("[pivot] move failed:", err);
      alert(`Move failed: ${formatError(err)}`);
    }
  }

  // ── Click-to-expand state. Pill click toggles a popover-row showing
  //    the plans + mould counts + done state behind that pill. Single
  //    expansion at a time so the table doesn't bloat.
  const [expandedCellKey, setExpandedCellKey] = useState<string | null>(null);

  // ── Render. ─────────────────────────────────────────────────────
  const CARD_LOCAL = "bg-white/65 backdrop-blur-2xl border border-white/60 rounded-[18px] p-4 shadow-[0_1px_2px_rgba(16,18,24,0.04),0_8px_24px_rgba(16,18,24,0.05)]";

  if (focusedSources.length === 0) {
    return (
      <section className={`${CARD_LOCAL} text-center py-10`}>
        <p className="text-sm text-muted-foreground">
          No scheduled sources in the next 14 days{focusTokens.length > 0 ? " matching the focus filter" : ""}.
        </p>
      </section>
    );
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd} collisionDetection={closestCenter}>
    <section className={CARD_LOCAL}>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-baseline gap-2">
          <h2
            className="text-[18px]"
            style={{ fontFamily: "var(--font-serif)", fontWeight: 500, letterSpacing: "-0.012em" }}
          >
            Pivot · sources × days
          </h2>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {focusedSources.length} source{focusedSources.length === 1 ? "" : "s"} · 14 days
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full" style={{ background: SRC_COLOR.order }} />Order</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full" style={{ background: SRC_COLOR.campaign }} />Campaign</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full" style={{ background: SRC_COLOR.po }} />PO</span>
        </div>
      </div>

      <div className="overflow-x-auto -mx-2 px-2">
        <table className="w-full" style={{ borderCollapse: "separate", borderSpacing: "0 4px", minWidth: 1100 }}>
          <thead>
            <tr>
              <th
                className="text-left text-[11px] font-normal text-muted-foreground"
                style={{ paddingLeft: 12, paddingRight: 8, paddingBottom: 6, minWidth: 220 }}
              >
                Source
              </th>
              {days.map((d) => {
                const isToday = d.iso === todayIso;
                return (
                  <th
                    key={d.iso}
                    className="text-center text-[11px] font-normal text-muted-foreground"
                    style={{
                      padding: "4px 4px 6px",
                      minWidth: 64,
                      background: isToday ? "rgba(253,242,244,0.55)" : undefined,
                      borderRadius: isToday ? 8 : 0,
                    }}
                  >
                    <div
                      className="text-[13px]"
                      style={{ fontFamily: "var(--font-serif)", fontWeight: 500, color: isToday ? "#2e4839" : "#1c1d1f" }}
                    >
                      {d.label}
                    </div>
                    <div className="tabular-nums" style={{ fontSize: 10.5 }}>{d.dd}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {focusedSources.map((src) => {
              const accent = SRC_COLOR[src.kind];
              const rowBg = src.isShared ? "#e3ebe6" : "#fff";
              return (
                <tr key={src.token}>
                  <td
                    style={{
                      padding: "8px 10px",
                      background: rowBg,
                      borderRadius: "12px 0 0 12px",
                      borderLeft: `4px solid ${src.isShared ? "#4a6b5b" : accent}`,
                      verticalAlign: "top",
                    }}
                  >
                    <div className="flex items-baseline gap-1.5">
                      <span
                        className="inline-block rounded-full"
                        style={{ width: 7, height: 7, background: accent, marginTop: 4, alignSelf: "flex-start" }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          className="text-[13.5px] leading-tight"
                          style={{ fontFamily: "var(--font-serif)", fontWeight: 500 }}
                        >
                          {src.label}
                          {src.isShared && (
                            <span
                              className="ml-1.5 align-middle"
                              style={{
                                fontSize: 9.5, padding: "1px 6px", borderRadius: 999,
                                background: "#4a6b5b", color: "#ffffff", fontFamily: "system-ui",
                              }}
                            >
                              shared
                            </span>
                          )}
                        </div>
                        <div
                          className="text-[10.5px] mt-0.5"
                          style={{ color: src.isOverdue ? "#9b4f48" : "#8a8780", fontWeight: src.isOverdue ? 600 : 400 }}
                        >
                          {src.sub || `earliest ${src.earliestIso}`}
                        </div>
                      </div>
                    </div>
                  </td>
                  {days.map((d, dayIdx) => {
                    const isToday = d.iso === todayIso;
                    const isDeadline = src.deadlineIso === d.iso;
                    const cell = cells.get(`${src.token}|${d.iso}`);
                    const isLast = dayIdx === days.length - 1;
                    const phasesPresent = cell ? PHASE_ORDER.filter((p) => cell.phases.has(p)) : [];
                    return (
                      <td
                        key={d.iso}
                        style={{
                          padding: 4,
                          background: isToday ? "rgba(253,242,244,0.35)" : "rgba(255,255,255,0.45)",
                          borderRadius: isLast ? "0 12px 12px 0" : 0,
                          textAlign: "center",
                          verticalAlign: "top",
                          minWidth: 60,
                        }}
                      >
                        <PivotCellDrop iso={d.iso}>
                          <div className="flex flex-col gap-1 items-stretch">
                            {phasesPresent.map((phase) => {
                              const tint = PHASE_TINT[phase];
                              const stat = cell!.phases.get(phase)!;
                              const planList = [...src.planIds];
                              const allDone = planList.every((pid) => isPhaseDoneForPlan(phase, pid));
                              const dragId = `pivot:${src.token}|${d.iso}|${phase}`;
                              const payload = {
                                planIds: [...stat.planIds],
                                stepIds: [...stat.stepIds],
                                sourceDate: d.iso,
                                label: `${PHASE_LABEL[phase]} · ${src.label}`,
                              };
                              return (
                                <PivotPill
                                  key={phase}
                                  id={dragId}
                                  payload={payload}
                                  title={`${PHASE_LABEL[phase]} · ${stat.count} step${stat.count === 1 ? "" : "s"} · ${stat.minutes}m${allDone ? " · done" : ""}${isDeadline ? " · deadline" : ""} · click to expand · drag to move`}
                                  onClick={() => {
                                    const k = `${src.token}|${d.iso}|${phase}`;
                                    setExpandedCellKey((cur) => (cur === k ? null : k));
                                  }}
                                  style={{
                                    display: "inline-block",
                                    background: tint.bg,
                                    color: tint.ink,
                                    padding: "3px 6px",
                                    borderRadius: 6,
                                    fontSize: 10.5,
                                    lineHeight: 1.2,
                                    outline: expandedCellKey === `${src.token}|${d.iso}|${phase}`
                                      ? "2px solid #2e4839"
                                      : isDeadline ? "1.5px solid #2e4839" : undefined,
                                    outlineOffset: isDeadline || expandedCellKey === `${src.token}|${d.iso}|${phase}` ? 1 : undefined,
                                    opacity: allDone ? 0.4 : 1,
                                    textDecoration: allDone ? "line-through" : undefined,
                                    fontWeight: 500,
                                  }}
                                >
                                  {PHASE_LABEL[phase]}
                                </PivotPill>
                              );
                            })}
                            {phasesPresent.length === 0 && isDeadline && (
                              <span
                                style={{
                                  display: "inline-block",
                                  fontSize: 9.5, padding: "2px 6px", borderRadius: 6,
                                  outline: "1.5px solid #2e4839",
                                  color: "#2e4839",
                                }}
                              >
                                due
                              </span>
                            )}
                          </div>
                        </PivotCellDrop>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {expandedCellKey && (() => {
              const [token, iso, phase] = expandedCellKey.split("|");
              const cell = cells.get(`${token}|${iso}`);
              const stat = cell?.phases.get(phase);
              const src = focusedSources.find((s) => s.token === token);
              if (!stat || !src) return null;
              const tint = PHASE_TINT[phase] ?? { bg: "#fff", ink: "#1c1d1f" };
              const planList = [...stat.planIds];
              return (
                <tr key="pivot-expand">
                  <td colSpan={1 + days.length} style={{ padding: 0 }}>
                    <div
                      style={{
                        margin: "2px 0 6px",
                        padding: "10px 14px",
                        background: tint.bg,
                        color: tint.ink,
                        borderRadius: 10,
                        border: "1px solid rgba(0,0,0,0.06)",
                      }}
                    >
                      <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
                        <div
                          className="text-[14px]"
                          style={{ fontFamily: "var(--font-serif)", fontWeight: 500 }}
                        >
                          {PHASE_LABEL[phase]} · {src.label} · {iso}
                        </div>
                        <div className="text-[11px] opacity-80 tabular-nums">
                          {stat.count} step{stat.count === 1 ? "" : "s"} · ~{stat.minutes}m · {planList.length} plan{planList.length === 1 ? "" : "s"}
                        </div>
                        <button
                          type="button"
                          onClick={() => setExpandedCellKey(null)}
                          className="text-[11px] underline opacity-75 hover:opacity-100"
                        >
                          close
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {planList.map((pid) => {
                          const plan = plans.find((p) => p.id === pid);
                          const done = isPhaseDoneForPlan(phase, pid);
                          const pinned = !!plan?.pinnedDate;
                          return (
                            <span
                              key={pid}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11.5px]"
                              style={{
                                background: "rgba(255,255,255,0.7)",
                                borderColor: "rgba(0,0,0,0.08)",
                                color: tint.ink,
                                opacity: done ? 0.55 : 1,
                                textDecoration: done ? "line-through" : undefined,
                              }}
                            >
                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  try {
                                    if (pinned) await unpinProductionPlan(pid);
                                    else await pinProductionPlans([pid]);
                                  } catch (err) {
                                    alert(err instanceof Error ? err.message : "Toggle failed");
                                  }
                                }}
                                title={
                                  pinned
                                    ? `Pinned to ${plan?.pinnedDate} — click to unpin`
                                    : "Click to lock to current day"
                                }
                                className={pinned ? "text-[#2e4839]" : "opacity-40 hover:opacity-100"}
                              >
                                <Lock className="w-3 h-3" />
                              </button>
                              <Link
                                href={`/production/${pid}?from=plan`}
                                className="inline-flex items-center gap-1 hover:opacity-90"
                                style={{ color: tint.ink }}
                              >
                                <span style={{ fontFamily: "var(--font-serif)", fontWeight: 500 }}>
                                  {plan?.batchNumber || (plan?.name ?? pid.slice(0, 6))}
                                </span>
                                <span className="opacity-65">→ wizard</span>
                              </Link>
                            </span>
                          );
                        })}
                      </div>
                      <p className="text-[10.5px] mt-2 opacity-70">
                        Click a batch to open the wizard where you tick the step done. Drag the pill above to move this phase to another day.
                      </p>
                    </div>
                  </td>
                </tr>
              );
            })()}
          </tbody>
        </table>
      </div>

      <p className="text-[10.5px] text-muted-foreground mt-3">
        Each row reads left-to-right as one source's pipeline through the next 14 days.
        Pink rows share a batch with at least one other source. Outlined cell = source's deadline.
        Drag a phase pill onto another day in the row to move it.
      </p>
    </section>
    </DndContext>
  );
}

// ─── Month view drag-drop sub-components ──────────────────────────
// Hoisted to module scope so dnd-kit registrations survive React
// re-renders inside MonthView (same gotcha that broke the pivot
// drag earlier).

function MonthDragHandle({
  id, payload, children,
}: {
  id: string;
  payload: { planIds: string[]; stepIds: string[]; sourceDate: string; label: string };
  children: (args: { setNodeRef: (n: HTMLElement | null) => void; listeners: Record<string, unknown>; attributes: Record<string, unknown>; isDragging: boolean; transform: { x: number; y: number } | null }) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, data: payload });
  return <>{children({
    setNodeRef,
    listeners: (listeners ?? {}) as unknown as Record<string, unknown>,
    attributes: attributes as unknown as Record<string, unknown>,
    isDragging,
    transform: transform ? { x: transform.x, y: transform.y } : null,
  })}</>;
}

function MonthDayDrop({
  iso, children,
}: {
  iso: string;
  children: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `month-day:${iso}` });
  return (
    <div
      ref={setNodeRef}
      className="rounded-[14px] p-4"
      style={{
        background: isOver ? "rgba(246,198,203,0.45)" : "rgba(255,255,255,0.85)",
        border: isOver ? "2px solid #2e4839" : "1px solid var(--border)",
        transition: "background-color 80ms ease, border-color 80ms ease",
      }}
    >
      {children}
    </div>
  );
}

// Calendar cells double as drop targets so the operator can drag a
// chip out of the right pane and drop it directly onto any day in
// the grid — no need to first open the destination day in the
// right pane. Same id prefix as MonthDayDrop so handleDragEnd's
// `month-day:<iso>` parser handles both.
function CalendarCellDrop({
  iso, onClick, children, baseStyle,
}: {
  iso: string;
  onClick: () => void;
  children: React.ReactNode;
  baseStyle: React.CSSProperties;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `month-day:${iso}` });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      className="text-left rounded-[10px] p-1.5 transition border"
      style={{
        ...baseStyle,
        ...(isOver ? {
          background: "rgba(246,198,203,0.55)",
          borderColor: "#2e4839",
          borderWidth: 2,
        } : {}),
      }}
    >
      {children}
    </button>
  );
}

// ─── Month view ─────────────────────────────────────────────────────
//
// Compact 5×7 calendar on the left. Clicking a day opens a detail
// card on the right; clicking another day stacks a second card below
// it so the operator can compare two days side-by-side. Cards list:
//   - must-do orders (overdue / due that day) marked with a pink rule
//   - other deadlines (orders, campaigns, POs) ending that day
//   - production batches scheduled that day, grouped by phase
// Source-filter chips (focusTokens) narrow what shows up everywhere.
function MonthView(props: {
  plans: import("@/types").ProductionPlan[];
  lineItems: import("@/types").ProductionDayLineItem[];
  productionDays: import("@/types").ProductionDay[];
  orderedSteps: import("@/types").ProductionStep[];
  planProductsByPlan: Map<string, import("@/types").PlanProduct[]>;
  productMap: Map<string, { name: string; productCategoryId?: string }>;
  orderPlanLinks: import("@/types").OrderPlanLink[];
  orderItems: import("@/types").OrderItem[];
  orders: import("@/types").Order[];
  campaigns: import("@/types").Campaign[];
  doneKeysByPlan: Map<string, Set<string>>;
  focusTokens: string[];
  blockedDays: import("@/types").EventCalendarEntry[];
  config: import("@/types").CapacityConfig | null;
}) {
  const {
    plans, lineItems, productionDays, orderedSteps,
    orderPlanLinks, orderItems, orders, campaigns,
    doneKeysByPlan, focusTokens, blockedDays,
  } = props;
  void campaigns; void props.planProductsByPlan; void props.productMap; void props.config;

  // ── Phase mapping (mirrors the Pivot/Week views). ────────────────
  function phaseKeyForStepName(name: string): string | null {
    const n = (name ?? "").toLowerCase().trim();
    if (n.includes("polish")) return "polishing";
    if (n.includes("paint") || n.includes("colour") || n.includes("color")) return "colour";
    if (n.includes("shell") || n.includes("temper")) return "shell";
    if (n.includes("filling prep") || n === "prep" || n.startsWith("prep")) return "filling";
    if (n.includes("fill")) return "fill";
    if (n.includes("cap")) return "cap";
    if (n.includes("unmould") || n.includes("unmold")) return "unmould";
    if (n.includes("pack")) return "packing";
    return null;
  }
  const PHASE_ORDER = ["polishing", "colour", "shell", "filling", "fill", "cap", "unmould", "packing"];
  const PHASE_LABEL: Record<string, string> = {
    polishing: "Polish", colour: "Paint", shell: "Shell", filling: "Prep",
    fill: "Fill", cap: "Cap", unmould: "Unmould", packing: "Pack",
  };
  const PHASE_TINT: Record<string, { bg: string; ink: string }> = {
    polishing: { bg: "rgba(255,255,255,0.65)", ink: "#8a7030" },
    colour:    { bg: "rgba(255,255,255,0.65)", ink: "#9b4f48" },
    shell:     { bg: "rgba(255,255,255,0.65)", ink: "#9a6640" },
    filling:   { bg: "rgba(255,255,255,0.65)", ink: "#735a78" },
    fill:      { bg: "rgba(255,255,255,0.65)", ink: "#4b6b8f" },
    cap:       { bg: "rgba(255,255,255,0.65)", ink: "#5c7050" },
    unmould:   { bg: "rgba(255,255,255,0.65)", ink: "#4a7a5e" },
    packing:   { bg: "rgba(255,255,255,0.65)", ink: "#9b4f48" },
  };
  const SRC_COLOR: Record<"order" | "campaign" | "po", string> = {
    order: "#2b6cb0", campaign: "#6a3a8c", po: "#2e4839",
  };

  // ── Month navigation. monthOffset 0 = current. ──────────────────
  const [monthOffset, setMonthOffset] = useState(0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const focusMonth = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const monthLabel = focusMonth.toLocaleDateString("de-AT", { month: "long", year: "numeric" });

  // Compute first Monday on or before the 1st.
  const firstOfMonth = new Date(focusMonth);
  firstOfMonth.setHours(0, 0, 0, 0);
  const firstDow = firstOfMonth.getDay() === 0 ? 7 : firstOfMonth.getDay();
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - (firstDow - 1));
  // Build 6 weeks (42 cells) so months that span 6 rows fit; we trim
  // empty trailing rows.
  type CalDay = { iso: string; date: Date; inMonth: boolean; isToday: boolean; isClosed: boolean };
  const cells: CalDay[] = [];
  // Blocked days span [startDate, endDate]. Expand into a per-iso set
  // so closed-cell hatching marks every day in the range.
  const blockedSet = new Set<string>();
  for (const b of blockedDays) {
    if (b.kind !== "blocked" && b.kind !== "holiday") continue;
    const start = new Date(b.startDate + "T00:00:00");
    const end = new Date(b.endDate + "T00:00:00");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      blockedSet.add(iso);
    }
  }
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const inMonth = d.getMonth() === focusMonth.getMonth();
    const dow = d.getDay();
    const isWeekend = dow === 0 || dow === 6;
    cells.push({ iso, date: d, inMonth, isToday: iso === todayIso, isClosed: blockedSet.has(iso) || isWeekend });
  }
  // Trim trailing all-out-of-month rows.
  while (cells.length > 35 && cells.slice(-7).every((c) => !c.inMonth)) {
    cells.splice(cells.length - 7, 7);
  }

  // ── Build per-day source + batch maps. ───────────────────────────
  const itemById = new Map(orderItems.map((i) => [i.id!, i]));
  const orderById = new Map(orders.map((o) => [o.id!, o]));
  const stepById = new Map(orderedSteps.map((s) => [s.id!, s]));

  const dayIdToIso = new Map<string, string>();
  for (const d of productionDays) {
    if (d.id) dayIdToIso.set(d.id, d.date);
  }

  type SourceRow = {
    token: string;
    label: string;
    kind: "order" | "campaign" | "po";
    qty?: number;
    subline?: string;
    isMustDo: boolean;
  };

  // Apply source-filter (focusTokens) to a candidate token. If no
  // tokens selected, accept everything.
  function passesFilter(token: string): boolean {
    if (focusTokens.length === 0) return true;
    return focusTokens.includes(token);
  }

  // Deadlines per day — from open orders + campaigns. Must-do = an
  // order whose deadline is overdue (< today) or === today.
  const sourcesByDay = new Map<string, SourceRow[]>();
  for (const o of orders) {
    if (o.status === "done" || o.status === "cancelled") continue;
    if (!o.deadline) continue;
    const iso = o.deadline.slice(0, 10);
    const token = `order:${o.id}`;
    if (!passesFilter(token)) continue;
    const ref = o.sourceRef ? `${o.sourceRef}` : (o.customerName || o.eventName || (o.id ?? "").slice(0, 6));
    const items = orderItems.filter((it) => it.orderId === o.id);
    const qty = items.reduce((s, it) => s + (it.quantity ?? 0), 0);
    const arr = sourcesByDay.get(iso) ?? [];
    arr.push({
      token, label: `Order ${ref}`, kind: "order", qty,
      subline: o.customerName || o.eventName,
      isMustDo: iso <= todayIso,
    });
    sourcesByDay.set(iso, arr);
  }
  for (const c of campaigns) {
    if (!c.startDate) continue;
    const iso = c.startDate;
    const token = `campaign:${c.name}`;
    if (!passesFilter(token)) continue;
    const arr = sourcesByDay.get(iso) ?? [];
    arr.push({
      token, label: `Camp · ${c.name}`, kind: "campaign",
      qty: c.targetTotalUnits,
      subline: c.endDate ? `runs to ${c.endDate}` : undefined,
      isMustDo: iso <= todayIso,
    });
    sourcesByDay.set(iso, arr);
  }
  // POs: derive due date from any plan named `PO: <po> — *` whose
  // earliest scheduled day = the deadline. Crude but consistent.
  // We'll surface POs at the day of their earliest scheduled batch.
  for (const plan of plans) {
    const name = plan.name ?? "";
    if (!name.startsWith("PO: ")) continue;
    const rest = name.slice("PO: ".length);
    const dash = rest.indexOf(" — ");
    const poName = dash > 0 ? rest.slice(0, dash) : rest;
    const token = `po:${poName}`;
    if (!passesFilter(token)) continue;
    let earliest: string | null = null;
    for (const li of lineItems) {
      if (li.planId !== plan.id) continue;
      const iso = dayIdToIso.get(li.productionDayId);
      if (!iso) continue;
      if (!earliest || iso < earliest) earliest = iso;
    }
    if (!earliest) continue;
    const arr = sourcesByDay.get(earliest) ?? [];
    if (!arr.some((s) => s.token === token)) {
      arr.push({
        token, label: `PO · ${poName}`, kind: "po",
        subline: "shop refill",
        isMustDo: false,
      });
      sourcesByDay.set(earliest, arr);
    }
  }

  // Production batches per day → per-phase plan list. Stored as a
  // Map<phaseKey, Set<planId>> so the right pane can render each
  // batch with its source attribution (which order / campaign / PO
  // it belongs to) — operator scheduling June needs to see "this
  // Paint batch is for Vatertag", not just "Paint · 2 batches".
  const phasePlansByDay = new Map<string, Map<string, Set<string>>>();
  const planIdsByDay = new Map<string, Set<string>>();
  // Source filter on plans: when focusTokens is set, restrict plans to
  // those linked to a selected token (order/campaign/po).
  const allowedPlanIds: Set<string> | null = (() => {
    if (focusTokens.length === 0) return null;
    const ids = new Set<string>();
    for (const tok of focusTokens) {
      const sep = tok.indexOf(":");
      const kind = tok.slice(0, sep);
      const value = tok.slice(sep + 1);
      if (kind === "order") {
        const itemIds = new Set(orderItems.filter((it) => it.orderId === value).map((it) => it.id!));
        for (const link of orderPlanLinks) {
          if (itemIds.has(link.orderItemId)) ids.add(link.planId);
        }
      } else if (kind === "campaign") {
        const prefix = `Campaign: ${value} —`;
        for (const p of plans) if (p.id && (p.name ?? "").startsWith(prefix)) ids.add(p.id);
      } else if (kind === "po") {
        const prefix = `PO: ${value} —`;
        for (const p of plans) if (p.id && (p.name ?? "").startsWith(prefix)) ids.add(p.id);
      }
    }
    return ids;
  })();

  for (const li of lineItems) {
    const iso = dayIdToIso.get(li.productionDayId);
    if (!iso) continue;
    if (allowedPlanIds && !allowedPlanIds.has(li.planId)) continue;
    const planSet = planIdsByDay.get(iso) ?? new Set();
    planSet.add(li.planId);
    planIdsByDay.set(iso, planSet);

    const phaseMap = phasePlansByDay.get(iso) ?? new Map<string, Set<string>>();
    const seenPhasesForLi = new Set<string>();
    for (const sid of li.stepIds ?? []) {
      const step = stepById.get(sid);
      if (!step) continue;
      const phase = phaseKeyForStepName(step.name);
      if (!phase) continue;
      if (seenPhasesForLi.has(phase)) continue;
      seenPhasesForLi.add(phase);
      const set = phaseMap.get(phase) ?? new Set<string>();
      set.add(li.planId);
      phaseMap.set(phase, set);
    }
    phasePlansByDay.set(iso, phaseMap);
  }

  // Resolve each plan to its source label (Order / Campaign / PO).
  // Used in day cards so each batch row reads e.g. "Hazelnut Crunch
  // — for #4422 Spar Café".
  function resolveSourceForPlan(planId: string): { label: string; kind: "order" | "campaign" | "po" } | null {
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return null;
    const name = plan.name ?? "";
    if (name.startsWith("Campaign: ")) {
      const rest = name.slice("Campaign: ".length);
      const dash = rest.indexOf(" — ");
      const cName = dash > 0 ? rest.slice(0, dash) : rest;
      return { label: `Camp · ${cName}`, kind: "campaign" };
    }
    if (name.startsWith("PO: ")) {
      const rest = name.slice("PO: ".length);
      const dash = rest.indexOf(" — ");
      const poName = dash > 0 ? rest.slice(0, dash) : rest;
      return { label: `PO · ${poName}`, kind: "po" };
    }
    // Order-driven: find first linked order.
    for (const link of orderPlanLinks) {
      if (link.planId !== planId) continue;
      const item = itemById.get(link.orderItemId);
      if (!item) continue;
      const order = orderById.get(item.orderId);
      if (!order) continue;
      const ref = order.sourceRef ? `${order.sourceRef}` : (order.customerName || order.eventName || (order.id ?? "").slice(0, 6));
      return { label: `Order ${ref}`, kind: "order" };
    }
    return null;
  }
  // Plan id → product name from the first plan-product linked. Used
  // as the human-readable batch label (operator thinks "Hazelnut",
  // not "DUL-2026-04-29-001").
  function resolveProductLabelForPlan(planId: string): string {
    const pps = props.planProductsByPlan.get(planId) ?? [];
    if (pps.length === 0) return "Batch";
    if (pps.length === 1) {
      return props.productMap.get(pps[0].productId)?.name ?? "Batch";
    }
    return `Mixed (${pps.length})`;
  }

  // ── Right-pane state: open days + nav. ───────────────────────────
  const [openIsos, setOpenIsos] = useState<string[]>([todayIso]);
  function toggleDay(iso: string) {
    setOpenIsos((cur) => {
      if (cur.includes(iso)) return cur.filter((x) => x !== iso);
      return [...cur, iso];
    });
  }

  // Per-phase expand/collapse inside each open day card. Keyed by
  // `${iso}|${phase}`. Default collapsed — operator opens only the
  // phase she cares about, no scrolling through 30 batch lines.
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());
  function togglePhase(iso: string, phase: string) {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      const k = `${iso}|${phase}`;
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }
  // Same for the deadline lists (must-do + others). Bulk-collapsed
  // when >6 entries; chip header shows count.
  const [expandedSection, setExpandedSection] = useState<Set<string>>(new Set());
  function toggleSection(iso: string, key: string) {
    setExpandedSection((prev) => {
      const next = new Set(prev);
      const k = `${iso}|${key}`;
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  // ── Drag-drop wiring. Both the phase header and the individual
  //    batch rows in the right-pane day cards are draggable; every
  //    open day card is a drop target. Drop target id is
  //    `month-day:<targetIso>`. Payload carries (planId, stepIds[])
  //    so moveProductionStepsToDate migrates exactly the dragged
  //    phase's steps for the dragged plan(s) — same semantics as
  //    the pivot view.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 2 } }));

  function stepIdsForPhaseOnDay(planId: string, phase: string, sourceIso: string): string[] {
    const out: string[] = [];
    for (const li of lineItems) {
      if (li.planId !== planId) continue;
      const liIso = dayIdToIso.get(li.productionDayId);
      if (liIso !== sourceIso) continue;
      for (const sid of li.stepIds ?? []) {
        const step = stepById.get(sid);
        if (!step) continue;
        if (phaseKeyForStepName(step.name) === phase) out.push(sid);
      }
    }
    return out;
  }

  async function handleDragEnd(e: DragEndEvent) {
    if (!e.over) {
      console.warn("[month] drag ended over nothing");
      return;
    }
    const overId = String(e.over.id);
    console.log(`[month] drag ended over: ${overId}`);
    if (!overId.startsWith("month-day:")) {
      console.warn("[month] drag ended over non-day target", overId);
      return;
    }
    const targetDate = overId.slice("month-day:".length);
    const data = e.active.data.current as
      | { planIds: string[]; stepIds: string[]; sourceDate: string; label: string }
      | undefined;
    if (!data || data.planIds.length === 0 || data.stepIds.length === 0) {
      console.warn("[month] drag payload missing plans/steps", data);
      return;
    }
    if (data.sourceDate === targetDate) {
      console.log(`[month] same-day drop, ignoring`);
      return;
    }
    const moves: Array<{ planId: string; stepId: string }> = [];
    for (const planId of data.planIds) {
      for (const stepId of data.stepIds) {
        moves.push({ planId, stepId });
      }
    }
    console.log(`[month] drop OK · ${data.label} · ${data.sourceDate} → ${targetDate} · ${moves.length} (planId,stepId) pairs`);
    try {
      await moveProductionStepsToDate({ moves, targetDate });
      console.log(`[month] moveProductionStepsToDate completed`);
      await queryClient.invalidateQueries({ queryKey: ["production-day-line-items"] });
      await queryClient.invalidateQueries({ queryKey: ["production-days"] });
      await queryClient.refetchQueries({ queryKey: ["production-day-line-items"] });
      console.log(`[month] refetch done`);
      setOpenIsos((cur) => (cur.includes(targetDate) ? cur : [...cur, targetDate]));
    } catch (err) {
      console.error("[month] move failed:", err);
      alert(`Move failed: ${formatError(err)}`);
    }
  }

  // ── Render. ─────────────────────────────────────────────────────
  const CARD_LOCAL = "bg-white/65 backdrop-blur-2xl border border-white/60 rounded-[18px] p-4 shadow-[0_1px_2px_rgba(16,18,24,0.04),0_8px_24px_rgba(16,18,24,0.05)]";

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd} collisionDetection={pointerWithin}>
    <section className={CARD_LOCAL}>
      {/* Toolbar — month nav + legend */}
      <div className="flex items-baseline gap-3 mb-3 flex-wrap">
        <h2
          className="text-[18px]"
          style={{ fontFamily: "var(--font-serif)", fontWeight: 500, letterSpacing: "-0.012em" }}
        >
          Month · {monthLabel}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMonthOffset((m) => m - 1)}
            className="text-[11px] px-2 py-0.5 rounded-full border border-border hover:bg-muted/40"
          >
            ‹ prev
          </button>
          <button
            type="button"
            onClick={() => setMonthOffset(0)}
            className="text-[11px] px-2 py-0.5 rounded-full border border-border hover:bg-muted/40"
          >
            today
          </button>
          <button
            type="button"
            onClick={() => setMonthOffset((m) => m + 1)}
            className="text-[11px] px-2 py-0.5 rounded-full border border-border hover:bg-muted/40"
          >
            next ›
          </button>
        </div>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full" style={{ background: SRC_COLOR.order }} />Order</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full" style={{ background: SRC_COLOR.campaign }} />Campaign</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full" style={{ background: SRC_COLOR.po }} />PO</span>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        {/* LEFT: calendar */}
        <div>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="text-center text-[10px] text-muted-foreground uppercase" style={{ letterSpacing: "0.14em" }}>
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((c) => {
              const sources = sourcesByDay.get(c.iso) ?? [];
              const phaseMap = phasePlansByDay.get(c.iso);
              const totalBatches = planIdsByDay.get(c.iso)?.size ?? 0;
              const hasMustDo = sources.some((s) => s.isMustDo);
              const isOpen = openIsos.includes(c.iso);
              const dimmed = !c.inMonth;
              const closed = c.isClosed;
              return (
                <CalendarCellDrop
                  key={c.iso}
                  iso={c.iso}
                  onClick={() => toggleDay(c.iso)}
                  baseStyle={{
                    background: closed
                      ? "repeating-linear-gradient(45deg, rgba(0,0,0,.02), rgba(0,0,0,.02) 5px, rgba(0,0,0,.04) 5px, rgba(0,0,0,.04) 10px)"
                      : c.isToday
                      ? "rgba(253,242,244,0.7)"
                      : "rgba(255,255,255,0.7)",
                    borderColor: isOpen ? "#2e4839" : c.isToday ? "#4a6b5b" : "rgba(255,255,255,0.6)",
                    borderStyle: closed ? "dashed" : "solid",
                    borderWidth: isOpen ? 2 : 1,
                    opacity: dimmed ? 0.45 : 1,
                    minHeight: 76,
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                  }}
                >
                  <div className="flex items-baseline justify-between">
                    <span
                      style={{
                        fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 14,
                        color: c.isToday ? "#2e4839" : "#1c1d1f",
                      }}
                    >
                      {c.date.getDate()}
                    </span>
                    {totalBatches > 0 && (
                      <span className="text-[9.5px] text-muted-foreground tabular-nums">
                        {totalBatches}b
                      </span>
                    )}
                  </div>
                  {sources.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {sources.slice(0, 4).map((s, i) => (
                        <span
                          key={`${s.token}-${i}`}
                          className="inline-block rounded-full"
                          style={{
                            width: 6, height: 6,
                            background: SRC_COLOR[s.kind],
                            outline: s.isMustDo ? "1.5px solid #2e4839" : undefined,
                            outlineOffset: 1,
                          }}
                        />
                      ))}
                      {sources.length > 4 && (
                        <span className="text-[9px] text-muted-foreground">+{sources.length - 4}</span>
                      )}
                    </div>
                  )}
                  {phaseMap && phaseMap.size > 0 && (
                    <div className="flex flex-wrap gap-0.5 mt-auto">
                      {PHASE_ORDER.filter((p) => phaseMap.has(p)).slice(0, 5).map((p) => {
                        const tint = PHASE_TINT[p];
                        return (
                          <span
                            key={p}
                            title={`${PHASE_LABEL[p]} · ${phaseMap.get(p)?.size ?? 0} batches`}
                            style={{
                              display: "inline-block",
                              width: 12, height: 4,
                              borderRadius: 2,
                              background: tint.bg,
                              border: `0.5px solid ${tint.ink}`,
                              opacity: 0.8,
                            }}
                          />
                        );
                      })}
                    </div>
                  )}
                  {hasMustDo && (
                    <span
                      className="text-[9px]"
                      style={{ color: "#2e4839", fontWeight: 500 }}
                    >
                      ⚠ must-do
                    </span>
                  )}
                </CalendarCellDrop>
              );
            })}
          </div>
          <p className="text-[10.5px] text-muted-foreground mt-2">
            Click any day to open it in the right pane. Click another day to stack a second card. Pink-outlined cells are open. Drag a chip from the right pane onto a calendar day to move it.
          </p>
        </div>

        {/* RIGHT: stacked open day cards */}
        <div className="flex flex-col gap-2.5">
          {openIsos.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-center">
              <p className="text-[13px] text-muted-foreground max-w-[260px]">
                Click a day on the left to see its deadlines, must-dos, and production batches.
              </p>
            </div>
          ) : openIsos.map((iso) => {
            const dateObj = new Date(iso + "T00:00:00");
            const sources = sourcesByDay.get(iso) ?? [];
            const mustDo = sources.filter((s) => s.isMustDo);
            const others = sources.filter((s) => !s.isMustDo);
            const phaseMap = phasePlansByDay.get(iso);
            const totalBatches = planIdsByDay.get(iso)?.size ?? 0;
            const isToday = iso === todayIso;
            const dayLabel = dateObj.toLocaleDateString("de-AT", { weekday: "long", day: "2-digit", month: "long" });

            return (
              <MonthDayDrop key={iso} iso={iso}>
                <div className="flex items-baseline gap-2 mb-2 pb-2" style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                  <span
                    style={{
                      fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 22,
                      letterSpacing: "-0.012em",
                      color: isToday ? "#2e4839" : "#1c1d1f",
                    }}
                  >
                    {dayLabel}
                  </span>
                  {isToday && (
                    <span
                      className="text-[10px] uppercase px-2 py-0.5 rounded-full"
                      style={{ background: "#e3ebe6", color: "#2e4839", letterSpacing: "0.08em" }}
                    >
                      today
                    </span>
                  )}
                  <span className="ml-auto text-[10.5px] text-muted-foreground">
                    {totalBatches} batch{totalBatches === 1 ? "" : "es"}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleDay(iso)}
                    className="text-muted-foreground hover:text-foreground text-[16px] leading-none px-1"
                    title="Close"
                  >
                    ×
                  </button>
                </div>

                {mustDo.length > 0 && (() => {
                  const expanded = expandedSection.has(`${iso}|must-do`);
                  return (
                    <div className="mb-3">
                      <button
                        type="button"
                        onClick={() => toggleSection(iso, "must-do")}
                        className="w-full flex items-baseline gap-1.5 text-left text-[10px] uppercase mb-1.5 hover:opacity-80"
                        style={{ letterSpacing: "0.1em", color: "#2e4839" }}
                      >
                        <span className="opacity-70">{expanded ? "▾" : "▸"}</span>
                        <span style={{ fontWeight: 600 }}>Must do · {mustDo.length}</span>
                      </button>
                      {expanded && (
                        <ul className="space-y-1" style={{ listStyle: "none", padding: 0 }}>
                          {mustDo.map((s) => (
                            <li
                              key={s.token}
                              className="flex items-baseline gap-2 px-2 py-1.5 rounded-[6px]"
                              style={{
                                background: "#e3ebe6",
                                borderLeft: "2px solid #2e4839",
                              }}
                            >
                              <span
                                className="inline-block rounded-full"
                                style={{ width: 7, height: 7, background: SRC_COLOR[s.kind], marginTop: 4, alignSelf: "flex-start" }}
                              />
                              <div className="flex-1 min-w-0">
                                <div style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 13.5, color: "#2e4839" }}>
                                  {s.label}
                                  {s.qty != null && <span className="opacity-70 font-normal ml-1.5 text-[11px]">{s.qty} pcs</span>}
                                </div>
                                {s.subline && (
                                  <div className="text-[10.5px]" style={{ color: "#2e4839", opacity: 0.85 }}>{s.subline}</div>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })()}

                {others.length > 0 && (() => {
                  const expanded = expandedSection.has(`${iso}|deadlines`);
                  return (
                    <div className="mb-3">
                      <button
                        type="button"
                        onClick={() => toggleSection(iso, "deadlines")}
                        className="w-full flex items-baseline gap-1.5 text-left text-[10px] uppercase mb-1.5 text-muted-foreground hover:text-foreground"
                        style={{ letterSpacing: "0.1em" }}
                      >
                        <span className="opacity-70">{expanded ? "▾" : "▸"}</span>
                        <span>Deadlines · {others.length}</span>
                      </button>
                      {expanded && (
                        <ul className="space-y-0.5" style={{ listStyle: "none", padding: 0 }}>
                          {others.map((s) => (
                            <li key={s.token} className="flex items-baseline gap-2 px-2 py-1 rounded-[6px]">
                              <span
                                className="inline-block rounded-full"
                                style={{ width: 7, height: 7, background: SRC_COLOR[s.kind], marginTop: 4, alignSelf: "flex-start" }}
                              />
                              <div className="flex-1 min-w-0">
                                <span style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 13 }}>{s.label}</span>
                                {s.qty != null && <span className="opacity-70 ml-1.5 text-[11px]">{s.qty} pcs</span>}
                                {s.subline && <span className="opacity-70 ml-1.5 text-[10.5px]">· {s.subline}</span>}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })()}

                {phaseMap && phaseMap.size > 0 ? (
                  <>
                    <p className="text-[10px] uppercase text-muted-foreground mb-1.5" style={{ letterSpacing: "0.1em" }}>
                      Production batches · {totalBatches}
                    </p>
                    <div className="space-y-1">
                      {PHASE_ORDER.filter((p) => phaseMap.has(p)).map((p) => {
                        const tint = PHASE_TINT[p];
                        const planSet = phaseMap.get(p)!;
                        const expanded = expandedPhases.has(`${iso}|${p}`);
                        // Aggregate stepIds for this phase across every
                        // plan running it on this day. The "drag whole
                        // phase" handle moves all of them together.
                        const phaseStepIds: string[] = [];
                        const phasePlanIds: string[] = [];
                        for (const pid of planSet) {
                          const sids = stepIdsForPhaseOnDay(pid, p, iso);
                          if (sids.length === 0) continue;
                          phasePlanIds.push(pid);
                          for (const sid of sids) phaseStepIds.push(sid);
                        }
                        return (
                          <div
                            key={p}
                            className="rounded-[8px]"
                            style={{ background: expanded ? tint.bg : "transparent" }}
                          >
                            {/* Phase header — draggable handle */}
                            <MonthDragHandle
                              id={`month-phase:${iso}:${p}`}
                              payload={{
                                planIds: phasePlanIds,
                                stepIds: phaseStepIds,
                                sourceDate: iso,
                                label: `${PHASE_LABEL[p]} · ${planSet.size} batch${planSet.size === 1 ? "" : "es"}`,
                              }}
                            >
                              {({ setNodeRef, listeners, attributes, isDragging, transform }) => (
                                <div
                                  ref={setNodeRef}
                                  {...attributes}
                                  className="flex items-center gap-2 rounded-[8px] hover:opacity-90 transition"
                                  style={{
                                    color: tint.ink,
                                    background: expanded ? "transparent" : tint.bg,
                                    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
                                    zIndex: isDragging ? 50 : undefined,
                                    position: isDragging ? "relative" : undefined,
                                    pointerEvents: isDragging ? "none" : undefined,
                                    opacity: isDragging ? 0.85 : 1,
                                    boxShadow: isDragging ? "0 6px 18px rgba(0,0,0,0.18)" : undefined,
                                    touchAction: "none",
                                    userSelect: "none",
                                  }}
                                >
                                  <span
                                    {...listeners}
                                    title="Drag this whole phase to another open day"
                                    className="px-1.5 py-1.5 cursor-grab opacity-50 hover:opacity-90"
                                    style={{ fontSize: 11 }}
                                  >
                                    ⋮⋮
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => togglePhase(iso, p)}
                                    className="flex-1 flex items-center gap-2 py-1.5 pr-2 text-left"
                                    style={{ color: "inherit", background: "transparent" }}
                                  >
                                    <span className="text-[10px] opacity-70 shrink-0">
                                      {expanded ? "▾" : "▸"}
                                    </span>
                                    <span
                                      className="text-[12.5px]"
                                      style={{ fontFamily: "var(--font-serif)", fontWeight: 500 }}
                                    >
                                      {PHASE_LABEL[p]}
                                    </span>
                                    <span className="ml-auto text-[10px] tabular-nums opacity-70">
                                      {planSet.size} batch{planSet.size === 1 ? "" : "es"}
                                    </span>
                                  </button>
                                </div>
                              )}
                            </MonthDragHandle>
                            {expanded && (
                              <ul className="space-y-0.5 px-3 pb-2" style={{ listStyle: "none" }}>
                                {[...planSet].map((pid) => {
                                  const productLabel = resolveProductLabelForPlan(pid);
                                  const src = resolveSourceForPlan(pid);
                                  const sids = stepIdsForPhaseOnDay(pid, p, iso);
                                  return (
                                    <MonthDragHandle
                                      key={pid}
                                      id={`month-batch:${iso}:${p}:${pid}`}
                                      payload={{
                                        planIds: [pid],
                                        stepIds: sids,
                                        sourceDate: iso,
                                        label: `${PHASE_LABEL[p]} · ${productLabel}`,
                                      }}
                                    >
                                      {({ setNodeRef, listeners, attributes, isDragging, transform }) => (
                                        <li
                                          ref={setNodeRef}
                                          {...attributes}
                                          className="flex items-baseline gap-2 text-[11.5px] rounded-[6px] px-1 py-0.5"
                                          style={{
                                            transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
                                            zIndex: isDragging ? 50 : undefined,
                                            position: isDragging ? "relative" : undefined,
                                            pointerEvents: isDragging ? "none" : undefined,
                                            opacity: isDragging ? 0.85 : 1,
                                            boxShadow: isDragging ? "0 4px 14px rgba(0,0,0,0.15)" : undefined,
                                            touchAction: "none",
                                            userSelect: "none",
                                            background: isDragging ? "rgba(255,255,255,0.95)" : undefined,
                                          }}
                                        >
                                          <span
                                            {...listeners}
                                            title="Drag this batch only"
                                            className="cursor-grab opacity-40 hover:opacity-90"
                                            style={{ fontSize: 10 }}
                                          >
                                            ⋮⋮
                                          </span>
                                          <Link
                                            href={`/production/${pid}?from=plan`}
                                            className="hover:underline"
                                            style={{ color: "#1c1d1f", fontWeight: 500 }}
                                          >
                                            {productLabel}
                                          </Link>
                                          {src ? (
                                            <span className="inline-flex items-baseline gap-1 text-[10.5px] text-muted-foreground">
                                              <span>·</span>
                                              <span
                                                className="inline-block rounded-full"
                                                style={{
                                                  width: 6, height: 6, alignSelf: "center",
                                                  background: SRC_COLOR[src.kind],
                                                }}
                                              />
                                              <span>for {src.label}</span>
                                            </span>
                                          ) : (
                                            <span className="text-[10.5px] text-muted-foreground italic">
                                              · standalone
                                            </span>
                                          )}
                                        </li>
                                      )}
                                    </MonthDragHandle>
                                  );
                                })}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  sources.length === 0 && (
                    <p className="text-[12px] italic text-muted-foreground">Nothing scheduled.</p>
                  )
                )}
              </MonthDayDrop>
            );
          })}
        </div>
      </div>
    </section>
    </DndContext>
  );
}

