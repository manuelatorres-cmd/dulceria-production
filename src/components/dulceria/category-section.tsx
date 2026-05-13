"use client";

import type { ReactNode } from "react";

/**
 * Section wrapper for pantry pages — serif title left, count right,
 * children below. No card background. Use inside .ds page scope.
 */
export function CategorySection({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          paddingBottom: 4,
          borderBottom: "0.5px solid var(--ds-border-warm)",
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 18,
            fontWeight: 500,
            color: "var(--ds-text-primary)",
            letterSpacing: "-0.005em",
          }}
        >
          {title}
        </h2>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          {count && (
            <span
              style={{
                fontSize: 11,
                color: "var(--ds-text-muted)",
                fontStyle: "italic",
              }}
            >
              {count}
            </span>
          )}
          {action}
        </div>
      </header>
      {children}
    </section>
  );
}

export function AddCard({
  label,
  onClick,
  href,
  disabled,
  aspect = "card",
}: {
  label: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  /** "card" = product/filling aspect, "row" = single-row */
  aspect?: "card" | "row" | "swatch" | "mould";
}) {
  const padding =
    aspect === "row" ? "12px 16px" :
    aspect === "swatch" ? "0" :
    aspect === "mould" ? "0" :
    "14px 12px";

  const minHeight =
    aspect === "row" ? "auto" :
    aspect === "swatch" ? 120 :
    aspect === "mould" ? 140 :
    120;

  const content = (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        minHeight,
        padding,
        color: "var(--ds-text-muted)",
        fontStyle: "italic",
        fontSize: aspect === "row" ? 12 : 11,
        textAlign: "center",
      }}
    >
      + {label}
    </span>
  );

  const sharedStyle: React.CSSProperties = {
    display: "block",
    background: "transparent",
    border: "1px dashed var(--ds-border-warm)",
    borderRadius: 6,
    cursor: disabled ? "wait" : "pointer",
    opacity: disabled ? 0.5 : 1,
    textDecoration: "none",
  };

  if (href && !disabled) {
    return (
      <a href={href} style={sharedStyle} className="hover:bg-[color:var(--ds-card-bg-hover)]">
        {content}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{ ...sharedStyle, width: "100%", textAlign: "center" }}
      className="hover:bg-[color:var(--ds-card-bg-hover)]"
    >
      {content}
    </button>
  );
}
