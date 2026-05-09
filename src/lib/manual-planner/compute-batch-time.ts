/**
 * Sum the active-minutes a batch costs against workshop capacity.
 *
 * Mirrors `src/lib/scheduler.ts:292-295`: `perBatch=true` steps are a
 * fixed cost regardless of mould count (e.g. tempering vat); the rest
 * scale with mould count.
 *
 * Waiting minutes are intentionally excluded — they're elapsed-only
 * (drying / cooling) and don't count against the people-hours budget.
 */

import type { ProductionStep } from "@/types";

export function computeBatchActiveMinutes(
  productType: string | undefined | null,
  mouldCount: number,
  steps: ProductionStep[],
): number {
  if (!productType || mouldCount <= 0) return 0;
  let total = 0;
  for (const step of steps) {
    if (step.productType !== productType) continue;
    const factor = step.perBatch ? 1 : mouldCount;
    total += step.activeMinutes * factor;
  }
  return total;
}

/** Format minutes as "Xh Ym" — used in the draft bar summary. */
export function formatMinutes(min: number): string {
  if (min <= 0) return "0m";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
