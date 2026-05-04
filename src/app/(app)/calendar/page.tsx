"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  useCampaigns,
  useBlockedDays,
  useProductionDays,
  useOrders,
} from "@/lib/hooks";
import { ChevronLeft, ChevronRight, Plus, Calendar as CalIcon } from "lucide-react";
import { BackButton } from "@/components/back-button";

/**
 * Master calendar — focused month view with a side panel showing the
 * selected day's items and quick-create routes.
 *
 * Data aggregated: campaigns, workshop closures, Austrian public holidays,
 * event-channel orders, and production days (from the scheduler). Each
 * surfaces as a coloured dot on the day; clicking a day populates the
 * side panel. No new "events" type — the panel routes to the existing
 * creation flows (orders / campaigns / settings → blocked days).
 */

const CARD = "bg-white/65 backdrop-blur-2xl border border-white/60 rounded-[18px] p-4 shadow-[0_1px_2px_rgba(16,18,24,0.04),0_8px_24px_rgba(16,18,24,0.05)]";
const INNER = "rounded-[12px] border border-border";

type MarkerKind = "campaign" | "closure" | "holiday" | "production" | "order";
interface Marker {
  kind: MarkerKind;
  label: string;
  href?: string;
}

const MARKER_COLOR: Record<MarkerKind, string> = {
  campaign:   "var(--accent-terracotta-ink)",
  closure:    "var(--accent-butter-ink)",
  holiday:    "var(--accent-blush-ink)",
  production: "var(--accent-sage-ink)",
  order:      "var(--accent-peach-ink)",
};

const MARKER_LABEL: Record<MarkerKind, string> = {
  campaign: "Campaign",
  closure: "Closure",
  holiday: "Holiday",
  production: "Production",
  order: "Event order",
};

