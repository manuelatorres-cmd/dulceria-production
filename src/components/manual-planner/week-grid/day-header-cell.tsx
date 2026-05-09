"use client";

import { CapacityBar } from "./capacity-bar";

export function DayHeaderCell({
  dayLabel,
  dateLabel,
  isToday,
  isClosed,
  usedMinutes,
  capacityMinutes,
  warnPercent,
  criticalPercent,
}: {
  dayLabel: string;
  dateLabel: string;
  isToday: boolean;
  isClosed: boolean;
  usedMinutes: number;
  capacityMinutes: number;
  warnPercent: number;
  criticalPercent: number;
}) {
  return (
    <div className="px-2 pt-2 pb-2.5">
      <div
        className="text-[10.5px] uppercase"
        style={{
          color: "var(--mp-text-muted)",
          letterSpacing: "0.05em",
          fontWeight: 600,
        }}
      >
        {dayLabel}
      </div>
      <div
        className="text-[14px] tabular-nums"
        style={{
          fontWeight: 500,
          color: isToday ? "var(--mp-rose)" : "var(--mp-text-primary)",
          marginBottom: 4,
        }}
      >
        {dateLabel}
      </div>
      {isClosed ? (
        <p className="text-[10.5px] italic" style={{ color: "var(--mp-text-muted)" }}>
          closed
        </p>
      ) : (
        <CapacityBar
          usedMinutes={usedMinutes}
          capacityMinutes={capacityMinutes}
          warnPercent={warnPercent}
          criticalPercent={criticalPercent}
        />
      )}
    </div>
  );
}
