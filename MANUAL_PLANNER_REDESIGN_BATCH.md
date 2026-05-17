# MANUAL_PLANNER_REDESIGN_BATCH.md

**App:** Production · Workshop section
**Page:** `/production-brain/manual`
**Status:** Spec v1 · 2026-05-17
**Mockup reference:** `manual-planner-redesign-v2.html` (Manuela has the file)
**Schema reference:** the data-model dump dated 2026-05-17 (Manuela has the file)

---

## 0 · Why

Current page dumps every task vertically into whichever day got hit, scopes Open Demand as a flat aggregate, and exposes none of the source lines (orders / PO items) underneath. Real workflow: pick demand by channel → combine across orders + POs into mould-sized batches → park or pin to a day. This batch rebuilds the page around that flow.

---

## 1 · Scope

### In scope

- `src/app/(app)/production-brain/manual/page.tsx` — major rewrite
- `src/lib/manual-planner/aggregate-demand.ts` — extend
- `src/lib/manual-planner/draft-state.ts` — minor
- `src/lib/manual-planner/save-draft-to-plan.ts` — signature change
- New: `src/lib/manual-planner/load-draft-from-plan.ts`
- New: `src/lib/manual-planner/delete-parked-draft.ts`
- New hook: `useDraftPlans()` in `src/lib/hooks.ts`
- New components: `SourceFilterChips`, `DraftsTray`
- Rewrite: `DemandList`, `ActiveDraftPanel`, `WeekStrip`

### Out of scope (do NOT touch in this batch)

- PO-plan join table (deferred gap — PO allocations still survive only as `productionPlans.notes` text — separate batch)
- Variant-line demand (`orderItems.variantId IS NOT NULL`)
- Multi-day batch splitting (`productionDayLineItems` write logic untouched)
- Daily / Weekly / Pivot view pages
- Equipment occupancy / scheduler
- Cost aggregation / margin reporting

### No migrations

`productionPlans.status='draft'` already exists in the CHECK enum (mig 0001). This batch starts using it.

---

## 2 · Data layer

### 2.1 `saveDraftToPlan` — change signature

```ts
// before
saveDraftToPlan(draft: DraftBatch): Promise<string>

// after
saveDraftToPlan(
  draft: DraftBatch,
  options: { status: 'draft' | 'active'; pinnedDate?: string | null }
): Promise<string>  // returns inserted productionPlans.id
```

Rules:
- `status='draft'` → write with `pinnedDate=null` regardless of input
- `status='active'` → require `pinnedDate` (ISO yyyy-mm-dd); throw if missing
- Everything else (planProducts, orderPlanLinks insert, PO-as-notes) stays as-is

### 2.2 New: `loadDraftFromPlan(planId)`

Reconstructs a `DraftBatch` from a parked plan.

Reads:
- `productionPlans` row (status, name, pinnedDate, surplusDestination, notes for PO trail)
- `planProducts` row (productId, mouldId, quantity = mould fills)
- Joined `products` (name) + `moulds` (name, numberOfCavities)
- `orderPlanLinks` rows for this planId → allocations with source='order'
- Parse PO allocations from `productionPlans.notes` (best-effort; format `PO {label}: {qty} pcs`)

Returns a `DraftBatch` matching the localStorage shape exactly. Used by "click parked card → load into active editor".

### 2.3 New: `deleteParkedDraft(planId)`

Deletes `productionPlans` row where `status='draft'`. ON DELETE CASCADE handles `orderPlanLinks` and `planProducts`. Guard against deleting non-draft rows — throw if status is anything other than `'draft'`.

### 2.4 New hook: `useDraftPlans()`

```ts
useDraftPlans(): UseQueryResult<DraftPlanCard[]>
```

Reads `productionPlans` WHERE `status='draft'`. Returns compact card shape:

```ts
type DraftPlanCard = {
  planId: string
  name: string
  productId: string
  productName: string
  mouldName: string
  numberOfCavities: number
  mouldCount: number          // = planProducts.quantity
  totalPieces: number         // = mouldCount * numberOfCavities
  totalDemand: number         // sum of orderPlanLinks.allocatedQuantity + parsed PO qty
  allocationCount: number     // orderPlanLinks rows + parsed PO lines
  surplus: number             // totalPieces - totalDemand
  surplusDestination: string | null
  pinnedDate: string | null   // always null for status='draft' but exposed for UI typing
}
```

Join-heavy query — write it as a single Supabase RPC if perf needs it. For v1, plain JS join across the hooks is fine.

