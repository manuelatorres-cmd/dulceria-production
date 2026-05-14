"use client";

import { useEffect, useMemo, useState } from "react";
import { IconTemperature as Thermometer } from "@tabler/icons-react";
import type { Equipment } from "@/types";
import { EQUIPMENT_LOCATION_LABELS } from "@/types";
import { DsModalShell, DsButton } from "@/components/dulceria";

export interface TemperatureEntryDraft {
  equipmentId: string;
  temperatureC: string;
  note: string;
}

/** Daily HACCP popup. Shown when the production day is opened. Lists every
 *  equipment with `requiresTempCheck=true`, pre-fills yesterday's reading,
 *  requires a note whenever a reading falls outside the device's range. */
export function TemperatureLogModal({
  devices,
  previousReadings,
  onSave,
  onSnooze,
}: {
  devices: Equipment[];
  /** equipmentId → yesterday's last reading (°C). */
  previousReadings: Map<string, number>;
  onSave: (entries: Array<{ equipmentId: string; temperatureC: number; note?: string; isWithinRange: boolean }>) => Promise<void>;
  onSnooze: (reason: string) => Promise<void>;
}) {
  const sorted = useMemo(() => {
    return [...devices].sort((a, b) => {
      const la = a.location ?? "zz";
      const lb = b.location ?? "zz";
      if (la !== lb) return la.localeCompare(lb);
      return a.name.localeCompare(b.name);
    });
  }, [devices]);

  const [drafts, setDrafts] = useState<TemperatureEntryDraft[]>(() =>
    sorted.map((d) => ({
      equipmentId: d.id!,
      temperatureC: previousReadings.get(d.id!) != null ? String(previousReadings.get(d.id!)) : "",
      note: "",
    })),
  );
  const [snoozing, setSnoozing] = useState(false);
  const [snoozeReason, setSnoozeReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function update(equipmentId: string, patch: Partial<TemperatureEntryDraft>) {
    setDrafts((prev) => prev.map((d) => d.equipmentId === equipmentId ? { ...d, ...patch } : d));
  }

  // Re-seed drafts if the device set changes (popup stays mounted).
  useEffect(() => {
    setDrafts(sorted.map((d) => {
      const existing = drafts.find((x) => x.equipmentId === d.id);
      return existing ?? {
        equipmentId: d.id!,
        temperatureC: previousReadings.get(d.id!) != null ? String(previousReadings.get(d.id!)) : "",
        note: "",
      };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted.length]);

  const evaluated = drafts.map((d) => {
    const device = sorted.find((x) => x.id === d.equipmentId)!;
    const t = parseFloat(d.temperatureC);
    const inRange =
      Number.isFinite(t)
      && (device.tempMinC == null || t >= device.tempMinC)
      && (device.tempMaxC == null || t <= device.tempMaxC);
    return { draft: d, device, temperatureC: t, inRange, hasReading: Number.isFinite(t) };
  });
  const missingReadings = evaluated.some((e) => !e.hasReading);
  const outOfRangeMissingNote = evaluated.some((e) => e.hasReading && !e.inRange && !e.draft.note.trim());
  const canSave = !missingReadings && !outOfRangeMissingNote && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      await onSave(evaluated.map((e) => ({
        equipmentId: e.draft.equipmentId,
        temperatureC: e.temperatureC,
        note: e.draft.note.trim() || undefined,
        isWithinRange: e.inRange,
      })));
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "Save failed");
      setSaving(false);
    }
  }

  async function handleSnooze() {
    if (!snoozeReason.trim() || saving) return;
    setSaving(true);
    try { await onSnooze(snoozeReason.trim()); }
    catch (ex) { setError(ex instanceof Error ? ex.message : "Snooze failed"); setSaving(false); }
  }

  return (
    <DsModalShell
      open
      width={640}
      title="Daily temperature check"
      subtitle="Record a reading for each device before starting production — HACCP compliance."
      icon={<Thermometer size={15} />}
      busy={saving}
      onClose={() => { /* no close — must save or snooze */ }}
      footer={
        !snoozing ? (
          <>
            <DsButton onClick={() => setSnoozing(true)} disabled={saving}>Snooze for today</DsButton>
            <DsButton variant="primary" onClick={handleSave} disabled={!canSave || sorted.length === 0}>
              {saving ? "Saving…" : "Save readings"}
            </DsButton>
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
            <input
              type="text"
              value={snoozeReason}
              onChange={(e) => setSnoozeReason(e.target.value)}
              placeholder="Reason for skipping (required)"
              className="input text-sm"
              autoFocus
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <DsButton onClick={() => setSnoozing(false)}>Cancel</DsButton>
              <DsButton variant="primary" onClick={handleSnooze} disabled={!snoozeReason.trim() || saving}>
                Confirm snooze
              </DsButton>
            </div>
          </div>
        )
      }
    >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground italic py-6 text-center">
              No equipment is marked &quot;requires daily temperature check&quot;. Enable it in Settings → Equipment.
            </p>
          ) : (
            evaluated.map(({ draft, device, inRange, hasReading }) => {
              const needsNote = hasReading && !inRange && !draft.note.trim();
              const range = device.tempMinC != null && device.tempMaxC != null
                ? `${device.tempMinC}°C – ${device.tempMaxC}°C`
                : device.tempMinC != null
                  ? `≥ ${device.tempMinC}°C`
                  : device.tempMaxC != null
                    ? `≤ ${device.tempMaxC}°C`
                    : "No range set";
              return (
                <div
                  key={device.id}
                  className={`rounded-[6px] border p-2.5 ${
                    needsNote
                      ? "border-status-alert-edge bg-status-alert-bg"
                      : hasReading && !inRange
                        ? "border-status-warn-edge bg-status-warn-bg"
                        : "border-[color:var(--ds-border-warm)] bg-background"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{device.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {device.location ? EQUIPMENT_LOCATION_LABELS[device.location] : "—"} · Range {range}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <input
                        type="number"
                        step="0.1"
                        value={draft.temperatureC}
                        onChange={(e) => update(device.id!, { temperatureC: e.target.value })}
                        className="input text-sm w-20 text-right"
                      />
                      <span className="text-xs text-muted-foreground">°C</span>
                    </div>
                  </div>
                  {hasReading && !inRange && (
                    <input
                      type="text"
                      value={draft.note}
                      onChange={(e) => update(device.id!, { note: e.target.value })}
                      placeholder="Note required — what was the cause / fix?"
                      className="input text-xs mt-2"
                    />
                  )}
                </div>
              );
            })
          )}
        </div>

        {error && <p style={{ marginTop: 8, fontSize: 11, color: "var(--ds-tier-urgent)" }}>{error}</p>}
        {outOfRangeMissingNote && (
          <p style={{ marginTop: 8, fontSize: 11, color: "var(--ds-tier-urgent)" }}>
            Out-of-range readings need a note before you can save.
          </p>
        )}
    </DsModalShell>
  );
}
