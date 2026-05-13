# Weekly production plan — Implementation spec

Redesign of `/production-brain/plan` page (Weekly tab). Target: replace current 3-card-stacked-vertically header pattern with compressed header, collapsible filter, full-width 7-column calendar grid, day-detail drawer, and bottom summary strip.

Reference mockup: `weekly-plan-redesign.html` (saved in /docs/).

This spec ships in 5 phases. Each phase is independently shippable. Phase 1 is the visual restructure (cheap, high-impact). Phases 2-5 add real interaction and intelligence.

---

## Phase 1 — Header + filter compression

### Goal

Reduce vertical chrome from ~560px to ~180px before the calendar starts. Apply Dulceria visual system. Make the calendar the dominant element on the page.

### Layout target

```
┌─────────────────────────────────────────────────────────┐
│ [Weekly] [Pivot] [Daily]                                │ ← view tabs (16px tall + padding)
├─────────────────────────────────────────────────────────┤
│ Production plan · 89 batches · last update 22:47        │
│ [Focus on... ▼]  [1 tight day]  [↻ Regenerate]          │
│ 14 days · 8.05–17.05 · 67 batches · 31% · peak Sa 30%   │ ← stats strip
│ [Day][Week][Pivot][Month]      [Filling cooking list]   │
├─────────────────────────────────────────────────────────┤
│ Filtering: 15 sources visible · 11 ord + 1 cmp + 3 POs  │ ← collapsed filter, 36px tall
│                                          [show details ▼]│
├─────────────────────────────────────────────────────────┤
│  [CALENDAR — 7 equal columns, takes rest of viewport]   │
└─────────────────────────────────────────────────────────┘
```

### Header component

`src/components/production-plan/plan-header.tsx`:

```tsx
<PlanHeader
  totalBatches={89}
  daysCovered={5}
  lastUpdate={"2026-05-08T22:47Z"}
  tightDays={1}
  focusFilter={focusFilter}
  onFocusChange={...}
  windowStart={"2026-05-08"}
  windowEnd={"2026-05-17"}
  totalPlannedMinutes={1008}
  totalCapacityMinutes={3213}
  peakDay={{ date: "2026-05-09", batches: 33, capacityPct: 30 }}
  view={view}
  onViewChange={...}
  onRegenerate={...}
/>
```

Three rows:

**Row 1:** Title + meta + actions
- Title: "Production plan" (Playfair 28px weight 600)
- Meta: "89 batches · 5 days · last update 22:47, 8h ago" (italic muted 13px)
- Actions right-aligned: tight-day badge (if any), focus selector, regenerate button

**Row 2:** Stats strip
- Single line of metadata, separated by `·` characters
- Tabular figures throughout
- Strong weight on numbers, muted color for labels
- "14 days · 8.05–17.05 · 67 batches (wk1 60 / wk2 7) · 31% capacity (1008/3213 min) · 0 tight days · peak Sa 09.05 (33 batches · 30%)"
- Smaller font (12px)

**Row 3:** View switcher + secondary actions
- Day/Week/Pivot/Month segmented control (left-aligned)
- "Filling cooking list" or other contextual buttons (right-aligned)
- 12px top padding, 0.5px top border

### Visual tokens

Apply Dulceria system:
- `--page-bg` for page background
- `--card-bg` for elevated surfaces
- `--border-warm` for 0.5px borders
- `--text-primary` for primary text
- `--text-muted` for italic supporting text
- Tight-day badge: `--draft-tint` background + `--caramel` border
- Regenerate button: `--teal` filled
- Sentence case throughout
- No drop shadows, no gradients

### Collapsible filter strip

`src/components/production-plan/filter-strip.tsx`:

Default state — collapsed (36px tall):
```tsx
<div className="filter-strip" onClick={toggle}>
  <span>
    <Icon name="grid" />
    {visibleSourceCount} sources visible · {orderCount} orders + {campaignCount} campaigns + {poCount} POs
  </span>
  <span className="muted">show details ▼</span>
</div>
```

When user changes filter from default:
```tsx
<span>
  <Icon name="filter-active" />
  Filtered: {visibleSourceCount} of {totalSourceCount} sources · 
  <button onClick={reset}>reset</button>
</span>
```

Click strip → expands to current FilterCard implementation (the existing grouped checkbox UI). Move existing component code into expanded state container.

Filter state persists in URL query params (already pattern in app per investigation).

