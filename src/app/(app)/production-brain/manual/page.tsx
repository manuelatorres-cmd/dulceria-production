"use client";

/**
 * Source-first manual planner per MANUAL_PLANNER_SOURCE_FIRST_BATCH.md.
 *
 * Three columns top: SourceList (280px) | ItemList (flex) | SchedulePanel (320px).
 * Week view (full-width) below.
 *
 * Wipes the workspace / tray / pool / week-strip layer that lived here
 * across 6 prior batches. The page renders sources → items → schedule
 * day. Stage scheduling lives on Plan(week).
 */

import { useEffect, useMemo, useState } from "react";
import {
  useCapacityConfig,
  usePeople,
  usePersonUnavailability,
  useEventCalendar,
  useProductCategories,
  useProductionSteps,
  useAllProductionDayLineItems,
  useProductionDays,
} from "@/lib/hooks";
import { effectiveDailyCapacityMinutes } from "@/lib/capacity";
import {
  useSchedulableSources,
  useSourceItems,
  useScheduledSources,
} from "@/lib/manual-planner/source-hooks";
import {
  computeCombineMath,
  type CombineMathResult,
} from "@/lib/manual-planner/combine-math";
import {
  scheduleSourceToDay,
} from "@/lib/manual-planner/schedule-source-to-day";
import type {
  SchedulableSource,
  SourceItem,
} from "@/lib/manual-planner/source-types";
import {
  SourceList,
  ItemList,
  SchedulePanel,
  WeekView,
} from "@/components/manual-planner/source-first";
import { BackButton } from "@/components/back-button";
import { IconAlertTriangle as AlertTriangle } from "@tabler/icons-react";

function startOfWeekMonday(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = out.getUTCDay();
  const offset = (dow + 6) % 7;
  out.setUTCDate(out.getUTCDate() - offset);
  return out;
}

