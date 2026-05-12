"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type DsButtonVariant = "default" | "primary";
export type DsButtonSize = "sm" | "md" | "lg";

const SIZES: Record<DsButtonSize, { padding: string; fontSize: number }> = {
  sm: { padding: "4px 10px", fontSize: 12 },
  md: { padding: "6px 14px", fontSize: 13 },
  lg: { padding: "8px 18px", fontSize: 14 },
};

/**
 * Production-app design-system button. Use this on `.ds`-opted pages
 * for new buttons; legacy pages keep their existing buttons until
 * Phase 3 audits them per page.
 */
export function DsButton({
  variant = "default",
  size = "md",
  children,
  style,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: DsButtonVariant;
  size?: DsButtonSize;
  children: ReactNode;
}) {
  const s = SIZES[size];
  const primary = variant === "primary";
  return (
    <button
      {...rest}
      style={{
        padding: s.padding,
        fontSize: s.fontSize,
        border: `0.5px solid ${primary ? "var(--ds-tier-quarter-focus)" : "var(--ds-border-warm)"}`,
        borderRadius: 4,
        background: primary ? "var(--ds-tier-quarter-focus)" : "var(--ds-card-bg)",
        color: primary ? "var(--ds-text-inverse)" : "var(--ds-text-primary)",
        cursor: rest.disabled ? "not-allowed" : "pointer",
        opacity: rest.disabled ? 0.55 : 1,
        transition: "background 0.1s ease",
        ...style,
      }}
      className={
        (primary
          ? "hover:opacity-90 "
          : "hover:bg-[color:var(--ds-card-bg-hover)] ") + (rest.className ?? "")
      }
    >
      {children}
    </button>
  );
}
