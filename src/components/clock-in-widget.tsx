"use client";

/**
 * Compact clock-in widget for the production-brain daily view.
 *
 * Shows today's active shifts + idle staff with one-tap Start / Stop.
 * Optional `linkedPlanId` prop lets the Daily view attach the
 * currently-selected batch to shifts that start while it's open,
 * so labor cost per batch follows automatically.
 */

import { useMemo } from "react";
import {
  useStaffShifts,
  usePeople,
  saveStaffShift,
  clockOutShift,
} from "@/lib/hooks";
import { newId } from "@/lib/supabase";
import type { StaffShift } from "@/types";

interface Props {
  /** ISO 'YYYY-MM-DD' — defaults to today. Lets tests + historical
   *  daily views show other days. */
  date?: string;
  /** If set, newly-started shifts track this plan ID in linkedPlanIds. */
  linkedPlanId?: string;
  /** Optional default location for new shifts. */
  defaultLocation?: StaffShift["location"];
}

export function ClockInWidget({ date, linkedPlanId, defaultLocation = "production" }: Props) {
  const today = date ?? new Date().toISOString().slice(0, 10);
  const people = usePeople();
  const shifts = useStaffShifts(undefined, today, today);

  const shiftsByPerson = useMemo(() => {
    const m = new Map<string, StaffShift>();
    for (const s of shifts) {
      const prev = m.get(s.personId);
      if (
        !prev ||
        new Date(s.clockInAt).getTime() > new Date(prev.clockInAt).getTime()
      ) {
        m.set(s.personId, s);
      }
    }
    return m;
  }, [shifts]);

  const activePeople = people.filter((p) => !p.archived);

  async function startShift(personId: string) {
    await saveStaffShift({
      id: newId(),
      personId,
      shiftDate: today,
      clockInAt: new Date(),
      breakMinutes: 0,
      location: defaultLocation,
      linkedPlanIds: linkedPlanId ? [linkedPlanId] : [],
    });
  }

  async function stopShift(shiftId: string) {
    await clockOutShift(shiftId);
  }

  const clockedInCount = Array.from(shiftsByPerson.values()).filter(
    (s) => !s.clockOutAt,
  ).length;

  return (
    <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-4 py-3">
      <div className="flex items-baseline justify-between mb-2">
        <span className="uppercase tracking-wider text-[10px] text-muted-foreground font-semibold">
          On shift
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {clockedInCount} / {activePeople.length}
        </span>
      </div>
      <ul className="space-y-1.5">
        {activePeople.map((person) => {
          const shift = shiftsByPerson.get(person.id ?? "");
          const active = shift && !shift.clockOutAt;
          return (
            <li key={person.id} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={
                    "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold " +
                    (active
                      ? "bg-accent text-accent-foreground"
                      : "bg-muted text-muted-foreground")
                  }
                >
                  {person.name.slice(0, 1)}
                </span>
                <span className="text-sm truncate">{person.name}</span>
                {active && shift ? (
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    · in {formatSince(shift.clockInAt)}
                  </span>
                ) : null}
              </div>
              {active && shift ? (
                <button
                  type="button"
                  onClick={() => shift.id && stopShift(shift.id)}
                  className="text-xs px-2.5 py-0.5 rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] hover:bg-muted"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => person.id && startShift(person.id)}
                  className="text-xs px-2.5 py-0.5 rounded-[4px] border border-[color:var(--ds-border-warm)] bg-accent/20 hover:bg-accent/40"
                >
                  Start
                </button>
              )}
            </li>
          );
        })}
        {activePeople.length === 0 ? (
          <li className="text-xs text-muted-foreground italic">
            No people configured. Add people in /settings.
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function formatSince(d: Date | string): string {
  const ms = Date.now() - new Date(d).getTime();
  const h = Math.floor(ms / (60 * 60 * 1000));
  const m = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m}m`;
}
