# MANUAL_PLANNER_WEEK_VIEW_GANTT.md

**App:** Production · Workshop
**Page:** `/production-brain/manual`
**Section:** Week view (the bottom section of the page only)
**Mockup reference:** `manual-planner-week-view-options.html` — Option A
**Spec date:** 2026-05-17

---

## 0 · Context

The Manual Planner page has three regions: demand picker + active draft (top), drafts tray (middle), week view (bottom). **This spec only touches the bottom region.** The top two stay as currently shipped.

The current week-view implementation (whether `PlanWeekV2` reused or whatever's there now) renders stages as a vertical wall inside whichever day each batch was pinned to. That's wrong — Manuela needs to see how a batch's stages flow across days, not all stages of one batch piled into one day.

---

## 1 · What changes

Replace whatever is currently rendering at the bottom of `/production-brain/manual` with a **Gantt grid** where:

- **Rows = batches** (one row per `productionPlans` row with at least one `productionDayLineItems` in the visible week, OR pinned to a day in this week)
- **Columns = days** (Mon → Sun for the visible week)
- **Cells = the stage(s) of that batch running on that day** — rendered as draggable stage chips
- **Bottom totals row = day load** (sum of `activeMinutes` across all stage chips in that column, with stage count)

Replaces:
- ❌ The PlanWeekV2 reuse (or whatever is currently rendering)
- ❌ The "click to expand" stage breakdown per day
- ❌ Pills-only mode (from earlier spec — was the wrong call)

---

## 2 · Data — already in place, no new tables

From the schema dump:

```
productionPlans            — the batch row
  ├─ planProducts          — productId + mouldId + quantity (mould fills)
  └─ productionDayLineItems — ONE ROW per (plan, day) pair
                             contains stepIds[] — which steps run that day
                             contains plannedMinutes
                             productionDayId → productionDays.date

productionSteps            — definition of each step
  productType (joins to productCategories.name)
  name (e.g. "Polishing","Shelling","Fill Prep","Filling","Cap","Unmould","Sealing")
  activeMinutes, waitingMinutes
  sortOrder (drives sequence)
  perBatch, isPackingStep
```

The data model already supports per-day stage assignment via `productionDayLineItems.stepIds[]`. No schema work needed.

For each visible (plan, day) cell:
- Look up `productionDayLineItems` row where `planId = plan.id AND productionDayId = day.id`
- For each `stepId` in `stepIds[]`, look up `productionSteps` row
- Render one stage chip per step

---

## 3 · Layout

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Week of 11 – 17 May                  [← prev] [today] [next →]            │
├──────────────┬──────┬──────┬──────┬──────┬──────┬──────┬──────────────────┤
│  Batch       │ MON  │ TUE  │ WED  │ THU  │ FRI  │ SAT  │ SUN              │
│              │  11  │  12  │  13  │  14  │  15  │  16  │  17 · today      │
├──────────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────────────────┤
│ Pistachio Bar│ POL  │ SHE  │ FIL  │ CAP  │ UNM  │ SEAL │   ·              │
│ 3 fills · 45 │ 35m  │ 20m  │ 1h   │ 25m  │ 30m  │ 30m  │                  │
├──────────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────────────────┤
│ Strawberry CC│  ·   │ POL  │ SHE  │ FIL  │ CAP  │ UNM  │   ·              │
│ 1 fill · 24  │      │ 25m  │ 20m  │ 45m  │ 20m  │ 25m  │                  │
├──────────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────────────────┤
│ Espresso     │  ·   │  ·   │ POL  │ SHE  │ FIL  │ CAP  │   ·              │
│ 2 fills · 80 │      │      │ 45m  │ 35m  │ 1h20m│ 30m  │                  │
├──────────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────────────────┤
│ Day load     │ 35m  │ 45m  │2h05m │2h40m │3h25m │1h50m │  0m              │
│              │ 1stg │ 2stg │ 3stg │ 4stg │ 4stg │ 3stg │  rest            │
└──────────────┴──────┴──────┴──────┴──────┴──────┴──────┴──────────────────┘
```

Sizes:
- Batch label column: fixed 200px
- Day columns: equal flex (1fr each, 7 cols total)
- Row height: min 56px, grows with content
- Totals row: pinned at bottom of grid, slightly darker bg

Today column: subtle cream tint (`#fdfaf2`).

---

## 4 · Components

### 4.1 `ManualWeekGantt` — new component

Replaces whatever is mounted at the bottom of `manual/page.tsx`.

```ts
// src/components/manual-planner/ManualWeekGantt.tsx
interface ManualWeekGanttProps {
  weekStart: Date  // Monday of visible week
}
```

Internal data flow:
1. `useProductionPlans()` filtered to plans with at least one `productionDayLineItems` row in the visible week, OR with `pinnedDate` in the week
2. `useAllProductionDayLineItems()` filtered to those plans + visible week
3. `useProductionDays(visible week)` to resolve `productionDayId` → date
4. `useProductionSteps()` to resolve `stepId` → step definition
5. `useProductCategories()` to resolve `products.productCategoryId` → category name
6. `useProductsList()` + `useMoulds()` for the row label

For each cell `(plan, day)`:
- Find `productionDayLineItems` row for that (plan, day)
- If none → empty cell
- If found → render one `StageChip` per stepId in `stepIds[]`, sorted by `productionSteps.sortOrder`

For totals row:
- Sum `activeMinutes` across all stage chips in column
- Count distinct stage chips
- Show red `#d96a52` if total > daily capacity (use `capacityConfig` singleton — fetch via `useCapacityConfig()`)

### 4.2 `StageChip` — new component

```ts
interface StageChipProps {
  stepId: string
  productionDayLineItemId: string  // for drag identity
  stepName: string                  // "Polishing" → display "POL"
  activeMinutes: number
  sortOrder: number                 // for color mapping
  draggable: boolean
}
```

Render: `[grip] STAGE_ABBREV time`

Abbreviations (derive from `productionSteps.name`):
- Polishing → POL
- Shelling → SHE
- Fill Prep → FP
- Filling → FIL
- Cap → CAP
- Unmould / Unmoulding → UNM
- Sealing → SEAL
- Anything else → first 3 letters uppercased

Color per stage (sortOrder-based palette so unfamiliar stages still get a color):
| sortOrder | bg | text |
|---|---|---|
| 0 | `#d6e6e2` (pale teal) | `#1c4a44` |
| 1 | `#f0e7cf` (pale gold) | `#6b5418` |
| 2 | `#f5d9c4` (caramel) | `#7a3f1c` |
| 3 | `#f5d9d3` (blush) | `#8a3a2c` |
| 4 | `#e0d5e5` (lavender) | `#4d2e5a` |
| 5 | `#d5e5dc` (mint) | `#2c5340` |
| 6+ | cycle back to 0 | |

Time format:
- `< 60m` → `35m`
- `60–119m` → `1h`, `1h 20m`
- `≥ 120m` → `2h 05m` style

### 4.3 Drag and drop

A `StageChip` is draggable. On drop onto a different day cell:

**Action:** Move that single stepId from the source `productionDayLineItems.stepIds[]` array to the destination day's `productionDayLineItems` row for the same plan.

**Implementation:**
1. Source: remove stepId from source `productionDayLineItems.stepIds[]`. If array becomes empty, delete the row.
2. Destination:
   - If `productionDayLineItems` row exists for `(plan, destDay)`: append stepId to `stepIds[]`, recompute `plannedMinutes`
   - If no row exists: insert one
3. Recompute `plannedMinutes` on both rows: sum `activeMinutes` of all stepIds in `stepIds[]` (use per-product override from `products.stepDurationOverrides` if present)
4. Optimistic update: mutate react-query cache before the round-trip

**Constraints (warn but don't block):**
- Dropping a stage earlier than the previous stage in `sortOrder` for the same batch → soft warn ("Polishing must happen before Shelling — continue anyway?")
- Dropping a stage that would put two batches on the same mould the same day → soft warn

Hard block (refuse):
- Dropping on past dates (`day < today`) → reject silently, no save

### 4.4 Drag target for draft pin

The active draft card from the drafts tray can be dragged onto a day cell — same behavior as before. Sets `pinnedDate` on the active draft. After Save & pin, that batch shows up as a new row in the Gantt with whatever `productionDayLineItems` rows get seeded.

Seeding: when `saveDraftToPlan` writes `status='active' + pinnedDate`, it should ALSO seed `productionDayLineItems` for each step. v1 behavior: put all steps on `pinnedDate` itself (matches current). v2 follow-up: distribute steps across `pinnedDate` + N days based on category sequence + active minutes. **For this batch, keep v1 behavior — all steps on the pinned day. User then drags chips to spread them.**

---

## 5 · Interactions

| User action | Effect |
|---|---|
| Click "← prev / next" buttons | Update `weekStart` state, refetch lines for new range |
| Click "today" | Jump to current week |
| Click a stage chip (no drag) | Open peek popover: step name, batch name, full duration (active + waiting), `planStepStatus.done` checkbox |
| Drag chip → drop on same day | No-op (or visual shake) |
| Drag chip → drop on different day | Move stepId between `productionDayLineItems.stepIds[]` arrays as in §4.3 |
| Drag chip → drop outside grid | Cancel |
| Drag draft card from tray → drop on day | Set `pinnedDate` on draft (existing behavior) |
| Right-click batch row label | Context menu: "Edit batch" / "Delete batch" / "Mark all done" (defer — log only) |

---

## 6 · Acceptance criteria

Each one testable in the deployed UI. Cursor logs ✓ {item} — {file:line} or ✗ {item} deferred — reason.

1. `/production-brain/manual` bottom region renders the Gantt grid, NOT the previous PlanWeekV2 / stage-wall layout
2. One row per `productionPlans` row with `productionDayLineItems` in the visible week OR `pinnedDate` in the visible week
3. Day columns labeled MON 11 → SUN 17 (or current week), today column has cream tint
4. Each (batch, day) cell renders one stage chip per stepId in `productionDayLineItems.stepIds[]`
5. Stage chips show abbreviation (POL/SHE/FIL/CAP/UNM/SEAL) + active minutes
6. Stage colors follow the sortOrder palette in §4.2
7. Empty cells render as a subtle dot, not blank
8. Drag a stage chip → drop on different day in same row → stepId moves between `productionDayLineItems` rows
9. Drag a stage chip → drop on a different batch's row → reject with toast "stage stays with its batch"
10. After drop, source row recomputes `plannedMinutes`; destination row recomputes `plannedMinutes`
11. Source row with empty `stepIds[]` after drop is deleted from DB
12. Drop on a past day → silently rejected, no DB write
13. Drop creating a stage-order violation (FIL before SHE) → soft confirm toast, allow proceed
14. Day-load totals row at the bottom sums `activeMinutes` per column
15. Day load over `capacityConfig.dailyActiveMinutes` → red text
16. Prev / next / today week nav buttons work without page reload
17. Drag draft tray card → drop on day → sets `pinnedDate` on draft (existing flow preserved)
18. After Save & pin, the new batch appears as a new row in Gantt with all steps on the pinned day
19. Click chip (no drag) → peek popover with step name + batch name + full duration + done checkbox
20. Done checkbox in peek writes `planStepStatus`

---

## 7 · File changes

```
src/components/manual-planner/ManualWeekGantt.tsx               NEW
src/components/manual-planner/StageChip.tsx                     NEW
src/components/manual-planner/StagePeekPopover.tsx              NEW
src/components/manual-planner/[whatever is currently at bottom] DELETE or replace mount
src/app/(app)/production-brain/manual/page.tsx                  swap mounted week component
src/lib/manual-planner/move-stage-day.ts                        NEW — drag+drop persistence
src/lib/manual-planner/save-draft-to-plan.ts                    extend to seed productionDayLineItems on save
src/lib/hooks.ts                                                ensure useAllProductionDayLineItems is window-filterable
```

If you reuse existing helpers for `productionDayLineItems` mutations from `/daily`, prefer that over duplicating. State the reuse in the commit.

---

## 8 · Out of scope (log only)

- Distributing steps across multiple days automatically on Save & pin (v1: all on pinnedDate)
- Equipment / mould double-booking detection
- Stage-status rollup (done/partially-done indicators on chips)
- Resizing chips by time (today: time shown but not draggable to resize)
- Multi-week view
- Replacing `/daily` or `/weekly` views

---

## 9 · Risks

| Risk | Mitigation |
|---|---|
| `productionDayLineItems` mutations are shared with `/daily` — touching them here could regress that page | Use existing helper if present. Test `/daily` after this ships. |
| Drag conflict between StageChip and draft-card-from-tray (both target day cells) | Distinguish by drag source type (`'stage'` vs `'draft'`). Day cell `onDrop` reads source type and dispatches. |
| Empty `stepIds[]` array after drop — delete row or keep empty? | Delete row. Aggregate count logic depends on row existence. |
| Performance with many batches × 7 days | Window-filter all hooks by date range. Don't fetch the full history. |

---

## 10 · Evidence-per-item commit rule

Standing rule on this app. Every AC above gets `✓ {item} — {file:line range or diff hunk}` or `✗ {item} deferred — {reason}`. Vague `✓ done` without proof = not done. If you have to defer something, surface it in the commit with the reason — don't pick what's in scope unilaterally.

---

**End of spec.**
