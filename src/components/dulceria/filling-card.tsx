"use client";

import Link from "next/link";
import { AllergenDots } from "./allergen-dot";

export type FillingStatus = "confirmed" | "testing" | "to-try" | "unknown";

const ACCENT: Record<FillingStatus, string> = {
  confirmed: "var(--ds-tier-positive)",
  testing: "var(--ds-semantic-warn)",
  "to-try": "var(--ds-tier-urgent)",
  unknown: "var(--ds-tier-parked)",
};

const PILL: Record<FillingStatus, { bg: string; color: string }> = {
  confirmed: { bg: "var(--ds-tint-ok)", color: "var(--ds-tier-positive)" },
  testing: { bg: "var(--ds-tint-warn)", color: "var(--ds-semantic-warn)" },
  "to-try": { bg: "var(--ds-tint-critical)", color: "var(--ds-tier-urgent)" },
  unknown: { bg: "var(--ds-tint-info)", color: "var(--ds-tier-parked)" },
};

export function normalizeFillingStatus(s?: string): FillingStatus {
  if (s === "confirmed") return "confirmed";
  if (s === "testing") return "testing";
  if (s === "to try" || s === "to-try") return "to-try";
  return "unknown";
}

export function FillingCard({
  href,
  name,
  status,
  usedInProducts,
  allergens,
  archived,
}: {
  href: string;
  name: string;
  status: FillingStatus;
  usedInProducts?: string[];
  allergens?: string[];
  archived?: boolean;
}) {
  const accent = ACCENT[status];
  const pill = PILL[status];
  const usedIn =
    (usedInProducts?.length ?? 0) > 0
      ? `Used in: ${usedInProducts!.join(", ")}`
      : "Not yet used in products";

  return (
    <Link
      href={href}
      style={{
        display: "block",
        background: "var(--ds-card-bg)",
        border: "0.5px solid var(--ds-border-warm)",
        borderLeft: `3px solid ${accent}`,
        borderRadius: 8,
        padding: "14px 16px",
        textDecoration: "none",
        color: "var(--ds-text-primary)",
        opacity: archived ? 0.5 : 1,
      }}
      className="hover:[border-color:var(--ds-tier-quarter-focus)]"
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, justifyContent: "space-between" }}>
        <strong
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 15,
            fontWeight: 500,
            color: "var(--ds-text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {name}
        </strong>
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            padding: "2px 6px",
            borderRadius: 3,
            background: pill.bg,
            color: pill.color,
            whiteSpace: "nowrap",
          }}
        >
          {status === "to-try" ? "to try" : status}
        </span>
      </div>
      <p
        style={{
          marginTop: 6,
          fontSize: 11,
          color: "var(--ds-text-muted)",
          fontStyle: (usedInProducts?.length ?? 0) === 0 ? "italic" : "normal",
          overflow: "hidden",
          textOverflow: "ellipsis",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
        }}
      >
        {usedIn}
      </p>
      {(allergens?.length ?? 0) > 0 && (
        <div style={{ marginTop: 8 }}>
          <AllergenDots ids={allergens!} size={14} />
        </div>
      )}
    </Link>
  );
}
