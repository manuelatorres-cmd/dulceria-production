"use client";

import { useMemo } from "react";
import type { DayLineItemView } from "./day-column";
import { DayColumn } from "./day-column";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function isoForOffset(start: Date, offset: number): string {
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function startOfWeekMonday(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = out.getUTCDay();
  const offset = (dow + 6) % 7;
  out.setUTCDate(out.getUTCDate() - offset);
  return out;
}

export interface WeekGridDay {
  iso: string;
  isClosed: boolean;
  usedMinutes: number;
  capacityMinutes: number;
}

export function WeekGrid({
  anchor,
  capacityByDate,
  itemsByDate,
  warnPercent,
  criticalPercent,
  draftPinnedDate,
  draftPreview,
}: {
  anchor: Date;
  /** Per-date capacity info. capacity === 0 means "closed" (no staff scheduled). */
  capacityByDate: Map<string, { used: number; capacity: number }>;
  itemsByDate: Map<string, DayLineItemView[]>;
  warnPercent: number;
  criticalPercent: number;
  draftPinnedDate: string | null;
  draftPreview: { name: string; pieces: number; mouldCount: number } | null;
}) {
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const days = useMemo(() => {
    const start = startOfWeekMonday(anchor);
    const out: Array<{
      iso: string;
      dayLabel: string;
      dateLabel: string;
      isToday: boolean;
    }> = [];
    for (let i = 0; i < 7; i++) {
      const iso = isoForOffset(start, i);
      const d = new Date(iso + "T00:00:00");
      out.push({
        iso,
        dayLabel: DAY_LABELS[i],
        dateLabel: d.toLocaleDateString("de-AT", { day: "numeric", month: "short" }),
        isToday: iso === todayIso,
      });
    }
    return out;
  }, [anchor, todayIso]);

  return (
    <div
      className="grid gap-1.5"
      style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
    >
      {days.map((d) => {
        const cap = capacityByDate.get(d.iso) ?? { used: 0, capacity: 0 };
        const items = itemsByDate.get(d.iso) ?? [];
        const isClosed = cap.capacity === 0;
        return (
          <DayColumn
            key={d.iso}
            iso={d.iso}
            dayLabel={d.dayLabel}
            dateLabel={d.dateLabel}
            isToday={d.isToday}
            isClosed={isClosed}
            usedMinutes={cap.used}
            capacityMinutes={cap.capacity}
            warnPercent={warnPercent}
            criticalPercent={criticalPercent}
            items={items}
            draftPreview={draftPinnedDate === d.iso ? draftPreview : null}
          />
        );
      })}
    </div>
  );
}
