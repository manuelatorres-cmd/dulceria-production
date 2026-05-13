"use client";

import Link from "next/link";

export interface DsTabNavTab {
  id: string;
  label: string;
  /** Optional href — if provided, tab renders as a Next.js Link. */
  href?: string;
  /** Optional count chip after label. */
  count?: number;
  /** Optional dot badge variant. */
  badge?: "urgent" | "warn" | "ok";
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
          const baseStyle: React.CSSProperties = {
            padding: "3px 10px",
            fontSize: 11,
            border: `0.5px solid ${active ? "var(--ds-tier-quarter-focus)" : "var(--ds-border-warm)"}`,
            background: active ? "var(--ds-tier-quarter-focus)" : "var(--ds-card-bg)",
            color: active ? "#ffffff" : "var(--ds-text-muted)",
            borderRadius: 12,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            textDecoration: "none",
          };
          const content = (
            <>
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
