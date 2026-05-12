"use client";

import type { ReactNode } from "react";
import { IconRefresh as RefreshCw, IconFlame as Flame } from "@tabler/icons-react";
import Link from "next/link";
import { DsButton } from "@/components/dulceria";

export type PlanViewMode = "day" | "week" | "pivot" | "month";

const VIEW_LABELS: Record<PlanViewMode, string> = {
  day: "Day",
  week: "Week",
  pivot: "Pivot",
  month: "Month",
};

export interface PlanHeaderStats {
  /** Total scheduled batches across the visible window. */
  totalBatches: number;
  /** Distinct days with at least one line item. */
  daysCovered: number;
  /** ISO yyyy-mm-dd of the first day with line items, or null. */
  windowStart: string | null;
  /** ISO yyyy-mm-dd of the last day with line items, or null. */
  windowEnd: string | null;
  /** Sum of plannedMinutes across all visible line items. */
  totalPlannedMinutes: number;
  /** Sum of effective daily capacity across the visible days. */
  totalCapacityMinutes: number;
  /** Days at warn / critical / over level. */
  tightDays: number;
  /** The day with the most batches in the window. */
  peakDay: { date: string; batches: number; capacityPct: number } | null;
}

export function PlanHeader({
  stats,
  view,
  onViewChange,
  onRegenerate,
  regenerating,
  configIncomplete,
  /** Custom selector for the focus dropdown — page builds it because
   *  the option list pulls from campaigns/POs/orders. */
  focusSlot,
  /** Optional inline pill rendered after the focus selector — e.g. the
   *  active focus chip with a clear button. */
  focusActiveChip,
  /** Right-aligned secondary actions (e.g. "Filling cooking list" link).
   *  When omitted the default "Filling cooking list" link is shown so
   *  callers can opt out. */
  secondaryActions,
  /** Slot for the "Last update X · Y ago" line under the regenerate button. */
  lastRegenSlot,
}: {
  stats: PlanHeaderStats;
  view: PlanViewMode;
  onViewChange: (v: PlanViewMode) => void;
  onRegenerate: () => void;
  regenerating: boolean;
  configIncomplete: boolean;
  focusSlot: ReactNode;
  focusActiveChip?: ReactNode;
  secondaryActions?: ReactNode;
  lastRegenSlot?: ReactNode;
}) {
  return (
    <div
      className="weekly-plan-v2 mb-3 px-4 py-3"
      style={{
        background: "var(--wp-card-bg)",
        border: "0.5px solid var(--wp-border-warm)",
        borderRadius: 8,
        color: "var(--wp-text-primary)",
      }}
    >
      {/* Row 1 — title + meta + actions */}
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-3 flex-wrap min-w-0">
          <h1
            className="text-[26px] tracking-[-0.025em]"
            style={{ fontFamily: "var(--font-serif)", fontWeight: 600, color: "var(--wp-text-primary)" }}
          >
            Production plan
          </h1>
          <span className="text-[12px] italic" style={{ color: "var(--wp-text-muted)" }}>
            {stats.totalBatches} batch{stats.totalBatches === 1 ? "" : "es"} ·{" "}
            {stats.daysCovered} day{stats.daysCovered === 1 ? "" : "s"}
          </span>
          {focusActiveChip}
          {focusSlot}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {stats.tightDays > 0 && (
            <span
              className="text-[11px] font-medium px-2.5 py-0.5 tabular-nums"
              style={{
                background: "var(--wp-draft-tint)",
                border: "0.5px solid var(--wp-caramel)",
                color: "var(--wp-text-primary)",
                borderRadius: 14,
              }}
            >
              {stats.tightDays} tight day{stats.tightDays === 1 ? "" : "s"}
            </span>
          )}
          <DsButton
            variant="primary"
            size="sm"
            onClick={onRegenerate}
            disabled={regenerating || configIncomplete}
            style={{
              borderRadius: 14,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontWeight: 500,
            }}
          >
            <RefreshCw className={`w-3 h-3 ${regenerating ? "animate-spin" : ""}`} />
            {regenerating ? "Regenerating…" : "Regenerate"}
          </DsButton>
        </div>
      </div>

      {lastRegenSlot && (
        <div className="mt-1 text-right">{lastRegenSlot}</div>
      )}

      {/* Row 2 — stats strip */}
      <p
        className="mt-2 text-[12px] tabular-nums"
        style={{ color: "var(--wp-text-muted)" }}
      >
        {renderStatsStrip(stats)}
      </p>

      {/* Row 3 — view switcher + secondary actions */}
      <div
        className="mt-3 pt-3 flex items-center justify-between gap-2 flex-wrap"
        style={{ borderTop: "0.5px solid var(--wp-border-warm)" }}
      >
        <div
          className="inline-flex items-center text-[11px] overflow-hidden"
          style={{
            border: "0.5px solid var(--wp-border-warm)",
            background: "var(--wp-card-bg)",
            borderRadius: 14,
          }}
        >
          {(Object.keys(VIEW_LABELS) as PlanViewMode[]).map((m) => {
            const active = view === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => onViewChange(m)}
                className="px-3 py-1 transition-colors"
                style={{
                  background: active ? "var(--wp-teal)" : "transparent",
                  color: active ? "#ffffff" : "var(--wp-text-muted)",
                }}
              >
                {VIEW_LABELS[m]}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          {secondaryActions ?? (
            <Link
              href="/plan/fillings"
              className="inline-flex items-center gap-1.5 px-3 py-1 text-[11px] hover:bg-[color:var(--wp-hover-bg)]"
              style={{
                border: "0.5px solid var(--wp-border-warm)",
                background: "var(--wp-card-bg)",
                color: "var(--wp-text-primary)",
                borderRadius: 14,
              }}
            >
              <Flame className="w-3 h-3" /> Filling cooking list
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function renderStatsStrip(s: PlanHeaderStats): string {
  const parts: string[] = [];
  parts.push(`${s.daysCovered} day${s.daysCovered === 1 ? "" : "s"}`);
  if (s.windowStart && s.windowEnd) {
    parts.push(`${shortDate(s.windowStart)}–${shortDate(s.windowEnd)}`);
  }
  parts.push(`${s.totalBatches} batches`);
  if (s.totalCapacityMinutes > 0) {
    const pct = Math.round((s.totalPlannedMinutes / s.totalCapacityMinutes) * 100);
    parts.push(`${pct}% (${formatMinutes(s.totalPlannedMinutes)}/${formatMinutes(s.totalCapacityMinutes)})`);
  } else {
    parts.push(`${formatMinutes(s.totalPlannedMinutes)} planned`);
  }
  parts.push(`${s.tightDays} tight`);
  if (s.peakDay) {
    parts.push(`peak ${shortDate(s.peakDay.date)} (${s.peakDay.batches}b · ${s.peakDay.capacityPct}%)`);
  }
  return parts.join(" · ");
}

function shortDate(iso: string): string {
  // "2026-05-08" → "08.05"
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso;
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

function formatMinutes(min: number): string {
  if (min <= 0) return "0m";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
