"use client";

import { Lock, Hourglass } from "lucide-react";
import { formatMinutes } from "@/lib/manual-planner/compute-batch-time";
import type { ProductionStep } from "@/types";

export function StepBlock({
  step,
  productName,
  isLocked,
  isDraftPreview,
  pieces,
}: {
  step: ProductionStep | null;
  productName: string;
  isLocked: boolean;
  isDraftPreview: boolean;
  pieces: number | null;
}) {
  const passive =
    !!step && step.activeMinutes <= 0 && step.waitingMinutes > 0;
  const stepName = step?.name ?? "Step";
  const minutes = step ? step.activeMinutes : 0;
  const waitingLabel =
    passive && step && step.waitingMinutes > 0
      ? `${formatMinutes(step.waitingMinutes)} passive`
      : null;

  // Visual variants per spec.
  const baseStyle: React.CSSProperties = {
    padding: "5px 8px",
    borderRadius: 3,
    fontSize: 11,
    lineHeight: 1.35,
  };

  let style: React.CSSProperties = { ...baseStyle };
  if (isDraftPreview) {
    style = {
      ...style,
      borderLeft: `3px solid var(--mp-draft-border)`,
      border: "0.5px dashed var(--mp-draft-border)",
      background: "var(--mp-draft-tint)",
    };
  } else if (passive) {
    style = {
      ...style,
      borderLeft: "3px solid var(--mp-border-warm)",
      border: "0.5px dashed var(--mp-border-warm)",
      background: "var(--mp-card-bg)",
      fontStyle: "italic",
      color: "var(--mp-text-muted)",
    };
  } else if (isLocked) {
    style = {
      ...style,
      borderLeft: "3px solid var(--mp-teal)",
      background: "var(--mp-page-bg)",
    };
  } else {
    style = {
      ...style,
      borderLeft: "3px solid var(--mp-blush)",
      background: "var(--mp-page-bg)",
    };
  }

  return (
    <div style={style}>
      <div className="flex items-baseline gap-1">
        {isLocked && !passive && !isDraftPreview && (
          <Lock className="w-3 h-3 shrink-0" style={{ color: "var(--mp-teal)" }} />
        )}
        {passive && (
          <Hourglass className="w-3 h-3 shrink-0" style={{ color: "var(--mp-text-muted)" }} />
        )}
        <span className="truncate" style={{ fontWeight: 500 }}>
          {stepName}
          {productName ? (
            <span style={{ color: "var(--mp-text-muted)", fontWeight: 400 }}>
              {" "}
              · {productName}
            </span>
          ) : null}
        </span>
      </div>
      <div className="text-[10px] tabular-nums" style={{ color: "var(--mp-text-muted)" }}>
        {pieces != null && pieces > 0 ? `${pieces} pcs · ` : ""}
        {minutes > 0 ? formatMinutes(minutes) : waitingLabel ?? "—"}
      </div>
    </div>
  );
}
