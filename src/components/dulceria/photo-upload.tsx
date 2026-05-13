"use client";

import { useId, useRef, useState } from "react";
import { IconPhoto, IconX, IconUpload } from "@tabler/icons-react";

export interface DsPhotoUploadProps {
  value?: string;
  onChange: (url: string | undefined) => void;
  aspectRatio?: number;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Optional max file size in bytes (default 4 MiB). Larger files are
   * rejected with an inline error.
   */
  maxBytes?: number;
}

/**
 * Photo upload with drag-drop zone + preview. Currently embeds as
 * data URI (no CDN upload endpoint exists yet — flagged deferred per
 * spec phase 2.4). Switch internals to real upload once /api/upload is
 * wired up. Caller API stays the same.
 */
export function DsPhotoUpload({
  value,
  onChange,
  aspectRatio = 1,
  placeholder = "Drop photo or click to upload",
  disabled,
  maxBytes = 4 * 1024 * 1024,
}: DsPhotoUploadProps) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Only image files allowed");
      return;
    }
    if (file.size > maxBytes) {
      setError(`Image too large (max ${Math.round(maxBytes / (1024 * 1024))} MiB)`);
      return;
    }
    setUploading(true);
    try {
      const dataUri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });
      onChange(dataUri);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    if (!disabled) setDragging(true);
  }

  function onDragLeave() {
    setDragging(false);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  if (value) {
    return (
      <div
        style={{
          position: "relative",
          aspectRatio: `${aspectRatio} / 1`,
          background: "var(--ds-card-bg-hover)",
          border: "0.5px solid var(--ds-border-warm)",
          borderRadius: 6,
          overflow: "hidden",
        }}
        className="group"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={value}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
        {!disabled && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              background: "rgba(20, 18, 12, 0.55)",
              opacity: 0,
              transition: "opacity 0.15s",
            }}
            className="group-hover:opacity-100"
          >
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "5px 10px",
                background: "var(--ds-card-bg)",
                color: "var(--ds-text-primary)",
                border: "0.5px solid var(--ds-border-warm)",
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              <IconUpload size={11} stroke={1.5} /> Replace
            </button>
            <button
              type="button"
              onClick={() => onChange(undefined)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "5px 10px",
                background: "var(--ds-card-bg)",
                color: "var(--ds-tier-urgent)",
                border: "0.5px solid var(--ds-tier-urgent)",
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              <IconX size={11} stroke={1.5} /> Remove
            </button>
          </div>
        )}
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="image/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
          style={{ display: "none" }}
        />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label
        htmlFor={inputId}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          aspectRatio: `${aspectRatio} / 1`,
          background: dragging ? "var(--ds-card-bg-hover)" : "var(--ds-card-bg)",
          border: `1px dashed ${dragging ? "var(--ds-tier-quarter-focus)" : "var(--ds-border-warm)"}`,
          borderRadius: 6,
          color: "var(--ds-text-muted)",
          cursor: disabled ? "not-allowed" : "pointer",
          fontSize: 11,
          fontStyle: "italic",
          textAlign: "center",
          padding: 12,
        }}
      >
        <IconPhoto size={20} stroke={1.5} />
        <span>{uploading ? "Uploading…" : placeholder}</span>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="image/*"
          disabled={disabled}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
          style={{ display: "none" }}
        />
      </label>
      {error && (
        <span
          style={{
            fontSize: 11,
            fontStyle: "italic",
            color: "var(--ds-tier-urgent)",
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
