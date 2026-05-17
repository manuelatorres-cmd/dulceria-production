"use client";

/**
 * Pills-only week strip for the manual planner (spec §3.5).
 *
 * 7 day columns. Each column is a drop target (`plan-day-<iso>` to match
 * PlanWeekV2Body's id convention so the manual-page handleDragEnd parses
 * both surfaces the same way). Each pinned plan renders as one pill on
 * its pinnedDate day — NO stage breakdown.
 *
 * Stage breakdown lives on /daily, not here. The manual planner is for
 * composing batches and dropping them on a day; the /plan?view=weekly +
 * /daily pages own per-step scheduling.
 */

import { useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { effectiveDailyCapacityMinutes } from "@/lib/capacity";
import type {
  CapacityConfig,
  EventCalendarEntry,
  Mould,
  PersonUnavailability,
  Person,
  PlanProduct,
  Product,
  ProductionDay,
  ProductionDayLineItem,
  ProductionPlan,
} from "@/types";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

interface PillView {
  planId: string;
  productName: string;
  pieces: number;
  mouldCount: number;
  mouldName: string;
  isLocked: boolean;
}

export function WeekStripPills({
  weekAnchor,
  productionDays,
  lineItems,
  plans,
  planProducts,
  products,
  moulds,
  capacityConfig,
  people,
  unavailability,
  blockedDays,
  draftPinnedDate,
  draftPreview,
}: {
  weekAnchor: Date;
  productionDays: ProductionDay[];
  lineItems: ProductionDayLineItem[];
  plans: ProductionPlan[];
  planProducts: PlanProduct[];
  products: Product[];
  moulds: Mould[];
  capacityConfig: CapacityConfig | null;
  people: Person[];
  unavailability: PersonUnavailability[];
  blockedDays: EventCalendarEntry[];
  /** ISO yyyy-mm-dd of the active draft's pinnedDate, if any. */
  draftPinnedDate: string | null;
  /** Summary to overlay on the pinned day. */
  draftPreview: { name: string; pieces: number; mouldCount: number } | null;
}) {
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const weekDays = useMemo(() => {
    const start = startOfWeekMonday(weekAnchor);
    return Array.from({ length: 7 }, (_, i) => isoForOffset(start, i));
  }, [weekAnchor]);

  const dayDateById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of productionDays) if (d.id && d.date) m.set(d.id, d.date.slice(0, 10));
    return m;
  }, [productionDays]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const mouldById = useMemo(() => new Map(moulds.map((m) => [m.id!, m])), [moulds]);
  const planById = useMemo(() => new Map(plans.map((p) => [p.id!, p])), [plans]);

  // Pills per date: every active/draft plan whose pinnedDate falls in this
  // week. Also surface plans with line items on this day (for plans saved
  // with status='active' that have a line item but no explicit pinnedDate).
  const pillsByDate = useMemo(() => {
    const m = new Map<string, PillView[]>();
    const seen = new Set<string>();

    function push(date: string, planId: string, isLocked: boolean): void {
      const plan = planById.get(planId);
      if (!plan) return;
      if (plan.status === "done" || plan.status === "cancelled") return;
      const key = `${date}|${planId}`;
      if (seen.has(key)) return;
      seen.add(key);
      const pp = planProducts.find((x) => x.planId === planId);
      if (!pp) return;
      const product = productById.get(pp.productId);
      const mould = mouldById.get(pp.mouldId);
      const cavities = mould?.numberOfCavities ?? 0;
      const arr = m.get(date) ?? [];
      arr.push({
        planId,
        productName: product?.name ?? plan.name ?? "Batch",
        pieces: pp.actualYield ?? pp.quantity * cavities,
        mouldCount: pp.quantity,
        mouldName: mould?.name ?? "—",
        isLocked,
      });
      m.set(date, arr);
    }

    // Pinned-date plans (active drafts + saved active batches)
    for (const plan of plans) {
      if (!plan.pinnedDate) continue;
      if (!plan.id) continue;
      const date = plan.pinnedDate.slice(0, 10);
      if (!weekDays.includes(date)) continue;
      push(date, plan.id, true);
    }

    // Plans with line items on a week day (even without pinnedDate)
    for (const li of lineItems) {
      const date = dayDateById.get(li.productionDayId);
      if (!date || !weekDays.includes(date)) continue;
      push(date, li.planId, !!li.locked);
    }

    return m;
  }, [plans, lineItems, dayDateById, planById, planProducts, productById, mouldById, weekDays]);

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

  return (
    <section
      aria-label="Week strip"
      style={{
        background: "var(--ds-card-bg, #fff)",
        border: "0.5px solid var(--ds-border-warm, #d8d2c7)",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
      >
        {weekDays.map((iso, i) => {
          const cap = capacityByDate.get(iso) ?? { used: 0, capacity: 0 };
          const isClosed = cap.capacity === 0;
          const pills = pillsByDate.get(iso) ?? [];
          const showDraftOverlay = draftPinnedDate === iso && draftPreview;
          const isToday = iso === todayIso;
          return (
            <DayCell
              key={iso}
              iso={iso}
              label={DAY_LABELS[i]}
              isClosed={isClosed}
              isToday={isToday}
              usedMinutes={cap.used}
              capacityMinutes={cap.capacity}
              pills={pills}
              draftPreview={showDraftOverlay ? draftPreview : null}
            />
          );
        })}
      </div>
    </section>
  );
}

function DayCell({
  iso,
  label,
  isClosed,
  isToday,
  usedMinutes,
  capacityMinutes,
  pills,
  draftPreview,
}: {
  iso: string;
  label: string;
  isClosed: boolean;
  isToday: boolean;
  usedMinutes: number;
  capacityMinutes: number;
  pills: PillView[];
  draftPreview: { name: string; pieces: number; mouldCount: number } | null;
}) {
  // Match PlanWeekV2Body's droppable id convention so manual page's
  // handleDragEnd can parse both surfaces the same way.
  const droppable = useDroppable({ id: `plan-day-${iso}`, disabled: isClosed });

  const date = new Date(iso + "T00:00:00");
  const dateLabel = date.toLocaleDateString("en-US", { day: "numeric", month: "short" });

  const capacityRatio =
    capacityMinutes > 0 ? Math.min(1, usedMinutes / capacityMinutes) : 0;
  const overCapacity = capacityMinutes > 0 && usedMinutes > capacityMinutes;

  return (
    <div
      ref={droppable.setNodeRef}
      style={{
        background: isClosed
          ? "var(--ds-page-bg, #ece7df)"
          : isToday
          ? "#fff8e6"
          : "var(--ds-card-bg, #fff)",
        borderRight: "0.5px solid var(--ds-border-warm, #d8d2c7)",
        outline: droppable.isOver ? "1.5px dashed #e6c97a" : "none",
        outlineOffset: -2,
        minHeight: 140,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          padding: "6px 8px",
          borderBottom: "0.5px solid var(--ds-border-warm, #d8d2c7)",
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: isToday ? "#1c3937" : "var(--ds-text-muted, #7a766f)",
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          {label}
        </span>
        <span
          className="tabular-nums"
          style={{
            fontSize: 10,
            color: "var(--ds-text-muted, #7a766f)",
          }}
        >
          {dateLabel}
        </span>
      </header>
      {capacityMinutes > 0 && (
        <div
          style={{
            height: 3,
            background: "rgba(0,0,0,0.05)",
            position: "relative",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${capacityRatio * 100}%`,
              background: overCapacity
                ? "#d96a52"
                : capacityRatio > 0.75
                ? "#e6c97a"
                : "#1c5651",
              transition: "width 0.2s ease",
            }}
          />
        </div>
      )}
      <div
        style={{
          flex: 1,
          padding: 6,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          overflow: "hidden",
        }}
      >
        {isClosed ? (
          <p
            style={{
              fontSize: 10,
              fontStyle: "italic",
              color: "var(--ds-text-muted, #7a766f)",
              textAlign: "center",
              marginTop: 12,
              opacity: 0.7,
            }}
          >
            closed
          </p>
        ) : (
          <>
            {pills.length === 0 && !draftPreview ? (
              <p
                style={{
                  fontSize: 10,
                  fontStyle: "italic",
                  color: "var(--ds-text-muted, #7a766f)",
                  textAlign: "center",
                  marginTop: 12,
                  opacity: 0.5,
                }}
              >
                empty
              </p>
            ) : null}
            {pills.map((pill) => (
              <BatchPill key={pill.planId} pill={pill} />
            ))}
            {draftPreview ? <DraftPreviewPill preview={draftPreview} /> : null}
          </>
        )}
      </div>
    </div>
  );
}

function BatchPill({ pill }: { pill: PillView }) {
  return (
    <div
      title={`${pill.productName} · ${pill.pieces} pcs · ${pill.mouldCount} fills · ${pill.mouldName}`}
      style={{
        padding: "4px 6px",
        borderRadius: 4,
        background: pill.isLocked ? "#fff8e6" : "var(--ds-card-bg, #fff)",
        border: pill.isLocked ? "1px solid #e6c97a" : "0.5px solid var(--ds-border-warm, #d8d2c7)",
        fontSize: 11,
        display: "flex",
        flexDirection: "column",
        gap: 1,
        overflow: "hidden",
      }}
    >
      <span
        style={{
          fontWeight: 600,
          color: "var(--ds-text-primary, #1f1d18)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {pill.productName}
      </span>
      <span
        className="tabular-nums"
        style={{
          fontSize: 10,
          color: "var(--ds-text-muted, #7a766f)",
        }}
      >
        {pill.pieces} pcs · {pill.mouldCount} fills{pill.isLocked ? " · locked" : ""}
      </span>
    </div>
  );
}

function DraftPreviewPill({
  preview,
}: {
  preview: { name: string; pieces: number; mouldCount: number };
}) {
  return (
    <div
      style={{
        padding: "4px 6px",
        borderRadius: 4,
        background: "rgba(28,57,55,0.08)",
        border: "1px dashed #1c3937",
        fontSize: 11,
        color: "#1c3937",
      }}
    >
      <span style={{ fontWeight: 600 }}>{preview.name}</span>
      <span
        className="tabular-nums"
        style={{
          display: "block",
          fontSize: 10,
          opacity: 0.8,
        }}
      >
        {preview.pieces} pcs · {preview.mouldCount} fills · draft
      </span>
    </div>
  );
}
