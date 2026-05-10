"use client";

import type { ProductionStep } from "@/types";
import { DayHeader } from "./day-header";
import { formatMinutes } from "./format-minutes";

export interface DayStepEntry {
  /** lineItemId + stepId composite — unique per day. */
  key: string;
  step: ProductionStep | null;
  productName: string;
  planName: string;
  pieces: number;
  isLocked: boolean;
}

export function DayColumn({
  iso,
  isToday,
  isClosed,
  usedMinutes,
  capacityMinutes,
  warnPercent,
  criticalPercent,
  steps,
}: {
  iso: string;
  isToday: boolean;
  isClosed: boolean;
  usedMinutes: number;
  capacityMinutes: number;
  warnPercent: number;
  criticalPercent: number;
  steps: DayStepEntry[];
}) {
  return (
    <div
      className="flex flex-col"
      style={{
        background: isClosed ? "var(--wp-closed-bg)" : "var(--wp-card-bg)",
        borderRight: "0.5px solid var(--wp-border-warm)",
        minHeight: 480,
      }}
    >
      <div style={{ borderBottom: "0.5px solid var(--wp-border-warm)" }}>
        <DayHeader
          iso={iso}
          isToday={isToday}
          isClosed={isClosed}
          usedMinutes={usedMinutes}
          capacityMinutes={capacityMinutes}
          warnPercent={warnPercent}
          criticalPercent={criticalPercent}
        />
      </div>

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
          steps.map((entry) => <PreviewStepBlock key={entry.key} entry={entry} />)
        )}
      </div>
    </div>
  );
}

/**
 * Phase 2 step block — minimal placeholder. Phase 3 replaces with the
 * full StepBlock supporting locked / passive / conflict variants and
 * two-line vs compact density.
 */
function PreviewStepBlock({ entry }: { entry: DayStepEntry }) {
  const passive =
    !!entry.step && entry.step.activeMinutes <= 0 && (entry.step.waitingMinutes ?? 0) > 0;
  const minutes = entry.step ? entry.step.activeMinutes : 0;
  const waitingMins = entry.step?.waitingMinutes ?? 0;
  const stepName = entry.step?.name ?? entry.planName;

  return (
    <div
      style={{
        padding: "5px 7px",
        borderRadius: 3,
        fontSize: 11,
        lineHeight: 1.35,
        background: passive ? "transparent" : "var(--wp-page-bg)",
        border: passive ? "0.5px dashed var(--wp-border-warm)" : "0.5px solid var(--wp-border-warm)",
        borderLeft: `3px ${passive ? "dashed" : "solid"} ${
          entry.isLocked ? "var(--wp-teal)" : passive ? "var(--wp-text-muted)" : "var(--wp-blush)"
        }`,
        color: passive ? "var(--wp-text-muted)" : "var(--wp-text-primary)",
        fontStyle: passive ? "italic" : "normal",
      }}
    >
      <div className="flex items-baseline gap-1">
        <span className="truncate" style={{ fontWeight: 500 }}>
          {entry.isLocked && !passive && "🔒 "}
          {passive && "⏱ "}
          {stepName}
        </span>
      </div>
      <div className="text-[10px] tabular-nums" style={{ color: "var(--wp-text-muted)" }}>
        {entry.productName}
        {entry.pieces > 0 && ` · ${entry.pieces} pcs`}
        {minutes > 0 ? ` · ${formatMinutes(minutes)}` : passive ? ` · ${formatMinutes(waitingMins)} passive` : ""}
      </div>
    </div>
  );
}
