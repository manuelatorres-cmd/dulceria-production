"use client";

import { useEffect, type ReactNode } from "react";
import { IconX } from "@tabler/icons-react";

/**
 * Production-app design-system right-side drawer. Used for secondary flows
 * (duplicate, assign filling, swap product) that need form input but should
 * not stack as a nested modal. Esc + backdrop click close. Page is scroll-
 * locked while open.
 */
export function DsDrawer({
  open,
  title,
  width = 420,
  onClose,
  children,
}: {
  open: boolean;
  title: ReactNode;
  width?: number;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20, 14, 8, 0.35)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 55,
      }}
    >
      <aside
        style={{
          background: "var(--ds-page-bg)",
          width: "100%",
          maxWidth: width,
          height: "100%",
          borderLeft: "0.5px solid var(--ds-border-warm)",
          boxShadow: "-12px 0 32px rgba(20, 14, 8, 0.12)",
          display: "flex",
          flexDirection: "column",
          color: "var(--ds-text-primary)",
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
          <h2 className="serif" style={{ fontSize: 16, fontWeight: 600 }}>{title}</h2>
          <button
            type="button"
            aria-label="Close drawer"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              padding: 4,
              borderRadius: 999,
              cursor: "pointer",
              color: "var(--ds-text-muted)",
            }}
            className="hover:bg-[color:var(--ds-card-bg-hover)]"
          >
            <IconX size={16} />
          </button>
        </header>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          {children}
        </div>
      </aside>
    </div>
  );
}
