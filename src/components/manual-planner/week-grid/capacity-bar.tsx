"use client";

import { formatMinutes } from "@/lib/manual-planner/compute-batch-time";

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
  const color =
    pct >= criticalPercent
      ? "var(--mp-rose)"
      : pct >= warnPercent
      ? "var(--mp-caramel)"
      : "var(--mp-mint)";
  return (
    <div>
      <p
        className="text-[10.5px] tabular-nums"
        style={{ color: "var(--mp-text-muted)" }}
      >
        {formatMinutes(usedMinutes)} / {formatMinutes(capacityMinutes)}
      </p>
      <div
        aria-hidden
        className="mt-1"
        style={{
          height: 3,
          background: "var(--mp-border-warm)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div style={{ width: `${pct}%`, height: "100%", background: color }} />
      </div>
    </div>
  );
}
