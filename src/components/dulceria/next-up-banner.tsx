"use client";

import type { ReactNode } from "react";
import { IconPlayerPlay, IconAlertTriangle } from "@tabler/icons-react";

export type NextUpVariant = "next" | "in-progress" | "behind" | "done";

const VARIANT_STYLE: Record<NextUpVariant, { bg: string; border: string; color: string; label: string }> = {
  next: {
    bg: "var(--ds-tint-warn)",
    border: "var(--ds-semantic-warn)",
    color: "var(--ds-semantic-warn)",
    label: "⏵ Next up",
  },
  "in-progress": {
    bg: "var(--ds-tint-warn)",
    border: "var(--ds-semantic-warn)",
    color: "var(--ds-semantic-warn)",
    label: "▶ In progress",
  },
  behind: {
    bg: "var(--ds-tint-critical)",
    border: "var(--ds-tier-urgent)",
    color: "var(--ds-tier-urgent)",
    label: "⚠ Behind schedule",
  },
  done: {
    bg: "var(--ds-tint-ok)",
    border: "var(--ds-tier-positive)",
    color: "var(--ds-tier-positive)",
    label: "✓ Complete",
  },
};

/**
 * "Next up" banner — campaign detail header strip.
 * Caramel tint when something's queued; rose when overdue.
 */
export function NextUpBanner({
  variant,
  title,
  meta,
  action,
}: {
  variant: NextUpVariant;
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  const s = VARIANT_STYLE[variant];
  return (
    <section
      style={{
        background: s.bg,
        border: `0.5px solid ${s.border}`,
        borderLeft: `3px solid ${s.border}`,
        borderRadius: 8,
        padding: "14px 18px",
        display: "flex",
        alignItems: "center",
        gap: 16,
      }}
    >
      <div style={{ color: s.color, display: "inline-flex" }}>
        {variant === "behind" ? (
          <IconAlertTriangle size={20} stroke={1.5} />
        ) : (
          <IconPlayerPlay size={20} stroke={1.5} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: s.color,
            fontWeight: 600,
          }}
        >
          {s.label}
        </p>
        <p
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 18,
            fontWeight: 600,
            color: "var(--ds-text-primary)",
            marginTop: 2,
          }}
        >
          {title}
        </p>
        {meta && (
          <p
            style={{
              fontSize: 12,
              color: "var(--ds-text-muted)",
              fontStyle: "italic",
              marginTop: 2,
            }}
          >
            {meta}
          </p>
        )}
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </section>
  );
}
