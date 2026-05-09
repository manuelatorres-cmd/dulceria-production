"use client";

import { useMemo } from "react";
import type { ProductDemand } from "@/lib/manual-planner/aggregate-demand";
import {
  generateSuggestions,
  type SmartSuggestion,
} from "@/lib/manual-planner/smart-suggestions";
import { OrderLine } from "./order-line";
import { PoLine } from "./po-line";
import { SmartSuggestionRow } from "./smart-suggestion";

export function OrdersExpanded({
  product,
  draftOrderItemIds,
  draftPoItemIds,
  onPickOrderLine,
  onPickPoLine,
  onAcceptSuggestion,
}: {
  product: ProductDemand;
  draftOrderItemIds: Set<string>;
  draftPoItemIds: Set<string>;
  onPickOrderLine: (args: { orderItemId: string; productId: string; qty: number; customerName: string }) => void;
  onPickPoLine: (args: { poItemId: string; productId: string; qty: number; poName: string }) => void;
  onAcceptSuggestion: (productId: string, suggestion: SmartSuggestion) => void;
}) {
  const suggestions = useMemo(() => generateSuggestions(product), [product]);
  return (
    <div
      style={{
        background: "var(--mp-card-bg)",
        borderTop: "0.5px solid var(--mp-border-warm)",
      }}
    >
      {product.orderItems.length === 0 && product.poItems.length === 0 && (
        <p
          className="px-4 py-3 text-[12px] italic"
          style={{ color: "var(--mp-text-muted)" }}
        >
          No open orders or POs for this product.
        </p>
      )}

      {suggestions.map((s) => (
        <SmartSuggestionRow
          key={`${s.type}:${s.totalPieces}`}
          suggestion={s}
          onAccept={(sug) => onAcceptSuggestion(product.productId, sug)}
        />
      ))}

      {product.orderItems.length > 0 && (
        <SectionHeader
          label="Orders"
          count={product.orderItems.length}
          total={product.orderDemand}
        />
      )}
      {product.orderItems.map((line) => (
        <OrderLine
          key={line.orderItemId}
          line={line}
          productId={product.productId}
          inDraft={draftOrderItemIds.has(line.orderItemId)}
          onPick={onPickOrderLine}
        />
      ))}

      {product.poItems.length > 0 && (
        <SectionHeader
          label="Production orders"
          count={product.poItems.length}
          total={product.poDemand}
        />
      )}
      {product.poItems.map((line) => (
        <PoLine
          key={line.poItemId}
          line={line}
          productId={product.productId}
          inDraft={draftPoItemIds.has(line.poItemId)}
          onPick={onPickPoLine}
        />
      ))}
    </div>
  );
}

function SectionHeader({
  label,
  count,
  total,
}: {
  label: string;
  count: number;
  total: number;
}) {
  return (
    <div
      className="px-4 py-1.5 flex items-baseline justify-between text-[10px] uppercase"
      style={{
        background: "var(--mp-page-bg)",
        color: "var(--mp-text-muted)",
        letterSpacing: "0.08em",
        fontWeight: 600,
        borderTop: "0.5px solid var(--mp-border-warm)",
      }}
    >
      <span>
        {label} · {count}
      </span>
      <span style={{ textTransform: "none", letterSpacing: 0, fontStyle: "italic" }}>
        {total} pcs
      </span>
    </div>
  );
}
