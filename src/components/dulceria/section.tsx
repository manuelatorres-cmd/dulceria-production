"use client";

import type { ReactNode } from "react";

export function Section({
  title,
  action,
  children,
  noBody,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  /** Strip default body padding (lists handle their own padding). */
  noBody?: boolean;
}) {
  return (
    <section
      style={{
        background: "var(--ds-card-bg)",
        border: "0.5px solid var(--ds-border-warm)",
        borderRadius: 8,
        overflow: "hidden",
        color: "var(--ds-text-primary)",
      }}
    >
      <header
        style={{
          padding: "14px 20px 10px",
          borderBottom: "0.5px solid var(--ds-border-warm)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
        }}
      >
        <h2 className="text-ds-card-title">{title}</h2>
        {action && <span className="text-ds-meta shrink-0">{action}</span>}
      </header>
      <div style={{ padding: noBody ? 0 : "12px 0" }}>{children}</div>
    </section>
  );
}
