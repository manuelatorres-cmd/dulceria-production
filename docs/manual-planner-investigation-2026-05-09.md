# Production model investigation — 2026-05-09

Read-only investigation of the data model + workflow that backs the
Production Brain, gathered as a redesign brief for the Manual Planner page
(`src/app/(app)/production-brain/manual/page.tsx`).

All ground-truth quotes carry file:line citations so they can be re-verified
when something looks off.

---

## 1. Products — where stored?

`src/types/index.ts:175-255`:

```typescript
export interface Product {
  id?: string;
  name: string;
  photo?: string;
  popularity?: number;
  productCategoryId?: string; // FK → ProductCategory.id
  shellIngredientId?: string | null;
  shellFillingId?: string | null;
  shellPercentage?: number;
  fillMode?: "percentage" | "grams";
  coating?: string; // @deprecated
  tags?: string[];
  notes?: string;
  shelfLifeWeeks?: string;
  aliases?: string[];
  stockCountedAt?: number;
  defaultMouldId?: string;
  defaultBatchQty?: number;
  shellDesign?: ShellDesignStep[];
  vegan?: boolean;
  leadTimeDays?: number;
  defaultVatRate?: number;
  excludeFromReplen?: boolean;
  archived?: boolean;
  priorityTier?: 1 | 2 | 3;
  includedInCustomBoxes?: boolean;
  customBoxPickWeight?: number;
  secondsAllowed?: boolean;
  defaultDiscountPercentSeconds?: number;
  createdAt: Date;
  updatedAt: Date;
}
```

**Mould-related fields on Product itself:**
- `defaultMouldId?: string` — single default mould FK
- `defaultBatchQty?: number` — default number of moulds per batch

**Capacity/production fields on Product:**
- `leadTimeDays?: number` — production lead time in whole days
- `shellPercentage?: number` — shell as % of cavity weight (0–100)
- `fillMode?: "percentage" | "grams"` — how filling amounts are specified

No per-product cycle time on the Product itself — step durations are stored
per-product-category in `productionSteps` (Q2).

---

## 2. Production steps per product — where stored?

`src/types/index.ts:2008-2033`:

```typescript
export interface ProductionStep {
  id?: string;
  productType: string;
  name: string;
  activeMinutes: number;
  waitingMinutes: number;
  sortOrder: number;
  isPackingStep?: boolean;
  perBatch?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}
```

Table: `productionSteps` (migration 0002). One row per step in the production
sequence for a product type (category). `productType` joins to
`productCategories.name`.

- `activeMinutes` — hands-on work time, counts against daily capacity
- `waitingMinutes` — drying/resting/cooling, elapsed-only, no hands
- `sortOrder` — numeric ordering within a product type; the only dependency mechanism
- `perBatch` — when true, `activeMinutes` is fixed regardless of mould count
  (e.g. tempering vat). When false, `activeMinutes` is multiplied by mould
  count during scheduling (`src/lib/scheduler.ts:292-295`).

**No explicit dependency edge** between steps — sequencing is implicit via
`sortOrder`.

---

## 3. Active vs passive step categorization — is there a column?

Yes. `ProductionStep.activeMinutes` vs `waitingMinutes`. Quoted comment from
`src/types/index.ts:2003-2007`:

```typescript
/** One step in the production sequence for a specific product type.
 *  Step names are free-text; reuse across types is via UI autocomplete,
 *  not enforced at the DB level. Duration has two parts so the scheduler
 *  can distinguish hands-on work (activeMinutes, counts against the
 *  people-hours budget) from drying/resting (waitingMinutes, doesn't). */
```

The scheduler uses `activeMinutes` for the people-hours budget and treats
`waitingMinutes` only as elapsed time for mould-occupancy calculations
(`src/lib/scheduler.ts:291-305`). No additional `passive`/`unattended`/`category`
field — the two-column duration *is* the categorization.

---

## 4. Mould capacity per product — how is it expressed?

`src/types/index.ts:432-447`:

```typescript
export interface Mould {
  id?: string;
  name: string;
  productNumber?: string;
  brand?: string;
  cavityWeightG: number;          // manufacturer's stated weight of a fully filled solid cavity (g)
  numberOfCavities: number;
  fillingGramsPerCavity?: number; // net filling weight per cavity in grams
  quantityOwned?: number;         // how many physical copies of this mould the user owns
  photo?: string;
  notes?: string;
  tags?: string[];
  archived?: boolean;
}
```

