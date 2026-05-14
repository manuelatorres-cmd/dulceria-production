"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconPackage as Package } from "@tabler/icons-react";
import type { Packaging } from "@/types";
import { DsModalShell, DsButton } from "@/components/dulceria";

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
    <DsModalShell
      open
      title={`Pack ${productName}`}
      subtitle={totalPieces > 0 ? `${totalPieces} pieces to pack` : "Record packaging consumption"}
      icon={<Package size={15} />}
      busy={busy}
      onClose={onCancel}
      footer={
        <>
          <DsButton onClick={onCancel} disabled={busy}>Cancel</DsButton>
          <DsButton variant="primary" onClick={handleConfirm} disabled={!canConfirm}>
            {busy ? "Packing…" : "Mark packed"}
          </DsButton>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
            className="input text-sm"
            style={{ width: 128 }}
          />
          {selected && selected.capacity > 0 && (
            <p style={{ fontSize: 11, color: "var(--ds-text-muted)", marginTop: 2 }}>
              Fits ~{selected.capacity} pieces per unit — suggested {suggestedUnits}
            </p>
          )}
          {shortfall && (
            <p style={{ fontSize: 11, color: "var(--ds-semantic-warn)", marginTop: 4 }}>
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
        {error && <p style={{ fontSize: 11, color: "var(--ds-tier-urgent)" }}>{error}</p>}
      </div>
    </DsModalShell>
  );
}
