# Production app map — 2026-05-12

Read-only investigation. No code or data changed. Quotes carry file:line citations so a follow-up session can verify ground truth before acting on the map.

Repo: `dulceria-production` (Next.js + Supabase, forked from ChocCollab). Target planning window for the follow-up session: **May 12 → July 31, 2026**.

---

## 1. DATA MODEL

All schema sourced from `supabase/migrations/0001` through `0087`. Row counts are not in scope — no DB access from a read-only investigation; queries listed where relevant. RLS is enabled on every planning table (workspace pattern: single shared workspace for Manuela + partner; `authenticated_full_access` policies introduced in mig 0003 and re-asserted per new table).

### Reference + lookup

| Table | Purpose | Key columns | RLS |
|---|---|---|---|
| `productCategories` (0001:60) | Product type buckets (moulded / bar / praline). Drives shell% range + step set. | `id`, `name`, `shellPercentMin/Max/Default` | yes |
| `ingredientCategories` (0001:72) | Raw-material grouping. | `id`, `name`, `archived` | yes |
| `fillingCategories` (0001:80) | Filling type taxonomy + shelf-stable flag. | `id`, `name`, `shelfStable` | yes |
| `decorationCategories` (0001:89) | Airbrush / transfer / etc. | `id`, `name`, `slug` | yes |
| `userPreferences` (0001:50) | Singleton app config — region, currency, allergens, defaults. | `id`, `marketRegion`, `facilityMayContain`, `updatedAt` | yes |

### Core catalogue

| Table | Purpose | Key columns | RLS |
|---|---|---|---|
| `ingredients` (0001:109) | Raw materials. | `id`, `name`, `category`, `purchaseCost/Qty/Unit/gramsPerUnit`, `cacaoFat`, `sugar`, `allergens` (text[]), `shellCapable`, `lowStock`, `outOfStock` | yes |
| `moulds` (0001:150) | Physical mould inventory. | `id`, `name`, `cavityWeightG`, `numberOfCavities`, `fillingGramsPerCavity`, `quantityOwned` | yes |
| `fillings` (0001:199) | Ganache + praline recipes with rootId/version. | `id`, `name`, `category`, `allergens`, `shelfLifeWeeks`, `rootId`, `version`, `archived` | yes |
| `products` ⭐ (0001:165) | Saleable chocolates (truffles, bars, bonbons). One row per recipe SKU. | `id`, `name`, `productCategoryId` (FK), `shellIngredientId` (FK), `shellFillingId` (FK), `shellPercentage`, `fillMode`, `defaultMouldId` (FK), `defaultBatchQty`, `shellDesign` (jsonb), `shelfLifeWeeks` (text), `priorityTier`, `excludeFromReplen`, `archived` | yes |

### Production batches + steps

| Table | Purpose | Key columns | RLS |
|---|---|---|---|
| `productionPlans` ⭐ (0001:298) | A batch — one product, N moulds, status lifecycle. | `id`, `name`, `status` ('draft'\|'active'\|'done'\|'cancelled'\|'orphaned'), `batchNumber`, `notes`, `surplusDestination`, `pinnedDate` (mig 0078), `completedAt` | yes |
| `planProducts` (0001:315) | Joins a product to a batch (1:1 in the consolidated model). | `id`, `planId` (FK cascade), `productId` (FK), `mouldId` (FK), `quantity` (moulds), `actualYield`, `currentStock`, `frozenQty`, `preservedShelfLifeDays` | yes |
| `planStepStatus` (0001:334) | Per-batch per-step done flag. Drives "Step done" badges + day completion. | `id`, `planId`, `stepKey`, `done`, `doneAt`. Unique (planId, stepKey). | yes |
| `productionSteps` (0011:20) | Step sequence per product type with hands-on + wait durations. | `id`, `productType` (joins `productCategories.name`), `name`, `activeMinutes`, `waitingMinutes`, `sortOrder`, `perBatch` (0037) | yes |
| `productionDays` (0020 + 0043:37) | Calendar entry per date; HACCP open/close + scheduler status. | `id`, `date`, `openedAt`, `closedAt`, `status` ('draft'\|'active'\|'done'), `tempLogComplete`, `cleaningComplete`, `summary` (jsonb) | yes |
| `productionDayLineItems` ⭐ (0043:75) | One batch's appearance on one day with stepIds + plannedMinutes. | `id`, `productionDayId`, `planId`, `stepIds` (text[]), `plannedMinutes`, `sortOrder`, `actuallyWorked` (0087). Unique (productionDayId, planId). | yes |

### Demand sources

