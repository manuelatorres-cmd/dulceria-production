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
      (p) =>
        typeof p.defaultHoursPerDay === "number" && p.defaultHoursPerDay > 0 &&
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
    if (typeof person.defaultHoursPerDay !== "number" || person.defaultHoursPerDay <= 0) continue;
    if (isUnavailable(iso, person.id, unavailability)) continue;
    total += person.defaultHoursPerDay;
  }

  return total;
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
