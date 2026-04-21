/**
 * Capacity-config completeness + derived metrics.
 *
 * Pure helpers the scheduler + dashboard use to check whether the
 * Settings → Capacity & People form has been filled in, and to compute
 * the per-day active-minutes budget from per-person availability minus
 * workshop-wide blocked days.
 */

import type { CapacityConfig, Person, PersonUnavailability, EventCalendarEntry, Weekday } from "@/types";
import { WEEKDAYS } from "@/types";

export interface CapacityStatus {
  isComplete: boolean;
  /** User-facing labels of the fields still missing a value. */
  missing: string[];
}

/**
 * Check whether the singleton `capacityConfig` row AND the people list
 * have enough to run the scheduler. Returns per-field labels for the
 * Settings UI banner.
 *
 * Rules:
 *   - Buffer + threshold fields must all be within [0, 100].
 *   - At least one non-archived person must exist with both
 *     `defaultHoursPerDay > 0` and a non-empty `workingDays` list.
 */
export function capacityConfigStatus(
  config: CapacityConfig | null | undefined,
  people: Person[] = [],
): CapacityStatus {
  const missing: string[] = [];

  if (!isPercent(config?.capacityBufferPercent)) missing.push("Capacity buffer %");
  if (!isPercent(config?.fillingBufferPercent)) missing.push("Filling buffer %");
  if (!isPercent(config?.warnThresholdPercent)) missing.push("Warn threshold %");
  if (!isPercent(config?.criticalThresholdPercent)) missing.push("Critical threshold %");

  const activePeople = people.filter((p) => !p.archived);
  if (activePeople.length === 0) {
    missing.push("At least one person");
  } else {
    const anyConfigured = activePeople.some(
      (p) => personHoursPerDay(p) > 0 &&
        Array.isArray(p.workingDays) && p.workingDays.length > 0,
    );
    if (!anyConfigured) {
      missing.push("At least one person with hours and working days");
    }
  }

  return { isComplete: missing.length === 0, missing };
}

/**
 * Sum raw hours across every person scheduled to work on `date`,
 * before the capacity buffer. Respects:
 *   - person.workingDays
 *   - person.archived
 *   - per-person unavailability ranges (inclusive, by ISO date)
 *   - workshop-wide eventCalendar(kind='blocked') entries
 *
 * When a person has both `startTimeOfDay` and `endTimeOfDay` set, the
 * window duration (end−start) is used. Otherwise we fall back to
 * `defaultHoursPerDay`. This lets users configure precise 07:00–23:00
 * windows per employee without breaking legacy rows.
 */
export function availableHoursOnDate(
  date: Date,
  people: Person[],
  unavailability: PersonUnavailability[] = [],
  blockedDays: EventCalendarEntry[] = [],
): number {
  const iso = toIsoDate(date);
  if (isBlocked(iso, blockedDays)) return 0;

  const weekday = weekdayFromDate(date);
  let total = 0;

  for (const person of people) {
    if (person.archived) continue;
    if (!person.workingDays?.includes(weekday)) continue;
    if (isUnavailable(iso, person.id, unavailability)) continue;
    const hours = personHoursPerDay(person);
    if (hours <= 0) continue;
    total += hours;
  }

  return total;
}

/** Daily hours contributed by one person, respecting their configured
 *  time-of-day window when both start + end are set. Exported so the
 *  Settings UI can show the same number as the scheduler reads. */
export function personHoursPerDay(p: Person): number {
  const windowHours = timeWindowHours(p.startTimeOfDay, p.endTimeOfDay);
  if (windowHours != null) return windowHours;
  return typeof p.defaultHoursPerDay === "number" && p.defaultHoursPerDay > 0
    ? p.defaultHoursPerDay
    : 0;
}

/** Parse an "HH:MM" or "HH:MM:SS" time-of-day string to minutes since
 *  midnight. Returns null on bad input so callers can decide how to
 *  fall back. */
function timeOfDayToMinutes(s: string | undefined): number | null {
  if (!s) return null;
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (h < 0 || h > 24 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function timeWindowHours(start: string | undefined, end: string | undefined): number | null {
  const s = timeOfDayToMinutes(start);
  const e = timeOfDayToMinutes(end);
  if (s == null || e == null) return null;
  if (e <= s) return null;
  return (e - s) / 60;
}

/** Effective per-day active-minutes budget after applying the capacity buffer. */
export function effectiveDailyCapacityMinutes(
  date: Date,
  config: CapacityConfig | null | undefined,
  people: Person[],
  unavailability: PersonUnavailability[] = [],
  blockedDays: EventCalendarEntry[] = [],
): number {
  const rawHours = availableHoursOnDate(date, people, unavailability, blockedDays);
  if (rawHours === 0) return 0;
  const buffer = isPercent(config?.capacityBufferPercent) ? config!.capacityBufferPercent! : 0;
  const minutes = rawHours * 60 * (1 - buffer / 100);
  return Math.round(minutes);
}

// ─── Small date helpers ────────────────────────────────────────────────────

/** Convert a JavaScript day-of-week index (0=Sunday … 6=Saturday) to the
 *  lowercase Weekday string used on `Person.workingDays`. */
export function weekdayFromDate(d: Date): Weekday {
  const idx = d.getDay();
  const remap: Record<number, Weekday> = {
    0: "sunday", 1: "monday", 2: "tuesday", 3: "wednesday",
    4: "thursday", 5: "friday", 6: "saturday",
  };
  return remap[idx];
}

/** Canonical order for displaying weekdays in the UI. */
export function sortWeekdays(days: Weekday[]): Weekday[] {
  const index = new Map<Weekday, number>(WEEKDAYS.map((d, i) => [d, i]));
  return [...days].sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0));
}

/** Union of role strings across every person, sorted alphabetically. */
export function collectRoles(people: Person[]): string[] {
  const set = new Set<string>();
  for (const p of people) {
    for (const r of p.roles ?? []) {
      const trimmed = r.trim();
      if (trimmed) set.add(trimmed);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isBlocked(iso: string, blocked: EventCalendarEntry[]): boolean {
  return blocked.some(
    (e) => e.kind === "blocked" && iso >= e.startDate && iso <= e.endDate,
  );
}

function isUnavailable(iso: string, personId: string | undefined, entries: PersonUnavailability[]): boolean {
  if (!personId) return false;
  return entries.some(
    (u) => u.personId === personId && iso >= u.startDate && iso <= u.endDate,
  );
}

function isPercent(val: unknown): val is number {
  return typeof val === "number" && !isNaN(val) && val >= 0 && val <= 100;
}
