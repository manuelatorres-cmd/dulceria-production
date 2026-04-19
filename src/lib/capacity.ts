/**
 * Capacity-config completeness + derived metrics.
 *
 * Pure helpers the scheduler + dashboard use to check whether the
 * Settings → Capacity & People form has been filled in, and to convert
 * the user-entered people × hours × working-days into a per-day
 * active-minutes budget (after applying the capacity buffer).
 */

import type { CapacityConfig, Weekday } from "@/types";
import { WEEKDAYS } from "@/types";

export interface CapacityStatus {
  isComplete: boolean;
  /** User-facing labels of the fields still missing a value. */
  missing: string[];
}

/**
 * Check whether `capacityConfig` has every field the scheduler needs.
 * Validates >0 where sensible; percent fields must be within [0, 100].
 */
export function capacityConfigStatus(config: CapacityConfig | null | undefined): CapacityStatus {
  const missing: string[] = [];

  if (!config) {
    return {
      isComplete: false,
      missing: [
        "People count",
        "Hours per person per day",
        "Working days",
        "Capacity buffer %",
        "Filling buffer %",
        "Warn threshold %",
        "Critical threshold %",
      ],
    };
  }

  if (!(typeof config.peopleCount === "number" && config.peopleCount > 0)) {
    missing.push("People count");
  }
  if (!(typeof config.hoursPerPersonPerDay === "number" && config.hoursPerPersonPerDay > 0)) {
    missing.push("Hours per person per day");
  }
  if (!config.workingDays || config.workingDays.length === 0) {
    missing.push("Working days");
  }
  if (!isPercent(config.capacityBufferPercent)) missing.push("Capacity buffer %");
  if (!isPercent(config.fillingBufferPercent)) missing.push("Filling buffer %");
  if (!isPercent(config.warnThresholdPercent)) missing.push("Warn threshold %");
  if (!isPercent(config.criticalThresholdPercent)) missing.push("Critical threshold %");

  return { isComplete: missing.length === 0, missing };
}

/** Effective per-working-day active-minutes budget after applying the
 *  capacity buffer. Returns 0 when any input is missing. */
export function effectiveDailyCapacityMinutes(config: CapacityConfig | null | undefined): number {
  if (!config) return 0;
  const { peopleCount, hoursPerPersonPerDay, capacityBufferPercent } = config;
  if (!(typeof peopleCount === "number" && peopleCount > 0)) return 0;
  if (!(typeof hoursPerPersonPerDay === "number" && hoursPerPersonPerDay > 0)) return 0;
  const buffer = typeof capacityBufferPercent === "number" ? Math.max(0, Math.min(100, capacityBufferPercent)) : 0;
  const rawMinutes = peopleCount * hoursPerPersonPerDay * 60;
  return Math.round(rawMinutes * (1 - buffer / 100));
}

/** Convert a JavaScript day-of-week index (0=Sunday … 6=Saturday) to the
 *  lowercase Weekday string used in `capacityConfig.workingDays`. */
export function weekdayFromDate(d: Date): Weekday {
  // Date.getDay: 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  // WEEKDAYS order: monday..sunday → reindex.
  const idx = d.getDay();
  const remap: Record<number, Weekday> = {
    0: "sunday", 1: "monday", 2: "tuesday", 3: "wednesday",
    4: "thursday", 5: "friday", 6: "saturday",
  };
  return remap[idx];
}

/** Does the config treat a given date as a working day? */
export function isWorkingDay(config: CapacityConfig | null | undefined, d: Date): boolean {
  if (!config?.workingDays || config.workingDays.length === 0) return false;
  const set = new Set<Weekday>(config.workingDays);
  return set.has(weekdayFromDate(d));
}

/** Canonical order for displaying weekdays in the UI. */
export function sortWeekdays(days: Weekday[]): Weekday[] {
  const index = new Map<Weekday, number>(WEEKDAYS.map((d, i) => [d, i]));
  return [...days].sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0));
}

function isPercent(val: unknown): val is number {
  return typeof val === "number" && !isNaN(val) && val >= 0 && val <= 100;
}
