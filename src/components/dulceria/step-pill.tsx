"use client";

export type StepPillStatus = "done" | "in_progress" | "pending";

/**
 * Horizontal pipeline step pill (dashboard) — chained with chevrons.
 *
 * done       = mint tint + mint border
 * in_progress = caramel tint + caramel border
 * pending    = white + default border
 */
export function StepPill({
  name,
  progress,
  meta,
  status,
  onClick,
  isLast,
}: {
  name: string;
  progress: string;
  meta: string;
  status: StepPillStatus;
  onClick?: () => void;
  /** Set on the last pill in the row — drops the trailing chevron. */
  isLast?: boolean;
}) {
  const bg =
    status === "done"
      ? "var(--ds-tint-ok)"
      : status === "in_progress"
      ? "var(--ds-tint-warn)"
      : "var(--ds-card-bg)";
  const border =
    status === "done"
      ? "var(--ds-tier-positive)"
      : status === "in_progress"
      ? "var(--ds-semantic-warn)"
      : "var(--ds-border-warm)";
  return (
    <div
      onClick={onClick}
      style={{
        background: bg,
        border: `0.5px solid ${border}`,
        borderRadius: 4,
        padding: "8px 10px",
        textAlign: "center",
        position: "relative",
        cursor: onClick ? "pointer" : "default",
        flex: 1,
        minWidth: 0,
      }}
    >
      {!isLast && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            right: -7,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--ds-border-warm)",
            fontSize: 14,
            lineHeight: 1,
          }}
        >
          ›
        </span>
      )}
      <div
        style={{
          fontSize: 11,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.03em",
          color: "var(--ds-text-primary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {name}
      </div>
      <div
        style={{
          fontSize: 18,
          fontFamily: "var(--font-serif)",
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          marginTop: 4,
          color: "var(--ds-text-primary)",
        }}
      >
        {progress}
      </div>
      <div
        style={{
          fontSize: 10,
          color: "var(--ds-text-muted)",
          fontStyle: "italic",
          marginTop: 2,
        }}
      >
        {meta}
      </div>
    </div>
  );
}
