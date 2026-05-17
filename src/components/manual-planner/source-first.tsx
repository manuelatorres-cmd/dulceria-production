"use client";

/**
 * Source-first manual planner UI per
 * MANUAL_PLANNER_SOURCE_FIRST_BATCH.md. Single file because the
 * components are tightly coupled and never reused elsewhere.
 *
 * Exports:
 *   - SourceList         (left column)
 *   - ItemList           (middle column)
 *   - SchedulePanel      (right column, contains CombinePreview + DayPicker)
 *   - WeekView           (full-width bottom)
 *   - ScheduledItemCard  (used inside WeekView)
 */

import { useEffect, useMemo, useState } from "react";
import type {
  SchedulableSource,
  ScheduledSourceCard,
  SourceItem,
  SourceKind,
} from "@/lib/manual-planner/source-types";
import type { CombineMathResult } from "@/lib/manual-planner/combine-math";

const SOURCE_COLORS: Record<SourceKind, { border: string; bg: string; pillBg: string; pillFg: string; label: string }> = {
  "restock-po": {
    border: "#5a3a8a",
    bg: "#f0ecf5",
    pillBg: "#5a3a8a",
    pillFg: "#fff",
    label: "Restock",
  },
  campaign: {
    border: "#8a5a1c",
    bg: "#fff8e6",
    pillBg: "#c79e1b",
    pillFg: "#3d2e0a",
    label: "Campaign",
  },
  "customer-order": {
    border: "#8a5a1c",
    bg: "#faf0e8",
    pillBg: "#8a5a1c",
    pillFg: "#fff",
    label: "B2B",
  },
  "online-bucket": {
    border: "#7a766f",
    bg: "#fff",
    pillBg: "#555",
    pillFg: "#fff",
    label: "Online",
  },
};

