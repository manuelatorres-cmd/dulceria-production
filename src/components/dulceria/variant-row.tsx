"use client";

import Link from "next/link";

export type VariantRowStatus = "ongoing" | "past" | "upcoming" | "standard";

const ACCENT: Record<VariantRowStatus, string> = {
  ongoing: "var(--ds-tier-positive)",
  past: "var(--ds-tier-parked)",
  upcoming: "var(--ds-semantic-warn)",
  standard: "var(--ds-tier-quarter-focus)",
};

const STATUS_TINT: Record<VariantRowStatus, { bg: string; color: string }> = {
  ongoing: { bg: "var(--ds-tint-ok)", color: "var(--ds-tier-positive)" },
  past: { bg: "var(--ds-tint-info)", color: "var(--ds-tier-parked)" },
  upcoming: { bg: "var(--ds-tint-warn)", color: "var(--ds-semantic-warn)" },
  standard: { bg: "var(--ds-tint-info)", color: "var(--ds-tier-quarter-focus)" },
};

export function VariantRow({
  href,
  name,
  sub,
  dates,
  status,
  statusLabel,
}: {
  href: string;
  name: string;
  sub?: string;
  dates?: string;
  status: VariantRowStatus;
  statusLabel: string;
}) {
  const accent = ACCENT[status];
  const tint = STATUS_TINT[status];
  return (
    <Link
      href={href}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto auto",
        gap: 16,
        alignItems: "center",
        padding: "12px 16px",
        background: "var(--ds-card-bg)",
        border: "0.5px solid var(--ds-border-warm)",
        borderLeft: `3px solid ${accent}`,
        borderRadius: 6,
        color: "var(--ds-text-primary)",
        textDecoration: "none",
        opacity: status === "past" ? 0.65 : 1,
      }}
      className="hover:[border-color:var(--ds-tier-quarter-focus)]"
    >
      <div style={{ minWidth: 0 }}>
        <strong
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 14,
            fontWeight: 500,
            display: "block",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </strong>
        {sub && (
          <p
            style={{
              fontSize: 11,
              color: "var(--ds-text-muted)",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {sub}
          </p>
        )}
      </div>
      {dates && (
        <span
          style={{
            fontSize: 11,
            color: "var(--ds-text-muted)",
            fontVariantNumeric: "tabular-nums",
            fontStyle: "italic",
            whiteSpace: "nowrap",
          }}
        >
          {dates}
        </span>
      )}
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          padding: "3px 8px",
          borderRadius: 3,
          background: tint.bg,
          color: tint.color,
          whiteSpace: "nowrap",
        }}
      >
        {statusLabel}
      </span>
    </Link>
  );
}
