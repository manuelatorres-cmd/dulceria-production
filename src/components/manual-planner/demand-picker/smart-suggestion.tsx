"use client";

import { ArrowRight } from "lucide-react";
import type { SmartSuggestion } from "@/lib/manual-planner/smart-suggestions";

export function SmartSuggestionRow({
  suggestion,
  onAccept,
}: {
  suggestion: SmartSuggestion;
  onAccept: (s: SmartSuggestion) => void;
}) {
  const recommended = suggestion.recommended;
  return (
    <button
      type="button"
      onClick={() => onAccept(suggestion)}
      className="w-full text-left flex items-start gap-2 px-4 py-2.5"
      style={{
        background: recommended ? "var(--mp-draft-tint)" : "var(--mp-card-bg)",
        borderLeft: `3px solid ${recommended ? "var(--mp-draft-border)" : "var(--mp-border-warm)"}`,
        borderTop: "0.5px solid var(--mp-border-warm)",
      }}
    >
      <ArrowRight className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "var(--mp-teal)" }} />
      <span className="flex-1 min-w-0">
        <span
          className="block text-[13px]"
          style={{ color: "var(--mp-text-primary)", fontWeight: 500 }}
        >
          {suggestion.label}
          {recommended && (
            <span
              className="ml-2 text-[9.5px] uppercase"
              style={{
                color: "var(--mp-text-primary)",
                background: "var(--mp-caramel)",
                padding: "1px 5px",
                borderRadius: 2,
                letterSpacing: "0.08em",
                fontWeight: 600,
              }}
            >
              recommended
            </span>
          )}
        </span>
        <span
          className="block text-[11.5px] mt-0.5"
          style={{ color: "var(--mp-text-muted)" }}
        >
          {suggestion.detail}
        </span>
      </span>
    </button>
  );
}
