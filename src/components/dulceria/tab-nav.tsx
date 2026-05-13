"use client";

import Link from "next/link";
import { IconCheck } from "@tabler/icons-react";

export interface DsTabNavTab {
  id: string;
  label: string;
  /** Optional href — if provided, tab renders as a Next.js Link. */
  href?: string;
  /** Optional count chip after label. */
  count?: number;
  /** Optional dot badge variant. */
  badge?: "urgent" | "warn" | "ok";
  /** Optional explicit state for wizard-style step pills. Overrides
   *  activeTab derivation:
   *    - "completed" → mint background + check icon (past steps)
   *    - "active"    → deep teal pill (current step)
   *    - "future"    → muted pill (upcoming steps)
   *  Only used by `variant="pills"`. */
  state?: "completed" | "active" | "future";
}

export interface DsTabNavProps {
  tabs: DsTabNavTab[];
  activeTab: string;
  onChange?: (id: string) => void;
  variant?: "underline" | "pills";
}

/**
 * Production-app design-system tab nav. One component for every page
 * that uses tabs. Underline variant for primary tab strips; pills for
 * filter rows.
 */
export function DsTabNav({
  tabs,
  activeTab,
  onChange,
  variant = "underline",
}: DsTabNavProps) {
  if (variant === "pills") {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {tabs.map((t) => {
          const active = t.id === activeTab;
          // Step-pill state overrides activeTab styling. `completed`
          // pills stay tappable so users can jump back to a previous
          // step; `future` pills are muted but also tappable so they
          // can preview ahead. Only the visual differs.
          const state: "completed" | "active" | "future" | null = t.state
            ?? (active ? "active" : null);
          let border = "var(--ds-border-warm)";
          let background = "var(--ds-card-bg)";
          let color: string = "var(--ds-text-muted)";
          if (state === "active") {
            border = "var(--ds-tier-quarter-focus)";
            background = "var(--ds-tier-quarter-focus)";
            color = "#ffffff";
          } else if (state === "completed") {
            border = "var(--accent-mint-ink, #4ea58a)";
            background = "var(--accent-mint-bg, #e5f3ec)";
            color = "var(--accent-mint-ink, #2f7259)";
          } else if (state === "future") {
            border = "var(--ds-border-warm)";
            background = "var(--ds-card-bg)";
            color = "var(--ds-text-muted)";
          }
          const baseStyle: React.CSSProperties = {
            padding: "3px 10px",
            fontSize: 11,
            border: `0.5px solid ${border}`,
            background,
            color,
            borderRadius: 12,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            textDecoration: "none",
          };
          const content = (
            <>
              {state === "completed" && (
                <IconCheck size={11} stroke={2.4} style={{ marginRight: 1 }} />
              )}
              {t.label}
              {typeof t.count === "number" && (
                <span style={{ fontSize: 10, opacity: 0.7 }}>{t.count}</span>
              )}
              {t.badge && <BadgeDot variant={t.badge} />}
            </>
          );
          return t.href ? (
            <Link key={t.id} href={t.href} style={baseStyle}>
              {content}
            </Link>
          ) : (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange?.(t.id)}
              style={baseStyle}
            >
              {content}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 0,
        borderBottom: "0.5px solid var(--ds-border-warm)",
      }}
    >
      {tabs.map((t) => {
        const active = t.id === activeTab;
        const baseStyle: React.CSSProperties = {
          padding: "8px 16px",
          cursor: "pointer",
          fontSize: 13,
          color: active ? "var(--ds-text-primary)" : "var(--ds-text-muted)",
          borderBottom: `2px solid ${active ? "var(--ds-tier-quarter-focus)" : "transparent"}`,
          marginBottom: "-0.5px",
          background: "transparent",
          borderLeft: "none",
          borderRight: "none",
          borderTop: "none",
          fontWeight: active ? 500 : 400,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          textDecoration: "none",
        };
        const content = (
          <>
            <span>{t.label}</span>
            {typeof t.count === "number" && (
              <span style={{ fontSize: 11, color: "var(--ds-text-muted)" }}>
                {t.count}
              </span>
            )}
            {t.badge && <BadgeDot variant={t.badge} />}
          </>
        );
        return t.href ? (
          <Link key={t.id} href={t.href} style={baseStyle}>
            {content}
          </Link>
        ) : (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange?.(t.id)}
            style={baseStyle}
            className="hover:[color:var(--ds-text-primary)]"
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}

function BadgeDot({ variant }: { variant: "urgent" | "warn" | "ok" }) {
  const bg =
    variant === "urgent"
      ? "var(--ds-tier-urgent)"
      : variant === "warn"
      ? "var(--ds-semantic-warn)"
      : "var(--ds-tier-positive)";
  return (
    <span
      aria-hidden
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: bg,
        display: "inline-block",
      }}
    />
  );
}
