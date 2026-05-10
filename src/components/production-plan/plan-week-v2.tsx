"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  pointerWithin,
  type DragEndEvent,
} from "@dnd-kit/core";
import type {
  Mould,
  PlanProduct,
  Product,
  ProductionDay,
  ProductionDayLineItem,
  ProductionPlan,
  ProductionStep,
} from "@/types";
import { effectiveDailyCapacityMinutes } from "@/lib/capacity";
import type {
  CapacityConfig,
  EventCalendarEntry,
  Person,
  PersonUnavailability,
} from "@/types";
import { detectConflicts } from "@/lib/production-plan/detect-conflicts";
import { moveStep } from "@/lib/production-plan/move-step";
import { WeekGrid } from "./week-grid";
import { SpanOverlay, type SpanEntry } from "./span-overlay";
import type { DayStepEntry } from "./day-column";

export function PlanWeekV2({
  weekAnchor,
  setWeekAnchor,
  productionDays,
  lineItems,
  plans,
  planProducts,
  productionSteps,
  products,
  moulds,
  capacityConfig,
  people,
  unavailability,
  blockedDays,
  onDayHeaderClick,
  onStepClick,
  /** Optional slot rendered above the grid (e.g. WeekNav). */
  weekNav,
}: {
  weekAnchor: Date;
  setWeekAnchor: (d: Date) => void;
  productionDays: ProductionDay[];
  lineItems: ProductionDayLineItem[];
  plans: ProductionPlan[];
  planProducts: PlanProduct[];
  productionSteps: ProductionStep[];
  products: Product[];
  moulds: Mould[];
  capacityConfig: CapacityConfig | null;
  people: Person[];
  unavailability: PersonUnavailability[];
  blockedDays: EventCalendarEntry[];
  onDayHeaderClick?: (iso: string) => void;
  onStepClick?: (entry: DayStepEntry) => void;
  weekNav?: React.ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const warnPercent = capacityConfig?.warnThresholdPercent ?? 75;
  const criticalPercent = capacityConfig?.criticalThresholdPercent ?? 90;

  const dayDateById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of productionDays) {
      if (d.id && d.date) m.set(d.id, d.date.slice(0, 10));
    }
    return m;
  }, [productionDays]);

  const planProductByPlan = useMemo(() => {
    const m = new Map<string, PlanProduct>();
    for (const pp of planProducts) {
      if (!m.has(pp.planId)) m.set(pp.planId, pp);
    }
    return m;
  }, [planProducts]);

  const stepById = useMemo(
    () => new Map(productionSteps.map((s) => [s.id!, s])),
    [productionSteps],
  );

  const weekStart = useMemo(() => {
    const d = new Date(weekAnchor);
    const dow = d.getDay();
    const offset = (dow + 6) % 7;
    d.setDate(d.getDate() - offset);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [weekAnchor]);

  const weekIsoSet = useMemo(() => {
    const out = new Set<string>();
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      out.add(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      );
    }
    return out;
  }, [weekStart]);

  const colForIso = (iso: string): number => {
    const d = new Date(iso + "T00:00:00");
    const diff = Math.round((d.getTime() - weekStart.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(0, Math.min(6, diff));
  };

  // ── Span entries — passive multi-day gaps per plan ────────────
  const spans = useMemo(() => {
    const datesByPlan = new Map<string, Set<string>>();
    const passiveByPlanDay = new Map<string, boolean>();
    for (const li of lineItems) {
      const date = dayDateById.get(li.productionDayId);
      if (!date) continue;
      const set = datesByPlan.get(li.planId) ?? new Set<string>();
      set.add(date);
      datesByPlan.set(li.planId, set);
      let hasPassive = passiveByPlanDay.get(`${li.planId}|${date}`) ?? false;
      for (const sid of li.stepIds) {
        const step = stepById.get(sid);
        if (step && step.activeMinutes <= 0 && (step.waitingMinutes ?? 0) > 0) {
          hasPassive = true;
        }
      }
      passiveByPlanDay.set(`${li.planId}|${date}`, hasPassive);
    }
    const out: SpanEntry[] = [];
    let stackIdx = 0;
    for (const [planId, dates] of datesByPlan) {
      const plan = plans.find((p) => p.id === planId);
      if (!plan) continue;
      if (plan.status === "done" || plan.status === "cancelled") continue;
      const sortedDates = [...dates].sort();
      for (let i = 0; i < sortedDates.length - 1; i++) {
        const fromIso = sortedDates[i];
        const toIso = sortedDates[i + 1];
        if (!weekIsoSet.has(fromIso) && !weekIsoSet.has(toIso)) continue;
        if (!passiveByPlanDay.get(`${planId}|${fromIso}`)) continue;
        const startCol = colForIso(fromIso);
        const endCol = colForIso(toIso);
        if (endCol <= startCol) continue;
        const pp = planProductByPlan.get(planId);
        const product = pp ? products.find((p) => p.id === pp.productId) : undefined;
        const labelBase = product?.name ?? plan.name ?? "Batch";
        out.push({
          key: `${planId}:${fromIso}`,
          startCol,
          endCol,
          topPx: 96 + stackIdx * 28,
          label: `${labelBase} · passive overnight`,
        });
        stackIdx++;
      }
    }
    return out;
  // colForIso depends on weekStart; including weekIsoSet covers it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineItems, dayDateById, stepById, plans, weekIsoSet, planProductByPlan, products]);

  // ── Mould double-book conflicts per day ───────────────────────
  const conflictsByDate = useMemo(() => {
    const m = new Map<string, { message: string }[]>();
    const mouldByDate = new Map<string, Map<string, Set<string>>>();
    for (const li of lineItems) {
      const date = dayDateById.get(li.productionDayId);
      if (!date || !weekIsoSet.has(date)) continue;
      const plan = plans.find((p) => p.id === li.planId);
      if (!plan) continue;
      if (plan.status === "done" || plan.status === "cancelled") continue;
      const pp = planProductByPlan.get(li.planId);
      if (!pp || !pp.mouldId) continue;
      const byMould = mouldByDate.get(date) ?? new Map<string, Set<string>>();
      const set = byMould.get(pp.mouldId) ?? new Set<string>();
      set.add(li.planId);
      byMould.set(pp.mouldId, set);
      mouldByDate.set(date, byMould);
    }
    for (const [date, byMould] of mouldByDate) {
      for (const [mouldId, planIds] of byMould) {
        const mould = moulds.find((mm) => mm.id === mouldId);
        const cap = Math.max(1, mould?.quantityOwned ?? 1);
        if (planIds.size > cap) {
          const arr = m.get(date) ?? [];
          arr.push({
            message: `${mould?.name ?? "Mould"} double-booked: ${planIds.size} plans on this day (cap ${cap}).`,
          });
          m.set(date, arr);
        }
      }
    }
    return m;
  }, [lineItems, dayDateById, weekIsoSet, plans, planProductByPlan, moulds]);

  async function handleDragEnd(e: DragEndEvent) {
    if (!e.over) return;
    const overId = String(e.over.id);
    if (!overId.startsWith("plan-day-")) return;
    const targetDate = overId.slice("plan-day-".length);
    const data = e.active.data.current as
      | { planId: string; stepId: string; sourceDate: string }
      | undefined;
    if (!data || !data.planId || !data.stepId) return;
    if (data.sourceDate === targetDate) return;

    const targetDay = new Date(targetDate + "T12:00:00");
    const capacityMinutes = effectiveDailyCapacityMinutes(
      targetDay,
      capacityConfig,
      people,
      unavailability,
      blockedDays,
    );
    if (capacityMinutes === 0) {
      setMoveError("Cannot move to a closed day.");
      return;
    }
    const targetLineItems = lineItems.filter(
      (li) => dayDateById.get(li.productionDayId) === targetDate,
    );
    const usedMinutes = targetLineItems.reduce((s, li) => s + (li.plannedMinutes ?? 0), 0);
    const step = stepById.get(data.stepId);
    const movedMinutes = step?.activeMinutes ?? 0;
    const movingPp = planProductByPlan.get(data.planId);
    const conflicts = detectConflicts({
      targetDate,
      movedMinutes,
      movingPlanId: data.planId,
      movingMouldId: movingPp?.mouldId ?? null,
      existingUsedMinutes: usedMinutes,
      capacityMinutes,
      warnPercent,
      criticalPercent,
      targetDayLineItems: targetLineItems,
      plans,
      planProducts,
      moulds,
    });
    if (conflicts.length > 0) {
      const ok = window.confirm(
        `Confirm move?\n\n${conflicts.map((c) => "• " + c.message).join("\n")}`,
      );
      if (!ok) return;
    }

    setMoving(true);
    setMoveError(null);
    try {
      await moveStep({ planId: data.planId, stepId: data.stepId, targetDate });
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : String(err));
    } finally {
      setMoving(false);
    }
  }

  function renderDraggable(entry: DayStepEntry, body: React.ReactNode): React.ReactNode {
    if (!entry.step) return body;
    const passive =
      entry.step.activeMinutes <= 0 && (entry.step.waitingMinutes ?? 0) > 0;
    if (passive) return body;
    return (
      <DraggableStep
        planId={entry.planId}
        stepId={entry.step.id ?? ""}
        sourceDate={entry.sourceDate}
      >
        {body}
      </DraggableStep>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      onDragEnd={handleDragEnd}
      collisionDetection={pointerWithin}
    >
      <div className="weekly-plan-v2">
        {weekNav}
        {moveError && (
          <div
            className="mb-2 px-3 py-2 text-[12px]"
            style={{
              border: "0.5px solid var(--wp-rose)",
              background: "var(--wp-conflict-tint)",
              color: "var(--wp-rose)",
              borderRadius: 4,
            }}
          >
            {moveError}
            <button
              type="button"
              onClick={() => setMoveError(null)}
              className="ml-2 text-[10px] uppercase opacity-70 hover:opacity-100"
            >
              dismiss
            </button>
          </div>
        )}
        <div style={{ position: "relative" }}>
          <WeekGrid
            anchor={weekAnchor}
            productionDays={productionDays}
            lineItems={lineItems}
            plans={plans}
            planProducts={planProducts}
            productionSteps={productionSteps}
            products={products}
            moulds={moulds}
            capacityConfig={capacityConfig}
            people={people}
            unavailability={unavailability}
            blockedDays={blockedDays}
            warnPercent={warnPercent}
            criticalPercent={criticalPercent}
            renderDraggable={renderDraggable}
            conflictsByDate={conflictsByDate}
            onDayHeaderClick={onDayHeaderClick}
            onStepClick={onStepClick}
          />
          <SpanOverlay spans={spans} />
        </div>
        {moving && (
          <p className="mt-2 text-[11px] italic" style={{ color: "var(--wp-text-muted)" }}>
            Saving move…
          </p>
        )}
      </div>
    </DndContext>
  );
}

function DraggableStep({
  planId,
  stepId,
  sourceDate,
  children,
}: {
  planId: string;
  stepId: string;
  sourceDate: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `step-${planId}-${stepId}`,
    data: { planId, stepId, sourceDate },
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      {children}
    </div>
  );
}