export default function ManualPlannerPage() {
  const [weekAnchor, setWeekAnchor] = useState<Date>(new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const capacityConfig = useCapacityConfig();
  const people = usePeople();
  const personUnavailability = usePersonUnavailability();
  const eventCalendar = useEventCalendar();
  const productCategories = useProductCategories();
  const productionSteps = useProductionSteps();
  const dayLineItems = useAllProductionDayLineItems();
  const productionDays = useProductionDays(120);

  const sourcesQuery = useSchedulableSources();
  const sources: SchedulableSource[] = useMemo(() => sourcesQuery.data ?? [], [sourcesQuery.data]);

  // Selection state
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const selectedSources = useMemo(
    () => sources.filter((s) => selectedSourceIds.has(`${s.kind}|${s.id}`)),
    [sources, selectedSourceIds],
  );

  const itemsQuery = useSourceItems(selectedSources);
  const items: SourceItem[] = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);

  const [checkedItemIds, setCheckedItemIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  // When selected sources change, default-check every item that's still
  // present in the items query. Drops checks for items no longer in the
  // current selection.
  useEffect(() => {
    const validIds = new Set(items.map((it) => it.sourceItemId));
    setCheckedItemIds((cur) => {
      // First-time fill: when there are items but no checks yet, default to ALL.
      if (cur.size === 0 && items.length > 0) return new Set(validIds);
      // Prune stale entries.
      const next = new Set<string>();
      for (const id of cur) if (validIds.has(id)) next.add(id);
      return next;
    });
  }, [items]);

  const checkedItems = useMemo(
    () => items.filter((it) => checkedItemIds.has(it.sourceItemId)),
    [items, checkedItemIds],
  );

  // Combine math runs reactively.
  const todayCapMinutes = useMemo(
    () =>
      effectiveDailyCapacityMinutes(
        new Date(),
        capacityConfig,
        people,
        personUnavailability,
        eventCalendar,
      ) || null,
    [capacityConfig, people, personUnavailability, eventCalendar],
  );
  const math: CombineMathResult = useMemo(
    () =>
      computeCombineMath(checkedItems, {
        productCategories,
        productionSteps,
        dailyActiveCapacityMinutes: todayCapMinutes,
      }),
    [checkedItems, productCategories, productionSteps, todayCapMinutes],
  );

  // Capacity-by-date for the day picker subtitle.
  const dayIdByDate = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of productionDays) if (d.id && d.date) m.set(d.date.slice(0, 10), d.id);
    return m;
  }, [productionDays]);
  const scheduledMinutesByDate = useMemo(() => {
    const m = new Map<string, number>();
    const dateById = new Map<string, string>();
    for (const d of productionDays) if (d.id && d.date) dateById.set(d.id, d.date.slice(0, 10));
    for (const li of dayLineItems) {
      const date = dateById.get(li.productionDayId);
      if (!date) continue;
      m.set(date, (m.get(date) ?? 0) + (li.plannedMinutes ?? 0));
    }
    return m;
  }, [dayLineItems, productionDays]);
  const capacityMinutesByDate = useMemo(() => {
    const m = new Map<string, number>();
    const start = startOfWeekMonday(weekAnchor);
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const iso = d.toISOString().slice(0, 10);
      m.set(
        iso,
        effectiveDailyCapacityMinutes(
          d,
          capacityConfig,
          people,
          personUnavailability,
          eventCalendar,
        ),
      );
    }
    return m;
  }, [weekAnchor, capacityConfig, people, personUnavailability, eventCalendar]);

  // WeekView data
  const weekStart = useMemo(() => startOfWeekMonday(weekAnchor), [weekAnchor]);
  const weekEnd = useMemo(() => {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + 6);
    return d;
  }, [weekStart]);
  const scheduledSourcesQuery = useScheduledSources(weekStart, weekEnd);
  const scheduledCards = scheduledSourcesQuery.data ?? [];

  // Handlers
  function toggleSource(src: SchedulableSource): void {
    const key = `${src.kind}|${src.id}`;
    setSelectedSourceIds((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    // Clear checked items on selection change to avoid stale ticks.
    setCheckedItemIds(new Set());
  }
  function clearSources(): void {
    setSelectedSourceIds(new Set());
    setCheckedItemIds(new Set());
  }
  function toggleItem(it: SourceItem): void {
    setCheckedItemIds((cur) => {
      const next = new Set(cur);
      if (next.has(it.sourceItemId)) next.delete(it.sourceItemId);
      else next.add(it.sourceItemId);
      return next;
    });
  }
  function checkAll(): void {
    setCheckedItemIds(new Set(items.map((it) => it.sourceItemId)));
  }
  function uncheckAll(): void {
    setCheckedItemIds(new Set());
  }
  function applyMouldFilter(cavities: number | null): void {
    if (cavities == null) {
      setCheckedItemIds(new Set(items.map((it) => it.sourceItemId)));
      return;
    }
    setCheckedItemIds(
      new Set(items.filter((it) => it.mouldCavities === cavities).map((it) => it.sourceItemId)),
    );
  }
  function applyCategoryFilter(cat: "bar" | "praline" | null): void {
    if (cat == null) {
      setCheckedItemIds(new Set(items.map((it) => it.sourceItemId)));
      return;
    }
    setCheckedItemIds(
      new Set(
        items
          .filter((it) => it.productCategory.toLowerCase().includes(cat))
          .map((it) => it.sourceItemId),
      ),
    );
  }

  async function handleSchedule(date: string, _opts: { ignoreCapacityWarn: boolean }): Promise<void> {
    if (checkedItems.length === 0 || saving) return;
    setSaving(true);
    setSaveErr(null);
    try {
      const todayIso = new Date().toISOString().slice(0, 10);
      const historical = date < todayIso;
      await scheduleSourceToDay(checkedItems, date, { historical });
      // Optimistic UI: clear selection + day, force refetch via invalidation
      // (which scheduleSourceToDay already does).
      setCheckedItemIds(new Set());
      setSelectedDay(null);
      // If source itemCount drops to zero it'll disappear on refetch.
    } catch (err) {
      setSaveErr(`Schedule failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ds manual-planner-v2" style={{ minHeight: "100vh", background: "var(--ds-page-bg)", padding: 16 }}>
      <div style={{ marginBottom: 8 }}>
        <BackButton />
      </div>
      <header style={{ marginBottom: 12 }}>
        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            color: "var(--mp-text-primary)",
          }}
        >
          Manual planner
        </h1>
        <p style={{ fontSize: 12, color: "var(--mp-text-muted)", marginTop: 2 }}>
          Demand → day · combine where moulds allow.
        </p>
      </header>

      {saveErr ? (
        <div
          style={{
            marginBottom: 10,
            padding: "6px 12px",
            border: "1px solid #e8c5b1",
            background: "var(--mp-blush)",
            color: "#8a4530",
            borderRadius: 6,
            fontSize: 12,
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span style={{ flex: 1 }}>{saveErr}</span>
          <button
            type="button"
            onClick={() => setSaveErr(null)}
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "280px minmax(0,1fr) 320px",
          gap: 12,
          alignItems: "stretch",
          minHeight: 520,
          marginBottom: 12,
        }}
      >
        <SourceList
          sources={sources}
          selectedIds={selectedSourceIds}
          onToggle={toggleSource}
          onClear={clearSources}
        />
        <ItemList
          items={items}
          selectedSources={selectedSources}
          checkedItemIds={checkedItemIds}
          onToggleItem={toggleItem}
          onCheckAll={checkAll}
          onUncheckAll={uncheckAll}
          onMouldFilter={applyMouldFilter}
          onCategoryFilter={applyCategoryFilter}
          search={search}
          onSearch={setSearch}
        />
        <SchedulePanel
          math={math}
          weekAnchor={weekAnchor}
          setWeekAnchor={setWeekAnchor}
          selectedDay={selectedDay}
          setSelectedDay={setSelectedDay}
          scheduledByDate={scheduledMinutesByDate}
          capacityMinutesByDate={capacityMinutesByDate}
          canSchedule={checkedItems.length > 0}
          onSchedule={(date, opts) => { void handleSchedule(date, opts); }}
          saving={saving}
        />
      </div>

      <WeekView
        weekAnchor={weekAnchor}
        setWeekAnchor={setWeekAnchor}
        cards={scheduledCards}
        selectedDay={selectedDay}
      />
    </div>
  );
}

