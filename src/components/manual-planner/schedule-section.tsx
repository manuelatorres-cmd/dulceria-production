"use client";

/**
 * Bottom-of-page collapsible Schedule section per
 * MANUAL_PLANNER_WORKSPACE_BATCH.md §3.7.
 *
 * Collapsed: one-line header with toggle + counts.
 * Expanded: 280px pool (left) + flex week strip (right).
 *
 * State persists in localStorage `dulceria.manual-planner.sched-open.v1`.
 */

import { useEffect, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type {
  Mould,
  PlanProduct,
  Product,
  ProductionDay,
  ProductionDayLineItem,
  ProductionPlan,
  CapacityConfig,
  EventCalendarEntry,
  Person,
  PersonUnavailability,
} from "@/types";
import type { DraftPlanCard as DraftPlanCardShape } from "@/lib/hooks";
import { WeekStripPills } from "./week-strip-pills";

const STORAGE_KEY = "dulceria.manual-planner.sched-open.v1";

function loadOpen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
function saveOpen(open: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function ScheduleSection({
  poolCards,
  weekAnchor,
  setWeekAnchor,
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
  pinnedThisWeekCount,
  draftPinnedDate,
  draftPreview,
  onPillClick,
}: {
  poolCards: DraftPlanCardShape[];
  weekAnchor: Date;
  setWeekAnchor: (d: Date) => void;
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
  pinnedThisWeekCount: number;
  draftPinnedDate: string | null;
  draftPreview: { name: string; pieces: number; mouldCount: number } | null;
  /** Click a pinned pill on the week strip → caller opens BatchPeekPopover. */
  onPillClick?: (planId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(loadOpen());
  }, []);
  function toggle(): void {
    setOpen((cur) => {
      const next = !cur;
      saveOpen(next);
      return next;
    });
  }

  return (
    <section
      aria-label="Schedule"
      style={{
        background: "var(--mp-card-bg)",
        border: "1px solid var(--mp-border-warm)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={toggle}
        style={{
          width: "100%",
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--mp-page-bg)",
          border: "none",
          textAlign: "left",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <span style={{ fontSize: 12, opacity: 0.7 }}>{open ? "▾" : "▸"}</span>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Schedule</span>
        <span style={{ fontSize: 11.5, color: "var(--mp-text-muted)" }}>
          {poolCards.length} in pool · {pinnedThisWeekCount} on the week
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--mp-text-muted)", fontStyle: "italic" }}>
          {open ? "click to collapse" : "click to expand · drop pool cards on a day"}
        </span>
      </button>

      {open ? (
        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 12, padding: 12 }}>
          <PoolWithDropTarget cards={poolCards} />
          <div>
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                marginBottom: 8,
                fontSize: 12,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  const next = new Date(weekAnchor);
                  next.setDate(next.getDate() - 7);
                  setWeekAnchor(next);
                }}
                style={miniBtnStyle}
              >
                ← prev
              </button>
              <button
                type="button"
                onClick={() => setWeekAnchor(new Date())}
                style={{ ...miniBtnStyle, fontWeight: 600 }}
              >
                today
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = new Date(weekAnchor);
                  next.setDate(next.getDate() + 7);
                  setWeekAnchor(next);
                }}
                style={miniBtnStyle}
              >
                next →
              </button>
              <span style={{ flex: 1 }} />
              <span style={{ color: "var(--mp-text-muted)", fontStyle: "italic", fontSize: 11 }}>
                drag a pool card onto a day → pin
              </span>
            </div>
            <WeekStripPills
              weekAnchor={weekAnchor}
              productionDays={productionDays}
              lineItems={lineItems}
              plans={plans}
              planProducts={planProducts}
              products={products}
              moulds={moulds}
              capacityConfig={capacityConfig}
              people={people}
              unavailability={unavailability}
              blockedDays={blockedDays}
              draftPinnedDate={draftPinnedDate}
              draftPreview={draftPreview}
              onPillClick={onPillClick}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

const miniBtnStyle: React.CSSProperties = {
  padding: "3px 9px",
  borderRadius: 5,
  fontSize: 11.5,
  border: "1px solid var(--mp-border-warm)",
  background: "var(--mp-card-bg)",
  cursor: "pointer",
  fontFamily: "inherit",
};

/**
 * Schedule pool as a single droppable region. Drop target id `mp-pool`
 * so page-level handleDragEnd can route pinned-pill→pool drops to
 * unpinToPool().
 */
function PoolWithDropTarget({ cards }: { cards: DraftPlanCardShape[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: "mp-pool" });
  return (
    <div
      ref={setNodeRef}
      style={{
        background: "var(--mp-page-bg)",
        border: "1px solid var(--mp-border-warm)",
        borderRadius: 8,
        padding: 8,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minHeight: 200,
        outline: isOver ? "1.5px dashed var(--mp-draft-border, #dab73f)" : "none",
        outlineOffset: -2,
      }}
    >
      <header
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: "var(--mp-text-muted)",
          padding: "0 2px 4px",
        }}
      >
        Schedule pool · {cards.length}
      </header>
      {cards.length === 0 ? (
        <p style={{ fontSize: 11.5, fontStyle: "italic", color: "var(--mp-text-muted)", padding: "8px 4px" }}>
          {isOver ? "drop here to unpin" : "No parked drafts. Add a draft from the workspace."}
        </p>
      ) : (
        cards.map((card) => <PoolCard key={card.planId} card={card} />)
      )}
    </div>
  );
}