| Table | Purpose | Key columns | RLS |
|---|---|---|---|
| `orders` ⭐ (0002:33 + 0051) | Customer demand: B2B, event, online, shop. | `id`, `channel`, `customerName`, `eventName`, `deadline` (timestamptz), `priority`, `status` ('pending'\|'in_production'\|'ready_to_pack' (mig 0083)\|'done'\|'cancelled'), `fulfillmentType`, `timeSensitive`, `totalNet/Gross`, `sourceOrderId` (replen link), `isApproxDeadline` (0055) | yes |
| `orderItems` (0002:63 + 0051) | Line items. | `id`, `orderId`, `productId`, `quantity`, `fulfilmentMode` ('produce'\|'borrow'), `variantId`, `variantPackagingId`, `unitPriceNet/Gross`, `taxRatePercent`, `packagingId` | yes |
| `orderVariantLines` (0068) | Variant-pack demand alongside orderItems. | `id`, `orderId`, `variantId`, `variantPackagingId`, `quantity`, `unitPrice`, `sortOrder` | yes |
| `orderPlanLinks` (0041 + 0042:27) | Allocates an orderItem to a productionPlan with an explicit qty. | `id`, `orderItemId`, `planId`, `allocatedQuantity`. Unique (orderItemId, planId). | yes |
| `productionOrders` ⭐ (0066:9) | Internal demand: restock + campaign runs. Sibling to customer orders. | `id`, `name`, `dueDate` (date), `status` ('pending'\|'in_production'\|'done'\|'cancelled'), `channel` ('restock'\|'campaign_run'), `campaignId` (FK, nullable; required when channel='campaign_run'), `targetLocation`, `notes` | yes |
| `productionOrderItems` (0066:45) | PO line items. | `id`, `productionOrderId`, `productId`, `targetUnits`, `notes` | yes |

### Planning windows + campaigns

| Table | Purpose | Key columns | RLS |
|---|---|---|---|
| `campaigns` ⭐ (0051:92 + 0063 + 0065) | Limited editions, seasonal boxes, launches. | `id`, `name`, `type` ('seasonal'\|'limited'\|'collaboration'\|'launch'\|'market_event'), `startDate`, `endDate`, `productionStartDate`, `targetTotalUnits`, `productTargets` (jsonb), `status` ('planned'\|'active'\|'wrapping'\|'done'\|'cancelled'), `colorTag`, `notes` | yes |
| `subscriptionTemplates` (0057:12) | Recurring subscription template. | `id`, `name`, `packagingId`, `pieceCount`, `frequency` ('monthly'\|'bimonthly'\|'quarterly'\|'seasonal'), `active` | yes |
| `subscriptionRuns` (0057:30) | One cycle of a subscription. | `id`, `templateId`, `scheduledShipDate`, `subscriberCount`, `selectedProductIds` (uuid[]), `status`, `productionPlanIds` (uuid[]) | yes |
| `replenishmentProposals` (0051:28) | Engine-suggested restock batches before user accepts/dismisses. | `id`, `productId`, `suggestedBatchSize`, `earliestNeededDate`, `priorityTier` (1\|2\|3), `reason` ('auto-replen'\|'campaign-prep'\|'custom-box-buffer'\|'manual'), `status` ('pending'\|'scheduled'\|'dismissed'), `scheduledPlanId`, `dismissedUntil`, `locationId` | yes |
| `dailySellEstimates` (0051:68) | Rolling 30-day sell averages per product per location. | `id`, `productId`, `locationId`, `date`, `soldCount`, `customBoxPickCount`, `rollingAvg30d`. Unique (productId, locationId, date). | yes |
| `stockMinimums` (0002:272) | Low-stock thresholds per product per channel. Superseded by `stockLocationMinimums` for new UI. | `id`, `productId`, `channel`, `minimumUnits`, `reorderPoint`. Unique (productId, channel). | yes |
| `stockLocationMinimums` | Per-product per-location threshold (newer model). | `id`, `productId`, `location`, `minimumUnits`, `maximumUnits`, `reorderPoint` | yes |

### Capacity + people

