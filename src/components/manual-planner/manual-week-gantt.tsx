"use client";

/**
 * Gantt grid for /production-brain/manual (spec
 * MANUAL_PLANNER_WEEK_VIEW_GANTT.md).
 *
 * Rows = batches with productionDayLineItems in the visible week
 *        OR plans with pinnedDate in the visible week.
 * Cols = Mon → Sun for the visible week.
 * Cell = StageChip per stepId in the (plan, day) productionDayLineItems
 *        row, sorted by productionStep.sortOrder.
 * Bottom row = day-load totals (sum activeMinutes + stage count per col).
 *
 * Each cell is a `plan-day-<iso>` droppable so the page-level
 * handleDragEnd can route stage drops, draft pins, and (future) other
 * sources through one handler.
 */

import { useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import type {
  Mould,
  PlanProduct,
  Product,
  ProductCategory,
  ProductionDay,
  ProductionDayLineItem,
  ProductionPlan,
  ProductionStep,
} from "@/types";
import { StageChip, formatMinutes } from "./stage-chip";

const DAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

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

interface BatchRow {
  planId: string;
  productName: string;
  mouldCount: number;
  totalPieces: number;
}

export function ManualWeekGantt({
  weekAnchor,
  productionDays,
  lineItems,
  plans,
  planProducts,
  productionSteps,
  productCategories,
  products,
  moulds,
  dailyActiveCapacityMinutes,
  draftPinnedDate,
  draftPreview,
  onChipClick,
}: {
  weekAnchor: Date;
  productionDays: ProductionDay[];
  lineItems: ProductionDayLineItem[];
  plans: ProductionPlan[];
  planProducts: PlanProduct[];
  productionSteps: ProductionStep[];
  productCategories: ProductCategory[];
  products: Product[];
  moulds: Mould[];
  /** Daily capacity (active minutes) — over this, the day-load total
   *  renders red. Pass null/undefined to skip the threshold styling. */
  dailyActiveCapacityMinutes: number | null;
  draftPinnedDate: string | null;
  draftPreview: { name: string; pieces: number; mouldCount: number } | null;
  /** Stage chip click → peek popover (deferred — caller can no-op). */
  onChipClick?: (chip: {
    planId: string;
    stepId: string;
    sourceDate: string;
    stepName: string;
    activeMinutes: number;
    waitingMinutes: number;
  }) => void;
}) {
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const weekDays = useMemo(() => {
    const start = startOfWeekMonday(weekAnchor);
    return Array.from({ length: 7 }, (_, i) => isoForOffset(start, i));
  }, [weekAnchor]);

  const dayIdByDate = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of productionDays) {
      if (d.id && d.date) m.set(d.date.slice(0, 10), d.id);
    }
    return m;
  }, [productionDays]);

  const dateByDayId = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of productionDays) {
      if (d.id && d.date) m.set(d.id, d.date.slice(0, 10));
    }
    return m;
  }, [productionDays]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const mouldById = useMemo(() => new Map(moulds.map((m) => [m.id!, m])), [moulds]);
  const stepById = useMemo(
    () => new Map(productionSteps.map((s) => [s.id!, s])),
    [productionSteps],
  );
  const categoryById = useMemo(
    () => new Map(productCategories.map((c) => [c.id!, c])),
    [productCategories],
  );
  const planById = useMemo(() => new Map(plans.map((p) => [p.id!, p])), [plans]);

  // Line items keyed by `${planId}|${date}` for O(1) cell lookups.
  const lineItemByPlanDay = useMemo(() => {
    const m = new Map<string, ProductionDayLineItem>();
    for (const li of lineItems) {
      const date = dateByDayId.get(li.productionDayId);
      if (!date) continue;
      m.set(`${li.planId}|${date}`, li);
    }
    return m;
  }, [lineItems, dateByDayId]);

  // Which plans appear in this week — either via line items or pinnedDate.
  const visiblePlanIds = useMemo(() => {
    const set = new Set<string>();
    const weekSet = new Set(weekDays);
    for (const li of lineItems) {
      const date = dateByDayId.get(li.productionDayId);
      if (!date) continue;
      if (!weekSet.has(date)) continue;
      const plan = planById.get(li.planId);
      if (!plan) continue;
      if (plan.status === "done" || plan.status === "cancelled") continue;
      set.add(li.planId);
    }
    for (const plan of plans) {
      if (!plan.pinnedDate || !plan.id) continue;
      const pinned = plan.pinnedDate.slice(0, 10);
      if (!weekSet.has(pinned)) continue;
      if (plan.status === "done" || plan.status === "cancelled") continue;
      set.add(plan.id);
    }
    return [...set];
  }, [lineItems, dateByDayId, weekDays, planById, plans]);

  const planProductByPlan = useMemo(() => {
    const m = new Map<string, PlanProduct>();
    for (const pp of planProducts) {
      if (!m.has(pp.planId)) m.set(pp.planId, pp);
    }
    return m;
  }, [planProducts]);

  const batchRows: BatchRow[] = useMemo(() => {
    const rows: BatchRow[] = [];
    for (const planId of visiblePlanIds) {
      const plan = planById.get(planId);
      if (!plan) continue;
      const pp = planProductByPlan.get(planId);
      const product = pp ? productById.get(pp.productId) : null;
      const mould = pp ? mouldById.get(pp.mouldId) : null;
      const cav = mould?.numberOfCavities ?? 0;
      const mouldCount = pp?.quantity ?? 0;
      const totalPieces = pp?.actualYield ?? mouldCount * cav;
      rows.push({
        planId,
        productName: product?.name ?? plan.name ?? "Batch",
        mouldCount,
        totalPieces,
      });
    }
    rows.sort((a, b) => a.productName.localeCompare(b.productName));
    return rows;
  }, [visiblePlanIds, planById, planProductByPlan, productById, mouldById]);

  // Per-batch step set: which steps are valid for this product type.
  // (Drives per-product override resolution + chip color.)
  function stepsForPlan(planId: string): Map<string, ProductionStep> {
    const pp = planProductByPlan.get(planId);
    if (!pp) return new Map();
    const product = productById.get(pp.productId);
    if (!product?.productCategoryId) return new Map();
    const cat = categoryById.get(product.productCategoryId);
    if (!cat) return new Map();
    const productType = cat.name;
    const m = new Map<string, ProductionStep>();
    for (const s of productionSteps) {
      if (s.productType === productType) m.set(s.id!, s);
    }
    return m;
  }

  // Per-day totals (sum activeMinutes across every chip in the column,
  // count distinct chips).
  const dayTotals = useMemo(() => {
    const m = new Map<string, { minutes: number; chips: number }>();
    for (const iso of weekDays) m.set(iso, { minutes: 0, chips: 0 });
    for (const planId of visiblePlanIds) {
      const stepsOfPlan = stepsForPlan(planId);
      for (const iso of weekDays) {
        const li = lineItemByPlanDay.get(`${planId}|${iso}`);
        if (!li) continue;
        const total = m.get(iso)!;
        for (const stepId of li.stepIds ?? []) {
          const step = stepsOfPlan.get(stepId) ?? stepById.get(stepId);
          if (!step) continue;
          total.minutes += Number(step.activeMinutes ?? 0);
          total.chips += 1;
        }
      }
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekDays, visiblePlanIds, lineItemByPlanDay, stepById, productionSteps, planProductByPlan, productById, categoryById]);

  return (
    <section
      aria-label="Manual planner Gantt"
      style={{
        background: "var(--mp-card-bg, #fff)",
        border: "1px solid var(--mp-border-warm, #e8e3d6)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      {/* Header row: batch label + 7 day cells */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "200px repeat(7, minmax(0, 1fr))",
          background: "var(--mp-page-bg, #fbf6f1)",
          borderBottom: "1px solid var(--mp-border-warm, #e8e3d6)",
        }}
      >
        <div
          style={{
            padding: "8px 12px",
            fontSize: 10.5,
            letterSpacing: 0.8,
            textTransform: "uppercase",
            fontWeight: 700,
            color: "var(--mp-text-muted, #8a7e64)",
          }}
        >
          Batch
        </div>
        {weekDays.map((iso, i) => {
          const date = new Date(iso + "T00:00:00");
          const dayNum = date.getDate();
          const isToday = iso === todayIso;
          return (
            <div
              key={iso}
              style={{
                padding: "8px 10px",
                borderLeft: "1px solid var(--mp-border-warm, #e8e3d6)",
                background: isToday ? "#fdfaf2" : "transparent",
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                  fontWeight: 700,
                  color: isToday ? "var(--mp-teal)" : "var(--mp-text-muted, #8a7e64)",
                }}
              >
                {DAY_LABELS[i]}
                {isToday ? " · today" : ""}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{dayNum}</span>
            </div>
          );
        })}
      </div>

      {/* Body rows: one per batch */}
      {batchRows.length === 0 ? (
        <p
          style={{
            padding: 24,
            textAlign: "center",
            fontStyle: "italic",
            color: "var(--mp-text-muted, #8a7e64)",
            fontSize: 12.5,
          }}
        >
          No batches in this week. Drop a draft on a day below to schedule one.
        </p>
      ) : (
        batchRows.map((row) => {
          const stepsOfPlan = stepsForPlan(row.planId);
          return (
            <div
              key={row.planId}
              style={{
                display: "grid",
                gridTemplateColumns: "200px repeat(7, minmax(0, 1fr))",
                borderBottom: "1px solid var(--mp-border-warm, #e8e3d6)",
                minHeight: 56,
              }}
            >
              <div
                style={{
                  padding: "8px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  justifyContent: "center",
                  background: "var(--mp-page-bg, #fbf6f1)",
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                  {row.productName}
                </span>
                <span
                  style={{
                    fontSize: 10.5,
                    color: "var(--mp-text-muted, #8a7e64)",
                  }}
                >
                  {row.mouldCount} fill{row.mouldCount === 1 ? "" : "s"} ·{" "}
                  {row.totalPieces} pcs
                </span>
              </div>
              {weekDays.map((iso) => {
                const isToday = iso === todayIso;
                const li = lineItemByPlanDay.get(`${row.planId}|${iso}`);
                const sortedStepIds = (li?.stepIds ?? [])
                  .map((stepId) => {
                    const step = stepsOfPlan.get(stepId) ?? stepById.get(stepId);
                    return { stepId, step };
                  })
                  .filter(
                    (e): e is { stepId: string; step: ProductionStep } => !!e.step,
                  )
                  .sort((a, b) => (a.step.sortOrder ?? 0) - (b.step.sortOrder ?? 0));
                return (
                  <GanttCell
                    key={iso}
                    iso={iso}
                    isToday={isToday}
                    planId={row.planId}
                  >
                    {sortedStepIds.length === 0 ? (
                      <span
                        aria-hidden
                        style={{
                          color: "var(--mp-border-warm, #d8d2c7)",
                          fontSize: 10,
                        }}
                      >
                        ·
                      </span>
                    ) : (
                      sortedStepIds.map(({ stepId, step }) => (
                        <StageChip
                          key={stepId}
                          planId={row.planId}
                          stepId={stepId}
                          sourceDate={iso}
                          stepName={step.name}
                          activeMinutes={Number(step.activeMinutes ?? 0)}
                          sortOrder={step.sortOrder ?? 0}
                          onClick={() =>
                            onChipClick?.({
                              planId: row.planId,
                              stepId,
                              sourceDate: iso,
                              stepName: step.name,
                              activeMinutes: Number(step.activeMinutes ?? 0),
                              waitingMinutes: Number(step.waitingMinutes ?? 0),
                            })
                          }
                        />
                      ))
                    )}
                  </GanttCell>
                );
              })}
            </div>
          );
        })
      )}

      {/* Bottom totals row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "200px repeat(7, minmax(0, 1fr))",
          background: "var(--mp-page-bg, #fbf6f1)",
          borderTop: "1px solid var(--mp-border-warm, #e8e3d6)",
        }}
      >
        <div
          style={{
            padding: "8px 12px",
            fontSize: 11,
            fontWeight: 700,
            color: "var(--mp-text-muted, #8a7e64)",
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          Day load
        </div>
        {weekDays.map((iso) => {
          const t = dayTotals.get(iso) ?? { minutes: 0, chips: 0 };
          const overCap =
            dailyActiveCapacityMinutes != null &&
            t.minutes > dailyActiveCapacityMinutes;
          const isToday = iso === todayIso;
          const showDraftHint = draftPinnedDate === iso && draftPreview != null;
          return (
            <div
              key={iso}
              style={{
                padding: "8px 10px",
                borderLeft: "1px solid var(--mp-border-warm, #e8e3d6)",
                background: isToday ? "#fdfaf2" : "transparent",
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <span
                className="tabular-nums"
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: overCap
                    ? "#d96a52"
                    : "var(--mp-text-primary)",
                }}
              >
                {formatMinutes(t.minutes)}
              </span>
              <span
                style={{
                  fontSize: 10.5,
                  color: "var(--mp-text-muted, #8a7e64)",
                }}
              >
                {t.chips} stg
              </span>
              {showDraftHint ? (
                <span
                  style={{
                    fontSize: 10,
                    color: "var(--mp-teal, #1c5651)",
                    fontStyle: "italic",
                    marginTop: 2,
                  }}
                >
                  + draft
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function GanttCell({
  iso,
  isToday,
  planId,
  children,
}: {
  iso: string;
  isToday: boolean;
  planId: string;
  children: React.ReactNode;
}) {
  // Two parallel droppables on the same cell:
  // 1. `plan-day-<iso>` accepts stage chips + draft cards (page-level
  //    handleDragEnd dispatches by data.kind).
  // 2. `plan-day-row-<iso>-<planId>` lets a chip's own row be addressed
  //    separately, useful for future cross-batch reject logic.
  const dayDrop = useDroppable({ id: `plan-day-${iso}-${planId}` });
  const rowDrop = useDroppable({ id: `plan-day-${iso}` });
  // Mount the more specific id first so the row-day drop wins on
  // collision detection; the generic id remains as fallback for the
  // page-level handler that doesn't care about row identity.
  return (
    <div
      ref={(el) => {
        dayDrop.setNodeRef(el);
        rowDrop.setNodeRef(el);
      }}
      style={{
        padding: "6px 8px",
        borderLeft: "1px solid var(--mp-border-warm, #e8e3d6)",
        background: isToday ? "#fdfaf2" : "transparent",
        outline: dayDrop.isOver || rowDrop.isOver ? "1.5px dashed #e6c97a" : "none",
        outlineOffset: -2,
        display: "flex",
        flexWrap: "wrap",
        gap: 4,
        alignContent: "flex-start",
        alignItems: "flex-start",
        minHeight: 56,
      }}
      data-iso={iso}
      data-plan={planId}
    >
      {children}
    </div>
  );
}
