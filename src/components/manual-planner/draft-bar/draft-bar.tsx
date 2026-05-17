"use client";

import { useDraggable } from "@dnd-kit/core";
import {
  IconGripVertical as GripVertical,
  IconDeviceFloppy as Save,
  IconX as X,
  IconTrash as Trash2,
} from "@tabler/icons-react";
import type { DraftBatch } from "@/lib/manual-planner/draft-state";
import { DraftItemChip } from "./draft-item-chip";
import { formatMinutes } from "@/lib/manual-planner/compute-batch-time";

export function DraftBar({
  draft,
  totalActiveMinutes,
  onRemoveAllocation,
  onCancel,
  onSave,
  onPark,
  onName,
  saving,
  pinnedDateLabel,
}: {
  draft: DraftBatch | null;
  totalActiveMinutes: number;
  onRemoveAllocation: (parentId: string, source: "order" | "po") => void;
  onCancel: () => void;
  onSave: () => void;
  /** Park as draft — saves with status='draft', no pin required. */
  onPark: () => void;
  onName: (name: string) => void;
  saving: boolean;
  pinnedDateLabel: string | null;
}) {
  // Empty state
  if (!draft) {
    return (
      <div
        className="px-4 py-4 text-center"
        style={{
          background: "var(--mp-card-bg)",
          border: "0.5px dashed var(--mp-border-warm)",
          borderRadius: 8,
        }}
      >
        <p
          className="text-[13px] italic"
          style={{ color: "var(--mp-text-muted)" }}
        >
          Draft batch is empty. Click an order or PO on the left to start.
        </p>
      </div>
    );
  }

  return <ActiveDraftBar
    draft={draft}
    totalActiveMinutes={totalActiveMinutes}
    onRemoveAllocation={onRemoveAllocation}
    onCancel={onCancel}
    onSave={onSave}
    onPark={onPark}
    onName={onName}
    saving={saving}
    pinnedDateLabel={pinnedDateLabel}
  />;
}

function ActiveDraftBar({
  draft,
  totalActiveMinutes,
  onRemoveAllocation,
  onCancel,
  onSave,
  onPark,
  onName,
  saving,
  pinnedDateLabel,
}: {
  draft: DraftBatch;
  totalActiveMinutes: number;
  onRemoveAllocation: (parentId: string, source: "order" | "po") => void;
  onCancel: () => void;
  onSave: () => void;
  onPark: () => void;
  onName: (name: string) => void;
  saving: boolean;
  pinnedDateLabel: string | null;
}) {
  // The bar itself is the drag source — drag onto a day cell to set pinnedDate.
  const draggable = useDraggable({ id: "manual-draft-batch" });

  const summary = [
    `1 product`,
    `${draft.totalPieces} pcs`,
    `${draft.mouldCount} fill${draft.mouldCount === 1 ? "" : "s"}`,
    `~${formatMinutes(totalActiveMinutes)} active`,
  ].join(" · ");

  return (
    <div
      ref={draggable.setNodeRef}
      className="select-none"
      style={{
        background: "var(--mp-draft-tint)",
        border: `1px solid var(--mp-draft-border)`,
        borderRadius: 8,
        opacity: draggable.isDragging ? 0.4 : 1,
      }}
    >
      <div className="px-4 py-3 flex items-start gap-2">
        <span
          {...draggable.attributes}
          {...draggable.listeners}
          aria-label="drag draft batch onto a day"
          className="cursor-grab pt-1"
          style={{ color: "var(--mp-text-muted)" }}
          title="Drag to a day below"
        >
          <GripVertical className="w-4 h-4" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <input
              value={draft.name}
              onChange={(e) => onName(e.target.value)}
              className="text-[16px] bg-transparent border-none outline-none flex-1 min-w-0"
              style={{
                fontFamily: "var(--font-serif)",
                fontWeight: 600,
                color: "var(--mp-text-primary)",
              }}
              aria-label="batch name"
            />
            <button
              type="button"
              onClick={onCancel}
              className="text-[11px] inline-flex items-center gap-1"
              style={{ color: "var(--mp-text-muted)" }}
              title="Cancel draft"
            >
              <Trash2 className="w-3 h-3" />
              Cancel draft
            </button>
          </div>
          <p
            className="text-[12px] mt-0.5"
            style={{ color: "var(--mp-text-muted)" }}
          >
            {summary}
          </p>
        </div>
      </div>

      <div
        className="px-4 py-2 flex flex-wrap gap-1.5"
        style={{ borderTop: "0.5px solid var(--mp-border-warm)" }}
      >
        {draft.allocations.length === 0 ? (
          <p className="text-[12px] italic" style={{ color: "var(--mp-text-muted)" }}>
            No allocations yet.
          </p>
        ) : (
          draft.allocations.map((a) => (
            <DraftItemChip
              key={`${a.source}:${a.parentId}`}
              allocation={a}
              onRemove={() => onRemoveAllocation(a.parentId, a.source)}
            />
          ))
        )}
      </div>

      <div
        className="px-4 py-2.5 flex items-center justify-between gap-2"
        style={{ borderTop: "0.5px solid var(--mp-border-warm)" }}
      >
        <span className="text-[12px]" style={{ color: "var(--mp-text-muted)" }}>
          {pinnedDateLabel ? (
            <>
              Pinned to{" "}
              <strong style={{ color: "var(--mp-teal)", fontWeight: 500 }}>
                {pinnedDateLabel}
              </strong>
            </>
          ) : (
            <>⏵ Drop on a day below to set production date.</>
          )}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={onPark}
            disabled={draft.allocations.length === 0 || saving}
            className="px-3 py-1.5 inline-flex items-center gap-1 text-[12px]"
            style={{
              background: "transparent",
              color: draft.allocations.length === 0 || saving
                ? "var(--mp-text-muted)"
                : "var(--mp-text-primary)",
              border: "0.5px solid var(--mp-border-warm)",
              borderRadius: 4,
              cursor:
                draft.allocations.length === 0 || saving ? "not-allowed" : "pointer",
              opacity: draft.allocations.length === 0 || saving ? 0.6 : 1,
            }}
            title="Save as draft — pin a day later"
          >
            Park as draft
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!draft.pinnedDate || draft.allocations.length === 0 || saving}
            className="px-3 py-1.5 inline-flex items-center gap-1 text-[12px]"
            style={{
              background:
                !draft.pinnedDate || draft.allocations.length === 0 || saving
                  ? "var(--mp-border-warm)"
                  : "var(--mp-teal)",
              color:
                !draft.pinnedDate || draft.allocations.length === 0 || saving
                  ? "var(--mp-text-muted)"
                  : "#ffffff",
              border: "0.5px solid var(--mp-teal)",
              borderRadius: 4,
              opacity: !draft.pinnedDate || draft.allocations.length === 0 || saving ? 0.7 : 1,
              cursor:
                !draft.pinnedDate || draft.allocations.length === 0 || saving
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            <Save className="w-3.5 h-3.5" />
            {saving
              ? "Saving…"
              : pinnedDateLabel
              ? `Save & pin to ${pinnedDateLabel}`
              : "Save & pin"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Re-export X icon to satisfy lint about unused import scoping in some bundlers.
export { X };