| Table | Purpose | Key columns | RLS |
|---|---|---|---|
| `capacityConfig` ⭐ (0002:229 + 0008 + 0040 + 0043) | Singleton — workshop-wide capacity. | `id`, `peopleCount`, `hoursPerPersonPerDay` (legacy), `workingDays` (text[]), `warnThresholdPercent`, `criticalThresholdPercent`, `capacityBufferPercent`, `fillingBufferPercent`, `productionBufferDays`, `mergingWindowWeeks` (1\|2\|4), `stockExpiryWarnDays`, `labourHourlyRate` | yes |
| `people` (0009 + 0038 + 0060) | Production team. | `id`, `name`, `roles` (text[]), `startTimeOfDay`/`endTimeOfDay` (time), `defaultHoursPerDay`, `workingDays` (Weekday[]), `archived`, `skills`, `primaryRole`, `hourlyCostEuros`, `breakMinutesPerDay`, `contractType` | yes |
| `personUnavailability` (0009) | Vacation / sick / appointments. | `id`, `personId`, `startDate`, `endDate` (ISO strings), `absenceType`, `approved`, `notes` | yes |
| `eventCalendar` (0002:248) | Workshop-wide events / holidays / blocked days. | `id`, `name`, `kind` ('event'\|'peak'\|'blocked'\|'holiday'), `startDate`, `endDate`, `relatedOrderId`, `color`, `notes` | yes |

### Equipment + mould pool + filling stock

| Table | Purpose | RLS |
|---|---|---|
| `equipment` (0002:166 + 0010 + 0025) | Tempering / melting / coating belt / cooling system. `currentPlanId`, `occupiedSince`, `expectedFreeAt`. | yes |
| `mouldPool` (0002:137 + 0051:183) | Individual mould instance tracking (occupancy, deep-wash counter). Unique (mouldId, instanceIndex). | yes |
| `fillingStock` (0001:343) | Made filling waiting to be used. `fillingId`, `remainingG`, `madeAt`, `planId`, `frozen`, `frozenAt`, `preservedShelfLifeDays`. | yes |

### Stock + movements

| Table | Purpose | RLS |
|---|---|---|
| `stockLocations` (0016) | Per-batch per-location stock rows. `planProductId`, `location`, `orderId`/`productionOrderId` (when allocated), `quantity`. | yes |
| `variantStockLocations` (0084) | Same shape but keyed on `variantPackagingId` for pre-built variant boxes. | yes |
| `stockMovements` (0084 + 0085) | Append-only audit log. `planProductId`, `productId`, `fromLocation`, `toLocation`, `quantity`, `reason`, `variantPackagingId`. | yes |
| `ingredientStock` (0044 + 0045) | Per-ingredient on-hand grams + movements. | yes |

### Cross-DB Business Hub link

**None.** Grep across the repo for "business hub", "BusinessHub", or any external launches table = zero matches. The app is self-contained; `campaigns` + `productionOrders` are the only launch drivers.

### Row counts

Not in scope for read-only investigation. To populate any of the "current state" numbers below, run:

```sql
SELECT COUNT(*) FROM products WHERE archived = false;
SELECT COUNT(*) FROM "productionPlans" WHERE status IN ('draft','active');
SELECT name, status, "startDate", "endDate" FROM campaigns ORDER BY "startDate";
```

---

## 2. PAGES

Every page route under `src/app/(app)/*/page.tsx`. Mobile friendliness derived from presence of `lg:` / `md:` / `sm:` Tailwind breakpoints in the page; "yes" = responsive grid that collapses to a single column on narrow viewports.

### Production planning surfaces

| Path | Source | Description |
|---|---|---|
| `/dashboard` | `dashboard/page.tsx` (~1100 lines, iOS-glass) | Main entry. Capacity overview, today's pipeline, attention items, deadlines strip, 4-card KPI row. Reads orders, plans, planProducts, stockLocations, ingredientStock, etc. Writes via `closeProductionDay`. **Exempted from design-system refactor per memory `feedback_design_direction`.** Mobile: partial. |
| `/production-brain/dashboard` | `production-brain/dashboard/page.tsx` | Production-brain overview. KPI strip uses shared `StatCard` (retrofitted 2026-05-12). Engine controls + replenishment proposals + dateless orders panel. |
| `/production-brain/daily` | `production-brain/daily/page.tsx` | Single-day operational view. HACCP open/close + step-by-step progress. |
| `/production-brain/planner` | `production-brain/planner/page.tsx` | Drag-drop replenishment proposal → day-grid. Campaigns strip across top. |
| `/production-brain/needed` | `production-brain/needed/page.tsx` (post-2026-05-07 redesign) | Multi-select open orders → aggregated demand grouped by product + variant with Needed / Packed / Loose / Planned / Net columns. |
| `/production-brain/manual` | `production-brain/manual/page.tsx` (Manual Planner v2) | Three-zone layout: 380px demand picker + draft bar + week grid. Single localStorage draft. Saves into `productionPlans` + `planProducts` + `orderPlanLinks`. |
| `/production-brain/equipment` | `production-brain/equipment/page.tsx` | Equipment CRUD + live occupancy. |
| `/production-brain/haccp` | `production-brain/haccp/page.tsx` | HACCP compliance — temperature logs, cleaning, contamination, allergen warnings. |
| `/plan` | `plan/page.tsx` (~5000 lines) | URL-driven view-mode hub. `?view=day` (default), `?view=weekly`, `?view=pivot`, `?view=month`. Weekly = v2 7-col calendar with drag-drop + day-detail drawer + bottom summary. Other modes use legacy renderers. |
| `/plan/fillings` | `plan/fillings/page.tsx` | Weekly filling cooking list. |
| `/workshop` | `workshop/page.tsx` (post-2026-05-12 retrofit) | KPI strip + active batches list + deadlines panel — all on design-system components. |

