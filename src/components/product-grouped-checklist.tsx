"use client";

import { useState } from "react";
import { CheckSquare, Square, ChevronDown, ChevronRight } from "lucide-react";

/**
 * Aggregates per-batch step rows by productId. Display-only — each
 * tap still toggles a single batch's step in the database, so manual
 * rescheduling and per-batch audit trails stay intact.
 *
 * Default expansion: groups with < 5 batches expanded by default,
 * groups with ≥ 5 collapsed (showing just the count). User can flip.
 */

export interface ChecklistRow {
  planId: string;
  planProductId: string;
  productId: string;
  productName: string;
  qty: number;
  done: boolean;
  /** Free-form subline shown under the batch in expanded mode (e.g. "DUL-001 · 7 pcs · 28 May"). */
  subline?: string;
  /** Optional right-side chip (e.g. campaign name, "restock"). */
  chip?: string;
}

// Always start collapsed. Manuela's working a busy phase doesn't
// want a wall of pre-expanded product groups — she opens the one
// she's about to do and leaves the others tucked away.
const DEFAULT_EXPAND_THRESHOLD = 0;

export function ProductGroupedChecklist({
  rows,
  tintInk,
  onToggle,
  onSelect,
  selectedPlanProductId,
  infoOnly,
  doneLabel,
  notDoneLabel,
}: {
  rows: ChecklistRow[];
  tintInk: string;
  onToggle: (planId: string) => void;
  /** When set, clicking the row body selects it (right-pane preview).
   *  Tick + checkbox stay as the toggle target. */
  onSelect?: (row: ChecklistRow) => void;
  selectedPlanProductId?: string;
  /** When true, the row's checkbox is replaced with a non-clickable
   *  status pill — for phases where readiness is derived from stock
   *  (filling prep), not from an explicit tick. Click on the pill or
   *  row body still routes through `onToggle` so the parent can show
   *  an info alert / redirect. */
  infoOnly?: boolean;
  /** Pill text in infoOnly mode. Defaults: "ready" / "not ready". */
  doneLabel?: string;
  notDoneLabel?: string;
}) {
  // Build groups keyed by productId, preserving incoming order within
  // a group so done items can stay below pending ones.
  const groups = new Map<string, { name: string; rows: ChecklistRow[] }>();
  for (const r of rows) {
    const g = groups.get(r.productId) ?? { name: r.productName, rows: [] };
    g.rows.push(r);
    groups.set(r.productId, g);
  }
  const sorted = [...groups.entries()]
    .map(([productId, g]) => ({ productId, ...g }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const isOpen = (pid: string, batchCount: number) =>
    openMap[pid] ?? batchCount < DEFAULT_EXPAND_THRESHOLD;
  function toggleOpen(pid: string, currentlyOpen: boolean) {
    setOpenMap((p) => ({ ...p, [pid]: !currentlyOpen }));
  }

  if (sorted.length === 0) return null;

  return (
    <ul className="space-y-1.5">
      {sorted.map((g) => {
        const totalQty = g.rows.reduce((s, r) => s + r.qty, 0);
        const doneCount = g.rows.filter((r) => r.done).length;
        const allDone = doneCount === g.rows.length;
        const open = isOpen(g.productId, g.rows.length);
        const chips = [...new Set(g.rows.map((r) => r.chip).filter(Boolean) as string[])];
        return (
          <li key={g.productId} className="rounded-[12px] bg-white/70 border border-white/50 overflow-hidden">
            <button
              onClick={() => toggleOpen(g.productId, open)}
              className={
                "w-full flex items-center gap-2 px-3 py-2 text-left transition " +
                (allDone ? "opacity-65" : "")
              }
            >
              <span style={{ color: tintInk }} className="flex-shrink-0">
                {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-medium truncate" style={{ color: "#1c1d1f" }}>
                  {g.name}
                </div>
                <div className="text-[10.5px] opacity-75 truncate">
                  {totalQty} pcs · {g.rows.length} batch{g.rows.length === 1 ? "" : "es"}
                  {doneCount > 0 && doneCount < g.rows.length && ` · ${doneCount} done`}
                </div>
              </div>
              {chips.length > 0 && (
                <span
                  className="text-[9.5px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/85 truncate max-w-[120px]"
                  style={{ letterSpacing: "0.05em", color: "#1c1d1f" }}
                  title={chips.join(", ")}
                >
                  {chips.length === 1 ? chips[0] : `${chips.length} tags`}
                </span>
              )}
              {allDone && (
                <CheckSquare className="w-4 h-4 flex-shrink-0" style={{ color: "#4a7a5e" }} />
              )}
            </button>

            {open && (
              <ul className="border-t border-white/60 bg-white/40">
                {g.rows.map((row) => {
                  const isSelected = selectedPlanProductId && selectedPlanProductId === row.planProductId;
                  // When `onSelect` is provided we split the row into a
                  // tick zone (checkbox button) and a select zone (rest
                  // of the row). Without it the whole row toggles, same
                  // behaviour as before.
                  return (
                    <li key={row.planProductId}>
                      <div
                        className={
                          "w-full flex items-center gap-2.5 px-3 py-2 transition border-b border-white/40 last:border-b-0 " +
                          (row.done ? "opacity-60" : "") +
                          (isSelected ? " bg-white shadow-[inset_2px_0_0_currentColor]" : "")
                        }
                        style={isSelected ? { color: tintInk } : undefined}
                      >
                        <span className="w-4 flex-shrink-0" />
                        {infoOnly ? (
                          // Pure info — no checkbox, no button. Just a
                          // tiny status dot the operator scans for
                          // green/red. Click bubbles to the row-body
                          // button below so the parent's onToggle can
                          // route to the weekly cook view.
                          <span
                            className="flex-shrink-0 inline-flex items-center justify-center"
                            title={row.done ? (doneLabel ?? "ready") : (notDoneLabel ?? "not ready")}
                            style={{ width: 12, height: 12 }}
                          >
                            <span
                              className="inline-block rounded-full"
                              style={{
                                width: 10, height: 10,
                                background: row.done ? "#4a7a5e" : "#9b4f48",
                              }}
                            />
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onToggle(row.planId)}
                            title={row.done ? "Mark not done" : "Mark done"}
                            className="flex-shrink-0 hover:scale-110 transition"
                          >
                            {row.done ? (
                              <CheckSquare className="w-[18px] h-[18px]" style={{ color: "#4a7a5e" }} />
                            ) : (
                              <Square className="w-[18px] h-[18px]" style={{ color: tintInk }} />
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (onSelect) onSelect(row);
                            else onToggle(row.planId);
                          }}
                          className="flex-1 min-w-0 text-left hover:opacity-90 transition flex items-center gap-2"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-[12px] font-medium truncate" style={{ color: "#1c1d1f" }}>
                              {row.subline ?? `${row.qty} pcs`}
                            </div>
                          </div>
                          {row.chip && (
                            <span
                              className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-white/80"
                              style={{ letterSpacing: "0.05em", color: "#1c1d1f" }}
                            >
                              {row.chip}
                            </span>
                          )}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
