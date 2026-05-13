# Dulceria production app — sidebar + page inventory

Read-only investigation. No code or data changed. Captured from `src/components/side-nav.tsx` and every `src/app/(app)/**/page.tsx` route file as of 2026-05-13. Intended as the source-of-truth artefact for the sidebar redesign.

## The Workshop

| Route | File | Purpose | Primary user action | Data sources | Distinct from | State |
|-------|------|---------|---------------------|--------------|---------------|-------|
| `/orders` | `orders/page.tsx` | List and manage customer orders (wholesale, online, events). | View/edit/create orders, assign to production, change status. | useOrders, useAllOrderItems, useProductsList, useCustomers. | Orders are customer demand; Production orders are internal demand. | built |
| `/picking` | `picking/page.tsx` | Two-tab picking flow: Pack & ship orders, Box up loose pieces into variants. | Pack ready orders, create variant boxes from stock. | useOrders, useAllOrderItems, useProductsList, useVariants, usePackagingList, useProductLocationTotals. | Picking consumes existing stock; Plan creates replenishment. | built |
| `/production-orders` | `production-orders/page.tsx` | Manage internal demand: restocking, campaigns, launches, market events. | View/create/edit production orders for campaigns or minimums. | useProductionOrders, useAllProductionOrderItems, useProductsList, useCampaigns. | Production orders are internal; Orders are customer-facing. | built |
| `/calendar` | `calendar/page.tsx` | Master month view aggregating campaigns, closures, holidays, orders, production days. | Click day to see events, quick-route to creation. | useCampaigns, useBlockedDays, useProductionDays, useOrders. | Calendar is read-mostly aggregate; Plan is edit-centric drag-drop. | built |
| `/plan` | `plan/page.tsx` | Drag-drop production schedule: week view with daily capacity, replan/reschedule. | Drag plan products to days, regenerate plan, mark days worked. | useOrders, useAllOrderItems, useProductionPlans, useAllPlanProducts, useProductionDays, useAllPlanStepStatuses. | Plan is scheduling; Daily is execution on a single day. | built |
| `/production-brain/planner` | `production-brain/planner/page.tsx` | Drag-drop replenishment proposals onto calendar grid. | Drag proposals to schedule; proposals auto-flip to scheduled. | useReplenishmentProposals, useCampaigns, useProductionPlans, useProductionDays. | Planner is agenda for proposals; Plan is full schedule. | built |
| `/production-brain/daily` | `production-brain/daily/page.tsx` | Single-day execution dashboard: products in progress, step toggles, yield entry. | Toggle steps done, record yields, consume fillings, allocate across lots. | useProductionPlans, useAllPlanProducts, useProductionSteps, useAllPlanStepStatuses, usePeople, useEquipment. | Daily is live execution; Plan is pre-production scheduling. | built |
| `/campaigns` | `campaigns/page.tsx` | Create and manage seasonal/limited campaigns (Easter, Mother's Day, launches). | Create campaign, set dates/products, group by status. | useCampaigns. | Campaigns are limited-time promotions; Products are permanent SKUs. | built |
| `/stock` | `stock/page.tsx` | Master stock table: on-hand by location, freezer life, transfers, FIFO, intake. | Adjust counts, freeze/defrost, transfer, intake, mark sell-before dates. | useAllPlanProducts, useProductLocationTotals, useFillingStockItems, useVariantStockLocations. | Stock is ingredient/product ledger; Picking is withdrawal. | built |

## The Pantry

| Route | File | Purpose | Primary user action | Data sources | Distinct from | State |
|-------|------|---------|---------------------|--------------|---------------|-------|
| `/products` | `products/page.tsx` | Pantry master: bonbons, bars, truffles. Two tabs: Products, Categories. | Create/edit products, manage categories, tag allergens, set shelf life. | useProductsList, useProductCategories, useVariants, useFillings, useProductFillingsForProducts. | Pantry products are catalog/master; Shop stock is retail inventory. | built |
| `/fillings` | `fillings/page.tsx` | Reusable filling library: ganaches, pralines, caramels, fruit. | Create/edit fillings, set category shelf-stable flag. | useFillings, useFillingCategories, useFillingCategoryUsageCounts. | Fillings are recipe ingredients; Ingredients are raw materials. | built |
| `/ingredients` | `ingredients/page.tsx` | Raw material library with costs, allergens, composition. | Create/edit ingredients, set costs/allergens, manage categories. | useIngredients. | Ingredients feed fillings; Fillings feed products. | built |
| `/moulds` | `moulds/page.tsx` | Polycarbonate moulds: cavity counts, volumes, tracking pool state. | Create/edit moulds, manage pool (in-use, spare, broken). | useMouldsList, useMouldPool. | Moulds are production equipment; Packaging is finished-goods wrap. | built |
| `/packaging` | `packaging/page.tsx` | Box sizes, inserts, materials. | Create/edit packaging SKUs. | usePackagingList. | Packaging wraps variants; Moulds shape bonbons. | built |
| `/variants` | `variants/page.tsx` | Curated box assortments with status (active, upcoming, past, permanent). | Create/edit variants, set date ranges, manage composition. | useVariants. | Variants are curated SKUs with date windows; Collections are label-derived groups. | built |
| `/collections` | `collections/page.tsx` | Derived view: unique labels across all variants. Unlabelled row synthetic. | Click label to see variant list filtered by that label. | useVariants (extract unique labels). | Collections are derived from variant labels; Variants are primary. | built |
| `/pantry/decoration` | `pantry/decoration/page.tsx` | Decoration materials & categories, shell design techniques. Three tabs. | Create/edit materials, categories, designs. | useDecorationMaterials, useDecorationCategories, useShellDesigns. | Decoration is applied to products; Fillings go inside. | built |

## The Shop

| Route | File | Purpose | Primary user action | Data sources | Distinct from | State |
|-------|------|---------|---------------------|--------------|---------------|-------|
| `/shop` | `shop/page.tsx` | Shop overview: opening hours, closures, live status, stock minimums. | Set hours/closures, check status, configure per-location minimums. | useShopOpeningHours, useShopClosures, useProductsList, useProductLocationTotals. | Shop manages retail hours/config; Counter is transaction entry. | built |
| `/shop/counter` | `shop/counter/page.tsx` | Custom box builder for tablet: pick size → pick bonbons → print label. | 4-step flow: box size → bonbon pick → qty → print. | useProductsList, useProductLocationTotals, useFillings. | Counter is live retail sale; Daily count is end-of-day audit. | built |
| `/shop/daily-count` | `shop/daily-count/page.tsx` | Two-tab end-of-day: Variants sold, Bonbon count (reconcile shelf vs system). | Tab 1: pick variant + qty + price; Tab 2: recount products, apply variance. | useVariants, useAllVariantPackagings, useProductsList, useProductLocationTotals. | Daily count is shop post-transaction audit; Monthly count is full physical. | built |
| `/shop/transfer` | `shop/transfer/page.tsx` | Move finished goods from production → shop. Left: suggestions, Right: history. | One-click transfer of surplus stock, manual transfer form. | useProductsList, useProductLocationTotals, useStockLocationMinimums, useStockTransfers. | Transfer is incoming; Breakage is outgoing (non-sale). | built |
| `/shop/breakage` | `shop/breakage/page.tsx` | Stock-out log: sold, tasting, gift, event sample, staff, waste. | Bulk entry of walk-in singles + non-sale departures. | useProductsList, useStockTransfers, useCampaigns, useProductCategories. | Stock out captures non-order exits; Orders are structured wholesale. | built |
| `/shop/count` | `shop/count/page.tsx` | Monthly physical inventory count: walk shelves, enter actual counts. | Enter counts per product, save to reconcile system vs reality. | useProductsList, useProductLocationTotals, useProductCategories. | Monthly count is full recount; Daily count is variance after variants. | built |

## Customers

| Route | File | Purpose | Primary user action | Data sources | Distinct from | State |
|-------|------|---------|---------------------|--------------|---------------|-------|
| `/customers` | `customers/page.tsx` | B2B customer list with analytics (lifetime, last order, tags). | Search/filter/create customers, view lifetime value, assign price list. | useCustomers, useOrders, useAllOrderItems. | Customers are B2B accounts; Orders are transactions. | built |
| `/quotes` | `quotes/page.tsx` | B2B quotes: draft, sent, accepted, expired. Auto-expire on date. | Create/send/manage quotes with line items, expiry, margins. | useCustomers, useQuery (raw quotes), auto-expiry logic. | Quotes are pre-order proposals; Orders are confirmed. | built |
| `/pricing/lists` | `pricing/lists/page.tsx` | B2B price lists: named rule sets (product/collection/tag overrides). | Create list, assign customers, manage pricing rules. | usePriceLists, useCustomers. | Price lists are customer-level overrides; Pricing is global baseline. | built |
| `/subscriptions` | `subscriptions/page.tsx` | Subscription box templates: recurring SKU configs, ship cycles. Q4 rollout. | Create template, manage runs. | useSubscriptionTemplates, useSubscriptionRuns. | Subscriptions are recurring; Variants are one-time purchases. | built |

## The Observatory

| Route | File | Purpose | Primary user action | Data sources | Distinct from | State |
|-------|------|---------|---------------------|--------------|---------------|-------|
| `/observatory` | `observatory/page.tsx` | Observatory overview: MTD/YTD revenue, active quotes, production plan status. | Dashboard: navigate to detailed reports. | useOrders, useQuotes, useProductionPlans, useProductsList. | Observatory is read-only dashboard; Reports are detailed breakdowns. | built |
| `/reports/sales` | `reports/sales/page.tsx` | Weekly sales: stock-out (walk-in, tasting, gift, staff, waste) + orders. | Pick date range, export revenue. | useStockTransfers, useOrders, useAllOrderItems, usePackagingList. | Sales is weekly aggregate; Monthly is full month snapshot. | built |
| `/reports/monthly` | `reports/monthly/page.tsx` | Monthly review: revenue by channel, margin per product, yield %, filling waste. | Pick year-month, see trends vs previous month. | useOrders, useAllOrderItems, useProductionPlans, useAllPlanProducts. | Monthly is full month review; Weekly is narrow range. | built |
| `/pricing` | `pricing/page.tsx` | Variant pricing matrix: cost, packaging, margin, price per unit/box. | View costs, margins, suggest pricing. | useVariants, useAllVariantPackagings, useAllVariantProducts, usePackagingList. | Pricing is per-variant cost/margin; Price lists are customer overrides. | built |
| `/stats` | `stats/page.tsx` | Product trends: recent yield %, last produced, comparison windows. | View production trends, slot per product. | useProductionPlans, useAllPlanProducts, useVariants. | Stats is production trends; Pricing is margin analysis. | built |
| `/observatory/product-cost` | `observatory/product-cost/page.tsx` | Detailed cost breakdown per product: ingredient costs, yield loss, similar products. | Drill into cost components, see cost trend vs peers. | useProductsList, useMouldsList, useIngredients. | Product cost is ingredient+labour+overhead; Pricing is retail. | built |
| `/imports` | `imports/page.tsx` | CSV imports: Shopify orders, stock, HelloCash sales. Dry-run, preview, undo. | Upload CSV, resolve unmapped SKUs, commit or undo. | useCsvImports, useExternalSkuMapping, useProductsList. | Imports is data ingestion; Manual entry is real-time. | built |

## The Lab

| Route | File | Purpose | Primary user action | Data sources | Distinct from | State |
|-------|------|---------|---------------------|--------------|---------------|-------|
| `/lab` | `lab/page.tsx` | Product Lab: 4 tabs — Experiments, Ganache calculator, Recipe calculator, Audit recipes. | Switch tabs, create experiments, balance ganache, calculate recipes. | useFillings, useIngredients, useMouldsList, useVariants, useAllVariantProducts, useAllVariantPackagings. | Lab is formulation sandbox; Products are committed SKUs. | built |
| `/audit` | `audit/page.tsx` | Data audit: scan all entities for missing required fields, generate issue list. | Review issues, click deep link to fix, re-audit. | useProductsList, useVariants, useAllVariantPackagings, useIngredients, useFillings, useMouldsList, usePackagingList. | Audit is completeness check; Notifications are alerts. | built |

## Dashboard & Utilities

| Route | File | Purpose | Primary user action | Data sources | Distinct from | State |
|-------|------|---------|---------------------|--------------|---------------|-------|
| `/dashboard` | `dashboard/page.tsx` | Main app landing: 6-card zone overview, pipeline, needs attention, next 7 days. | Click zone cards to drill into spaces, scan alerts. | useOrders, useAllOrderItems, useProductsList, useProductionDays, useCapacityConfig, usePeople, useAllPlanProducts, useProductionPlans, useCampaigns. | Dashboard is home hub; Spaces are detailed workspaces. | built |
| `/shopping` | `shopping/page.tsx` | Ingredient/packaging/decoration purchasing: low-stock flags, order tracking. | Mark as ordered, undo, add manual items, receive stock. | useIngredients, usePackagingList, useShoppingItems, useDecorationMaterials, useAllIngredientStock. | Shopping is procurement; Inventory is on-hand tracking. | built |
| `/workshop` | `workshop/page.tsx` | Workshop overview: production plans, orders, campaigns. | Navigate to detailed workspace pages. | useProductionPlans, useOrders, useCampaigns, useProductsList, useAllPlanProducts. | Workshop is space hub; Plan is scheduling detail. | built |
| `/pantry` | `pantry/page.tsx` | Pantry overview: product/filling/ingredient counts, alerts, broken moulds. | Navigate to catalog pages. | useProductsList, useFillings, useIngredients, useMouldsList, usePackagingList, useMouldPool. | Pantry is space hub; Products is catalog detail. | built |
| `/settings` | `settings/page.tsx` | Multi-tab configuration: Backup, Import, Capacity, Equipment, Production Steps, Market, Printing, Demo. | Configure facility, import bulk data, backup. | All hooks (people, equipment, capacity, ingredients, fillings, moulds, products, production steps). | Settings is system config; Pantry is catalog. | built |
| `/notifications` | `notifications/page.tsx` | Notification center: filter by status/type/urgency, bulk actions. | Review, approve, snooze, dismiss notifications. | useNotifications. | Notifications is full-page center; Bell dropdown is quick view. | built |
| `/wall` | `wall/page.tsx` | Wall display: fullscreen dashboard for workshop TV (active plans, temps, incidents). | Display only (no interaction), auto-refresh. | useProductionPlans, usePeople, useStaffShifts, useColdStorageUnits, useTemperatureReadings, useHaccpIncidents. | Wall is big-format display; Plan is interactive editor. | built |
| `/library` | `library/page.tsx` | Library index/hub: card links to all pantry pages. | Click cards to navigate to catalogs. | useProductsList, useFillings, useIngredients. | Library is nav hub; Products is catalog detail. | built |

---

## Clarifications

### 1. Calendar vs Plan vs Planner vs Daily in Workshop

- **Calendar** (`/calendar`, `src/app/(app)/calendar/page.tsx`) — read-mostly aggregate of campaigns, closures, holidays, orders, production days. Month view with side panel for quick-create routes. Aggregates data but does not edit schedule.
- **Plan** (`/plan`, `src/app/(app)/plan/page.tsx`) — drag-drop production schedule: week view with daily capacity, replan/regenerate, mark days worked, reschedule plan products. Edit-centric.
- **Planner** (`/production-brain/planner`, `src/app/(app)/production-brain/planner/page.tsx`) — drag-drop replenishment proposals onto 4-week calendar grid. Proposals auto-flip to scheduled. Narrower scope than Plan (proposals only, not full schedule).
- **Daily** (`/production-brain/daily`, `src/app/(app)/production-brain/daily/page.tsx`) — single-day live execution: toggle steps done, record yields, consume fillings, allocate across lots. Execution dashboard for today; Plan is pre-production for the week.

### 2. Orders vs Picking vs Production orders

- **Orders** (`/orders`) — customer demand (wholesale, online, events). Statuses: quote, pending, ready_to_pack, done, cancelled.
- **Picking** (`/picking`) — fulfillment: two tabs — Pack & ship (one-click drain of allocated stock + status flip to done) and Box up (turn loose pieces in production/store into pre-built variant boxes).
- **Production orders** (`/production-orders`) — internal demand sibling of customer orders. Workshop drives these (restocking minimums, market events, campaign runs, launches). Brain reads them alongside customer orders.

### 3. Workshop Stock vs Shop Stock out

- **Workshop Stock** (`/stock`) — master ingredient/product ledger across all locations (production, shop, freezer, storage). Tracks on-hand by location, freezer shelf-life, transfers, FIFO, intake, adjustments.
- **Shop Stock out** (`/shop/breakage`) — bulk-entry screen for everything leaving shop stock outside normal order/box flows: walk-in singles, tastings, gifts, event samples, staff consumption, breakage. Saves as stockTransfer rows.

Different: Stock is all-inventory ledger; Stock out is shop-exit capture.

### 4. Pantry Products vs Shop products

- **Pantry Products** (`/products`) — master catalog: bonbons, bars, truffles. Source of truth for SKU definitions, allergens, shelf-life, fillings, moulds, coatings.
- **Shop stock** (implied in `/shop`, `/shop/daily-count`, `/shop/transfer`) — retail inventory at the physical shop location. Tracked via `productLocationTotals` (location='shop'). Pantry products *populate* shop stock via transfers and sales.

Relationship: Pantry = catalog master, Shop = retail point-of-sale inventory.

### 5. Variants vs Collections in Pantry

- **Variants** (`/variants`) — curated box assortments with time windows: `startDate`, `endDate`, `labels`. Status: active, upcoming, past, permanent. Composition points to products. Migration 0047 renamed Collections → Variants.
- **Collections** (`/collections`) — *derived* view: every unique label across all variants becomes a row. Unlabelled synthetic row. No independent record — just a grouping UI on variant labels.

Both still appear in nav (`src/components/side-nav.tsx`). Not Shopify-style; custom time-windowed + label-derived system.

### 6. Counter (custom box) in Shop

(`/shop/counter`) — tablet-first flow: customer picks box size (4/8/16/other) → picks bonbons (qty per product/filling) → prints label. Every bonbon pulled here deducts from shop stock immediately via `custom_box_records` inserts. Live retail transaction entry.

### 7. Pricing vs Price lists

- **Pricing** (`/pricing`, Observatory) — per-variant cost (ingredients + packaging), gross margin, margin %, suggested price per unit/box. Read-only reference for cost/margin analysis.
- **Price lists** (`/pricing/lists`, Customers) — named rule sets (product/collection/tag overrides). Customers can be assigned a `defaultPriceListId`. Pricing is global baseline/matrix; price lists are customer-level overrides.

### 8. Quotes in Customers

(`/quotes`) — B2B pre-order proposals. Statuses: draft, sent, accepted, expired. Auto-expire sent quotes whose expiresAt has passed (no cron — check runs on page load).

### 9. Subscriptions in Customers

(`/subscriptions`) — Subscription box templates: one recurring box shape per template. Runs (ship cycles) live on detail page. Q4 rollout per questionnaire, scaffolding ready.

### 10. Data audit vs Product Lab

- **Data audit** (`/audit`) — scan all entities (products, variants, variant-packaging, ingredients, fillings, moulds, packaging, product categories) for missing required fields. Generate issue list with deep links to fix. Re-audit to verify.
- **Product Lab** (`/lab`) — formulation sandbox: 4 tabs — Experiments, Ganache calculator, Recipe calculator, Audit recipes. Formulate and balance fillings before committing as products.

Different: Data audit is completeness/validity check; Product Lab is formulation workbench.

---

## Unreachable from sidebar

### Detail pages (accessed via row click or drill-down)

| Route | File | What it is |
|-------|------|-----------|
| `/orders/[id]` | `orders/[id]/page.tsx` | Order detail: line items, fulfillment, status tracking. |
| `/orders/[id]/production` | `orders/[id]/production/page.tsx` | Order production allocation detail. |
| `/orders/online` | `orders/online/page.tsx` | Separate online orders list (distinct from wholesale/event). |
| `/orders/online/[id]` | `orders/online/[id]/page.tsx` | Online order detail. |
| `/orders/online/import` | `orders/online/import/page.tsx` | Shopify order import flow (dry-run, preview, commit). |
| `/orders/online/import-bonbons` | `orders/online/import-bonbons/page.tsx` | Bonbon-specific import flow. |
| `/production-orders/[id]` | `production-orders/[id]/page.tsx` | Production order detail: line items, status, campaign link. |
| `/production` | `production/page.tsx` | Alternative production list view. |
| `/production/[id]` | `production/[id]/page.tsx` | Production detail: step-by-step status, yields, linked items. |
| `/production/[id]/products` | `production/[id]/products/page.tsx` | Production → products detail sub-view. |
| `/production/[id]/summary` | `production/[id]/summary/page.tsx` | Production → summary sub-view. |
| `/production/new` | `production/new/page.tsx` | New production form wizard. |
| `/campaigns/[id]` | `campaigns/[id]/page.tsx` | Campaign detail: dates, products, status. |
| `/campaigns/[id]/production` | `campaigns/[id]/production/page.tsx` | Campaign → production orders sub-view. |
| `/customers/[id]` | `customers/[id]/page.tsx` | Customer detail: contact, tags, analytics, order history. |
| `/quotes/[id]` | `quotes/[id]/page.tsx` | Quote detail: line items, expiry, send/accept flow. |
| `/quotes/new` | `quotes/new/page.tsx` | New quote form. |
| `/subscriptions/[id]` | `subscriptions/[id]/page.tsx` | Subscription template detail: runs, customer assignments. |
| `/products/[id]` | `products/[id]/page.tsx` | Product detail: fillings, moulds, coatings, photo, allergens. |
| `/products/categories/[id]` | `products/categories/[id]/page.tsx` | Product category detail. |
| `/fillings/[id]` | `fillings/[id]/page.tsx` | Filling detail: ingredients, recipe, allergens. |
| `/fillings/categories/[id]` | `fillings/categories/[id]/page.tsx` | Filling category detail. |
| `/ingredients/[id]` | `ingredients/[id]/page.tsx` | Ingredient detail: cost, allergens, weight, supplier. |
| `/ingredients/categories/[id]` | `ingredients/categories/[id]/page.tsx` | Ingredient category detail. |
| `/moulds/[id]` | `moulds/[id]/page.tsx` | Mould detail: cavity count, volume, pool tracking. |
| `/packaging/[id]` | `packaging/[id]/page.tsx` | Packaging detail: box size, components, costs. |
| `/variants/[id]` | `variants/[id]/page.tsx` | Variant detail: composition, packaging, dates, labels. |
| `/collections/[label]` | `collections/[label]/page.tsx` | Collection label detail: variants with that label. |
| `/pantry/decoration/[id]` | `pantry/decoration/[id]/page.tsx` | Decoration material/design detail. |
| `/pantry/decoration/categories/[id]` | `pantry/decoration/categories/[id]/page.tsx` | Decoration category detail. |
| `/pantry/decoration/designs/[id]` | `pantry/decoration/designs/[id]/page.tsx` | Shell design detail. |
| `/pricing/lists/[id]` | `pricing/lists/[id]/page.tsx` | Price list detail: product/collection/tag pricing rules. |
| `/calculator` | `calculator/page.tsx` | Production calculator (alternative view). |
| `/calculator/[id]` | `calculator/[id]/page.tsx` | Calculator detail. |
| `/calculator/[id]/batch` | `calculator/[id]/batch/page.tsx` | Calculator batch detail. |
| `/calculator/[id]/run` | `calculator/[id]/run/page.tsx` | Calculator run detail. |
| `/production-brain` | `production-brain/page.tsx` | Production Brain hub. |
| `/production-brain/dashboard` | `production-brain/dashboard/page.tsx` | Production Brain dashboard (alternate). |
| `/production-brain/equipment` | `production-brain/equipment/page.tsx` | Equipment status dashboard. |
| `/production-brain/haccp` | `production-brain/haccp/page.tsx` | HACCP incidents log. |
| `/production-brain/manual` | `production-brain/manual/page.tsx` | Manual production entry (Manual Planner v2 page). |
| `/production-brain/needed` | `production-brain/needed/page.tsx` | Replenishment needs (pending proposals). |
| `/settings/setup` | `settings/setup/page.tsx` | Settings setup wizard/onboarding. |
| `/settings/skills` | `settings/skills/page.tsx` | Settings skills catalog. |
| `/stock/adjust` | `stock/adjust/page.tsx` | Stock adjustment sub-flow. |
| `/plan/fillings` | `plan/fillings/page.tsx` | Plan fillings detail sub-view. |

### Public / auth routes

| Route | File | What it is |
|-------|------|-----------|
| `/` | `(public)/page.tsx` | Pre-login landing (marketing/login). |
| `/getting-started` | `(public)/getting-started/page.tsx` | Onboarding flow. |

---

## Summary

- **6 spaces** (Workshop / Pantry / Shop / Customers / Observatory / Lab) + Dashboard + utilities.
- **~40 primary routes** reachable from the side-nav. All marked `built`; no stubs in primary spaces.
- **~45 detail / drill-down routes** reachable via row clicks. All implemented.
- **8 `production-brain/*` parallel routes** — heavy duplication with `/plan`, `/calendar`, `/production-orders`, `/workshop`. Top candidate for consolidation pass.
- **`/wall`, `/library`, `/calculator`** sit outside the main spaces — orphans worth folding into existing spaces or dropping.
- **`/collections` is derived from `/variants` labels only.** Phase-out of the standalone collections nav entry is safe; it can stay as a filter inside `/variants`.
