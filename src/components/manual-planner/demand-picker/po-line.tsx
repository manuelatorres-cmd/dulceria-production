"use client";

import type { PoDemandLine } from "@/lib/manual-planner/aggregate-demand";
import { Plus } from "lucide-react";

export function PoLine({
  line,
  productId,
  inDraft,
  onPick,
}: {
  line: PoDemandLine;
  productId: string;
  inDraft: boolean;
  onPick: (args: { poItemId: string; productId: string; qty: number; poName: string }) => void;
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
          poItemId: line.poItemId,
          productId,
          qty: line.remaining,
          poName: line.poName,
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
          PO · {line.poName}
        </span>
        <span className="block text-[11px]" style={{ color: urgencyColor }}>
          {line.channel} · due {dueLabel}
          {line.urgency === "overdue" && " · overdue"}
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