### Catalogue + ops

| Path | Description |
|---|---|
| `/orders` | Customer orders list grouped by channel. v2 row design (ListRow + max-2 StatusTag). |
| `/orders/[id]` | Order detail w/ line-item edit, fulfilment, pricing, batch allocation. |
| `/orders/online` | Online (Shopify-style) order import + sync queue. |
| `/orders/online/import` | Per-line import preview with "skip this line" option. |
| `/orders/new` | New-order wizard. |
| `/production-orders` | Internal POs list. |
| `/production-orders/[id]` | PO detail with item lines + campaign link. |
| `/campaigns` | Campaign list grouped by status. |
| `/campaigns/[id]` | Campaign detail with productTargets + linked POs + status transitions. |
| `/subscriptions` | Subscription template list. |
| `/subscriptions/[id]` | Template detail + run schedule. |
| `/products`, `/products/[id]` | Product catalogue + detail (shell + filling composition, mould, packaging, steps overrides). |
| `/variants`, `/variants/[id]` | Variant boxes (curated and free-pick, kind enum from mig 0049). |
| `/ingredients`, `/ingredients/[id]` | Raw materials. |
| `/fillings`, `/fillings/[id]` | Ganache recipes. |
| `/moulds`, `/moulds/[id]` | Mould inventory + cavities + ownership. |
| `/packaging`, `/packaging/[id]` | Boxes, pouches, components. |
| `/customers`, `/customers/[id]` | B2B + retail customers + price-list links. |
| `/quotes`, `/quotes/[id]`, `/quotes/new` | Sales quotes that convert to orders. |
| `/pricing`, `/pricing/lists`, `/pricing/lists/[id]` | Price lists + per-product overrides. |
| `/stock`, `/stock/adjust` | Stock count + adjustment flow. |
| `/shop`, `/shop/count`, `/shop/counter`, `/shop/daily-count`, `/shop/breakage`, `/shop/transfer` | Daily shop ops (counts, breakage, transfers between locations). |
| `/shopping` | Ingredient + packaging shopping list driven by upcoming production. |
| `/calendar` | Workshop event calendar overlay. |
| `/picking` | 2-tab pack-and-box-up flow. |
| `/production`, `/production/[id]`, `/production/[id]/products`, `/production/[id]/summary`, `/production/new` | Production execution + batch detail. |
| `/audit` | Append-only stock-movement log viewer. |
| `/pantry` | Filling stock viewer (fresh + frozen). |
| `/stats`, `/reports/sales`, `/reports/monthly` | Sales + production reporting. |
| `/settings`, `/settings/setup`, `/settings/skills` | App config + first-run wizard. |
| `/notifications` | App notifications inbox. |
| `/observatory`, `/lab`, `/library`, `/wall`, `/imports`, `/calculator` | Misc operational tools. |

### Mobile friendliness

- **Fully responsive (collapse cleanly):** `/dashboard`, `/orders` (post-retrofit), `/workshop`, `/products`, `/ingredients`, `/customers`, `/campaigns`, `/production-orders`, settings pages.
- **Desktop-optimal but usable on tablet:** `/plan?view=weekly` (7 columns target iPad-landscape minimum), `/production-brain/manual` (380px sidebar + grid → needs ≥1024px wide).
- **Drag-drop surfaces need touch sensors:** `/plan`, `/production-brain/manual`, `/production-brain/planner` — sensor stacks include `TouchSensor` so iPad drag works.

### Expected-vs-actual

| Expected page | Found | Route |
|---|---|---|
| Dashboard | ✓ | `/dashboard` + `/production-brain/dashboard` |
| Daily | ✓ | `/production-brain/daily` |
| Planner | ✓ | `/production-brain/planner` |
| Needed | ✓ | `/production-brain/needed` |
| Manual | ✓ | `/production-brain/manual` (v2, phases 1-5 shipped) |
| Equipment | ✓ | `/production-brain/equipment` |
| HACCP | ✓ | `/production-brain/haccp` |
| Weekly | ✓ | `/plan?view=weekly` (v2, phases 1-5 shipped + phase 6 step grouping) |
| Pivot | ✓ | `/plan?view=pivot` (legacy renderer, not redesigned) |

