"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import {
  useColdStorageUnits,
  useTemperatureReadings,
  saveTemperatureReading,
  useHaccpIncidents,
  saveHaccpIncident,
  usePeople,
} from "@/lib/hooks";
import type { ColdStorageUnit, TemperatureReading } from "@/types";

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
    <div>
      <PageHeader
        title="HACCP"
        description="Temperature logs per cold storage unit + open incidents."
      />

      {units.length === 0 ? (
        <section className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          <p>
            No cold storage units configured yet. Insert rows into the
            <code className="mx-1">coldStorageUnits</code>
            table (name + location + target range) to start logging.
          </p>
        </section>
      ) : (
        <ul className="space-y-4">
          {units.map((unit) => (
            <UnitCard key={unit.id} unit={unit} />
          ))}
        </ul>
      )}

      {incidents.length > 0 ? (
        <section className="mt-8 rounded-xl border border-status-alert-edge bg-status-alert-bg p-4">
          <h3 className="uppercase tracking-wider text-[10px] text-status-alert font-semibold mb-3">
            Open incidents · {incidents.length}
          </h3>
          <ul className="space-y-2">
            {incidents.map((inc) => (
              <li key={inc.id} className="text-xs">
                <strong>{unitNameById(units, inc.coldStorageUnitId)}</strong>{" "}
                opened {new Date(inc.startedAt).toLocaleString()}.{" "}
                {inc.actionTaken ?? "No action logged."}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
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
    <li className="rounded-xl border border-border bg-card p-4">
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
        <div className="rounded-lg bg-muted p-3">
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

        <div className="rounded-lg bg-muted p-3">
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
                className="flex items-center justify-between border-b border-border/60 py-1 last:border-b-0"
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
