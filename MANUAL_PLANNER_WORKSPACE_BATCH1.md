# MANUAL_PLANNER_WORKSPACE_BATCH.md

**App:** Production · Workshop
**Page:** `/production-brain/manual`
**Mockup reference:** `manual-planner-workspace.html`
**Spec date:** 2026-05-17
**Status:** approved by Manuela · ready to build

**Standing rules.** Evidence-per-item commits. No silent partial shipments. Do not write a "v2 spec" to supersede this one — extend in place if you need to clarify something, and surface the change in the commit. If a spec item can't be built as described, log `✗ {item} deferred — {specific reason}`. Do not interpret unilaterally.

---

## 0 · Context

This page composes batches from demand. Stages / steps belong to a different page (Plan(week)). The currently-shipped version has stage chips at the bottom — **those go away in this batch**. This page ends at "batch pinned to a day"; stage-level scheduling lives on Plan(week).

Three vertical zones:
1. **Top — Demand workspace + Active draft** (60/40 split)
2. **Middle — Drafts tray** (full-width horizontal band)
3. **Bottom — Schedule section** (collapsible; pool + week strip side-by-side when expanded)

Pinned batches are **not locked**. They drag freely between days, between days and pool, and can be split into multiple plans across days. See §3.8–3.11.

**One migration in this batch: mig 0095 (`siblingGroupId` on productionPlans).** See §4.6.

---

## 1 · Already shipped — keep working, do NOT rebuild

- Drafts tray (horizontal band, parked draft cards, click to load)
- Source filter chips (Online / B2B / Event / Shop / Restock-PO / Campaign-PO / Urgent / Already-in-draft)
- `useDraftPlans()` filter for `allocationCount > 0` (cleanup-batch fix — do not regress)
- `poPlanLinks` table + write path (mig 0094 — do not regress)
- Active draft panel (mould math, surplus destination, allocation list)
- Cross-product line click prompt ("Start new draft for {product}? Current draft will be parked.")

---

## 2 · Remove from this page

### 2.1 Stage chips in the week view
Currently the bottom renders stage chips (POL, SHE, FIL, CAP, UNM, SEAL) per batch per day. **Remove all of that.** Replace with Schedule section (§5).

Stages live exclusively on Plan(week) / `/plan?view=weekly`. **Do NOT touch Plan(week) in this batch.**

### 2.2 Anything labeled "Gantt" / "WeekStrip in stage mode"
Remove.

---

## 3 · What's being added

### 3.1 Demand workspace view switcher

Tabs at top of demand panel: **By product / By campaign / By mould / By customer**.

| View | Group by | Sort within group |
|---|---|---|
| By product | `productId` | mould-cavity ↑, then demand desc |
| By campaign | `productionOrders.campaignId` → `campaigns` + "no campaign" bucket | due date asc |
| By mould | `products.defaultMouldId.numberOfCavities` | demand desc |
| By customer | `orders.customerName` + `orders.eventName` (events separate) | due date asc |

All views share source filter chips, search, "in draft" / "X of Y left" awareness, checkbox-to-allocate.

View state persists in localStorage keyed `dulceria.manual-planner.view.v1`.

### 3.2 Campaign view: review-and-build

Expanded campaign:
- Each product line has a checkbox (default all checked)
- Sticky action bar: "{N} selected · Build {N} drafts" with primary button
- Click → `buildDraftsFromCampaign(campaignId, productIds[])`:
  1. For each productId: `productionPlans` row with `status='draft'`, `name='{campaignName} · {productName}'`, `pinnedDate=null`
  2. `planProducts` row: productId, defaultMouldId, ceil(target/cavities) mould fills
  3. `poPlanLinks` rows linking the campaign's `productionOrderItems` for that product
  4. Refetch `useDraftPlans()`
- Skip products already in any draft for that campaign; toast skipped items

### 3.3 Mould view: capacity hint

Banner above products in a mould-cavity group:
> "40-cav mould bucket: 6 products · 247 pcs demand · 7 mould fills · 33 cavities surplus across fills"

### 3.4 Customer view: isolated flag

Customers with `orders.isolated = true`:
- Group shows `isolated` badge
- Ticking an isolated line in active draft → soft warning: "This customer's order is marked isolated — don't combine with other allocations."

### 3.5 Combine hint in active draft

If any other draft (active or parked) uses the SAME mould:
- Inline hint card: "💡 {OtherDraftName} ({mouldCavities}-cav) could be combined. [Merge?]"
- "Merge?" → `mergeDrafts(activePlanId, otherPlanId)`

