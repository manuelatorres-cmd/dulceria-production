"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
} from "@dnd-kit/core";
import { PageHeader } from "@/components/page-header";
import {
  useReplenishmentProposals,
  useCampaigns,
  useProductionPlans,
  useProductsList,
  useAllProductionDayLineItems,
  useProductionDays,
  scheduleProposalOnDay,
  dismissProposal,
} from "@/lib/hooks";
import type { ReplenishmentProposal } from "@/types";
import { BackButton } from "@/components/back-button";

/**
 * Production Brain · Planner — drag-drop scheduling.
 *
 * Left: month calendar grid (4 weeks × 5 workdays). Right: pending
 * replenishment proposals. Drag a proposal onto a day → batch
 * scheduled + proposal status flips to `scheduled`.
 */
export default function ProductionBrainPlannerPage() {
  const proposals = useReplenishmentProposals(["pending"]);
  const campaigns = useCampaigns(["active", "planned"]);
  const plans = useProductionPlans();
  const products = useProductsList();
  const lineItems = useAllProductionDayLineItems();
  const productionDays = useProductionDays(60);

  const [dragging, setDragging] = useState<ReplenishmentProposal | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
  );

  const productsById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products) if (p.id) m.set(p.id, p.name);
    return m;
  }, [products]);

  const productionDayDateById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of productionDays) {
      if (d.id && d.date) m.set(d.id, d.date.slice(0, 10));
    }
    return m;
  }, [productionDays]);

  const planIdsByDate = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const li of lineItems) {
      const date = productionDayDateById.get(li.productionDayId);
      if (!date) continue;
      const list = m.get(date) ?? [];
      list.push(li.planId);
      m.set(date, list);
    }
    return m;
  }, [lineItems, productionDayDateById]);

  const planById = useMemo(() => {
    const m = new Map<string, (typeof plans)[number]>();
    for (const p of plans) if (p.id) m.set(p.id, p);
    return m;
  }, [plans]);

  const weeks = useMemo(() => buildMonthGrid(new Date()), []);

  function handleDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    const proposal = proposals.find((p) => p.id === id);
    if (proposal) setDragging(proposal);
    setErr(null);
  }

  async function handleDragEnd(e: DragEndEvent) {
    const proposalId = String(e.active.id);
    const overId = e.over?.id as string | undefined;
    setDragging(null);
    if (!overId || !overId.startsWith("day-")) return;
    const targetDate = overId.slice(4);
    try {
      await scheduleProposalOnDay(proposalId, targetDate);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    }
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div>
        <div className="px-4 pt-4">
          <BackButton />
        </div>
        <PageHeader
          title="Planner"
          description="Drag a proposal onto a day to schedule it. Campaigns + holidays shown across the top. Brain runs daily + on order changes."
        />

        {err ? (
          <div
            className="mb-4 border border-status-alert-edge bg-status-alert-bg px-3 py-2 text-[12px] text-status-alert"
            style={{ borderRadius: 4 }}
          >
            Error: {err}
          </div>
        ) : null}

        {/* Campaign strip */}
        {campaigns.length > 0 ? (
          <section className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            {campaigns.map((c) => (
              <div
                key={c.id}
                className="border border-border bg-card p-3 text-sm"
                style={{ borderRadius: 4 }}
              >
                <div className="flex items-center justify-between">
                  <strong
                    className="tracking-tight"
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontWeight: 500,
                      letterSpacing: "-0.015em",
                    }}
                  >
                    {c.name}
                  </strong>
                  <span
                    className="text-[10px] uppercase text-muted-foreground"
                    style={{ letterSpacing: "0.12em" }}
                  >
                    {c.status}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {c.startDate} → {c.endDate}
                  {c.targetTotalUnits ? ` · ${c.targetTotalUnits} target` : ""}
                </div>
              </div>
            ))}
          </section>
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
          {/* Calendar */}
          <section
            className="border border-border bg-card p-4"
            style={{ borderRadius: 4 }}
          >
            <header className="flex items-center justify-between mb-3">
              <h3
                className="text-[10px] uppercase text-muted-foreground font-medium"
                style={{ letterSpacing: "0.12em" }}
              >
                Month view
              </h3>
              <p className="text-xs text-muted-foreground">
                {plans.length} batches · drag to schedule
              </p>
            </header>
            <div className="grid grid-cols-5 gap-1.5 text-xs">
              {["Mon", "Tue", "Wed", "Thu", "Fri"].map((label) => (
                <div
                  key={label}
                  className="text-center text-[10px] uppercase text-muted-foreground py-1"
                  style={{ letterSpacing: "0.12em" }}
                >
                  {label}
                </div>
              ))}
              {weeks.flatMap((week, wi) =>
                week.map((day, di) => {
                  const planIdsForDay = planIdsByDate.get(day.iso) ?? [];
                  const dayPlans = Array.from(new Set(planIdsForDay))
                    .map((id) => planById.get(id))
                    .filter((p): p is NonNullable<typeof p> => Boolean(p));
                  return (
                    <DayCell
                      key={`${wi}-${di}`}
                      day={day}
                      plans={dayPlans}
                    />
                  );
                }),
              )}
            </div>
          </section>

          {/* Sidebar — replenishment proposals */}
          <aside
            className="border border-border bg-card p-3"
            style={{ borderRadius: 4 }}
          >
            <h3
              className="text-[10px] uppercase text-muted-foreground font-medium mb-3"
              style={{ letterSpacing: "0.12em" }}
            >
              Proposals · {proposals.length}
            </h3>
            {proposals.length === 0 ? (
              <p
                className="text-muted-foreground text-[12.5px] italic"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                Engine quiet. Nothing waiting.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {proposals.map((p) => (
                  <ProposalCard
                    key={p.id}
                    proposal={p}
                    productName={productsById.get(p.productId)}
                  />
                ))}
              </ul>
            )}
          </aside>
        </div>
      </div>

      <DragOverlay>
        {dragging ? (
          <div
            className="border border-foreground bg-card px-2.5 py-1.5 text-xs shadow-lg"
            style={{ borderRadius: 3, opacity: 0.95 }}
          >
            <strong
              style={{
                fontFamily: "var(--font-serif)",
                fontWeight: 500,
                letterSpacing: "-0.01em",
              }}
            >
              {dragging.productId}
            </strong>
            <span className="ml-2 text-muted-foreground text-[10.5px]">
              ×{dragging.suggestedBatchSize}
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function ProposalCard({
  proposal,
  productName,
}: {
  proposal: ReplenishmentProposal;
  productName?: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: proposal.id ?? "",
  });
  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={
        "border border-border bg-muted px-2.5 py-2 text-xs flex flex-col gap-0.5 cursor-grab select-none transition-opacity " +
        (isDragging ? "opacity-40" : "hover:border-foreground")
      }
      style={{ borderRadius: 3 }}
    >
      <div className="flex items-baseline justify-between">
        <strong
          className="text-foreground text-[12.5px]"
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            letterSpacing: "-0.01em",
          }}
        >
          {productName ?? proposal.productId.slice(0, 8)}
        </strong>
        <span
          className={
            "text-[9px] uppercase font-medium " +
            (proposal.priorityTier === 1
              ? "text-status-alert"
              : proposal.priorityTier === 2
                ? "text-status-warn"
                : "text-muted-foreground")
          }
          style={{ letterSpacing: "0.1em" }}
        >
          T{proposal.priorityTier}
        </span>
      </div>
      <span className="text-muted-foreground text-[10.5px]">
        {proposal.suggestedBatchSize} pcs · needed {proposal.earliestNeededDate}
      </span>
      <div className="flex gap-2 mt-1.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (proposal.id) dismissProposal(proposal.id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="text-[10px] uppercase text-muted-foreground hover:text-foreground"
          style={{ letterSpacing: "0.08em" }}
        >
          Dismiss
        </button>
      </div>
    </li>
  );
}

