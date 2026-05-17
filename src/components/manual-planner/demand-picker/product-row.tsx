"use client";

import type { ProductDemand } from "@/lib/manual-planner/aggregate-demand";
import type { SmartSuggestion } from "@/lib/manual-planner/smart-suggestions";
import { IconChevronDown as ChevronDown, IconChevronRight as ChevronRight } from "@tabler/icons-react";
import { OrdersExpanded } from "./orders-expanded";

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
  // Determine left border color based on visual state.
  let leftBorder = "transparent";
  let bg = "var(--mp-card-bg)";
  let opacity = 1;

  if (inDraft) {
    leftBorder = "var(--mp-draft-border)";
    bg = "var(--mp-draft-tint)";
  } else if (product.urgencyLevel === "overdue" || product.urgencyLevel === "urgent") {
    leftBorder = "var(--mp-rose)";
  } else if (product.alreadyPlannedInDrafts > 0 || product.alreadyPlannedInActive > 0) {
    leftBorder = "var(--mp-blush)";
  }
  if (
    product.totalDemand > 0 &&
    product.currentStock + product.alreadyPlannedInActive >= product.totalDemand
  ) {
    opacity = 0.45;
  }
  if (expanded) {
    bg = "var(--mp-hover-bg)";
  }

  const dueLabel = product.earliestDeadline
    ? product.earliestDeadline.toLocaleDateString("de-AT", { day: "numeric", month: "short" })
    : null;

  // Summary line: "67 pcs · 17 ord · 50 PO · 3-cav · 40 pcs/run"
  const summaryParts: string[] = [];
  if (product.totalDemand > 0) summaryParts.push(`${product.totalDemand} pcs`);
  if (product.orderDemand > 0) summaryParts.push(`${product.orderDemand} ord`);
  if (product.poDemand > 0) summaryParts.push(`${product.poDemand} PO`);
  if (product.numberOfCavities > 0)
    summaryParts.push(`${product.numberOfCavities}-cav`);
  if (product.numberOfCavities > 0)
    summaryParts.push(`${product.numberOfCavities} pcs/run`);

  return (
    <div
      style={{
        borderBottom: "0.5px solid var(--mp-border-warm)",
        borderLeft: `3px solid ${leftBorder}`,
        background: bg,
        opacity,
        transition: "background 0.1s",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-4 py-2.5 flex items-start gap-2"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 mt-1 shrink-0" style={{ color: "var(--mp-text-muted)" }} />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 mt-1 shrink-0" style={{ color: "var(--mp-text-muted)" }} />
        )}
        <span className="flex-1 min-w-0">
          <span className="flex items-baseline justify-between gap-2">
            <span
              className="text-[14px] truncate"
              style={{ color: "var(--mp-text-primary)", fontWeight: 500 }}
            >
              {product.productName}
            </span>
            {product.currentStock > 0 && (
              <span
                className="text-[11px] italic shrink-0"
                style={{ color: "var(--mp-text-muted)" }}
              >
                stock {product.currentStock}
              </span>
            )}
          </span>
          {summaryParts.length > 0 && (
            <span
              className="block text-[11.5px] mt-0.5"
              style={{ color: "var(--mp-text-muted)" }}
            >
              {summaryParts.join(" · ")}
            </span>
          )}
          <span className="block mt-1 flex flex-wrap gap-1.5">
            {(product.urgencyLevel === "overdue" || product.urgencyLevel === "urgent") &&
              dueLabel && (
                <span
                  className="text-[10.5px]"
                  style={{
                    color: "var(--mp-rose)",
                    fontWeight: 500,
                  }}
                >
                  ⚠ due {dueLabel}
                </span>
              )}
            {product.alreadyPlannedInActive > 0 && (
              <span
                className="text-[10.5px]"
                style={{
                  color: "var(--mp-teal)",
                  fontWeight: 500,
                }}
              >
                {product.alreadyPlannedInActive} planned
              </span>
            )}
            {inDraft && (
              <span
                className="text-[10.5px]"
                style={{
                  color: "var(--mp-text-primary)",
                  background: "var(--mp-draft-border)",
                  padding: "1px 6px",
                  borderRadius: 2,
                  fontWeight: 500,
                }}
              >
                editing
              </span>
            )}
            {!inDraft && product.draftCount > 0 && (
              <span
                className="text-[10.5px]"
                style={{
                  color: "var(--mp-teal, #1c5651)",
                  background: "rgba(28,86,81,0.10)",
                  padding: "1px 6px",
                  borderRadius: 2,
                  fontWeight: 500,
                }}
              >
                in draft{product.draftCount > 1 ? ` × ${product.draftCount}` : ""}
              </span>
            )}
            {product.inDraftQty > 0 && product.totalDemand > 0 && (
              <span
                className="text-[10.5px] tabular-nums"
                style={{
                  color: "var(--mp-text-muted)",
                  fontWeight: 500,
                }}
              >
                {product.totalDemand} of {product.totalDemand + product.inDraftQty} left
              </span>
            )}
          </span>
        </span>
      </button>

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
    </div>
  );
}
