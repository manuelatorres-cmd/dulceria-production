"use client";

import { useEffect, useRef, useState } from "react";
import { IconPackage as Package } from "@tabler/icons-react";

export type YieldEntry = {
  planProductId: string;
  productName: string;
  totalProducts: number;
  /** Pieces that are shop-ready full-price. Was the only field in v1. */
  yield: number;
  /** Pieces with cosmetic flaws — sold at discount (bars) or given
   *  away in-shop as tastings (bonbons, which don't allow seconds). */
  seconds?: number;
  /** Pieces scrapped — unusable, counted as waste. */
  scrap?: number;
  /** Free-text reason for seconds / scrap (e.g. "broken during
   *  unmould", "overfilled, chocolate bloom"). */
  reason?: string;
  /** When true, this product allows seconds routing to the discount
   *  shelf. Bonbons typically false; bars true. Surfaced so the
   *  modal can hide the seconds row for ineligible products. */
  secondsAllowed?: boolean;
};

export function YieldModal({ entries, mode = "batch", onConfirm, onCancel, cancelLabel }: {
  entries: YieldEntry[];
  mode?: "single" | "batch";
  onConfirm: (entries: YieldEntry[]) => void;
  onCancel: () => void;
  cancelLabel?: string;
}) {
  const [localEntries, setLocalEntries] = useState<YieldEntry[]>(
    entries.map((e) => ({
      seconds: 0,
      scrap: 0,
      reason: "",
      ...e,
    })),
  );
  const [inputStrs, setInputStrs] = useState<Record<string, string>>({});
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstInputRef.current?.focus();
    firstInputRef.current?.select();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  function updateEntry(planProductId: string, patch: Partial<YieldEntry>) {
    setLocalEntries((prev) =>
      prev.map((e) =>
        e.planProductId === planProductId ? { ...e, ...patch } : e,
      ),
    );
  }

  function clamp(_planProductId: string, _max: number, value: number) {
    // Floor at 0; the planned `max` is informational only — operators
    // sometimes yield more pieces than planned (extra mould fills, large
    // pours, etc.) and need to log the actual count.
    return Math.max(0, value);
  }

  const totalIntact = localEntries.reduce((sum, e) => sum + e.yield, 0);
  const totalSeconds = localEntries.reduce((sum, e) => sum + (e.seconds ?? 0), 0);
  const totalScrap = localEntries.reduce((sum, e) => sum + (e.scrap ?? 0), 0);
  const totalMax = localEntries.reduce((sum, e) => sum + e.totalProducts, 0);
  const totalAccounted = totalIntact + totalSeconds + totalScrap;
  const unaccounted = totalMax - totalAccounted;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onCancel}
      />

      <div
        className="relative w-full max-w-lg mx-4 mb-4 sm:mb-0 border border-border bg-card shadow-xl overflow-hidden"
        style={{ borderRadius: 4 }}
      >
        <div className="bg-[color:var(--accent-peach-bg)] px-5 pt-5 pb-3 border-b border-border">
          <div className="flex items-center gap-3 mb-1">
            <div
              className="w-9 h-9 bg-card flex items-center justify-center border border-border"
              style={{ borderRadius: 3 }}
            >
              <Package className="w-5 h-5 text-foreground" />
            </div>
            <div>
              <h3
                className="text-[17px]"
                style={{
                  fontFamily: "var(--font-serif)",
                  fontWeight: 500,
                  letterSpacing: "-0.015em",
                }}
              >
                {mode === "single" ? "Fresh from the mould" : "Batch complete"}
              </h3>
              <p className="text-[11.5px] text-muted-foreground">
                Split the yield between intact, seconds, and scrap.
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 space-y-5 max-h-[70vh] overflow-y-auto">
          {localEntries.map((entry, idx) => {
            const max = entry.totalProducts;
            const accounted =
              entry.yield + (entry.seconds ?? 0) + (entry.scrap ?? 0);
            const over = accounted > max;
            return (
              <div key={entry.planProductId} className="space-y-2">
                <div className="flex items-center justify-between">
                  <label
                    className="text-[13px]"
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontWeight: 500,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {entry.productName}
                  </label>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    max {max}
                  </span>
                </div>
                <YieldField
                  label="Intact"
                  value={entry.yield}
                  max={max}
                  isFirst={idx === 0}
                  inputRef={idx === 0 ? firstInputRef : undefined}
                  inputStrKey={`${entry.planProductId}-yield`}
                  inputStrs={inputStrs}
                  setInputStrs={setInputStrs}
                  onChange={(v) =>
                    updateEntry(entry.planProductId, {
                      yield: clamp(entry.planProductId, max, v),
                    })
                  }
                />
                {entry.secondsAllowed !== false ? (
                  <YieldField
                    label="Seconds"
                    help="cosmetic flaws, discounted"
                    value={entry.seconds ?? 0}
                    max={max}
                    inputStrKey={`${entry.planProductId}-seconds`}
                    inputStrs={inputStrs}
                    setInputStrs={setInputStrs}
                    onChange={(v) =>
                      updateEntry(entry.planProductId, {
                        seconds: clamp(entry.planProductId, max, v),
                      })
                    }
                  />
                ) : (
                  <p
                    className="text-[10.5px] text-muted-foreground italic px-2"
                    style={{ fontFamily: "var(--font-serif)" }}
                  >
                    Seconds not sellable — broken pieces become free tastings.
                  </p>
                )}
                <YieldField
                  label="Scrap"
                  help="unusable, logged as waste"
                  value={entry.scrap ?? 0}
                  max={max}
                  inputStrKey={`${entry.planProductId}-scrap`}
                  inputStrs={inputStrs}
                  setInputStrs={setInputStrs}
                  onChange={(v) =>
                    updateEntry(entry.planProductId, {
                      scrap: clamp(entry.planProductId, max, v),
                    })
                  }
                />
                {(entry.seconds ?? 0) > 0 || (entry.scrap ?? 0) > 0 ? (
                  <div>
                    <label
                      className="text-[10px] uppercase text-muted-foreground"
                      style={{ letterSpacing: "0.1em" }}
                    >
                      Reason
                    </label>
                    <input
                      type="text"
                      value={entry.reason ?? ""}
                      onChange={(e) =>
                        updateEntry(entry.planProductId, { reason: e.target.value })
                      }
                      placeholder="e.g. broken edges, overfilled, bloom"
                      className="input mt-0.5"
                    />
                  </div>
                ) : null}
                {over ? (
                  <p className="text-[11px] text-status-alert">
                    Total exceeds batch max ({accounted} / {max}).
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-border grid grid-cols-3 gap-3 text-[11px] text-muted-foreground">
          <div>
            <span
              className="uppercase"
              style={{ letterSpacing: "0.1em" }}
            >
              Intact
            </span>{" "}
            <span className="text-foreground font-medium tabular-nums">
              {totalIntact}
            </span>
          </div>
          <div>
            <span
              className="uppercase"
              style={{ letterSpacing: "0.1em" }}
            >
              Seconds
            </span>{" "}
            <span className="text-foreground font-medium tabular-nums">
              {totalSeconds}
            </span>
          </div>
          <div>
            <span
              className="uppercase"
              style={{ letterSpacing: "0.1em" }}
            >
              Scrap
            </span>{" "}
            <span className="text-foreground font-medium tabular-nums">
              {totalScrap}
            </span>
          </div>
          {unaccounted !== 0 ? (
            <div className="col-span-3 text-[11px] text-status-warn">
              {unaccounted > 0
                ? `${unaccounted} pieces unaccounted — enter them before confirming.`
                : `${Math.abs(unaccounted)} over target.`}
            </div>
          ) : null}
        </div>

        <div className="px-5 py-4 border-t border-border flex gap-2 justify-end">
          <button onClick={onCancel} className="btn-secondary">
            {cancelLabel ?? "Cancel"}
          </button>
          <button
            onClick={() => onConfirm(localEntries)}
            className="btn-primary"
            disabled={unaccounted > 0}
          >
            Add to stock
          </button>
        </div>
      </div>
    </div>
  );
}

function YieldField({
  label,
  help,
  value,
  max,
  isFirst: _isFirst,
  inputRef,
  inputStrKey,
  inputStrs,
  setInputStrs,
  onChange,
}: {
  label: string;
  help?: string;
  value: number;
  max: number;
  isFirst?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  inputStrKey: string;
  inputStrs: Record<string, string>;
  setInputStrs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className="text-[11px] uppercase"
            style={{ letterSpacing: "0.1em", fontWeight: 500 }}
          >
            {label}
          </span>
          {help ? (
            <span className="text-[10px] text-muted-foreground italic">
              {help}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(Math.max(0, value - 1))}
          className="w-7 h-7 border border-border bg-card hover:border-foreground text-foreground"
          style={{ borderRadius: 2 }}
        >
          −
        </button>
        <input
          ref={inputRef ?? undefined}
          type="number"
          min={0}
          value={inputStrs[inputStrKey] ?? value}
          onChange={(e) => {
            setInputStrs((prev) => ({ ...prev, [inputStrKey]: e.target.value }));
          }}
          onBlur={(e) => {
            const val = parseInt(e.target.value, 10);
            // No upper cap — actual yield can exceed planned when an
            // operator pours extra moulds or gets above-spec yield.
            const clamped = isNaN(val) ? value : Math.max(0, val);
            onChange(clamped);
            setInputStrs((prev) => {
              const { [inputStrKey]: _removed, ...rest } = prev;
              return rest;
            });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-14 h-7 border border-border bg-card text-center text-sm font-medium focus:outline-none focus:ring-1 focus:ring-foreground [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          style={{ borderRadius: 2 }}
        />
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          className="w-7 h-7 border border-border bg-card hover:border-foreground text-foreground"
          style={{ borderRadius: 2 }}
        >
          +
        </button>
      </div>
    </div>
  );
}
