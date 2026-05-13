# Manual Planner v2 — Implementation spec

Redesign of `/production-brain/manual` page. Target: replace current order-by-order ADD button workflow with a three-zone accumulate-and-drop flow that respects the data model documented in `manual-planner-investigation-2026-05-09.md`.

Reference mockup: `manual-planner-v2.html` (saved in /docs/).

This spec ships in 5 phases. Each phase is independently shippable. Phases 1-3 are the core experience. Phases 4-5 add intelligence.

---

## Phase 1 — Page restructure (3-zone layout)

### Goal

Replace current single-column page with three-zone layout: demand picker (left 380px) + draft bar (top right) + week grid (right main).

### Layout

`src/app/(app)/production-brain/manual/page.tsx`

```tsx
<div className="page-shell">
  <Header />        {/* tabs, title, week nav */}
  <div className="layout-grid">
    <DemandPicker />     {/* left 380px */}
    <div className="right-column">
      <DraftBatchBar />  {/* top */}
      <WeekGrid />       {/* main */}
    </div>
  </div>
</div>
```

CSS grid: `grid-template-columns: 380px 1fr; gap: 24px`.

### Header

- Tabs (Dashboard / Daily / Planner / Needed / Manual / Equipment / HACCP) — already exist in nav, just make sure Manual is active state
- Page title "Manual planner" + subtitle "Select demand · build a draft batch · drop on a day · save as production order."
- Week navigation: "← prev week" / "today" / "next week →" buttons. Current week shown in WeekGrid header.

### Apply Dulceria visual system

Use brand tokens consistently:
- `--page-bg: #fbf6f1`, `--card-bg: #ffffff`, `--border-warm: #e8e3d6`
- `--text-primary: #2c2515`, `--text-muted: #8a7e64`
- Tier colors: caramel `#dab73f` (north star + draft batches), deep teal `#264443` (locked + dominant), blush `#fbccb9` (active/drafts), warm rose `#993556` (urgent/overdue), mint `#5dcaa5` (positive)
- Typography: Playfair Display for serif headers, Inter/system for body
- 0.5px borders, no drop shadows, no gradients
- Sentence case throughout

### Verify

1. Page loads with three zones visible
2. Left pane fixed 380px width, right pane takes remaining space
3. Header tabs match existing nav patterns
4. Week navigation works (changes week shown in WeekGrid)

---

## Phase 2 — Demand picker (left pane)

### Goal

Replace current flat demand list with category-grouped product rows that expand to show orders + POs.

### Data fetching

Use existing hooks (already imported in current page):
```typescript
useOrders, useAllOrderItems, useProductionOrders, useAllProductionOrderItems,
useProductsList, useMoulds, useAllPlanProducts, useProductionPlans
```

### Aggregation logic (new)

`src/lib/manual-planner/aggregate-demand.ts`:

```typescript
export interface ProductDemand {
  productId: string;
  productName: string;
  category: string;          // grouping bucket — "moulded" / "bars" / "bars-filled" / "toasties" / etc.
  mouldId: string;
  mouldName: string;
  numberOfCavities: number;
  quantityOwned: number;
  totalDemand: number;
  orderDemand: number;
  poDemand: number;
  currentStock: number;
  alreadyPlannedInDrafts: number;     // sum of pieces in active+draft plans
  alreadyPlannedInActive: number;
  urgencyLevel: 'none' | 'soon' | 'urgent' | 'overdue';
  earliestDeadline: Date | null;
  orderItems: OrderItemWithMeta[];
  poItems: PoItemWithMeta[];
}

export function aggregateDemandByProduct(input: AggregateInput): ProductDemand[];
```

Inputs: open orders, open order items, open POs, open PO items, products, moulds, all plans (to compute already-planned), stock levels.

