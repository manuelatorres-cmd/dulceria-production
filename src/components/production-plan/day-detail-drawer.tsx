"use client";

import { useEffect, useMemo, useState } from "react";
import {
  IconX as X,
  IconAlertTriangle as AlertTriangle,
  IconLock as Lock,
  IconHourglass as Hourglass,
  IconCircleCheck as CheckCircle,
  IconCalendar as Calendar,
} from "@tabler/icons-react";
import type {
  Mould,
  PlanProduct,
  Product,
  ProductionDay,
  ProductionDayLineItem,
  ProductionPlan,
  ProductionStep,
} from "@/types";
import {
  computeHourlyBreakdown,
  type HourlyEntry,
} from "@/lib/production-plan/compute-hourly-breakdown";
import { formatMinutes } from "./format-minutes";
import { effectiveDailyCapacityMinutes } from "@/lib/capacity";
import type {
  CapacityConfig,
  EventCalendarEntry,
  Person,
  PersonUnavailability,
} from "@/types";
import { RescheduleDayModal } from "./reschedule-day-modal";

const NOTES_KEY_PREFIX = "dulceria.plan-v2.day-notes.v1.";

function loadNote(date: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(NOTES_KEY_PREFIX + date) ?? "";
  } catch {
    return "";
  }
}
function saveNote(date: string, note: string): void {
  if (typeof window === "undefined") return;
  try {
    if (note) window.localStorage.setItem(NOTES_KEY_PREFIX + date, note);
    else window.localStorage.removeItem(NOTES_KEY_PREFIX + date);
  } catch {
    /* quota — ignore */
  }
}

export interface DayDetailDrawerProps {
  iso: string;
  onClose: () => void;
  productionDays: ProductionDay[];
  lineItems: ProductionDayLineItem[];
  plans: ProductionPlan[];
  planProducts: PlanProduct[];
  productionSteps: ProductionStep[];
  products: Product[];
  moulds: Mould[];
  capacityConfig: CapacityConfig | null;
  people: Person[];
  unavailability: PersonUnavailability[];
  blockedDays: EventCalendarEntry[];
  conflicts: { message: string }[];
  /** Phase 5 ships "mark as worked" via localStorage flag — DB write
   *  arrives once useUpdateLineItem hooks land; for now this hook is a
   *  no-op when undefined. */
  onMarkAsWorked?: (iso: string) => Promise<void> | void;
  onReschedule?: (sourceDate: string, targetDate: string, pin: boolean) => Promise<void> | void;
}

