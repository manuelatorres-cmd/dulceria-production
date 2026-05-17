# MANUAL_PLANNER_WORKSPACE_BATCH.md

**App:** Production · Workshop
**Page:** `/production-brain/manual`
**Mockup reference:** `manual-planner-workspace.html` (Manuela's local copy at `C:\Users\manue\Desktop\DULCERIA\CLAUDE\REMAKE\manual-planner-workspace.html` — ask her to open it for visual reference during build)
**Spec date:** 2026-05-17
**Status:** approved by Manuela · ready to build

**Standing rules apply.** Evidence-per-item commits. No silent partial shipments. Do not write a "v3" spec to supersede this one — extend in place if you need to clarify something, and surface the change in the commit. If a spec item can't be built as described, log `✗ {item} deferred — {specific reason}` with the deferral surfaced clearly. Do not interpret unilaterally.

---

## 0 · Context

This page composes batches from demand. Stages / steps belong to a different page (Plan(week)). The currently-shipped version has stage chips rendered at the bottom of this page — **those go away in this batch**. This page now ends at "batch pinned to a day"; stage-level scheduling lives on Plan(week).

The page has three vertical zones in the new design:

1. **Top — Demand workspace + Active draft** (60/40 split, side-by-side)
2. **Middle — Drafts tray** (full-width horizontal band)
3. **Bottom — Schedule section** (collapsible; expands to show Schedule pool + week strip side-by-side)

Mockup file is the visual contract. Differences from the mockup get surfaced in the commit.

---

## 1 · Already shipped — keep working, do NOT rebuild

These are live and correct. Don't touch unless this spec explicitly says so.

- **Drafts tray** — horizontal band, parked draft cards, click to load active, drag to day to pin. Already shipped.
- **Source filter chips** — Online / B2B / Event / Shop / Restock-PO / Campaign-PO / Urgent / Already-in-draft. Already shipped.
- **`useDraftPlans()` filter for `allocationCount > 0`** — fix from the cleanup batch. Already shipped. Do not regress.
- **`poPlanLinks` table + write path** — already shipped (mig 0094). Do not regress.
- **Active draft panel** — mould math, surplus destination radio, allocation list. Already shipped.
- **Cross-product line click prompt** — "Start new draft for {product}? Current draft will be parked." Already shipped.

Changes to these are itemized below where needed.

---

## 2 · Remove from this page

### 2.1 Stage chips in the week view

Currently the bottom of this page renders stage chips (POL, SHE, FIL, CAP, UNM, SEAL etc.) per batch per day. **Remove all of that.** Replace with the Schedule section described in §5.

Stages now live exclusively on Plan(week) / `/plan?view=weekly` — DO NOT touch that page in this batch. Just remove the stage rendering from `/production-brain/manual`.

### 2.2 Anything labeled "Gantt" or "WeekStrip in stage mode" on this page

Remove. Replace with collapsible Schedule section.

---

## 3 · What's being added

### 3.1 Demand workspace view switcher

The left panel currently shows one view (by product). Add 3 more views, switchable via tabs at the top of the panel:

| View | Group by | Sort within group |
|---|---|---|
| By product | `productId` | mould-cavity ↑, then demand desc |
| By campaign | `campaignId` (via `productionOrders.campaignId` → `campaigns`) + a "no campaign" bucket for loose demand | due date asc |
| By mould | `products.defaultMouldId.numberOfCavities` (so all 40-cav products group together, all 24-cav, etc.) | demand desc |
| By customer | `orders.customerName` + `orders.eventName` (events as separate bucket) | due date asc |

All four views share:
- The same source filter chips (channel-based) above
- The same search box
- The same "in draft" / "X of Y left" awareness on lines
- The same checkbox-to-allocate behavior

**View state persists in localStorage** keyed `dulceria.manual-planner.view.v1` (so refresh keeps your view).

### 3.2 Campaign view: review-and-build button

When a campaign group is expanded:
- Each campaign product line gets a checkbox (default all checked)
- At the bottom of the expansion: a sticky action bar showing "{N} selected · Build {N} drafts" with a primary button
- Clicking the button calls a new helper `buildDraftsFromCampaign(campaignId, productIds[])` which:
  1. For each productId, creates one `productionPlans` row with `status='draft'`, `name='{campaignName} · {productName}'`, `pinnedDate=null`
  2. Creates `planProducts` row with productId + defaultMouldId + ceil(target/cavities) mould fills
  3. Creates `poPlanLinks` rows linking the campaign's `productionOrderItems` for that product to the new plan, full target quantity
  4. Refetches `useDraftPlans()` — new cards appear in tray as parked drafts
- If a product is already in an active draft or parked draft for this campaign, skip it (don't double-create) and surface a toast "Skipped X (already in draft)"

### 3.3 Mould view: capacity hint per group

When a mould-cavity group is expanded:
- Show a small banner above the products: "40-cav mould bucket: 6 products · 247 pcs demand · 7 mould fills minimum · 33 cavities surplus across fills"
- This helps see where you can combine to fill empty cavities

### 3.4 Customer view: isolated flag honored

For customers with `orders.isolated = true`:
- The customer group shows a small `isolated` badge
- Inside the active draft, if you tick a line from an isolated customer, show a soft warning: "This customer's order is marked isolated — don't combine with other allocations."
- Doesn't block, just warns.

### 3.5 Combine hint in active draft

When the active draft is being edited, check if any other draft (active or parked) uses the SAME mould:
- If yes, show an inline hint card in the active draft panel: "💡 {OtherDraftName} ({mouldCavities}-cav) could be combined with this batch. [Merge?]"
- Clicking "Merge?": pulls all allocations from the other draft into the active, deletes the other draft from DB, recomputes math
- If no, no hint card renders

### 3.6 "Add to schedule pool" as primary save action

Rename the current "Park draft" button → "Add to schedule pool" (same DB action: write `productionPlans.status='draft'`, no `pinnedDate`).

Keep the "Save & pin to day" button as the secondary action for when the user has dragged the active draft onto a day.

### 3.7 Schedule section (NEW — collapsible)

Bottom of the page. Two states:

**Collapsed (default):**
- Single horizontal bar with: title "Schedule", subtitle "X batches in pool · Y on the week", chevron-down to expand
- Persists collapsed/expanded state in localStorage keyed `dulceria.manual-planner.sched-open.v1`

**Expanded:**
- Two columns: Schedule pool (left, 280px) + Week strip (right, flex)
- Schedule pool: vertical stack of pool cards, one per parked draft (i.e. `productionPlans.status='draft'` with `pinnedDate IS NULL`)
- Each pool card shows: batch name, line count, source summary, mould fills, total pieces, campaign tag if applicable
- Week strip: 7 day cards (Mon–Sun for visible week)
- Drag pool card onto a day → set `pinnedDate`, flip `status='active'`, card moves from pool to that day as a pill
- Existing pinned batches in the visible week (from `productionPlans WHERE status='active' AND pinnedDate IN this week`) show as pills on their day
- Pills show: batch name only (no stage breakdown — stages live on Plan(week))
- Click a pill → opens a peek popover with batch summary + "Open on Plan(week) →" link
- Week nav prev / today / next at the top of the week strip section

---

## 4 · Data layer

### 4.1 New hooks

| Hook | Returns | Source |
|---|---|---|
| `useCampaignsWithDemand()` | `Campaign[]` with nested `productionOrders` + items, demand totals, due dates | `campaigns` + `productionOrders` + `productionOrderItems` joined |
| `useDemandByMould()` | `MouldDemandGroup[]` — products grouped by `defaultMouldId.numberOfCavities` | derives from `aggregateDemandByProduct()` output + products + moulds |
| `useDemandByCustomer()` | `CustomerDemandGroup[]` — orders grouped by `customerName + eventName` | `orders` + `orderItems` + products |

The underlying demand math doesn't change — same `aggregateDemandByProduct` from the existing build, just three new grouping/selector functions on top.

### 4.2 New helper: `buildDraftsFromCampaign(campaignId, productIds[])`

Already specced above (§3.2). File: `src/lib/manual-planner/build-drafts-from-campaign.ts`.

### 4.3 New helper: `mergeDrafts(activePlanId, otherPlanId)`

For the combine hint (§3.5). File: `src/lib/manual-planner/merge-drafts.ts`. 

Algorithm:
1. Load both drafts (one is in localStorage if active, one is in DB)
2. Validate same mould — throw if mismatched
3. Combine allocations array, summing duplicate orderItemIds / productionOrderItemIds
4. Recompute totals (mould fills, total pieces, surplus)
5. Write the combined draft to active (localStorage)
6. Delete the other draft from DB (cascade clears its `orderPlanLinks` / `poPlanLinks`)

### 4.4 Update `useSchedulePool()`

New hook returning `productionPlans WHERE status='draft' AND pinnedDate IS NULL AND allocationCount > 0`.

This is what feeds the Schedule pool. Note the `allocationCount > 0` filter — same as the `useDraftPlans` fix from the cleanup batch. Don't regress that.

### 4.5 Update save flow

When user drags pool card onto a day, OR clicks "Save & pin to day":
1. Set `pinnedDate` on the plan
2. Flip `status` from `'draft'` to `'active'`
3. Refetch `useSchedulePool()` and pinned-batches query

When user clicks "Add to schedule pool" on active draft:
1. Call existing `saveDraftToPlan(draft, { status: 'draft', pinnedDate: null })`
2. Clear localStorage active draft
3. Refetch `useSchedulePool()`

---

## 5 · UI components

### New components

```
src/components/manual-planner/DemandViewSwitcher.tsx    NEW
src/components/manual-planner/CampaignView.tsx          NEW
src/components/manual-planner/MouldView.tsx             NEW
src/components/manual-planner/CustomerView.tsx          NEW
src/components/manual-planner/CombineHintCard.tsx       NEW
src/components/manual-planner/SchedulePool.tsx          NEW
src/components/manual-planner/ScheduleSection.tsx       NEW  (wraps pool + week strip)
src/components/manual-planner/PoolCard.tsx              NEW
src/components/manual-planner/PinnedBatchPill.tsx       NEW
src/components/manual-planner/BatchPeekPopover.tsx      NEW
```

### Updated components

```
src/app/(app)/production-brain/manual/page.tsx          rewire layout (top grid + tray + schedule section)
src/components/manual-planner/ActiveDraftPanel.tsx      rename buttons; mount CombineHintCard
src/components/manual-planner/DemandList.tsx            now lives inside ProductView (rename or wrap)
src/components/manual-planner/[whatever renders stage chips bottom]  DELETE
```

### Deleted/replaced components

Whatever component is currently rendering stage chips at the bottom of the manual planner page. Find it, delete it, remove its mount from `manual/page.tsx`. Do not touch Plan(week) page — that's a different file.

---

## 6 · Interactions

### View switching
- Click a tab → active view changes immediately, no reload
- Active draft is preserved across view switches
- Search box value is preserved
- Source filter chip selections are preserved
- View choice persists in localStorage

### Campaign build flow
1. User selects "By campaign" view
2. Clicks a campaign row → expands to show products with checkboxes (all checked default)
3. Unchecks any products they don't want
4. Clicks "Build {N} drafts" button
5. Drafts appear in tray as parked cards
6. Toast: "Built {N} drafts from {campaignName}. Open Schedule to pin to days."

### Mould combine flow
1. User in "By mould" view → 40-cav bucket
2. Sees Pistachio Bar in active draft already (24 pcs · 16 free cavities)
3. Clicks B2B Hotel Imperial line for Apple Walnut (also 40-cav)
4. Cross-product prompt fires: "Start new draft for Apple Walnut? Current draft will be parked."
5. User confirms → new draft starts
6. CombineHintCard appears on the new draft: "💡 Pistachio Bar (40-cav) could be combined with this batch. Merge?"
7. User clicks Merge → both draft's allocations combine into one batch on the same 40-cav mould

### Schedule section flow
1. User finishes building drafts → 4 cards in tray as parked
2. Clicks "Schedule ▼" header at bottom → expands
3. Sees the 4 cards in the left pool, week strip on the right
4. Drags Veganmania-Pistachio card onto Saturday → card disappears from pool, appears as pill on Saturday
5. `productionPlans.status='active'`, `pinnedDate='2026-05-16'` saved

### Pin → unpin flow (new)
- Click a pinned pill → peek popover
- Popover has "Send back to pool" action → sets `pinnedDate=null`, `status='draft'`, pill removed from day, card returns to pool

---

## 7 · Acceptance criteria

Each one screenshot-verifiable in the deployed UI. Each gets `✓ {item} — {file:line}` or `✗ {item} deferred — {reason}` in the commit.

1. Top section is a 60/40 grid: demand workspace left, active draft right (on ≥1024px)
2. Workspace has 4 tabs at top: "By product", "By campaign", "By mould", "By customer"
3. Active tab is highlighted dark teal, count badge visible on each tab
4. View switching is instant — no reload, no fetch wait
5. View choice persists across page refresh
6. By campaign: campaigns from `campaigns` table render as groups, products under each campaign as sub-rows with checkboxes
7. By campaign: "Build {N} drafts" button at bottom of expanded campaign creates parked drafts for each checked product
8. By campaign: building drafts for a campaign that already has drafts for some products skips those and toasts the skip
9. By mould: products group by `moulds.numberOfCavities` from `products.defaultMouldId`
10. By mould: capacity banner shows total demand, mould fills needed, surplus capacity across all products in bucket
11. By customer: orders group by `customerName + eventName`, `isolated` flag shows a badge
12. By customer: ticking a line from an isolated customer shows a soft warning in active draft
13. CombineHintCard appears in active draft when another draft uses the same mould
14. Merge action combines allocations from both drafts, deletes the other from DB
15. "Park as draft" button is renamed "Add to schedule pool" in active draft panel
16. "Save & pin to day" button still works as before (only enabled after drag-to-day sets pinnedDate)
17. Stage chips no longer render at the bottom of this page (delete the component that was rendering them)
18. Schedule section is collapsed by default
19. Schedule section state persists across refresh (localStorage)
20. Schedule section expanded: pool on left (280px), week strip on right
21. Pool shows `productionPlans WHERE status='draft' AND pinnedDate IS NULL AND allocationCount > 0`
22. Pool card shows: batch name, line count, source summary, mould fills, total pieces, campaign tag if applicable
23. Drag pool card onto a day cell → `pinnedDate` set, `status='active'`, card moves from pool to day as a pill
24. Pinned batch pills show batch name only (no stage breakdown)
25. Click pinned pill → peek popover with batch summary + "Open on Plan(week) →" link
26. Peek popover has "Send back to pool" action → reverses the pin
27. Week nav (prev / today / next) in the schedule section works without page reload
28. Existing parked drafts (already shipped) still appear in the drafts tray AND in the schedule pool — these are the same set, two views of it
29. After Cursor's build: open the deployed page, screenshot it, attach to commit. Layout must visually match the mockup at desktop width

---

## 8 · Out of scope (explicit — do NOT touch in this batch)

- Plan(week) page — completely separate
- Stage-level scheduling on this page — moved to Plan(week)
- Variant-line demand (`orderItems.variantId IS NOT NULL` still skipped)
- Editing already-active / already-pinned plans inline (still requires Send-back-to-pool first)
- Multi-product batches in `planProducts` (still 1 product per plan)
- PO lifecycle auto-transitions on save
- Mould double-booking detection across days
- Equipment occupancy
- Multi-week zoom on schedule section
- Real-time multi-user collaboration on drafts
- Auto-suggest "best day to schedule this on"
- Cost / margin display

If anything in this section feels like it should be tackled, log a TODO comment with a reference to this spec and ship without it.

---

## 9 · Commit rules

Per standing app rule:
- Every AC line above gets `✓ {item} — {file:line range or diff hunk}` or `✗ {item} deferred — {specific reason}`
- Vague `✓ done` without file references = not done. Last 3 rounds went soft on this. Hard rule now.
- If you defer something, surface it explicitly in the commit message with a reason. Do not pick scope unilaterally.
- After deploy, open the page and screenshot it. Attach screenshot to the PR or commit log.

Commit message template:

```
Manual Planner — multi-pivot workspace + schedule pool

Removed:
✓ Stage chips at bottom of page — {filename:lines}
✓ {whatever-it-was-called}.tsx — deleted

Added:
✓ AC-1 60/40 top grid — page.tsx:lines
✓ AC-2 4-tab view switcher — DemandViewSwitcher.tsx
✓ AC-3 active tab styling — DemandViewSwitcher.tsx:lines
... (all 29 ACs)

Schema:
(no migrations)

Hooks:
✓ useCampaignsWithDemand — hooks.ts:lines
✓ useDemandByMould — hooks.ts:lines
✓ useDemandByCustomer — hooks.ts:lines
✓ useSchedulePool — hooks.ts:lines

Helpers:
✓ buildDraftsFromCampaign — build-drafts-from-campaign.ts
✓ mergeDrafts — merge-drafts.ts

Out of scope (correctly deferred):
✗ Plan(week) changes — separate page
✗ Variant-line demand — separate batch
... (rest of §8)

Screenshot: {url or attachment}
```

---

**End of spec.**