export default function CalendarPage() {
  const campaigns = useCampaigns();
  const blocked = useBlockedDays();
  const productionDays = useProductionDays(400);
  const orders = useOrders();

  // Focused month — starts at today's month. Arrows shift ±1.
  const today = new Date();
  const todayIso = toIsoDate(today);
  const [focusYear, setFocusYear] = useState(today.getFullYear());
  const [focusMonth, setFocusMonth] = useState(today.getMonth()); // 0-indexed
  const [selectedIso, setSelectedIso] = useState<string>(todayIso);

  const markersByDate = useMemo(() => {
    const m = new Map<string, Marker[]>();
    for (const c of campaigns) {
      if (!c.startDate || !c.endDate) continue;
      const cursor = new Date(c.startDate + "T00:00:00Z");
      const end = new Date(c.endDate + "T00:00:00Z");
      while (cursor.getTime() <= end.getTime()) {
        const iso = cursor.toISOString().slice(0, 10);
        const list = m.get(iso) ?? [];
        list.push({ kind: "campaign", label: c.name, href: c.id ? `/campaigns/${c.id}` : "/campaigns" });
        m.set(iso, list);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    for (const b of blocked) {
      if (!b.startDate) continue;
      const cursor = new Date(b.startDate + "T00:00:00Z");
      const end = new Date((b.endDate ?? b.startDate) + "T00:00:00Z");
      while (cursor.getTime() <= end.getTime()) {
        const iso = cursor.toISOString().slice(0, 10);
        const list = m.get(iso) ?? [];
        list.push({ kind: "closure", label: b.name ?? "Closed", href: "/settings" });
        m.set(iso, list);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    for (const d of productionDays) {
      if (!d.date) continue;
      const iso = d.date.slice(0, 10);
      const list = m.get(iso) ?? [];
      list.push({ kind: "production", label: "Production day", href: "/plan" });
      m.set(iso, list);
    }
    for (const o of orders) {
      if (o.channel !== "event") continue;
      if (!o.deadline) continue;
      const iso = o.deadline.slice(0, 10);
      const list = m.get(iso) ?? [];
      list.push({
        kind: "order",
        label: o.customerName || o.eventName || "(event order)",
        href: o.id ? `/orders/${o.id}` : "/orders",
      });
      m.set(iso, list);
    }
    const year = focusYear;
    for (const h of AUSTRIAN_HOLIDAYS(year)) {
      const list = m.get(h.date) ?? [];
      list.push({ kind: "holiday", label: h.name });
      m.set(h.date, list);
    }
    // Adjacent years — holidays spanning Jan/Dec views.
    for (const h of AUSTRIAN_HOLIDAYS(year - 1)) {
      const list = m.get(h.date) ?? [];
      list.push({ kind: "holiday", label: h.name });
      m.set(h.date, list);
    }
    for (const h of AUSTRIAN_HOLIDAYS(year + 1)) {
      const list = m.get(h.date) ?? [];
      list.push({ kind: "holiday", label: h.name });
      m.set(h.date, list);
    }
    return m;
  }, [campaigns, blocked, productionDays, orders, focusYear]);

  function shiftMonth(delta: number) {
    const d = new Date(focusYear, focusMonth + delta, 1);
    setFocusYear(d.getFullYear());
    setFocusMonth(d.getMonth());
  }

  const focusMonthLabel = new Date(focusYear, focusMonth, 1)
    .toLocaleDateString("de-AT", { month: "long", year: "numeric" });

  const focusedGrid = useMemo(() => buildMonthGrid(focusYear, focusMonth), [focusYear, focusMonth]);
  const nextGrid = useMemo(() => {
    const n = new Date(focusYear, focusMonth + 1, 1);
    return buildMonthGrid(n.getFullYear(), n.getMonth());
  }, [focusYear, focusMonth]);
  const next2Grid = useMemo(() => {
    const n = new Date(focusYear, focusMonth + 2, 1);
    return buildMonthGrid(n.getFullYear(), n.getMonth());
  }, [focusYear, focusMonth]);

  const selectedMarkers = markersByDate.get(selectedIso) ?? [];
  const selectedDate = new Date(selectedIso + "T12:00:00");
  const selectedLabel = selectedDate.toLocaleDateString("de-AT", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="px-3 sm:px-5 pt-5 pb-10 max-w-[1700px] mx-auto">
      <div className="mb-2">
        <BackButton />
      </div>
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <h1
          className="text-[26px] tracking-[-0.025em]"
          style={{ fontFamily: "var(--font-serif)", fontWeight: 400 }}
        >
          Calendar
        </h1>
        <span className="text-[12px] text-muted-foreground">
          Campaigns · event orders · closures · holidays · production days
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => shiftMonth(-1)}
            className="rounded-full border border-border bg-card w-8 h-8 flex items-center justify-center hover:border-foreground/30"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setFocusYear(today.getFullYear()); setFocusMonth(today.getMonth()); setSelectedIso(todayIso); }}
            className="rounded-full border border-border bg-card px-3 h-8 text-[12px] hover:border-foreground/30"
          >
            Today
          </button>
          <button
            onClick={() => shiftMonth(1)}
            className="rounded-full border border-border bg-card w-8 h-8 flex items-center justify-center hover:border-foreground/30"
            aria-label="Next month"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main: focused month + side panel */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-3 mb-3">
        <section className={CARD}>
          <h2
            className="text-[20px] mb-3 tracking-[-0.02em]"
            style={{ fontFamily: "var(--font-serif)", fontWeight: 500 }}
          >
            {focusMonthLabel}
          </h2>
          <MonthGrid
            grid={focusedGrid}
            markers={markersByDate}
            selectedIso={selectedIso}
            onSelect={setSelectedIso}
            large
          />
          <LegendRow />
        </section>

        <section className={CARD}>
          <h3 className="text-[10px] tracking-[0.08em] uppercase text-muted-foreground font-semibold mb-2">
            Selected day
          </h3>
          <p
            className="text-[17px] mb-3 tracking-[-0.02em]"
            style={{ fontFamily: "var(--font-serif)", fontWeight: 500 }}
          >
            {selectedLabel}
            {selectedIso === todayIso && (
              <span className="ml-2 text-[11px] text-muted-foreground font-normal">· today</span>
            )}
          </p>

          {selectedMarkers.length === 0 ? (
            <div className={`${INNER} bg-muted/40 px-3 py-5 text-center text-sm text-muted-foreground mb-3`}>
              Nothing scheduled.
            </div>
          ) : (
            <ul className="space-y-1.5 mb-3">
              {selectedMarkers.map((mk, i) => (
                <li key={i} className={`${INNER} bg-muted/40 px-3 py-2 flex items-start gap-2`}>
                  <span
                    className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                    style={{ background: MARKER_COLOR[mk.kind] }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground font-medium">
                      {MARKER_LABEL[mk.kind]}
                    </p>
                    {mk.href ? (
                      <Link href={mk.href} className="text-[13px] truncate block hover:underline-offset-2 hover:underline">
                        {mk.label}
                      </Link>
                    ) : (
                      <p className="text-[13px] truncate">{mk.label}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-1.5">
            <p className="text-[10px] tracking-[0.08em] uppercase text-muted-foreground font-semibold mb-1">
              Add for this day
            </p>
            <QuickAdd
              href="/orders"
              label="Event order"
              sub="For a customer gig on this date"
            />
            <QuickAdd
              href="/campaigns"
              label="Campaign"
              sub="Seasonal push (Easter, Mother's Day…)"
            />
            <QuickAdd
              href="/settings"
              label="Block this day"
              sub="Workshop closed / teaching / vacation"
            />
          </div>
        </section>
      </div>

      {/* Strip of next 2 months */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <MiniMonth grid={nextGrid} markers={markersByDate} onPick={(iso) => { setSelectedIso(iso); setFocusYear(new Date(iso).getFullYear()); setFocusMonth(new Date(iso).getMonth()); }} />
        <MiniMonth grid={next2Grid} markers={markersByDate} onPick={(iso) => { setSelectedIso(iso); setFocusYear(new Date(iso).getFullYear()); setFocusMonth(new Date(iso).getMonth()); }} />
      </div>
    </div>
  );
}

function QuickAdd({ href, label, sub }: { href: string; label: string; sub: string }) {
  return (
    <Link
      href={href}
      className={`${INNER} flex items-center gap-3 px-3 py-2 bg-card hover:bg-muted/40 transition-colors`}
    >
      <Plus className="w-3.5 h-3.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-medium">{label}</p>
        <p className="text-[10.5px] text-muted-foreground">{sub}</p>
      </div>
    </Link>
  );
}

function MonthGrid({
  grid, markers, selectedIso, onSelect, large,
}: {
  grid: BuiltMonth;
  markers: Map<string, Marker[]>;
  selectedIso: string;
  onSelect: (iso: string) => void;
  large?: boolean;
}) {
  const cellSize = large ? "min-h-[62px]" : "min-h-[38px]";
  const dayFont = large ? "text-[13px]" : "text-[11px]";
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((l) => (
          <span
            key={l}
            className="text-[10px] tracking-[0.06em] uppercase text-muted-foreground text-center font-medium"
          >
            {l}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {grid.cells.map((cell, idx) => {
          if (!cell.iso) {
            return <div key={"b" + idx} className={`${cellSize}`} />;
          }
          const list = markers.get(cell.iso) ?? [];
          const isSelected = cell.iso === selectedIso;
          const isToday = cell.iso === toIsoDate(new Date());
          const kinds = [...new Set(list.map((m) => m.kind))];
          return (
            <button
              key={cell.iso}
              onClick={() => onSelect(cell.iso!)}
              className={`${cellSize} rounded-[8px] border text-left flex flex-col items-stretch px-1.5 py-1 transition-colors ${
                isSelected
                  ? "border-foreground bg-card"
                  : isToday
                  ? "border-[var(--accent-terracotta-ink)]/60 bg-card"
                  : "border-border bg-muted/30 hover:bg-muted/50"
              }`}
              title={list.map((m) => `${MARKER_LABEL[m.kind]}: ${m.label}`).join(" · ") || undefined}
            >
              <span className={`${dayFont} ${isToday ? "font-semibold" : "font-medium"} ${isSelected ? "text-foreground" : ""}`}>
                {cell.day}
              </span>
              {kinds.length > 0 && (
                <span className="mt-auto flex gap-1 pt-1">
                  {kinds.map((k) => (
                    <span
                      key={k}
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: MARKER_COLOR[k] }}
                    />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MiniMonth({
  grid, markers, onPick,
}: {
  grid: BuiltMonth;
  markers: Map<string, Marker[]>;
  onPick: (iso: string) => void;
}) {
  return (
    <section className={CARD}>
      <h3
        className="text-[13px] mb-2 tracking-[-0.015em]"
        style={{ fontFamily: "var(--font-serif)", fontWeight: 500 }}
      >
        {grid.label}
      </h3>
      <MonthGrid
        grid={grid}
        markers={markers}
        selectedIso=""
        onSelect={onPick}
      />
    </section>
  );
}

function LegendRow() {
  return (
    <div className="mt-3 flex flex-wrap gap-3 text-[10.5px] text-muted-foreground">
      {(["campaign", "order", "production", "closure", "holiday"] as MarkerKind[]).map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: MARKER_COLOR[k] }} />
          <span>{MARKER_LABEL[k]}</span>
        </span>
      ))}
    </div>
  );
}

// ─── grid helpers ───────────────────────────────────────────────────

interface BuiltMonth {
  label: string;
  cells: Array<{ iso: string | null; day: number }>;
}

function buildMonthGrid(year: number, monthIdx: number): BuiltMonth {
  const first = new Date(year, monthIdx, 1);
  const label = first.toLocaleDateString("de-AT", { month: "long", year: "numeric" });
  const dow = first.getDay(); // 0 = Sun
  const leadingBlanks = (dow + 6) % 7; // Monday-start
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const cells: BuiltMonth["cells"] = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push({ iso: null, day: 0 });
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = toIsoDate(new Date(year, monthIdx, d));
    cells.push({ iso, day: d });
  }
  return { label, cells };
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Austrian public holidays — keyed per year. Easter-derived days use
// the Gregorian algorithm so they stay accurate year-to-year.
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
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month, day));
}

// Lucide CalIcon reserved for a future "today" pill variant.
void CalIcon;