---

## 3. THE PLANNING FLOW

Scenario: **Bar Line launch June 7, 5 SKUs. Booth June 4-7 + online drop June 7 20:00.**

### Step 1 — Register the launch as a campaign

**Page:** `/campaigns` → "New campaign"

Fields to fill:
- `name`: "Bar Line"
- `type`: `launch`
- `startDate`: 2026-06-04 (first booth day)
- `endDate`: 2026-06-07 (online drop day)
- `productionStartDate`: 2026-06-02 (≥ 2 days before booth opens; reconciler reads this as the earliest acceptable day for first batch)
- `targetTotalUnits`: 500 (or whatever the booth + online total is)
- `productTargets` (jsonb): `{ "SKU1_uuid": 100, "SKU2_uuid": 80, ... }` per SKU

**Writes:** one row in `campaigns`, status='planned'.

**What it does NOT do:** No `productionPlans`, no `productionOrders`, no `orderItems` are created. The campaign sits passive until something else references it.

### Step 2 — Convert the campaign into demand the scheduler can see

**Option A — internal Production Order (recommended for launches):**

`/production-orders` → "New production order"
- `name`: "Bar Line — Booth + Online"
- `dueDate`: 2026-06-07
- `channel`: `campaign_run` (required when campaignId is set, mig 0066)
- `campaignId`: link to the campaign you just made
- For each SKU: one `productionOrderItem` row with `targetUnits` = the campaign's productTargets value

**Writes:** one `productionOrders` row + 5 `productionOrderItems`.

**Option B — customer orders** (when there are real buyers placing pre-orders):

`/orders` for each booth/online customer with `channel='b2b'` or `'event'` and an item per SKU.

**Option C — both:** booth = orders, online = PO. The reconciler aggregates both.

### Step 3 — Reconcile demand into draft batches

**Trigger:** Click "Regenerate" on `/plan?view=weekly` or `/production-brain/dashboard`.

**Entry point:** `src/lib/order-batch-global-reconciler.ts:133`:

```ts
export function reconcileGlobalProduceDemand(input: GlobalReconcileInput): GlobalReconcileDecision
```

Walks roughly:

1. Filter to open orders/POs (`status ∈ {pending, in_production, ready_to_pack}`, items `fulfilmentMode='produce'`).
2. Per `OrderPlanLink`: subtract pieces already allocated to active/done plans.
3. Group remaining demand by `productId`.
4. Within product, cluster by deadline (`MAX_CLUSTER_GAP_DAYS = 3` — items > 3 days apart split into separate batches).
5. Per cluster: `moulds_needed = ceil(demand / mould.numberOfCavities)`. If `> mould.quantityOwned`, split into sequential sub-batches.
6. Output `ReconciledBatch` rows that get persisted as `productionPlans` (status='draft') + `planProducts` + fresh `orderPlanLinks`.

Customer-order plans get named `<Product> · <Cluster idx>/<N>`; PO-driven plans get prefixed `PO: <po name> — <product>` so the auto-flip-PO-done logic in `saveProductionPlan` (src/lib/hooks.ts:1908) can find them.

### Step 4 — Schedule draft batches onto days

`src/lib/scheduler.ts:157` `buildDailySchedule()`:

1. Take every draft + active plan with a date-eligible deadline.
2. For each, expand into a flat step list using `productionSteps` for the product's category.
3. Sort batches by earliest deadline (smaller first as tiebreak).
4. Forward-fill or reverse-schedule:
   - Forward when the deadline is within `mergingWindowWeeks` from today; pack work into the next available days until daily capacity is exhausted, spill to the next.
   - Reverse from `deadline − productionBufferDays` otherwise.
5. Respect:
   - `effectiveDailyCapacityMinutes(date, …)` from `src/lib/capacity.ts:126` — people-hours × (1 − buffer%).
   - Mould occupancy spans (polish → unmould blocks the mould pool).
   - Blocked days from `eventCalendar` (`kind='blocked'`) + `personUnavailability` per person.
6. Emit `productionDayLineItems` rows: one per (batch, day) with `stepIds[]` + `plannedMinutes`.

Pinned plans (`productionPlans.pinnedDate` set via mig 0078) are forced onto their pin date by the reconciler/scheduler pair.

### Step 5 — Review + adjust on the calendar

`/plan?view=weekly`

- 7-column grid Mon-Sun. Each day shows step blocks per batch, colour-coded:
  - default = blush left border
  - locked (pinnedDate) = teal + 🔒
  - passive (waitingMinutes-only) = dashed gray + ⏱ + italic
  - conflict = rose + tinted bg
