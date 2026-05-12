"use client";

import type { ReactNode } from "react";

export type StatusTagKind =
  | "pending"
  | "scheduled"
  | "ready"
  | "overdue"
  | "done"
  | "neutral";

interface Style {
  color: string;
  borderColor: string;
  background: string;
  opacity?: number;
}

const STYLES: Record<StatusTagKind, Style> = {
  pending: {
    color: "var(--ds-semantic-warn)",
    borderColor: "var(--ds-semantic-warn)",
    background: "var(--ds-card-bg)",
  },
  scheduled: {
    color: "var(--ds-tier-positive)",
    borderColor: "var(--ds-tier-positive)",
    background: "var(--ds-card-bg)",
  },
  ready: {
    color: "var(--ds-tier-positive)",
    borderColor: "transparent",
    background: "var(--ds-tint-ok)",
  },
  overdue: {
    color: "var(--ds-semantic-critical)",
    borderColor: "var(--ds-semantic-critical)",
    background: "var(--ds-card-bg)",
  },
  done: {
    color: "var(--ds-text-muted)",
    borderColor: "var(--ds-border-warm)",
    background: "var(--ds-card-bg)",
    opacity: 0.6,
  },
  neutral: {
    color: "var(--ds-text-muted)",
    borderColor: "var(--ds-border-warm)",
    background: "var(--ds-card-bg)",
  },
};

/**
 * Production-app design-system status tag. Hard rule: caller renders at
 * most TWO of these per row (channel goes in the meta line, not as a
 * tag — see spec phase 2 "Status tags").
 */
export function StatusTag({
  kind,
  children,
}: {
  kind: StatusTagKind;
  children: ReactNode;
}) {
  const s = STYLES[kind];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 12,
        fontSize: 11,
        border: `0.5px solid ${s.borderColor}`,
        background: s.background,
        color: s.color,
        opacity: s.opacity,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}
