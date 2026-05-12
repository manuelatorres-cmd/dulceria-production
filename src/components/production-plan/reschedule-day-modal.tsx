"use client";

import { useState } from "react";
import { IconX as X } from "@tabler/icons-react";
import { DsButton } from "@/components/dulceria";

export function RescheduleDayModal({
  sourceDate,
  defaultTarget,
  onCancel,
  onConfirm,
}: {
  sourceDate: string;
  defaultTarget: string;
  onCancel: () => void;
  onConfirm: (targetDate: string, pin: boolean) => void;
}) {
  const [target, setTarget] = useState<string>(defaultTarget);
  const [pin, setPin] = useState<boolean>(true);
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.35)" }}
    >
      <div
        className="weekly-plan-v2 w-full max-w-sm"
        style={{
          background: "var(--wp-card-bg)",
          border: "0.5px solid var(--wp-border-warm)",
          borderRadius: 8,
          color: "var(--wp-text-primary)",
        }}
      >
        <div
          className="px-5 pt-4 pb-3 flex items-start justify-between"
          style={{ borderBottom: "0.5px solid var(--wp-border-warm)" }}
        >
          <div>
            <h2
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: 18,
                fontWeight: 600,
                marginBottom: 2,
              }}
            >
              Reschedule {sourceDate}
            </h2>
            <p className="text-[12px] italic" style={{ color: "var(--wp-text-muted)" }}>
              Moves every batch on this day to the chosen target. No capacity check —
              you confirm what fits.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="close"
            style={{ color: "var(--wp-text-muted)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <label className="block text-[12px]">
            <span className="block mb-1" style={{ color: "var(--wp-text-muted)" }}>
              Target date
            </span>
            <input
              type="date"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="w-full px-2 py-1.5"
              style={{
                border: "0.5px solid var(--wp-border-warm)",
                background: "var(--wp-card-bg)",
                color: "var(--wp-text-primary)",
                borderRadius: 4,
              }}
            />
          </label>
          <label className="flex items-center gap-2 text-[12px]">
            <input
              type="checkbox"
              checked={pin}
              onChange={(e) => setPin(e.target.checked)}
            />
            <span>Pin moved batches so the auto-planner respects the new day.</span>
          </label>
        </div>

        <div
          className="px-5 py-3 flex items-center justify-end gap-2"
          style={{ borderTop: "0.5px solid var(--wp-border-warm)" }}
        >
          <DsButton size="md" onClick={onCancel}>
            Cancel
          </DsButton>
          <DsButton
            variant="primary"
            size="md"
            onClick={() => onConfirm(target, pin)}
            disabled={!target || target === sourceDate}
          >
            Move all batches
          </DsButton>
        </div>
      </div>
    </div>
  );
}