- Group blocks fold ≥5 same-step entries on a day (`buildStepGroups` in `src/components/production-plan/group-block.tsx`).
- Drag a step → drop on another day → soft conflict warnings (capacity overflow, mould double-book) via window.confirm; closed days reject.
- Click a day header → drawer with hour-by-hour breakdown, notes, "Mark as worked", "Reschedule day".

Pin a plan to lock it: click into batch detail, "Pin to this day". The auto-planner respects it on the next Regenerate.

### Step 6 — Operate

`/production-brain/daily` for the chosen date. Open the day, mark step statuses as the team completes work (`planStepStatus` rows). At end of day click "Close day" → status flips to 'done' and the next day inherits unfinished work.

### Gaps in the flow

1. **Campaign → demand handoff is manual.** Creating a campaign does not auto-spawn a PO. If Manuela forgets to create the PO, the campaign sits passive and the reconciler ignores it. Spec'd as honest-deferred in the Manual Planner v2 spec.
2. **Reconciler does not see subscription runs.** `subscriptionRuns` rows aren't picked up by `reconcileGlobalProduceDemand`; a separate (currently unwired) seeder is intended to fan them out. Drag-drop in `/production-brain/manual` lets you treat them as informational source lines.
3. **Replenishment proposals stay pending until dragged.** `replenishmentProposals` rows are engine output; they do not become batches automatically. If Manuela never accepts them, stock runs out.
4. **No first-class packing schedule.** Booth packing (pack 200 bars on the night of June 6) isn't its own work; it sits inside the last "Pack" step of each batch with no aggregate viewport.
5. **Shopify inventory not pushed live.** Online drop reservation is manual — production status doesn't write back to Shopify.

---

## 4. WHERE PRODUCTS ARE DEFINED

### The `Product` interface

`src/types/index.ts:175` — full shape quoted in section 1. Production-relevant fields:

- `productCategoryId` — joins to `productCategories.name` which is the `productionSteps.productType` key. Steps are per-category, not per-product.
- `defaultMouldId` — selects the mould. `mould.numberOfCavities × planProduct.quantity = totalPieces`.
- `defaultBatchQty` — default mould count when a new plan is created for this product.
- `shellIngredientId` XOR `shellFillingId` — couverture from a single ingredient or from a custom shell recipe.
- `shellPercentage`, `fillMode` — drive shell vs filling weight math (`src/lib/costCalculation.ts`).
- `shelfLifeWeeks` — free-text (e.g. "4–6"); advisory only; scheduler does not enforce.
- `priorityTier` (1|2|3) — replenishment ordering.
- `excludeFromReplen` (0079) — true for campaign-only items (Easter bunnies etc.).
- `stepDurationOverrides` — jsonb `{ stepName: minutes }` overrides default step durations for that single product.
- `shellDesign` — jsonb list of decoration steps (airbrush, transfer sheet, etc.).
- `secondsAllowed`, `defaultDiscountPercentSeconds` — flags B-ware (mostly bars).
- `archived`.

### SKU ↔ recipe relationship

- One product row = one mould-aware SKU.
- One product has one shell source (ingredient or filling) — exclusive.
- One product → many `productFillings` rows → many fillings (each with its own version line through `rootId`).
- One product → many variants (via `variantPackagings` + `variantPackagingProducts`, mig 0049 + 0064 + 0067). Variants are packaging configurations of the same product piece (3-piece box / 8-piece box / loose). Variants are what shop customers buy; the underlying pieces are still one product.

So: **product = manufacturable piece**. **variant = sellable bundle of pieces**.

### Steps live on the category, not the product

`productionSteps.productType = productCategories.name`. Every product in the same category shares the step list. Per-product variation comes from `Product.stepDurationOverrides` only.

### Equipment requirements

Not stored on `Product`. `equipment` rows exist (tempering, melting pot, coating belt, cooling) with occupancy fields (`currentPlanId`, `occupiedSince`, `expectedFreeAt`) but the scheduler doesn't currently consume them — equipment is informational. Documented as a deferred item.

### Yield + shelf-life

- Yield = `mould.numberOfCavities × planProduct.quantity`. `actualYield` overrides expected yield once the operator records it post-unmould.
- Shelf life: `Product.shelfLifeWeeks` is text + advisory; `fillings.shelfLifeWeeks` is integer days and feeds the freeze/defrost logic on filling stock.

### Count

Row count not available from a read-only session. To get it: `SELECT COUNT(*) FROM products WHERE archived = false;` Per the existing memory `project_business_process_map.md` Dulceria's live catalogue is roughly 25-30 products at the time of writing.

---

## 5. CAPACITY MODEL

