# Production app — page audit (2026-05-13)

Snapshot of every non-redesigned route + every tab/detail page hanging off the
already-redesigned pantry pages. Brutally honest by intent.

Already-redesigned routes excluded from this audit (they live in the spec):

- `/workshop`, `/dashboard`, `/calendar`, `/campaigns`, `/campaigns/[id]`
- `/plan?view=weekly`, `/production-brain/manual`, `/production-brain/dashboard`
- `/products`, `/fillings`, `/ingredients`, `/moulds`, `/packaging`, `/variants`, `/collections`, `/decoration`
- Sidebar (global)

Audit template per route: file path · what it shows · what works · what's broken · data state · DS retrofit status · severity flag.

---

# Workshop space

## /orders

**File:** `src/app/(app)/orders/page.tsx`

**What it shows:** Custom inline header (serif h1 "Orders" + subtitle + "Online" + "New order"). Search bar in iOS-glass pastel card. Status filter tabs (all / pending / ready_to_pack / in_production / done / cancelled) with count badges. Orders grouped by channel (online, b2b, event, shop) inside pastel iOS-glass card sections. Each order rendered as DS `ListRow` (tier + StatusTag + secondary "Next action" line). Sidebar metadata: customer name + source ref + deadline with overdue highlighting. Line count + item preview truncated to 3.

**What works:** Smart `ListRow` tier system (urgent for overdue, done for completed, parked for cancelled). StatusTag pairs (main status + sub-state "Scheduled" / "Awaiting plan"). Next-action label pulls from production pipeline + calculates relative dates. Search + tab filtering clean. Channel grouping organises visual hierarchy.

**What's broken / clunky:** "New order" inline form sits below the search — no modal separation, cramped product picker grid (col-span-6/2/3 + 1 delete). Partial-stock resolution modal is a full-screen overlay (good prominence, adds friction on save). StatusTag for pending sub-states can confuse when Next action is also visible (two overlapping signals). Unit-price resolution (net vs gross / variant vs customer vs retail fallback) opaque in UI.

**Data state:** Real. Hooks pull live orders, order items, production plans, plan step statuses. Next-action walks production day line items + step completion. Zero-orders state graceful. Partial-stock detection live against `stockLocationTotals`.

**Recent DS retrofits:** `ListRow` + `StatusTag` from `@/components/dulceria` fully integrated. Tabler icons. iOS-glass `backdrop-blur-2xl` cards used throughout. No DS PageHeader (custom serif h1 inline). Pastel STATUS_STYLE map uses `--accent-*-bg`.

**Severity flags:** 🟡 NEEDS WORK — inline form feels less polished than modal; price-resolution opacity.

---

## /picking

**File:** `src/app/(app)/picking/page.tsx`

**What it shows:** Custom inline header "Picking". Two tabs: "Pack & ship" + "Box up". Pack tab = orders with status `ready_to_pack` as simple cards (customer, channel, source ref, deadline, line count, item preview, success/error state); one-click "Pack & ship" button per order. Box tab = all boxable variant packagings as rows with: variant name + size, on-hand per location, open-order demand, buildable count (bottleneck-aware), qty input, destination select (shop/production/freezer), "Box up" button.

**What works:** Two-tab split is dead simple. Bottleneck messaging ("limited by [product] [free qty]") shows what's blocking. Live reservation logic (other rows' inputs reduce max for shared products/packaging). Card success/error feedback via `status-ok-bg/blush-bg/30`.

**What's broken / clunky:** Box tab row is cramped: number input (w-20) + select + button inline, meta on next line. When bottleneck count is high (e.g. 500) the message is verbose. No clear visual hierarchy between on-hand / needed / can build — all same font/color. Pack tab item preview caps at 5 with "+N more" — large orders feel truncated. Open-order demand shown only on box tab, not on pack rows, so operator can't see piece-count movement.

**Data state:** Real. Pack filters `ready_to_pack`. Box pulls `variantPackagingId` + product composition + packaging components + variant stock (unallocated) + open-order variant lines + active production plans. Max buildable via composition walk.

**Recent DS retrofits:** Tabler icons only. No DS components. Pure custom CSS with `border-status-*` + card bg. `BackButton`.

**Severity flags:** 🟡 NEEDS WORK — Box tab layout cramped; metrics not equally scannable. Consider single visual gauge per variant size.

---

## /production-orders

**File:** `src/app/(app)/production-orders/page.tsx`

**What it shows:** Custom inline header "Production orders" + total count. "New production order" button. Empty state with calendar icon. Orders grouped by status (pending / in_production / done / cancelled). Each row: title (name + channel badge "Restock"/"Campaign run" + target location + optional campaign name) + meta (total units + product names preview + "+N more") + due date right-aligned.

**What works:** Status grouping with counts. Channel/target badges stack logically. Campaign-name styling (lilac ink) marks cross-linked production work.

**What's broken / clunky:** No visual urgency state per row — bare static text cards. No stock/yield feedback. "Campaign run" badge doesn't link to the campaign — shallow context. Target location (→ store / freezer) hard to spot. No filter/search despite scaling potential. Empty-items shown as "no items yet" — should encourage adding or mark as template. Due date is bare ISO with no relative indicator (today/tomorrow/overdue).

**Data state:** Real. Hooks pull production orders + items + campaigns. Groups by status, sorts by due date asc.

**Recent DS retrofits:** Tabler `IconCalendar` (empty state) only. No DS components. Custom card styling.

**Severity flags:** 🟡 NEEDS WORK — No search/filter, no relative date labels, no visual urgency. Scaling to >20 orders is going to feel repetitive.

---

## /stock

**File:** `src/app/(app)/stock/page.tsx`

**What it shows:** Legacy `@/components/page-header` PageHeader. Tab strip (products / boxes / fillings / movements) as rounded-full buttons. "Adjust stock →" link top-right. Products tab = per-product groups (collapsed by default). Each group: product name, total pieces, frozen pieces, earliest sell-by, low-stock flag. Per-batch detail rows: batch label, mould info, yield, current stock (available + frozen), sell-by + shelf-life status, distribution across locations (store / production / freezer / allocated). Boxes tab = variant packagings with on-hand per location + allocation status. Fillings + movements tabs exist.

**What works:** Tab strip unambiguous. Collapsed groups + expand-on-demand keeps overview scannable. Shelf-life logic (`completedAt + shelfLifeWeeks`, or `defrostedAt + preservedShelfLifeDays` for thawed) is thorough. Low-stock floats to top. Sell-by color coding (expired = alert, <7d = warn, OK = muted). Freeze/defrost buttons per batch with state transitions (available → needs-wash → in-deep-wash → available).

**What's broken / clunky:** Count input requires a modal prompt + confirmation — friction. Filter pill strip (low / sell-by / has-notes / freezer state) hidden behind a `SlidersHorizontal` toggle. Batch rows are dense text — no visual separation between yield/current/frozen. Sell-by "soon" badge doesn't show the actual date clearly. Frozen pieces shown separately but not grayed out in the count. No drag-to-reorder or inline batch actions.

**Data state:** Real. `inStockRows` filters `planProducts` by `status=done`, non-zero availability, computes shelf-life per product + mould cavities. Groups by `productId`, sorts by earliest sell-by + low-stock flag.

**Recent DS retrofits:** Legacy PageHeader. Tabler icons (`Search`, `SlidersHorizontal`, `X`, `Plus`, `ClipboardList`, `Snowflake`, chevrons). No DS components.

**Severity flags:** 🟡 NEEDS WORK — modal-driven count confirm; filter UI hidden; no keyboard shortcuts.

---

## /production-brain (hub landing)

**File:** `src/app/(app)/production-brain/page.tsx`

**What it shows:** Redirects to `/production-brain/dashboard`. No actual page content.

**Severity flags:** 🔴 CRITICAL if dashboard route is broken / missing. Should be a hub with links to planner / daily / needed / equipment / haccp / manual / dashboard. Right now users get a silent bounce.

---

## /production-brain/planner

**File:** `src/app/(app)/production-brain/planner/page.tsx`

**What it shows:** Legacy PageHeader. Month-view calendar grid (4 weeks × 5 workdays, skips weekends). Day cells: day number, plan count, clickable batch list (max 3 + "+N more"), drag-over highlight `accent-terracotta-bg`, grayed for out-of-month. Campaigns strip above (3-col grid). Right sidebar: proposal list (pending replenishment proposals with product, T1/T2/T3 priority, qty + needed date, dismiss). Drag-drop: drag proposal → drop on day → schedules batch + flips proposal to scheduled. `DragOverlay` shows proposal label.

**What works:** Month grid visual + color-coded. Campaign strip provides context. Proposal cards compact + draggable. Error messaging for missed drops. Priority tiers color-coded.

**What's broken / clunky:** Day cells `min-h-[100px]` — tight if >3 batches. Sidebar fixed-width 260px — stacks tall on narrow viewports. "Engine quiet. Nothing waiting." placeholder is stylised serif (out of tone). Tier labelling (T1/T2/T3) terse — users unfamiliar may not know which is most urgent. No undo after drag — batch scheduled immediately. Day cell click does nothing (no detail drawer).

**Data state:** Real. `useReplenishmentProposals` filtered to pending. `useCampaigns` filters to active/planned. Month anchor hardcoded to `new Date()` — no URL param.

**Recent DS retrofits:** Legacy PageHeader. `@dnd-kit/core` drag-drop. No DS components.

**Severity flags:** 🟡 NEEDS WORK — read-only month grid (no inline edit / detail drawer). Sidebar lacks pagination/search.

---

## /production-brain/daily

**File:** `src/app/(app)/production-brain/daily/page.tsx`

**What it shows:** Workshop floor focus. ViewDate picker (step forward/back to preview tomorrow). PlanTabs strip. Big "Right now" focus card. Clickable peek cards per phase (Polishing / Painting / Shelling / Filling Prep / Filling / Capping / Unmoulding / Packing). Each phase card has a tinted gradient (PHASE_TINT: polishing butter, colour blush, shell butter, filling lavender, fill sky, cap sage, unmould green, packing orange). Side rail with machines / mould pool / staff / live event feed.

**What works:** Phase organisation splits day into clear stages. Phase tint gradients create visual hierarchy. ViewDate allows multi-day preview.

**What's broken / clunky:** Phase cards have pastel gradient backgrounds (legacy pastel-filled) — no clear affordance to expand/collapse or drill in. "Right now" focus card structure unclear from skim. Side rail content layout not surfaced. PHASES list hardcoded — adding a phase needs code. No visual "current phase" indicator.