### Verify

1. Page loads with header ≤ 200px tall total
2. Filter strip collapsed by default, 36px tall
3. Click filter strip → expands showing source groupings
4. Click strip again → collapses
5. Tight day badge only renders when tightDays > 0
6. View switcher segmented control shows current view as active (deep teal background)
7. All typography matches Dulceria tokens
8. No drop shadows or gradients introduced
9. Stats strip uses tabular-nums for all numbers
10. Filter state preserves across reload via URL params

---

## Phase 2 — Calendar grid restructure (7 equal columns)

### Goal

Replace current calendar that shrinks empty days into smaller columns. New: always 7 equal columns. Empty days look intentionally empty, not "the column got squished."

### Component structure

`src/components/production-plan/week-grid.tsx`:

```tsx
<WeekGrid
  weekStart={"2026-05-04"}
  workingDays={["Mon","Tue","Wed","Thu","Fri","Sat"]}
  capacityConfig={capacityConfig}
  plans={plans}
  planProducts={planProducts}
  productionDayLineItems={lineItems}
  productionSteps={steps}
  products={products}
  onDayClick={openDayDrawer}
  onStepDrag={...}
/>
```

CSS:
```css
.week-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
}
.day-col {
  border-right: 0.5px solid var(--border-warm);
  min-height: 480px;
  display: flex;
  flex-direction: column;
}
.day-col:last-child { border-right: none; }
```

### DayColumn component

`src/components/production-plan/day-column.tsx`:

Three regions stacked vertically:

**Region 1 — Header (88px tall):**
- Day name (Mon, Tue, etc.) — 11px uppercase muted
- Date — 16px weight 500 tabular-nums
- Capacity text: "{plannedMinutesFormatted} / {capacityMinutesFormatted}" + percentage right-aligned
- Capacity bar (3px tall) with mint/caramel/rose fill based on % vs threshold

**Region 2 — Content (flex 1):**
- Padding 6px
- Stack of step blocks (gap 4px)
- Empty days: "drop here" hint (dashed border, muted)

