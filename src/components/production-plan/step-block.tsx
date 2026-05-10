"use client";

import { Lock, Hourglass, AlertTriangle } from "lucide-react";
import type { ProductionStep } from "@/types";
import { formatMinutes } from "./format-minutes";

export type StepBlockDensity = "two-line" | "compact";

export interface StepBlockEntry {
  /** Composite key — lineItemId + stepId. */
  key: string;
  /** Plan id — used by phase 4 drag handlers. */
  planId: string;
  /** ISO yyyy-mm-dd of the day this entry currently lives on. */
  sourceDate: string;
  /** May be null when stepId is missing from productionSteps. */
  step: ProductionStep | null;
  productName: string;
  planName: string;
  pieces: number;
  isLocked: boolean;
  /** Set when this step has waitingMinutes spilling into another day. */
  spanInfo?: { fromIso: string; toIso: string } | null;
  /** Inline conflict marker — phase 4 will populate from detect-conflicts. */
  hasConflict?: boolean;
}

export function StepBlock({
  entry,
  density,
  onClick,
  draggable,
  dragHandleProps,
  isDragging,
}: {
  entry: StepBlockEntry;
  density: StepBlockDensity;
  onClick?: () => void;
  draggable?: boolean;
  /** Spread on the block — supplies dnd-kit listeners + attributes. */
  dragHandleProps?: Record<string, unknown>;
  isDragging?: boolean;
}) {
  const passive =
    !!entry.step && entry.step.activeMinutes <= 0 && (entry.step.waitingMinutes ?? 0) > 0;
  const stepName = entry.step?.name ?? entry.planName;
  const minutes = entry.step ? entry.step.activeMinutes : 0;
  const waitingMins = entry.step?.waitingMinutes ?? 0;
  const conflict = !!entry.hasConflict;

  // Visual variant decision (per spec matrix).
  let leftBorder: string;
  let leftStyle: "solid" | "dashed";
  let bg: string;
  let textColor: string;
  let italic = false;
  if (conflict) {
    leftBorder = "var(--wp-rose)";
    leftStyle = "solid";
    bg = "var(--wp-conflict-tint)";
    textColor = "var(--wp-text-primary)";
  } else if (passive) {
    leftBorder = "var(--wp-text-muted)";
    leftStyle = "dashed";
    bg = "transparent";
    textColor = "var(--wp-text-muted)";
    italic = true;
  } else if (entry.isLocked) {
    leftBorder = "var(--wp-teal)";
    leftStyle = "solid";
    bg = "var(--wp-page-bg)";
    textColor = "var(--wp-text-primary)";
  } else {
    leftBorder = "var(--wp-blush)";
    leftStyle = "solid";
    bg = "var(--wp-page-bg)";
    textColor = "var(--wp-text-primary)";
  }

  const cursor = passive ? "default" : draggable ? "grab" : "pointer";

  const root: React.CSSProperties = {
    padding: density === "compact" ? "3px 7px" : "5px 7px",
    borderRadius: 3,
    fontSize: density === "compact" ? 10.5 : 11,
    lineHeight: 1.35,
    background: bg,
    border: passive
      ? "0.5px dashed var(--wp-border-warm)"
      : conflict
      ? "0.5px solid var(--wp-rose)"
      : "0.5px solid var(--wp-border-warm)",
    borderLeft: `3px ${leftStyle} ${leftBorder}`,
    color: textColor,
    fontStyle: italic ? "italic" : "normal",
    cursor,
    transition: "background 0.1s ease, transform 0.08s ease",
    opacity: isDragging ? 0.4 : 1,
  };

  const timeLabel = passive
    ? entry.spanInfo?.toIso
      ? `→ ${shortDow(entry.spanInfo.toIso)}`
      : `${formatMinutes(waitingMins)} passive`
    : minutes > 0
    ? formatMinutes(minutes)
    : "—";

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      style={root}
      className="hover:bg-[color:var(--wp-hover-bg)] hover:translate-x-[1px]"
      {...(dragHandleProps ?? {})}
    >
      {density === "compact" ? (
        <CompactRow
          stepName={stepName}
          productName={entry.productName}
          isLocked={entry.isLocked}
          passive={passive}
          conflict={conflict}
          timeLabel={timeLabel}
        />
      ) : (
        <TwoLineRow
          stepName={stepName}
          productName={entry.productName}
          pieces={entry.pieces}
          isLocked={entry.isLocked}
          passive={passive}
          conflict={conflict}
          timeLabel={timeLabel}
          spanInfo={entry.spanInfo}
        />
      )}
    </div>
  );
}

function TwoLineRow({
  stepName,
  productName,
  pieces,
  isLocked,
  passive,
  conflict,
  timeLabel,
  spanInfo,
}: {
  stepName: string;
  productName: string;
  pieces: number;
  isLocked: boolean;
  passive: boolean;
  conflict: boolean;
  timeLabel: string;
  spanInfo?: { fromIso: string; toIso: string } | null;
}) {
  return (
    <>
      <div className="flex items-baseline gap-1">
        <span className="flex-1 truncate inline-flex items-center gap-1" style={{ fontWeight: 500 }}>
          {conflict && <AlertTriangle className="w-3 h-3" style={{ color: "var(--wp-rose)" }} />}
          {isLocked && !passive && !conflict && <Lock className="w-3 h-3" style={{ color: "var(--wp-teal)" }} />}
          {passive && <Hourglass className="w-3 h-3" style={{ color: "var(--wp-text-muted)" }} />}
          {stepName}
        </span>
        <span className="tabular-nums shrink-0" style={{ color: "var(--wp-text-muted)" }}>
          {timeLabel}
        </span>
      </div>
      <div className="text-[10px] tabular-nums truncate" style={{ color: "var(--wp-text-muted)" }}>
        {productName}
        {pieces > 0 && ` · ${pieces} pcs`}
        {spanInfo?.fromIso && ` · from ${shortDow(spanInfo.fromIso)}`}
      </div>
    </>
  );
}

function CompactRow({
  stepName,
  productName,
  isLocked,
  passive,
  conflict,
  timeLabel,
}: {
  stepName: string;
  productName: string;
  isLocked: boolean;
  passive: boolean;
  conflict: boolean;
  timeLabel: string;
}) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="flex-1 truncate inline-flex items-center gap-1">
        {conflict && <AlertTriangle className="w-3 h-3" style={{ color: "var(--wp-rose)" }} />}
        {isLocked && !passive && !conflict && <Lock className="w-3 h-3" style={{ color: "var(--wp-teal)" }} />}
        {passive && <Hourglass className="w-3 h-3" style={{ color: "var(--wp-text-muted)" }} />}
        <span style={{ fontWeight: 500 }}>{stepName}</span>
        <span style={{ color: "var(--wp-text-muted)" }}>· {productName}</span>
      </span>
      <span className="tabular-nums shrink-0" style={{ color: "var(--wp-text-muted)" }}>
        {timeLabel}
      </span>
    </div>
  );
}

function shortDow(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short" });
}
