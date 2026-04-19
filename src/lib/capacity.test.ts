import { describe, it, expect } from "vitest";
import {
  capacityConfigStatus,
  availableHoursOnDate,
  effectiveDailyCapacityMinutes,
  weekdayFromDate,
  sortWeekdays,
  collectRoles,
} from "./capacity";
import type { CapacityConfig, Person, PersonUnavailability, EventCalendarEntry } from "@/types";

const fullConfig: CapacityConfig = {
  capacityBufferPercent: 15,
  fillingBufferPercent: 10,
  warnThresholdPercent: 80,
  criticalThresholdPercent: 95,
};

const alice: Person = {
  id: "p-alice",
  name: "Alice",
  roles: ["chocolatier", "owner"],
  defaultHoursPerDay: 6,
  workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
};

const bob: Person = {
  id: "p-bob",
  name: "Bob",
  roles: ["chocolatier"],
  defaultHoursPerDay: 4,
  workingDays: ["tuesday", "thursday"],
};

describe("capacityConfigStatus", () => {
  it("flags percent fields + people when nothing is filled", () => {
    const status = capacityConfigStatus(null, []);
    expect(status.isComplete).toBe(false);
    expect(status.missing).toContain("Capacity buffer %");
    expect(status.missing).toContain("Filling buffer %");
    expect(status.missing).toContain("Warn threshold %");
    expect(status.missing).toContain("Critical threshold %");
    expect(status.missing).toContain("At least one person");
  });

  it("flags the empty-people case when config is complete but no people exist", () => {
    const status = capacityConfigStatus(fullConfig, []);
    expect(status.isComplete).toBe(false);
    expect(status.missing).toEqual(["At least one person"]);
  });

  it("flags unconfigured people (no hours or no working days)", () => {
    const status = capacityConfigStatus(fullConfig, [
      { name: "Partial", defaultHoursPerDay: 0, workingDays: ["monday"] },
      { name: "Partial", defaultHoursPerDay: 5, workingDays: [] },
    ]);
    expect(status.isComplete).toBe(false);
    expect(status.missing).toEqual(["At least one person with hours and working days"]);
  });

  it("skips archived people for completeness", () => {
    const status = capacityConfigStatus(fullConfig, [
      { ...alice, archived: true },
    ]);
    expect(status.isComplete).toBe(false);
    expect(status.missing).toContain("At least one person");
  });

  it("passes when config is complete and at least one person has hours + days", () => {
    const status = capacityConfigStatus(fullConfig, [alice]);
    expect(status.isComplete).toBe(true);
    expect(status.missing).toEqual([]);
  });

  it("rejects out-of-range percent values", () => {
    const bad: CapacityConfig = {
      capacityBufferPercent: 150,
      fillingBufferPercent: -5,
      warnThresholdPercent: 80,
      criticalThresholdPercent: 95,
    };
    const status = capacityConfigStatus(bad, [alice]);
    expect(status.missing).toContain("Capacity buffer %");
    expect(status.missing).toContain("Filling buffer %");
  });
});

describe("availableHoursOnDate", () => {
  it("sums hours across people working on that weekday", () => {
    // 2026-04-21 is a Tuesday — both Alice (6h) and Bob (4h) work it.
    const date = new Date("2026-04-21T12:00:00");
    expect(availableHoursOnDate(date, [alice, bob])).toBe(10);
  });

  it("only counts people whose workingDays include the day", () => {
    // 2026-04-20 is a Monday — only Alice (6h) works it.
    const date = new Date("2026-04-20T12:00:00");
    expect(availableHoursOnDate(date, [alice, bob])).toBe(6);
  });

  it("excludes archived people", () => {
    const date = new Date("2026-04-21T12:00:00");
    expect(availableHoursOnDate(date, [{ ...alice, archived: true }, bob])).toBe(4);
  });

  it("excludes a person on an unavailability range", () => {
    const date = new Date("2026-04-21T12:00:00");
    const unavail: PersonUnavailability[] = [
      { personId: "p-alice", startDate: "2026-04-20", endDate: "2026-04-25" },
    ];
    expect(availableHoursOnDate(date, [alice, bob], unavail)).toBe(4);
  });

  it("returns 0 on a workshop-wide blocked day regardless of people", () => {
    const date = new Date("2026-04-21T12:00:00");
    const blocked: EventCalendarEntry[] = [
      { name: "Equipment service", kind: "blocked", startDate: "2026-04-21", endDate: "2026-04-21" },
    ];
    expect(availableHoursOnDate(date, [alice, bob], [], blocked)).toBe(0);
  });

  it("ignores people with zero or missing hours", () => {
    const date = new Date("2026-04-21T12:00:00");
    const untrained: Person = { id: "p-x", name: "Trainee", workingDays: ["tuesday"] };
    expect(availableHoursOnDate(date, [untrained])).toBe(0);
  });
});

describe("effectiveDailyCapacityMinutes", () => {
  it("applies the capacity buffer to the summed hours × 60", () => {
    // Tuesday: Alice + Bob = 10h → 600 min. Buffer 15% → 510 min.
    const date = new Date("2026-04-21T12:00:00");
    expect(effectiveDailyCapacityMinutes(date, fullConfig, [alice, bob])).toBe(510);
  });

  it("returns 0 when no-one is available (blocked day)", () => {
    const date = new Date("2026-04-21T12:00:00");
    const blocked: EventCalendarEntry[] = [
      { name: "Holiday", kind: "blocked", startDate: "2026-04-21", endDate: "2026-04-21" },
    ];
    expect(effectiveDailyCapacityMinutes(date, fullConfig, [alice, bob], [], blocked)).toBe(0);
  });

  it("treats a missing buffer as 0% (full capacity)", () => {
    // Alice alone on Monday: 6h → 360 min.
    const date = new Date("2026-04-20T12:00:00");
    expect(effectiveDailyCapacityMinutes(date, {} as CapacityConfig, [alice])).toBe(360);
  });
});

describe("weekdayFromDate + sortWeekdays", () => {
  it("maps JavaScript days to lowercase Weekday strings", () => {
    expect(weekdayFromDate(new Date("2026-04-20T12:00:00"))).toBe("monday");
    expect(weekdayFromDate(new Date("2026-04-19T12:00:00"))).toBe("sunday");
  });
  it("sorts to canonical Monday-first order", () => {
    expect(sortWeekdays(["friday", "monday", "wednesday"])).toEqual(["monday", "wednesday", "friday"]);
  });
});

describe("collectRoles", () => {
  it("returns the sorted, deduplicated union of roles across all people", () => {
    expect(collectRoles([alice, bob])).toEqual(["chocolatier", "owner"]);
  });
  it("trims whitespace and drops empties", () => {
    const dirty: Person[] = [
      { name: "X", roles: ["  baker  ", ""] },
      { name: "Y", roles: ["baker", "assistant "] },
    ];
    expect(collectRoles(dirty)).toEqual(["assistant", "baker"]);
  });
  it("tolerates missing roles field", () => {
    expect(collectRoles([{ name: "No roles" }])).toEqual([]);
  });
});

