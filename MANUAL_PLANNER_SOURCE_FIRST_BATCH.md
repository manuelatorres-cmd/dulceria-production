# MANUAL_PLANNER_SOURCE_FIRST_BATCH.md

**App:** Production · Workshop
**Page:** `/production-brain/manual`
**Mockup reference:** `manual-planner-source-first.html`
**Spec date:** 2026-05-17
**Status:** approved by Manuela · this REPLACES the workspace + pool + tray model

**Standing rules.** Evidence-per-item commits. No silent partial shipments. No DELETEs in this spec. Do not write a "v2" spec to supersede this — extend in place if you need to clarify something. If a spec item can't be built as described, log `✗ {item} deferred — {specific reason}`. Do not interpret unilaterally.

---

## 0 · Why a rewrite

Five batches in, the page is still wrong. Root cause: the draft / tray / pool / week-strip model assumes she hand-builds composite batches one allocation at a time. She doesn't. She thinks: *"this PO / this campaign / this order — schedule it to a day."* The schedulable unit is a **source**. Underneath, the system creates 1–N batches based on what shares moulds. Stage-level distribution belongs to Plan(week).

This batch deletes the workspace / tray / pool / week-strip layer and replaces it with three columns: Sources, Items in selection, Schedule. Plus a week view at the bottom showing scheduled work as summary cards (not stage chips, not batch pills — source-level summaries with a "→ open in Plan(week)" drill-down).

---

## 1 · Scope

### In
- **Full rewrite** of `src/app/(app)/production-brain/manual/page.tsx`
- New components: `SourceList`, `ItemList`, `SchedulePanel`, `CombinePreview`, `DayPicker`, `ScheduledItemCard`, `WeekView`
- New hooks: `useSchedulableSources`, `useSourceItems`, `useScheduledSources`
- New helper: `computeCombineMath(items[])` — calculates batches-needed, mould-sharing combines, total active time
- New helper: `scheduleSourceToDay(items[], date)` — creates all `productionPlans` + `planProducts` + `orderPlanLinks` + `poPlanLinks` rows in one transaction
- **Delete** components from previous batches that no longer exist in the new layout (listed in §2)

### Out (do NOT touch)
- Plan(week) page (`/plan?view=weekly`) — completely separate
- The 14 other writers of `productionPlans` (audit) — they stay as-is
- `planType` column work — separate batch
- Pause-production hack — separate batch
- `seedCampaignDrivenPlans` / `seedProductionOrderDrivenPlans` — they keep doing what they do, just won't be the source of pool pollution anymore because there's no pool
- Variant-line demand
- Equipment / mould double-booking detection
- Multi-week zoom
- Stage swimlanes (always on Plan(week), never here)

---

## 2 · Components to DELETE from this page

Find and remove all of these (delete the file, delete the mount, no leftovers):

```
src/components/manual-planner/DemandViewSwitcher.tsx
src/components/manual-planner/CampaignView.tsx          (concept merges into SourceList)
src/components/manual-planner/MouldView.tsx
src/components/manual-planner/CustomerView.tsx
src/components/manual-planner/CombineHintCard.tsx
src/components/manual-planner/SchedulePool.tsx
src/components/manual-planner/ScheduleSection.tsx
src/components/manual-planner/PoolCard.tsx
src/components/manual-planner/PinnedBatchPill.tsx
src/components/manual-planner/BatchPeekPopover.tsx
src/components/manual-planner/SplitBatchModal.tsx
src/components/manual-planner/ActiveDraftPanel.tsx
src/components/manual-planner/DraftsTray.tsx
src/components/manual-planner/SourceFilterChips.tsx     (subsumed into SourceList)
src/components/manual-planner/DemandList.tsx
```

Also delete (or stop calling — your judgment which is safer):