### 2.5 Update `aggregateDemandByProduct`

Current algorithm (per dump):
> *Subtract `alreadyPlannedInActive + alreadyPlannedInDrafts (from localStorage)` at product level*

Change:
- Subtract from ALL `productionPlans` where `status IN ('draft', 'active', 'done')`
- Track per-source-line allocation: for each demand line (orderItem or productionOrderItem), compute:
  - `alreadyAllocated` = sum allocated qty in `status='active' OR 'done'` plans (existing)
  - `inDraftQty` = sum allocated qty in `status='draft'` plans (new)
  - `remainingQty = max(0, quantity - alreadyAllocated - inDraftQty)`
- `ProductDemand` return shape adds:
  - `inDraftQty: number` (total across all drafts)
  - `draftCount: number` (how many distinct drafts touch this product)
  - per source line: `inDraftQty: number` on each `OrderDemandLine` / `PoDemandLine`

### 2.6 `draft-state.ts` minor

Add a method to set `pinnedDate` on the active draft without saving — used by drag-to-day.

```ts
setActiveDraftPinnedDate(date: string | null): void
```

Updates localStorage in place. Triggers re-render via existing draft-state subscription pattern.

---

## 3 · UI components

### 3.1 `SourceFilterChips` (new)

Channel-based filter chips above the demand list.

| Chip | Filter |
|---|---|
| All | no filter (clears others) |
| Online | `orders.channel='online'` source lines |
| B2B | `orders.channel='b2b'` source lines |
| Event | `orders.channel='event'` source lines |
| Shop | `orders.channel='shop'` source lines |
| Restock-PO | `productionOrders.channel='restock'` source lines |
| Campaign-PO | `productionOrders.channel='campaign_run'` source lines |
| Urgent | `orders.priority='urgent'` source lines (POs have no priority field — only orders contribute) |
| Already-in-draft | products where `ProductDemand.inDraftQty > 0` |

Multi-select except All. Each chip shows count (number of products in current view that have ≥1 line matching the chip).

### 3.2 `DemandList` (rewrite)

Each product = expandable row. Collapsed header shows:

```
[caret] [product name]                              [urgent dot] [needs pill] [≈ X moulds]
        [mould tag] [source tags] [in-draft badge if any]
```

- **Needs pill** = `{remainingPieces} of {totalDemand} left` if `inDraftQty > 0`, else `{totalDemand} pcs needed`
- **In-draft badge** = small teal pill `in draft` if `ProductDemand.draftCount > 0`. If editing this product, show `editing` instead.
- **Urgent dot** = present if any source line has `priority='urgent'`
- **Source tags** = small pills, one per channel present, with count (e.g. `Online · 2`)

Click row → expand to source lines. Each line:

```
[checkbox] [label]                          [priority flag] [due date] [qty]
           [sub-label: customer/PO + meta]
```

- Checkbox = checked iff line is in the active draft
- Disabled+greyed if line is in a parked draft (different from active) — show small note "in draft #N"
- Click checkbox → toggle in active draft (see §4.2 for cross-product / cross-draft rules)

Below the source lines (only when active draft is for THIS product):

```
[capacity hint bar]  Active draft: 24 / 40 cavities · 16 free  [Top up with B2B (8)]
```

Sort options (top-right of list):
- "Not-yet-drafted first" (default — items with `inDraftQty=0` ranked highest)
- "Demand high → low" (by `remainingQty`)
- "Due-date earliest" (by min due date across uncovered source lines)
- "Mould cavity ↑" (current default in code — keep as option)

### 3.3 `ActiveDraftPanel` (update)

Header:
```
[product name] [editing pill]                    [✕ clear]
Mould: PWC-40 · 40 cavities · 8 g each
```

Sections (top to bottom):
1. **Selected demand** — list of allocations with remove (✕) per line
2. **Batch math** — Demand / Mould fills / Total output / Surplus (already in DraftBatch state)
3. **Surplus destination** — radio: Store / Freezer / Fill a PO / Waste. "Fill a PO" expands a small select for which open PO

Actions row (bottom):
- `[Park as draft]` — always enabled when draft has ≥1 allocation
- `[Save & pin to {day}]` — disabled until `pinnedDate` is set (set via drag-to-day in week strip)

Below actions:
- Status line — "localStorage · unsaved changes" / "dragged to Sat 17 May — click Save & pin to commit"

Empty state (no active draft):
> *Tick a demand line on the left to start a draft.*

### 3.4 `DraftsTray` (new)

Horizontal scrolling strip between main grid and week strip.

