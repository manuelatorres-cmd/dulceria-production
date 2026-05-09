"use client";

import type { ReactNode } from "react";

export function CategoryGroup({
  label,
  productCount,
  meta,
  children,
}: {
  label: string;
  productCount: number;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <div style={{ borderBottom: "0.5px solid var(--mp-border-warm)" }}>
      <div
        className="px-5 py-2.5 flex items-center justify-between"
        style={{
          background: "var(--mp-page-bg)",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--mp-text-muted)",
          fontWeight: 600,
        }}
      >
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: 999,
              background: "var(--mp-caramel)",
            }}
          />
          {label}
          <span
            style={{
              textTransform: "none",
              letterSpacing: 0,
              fontWeight: 400,
              fontStyle: "italic",
              color: "var(--mp-text-muted)",
            }}
          >
            · {productCount}
          </span>
        </span>
        {meta ? (
          <span
            style={{
              textTransform: "none",
              letterSpacing: 0,
              fontWeight: 400,
              fontStyle: "italic",
            }}
          >
            {meta}
          </span>
        ) : null}
      </div>
      <div>{children}</div>
    </div>
  );
}