Steps:
1. Filter orders to `pending` + `in_production` status, items to `fulfilmentMode === 'produce'`
2. Subtract pieces already linked to active/done plans (via `orderPlanLinks` and `productionOrderItems` linked to plans)
3. Aggregate POs separately (orders use `reconcileGlobalProduceDemand` path, POs use `seedProductionOrderDrivenPlans` path — DON'T merge these into one batch in the data model, but DO show side by side in UI)
4. Compute urgency: `overdue` if any deadline past today, `urgent` if any deadline within 3 days, `soon` if within 7 days, else `none`
5. Compute already-planned-in-drafts and already-planned-in-active separately so UI can show both
6. Group by `category` field — see next section

### Category grouping

Products need a `category` field for grouping. Options:

**Option A:** Use existing `productCategories` table (referenced via `Product.productCategoryId`). Read category names directly.

**Option B:** Group by mould type (filled / 3-cav / bar / bar-filled / toasty). Simpler to compute, matches mould-driven workflow.

**Recommendation:** Option B for v1. Group key = mould name normalized. Categories show as:
- "Moulded" (3-cav, filled, etc.)
- "Bars" (bar mould)
- "Bars filled" (bar with filling)
- "Toasties"
- Sub-grouped within each (e.g., "Moulded · 3-cav 40 pcs/run" vs "Moulded · filled 16 pcs/run")

When the data model gets a proper category taxonomy, switch to A.

### Component structure

```
DemandPicker
├── PaneHeader (title + meta count)
├── FilterRow (All / Online orders / POs / Urgent / Low stock)
└── PaneBody
    └── for each category:
        CategoryGroup
        ├── CategoryHeader (dot + name + count + meta)
        └── for each product:
            ProductRow (collapsed by default)
            └── on click: OrdersExpanded
                ├── SmartSuggestion (Phase 4)
                ├── OrderLines (orders section)
                └── PoLines (POs section)
```

### ProductRow visual states

- **Default**: white background, no left border
- **Has urgent demand**: warm rose left border (3px)
- **Already partially planned**: blush left border + indicator "40 planned Tue"
- **In active draft batch**: caramel left border + caramel-tinted bg + "in draft batch" tag
- **Stock covers demand**: 40% opacity, dimmed
- **Expanded**: cream-tinted bg, chevron rotates

Show inline:
- Product name (14px, weight 500)
- Stock level: "stock 24" (italic muted)
- One-line summary: "67 pcs · 17 ord · 50 PO · 3-cav · 40 pcs/run"
- Urgency tag: "⚠ 3 due in 2d" (warm rose, weight 500)
- Already-planned tag: "40 planned Tue" (deep teal)

### Filter pills

- All (default active)
- Online orders only — filters demand to `orderDemand > 0`
- POs only — filters to `poDemand > 0`
- Urgent — filters to `urgencyLevel === 'urgent' || 'overdue'`
- Low stock — filters to `currentStock < totalDemand`

Filter state stored in URL query params for back-navigation persistence.

### Search

Simple input above filter row: "Search product name..." — filters by `productName.toLowerCase().includes(query)`.

### Verify

1. All 29 products grouped into mould-type categories
2. Each category shows dot + name + product count + mould meta
3. Click product row → expands showing orders + POs
4. Click again → collapses
5. Only one row expanded at a time (collapses others on expand)
6. Filter pills work — urgency filter shows only urgent/overdue products
7. Search filters products by name
8. URL state preserves filters across reload

---

## Phase 3 — Draft batch + week grid (drop flow)

### Goal

Implement the accumulation flow: click orders to add → draft batch bar updates → drag draft to a day → save as production order.

### Draft batch state

Persists in localStorage during composition (matches existing pattern at `dulceria.manual-planner.drafts.v1`). Cleared on save or cancel.

```typescript
interface DraftBatch {
  id: string;                    // tempId, generated client-side
  productId: string;
  productName: string;
  mouldId: string;
  numberOfCavities: number;
  mouldCount: number;            // computed: ceil(totalDemand / numberOfCavities)
  totalPieces: number;           // mouldCount × numberOfCavities
  totalDemand: number;
  surplus: number;
  surplusDestination: 'store' | 'freezer' | 'waste' | 'po-fill' | null;
  poFillPlanId: string | null;   // if surplus → po-fill, which PO
  allocations: DraftAllocation[];
  pinnedDate: string | null;     // ISO date once dropped on calendar
  notes: string;
}

interface DraftAllocation {
  source: 'order' | 'po';
  parentId: string;              // orderItemId or productionOrderItemId
  qty: number;
  customerName?: string;         // for display
  dueDate?: Date;
}
```

Multiple drafts per session are NOT supported in v1 — one draft batch in progress at a time. Future v2 could allow multiple parallel drafts.

### Adding to draft

Click order line in expanded ProductRow:
- If no draft yet: create new draft with this product + this allocation
- If draft exists for SAME product: add allocation to existing draft, recompute mouldCount + totalPieces
- If draft exists for DIFFERENT product: warn user "Save current draft first or cancel before adding different product" (one product per batch per data model)

Visual feedback: row highlights with caramel border, checkbox fills, draft bar updates with new total.

### DraftBatchBar component

Top of right pane. Two states:

**Empty state:**
```
┌─────────────────────────────────────────────────┐
│ Draft batch is empty.                            │
│ Click orders or POs in the list to start.        │
└─────────────────────────────────────────────────┘
```
Dashed border, italic muted text.

**Active state:**
```
┌─────────────────────────────────────────────────┐
│ Draft batch    1 product · 40 pcs · 1 fill ·    │
│                ~5h 30m total      [Cancel draft]│
│                                                  │
│ ● Almond Praline · 40 pcs (3-cav) [×]           │
│   drag to a day below ↓                          │
│                                                  │
│ ⏵ drop on a day to set production date           │
│                              [Edit] [Save as PO] │
└─────────────────────────────────────────────────┘
```

- Title in serif 16px
- Summary line: products count, total pieces, mould fills, total time (sum of activeMinutes for all steps from `productionSteps` for this product type)
- Each draft item as chip: dot + product + qty + (×) remove
- Status line showing whether target day is set
- Save button disabled until pinnedDate is set

### Computing total time

Use `productionSteps` table for the product's `productType`:

```typescript
function computeBatchTime(productType: string, mouldCount: number): number {
  const steps = productionSteps.filter(s => s.productType === productType);
  return steps.reduce((sum, step) => {
    const mins = step.perBatch ? step.activeMinutes : step.activeMinutes * mouldCount;
    return sum + mins;
  }, 0);
}
```

This matches scheduler logic at `src/lib/scheduler.ts:292-295`.

### Drag-and-drop

Use `@dnd-kit/core` (likely already installed for other drag flows in app, or install if not).

Draft batch bar is the drag source. When user starts dragging:
- Bar shows "drop on a day below ↓" hint
- Week grid days highlight as potential drop targets (border becomes dashed caramel)
- Closed days reject drop

On drop on a day:
- `draft.pinnedDate = day.iso`
- Day cell shows draft preview block (dashed border, caramel left border, "+ Almond Praline batch · 40 pcs · ~5h 30m")
- Other days un-highlight
- DraftBatchBar updates: status line becomes "Pinned to Wed 6 May" (deep teal, weight 500)
- Save button enables

User can re-drag to different day → preview moves.

### WeekGrid component

7 columns, one per weekday. Mon-Sun layout.

Each day column:

```
┌─────────────────┐
│ MON             │  ← day-header-cell
│ 4 May           │
│ 0h / 14h        │
│ ▓░░░░░░░ 0%     │  ← cap-bar
├─────────────────┤
│ [step blocks]   │  ← day-content
│ [step blocks]   │
│ [empty hint]    │
│                 │
└─────────────────┘
```

### Day header cell

- Day name (uppercase, 11px, muted, letterspacing 0.05em)
- Date (14px, weight 500, tabular-nums)
- Capacity: "X / Y" where X = sum of plannedMinutes from `productionDayLineItems`, Y = effectiveDailyCapacityMinutes from `capacityConfig`
- Capacity bar: 3px tall, filled %
- Color: mint < warnThreshold, caramel < criticalThreshold, rose ≥ critical

Working days come from `capacityConfig.workingDays`. Non-working days render as "closed" with diagonal stripe pattern, no drop allowed.

Today: cream-tinted bg, rose date number.

### Step blocks in day content

For each `productionDayLineItem` for this date:

```typescript
function renderDayContent(date: string, lineItems: ProductionDayLineItem[]) {
  // Group lineItems by parent plan
  const byPlan = groupBy(lineItems, 'planId');
  
  // For each plan, render its steps for this day
  return Object.entries(byPlan).flatMap(([planId, items]) => {
    const plan = plans.find(p => p.id === planId);
    const planProduct = planProducts.find(pp => pp.planId === planId);
    
    return items.flatMap(item => 
      item.stepIds.map(stepId => {
        const step = productionSteps.find(s => s.id === stepId);
        return (
          <StepBlock
            key={stepId}
            step={step}
            plan={plan}
            planProduct={planProduct}
            isLocked={!!plan.pinnedDate}
            isActive={step.activeMinutes > 0}
            isPassive={step.waitingMinutes > 0 && step.activeMinutes === 0}
          />
        );
      })
    );
  });
}
```

StepBlock visual:
- **Active step**: solid bg `--page-bg`, blush left border 3px
- **Locked active**: deep teal left border, 🔒 prefix
- **Passive step**: dashed border, italic muted text, "⏱" prefix, "20h passive · → next day" annotation if spans
- **Conflict**: small inline "⚠ Mould 11:00" warning, rose color

Each step shows:
- Step name + product name on first line: "Fill · Almond Praline" (weight 500)
- Meta on second line: "40 pcs · 2h · 10:00" (10px, muted)

Click step → opens edit drawer (existing pattern, just bring in the existing component).

### Save flow

When user clicks "Save as production order":

1. Validate: `draft.pinnedDate` is set, `draft.allocations.length > 0`
2. Call `saveProductionPlan({ name, status: 'active', pinnedDate, notes, createdAt, updatedAt })` → returns planId
3. Call `savePlanProduct({ planId, productId, mouldId, quantity: mouldCount, sortOrder: 0 })`
4. For each `allocation` where `source === 'order'`: call `saveOrderPlanLink({ orderItemId: allocation.parentId, planId, allocatedQuantity: allocation.qty })`
5. For each `allocation` where `source === 'po'`: link via `productionOrderItem.linkedPlanId` if that's the existing pattern, else add link via whatever PO-link table exists
6. If `surplusDestination` set, save it to the plan via `productionPlan.surplusDestination`
7. Clear draft from localStorage
8. Refetch demand, plans, lineItems → UI updates with new locked plan visible on the day
9. Toast: "Saved as production order"

This matches the existing save flow at `src/app/(app)/production-brain/manual/page.tsx:456-507` so reuse that logic.

### Verify

1. Click order line → draft batch bar shows that order's product
2. Click another order from SAME product → adds to existing draft, total updates
3. Click order from DIFFERENT product → warning shown, click resolved by canceling current draft or ignoring new click
4. Click × on draft chip → removes that allocation, recomputes
5. "Cancel draft" button clears draft entirely
6. Drag draft batch from bar onto a day → day shows preview block
7. Drop on closed day → rejected (no preview, no state change)
8. Save button only enables after pinnedDate set
9. Click Save → creates plan + planProduct + orderPlanLinks rows, clears draft, refreshes UI
10. Refreshing page mid-draft restores from localStorage
11. Capacity bars accurate (matches `effectiveDailyCapacityMinutes`)
12. Closed days render with diagonal stripe
13. Today highlighted (cream + rose date)

---

## Phase 4 — Smart suggestions

### Goal

Above the order list within each expanded product, show smart suggestions for filling the mould efficiently.

### Logic

`src/lib/manual-planner/smart-suggestions.ts`:

```typescript
export interface SmartSuggestion {
  type: 'single-run' | 'multi-run' | 'fill-mould';
  label: string;
  detail: string;
  mouldCount: number;
  totalPieces: number;
  coverage: {
    fromOrders: number;
    fromPo: number;
    surplus: number;
  };
  recommended: boolean;
}

export function generateSuggestions(demand: ProductDemand): SmartSuggestion[] {
  const suggestions: SmartSuggestion[] = [];
  const mouldCap = demand.numberOfCavities;
  
  // Suggestion: single run that covers all urgent orders + partial PO fill
  const urgentOrderTotal = sumUrgentOrders(demand.orderItems);
  if (urgentOrderTotal > 0 && urgentOrderTotal < mouldCap) {
    suggestions.push({
      type: 'single-run',
      label: `Plan ${mouldCap}-piece run`,
      detail: `covers ${urgentOrderTotal} urgent ord + ${mouldCap - urgentOrderTotal} toward PO`,
      mouldCount: 1,
      totalPieces: mouldCap,
      coverage: {
        fromOrders: urgentOrderTotal,
        fromPo: Math.min(mouldCap - urgentOrderTotal, demand.poDemand),
        surplus: Math.max(0, mouldCap - urgentOrderTotal - demand.poDemand)
      },
      recommended: true
    });
  }
  
  // Suggestion: multi-run that covers everything
  const totalNeeded = demand.totalDemand;
  if (totalNeeded > mouldCap) {
    const runs = Math.ceil(totalNeeded / mouldCap);
    suggestions.push({
      type: 'multi-run',
      label: `Plan ${runs * mouldCap}-piece run`,
      detail: `${runs} mould fills · covers all ${totalNeeded} pcs`,
      mouldCount: runs,
      totalPieces: runs * mouldCap,
      coverage: {
        fromOrders: demand.orderDemand,
        fromPo: demand.poDemand,
        surplus: runs * mouldCap - totalNeeded
      },
      recommended: false
    });
  }
  
  return suggestions;
}
```

### UI

Above order section in expanded ProductRow:

```
┌─────────────────────────────────────────────────┐
│ → Plan 40-piece run — covers 24 ord + 16 to PO  │ ← caramel left border, draft-tint bg
└─────────────────────────────────────────────────┘
```

Click suggestion → opens FillMouldModal (Phase 5) with this suggestion pre-selected.

### Verify

1. Product with urgent orders < mould cap → shows "Plan N-piece run" suggestion
2. Product with totalDemand > mould cap → shows "Plan multi-run" suggestion
3. Click suggestion → modal opens
4. Confirming suggestion adds N orders to draft batch + sets surplus destination

---

## Phase 5 — Fill mould modal

### Goal

When draft batch's selected allocations don't fill the mould fully, prompt user for surplus destination before saving.

### Trigger

When user adds allocations summing to less than `numberOfCavities` and clicks "Save as production order" OR clicks a smart suggestion.

### Component

```
┌─────────────────────────────────────────────────┐
│ Almond Praline · 3-cav mould                     │
│ Mould produces 40 pcs per run. You have 3        │
│ selected orders = 3 pcs. How to use the rest?    │
│                                                  │
│ ┌─────────────────────────────────────────────┐ │
│ │ → Fill from PO Mothersday (recommended)     │ │ ← caramel border + bg
│ │   37 pcs toward 50 pc PO · covers 74%       │ │
│ └─────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────┐ │
│ │ Add to stock                                │ │
│ │ 37 pcs to inventory · current 24 → 61       │ │
│ └─────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────┐ │
│ │ Make only 3 pcs                             │ │
│ │ Surplus 37 → store/freezer/waste at unmould │ │
│ └─────────────────────────────────────────────┘ │
│                          [Cancel] [Use selection] │
└─────────────────────────────────────────────────┘
```

### Options

1. **Fill from PO**: auto-allocate surplus to existing PO with same product. Sets `draft.surplusDestination = 'po-fill'` + `draft.poFillPlanId`. UI then shows PO partial-fill in draft chip list.
2. **Add to stock**: sets `draft.surplusDestination = 'store'`. At unmould time, scheduler creates stock movement with reason `restock` or similar.
3. **Make only N pcs**: sets `draft.surplusDestination = null`. Operator chooses store/freezer/waste at unmould time (existing behavior). Mould still produces full N cavities physically — `make only` is a misnomer; really it's "decide later."

Per your data model, the mould always produces full cavity count physically. The only choice is what happens to the surplus pieces.

### Verify

1. Add 3 pcs of demand to draft → click Save → modal appears
2. Recommended option (Fill from PO) highlighted with caramel border
3. Selecting "Add to stock" closes modal, sets destination, save proceeds
4. After save, surplus is correctly recorded on `productionPlan.surplusDestination`
5. Existing scheduler logic at unmould time reads `surplusDestination` correctly

---

## Honest deferred items (NOT in v1, document in commit)

These were considered but require additional work beyond this spec:

1. **Cross-product batches** — current model is "one product per batch." If user wants to do 30 pcs Almond Praline + 10 pcs Hazelnut Caramel in the same tempering session, that's not modeled. Each is a separate batch.

2. **Shared steps consolidation** — if Almond Praline and Hazelnut Caramel both need tempering at 09:00, system schedules two separate tempering steps (one per batch). Real-world workshop would temper once for both. Requires new "shared step" model + UI for selection.

3. **Active plan mould conflict detection** — current scheduler only checks mould conflicts within drafts. Active plans' mould spans aren't checked. So a manual placement could collide with an existing active plan on the same mould. Surface as warning at save time, but don't block.

4. **Step cascade on move** — when user drags a step from one day to another (existing functionality), downstream steps don't auto-shift. Same limitation in v2.

5. **Equipment scheduling** — equipment table exists but scheduler ignores it. Skip equipment conflicts entirely.

6. **Per-day capacity override** — `capacityConfig` is global. No "half-day Friday" knob. Skip.

7. **Auto-trigger reconciler after manual save** — manual save doesn't kick off auto-planner re-run. User must click Regenerate elsewhere if they want reconciliation. Match existing behavior in v2.

8. **Multi-draft simultaneous composition** — only one draft at a time. If user wants two parallel drafts, they save one first.

9. **PO partial fill UI in draft** — when surplus → po-fill, show that PO allocation in draft chip list. Phase 5 mentions this but full implementation deferred to phase 5.5.

---

## Migration / new tables

NO new tables or migrations required. v1 uses existing schema:

- `productionPlans` (existing)
- `planProducts` (existing)
- `orderPlanLinks` (existing)
- `productionDayLineItems` (existing)
- `productionSteps` (existing — read for time computation)
- `moulds` (existing)
- `capacityConfig` (existing)
- `products` (existing)
- `orders`, `orderItems` (existing)
- `productionOrders`, `productionOrderItems` (existing)

This is intentional — Phase 1-3 ship with existing schema. Phases 4-5 add UI on top.

---

## File map

```
src/app/(app)/production-brain/manual/
├── page.tsx                              [refactor: thin shell, compose components]
├── layout.tsx                            [unchanged]
src/components/manual-planner/
├── header.tsx                            [NEW: tabs + title + week nav]
├── demand-picker/
│   ├── demand-picker.tsx                 [NEW: left pane container]
│   ├── filter-row.tsx                    [NEW]
│   ├── category-group.tsx                [NEW]
│   ├── product-row.tsx                   [NEW]
│   ├── orders-expanded.tsx               [NEW]
│   ├── order-line.tsx                    [NEW]
│   ├── po-line.tsx                       [NEW]
│   └── smart-suggestion.tsx              [NEW: phase 4]
├── draft-bar/
│   ├── draft-bar.tsx                     [NEW: top right pane]
│   ├── draft-item-chip.tsx               [NEW]
│   └── fill-mould-modal.tsx              [NEW: phase 5]
└── week-grid/
    ├── week-grid.tsx                     [NEW: right main]
    ├── day-column.tsx                    [NEW]
    ├── day-header-cell.tsx               [NEW]
    ├── capacity-bar.tsx                  [NEW]
    └── step-block.tsx                    [NEW]
src/lib/manual-planner/
├── aggregate-demand.ts                   [NEW: phase 2]
├── compute-batch-time.ts                 [NEW: phase 3]
├── smart-suggestions.ts                  [NEW: phase 4]
├── draft-state.ts                        [NEW: localStorage persistence]
└── save-draft-to-plan.ts                 [NEW: save flow wrapper]
```

---

## Phase shipping order

Recommended sequence to keep app shippable at every step:

1. **Phase 1** — page restructure with new layout, existing data still rendered (so nothing breaks). Ship.
2. **Phase 2** — demand picker with categories, filter, expansion. Ship.
3. **Phase 3** — draft bar + week grid + drag-drop save flow. Ship — replaces current ADD button workflow.
4. **Phase 4** — smart suggestions in expanded rows. Ship as enhancement.
5. **Phase 5** — fill mould modal triggered on save. Ship as enhancement.

Each phase independently shippable. After Phase 3 the new manual planner is the primary workflow. After Phases 4-5 it's the recommended workflow with intelligence baked in.

---

## Per-phase commit evidence rule

Per the process change adopted in main app: every commit includes evidence per checklist item.

```
✓ Page restructure — src/app/(app)/production-brain/manual/page.tsx
✓ DemandPicker component — src/components/manual-planner/demand-picker/demand-picker.tsx
✓ aggregateDemandByProduct — src/lib/manual-planner/aggregate-demand.ts
✗ Active plan mould conflict — deferred per spec section "Honest deferred items"
```

Surface partial work explicitly. No ghost-shipping.

---

**End of spec.**
