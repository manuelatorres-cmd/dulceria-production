"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { IconCheck, IconPencil, IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { FormError } from "./form-error";

interface BaseProps {
  label: string;
  placeholder?: string;
  disabled?: boolean;
}

type ValidateResult = true | string;

export interface DsInlineFieldProps extends BaseProps {
  value: string;
  onSave: (next: string) => Promise<unknown> | void;
  type?: "text" | "number" | "email" | "url" | "date";
  validate?: (next: string) => ValidateResult;
  /** Optional unit / suffix rendered next to value, e.g. "g", "%". */
  suffix?: string;
}

/**
 * Inline-editable field. Read mode = label + value text (hover shows
 * pencil affordance). Click value → input. Enter saves, Esc cancels.
 */
export function DsInlineField({
  label,
  value,
  onSave,
  type = "text",
  validate,
  placeholder = "—",
  disabled,
  suffix,
}: DsInlineFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = useCallback(async () => {
    const v = validate?.(draft);
    if (v && v !== true) {
      setError(v);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [draft, onSave, validate]);

  function cancel() {
    setEditing(false);
    setDraft(value);
    setError(null);
  }

  if (editing && !disabled) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label htmlFor={inputId} className="text-ds-label">
          {label}
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            ref={inputRef}
            id={inputId}
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              else if (e.key === "Escape") cancel();
            }}
            placeholder={placeholder}
            disabled={saving}
            style={{
              flex: 1,
              minWidth: 0,
              padding: "4px 8px",
              fontSize: 13,
              border: "0.5px solid var(--ds-tier-quarter-focus)",
              borderRadius: 4,
              background: "var(--ds-card-bg)",
              color: "var(--ds-text-primary)",
              outline: "none",
            }}
          />
          <IconButton onClick={commit} title="Save" variant="primary" disabled={saving}>
            <IconCheck size={12} stroke={1.75} />
          </IconButton>
          <IconButton onClick={cancel} title="Cancel" disabled={saving}>
            <IconX size={12} stroke={1.75} />
          </IconButton>
        </div>
        {error && <FormError>{error}</FormError>}
      </div>
    );
  }

  const display = value && value.trim() !== "" ? value : placeholder;
  const isEmpty = !value || value.trim() === "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="text-ds-label">{label}</span>
      <button
        type="button"
        onClick={() => !disabled && setEditing(true)}
        disabled={disabled}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          margin: "-4px -8px",
          background: "transparent",
          border: "0.5px solid transparent",
          borderRadius: 4,
          fontSize: 13,
          color: isEmpty ? "var(--ds-text-muted)" : "var(--ds-text-primary)",
          fontStyle: isEmpty ? "italic" : "normal",
          cursor: disabled ? "default" : "pointer",
          textAlign: "left",
          width: "fit-content",
        }}
        className="hover:[border-color:var(--ds-border-warm)] [&_.pencil]:hover:opacity-100"
      >
        <span>
          {display}
          {suffix && !isEmpty && (
            <span style={{ color: "var(--ds-text-muted)", marginLeft: 4 }}>{suffix}</span>
          )}
        </span>
        {!disabled && (
          <IconPencil
            className="pencil"
            size={11}
            stroke={1.5}
            style={{ color: "var(--ds-text-muted)", opacity: 0, transition: "opacity 0.1s" }}
          />
        )}
      </button>
    </div>
  );
}

export interface DsInlineTextareaProps extends BaseProps {
  value: string;
  onSave: (next: string) => Promise<unknown> | void;
  rows?: number;
}

