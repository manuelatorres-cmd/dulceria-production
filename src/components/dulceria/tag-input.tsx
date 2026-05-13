"use client";

import { useId, useMemo, useRef, useState } from "react";
import { IconX } from "@tabler/icons-react";

export interface DsTagInputProps {
  label?: string;
  values: string[];
  onChange: (next: string[]) => void;
  /** Optional autocomplete suggestions. */
  suggestions?: string[];
  placeholder?: string;
  disabled?: boolean;
  /** If true, deduplication is case-insensitive. Default true. */
  caseInsensitiveDedup?: boolean;
}

/**
 * Multi-tag input. Tags render as small × pills. Type + Enter or comma
 * to add. Backspace on empty input removes last tag. Optional
 * autocomplete dropdown from suggestions.
 */
export function DsTagInput({
  label,
  values,
  onChange,
  suggestions,
  placeholder = "Add…",
  disabled,
  caseInsensitiveDedup = true,
}: DsTagInputProps) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const lowerValues = useMemo(
    () => (caseInsensitiveDedup ? new Set(values.map((v) => v.toLowerCase())) : new Set(values)),
    [values, caseInsensitiveDedup],
  );

  const filteredSuggestions = useMemo(() => {
    if (!suggestions) return [];
    const q = draft.trim().toLowerCase();
    return suggestions
      .filter((s) => {
        const key = caseInsensitiveDedup ? s.toLowerCase() : s;
        if (lowerValues.has(caseInsensitiveDedup ? key : s)) return false;
        if (!q) return true;
        return s.toLowerCase().includes(q);
      })
      .slice(0, 8);
  }, [suggestions, draft, lowerValues, caseInsensitiveDedup]);

  function commit(raw: string) {
    const v = raw.trim();
    if (!v) return;
    const key = caseInsensitiveDedup ? v.toLowerCase() : v;
    if (lowerValues.has(key)) {
      setDraft("");
      return;
    }
    onChange([...values, v]);
    setDraft("");
  }

  function remove(idx: number) {
    const next = [...values];
    next.splice(idx, 1);
    onChange(next);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {label && <label htmlFor={inputId} className="text-ds-label">{label}</label>}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 4,
          padding: "4px 6px",
          border: "0.5px solid var(--ds-border-warm)",
          borderRadius: 6,
          background: "var(--ds-card-bg)",
          minHeight: 32,
          position: "relative",
        }}
        onClick={() => inputRef.current?.focus()}
      >
        {values.map((v, i) => (
          <span
            key={`${v}-${i}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              padding: "2px 4px 2px 8px",
              fontSize: 11,
              background: "var(--ds-tint-info)",
              color: "var(--ds-tier-quarter-focus)",
              borderRadius: 12,
              fontWeight: 500,
            }}
          >
            {v}
            {!disabled && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(i);
                }}
                aria-label={`Remove ${v}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 14,
                  height: 14,
                  background: "transparent",
                  border: "none",
                  color: "var(--ds-tier-quarter-focus)",
                  cursor: "pointer",
                  padding: 0,
                  opacity: 0.7,
                }}
              >
                <IconX size={10} stroke={2} />
              </button>
            )}
          </span>
        ))}
        <input
          ref={inputRef}
          id={inputId}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit(draft);
            } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
              remove(values.length - 1);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={values.length === 0 ? placeholder : ""}
          disabled={disabled}
          style={{
            flex: 1,
            minWidth: 80,
            border: "none",
            outline: "none",
            background: "transparent",
            fontSize: 12,
            color: "var(--ds-text-primary)",
            padding: "2px 4px",
          }}
        />
        {open && filteredSuggestions.length > 0 && (
          <ul
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              right: 0,
              background: "var(--ds-card-bg)",
              border: "0.5px solid var(--ds-border-warm)",
              borderRadius: 6,
              boxShadow: "0 4px 12px rgba(20, 18, 12, 0.06)",
              listStyle: "none",
              margin: 0,
              padding: 4,
              zIndex: 10,
              maxHeight: 180,
              overflowY: "auto",
            }}
          >
            {filteredSuggestions.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(s);
                    setOpen(false);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "4px 8px",
                    background: "transparent",
                    border: "none",
                    fontSize: 12,
                    color: "var(--ds-text-primary)",
                    borderRadius: 3,
                    cursor: "pointer",
                  }}
                  className="hover:bg-[color:var(--ds-card-bg-hover)]"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
