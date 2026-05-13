"use client";

import { IconCheck, IconX, IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import type { ReactNode } from "react";

export type ToastKind = "success" | "error" | "warn" | "info";

export interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
  description?: string;
}

const ACCENT: Record<ToastKind, string> = {
  success: "var(--ds-tier-positive)",
  error: "var(--ds-tier-urgent)",
  warn: "var(--ds-semantic-warn)",
  info: "var(--ds-semantic-info)",
};

const ICON: Record<ToastKind, ReactNode> = {
  success: <IconCheck size={14} stroke={1.75} />,
  error: <IconAlertTriangle size={14} stroke={1.75} />,
  warn: <IconAlertTriangle size={14} stroke={1.75} />,
  info: <IconInfoCircle size={14} stroke={1.75} />,
};

export function Toast({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      style={{
        background: "var(--ds-card-bg)",
        border: "0.5px solid var(--ds-border-warm)",
        borderLeft: `3px solid ${ACCENT[item.kind]}`,
        borderRadius: 6,
        padding: "12px 16px",
        minWidth: 280,
        maxWidth: 400,
        fontSize: 13,
        boxShadow: "0 4px 16px rgba(20, 18, 12, 0.06)",
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
      }}
    >
      <span style={{ color: ACCENT[item.kind], marginTop: 1 }}>{ICON[item.kind]}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            color: "var(--ds-text-primary)",
            fontWeight: 500,
            margin: 0,
          }}
        >
          {item.message}
        </p>
        {item.description && (
          <p
            style={{
              fontSize: 11,
              color: "var(--ds-text-muted)",
              margin: "4px 0 0",
              lineHeight: 1.4,
            }}
          >
            {item.description}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{
          background: "transparent",
          border: "none",
          color: "var(--ds-text-muted)",
          cursor: "pointer",
          padding: 0,
          marginTop: 1,
        }}
      >
        <IconX size={14} stroke={1.5} />
      </button>
    </div>
  );
}
