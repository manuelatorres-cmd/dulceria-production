"use client";

import { CapacityBar } from "./capacity-bar";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function DayHeader({
  iso,
  isToday,
  isClosed,
  usedMinutes,
  capacityMinutes,
  warnPercent,
  criticalPercent,
}: {
  iso: string;
  isToday: boolean;
  isClosed: boolean;
  usedMinutes: number;
  capacityMinutes: number;
  warnPercent: number;
  criticalPercent: number;
}) {
  const date = new Date(iso + "T00:00:00");
  const dayLabel = DAY_LABELS[date.getDay()];
  const dateLabel = date.toLocaleDateString("de-AT", { day: "numeric", month: "short" });

  return (
    <div
      className="px-3 py-2.5"
      style={{
        background: isToday
          ? "var(--wp-today-tint)"
          : isClosed
          ? "var(--wp-closed-bg)"
          : "transparent",
        minHeight: 88,
      }}
    >
      <div
        className="text-[11px] uppercase"
        style={{
          color: "var(--wp-text-muted)",
          letterSpacing: "0.06em",
          fontWeight: 600,
        }}
      >
        {dayLabel}
        {isToday && (
          <span
            className="ml-1 normal-case"
            style={{ color: "var(--wp-rose)", fontWeight: 500, letterSpacing: 0 }}
          >
            · today
          </span>
        )}
      </div>
      <div
        className="text-[16px] tabular-nums mt-0.5"
        style={{
          fontWeight: 500,
          color: isToday ? "var(--wp-rose)" : "var(--wp-text-primary)",
        }}
      >
        {dateLabel}
      </div>
      {!isClosed ? (
        <div className="mt-2">
          <CapacityBar
            usedMinutes={usedMinutes}
            capacityMinutes={capacityMinutes}
            warnPercent={warnPercent}
            criticalPercent={criticalPercent}
          />
        </div>
      ) : (
        <p
          className="text-[10.5px] italic mt-2"
          style={{ color: "var(--wp-text-muted)", opacity: 0.7 }}
        >
          closed
        </p>
      )}
    </div>
  );
}