- `Mould.numberOfCavities` — pieces per fill
- `Mould.cavityWeightG` — volume of one cavity in grams (used for cost / nutrition)
- `Mould.quantityOwned` — physical copies the user owns (default 1) — drives
  the parallel-fill cap and the cluster-split logic in
  `src/lib/order-batch-global-reconciler.ts:309-312`

Mould selection: `Product.defaultMouldId` (single FK). The reconciler reads
this + computes `moulds_needed = ceil(totalDemand / numberOfCavities)`. If
`moulds_needed > quantityOwned`, demand is split into sequential sub-batches.

**Multiple moulds per product is not supported in the consolidated model.**
`src/lib/scheduler.ts:235-237`:

```typescript
    // All planProducts in a batch share one mould in the new
    // consolidated model. Take the first; warn if they diverge.
    const mouldIds = [...new Set(pps.map((pp) => pp.mouldId).filter(Boolean))];
```

---

## 5. Equipment / shared resources — is there a model?

`src/types/index.ts:2049-2080`:

```typescript
export interface Equipment {
  id?: string;
  name: string;
  kind: EquipmentKind;
  quantity?: number;           // how many identical copies exist
  kgPerHour?: number;         // throughput per unit
  capacityKg?: number;        // per-cycle load capacity (kg)
  manufacturer?: string;
  model?: string;
  notes?: string;
  currentPlanId?: string;     // scheduler-managed occupancy
  currentScheduleId?: string;
  occupiedSince?: Date;
  expectedFreeAt?: Date;
  archived?: boolean;
  requiresTempCheck?: boolean;
  tempMinC?: number;
  tempMaxC?: number;
  location?: EquipmentLocation;
  createdAt?: Date;
  updatedAt?: Date;
}
```

Table: `equipment` (migration 0002). `kind` is one of `tempering`,
`melting_pot`, `coating_belt`, `other`.

**Equipment is not used by the scheduler.** Occupancy columns
(`currentPlanId`, `occupiedSince`, `expectedFreeAt`) exist as legacy from
migration 0002 but are never populated and never checked by
`buildDailySchedule`. Equipment is informational only at present.

---

## 6. Workshop capacity per day — where is daily working hours stored?

`supabase/migrations/0002_planning_tables.sql:229-239`:

```sql
create table "capacityConfig" (
  id                         uuid primary key,
  "peopleCount"              integer check ("peopleCount" > 0),
  "hoursPerPersonPerDay"     numeric(4,2)
                             check ("hoursPerPersonPerDay" > 0 and "hoursPerPersonPerDay" <= 24),
  "workingDays"              text[],
  "warnThresholdPercent"     numeric(5,2),
  "criticalThresholdPercent" numeric(5,2),
  "fillingBufferPercent"     numeric(5,2),
  "updatedAt"                timestamptz not null default now()
);
```

- `peopleCount` — staff working simultaneously
- `hoursPerPersonPerDay` — hours per person
- `workingDays: text[]` — weekday names (`['monday',...]`)
- `productionBufferDays` — added in mig 0040 (default 2)
- `mergingWindowWeeks` — added in mig 0043 (1, 2 or 4)

Singleton; editable in Settings → Capacity. Ships empty — scheduler refuses
to run until populated.

Per-weekday config via `workingDays`. **No per-specific-date capacity
override** in `capacityConfig`. Blocked dates live separately in
`eventCalendar` (mig 0002:248-264) with `kind='blocked'`. Per-person
unavailability lives in `personUnavailability`.

Effective daily capacity is computed at `src/lib/scheduler.ts:326-332`:

```typescript
function capFor(date: string): number {
  const d = new Date(date + "T12:00:00");
  const cap = effectiveDailyCapacityMinutes(d, config, people, unavailability, blockedDays);
  capacityCache.set(date, cap);
  return cap;
}
```

---

## 7. Lock semantics — how is a manually placed batch represented?

`src/types/index.ts:461-490`:

```typescript
export interface ProductionPlan {
  id?: string;
  batchNumber?: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  status: "draft" | "active" | "done" | "cancelled" | "orphaned";
  notes?: string;
  fillingOverrides?: string;
  fillingPreviousBatches?: string;
  batchSummary?: string;
  sourceOrderId?: string; // @deprecated
  surplusDestination?: "store" | "freezer" | "waste";
  /** Manual day pin (mig 0078). When set, regenerate forces this
   *  plan's lineItems onto this exact date instead of recomputing.
   *  Set by the user via drag-drop in /plan week view + "Lock"
   *  confirmation. Cleared by the "Unpin" button on the same row. */
  pinnedDate?: string | null;
}
```

**Lock = `pinnedDate` (mig 0078).** When set, the regenerate path forces the
plan's lineItems onto that ISO date instead of recomputing.

**No separate `locked` boolean.** Manual placement is implied by:
- `pinnedDate` being set
- `status='active'` immediately on save (manual planner skips `draft`)

The current `buildDailySchedule` does not yet read `pinnedDate` itself —
the manual planner writes plans directly with the pin and status='active' so
they are not part of the reconciler's draft-rebuild set
(`src/lib/order-batch-global-reconciler.ts:70-73`):

```typescript
  /** Every production plan, all statuses. The reconciler picks apart
   *  active (untouchable), draft (rebuildable), and the rest (ignored). */
```

Active = untouchable. Draft = rebuildable. Therefore manual `active+pinned`
plans are safe from reconciler overwrite.

Status lifecycle:
- `draft` — auto-planner candidate, not yet placed
- `active` — placed / in production; manual planner sets this on save
- `done` — completed
- `cancelled` — user-cancelled or auto-cancelled draft with no demand
- `orphaned` — legacy; rare

---

## 8. Shared step across products — supported?

**Not implemented.** Each product's steps are scheduled independently. The
consolidated model enforces one product per batch
(`src/lib/order-batch-global-reconciler.ts:70-73`, scheduler.ts:240-243).

If Almond Praline and Hazelnut Caramel both need tempering, two separate
tempering steps are scheduled — one per product — even though physically
the same tempering vat could serve both in a single run.

No edge table, no step-sharing FK, no consolidation algorithm in the
reconciler or scheduler.

---

## 9. PO vs Order demand aggregation — how is demand summed?

`src/lib/order-batch-global-reconciler.ts:56-78`:

```typescript
export interface GlobalReconcileInput {
  /** All orders with status ∈ { pending, in_production }. */
  openOrders: Order[];
  /** Every orderItem on those orders. */
  openOrderItems: OrderItem[];
  products: Product[];
  moulds: Mould[];
  plans: ProductionPlan[];
  planProducts: PlanProduct[];
  links: OrderPlanLink[];
}
```

Aggregation (`src/lib/order-batch-global-reconciler.ts:157-207`):

```typescript
const openOrderIds = new Set(
  openOrders.filter((o) => OPEN_ORDER_STATUSES.has(o.status)).map((o) => o.id!),
);
const eligibleItems = openOrderItems.filter(
  (i) =>
    openOrderIds.has(i.orderId) &&
    (i.fulfilmentMode ?? "produce") === "produce",
);

// Per-item: how much is already committed to an in-flight or
// already-completed batch.
const donePlanIds = new Set(plans.filter((p) => p.status === "done").map((p) => p.id!));
const fulfilledPlanIds = new Set([...activePlanIds, ...donePlanIds]);
const activeAllocByItem = new Map<string, number>();
for (const link of links) {
  if (!fulfilledPlanIds.has(link.planId)) continue;
  activeAllocByItem.set(
    link.orderItemId,
    (activeAllocByItem.get(link.orderItemId) ?? 0) + link.allocatedQuantity,
  );
}

// Group eligible items by productId.
const demandByProduct = new Map<
  string,
  Array<{ itemId: string; remaining: number; deadlineMs: number }>
>();
for (const item of eligibleItems) {
  const alreadyInActive = activeAllocByItem.get(item.id!) ?? 0;
  const remaining = Math.max(0, item.quantity - alreadyInActive);
  if (remaining <= 0) continue;
  const order = orderById.get(item.orderId);
  const deadlineMs = order?.deadline ? new Date(order.deadline).getTime() : 0;
  const arr = demandByProduct.get(item.productId) ?? [];
  arr.push({ itemId: item.id!, remaining, deadlineMs });
  demandByProduct.set(item.productId, arr);
}
```

