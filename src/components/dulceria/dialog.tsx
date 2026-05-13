"use client";

import { useEffect, type ReactNode } from "react";
import { DsButton } from "./button";

export type DsDialogTone = "default" | "destructive";

/**
 * Production-app design-system confirmation dialog. Used for destructive /
 * irreversible actions (delete, photo remove). Single primary action + cancel.
 * Esc + backdrop click close. Modal — blocks the page.
 */
export function DsDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DsDialogTone;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20, 14, 8, 0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 60,
      }}
    >
      <div
        style={{
          background: "var(--ds-card-bg)",
          border: "0.5px solid var(--ds-border-warm)",
          borderRadius: 8,
          padding: 20,
          maxWidth: 420,
          width: "100%",
          color: "var(--ds-text-primary)",
          boxShadow: "0 12px 32px rgba(20, 14, 8, 0.18)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h2
          className="serif"
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: tone === "destructive" ? "var(--ds-tier-urgent)" : "var(--ds-text-primary)",
          }}
        >
          {title}
        </h2>
        {description && (
          <div style={{ fontSize: 13, color: "var(--ds-text-muted)", lineHeight: 1.45 }}>
            {description}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <DsButton onClick={onCancel} disabled={busy}>{cancelLabel}</DsButton>
          <DsButton
            variant="primary"
            onClick={onConfirm}
            disabled={busy}
            style={tone === "destructive" ? {
              background: "var(--ds-tier-urgent)",
              borderColor: "var(--ds-tier-urgent)",
            } : undefined}
          >
            {busy ? "…" : confirmLabel}
          </DsButton>
        </div>
      </div>
    </div>
  );
}