**Data state:** Real. `useTodayProductionDay`, plans, planProducts, steps, statuses, people, unavailability, equipment, mould pool, fillings, ingredients, campaigns, orders.

**Recent DS retrofits:** Tabler icons (`Thermometer`, `X`). `BackButton`, `PlanTabs`, `ProductGroupedChecklist`. PHASE_TINT custom (not DS).

**Severity flags:** 🟡 NEEDS WORK — phase card interaction pattern unclear; no current-phase indicator.

---

## /production-brain/needed

**File:** `src/app/(app)/production-brain/needed/page.tsx`

**What it shows:** Two sections: open orders (pending / in_production / ready_to_pack) clickable list + demand aggregation by product vs variant packaging. Variant rows: label (variant – size), needed, packed, planned, net gap (needed - packed - planned), packable from loose (composition-limited). Product rows similar.

**What works:** Demand / stock / planned separation clear. Composition constraint calc (packable = min across composition products / qty) prevents over-promise.

**What's broken / clunky:** Selection mechanism (checkboxes? click rows?) unclear in skim. Packed / planned / gap as separate columns — slow to compare mentally. Packable from loose is conditional info (only shown if gap > 0) so it can vanish. No totals row. No action buttons to trigger packing or production runs. Variant + product rows mixed in same list — unclear which is which at a glance.

**Data state:** Real. Orders filtered to open. Demand keyed by variant packaging ID + product ID. `looseByProduct` sums all locations. `packedByVp` sums non-allocated `variantStockLocations`. `plannedByProduct` sums active production plan pieces.

**Recent DS retrofits:** Tabler icons (`CheckSquare`, `Square`, `Info`, `AlertTriangle`, `Check`). No DS components.

**Severity flags:** 🟡 NEEDS WORK — selection mechanism unclear; no action affordances.

---

## /production-brain/equipment

**File:** `src/app/(app)/production-brain/equipment/page.tsx`

**What it shows:** Phase 2 read-only. Four panels: tempering machines + melting pots, mould pool, cold storage (HACCP targets + frequency), other equipment. Machines grid (1/2/3 cols): instance name + status dot, active chocolate load (ingredient + remaining kg + progress bar), aging alert if load > threshold, machine specs (brand + model + capacity).

**What works:** Machine grid compactly shows live load + aging. Progress bar (`remainingQty / loadedQty %`) scannable. Aging alert text ("in machine Xd · aging — use or switch") clear. Status dot color-coded.

**What's broken / clunky:** "Coming soon" placeholder for edit UI breaks immersion — operators can't log loads, drain, or mark moulds washed. Mould pool detail not visible in skim. Machine specs in small gray text — easy to miss. No load history or drain log. No inventory of available ingredients to temp.

**Data state:** Real. `useEquipmentInstances`, `useMachineLoads`, `useEquipment`. Aging computed as `daysSince(loadedAt)` vs threshold. MouldPoolInstance state transitions via `saveMouldPoolInstance`.

**Recent DS retrofits:** Legacy PageHeader. Tabler `Thermometer`. No DS components.

**Severity flags:** 🟡 NEEDS WORK — Phase 2 read-only means key operator actions blocked. Edit flows are "coming soon" placeholders.

---

## /production-brain/haccp

**File:** `src/app/(app)/production-brain/haccp/page.tsx`

**What it shows:** Cold storage unit management. Unit list (fridge / freezer / ambient). Each unit card: name + type + location + target range (min–max °C) + check frequency (/day). Left half = last reading display (large temp + °C + timestamp + in-range status + sparkline of last 20). Right half = log form (temp input + person dropdown + notes + submit). Open incidents section at bottom (red-tinted, unit + start time + action taken).

**What works:** Two-column layout (view + act) separates concerns. Large temp display with in-range color (alert red / OK green). Sparkline shows trend at a glance. Out-of-range reads auto-create HACCP incidents.

**What's broken / clunky:** Sparkline render details opaque. Log form notes optional — unclear when to fill it. No submit confirmation — accidental clicks save. Unit list scroll/pagination unknown. Open incidents are static text — no way to mark resolved or add follow-up. No timezone indicator.

**Data state:** Real. `useColdStorageUnits`, `useTemperatureReadings`, `useHaccpIncidents`. Out-of-range triggers `saveHaccpIncident`.

**Recent DS retrofits:** Legacy PageHeader. No DS components.

**Severity flags:** 🟡 NEEDS WORK — no incident resolution path; log form lacks confirmation; setup ("NewUnitForm") missing.

---

## /plan (day / pivot / month views)

**File:** `src/app/(app)/plan/page.tsx`

**What it shows:** Four view modes via `?view=` param:
- `weekly` (default) → `PlanWeekV2` (already redesigned).
- `day` → not visibly redesigned. Implementation hidden in skim.
- `pivot` → not visibly redesigned.
- `month` → not visibly redesigned.

Header has `PlanHeader` (stats pills: total batches, days covered, window start/end, total planned vs capacity minutes, tight days count, peak day). `FilterStrip` with focus multi-source selector (comma-separated tokens like `campaign:Veganmania,po:Replen`). Focus chip strip shows active sources. Optional day-detail drawer (right sidebar, keyed by `drawerIso`). Bottom summary panel. Regenerate button + last-result feedback. `DndContext` wraps everything for rescheduling.

**What works:** URL-driven viewMode stays in sync. Focus filter (`?focus=`) slices calendar to single source; multi-source comma-sep is powerful. `FocusLabel` resolver shows "3 sources" vs individual label. StatusTag colors via `LEVEL_PILL/LEVEL_TINT` maps.

**What's broken / clunky:** `viewParamRaw` normalisation ("weekly" → "week" internally but URL shows "weekly") is confusing. `FilterStrip` source counts keyed on hardcoded window (yesterday…+13 days). Focus token parsing string-based (split on `:`, index-of check) — malformed tokens silently ignored. Day / pivot / month views are LEGACY layouts — pastel iOS-glass cards still present, no DS retrofit. CARD constant still defined `bg-white/65 backdrop-blur-2xl border border-white/60 rounded-[18px] p-4`. No undo for drag operations. SearchParams-driven focus = long URLs.

**Data state:** Real. ~15 hooks pulled. `daySummary` per day: plannedMinutes, availableMinutes, utilisationPercent, level (ok/warn/critical/over). `visibleLineItems` filtered by `focusFocusedPlanIds` + excludes done/cancelled/orphaned.

**Recent DS retrofits:** Weekly view = redesigned. Day/pivot/month = legacy iOS-glass. Legacy PageHeader. Tabler icons. Custom `PlanHeader`/`FilterStrip`/`PlanTabs`. LEVEL_PILL uses pastel `--accent-*-bg` CSS vars.

**Severity flags:** 🟡 NEEDS WORK — three view modes (day, pivot, month) still on legacy iOS-glass. Token parser fragile. Window hardcoded.

---

# Shop space

## /shop (overview)

**File:** `src/app/(app)/shop/page.tsx`

**What it shows:** Custom inline header (serif "Storefront", status pill open/closed, four destination pills: Counter, Daily count, Transfer in, Stock out). Two-column grid. Left col: 3 iOS-glass cards (Pickups today, Arriving from production, Online orders). Right col: Shop stock grid (color-coded pastel tiles: mint ok / butter low / blush out / purple over with product names + qty), Hours & closures card, Label printing placeholder.

**What works:** Clear operational dashboard. Pickups card with channel tags. Stock grid color-coded. Hours card compact weekday summary, expandable into full editor. Live status inline.

**What's broken / clunky:** Stock grid at 3-4 col span on desktop crams too many small tiles — product names at 8.5px unreadable. Hours card repeats info redundantly (compact + detailed view toggle). Label printing placeholder = Coming Soon vaporware. Closures list shows 3 items before hiding — forced expand for short list. Colors hardcoded inline (#e3ebe6, #2e4839).

**Data state:** Real. `useOrders`, `useProductsList`, `useStockLocationTotals`, `useShopClosures`, `useShopOpeningHours`.

**Recent DS retrofits:** None. All custom iOS-glass (`bg-white/70 backdrop-blur-2xl`). Tabler icons (`Plus`, `X`, `Printer`, `Clock`). No DS PageHeader/StatCard/Section/DsButton.

**Severity flags:** 🟡 NEEDS WORK — stock grid density unreadable; placeholder real estate; redundant hours toggle.

---

## /shop/counter

**File:** `src/app/(app)/shop/counter/page.tsx`

**What it shows:** 4-step wizard for custom box building: Step 1 (size selector — 4/8/16/other with text input), Step 2 (bonbon grid picker — 2/3/4 col responsive, product cards with +/- buttons), Step 3 (review panel — 2-col layout with picked items list + monospace label preview), Step 4 (print confirm). Step tracker top (numbered circles, active/done/pending serif styling). Elapsed timer + Reset button in header.

**What works:** Clean wizard flow. Bonbon cards show stock availability + picked count badge (pastel terracotta). Serif numbers for warmth. Review panel shows actual label output (monospace, dashed dividers). Price override inputs on Step 2.

**What's broken / clunky:** Step 1 buttons massive (90px min-width) — awkward for "Other" alongside numeric input. Step 2 bonbon grid TIGHT (gap-3, aspect-square tiny cards) — hard to hit +/- on tablet. Border radius inconsistent (4px sections, 2px buttons, 999px step circles). Bonbon stock text shows "Out of stock" + "X in shop" at 10.5px — redundant when stock zero. Label preview hardcoded placeholder ("Dulceria · Pralinenauswahl", "Charge: C-{batchStamp()}") — doesn't pull real allergen data yet (TODO comments admit this). Elapsed timer at 11px tabular-nums — hard to read.

**Data state:** Mostly real. Products filtered by `includedInCustomBoxes` + category. Stock from `useProductLocationTotals`. Variant + composition wired but allergens + real weight not yet live ("next commit").

**Recent DS retrofits:** None. Legacy PageHeader. `btn-primary`/`btn-secondary` utils. No Tabler icons used. Inline serif throughout.

**Severity flags:** 🟡 NEEDS WORK — button sizing, touch targets; allergen TODO acceptable as placeholder.

---

## /shop/daily-count

**File:** `src/app/(app)/shop/daily-count/page.tsx`

