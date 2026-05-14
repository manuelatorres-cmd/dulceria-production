"use client";

import { useMemo, useState } from "react";
import { PageHeader, Section, ListRow, StatusTag, DsButton } from "@/components/dulceria";
import {
  useColdStorageUnits,
  useTemperatureReadings,
  saveTemperatureReading,
  useHaccpIncidents,
  saveHaccpIncident,
  usePeople,
  saveColdStorageUnit,
  useEquipment,
  useCalibrations,
  saveCalibration,
  deleteCalibration,
} from "@/lib/hooks";
import type { ColdStorageUnit, TemperatureReading, Calibration, CalibrationCadence, CalibrationOutcome } from "@/types";
import { COLD_STORAGE_LOCATIONS, COLD_STORAGE_TYPES, CALIBRATION_CADENCES, CALIBRATION_OUTCOMES } from "@/types";

/**
 * Production Brain · HACCP (phase 3 UI)
 *
 * For each configured cold storage unit: show target range, last
 * readings (most recent first), a mini sparkline, and a
 * "Log reading" inline form. Out-of-range submissions auto-open
 * an incident via saveHaccpIncident.
 */
export default function ProductionBrainHaccpPage() {
  const units = useColdStorageUnits();
  const incidents = useHaccpIncidents(true);

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader title="HACCP" meta="Temperature logs per cold storage unit + open incidents" />
      <div style={{ padding: "16px 32px 40px", display: "flex", flexDirection: "column", gap: 18 }}>

        <Section title="New unit">
          <div style={{ padding: 16 }}>
            <NewUnitForm hasAny={units.length > 0} />
          </div>
        </Section>

        {units.length === 0 ? (
          <p
            style={{
              padding: "32px 16px",
              textAlign: "center",
              fontStyle: "italic",
              fontFamily: "var(--font-serif)",
              color: "var(--ds-text-muted)",
              fontSize: 14,
              background: "var(--ds-card-bg)",
              border: "0.5px solid var(--ds-border-warm)",
              borderRadius: 6,
            }}
          >
            No cold storage units yet. Add your first one above (fridge, freezer, ambient room).
          </p>
        ) : (
          units.map((unit) => <UnitCard key={unit.id} unit={unit} />)
        )}

        {incidents.length > 0 && (
          <Section title={`Open incidents · ${incidents.length}`}>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {incidents.map((inc) => (
                <li
                  key={inc.id}
                  style={{
                    padding: "10px 16px",
                    fontSize: 12,
                    borderTop: "0.5px solid var(--ds-border-warm)",
                    borderLeft: "3px solid var(--ds-tier-urgent)",
                  }}
                >
                  <strong style={{ fontWeight: 600 }}>{unitNameById(units, inc.coldStorageUnitId)}</strong>{" "}
                  opened {new Date(inc.startedAt).toLocaleString()}.{" "}
                  <span style={{ color: "var(--ds-text-muted)" }}>
                    {inc.actionTaken ?? "No action logged."}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <CalibrationsSection />
      </div>
    </div>
  );
}

function unitNameById(units: ColdStorageUnit[], id: string): string {
  return units.find((u) => u.id === id)?.name ?? id.slice(0, 8);
}

function UnitCard({ unit }: { unit: ColdStorageUnit }) {
  const readings = useTemperatureReadings(unit.id, undefined, undefined);
  const people = usePeople();
  const [temp, setTemp] = useState("");
  const [notes, setNotes] = useState("");
  const [personId, setPersonId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const last = readings[0];

  const sparkValues = useMemo(
    () => readings.slice(0, 20).reverse().map((r) => Number(r.readingC)),
    [readings],
  );

  async function submit() {
    if (!temp || !unit.id) return;
    setBusy(true);
    setErr(null);
    try {
      const reading = Number(temp);
      if (Number.isNaN(reading)) throw new Error("Invalid number.");
      const inRange = computeInRange(reading, unit);
      const savedId = await saveTemperatureReading({
        coldStorageUnitId: unit.id,
        readingC: reading,
        loggedAt: new Date(),
        loggedByPersonId: personId || undefined,
        inRange,
        notes: notes || undefined,
      });
      if (inRange === false) {
        await saveHaccpIncident({
          coldStorageUnitId: unit.id,
          temperatureReadingId: savedId,
          startedAt: new Date(),
          actionTaken: notes || undefined,
        });
      }
      setTemp("");
      setNotes("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4">
      <header className="flex items-baseline justify-between">
        <div>
          <strong className="tracking-tight text-sm">{unit.name}</strong>
          <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            {unit.type} · {unit.location}
          </span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          Target{" "}
          {unit.targetTempMinC ?? "?"}–{unit.targetTempMaxC ?? "?"} °C
          {" · "}
          {unit.checkFrequencyPerDay}×/day
        </span>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4 mt-3">
        <div className="rounded-[4px] bg-muted p-3">
          <h4 className="uppercase tracking-wider text-[10px] text-muted-foreground font-semibold mb-2">
            Last reading
          </h4>
          {last ? (
            <div>
              <span className="text-2xl font-semibold tabular-nums">
                {Number(last.readingC).toFixed(1)}
              </span>
              <span className="text-xs text-muted-foreground ml-1">°C</span>
              <p className="text-[10px] text-muted-foreground mt-1">
                {new Date(last.loggedAt).toLocaleString()}
              </p>
              <p
                className={
                  "text-[11px] mt-1 " +
                  (last.inRange === false
                    ? "text-status-alert"
                    : last.inRange === true
                      ? "text-status-ok"
                      : "text-muted-foreground")
                }
              >
                {last.inRange === false
                  ? "Out of range"
                  : last.inRange === true
                    ? "In range"
                    : "Range unknown"}
              </p>
              <Spark values={sparkValues} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              No readings yet.
            </p>
          )}
        </div>

        <div className="rounded-[4px] bg-muted p-3">
          <h4 className="uppercase tracking-wider text-[10px] text-muted-foreground font-semibold mb-2">
            Log reading
          </h4>
          <div className="space-y-2">
            <div>
              <label className="label">Temperature (°C)</label>
              <input
                type="number"
                step="0.1"
                value={temp}
                onChange={(e) => setTemp(e.target.value)}
                className="input"
                placeholder="e.g. 4.2"
              />
            </div>
            <div>
              <label className="label">Logged by</label>
              <select
                value={personId}
                onChange={(e) => setPersonId(e.target.value)}
                className="input"
              >
                <option value="">—</option>
                {people
                  .filter((p) => !p.archived)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="label">Note (optional)</label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="input"
                placeholder="e.g. after door left open"
              />
            </div>
            {err ? (
              <p className="text-xs text-status-alert">{err}</p>
            ) : null}
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !temp}
              onClick={submit}
            >
              {busy ? "Saving…" : "Save reading"}
            </button>
          </div>
        </div>
      </div>

      {readings.length > 0 ? (
        <details className="mt-3">
          <summary className="text-xs text-muted-foreground cursor-pointer">
            Last {Math.min(readings.length, 20)} readings
          </summary>
          <ul className="mt-2 space-y-1 text-xs">
            {readings.slice(0, 20).map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between border-b border-[color:var(--ds-border-warm)] py-1 last:border-b-0"
              >
                <span className="text-muted-foreground">
                  {new Date(r.loggedAt).toLocaleString()}
                </span>
                <span className="tabular-nums">
                  {Number(r.readingC).toFixed(1)}°C
                </span>
                <span
                  className={
                    r.inRange === false
                      ? "text-status-alert"
                      : r.inRange === true
                        ? "text-status-ok"
                        : "text-muted-foreground"
                  }
                >
                  {r.inRange === false
                    ? "out"
                    : r.inRange === true
                      ? "ok"
                      : "—"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

function computeInRange(
  reading: number,
  unit: ColdStorageUnit,
): boolean | undefined {
  if (unit.targetTempMinC === undefined && unit.targetTempMaxC === undefined) {
    return undefined;
  }
  if (unit.targetTempMinC !== undefined && reading < unit.targetTempMinC) return false;
  if (unit.targetTempMaxC !== undefined && reading > unit.targetTempMaxC) return false;
  return true;
}

/** Minimal inline sparkline — no external deps. */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 120;
  const h = 24;
  const step = w / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      className="mt-2 opacity-70"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        points={points}
      />
    </svg>
  );
}

/** Inline form to add a new cold storage unit. Replaces the old
 *  "go run SQL" empty state — the operator can spin up a fridge or
 *  freezer entry directly from this page and start logging temps in
 *  the same session. */
function NewUnitForm({ hasAny }: { hasAny: boolean }) {
  const [open, setOpen] = useState(!hasAny);
  const [name, setName] = useState("");
  const [location, setLocation] = useState<typeof COLD_STORAGE_LOCATIONS[number]>("production");
  const [type, setType] = useState<typeof COLD_STORAGE_TYPES[number]>("fridge");
  const [minC, setMinC] = useState("0");
  const [maxC, setMaxC] = useState("4");
  const [busy, setBusy] = useState(false);

  function defaultsForType(t: typeof COLD_STORAGE_TYPES[number]) {
    if (t === "freezer") return { min: -22, max: -18 };
    if (t === "ambient") return { min: 16, max: 22 };
    return { min: 0, max: 4 };
  }

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const min = parseFloat(minC.replace(",", "."));
      const max = parseFloat(maxC.replace(",", "."));
      await saveColdStorageUnit({
        name: name.trim(),
        location,
        type,
        targetTempMinC: isNaN(min) ? undefined : min,
        targetTempMaxC: isNaN(max) ? undefined : max,
        requiresTempCheck: true,
        checkFrequencyPerDay: 1,
        archived: false,
      });
      setName("");
      const d = defaultsForType(type);
      setMinC(String(d.min));
      setMaxC(String(d.max));
      setOpen(hasAny ? false : true);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to add unit");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[12px] px-3 py-1.5 rounded-[4px] bg-[color:var(--ds-tier-quarter-focus)] text-white"
      >
        + Add cold storage unit
      </button>
    );
  }

  return (
    <div>
      <p className="text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground mb-2">
        Add a fridge / freezer / ambient room
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
        <label className="block">
          <span className="text-[11px] text-muted-foreground">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Production fridge 1"
            className="input w-full"
            autoFocus
          />
        </label>
        <label className="block">
          <span className="text-[11px] text-muted-foreground">Type</span>
          <select
            value={type}
            onChange={(e) => {
              const t = e.target.value as typeof COLD_STORAGE_TYPES[number];
              setType(t);
              const d = defaultsForType(t);
              setMinC(String(d.min));
              setMaxC(String(d.max));
            }}
            className="input w-full"
          >
            {COLD_STORAGE_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] text-muted-foreground">Location</span>
          <select
            value={location}
            onChange={(e) => setLocation(e.target.value as typeof COLD_STORAGE_LOCATIONS[number])}
            className="input w-full"
          >
            {COLD_STORAGE_LOCATIONS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <label className="block flex-1">
            <span className="text-[11px] text-muted-foreground">Min °C</span>
            <input
              type="text"
              inputMode="decimal"
              value={minC}
              onChange={(e) => setMinC(e.target.value)}
              className="input w-full"
            />
          </label>
          <label className="block flex-1">
            <span className="text-[11px] text-muted-foreground">Max °C</span>
            <input
              type="text"
              inputMode="decimal"
              value={maxC}
              onChange={(e) => setMaxC(e.target.value)}
              className="input w-full"
            />
          </label>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        {hasAny && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-[12px] px-3 py-1.5 rounded-[4px] border border-[color:var(--ds-border-warm)] hover:bg-muted"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={busy || !name.trim()}
          className="text-[12px] px-3 py-1.5 rounded-[4px] bg-[color:var(--ds-tier-quarter-focus)] text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Add unit"}
        </button>
      </div>
    </div>
  );
}

/** Calibration history + add-new form. Backed by migration 0092
 *  calibrations table. Renders one ListRow per past calibration with
 *  outcome chip + next-due chip; an inline add row at the top accepts
 *  equipment + measured value + outcome + cadence. */
function CalibrationsSection() {
  const equipment = useEquipment(false);
  const calibrations = useCalibrations();
  const people = usePeople(false);

  const equipmentById = useMemo(() => new Map(equipment.map((e) => [e.id!, e])), [equipment]);
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id!, p])), [people]);

  // New-row form state.
  const [equipmentId, setEquipmentId] = useState("");
  const [outcome, setOutcome] = useState<CalibrationOutcome>("ok");
  const [cadence, setCadence] = useState<CalibrationCadence>("monthly");
  const [measuredValue, setMeasuredValue] = useState("");
  const [referenceValue, setReferenceValue] = useState("");
  const [calibratedBy, setCalibratedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const sorted = useMemo(
    () => [...calibrations].sort((a, b) =>
      new Date(b.calibratedAt).getTime() - new Date(a.calibratedAt).getTime(),
    ),
    [calibrations],
  );

  // Next-due chip per row. Surfaced separately in the meta line so the
  // operator can scan upcoming work without opening each row.
  function dueChipFor(c: Calibration): { label: string; kind: "ready" | "pending" | "overdue" } | null {
    if (!c.nextDueAt) return null;
    const due = new Date(c.nextDueAt);
    const days = Math.round((due.getTime() - Date.now()) / 86_400_000);
    if (days < 0) return { label: `overdue ${Math.abs(days)}d`, kind: "overdue" };
    if (days <= 7) return { label: `due in ${days}d`, kind: "pending" };
    return { label: `due ${due.toLocaleDateString("de-AT", { day: "numeric", month: "short" })}`, kind: "ready" };
  }

  function suggestNextDueFromCadence(c: CalibrationCadence): Date | undefined {
    const now = new Date();
    if (c === "monthly") return new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
    if (c === "quarterly") return new Date(now.getFullYear(), now.getMonth() + 3, now.getDate());
    if (c === "annual") return new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    return undefined;
  }

  async function submit() {
    if (!equipmentId) return;
    setBusy(true);
    try {
      await saveCalibration({
        equipmentId,
        calibratedAt: new Date(),
        calibratedBy: calibratedBy || undefined,
        outcome,
        cadence,
        nextDueAt: suggestNextDueFromCadence(cadence),
        measuredValue: measuredValue ? Number(measuredValue) : undefined,
        referenceValue: referenceValue ? Number(referenceValue) : undefined,
        notes: notes.trim() || undefined,
      });
      setMeasuredValue("");
      setReferenceValue("");
      setNotes("");
    } finally {
      setBusy(false);
    }
  }

  const outcomeTagKind: Record<CalibrationOutcome, "ready" | "pending" | "overdue" | "done" | "neutral"> = {
    ok: "ready",
    out_of_tolerance: "overdue",
    adjusted: "pending",
    retired: "neutral",
  };

  return (
    <Section
      title={`Calibrations · ${sorted.length}`}
      action={
        equipment.length === 0
          ? <span style={{ fontSize: 11, color: "var(--ds-text-muted)" }}>No equipment configured</span>
          : null
      }
      noBody
    >
      {/* New-row form */}
      {equipment.length > 0 && (
        <div style={{
          padding: "12px 16px", borderBottom: "0.5px solid var(--ds-border-warm)",
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8,
          background: "var(--ds-card-bg-hover, rgba(0,0,0,0.02))",
        }}>
          <select
            value={equipmentId}
            onChange={(e) => setEquipmentId(e.target.value)}
            style={inputStyle}
          >
            <option value="">Equipment…</option>
            {equipment.map((eq) => (
              <option key={eq.id} value={eq.id}>{eq.name}</option>
            ))}
          </select>
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as CalibrationOutcome)}
            style={inputStyle}
          >
            {CALIBRATION_OUTCOMES.map((o) => (
              <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
            ))}
          </select>
          <select
            value={cadence}
            onChange={(e) => setCadence(e.target.value as CalibrationCadence)}
            style={inputStyle}
          >
            {CALIBRATION_CADENCES.map((c) => (
              <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
            ))}
          </select>
          <input
            type="number"
            step="0.001"
            value={referenceValue}
            onChange={(e) => setReferenceValue(e.target.value)}
            placeholder="Reference"
            style={inputStyle}
          />
          <input
            type="number"
            step="0.001"
            value={measuredValue}
            onChange={(e) => setMeasuredValue(e.target.value)}
            placeholder="Measured"
            style={inputStyle}
          />
          <select
            value={calibratedBy}
            onChange={(e) => setCalibratedBy(e.target.value)}
            style={inputStyle}
          >
            <option value="">By…</option>
            {people.filter((p) => !p.archived).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            style={{ ...inputStyle, gridColumn: "span 2" }}
          />
          <DsButton
            variant="primary"
            size="sm"
            onClick={submit}
            disabled={!equipmentId || busy}
          >
            {busy ? "Saving…" : "Log calibration"}
          </DsButton>
        </div>
      )}

      {sorted.length === 0 ? (
        <p style={{ padding: "16px 20px", fontSize: 13, color: "var(--ds-text-muted)", fontStyle: "italic" }}>
          No calibrations logged yet. Use the row above to record a tare check, ice-point verification, or any periodic device-accuracy event.
        </p>
      ) : (
        sorted.map((c) => {
          const eq = equipmentById.get(c.equipmentId);
          const due = dueChipFor(c);
          const person = c.calibratedBy ? peopleById.get(c.calibratedBy) : null;
          const tierKind = c.outcome === "out_of_tolerance" ? "urgent"
            : c.outcome === "adjusted" ? "active"
            : c.outcome === "retired" ? "parked"
            : "positive";
          return (
            <ListRow
              key={c.id}
              tier={tierKind}
              title={
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span>{eq?.name ?? "Unknown equipment"}</span>
                  <StatusTag kind={outcomeTagKind[c.outcome]}>{c.outcome.replace(/_/g, " ")}</StatusTag>
                  {due && <StatusTag kind={due.kind}>{due.label}</StatusTag>}
                </span>
              }
              meta={
                <>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    {new Date(c.calibratedAt).toLocaleString("de-AT", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                  {" · "}
                  <span style={{ textTransform: "capitalize" }}>{c.cadence.replace(/_/g, " ")}</span>
                  {person && <> · {person.name}</>}
                  {(c.measuredValue != null || c.referenceValue != null) && (
                    <> · ref {c.referenceValue ?? "—"} / meas {c.measuredValue ?? "—"}</>
                  )}
                </>
              }
              secondary={c.notes ? <span style={{ fontStyle: "italic" }}>{c.notes}</span> : undefined}
              side={
                <button
                  onClick={() => c.id && deleteCalibration(c.id)}
                  aria-label="Delete calibration"
                  style={{
                    fontSize: 11, padding: "2px 8px",
                    background: "transparent",
                    border: "0.5px solid var(--ds-border-warm)", borderRadius: 12,
                    color: "var(--ds-text-muted)", cursor: "pointer",
                  }}
                >
                  Delete
                </button>
              }
            />
          );
        })
      )}
    </Section>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 12,
  border: "0.5px solid var(--ds-border-warm)",
  borderRadius: 4,
  background: "var(--ds-card-bg)",
  color: "var(--ds-text-primary)",
  outline: "none",
};
