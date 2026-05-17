"use client";

/**
 * Spec MANUAL_PLANNER_WORKSPACE_BATCH1.md §3.9.
 *
 * Modal triggered from BatchPeekPopover's [Split…] action. User picks
 * how many fills to move + whether they go to a day in the visible
 * week or back to the pool.
 *
 * Calls splitPlan() on confirm; closes on success.
 */

import { useEffect, useMemo, useState } from "react";
import { splitPlan, type SplitTarget } from "@/lib/manual-planner/split-plan";

function isoForOffset(start: Date, offset: number): string {
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function startOfWeekMonday(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = out.getUTCDay();
  const offset = (dow + 6) % 7;
  out.setUTCDate(out.getUTCDate() - offset);
  return out;
}

export function SplitBatchModal({
  planId,
  productName,
  totalFills,
  cavities,
  weekAnchor,
  onDone,
  onClose,
}: {
  planId: string;
  productName: string;
  totalFills: number;
  cavities: number;
  weekAnchor: Date;
  onDone: () => void;
  onClose: () => void;
}) {
  const weekDays = useMemo(() => {
    const start = startOfWeekMonday(weekAnchor);
    return Array.from({ length: 7 }, (_, i) => isoForOffset(start, i));
  }, [weekAnchor]);

  const maxFills = Math.max(1, totalFills - 1);
  const defaultMove = Math.max(1, Math.floor(totalFills / 2));
  const [fillsToMove, setFillsToMove] = useState(Math.min(defaultMove, maxFills));
  const [targetKind, setTargetKind] = useState<"day" | "pool">("day");
  const [targetDate, setTargetDate] = useState<string>(weekDays[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!weekDays.includes(targetDate)) setTargetDate(weekDays[0]);
  }, [weekDays, targetDate]);

  const remaining = totalFills - fillsToMove;
  const movedPieces = fillsToMove * cavities;
  const remainingPieces = remaining * cavities;

  async function handleSplit(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const target: SplitTarget =
        targetKind === "day"
          ? { kind: "day", date: targetDate }
          : { kind: "pool" };
      await splitPlan(planId, fillsToMove, target);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Split batch"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--mp-card-bg)",
          border: "1px solid var(--mp-border-warm)",
          borderRadius: 10,
          padding: 18,
          minWidth: 360,
          maxWidth: 460,
          boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          fontSize: 12.5,
        }}
      >
        <header style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>Split {productName}</h2>
          <button
            type="button"
            onClick={onClose}
            style={{ fontSize: 12, background: "transparent", border: "none", cursor: "pointer", opacity: 0.6 }}
          >
            ✕
          </button>
        </header>

        <div>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600 }}>Move</span>
            <input
              type="number"
              min={1}
              max={maxFills}
              value={fillsToMove}
              onChange={(e) =>
                setFillsToMove(Math.max(1, Math.min(maxFills, Number(e.target.value) || 1)))
              }
              style={{
                width: 70,
                padding: "4px 8px",
                fontSize: 13,
                borderRadius: 4,
                border: "1px solid var(--mp-border-warm)",
                fontFamily: "inherit",
              }}
            />
            <span>fills (of {totalFills} total)</span>
          </label>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontWeight: 600 }}>Target</span>
          <label style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
            <input
              type="radio"
              checked={targetKind === "day"}
              onChange={() => setTargetKind("day")}
            />
            <span>To day:</span>
            <select
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              disabled={targetKind !== "day"}
              style={{
                padding: "3px 6px",
                fontSize: 12,
                borderRadius: 4,
                border: "1px solid var(--mp-border-warm)",
                fontFamily: "inherit",
              }}
            >
              {weekDays.map((iso) => {
                const d = new Date(iso + "T00:00:00");
                const label = d.toLocaleDateString("en-GB", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                });
                return (
                  <option key={iso} value={iso}>
                    {label}
                  </option>
                );
              })}
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
            <input
              type="radio"
              checked={targetKind === "pool"}
              onChange={() => setTargetKind("pool")}
            />
            <span>To pool (unscheduled)</span>
          </label>
        </div>

        <div
          style={{
            padding: "8px 10px",
            background: "var(--mp-page-bg)",
            border: "1px solid var(--mp-border-warm)",
            borderRadius: 6,
            fontSize: 12,
            color: "var(--mp-text-primary)",
          }}
        >
          <strong>Preview:</strong> Original keeps {remaining} fill{remaining === 1 ? "" : "s"} ·{" "}
          {remainingPieces} pcs · {fillsToMove} fill{fillsToMove === 1 ? "" : "s"} ({movedPieces} pcs) goes to{" "}
          {targetKind === "day"
            ? new Date(targetDate + "T00:00:00").toLocaleDateString("en-GB", {
                weekday: "short",
                day: "numeric",
                month: "short",
              })
            : "pool"}
          .
        </div>

        {err ? (
          <p style={{ color: "var(--mp-rose, #993556)", fontSize: 11.5 }}>{err}</p>
        ) : null}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "5px 12px",
              borderRadius: 5,
              border: "1px solid var(--mp-border-warm)",
              background: "transparent",
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { void handleSplit(); }}
            disabled={busy}
            style={{
              padding: "5px 14px",
              borderRadius: 5,
              border: "none",
              background: "var(--mp-teal, #1c5651)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 600,
              cursor: busy ? "wait" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {busy ? "Splitting…" : "Split"}
          </button>
        </div>
      </div>
    </div>
  );
}
