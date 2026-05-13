"use client";

import Link from "next/link";
import * as TablerIcons from "@tabler/icons-react";

export interface HubCardProps {
  href: string;
  /** Tabler icon name without the `Icon` prefix, e.g. "LayoutBoardSplit". */
  icon: string;
  title: string;
  description: string;
  /** Optional stat line at the bottom, e.g. "3 pending proposals". */
  stat?: string;
  /** Optional dot badge top-right. */
  badge?: "urgent" | "warn" | "ok";
}

// Tabler icons are typed as ForwardRefExoticComponent; for our dynamic-resolve
// case we treat them as a permissive function component to keep TSX happy.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IconComp = (props: any) => any;

function resolveIcon(name: string): IconComp {
  const normalised =
    name
      .split(/[-_]/g)
      .filter(Boolean)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join("") || "Help";
  const candidates = [`Icon${normalised}`, `Icon${normalised.replace(/s$/, "")}`, "IconHelp"];
  for (const k of candidates) {
    const comp = (TablerIcons as unknown as Record<string, IconComp | undefined>)[k];
    if (comp) return comp;
  }
  return (TablerIcons as unknown as Record<string, IconComp>).IconHelp;
}

const BADGE_COLOR: Record<NonNullable<HubCardProps["badge"]>, string> = {
  urgent: "var(--ds-tier-urgent)",
  warn: "var(--ds-semantic-warn)",
  ok: "var(--ds-tier-positive)",
};

/**
 * Hub-landing card. Used by /production-brain hub, /settings landing,
 * and any future hub page.
 */
export function HubCard({
  href,
  icon,
  title,
  description,
  stat,
  badge,
}: HubCardProps) {
  const Icon = resolveIcon(icon);
  return (
    <Link
      href={href}
      style={{
        display: "block",
        position: "relative",
        background: "var(--ds-card-bg)",
        border: "0.5px solid var(--ds-border-warm)",
        borderRadius: 8,
        padding: "16px 18px",
        textDecoration: "none",
        color: "var(--ds-text-primary)",
        transition: "border-color 0.15s",
        minHeight: 120,
      }}
      className="hover:[border-color:var(--ds-tier-quarter-focus)]"
    >
      {badge && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: BADGE_COLOR[badge],
          }}
        />
      )}
      <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 6 }}>
        <Icon size={18} stroke={1.5} style={{ color: "var(--ds-text-muted)" }} />
        <h3
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 16,
            fontWeight: 500,
            color: "var(--ds-text-primary)",
            letterSpacing: "-0.005em",
            margin: 0,
          }}
        >
          {title}
        </h3>
        <p
          style={{
            fontSize: 12,
            color: "var(--ds-text-muted)",
            fontStyle: "italic",
            margin: 0,
            lineHeight: 1.4,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {description}
        </p>
        {stat && (
          <p
            style={{
              marginTop: "auto",
              fontSize: 11,
              color: "var(--ds-text-muted)",
              fontVariantNumeric: "tabular-nums",
              fontWeight: 500,
            }}
          >
            {stat}
          </p>
        )}
      </div>
    </Link>
  );
}