**Region 3 — Closed-day treatment:**
- Header gets `--closed-bg` (#f3eee2)
- Content gets `--closed-bg` background
- Center-align "closed" label, italic, opacity 0.6
- Hide capacity text and bar
- No drop targets accept on closed days
- No diagonal stripe pattern (remove from current implementation)

**Today highlight:**
- Header: `--today-tint` (#fdf6e8) background
- Date number: `--rose` color
- "Thu · today" inline with day name

### Capacity calculation

Per day:
```typescript
const dayLineItems = lineItems.filter(li => li.date === dateString);
const plannedMinutes = sum(dayLineItems.map(li => li.plannedMinutes));
const capacityMinutes = capacityConfig.effectiveDailyCapacityMinutes; // existing
const pct = (plannedMinutes / capacityMinutes) * 100;
const status = 
  pct >= capacityConfig.criticalThreshold ? 'over' :
  pct >= capacityConfig.warnThreshold ? 'warn' :
  'ok';
```

### Working days check

```typescript
const dayName = format(date, 'EEE'); // "Mon", "Tue", etc.
const isWorkingDay = capacityConfig.workingDays.includes(dayName);
```

If not working day → render as closed (not "0%"). Closed days don't accept drag-drop.

### Verify

1. Week grid always renders 7 equal-width columns regardless of content
2. Empty days don't shrink visually
3. Closed days have subtle gray bg, no stripe pattern, "closed" label centered
4. Today shows cream-tinted header + rose date
5. Capacity bar accurately reflects `plannedMinutes / effectiveDailyCapacityMinutes`
6. Capacity color changes at warn/critical thresholds from `capacityConfig`
7. Working days respected from `capacityConfig.workingDays`
8. Day header height consistent across all 7 columns

---

## Phase 3 — Step blocks redesign

### Goal

Replace current dense abbreviated step labels with two-line format that surfaces step name + product separately. Add visual hierarchy for locked vs draft, active vs passive, conflict states.

### StepBlock component

`src/components/production-plan/step-block.tsx`:

```tsx
<StepBlock
  step={step}                 // ProductionStep
  plan={plan}                 // ProductionPlan
  planProduct={planProduct}   // PlanProduct
  product={product}           // Product
  lineItem={lineItem}         // ProductionDayLineItem
  hasConflict={boolean}
  conflictMessage={string?}
  isPassive={boolean}         // computed: waitingMinutes > 0 && activeMinutes === 0
  isLocked={boolean}          // computed: !!plan.pinnedDate
  spanInfo={{ from, to }?}    // for spanning passive steps (set/cool)
  onClick={openStepDrawer}
  onDragStart={...}
  onDragEnd={...}
/>
```

### Visual states (matrix)

```
                 │ Default (auto)  │ Locked (manual) │ Passive          │ Conflict
─────────────────┼─────────────────┼─────────────────┼──────────────────┼─────────────────
Background       │ --page-bg       │ --page-bg       │ transparent      │ --conflict-tint
Left border      │ 3px solid blush │ 3px solid teal  │ 3px dashed gray  │ 3px solid rose
Text color       │ primary         │ primary         │ muted italic     │ primary
Lock icon        │ —               │ 🔒 prefix       │ —                │ —
Time prefix      │ —               │ —               │ ⏱                │ ⚠
Cursor           │ grab            │ grab            │ default          │ grab
```

### Two-line format

```
🔒 Fill                    2h
   Almond Praline · 40 pcs
```

```
Painting                    14m
Almond Praline · 2 cat
```

```
⏱ Set/cool                  → Wed
  Almond Praline · 20h passive
```

Row 1: lock icon (if locked) + step name (weight 500) + time right-aligned (tabular-nums)
Row 2: product name (truncates with ellipsis if long) + qty/category (muted small)

### Density variants

When day is busy (>5 step blocks rendered), switch to compact single-line format:

```
🔒 Fill · Almond Praline                    2h
🔒 Temper · dark chocolate                  1h
   Decorate · Lillet Berry · 24 pcs        30m
```

Step name + product on one line, time right-aligned. Product gets less prominence but everything still visible.

Toggle threshold: if day's step count >= 6, use compact. Else two-line.

### Hover

- Slight transform: `translateX(1px)` (subtle drag-ready feel)
- Background shift to `--hover-bg`
- Cursor `grab`

### Conflict indicator

When `hasConflict` is true:
- Block gets rose border + tint
- Below the block, render small inline warning:

```
┌─────────────────────────────┐
│ Fill · Almond Praline   2h  │ ← rose border
└─────────────────────────────┘
⚠ Mould conflict at 11:00
```

Conflict warning is inline at day-content level, not inside the block (so two conflicting blocks share one warning).

### Spanning passive steps

When a step has `waitingMinutes > 0` and crosses days (e.g., set/cool from Tue 12:00 → Wed 08:00):

**Approach 1 — Visual annotation** (Phase 3, simple):
- Render block on starting day with "→ Wed 08:00" annotation
- Render block on ending day with "← Tue 12:00 · 20h passive" annotation
- Two separate blocks, visually linked by the annotation

**Approach 2 — Connected span** (Phase 4, advanced):
- Single block that visually spans columns
- Uses absolute positioning overlay over the day grid
- Connects start day to end day with continuous bg

Phase 3 ships Approach 1. Phase 4 adds Approach 2 as enhancement.

### Verify

1. Locked steps show 🔒 + deep teal left border
2. Default (auto-planned) steps show blush left border, no lock icon
3. Passive steps show dashed gray border + italic muted text + ⏱ prefix
4. Conflicting steps show rose border + tinted bg + inline warning below
5. Two-line format on days with ≤5 steps
6. Compact single-line format on days with ≥6 steps
7. Hover shows slight transform + bg shift
8. Click step block → opens edit drawer (existing pattern)
9. Spanning passive steps annotate both start and end days with day reference

---

## Phase 4 — Drag-drop within calendar + multi-day spanning visualization

### Goal

Make step blocks drag-droppable to different days/times. Add visual connectors for multi-day spanning passive steps.

### Drag-drop infrastructure

Use `@dnd-kit/core`. If not installed in production app, install:

```
npm install @dnd-kit/core @dnd-kit/sortable
```

### Drag source: step block

```tsx
<StepBlock>
  {/* draggable wrapper */}
  <DndDraggable id={step.id} data={{ stepId, planId, lineItemId, currentDate }}>
    ... step block content
  </DndDraggable>
</StepBlock>
```

### Drop targets: day columns

```tsx
<DayColumn>
  <DndDroppable id={`day-${dateString}`} data={{ date, isWorkingDay, capacityRemaining }}>
    ... day column content
  </DndDroppable>
</DayColumn>
```

### Drag flow

1. User starts dragging a step
2. All day columns highlight as potential drop targets (dashed caramel border)
3. Closed days reject (no highlight, drop returns false)
4. While hovering over a day, that day shows preview: "+ Fill · Almond Praline · 2h"
5. On drop:
   - Validate working day
   - Check capacity: would this push the day over critical threshold? Show warning.
   - Check mould conflict: is the mould double-booked at this time? Show warning.
   - Check dependency: is there a downstream/upstream step that breaks? Show warning. (Per investigation, dependencies aren't enforced — show as soft warning only.)
6. If all clear OR user confirms warnings, save:
   - Update `productionDayLineItem.date` to new date
   - If plan was draft, recompute scheduler-assigned times via reconciler
   - If plan was locked (`pinnedDate` set), update `pinnedDate` to new day

### Drop result handling

```typescript
async function handleStepDrop(stepId: string, fromDate: string, toDate: string) {
  // optimistic UI: move block to new column immediately
  optimisticUpdate(stepId, { date: toDate });
  
  // validate
  const conflicts = await detectConflicts(stepId, toDate);
  if (conflicts.length > 0) {
    const confirmed = await showConflictDialog(conflicts);
    if (!confirmed) {
      revertUpdate(stepId);
      return;
    }
  }
  
  // server save
  try {
    await moveStep(stepId, toDate);
    refetchPlans();
  } catch (e) {
    revertUpdate(stepId);
    toast.error("Could not move step: " + e.message);
  }
}
```

### Conflict types

1. **Mould double-booking** — same mould assigned to two products at overlapping times. Surface as: "3-cav mould booked for Almond Praline at this time. Continue and check manually?"
2. **Capacity overflow** — moving step pushes day past `criticalThreshold`. Surface as: "Day will be at 110% capacity. Continue?"
3. **Dependency break** — step has `sortOrder` lower than this step's predecessor on same day. Surface as: "This step normally happens after Polishing. Continue?"
4. **Closed day** — moved to non-working day. Hard reject — don't allow drop on closed day at all.

### Multi-day span visualization (Approach 2)

Overlay layer above the week grid:

```tsx
<WeekGrid>
  <div className="grid"> ... day columns ... </div>
  <div className="span-overlay">
    {spanningSteps.map(span => (
      <SpanBar
        key={span.id}
        startDay={span.fromDate}
        endDay={span.toDate}
        startHour={span.fromHour}
        endHour={span.toHour}
        label={`${span.stepName} · ${span.productName}`}
      />
    ))}
  </div>
</WeekGrid>
```

`SpanBar` is positioned absolutely over the day cells using grid coordinates:

```css
.span-bar {
  position: absolute;
  height: 24px;
  background: var(--card-bg);
  border: 0.5px dashed var(--gray);
  border-left: 3px dashed var(--gray);
  border-radius: 3px;
  font-style: italic;
  font-size: 11px;
  color: var(--text-muted);
  padding: 4px 8px;
  pointer-events: none;
}
```

Calculate `left` and `width` based on column positions:

```typescript
const colWidth = gridWidth / 7;
const startCol = getDayIndex(startDay); // 0-6
const endCol = getDayIndex(endDay);
const left = startCol * colWidth + 8; // 8px inset from column edge
const width = (endCol - startCol) * colWidth + colWidth - 16;
```

Span bars render after all step blocks but before drag overlay.

When a step that spans is being dragged, hide its span bar during drag, restore on drop.

### Verify

1. Step block has grab cursor + drag handle
2. Dragging a step highlights all valid day columns with caramel dashed border
3. Closed days don't highlight, reject drop
4. Drop on different working day moves the step (optimistic UI immediate)
5. Mould conflict shows warning dialog before commit
6. Capacity overflow shows warning dialog
7. Dependency soft warning if applicable
8. Server save persists; refresh shows step on new day
9. Server failure reverts UI with error toast
10. Multi-day passive steps show as connected bar across columns
11. Spanning bar maintains correct width when window resizes
12. Dragging a spanning step temporarily hides its span bar during drag

---

## Phase 5 — Day-detail drawer + bottom summary

### Goal

Provide deep view of single day with hour-by-hour breakdown, conflict surfacing, day notes, action buttons. Add bottom summary strip with at-a-glance week totals.

### Day detail drawer

`src/components/production-plan/day-detail-drawer.tsx`:

Triggered by clicking day header (not step block — those open step drawer).

Right-side drawer, 480px wide, full height.

```
┌────────────────────────────────────────┐
│                                     × │
│                                        │
│ Tuesday, 5 May 2026                    │
│ 6h 20m planned · 14h capacity · 45%    │
│                                        │
│ HOUR BY HOUR                           │
│ 09:00  🔒 Temper · dark · 1h           │
│ 10:00  🔒 Fill · Almond Praline · 2h   │
│ 12:00  ⏱ Set/cool · → Wed 08:00        │
│ 13:00  Decorate · Lillet · 30m         │
│ 13:30  Package · Hazelnut · 1h         │
│                                        │
│ CONFLICTS (1)                          │
│ ⚠ Mould conflict at 11:00 — 3-cav      │
│   booked for AP + HC                   │
│                                        │
│ DAY NOTES                              │
│ [textarea for free notes]              │
│                                        │
│ [Mark as worked] [Reschedule day]      │
└────────────────────────────────────────┘
```

### Hour-by-hour computation

```typescript
function computeHourlyBreakdown(
  dayLineItems: ProductionDayLineItem[],
  steps: ProductionStep[]
): HourlyEntry[] {
  // Group all stepIds across line items, dedupe
  const allStepIds = dayLineItems.flatMap(li => li.stepIds);
  const stepEntries = allStepIds.map(stepId => {
    const step = steps.find(s => s.id === stepId);
    return {
      stepId,
      step,
      // ...
    };
  });
  
  // Sort by sortOrder + assigned time (if scheduler set one)
  // Compute start hour cumulatively from workdayStart + step durations
  const workdayStart = parseTime(capacityConfig.workdayStart);
  let cursor = workdayStart;
  
  return stepEntries.map(entry => {
    const startTime = formatTime(cursor);
    const duration = entry.step.activeMinutes;
    cursor += duration;
    return { ...entry, startTime, duration };
  });
}
```

### Conflicts section

Reuse conflict detection from Phase 4 but applied to entire day:
- Mould double-bookings within day
- Capacity overflow (already shown in header but also list specific steps causing it)
- Dependency violations

### Day notes

Free-text area saved to a new column or existing notes field on... actually, this needs investigation. Options:
- New `productionDayNotes` table (date, note, userId)
- Column on `productionPlans` if there's a single plan per day (there isn't always)
- Generic `dayNotes` table keyed by date

For Phase 5, defer the persistence layer. Show textarea, save to localStorage in v1. Database persistence is Phase 5.5.

### "Mark as worked" action

Sets a boolean flag on the day indicating "this day actually happened, no further auto-rescheduling." Useful for past days where you don't want auto-planner reshuffling history.

Schema addition (new):

```sql
ALTER TABLE productionDayLineItems
  ADD COLUMN actuallyWorked BOOLEAN DEFAULT FALSE;
```

When all line items for a date have `actuallyWorked = true`, day shows green checkmark in calendar.

### "Reschedule day" action

Opens a smaller modal: "Move all batches from {date} to..." with date picker. Then bulk-updates all `productionDayLineItems` for that date. Useful when you sick day or shop closes unexpectedly.

### Bottom summary strip

`src/components/production-plan/bottom-summary.tsx`:

Below the calendar, before page bottom.

```
┌─────────────────────────────────────────────────────────┐
│ This week · 6 days · 67 batches · 30h 44m · peak Sat 30%│
│ Next week · 7 batches scheduled · view →                │
└─────────────────────────────────────────────────────────┘
```

Two rows:
- Row 1: current week summary (total batches, total active minutes, peak day)
- Row 2: next week preview link (count + click to navigate)

If next week has 0 batches: "Next week · empty · regenerate to populate"

### Verify

1. Click any day header (not step block) → drawer opens from right
2. Drawer shows hour-by-hour breakdown with step names + products + times
3. Conflicts section lists actual conflicts for that day
4. Day notes textarea persists to localStorage (Phase 5.5 = DB persistence)
5. "Mark as worked" sets flag, day gets visual confirmation in calendar
6. "Reschedule day" opens date picker, bulk moves all batches
7. Bottom summary shows accurate week totals
8. Bottom summary shows next-week preview with batch count
9. Click "view →" navigates to next week

---

## Honest deferred items (NOT in v1)

These came up during design but are explicitly out of scope for the 5 phases above:

1. **Day notes database persistence** — Phase 5 ships with localStorage. DB persistence (`productionDayNotes` table or similar) is Phase 5.5.

2. **"Mark as worked" propagating to historical analytics** — flag is set but no downstream consumers wired up. Would need analytics queries to filter by `actuallyWorked`.

3. **Bulk reschedule day with conflict detection** — current "Reschedule day" moves all line items but doesn't check if target day has capacity. Naive bulk move. Phase 6.

4. **Pivot view redesign** — separate tab, separate redesign. Not in this spec.

5. **Daily view redesign** — separate tab, separate redesign. Not in this spec.

6. **Month view redesign** — separate tab, separate redesign. Not in this spec.

7. **Filtering UX while expanded** — when filter strip is expanded, current grouped checkbox UI is preserved as-is. Improving the filter editing experience itself (e.g., search within filter, save filter presets) is deferred.

8. **Cross-week drag-drop** — drag a step from current week to next week by dragging onto "next week →" button. Deferred to Phase 6.

9. **Step reordering within day via drag** — currently drag moves step to a different day. Reordering within same day via drag is deferred. Use drawer to manage hour-by-hour ordering.

10. **Spanning bar interaction** — span bar is visual-only. Can't be clicked or dragged. Future: click span to open the parent batch. Phase 6.

---

## Migrations / new tables

Phase 5 needs one schema addition:

```sql
-- 0XXX_actually_worked.sql
ALTER TABLE productionDayLineItems
  ADD COLUMN actuallyWorked BOOLEAN DEFAULT FALSE;
```

Phase 5.5 (deferred) needs:

```sql
-- 0XXY_day_notes.sql
CREATE TABLE productionDayNotes (
  id TEXT PRIMARY KEY,
  date DATE NOT NULL,
  note TEXT,
  createdAt TIMESTAMPTZ DEFAULT now(),
  updatedAt TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_production_day_notes_date ON productionDayNotes(date);
```

Phases 1-4 require NO migrations.

---

## File map

```
src/app/(app)/production-brain/plan/
├── page.tsx                                  [refactor: thin shell, compose components]
src/components/production-plan/
├── plan-header.tsx                           [NEW: phase 1]
├── filter-strip.tsx                          [NEW: phase 1]
├── filter-expanded.tsx                       [NEW: phase 1, wraps existing FilterCard]
├── week-grid.tsx                             [NEW: phase 2]
├── day-column.tsx                            [NEW: phase 2]
├── day-header.tsx                            [NEW: phase 2]
├── capacity-bar.tsx                          [NEW: phase 2]
├── step-block.tsx                            [NEW: phase 3]
├── span-bar.tsx                              [NEW: phase 4]
├── span-overlay.tsx                          [NEW: phase 4]
├── day-detail-drawer.tsx                     [NEW: phase 5]
├── conflict-warning.tsx                      [NEW: phase 3]
├── bottom-summary.tsx                        [NEW: phase 5]
└── reschedule-day-modal.tsx                  [NEW: phase 5]
src/lib/production-plan/
├── compute-day-summary.ts                    [NEW: phase 2]
├── compute-hourly-breakdown.ts               [NEW: phase 5]
├── detect-conflicts.ts                       [NEW: phase 3 + 4]
├── move-step.ts                              [NEW: phase 4 — drag-drop save]
├── reschedule-day.ts                         [NEW: phase 5]
└── span-step-positions.ts                    [NEW: phase 4 — spanning bar coords]
```

---

## Phase shipping order

1. **Phase 1** — header + filter compression. Visible upgrade, low risk. Ship first.
2. **Phase 2** — calendar grid restructure. 7 equal columns, closed-day treatment. Ship.
3. **Phase 3** — step blocks redesign. Two-line format, visual hierarchy, density variants. Ship.
4. **Phase 4** — drag-drop + spanning bar. Real interaction. Higher complexity. Ship after testing Phase 3.
5. **Phase 5** — day-detail drawer + bottom summary. Polish. Ship.

After Phase 3, the page looks substantially better. After Phase 4, it feels like a real planning tool. Phase 5 adds the finishing touches.

---

## Per-phase commit evidence rule

Every commit includes evidence per checklist item:

```
✓ Header compression — src/components/production-plan/plan-header.tsx
✓ Filter strip collapsed default — src/components/production-plan/filter-strip.tsx
✗ Stats strip mobile responsive — deferred per spec section "Honest deferred items"
```

---

**End of spec.**