### `capacityConfig` schema

`supabase/migrations/0002_planning_tables.sql:229`:

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

Extended in:
- 0008 → `capacityBufferPercent`
- 0040 → `productionBufferDays integer default 2`
- 0043 → `mergingWindowWeeks integer default 2 check in (1,2,4)`

### Where the 14h number lives

Grep for the literal `14` in capacity code: it's not a hardcoded daily-hours default. The `solids: { min: 3, max: 14 }` match in `src/types/index.ts` is a ganache % range, unrelated.

Daily hours actually come from per-person `startTimeOfDay` / `endTimeOfDay` (mig 0038) with `defaultHoursPerDay` as a legacy fallback. `src/lib/capacity.ts:96`:

```ts
export function personHoursPerDay(p: Person): number {
  const windowHours = timeWindowHours(p.startTimeOfDay, p.endTimeOfDay);
  if (windowHours != null) return windowHours;
  return typeof p.defaultHoursPerDay === "number" && p.defaultHoursPerDay > 0
    ? p.defaultHoursPerDay
    : 0;
}
```

So when Manuela said "14h default", she was likely referring to a real window in Settings (e.g. 07:00 → 21:00 = 14h) not a code default. **Check Settings → Capacity to confirm the configured hours per person.**

### Effective daily capacity in minutes

`src/lib/capacity.ts:126`:

```ts
export function effectiveDailyCapacityMinutes(
  date, config, people, unavailability = [], blockedDays = [],
): number {
  const rawHours = availableHoursOnDate(date, people, unavailability, blockedDays);
  if (rawHours === 0) return 0;
  const buffer = isPercent(config?.capacityBufferPercent) ? config!.capacityBufferPercent! : 0;
  return Math.round(rawHours * 60 * (1 - buffer / 100));
}
```

Returns 0 for closed days. The plan v2 grid uses this directly to detect "closed" (capacity=0 → soft gray + diagonal-stripe-free tint per spec).

### Crisis mode

Not present. Grep for "crisis" finds nothing in production-app code; it exists in the Business Hub sibling per memory but is not mirrored here.

### Over-capacity warnings

- Per-day badge: `warnThresholdPercent` and `criticalThresholdPercent` drive the capacity-bar colour ramp (mint → caramel → rose). Wired through `effectiveDailyCapacityMinutes` and the `CapacityBar` component (`src/components/production-plan/capacity-bar.tsx`).
- Header strip: number of "tight days" surfaced in `PlanHeader` stats line.
- Drag-drop: dropping a step onto a day whose projected utilisation exceeds the critical threshold prompts a `window.confirm` via `detectConflicts` (`src/lib/production-plan/detect-conflicts.ts`).
- Reconciler: warnings collected on `GlobalReconcileDecision.warnings`; surfaced as `GroupedWarnings` after Regenerate.

---

## 6. CURRENT STATE OF DATA

All counts require DB access. The following are the queries to run from Supabase SQL editor for the planning session that comes next.

| Question | SQL |
|---|---|
| Active products in catalogue | `SELECT COUNT(*) FROM products WHERE archived = false;` |
| Open customer orders | `SELECT COUNT(*) FROM orders WHERE status IN ('pending','in_production','ready_to_pack');` |
| Open POs | `SELECT COUNT(*) FROM "productionOrders" WHERE status IN ('pending','in_production');` |
| Draft batches | `SELECT COUNT(*) FROM "productionPlans" WHERE status='draft';` |
| Active batches | `SELECT COUNT(*) FROM "productionPlans" WHERE status='active';` |
| Batches scheduled in May–Jul 2026 | `SELECT COUNT(DISTINCT pdli."planId") FROM "productionDayLineItems" pdli JOIN "productionDays" pd ON pd.id = pdli."productionDayId" WHERE pd.date BETWEEN '2026-05-12' AND '2026-07-31';` |
| Campaigns scheduled in window | `SELECT name, type, status, "startDate", "endDate", "productionStartDate", "targetTotalUnits" FROM campaigns WHERE "startDate" BETWEEN '2026-05-12' AND '2026-07-31' OR "endDate" BETWEEN '2026-05-12' AND '2026-07-31' ORDER BY "startDate";` |
| Subscription runs in window | `SELECT * FROM "subscriptionRuns" WHERE "scheduledShipDate" BETWEEN '2026-05-12' AND '2026-07-31';` |
| Replenishment proposals pending | `SELECT * FROM "replenishmentProposals" WHERE status='pending' ORDER BY "priorityTier", "earliestNeededDate";` |

### Mentions of the named launches in the repo