export function DsInlineTextarea({
  label,
  value,
  onSave,
  placeholder = "—",
  rows = 3,
  disabled,
}: DsInlineTextareaProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  async function commit() {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setEditing(false);
    setDraft(value);
    setError(null);
  }

  if (editing && !disabled) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label className="text-ds-label">{label}</label>
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
          }}
          placeholder={placeholder}
          disabled={saving}
          rows={rows}
          style={{
            padding: "6px 8px",
            fontSize: 13,
            border: "0.5px solid var(--ds-tier-quarter-focus)",
            borderRadius: 4,
            background: "var(--ds-card-bg)",
            color: "var(--ds-text-primary)",
            outline: "none",
            resize: "vertical",
            fontFamily: "inherit",
          }}
        />
        <div style={{ display: "flex", gap: 6 }}>
          <IconButton onClick={commit} title="Save" variant="primary" disabled={saving}>
            <IconCheck size={12} stroke={1.75} />
          </IconButton>
          <IconButton onClick={cancel} title="Cancel" disabled={saving}>
            <IconX size={12} stroke={1.75} />
          </IconButton>
        </div>
        {error && <FormError>{error}</FormError>}
      </div>
    );
  }

  const isEmpty = !value || value.trim() === "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="text-ds-label">{label}</span>
      <button
        type="button"
        onClick={() => !disabled && setEditing(true)}
        disabled={disabled}
        style={{
          padding: "6px 8px",
          margin: "-6px -8px",
          background: "transparent",
          border: "0.5px solid transparent",
          borderRadius: 4,
          fontSize: 13,
          color: isEmpty ? "var(--ds-text-muted)" : "var(--ds-text-primary)",
          fontStyle: isEmpty ? "italic" : "normal",
          cursor: disabled ? "default" : "pointer",
          textAlign: "left",
          whiteSpace: "pre-wrap",
          lineHeight: 1.5,
        }}
        className="hover:[border-color:var(--ds-border-warm)]"
      >
        {isEmpty ? placeholder : value}
      </button>
    </div>
  );
}

export interface DsInlineSelectProps<T extends string> extends BaseProps {
  value: T;
  options: Array<{ value: T; label: string }>;
  onSave: (next: T) => Promise<unknown> | void;
}

export function DsInlineSelect<T extends string>({
  label,
  value,
  options,
  onSave,
  disabled,
  placeholder = "—",
}: DsInlineSelectProps<T>) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(next: T) {
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const labelFor = options.find((o) => o.value === value)?.label ?? value;

  if (editing && !disabled) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label className="text-ds-label">{label}</label>
        <select
          value={value}
          onChange={(e) => handleChange(e.target.value as T)}
          onBlur={() => setEditing(false)}
          disabled={saving}
          autoFocus
          style={{
            padding: "4px 8px",
            fontSize: 13,
            border: "0.5px solid var(--ds-tier-quarter-focus)",
            borderRadius: 4,
            background: "var(--ds-card-bg)",
            color: "var(--ds-text-primary)",
            outline: "none",
            width: "fit-content",
            minWidth: 160,
          }}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {error && <FormError>{error}</FormError>}
      </div>
    );
  }

  const isEmpty = !value || value.trim() === "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="text-ds-label">{label}</span>
      <button
        type="button"
        onClick={() => !disabled && setEditing(true)}
        disabled={disabled}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          margin: "-4px -8px",
          background: "transparent",
          border: "0.5px solid transparent",
          borderRadius: 4,
          fontSize: 13,
          color: isEmpty ? "var(--ds-text-muted)" : "var(--ds-text-primary)",
          fontStyle: isEmpty ? "italic" : "normal",
          cursor: disabled ? "default" : "pointer",
          textAlign: "left",
          width: "fit-content",
        }}
        className="hover:[border-color:var(--ds-border-warm)]"
      >
        {isEmpty ? placeholder : labelFor}
      </button>
    </div>
  );
}

function IconButton({
  children,
  onClick,
  title,
  variant = "default",
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
  variant?: "primary" | "default";
  disabled?: boolean;
}) {
  const primary = variant === "primary";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        border: `0.5px solid ${primary ? "var(--ds-tier-quarter-focus)" : "var(--ds-border-warm)"}`,
        background: primary ? "var(--ds-tier-quarter-focus)" : "var(--ds-card-bg)",
        color: primary ? "#ffffff" : "var(--ds-text-primary)",
        borderRadius: 4,
        cursor: disabled ? "wait" : "pointer",
        opacity: disabled ? 0.6 : 1,
        padding: 0,
      }}
    >
      {children}
    </button>
  );
}