### 3.6 "Add to schedule pool" as primary save

Rename "Park draft" → "Add to schedule pool" (same DB action: `status='draft'`, `pinnedDate=null`).

Keep "Save & pin to day" as secondary (enabled after drag-to-day on active draft).

### 3.7 Schedule section (NEW — collapsible)

**Collapsed (default):**
- Bar: "Schedule · X batches in pool · Y on the week · ▼"
- State persists in localStorage `dulceria.manual-planner.sched-open.v1`

**Expanded:**
- Pool on left (280px) + Week strip on right (flex)
- Pool = vertical stack, one card per `productionPlans WHERE status='draft' AND pinnedDate IS NULL AND allocationCount > 0`
- Pool card: name, line count, source summary, mould fills, total pcs, campaign tag if applicable
- Week strip: 7 day cards (Mon–Sun visible week), prev/today/next nav
- Pinned pills on each day from `productionPlans WHERE status='active' AND pinnedDate IN this week`
- Pill shows batch name + fill count only (no stage breakdown)

### 3.8 Drag pinned pills anywhere (the unlock)

Pinned pills are freely draggable. No popover, no extra step.

| Drag source | Drop target | Effect |
|---|---|---|
| Pinned pill, day A | Day B cell (same week) | `pinnedDate` = day B. Stays `status='active'`. |
| Pinned pill, day A | Pool area | `pinnedDate=null`, `status='draft'`. Pill → pool card. |
| Pool card | Day cell | `pinnedDate=toDate`, `status='active'`. Card → day pill. |
| Active draft card (tray) | Day cell | Sets `pinnedDate` on active draft (existing behavior). |

All four flows = one drag layer. No "Send back to pool" button.

### 3.9 Split pinned batch

Lemon Bar needs 5 fills but only 3 fit in one day. Split: 3 fills Mon + 2 fills Tue.

**UI:**
- Click pinned pill → popover with [Split…], [Open on Plan(week) →], [Merge with sibling] (if applicable)
- "Split…" → `SplitBatchModal`:
  - Counter: "Move N fills" — min 1, max totalFills - 1, default floor(totalFills / 2)
  - Target radio: "To day:" (day picker for visible week) / "To pool"
  - Preview: "Original keeps M fills · {cavities × M} pcs · N goes to {target}"
  - [Cancel] / [Split]

**Persistence — `splitPlan(planId, fillsToMove, target)`:**
1. Load original + planProducts + orderPlanLinks + poPlanLinks
2. Generate new uuid for `siblingGroupId` if original doesn't have one; otherwise reuse
3. Write `siblingGroupId` on original
4. Create new `productionPlans` row: same productId, mouldId, `status='active'` (or `'draft'` if target=pool), `pinnedDate=targetDate || null`, `siblingGroupId=same`, `name='{originalName} · split'`
5. New `planProducts` row: `quantity=fillsToMove` on new plan
6. Update original `planProducts.quantity` -= fillsToMove
7. Redistribute allocations proportionally:
   - For each `orderPlanLinks` / `poPlanLinks` row on original:
     - `newQty = floor(origQty × fillsToMove / totalFills)`
     - Create matching link on new plan with `allocatedQuantity = newQty`
     - Update original link row: `allocatedQuantity -= newQty`
     - Delete rows where `allocatedQuantity = 0` after subtract
8. Inherit `surplusDestination` from original on new plan (and `poFillPlanId` if set)
9. Refetch `useSchedulePool` + `usePinnedBatches`

**`productionDayLineItems` for the split-derived plan:** v1 does NOT auto-seed. Stage scheduling for split plans starts empty; Manuela uses Plan(week) to add them. Log as known limitation.

### 3.10 Merge sibling batches

Inverse of split.

**UI:**
- Pill with `siblingGroupId IS NOT NULL` + ≥1 other sibling shows a chain-link icon (top-right of pill)
- Click pill → popover lists siblings with day labels
- "Merge with {siblingName} ({day label})"

**Persistence — `mergeSiblingPlans(planAId, planBId)`:**
1. Validate same productId, mouldId, siblingGroupId
2. Pick survivor: earlier `pinnedDate` (or active over draft if mixed)
3. Sum `planProducts.quantity` onto survivor
4. Recombine allocations: for each link on deleted plan, add `allocatedQuantity` to matching link on survivor (match by `orderItemId` or `productionOrderItemId`); create new link on survivor if no match
5. Delete merged-from plan (cascades clear its link rows)
6. If survivor is only plan with `siblingGroupId`: clear it to null
7. Refetch

