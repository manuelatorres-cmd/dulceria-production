"use client";

import type { ReactNode } from "react";

export type AttentionVariant = "default" | "critical" | "warn" | "info" | "positive";

const ACCENT: Record<AttentionVariant, string> = {
  default: "var(--ds-text-muted)",
  critical: "var(--ds-semantic-critical)",
  warn: "var(--ds-semantic-warn)",
  info: "var(--ds-semantic-info)",
  positive: "var(--ds-tier-positive)",
};

export function AttentionItem({
  icon,
  title,
  detail,
  action,
  variant = "default",
}: {
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
  variant?: AttentionVariant;
}) {
  return (
    <div
      style={{
        background: "var(--ds-card-bg)",
        border: "0.5px solid var(--ds-border-warm)",
        borderLeft: `3px solid ${ACCENT[variant]}`,
        borderRadius: 4,
        padding: "12px 14px",
        marginBottom: 8,
        display: "flex",
        gap: 10,
        color: "var(--ds-text-primary)",
      }}
    >
      {icon && (
        <span
          aria-hidden
          style={{
            fontSize: 14,
            color: "var(--ds-text-muted)",
            display: "inline-flex",
            alignItems: "flex-start",
            marginTop: 1,
          }}
        >
          {icon}
        </span>
      )}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{title}</div>
        {detail && (
          <div
            style={{
              fontSize: 12,
              color: "var(--ds-text-muted)",
              fontStyle: "italic",
              marginBottom: action ? 8 : 0,
            }}
          >
            {detail}
          </div>
        )}
        {action}
      </div>
    </div>
  );
}
