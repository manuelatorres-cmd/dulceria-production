/**
 * Save a manual-planner DraftBatch to the DB as a real production plan.
 *
 * Writes:
 *   - one productionPlans row (status='active', pinnedDate set so the
 *     auto-planner respects the placement)
 *   - one planProducts row (productId + mouldId + quantity = mouldCount)
 *   - one orderPlanLinks row per order-source allocation
 *
 * PO-source allocations are NOT linked — there is no PO-plan link
 * table at the schema level (see investigation §9). They flow through
 * as informational notes on the plan. This is documented as an honest
 * deferred item in the v2 spec.
 */

import { saveProductionPlan, savePlanProduct, saveOrderPlanLink } from "@/lib/hooks";
import type { DraftBatch } from "./draft-state";

export interface SaveDraftResult {
  planId: string;
  warnings: string[];
}

export async function saveDraftToPlan(draft: DraftBatch): Promise<SaveDraftResult> {
  if (!draft.pinnedDate) throw new Error("Cannot save: no pinned date.");
  if (draft.allocations.length === 0 && draft.surplusDestination == null) {
    throw new Error("Cannot save: no allocations and no surplus destination.");
  }

  const now = new Date();
  const poNotes: string[] = [];
  for (const a of draft.allocations) {
    if (a.source === "po") poNotes.push(`PO ${a.label}: ${a.qty} pcs`);
  }
  const notes =
    [
      draft.notes.trim(),
      poNotes.length > 0 ? `PO allocations (informational): ${poNotes.join("; ")}` : "",
    ]
      .filter(Boolean)
      .join("\n") || undefined;

  const planId = await saveProductionPlan({
    name: draft.name,
    status: "active",
    notes,
    pinnedDate: draft.pinnedDate,
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
    if (a.source !== "order" || !a.parentId) continue;
    try {
      await saveOrderPlanLink({
        orderItemId: a.parentId,
        planId,
        allocatedQuantity: a.qty,
      });
    } catch (e) {
      warnings.push(
        `OrderPlanLink for ${a.label}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return { planId, warnings };
}
