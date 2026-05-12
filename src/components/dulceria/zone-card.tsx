"use client";

import type { ReactNode } from "react";
import Link from "next/link";

export type ZoneVariant = "urgent" | "warn" | "ok" | "info";

const ACCENT: Record<ZoneVariant, string> = {
  urgent: "var(--ds-tier-urgent)",
  warn: "var(--ds-semantic-warn)",
  ok: "var(--ds-tier-positive)",
  info: "var(--ds-semantic-info)",
};

const STATUS_COLOR: Record<ZoneVariant, string> = {
  urgent: "var(--ds-tier-urgent)",
  warn: "var(--ds-semantic-warn)",
  ok: "var(--ds-tier-positive)",
  info: "var(--ds-semantic-info)",
};

const VALUE_COLOR: Partial<Record<ZoneVariant, string>> = {
  urgent: "var(--ds-tier-urgent)",
  warn: "var(--ds-semantic-warn)",
  ok: "var(--ds-tier-positive)",
};

/**
 * Dashboard zone card — replaces the legacy pastel-filled stat strip.
 *
 * 6 of these sit across the top of the main dashboard. Left border = 3px
 * variant colour, body white, big Playfair value, italic muted subtitle,
 * "open →" footer that links into the underlying page.
 */
export function ZoneCard({
  label,
  status,
  statusVariant,
  value,
  subtitle,
  href,
  onClick,
  accentVariant,
  footerLabel = "open →",
}: {
  label: string;
  status: string;
  statusVariant: ZoneVariant;
  value: ReactNode;
  subtitle: string;
  href?: string;
  onClick?: () => void;
  accentVariant: ZoneVariant;
  footerLabel?: string;
}) {
  const inner = (
    <div
      onClick={onClick}
      style={{
        background: "var(--ds-card-bg)",
        border: "0.5px solid var(--ds-border-warm)",
        borderLeft: `3px solid ${ACCENT[accentVariant]}`,
        borderRadius: 8,
        overflow: "hidden",
        cursor: href || onClick ? "pointer" : "default",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        transition: "border-color 0.15s",
        color: "var(--ds-text-primary)",
      }}
      className="hover:[border-color:var(--ds-tier-quarter-focus)]"
    >
      <div style={{ padding: "12px 14px 8px", flex: 1 }}>
        <div
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--ds-text-muted)",
            fontWeight: 600,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>{label}</span>
          <span
            style={{
              textTransform: "none",
              letterSpacing: 0,
              fontWeight: 500,
              fontSize: 10,
              color: STATUS_COLOR[statusVariant],
            }}
          >
            {status}
          </span>
        </div>
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 32,
            fontWeight: 600,
            lineHeight: 1.1,
            marginTop: 4,
            fontVariantNumeric: "tabular-nums",
            color: VALUE_COLOR[accentVariant] ?? "var(--ds-text-primary)",
          }}
        >
          {value}
        </div>
        <p
          style={{
            fontSize: 11,
            color: "var(--ds-text-muted)",
            fontStyle: "italic",
            marginTop: 2,
            lineHeight: 1.3,
          }}
        >
          {subtitle}
        </p>
      </div>
      <div
        style={{
          padding: "8px 14px",
          background: "var(--ds-page-bg)",
          borderTop: "0.5px solid var(--ds-border-warm)",
          fontSize: 11,
          color: "var(--ds-text-muted)",
        }}
      >
        {footerLabel}
      </div>
    </div>
  );
  if (href) {
    return (
      <Link href={href} style={{ color: "inherit", textDecoration: "none" }}>
        {inner}
      </Link>
    );
  }
  return inner;
}