function PoolCard({ card }: { card: DraftPlanCardShape }) {
  // Pool cards drag using the same id convention as DraftsTray cards
  // (`draft-card-<planId>` with kind `parked`) so page-level
  // handleDragEnd routes them through the existing pin flow.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `draft-card-${card.planId}`,
    data: { kind: "draft-card", trayCardId: card.planId, trayCardKind: "parked" },
  });
  const isCampaignTagged = /^[^·]+ · /.test(card.name);
  const campaignTag = isCampaignTagged ? card.name.split(" · ")[0] : null;
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        background: "var(--mp-card-bg)",
        border: "1px solid var(--mp-border-warm)",
        borderRadius: 6,
        padding: "6px 8px",
        cursor: "grab",
        opacity: isDragging ? 0.4 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600 }}>{card.productName}</div>
      {campaignTag ? (
        <div
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: 0.4,
            textTransform: "uppercase",
            color: "var(--mp-teal, #1c5651)",
          }}
        >
          {campaignTag}
        </div>
      ) : null}
      <div style={{ fontSize: 10.5, color: "var(--mp-text-muted)" }}>
        {card.allocationCount} line{card.allocationCount === 1 ? "" : "s"} · {card.mouldName}
      </div>
      <div className="tabular-nums" style={{ fontSize: 11.5, fontWeight: 600 }}>
        {card.totalDemand} / {card.totalPieces}
        <span style={{ fontWeight: 400, color: "var(--mp-text-muted)", marginLeft: 4 }}>
          {card.mouldCount} fills
        </span>
      </div>
    </div>
  );
}

