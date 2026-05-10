"use client";

import { formatMinutes } from "./format-minutes";

export function CapacityBar({
  usedMinutes,
  capacityMinutes,
  warnPercent,
  criticalPercent,
}: {
  usedMinutes: number;
  capacityMinutes: number;
  warnPercent: number;
  criticalPercent: number;
}) {
  const pct = capacityMinutes > 0 ? Math.min(100, (usedMinutes / capacityMinutes) * 100) : 0;
  const overflow =
    capacityMinutes > 0 && usedMinutes > capacityMinutes
      ? Math.round((usedMinutes / capacityMinutes) * 100)
      : null;
  const color =
    overflow != null || pct >= criticalPercent
      ? "var(--wp-rose)"
      : pct >= warnPercent
      ? "var(--wp-caramel)"
      : "var(--wp-mint)";

  return (
    <div>
      <div
        className="flex items-baseline justify-between text-[10.5px] tabular-nums"
        style={{ color: "var(--wp-text-muted)" }}
      >
        <span>
          {formatMinutes(usedMinutes)} / {formatMinutes(capacityMinutes)}
        </span>
        <span style={{ color: overflow != null ? "var(--wp-rose)" : "var(--wp-text-muted)" }}>
          {capacityMinutes > 0 ? `${overflow ?? Math.round(pct)}%` : "—"}
        </span>
      </div>
      <div
        aria-hidden
        className="mt-1"
        style={{
          height: 3,
          background: "var(--wp-border-warm)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div style={{ width: `${pct}%`, height: "100%", background: color }} />
      </div>
    </div>
  );
}
