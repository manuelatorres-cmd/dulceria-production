"use client";

import type { ReactNode } from "react";

/**
 * Production-app design-system page header.
 *
 * Pattern: title + meta on the left, status badges + actions on the right.
 * Border-bottom 0.5px. Padding 16px 32px. Page header must stay ≤ 100px
 * tall per spec phase 4 density target.
 */
export function PageHeader({
  title,
  meta,
  badges,
  actions,
}: {
  title: ReactNode;
  meta?: ReactNode;
  /** Right-aligned status/info badges. */
  badges?: ReactNode;
  /** Buttons / links to the far right. */
  actions?: ReactNode;
}) {
  return (
    <header
      style={{
        padding: "16px 32px",
        borderBottom: "0.5px solid var(--ds-border-warm)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 16,
        background: "var(--ds-page-bg)",
        flexWrap: "wrap",
      }}
    >
      <div>
        <h1 className="text-ds-page-title">{title}</h1>
        {meta && <p className="text-ds-meta" style={{ marginTop: 2 }}>{meta}</p>}
      </div>
      {(badges || actions) && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {badges}
          {actions}
        </div>
      )}
    </header>
  );
}
