"use client";

/**
 * One stage chip in the ManualWeekGantt cell. Renders an abbreviation
 * (POL/SHE/FIL/CAP/UNM/SEAL) + active minutes, colored by the step's
 * sortOrder so neighbouring stages contrast.
 *
 * Drag identity: the (planId, stepId, sourceDate) triple is encoded in
 * the dnd-kit useDraggable id so the page-level handleDragEnd can
 * dispatch to moveProductionStepsToDate without spec-knowledge here.
 */

import { useDraggable } from "@dnd-kit/core";

const ABBREVIATIONS: Record<string, string> = {
  polishing: "POL",
  shelling: "SHE",
  shell: "SHE",
  "fill prep": "FP",
  filling: "FIL",
  fill: "FIL",
  cap: "CAP",
  capping: "CAP",
  unmould: "UNM",
  unmoulding: "UNM",
  unmold: "UNM",
  sealing: "SEAL",
  seal: "SEAL",
  paint: "PNT",
  painting: "PNT",
  decoration: "DEC",
  decorating: "DEC",
  packing: "PCK",
  packaging: "PCK",
};

export function abbreviateStep(name: string): string {
  const key = name.trim().toLowerCase();
  if (ABBREVIATIONS[key]) return ABBREVIATIONS[key];
  return name.slice(0, 3).toUpperCase();
}

// Palette indexed by sortOrder (cycles after 6).
const PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: "#d6e6e2", fg: "#1c4a44" }, // pale teal
  { bg: "#f0e7cf", fg: "#6b5418" }, // pale gold
  { bg: "#f5d9c4", fg: "#7a3f1c" }, // caramel
  { bg: "#f5d9d3", fg: "#8a3a2c" }, // blush
  { bg: "#e0d5e5", fg: "#4d2e5a" }, // lavender
  { bg: "#d5e5dc", fg: "#2c5340" }, // mint
];

export function chipColor(sortOrder: number): { bg: string; fg: string } {
  const idx = ((sortOrder % PALETTE.length) + PALETTE.length) % PALETTE.length;
  return PALETTE[idx];
}

export function formatMinutes(min: number): string {
  if (min <= 0) return "—";
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function StageChip({
  planId,
  stepId,
  sourceDate,
  stepName,
  activeMinutes,
  sortOrder,
  isDone,
  onClick,
  draggable = true,
}: {
  planId: string;
  stepId: string;
  sourceDate: string;
  stepName: string;
  activeMinutes: number;
  sortOrder: number;
  isDone?: boolean;
  onClick?: () => void;
  draggable?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `stage-${planId}-${stepId}-${sourceDate}`,
    data: { kind: "stage", planId, stepId, sourceDate },
    disabled: !draggable,
  });

  const palette = chipColor(sortOrder);
  const abbrev = abbreviateStep(stepName);
  const minsLabel = formatMinutes(activeMinutes);

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={onClick}
      title={`${stepName} · ${minsLabel}${isDone ? " · done" : ""}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 6px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        background: palette.bg,
        color: palette.fg,
        border: isDone ? "1px solid currentColor" : "1px solid transparent",
        opacity: isDragging ? 0.4 : isDone ? 0.7 : 1,
        cursor: draggable ? "grab" : "pointer",
        textDecoration: isDone ? "line-through" : "none",
        fontFamily: "inherit",
        lineHeight: 1.2,
        whiteSpace: "nowrap",
      }}
    >
      <span>{abbrev}</span>
      <span style={{ fontWeight: 500, opacity: 0.85 }}>{minsLabel}</span>
    </button>
  );
}
