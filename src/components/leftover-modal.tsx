"use client";

import { useEffect, useRef, useState } from "react";
import { IconDroplets as Droplets, IconSnowflake as Snowflake } from "@tabler/icons-react";
import { DsModalShell, DsButton } from "@/components/dulceria";

export type LeftoverEntry = {
  fillingId: string;
  fillingName: string;
  category?: string;
  /** Pre-computed estimate: amount made minus amount needed */
  estimatedLeftoverG: number;
  /** Total grams actually made in this batch — hard upper bound on leftover entry.
   *  Users can't register more leftover than what was produced. */
  totalMadeG: number;
  /** Shelf life of the filling (weeks). Used as the "days preserved" default when
   *  the user chooses to freeze the leftover (just-made → full shelf life). */
  shelfLifeWeeks?: number;
  /** The plan that created this stock */
  planId?: string;
  /** When the filling was made (ISO date) */
  madeAt: string;
};

export type LeftoverResult = {
  fillingId: string;
  remainingG: number;
  madeAt: string;
  planId?: string;
  frozen?: boolean;
  preservedShelfLifeDays?: number;
};

export function LeftoverModal({ entries, onConfirm, onSkip }: {
  entries: LeftoverEntry[];
  /** Called with final gram values per filling (0 = no leftover to save) */
  onConfirm: (results: LeftoverResult[]) => void;
  /** Skip without registering any leftover */
  onSkip: () => void;
}) {
  const [localValues, setLocalValues] = useState<Record<string, number>>(
    () => Object.fromEntries(entries.map((e) => [e.fillingId, Math.max(0, Math.round(e.estimatedLeftoverG))]))
  );
  const [inputStrs, setInputStrs] = useState<Record<string, string>>({});
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstInputRef.current?.focus();
    firstInputRef.current?.select();
  }, []);

  function buildResults(freeze: boolean): LeftoverResult[] {
    return entries
      .filter((e) => (localValues[e.fillingId] ?? 0) > 0)
      .map((e) => {
        const base: LeftoverResult = {
          fillingId: e.fillingId,
          remainingG: localValues[e.fillingId],
          madeAt: e.madeAt,
          planId: e.planId,
        };
        if (freeze) {
          base.frozen = true;
          base.preservedShelfLifeDays = e.shelfLifeWeeks && e.shelfLifeWeeks > 0
            ? Math.round(e.shelfLifeWeeks * 7)
            : 0;
        }
        return base;
      });
  }

  function handleConfirm() {
    onConfirm(buildResults(false));
  }

  function handleFreeze() {
    onConfirm(buildResults(true));
  }

  const anyPositive = entries.some((e) => (localValues[e.fillingId] ?? 0) > 0);

  return (
    <DsModalShell
      open
      title="Any leftover filling?"
      subtitle="Weigh what's left and we'll track it for next time"
      icon={<Droplets size={15} />}
      onClose={onSkip}
      footer={
        <>
          <DsButton onClick={onSkip}>No leftover</DsButton>
          <DsButton onClick={handleFreeze} disabled={!anyPositive}>
            <Snowflake size={13} style={{ marginRight: 4, verticalAlign: "-2px" }} /> Freeze leftover
          </DsButton>
          <DsButton variant="primary" onClick={handleConfirm} disabled={!anyPositive}>
            Save leftover
          </DsButton>
        </>
      }
    >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {entries.map((entry, idx) => {
            const value = localValues[entry.fillingId] ?? 0;
            return (
              <div key={entry.fillingId} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-foreground">{entry.fillingName}</label>
                    {entry.category && (
                      <p className="text-[10px] text-muted-foreground">{entry.category}</p>
                    )}
                  </div>
                  {entry.estimatedLeftoverG > 0 && (
                    <span className="text-[10px] text-muted-foreground font-mono">
                      ~{Math.round(entry.estimatedLeftoverG)}g estimated
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    ref={idx === 0 ? firstInputRef : undefined}
                    type="number"
                    min={0}
                    max={entry.totalMadeG > 0 ? Math.round(entry.totalMadeG) : undefined}
                    step="any"
                    value={inputStrs[entry.fillingId] ?? value}
                    onChange={(e) => {
                      setInputStrs((prev) => ({ ...prev, [entry.fillingId]: e.target.value }));
                    }}
                    onBlur={(e) => {
                      const val = parseFloat(e.target.value);
                      const cap = entry.totalMadeG > 0 ? Math.round(entry.totalMadeG) : Infinity;
                      const clamped = isNaN(val) ? 0 : Math.max(0, Math.min(Math.round(val), cap));
                      setLocalValues((prev) => ({ ...prev, [entry.fillingId]: clamped }));
                      setInputStrs((prev) => {
                        const next = { ...prev };
                        delete next[entry.fillingId];
                        return next;
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        (e.target as HTMLInputElement).blur();
                        if (entries.length === 1) handleConfirm();
                      }
                    }}
                    className="flex-1 h-8 rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] text-center text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-xs text-muted-foreground w-4">g</span>
                </div>
                {entry.totalMadeG > 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    Max {Math.round(entry.totalMadeG)}g (batch total)
                  </p>
                )}
              </div>
            );
          })}
        </div>
    </DsModalShell>
  );
}