function shortDow(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "short",
  });
}
function dateLabel(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

// ─── SourceList (left column) ──────────────────────────────────────

export function SourceList({
  sources,
  selectedIds,
  onToggle,
  onClear,
}: {
  sources: SchedulableSource[];
  selectedIds: Set<string>;
  onToggle: (source: SchedulableSource) => void;
  onClear: () => void;
}) {
  const byGroup: Record<string, SchedulableSource[]> = {
    "Restock POs": sources.filter((s) => s.kind === "restock-po"),
    Campaigns: sources.filter((s) => s.kind === "campaign"),
    "Customer orders": sources.filter(
      (s) => s.kind === "customer-order" || s.kind === "online-bucket",
    ),
  };
  const selectedCount = sources.filter((s) =>
    selectedIds.has(`${s.kind}|${s.id}`),
  ).length;
  const totalItems = sources
    .filter((s) => selectedIds.has(`${s.kind}|${s.id}`))
    .reduce((s, src) => s + src.itemCount, 0);

  return (
    <aside
      style={{
        background: "var(--mp-card-bg)",
        border: "1px solid var(--mp-border-warm)",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        height: "100%",
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--mp-border-warm)",
          background: "var(--mp-page-bg)",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 0.4,
          textTransform: "uppercase",
          color: "var(--mp-text-muted)",
        }}
      >
        Sources
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {Object.entries(byGroup).map(([heading, list]) => (
          <div key={heading}>
            <div
              style={{
                padding: "8px 14px 4px",
                fontSize: 10.5,
                letterSpacing: 0.6,
                textTransform: "uppercase",
                color: "var(--mp-text-muted)",
                fontWeight: 700,
              }}
            >
              {heading}
            </div>
            {list.length === 0 ? (
              <p style={{ padding: "0 14px 6px", fontSize: 11, fontStyle: "italic", color: "var(--mp-text-muted)" }}>
                None open.
              </p>
            ) : (
              list.map((src) => {
                const key = `${src.kind}|${src.id}`;
                const checked = selectedIds.has(key);
                const palette = SOURCE_COLORS[src.kind];
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onToggle(src)}
                    style={{
                      display: "flex",
                      width: "100%",
                      gap: 8,
                      alignItems: "flex-start",
                      padding: "7px 14px",
                      background: checked ? "var(--mp-draft-tint)" : "transparent",
                      borderLeft: `3px solid ${checked ? palette.border : "transparent"}`,
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: "inherit",
                    }}
                  >
                    <input
                      type="checkbox"
                      readOnly
                      checked={checked}
                      style={{ marginTop: 2 }}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontWeight: 600, fontSize: 12.5 }}>{src.name}</span>
                        {src.isolated ? (
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 700,
                              padding: "1px 5px",
                              borderRadius: 3,
                              background: "var(--mp-rose, #993556)",
                              color: "#fff",
                            }}
                          >
                            ISOLATED
                          </span>
                        ) : null}
                      </span>
                      <span
                        style={{
                          display: "block",
                          fontSize: 10.5,
                          color: "var(--mp-text-muted)",
                          marginTop: 1,
                        }}
                      >
                        {src.itemCount} item{src.itemCount === 1 ? "" : "s"}
                        {src.dueDate ? ` · due ${dateLabel(src.dueDate)}` : ""}
                      </span>
                    </span>
                    <span
                      className="tabular-nums"
                      style={{
                        fontSize: 11,
                        padding: "1px 6px",
                        borderRadius: 4,
                        background:
                          src.priority === "urgent"
                            ? "var(--mp-blush)"
                            : "rgba(0,0,0,0.06)",
                        color:
                          src.priority === "urgent"
                            ? "var(--mp-rose, #993556)"
                            : "var(--mp-text-primary)",
                        fontWeight: 600,
                      }}
                    >
                      {src.itemCount}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        ))}
      </div>
      <div
        style={{
          padding: "8px 14px",
          borderTop: "1px solid var(--mp-border-warm)",
          background: "var(--mp-page-bg)",
          fontSize: 11.5,
          color: "var(--mp-text-muted)",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <span style={{ flex: 1 }}>
          {selectedCount} source{selectedCount === 1 ? "" : "s"} · {totalItems} item{totalItems === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={onClear}
          disabled={selectedCount === 0}
          style={{
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 4,
            border: "1px solid var(--mp-border-warm)",
            background: "transparent",
            cursor: selectedCount === 0 ? "not-allowed" : "pointer",
            opacity: selectedCount === 0 ? 0.5 : 1,
            fontFamily: "inherit",
          }}
        >
          Clear
        </button>
      </div>
    </aside>
  );
}

// ─── ItemList (middle column) ──────────────────────────────────────

export function ItemList({
  items,
  selectedSources,
  checkedItemIds,
  onToggleItem,
  onCheckAll,
  onUncheckAll,
  onMouldFilter,
  onCategoryFilter,
  search,
  onSearch,
}: {
  items: SourceItem[];
  selectedSources: SchedulableSource[];
  checkedItemIds: Set<string>;
  onToggleItem: (item: SourceItem) => void;
  onCheckAll: () => void;
  onUncheckAll: () => void;
  onMouldFilter: (cavities: number | null) => void;
  onCategoryFilter: (cat: "bar" | "praline" | null) => void;
  search: string;
  onSearch: (s: string) => void;
}) {
  const sourceLabel =
    selectedSources.length === 0
      ? "Select a source"
      : selectedSources.length === 1
      ? selectedSources[0].name
      : `${selectedSources.length} sources`;
  const dueDates = selectedSources
    .map((s) => s.dueDate)
    .filter((d): d is string => !!d)
    .sort();
  const earliestDue = dueDates[0];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.productName.toLowerCase().includes(q) ||
        it.mouldName.toLowerCase().includes(q),
    );
  }, [items, search]);

  return (
    <main
      style={{
        background: "var(--mp-card-bg)",
        border: "1px solid var(--mp-border-warm)",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        height: "100%",
      }}
    >
      <header
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--mp-border-warm)",
          background: "var(--mp-page-bg)",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{sourceLabel}</span>
          {earliestDue ? (
            <span style={{ fontSize: 11, color: "var(--mp-text-muted)" }}>
              earliest due {dateLabel(earliestDue)}
            </span>
          ) : null}
          <span style={{ flex: 1 }} />
          <span className="tabular-nums" style={{ fontSize: 11, color: "var(--mp-text-muted)" }}>
            {items.length} item{items.length === 1 ? "" : "s"}
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <FilterChip label="✓ All" onClick={onCheckAll} />
          <FilterChip label="○ None" onClick={onUncheckAll} />
          <FilterChip label="Only 40-cav" onClick={() => onMouldFilter(40)} />
          <FilterChip label="Only 3-cav" onClick={() => onMouldFilter(3)} />
          <FilterChip label="Only bars" onClick={() => onCategoryFilter("bar")} />
          <FilterChip label="Only pralines" onClick={() => onCategoryFilter("praline")} />
          <FilterChip label="Reset" onClick={() => { onMouldFilter(null); onCategoryFilter(null); }} />
        </div>
        <input
          type="search"
          placeholder="Search product or mould…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          style={{
            width: "100%",
            padding: "5px 9px",
            fontSize: 12,
            borderRadius: 5,
            border: "1px solid var(--mp-border-warm)",
            background: "var(--mp-card-bg)",
            fontFamily: "inherit",
          }}
        />
      </header>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {selectedSources.length === 0 ? (
          <p style={{ padding: 20, fontSize: 12, fontStyle: "italic", color: "var(--mp-text-muted)", textAlign: "center" }}>
            Select a source on the left to see its items.
          </p>
        ) : filtered.length === 0 ? (
          <p style={{ padding: 20, fontSize: 12, fontStyle: "italic", color: "var(--mp-text-muted)", textAlign: "center" }}>
            No items match the current filter.
          </p>
        ) : (
          filtered.map((it) => {
            const checked = checkedItemIds.has(it.sourceItemId);
            const palette = SOURCE_COLORS[it.sourceKind];
            return (
              <button
                key={it.sourceItemId}
                type="button"
                onClick={() => onToggleItem(it)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "20px 1fr 70px 80px 50px",
                  gap: 8,
                  width: "100%",
                  alignItems: "center",
                  padding: "6px 12px",
                  borderBottom: "1px solid var(--mp-border-warm)",
                  background: checked ? "var(--mp-draft-tint)" : "transparent",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: "inherit",
                  fontSize: 12.5,
                }}
              >
                <input type="checkbox" readOnly checked={checked} />
                <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {it.productName}
                  </span>
                  <span style={{ fontSize: 10.5, color: "var(--mp-text-muted)", display: "flex", gap: 6, alignItems: "center" }}>
                    <span
                      style={{
                        fontSize: 9.5,
                        fontWeight: 700,
                        padding: "1px 5px",
                        borderRadius: 3,
                        background: palette.pillBg,
                        color: palette.pillFg,
                        textTransform: "uppercase",
                        letterSpacing: 0.4,
                      }}
                    >
                      {palette.label}
                    </span>
                    <span>{it.productCategory}</span>
                  </span>
                </span>
                <span
                  className="tabular-nums"
                  style={{
                    fontSize: 10.5,
                    padding: "1px 6px",
                    borderRadius: 3,
                    background: "rgba(0,0,0,0.06)",
                    color: "var(--mp-text-primary)",
                    textAlign: "center",
                  }}
                >
                  {it.mouldCavities}-cav
                </span>
                <span className="tabular-nums" style={{ fontSize: 11.5, color: "var(--mp-text-muted)", textAlign: "right" }}>
                  {it.remainingQty} pcs
                </span>
                <span className="tabular-nums" style={{ fontSize: 11, fontWeight: 600, textAlign: "right" }}>
                  {it.fillsNeeded}f
                </span>
              </button>
            );
          })
        )}
      </div>
    </main>
  );
}

function FilterChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "3px 9px",
        fontSize: 11,
        borderRadius: 4,
        border: "1px solid var(--mp-border-warm)",
        background: "var(--mp-card-bg)",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );
}

// ─── SchedulePanel (right column) ──────────────────────────────────

export function SchedulePanel({
  math,
  weekAnchor,
  setWeekAnchor,
  selectedDay,
  setSelectedDay,
  scheduledByDate,
  capacityMinutesByDate,
  canSchedule,
  onSchedule,
  saving,
}: {
  math: CombineMathResult;
  weekAnchor: Date;
  setWeekAnchor: (d: Date) => void;
  selectedDay: string | null;
  setSelectedDay: (d: string | null) => void;
  scheduledByDate: Map<string, number>; // booked minutes per date
  capacityMinutesByDate: Map<string, number>;
  canSchedule: boolean;
  onSchedule: (date: string, opts: { ignoreCapacityWarn: boolean }) => void;
  saving: boolean;
}) {
  return (
    <aside
      style={{
        background: "var(--mp-card-bg)",
        border: "1px solid var(--mp-border-warm)",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 12,
        overflow: "hidden",
        height: "100%",
      }}
    >
      <CombinePreview math={math} />
      <DayPicker
        weekAnchor={weekAnchor}
        setWeekAnchor={setWeekAnchor}
        selectedDay={selectedDay}
        setSelectedDay={setSelectedDay}
        scheduledByDate={scheduledByDate}
        capacityMinutesByDate={capacityMinutesByDate}
      />
      <ScheduleButton
        math={math}
        selectedDay={selectedDay}
        canSchedule={canSchedule}
        saving={saving}
        onSchedule={onSchedule}
      />
      <p
        style={{
          fontSize: 11,
          color: "var(--mp-text-muted)",
          fontStyle: "italic",
          lineHeight: 1.4,
        }}
      >
        Step-by-step scheduling happens on Plan(week). Each batch&apos;s
        polish / shell / fill / cap / unmould lives there.
      </p>
    </aside>
  );
}

