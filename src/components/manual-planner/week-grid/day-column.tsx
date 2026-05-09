"use client";

import { useDroppable } from "@dnd-kit/core";
import { DayHeaderCell } from "./day-header-cell";
import { StepBlock } from "./step-block";
import type { ProductionStep } from "@/types";

export interface DayLineItemView {
  /** lineItemId. */
  id: string;
  planId: string;
  planName: string;
  productName: string;
  pieces: number;
  /** Steps in order — each rendered as one StepBlock. */
  steps: ProductionStep[];
  /** Whether the parent plan is pinned (locked). */
  isLocked: boolean;
}

export function DayColumn({
  iso,
  dayLabel,
  dateLabel,
  isToday,
  isClosed,
  usedMinutes,
  capacityMinutes,
  warnPercent,
  criticalPercent,
  items,
  draftPreview,
}: {
  iso: string;
  dayLabel: string;
  dateLabel: string;
  isToday: boolean;
  isClosed: boolean;
  usedMinutes: number;
  capacityMinutes: number;
  warnPercent: number;
  criticalPercent: number;
  items: DayLineItemView[];
  draftPreview: { name: string; pieces: number; mouldCount: number } | null;
}) {
  const droppable = useDroppable({ id: `day-${iso}`, disabled: isClosed });

  const baseBg = isToday
    ? "var(--mp-today-tint)"
    : isClosed
    ? "var(--mp-closed-tint)"
    : "var(--mp-card-bg)";

  return (
    <div
      ref={droppable.setNodeRef}
      className="flex flex-col"
      style={{
        background: baseBg,
        border: "0.5px solid var(--mp-border-warm)",
        borderRadius: 4,
        outline: droppable.isOver
          ? "1.5px dashed var(--mp-draft-border)"
          : "none",
        outlineOffset: -2,
        backgroundImage: isClosed
          ? "repeating-linear-gradient(45deg, transparent 0 6px, rgba(0,0,0,0.04) 6px 7px)"
          : undefined,
        minHeight: 320,
      }}
    >
      <div style={{ borderBottom: "0.5px solid var(--mp-border-warm)" }}>
        <DayHeaderCell
          dayLabel={dayLabel}
          dateLabel={dateLabel}
          isToday={isToday}
          isClosed={isClosed}
          usedMinutes={usedMinutes}
          capacityMinutes={capacityMinutes}
          warnPercent={warnPercent}
          criticalPercent={criticalPercent}
        />
      </div>

      <div className="flex-1 px-1.5 py-1.5 space-y-1.5 overflow-y-auto">
        {draftPreview && (
          <div
            style={{
              padding: "5px 8px",
              borderRadius: 3,
              fontSize: 11,
              borderLeft: "3px solid var(--mp-draft-border)",
              border: "0.5px dashed var(--mp-draft-border)",
              background: "var(--mp-draft-tint)",
            }}
          >
            <div style={{ fontWeight: 500, color: "var(--mp-text-primary)" }}>
              + {draftPreview.name}
            </div>
            <div className="text-[10px] tabular-nums" style={{ color: "var(--mp-text-muted)" }}>
              {draftPreview.pieces} pcs · {draftPreview.mouldCount} fill
              {draftPreview.mouldCount === 1 ? "" : "s"}
            </div>
          </div>
        )}
        {items.length === 0 && !draftPreview && !isClosed && (
          <p
            className="text-[11px] italic text-center mt-3"
            style={{ color: "var(--mp-text-muted)" }}
          >
            empty
          </p>
        )}
        {items.flatMap((item) =>
          item.steps.length === 0
            ? [
                <StepBlock
                  key={item.id}
                  step={null}
                  productName={item.productName}
                  isLocked={item.isLocked}
                  isDraftPreview={false}
                  pieces={item.pieces}
                />,
              ]
            : item.steps.map((step) => (
                <StepBlock
                  key={`${item.id}:${step.id}`}
                  step={step}
                  productName={item.productName}
                  isLocked={item.isLocked}
                  isDraftPreview={false}
                  pieces={item.pieces}
                />
              )),
        )}
      </div>
    </div>
  );
}