Header:
```
Drafts · {N} in progress       [click to edit · drag onto a day to save & pin]    [+ new draft]
```

Cards (one per parked draft + the active one if any):

```
[status pill: editing / pinned · Wed / unscheduled]
{product name}
{N lines · sources summary}
{Y / Z}      {mould count · surplus note}
[capacity bar]
```

- **Active** card → dark teal background, "editing" pill
- **Pinned** card (pinnedDate set, not yet saved) → cream/gold background, "pinned · {day-short}" pill
- **Unscheduled** parked draft → dashed border, "unscheduled" pill

Interactions:
- Click card → load that draft into active editor (auto-park current if dirty — see §4.3)
- Long-press / right-click → delete confirm
- Drag card onto a week-strip day → call `setActiveDraftPinnedDate(date)` for the dragged draft (loads it active first if it wasn't)
- "+ new draft" → clear active editor (auto-park current if dirty)

### 3.5 `WeekStrip` (update)

7 day cards as drop targets only (NOT the place where individual stages are scheduled — that's `/daily`).

Each day shows:
- Day name + date
- Summary line: "X batches" or "empty" or "rest day"
- Batch pills for already-saved batches (`status='active'`, `pinnedDate=this date`)
- During drag-over: solid border + cream background + "drop here" label

Today highlight: solid teal border.

---

## 4 · Interactions / state transitions

### 4.1 Active draft lifecycle

```
empty editor
    │ tick a demand line
    ▼
active draft (localStorage, dirty)
    │
    ├─ "Park as draft" ───▶ DB row status='draft', pinnedDate=null, localStorage cleared
    │
    ├─ drag to day ─────▶ pinnedDate set in localStorage, "Save & pin" enabled
    │       │
    │       ▼
    │   "Save & pin" ───▶ DB row status='active', pinnedDate set, localStorage cleared
    │
    └─ "✕ clear" ───────▶ localStorage cleared (no DB write)
```

### 4.2 Demand-line click rules

When user clicks a checkbox on a demand line:

| Active draft state | Clicked line's product | Action |
|---|---|---|
| Empty | (any) | Initialize active draft for this product, add line |
| For product A | Product A, line not in any draft | Toggle line in active draft |
| For product A | Product A, line in active | Remove line from active (uncheck) |
| For product A | Product A, line in PARKED draft | Prompt: *"This line is in parked draft '{name}'. Switch to that draft?"* → confirm: auto-park current (if dirty) + load parked → active; cancel: no-op |
| For product A | Product B | Prompt: *"Start new draft for {Product B}? Current draft will be parked."* → confirm: auto-park current + init new active for B with this line; cancel: no-op |

### 4.3 Auto-park-if-dirty rule

When switching active draft (via parked card click, new draft button, or cross-product line click):
- If current active has ≥1 allocation: silently park it as `status='draft'` (no prompt — the prompt at §4.2 is the user's consent)
- If current active is empty: just discard

"Dirty" = has at least one allocation, OR surplus destination ≠ default.

### 4.4 Drag-to-day from tray

- Pick up a card in the drafts tray
- Drop on a week-strip day cell
- That draft becomes active (auto-park current if dirty AND different draft)
- `pinnedDate` is set in localStorage on the now-active draft
- Tray card updates to show "pinned · {day-short}" pill (still cream/gold — not yet saved)
- User clicks "Save & pin" in ActiveDraftPanel to commit

### 4.5 Drag-to-day during active editing

If user drags the ActiveDraftPanel itself (or a "pin this draft" handle) onto a day:
- Same as 4.4 — sets `pinnedDate` on active

(Defer choice: separate handle vs. whole panel as draggable. Cursor: pick whichever is cleaner, document in commit.)

---

## 5 · Acceptance criteria

Every line below is testable in the UI. Cursor must log each as ✓ or ✗ per the evidence-per-item rule.

1. Open page → demand list shows products grouped, with source tags + need pills
2. `useDraftPlans` returns parked drafts; tray renders one card per parked draft
3. Click filter chip "B2B" → list filters to products with at least one B2B source line
4. Click filter chip "Already in draft" → list filters to products where `inDraftQty > 0`
5. Multi-select filter chips → list filters to union of chip predicates
6. Expand a product row → source lines render with checkboxes, priority flags, due dates, qty
7. Tick an unchecked line on empty active draft → active draft initializes for that product, line is added, ActiveDraftPanel renders
8. Tick a second line for same product → added to active draft, batch math recalcs
9. Untick a line in active draft → removed, batch math recalcs
10. Tick a line for a different product → prompt appears, confirm parks current and inits new active
11. Tick a line that's in a parked draft → prompt to switch, confirm loads parked into active
12. "Park as draft" button → calls `saveDraftToPlan(draft, { status: 'draft' })`, draft moves to tray
13. "Park as draft" disabled when no allocations
14. Drag a parked card onto a week-strip day → that draft becomes active with `pinnedDate` set
15. "Save & pin" button disabled when `pinnedDate` is null
16. "Save & pin" → calls `saveDraftToPlan(draft, { status: 'active', pinnedDate })`, draft leaves tray, batch pill appears on the day
17. Click a parked card → loaded into active editor (current auto-parked if dirty)
18. Long-press parked card → delete confirm; on confirm calls `deleteParkedDraft(planId)`
19. Demand list of a product with active draft allocation → shows "editing" badge + "X of Y left" pill
20. Demand list of a product with parked draft allocation → shows "in draft" badge
21. "+ new draft" in tray → clears active editor (auto-parks if dirty)
22. Surplus destination "Fill a PO" → inline PO select appears, choice persists in `surplusDestination` + `poFillPlanId`
23. Capacity hint bar in expanded row only shows when active draft matches that product
24. Refresh page mid-edit → active draft survives (localStorage) AND parked drafts survive (DB)

---

## 6 · Edge cases to handle explicitly

- **Empty park save** — if active draft has allocations, user removes all, then hits Park: do NOT write to DB. Treat as clear.
- **Editing a previously-pinned plan** — out of scope. Once `status='active'`, plan cannot be edited via this page. (Use `/planner` or whatever the existing edit path is.)
- **Concurrent drafts for same product** — allowed. Two parked drafts can both target Pistachio. The "in draft" badge shows `draftCount > 1` as `in draft × 2`.
- **PO line in a draft, but underlying PO is cancelled or completed** — when loading the parked draft, the PO line label still renders but with a strike-through + "cancelled" tag. User can ✕ to remove from draft.
- **Draft name** — auto-generate from product + first allocation source: `"Pistachio · Restock + Online"`. User can edit in a text field on the panel.
- **Save & pin to a day with existing batches** — fine, multiple batches per day allowed. No capacity check across days in this batch.
- **Click parked card while active is empty** — no auto-park prompt needed, just load.

---

## 7 · File-level change summary

```
src/app/(app)/production-brain/manual/page.tsx                   MAJOR REWRITE
src/lib/manual-planner/aggregate-demand.ts                       EXTEND (per-line inDraftQty)
src/lib/manual-planner/draft-state.ts                            MINOR (pinnedDate setter)
src/lib/manual-planner/save-draft-to-plan.ts                     SIGNATURE CHANGE
src/lib/manual-planner/load-draft-from-plan.ts                   NEW
src/lib/manual-planner/delete-parked-draft.ts                    NEW
src/lib/hooks.ts                                                 ADD useDraftPlans
src/components/manual-planner/SourceFilterChips.tsx              NEW
src/components/manual-planner/DemandList.tsx                     MAJOR REWRITE
src/components/manual-planner/ActiveDraftPanel.tsx               UPDATE (buttons + flow)
src/components/manual-planner/DraftsTray.tsx                     NEW
src/components/manual-planner/WeekStrip.tsx                      UPDATE (drop targets)
```

Paths are inferred from the page path — Cursor: verify against actual file structure and adjust. If components live under a different directory, update this section in the commit and proceed.

---

## 8 · Visual / design system

Match existing production app aesthetic from the mockup:

- Page bg: `#ece7df` (sage cream)
- Card bg: `#fff`
- Borders: `#d8d2c7`
- Primary action bg: `#1c3937` (dark teal)
- Accent / surplus / pinned: `#e6c97a` (caramel) on `#fff8e6` (cream-yellow)
- Source-tag colors: Online `#1c5651/e8f0ee`, B2B `#8a5a1c/faf0e8`, Restock `#5a3a8a/f0ecf5`, Event `#a8421c/fdeae5`
- Urgent: `#d96a52`
- Muted text: `#7a766f`
- Tabular numerals on all quantity / capacity displays

Use existing design tokens from the production app's DS — if a token doesn't exist for one of the above, add it to the tokens file rather than hardcoding.

---

## 9 · Commit rules (standing)

Per the production app's evidence-per-item rule:

- Every spec line item (each AC + each schema/file change) gets `✓ {item} — {file}` or `✗ {item} deferred — {reason}` in the commit message
- No silent partial shipments
- If something can't be built as specced, surface it explicitly with a reason and ship the rest

Commit message template:

```
Manual Planner v2 — multi-draft + library

Schema:
✓ saveDraftToPlan signature change — save-draft-to-plan.ts
✓ loadDraftFromPlan added — load-draft-from-plan.ts
✓ deleteParkedDraft added — delete-parked-draft.ts
✓ aggregateDemandByProduct extended for per-line inDraftQty — aggregate-demand.ts
✓ useDraftPlans hook — hooks.ts

UI:
✓ AC-1 demand list with source tags — DemandList.tsx
✓ AC-2 useDraftPlans renders tray — DraftsTray.tsx
... (all 24 ACs)

Out of scope (correctly deferred):
✗ PO-plan join table — separate batch
✗ Variant-line demand — separate batch
✗ Editing pinned/active plans — separate batch
```

---

## 10 · Not for this batch — log only

- PO-plan join table migration (currently PO allocations live in `productionPlans.notes` text)
- Variant-line demand expansion (currently `orderItems.variantId IS NOT NULL` lines skipped)
- Editing batches that are already pinned/active
- Multi-product batches (`planProducts` supports many but `saveDraftToPlan` writes one)
- Multi-day batch splitting via `productionDayLineItems`
- Equipment occupancy checks

These should each get their own spec when Manuela is ready.

---

**End of spec.**

---

## 11 · Schema addition: `poPlanLinks` (folded into this batch)

Added 2026-05-17 after schema-dump review. Original spec §1 "Out of scope" listed the PO-plan join table as deferred; that exclusion is **revoked** for this batch only. The other deferrals (variant-line demand, multi-day batch splitting, etc.) stand.

### 11.1 Why

Without a PO equivalent of `orderPlanLinks`, parked drafts that allocate PO lines lose those allocations on reload (the `notes`-text parse in `loadDraftFromPlan` is best-effort and brittle). The demand aggregator also can't subtract PO allocations from `productionOrderItems.targetUnits`, so the picker overstates PO demand whenever a draft already covers it.

### 11.2 Migration 0094

```sql
create table if not exists public."poPlanLinks" (
  id                       uuid primary key,
  "productionOrderItemId"  uuid not null references public."productionOrderItems"(id) on delete cascade,
  "planId"                 uuid not null references public."productionPlans"(id) on delete cascade,
  "allocatedQuantity"      integer not null check ("allocatedQuantity" >= 0),
  "createdAt"              timestamptz not null default now(),
  "updatedAt"              timestamptz not null default now(),
  unique ("productionOrderItemId", "planId")
);
```

Indexes on each FK column. RLS: `authenticated_full_access` (matches every other planner table).

### 11.3 Code changes folded in

- `src/lib/manual-planner/save-draft-to-plan.ts` — for each `allocation.source === 'po'`, insert a `poPlanLinks` row (no more `notes`-text trail).
- `src/lib/manual-planner/load-draft-from-plan.ts` — read `poPlanLinks` for the plan, reconstruct `source='po'` allocations from rows instead of parsing notes.
- `src/lib/manual-planner/aggregate-demand.ts` — open-PO remaining now subtracts the sum of `poPlanLinks` rows whose `planId` is in `draft|active|done` plans.
- `src/lib/hooks.ts` — new `useAllPoPlanLinks()`, `savePoPlanLink()`, `deletePoPlanLink()`.

### 11.4 Acceptance criteria (additions to the §5 list)

25. Migration 0094 creates `poPlanLinks` table with RLS — `supabase/migrations/0094_po_plan_links.sql`
26. `saveDraftToPlan` writes one `poPlanLinks` row per `source='po'` allocation — `save-draft-to-plan.ts`
27. `loadDraftFromPlan` reads PO allocations from `poPlanLinks` (not from notes text) — `load-draft-from-plan.ts`
28. `aggregateDemandByProduct` subtracts `poPlanLinks` from PO line remaining — `aggregate-demand.ts`
29. PO line in a parked draft → demand picker shows "X of Y left" pill matching `targetUnits - sum(allocatedQuantity)` — `DemandList.tsx`

### 11.5 Out of scope (still — confirmed)

- **Variant-line demand** (`orderItems.variantId IS NOT NULL`) — stays excluded with the existing skip-comment. Future batch.
- **PO lifecycle status transitions** — saving a draft that fully covers a PO does NOT auto-flip `productionOrders.status`. Future batch.

---

**End of schema addition.**
