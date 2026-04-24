"use client";

import { useMemo } from "react";
import {
  useProductionPlans,
  usePeople,
  useStaffShifts,
  useReplenishmentProposals,
  useColdStorageUnits,
  useTemperatureReadings,
  useHaccpIncidents,
} from "@/lib/hooks";

/**
 * Workshop wall display — big-format dashboard meant for a TV on the
 * workshop wall. Zero chrome, zero nav, huge numbers. Self-refreshes
 * via the same react-query hooks (background polling inherited).
 *
 * Intended to be opened fullscreen on a dedicated device. Hide the
 * cursor + press F11.
 */
export default function WallDisplayPage() {
  const plans = useProductionPlans();
  const people = usePeople();
  const today = new Date().toISOString().slice(0, 10);
  const shifts = useStaffShifts(undefined, today, today);
  const proposals = useReplenishmentProposals(["pending"]);
  const storage = useColdStorageUnits();
  const readings = useTemperatureReadings();
  const incidents = useHaccpIncidents(true);

  const active = useMemo(
    () => plans.filter((p) => p.status === "active").slice(0, 6),
    [plans],
  );
  const shiftByPerson = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const s of shifts) {
      if (!s.clockOutAt && s.personId) m.set(s.personId, true);
    }
    return m;
  }, [shifts]);

  const lastReadingByUnit = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of readings) {
      const prev = m.get(r.coldStorageUnitId) ?? 0;
      const t = new Date(r.loggedAt).getTime();
      if (t > prev) m.set(r.coldStorageUnitId, t);
    }
    return m;
  }, [readings]);

  const nowTime = new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const nowDate = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div
      className="min-h-screen bg-[color:var(--color-background)] text-foreground p-12"
      style={{ marginLeft: 0 }}
    >
      <header className="flex items-baseline justify-between mb-10">
        <div>
          <div
            className="text-[42px] leading-none"
            style={{
              fontFamily: "var(--font-serif)",
              fontWeight: 500,
              letterSpacing: "-0.025em",
            }}
          >
            Dulceria
          </div>
          <div
            className="text-[12px] uppercase mt-2 text-muted-foreground"
            style={{ letterSpacing: "0.18em" }}
          >
            Workshop wall · {nowDate}
          </div>
        </div>
        <div
          className="text-[56px] tabular-nums leading-none"
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            letterSpacing: "-0.025em",
          }}
        >
          {nowTime}
        </div>
      </header>

      <div className="grid grid-cols-12 gap-6">
        {/* Active batches */}
        <section className="col-span-8">
          <h2
            className="text-[10px] uppercase text-muted-foreground font-medium mb-4"
            style={{ letterSpacing: "0.18em" }}
          >
            In production · {active.length}
          </h2>
          {active.length === 0 ? (
            <p
              className="text-[28px] italic text-muted-foreground"
              style={{ fontFamily: "var(--font-serif)", fontWeight: 400 }}
            >
              Workshop quiet.
            </p>
          ) : (
            <ul className="space-y-4">
              {active.map((plan) => (
                <li
                  key={plan.id}
                  className="border border-border bg-card px-6 py-4"
                  style={{ borderRadius: 4 }}
                >
                  <div
                    className="text-[26px] leading-tight"
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontWeight: 500,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {plan.name ?? `Batch ${plan.batchNumber ?? ""}`}
                  </div>
                  <div
                    className="text-[11px] uppercase text-muted-foreground mt-2"
                    style={{ letterSpacing: "0.14em" }}
                  >
                    {plan.status}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Side column */}
        <aside className="col-span-4 space-y-6">
          {/* On-shift staff */}
          <div
            className="border border-border bg-card p-5"
            style={{ borderRadius: 4 }}
          >
            <h2
              className="text-[10px] uppercase text-muted-foreground font-medium mb-3"
              style={{ letterSpacing: "0.18em" }}
            >
              On shift
            </h2>
            <ul className="flex flex-wrap gap-2">
              {people
                .filter((p) => !p.archived && shiftByPerson.get(p.id ?? ""))
                .map((p) => (
                  <li
                    key={p.id}
                    className="px-3 py-1 bg-[color:var(--accent-terracotta-bg)] text-[color:var(--accent-terracotta-ink)] text-[14px]"
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontWeight: 500,
                      letterSpacing: "-0.012em",
                      borderRadius: 2,
                    }}
                  >
                    {p.name}
                  </li>
                ))}
              {people.filter((p) => !p.archived && shiftByPerson.get(p.id ?? ""))
                .length === 0 ? (
                <li
                  className="text-[14px] text-muted-foreground italic"
                  style={{ fontFamily: "var(--font-serif)" }}
                >
                  Nobody clocked in.
                </li>
              ) : null}
            </ul>
          </div>

          {/* Proposals counter */}
          <div
            className="border border-border bg-card p-5"
            style={{ borderRadius: 4 }}
          >
            <h2
              className="text-[10px] uppercase text-muted-foreground font-medium mb-3"
              style={{ letterSpacing: "0.18em" }}
            >
              Proposals waiting
            </h2>
            <div
              className="text-[56px] tabular-nums leading-none"
              style={{
                fontFamily: "var(--font-serif)",
                fontWeight: 500,
                letterSpacing: "-0.025em",
              }}
            >
              {proposals.length}
            </div>
          </div>

          {/* HACCP + alerts */}
          <div
            className="border border-border bg-card p-5"
            style={{ borderRadius: 4 }}
          >
            <h2
              className="text-[10px] uppercase text-muted-foreground font-medium mb-3"
              style={{ letterSpacing: "0.18em" }}
            >
              HACCP
            </h2>
            <ul className="space-y-1">
              {storage.map((unit) => {
                const lastMs = lastReadingByUnit.get(unit.id ?? "") ?? 0;
                const hoursAgo =
                  lastMs === 0
                    ? null
                    : Math.round((Date.now() - lastMs) / (60 * 60 * 1000));
                return (
                  <li
                    key={unit.id}
                    className="flex items-center justify-between text-[13px]"
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontWeight: 500,
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {unit.name}
                    </span>
                    <span
                      className={
                        hoursAgo === null
                          ? "text-status-alert"
                          : hoursAgo > 12
                            ? "text-status-warn"
                            : "text-status-ok"
                      }
                    >
                      {hoursAgo === null ? "no reading" : `${hoursAgo}h ago`}
                    </span>
                  </li>
                );
              })}
            </ul>
            {incidents.length > 0 ? (
              <div
                className="mt-3 border border-[color:var(--color-status-alert-edge)] bg-[color:var(--color-status-alert-bg)] px-3 py-2 text-[12px] text-status-alert"
                style={{ borderRadius: 3 }}
              >
                {incidents.length} open incident{incidents.length === 1 ? "" : "s"}
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
