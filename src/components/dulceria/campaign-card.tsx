"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export type CampaignCardVariant = "urgent" | "warn" | "active" | "planned" | "done";
export type CampaignTypeTag = "seasonal" | "launch" | "market_event" | "collaboration" | "limited";

const ACCENT: Record<CampaignCardVariant, string> = {
  urgent: "var(--ds-tier-urgent)",
  warn: "var(--ds-semantic-warn)",
  active: "var(--ds-tier-quarter-focus)",
  planned: "var(--ds-tier-parked)",
  done: "var(--ds-tier-positive)",
};

const TYPE_TINT: Record<CampaignTypeTag, { bg: string; color: string }> = {
  seasonal: { bg: "var(--ds-tint-critical)", color: "var(--ds-tier-urgent)" },
  launch: { bg: "var(--ds-tint-info)", color: "var(--ds-tier-quarter-focus)" },
  market_event: { bg: "var(--ds-tint-warn)", color: "var(--ds-semantic-warn)" },
  collaboration: { bg: "var(--ds-tint-info)", color: "var(--ds-tier-quarter-focus)" },
  limited: { bg: "var(--ds-tint-warn)", color: "var(--ds-semantic-warn)" },
};

export interface CampaignCardProps {
  href: string;
  name: string;
  typeTag: CampaignTypeTag;
  variant: CampaignCardVariant;
  dateLabel: string;
  daysToLaunchLabel: string;
  stats: Array<{ label: string; value: number | string }>;
  progressPct: number;
  /** Status line under the progress bar, e.g. "production starts in 7 days". */
  statusText: string;
}

/**
 * Campaign card for /campaigns list.
 * White body, 3px tier left border, italic muted dates + meta, progress
 * bar, footer with status text + %. No pastel fills.
 */
export function CampaignCard({
  href,
  name,
  typeTag,
  variant,
  dateLabel,
  daysToLaunchLabel,
  stats,
  progressPct,
  statusText,
}: CampaignCardProps) {
  const accent = ACCENT[variant];
  const dimmed = variant === "done";
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
        color: "var(--ds-text-primary)",
        textDecoration: "none",
        transition: "border-color 0.15s",
        opacity: dimmed ? 0.6 : 1,
      }}
      className="hover:[border-color:var(--ds-tier-quarter-focus)]"
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <strong
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 16,
            fontWeight: 600,
            color: "var(--ds-text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {name}
        </strong>
        <CampaignTypeTagPill tag={typeTag} />
      </div>

      <p
        style={{
          fontSize: 12,
          color: "var(--ds-text-muted)",
          fontStyle: "italic",
          marginTop: 4,
        }}
      >
        <strong style={{ fontStyle: "normal", color: "var(--ds-text-primary)", fontWeight: 500 }}>
          {dateLabel}
        </strong>
        {daysToLaunchLabel && <> · {daysToLaunchLabel}</>}
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${Math.max(1, stats.length)}, minmax(0, 1fr))`,
          gap: 8,
          marginTop: 10,
        }}
      >
        {stats.map((s, i) => (
          <CampaignStat key={i} label={s.label} value={s.value} />
        ))}
      </div>

      <div
        aria-hidden
        style={{
          marginTop: 12,
          height: 3,
          background: "var(--ds-border-warm)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.min(100, Math.max(0, progressPct))}%`,
            height: "100%",
            background: accent,
          }}
        />
      </div>

      <div
        style={{
          marginTop: 8,
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 11, color: accent, fontWeight: 500 }}>{statusText}</span>
        <span
          style={{
            fontSize: 11,
            color: "var(--ds-text-muted)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {progressPct}%
        </span>
      </div>
    </Link>
  );
}

function CampaignTypeTagPill({ tag }: { tag: CampaignTypeTag }) {
  const style = TYPE_TINT[tag];
  return (
    <span
      style={{
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        fontWeight: 600,
        padding: "2px 6px",
        borderRadius: 3,
        background: style.bg,
        color: style.color,
        whiteSpace: "nowrap",
      }}
    >
      {tag.replace("_", " ")}
    </span>
  );
}

function CampaignStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p
        style={{
          fontSize: 9,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--ds-text-muted)",
          fontWeight: 600,
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 16,
          fontWeight: 600,
          marginTop: 2,
          fontVariantNumeric: "tabular-nums",
          color: "var(--ds-text-primary)",
        }}
      >
        {value}
      </p>
    </div>
  );
}

export function AddCampaignCard({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        background: "transparent",
        border: "1px dashed var(--ds-border-warm)",
        borderRadius: 8,
        padding: "18px 16px",
        color: "var(--ds-text-muted)",
        textAlign: "center",
        fontSize: 13,
        fontStyle: "italic",
        cursor: disabled ? "wait" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
      className="hover:bg-[color:var(--ds-card-bg-hover)]"
    >
      + {label}
    </button>
  );
}

export type _campaignCardModule = never;
