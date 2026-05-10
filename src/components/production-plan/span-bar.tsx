"use client";

export interface SpanBarLayout {
  /** Column index of the start day (0..6). */
  startCol: number;
  /** Column index of the end day (0..6). */
  endCol: number;
  /** Number of grid columns total (always 7 for week grid). */
  totalCols: number;
  /** Vertical position from the grid top in px. */
  topPx: number;
}

export function SpanBar({
  layout,
  label,
}: {
  layout: SpanBarLayout;
  label: string;
}) {
  // Use percentages so the span resizes with the grid on window resize.
  const colWidthPct = 100 / layout.totalCols;
  const leftPct = layout.startCol * colWidthPct;
  const widthPct = (layout.endCol - layout.startCol + 1) * colWidthPct;
  return (
    <div
      style={{
        position: "absolute",
        left: `calc(${leftPct}% + 8px)`,
        width: `calc(${widthPct}% - 16px)`,
        top: layout.topPx,
        height: 24,
        background: "var(--wp-card-bg)",
        border: "0.5px dashed var(--wp-text-muted)",
        borderLeft: "3px dashed var(--wp-text-muted)",
        borderRadius: 3,
        fontStyle: "italic",
        fontSize: 11,
        lineHeight: "24px",
        color: "var(--wp-text-muted)",
        padding: "0 8px",
        pointerEvents: "none",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      ⏱ {label}
    </div>
  );
}
