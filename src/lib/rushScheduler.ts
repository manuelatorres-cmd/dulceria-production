/**
 * Rush scheduler — pure functions only.
 *
 * Job: when an order is saved with `timeSensitive=true`, decide which
 * existing scheduled blocks to displace so the rush fits before its
 * deadline, in priority order (R&D → tier-3 → tier-2 → tier-1 →
 * standard order → campaign → never displace).
 *
 * Output: a placement plan listing where each rush slice lands and
 * which existing blocks were pushed (and to which new dates). The
 * caller is responsible for persisting the changes.
 */

import type { Product } from "@/types";
import { addDays, todayISO } from "./replenishmentEngine";

/** Existing block on the calendar that the rush might displace. */
export interface ScheduledBlock {
  /** ID of the productionPlan or proposal this block represents. */
  id: string;
  productId: string;
  /** ISO date 'YYYY-MM-DD'. */
  date: string;
  /** Active minutes consumed on that day. */
  minutes: number;
  /** Block category — drives priority ordering when displacing. */
  kind:
    | "rush-order"
    | "campaign"
    | "standard-order"
    | "tier-1-replen"
    | "tier-2-replen"
    | "tier-3-replen"
    | "rd";
}

/** Per-day capacity in active minutes. */
export interface DayCapacity {
  /** ISO date 'YYYY-MM-DD'. */
  date: string;
  availableMinutes: number;
  /** Already-allocated minutes from the existing schedule. */
  usedMinutes: number;
}

/** A single rush slice to place. Big orders auto-split into multiple
 *  slices, one per workday. */
export interface RushSlice {
  productId: string;
  quantity: number;
  /** Estimated minutes this slice will need. */
  minutes: number;
}

export interface PlacementResult {
  placements: Array<{ slice: RushSlice; date: string }>;
  displacements: Array<{ block: ScheduledBlock; from: string; to: string }>;
  /** Slices that could not be placed within the deadline. */
  unfit: RushSlice[];
}

/** Order in which existing blocks are dropped to make room. Earlier in
 *  this list = first to displace. Campaign + rush blocks never appear
 *  here — the engine refuses to touch them. */
const DISPLACE_ORDER: ScheduledBlock["kind"][] = [
  "rd",
  "tier-3-replen",
  "tier-2-replen",
  "tier-1-replen",
  "standard-order",
];

/** Compute the daily slice cap from product mould floor + workshop max. */
export function suggestSliceSize(args: {
  totalQuantity: number;
  mouldFloor: number;
  maxPerDay: number;
}): number {
  const cap = Math.min(args.maxPerDay, args.totalQuantity);
  // Round down to nearest mould floor multiple, but at least one mould.
  const mults = Math.max(1, Math.floor(cap / args.mouldFloor));
  return mults * args.mouldFloor;
}

/** Build the rush slices that together cover the requested quantity. */
export function buildRushSlices(args: {
  productId: string;
  quantity: number;
  mouldFloor: number;
  maxPerDay: number;
  minutesPerPiece: number;
}): RushSlice[] {
  if (args.quantity <= 0) return [];
  const slices: RushSlice[] = [];
  const sliceSize = suggestSliceSize({
    totalQuantity: args.quantity,
    mouldFloor: args.mouldFloor,
    maxPerDay: args.maxPerDay,
  });
  let remaining = args.quantity;
  while (remaining > 0) {
    const qty = Math.min(remaining, sliceSize);
    slices.push({
      productId: args.productId,
      quantity: qty,
      minutes: Math.ceil(qty * args.minutesPerPiece),
    });
    remaining -= qty;
  }
  return slices;
}

/** List the workdays available between today and the deadline that the
 *  rush can target. Excludes weekends / closures via the
 *  `closedDates` set. */