Steps:
1. Filter to open orders, `produce` items only.
2. Subtract pieces already linked to active or done plans.
3. Group remaining demand by `productId`.
4. Cluster items within a product by deadline (`MAX_CLUSTER_GAP_DAYS = 3`).
5. Split each cluster by mould-capacity cap.

**Production Orders (POs) are NOT part of this aggregation.** A separate
seeder (`seedProductionOrderDrivenPlans`, referenced at reconciler.ts:219)
handles PO demand by emitting draft plans named with the prefix `PO: `.
Customer orders + POs never share a batch via the reconciler.

---

## 10. Stock tracking — where is real-time stock?

Per-batch stock on `PlanProduct` (`src/types/index.ts:514-540`):

```typescript
export interface PlanProduct {
  id?: string;
  planId: string;
  productId: string;
  mouldId: string;
  quantity: number; // number of moulds used
  sortOrder: number;
  notes?: string;
  stockStatus?: "low" | "gone";
  actualYield?: number; // products added to stock after unmoulding
  /** Current pieces remaining in stock for this batch. Defaults to `actualYield` until
   *  a manual count adjusts it. `updateProductStockCount` mutates this FIFO across batches. */
  currentStock?: number;
  /** Pieces in the freezer for this batch. */
  frozenQty?: number;
  frozenAt?: number;
  preservedShelfLifeDays?: number;
  defrostedAt?: number;
}
```

Per-location stock on `stockLocations` (per planProduct per location, mig
0084-driven model):

- Real-time per location (Production / Freezer / Shop / Allocated)
- `variantStockLocations` mirrors the same shape but keys on
  `variantPackagingId` (mig 0084) for pre-packed boxes

Aggregated to per-product totals via `useProductLocationTotals`
(`src/lib/hooks.ts:9861`).

Stock movements are append-only via `stockMovements` (mig 0084) with reason
codes (`unmould`, `freeze`, `defrost`, `transfer`, `allocate`, `unallocate`,
`sold`, `waste`, `breakage`, `recount`, `initial_backfill`).

---

## 11. Auto-planner algorithm — walk through

Entry: `reconcileGlobalProduceDemand` at
`src/lib/order-batch-global-reconciler.ts:133-135`:

```typescript
export function reconcileGlobalProduceDemand(
  input: GlobalReconcileInput,
): GlobalReconcileDecision {
```

Optimizes for:
1. **Deadline clustering** — items within `MAX_CLUSTER_GAP_DAYS = 3` of each other group into the same batch.
2. **Mould capacity** — respects `numberOfCavities` and `quantityOwned`.
3. **Consolidation** — merges unlinked demand across orders into one draft batch per product per cluster.

Constraints:
- Items in a batch must have deadlines within 3 days of each other.
- If `totalDemand > quantityOwned × numberOfCavities`, the batch splits into `ceil(...)` sub-batches named "Product · 1/N", "Product · 2/N".
- `status='active'` plans are never modified — only drafts are rebuilt.

Output (`src/lib/order-batch-global-reconciler.ts:109-129`):

```typescript
export interface GlobalReconcileDecision {
  newBatches: ReconciledBatch[];
  updateBatches: Array<ReconciledBatch & { planId: string; planProductId: string }>;
  plansToCancel: string[];
  plansToDelete: string[];
  linksToDelete: string[];
  warnings: string[];
}
```

Each `ReconciledBatch`:
- `productId`, `mouldId`, `moulds` (number of fills), `totalPieces`
- `totalDemand`, `surplus = totalPieces − totalDemand`
- `allocations: Array<{ orderItemId, allocatedQuantity }>`

Downstream: `buildDailySchedule` (`src/lib/scheduler.ts:157`) takes draft
batches and:
1. Expands each into a flat step list per product category.
2. Sorts by earliest deadline (then batch size as tiebreak).
3. Forward- or reverse-places steps based on deadline urgency.
4. Emits `productionDayLineItems` (one per day per batch with `stepIds[]` + `plannedMinutes`).

Cluster split (`src/lib/order-batch-global-reconciler.ts:309-312`):

```typescript
const cap = mould.quantityOwned && mould.quantityOwned > 0 ? mould.quantityOwned : null;
const allSubBatches = clusters.flatMap((c) =>
  splitClusterByCap(c, mould.numberOfCavities, cap),
);
```

---

