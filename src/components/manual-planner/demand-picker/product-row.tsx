"use client";

import type { ProductDemand } from "@/lib/manual-planner/aggregate-demand";
import type { SmartSuggestion } from "@/lib/manual-planner/smart-suggestions";
import { IconChevronRight as ChevronRight } from "@tabler/icons-react";
import { OrdersExpanded } from "./orders-expanded";

/**
 * Compact single-line product row per the workflow redesign
 * (CURSOR_PROMPT_MANUAL_PLANNER_WORKFLOW.md §3). Grid columns:
 *   14px | 1fr | 70px | 110px | 100px | 100px | 24px
 *   dot · name · qty · spec · due · state · expand
 *
 * Click the row body → expand inline to reveal source lines
 * (OrdersExpanded). Expand chevron fades in on hover so the resting
 * state stays scan-friendly across 26+ products.
 */
export function ProductRow({
  product,
  expanded,
  onToggle,
  inDraft,
  draftOrderItemIds,
  draftPoItemIds,
  onPickOrderLine,
  onPickPoLine,
  onAcceptSuggestion,
}: {
  product: ProductDemand;
  expanded: boolean;
  onToggle: () => void;
  inDraft: boolean;
  draftOrderItemIds: Set<string>;
  draftPoItemIds: Set<string>;
  onPickOrderLine: (args: { orderItemId: string; productId: string; qty: number; customerName: string }) => void;
  onPickPoLine: (args: { poItemId: string; productId: string; qty: number; poName: string }) => void;
  onAcceptSuggestion: (productId: string, suggestion: SmartSuggestion) => void;
}) {
  const urgent =
    product.urgencyLevel === "overdue" || product.urgencyLevel === "urgent";

  const dueLabel = product.earliestDeadline
    ? `${urgent ? "⚠ " : ""}${product.earliestDeadline.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
    : "—";

  // Spec column: "{N} PO · {C}-cav" (drop pcs/run per spec §3).
  const specParts: string[] = [];
  if (product.poDemand > 0) specParts.push(`${product.poDemand} PO`);
  if (product.orderDemand > 0) specParts.push(`${product.orderDemand} ord`);
  if (product.numberOfCavities > 0) specParts.push(`${product.numberOfCavities}-cav`);

  const rowClass = [
    "mp-demand-row",
    urgent ? "urgent" : "",
    inDraft ? "editing" : "",
  ].filter(Boolean).join(" ");

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className={rowClass}
      >
        <span className="status-dot" aria-hidden />
        <span className="name">{product.productName}</span>
        <span className="qty">
          {product.totalDemand}
          <span className="unit"> pcs</span>
        </span>
        <span className="spec">{specParts.join(" · ") || "—"}</span>
        <span className="due">{dueLabel}</span>
        <span className="state">
          {inDraft ? (
            <span className="mp-state-tag editing">editing</span>
          ) : product.draftCount > 0 ? (
            <span className="mp-state-tag draft">
              in draft{product.draftCount > 1 ? ` × ${product.draftCount}` : ""}
            </span>
          ) : null}
        </span>
        <span className="expand" aria-hidden>
          <ChevronRight className="w-3 h-3" />
        </span>
      </div>

      {expanded && (
        <OrdersExpanded
          product={product}
          draftOrderItemIds={draftOrderItemIds}
          draftPoItemIds={draftPoItemIds}
          onPickOrderLine={onPickOrderLine}
          onPickPoLine={onPickPoLine}
          onAcceptSuggestion={onAcceptSuggestion}
        />
      )}
    </>
  );
}
