"use client";

import { IconAlertTriangle, IconAlertCircle } from "@tabler/icons-react";
import type { ReactNode } from "react";

export interface FormErrorProps {
  variant?: "error" | "warn";
  children: ReactNode;
}

/**
 * Inline form-field error / warning. Render directly below the input
 * it relates to. Use `variant="warn"` for soft validation (will save
 * but flagged); default `error` blocks save.
 */
export function FormError({ variant = "error", children }: FormErrorProps) {
  const color =
    variant === "warn" ? "var(--ds-semantic-warn)" : "var(--ds-tier-urgent)";
  const Icon = variant === "warn" ? IconAlertTriangle : IconAlertCircle;
  return (
    <p
      role="alert"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontStyle: "italic",
        color,
        marginTop: 4,
      }}
    >
      <Icon size={11} stroke={1.75} />
      {children}
    </p>
  );
}