function DayCell({
  day,
  plans,
}: {
  day: DayCellInfo;
  plans: Array<{ id?: string; name?: string; batchNumber?: string }>;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `day-${day.iso}` });
  return (
    <div
      ref={setNodeRef}
      className={
        "min-h-[100px] border p-1.5 transition-colors " +
        (day.inMonth
          ? isOver
            ? "bg-accent-terracotta-bg border-[color:var(--accent-terracotta-ink)]"
            : "bg-muted border-border"
          : "bg-card border-border opacity-40")
      }
      style={{ borderRadius: 3 }}
    >
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span className={day.inMonth ? "text-foreground font-medium" : ""}>
          {day.day}
        </span>
        {plans.length > 0 ? <span>{plans.length}</span> : null}
      </div>
      <ul className="mt-1 space-y-0.5">
        {plans.slice(0, 3).map((plan) => (
          <li
            key={plan.id}
            className="px-1.5 py-0.5 text-[10px] truncate bg-card border border-border"
            title={plan.name ?? ""}
            style={{ borderRadius: 2 }}
          >
            {plan.name ?? `Batch ${plan.batchNumber ?? ""}`}
          </li>
        ))}
        {plans.length > 3 ? (
          <li className="text-[10px] text-muted-foreground">
            +{plans.length - 3} more
          </li>
        ) : null}
      </ul>
    </div>
  );
}

interface DayCellInfo {
  iso: string;
  day: number;
  inMonth: boolean;
}

/** Build a 4-week × 5-workday grid centred on the given month. Skips
 *  Sat/Sun so the column count stays at 5 per week. */
function buildMonthGrid(anchor: Date): DayCellInfo[][] {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const firstDow = firstOfMonth.getUTCDay();
  const offsetToMon = (firstDow + 6) % 7;
  const cursor = new Date(firstOfMonth);
  cursor.setUTCDate(cursor.getUTCDate() - offsetToMon);
  const weeks: DayCellInfo[][] = [];
  for (let w = 0; w < 4; w++) {
    const week: DayCellInfo[] = [];
    for (let d = 0; d < 5; d++) {
      const iso = cursor.toISOString().slice(0, 10);
      week.push({
        iso,
        day: cursor.getUTCDate(),
        inMonth: cursor.getUTCMonth() === month,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 2);
    weeks.push(week);
  }
  return weeks;
}
