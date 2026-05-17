/**
 * Save a manual-planner DraftBatch to the DB as a productionPlans row.
 *
 * Two save modes, controlled by `options.status`:
 *   - 'draft'  → park for later. pinnedDate forced to null regardless
 *                of input. Editor clears so the user can start a new
 *                draft; the parked card appears in the DraftsTray.
 *   - 'active' → commit + pin. pinnedDate is required (ISO yyyy-mm-dd)
 *                and persists on the productionPlans row so the
 *                scheduler treats it as locked.
 *
 * Writes:
 *   - productionPlans (status, pinnedDate, surplusDestination, name, notes)
 *   - planProducts    (productId, mouldId, quantity = mouldCount)
 *   - orderPlanLinks  (one per source='order' allocation)
 *   - poPlanLinks     (one per source='po' allocation — mig 0094)
 *
 * No more PO-as-notes-text trail: every allocation has a typed FK row.
 */

import {
  saveProductionPlan,
  savePlanProduct,
  saveOrderPlanLink,
  savePoPlanLink,
} from "@/lib/hooks";
import type { DraftBatch } from "./draft-state";

export interface SaveDraftOptions {
  status: "draft" | "active";
  /** Required when status === 'active'. Ignored (forced null) when 'draft'. */
  pinnedDate?: string | null;
}

export interface SaveDraftResult {
  planId: string;
  warnings: string[];
}

export async function saveDraftToPlan(
  draft: DraftBatch,
  options: SaveDraftOptions,
): Promise<SaveDraftResult> {
  // Hard rule (2026-05-17): no zero-allocation drafts. Earlier path
  // allowed parking when surplusDestination was set with no allocations,
  // which spawned "0 lines · +200 surplus" orphans visible in the tray.
  // Save must carry real demand or it shouldn't exist.
  if (draft.allocations.length === 0) {
    throw new Error("Cannot save empty draft — add at least one allocation first.");
  }
  if (options.status === "active" && !options.pinnedDate) {
    throw new Error("Cannot save & pin: no pinned date.");
  }

  const now = new Date();
  const pinnedDate = options.status === "draft" ? null : options.pinnedDate ?? null;
  const notes = draft.notes.trim() ? draft.notes.trim() : undefined;

  const planId = await saveProductionPlan({
    name: draft.name,
    status: options.status,
    notes,
    pinnedDate,
    surplusDestination:
      draft.surplusDestination === "po-fill"
        ? "store"
        : draft.surplusDestination ?? undefined,
    createdAt: now,
    updatedAt: now,
  });

  await savePlanProduct({
    planId,
    productId: draft.productId,
    mouldId: draft.mouldId,
    quantity: draft.mouldCount,
    sortOrder: 0,
  });

  const warnings: string[] = [];
  for (const a of draft.allocations) {
    if (!a.parentId) continue;
    try {
      if (a.source === "order") {
        await saveOrderPlanLink({
          orderItemId: a.parentId,
          planId,
          allocatedQuantity: a.qty,
        });
      } else {
        await savePoPlanLink({
          productionOrderItemId: a.parentId,
          planId,
          allocatedQuantity: a.qty,
        });
      }
    } catch (e) {
      warnings.push(
        `${a.source === "order" ? "OrderPlanLink" : "PoPlanLink"} for ${a.label}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return { planId, warnings };
}