export function DayDetailDrawer(props: DayDetailDrawerProps) {
  const {
    iso,
    onClose,
    productionDays,
    lineItems,
    plans,
    planProducts,
    productionSteps,
    products,
    capacityConfig,
    people,
    unavailability,
    blockedDays,
    conflicts,
    onMarkAsWorked,
    onReschedule,
  } = props;

  const [note, setNote] = useState<string>("");
  const [rescheduleOpen, setRescheduleOpen] = useState<boolean>(false);
  const [working, setWorking] = useState<boolean>(false);

  useEffect(() => {
    setNote(loadNote(iso));
  }, [iso]);
  useEffect(() => {
    saveNote(iso, note);
  }, [iso, note]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dayDateById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of productionDays) {
      if (d.id && d.date) m.set(d.id, d.date.slice(0, 10));
    }
    return m;
  }, [productionDays]);

  const dayLineItems = useMemo(
    () => lineItems.filter((li) => dayDateById.get(li.productionDayId) === iso),
    [lineItems, dayDateById, iso],
  );

  const breakdown: HourlyEntry[] = useMemo(
    () =>
      computeHourlyBreakdown({
        date: iso,
        lineItems: dayLineItems,
        plans,
        planProducts,
        steps: productionSteps,
        products,
      }),
    [iso, dayLineItems, plans, planProducts, productionSteps, products],
  );

  const plannedMinutes = useMemo(
    () => dayLineItems.reduce((s, li) => s + (li.plannedMinutes ?? 0), 0),
    [dayLineItems],
  );
  const capacityMinutes = useMemo(
    () =>
      effectiveDailyCapacityMinutes(
        new Date(iso + "T12:00:00"),
        capacityConfig,
        people,
        unavailability,
        blockedDays,
      ),
    [iso, capacityConfig, people, unavailability, blockedDays],
  );
  const pct =
    capacityMinutes > 0 ? Math.round((plannedMinutes / capacityMinutes) * 100) : 0;

  const dateLabel = new Date(iso + "T00:00:00").toLocaleDateString("de-AT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  async function handleMarkAsWorked() {
    if (!onMarkAsWorked) return;
    setWorking(true);
    try {
      await onMarkAsWorked(iso);
      onClose();
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Day detail · ${dateLabel}`}
        className="fixed inset-0 z-40"
      >
        <div
          className="absolute inset-0"
          style={{ background: "rgba(0,0,0,0.25)" }}
          onClick={onClose}
        />
        <aside
          className="weekly-plan-v2 absolute right-0 top-0 h-full overflow-y-auto"
          style={{
            width: "min(480px, 100%)",
            background: "var(--wp-card-bg)",
            borderLeft: "0.5px solid var(--wp-border-warm)",
            color: "var(--wp-text-primary)",
          }}
        >
          <div
            className="px-5 pt-4 pb-3 flex items-start justify-between"
            style={{ borderBottom: "0.5px solid var(--wp-border-warm)" }}
          >
            <div>
              <h2
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: 20,
                  fontWeight: 600,
                  letterSpacing: "-0.015em",
                  marginBottom: 4,
                }}
              >
                {dateLabel}
              </h2>
              <p className="text-[12px] italic" style={{ color: "var(--wp-text-muted)" }}>
                {formatMinutes(plannedMinutes)} planned · {formatMinutes(capacityMinutes)} capacity
                {capacityMinutes > 0 && ` · ${pct}%`}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="close"
              style={{ color: "var(--wp-text-muted)" }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <Section title="Hour by hour">
            {breakdown.length === 0 ? (
              <p className="text-[12px] italic" style={{ color: "var(--wp-text-muted)" }}>
                No work scheduled.
              </p>
            ) : (
              <ul className="space-y-1">
                {breakdown.map((e, i) => (
                  <li
                    key={i}
                    className="flex items-baseline gap-2 text-[12px]"
                    style={{ color: e.isPassive ? "var(--wp-text-muted)" : "var(--wp-text-primary)" }}
                  >
                    <span
                      className="tabular-nums shrink-0"
                      style={{ color: "var(--wp-text-muted)", width: 48 }}
                    >
                      {e.startTime}
                    </span>
                    <span className="inline-flex items-center gap-1 shrink-0">
                      {e.isLocked && !e.isPassive && (
                        <Lock className="w-3 h-3" style={{ color: "var(--wp-teal)" }} />
                      )}
                      {e.isPassive && <Hourglass className="w-3 h-3" />}
                    </span>
                    <span className="flex-1 truncate">
                      <span style={{ fontWeight: 500 }}>{e.stepName}</span>
                      <span style={{ color: "var(--wp-text-muted)" }}> · {e.productName}</span>
                    </span>
                    <span
                      className="tabular-nums shrink-0"
                      style={{ color: "var(--wp-text-muted)" }}
                    >
                      {e.durationMinutes > 0
                        ? e.isPassive
                          ? `${formatMinutes(e.durationMinutes)} passive`
                          : formatMinutes(e.durationMinutes)
                        : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {conflicts.length > 0 && (
            <Section title={`Conflicts · ${conflicts.length}`}>
              <ul className="space-y-1">
                {conflicts.map((c, i) => (
                  <li
                    key={i}
                    className="text-[12px] inline-flex items-start gap-1"
                    style={{ color: "var(--wp-rose)" }}
                  >
                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>{c.message}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Day notes">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              placeholder="Anything to remember about this day…"
              className="w-full text-[12px] p-2"
              style={{
                border: "0.5px solid var(--wp-border-warm)",
                background: "var(--wp-card-bg)",
                color: "var(--wp-text-primary)",
                borderRadius: 4,
                resize: "vertical",
              }}
            />
            <p
              className="mt-1 text-[10.5px] italic"
              style={{ color: "var(--wp-text-muted)" }}
            >
              Saved in this browser — DB persistence ships in phase 5.5.
            </p>
          </Section>

          <div
            className="px-5 py-3 flex items-center gap-2 sticky bottom-0"
            style={{
              background: "var(--wp-card-bg)",
              borderTop: "0.5px solid var(--wp-border-warm)",
            }}
          >
            {onMarkAsWorked && (
              <button
                type="button"
                onClick={handleMarkAsWorked}
                disabled={working || dayLineItems.length === 0}
                className="flex-1 px-3 py-1.5 text-[12px] inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                style={{
                  background: "var(--wp-teal)",
                  color: "#ffffff",
                  border: "0.5px solid var(--wp-teal)",
                  borderRadius: 4,
                }}
              >
                <CheckCircle className="w-3.5 h-3.5" />
                {working ? "Saving…" : "Mark as worked"}
              </button>
            )}
            {onReschedule && (
              <button
                type="button"
                onClick={() => setRescheduleOpen(true)}
                disabled={dayLineItems.length === 0}
                className="px-3 py-1.5 text-[12px] inline-flex items-center gap-1.5 disabled:opacity-50"
                style={{
                  border: "0.5px solid var(--wp-border-warm)",
                  background: "var(--wp-card-bg)",
                  color: "var(--wp-text-primary)",
                  borderRadius: 4,
                }}
              >
                <Calendar className="w-3.5 h-3.5" />
                Reschedule day
              </button>
            )}
          </div>
        </aside>
      </div>
      {rescheduleOpen && onReschedule && (
        <RescheduleDayModal
          sourceDate={iso}
          defaultTarget={iso}
          onCancel={() => setRescheduleOpen(false)}
          onConfirm={async (target, pin) => {
            await onReschedule(iso, target, pin);
            setRescheduleOpen(false);
            onClose();
          }}
        />
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="px-5 py-4"
      style={{ borderBottom: "0.5px solid var(--wp-border-warm)" }}
    >
      <h3
        className="text-[10.5px] uppercase mb-2"
        style={{
          color: "var(--wp-text-muted)",
          letterSpacing: "0.08em",
          fontWeight: 600,
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}
