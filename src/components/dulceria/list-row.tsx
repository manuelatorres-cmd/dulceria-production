"use client";

import type { ReactNode } from "react";

export type ListRowTier =
  | "default"
  | "urgent"
  | "active"
  | "parked"
  | "done"
  | "positive";

const BORDER: Record<ListRowTier, string> = {
  default: "transparent",
  urgent: "var(--ds-tier-urgent)",
  active: "var(--ds-tier-active)",
  parked: "var(--ds-tier-parked)",
  done: "transparent",
  positive: "var(--ds-tier-positive)",
};

const OPACITY: Record<ListRowTier, number> = {
  default: 1,
  urgent: 1,
  active: 1,
  parked: 0.7,
  done: 0.5,
  positive: 1,
};

/**
 * Production-app design-system list row.
 *
 * Used by orders, batches, tasks, etc. The visual contract: tier-coloured
 * 3px left border, hover bg shift, max two status tags rendered by the
 * caller in the side slot — channel info goes in the meta line, not as
 * a tag.
 */
export function ListRow({
  title,
  meta,
  secondary,
  side,
  tier = "default",
  onClick,
}: {
  title: ReactNode;
  meta?: ReactNode;
  /** Optional second meta line below the first. */
  secondary?: ReactNode;
  /** Right-aligned content — date + at most one status tag. */
  side?: ReactNode;
  tier?: ListRowTier;
  onClick?: () => void;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      style={{
        borderLeft: `3px solid ${BORDER[tier]}`,
        padding: "12px 20px",
        borderBottom: "0.5px solid var(--ds-border-warm)",
        display: "flex",
        justifyContent: "space-between",
        gap: 16,
        cursor: onClick ? "pointer" : "default",
        transition: "background 0.1s",
        opacity: OPACITY[tier],
      }}
      className={onClick ? "hover:bg-[color:var(--ds-card-bg-hover)]" : undefined}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            marginBottom: 4,
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          {title}
        </div>
        {meta && <div className="text-ds-meta" style={{ marginTop: 2 }}>{meta}</div>}
        {secondary && <div className="text-ds-meta" style={{ marginTop: 2 }}>{secondary}</div>}
      </div>
      {side && (
        <div
          style={{
            textAlign: "right",
            whiteSpace: "nowrap",
            fontSize: 12,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 4,
          }}
        >
          {side}
        </div>
      )}
    </div>
  );
}