```
src/lib/manual-planner/draft-state.ts                   (no more localStorage active draft)
src/lib/manual-planner/save-draft-to-plan.ts            (replaced by scheduleSourceToDay)
src/lib/manual-planner/load-draft-from-plan.ts          (no longer loaded)
src/lib/manual-planner/delete-parked-draft.ts           (no pool)
src/lib/manual-planner/merge-drafts.ts                  (no drafts)
src/lib/manual-planner/build-drafts-from-campaign.ts    (campaigns are sources now)
src/lib/manual-planner/is-composition-draft.ts          (no draft pool to filter)
src/lib/manual-planner/split-plan.ts                    (DEFERRED — see §6.3, may resurrect)
src/lib/manual-planner/merge-sibling-plans.ts           (DEFERRED — see §6.3)
src/lib/manual-planner/plan-placement.ts                (drag-to-day no longer here)
src/lib/manual-planner/pin-pool-card-to-day.ts          (no pool cards)
```

Hooks to delete:
```
useDraftPlans
useSchedulePool
usePinnedBatches
useCampaignsWithDemand          (replaced by useSchedulableSources)
useDemandByMould                (no longer a view)
useDemandByCustomer             (subsumed into useSchedulableSources)
```

**The `productionPlans` DB rows from previous experimentation stay.** This is a UI-only rewrite. No data is deleted. Existing `status='draft'` rows live wherever the regenerate flow puts them — they don't show here anymore because nothing reads them on this page.

---

## 3 · Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Manual Planner · "Demand → day · combine where moulds allow"            │
├─────────────────┬────────────────────────────────┬──────────────────────┤
│ SOURCES (280px) │ ITEMS IN SELECTION (flex)      │ SCHEDULE (320px)     │
│                 │                                │                      │
│ Restock POs     │ Replen 13 May · due 14 May    │ Combine preview      │
│ ▣ Replen 13 May │ ─────────────────────────────  │ ─ items: 14         │
│                 │ [✓ All] [○ None] [Only 40-cav] │ ─ batches: 12        │
│ Campaigns       │ [Search…]                     │ ─ saved by mould-    │
│ ☐ Veganmania    │                                │   share: 2 batches  │
│ ☐ Bar Launch    │ ☑ Crunchy Nougat · 40 pcs · 1f│ ─ active: ~5h 50m   │
│                 │ ☑ Pistachio WC   · 40 pcs · 1f│ ─ day capacity warn  │
│ Customer orders │ ☑ Double Caramel · 40 pcs · 1f│                      │
│ ☐ Hotel Imperial│ ☑ Lime Passion   · 40 pcs · 1f│ Day picker (M-Sun)   │
│ ☐ Online (12)   │ ☐ Mango Chilli   · 40 pcs · 1f│ ● Wed selected       │
│                 │ ☑ Pistachio Bar  · 9 pcs · 3f │                      │
│ ─ Selection ─   │ ☑ Peanut Bar     · 9 pcs · 3f │ [Schedule to Wed 13] │
│ 1 source · 15 it│ ...                            │                      │
│ [Clear]         │                                │ Plan(week) hint      │
├─────────────────┴────────────────────────────────┴──────────────────────┤
│ WEEK VIEW (full width)                                                   │
│ Mon 11 │ Tue 12 │ Wed 13 │ Thu 14 │ Fri 15 │ Sat 16 │ Sun 17 (today)   │
│  ·     │  ·     │ DROP   │  ·     │ Campn. │ B2B    │ rest             │
│        │        │ here   │        │ card   │ card   │                  │
│        │        │        │        │→Plan(w)│→Plan(w)│                  │
└─────────────────────────────────────────────────────────────────────────┘
```

Sizes:
- Sources panel: 280px fixed left
- Schedule panel: 320px fixed right
- Items panel: flex middle
- Week view: full width below, ~200px tall per column

---

## 4 · Data layer

### 4.1 New hook: `useSchedulableSources()`

Returns all sources currently with open demand. Source = anything Manuela can schedule as a unit.

Return shape:
```ts
type SchedulableSource =
  | {
      kind: 'restock-po';
      id: string;              // productionOrders.id
      name: string;            // "Replen 13 May" — from PO name or dueDate
      dueDate: string | null;
      itemCount: number;       // # of distinct productionOrderItems with open qty
      priority: 'urgent' | 'normal';
    }
  | {
      kind: 'campaign';
      id: string;              // campaigns.id
      name: string;            // "Veganmania 2026"
      dueDate: string | null;
      itemCount: number;
      priority: 'urgent' | 'normal';
    }
  | {
      kind: 'customer-order';
      id: string;              // orders.id
      name: string;            // customerName (or eventName)
      dueDate: string | null;
      itemCount: number;
      isolated: boolean;       // from orders.isolated
      priority: 'urgent' | 'normal';
    }
  | {
      kind: 'online-bucket';
      id: 'online-loose';      // synthetic — all loose online orders grouped
      name: 'Online orders';
      dueDate: null;
      itemCount: number;       // sum across all unscheduled online orders
      priority: 'normal';
    };

