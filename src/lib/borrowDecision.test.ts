import { describe, it, expect } from "vitest";
import { decideBorrowStrategy, computeReplenishmentQuantity } from "./borrowDecision";
import type { ShopOpeningHours, ShopClosure } from "@/types";

const weekly: ShopOpeningHours[] = [
  { dayOfWeek: 0, isOpen: false },
  { dayOfWeek: 1, isOpen: false },
  { dayOfWeek: 2, isOpen: true, openAt: "10:00", closeAt: "18:00" },
  { dayOfWeek: 3, isOpen: true, openAt: "10:00", closeAt: "18:00" },
  { dayOfWeek: 4, isOpen: true, openAt: "10:00", closeAt: "18:00" },
  { dayOfWeek: 5, isOpen: true, openAt: "10:00", closeAt: "18:00" },
  { dayOfWeek: 6, isOpen: true, openAt: "10:00", closeAt: "16:00" },
];

describe("decideBorrowStrategy", () => {
  it("borrows when time + stock both fit", () => {
    // Mon 2026-04-20 → next opening is Tue 21. 1 day away, lead time 1.
    const d = decideBorrowStrategy({
      quantityRequested: 10,
      storeAvailable: 20,
      leadTimeDays: 1,
      now: new Date(2026, 3, 20),
      hours: weekly,
      closures: [],
    });
    expect(d.mode).toBe("borrow");
    if (d.mode === "borrow") {
      expect(d.borrowedQuantity).toBe(10);
      expect(d.daysUntilReopen).toBe(1);
    }
  });

  it("produces when lead time is longer than the gap", () => {
    const d = decideBorrowStrategy({
      quantityRequested: 10,
      storeAvailable: 20,
      leadTimeDays: 3,
      now: new Date(2026, 3, 20), // Mon, next opening Tue → 1 day
      hours: weekly,
      closures: [],
    });
    expect(d.mode).toBe("produce");
    if (d.mode === "produce") expect(d.reason).toBe("lead_time_too_long");
  });

  it("produces when Store doesn't have enough", () => {
    const d = decideBorrowStrategy({
      quantityRequested: 50,
      storeAvailable: 20,
      leadTimeDays: 1,
      now: new Date(2026, 3, 20),
      hours: weekly,
      closures: [],
    });
    expect(d.mode).toBe("produce");
    if (d.mode === "produce") expect(d.reason).toBe("insufficient_store");
  });

  it("produces when no open day exists in the next 365", () => {
    const closed: ShopOpeningHours[] = Array.from({ length: 7 }, (_, i) => ({
      dayOfWeek: i, isOpen: false,
    }));
    const d = decideBorrowStrategy({
      quantityRequested: 10,
      storeAvailable: 20,
      leadTimeDays: 1,
      now: new Date(2026, 3, 20),
      hours: closed,
      closures: [],
    });
    expect(d.mode).toBe("produce");
    if (d.mode === "produce") expect(d.reason).toBe("no_shop_opening");
  });

  it("waits past a closure and still borrows if lead time allows", () => {
    const closures: ShopClosure[] = [
      { startDate: "2026-04-21", endDate: "2026-04-24", reason: "vac" },
    ];
    // Mon 20th → next opening is Sat 25th = 5 days out. Lead 3 is fine.
    const d = decideBorrowStrategy({
      quantityRequested: 10,
      storeAvailable: 20,
      leadTimeDays: 3,
      now: new Date(2026, 3, 20),
      hours: weekly,
      closures,
    });
    expect(d.mode).toBe("borrow");
    if (d.mode === "borrow") expect(d.daysUntilReopen).toBe(5);
  });
});

describe("computeReplenishmentQuantity", () => {
  it("uses maximumUnits when set", () => {
    // Borrowed 5 of 20 Store. Min 10, Max 30 → restock to 30 = 30 − (20−5) = 15.
    // Floor at borrowed (5) → 15.
    expect(computeReplenishmentQuantity({
      borrowedQuantity: 5, currentStore: 20, minimumUnits: 10, maximumUnits: 30,
    })).toBe(15);
  });

  it("falls back to minimumUnits when max is null", () => {
    // Borrowed 5 of 20. Min 10, no max → target 10. 10 − 15 = negative → 0.
    // Floor at borrowed (5) → 5.
    expect(computeReplenishmentQuantity({
      borrowedQuantity: 5, currentStore: 20, minimumUnits: 10,
    })).toBe(5);
  });

  it("tops up when currentStore is low and we borrow a bit", () => {
    // Borrowed 3 of 5. Min 12, no max → target 12. post = 5−3 = 2.
    // topUp = 12 − 2 = 10 (> borrowed 3).
    expect(computeReplenishmentQuantity({
      borrowedQuantity: 3, currentStore: 5, minimumUnits: 12,
    })).toBe(10);
  });

  it("never goes below the borrowed quantity", () => {
    // Already above min → topUp 0, but we still must make back what we took.
    expect(computeReplenishmentQuantity({
      borrowedQuantity: 7, currentStore: 100, minimumUnits: 10,
    })).toBe(7);
  });
});
