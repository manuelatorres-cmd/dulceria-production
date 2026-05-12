"use client";

export type MiniDayVariant = "ok" | "warn" | "over";

const FILL: Record<MiniDayVariant, string> = {
  ok: "var(--ds-tier-positive)",
  warn: "var(--ds-semantic-warn)",
  over: "var(--ds-tier-urgent)",
};

/**
 * Dashboard "next 7 days" cell. Day label + date + capacity bar +
 * batch count. Today gets the cream tint + deep-teal border.
 */
export function MiniDay({
  label,
  num,
  isToday,
  capacityPct,
  capacityVariant,
  batchCount,
  onClick,
}: {
  /** Short day-of-week label, e.g. "Mo". */
  label: string;
  /** Date number, e.g. 12. */
  num: number;
  isToday: boolean;
  capacityPct: number;
  capacityVariant: MiniDayVariant;
  batchCount: number;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        textAlign: "center",
        padding: "8px 4px",
        borderRadius: 4,
        border: `0.5px solid ${
          isToday ? "var(--ds-tier-quarter-focus)" : "var(--ds-border-warm)"
        }`,
        background: isToday ? "var(--ds-today-tint)" : "var(--ds-card-bg)",
        cursor: onClick ? "pointer" : "default",
        transition: "background 0.1s",
      }}
      className={onClick ? "hover:bg-[color:var(--ds-card-bg-hover)]" : undefined}
    >
      <div
        style={{
          fontSize: 10,
          color: "var(--ds-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 500,
          marginTop: 2,
          fontVariantNumeric: "tabular-nums",
          color: isToday ? "var(--ds-tier-quarter-focus)" : "var(--ds-text-primary)",
        }}
      >
        {num}
      </div>
      <div
        aria-hidden
        style={{
          height: 2,
          background: "var(--ds-border-warm)",
          marginTop: 6,
          borderRadius: 1,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.min(100, Math.max(0, capacityPct))}%`,
            height: "100%",
            background: FILL[capacityVariant],
          }}
        />
      </div>
      <div
        style={{
          fontSize: 10,
          color: "var(--ds-text-muted)",
          fontStyle: "italic",
          marginTop: 4,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {batchCount} batch{batchCount === 1 ? "" : "es"}
      </div>
    </div>
  );
}