export function workableDays(args: {
  fromISO: string;
  deadlineISO: string;
  closedDates?: Set<string>;
}): string[] {
  const out: string[] = [];
  let cursor = args.fromISO;
  while (cursor <= args.deadlineISO) {
    const d = new Date(cursor + "T00:00:00Z");
    const dow = d.getUTCDay(); // 0 = Sunday … 6 = Saturday
    const closed = args.closedDates?.has(cursor) ?? false;
    if (dow !== 0 && dow !== 6 && !closed) {
      out.push(cursor);
    }
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** Find the next available date forward starting from `fromISO`. */
export function nextWorkday(
  fromISO: string,
  closedDates?: Set<string>,
  maxDaysAhead = 365,
): string {
  let cursor = fromISO;
  for (let i = 0; i < maxDaysAhead; i++) {
    const d = new Date(cursor + "T00:00:00Z");
    const dow = d.getUTCDay();
    const closed = closedDates?.has(cursor) ?? false;
    if (dow !== 0 && dow !== 6 && !closed) return cursor;
    cursor = addDays(cursor, 1);
  }
  return cursor;
}

/** Try to place rush slices across workdays, displacing lower-priority
 *  blocks as needed. Returns placements + displacements + any
 *  unplaceable slices. */
export function placeRushSlices(args: {
  slices: RushSlice[];
  deadlineISO: string;
  startISO?: string;
  closedDates?: Set<string>;
  capacity: DayCapacity[];
  existingBlocks: ScheduledBlock[];
}): PlacementResult {
  const start = args.startISO ?? todayISO();
  const days = workableDays({
    fromISO: start,
    deadlineISO: args.deadlineISO,
    closedDates: args.closedDates,
  });
  const capByDate = new Map(args.capacity.map((c) => [c.date, { ...c }]));
  const blocksByDate = new Map<string, ScheduledBlock[]>();
  for (const b of args.existingBlocks) {
    const list = blocksByDate.get(b.date) ?? [];
    list.push(b);
    blocksByDate.set(b.date, list);
  }

  const placements: PlacementResult["placements"] = [];
  const displacements: PlacementResult["displacements"] = [];
  const unfit: RushSlice[] = [];

  for (const slice of args.slices) {
    let placed = false;
    for (const date of days) {
      const cap = capByDate.get(date);
      if (!cap) continue;
      let free = cap.availableMinutes - cap.usedMinutes;
      if (free >= slice.minutes) {
        cap.usedMinutes += slice.minutes;
        placements.push({ slice, date });
        placed = true;
        break;
      }
      // Need to displace. Walk DISPLACE_ORDER from softest to hardest,
      // dropping until enough room or run out of options.
      const dayBlocks = (blocksByDate.get(date) ?? [])
        .filter((b) => DISPLACE_ORDER.includes(b.kind))
        .sort(
          (a, b) =>
            DISPLACE_ORDER.indexOf(a.kind) - DISPLACE_ORDER.indexOf(b.kind),
        );
      for (const block of dayBlocks) {
        if (free >= slice.minutes) break;
        // Push the block to the next workable date.
        const newDate = nextWorkday(addDays(date, 1), args.closedDates);
        displacements.push({ block, from: date, to: newDate });
        cap.usedMinutes -= block.minutes;
        free += block.minutes;
        // Track moved block on the new date too.
        const newDayCap = capByDate.get(newDate);
        if (newDayCap) {
          newDayCap.usedMinutes += block.minutes;
        }
      }
      if (free >= slice.minutes) {
        cap.usedMinutes += slice.minutes;
        placements.push({ slice, date });
        placed = true;
        break;
      }
    }
    if (!placed) unfit.push(slice);
  }

  return { placements, displacements, unfit };
}

/** Convenience: for an order line, build slices + place them. */
export function planRush(args: {
  product: Product;
  totalQuantity: number;
  deadlineISO: string;
  startISO?: string;
  closedDates?: Set<string>;
  capacity: DayCapacity[];
  existingBlocks: ScheduledBlock[];
  mouldFloor: number;
  maxPerDay: number;
  minutesPerPiece: number;
}): PlacementResult {
  const slices = buildRushSlices({
    productId: args.product.id ?? "",
    quantity: args.totalQuantity,
    mouldFloor: args.mouldFloor,
    maxPerDay: args.maxPerDay,
    minutesPerPiece: args.minutesPerPiece,
  });
  return placeRushSlices({
    slices,
    deadlineISO: args.deadlineISO,
    startISO: args.startISO,
    closedDates: args.closedDates,
    capacity: args.capacity,
    existingBlocks: args.existingBlocks,
  });
}
