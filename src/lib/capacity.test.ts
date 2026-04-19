import { describe, it, expect } from "vitest";
import {
  capacityConfigStatus,
  effectiveDailyCapacityMinutes,
  isWorkingDay,
  weekdayFromDate,
  sortWeekdays,
} from "./capacity";
import type { CapacityConfig } from "@/types";

describe("capacityConfigStatus", () => {
  it("flags every field when config is null", () => {
    const status = capacityConfigStatus(null);
    expect(status.isComplete).toBe(false);
    expect(status.missing.length).toBeGreaterThan(0);
    expect(status.missing).toContain("People count");
    expect(status.missing).toContain("Working days");
  });

  it("flags individual missing fields", () => {
    const partial: CapacityConfig = {
      peopleCount: 2,
      hoursPerPersonPerDay: 6,
      workingDays: ["monday", "tuesday"],
      capacityBufferPercent: 10,
      // filling + thresholds missing
    };
    const status = capacityConfigStatus(partial);
    expect(status.isComplete).toBe(false);
    expect(status.missing).toEqual([
      "Filling buffer %",
      "Warn threshold %",
      "Critical threshold %",
    ]);
  });

  it("passes when every field is set within range", () => {
    const full: CapacityConfig = {
      peopleCount: 2,
      hoursPerPersonPerDay: 6,
      workingDays: ["monday", "tuesday", "wednesday"],
      capacityBufferPercent: 15,
      fillingBufferPercent: 10,
      warnThresholdPercent: 80,
      criticalThresholdPercent: 95,
    };
    expect(capacityConfigStatus(full).isComplete).toBe(true);
    expect(capacityConfigStatus(full).missing).toEqual([]);
  });

  it("rejects out-of-range percents and non-positive counts", () => {
    const bad: CapacityConfig = {
      peopleCount: 0,                   // not > 0
      hoursPerPersonPerDay: 25,         // > 24 — but typing-wise any > 0 number passes this helper;
                                        // the Supabase CHECK catches that. Helper only checks > 0.
      workingDays: [],                  // empty array treated as missing
      capacityBufferPercent: 150,       // out of range
      fillingBufferPercent: -5,         // negative
      warnThresholdPercent: 80,
      criticalThresholdPercent: 95,
    };
    const status = capacityConfigStatus(bad);
    expect(status.isComplete).toBe(false);
    expect(status.missing).toContain("People count");
    expect(status.missing).toContain("Working days");
    expect(status.missing).toContain("Capacity buffer %");
    expect(status.missing).toContain("Filling buffer %");
  });
});

describe("effectiveDailyCapacityMinutes", () => {
  it("returns 0 when required inputs are missing", () => {
    expect(effectiveDailyCapacityMinutes(null)).toBe(0);
    expect(effectiveDailyCapacityMinutes({})).toBe(0);
    expect(effectiveDailyCapacityMinutes({ peopleCount: 2 })).toBe(0);
  });

  it("applies the buffer to the raw people-hours budget", () => {
    // 2 people × 8h = 960 min. Buffer 20% → 768 min.
    expect(effectiveDailyCapacityMinutes({
      peopleCount: 2,
      hoursPerPersonPerDay: 8,
      capacityBufferPercent: 20,
    })).toBe(768);
  });

  it("treats a missing buffer as 0% (full capacity)", () => {
    // 1 × 6 = 360 min.
    expect(effectiveDailyCapacityMinutes({
      peopleCount: 1,
      hoursPerPersonPerDay: 6,
    })).toBe(360);
  });

  it("clamps absurd buffer values to the 0–100 range", () => {
    expect(effectiveDailyCapacityMinutes({
      peopleCount: 1,
      hoursPerPersonPerDay: 10,
      capacityBufferPercent: 200,
    })).toBe(0);
  });
});

describe("weekdayFromDate + isWorkingDay", () => {
  it("maps JavaScript days to the lowercase Weekday string", () => {
    expect(weekdayFromDate(new Date("2026-04-20T12:00:00"))).toBe("monday");
    expect(weekdayFromDate(new Date("2026-04-19T12:00:00"))).toBe("sunday");
  });

  it("isWorkingDay honours the configured working-days set", () => {
    const config: CapacityConfig = {
      workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    };
    expect(isWorkingDay(config, new Date("2026-04-20T12:00:00"))).toBe(true);  // mon
    expect(isWorkingDay(config, new Date("2026-04-18T12:00:00"))).toBe(false); // sat
  });

  it("returns false when workingDays is empty or missing", () => {
    expect(isWorkingDay({ workingDays: [] }, new Date("2026-04-20T12:00:00"))).toBe(false);
    expect(isWorkingDay(null, new Date("2026-04-20T12:00:00"))).toBe(false);
  });
});

describe("sortWeekdays", () => {
  it("sorts to Monday-first canonical order", () => {
    expect(sortWeekdays(["friday", "monday", "wednesday"])).toEqual(["monday", "wednesday", "friday"]);
    expect(sortWeekdays(["sunday", "saturday"])).toEqual(["saturday", "sunday"]);
  });
});