| Name | Match in repo / memory? | Notes |
|---|---|---|
| Veganmania | yes — `/orders/page.tsx`, `/plan/page.tsx`, business-process-map.md | Real recurring market event, used as a focus-filter test value. |
| Bar Line | no | Not in seed data; would be a new campaign. |
| Iced Things | no | Not in repo. |
| Caramel Jar | no | Not in repo. |
| Strawberry Matcha Bar | no | Not in repo. |
| Father's Day | no | Not in repo. |
| 1060 opening party | no | Not in repo. |

The seven launches are entirely new for this planning window. None of them are pre-seeded as campaigns. Manuela will create each as a fresh `campaigns` row before the reconciler can act on them.

---

## 7. GAPS / KNOWN ISSUES

### Manual Planner v2 — shipped

Spec: `docs/MANUAL_PLANNER_V2_SPEC.md`. All 5 phases shipped (commits `b6467e1` → `9e431dd`). Page at `src/app/(app)/production-brain/manual/page.tsx`. Components under `src/components/manual-planner/`. Aggregator at `src/lib/manual-planner/aggregate-demand.ts`. Single-draft localStorage state; saves into `productionPlans` + `planProducts` + `orderPlanLinks`. Smart suggestions (Phase 4) + FillMouldModal (Phase 5) both wired.

Known carry-forwards:
- Variant-line allocation skipped (`OrderPlanLink` keys on `orderItemId`, not variant lines)
- PO allocations stay informational (no `productionOrderPlanLink` table)
- `productionPlans.surplusDestination = 'po-fill'` is mapped to `'store'` because the enum lacks `'po-fill'`
- Multi-draft composition out of scope

### Weekly Plan redesign — shipped

Spec: `docs/WEEKLY_PLAN_REDESIGN_SPEC.md`. Phases 1-5 shipped + Phase 6 (step grouping). Commits `c4bcdb5` → `fe23366`. Wired into `/plan?view=weekly` via `PlanWeekV2` (`src/components/production-plan/plan-week-v2.tsx`).

Known carry-forwards:
- Day notes persisted only to localStorage (Phase 5.5 DB persistence drafted in spec, not yet shipped)
- "Mark as worked" downstream analytics consumers not wired
- Bulk-reschedule day does no capacity check on target

### Step grouping ≥5 same step same day — shipped

`src/components/production-plan/group-block.tsx`. `buildStepGroups()` exports the threshold-5 logic. Wired into `day-column.tsx` so it precomputes groups + solos and interleaves them by min sortOrder. Group block has its own variant matrix (locked / passive / conflict) and expands inline.

### Two-line step block format — shipped

`src/components/production-plan/step-block.tsx`. `TwoLineRow` + `CompactRow` both present. Density toggle: `COMPACT_THRESHOLD = 6` in `day-column.tsx`. Days with ≥6 step blocks render compact single-line; everything else renders two-line.

### Other gaps (cross-piece)

| Gap | Symptom | Where |
|---|---|---|
| Campaign creation does NOT spawn POs | A new campaign sits passive; reconciler ignores it | `/campaigns` form |
| Subscription runs not in reconciler | Sub demand never becomes a batch automatically | `reconcileGlobalProduceDemand` skips `subscriptionRuns` |
| Replenishment proposals require manual accept | Stock-out risk if user forgets | `/production-brain/needed` + `/plan` Regenerate flow |
| Equipment occupancy not enforced | Tempering machine can be double-scheduled in theory | `scheduler.ts` doesn't read `equipment.currentPlanId` |
| No packing schedule view | Booth + online drop packing folded into "Pack" step only | No dedicated page |
| Shopify inventory not pushed live | Online drop reservation manual | No webhook out from production status |

---

## 8. RECOMMENDATION

Start at `/settings` — confirm Capacity is populated (peopleCount, per-person time windows, workingDays, buffer%, thresholds). Without this the scheduler refuses to run. Then go to `/campaigns` and create one campaign per launch (Veganmania, Bar Line, Iced Things, Caramel Jar, Strawberry Matcha Bar, Father's Day, 1060 opening party) with realistic `startDate` / `endDate` / `productionStartDate` / `targetTotalUnits` / `productTargets`. Immediately for each campaign that's a launch (not a market event already covered by customer orders), create a matching `productionOrder` at `/production-orders/new` with `channel='campaign_run'` + the campaign linked + one `productionOrderItem` per SKU. Once campaigns + POs exist, open `/plan?view=weekly`, click Regenerate, and the reconciler will fan everything into draft batches spread across May 12 → July 31. From there `/plan?view=weekly` is the operational hub — drag-drop to rebalance tight days, pin critical batches, expand step-groups when the column hits 6+ entries, mark days worked from the day-detail drawer as the team completes each one.