**What it shows:** Two-tab interface. Tab 1 (Variants & singles): variant size rows + manual single-product sales entry (product select + qty + price inputs, additive). Tab 2 (Bonbon count): table with columns Product | Start | Sold(T1) | Expected | Counted | Variance | Reason. Category chips above both tabs. Summary footer (pcs sold, revenue, products counted).

**What works:** Tab architecture clear. Variant rows show composition breakdown (X pcs · Y products). Variance auto-calculates + color-codes (red sold, green found, gray zero). Reason dropdown only appears when variance != 0 + adapts to sign. Market event auto-tagging is thoughtful.

**What's broken / clunky:** Category chips styled differently from tabs (different padding/border). Variant price override placeholder shows €X.XX, input `step="0.01"` allows cents but no rounding validation. Bonbon count table no row striping — tbody blends into bg-card. "Sold (T1)" column blank if qty=0 — inconsistent with Expected which shows a number. Variance formula explained at label but not at table header. No success message besides bottom-right text label (easy to miss). Tab buttons not underlined when active — relies on bg-foreground text-background.

**Data state:** Real. Variant compositions from `variantProducts` join. Single-product sales free-entry. Variances calculated against live stock. On save: stock adjustments + `stockTransfer` audit rows (revenue + variance with reasons).

**Recent DS retrofits:** None. Legacy PageHeader. Tabler icons (`ArrowLeft`, `Check`). Old `.input` class. Category chips styled inline.

**Severity flags:** 🟡 NEEDS WORK — row striping, zero-value display inconsistent, dull success feedback.

---

## /shop/transfer (aka transfer-in)

**File:** `src/app/(app)/shop/transfer/page.tsx`

**What it shows:** Three sections. (1) Suggestions panel — auto-generated rows where shop stock < min; product + shop/min/production totals + override qty input + Transfer button. (2) Manual transfer form — product + from/to location selects + qty + Transfer (any direction). (3) Recent transfers panel — scrollable list of last 30 with qty / direction / timestamp / reason.

**What works:** Suggestions prioritised by qty (largest first). `suggestedQty = min(want, available)` smart. Manual form allows ad-hoc moves. Override input lets operator adjust. Category filtering accessible. Error messages clear ("Only X pieces available").

**What's broken / clunky:** Suggestion rows inconsistent padding — product left-aligned, stock right-aligned, Move + input + availability wraps awkwardly on small screens. Recent transfers panel shows only 30 with no pagination — older inaccessible. Transfer button disabled state = `opacity-50` (should be `cursor-not-allowed` + darker). Manual form dense inline (flex-col gap-0.5 labels, all one line) — selects don't wrap on mobile. Qty placeholder="0" but no `> 0` validation. No success feedback beyond query invalidation.

**Data state:** Real. Suggestions from `productLocationTotals` vs `stockLocationMinimums`. Manual transfers call `moveProductStockFifo` + save `stockTransfer` row. History from `useStockTransfers` filtered to "product" entities.

**Recent DS retrofits:** None. Legacy PageHeader. No Tabler icons. All custom inline styling.

**Severity flags:** 🟡 NEEDS WORK — pagination on recent transfers; mobile layout; success feedback; qty validation should reject ≤ 0.

---

## /shop/breakage (aka stock-out)

**File:** `src/app/(app)/shop/breakage/page.tsx`

**What it shows:** Single-screen form. Reason pills (sold, tasting, gift, event_sample, staff, waste) — toggle one active. Product grid (3-col lg, 1-2 col sm) with product name + qty input per row. Notes textarea. Category chips + search above. Summary footer (total pcs, product count) + Save button. Recent log panel below showing last 30 entries.

**What works:** Reason selection clear (mutually exclusive). Product grid auto-hides zero entries. Market event auto-tagging useful. Notes field simple. Log panel shows qty + reason + notes + timestamp. Filter by category narrows list. Grid responsive.

**What's broken / clunky:** Product grid rows (3-col) squeezed on desktop — name truncates at 12.5px serif, qty input max-width 72px (tiny). No column headers — unclear what each column is at first glance. Recent log doesn't paginate or sort — just `.slice(0, 30)`. Log rows plain text without visual hierarchy. Notes says "(optional)" but no validation — blank notes saved with no notes label. Empty log state "Nothing logged yet" but doesn't say what entry types are tracked. Category chip colors don't match other pages.

**Data state:** Real. Products filtered to non-archived. Qty entries saved via `saveStockTransfer` with reason + notes — written in a loop (not batched, partial failures possible). Log filters to `STOCK_OUT_REASONS` only.

**Recent DS retrofits:** None. Legacy PageHeader. No Tabler icons. All custom inline styling.

**Severity flags:** 🟡 NEEDS WORK — product grid density, recent log UX, batch save to avoid partial failures.

---

## /shop/count (aka monthly-count)

**File:** `src/app/(app)/shop/count/page.tsx`

**What it shows:** Monthly inventory reconciliation. Table: Product | System | Count | Variance. Category chips + search above. Each row: name, read-only system stock, count input, variance (colored text + direction). Notes textarea. Save button ("Reconcile"). Summary footer (entered count, total variance pcs).

**What works:** Minimal focused UX. Variance auto-calculates + color-codes (red negative, orange found, gray zero). Input numeric-only. No wizard bloat. Notes captures reasoning. Save checks ≥1 count entered before enabling. Category + search narrow.

**What's broken / clunky:** Table lacks row striping. Variance column shows "+" for positive but "—" placeholder for uncounted (should be consistent). System column read-only text, no visual distinction. Count input `placeholder="—"` but `type="number"` doesn't render that. Save error message says "Stopped at {itemId}" but `itemId` is a UUID — should show product name. Success message shows count + variance, no clear "All good" emphatic message. No undo/confirm before live save.

**Data state:** Real. Products sorted alphabetically. System stock from `useProductLocationTotals` (store). Variances = counted - system. On save, `applyStockAdjustments` called with `itemType="product"` + reason `correction` — writes to live `productStock` table.

**Recent DS retrofits:** None. Legacy PageHeader. No Tabler icons. Custom inline styling.

**Severity flags:** 🟡 NEEDS WORK — table readability; input UX (placeholder not showing); error messaging (show name, not UUID); confirm dialog before live save.

---

# Customers space

## /customers

**File:** `src/app/(app)/customers/page.tsx`

**What it shows:** Legacy PageHeader (title + description). Search input with `Search` icon. Inline "New customer" button (primary bg). Expandable inline form (name + contact). Tag-based filter pills (selected = `primary/10` bg). Sort selector (Name, Lifetime value, Last order) with pastel toggle (`text-accent-foreground on bg-accent` when active). Archive toggle. List rendering: company + tags + warning triangle for missing required fields + contact name/email in tertiary text. Right side: order count, lifetime value (EUR), days since last order. Empty state: border-dashed serif italic.

**What works:** Clean search + sort. Pre-cached analytics per customer. Tag filtering intuitive. Archive mode visible. Last order date useful context.

**What's broken / clunky:** No row-level action buttons (have to click name to drill in). Archive toggle tiny + awkward at far right. "no orders yet" message takes same space as values → jumpy columns. No bulk actions. Missing email validation warning for B2B. New customer form cramped at mobile.

**Data state:** Real. Customer counts from `useOrders`. Last-order date sorted correctly. Analytics memoised.

**Recent DS retrofits:** None — legacy PageHeader. Tabler icons (`Plus`, `Search`, `X`, `Archive`, `AlertTriangle`). All buttons bespoke `px-3 py-1.5 rounded-sm`. No DS components.

**Severity flags:** 🟡 NEEDS WORK — inline form unpolished; mobile layout breaks at 400px; no keyboard nav hints.

---

## /quotes

**File:** `src/app/(app)/quotes/page.tsx`

**What it shows:** Legacy PageHeader. Search + status dropdown (All / Draft / Sent / Won / Expired) + "New quote" primary button. Auto-expiry logic for sent quotes (runs on mount). List: quote title + customer + status label + "tight capacity" flag if `feasible=false` + "expired" tag if past `expiresAt`. Right side: sell price (EUR, 2 dp) + margin % in tertiary text. Empty state with FileText icon.

**What works:** Status filtering dropdown clear. Quote expiry handled transparently. Margin % inline for quick scanning. Customer mapping works. Status labels readable.

**What's broken / clunky:** No margin % when `marginPercent=null` (shows nothing, not "—"). Feasibility flag ("tight capacity") visually weak — low contrast. No sort by price or margin. Expiry date not shown until "expired" tag fires. No export / bulk actions. List unpaginated — slow at hundreds. "Untitled quote" fallback looks messy.

**Data state:** Real. Auto-expiry mutates DB. Margin calc placeholder (hardcoded 45% in some paths).

**Recent DS retrofits:** Legacy PageHeader only. Tabler icons (`Plus`, `Search`, `FileText`). No DS components.

**Severity flags:** 🟡 NEEDS WORK — weak feasibility indicator; no sort; quote expiry silent.

---

## /price-lists (aka /pricing/lists)

**File:** `src/app/(app)/pricing/lists/page.tsx`

**What it shows:** Legacy PageHeader (`accent="Pricing"`). "New price list" button. Two-column grid (md:grid-cols-2, gap-3). Each card: name (serif, 500, `letterSpacing: -0.012em`) + optional description (truncated 2 lines) + metadata tags (blanket discount %, valid from/to, customer count). Hover border transition. Archived section below with uppercase "ARCHIVED" label.

**What works:** Card grid clean. Metadata tags compact + informative. Active/archived split clear. Hover effect subtle but effective.

**What's broken / clunky:** No search/filter. Archived cards visually de-emphasised but clickable (opacity-70). No preview of rules or rule count on card. "New" button jumps straight to detail (no inline form / modal). No bulk delete/archive. Card borders very thin (no shadow).

**Data state:** Real. Customer counts pre-computed. Metadata raw strings.

**Recent DS retrofits:** Legacy PageHeader. Bespoke card styling. No DS components.

**Severity flags:** 🟡 NEEDS WORK — missing search; no bulk actions; need more visual hierarchy.

---

## /subscriptions

**File:** `src/app/(app)/subscriptions/page.tsx`

**What it shows:** Legacy PageHeader (`accent="Customers"`). Two-column grid of subscription template cards. Each card: template name (serif, 500) + frequency badge (top-right, uppercase, `0.12em` tracking) + metadata (piece count, cycle count, active/inactive). Inactive = `opacity-60`. Empty state serif italic. "New subscription" button.

