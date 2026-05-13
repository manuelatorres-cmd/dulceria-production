"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconPackage as Package } from "@tabler/icons-react";
import type { Packaging } from "@/types";

/** Records packaging consumption for one unmoulded batch being packed. */
export function PackingModal({
  productName,
  totalPieces,
  packaging,
  onConfirm,
  onCancel,
}: {
  productName: string;
  totalPieces: number;
  packaging: Packaging[];
  onConfirm: (args: { packagingId: string; units: number; note?: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const available = useMemo(
    () => packaging.filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name)),
    [packaging],
  );
  const [packagingId, setPackagingId] = useState<string>(available[0]?.id ?? "");
  const selected = available.find((p) => p.id === packagingId);
  const suggestedUnits = selected && selected.capacity > 0
    ? Math.max(1, Math.ceil(totalPieces / selected.capacity))
    : 1;
  const [units, setUnits] = useState<string>(String(suggestedUnits));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const firstRef = useRef<HTMLSelectElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);
  useEffect(() => {
    if (selected && selected.capacity > 0) {
      setUnits(String(Math.max(1, Math.ceil(totalPieces / selected.capacity))));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packagingId]);

  const unitsNum = parseInt(units, 10);
  const shortfall = selected != null
    && (selected.quantityOnHand ?? 0) < unitsNum;
  const canConfirm = !!packagingId && Number.isFinite(unitsNum) && unitsNum > 0 && !busy;

  async function handleConfirm() {
    if (!canConfirm) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm({ packagingId, units: unitsNum, note: note.trim() || undefined });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={busy ? undefined : onCancel} />
      <div className="relative w-full max-w-md mx-4 mb-4 sm:mb-0 rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] shadow-xl overflow-hidden">
        <div className="bg-gradient-to-b from-amber-50 to-card px-5 pt-5 pb-3">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-sm bg-primary/10 flex items-center justify-center">
              <Package className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold">Pack {productName}</h3>
              <p className="text-xs text-muted-foreground">
                {totalPieces > 0 ? `${totalPieces} pieces to pack` : "Record packaging consumption"}
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 space-y-3">
          <div>
            <label className="label">Packaging</label>
            <select
              ref={firstRef}
              value={packagingId}
              onChange={(e) => setPackagingId(e.target.value)}
              className="input text-sm"
            >
              {available.length === 0 && <option value="">No packaging configured</option>}
              {available.map((p) => (
                <option key={p.id} value={p.id!}>
                  {p.name}
                  {p.capacity > 0 && ` · fits ${p.capacity}`}
                  {` · on hand ${p.quantityOnHand ?? 0}`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Units used</label>
            <input
              type="number"
              min="1"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              className="input text-sm w-32"
            />
            {selected && selected.capacity > 0 && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Fits ~{selected.capacity} pieces per unit — suggested {suggestedUnits}
              </p>
            )}
            {shortfall && (
              <p className="text-[11px] text-status-warn mt-1">
                Only {selected?.quantityOnHand ?? 0} on hand. Consumption will be clamped to what&apos;s available.
              </p>
            )}
          </div>
          <div>
            <label className="label">Note (optional)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. gift ribbons added"
              className="input text-sm"
            />
          </div>
          {error && <p className="text-[11px] text-status-alert">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-[color:var(--ds-border-warm)] flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="rounded-sm bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? "Packing…" : "Mark packed"}
          </button>
        </div>
      </div>
    </div>
  );
}