function CombinePreview({ math }: { math: CombineMathResult }) {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <section style={{ border: "1px solid var(--mp-border-warm)", borderRadius: 8, overflow: "hidden" }}>
      <header
        style={{
          padding: "8px 12px",
          background: "var(--mp-page-bg)",
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: "var(--mp-text-muted)",
        }}
      >
        Combine preview
      </header>
      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 12px", fontSize: 12, padding: 10 }}>
        <dt style={{ color: "var(--mp-text-muted)" }}>Items</dt>
        <dd className="tabular-nums">{math.itemCount}</dd>
        <dt style={{ color: "var(--mp-text-muted)" }}>Batches</dt>
        <dd className="tabular-nums">{math.batchCount}</dd>
        <dt style={{ color: "var(--mp-text-muted)" }}>Saved by mould-share</dt>
        <dd className="tabular-nums">{math.savedByMouldShare}</dd>
        <dt style={{ color: "var(--mp-text-muted)" }}>Active time</dt>
        <dd
          className="tabular-nums"
          style={{
            color: math.overCapacity ? "var(--mp-rose, #993556)" : "var(--mp-text-primary)",
            fontWeight: math.overCapacity ? 700 : 500,
          }}
        >
          {formatMinutes(math.totalActiveMinutes)}
          {math.overCapacity ? " · over capacity" : ""}
        </dd>
      </dl>
      {math.combines.length > 0 ? (
        <>
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            style={{
              padding: "4px 12px",
              fontSize: 11,
              background: "transparent",
              border: "none",
              borderTop: "1px solid var(--mp-border-warm)",
              cursor: "pointer",
              color: "var(--mp-text-muted)",
              fontFamily: "inherit",
              width: "100%",
              textAlign: "left",
            }}
          >
            {showDetails ? "▾ Hide details" : "▸ Show details"}
          </button>
          {showDetails ? (
            <ul style={{ margin: 0, padding: "4px 12px 10px 24px", fontSize: 11, listStyle: "disc" }}>
              {math.combines.map((c) => (
                <li key={c.mouldId} style={{ paddingTop: 2 }}>
                  {c.productNames.join(" + ")} → {c.mouldName} · {c.totalFills} fills
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function DayPicker({
  weekAnchor,
  setWeekAnchor,
  selectedDay,
  setSelectedDay,
  scheduledByDate,
  capacityMinutesByDate,
}: {
  weekAnchor: Date;
  setWeekAnchor: (d: Date) => void;
  selectedDay: string | null;
  setSelectedDay: (d: string | null) => void;
  scheduledByDate: Map<string, number>;
  capacityMinutesByDate: Map<string, number>;
}) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const weekDays = useMemo(() => buildWeekDays(weekAnchor), [weekAnchor]);
  return (
    <section style={{ border: "1px solid var(--mp-border-warm)", borderRadius: 8, padding: 10 }}>
      <header
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: "var(--mp-text-muted)",
          marginBottom: 6,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ flex: 1 }}>Day picker</span>
        <button
          type="button"
          onClick={() => {
            const d = new Date(weekAnchor);
            d.setDate(d.getDate() - 7);
            setWeekAnchor(d);
          }}
          style={miniBtn}
        >
          ←
        </button>
        <button
          type="button"
          onClick={() => setWeekAnchor(new Date())}
          style={miniBtn}
        >
          today
        </button>
        <button
          type="button"
          onClick={() => {
            const d = new Date(weekAnchor);
            d.setDate(d.getDate() + 7);
            setWeekAnchor(d);
          }}
          style={miniBtn}
        >
          →
        </button>
      </header>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {weekDays.map((iso) => {
          const isToday = iso === todayIso;
          const isSelected = iso === selectedDay;
          const minutes = scheduledByDate.get(iso) ?? 0;
          const cap = capacityMinutesByDate.get(iso) ?? 0;
          const closed = cap === 0;
          const isSunday = new Date(iso + "T00:00:00").getDay() === 0;
          const label = isSunday && closed ? "rest" : minutes > 0 ? formatMinutes(minutes) : closed ? "—" : "empty";
          return (
            <button
              key={iso}
              type="button"
              onClick={() => setSelectedDay(iso === selectedDay ? null : iso)}
              disabled={closed && !isSunday}
              style={{
                padding: "5px 4px",
                borderRadius: 4,
                border: isToday ? "1px solid #c79e1b" : "1px solid var(--mp-border-warm)",
                background: isSelected
                  ? "var(--mp-teal, #1c5651)"
                  : isToday
                  ? "#fff8e6"
                  : "var(--mp-card-bg)",
                color: isSelected ? "#fff" : "var(--mp-text-primary)",
                cursor: closed && !isSunday ? "not-allowed" : "pointer",
                opacity: closed && !isSunday ? 0.45 : 1,
                fontFamily: "inherit",
                fontSize: 10,
                display: "flex",
                flexDirection: "column",
                gap: 1,
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>
                {shortDow(iso)}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600 }} className="tabular-nums">
                {new Date(iso + "T00:00:00").getDate()}
              </span>
              <span style={{ fontSize: 9, opacity: 0.85 }}>{label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ScheduleButton({
  math,
  selectedDay,
  canSchedule,
  saving,
  onSchedule,
}: {
  math: CombineMathResult;
  selectedDay: string | null;
  canSchedule: boolean;
  saving: boolean;
  onSchedule: (date: string, opts: { ignoreCapacityWarn: boolean }) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  function handleClick(): void {
    if (!selectedDay) return;
    if (math.overCapacity) {
      const cap = 300; // mirrors DEFAULT_DAILY_CAPACITY in combine-math; UI hint only
      const ok = window.confirm(
        `Day capacity is ${formatMinutes(cap)}, this would use ${formatMinutes(math.totalActiveMinutes)}. Schedule anyway?`,
      );
      if (!ok) return;
    }
    if (selectedDay < today) {
      const ok = window.confirm(
        `${dateLabel(selectedDay)} is in the past — log as historical?`,
      );
      if (!ok) return;
    }
    onSchedule(selectedDay, { ignoreCapacityWarn: true });
  }

  const disabled = !canSchedule || !selectedDay || saving;
  const label = selectedDay
    ? `Schedule to ${shortDow(selectedDay)} ${dateLabel(selectedDay)}`
    : "Pick a day first";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={handleClick}
      style={{
        padding: "10px 12px",
        background: disabled ? "rgba(0,0,0,0.08)" : "var(--mp-teal, #1c5651)",
        color: disabled ? "var(--mp-text-muted)" : "#fff",
        border: "none",
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        textAlign: "left",
        fontFamily: "inherit",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <span>{saving ? "Scheduling…" : label}</span>
      <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.85 }}>
        creates {math.batchCount} batch{math.batchCount === 1 ? "" : "es"}
        {selectedDay ? ` · pins to ${dateLabel(selectedDay)}` : ""}
      </span>
    </button>
  );
}

const miniBtn: React.CSSProperties = {
  padding: "2px 6px",
  fontSize: 10,
  borderRadius: 3,
  border: "1px solid var(--mp-border-warm)",
  background: "var(--mp-card-bg)",
  cursor: "pointer",
  fontFamily: "inherit",
};

// ─── WeekView ───────────────────────────────────────────────────────

export function WeekView({
  weekAnchor,
  setWeekAnchor,
  cards,
  selectedDay,
}: {
  weekAnchor: Date;
  setWeekAnchor: (d: Date) => void;
  cards: ScheduledSourceCard[];
  selectedDay: string | null;
}) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const weekDays = useMemo(() => buildWeekDays(weekAnchor), [weekAnchor]);
  const cardsByDate = useMemo(() => {
    const m = new Map<string, ScheduledSourceCard[]>();
    for (const c of cards) {
      const arr = m.get(c.pinnedDate) ?? [];
      arr.push(c);
      m.set(c.pinnedDate, arr);
    }
    return m;
  }, [cards]);

  return (
    <section
      style={{
        background: "var(--mp-card-bg)",
        border: "1px solid var(--mp-border-warm)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <header
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--mp-border-warm)",
          background: "var(--mp-page-bg)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700 }}>Week view</span>
        <span style={{ fontSize: 11, color: "var(--mp-text-muted)" }}>
          {dateLabel(weekDays[0])} — {dateLabel(weekDays[6])}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => {
            const d = new Date(weekAnchor);
            d.setDate(d.getDate() - 7);
            setWeekAnchor(d);
          }}
          style={miniBtn}
        >
          ← prev
        </button>
        <button
          type="button"
          onClick={() => setWeekAnchor(new Date())}
          style={miniBtn}
        >
          today
        </button>
        <button
          type="button"
          onClick={() => {
            const d = new Date(weekAnchor);
            d.setDate(d.getDate() + 7);
            setWeekAnchor(d);
          }}
          style={miniBtn}
        >
          next →
        </button>
      </header>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
        {weekDays.map((iso) => {
          const isToday = iso === todayIso;
          const isDrop = iso === selectedDay;
          const isSunday = new Date(iso + "T00:00:00").getDay() === 0;
          const dayCards = cardsByDate.get(iso) ?? [];
          return (
            <div
              key={iso}
              style={{
                minHeight: 200,
                borderLeft: "1px solid var(--mp-border-warm)",
                background: isToday ? "#fff8e6" : "transparent",
                outline: isDrop ? "2px dashed #c79e1b" : "none",
                outlineOffset: -2,
                padding: 6,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  color: isToday ? "var(--mp-teal, #1c5651)" : "var(--mp-text-muted)",
                }}
              >
                {shortDow(iso)} {new Date(iso + "T00:00:00").getDate()}
                {isToday ? " · today" : ""}
              </div>
              {dayCards.length === 0 ? (
                <p
                  style={{
                    fontSize: 10,
                    fontStyle: "italic",
                    color: "var(--mp-text-muted)",
                    marginTop: 12,
                    textAlign: "center",
                  }}
                >
                  {isDrop ? "↓ Source lands here" : isSunday ? "rest day" : "no production"}
                </p>
              ) : (
                dayCards.map((card) => (
                  <ScheduledItemCard
                    key={`${card.sourceKind}|${card.sourceId}|${card.pinnedDate}`}
                    card={card}
                  />
                ))
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function ScheduledItemCard({ card }: { card: ScheduledSourceCard }) {
  const palette =
    card.sourceKind === "unscheduled"
      ? { border: "#999", bg: "#f5f5f5", pillBg: "#999", pillFg: "#fff", label: "no source" }
      : SOURCE_COLORS[card.sourceKind];
  const focusHref = `/plan?view=weekly&focusDate=${card.pinnedDate}&focusSourceId=${encodeURIComponent(card.sourceId)}`;
  return (
    <div
      style={{
        background: palette.bg,
        borderLeft: `3px solid ${palette.border}`,
        border: `1px solid ${palette.border}33`,
        borderRadius: 4,
        padding: "5px 7px",
        fontSize: 11,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <span
        style={{
          alignSelf: "flex-start",
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: 0.4,
          textTransform: "uppercase",
          padding: "1px 5px",
          borderRadius: 3,
          background: palette.pillBg,
          color: palette.pillFg,
        }}
      >
        {palette.label}
      </span>
      <span style={{ fontWeight: 600 }}>
        {card.sourceName}
        {card.isolated ? (
          <span
            style={{
              marginLeft: 4,
              fontSize: 9,
              fontWeight: 700,
              padding: "0 4px",
              borderRadius: 2,
              background: "var(--mp-rose, #993556)",
              color: "#fff",
            }}
          >
            ISO
          </span>
        ) : null}
      </span>
      <span style={{ fontSize: 10, color: "var(--mp-text-muted)" }}>
        {card.batchCount} batch{card.batchCount === 1 ? "" : "es"} ·{" "}
        {formatMinutes(card.totalActiveMinutes)} active
      </span>
      <a href={focusHref} style={{ fontSize: 10, color: "var(--mp-teal, #1c5651)" }}>
        → open in Plan(week)
      </a>
    </div>
  );
}

// ─── Shared helpers ────────────────────────────────────────────────

function buildWeekDays(anchor: Date): string[] {
  const d = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()));
  const dow = d.getUTCDay();
  const offset = (dow + 6) % 7; // start Monday
  d.setUTCDate(d.getUTCDate() - offset);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const x = new Date(d);
    x.setUTCDate(d.getUTCDate() + i);
    out.push(x.toISOString().slice(0, 10));
  }
  return out;
}

function formatMinutes(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return "0m";
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export { buildWeekDays as _buildWeekDays_for_tests };
