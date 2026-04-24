"use client";

import { useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import {
  useCampaigns,
  useBlockedDays,
  useProductionDays,
} from "@/lib/hooks";

/**
 * Master calendar — 12-month yearly overview.
 *
 * Aggregates every scheduled signal the brain cares about:
 *   - Campaigns (seasonal + limited + launches)
 *   - Workshop closures / blocked days (legacy EventCalendarEntry)
 *   - Austrian public holidays (hard-coded preset)
 *   - Production days that have batches scheduled (pulled
 *     transparently so the master view matches the planner view)
 *
 * One screen, zoomable by scrolling. Click a month to jump to the
 * planner for that window.
 */
export default function MasterCalendarPage() {
  const campaigns = useCampaigns();
  const blocked = useBlockedDays();
  const productionDays = useProductionDays(400);

  const year = new Date().getUTCFullYear();
  const months = useMemo(() => buildYearGrid(year), [year]);

  const holidays = useMemo(() => AUSTRIAN_HOLIDAYS(year), [year]);

  const markersByDate = useMemo(() => {
    const m = new Map<string, Marker[]>();
    // Campaigns — add a marker every day from start to end.
    for (const c of campaigns) {
      if (!c.startDate || !c.endDate) continue;
      const cursor = new Date(c.startDate + "T00:00:00Z");
      const end = new Date(c.endDate + "T00:00:00Z");
      while (cursor.getTime() <= end.getTime()) {
        const iso = cursor.toISOString().slice(0, 10);
        const list = m.get(iso) ?? [];
        list.push({ kind: "campaign", label: c.name });
        m.set(iso, list);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    // Blocked days (legacy eventCalendar rows marked `blocked`).
    for (const b of blocked) {
      if (!b.startDate) continue;
      const cursor = new Date(b.startDate + "T00:00:00Z");
      const end = new Date((b.endDate ?? b.startDate) + "T00:00:00Z");
      while (cursor.getTime() <= end.getTime()) {
        const iso = cursor.toISOString().slice(0, 10);
        const list = m.get(iso) ?? [];
        list.push({ kind: "closure", label: b.name ?? "Closed" });
        m.set(iso, list);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    // Production days with at least one batch.
    for (const d of productionDays) {
      if (!d.date) continue;
      const iso = d.date.slice(0, 10);
      const list = m.get(iso) ?? [];
      list.push({ kind: "production", label: "Production" });
      m.set(iso, list);
    }
    // Austrian holidays.
    for (const h of holidays) {
      const list = m.get(h.date) ?? [];
      list.push({ kind: "holiday", label: h.name });
      m.set(h.date, list);
    }
    return m;
  }, [campaigns, blocked, productionDays, holidays]);

  return (
    <div>
      <PageHeader
        title={`Calendar · ${year}`}
        description="Campaigns, closures, public holidays, production days. Click a day to jump to the planner for that window."
      />

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {months.map((month) => (
          <MonthBlock
            key={month.monthNumber}
            month={month}
            markers={markersByDate}
          />
        ))}
      </section>

      <footer className="mt-6 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        <Legend colour="bg-[color:var(--accent-terracotta-ink)]">Campaign</Legend>
        <Legend colour="bg-[color:var(--color-status-warn)]">Closure</Legend>
        <Legend colour="bg-[color:var(--accent-blue-ink)]">Holiday</Legend>
        <Legend colour="bg-[color:var(--accent-sage-ink)]">Production day</Legend>
      </footer>
    </div>
  );
}

function MonthBlock({
  month,
  markers,
}: {
  month: MonthGrid;
  markers: Map<string, Marker[]>;
}) {
  return (
    <div
      className="border border-border bg-card p-4"
      style={{ borderRadius: 4 }}
    >
      <h3
        className="text-[13px] mb-3"
        style={{
          fontFamily: "var(--font-serif)",
          fontWeight: 500,
          letterSpacing: "-0.015em",
        }}
      >
        {month.label}
      </h3>
      <div className="grid grid-cols-7 gap-0.5 text-[10px]">
        {["M", "T", "W", "T", "F", "S", "S"].map((l, i) => (
          <span
            key={i}
            className="text-center text-muted-foreground uppercase"
            style={{ letterSpacing: "0.05em" }}
          >
            {l}
          </span>
        ))}
        {month.days.map((day, idx) => {
          const key = day.iso ?? "blank-" + idx;
          if (!day.iso) {
            return <span key={key} />;
          }
          const list = markers.get(day.iso) ?? [];
          return (
            <DayBox key={key} day={day.day} markers={list} />
          );
        })}
      </div>
    </div>
  );
}

function DayBox({ day, markers }: { day: number; markers: Marker[] }) {
  const hasCampaign = markers.some((m) => m.kind === "campaign");
  const hasClosure = markers.some((m) => m.kind === "closure");
  const hasHoliday = markers.some((m) => m.kind === "holiday");
  const hasProduction = markers.some((m) => m.kind === "production");
  const title = markers.map((m) => m.label).join(" · ");
  return (
    <span
      className="aspect-square flex flex-col items-center justify-center border border-border bg-background relative"
      title={title}
      style={{ borderRadius: 2 }}
    >
      <span className="text-[10px] text-foreground">{day}</span>
      {markers.length > 0 ? (
        <span className="absolute bottom-0.5 left-0.5 right-0.5 flex gap-[1px] justify-center">
          {hasCampaign ? <DotInline colour="bg-[color:var(--accent-terracotta-ink)]" /> : null}
          {hasClosure ? <DotInline colour="bg-[color:var(--color-status-warn)]" /> : null}
          {hasHoliday ? <DotInline colour="bg-[color:var(--accent-blue-ink)]" /> : null}
          {hasProduction ? <DotInline colour="bg-[color:var(--accent-sage-ink)]" /> : null}
        </span>
      ) : null}
    </span>
  );
}

function DotInline({ colour }: { colour: string }) {
  return <span className={"w-1 h-1 " + colour} style={{ borderRadius: 1 }} />;
}

function Legend({ colour, children }: { colour: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={"w-2 h-2 " + colour} style={{ borderRadius: 1 }} />
      <span
        className="uppercase"
        style={{ letterSpacing: "0.08em", fontWeight: 500 }}
      >
        {children}
      </span>
    </span>
  );
}

interface MonthGrid {
  label: string;
  monthNumber: number;
  days: Array<{ iso: string | null; day: number }>;
}

interface Marker {
  kind: "campaign" | "closure" | "holiday" | "production";
  label: string;
}

function buildYearGrid(year: number): MonthGrid[] {
  const months: MonthGrid[] = [];
  for (let m = 0; m < 12; m++) {
    const first = new Date(Date.UTC(year, m, 1));
    const label = first.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    const dow = first.getUTCDay(); // 0 = Sun
    const leadingBlanks = (dow + 6) % 7;
    const daysInMonth = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
    const days: MonthGrid["days"] = [];
    for (let i = 0; i < leadingBlanks; i++) days.push({ iso: null, day: 0 });
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = new Date(Date.UTC(year, m, d)).toISOString().slice(0, 10);
      days.push({ iso, day: d });
    }
    months.push({ label, monthNumber: m, days });
  }
  return months;
}

// Austrian public holidays — computed per year. Easter-derived days use
// the standard ecclesiastical algorithm so they stay accurate across years.
function AUSTRIAN_HOLIDAYS(year: number): Array<{ date: string; name: string }> {
  const easter = easterSunday(year);
  const addDays = (base: Date, n: number) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  return [
    { date: `${year}-01-01`, name: "Neujahr" },
    { date: `${year}-01-06`, name: "Heilige Drei Könige" },
    { date: addDays(easter, 1), name: "Ostermontag" },
    { date: `${year}-05-01`, name: "Staatsfeiertag" },
    { date: addDays(easter, 39), name: "Christi Himmelfahrt" },
    { date: addDays(easter, 50), name: "Pfingstmontag" },
    { date: addDays(easter, 60), name: "Fronleichnam" },
    { date: `${year}-08-15`, name: "Mariä Himmelfahrt" },
    { date: `${year}-10-26`, name: "Nationalfeiertag" },
    { date: `${year}-11-01`, name: "Allerheiligen" },
    { date: `${year}-12-08`, name: "Mariä Empfängnis" },
    { date: `${year}-12-25`, name: "Christtag" },
    { date: `${year}-12-26`, name: "Stefanitag" },
  ];
}

function easterSunday(year: number): Date {
  // Anonymous Gregorian algorithm.
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1; // 0-indexed
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month, day));
}
