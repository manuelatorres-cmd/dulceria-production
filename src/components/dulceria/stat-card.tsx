"use client";

import type { ReactNode } from "react";

export type StatCardVariant =
  | "default"
  | "urgent"
  | "warn"
  | "ok"
  | "active"
  | "parked";

const ACCENT: Record<StatCardVariant, string> = {
  default: "var(--ds-tier-quarter-focus)",
  urgent: "var(--ds-tier-urgent)",
  warn: "var(--ds-semantic-warn)",
  ok: "var(--ds-tier-positive)",
  active: "var(--ds-tier-active)",
  parked: "var(--ds-tier-parked)",
};

/**
 * Production-app design-system stat card.
 *
 * Replaces the legacy pastel-filled cards. White card body + thin
 * tier-coloured left border + serif Playfair value, per spec.
 */
export function StatCard({
  label,
  value,
  meta,
  icon,
  variant = "default",
  onClick,
}: {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  icon?: ReactNode;
  variant?: StatCardVariant;
  onClick?: () => void;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      style={{
        background: "var(--ds-card-bg)",
        border: "0.5px solid var(--ds-border-warm)",
        borderLeft: `3px solid ${ACCENT[variant]}`,
        borderRadius: 8,
        padding: "14px 16px",
        minHeight: 80,
        maxWidth: 280,
        cursor: onClick ? "pointer" : "default",
        color: "var(--ds-text-primary)",
        transition: "background 0.1s",
      }}
      className={onClick ? "hover:bg-[color:var(--ds-card-bg-hover)]" : undefined}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 4,
        }}
      >
        <span className="text-ds-label">{label}</span>
        {icon && (
          <span style={{ color: "var(--ds-text-muted)", display: "inline-flex" }}>
            {icon}
          </span>
        )}
      </div>
      <div
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 32,
          fontWeight: 600,
          lineHeight: 1.2,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      {meta && <div className="text-ds-meta">{meta}</div>}
    </div>
  );
}
