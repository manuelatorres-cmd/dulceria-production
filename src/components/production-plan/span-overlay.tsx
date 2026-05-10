"use client";

import { SpanBar } from "./span-bar";

export interface SpanEntry {
  /** Composite key — planId + start. */
  key: string;
  /** Column index of the start day (0..6). */
  startCol: number;
  /** Column index of the end day (0..6). */
  endCol: number;
  /** Vertical position from the grid top in px. */
  topPx: number;
  label: string;
}

export function SpanOverlay({
  spans,
  totalCols = 7,
}: {
  spans: SpanEntry[];
  totalCols?: number;
}) {
  if (spans.length === 0) return null;
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
      }}
    >
      {spans.map((s) => (
        <SpanBar
          key={s.key}
          layout={{
            startCol: s.startCol,
            endCol: s.endCol,
            totalCols,
            topPx: s.topPx,
          }}
          label={s.label}
        />
      ))}
    </div>
  );
}
