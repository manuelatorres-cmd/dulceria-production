"use client";

import { useState } from "react";
import type { ProductionStep } from "@/types";
import { useDroppable } from "@dnd-kit/core";
import { DayHeader } from "./day-header";
import { StepBlock, type StepBlockEntry } from "./step-block";
import { ConflictWarning } from "./conflict-warning";
import { GroupBlock, buildStepGroups } from "./group-block";

const COMPACT_THRESHOLD = 6;

export interface DayStepEntry extends StepBlockEntry {
  /** Underlying step passed up for phase 4 logic. */
  step: ProductionStep | null;
}

export interface DayConflict {
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
  renderDraggable?: (entry: DayStepEntry, body: React.ReactNode) => React.ReactNode;
}) {
  const droppable = useDroppable({ id: `plan-day-${iso}`, disabled: isClosed });
  const density = steps.length >= COMPACT_THRESHOLD ? "compact" : "two-line";
  const { groups, solos } = buildStepGroups(steps);
  // Group expansion per day — local state, not URL synced.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Render order: interleave groups + solos sorted by step.sortOrder so
  // the visual sequence still tracks production order. Group sortOrder =
  // min sortOrder of its members.
  type Slot =
    | { kind: "group"; group: ReturnType<typeof buildStepGroups>["groups"][number]; sortOrder: number }
    | { kind: "solo"; entry: DayStepEntry; sortOrder: number };
  const slots: Slot[] = [];
  for (const g of groups) {
    const minSort = g.members.reduce(
      (m, e) => Math.min(m, e.step?.sortOrder ?? 9999),
      9999,
    );
    slots.push({ kind: "group", group: g, sortOrder: minSort });
  }
  for (const e of solos) {
    slots.push({ kind: "solo", entry: e, sortOrder: e.step?.sortOrder ?? 9999 });
  }
  slots.sort((a, b) => a.sortOrder - b.sortOrder);

  function toggleGroup(key: string) {
    setExpandedGroups((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div
      ref={droppable.setNodeRef}
      className="flex flex-col"
      style={{
        background: isClosed ? "var(--wp-closed-bg)" : "var(--wp-card-bg)",
        borderRight: "0.5px solid var(--wp-border-warm)",
        outline: droppable.isOver ? "1.5px dashed var(--wp-caramel)" : "none",
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
          slots.map((slot) => {
            if (slot.kind === "group") {
              const isExpanded = expandedGroups.has(slot.group.key);
              return (
                <GroupBlock
                  key={slot.group.key}
                  group={slot.group}
                  expanded={isExpanded}
                  onToggle={() => toggleGroup(slot.group.key)}
                  density={density}
                >
                  {isExpanded &&
                    slot.group.members.map((entry) => {
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
                    })}
                </GroupBlock>
              );
            }
            const entry = slot.entry;
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
