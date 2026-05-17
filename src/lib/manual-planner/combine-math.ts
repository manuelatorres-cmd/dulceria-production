/**
 * Spec MANUAL_PLANNER_SOURCE_FIRST_BATCH.md §4.4
 *
 * Given a list of source items the operator has checked, compute:
 *   - how many batches we actually need (mould-share consolidates)
 *   - how many batches mould-sharing saved vs naive per-item batches
 *   - total active minutes (used for the capacity warning)
 *   - per-combine detail rows for the Combine Preview accordion
 *
 * v1 mould-share rule: any two items targeting the same mouldId can
 * share batch runs. Each batch holds `mouldCavities` pieces per fill;
 * the chunk count = ceil(sumFills / quantityOwned-or-1). For now we
 * don't constrain by `quantityOwned` (audit §6.4 — keep), only by
 * the cavity count + fill count math the user already sees.
 *
 * Active-minute estimate: sum step.activeMinutes for every step
 * matching the product's category. Multiply by fillCount unless the
 * step is `perBatch=true` (mig 0037).
 */

import type {
  ProductCategory,
  ProductionStep,
} from "@/types";
import type { SourceItem } from "./source-types";

export interface CombineDetail {
  mouldId: string;
  mouldName: string;
  productNames: string[];
  totalFills: number;
}

export interface CombineMathResult {
  itemCount: number;
  batchCount: number;
  savedByMouldShare: number;
  totalActiveMinutes: number;
  overCapacity: boolean;
  combines: CombineDetail[];
}

export interface CombineMathDeps {
  productCategories: ProductCategory[];
  productionSteps: ProductionStep[];
  /** Daily active-minutes capacity threshold. Null/undefined → 300 (5h). */
  dailyActiveCapacityMinutes: number | null | undefined;
}

const DEFAULT_DAILY_CAPACITY = 300;

export function computeCombineMath(
  items: SourceItem[],
  deps: CombineMathDeps,
): CombineMathResult {
  if (items.length === 0) {
    return {
      itemCount: 0,
      batchCount: 0,
      savedByMouldShare: 0,
      totalActiveMinutes: 0,
      overCapacity: false,
      combines: [],
    };
  }

  // Group by mouldId.
  const byMould = new Map<string, SourceItem[]>();
  for (const it of items) {
    const arr = byMould.get(it.mouldId) ?? [];
    arr.push(it);
    byMould.set(it.mouldId, arr);
  }

  const stepsByCategoryName = indexStepsByCategory(deps.productCategories, deps.productionSteps);

  let batchCount = 0;
  let totalActiveMinutes = 0;
  let naiveBatchCount = 0;
  const combines: CombineDetail[] = [];

  for (const [mouldId, group] of byMould) {
    const sumFills = group.reduce((s, it) => s + it.fillsNeeded, 0);
    naiveBatchCount += group.length;
    // v1: one batch per mould group regardless of fill count. (Capacity
    // warning catches the user if it's actually too much for one day.)
    batchCount += 1;
    combines.push({
      mouldId,
      mouldName: group[0].mouldName,
      productNames: [...new Set(group.map((it) => it.productName))],
      totalFills: sumFills,
    });
    // Active-minute estimate per item, summed.
    for (const it of group) {
      const stepList = stepsByCategoryName.get(it.productCategory) ?? [];
      for (const step of stepList) {
        const mins = Number(step.activeMinutes ?? 0);
        if (!mins) continue;
        totalActiveMinutes += step.perBatch ? mins : mins * it.fillsNeeded;
      }
    }
  }

  const cap = deps.dailyActiveCapacityMinutes ?? DEFAULT_DAILY_CAPACITY;
  return {
    itemCount: items.length,
    batchCount,
    savedByMouldShare: Math.max(0, naiveBatchCount - batchCount),
    totalActiveMinutes: Math.round(totalActiveMinutes),
    overCapacity: cap > 0 && totalActiveMinutes > cap,
    combines: combines.sort((a, b) => a.mouldName.localeCompare(b.mouldName)),
  };
}

function indexStepsByCategory(
  categories: ProductCategory[],
  steps: ProductionStep[],
): Map<string, ProductionStep[]> {
  const m = new Map<string, ProductionStep[]>();
  for (const step of steps) {
    const key = step.productType;
    const arr = m.get(key) ?? [];
    arr.push(step);
    m.set(key, arr);
  }
  // Sort each list by sortOrder so the multiplier loop is deterministic.
  for (const arr of m.values()) arr.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  // Build a category-name alias map (some callers pass `productCategory`
  // names; some pass IDs). Caller in source-first uses names.
  // categories array isn't used to alias right now but kept in signature
  // so future caller flexibility doesn't break the API.
  void categories;
  return m;
}