**What works:** Card layout mirrors price-lists — familiar. Frequency badge well-positioned. Piece + cycle count scannable. Active/inactive via opacity.

**What's broken / clunky:** No sorting / filtering / search. No bulk actions. Card styling identical to price-lists (thin borders, no shadow). "New" button jumps to detail. Cycles only managed on detail page. "inactive" inline could be a badge. No count of upcoming vs past cycles.

**Data state:** Real. Templates + runs from hooks. Cycle counts pre-computed.

**Recent DS retrofits:** Legacy PageHeader. Bespoke cards. No DS components.

**Severity flags:** 🟡 NEEDS WORK — minimal UI; share a card component with price-lists.

---

# Observatory space

## /observatory (overview)

**File:** `src/app/(app)/observatory/page.tsx`

**What it shows:** Legacy PageHeader. Four KPI cards in 2×2 grid: Revenue MTD (Euro icon, € amount + prev-month delta %), Quotes open (FileText, count + "X won ever"), Batches MTD (Scale, count), Products (BarChart, count). KPI cards use `accent` prop to color icon (ok/warn). Two-column section: "Recent completed batches" (5 items, list with TrendingUp icons → /production/{id}) + "This month highlights" (2×2 stats grid). QuickActions row at bottom: 5 pill-buttons (Monthly review, Pricing, Stats, Product Cost, CSV imports).

**What works:** KPIs color-coded by trend (warn red if delta < 0, ok green if ≥ 0). Monthly delta % quick context. Recent batches link to production detail. Quick actions accessible. Stats grid compact.

**What's broken / clunky:** KPI styling bespoke (white card + border-border, serif inline, icon colors hardcoded). "Recent completed batches" has TrendingUp icon for every row — redundant. No way to refresh MTD. QuickActions styled differently from KPI buttons (muted bg vs card bg). MTD filters hardcoded. Revenue doesn't break down by channel.

**Data state:** Real. Orders, quotes, plans, products computed. Month boundaries correct. Previous-month revenue computed.

**Recent DS retrofits:** None visible. Legacy PageHeader. Bespoke KPI + DashCard + Stat components. Tabler icons. No DS StatCard.

**Severity flags:** 🟡 NEEDS WORK — KPI design custom (should use DS StatCard); inconsistent button styling; no custom date range; channel breakdown missing.

---

## /reports/sales (aka /observatory/sales)

**File:** `src/app/(app)/reports/sales/page.tsx`

**What it shows:** Back button. Legacy PageHeader. Range picker card (`rounded-[14px]`, bg-card, p-3): three preset buttons (This week, Last week, This month) + From/To date inputs + campaign indicator list if active in window. Four KPI tiles in 2×2 grid: Pieces sold, Given (tasting/gift/staff), Waste (red bg if status-alert), Revenue (orders). Products table (7 cols: Product, Sold, Tasting, Gift, Staff, Waste, Revenue). "By reason" pivot section (grid of reason breakdown). "By channel" section (Counter/event count + per-order-channel counts). Packaging consumed table (conditional). "Slow movers" section (dashed border, comma-separated names, truncated at 30).

**What works:** Date picker visible + changeable. KPI tiles color-coded (waste = alert red). Product table well-structured tabular-nums. Reason pivot shows all stock-out categories. Slow movers flags zero-movement products. Campaigns linked inline.

**What's broken / clunky:** Slow movers section shows only names — no click-through. Packaging section hidden if no data — no indication it exists. Table headers tiny (10px uppercase). "Pieces sold" tile doesn't link anywhere. Waste/Revenue columns show empty string if 0 (should be "—" or "0"). No export. Channel breakdown summary only — no per-channel product mix.

**Data state:** Real. Stock transfers, orders, items, packaging fetched. Filters by date range. `slowMovers` computed by `!productRollup.has(productId)`.

**Recent DS retrofits:** Legacy PageHeader. Tabler icons. Bespoke `Tile` component. Tables custom `bg-muted/40` header. No DS components.

**Severity flags:** 🟡 NEEDS WORK — slow movers should click-through; empty values inconsistent; no export.

---

## /reports/monthly (aka /observatory/monthly)

**File:** `src/app/(app)/reports/monthly/page.tsx`

**What it shows:** Legacy PageHeader (`accent="Reports"`). Month picker (`type="month"`). Three KPI cards: Total revenue, Orders count, Batches produced. "Revenue by channel" table (Channel, Orders, Gross, vs prev) + `DeltaPill` (▲/▼ ± %). "Margin per product (top 10)" table (Product, Qty sold, Gross, Margin %) + color-coded margin (red <30%, yellow <50%, green ≥50%). "Yield actual vs target" table (Product, Target, Actual, %) + color-coded yield (red <90%, yellow <97%, green ≥97%). "Coming next" section with bullet list (Filling waste %, Cost of waste, YoY).

**What works:** Month picker standard HTML. Revenue table shows order count per channel. Margin/yield color-coded with meaningful thresholds. Delta pills show direction. Tables well-formatted.

**What's broken / clunky:** 🔴 **Margin % is HARDCODED PLACEHOLDER** (line 364: `marginPct: stats.gross > 0 && stats.qty > 0 ? 45 : null`). No real cost-per-product calc. No granularity toggle. No sort headers. No export. "vs prev" might not be useful comparing Jan to Dec. Revenue shows "—" if prev was zero. No channel drill-down.

**Data state:** Real for revenue/yield. Margin calc STUBBED (placeholder 45%).

**Recent DS retrofits:** Legacy PageHeader. Bespoke `Kpi`, `DeltaPill`, `ReportSection`, `EmptyText`. No DS components.

**Severity flags:** 🔴 CRITICAL — Margin % hardcoded 45%. Otherwise solid but needs UI refinement.

---

## /pricing (aka /observatory/pricing)

**File:** `src/app/(app)/pricing/page.tsx`

**What it shows:** Legacy PageHeader ("Pricing & Margins"). Summary banner (rounded-sm, border-border, bg-card, p-4) showing 4 KPIs: Avg margin %, Healthy count (text-status-ok), Thin count (text-status-warn), Negative count (text-status-alert). Variant cards in list. Each card header: variant name (serif → /variants/{id}), description, avg product cost per unit + Status badge (Permanent/Active/Upcoming/Past), Products count + warning if cost data missing. Box pricing rows: box name + capacity + cost→price arrow + margin % bar (height 1, `bg-black/5` with colored fill) + % number. Shared ingredients (if comparing multiple).

**What works:** Summary KPIs clear + color-coded. Variant sort smart (active/permanent first, then by worst margin). Status badges show lifecycle. Margin bars scannable. Cost breakdown helpful.

**What's broken / clunky:** No search/filter. Cards don't show fill-rate of cost-data products (just count). Margin bars height-1 (hard to read on mobile). No way to drill into a variant's box config from this page. Shared ingredients only in /observatory/product-cost. Summary KPIs hidden if `summary.total === 0`. "Unpriced variants" hint at bottom weak styling.

**Data state:** Real. Variants filtered to those with `cpsByVariant.length > 0`. Pricing uses `latestPackagingUnitCost` (may be stale).

**Recent DS retrofits:** Legacy PageHeader. Custom Margin color map. No DS components.

**Severity flags:** 🟡 NEEDS WORK — no search/filter; margin bars too small; missing variant drill-down links.

---

## /stats

**File:** `src/app/(app)/stats/page.tsx`

**What it shows:** PageHeader "Production Stats". Time preset pills (7d, 30d, 3m, 6m, 12m, all, custom) with `bg-stone-800` active + `stone-300` border inactive. Custom date range inputs if "custom". Variant + product filter dropdowns. Clear filters link. Four KPI cards (sm:grid-cols-4): To stock (actual yield), Yield (%, color-coded green ≥98% / yellow ≥90% / red <90%), Batches, Top product. Stacked bar chart (products per month/week, granularity toggle, RECIPE_COLORS array of 10 + gray waste segment). Tooltip on hover. Product leaderboard table: product + variants + total + yield % + waste + trend label (↑Rising, →Steady, ↓Easing).

**What works:** Time presets quick + functional. Granularity toggle accessible. Chart visually rich. Tooltip shows period + product + count. Trend calc smart (recent vs previous period). KPIs color-coded by health. Leaderboard sorts by total desc.

**What's broken / clunky:** `stone-800` active pill not primary color — looks out-of-place. Active preset not prominent. Custom date inputs tiny (border-border, text-sm). Chart horizontally scrollable on mobile, no responsive scaling. Waste segment light gray — low contrast on white. Tooltip `position-fixed z-50` can be cut off by scroll. Granularity buttons also `stone-800`. Variant filter only shows variants with production history. No refresh button.

**Data state:** Real. Plans filtered `status="done"` + `completedAt`. Yield = `(actualYield ?? plannedCount) / plannedCount`. Trend window adaptive per preset.

**Recent DS retrofits:** None. Legacy PageHeader. Custom stone-color pills. Chart is 100% custom (no recharts).

**Severity flags:** 🟡 NEEDS WORK — color scheme off (stone vs primary); tooltip clip; small date inputs; waste contrast.

---

## /observatory/product-cost

**File:** `src/app/(app)/observatory/product-cost/page.tsx`

