"use client";

import type { OrderDemandLine } from "@/lib/manual-planner/aggregate-demand";
import { IconPlus as Plus } from "@tabler/icons-react";

export function OrderLine({
  line,
  productId,
  inDraft,
  onPick,
}: {
  line: OrderDemandLine;
  productId: string;
  inDraft: boolean;
  onPick: (args: { orderItemId: string; productId: string; qty: number; customerName: string }) => void;
}) {
  const dueLabel = line.dueDate
    ? line.dueDate.toLocaleDateString("de-AT", { day: "numeric", month: "short" })
    : "—";
  const urgencyColor =
    line.urgency === "overdue" || line.urgency === "urgent"
      ? "var(--mp-rose)"
      : line.urgency === "soon"
      ? "var(--mp-caramel)"
      : "var(--mp-text-muted)";

  return (
    <button
      type="button"
      onClick={() =>
        onPick({
          orderItemId: line.orderItemId,
          productId,
          qty: line.remaining,
          customerName: line.customerName,
        })
      }
      className="w-full text-left flex items-baseline gap-2 px-3 py-1.5 hover:bg-[color:var(--mp-hover-bg)]"
      style={{
        borderTop: "0.5px solid var(--mp-border-warm)",
        background: inDraft ? "var(--mp-draft-tint)" : "transparent",
      }}
    >
      <span className="flex-1 min-w-0">
        <span
          className="block text-[12.5px] truncate"
          style={{ color: "var(--mp-text-primary)" }}
        >
          {line.customerName}
          {line.sourceRef && (
            <span
              style={{ color: "var(--mp-text-muted)", fontSize: 11, marginLeft: 6 }}
            >
              {line.sourceRef}
            </span>
          )}
        </span>
        <span
          className="block text-[11px]"
          style={{ color: urgencyColor }}
        >
          {line.channel} · due {dueLabel}
          {line.urgency === "overdue" && " · overdue"}
          {line.urgency === "urgent" && line.dueDate && " · soon"}
        </span>
      </span>
      <span
        className="tabular-nums text-[12px] font-medium shrink-0"
        style={{ color: "var(--mp-text-primary)" }}
      >
        {line.remaining} pcs
      </span>
      <Plus className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--mp-teal)" }} />
    </button>
  );
}
