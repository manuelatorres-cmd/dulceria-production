/**
 * Shop opening hours helpers — pure, no Supabase, no React.
 *
 * The shop has a weekly schedule (one `ShopOpeningHours` row per
 * day-of-week) and an open-ended list of one-off closures (holidays,
 * vacations). The /shop dashboard and the borrow decision both depend
 * on knowing "is the shop open now?" and "when's the next opening day?".
 */

import type { ShopOpeningHours, ShopClosure } from "@/types";

/** Format a Date as 'YYYY-MM-DD' in local time (not UTC, so dates
 *  match what the user enters in a date-picker). */
export function dateToIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** True if the ISO date falls inside any closure (inclusive). */
export function isClosedDate(iso: string, closures: ShopClosure[]): boolean {
  return closures.some((c) => iso >= c.startDate && iso <= c.endDate);
}

/** True if the shop is scheduled to be open on `date` — honours both
 *  the weekly schedule and closure ranges. Doesn't check the clock. */
export function isOpenOnDate(
  date: Date,
  hours: ShopOpeningHours[],
  closures: ShopClosure[],
): boolean {
  const iso = dateToIso(date);
  if (isClosedDate(iso, closures)) return false;
  const row = hours.find((h) => h.dayOfWeek === date.getDay());
  return !!row?.isOpen;
}

/** The next Date (at 00:00 local) when the shop is open, starting from
 *  `fromDate` inclusive. Returns null if the shop has no open days in
 *  the next 365 — e.g. every weekday is `isOpen: false`. */
export function nextShopOpeningDay(
  hours: ShopOpeningHours[],
  closures: ShopClosure[],
  fromDate: Date = new Date(),
): Date | null {
  const cursor = new Date(fromDate);
  cursor.setHours(0, 0, 0, 0);
  for (let i = 0; i < 365; i++) {
    if (isOpenOnDate(cursor, hours, closures)) return new Date(cursor);
    cursor.setDate(cursor.getDate() + 1);
  }
  return null;
}

/** Whole calendar days between two dates (to - from). Both clamped to
 *  00:00 so daylight-savings transitions don't nudge the count. */
export function daysBetween(from: Date, to: Date): number {
  const a = new Date(from); a.setHours(0, 0, 0, 0);
  const b = new Date(to);   b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export interface LiveShopStatus {
  isOpenNow: boolean;
  todayHours?: { openAt: string; closeAt: string };
  nextOpening?: { date: Date; openAt?: string; closeAt?: string };
  closureReason?: string;
}

/** Live "open / closed now" + next opening for the dashboard's top card. */
export function computeLiveShopStatus(
  now: Date,
  hours: ShopOpeningHours[],
  closures: ShopClosure[],
): LiveShopStatus {
  const todayIso = dateToIso(now);
  const activeClosure = closures.find(
    (c) => todayIso >= c.startDate && todayIso <= c.endDate,
  );
  const todayRow = hours.find((h) => h.dayOfWeek === now.getDay());
  const todayHours = todayRow?.isOpen && todayRow.openAt && todayRow.closeAt
    ? { openAt: todayRow.openAt, closeAt: todayRow.closeAt }
    : undefined;

  let isOpenNow = false;
  if (!activeClosure && todayHours) {
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const nowHm = `${hh}:${mm}`;
    isOpenNow = nowHm >= todayHours.openAt && nowHm < todayHours.closeAt;
  }

  const next = nextShopOpeningDay(hours, closures, now);
  const nextRow = next ? hours.find((h) => h.dayOfWeek === next.getDay()) : undefined;

  return {
    isOpenNow,
    todayHours,
    nextOpening: next
      ? { date: next, openAt: nextRow?.openAt, closeAt: nextRow?.closeAt }
      : undefined,
    closureReason: activeClosure?.reason,
  };
}

/** Derived suggestion for a product's lead time in whole days.
 *  totalBatchMinutes = sum of active + waiting across every step in the
 *  product's category (or 0 if unknown). dailyCapacityMinutes = people
 *  × hours-per-day × 60. Falls back to 1 day when inputs are missing. */
export function suggestLeadTimeDays(
  totalBatchMinutes: number,
  dailyCapacityMinutes: number,
): number {
  if (dailyCapacityMinutes <= 0 || totalBatchMinutes <= 0) return 1;
  return Math.max(1, Math.ceil(totalBatchMinutes / dailyCapacityMinutes));
}