type UseSchedulableSources = UseQueryResult<SchedulableSource[]>
```

Queries underneath:
- `productionOrders` WHERE channel='restock' AND not fully allocated yet
- `campaigns` WHERE has any open `productionOrderItems` belonging to its POs
- `orders` WHERE not fully allocated (one row per order; isolated flag exposed)
- Online bucket: aggregate of `orders` WHERE channel='online' AND not isolated

"Not fully allocated" = the source has at least one underlying item where `quantity > sum(orderPlanLinks.allocatedQuantity for status IN ('active','done'))`.

Sources hide once they're fully scheduled. They reappear if Manuela unschedules from Plan(week) or via a re-pin.

### 4.2 New hook: `useSourceItems(selectedSources[])`

Given an array of selected sources, returns the union of their unallocated items.

Return shape:
```ts
type SourceItem = {
  // Identity
  sourceKind: 'restock-po' | 'campaign' | 'customer-order' | 'online-bucket';
  sourceId: string;
  sourceName: string;          // for source-tag rendering

  // What to make
  productId: string;
  productName: string;
  productCategory: string;     // "Praline" / "Bar" — for display
  mouldId: string;
  mouldName: string;           // "PWC-40"
  mouldCavities: number;       // 40

  // How much
  remainingQty: number;        // pieces still owed
  fillsNeeded: number;         // ceil(remainingQty / cavities)

  // Origin row IDs (for the scheduler to write link tables)
  sourceItemId: string;        // productionOrderItems.id OR orderItems.id
  sourceItemKind: 'productionOrderItem' | 'orderItem';

  // Display flags
  isolated: boolean;           // from orders.isolated
  dueDate: string | null;
  priority: 'urgent' | 'normal';
}

type UseSourceItems = (sources: SchedulableSource[]) => UseQueryResult<SourceItem[]>
```

When zero sources selected: returns empty array. When one source: only its items. When multiple: union, sorted by source then by mould-cavity ↑.

### 4.3 New hook: `useScheduledSources(weekStart, weekEnd)`

Returns the scheduled work for the visible week, **grouped by source** — not by plan.

```ts
type ScheduledSourceCard = {
  sourceKind: 'restock-po' | 'campaign' | 'customer-order';
  sourceId: string;
  sourceName: string;
  pinnedDate: string;          // ISO date
  planIds: string[];           // all productionPlans rows that belong to this source on this day
  batchCount: number;          // length of planIds
  totalActiveMinutes: number;  // sum of estimated active time across batches
  isolated: boolean;
}