## 12. Manual batch placement workflow — what gets created?

`src/app/(app)/production-brain/manual/page.tsx:456-507`:

```typescript
async function saveComposer() {
  if (!composer) return;
  if (!composer.pinnedDate) {
    setSaveErr("Pick a day before saving (drag onto the grid or pick from the date input).");
    return;
  }
  if (composer.items.length === 0) {
    setSaveErr("Batch is empty — add at least one product.");
    return;
  }
  setSaveErr(null);
  setSaving(true);
  try {
    const planId = await saveProductionPlan({
      name: composer.name || "Manual batch",
      status: "active",
      notes: composer.notes || undefined,
      pinnedDate: composer.pinnedDate,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    for (const it of composer.items) {
      await savePlanProduct({
        planId,
        productId: it.productId,
        mouldId: it.mouldId,
        quantity: it.mouldCount,
        sortOrder: 0,
      });
      for (const a of it.allocations) {
        if (a.source !== "order" || !a.parentId) continue;
        try {
          await saveOrderPlanLink({
            orderItemId: a.parentId,
            planId,
            allocatedQuantity: a.qty,
          });
        } catch (e) {
          console.warn("OrderPlanLink failed", e);
        }
      }
    }
```

Tables touched:
1. `productionPlans` — one row, `status='active'`, `pinnedDate=<picked>`
2. `planProducts` — one per item (productId, mouldId, quantity moulds)
3. `orderPlanLinks` — one per order-line allocation

No separate "manually placed" flag. Manual placement is implied by
`pinnedDate` set + direct save bypassing the reconciler.

The auto-planner is **not triggered** after save — user must click
Regenerate on `/production-brain/planner` if they want reconciliation.

---

## 13. Step dependency enforcement — server, client, or none?

`src/types/index.ts:2003-2007` (comment):

```typescript
/** One step in the production sequence for a specific product type.
 *  Step names are free-text; reuse across types is via UI autocomplete,
 *  not enforced at the DB level. Duration has two parts so the scheduler
 *  can distinguish hands-on work (activeMinutes, counts against the
 *  people-hours budget) from drying/resting (waitingMinutes, doesn't). */
```

**Not enforced.** Implicit ordering via `ProductionStep.sortOrder`. The
scheduler sorts by `sortOrder` ascending when placing steps
(`src/lib/scheduler.ts:257-259`):

```typescript
.slice().sort((a, b) => a.sortOrder - b.sortOrder)
```

No FK constraint, no `dependsOnStepId`, no validation that earlier steps are
done before a later one starts. The legacy `productionSchedule.dependsOnId`
FK was dropped in mig 0043.

---

## 14. Step move / cascade — auto-shift downstream?

**No cascade.** Recent commit `cc06b2f` (memory):

