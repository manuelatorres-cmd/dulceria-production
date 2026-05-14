"use client";

import { useEffect, type ReactNode } from "react";
import { IconX } from "@tabler/icons-react";

/**
 * Generic centered modal shell — fixed-position dim backdrop + centered
 * card with header / body / optional footer slots. Unlike `DsDialog`
 * (single-action confirm/cancel) this exposes full body + footer control,
 * for forms / multi-step flows.
 *
 * Use this for legacy workflow modals (packing, yield, leftover, etc.)
 * that don't fit the confirm/cancel shape. Backdrop click + Esc close
 * unless `busy`. Body scrolls when content overflows; the page body is
 * scroll-locked while open.
 */
export function DsModalShell({
  open,
  title,
  subtitle,
  icon,
  width = 480,
  busy = false,
  onClose,
  footer,
  children,
}: {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Optional small icon rendered to the left of the title. */
  icon?: ReactNode;
  /** Max card width in px. */
  width?: number;
  /** Disables backdrop + Esc close when an action is in flight. */
  busy?: boolean;
  onClose: () => void;
  /** Optional action row pinned to the bottom (Cancel + Confirm etc.). */
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, busy, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
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
      className="ds"
    >
      <div
        style={{
          background: "var(--ds-card-bg)",
          border: "0.5px solid var(--ds-border-warm)",
          borderRadius: 8,
          width: "100%",
          maxWidth: width,
          maxHeight: "calc(100vh - 32px)",
          boxShadow: "0 12px 32px rgba(20, 14, 8, 0.18)",
          color: "var(--ds-text-primary)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            padding: "14px 20px",
            borderBottom: "0.5px solid var(--ds-border-warm)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            background: "var(--ds-card-bg)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            {icon && (
              <span style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 28, height: 28,
                border: "0.5px solid var(--ds-border-warm)", borderRadius: 4,
                background: "var(--ds-card-bg-hover, rgba(0,0,0,0.03))",
                color: "var(--ds-tier-quarter-focus)",
                flexShrink: 0,
              }}>{icon}</span>
            )}
            <div style={{ minWidth: 0 }}>
              <h2
                className="serif"
                style={{ fontSize: 16, fontWeight: 600, color: "var(--ds-text-primary)", margin: 0 }}
              >
                {title}
              </h2>
              {subtitle && (
                <p style={{ fontSize: 11, color: "var(--ds-text-muted)", margin: 0 }}>{subtitle}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            disabled={busy}
            style={{
              border: "none",
              background: "transparent",
              padding: 4,
              borderRadius: 999,
              cursor: busy ? "default" : "pointer",
              color: "var(--ds-text-muted)",
              opacity: busy ? 0.4 : 1,
            }}
            className="hover:bg-[color:var(--ds-card-bg-hover)]"
          >
            <IconX size={16} />
          </button>
        </header>

        <div style={{ padding: "16px 20px", flex: 1, overflowY: "auto" }}>
          {children}
        </div>

        {footer && (
          <footer
            style={{
              padding: "12px 20px",
              borderTop: "0.5px solid var(--ds-border-warm)",
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 8,
              background: "var(--ds-card-bg)",
            }}
          >
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