type UseScheduledSources = (weekStart: Date, weekEnd: Date) => UseQueryResult<ScheduledSourceCard[]>
```

Underneath: query `productionPlans WHERE pinnedDate IN range AND status IN ('active','done')`. Group by `(sourceKind, sourceId)`. The link between a plan and a source uses link tables: a plan with `orderPlanLinks` rows back to a `productionOrders` from a `restock` channel = restock-po source; back to a `productionOrders.campaignId IS NOT NULL` = campaign source; back to `orders` = customer-order or online-bucket source.

A plan with no link rows (legacy) renders as "Unscheduled batch (no source)" — gray, opens in Plan(week). Don't try to delete or hide these.

### 4.4 New helper: `computeCombineMath(items[])`

Returns the batch-count math for the Combine Preview panel.

```ts
function computeCombineMath(items: SourceItem[]): {
  itemCount: number;
  batchCount: number;
  savedByMouldShare: number;   // (sum of items' fillsNeeded) - batchCount
  totalActiveMinutes: number;
  overCapacity: boolean;
  combines: Array<{
    mouldId: string;
    mouldName: string;
    productNames: string[];
    totalFills: number;
  }>;
}
```

Algorithm:
1. Group items by `mouldId`
2. For each mould group:
   - Sum `fillsNeeded` across items in group
   - If the sum fits in `mouldCavities` per fill and items can be made in parallel (no per-item mould constraint), this is **one batch** with N fills
   - Else split into chunks that fit `mouldCavities` — each chunk is a batch
   - For v1: assume any two items sharing a mould can share a batch run (no special filter exclusion)
3. `batchCount` = sum of batches across all groups
4. `savedByMouldShare` = (naive count where each item = its own batch) - batchCount
5. `totalActiveMinutes`:
   - For each batch, sum `productionSteps.activeMinutes` for the steps that apply to that product (join `productionSteps WHERE productType = product.productCategory.name`)
   - Multiply by `fillsNeeded` for batches where step duration scales with fill count (use `productionSteps.perBatch` flag — if true, don't multiply; else multiply)
6. `overCapacity` = `totalActiveMinutes` > `capacityConfig.dailyActiveMinutes` (read singleton config)

If `capacityConfig` doesn't expose a value, default to 5h (300 min) and log a console warning.

### 4.5 New helper: `scheduleSourceToDay(items[], date, capacityOverride?)`

This is the main action. One transaction. Creates all underlying batches and pins them.

Signature:
```ts
async function scheduleSourceToDay(
  items: SourceItem[],
  date: string,                  // ISO yyyy-mm-dd
  options?: { ignoreCapacityWarn?: boolean }
): Promise<{ createdPlanIds: string[] }>
```

Algorithm:
1. Compute combine math (§4.4) — get the `combines` list
2. For each batch in `combines`:
   - INSERT `productionPlans`:
     - `status = 'active'`
     - `pinnedDate = date`
     - `name = generateBatchName(items in this batch)` — see §4.6
     - `surplusDestination = 'store'` (default; user can change later via Plan(week))
   - INSERT `planProducts` row for each productId in the batch with `quantity = its fill count`
   - For each item's `sourceItemId`:
     - If `sourceItemKind === 'orderItem'` → INSERT `orderPlanLinks` row with `allocatedQuantity = ceil(itemPortionOfBatchOutput)`
     - If `sourceItemKind === 'productionOrderItem'` → INSERT `poPlanLinks` row with `allocatedQuantity = ceil(itemPortionOfBatchOutput)`
3. Collect all created plan IDs, return
4. Optimistic update the UI before round-trip: items disappear from selection, source's `itemCount` decrements, new ScheduledSourceCard appears on the chosen day

Wrap in a Supabase RPC if doable for transactional safety. Otherwise do it client-side with proper error rollback. State the choice in the commit.

### 4.6 New helper: `generateBatchName(items)`

Generates a stable, readable name for an auto-created batch.

Rules:
- If single item: `{productName}`
- If multi-item single-mould combine: `{firstProductName} + {N-1} more · {mouldName}`
- Suffix with source: ` · {sourceName}` (truncate sourceName to 24 chars)

Examples:
- `Crunchy Nougat · Replen 13 May`
- `Pistachio Bar + 1 more · PCB-3 · Replen 13 May`
- `Strawberry Cheesecake · Hotel Imperial`

Don't include `Campaign:` or `PO:` prefixes — those are reserved for regenerate-driven plans.

---

## 5 · UI components

### 5.1 `SourceList` (new) — left column

Renders sources grouped by `kind`:

- Header `Restock POs` → all `kind='restock-po'` rows
- Header `Campaigns` → all `kind='campaign'` rows
- Header `Customer orders` → all `kind='customer-order'` rows + the single `kind='online-bucket'` row

Each row:
- Checkbox (click toggles `selectedSourceIds`)
- Name (with `isolated` badge if applicable)
- Subtitle: `{itemCount} products · {channel-or-due-info}`
- Count chip on the right (item count)
- Hover: cream tint. Active (checked): dark teal background.
- Urgent priority: count chip uses red tint.

Selection panel at the bottom of the column (sticky):
- `{N} sources · {M} items` summary
- `[Clear selection]` button

### 5.2 `ItemList` (new) — middle column

Header bar:
- Title: name of source if 1 selected; "Multiple sources" if >1
- Due date callout if any source has a due date
- Action row: `[✓ All]`, `[○ None]`, `[Only 40-cav]`, `[Only bars]`, `[Only pralines]` quick filters
- Search input — text match on `productName`, `mouldName`

Each item row:
- Checkbox (click toggles inclusion in selection)
- Product name + category subtitle
- Source tag pill (colored: Replen=lavender, Campaign=gold, B2B=warm tan, Online=neutral, Event=coral)
- Mould tag chip (`40-cav`)
- Qty + fills count on the right

Items are sorted: by mould cavity ascending (so bars come first if 3-cav, then 24-cav, then 40-cav), then alphabetical within mould. Adjustable via the action row filters.

Default: all items checked when source(s) first selected. Persists in component state during the session (not localStorage — fresh on reload).

### 5.3 `SchedulePanel` (new) — right column

Three sections, top to bottom:

**Combine preview** (`CombinePreview` subcomponent)
- Calls `computeCombineMath(checkedItems)` reactively
- Shows: items selected, batches needed, batches saved by mould-share, total active time, over-capacity warning if applicable
- Below: collapsed-by-default details list of each combine ("Pistachio + Peanut bars → PCB-3 · 6 fills")

**Day picker** (`DayPicker` subcomponent)
- 7-day strip for the visible week
- Each day shows: dow, date, load summary ("empty" / "{N}h booked" / "today" / "rest day")
- Click to select. Selected day = dark teal.
- Today's date has a gold border (even if not selected).

**Schedule button**
- Primary, full-width, dark teal
- Disabled if zero items checked OR no day selected
- Label: `Schedule to {day-short}` with subline `creates N batches · pins all to {date}`
- If over-capacity, button is still enabled but shows a confirmation prompt: "Day capacity is 5h, this would use 5h 50m. Schedule anyway?"

**Plan(week) hint** below the button: `Step-by-step scheduling happens on Plan(week). Each batch's polish/shell/fill/cap/unmould lives there.`

