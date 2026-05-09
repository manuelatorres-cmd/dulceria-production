/**
 * Manual planner v2 — smart batch suggestions.
 *
 * Given a product's demand row, propose 0..2 batch shapes the user
 * is likely to want:
 *
 *   1. single-run  — one mould fill that covers all urgent demand and
 *      uses the leftover cavities for in-flight POs (or surplus).
 *   2. multi-run   — N mould fills that cover all open demand
 *      (orders + POs), used when totalDemand exceeds mould capacity.
 *
 * Both produce concrete order-line + PO-line picks the picker can
 * write into the draft on click — no further user input required for
 * the recommended option.
 */

import type { ProductDemand } from "./aggregate-demand";

export type SuggestionType = "single-run" | "multi-run" | "fill-mould";

export interface SuggestionPick {
  source: "order" | "po";
  /** orderItemId or productionOrderItemId. */
  parentId: string;
  /** Display label (customer name / PO name). */
  label: string;
  qty: number;
  dueDate: string | null;
}

export interface SmartSuggestion {
  type: SuggestionType;
  label: string;
  detail: string;
  mouldCount: number;
  totalPieces: number;
  coverage: {
    fromOrders: number;
    fromPo: number;
    surplus: number;
  };
  recommended: boolean;
  /** Concrete picks the suggestion translates into when accepted. */
  picks: SuggestionPick[];
  /** When surplus > 0, where it should go. null = let the user decide
   *  later via FillMouldModal (Phase 5). */
  surplusDestination: "store" | "freezer" | "po-fill" | null;
}

function isUrgent(u: ProductDemand["urgencyLevel"]): boolean {
  return u === "overdue" || u === "urgent";
}

function urgencyForLine(d: { urgency: ProductDemand["urgencyLevel"] }): boolean {
  return isUrgent(d.urgency);
}

export function generateSuggestions(demand: ProductDemand): SmartSuggestion[] {
  const out: SmartSuggestion[] = [];
  const cavities = demand.numberOfCavities;
  if (cavities <= 0) return out;

  // ─── Single-run: pack one mould with urgent orders + PO top-up ────
  const urgentOrderLines = demand.orderItems.filter(urgencyForLine);
  const urgentTotal = urgentOrderLines.reduce((s, l) => s + l.remaining, 0);

  if (urgentTotal > 0 && urgentTotal <= cavities) {
    let remaining = cavities;
    const picks: SuggestionPick[] = [];
    let fromOrders = 0;
    for (const l of urgentOrderLines) {
      if (remaining <= 0) break;
      const take = Math.min(l.remaining, remaining);
      picks.push({
        source: "order",
        parentId: l.orderItemId,
        label: l.customerName,
        qty: take,
        dueDate: l.dueDate ? l.dueDate.toISOString().slice(0, 10) : null,
      });
      remaining -= take;
      fromOrders += take;
    }

    let fromPo = 0;
    for (const p of demand.poItems) {
      if (remaining <= 0) break;
      const take = Math.min(p.remaining, remaining);
      picks.push({
        source: "po",
        parentId: p.poItemId,
        label: p.poName,
        qty: take,
        dueDate: p.dueDate ? p.dueDate.toISOString().slice(0, 10) : null,
      });
      remaining -= take;
      fromPo += take;
    }

    const surplus = remaining;
    const detailParts = [`covers ${fromOrders} ord`];
    if (fromPo > 0) detailParts.push(`+${fromPo} to PO`);
    if (surplus > 0) detailParts.push(`+${surplus} surplus`);

    out.push({
      type: "single-run",
      label: `Plan ${cavities}-piece run`,
      detail: detailParts.join(", "),
      mouldCount: 1,
      totalPieces: cavities,
      coverage: { fromOrders, fromPo, surplus },
      recommended: true,
      picks,
      // When there's a PO with leftover demand, default surplus → po-fill
      // so the user's surplus pieces aren't auto-routed to stock.
      surplusDestination: surplus > 0 && demand.poDemand > fromPo ? "po-fill" : null,
    });
  }

  // ─── Multi-run: cover all demand (orders + POs) ──────────────────
  const totalNeeded = demand.totalDemand;
  if (totalNeeded > cavities) {
    const runs = Math.ceil(totalNeeded / cavities);
    const totalPieces = runs * cavities;

    let remaining = totalPieces;
    const picks: SuggestionPick[] = [];
    let fromOrders = 0;
    // Orders first, deadline-sorted (already pre-sorted in aggregator).
    for (const l of demand.orderItems) {
      if (remaining <= 0) break;
      const take = Math.min(l.remaining, remaining);
      picks.push({
        source: "order",
        parentId: l.orderItemId,
        label: l.customerName,
        qty: take,
        dueDate: l.dueDate ? l.dueDate.toISOString().slice(0, 10) : null,
      });
      remaining -= take;
      fromOrders += take;
    }
    let fromPo = 0;
    for (const p of demand.poItems) {
      if (remaining <= 0) break;
      const take = Math.min(p.remaining, remaining);
      picks.push({
        source: "po",
        parentId: p.poItemId,
        label: p.poName,
        qty: take,
        dueDate: p.dueDate ? p.dueDate.toISOString().slice(0, 10) : null,
      });
      remaining -= take;
      fromPo += take;
    }
    const surplus = totalPieces - fromOrders - fromPo;

    out.push({
      type: "multi-run",
      label: `Plan ${totalPieces}-piece run`,
      detail: `${runs} mould fills · covers all ${totalNeeded} pcs${surplus > 0 ? ` (+${surplus} surplus)` : ""}`,
      mouldCount: runs,
      totalPieces,
      coverage: { fromOrders, fromPo, surplus },
      recommended: false,
      picks,
      surplusDestination: surplus > 0 ? "store" : null,
    });
  }

  return out;
}
