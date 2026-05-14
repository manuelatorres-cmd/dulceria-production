"use client";

import { useEffect, useRef, useState } from "react";
import { IconSnowflake as Snowflake } from "@tabler/icons-react";
import { DsModalShell, DsButton, DsDialog } from "@/components/dulceria";

export function FreezeModal({
  title,
  itemName,
  itemSubtitle,
  unit,
  availableQty,
  defaultQty,
  defaultShelfLifeDays,
  onConfirm,
  onCancel,
}: {
  title: string;
  itemName: string;
  itemSubtitle?: string;
  unit: string;
  availableQty: number;
  defaultQty: number;
  defaultShelfLifeDays: number;
  onConfirm: (qty: number, preservedShelfLifeDays: number) => void;
  onCancel: () => void;
}) {
  const [qtyStr, setQtyStr] = useState(String(Math.round(defaultQty)));
  const [daysStr, setDaysStr] = useState(String(Math.max(0, Math.round(defaultShelfLifeDays))));
  const qtyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    qtyRef.current?.focus();
    qtyRef.current?.select();
  }, []);

  function handleConfirm() {
    const qty = Math.max(0, Math.min(Math.round(parseFloat(qtyStr) || 0), Math.round(availableQty)));
    const days = Math.max(0, Math.round(parseFloat(daysStr) || 0));
    if (qty <= 0) return;
    onConfirm(qty, days);
  }

  const qtyNum = parseFloat(qtyStr);
  const tooMuch = !isNaN(qtyNum) && qtyNum > availableQty;

  return (
    <DsModalShell
      open
      title={title}
      subtitle={`${itemName}${itemSubtitle ? ` · ${itemSubtitle}` : ""}`}
      icon={<Snowflake size={15} />}
      onClose={onCancel}
      footer={
        <>
          <DsButton onClick={onCancel}>Cancel</DsButton>
          <DsButton variant="primary" onClick={handleConfirm} disabled={tooMuch || !(parseFloat(qtyStr) > 0)}>
            Freeze
          </DsButton>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={{ display: "block", fontSize: 11, color: "var(--ds-text-muted)", marginBottom: 4 }}>
            Quantity to freeze
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              ref={qtyRef}
              type="number"
              min={1}
              max={Math.round(availableQty)}
              value={qtyStr}
              onChange={(e) => setQtyStr(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
              style={{
                flex: 1, height: 32, padding: "0 12px", fontSize: 13, fontWeight: 500,
                border: "0.5px solid var(--ds-border-warm)", borderRadius: 6,
                background: "var(--ds-card-bg)", color: "var(--ds-text-primary)",
                outline: "none",
              }}
            />
            <span style={{ fontSize: 11, color: "var(--ds-text-muted)", width: 40 }}>{unit}</span>
          </div>
          <p style={{ marginTop: 4, fontSize: 11, color: "var(--ds-text-muted)" }}>
            Available: {Math.round(availableQty)} {unit}
          </p>
          {tooMuch && (
            <p style={{ marginTop: 4, fontSize: 11, color: "var(--ds-tier-urgent)" }}>
              Cannot freeze more than what&apos;s available.
            </p>
          )}
        </div>

        <div>
          <label style={{ display: "block", fontSize: 11, color: "var(--ds-text-muted)", marginBottom: 4 }}>
            Shelf life to preserve (days)
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="number"
              min={0}
              value={daysStr}
              onChange={(e) => setDaysStr(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
              style={{
                flex: 1, height: 32, padding: "0 12px", fontSize: 13, fontWeight: 500,
                border: "0.5px solid var(--ds-border-warm)", borderRadius: 6,
                background: "var(--ds-card-bg)", color: "var(--ds-text-primary)",
                outline: "none",
              }}
            />
            <span style={{ fontSize: 11, color: "var(--ds-text-muted)", width: 40 }}>days</span>
          </div>
          <p style={{ marginTop: 4, fontSize: 11, color: "var(--ds-text-muted)" }}>
            Pre-filled with the remaining shelf life. Sell-by is paused in the freezer
            and restarts from this many days once defrosted.
          </p>
        </div>
      </div>
    </DsModalShell>
  );
}

export function DefrostConfirmModal({
  itemName,
  qty,
  unit,
  preservedShelfLifeDays,
  onConfirm,
  onCancel,
}: {
  itemName: string;
  qty: number;
  unit: string;
  preservedShelfLifeDays: number | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const sellBy = preservedShelfLifeDays != null
    ? new Date(Date.now() + preservedShelfLifeDays * 24 * 60 * 60 * 1000).toLocaleDateString("de-AT", {
        day: "numeric", month: "short", year: "numeric",
      })
    : null;

  return (
    <DsDialog
      open
      title={`Defrost ${itemName}?`}
      description={
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ margin: 0 }}>
            {Math.round(qty)} {unit} will move back to available stock.
          </p>
          {sellBy ? (
            <p style={{
              margin: 0, padding: "8px 12px", borderRadius: 4,
              background: "var(--ds-card-bg-hover, rgba(0,0,0,0.03))",
              border: "0.5px solid var(--ds-border-warm)",
              color: "var(--ds-text-primary)", fontSize: 12,
            }}>
              New sell-by date: <strong style={{ fontWeight: 500 }}>{sellBy}</strong>
              <span style={{ color: "var(--ds-text-muted)" }}> ({preservedShelfLifeDays} days from today)</span>
            </p>
          ) : (
            <p style={{
              margin: 0, padding: "8px 12px", borderRadius: 4,
              background: "var(--ds-card-bg-hover, rgba(0,0,0,0.03))",
              border: "0.5px solid var(--ds-border-warm)",
              color: "var(--ds-text-muted)", fontSize: 12,
            }}>
              No preserved shelf life recorded — defrosting will not set a new sell-by date.
            </p>
          )}
        </div>
      }
      confirmLabel="Yes, defrost"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