### 5.4 `WeekView` (new) — full-width bottom

Header: week range + prev/today/next nav buttons.

7-column grid below:
- Each column = one day, ~200px tall
- Today column: cream background, dark teal border
- Drop-target day during day-picker hover: gold dashed border, "↓ Source lands here" label
- Inside each column: list of `ScheduledItemCard` per source scheduled to that day
- Empty days: "no production" italic centered grey, or "rest day" for Sunday

Each `ScheduledItemCard`:
- Border-left color by source kind: Restock=lavender, Campaign=gold, B2B=warm tan
- Pill at top showing source kind
- Title: source name (e.g. "Veganmania · 3 bars")
- Meta: `{batchCount} batches · {totalActiveMinutes}m active`
- Footer link: `→ open in Plan(week)` — navigates to `/plan?view=weekly&focusDate={date}&focusSourceId={sourceId}`

Click a scheduled card → opens a peek popover with all the underlying plan IDs and a list of "Unschedule" (drops `pinnedDate` to null, status to 'draft' — but per audit that puts it back into the regenerate-managed pool which is fine). Defer this peek popover behavior if it complicates scope — log as `✗ scheduled-card peek deferred — separate batch`.

---

## 6 · Interactions

### 6.1 Build flow

1. Page load → SourceList populated, ItemList empty ("Select a source to see items"), SchedulePanel disabled
2. Click a source's checkbox → it becomes active, ItemList fills with its items (all checked by default), SchedulePanel enables
3. Uncheck items the user doesn't want
4. Click a day in DayPicker → day highlighted, Schedule button shows target date
5. Click Schedule → `scheduleSourceToDay` runs
6. Success: items disappear from selection, source's itemCount decrements (or source disappears if fully scheduled), WeekView shows the new card on the chosen day, day picker resets, items-list clears (back to "Select a source"), selectionSummary clears
7. Failure: error toast surfaces, no state change

### 6.2 Multi-source flow

1. Check source A → its items appear
2. Check source B → its items append to ItemList (sorted, with source tags)
3. Uncheck items from either source
4. Combine preview math accounts for cross-source mould sharing
5. Schedule → creates batches that may pull items from multiple sources

### 6.3 Splitting a source across days

**No dedicated UI.** Workflow:
1. Click source → items appear, all checked
2. Uncheck half
3. Schedule to day A
4. Source's itemCount decrements but source stays visible (still has unscheduled items)
5. Click source again → only the remaining items show
6. Schedule those to day B

