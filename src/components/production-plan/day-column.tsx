"use client";

import type { ProductionStep } from "@/types";
import { useDroppable } from "@dnd-kit/core";
import { DayHeader } from "./day-header";
import { StepBlock, type StepBlockEntry } from "./step-block";
import { ConflictWarning } from "./conflict-warning";

const COMPACT_THRESHOLD = 6;

export interface DayStepEntry extends StepBlockEntry {
  /** Underlying step still passed up so phase 4 can use it. */
  step: ProductionStep | null;
}

export interface DayConflict {
  /** Visible message under the day's blocks. */
  message: string;
}

export function DayColumn({
  iso,
  isToday,
  isClosed,
  isWorked,
  usedMinutes,
  capacityMinutes,
  warnPercent,
  criticalPercent,
  steps,
  conflicts,
  onHeaderClick,
  onStepClick,
  renderDraggable,
}: {
  iso: string;
  isToday: boolean;
  isClosed: boolean;
  isWorked?: boolean;
  usedMinutes: number;
  capacityMinutes: number;
  warnPercent: number;
  criticalPercent: number;
  steps: DayStepEntry[];
  conflicts?: DayConflict[];
  onHeaderClick?: () => void;
  onStepClick?: (entry: DayStepEntry) => void;
  /** Phase 4 wraps each StepBlock with a useDraggable. Null = static. */
  renderDraggable?: (entry: DayStepEntry, body: React.ReactNode) => React.ReactNode;
}) {
  const droppable = useDroppable({ id: `plan-day-${iso}`, disabled: isClosed });
  const density = steps.length >= COMPACT_THRESHOLD ? "compact" : "two-line";

  return (
    <div
      ref={droppable.setNodeRef}
      className="flex flex-col"
      style={{
        background: isClosed ? "var(--wp-closed-bg)" : "var(--wp-card-bg)",
        borderRight: "0.5px solid var(--wp-border-warm)",
        outline: droppable.isOver
          ? "1.5px dashed var(--wp-caramel)"
          : "none",
        outlineOffset: -2,
        minHeight: 480,
      }}
    >
      <button
        type="button"
        onClick={onHeaderClick}
        className="text-left"
        style={{
          borderBottom: "0.5px solid var(--wp-border-warm)",
          background: "transparent",
          cursor: onHeaderClick ? "pointer" : "default",
        }}
      >
        <DayHeader
          iso={iso}
          isToday={isToday}
          isClosed={isClosed}
          isWorked={isWorked}
          usedMinutes={usedMinutes}
          capacityMinutes={capacityMinutes}
          warnPercent={warnPercent}
          criticalPercent={criticalPercent}
        />
      </button>

      <div className="flex-1 px-1.5 py-2 space-y-1 overflow-y-auto">
        {isClosed ? (
          <p
            className="text-[11px] italic text-center mt-6"
            style={{ color: "var(--wp-text-muted)", opacity: 0.6 }}
          >
            closed
          </p>
        ) : steps.length === 0 ? (
          <p
            className="text-[11px] italic text-center mt-6"
            style={{ color: "var(--wp-text-muted)" }}
          >
            empty
          </p>
        ) : (
          steps.map((entry) => {
            const block = (
              <StepBlock
                entry={entry}
                density={density}
                onClick={onStepClick ? () => onStepClick(entry) : undefined}
                draggable={!!renderDraggable}
              />
            );
            return (
              <div key={entry.key}>
                {renderDraggable ? renderDraggable(entry, block) : block}
              </div>
            );
          })
        )}
        {conflicts && conflicts.length > 0 && (
          <div className="pt-1">
            {conflicts.map((c, i) => (
              <ConflictWarning key={i} message={c.message} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