### 3.11 Batch peek popover

Click pinned pill → popover with:
- Batch summary (name, mould, fills, pcs, allocations preview)
- [Split…] → SplitBatchModal
- [Merge with sibling] → only when ≥1 sibling exists
- [Open on Plan(week) →] → `/plan?view=weekly&focusPlanId={id}`

No "Send back to pool" button — drag handles that.

---

## 4 · Data layer

### 4.1 New hooks

| Hook | Returns | Source |
|---|---|---|
| `useCampaignsWithDemand()` | Campaigns + nested POs + items + totals + due dates | `campaigns` + `productionOrders` + `productionOrderItems` |
| `useDemandByMould()` | Products grouped by `defaultMouldId.numberOfCavities` | from `aggregateDemandByProduct()` + products + moulds |
| `useDemandByCustomer()` | Orders grouped by `customerName + eventName` | `orders` + `orderItems` + products |
| `useSchedulePool()` | `productionPlans WHERE status='draft' AND pinnedDate IS NULL AND allocationCount > 0` | productionPlans |
| `usePinnedBatches(weekStart, weekEnd)` | `productionPlans WHERE status='active' AND pinnedDate IN range` | productionPlans |

Underlying demand math unchanged — same `aggregateDemandByProduct`, new grouping selectors.

### 4.2 `buildDraftsFromCampaign(campaignId, productIds[])`
File: `src/lib/manual-planner/build-drafts-from-campaign.ts`. Per §3.2.

### 4.3 `mergeDrafts(activePlanId, otherPlanId)`
File: `src/lib/manual-planner/merge-drafts.ts`. Per §3.5. For build-phase same-mould drafts.

### 4.4 Save flow updates

Drag pool card onto day OR "Save & pin to day":
1. `pinnedDate` set + `status` flip `'draft'` → `'active'`
2. Refetch pool + pinned

"Add to schedule pool" on active draft:
1. `saveDraftToPlan(draft, { status: 'draft', pinnedDate: null })`
2. Clear localStorage active draft
3. Refetch pool

### 4.5 Drag handler logic

Single drag-drop layer:

```ts
type DropEvent =
  | { kind: 'pinnedPill→day', planId: string, fromDate: string, toDate: string }
  | { kind: 'pinnedPill→pool', planId: string, fromDate: string }
  | { kind: 'poolCard→day', planId: string, toDate: string }
  | { kind: 'activeDraft→day', toDate: string }
```

Each dispatches to: `movePinnedToDay`, `unpinToPool`, `pinFromPool`, `setActivePinnedDate`.

### 4.6 Migration 0095 — siblingGroupId

```sql
-- supabase/migrations/0095_plan_sibling_group.sql

ALTER TABLE "productionPlans"
  ADD COLUMN "siblingGroupId" uuid;

CREATE INDEX "idx_production_plans_sibling_group"
  ON "productionPlans"("siblingGroupId")
  WHERE "siblingGroupId" IS NOT NULL;

COMMENT ON COLUMN "productionPlans"."siblingGroupId" IS
  'UUID shared by all plans originating from a split. Cleared when only one plan remains in the group.';
```

No backfill — existing plans have NULL `siblingGroupId`. Splits going forward populate it.

### 4.7 `splitPlan(planId, fillsToMove, target)`
File: `src/lib/manual-planner/split-plan.ts`. Per §3.9.

### 4.8 `mergeSiblingPlans(planAId, planBId)`
File: `src/lib/manual-planner/merge-sibling-plans.ts`. Per §3.10. Distinct from `mergeDrafts` in §4.3 — that's for build-phase same-mould drafts, this is for pinned/scheduled siblings created by `splitPlan`.

### 4.9 `movePinnedToDay(planId, toDate)`
Single-field update on `productionPlans.pinnedDate`. No status change.

### 4.10 `unpinToPool(planId)`
Updates `productionPlans`: `pinnedDate=null`, `status='draft'`.

### 4.11 `pinFromPool(planId, toDate)`
Updates `productionPlans`: `pinnedDate=toDate`, `status='active'`.

---

## 5 · UI components

### New
```
src/components/manual-planner/DemandViewSwitcher.tsx
src/components/manual-planner/CampaignView.tsx
src/components/manual-planner/MouldView.tsx
src/components/manual-planner/CustomerView.tsx
src/components/manual-planner/CombineHintCard.tsx
src/components/manual-planner/SchedulePool.tsx
src/components/manual-planner/ScheduleSection.tsx
src/components/manual-planner/PoolCard.tsx
src/components/manual-planner/PinnedBatchPill.tsx
src/components/manual-planner/BatchPeekPopover.tsx
src/components/manual-planner/SplitBatchModal.tsx
```

