"use client";

import { useMemo } from "react";
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
import { DayColumn, type DayStepEntry, type DayConflict } from "./day-column";
import type { StepGroup } from "./group-block";

function isoForOffset(start: Date, offset: number): string {
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function startOfWeekMonday(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = out.getUTCDay();
  const offset = (dow + 6) % 7;
  out.setUTCDate(out.getUTCDate() - offset);
  return out;
}

export interface WeekGridInputs {
  /** Anchor date — week starts on the Monday of this date. */
  anchor: Date;
  productionDays: ProductionDay[];
  lineItems: ProductionDayLineItem[];
  plans: ProductionPlan[];
  planProducts: PlanProduct[];
  productionSteps: ProductionStep[];
  products: Product[];
  moulds: Mould[];
  capacityConfig: Parameters<typeof effectiveDailyCapacityMinutes>[1];
  people: Parameters<typeof effectiveDailyCapacityMinutes>[2];
  unavailability: Parameters<typeof effectiveDailyCapacityMinutes>[3];
  blockedDays: Parameters<typeof effectiveDailyCapacityMinutes>[4];
  warnPercent: number;
  criticalPercent: number;
  /** Phase 5 hooks the day header click into the day-detail drawer. */
  onDayHeaderClick?: (iso: string) => void;
  /** Phase 4/5 hooks step clicks into an edit drawer. */
  onStepClick?: (entry: DayStepEntry) => void;
  /** Phase 4 wraps each block with useDraggable. */
  renderDraggable?: (entry: DayStepEntry, body: React.ReactNode) => React.ReactNode;
  /** Wraps a group header so the GripVertical icon becomes a drag source
   *  carrying every member plan+step in one drop. */
  renderGroupDraggable?: (
    group: StepGroup,
    sourceDate: string,
    renderHandle: (props: {
      dragHandleProps: Record<string, unknown>;
      isDragging: boolean;
    }) => React.ReactNode,
  ) => React.ReactNode;
  /** Toggle pinnedDate on one or more plans. Used by group + per-batch
   *  lock affordances. */
  onLockToggle?: (planIds: string[], lock: boolean) => void;
  /** Phase 4 conflict detection result, keyed by ISO date. */
  conflictsByDate?: Map<string, DayConflict[]>;
}

/**
 * Plan v2 week grid — always 7 equal columns, never shrinks empty days.
 * Closed days (capacity = 0) get a soft tint and "closed" treatment.
 *
 * Phase 2 ships the structural shell with capacity bars and minimal
 * step previews. Phase 3 swaps PreviewStepBlock for the full StepBlock
 * with locked / passive / conflict variants and density toggling.
 */
export function WeekGrid(props: WeekGridInputs) {
  const {
    anchor,
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
    warnPercent,
    criticalPercent,
    onDayHeaderClick,
    onStepClick,
    renderDraggable,
    renderGroupDraggable,
    onLockToggle,
    conflictsByDate,
  } = props;

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const weekDays = useMemo(() => {
    const start = startOfWeekMonday(anchor);
    return Array.from({ length: 7 }, (_, i) => isoForOffset(start, i));
  }, [anchor]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const mouldById = useMemo(() => new Map(moulds.map((m) => [m.id!, m])), [moulds]);
  const stepById = useMemo(
    () => new Map(productionSteps.map((s) => [s.id!, s])),
    [productionSteps],
  );
  const planById = useMemo(() => new Map(plans.map((p) => [p.id!, p])), [plans]);
  const planProductByPlan = useMemo(() => {
    const m = new Map<string, PlanProduct>();
    for (const pp of planProducts) {
      if (!m.has(pp.planId)) m.set(pp.planId, pp);
    }
    return m;
  }, [planProducts]);

  const dayDateById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of productionDays) {
      if (d.id && d.date) m.set(d.id, d.date.slice(0, 10));
    }
    return m;
  }, [productionDays]);

  const capacityByDate = useMemo(() => {
    const m = new Map<string, { used: number; capacity: number }>();
    for (const iso of weekDays) {
      const d = new Date(iso + "T12:00:00");
      const cap = effectiveDailyCapacityMinutes(d, capacityConfig, people, unavailability, blockedDays);
      m.set(iso, { used: 0, capacity: cap });
    }
    for (const li of lineItems) {
      const date = dayDateById.get(li.productionDayId);
      if (!date) continue;
      const slot = m.get(date);
      if (!slot) continue;
      slot.used += li.plannedMinutes ?? 0;
    }
    return m;
  }, [weekDays, capacityConfig, people, unavailability, blockedDays, lineItems, dayDateById]);

  // Per-day "all line items actually worked" — drives the green ✓ badge.
  const workedByDate = useMemo(() => {
    const totalByDate = new Map<string, number>();
    const workedByDateAcc = new Map<string, number>();
    for (const li of lineItems) {
      const date = dayDateById.get(li.productionDayId);
      if (!date) continue;
      totalByDate.set(date, (totalByDate.get(date) ?? 0) + 1);
      if (li.actuallyWorked) {
        workedByDateAcc.set(date, (workedByDateAcc.get(date) ?? 0) + 1);
      }
    }
    const m = new Map<string, boolean>();
    for (const [date, total] of totalByDate) {
      m.set(date, total > 0 && (workedByDateAcc.get(date) ?? 0) === total);
    }
    return m;
  }, [lineItems, dayDateById]);

  // Sorted lineItem dates per plan — used to populate spanInfo on
  // passive steps so the StepBlock can render "→ Wed" / "from Mon"
  // annotations without recomputing per-render.
  const datesByPlan = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const li of lineItems) {
      const date = dayDateById.get(li.productionDayId);
      if (!date) continue;
      const arr = m.get(li.planId) ?? [];
      if (!arr.includes(date)) arr.push(date);
      m.set(li.planId, arr);
    }
    for (const arr of m.values()) arr.sort();
    return m;
  }, [lineItems, dayDateById]);

  const stepsByDate = useMemo(() => {
    const m = new Map<string, DayStepEntry[]>();
    for (const li of lineItems) {
      const date = dayDateById.get(li.productionDayId);
      if (!date || !capacityByDate.has(date)) continue;
      const plan = planById.get(li.planId);
      if (!plan) continue;
      if (plan.status === "done" || plan.status === "cancelled") continue;
      const pp = planProductByPlan.get(li.planId);
      const product = pp ? productById.get(pp.productId) : undefined;
      const mould = pp ? mouldById.get(pp.mouldId) : undefined;
      const cavities = mould?.numberOfCavities ?? 0;
      const pieces = pp ? (pp.actualYield ?? pp.quantity * cavities) : 0;
      const isLocked = !!plan.pinnedDate;

      const planDates = datesByPlan.get(li.planId) ?? [date];
      const dateIdx = planDates.indexOf(date);

      for (const stepId of li.stepIds) {
        const step = stepById.get(stepId) ?? null;
        const passive =
          !!step && step.activeMinutes <= 0 && (step.waitingMinutes ?? 0) > 0;
        const spanInfo = passive
          ? {
              fromIso: dateIdx > 0 ? planDates[dateIdx - 1] : "",
              toIso: dateIdx < planDates.length - 1 ? planDates[dateIdx + 1] : "",
            }
          : null;
        const arr = m.get(date) ?? [];
        arr.push({
          key: `${li.id ?? `${li.productionDayId}:${li.planId}`}:${stepId}`,
          planId: li.planId,
          sourceDate: date,
          step,
          productName: product?.name ?? "—",
          planName: plan.name ?? "Batch",
          pieces,
          isLocked,
          spanInfo:
            spanInfo && (spanInfo.fromIso || spanInfo.toIso)
              ? {
                  fromIso: spanInfo.fromIso || date,
                  toIso: spanInfo.toIso || date,
                }
              : null,
        });
        m.set(date, arr);
      }
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => {
        const ao = a.step?.sortOrder ?? 9999;
        const bo = b.step?.sortOrder ?? 9999;
        return ao - bo;
      });
    }
    return m;
  }, [
    lineItems,
    dayDateById,
    capacityByDate,
    planById,
    planProductByPlan,
    productById,
    mouldById,
    stepById,
    datesByPlan,
  ]);

  return (
    <section
      className="weekly-plan-v2"
      style={{
        background: "var(--wp-card-bg)",
        border: "0.5px solid var(--wp-border-warm)",
        borderRadius: 8,
        overflow: "hidden",
        color: "var(--wp-text-primary)",
      }}
    >
      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
      >
        {weekDays.map((iso) => {
          const cap = capacityByDate.get(iso) ?? { used: 0, capacity: 0 };
          const isClosed = cap.capacity === 0;
          const steps = stepsByDate.get(iso) ?? [];
          return (
            <DayColumn
              key={iso}
              iso={iso}
              isToday={iso === todayIso}
              isClosed={isClosed}
              isWorked={workedByDate.get(iso) ?? false}
              usedMinutes={cap.used}
              capacityMinutes={cap.capacity}
              warnPercent={warnPercent}
              criticalPercent={criticalPercent}
              steps={steps}
              conflicts={conflictsByDate?.get(iso)}
              onHeaderClick={onDayHeaderClick ? () => onDayHeaderClick(iso) : undefined}
              onStepClick={onStepClick}
              renderDraggable={renderDraggable}
              renderGroupDraggable={renderGroupDraggable}
              onLockToggle={onLockToggle}
            />
          );
        })}
      </div>
    </section>
  );
}
