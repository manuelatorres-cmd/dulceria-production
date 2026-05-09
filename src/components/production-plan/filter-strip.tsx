"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Filter, Grid3x3 } from "lucide-react";

export interface FilterStripCounts {
  /** Number of source pills currently rendered after applying the active focus. */
  visibleSourceCount: number;
  /** Total number of source pills available (campaigns + POs + orders). */
  totalSourceCount: number;
  orderCount: number;
  campaignCount: number;
  poCount: number;
}

/**
 * Collapsible filter strip — 36px tall when collapsed, expands to render
 * the existing ScheduledPanel (or any expanded filter UI) inline.
 *
 * State is local: collapsed/expanded toggles per-page. URL filter state
 * stays where it already lives (focusTokens + focus param).
 */
export function FilterStrip({
  counts,
  hasActiveFilter,
  onResetFilter,
  expanded: controlledExpanded,
  onExpandedChange,
  children,
}: {
  counts: FilterStripCounts;
  /** True when user has narrowed the filter from default. Drives the
   *  active-filter chip + reset button. */
  hasActiveFilter: boolean;
  onResetFilter: () => void;
  /** Optional controlled expansion. When omitted the strip is uncontrolled. */
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
  /** Rendered inside the expanded panel. Typically the existing filter UI. */
  children: ReactNode;
}) {
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(false);
  const expanded = controlledExpanded ?? uncontrolledExpanded;
  const setExpanded = (next: boolean) => {
    if (onExpandedChange) onExpandedChange(next);
    else setUncontrolledExpanded(next);
  };

  return (
    <section
      className="weekly-plan-v2 mb-3"
      style={{
        background: "var(--wp-card-bg)",
        border: "0.5px solid var(--wp-border-warm)",
        borderRadius: 8,
        color: "var(--wp-text-primary)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between gap-3 px-4 py-2"
        style={{ minHeight: 36 }}
      >
        <span className="flex items-center gap-2 text-[12px] min-w-0">
          {hasActiveFilter ? (
            <Filter className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--wp-rose)" }} />
          ) : (
            <Grid3x3 className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--wp-text-muted)" }} />
          )}
          {hasActiveFilter ? (
            <span className="truncate" style={{ color: "var(--wp-text-primary)" }}>
              Filtered: <strong className="tabular-nums" style={{ fontWeight: 500 }}>{counts.visibleSourceCount}</strong>
              {" of "}
              <strong className="tabular-nums" style={{ fontWeight: 500 }}>{counts.totalSourceCount}</strong>
              {" sources"}
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onResetFilter();
                }}
                className="ml-2 underline-offset-2 hover:underline cursor-pointer"
                style={{ color: "var(--wp-rose)" }}
              >
                reset
              </span>
            </span>
          ) : (
            <span className="truncate" style={{ color: "var(--wp-text-muted)" }}>
              <strong className="tabular-nums" style={{ fontWeight: 500, color: "var(--wp-text-primary)" }}>
                {counts.visibleSourceCount}
              </strong>{" "}
              source{counts.visibleSourceCount === 1 ? "" : "s"} visible
              {(counts.orderCount > 0 || counts.campaignCount > 0 || counts.poCount > 0) && (
                <>
                  {" · "}
                  {[
                    counts.orderCount > 0 ? `${counts.orderCount} ord` : "",
                    counts.campaignCount > 0 ? `${counts.campaignCount} cmp` : "",
                    counts.poCount > 0 ? `${counts.poCount} PO${counts.poCount === 1 ? "" : "s"}` : "",
                  ]
                    .filter(Boolean)
                    .join(" + ")}
                </>
              )}
            </span>
          )}
        </span>
        <span
          className="text-[11px] inline-flex items-center gap-1 shrink-0"
          style={{ color: "var(--wp-text-muted)" }}
        >
          {expanded ? "hide details" : "show details"}
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </span>
      </button>

      {expanded && (
        <div style={{ borderTop: "0.5px solid var(--wp-border-warm)" }}>
          {children}
        </div>
      )}
    </section>
  );
}