### Updated
```
src/app/(app)/production-brain/manual/page.tsx           rewire layout
src/components/manual-planner/ActiveDraftPanel.tsx       rename buttons; mount CombineHintCard
src/components/manual-planner/DemandList.tsx             becomes part of ProductView
```

### Deleted
Whatever currently renders stage chips at bottom of `/production-brain/manual`. Find, delete, remove mount from `manual/page.tsx`. Do NOT touch Plan(week).

---

## 6 · Interactions

### View switching
- Click tab → active view changes instantly
- Active draft, search, source-chip filters preserved across switches
- View persists in localStorage

### Campaign build
1. "By campaign" → click campaign → expand
2. Uncheck unwanted products
3. "Build N drafts" → drafts appear in tray
4. Toast confirmation

### Mould combine
1. "By mould" → 40-cav bucket
2. Active draft has Pistachio Bar (24/40)
3. Tick Apple Walnut B2B line (40-cav)
4. Cross-product prompt → confirm
5. CombineHintCard → Merge → both allocations on one batch

### Schedule section
1. Drafts in tray → click "Schedule ▼" → expands
2. Pool shows parked drafts
3. Drag pool card onto day → pill on day, card removed from pool

### Move pinned (drag-anywhere — new)
- Drag pinned pill Wed → drop Thu = `pinnedDate` becomes Thu
- Drag pinned pill Wed → drop pool = back to pool, `status='draft'`
- Drag pool card → drop Wed = pinned to Wed
- All one drag, no popover/confirmation

### Split (new)
1. Click pinned pill → popover
2. [Split…] → SplitBatchModal
3. Counter to 2 of 5 fills
4. Target: "To day: Tuesday" OR "To pool"
5. [Split] → modal closes
6. Original pill: "3 fills"; new pill on Tuesday: "Lemon Bar · 2 fills · split"
7. Both have chain-link icon (siblingGroupId set)

### Merge siblings (new)
1. Click pill with chain-link → popover
2. Lists siblings: "Lemon Bar · 2 fills (Tue 13)"
3. "Merge with Tue 13 sibling" → confirm
4. Surviving pill: "Lemon Bar · 5 fills"
5. Tuesday pill removed
6. `siblingGroupId` cleared on survivor (last in group)

---

## 7 · Acceptance criteria

Each screenshot-verifiable. Each gets `✓ {item} — {file:line}` or `✗ {item} deferred — {specific reason}`.

### Layout
1. Top section is 60/40 grid: workspace left, active draft right (≥1024px)
2. Workspace has 4 tabs: "By product", "By campaign", "By mould", "By customer"
3. Active tab dark teal, count badge per tab
4. View switch is instant, no reload
5. View choice persists across refresh

### Views
6. By campaign: campaigns render as groups, products as checkbox sub-rows
7. By campaign: "Build N drafts" creates parked drafts for each checked product
8. By campaign: skip + toast for products already in a draft for that campaign
9. By mould: products group by `moulds.numberOfCavities`
10. By mould: capacity banner shows demand + fills + surplus
11. By customer: groups by `customerName + eventName`; isolated badge present
12. By customer: ticking isolated line shows warning in active draft

### Combine + save
13. CombineHintCard appears when another draft uses same mould as active
14. Merge action combines allocations, deletes other draft
15. "Park as draft" renamed → "Add to schedule pool"
16. "Save & pin to day" still works (enabled after drag onto day)

### Remove
17. Stage chips no longer render at bottom of `/production-brain/manual`

### Schedule section
18. Schedule section collapsed by default
19. Collapse state persists across refresh
20. Expanded: pool left (280px), week strip right
21. Pool shows `productionPlans WHERE status='draft' AND pinnedDate IS NULL AND allocationCount > 0`
22. Pool card shows: name, line count, source summary, fills, pcs, campaign tag

### Drag-anywhere (the unlock)
23. Drag pool card onto day → `pinnedDate` set, `status='active'`, card moves to day as pill
24. **Drag pinned pill day A → day B → `pinnedDate` updates, stays `status='active'`, pill moves visually**
25. **Drag pinned pill day → pool → `pinnedDate=null`, `status='draft'`, pill removed from day, card appears in pool**
26. **All three drag flows work without popover or confirmation**