Same source, two days. No SplitBatchModal, no `siblingGroupId`. The previous split / merge mechanics are deferred — the underlying schema (`siblingGroupId` from mig 0095) stays in DB but isn't used by this page in v1. If splitting once-scheduled batches becomes needed, that's a Plan(week) feature, not here.

### 6.4 Source coloring

Source kind → color (matches mockup):
- Restock-PO: lavender (`#f0ecf5` / `#5a3a8a`)
- Campaign: gold (`#fff8e6` / `#8a5a1c`)
- Customer order (B2B): warm tan (`#faf0e8` / `#8a5a1c`)
- Online: neutral white (`#fff` / `#555`)
- Event (when distinguished from campaign in customer-order kind): coral (`#fdeae5` / `#a8421c`)

---

## 7 · Acceptance criteria

Each gets `✓ {item} — {file:line range}` or `✗ {item} deferred — {specific reason}`.

### Setup
1. All files listed in §2 are deleted (or their mount removed if the file is reused elsewhere — state which in the commit)
2. `manual/page.tsx` no longer mounts any of the deleted components
3. New components from §5 exist at the expected paths

### Sources
4. `useSchedulableSources` returns all source kinds correctly grouped
5. Source row checkbox toggles `selectedSourceIds` array (component state)
6. Multi-source selection allowed
7. Isolated customer orders show `isolated` badge
8. Selection summary at bottom of SourceList shows live `{N} sources · {M} items`