export function BatchPeekPopover({
  planId,
  plans,
  planProducts,
  products,
  moulds,
  onClose,
  onSplit,
  onMergeSibling,
}: {
  planId: string;
  plans: ProductionPlan[];
  planProducts: PlanProduct[];
  products: Product[];
  moulds: Mould[];
  onClose: () => void;
  /** Caller opens the SplitBatchModal. */
  onSplit: () => void;
  /** Caller invokes mergeSiblingPlans(planId, siblingId). */
  onMergeSibling: (siblingId: string) => void;
}) {
  const plan = plans.find((p) => p.id === planId);
  const pp = planProducts.find((x) => x.planId === planId);
  const product = pp ? products.find((p) => p.id === pp.productId) : null;
  const mould = pp ? moulds.find((m) => m.id === pp.mouldId) : null;
  if (!plan) return null;
  const cavities = mould?.numberOfCavities ?? 0;
  const pieces = pp ? (pp.actualYield ?? pp.quantity * cavities) : 0;

  // Siblings: plans sharing this plan's siblingGroupId, excluding self.
  const siblings = plan.siblingGroupId
    ? plans
        .filter((p) => p.siblingGroupId === plan.siblingGroupId && p.id !== plan.id)
        .filter((p) => p.status !== "done" && p.status !== "cancelled")
    : [];

  return (
    <div
      role="dialog"
      aria-label="Batch peek"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--mp-card-bg)",
          border: "1px solid var(--mp-border-warm)",
          borderRadius: 10,
          padding: 18,
          minWidth: 360,
          maxWidth: 460,
          boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          fontSize: 12.5,
        }}
      >
        <header style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>
            {product?.name ?? plan.name}
            {plan.siblingGroupId ? (
              <span
                title="Sibling group"
                style={{ marginLeft: 6, fontSize: 11, opacity: 0.6 }}
              >
                🔗
              </span>
            ) : null}
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{ fontSize: 12, background: "transparent", border: "none", cursor: "pointer", opacity: 0.6 }}
          >
            ✕
          </button>
        </header>
        <p style={{ color: "var(--mp-text-muted)", fontSize: 11.5 }}>{plan.name}</p>
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 12 }}>
          <dt style={{ color: "var(--mp-text-muted)" }}>Mould</dt>
          <dd>{mould?.name ?? "—"}</dd>
          <dt style={{ color: "var(--mp-text-muted)" }}>Mould fills</dt>
          <dd className="tabular-nums">{pp?.quantity ?? 0}</dd>
          <dt style={{ color: "var(--mp-text-muted)" }}>Total pieces</dt>
          <dd className="tabular-nums">{pieces}</dd>
          <dt style={{ color: "var(--mp-text-muted)" }}>Pinned day</dt>
          <dd>
            {plan.pinnedDate
              ? new Date(plan.pinnedDate + "T00:00:00").toLocaleDateString("en-GB", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })
              : "—"}
          </dd>
          <dt style={{ color: "var(--mp-text-muted)" }}>Status</dt>
          <dd>{plan.status}</dd>
        </dl>

        {siblings.length > 0 ? (
          <div
            style={{
              padding: "8px 10px",
              background: "var(--mp-page-bg)",
              border: "1px solid var(--mp-border-warm)",
              borderRadius: 6,
              fontSize: 12,
            }}
          >
            <strong>Siblings:</strong>
            <ul style={{ margin: "4px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
              {siblings.map((s) => {
                const sPp = planProducts.find((x) => x.planId === s.id);
                const sLabel = s.pinnedDate
                  ? new Date(s.pinnedDate + "T00:00:00").toLocaleDateString("en-GB", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })
                  : "pool";
                return (
                  <li
                    key={s.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 11.5,
                    }}
                  >
                    <span style={{ flex: 1 }}>
                      {sPp?.quantity ?? 0} fills · {sLabel}
                    </span>
                    <button
                      type="button"
                      onClick={() => onMergeSibling(s.id!)}
                      style={{
                        padding: "3px 9px",
                        fontSize: 11,
                        borderRadius: 4,
                        border: "1px solid var(--mp-teal, #1c5651)",
                        background: "var(--mp-teal, #1c5651)",
                        color: "#fff",
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      Merge
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <a
          href={`/plan?view=weekly&focusPlanId=${plan.id}`}
          style={{
            fontSize: 12,
            color: "var(--mp-teal, #1c5651)",
            textDecoration: "underline",
            marginTop: 2,
          }}
        >
          Open on Plan(week) →
        </a>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
          <button
            type="button"
            onClick={onSplit}
            disabled={(pp?.quantity ?? 0) <= 1}
            title={(pp?.quantity ?? 0) <= 1 ? "Need at least 2 fills to split" : "Split into two batches"}
            style={{
              padding: "5px 12px",
              borderRadius: 5,
              border: "1px solid var(--mp-border-warm)",
              background: "transparent",
              fontSize: 12,
              cursor: (pp?.quantity ?? 0) <= 1 ? "not-allowed" : "pointer",
              opacity: (pp?.quantity ?? 0) <= 1 ? 0.5 : 1,
              fontFamily: "inherit",
            }}
          >
            Split…
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "5px 12px",
              borderRadius: 5,
              border: "none",
              background: "var(--mp-teal, #1c5651)",
              color: "#fff",
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Drop handler for sending a pinned plan back to the pool. */
export async function sendBackToPool(planId: string): Promise<void> {
  const { supabase } = await import("@/lib/supabase");
  const { queryClient } = await import("@/lib/query-client");
  const { error } = await supabase
    .from("productionPlans")
    .update({ status: "draft", pinnedDate: null, updatedAt: new Date() })
    .eq("id", planId);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["production-plans"] });
  queryClient.invalidateQueries({ queryKey: ["productionDayLineItems"] });
}