> Plan move: surface a real error when a step move silently no-ops
>
> moveProductionStepsToDate quietly skipped any move where the source
> lineItem was missing or already on the target day. UI then closed the
> modal as if the action succeeded — looked like a freeze. Now the
> function throws when zero moves apply, so /plan's catch turns the
> silent skip into a clear alert ("step couldn't be moved — try
> Regenerate plan, then drag again").

When a step moves to a different day, downstream steps stay where they
were. User must move each manually or click Regenerate to recompute.

---

## 15. Multi-day batches — representation?

`src/lib/scheduler.ts:10` and `:33`:

```typescript
 * One batch can span multiple days. Step progress is tracked batch-globally via
 * (a future extension of) planStepStatus; lineItems link steps to dates.
```

```typescript
 * Tracked as an Array<{mouldId, from, to}> across days — cheap for
 * mould-occupancy checks when two batches share a mould and need
 * separate placement windows.
```

Forward-placement loop (`src/lib/scheduler.ts:554-604`):

```typescript
function placeForward(
  flat: FlatStep[],
  mouldId: string,
  mouldCapacity: number,
  planId: string,
  todayIso: string,
  latestDay: string | null,
  days: Map<string, DayState>,
  mouldSpans: MouldSpan[],
  capFor: (date: string) => number,
  lockedStepsByDate: Map<string, Set<string>>,
  mouldConflictLog?: Array<{ date: string; blockedBy: string }>,
): Array<{ date: string; stepIds: string[]; minutes: number }> | null {
  const result: Array<{ date: string; stepIds: string[]; minutes: number }> = [];
  let stepIdx = 0;
  let cursor = todayIso;

  while (stepIdx < flat.length) {
    if (latestDay && cursor > latestDay) return null;
    const cap = capFor(cursor);
    const existing = days.get(cursor);
    const used = existing?.used ?? 0;
    let remaining = cap - used;
    const stepsToday: string[] = [];
    let minutesToday = 0;
    while (stepIdx < flat.length) {
      const s = flat[stepIdx];
      if (locked.has(s.stepId)) break;
      if (s.activeMinutes > remaining) break;
      stepsToday.push(s.stepId);
      minutesToday += s.activeMinutes;
      remaining -= s.activeMinutes;
      stepIdx++;
    }
    if (stepsToday.length > 0) {
      result.push({ date: cursor, stepIds: stepsToday, minutes: minutesToday });
    }
    cursor = advanceDay(cursor);
  }
  return result;
}
```

**Shape of a multi-day batch:**
- One `productionPlans` row = the batch
- N `productionDayLineItems` rows, one per day the batch lands on, each
  with `stepIds: string[]` + `plannedMinutes`

Mould occupancy span: from first `polish` step to last `unmould` step,
inclusive of overnight wait windows. The mould is locked for the whole span
even though it's not actively used during overnight drying.

---

## 16. Mould partial fill — supported?

**Not supported.** The reconciler always emits `totalPieces = moulds × cavities` (`src/lib/order-batch-global-reconciler.ts:80-92`):

```typescript
export interface ReconciledBatch {
  tempId: string;
  productId: string;
  productName: string;
  mouldId: string;
  moulds: number;          // number of mould fills
  totalPieces: number;     // moulds × cavities (≥ totalDemand)
  totalDemand: number;     // sum of allocatedQuantity across allocations
  surplus: number;         // totalPieces − totalDemand
  allocations: Array<{ orderItemId: string; allocatedQuantity: number }>;
```

Demand of 1 in a 40-cavity mould produces 40, not 1. Surplus is disposed at
unmould time via `surplusDestination`.

---

## 17. Surplus to PO/stock — auto-extend?

`src/types/index.ts:480-485`:

```typescript
  /** Operator's choice at unmould time when this batch overproduces
   *  vs its allocated order demand. 'store' / 'freezer' / 'waste'.
   *  Currently informational — the stock-rewrite task will read this
   *  and issue the corresponding stockMovement. */
  surplusDestination?: "store" | "freezer" | "waste";
```

Operator picks `store` / `freezer` / `waste` at unmould. **Not auto-suggested
based on low-stock or pending POs.** The field is currently informational —
no stock movement is automatically issued.

POs are never auto-extended to consume mould surplus.

---

## 18. Conflict detection — what is caught?

Mould double-booking (`src/lib/scheduler.ts:687-718`):

```typescript
function mouldConflicts(
  mouldId: string,
  from: string,
  to: string,
  excludePlanId: string,
  spans: MouldSpan[],
  mouldCapacity: number,
): boolean {
  return firstConflictingSpan(mouldId, from, to, excludePlanId, spans, mouldCapacity) !== null;
}

function firstConflictingSpan(
  mouldId: string,
  from: string,
  to: string,
  excludePlanId: string,
  spans: MouldSpan[],
  mouldCapacity: number,
): MouldSpan | null {
  let overlapping: MouldSpan[] = [];
  for (const s of spans) {
    if (s.mouldId !== mouldId) continue;
    if (s.planId === excludePlanId) continue;
    if (s.to < from || s.from > to) continue;
    overlapping.push(s);
  }
  if (overlapping.length < Math.max(1, mouldCapacity)) return null;
  return overlapping[0];
}
```

**Validated:**
- Mould double-booking against `quantityOwned` cap (within draft batches)
- Daily active-minutes capacity overrun (steps spill to next day)
- Deadline miss (refuses placement past `latestDay = deadline − bufferDays`)

**Not validated:**
- Equipment conflicts (no enforcement)
- Step dependency violations (no FK, no ordering check)
- Mould double-booking with active plans (only drafts are scheduled —
  active plans' mould spans are not passed to the scheduler)
- Shared-step consolidation (no merge logic at all)

Conflicts are warnings, not errors. The scheduler logs and bumps the batch
to a later day rather than failing.

---

## 19. Manual Planner data flow — freshly shipped page

Hooks (`src/app/(app)/production-brain/manual/page.tsx:20-38`):

```typescript
import {
  useOrders,
  useAllOrderItems,
  useAllOrderVariantLines,
  useProductionOrders,
  useAllProductionOrderItems,
  useSubscriptionRuns,
  useSubscriptionTemplates,
  useProductsList,
  useVariants,
  useAllVariantPackagings,
  useAllVariantPackagingProducts,
  usePackagingList,
  useMoulds,
  useAllPlanProducts,
  useProductionPlans,
  saveProductionPlan,
  savePlanProduct,
  saveOrderPlanLink,
} from "@/lib/hooks";
```

Mutates:
1. `productionPlans` — `saveProductionPlan({ status:'active', pinnedDate, ... })`
2. `planProducts` — `savePlanProduct({ planId, productId, mouldId, quantity })`
3. `orderPlanLinks` — `saveOrderPlanLink({ orderItemId, planId, allocatedQuantity })`

**Does not trigger the auto-planner.** Saves directly. Drafts persist in
localStorage under `dulceria.manual-planner.drafts.v1`.

---

## 20. Production planning settings/preferences

Singleton `capacityConfig` (mig 0002, extended through 0040 + 0043).

```sql
create table "capacityConfig" (
  id                         uuid primary key,
  "peopleCount"              integer check ("peopleCount" > 0),
  "hoursPerPersonPerDay"     numeric(4,2)
                             check ("hoursPerPersonPerDay" > 0 and "hoursPerPersonPerDay" <= 24),
  "workingDays"              text[],
  "warnThresholdPercent"     numeric(5,2),
  "criticalThresholdPercent" numeric(5,2),
  "fillingBufferPercent"     numeric(5,2),
  "updatedAt"                timestamptz not null default now()
);
```

Mig 0040: `productionBufferDays integer default 2`.
Mig 0043: `mergingWindowWeeks integer default 2 check (… in (1,2,4))`.

Settings stored:
- Workshop hours: `peopleCount`, `hoursPerPersonPerDay`
- Working days: `workingDays text[]`
- Capacity alert thresholds: `warnThresholdPercent`, `criticalThresholdPercent`
- Replen safety margin: `fillingBufferPercent`
- Production buffer days
- Merge horizon (1, 2, or 4 weeks)

Editable in Settings → Capacity. **No global default batch sizes** — those
are per-product (`Product.defaultBatchQty`). **No mould preferences** — per-product (`Product.defaultMouldId`).

---

## Gaps the redesign should account for

- **No step dependency enforcement** — steps can be moved out of order; no FK constraint prevents "fill before shell" if UI allows it.
- **No equipment resource allocation** — equipment occupancy columns exist but the scheduler never checks or populates them; tempering machines, ovens, fridges have no capacity constraints.
- **No shared-step consolidation** — two products needing the same step (e.g. tempering) produce separate batches; no mechanism to merge them into one run.
- **No in-place step cascading** — when a step is moved to a different day, downstream steps do NOT auto-shift; user must manually move them or Regenerate.
- **No partial-fill batches** — mould capacity is always fully produced; if demand is 1 and mould is 40, surplus 39 must be disposed as waste/store/freezer; cannot stop production at 1.
- **No auto-extend PO for surplus** — surplus pieces from a batch do not automatically allocate to an existing PO or replenishment order; operator manually picks store/freezer/waste.
- **No multi-product batches in current model** — the consolidated reconciler enforces one product per batch; legacy multi-product batches are still parsed but not produced.
- **Mould double-booking against active plans not checked** — the scheduler only schedules drafts; active plans' mould occupancy is not passed in, so a new draft can be scheduled onto the same mould on overlapping days without warning.
- **Session-lock not implemented** — `PlanStepStatus.done` exists, but the scheduler does not yet read it to lock placed steps; the code is a placeholder (`src/lib/scheduler.ts:346-355`).
- **Manual planner does not trigger the auto-planner** — user must explicitly Regenerate after manual placement; no event-driven re-run.
- **No per-date capacity override** — working hours are global; no "half-day this Friday" knob.
- **`surplusDestination` is informational only** — the comment says stock movements come from a "stock-rewrite task" not yet implemented; the field is captured but not acted on automatically.