### Pills + peek
27. Pinned pill shows batch name + fill count (no stage breakdown)
28. Click pill → BatchPeekPopover opens
29. Peek has [Split…], [Open on Plan(week) →]
30. Peek has [Merge with sibling] action only when `siblingGroupId IS NOT NULL` and ≥1 other plan shares the group
31. Pill shows chain-link icon when `siblingGroupId IS NOT NULL` and ≥1 sibling exists

### Split
32. Click [Split…] → SplitBatchModal opens
33. Counter: min 1, max totalFills - 1, default floor(totalFills / 2)
34. Target: radio "To day" (day picker, visible week) / "To pool"
35. Preview readout updates as counter changes
36. Confirm split → mig 0095 applied, new plan created, allocations redistributed proportionally
37. Both plans have same `siblingGroupId` (a new uuid)
38. Original pill's fill count decreases, new pill appears on target day (or new card in pool if target=pool)
39. Original plan's allocations reduced by `floor(origQty × fillsToMove / totalFills)` per row
40. New plan's allocations sum to `fillsToMove × cavities` (with surplus absorbing rounding)

### Merge siblings
41. Click pill with chain-link → peek lists siblings with day labels
42. Click "Merge with {sibling}" → confirms then merges
43. Survivor's `planProducts.quantity` += merged plan's quantity
44. Allocations recombined: matching link rows summed, non-matching added
45. Merged-from plan deleted from DB (link tables cascade)
46. If only survivor remains in group: `siblingGroupId` set to null

### Migration
47. Mig 0095 created and runs cleanly in Supabase

### Week nav
48. Prev / today / next buttons work in schedule section, no reload

### Verification
49. After deploy: screenshot manual planner in collapsed AND expanded schedule states, attach to commit
50. After deploy: do full round trip — split → merge → unpin → re-pin — paste DB state SQL confirmations into commit

---

## 8 · Out of scope (do NOT touch)

- Plan(week) page — completely separate
- Stage-level scheduling on this page
- Variant-line demand (`orderItems.variantId IS NOT NULL` still skipped)
- Editing already-active / already-pinned plans inline (drag is the only "edit" for placement)
- Multi-product batches in `planProducts` (still 1 product per plan)
- PO lifecycle auto-transitions on save
- Mould double-booking detection across days
- Equipment occupancy
- Multi-week zoom on schedule section
- Real-time multi-user collaboration
- Auto-suggest "best day to schedule on"
- Cost / margin display
- **Auto-seeding `productionDayLineItems` for split-derived plans** — stage scheduling for split plans starts empty on Plan(week); revisit if Manuela hits friction
- **Splitting unpinned (pool / draft) batches** — split is for pinned plans only in v1. Pin first to split.
- **Manual allocation reassignment during split** — v1 is proportional auto-distribute. Edit through normal allocation UI after split.

If anything here feels like it should be tackled, log a TODO referencing this spec and ship without it.

---

## 9 · Commit rules

- Every AC line (50 total) gets `✓ {item} — {file:line range}` or `✗ {item} deferred — {specific reason}`
- Vague `✓ done` without file references = not done. Hard rule.
- Deferrals surfaced explicitly. Do not pick scope unilaterally.
- After deploy: screenshot collapsed + expanded states, attach.
- After deploy: full split → merge → unpin → re-pin round trip with DB state confirmations pasted.

Commit message template:

```
Manual Planner — multi-pivot workspace + schedule pool + split/merge + drag-anywhere

Schema:
✓ Mig 0095 siblingGroupId — supabase/migrations/0095_plan_sibling_group.sql

Removed:
✓ Stage chips at bottom of page — {filename:lines}

Hooks:
✓ useCampaignsWithDemand — hooks.ts:lines
✓ useDemandByMould — hooks.ts:lines
✓ useDemandByCustomer — hooks.ts:lines
✓ useSchedulePool — hooks.ts:lines
✓ usePinnedBatches — hooks.ts:lines

Helpers:
✓ buildDraftsFromCampaign — build-drafts-from-campaign.ts
✓ mergeDrafts — merge-drafts.ts
✓ splitPlan — split-plan.ts
✓ mergeSiblingPlans — merge-sibling-plans.ts
✓ movePinnedToDay / unpinToPool / pinFromPool — {files}

UI: (all 50 ACs with file:line refs)

Out of scope (correctly deferred):
✗ Plan(week) changes
✗ productionDayLineItems auto-seed for split plans — known limitation
...

Verification:
- Screenshot collapsed: {url}
- Screenshot expanded: {url}
- Round trip SQL: {pasted output}
```

---

**End of spec.**