**What it shows:** PageHeader "Product Cost Analysis". Two modes: **Overview** (when `focusId` is null): search + Sort dropdown (cost asc/desc, cost/gram, name) + Product category filter dropdown + Clear filters link. Filling category chips (Ganache, Praline, Caramel, Fruit, Crunch) with toggle styling. Products list as table (#, Product, Cost/product, Cost/gram). Each row: rank + name + category badge + filling chips + `CategoryBar` (stacked horizontal bar colored by cost category) + cost (mono) + cost/gram (mono, hidden on mobile). Legend at bottom. **Analysis mode** (when `focusId` is set): Back button → Focus card with name + product-type badge + coating + mould info + rank badge. Cost figures (per product, per gram, shell/filling %). CategoryBar + breakdown legend. Similar products section (similarity score % + match indicator + name + category badge + shared chips + cost + delta vs focus + pin-to-compare). Comparison table (Metric, Focus, Compare 1-3) with rows for Cost/product, Cost/gram, Structure bar, per-category costs, shared ingredients section.

**What works:** Overview search/filter/sort comprehensive. `CategoryBar` intuitive + color-coded. Similar products ranking smart (filling categories + product category). Comparison table detailed. Similarity score percentage clear. Shell color override clever (detects dark/milk/white/ruby in coating name).

**What's broken / clunky:** Overview search free-text only (no autocomplete). Filling category filter awkward at many categories. Product category filter dropdown duplicates filtering logic. Sort dropdown small. Table header tiny (10px uppercase). "Clear filters" link subtle. Analysis-mode "All products" back-button text but goes to overview (should say "Back"). Add-compare search has autocomplete results but no clear affordance. Comparison table no "remove" button on compare columns (only text link below name). Shared ingredients only if ≥2 compared. No export.

**Data state:** Real. Product cost snapshots queried. Latest snapshot per product tracked. Margin health: healthy ≥40%, thin 40-0%, negative <0%. Similar products ranked by shared filling categories + product category match.

**Recent DS retrofits:** None. Custom `CategoryBar`. Custom color maps. No DS components.

**Severity flags:** 🟡 NEEDS WORK — filling chips should be multi-select dropdown; search needs autocomplete; comparison table remove-button hidden; mobile dense.

---

## /imports (aka /observatory/imports)

**File:** `src/app/(app)/imports/page.tsx`

**What it shows:** Legacy PageHeader (`accent="CSV"`). "New import" section: Source dropdown (Shopify orders/stock, HelloCash sales/inventory, Other) + CSV file input. Preview section (if file selected): row count + table (SKU, Qty, Unit price, Customer, Order ref, first 8 rows). If unmapped SKUs: warning box (`status-warn-edge/bg-40`) listing each + dropdown to select product. Cancel + "Confirm import" buttons. History section: past imports with filename + source + rows imported/total + timestamp + status badge (ok=green, failed=red, warn=yellow).

**What works:** New import section clear. File upload straightforward. Preview table good. Unmapped SKU resolution dropdowns functional. History shows all metadata. Status color-coded.

**What's broken / clunky:** No drag-and-drop (only file input). Source dropdown options long + ungrouped. Preview table no scroll indicator on mobile. Unmapped dropdowns show all products no search (hundreds unscrollable). Cancel button `btn-secondary` weak contrast. Confirm disabled state shows "Committing…" but no spinner. History rows don't show failure reasons. No undo UI (comment says 24h available). File input doesn't persist filename after preview closes. No progress bar.

**Data state:** Real (stub). Preview rows parsed in-browser. Unmapped SKU resolution → `externalSkuMapping`. Import logs to `csvImports` with `rowsTotal/Imported/Skipped/Failed`. Actual row-level writes STUBBED.

**Recent DS retrofits:** Legacy PageHeader. Bespoke form styling. Warning box uses CSS vars. No DS components.

**Severity flags:** 🟡 NEEDS WORK — no drag-drop; SKU dropdown needs search; no undo UI; no failure detail; no progress.

---

# Lab space

## /lab

**File:** `src/app/(app)/lab/page.tsx`

**What it shows:** Container page. Legacy PageHeader + descriptive copy. 4-tab navigation (underline style, primary border-b on active). Tabs: Experiments, Ganache calculator, Recipe calculator, Audit recipes. Active tab component renders below.

**What works:** Clean tab interface with state + URL query params. Semantic header with hierarchy.

**What's broken / clunky:** Tab styling bespoke (no DS TabNav). Overflow-x-auto on narrow viewports for tab pills, no scroll affordance. No animation on tab switch.

**Data state:** Real (experiments, fillings, ingredients).

**Recent DS retrofits:** None. Legacy PageHeader. Tabs are custom CSS.

**Severity flags:** Low — functional, just pre-DS.

### Tab: Experiments (`lab/experiments-tab.tsx`)

Dual-mode (empty state vs list). Empty state: 2 large CTA buttons (primary blue + pastel mint glassmorphism, `border-primary/20 bg-primary/5`, icon + hover chevron slide). Active state: "Brewing" section (space-y-2 list) + collapsible "Promoted to fillings" section below. Each `ExperimentCard`: title + version, chocolate type, relative date, status badges (yellow "Needs work" or green "Promoted ✓"), action buttons (Play / Pencil / GitBranch / View filling), delete X. Delete confirm inline card (destructive border/bg, yes/cancel).

**Works:** excellent empty state. Status badges semantic colors. Keyboard shortcuts (`n` to new, Esc to cancel). Auto-focus on name input. Relative dates. Archive moves items to Promoted fold.

**Broken:** delete confirm inline takes up list space. Card is tall + dense. No loading state on Create/Clone (button disabled but no spinner).

**Severity:** 🟡 — delete confirmation UX clunky.

### Tab: Ganache Calculator (`lab/ganache-calculator-tab.tsx`)

2-col layout (`lg:grid-cols-[1fr_360px]`). Left: ingredient editor table (grid header + rows, select + number inputs, % of mix, batched grams, delete X). Composition bars (6 components: label + target range + bar + %). Batch size input. Right sidebar (sticky): verdict card (severity colored border + bg, icon + label + AW estimate + shelf life + caveat), suggestions list (expandable, apply buttons), issues list (icon + message + optional fix).

**Works:** Responsive grid with sticky sidebar. Composition bars use calculated severity coloring. Verdict card hierarchy excellent. Suggestions + issues actionable. Memoised calc — no jank.

**Broken:** Composition bar faint band (`bg-muted-foreground/15`) hard to see. Missing composition warning is small `ExternalLink` icon — easy to miss. Batch size label "Make today" is jargon (should be "Batch size").

**Severity:** Low — visuals good.

### Tab: Recipe Calculator (`lab/recipe-calculator-tab.tsx`)

2-col layout (`lg:grid-cols-[260px_1fr]`). Left: category nav sidebar. Right: template header (h2 serif, summary, optional AW hint, notes list). Below: "Slots" with `SlotCard` per slot. Each: icon + role name + required label + severity badge + target range + candidate ingredient options + nested ingredient lines table. Process section if `template.steps` (numbered list with stage + temperature icon).

**Works:** Template header clean. SlotCard severity indicators clear. Ingredient picker via grouped dropdown sensible. Numbered process steps. Disabled "Add" when no candidates.

**Broken:** Severity border thin — hard to distinguish at a glance. Nested table doesn't inherit parent styling — feels disconnected. Missing composition warning same small icon — inconsistent. No batch-size scaler (absolute grams only).

**Severity:** Low — intuitive.

### Tab: Audit (`lab/audit-tab.tsx`)

Filter pills (Ganaches only, Issues (count), All fillings (count)) + Export .md button. 4 summary tiles (grid-cols-2 sm:4): "Well balanced" (green), "Tweak suggested" (yellow), "Out of band" (red), "Skipped (data)" (gray). Collapsible `AuditCard` per filling. Header: severity icon (`AlertCircle`/`AlertTriangle`/`CheckCircle2`/`FileWarning`) + name + category tag + optional AW recorded + composition % + skip reason + issue count. Expanded: composition bars, issues list, suggestions list, "Open filling →" link.

**Works:** Filter pills clean. Summary tiles color-coded backgrounds (`status-*-bg/30`). Card hierarchy good (composition bars + issues + suggestions + link). Markdown export rare + valuable.

**Broken:** AuditCard button overlay feels like it should be a card. ChevronRight rotates on expand but no `transition` declared. Composition bars locked to `sm:grid-cols-2`. "Skipped" severity has `FileWarning` icon — less intuitive than `CheckCircle2`. Missing composition warnings buried in expand.

**Severity:** 🟡 — missing composition should surface in collapsed view.

---

## /audit (aka /lab/audit)

**File:** `src/app/(app)/audit/page.tsx`

**What it shows:** Legacy iOS-glass card aesthetic (`CARD = "bg-white/70 backdrop-blur-2xl border border-white/60 rounded-[18px] p-5 shadow-[...]"`). Header serif h1 "Data audit". Summary card: if zero issues, `CheckCircle` icon + "All clean" green; else `AlertTriangle` + red + "N rows need attention". 6 collapsible `AuditGroup` sections (Variants, Products, Ingredients, Fillings, Moulds, Packaging). Each group: serif h2 + colored badge (custom color + bg per table — burgundy variants, tan products, blue ingredients, purple fillings, brown moulds, sage packaging). Expanded: list of issue items linking to fix page (`/variants/{id}#vp-{vpId}` etc.) + "Missing: [field list]" + `ChevronRight`.

**What works:** Cohesive iOS-glass aesthetic. Color-coded groups. Summary at top. Each issue clickable + deep-links to fix.

**What's broken / clunky:** iOS-glass feels dated + off-brand for production-planning. Colors hand-tuned hex codes (#9b4f48, #fdeeea), not CSS vars. Expand/collapse uses custom triangle strings ("▾" / "▸") instead of icon. Inline ternary for badge bg/border styling — messy. Groups collapsed by default unless ≤ 8 issues (magic number). Typography mix of serif + sans inconsistent. No loading states.

**Data state:** Real. Comprehensive validation across all 6 tables (category, mould, shell %, pricing, AW, shelf life, cavity weight, capacity).

**Recent DS retrofits:** Tabler icons. Everything else pre-DS. CARD constant + all styling bespoke iOS-glass.

**Severity flags:** 🟡 NEEDS WORK — legacy aesthetic; hand-tuned colors should be CSS vars; chevron icon system inconsistent.

---

# Root utilities

## /shopping

**File:** `src/app/(app)/shopping/page.tsx`

**What it shows:** Legacy PageHeader. Multiple sections by state. "Below stock threshold": table (Ingredient | On hand | Threshold | Short by | Received). "Needs ordering" (collapsible, default expanded if count ≤ 8): sub-sections per type (Ingredients, Packaging, Decoration, Other). Each item: colored dot (warn or alert) + name + category/date + action buttons (View, Ordered, delete X). "Add item" form: text input with datalist suggestions + optional category select + optional note + Add/Cancel. "Ordered — awaiting delivery" (collapsible): similar cards with Undo + Restocked. "Planned demand" (conditional): warnings alert box + shortage table grouped by vendor, each group: vendor + count + total EUR, rows (Ingredient | Short g | Buy qty + unit | Unit EUR | Subtotal | Received), expandable breakdown showing source.

**What works:** Multi-section organised + scannable. Status-warn / status-alert coloring throughout. Action buttons clear (Ordered primary blue, Undo/Restocked secondary outline). Suggestion datalist auto-recognises existing items + skips category select. Vendor grouping in planned-demand makes ordering easier. Received cell with pack/kg/g toggle flexible. Breakdown expand shows source per ingredient (transparency).

**What's broken / clunky:** Many sections = lots of vertical scroll. Below-threshold table tiny text-xs. Warning link small `ExternalLink` icon — easy to miss. `ReceiveCell` packs lots of state (unitMode, val, saving, flash) into tiny input + button + unit toggle — hard on mobile. Pending vs ordered logic confusing. Planned demand warnings truncated to 5 (+"and N more") — could hide critical issues. No "mark all as received" bulk action. Currency hardcoded EUR.

**Data state:** Real. Ingredients + packaging + decoration + shopping items with low-stock flags + order dates + planned demand from open orders + campaigns + production orders.

**Recent DS retrofits:** Tabler icons (`ShoppingCart`, `Check`, `ChevronDown`, `Plus`, `X`, `Trash2`, `AlertTriangle`). Sections use `border border-border bg-card` but no DS `Section`. `.input` class. Mix of `btn-primary`/`btn-secondary`/inline hover.

**Severity flags:** 🟡 NEEDS WORK — fragmented sections; ReceiveCell cramped; warning truncation hides items.

---

## /wall

**File:** `src/app/(app)/wall/page.tsx`

**What it shows:** Full-screen wall display (no nav, no chrome). Large serif h1 "Dulceria" (42px) + small uppercase "Workshop wall · {date}". Top-right big time (56px serif, tabular-nums). 12-column grid. Left (col-span-8): "In production" section with active plans (max 6, ordered by status). Each: serif h2 name or "Batch {batchNumber}" + status label (uppercase, small). Right sidebar (col-span-4, space-y-6): "On shift" card (flex flex-wrap, pastel terracotta-bg pills with names), "Proposals waiting" card (giant 56px number), "HACCP" card (list of cold storage units with last reading time + color-coded status: ok green, warn yellow >12h, alert red no reading, incident count if > 0).

**What works:** Zero chrome — truly full-screen. Large readable fonts for wall distance. Time/date updating live. Semantic status colors for HACCP. Staff pills pastel terracotta-bg. Grid stable + responsive.

**What's broken / clunky:** Production section hardcoded `.slice(0, 6)` — caps at 6 plans regardless. "Workshop quiet" italic serif charming but not scannable. HACCP shows time-since-reading but not actual temperature — operators see *when* not *what*. Proposals count huge but clickable-ness unclear. Card borders hardcoded CSS. On-shift pills custom inline style verbose.

**Data state:** Real. Production plans, staff shifts, replenishment proposals, cold storage units, temperature readings, HACCP incidents.

**Recent DS retrofits:** No Tabler icons in this file. Uses CSS vars + custom serif styles.

**Severity flags:** Low — purpose clear. 🟡 could show actual temperatures, more plans, clearer affordances.

---

## /settings

**File:** `src/app/(app)/settings/page.tsx` (~48KB)

**What it shows:** Tabbed interface with 8 tabs (backup, import, capacity, equipment, steps, market, printing, demo) managed by state. Extensive backup/import/export UI with spreadsheet-import components for ingredients/moulds/packaging/decorations/fillings/products. Capacity tab covers shift config + equipment utilisation. Legacy PageHeader + custom tab switchers. State management is rich: market region, currency, fill mode, facility allergens, capacity config, people, unavailability, equipment, production steps.

**What works:** Comprehensive settings hub in one route. Tabbed organisation. Import/export workflow with file handling + confirmation. Navigation guard prevents unsaved data loss.

**What's broken / clunky:** 48KB+ — massive component. Tab switching custom (no DS TabNav). Form dirty tracking only per-tab (`marketDirty`) — doesn't track other tabs. Spreadsheet import UI delegated to sub-components with own complexity. No visible preview of import contents before confirm.

**Data state:** All master data hooks (market, currency, capacity, equipment, people, unavailability, steps, allergens).

**Recent DS retrofits:** Tabler icons. dnd-kit for drag-reorder. Uses `btn-primary`, `input` class + lots of custom CSS.

**Severity flags:** 🔴 CRITICAL — file size unsustainable; should be split per-tab subpages. Dirty-state tracking incomplete.

### /settings/setup

**File:** `src/app/(app)/settings/setup/page.tsx`

Setup wizard / data-health dashboard. Header legacy PageHeader. Checklist of 8 sections (Minimum stock per product, Priority tier, Staff skills, Admin role, Physical equipment instances, Cold storage units, Market region config, Warnings count). Each: collapsible accordion (default expanded if count ≤ 8): title + description + count badge + 8-item sample list (deep-links) + "View all" if > 8.

**Works:** Excellent onboarding checklist — explains *why* each field matters. Sample items deep-link to fix pages. Count badges + collapsible groups.

**Broken:** Accordion styling custom. Each section a separate card — verbose. No "mark as done" mechanic. No progress bar showing overall setup completion. Links use `/settings#people` anchor (old pattern) — fragile.

**Severity:** 🟡 NEEDS WORK — no progress feedback; fragile anchor links.

### /settings/skills

**File:** `src/app/(app)/settings/skills/page.tsx`

Header legacy PageHeader. "Add new skill" section: text input + Add. "Assignments" section: table (sticky person column, checkboxes per skill per person + Admin checkbox). If no people, shows italic empty-state.

**Works:** Matrix UI — person rows × skill columns. Master skill list auto-curated (default 8 + union of assigned). Adding skill tags first unarchived person.

**Broken:** Header sticky but not the person column label — horizontal scroll loses context. No visual indication of default vs custom skills. No bulk operations (clone skills across people). Browser-default checkboxes. Input `maxWidth: 320` arbitrary. Admin column should be in person row header, not in matrix.

**Severity:** 🟡 NEEDS WORK — table UX breaks on horizontal scroll.

---

# Tabs within already-redesigned list pages

The list view itself was redesigned in Phase 4.1–4.8. These are the OTHER tabs.

## /products tabs

### Tab: Categories
- **Access:** `usePersistedFilters("products-tab")`, param `?tab=categories`
- **What it shows:** Searchable list of product categories with shell range specs (min, max, default %), usage count per category. Built with legacy `ListToolbar`, `FilterPanel`, `ArchiveFilterChip`, `QuickAddForm`, `ListItemCard`. Cards show category name, shell percentage range as monospace badge, default shell percent, product usage.
- **What's broken / clunky:** Functional but uses legacy `ListItemCard`; filter panel has archive toggle only.
- **Distinct from main list:** Main list = product card grid grouped by category. This tab = flat list of category definitions with CRUD.

## /fillings tabs

### Tab: Categories
- **Access:** `usePersistedFilters("fillings-tab")`, param `?tab=categories`
- **What it shows:** List of filling categories with `shelfStable` indicator badge + usage count. Built with `ListToolbar`/`FilterPanel`/`ArchiveFilterChip`/`QuickAddForm`/`ListItemCard`.
- **What's broken / clunky:** Same pattern as products — minimal filtering, archive only.
- **Distinct:** Main = filling card grid. This = flat searchable category list with metadata badges.

## /ingredients tabs

### Tab: Stock
- **Access:** `usePersistedFilters("ingredients-tab")`, param `?tab=stock`
- **What it shows:** Table of all ingredients with live stock qty + threshold + level badge (zero/low/ok). Inline action buttons: Receive, Recount, Waste. Each opens a collapsed form with qty + notes. No pagination.
- **What's broken / clunky:** 🟡 Adjust form is cramped (8px padding, inline labels); poor mobile UX. Form state in component state (not persisted). Inline edit UI dense. Waste button triggers negative delta with no visual confirm before submit.
- **Distinct:** Main = ingredient card grid grouped by category. Stock tab = flat sortable table focused on qty management.

### Tab: Categories
- **Access:** `?tab=categories`
- **What it shows:** Searchable list of ingredient categories + usage count + archive badge. Built with `ListItemCard`/`ListToolbar`/`FilterPanel`/`ArchiveFilterChip`/`QuickAddForm`.
- **What's broken / clunky:** Minimal — same pattern as other category tabs.

## /moulds, /packaging, /variants, /collections tabs

No tabs — single-view pages (only the main list).

## /pantry/decoration tabs

### Tab: Materials (the main view)
Redesigned grid of decoration material color swatches (150px min) grouped by type. Each swatch: name, brand, product count, hex color circle, stock badge (in/low/out/ordered), archived marker. Built with `DecoSwatch`, `CategorySection`, `AddCard`.

**Broken:** Filter pills tightly spaced; Type filter uses category slug not display name in state (works but opaque). Material grid switches category ordering when archive toggled.

### Tab: Categories
- **Access:** Tab state in `usePersistedFilters("decoration-tab")`
- **What it shows:** Searchable list of decoration material type categories (e.g. cocoa_butter, lustre_dust) with usage count. `ListItemCard`/`ListToolbar`/`FilterPanel`/etc.
- **What's broken / clunky:** Nothing obvious.
- **Distinct:** Categories = type definitions.

### Tab: Designs
- **What it shows:** Searchable list of shell design techniques with apply-at stage badge (e.g. "Colour", "On mould") + archived marker. `ListItemCard`/`ListToolbar`/etc.
- **What's broken / clunky:** Nothing obvious.
- **Distinct:** Designs are decoration techniques, separate from both materials and categories.

---

# Detail pages (drill-downs from list rows)

## /products/[id]

**File:** `src/app/(app)/products/[id]/page.tsx`

**What it shows:**
- Back button, `DetailNav` (adjacent products carousel), `InlineNameEditor` title, archived badge, edit button
- Tab strip: Product | Shell | Filling History | Batches | Cost | Nutrition
- Product tab: category picker, fill mode (% / grams), shell source (ingredient or filling), shell %, coating, tags, aliases, notes, shelf life, lead time days, default mould, default batch qty, shell design steps, priority tier, custom-boxes flag, seconds-allowed flag, min stock (store/production), default VAT, default discount on seconds
- Shell tab: shell ingredient/filling + % (derived or explicit), composition breakdown, allergens
- Filling History: table of batch production history
- Batches: linked production batches (grid of batch cards with status)
- Cost: cost snapshot history, cost per unit, margin, profitability charts
- Nutrition: calculated nutrition (aggregates shell + fillings), allergen summary
- Delete confirm, duplicate panel, photo removal confirm

**What works:** Multi-tab detail with clear separation. Real-time allergen/shelf-life aggregation from fillings. Navigation guard. Shell % auto-derives from mould when in grams mode. Cost/nutrition tabs use hooks for live data.

**What's broken / clunky:**
- 🟡 Photo upload inline — no preview, raw `FileReader`, embeds as data URI (not CDN)
- 🟡 Tag & alias inputs ad-hoc "input + add button" — not a modern tag input
- 🟡 Save validates complex shell % constraints but error toast at tab top — users may miss
- 🟡 Duplicate panel modal overlay — intrusive
- 🟡 Filling assignment form (search + list) is a second modal on top of product modal — nested-modal confusion
- 🟡 Batch history table unpaginated — large catalogue renders 100s of rows
- 🟡 Shell design steps rendered but no visual editor — just a text array display

**Tabs inside:** Product / Shell / Filling History / Batches / Cost / Nutrition (described above)

**Data state:** Real. Pulls live fillings, shell ingredients, moulds, categories, coatings. Cost snapshots fetched. Allergens computed fresh.

**Recent DS retrofits:** Legacy PageHeader, `DsButton`, `DetailNav`/`InlineNameEditor` (custom). Tab strip custom (not DS tabbar). Save/cancel buttons custom styled divs, not `DsButton`.

**Severity flags:** 🟡 NEEDS WORK — tag/alias UX antiquated; photo no preview; duplicate modal intrusive; nested modals confusing.

---

## /fillings/[id]

**File:** `src/app/(app)/fillings/[id]/page.tsx`

**What it shows:**
- Back button, `DetailNav`, `InlineNameEditor` title, version badge (v2, v3…), archived badge, edit button
- Tab strip: Ingredients | Nutrition | Cost | History
- Ingredients: sortable table (amount, unit, supplier cost) with drag-reorder, +Add, inline remove
- Nutrition: calculated panel + allergen summary
- Cost: cost per gram, ingredient cost breakdown
- History: version chain (branching, forking, root id), prior versions with link, fork panel (fork with notes), delete-impact modal
- Edit form (read mode): category, status, shelf-life weeks, water activity (Aw), description, instructions
- Used-In panel: list of products using this filling
- Delete confirm, Archive confirm (cascade impact modal), Fork panel

**What works:** Clean ingredient drag-reorder via dnd-kit. Allergen computation. Version history + fork branching (solid feature). Nutrition aggregation.

**What's broken / clunky:**
- 🟡 Add-ingredient form is a custom popup/slide panel — no standard dialog
- 🟡 Water activity (Aw) field 0–1 numeric, no label guidance
- 🟡 Category picker custom combobox, not standard
- 🟡 Fork impact modal shows products but doesn't explain what "fork" means to each (will old refs hold?)
- 🟡 Ingredient reorder drag-only; no cut/paste or arrow buttons for a11y

**Tabs inside:** Ingredients / Nutrition / Cost / History.

**Data state:** Real. Allergens live. Version IDs may be stale if history pruned.

**Recent DS retrofits:** `DetailNav`, `InlineNameEditor`, `UsedInPanel` (custom). Tab strip custom. Add-ingredient custom modal.

**Severity flags:** 🟡 NEEDS WORK — ingredient add/edit UX cramped; Aw field needs guidance; fork explanation missing.

---

## /ingredients/[id]

**File:** `src/app/(app)/ingredients/[id]/page.tsx`

**What it shows:**
- Back button, `DetailNav`, `InlineNameEditor`, archived badge, edit button
- Edit form (always visible): manufacturer, brand, vendor, source, category, cost/qty/unit, allergens (tag checkboxes from `COMPOSITION_FIELDS`)
- Tab strip: Details | Composition | Ingredients | Allergens | Pricing | Nutrition | Shell | Stock
- Details: read-only metadata
- Composition: form fields for cacao fat, sugar, milk fat, water, solids, other fats, alcohol (%), running total + validation
- Ingredients: (unused? links to products using this ingredient)
- Allergens: checkboxes for each allergen
- Pricing: purchase price history (expandable), add new purchase, delete entry with confirm
- Nutrition: calculated panel + allergen summary
- Shell: shell capability flags, density, melting point (if applicable)
- Stock: `StockStatusPanel` (custom), stock location minimums
- Delete confirm, Archive/Unarchive toggles

**What works:** Composition fields clearly laid out with running total. Price history expandable + dated. Allergen checkboxes inline. Navigation guard. Comprehensive tabs.

**What's broken / clunky:**
- 🟡 Edit form ALWAYS open — no Edit/View toggle. Space hog on read-only view
- 🟡 Composition labels (cacao fat etc) unclear to non-chemists — no tooltips
- 🟡 Allergen checkboxes in grid, not tags. Hard to remove multiple at once
- 🟡 Price history table plain + cramped; no currency symbol in header
- 🟡 Shell tab mentions but doesn't fully expose shell-specific fields
- 🟡 Stock tab `StockStatusPanel` unclear what actions it provides

**Tabs inside:** Details / Composition / Ingredients / Allergens / Pricing / Nutrition / Shell / Stock.

**Data state:** Real. Composition stored + fetched. Price history queried separately.

**Recent DS retrofits:** `InlineNameEditor`, `DetailNav`, `UsedInPanel` custom. Tab strip custom. Stock panel custom.

**Severity flags:** 🟡 NEEDS WORK — edit form always open; composition labels lack guidance; allergen UX checkbox not tag.

---

## /moulds/[id]

**File:** `src/app/(app)/moulds/[id]/page.tsx`

**What it shows:**
- Back button, `DetailNav`, `InlineNameEditor`, archived badge, edit button
- Edit form: photo upload (raw file input, no preview), product number, brand, cavity weight (g), number of cavities, filling grams/cavity (auto-derived from weight or manual), quantity owned, notes, tags (comma-separated)
- View mode: read-only display, photo preview if set, used-in panel
- Delete confirm, Archive/Unarchive toggles

**What works:** Simple focused detail view. Auto-derives filling grams from cavity weight via `FILL_FACTOR`. Navigation guard. Used-in panel.

**What's broken / clunky:**
- 🟡 Photo upload: `<input type="file" />`, no drag-drop, no preview before save, FileReader embeds as data URI (not CDN)
- 🟡 Tags: manual comma-edit text field, not tag component
- 🟡 Edit doesn't toggle inline — launches side panel or full re-render
- 🟡 Filling grams derivation invisible to user (cavity weight changes don't auto-update display)

**Tabs inside:** None.

**Data state:** Real.

**Recent DS retrofits:** `DetailNav`, `InlineNameEditor`. Edit form custom. No DS components.

**Severity flags:** 🟡 NEEDS WORK — photo upload UX basic; tags text field.

---

## /packaging/[id]

**File:** `src/app/(app)/packaging/[id]/page.tsx`

**What it shows:**
- Back button, `DetailNav`, `InlineNameEditor`, archived badge, edit button
- Edit form: capacity (units), manufacturer, low-stock threshold, lead time days, packing time per unit, default VAT %, notes
- View mode: read-only, `StockStatusPanel` (custom), order history table (date, qty, supplier, price/unit, invoice)
- +Add Order form: date, qty, price per unit, supplier dropdown, notes, VAT %, invoice link, "update default" checkbox
- Delete order confirm, Delete packaging confirm, Archive/Unarchive toggles

**What works:** Order history clear + dated + shows supplier. Inline order add/remove without modal. Navigation guard. Low-stock threshold + lead time useful.

**What's broken / clunky:**
- 🟡 Edit form doesn't toggle — always visible or full re-render
- 🟡 Order form inline below table, cramped; no collapsed state for many orders
- 🟡 VAT fields plain text input, no validation/format hint
- 🟡 Supplier dropdown probably dynamic from all orders, not a managed vendor list
- 🟡 Invoice field plain text, not file upload or link picker

**Tabs inside:** None.

**Data state:** Real.

**Recent DS retrofits:** `DetailNav`, `InlineNameEditor`, `StockStatusPanel` custom.

**Severity flags:** 🟡 NEEDS WORK — edit doesn't toggle; order form cramped; VAT validation missing.

---

## /variants/[id]

**File:** `src/app/(app)/variants/[id]/page.tsx`

**What it shows:**
- Back button, `DetailNav`, `InlineNameEditor`, status badge (Active/Upcoming/Past/Standard), edit button
- Edit form: name, description, start date, end date, notes, labels (tag add/remove), aliases (tag add/remove), kind (curated/seasonal), VAT rate %
- Tab strip: Overview | Products | Packaging | Pricing
- Overview: read-only summary + related counts
- Products: grid/list of products in variant, +Add search (autocomplete), -Remove confirm per product
- Packaging: grid of "boxes" (variant packaging configs): name, sell price, margin %, margin health color bar, channel pricing overrides (B2B/Shop/Event/Online), cost breakdown. +Add Box form: packaging picker, sell price, channel overrides, product qty per variant product. Edit box form (click card). Pricing history per box (expandable list of snapshots).
- Pricing tab: pricing snapshots timeline, margin health, cost-to-sell comparison
- Delete confirm, Duplicate button

**What works:** Multi-tab detail. Products/packaging management via embedded search. Pricing snapshot history. Margin health color-coded. Navigation guard.

**What's broken / clunky:**
- 🟡 Edit mode toggles entire page — save/cancel hidden until edit mode; no inline field editing
- 🟡 Labels & aliases manual add/remove buttons, not tag component
- 🟡 +Add Box form cramped: packaging picker + sell price + 4 channel fields + product qty pickers in grid
- 🟡 Pricing history per-box expandable text links, not visual timeline
- 🟡 Channel prices (B2B/Shop/Event/Online) no legend — unclear which is default
- 🟡 Product qty pickers in add-box form inline numeric inputs, easy to miss

**Tabs inside:** Overview / Products / Packaging / Pricing.

**Data state:** Real. Pricing snapshots queried + cost aggregation computed.

**Recent DS retrofits:** `DetailNav`, `InlineNameEditor`. Tab strip custom. Add/edit forms custom.

**Severity flags:** 🟡 NEEDS WORK — edit mode all-or-nothing; add-box form cramped; channel price legend missing.

---

## /pantry/decoration/[id]

**File:** `src/app/(app)/pantry/decoration/[id]/page.tsx`

**What it shows:**
- Back button, `InlineNameEditor`, archived badge, edit button
- Edit form: type dropdown (cocoa_butter, lustre, transfer…), cocoa butter subtype (if type=cocoa_butter), color picker (hex input or palette), manufacturer, vendor, source, notes
- View mode: read-only, color swatch (circle with hex bg), used-in panel
- Delete confirm, Archive/Unarchive toggles

**What works:** Color picker well-integrated (hex input + live preview circle). Type-dependent conditional fields. Navigation guard. Used-in visible.

**What's broken / clunky:**
- 🟡 Edit form doesn't toggle
- 🟡 Type dropdown plain select, no icons/colors to distinguish types
- 🟡 Manufacturer/vendor/source/notes plain text, no autocomplete/validation
- 🟡 Color picker hex-only — no palette or eyedropper
- 🟡 Form layout vertical stack — takes a lot of vertical space

**Tabs inside:** None.

**Data state:** Real.

**Recent DS retrofits:** `InlineNameEditor`. Edit form custom.

**Severity flags:** 🟡 NEEDS WORK — edit doesn't toggle; color picker minimal.

---

# Cross-cutting findings

**1. Two design languages in active use today.**
- New `.ds` design system (white card + thin colored left border + serif h2 + DS components): live on `/workshop`, `/dashboard`, `/campaigns`, all pantry list pages, sidebar.
- Legacy iOS-glass (`bg-white/70 backdrop-blur-2xl` + pastel `--accent-*-bg` fills + custom serif headers + bespoke `Tile`/`Kpi` components): live on `/orders`, `/picking`, `/stock`, `/production-brain/*`, `/plan` day/pivot/month, all of `/shop/*`, `/customers`, `/quotes`, `/price-lists`, `/subscriptions`, `/observatory`, `/reports/*`, `/pricing`, `/stats`, `/observatory/product-cost`, `/imports`, `/lab/*`, `/audit`, `/shopping`, `/wall`, `/settings*`.

**2. Detail pages are universally pre-DS.** Every `[id]` route uses `InlineNameEditor` + `DetailNav` + custom tab strip + custom edit form. None use DS `PageHeader`, `Section`, `StatCard`, `DsButton`. Photo uploads embed as data URI — no CDN/preview. Tag inputs are ad-hoc text+button patterns.

**3. KPI tiles are inconsistent across the app.** Five flavors observed: DS `StatCard` (new); pastel `Tile` with `--accent-*-bg` fill (observatory, reports/sales); iOS-glass card with serif text (campaigns/[id] before retrofit); bespoke `Kpi`/`DashCard` (observatory, reports/monthly); inline `<div>` with custom styles (everywhere else). Should consolidate to `StatCard`.

**4. Tab strips are all bespoke.** No DS `TabNav` component exists. Each page reinvents the underline-active-state pattern with subtle variations (rounded-full pills vs underline border-b vs colored bg). Worth shipping one DS `TabNav`.

**5. Forms lack validation feedback.** Most save buttons disable on empty but show no inline error states. Success messages are bottom-right text labels easy to miss. Several pages still missing toast/notification systems.

**6. History/log lists truncate without pagination.** `/shop/transfer`, `/shop/breakage`, `/shop/count`, `/shopping`, `/audit`, products detail (batch history) all `.slice(0, 30)` or similar — older data inaccessible.

**7. Critical placeholder bugs.**
- 🔴 `/reports/monthly` margin % hardcoded `45` (line 364).
- 🔴 `/settings/page.tsx` is 48KB+ — needs splitting into per-tab subroutes.
- 🔴 `/production-brain` hub is bare redirect — no landing or wayfinding.

**8. `/observatory/product-cost` is the only page with real cost-comparison UX.** `/pricing` doesn't drill in. `/reports/monthly` uses placeholder 45%. Product-cost should be the source of truth, but its UI is dense + hard to navigate on mobile.

**9. Pantry detail pages lack consistency with newly redesigned list pages.** List pages now use DS `PageHeader` + `CategorySection` + `ProductCard`/`FillingCard`/etc. Detail pages still use `InlineNameEditor` + legacy tabs + custom edit form. The visual mismatch is jarring after clicking a card.

**10. Schema-blocked items found in code:**
- Workshop elapsed timer needs `startedAt` column on `productionDayLineItems` (audit confirms not present).
- Mould drying state needs new enum / state in `mouldPoolInstances`.
- HACCP calibration checks need new `calibrations` model.
- Margin % in `/reports/monthly` needs real cost-per-product calc (not placeholder).

---

# Suggested next-chain redesign order

1. **/reports/monthly margin fix** — 🔴 placeholder bug shipping live numbers.
2. **/production-brain hub** — 🔴 bare redirect; build a wayfinding landing.
3. **/settings split** — 🔴 48KB monolith; split into per-tab subroutes.
4. **/plan day/pivot/month views** — three legacy view modes after redesigned weekly.
5. **/orders, /picking, /stock** — high-traffic workshop pages still on iOS-glass.
6. **/shop/* (six pages)** — uniform shop redesign with shared toolbar/table.
7. **/observatory + /reports/sales + /pricing + /stats + /observatory/product-cost** — analytics suite.
8. **/customers + /quotes + /price-lists + /subscriptions** — customers suite.
9. **/lab + /audit + /shopping** — utility cluster.
10. **Detail pages** — `/products/[id]`, `/fillings/[id]`, `/ingredients/[id]`, `/moulds/[id]`, `/packaging/[id]`, `/variants/[id]`, `/pantry/decoration/[id]`. Build one DS detail-page template, then refit each.
11. **DS `TabNav` component** — needed everywhere with tabs.
12. **DS `Toast` / inline-error system** — needed everywhere with forms.

---

End audit.

---

## Status update — 2026-05-14

Audit findings about legacy iOS-glass chrome are now mostly **stale**. Sweep
on 2026-05-14 confirmed:

- Every page-level `*/page.tsx` under `src/app/(app)/` imports from
  `@/components/dulceria` — PageHeader / DsTabNav / Section / ListRow /
  StatusTag / DsButton / etc. are universal.
- `backdrop-blur` no longer appears in any page chrome. Remaining
  `backdrop-blur` references live only in **10 legacy modal components**
  under `src/components/`: allocation-split, temperature-log, workshop-
  actions, machine-load, transfer, surplus, packing, leftover, freeze,
  yield. Those modals still function correctly; refitting them to
  `DsDialog` / `DsDrawer` is a cosmetic-only follow-up.

### Today's shipped refits (2026-05-14)

- `/orders` — toolbar flattened, channel sections wrap in `Section`
  noBody, "New order" uses `DsButton`. Tabs migrated to `DsTabNav`
  variant=pills.
- `/picking` — bespoke rounded-full tab strip → `DsTabNav` pills;
  PackTab + BoxTab outputs wrapped in `Section` with count action.
- `/production` (list) — per-day iOS-glass section divs → `Section`
  + `StatusTag` (day-status + Today chip); capacity chip moved to
  Section action; batches render as `ListRow`; delete confirm via
  `DsDialog`.
- `/stock` — bespoke rounded-full tab strip → `DsTabNav` pills;
  "Adjust stock" link moved to `PageHeader.actions`.
- `/lab/audit-tab` — Phase F.1 (covered separately in
  MEGA_PAGES_BATCH.md).

### Pages confirmed already DS-clean (no work required)

`/dashboard`, `/workshop`, `/campaigns`, `/campaigns/[id]`,
`/production-orders`, `/production-brain/*` (hub, planner, daily,
needed, equipment, haccp, manual, dashboard), `/plan` views,
`/shop/*` (six pages — counter / daily-count / transfer / breakage /
count / landing), `/customers`, `/quotes`, `/subscriptions`,
`/observatory`, `/reports/*`, `/pricing`, `/stats`, `/imports`,
`/lab/*`, `/audit`, `/shopping`, `/wall`, `/settings*`, and every
detail page (products, fillings, ingredients, moulds, packaging,
variants, decoration, orders, production).

### What's actually still open

1. **Modal DsDialog/DsDrawer migration** — ✓ shipped 2026-05-14.
   `DsModalShell` introduced; all 10 workflow modals (packing, yield,
   leftover, freeze, transfer, surplus, allocation-split, machine-load,
   temperature-log, workshop-actions) converted. Zero `backdrop-blur`
   in the src tree.
2. **Schema migrations** — ✓ batch 0089–0092 shipped 2026-05-14:
   - 0089: `planProducts.assignedPersonId` + `.varianceReason`,
     `productionPlans.issuesNotes` (wired into Plan / Wrap up steps)
   - 0090: `planStepStatus.startedAt` + `.personId` + `.pausedAt`
     (wired into Right-now card on /production-brain/daily)
   - 0091: `productionDayNotes` table (schema only — UI follow-up)
   - 0092: `calibrations` table (schema only — UI follow-up)
3. **Still open**:
   - Real cost-per-product aggregation for `/reports/monthly`
     margin (placeholder still `null`) — needs ingredient
     consumption × purchase-price walk per product
   - Equipment occupancy writes (`currentPlanId`/`occupiedSince`/
     `expectedFreeAt` columns exist; scheduler doesn't write them) —
     needs scheduler integration
4. **Resolved without schema change**:
   - `mouldPoolInstance.dryingState` — existing `currentState` enum
     (available / loaded / filled / sealed / needs-wash /
     in-deep-wash / retired / broken) maps cleanly:
     sealed = drying, available = free, loaded|filled = in-use,
     needs-wash|in-deep-wash|broken = blocked. The 3-state pool
     visualization on /production-brain/daily side rail already
     uses this mapping.
   - Day-notes UI — ✓ shipped 2026-05-14 on /production-brain/daily
     via `DayNotesStrip` (save-on-blur textarea) + new hooks
     `useProductionDayNotes` + `saveProductionDayNotes`.
   - Calibrations UI — ✓ shipped 2026-05-14 on
     /production-brain/haccp via `CalibrationsSection` (inline add
     row + ListRow history with severity tier + StatusTag outcome /
     next-due chips) + new hooks `useCalibrations` +
     `saveCalibration` + `deleteCalibration`.
4. **Workflow rebuilds** (separate specs):
   - WEEKLY_PLAN_REDESIGN_SPEC.md — 5-phase rebuild of
     `/production-brain/plan` (most views already shipped per
     handover 2026-04-30; phases 1-3 likely done, phases 4-5
     verify).
   - MANUAL_PLANNER_V2_SPEC.md — 5-phase rebuild of
     `/production-brain/manual`.
5. **Settings physical split** — `_section-impls.tsx` (~2800 LOC)
   still holds the per-tab bodies. Surface contract met (provider +
   subroutes + thin re-export files + `all-tabs.tsx` deleted); the
   physical body split is mechanical and intentionally deferred
   because the underscore-prefixed module reads as a private helper.