### Items
9. ItemList empty state when zero sources selected
10. Single-source: only that source's items render, all checked by default
11. Multi-source: items merged, sorted by mould cavity ↑ then alphabetical, each tagged with source-colored pill
12. Action row buttons (All / None / Only 40-cav / Only bars / Only pralines) filter checked state correctly
13. Search input filters by productName + mouldName, ILIKE-style
14. Items already fully allocated to existing scheduled batches do NOT appear (the source's unallocated remaining only)

### Combine preview
15. CombinePreview math matches `computeCombineMath` output exactly
16. `batchCount` shown correctly (e.g. 2 bars sharing PCB-3 = 1 batch, 10 single-mould pralines = 10 batches)
17. `savedByMouldShare` calculated correctly (= naive count - actual batch count)
18. `totalActiveMinutes` reasonable (within 10% of manual hand-calculation on 3 spot-check examples — paste in commit)
19. `overCapacity` flag triggers red styling when total > 5h (or capacityConfig value)

### Day picker
20. DayPicker shows 7 days for visible week
21. Today's date highlighted with gold border
22. Each day shows load summary ("empty" / "{N}h booked" / "today" / "rest day")
23. Clicking a day selects it (dark teal background)
24. Schedule button shows `Schedule to {day-short}` once day selected

### Schedule action
25. Schedule button disabled when zero items checked OR no day selected
26. Click Schedule with over-capacity → confirm prompt appears
27. Click Schedule confirm → `scheduleSourceToDay` runs, all batches created in one DB transaction (state RPC vs client-side in commit)
28. Created plans have correct `pinnedDate`, `status='active'`, `planProducts.quantity = fills`, `orderPlanLinks` or `poPlanLinks` rows
29. Optimistic UI: selection clears immediately, sources refetch, WeekView shows new card without page reload
30. Failure rolls back optimistic state and shows error toast

### Week view
31. `useScheduledSources` groups plans by source correctly
32. Each ScheduledItemCard renders with correct color border + source pill
33. Today column has cream background + dark teal border
34. Drop-target day (when day-picker hovers) shows gold dashed border + drop hint
35. Card footer "→ open in Plan(week)" navigates to `/plan?view=weekly&focusDate={date}&focusSourceId={sourceId}`
36. Empty days show "no production" italic (or "rest day" for Sunday)

### Source lifecycle
37. After scheduling all items of a source: source disappears from SourceList (its `itemCount` is 0)
38. After unscheduling (from Plan(week), or `pinnedDate` cleared elsewhere): source reappears with its items available

### Verification
39. End-to-end test: select Replen, uncheck 1 item, schedule to Wed → DB state matches expectation (paste SQL of created plans + their link rows + planProducts)
40. Cleanup verification: re-run AC-9 SQL from the hotfix spec → composition vs regen counts stay sensible (this batch should not create any new regen-pattern names)
41. Screenshot the deployed page in three states: empty (no source selected), one source selected (15 items, day picked), after scheduling (WeekView showing the new card)

---

## 8 · Out of scope (do NOT do)

- Plan(week) page changes
- The 14 other writers of `productionPlans` (audit) — they keep working as-is
- `planType` column — separate batch
- Pause-production hack fix — separate batch
- Splitting an already-scheduled batch across multiple days from this page (uncheck-and-reschedule replaces this UX)
- Editing a scheduled card inline — drill into Plan(week) instead
- Auto-suggesting "best day to schedule on"
- Mould double-booking detection across days
- Variant-line demand
- Equipment occupancy
- Cost / margin display
- Stage-level rendering anywhere on this page
- Multi-week zoom

---

## 9 · Edge cases to handle explicitly

- **Source with all items already scheduled** → don't show in SourceList
- **Item with `remainingQty = 0`** → don't show in ItemList
- **Items sharing mould but with different products** → combine into one batch (one `productionPlans` row, multiple `planProducts` rows — note: `saveDraftToPlan` previously only wrote one planProducts row, this is a new pattern; need to confirm `productionPlans` allows multi-product or extend the model)
- **Items sharing mould where total fills exceeds reasonable single-batch threshold (e.g. 20+ fills)** → for v1, still combine but flag in CombinePreview details
- **Empty selection scheduled** → button disabled, can't fire
- **Day in the past picked** → day still selectable; on schedule, confirm prompt: "This day is in the past — log as historical?"  If yes, set `status='done'` + `completedAt=now`; if no, abort
- **Capacity overcommit** → confirm prompt, but still allowed
- **Isolated customer order picked alongside other sources** → soft warning in CombinePreview: "Hotel Imperial is isolated and should not be combined with other sources." Still allowed — user override.

**Multi-product per plan check:** before committing, verify with `planProducts` schema (per audit, table is many-to-one with `productionPlans` already, so multiple rows per plan are allowed). If a runtime test reveals this breaks Plan(week) rendering (which assumes 1 plan = 1 product), fall back to creating N plans (one per product) for combined batches, all sharing a `siblingGroupId` so Plan(week) groups them visually. State the fallback choice in the commit.

---

## 10 · Commit rules

- All 41 ACs get `✓ {item} — {file:line range}` or `✗ {item} deferred — {specific reason}`
- AC-18 manual capacity math spot-check pasted in commit
- AC-39 end-to-end SQL state pasted in commit
- AC-40 hotfix-SQL re-check pasted (should show no new regen-pattern rows)
- AC-41 three screenshots attached
- No vague `✓ done` without file:line refs

Commit message template:

```
Manual Planner — source-first rewrite

Deleted:
✓ All §2 components and helpers — files at PATHS

New hooks:
✓ useSchedulableSources — hooks.ts:LINES
✓ useSourceItems — hooks.ts:LINES
✓ useScheduledSources — hooks.ts:LINES

New helpers:
✓ computeCombineMath — src/lib/manual-planner/combine-math.ts
✓ scheduleSourceToDay — src/lib/manual-planner/schedule-source-to-day.ts
✓ generateBatchName — same file as scheduler

New components:
✓ SourceList — src/components/manual-planner/SourceList.tsx
✓ ItemList — src/components/manual-planner/ItemList.tsx
✓ SchedulePanel — src/components/manual-planner/SchedulePanel.tsx
✓ CombinePreview — src/components/manual-planner/CombinePreview.tsx
✓ DayPicker — src/components/manual-planner/DayPicker.tsx
✓ WeekView — src/components/manual-planner/WeekView.tsx
✓ ScheduledItemCard — src/components/manual-planner/ScheduledItemCard.tsx

AC verification: (all 41 with file:line refs or paste output)

Verification:
- AC-18 capacity math spot-checks:
  {paste 3 examples}
- AC-39 end-to-end SQL after one scheduling action:
  {paste output}
- AC-40 hotfix re-check:
  {paste output}
- AC-41 screenshots: {urls}

Out of scope (correctly deferred):
✗ Plan(week) changes
✗ planType column
✗ Pause-production hack
✗ ScheduledItemCard peek popover (if deferred)
... (rest of §8)
```

---

**End of spec.**
