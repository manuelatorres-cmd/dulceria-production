/**
 * Borrow-from-Store decision — pure.
 *
 * For every order line on a B2B or online order, we ask: can we fulfil
 * this by borrowing pieces from the shop's Store stock, and then
 * produce a replacement batch before the shop reopens? If yes, we
 * allocate Store stock immediately and auto-create a linked
 * "Shop Replenishment" order. If no, the line runs through full
 * production like normal.
 *
 * The two gates are simple:
 *   1. Time: next shop opening day − today ≥ product.leadTimeDays.
 *      Otherwise we can't produce a replacement in time — don't borrow.
 *   2. Stock: Store has enough un-allocated pieces to cover the line.
 *      Otherwise we can't fulfil — don't borrow.
 */

import type { ShopOpeningHours, ShopClosure } from "@/types";
import { nextShopOpeningDay, daysBetween } from "@/lib/shopHours";

export interface BorrowDecisionInput {
  quantityRequested: number;
  /** Pieces available in the Store location that aren't already allocated
   *  to another order. Caller computes by subtracting allocated-from-store
   *  rows from the total Store quantity. */
  storeAvailable: number;
  /** Days to produce a replacement batch. If the product has no lead
   *  time set, callers should pass the suggested value. */
  leadTimeDays: number;
  /** "Now" — injected for testability. */
  now: Date;
  hours: ShopOpeningHours[];
  closures: ShopClosure[];
}

export type BorrowDecision =
  | {
      mode: "borrow";
      borrowedQuantity: number;
      nextShopOpening: Date;
      daysUntilReopen: number;
    }
  | {
      mode: "produce";
      reason: "no_shop_opening" | "lead_time_too_long" | "insufficient_store";
      /** Details the caller can surface in the UI to explain *why* the
       *  order couldn't borrow. */
      detail?: {
        daysUntilReopen?: number;
        leadTimeDays?: number;
        storeAvailable?: number;
        quantityRequested?: number;
      };
    };

export function decideBorrowStrategy(input: BorrowDecisionInput): BorrowDecision {
  const next = nextShopOpeningDay(input.hours, input.closures, input.now);
  if (!next) {
    return { mode: "produce", reason: "no_shop_opening" };
  }

  const daysUntilReopen = daysBetween(input.now, next);

  if (daysUntilReopen < input.leadTimeDays) {
    return {
      mode: "produce",
      reason: "lead_time_too_long",
      detail: { daysUntilReopen, leadTimeDays: input.leadTimeDays },
    };
  }

  if (input.storeAvailable < input.quantityRequested) {
    return {
      mode: "produce",
      reason: "insufficient_store",
      detail: {
        storeAvailable: input.storeAvailable,
        quantityRequested: input.quantityRequested,
      },
    };
  }

  return {
    mode: "borrow",
    borrowedQuantity: input.quantityRequested,
    nextShopOpening: next,
    daysUntilReopen,
  };
}

/** Compute the replenishment quantity for a single borrowed product.
 *  Target = maximumUnits (if set) else minimumUnits. Replenishment =
 *  max(borrowedQuantity, target − currentStore + borrowedQuantity).
 *  The floor at `borrowedQuantity` guarantees we at least restore
 *  what we took. */
export function computeReplenishmentQuantity(input: {
  borrowedQuantity: number;
  currentStore: number;
  minimumUnits: number;
  maximumUnits?: number;
}): number {
  const target = input.maximumUnits ?? input.minimumUnits;
  const postBorrowStore = Math.max(0, input.currentStore - input.borrowedQuantity);
  const topUp = Math.max(0, target - postBorrowStore);
  return Math.max(input.borrowedQuantity, topUp);
}
