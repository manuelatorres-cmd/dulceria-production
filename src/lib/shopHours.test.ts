import { describe, it, expect } from "vitest";
import {
  dateToIso,
  isClosedDate,
  isOpenOnDate,
  nextShopOpeningDay,
  daysBetween,
  computeLiveShopStatus,
  suggestLeadTimeDays,
} from "./shopHours";
import type { ShopOpeningHours, ShopClosure } from "@/types";

// Weekly schedule: open Tue/Wed/Thu/Fri/Sat 10–18, closed Sun/Mon.
const weekly: ShopOpeningHours[] = [
  { dayOfWeek: 0, isOpen: false },
  { dayOfWeek: 1, isOpen: false },
  { dayOfWeek: 2, isOpen: true, openAt: "10:00", closeAt: "18:00" },
  { dayOfWeek: 3, isOpen: true, openAt: "10:00", closeAt: "18:00" },
  { dayOfWeek: 4, isOpen: true, openAt: "10:00", closeAt: "18:00" },
  { dayOfWeek: 5, isOpen: true, openAt: "10:00", closeAt: "18:00" },
  { dayOfWeek: 6, isOpen: true, openAt: "10:00", closeAt: "16:00" },
];

describe("dateToIso", () => {
  it("formats in local time as YYYY-MM-DD", () => {
    expect(dateToIso(new Date(2026, 3, 20))).toBe("2026-04-20");
    expect(dateToIso(new Date(2026, 0, 1))).toBe("2026-01-01");
  });
});

describe("isClosedDate", () => {
  const closures: ShopClosure[] = [
    { startDate: "2026-04-10", endDate: "2026-04-12", reason: "Easter" },
  ];
  it("matches inclusively", () => {
    expect(isClosedDate("2026-04-09", closures)).toBe(false);
    expect(isClosedDate("2026-04-10", closures)).toBe(true);
    expect(isClosedDate("2026-04-11", closures)).toBe(true);
    expect(isClosedDate("2026-04-12", closures)).toBe(true);
    expect(isClosedDate("2026-04-13", closures)).toBe(false);
  });
});

describe("isOpenOnDate", () => {
  it("honours weekly schedule", () => {
    // Mon 2026-04-20 → closed
    expect(isOpenOnDate(new Date(2026, 3, 20), weekly, [])).toBe(false);
    // Tue 2026-04-21 → open
    expect(isOpenOnDate(new Date(2026, 3, 21), weekly, [])).toBe(true);
  });

  it("closures override a normally-open weekday", () => {
    const closures: ShopClosure[] = [
      { startDate: "2026-04-21", endDate: "2026-04-21", reason: "sick" },
    ];
    expect(isOpenOnDate(new Date(2026, 3, 21), weekly, closures)).toBe(false);
  });
});

describe("nextShopOpeningDay", () => {
  it("returns today if shop is open today", () => {
    const tue = new Date(2026, 3, 21); // Tuesday
    const next = nextShopOpeningDay(weekly, [], tue);
    expect(next?.getDate()).toBe(21);
  });

  it("skips to the next open weekday when today is closed", () => {
    const sun = new Date(2026, 3, 19); // Sunday
    const next = nextShopOpeningDay(weekly, [], sun);
    expect(next?.getDay()).toBe(2); // Tuesday
    expect(next?.getDate()).toBe(21);
  });

  it("skips over a multi-day closure", () => {
    const closures: ShopClosure[] = [
      { startDate: "2026-04-21", endDate: "2026-04-24", reason: "vacation" },
    ];
    const sun = new Date(2026, 3, 19);
    const next = nextShopOpeningDay(weekly, closures, sun);
    // Sat 25th is open and outside the closure
    expect(next?.getDate()).toBe(25);
  });

  it("returns null when every day is closed", () => {
    const closedAll: ShopOpeningHours[] = Array.from({ length: 7 }, (_, i) => ({
      dayOfWeek: i, isOpen: false,
    }));
    expect(nextShopOpeningDay(closedAll, [], new Date())).toBeNull();
  });
});

describe("daysBetween", () => {
  it("counts whole days ignoring time-of-day", () => {
    const a = new Date(2026, 3, 20, 23, 50);
    const b = new Date(2026, 3, 25, 0, 10);
    expect(daysBetween(a, b)).toBe(5);
  });
});

describe("computeLiveShopStatus", () => {
  it("reports open when now is inside today's window", () => {
    const tueAt12 = new Date(2026, 3, 21, 12, 0);
    const s = computeLiveShopStatus(tueAt12, weekly, []);
    expect(s.isOpenNow).toBe(true);
    expect(s.todayHours?.openAt).toBe("10:00");
  });

  it("reports closed before opening hour, with next opening = today", () => {
    const tueAt9 = new Date(2026, 3, 21, 9, 0);
    const s = computeLiveShopStatus(tueAt9, weekly, []);
    expect(s.isOpenNow).toBe(false);
    expect(s.nextOpening?.date.getDate()).toBe(21);
  });

  it("reports closed + reason during a closure", () => {
    const closures: ShopClosure[] = [
      { startDate: "2026-04-21", endDate: "2026-04-21", reason: "training" },
    ];
    const tueAt12 = new Date(2026, 3, 21, 12, 0);
    const s = computeLiveShopStatus(tueAt12, weekly, closures);
    expect(s.isOpenNow).toBe(false);
    expect(s.closureReason).toBe("training");
  });

  it("falls back to the next open day when today is a closed weekday", () => {
    const mon = new Date(2026, 3, 20, 12, 0);
    const s = computeLiveShopStatus(mon, weekly, []);
    expect(s.isOpenNow).toBe(false);
    expect(s.nextOpening?.date.getDay()).toBe(2);
  });
});

describe("suggestLeadTimeDays", () => {
  it("returns 1 when inputs are missing / zero", () => {
    expect(suggestLeadTimeDays(0, 480)).toBe(1);
    expect(suggestLeadTimeDays(480, 0)).toBe(1);
  });

  it("rounds up so short batches still take one day", () => {
    expect(suggestLeadTimeDays(30, 480)).toBe(1);
  });

  it("scales up for bigger batches", () => {
    // 1200 min / 480 min-per-day = 2.5 → 3 days
    expect(suggestLeadTimeDays(1200, 480)).toBe(3);
  });
});
