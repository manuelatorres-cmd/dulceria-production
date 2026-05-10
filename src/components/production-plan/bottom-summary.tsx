"use client";

import { ArrowRight } from "lucide-react";
import { formatMinutes } from "./format-minutes";

export interface BottomSummaryProps {
  /** Days, batches and minutes covered by the visible week. */
  thisWeek: {
    daysActive: number;
    batches: number;
    plannedMinutes: number;
    peak: { iso: string; batches: number; pct: number } | null;
  };
  /** Same shape for next week. */
  nextWeek: {
    batches: number;
  };
  onJumpToNextWeek?: () => void;
}

export function BottomSummary({ thisWeek, nextWeek, onJumpToNextWeek }: BottomSummaryProps) {
  return (
    <section
      className="weekly-plan-v2 mt-3 px-4 py-3"
      style={{
        background: "var(--wp-card-bg)",
        border: "0.5px solid var(--wp-border-warm)",
        borderRadius: 8,
        color: "var(--wp-text-primary)",
      }}
    >
      <p className="text-[12px] tabular-nums" style={{ color: "var(--wp-text-muted)" }}>
        <strong style={{ fontWeight: 500, color: "var(--wp-text-primary)" }}>This week</strong>
        {" · "}
        {thisWeek.daysActive} day{thisWeek.daysActive === 1 ? "" : "s"}
        {" · "}
        {thisWeek.batches} batches
        {" · "}
        {formatMinutes(thisWeek.plannedMinutes)}
        {thisWeek.peak && (
          <>
            {" · "}peak {shortDate(thisWeek.peak.iso)} ({thisWeek.peak.batches}b · {thisWeek.peak.pct}%)
          </>
        )}
      </p>
      <p className="mt-1 text-[12px]" style={{ color: "var(--wp-text-muted)" }}>
        <strong style={{ fontWeight: 500, color: "var(--wp-text-primary)" }}>Next week</strong>
        {" · "}
        {nextWeek.batches > 0
          ? `${nextWeek.batches} batches scheduled`
          : "empty · regenerate to populate"}
        {onJumpToNextWeek && (
          <button
            type="button"
            onClick={onJumpToNextWeek}
            className="ml-2 inline-flex items-center gap-1 text-[11.5px] underline-offset-2 hover:underline"
            style={{ color: "var(--wp-teal)" }}
          >
            view <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </p>
    </section>
  );
}

function shortDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso;
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}
