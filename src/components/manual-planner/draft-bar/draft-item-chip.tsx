"use client";

import { X } from "lucide-react";
import type { DraftAllocation } from "@/lib/manual-planner/draft-state";

export function DraftItemChip({
  allocation,
  onRemove,
}: {
  allocation: DraftAllocation;
  onRemove: () => void;
}) {
  const dueLabel = allocation.dueDate
    ? new Date(allocation.dueDate).toLocaleDateString("de-AT", {
        day: "numeric",
        month: "short",
      })
    : null;
  const sourceTag = allocation.source === "po" ? "PO" : "ORD";
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 text-[12px]"
      style={{
        background: "var(--mp-card-bg)",
        border: "0.5px solid var(--mp-border-warm)",
        borderRadius: 14,
        color: "var(--mp-text-primary)",
      }}
    >
      <span
        aria-hidden
        style={{
          fontSize: 9,
          letterSpacing: "0.08em",
          fontWeight: 600,
          color: "var(--mp-text-muted)",
        }}
      >
        {sourceTag}
      </span>
      <span style={{ fontWeight: 500 }}>{allocation.label}</span>
      <span className="tabular-nums" style={{ color: "var(--mp-text-muted)" }}>
        · {allocation.qty} pcs
      </span>
      {dueLabel && (
        <span style={{ color: "var(--mp-text-muted)", fontSize: 10 }}>· due {dueLabel}</span>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5"
        aria-label="remove allocation"
        style={{ color: "var(--mp-text-muted)" }}
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}
