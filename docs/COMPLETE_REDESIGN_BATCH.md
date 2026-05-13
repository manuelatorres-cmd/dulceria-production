# Complete redesign batch — everything not yet shipped

Single spec covering 100% of remaining production app work. Ship in continuous chain. Each phase independently shippable.

References (save mockups to `/docs/`):
- `workshop-dashboard.html`, `campaigns-redesign.html`, `pantry-redesign.html`, `sidebar-redesign.html`, `calendar-redesign.html` — already in /docs/

Reference inventory:
- `docs/SIDEBAR_INVENTORY_2026-05-13.md` (committed)
- `docs/PAGE_AUDIT_2026-05-13.md` (committed)

Already-shipped specs:
- `UNSHIPPED_REDESIGNS_BATCH.md` (sidebar + workshop dashboard + campaigns + 7 pantry pages)
- `PRODUCTION_APP_DESIGN_SYSTEM.md` (foundation)
- `MANUAL_PLANNER_V2_SPEC.md`
- `WEEKLY_PLAN_REDESIGN_SPEC.md`
- `MAIN_DASHBOARD_REDESIGN_SPEC.md`

This spec covers what's left. ~45 phases.

---

## Phase 0 — CRITICAL BUGS

Three bugs that ship before any redesign. These are not redesigns — they are wrong data / broken routes / unsustainable file size.

### Phase 0.1 — Fix `/reports/monthly` hardcoded 45% margin

File: `src/app/(app)/reports/monthly/page.tsx` (line ~364)

Current code:
```ts
marginPct: stats.gross > 0 && stats.qty > 0 ? 45 : null,
```

This ships a fake 45% margin to live UI. Replace with real cost-per-product calc.

Pull real cost from product cost snapshots (`useProductCostSnapshots` or equivalent). Aggregate cost per product for the period. Compute margin as `(gross - totalCost) / gross * 100`.

If cost data is missing for a product, show `—` not `45`. Never invent numbers.

If real cost calc isn't computable yet, set `marginPct: null` and render `—` in the UI. Better to show nothing than to lie.

Evidence on commit:
- ✓ Hardcoded 45 removed — src/app/(app)/reports/monthly/page.tsx
- ✓ Real cost calc wired — {file path}
- OR ✗ Real cost calc deferred — reason: missing data source X

### Phase 0.2 — Build `/production-brain` hub landing

File: `src/app/(app)/production-brain/page.tsx`

Currently just redirects to `/dashboard`. Replace with actual hub landing.

New page content:

```
PageHeader: "Production brain"
Meta: "Specialized planning surfaces for production work"

Grid of 6 cards (2 cols on desktop, 1 on mobile):

1. Planner (replen) → /production-brain/planner
   Icon: layout-board-split
   Description: "Drag replenishment proposals onto a 4-week grid"
   Stat: {pendingProposalsCount} pending proposals

2. Manual planner → /production-brain/manual
   Icon: edit
   Description: "Hand-compose batches in 3-zone builder"
   Stat: {draftPlansCount} drafts

3. Daily → /production-brain/daily
   Icon: calendar-event
   Description: "Single-day execution + step toggles"
   Stat: {todayBatchesCount} batches today

4. Needed vs stock → /production-brain/needed
   Icon: list-check
   Description: "Multi-order picker against current stock"
   Stat: {openOrdersCount} open orders

5. Equipment → /production-brain/equipment
   Icon: settings
   Description: "Machine loads, mould pool, cold storage"
   Stat: {activeMachinesCount} machines loaded

6. HACCP → /production-brain/haccp
   Icon: alert-triangle
   Description: "Temperature logs + incident tracking"
   Stat: {pendingHaccpCount} pending entries
   Badge: if pending > 0, show warn dot
```

Use `Section` + new `HubCard` component (see Phase 1).

### Phase 0.3 — Split `/settings` monolith

File: `src/app/(app)/settings/page.tsx` (48KB+, 8 tabs in one file)

Split into per-tab subroutes:

```
/settings           — landing page with 8 tab cards (like Production-brain hub)
/settings/backup    — backup + import section
/settings/import    — spreadsheet imports (ingredients, moulds, etc.)
/settings/capacity  — shift config + capacity
/settings/equipment — equipment list
/settings/steps     — production steps + dependencies
/settings/market    — market region, currency, fill mode
/settings/printing  — printing config
/settings/demo      — demo data tools
```

Each subroute = its own page.tsx. Extract per-tab content from the monolith.

Replace the in-page tab switcher with sidebar sub-navigation (already added in sidebar redesign — Settings is in the utility bottom group).

Keep dirty-state tracking per-page (each page has its own `useNavigationGuard`).

Evidence per file extracted:
- ✓ /settings/backup — src/app/(app)/settings/backup/page.tsx
- ✓ /settings/import — src/app/(app)/settings/import/page.tsx
- etc.

Other settings sub-routes (`/settings/setup`, `/settings/skills`) already exist — leave alone, they're separate routes that ARE working.

---

## Phase 1 — SHARED COMPONENTS

Three components used across every subsequent batch. Build first to unblock everything else.

### Phase 1.1 — `DsTabNav` component

Location: `src/components/dulceria/tab-nav.tsx`

Currently every page reinvents tabs. Build one component, use everywhere.

```tsx
interface DsTabNavProps {
  tabs: Array<{
    id: string;
    label: string;
    href?: string;  // optional — if absent, uses internal state
    count?: number; // optional badge
    badge?: "urgent" | "warn" | "ok"; // optional dot variant
  }>;
  activeTab: string;
  onChange?: (id: string) => void;
  variant?: "underline" | "pills";  // default: underline
}

<DsTabNav
  tabs={[
    { id: "all", label: "All", count: 42 },
    { id: "active", label: "Active", count: 22 },
    { id: "past", label: "Past", count: 4 }
  ]}
  activeTab="all"
  onChange={(id) => setTab(id)}
/>
```

Style — underline variant (default):
```css
.ds-tab-nav {
  display: flex;
  gap: 0;
  border-bottom: 0.5px solid var(--ds-border-warm);
}
.ds-tab {
  padding: 8px 16px;
  cursor: pointer;
  font-size: 13px;
  color: var(--ds-text-muted);
  border-bottom: 2px solid transparent;
  margin-bottom: -0.5px;
  background: transparent;
  border-left: none;
  border-right: none;
  border-top: none;
}
.ds-tab:hover { color: var(--ds-text-primary); }
.ds-tab.active {
  color: var(--ds-text-primary);
  border-bottom-color: var(--ds-tier-quarter-focus);
  font-weight: 500;
}
.ds-tab-count {
  font-size: 11px;
  color: var(--ds-text-muted);
  margin-left: 4px;
}
.ds-tab-badge {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-left: 6px;
  display: inline-block;
}
.ds-tab-badge.urgent { background: var(--ds-tier-urgent); }
.ds-tab-badge.warn { background: var(--ds-semantic-warn); }
.ds-tab-badge.ok { background: var(--ds-tier-positive); }
```

Pills variant (for filter rows): rounded-full bg-card border-warm, active = deep teal + white.

URL state support: if `href` provided per tab, use Next.js `<Link>`. Otherwise internal state via `onChange`.

### Phase 1.2 — `DsToast` + inline error system

Locations:
- `src/components/dulceria/toast.tsx`
- `src/components/dulceria/toast-provider.tsx`
- `src/components/dulceria/form-error.tsx`
- `src/hooks/use-toast.ts`

Toast system:
```tsx
const { toast } = useToast();

toast.success("Saved");
toast.error("Could not save", { description: "Network error" });
toast.warn("Stock below minimum");
toast.info("Synced 5 minutes ago");
```

Toast position: bottom-right, stacks vertically, auto-dismiss 4s for success/info, 8s for warn, sticky for error (manual dismiss).

Style:
```css
.ds-toast {
  background: var(--ds-card-bg);
  border: 0.5px solid var(--ds-border-warm);
  border-left: 3px solid;
  border-radius: 6px;
  padding: 12px 16px;
  min-width: 280px;
  max-width: 400px;
  font-size: 13px;
}
.ds-toast.success { border-left-color: var(--ds-tier-positive); }
.ds-toast.error { border-left-color: var(--ds-tier-urgent); }
.ds-toast.warn { border-left-color: var(--ds-semantic-warn); }
.ds-toast.info { border-left-color: var(--ds-semantic-info); }
```

Inline form error component:
```tsx
<FormError>Product name is required</FormError>
<FormError variant="warn">Stock will go below minimum</FormError>
```

Style: rose text (or caramel for warn), italic, 11px, with small icon prefix.

Wire `<ToastProvider>` at root layout.

### Phase 1.3 — `HubCard` component

Location: `src/components/dulceria/hub-card.tsx`

Used by `/production-brain` hub (Phase 0.2) and `/settings` landing (Phase 0.3) and potentially other landing pages.

```tsx
interface HubCardProps {
  href: string;
  icon: string;       // Tabler icon name
  title: string;
  description: string;
  stat?: string;      // optional stat line ("12 pending")
  badge?: "urgent" | "warn" | "ok";  // optional
}

<HubCard
  href="/production-brain/planner"
  icon="layout-board-split"
  title="Planner (replen)"
  description="Drag replenishment proposals onto a 4-week grid"
  stat="3 pending proposals"
  badge="warn"
/>
```

Layout:
- White card with 0.5px border
- 14px icon top-left (muted)
- Serif title (16px)
- Description (12px, italic, muted, 2 lines max)
- Stat line at bottom (11px, muted, tabular-nums)
- Optional badge dot top-right
- Hover: border becomes deep teal

---

## Phase 2 — DETAIL PAGE TEMPLATE

Biggest visual-mismatch fix. Right now list pages are redesigned but clicking through to detail uses legacy `InlineNameEditor` + custom tabs + raw forms. Build ONE template, refit all 7 detail pages.

### Phase 2.1 — Build `DsDetailPage` template

Location: `src/components/dulceria/detail-page.tsx`

```tsx
interface DsDetailPageProps {
  title: string;
  titleEditor?: ReactNode;        // optional inline title editor
  meta?: string;                  // sub-header italic
  statusBadge?: ReactNode;        // optional status pill
  
  breadcrumb?: {
    label: string;
    href: string;
  };
  
  navAdjacent?: {                 // prev/next navigation
    prev?: { id: string; label: string };
    next?: { id: string; label: string };
  };
  
  actions?: ReactNode;            // header right-side actions
  
  tabs?: Array<{
    id: string;
    label: string;
    count?: number;
  }>;
  activeTab?: string;
  onTabChange?: (id: string) => void;
  
  children: ReactNode;            // tab content
}
```

Layout:

```
PageHeader
├─ breadcrumb (small, muted, uppercase)
├─ row:
│  ├─ left: title (serif, editable) + meta + statusBadge
│  └─ right: navAdjacent (‹ prev · next ›) + actions

DsTabNav (if tabs provided)

Tab content area (children)
```

Replace `InlineNameEditor` with inline-editable title via double-click → input.

Replace `DetailNav` (the custom carousel) with simple prev/next arrows in header right.

### Phase 2.2 — Inline edit pattern

Most detail pages currently have "Edit" button that toggles entire page into edit mode. Replace with inline-edit per field.

Build `DsInlineField`:

```tsx
<DsInlineField
  label="Manufacturer"
  value={ingredient.manufacturer}
  onSave={(value) => updateIngredient({ manufacturer: value })}
  placeholder="—"
  validate={(v) => v.length > 0 || "Required"}
/>
```

Pattern:
- Read mode: shows value as text, hover shows pencil icon
- Click value → becomes input
- Enter to save, Esc to cancel
- Inline validation message below
- Toast on save

For complex fields (long text, selects, multi-tag): use `DsInlineSelect`, `DsInlineTextarea`, `DsInlineTagInput`.

### Phase 2.3 — `DsTagInput` component

Replace ad-hoc "input + add button" tag patterns across detail pages.

```tsx
<DsTagInput
  label="Aliases"
  values={product.aliases}
  onChange={(values) => updateProduct({ aliases: values })}
  suggestions={existingAliases}  // optional autocomplete
  placeholder="Add alias..."
/>
```

Pattern:
- Tags render as small pills with × to remove
- Input below to type new
- Comma/Enter creates tag
- Backspace on empty input removes last tag
- Autocomplete from suggestions

### Phase 2.4 — `DsPhotoUpload` component

Currently photo uploads embed as data URI (not CDN). Build proper upload.

```tsx
<DsPhotoUpload
  value={product.photoUrl}
  onChange={(url) => updateProduct({ photoUrl: url })}
  uploadEndpoint="/api/upload"  // wired to your CDN/storage
  aspectRatio={1}
  placeholder="Add product photo"
/>
```

Pattern:
- Empty state: dashed border, drag-drop zone, "Drop photo or click to upload"
- Drag-over: highlight border
- Uploading: spinner overlay
- Success: image preview, hover shows replace/remove buttons
- Real upload to backend, returns CDN URL

If your CDN/storage isn't set up yet, mark this component as `deferred` and use temporary data-URI fallback. Flag in commit.

### Phase 2.5 — Refit `/products/[id]`

File: `src/app/(app)/products/[id]/page.tsx`

Use `DsDetailPage` wrapper. Tabs: Product / Shell / Filling history / Batches / Cost / Nutrition.

Each tab becomes its own section, content unchanged but rendered via DS components:
- All fields → `DsInlineField` / `DsInlineSelect` / `DsTagInput`
- Photo → `DsPhotoUpload`
- Section blocks → `Section` from design system
- Tables → ListRow (where appropriate)
- Buttons → `DsButton`

Remove "Edit/Save/Cancel" page-mode toggle entirely. All fields inline-editable.

Duplicate panel → keep as modal overlay but use DS styling.

Delete confirm → use DS modal pattern.

### Phase 2.6 — Refit `/fillings/[id]`

Same pattern. Tabs: Ingredients / Nutrition / Cost / History.

Ingredients tab: keep dnd-kit drag-reorder. Wrap rows in ListRow. Add-ingredient form via `Section` + `DsButton`.

Version history fork modal: clarify "fork" — show diff of what changes for affected products.

### Phase 2.7 — Refit `/ingredients/[id]`

Tabs: Details / Composition / Ingredients / Allergens / Pricing / Nutrition / Shell / Stock.

Edit form ALWAYS open today — replace with inline-edit per field.

Composition fields: add tooltips explaining each (cacao fat, sugar, milk fat, water, solids, other fats, alcohol). Use `DsTooltip` (build if doesn't exist — simple `title` attr is fine for v1).

Allergen checkboxes → `DsTagInput` with predefined options.

Pricing tab: price history as `ListRow` with date + price + supplier. Add new = inline form.

### Phase 2.8 — Refit `/moulds/[id]`

No tabs. Single-page detail with all fields.

Photo → `DsPhotoUpload`.

Tags → `DsTagInput`.

Filling grams derivation: show inline next to cavity weight: "→ {derived} g/cavity (auto)".

### Phase 2.9 — Refit `/packaging/[id]`

No tabs. Fields + order history.

Order history → ListRow with date, qty, supplier, price.

Add order form: inline expandable section, not always-visible.

VAT field: numeric input with `%` suffix and 0-25 range validation.

### Phase 2.10 — Refit `/variants/[id]`

Tabs: Overview / Products / Packaging / Pricing.

Products tab: grid using existing `ProductCard` (smaller variant).

Packaging tab: cards for variant-packaging configs. Each card shows:
- Box name
- Sell price + channel overrides (B2B/Shop/Event/Online) as small chips
- Margin % with health-color bar
- Edit button → inline edit (not modal)

Pricing snapshot history → visual timeline (TimelineStrip component from Campaigns spec, or simple ListRow with date + cost + price + margin).

### Phase 2.11 — Refit `/decoration/[id]`

No tabs. Single-page detail.

Color picker → keep hex input + palette suggestions (small grid of recently-used colors).

Type dropdown → with icon per type.

---

## Phase 3 — WORKSHOP REMAINING

Pages not covered by previous specs. Each replaces existing legacy iOS-glass with DS.

### Phase 3.1 — `/orders` refit

File: `src/app/(app)/orders/page.tsx`

Mostly DS-compliant already. Minor cleanups:

- Replace "New order" inline form with `DsDialog` modal (cleaner separation)
- Surface unit-price resolution: show which price source was used (variant override / customer price-list / retail fallback) inline below price as 10px muted text
- Replace pastel iOS-glass card containers with white DS `Section` wrappers
- StatusTag max-2 enforcement (per design system rules)

Search + tab filter pattern stays — works well.

### Phase 3.2 — `/picking` refit

File: `src/app/(app)/picking/page.tsx`

Two tabs (Pack & ship / Box up) → use new `DsTabNav`.

Pack tab: orders as `ListRow` with status + customer + line preview + Pack button (DsButton primary on right).

Box tab: redesign row layout — currently cramped. New structure:

```
[Variant name + size (1fr)]
[Stock indicator: on-hand by location (gauge or compact text)]
[Demand: open-order qty needed]
[Can build: capped by bottleneck, with "blocked by X" if relevant]
[Qty input · destination select · Box up button]
```

Use a clear visual gauge (small horizontal bar) showing on-hand vs needed, color-coded.

### Phase 3.3 — `/production-orders` refit

File: `src/app/(app)/production-orders/page.tsx`

Group by status (pending / in_production / done / cancelled) — keep. Use `Section` per status.

Each order row → `ListRow` with:
- Title: name + channel badge (Restock/Campaign) + target location chip
- Campaign name → link to `/campaigns/[id]` (currently shallow context)
- Meta: total units + product names + due date
- Due date: convert ISO to relative ("in 3 days" / "tomorrow" / "today" / "overdue 2 days") with color
- Left border: caramel if due ≤ 3 days, urgent rose if overdue

Add search input + filter pills above (status filter as secondary filter).

### Phase 3.4 — `/stock` refit

File: `src/app/(app)/stock/page.tsx`

Tabs (products / boxes / fillings / movements) → `DsTabNav`.

Per-product groups: replace expand/collapse custom UI with `Section` (collapsible variant).

Batch rows: better visual separation. Each batch row shows:
- Batch label + mould info (1fr)
- Yield (compact, tabular)
- Current stock breakdown: store / production / freezer / allocated as small chips
- Sell-by with relative date + color (red expired, caramel <7d, default OK)
- Actions: freeze / defrost / count (icon buttons, hover shows tooltip)

Replace modal-prompt count flow with inline edit:
- Click count → inline number input
- Save with DS pattern (Enter or check button)
- Toast on success

Filter pill strip currently hidden behind `SlidersHorizontal` toggle — surface inline.

### Phase 3.5 — `/production-brain/planner` refit

File: `src/app/(app)/production-brain/planner/page.tsx`

Month calendar grid + proposals sidebar.

- Replace legacy PageHeader with DS PageHeader
- Day cells: keep drag-drop, increase min-height when needed, add "view details" click → opens day-detail drawer (same drawer as /plan)
- Tier labels (T1/T2/T3) — add tooltips explaining: T1 = critical (next 7 days), T2 = urgent (8-21 days), T3 = standard
- Add undo affordance: "Last scheduled: Lemon Bar → Tue. Undo" toast for 5s after drag
- Sidebar (proposals): add search + sort dropdown (priority / qty / needed-by)
- Replace "Engine quiet. Nothing waiting." with neutral DS empty state (Section empty state)

### Phase 3.6 — `/production-brain/daily` refit

File: `src/app/(app)/production-brain/daily/page.tsx`

Phase cards with pastel gradient backgrounds → replace with white cards + colored left borders (DS pattern).

Each phase card:
- Header: phase name (serif), step count, time estimate
- Body: list of batches in this phase as ListRow
- Footer: collective actions if relevant
- Visual "current phase" indicator: caramel left border + chip "active now" on the phase that has an in-progress step

Right rail (machines / mould pool / staff / event feed): wrap each in `Section`.

ViewDate picker: keep, restyle to match DS nav pattern (chevron buttons + "Today" pill).

### Phase 3.7 — `/production-brain/needed` refit

File: `src/app/(app)/production-brain/needed/page.tsx`

Two sections clearer:
1. Open orders list (top) — `Section` with `ListRow` per order, click to expand and see demand contribution
2. Demand aggregation table (below) — `Section` with table

Table redesign:
- Columns: Item / Needed / Packed / Planned / Net gap / Packable from loose
- Variant rows + product rows visually distinct (variants get a small "variant" chip, products get "product" chip)
- Net gap column: color-coded (mint if ≤ 0, caramel if > 0 but covered by loose, urgent rose if uncovered)
- Action column: "Schedule" button if gap > 0 → opens manual planner pre-filled with this product

Add totals row at bottom.

Add filter pills: All / With gap / Covered / Critical (urgent).

### Phase 3.8 — `/production-brain/equipment` refit

File: `src/app/(app)/production-brain/equipment/page.tsx`

Four panels → wrap each in `Section`.

Machine cards:
- Status dot top-left
- Brand + model + capacity in header
- Active load: ingredient name + remaining kg + progress bar (using DS progress)
- Aging alert: caramel chip "in machine 3d · aging" if over threshold

Replace "Coming soon" edit placeholders with actual inline forms:
- Click machine → opens drawer
- Drawer has: Load new chocolate / Drain / Mark moulds washed
- Each action via `DsButton` + inline form fields

Cold storage section: list of units with name + target range + last reading time + status dot.

### Phase 3.9 — `/production-brain/haccp` refit

File: `src/app/(app)/production-brain/haccp/page.tsx`

Two-column layout per unit (view + act) → keep but restyle.

View column:
- Unit name + type + location (serif header)
- Large temp display (28-36px tabular-nums) with in-range color
- Last reading timestamp + relative time
- Sparkline of last 20 readings (small inline chart)
- "Target: 2-8°C · check 3x/day" meta

Act column:
- Temp input (number, large font)
- Person dropdown
- Notes textarea (optional, with "(optional)" hint)
- Submit button (DsButton primary)
- Toast on save: "Reading saved · {value}°C at {time}"

Open incidents section: each incident as ListRow with:
- Unit name + start time + initial reading
- Action taken (if any)
- Resolve button → opens form (resolution notes + corrective action)

Add "+ New unit" button → form to add cold storage unit (currently missing per audit).

### Phase 3.10 — `/plan` day view refit

File: `src/app/(app)/plan/page.tsx` (when `?view=day`)

Replace legacy iOS-glass with DS pattern.

Single-day timeline view:
- Header: date picker + day summary (planned minutes / capacity / utilization %)
- Body: hour blocks (07:00–23:00) with batch chips placed by start time
- Each batch chip: product name + step + duration + status color
- Drag to reschedule
- Click to open detail drawer

### Phase 3.11 — `/plan` pivot view refit

When `?view=pivot`. Pivot table showing products × days.

- Sticky product column on left
- Day columns across top (next 14 days)
- Cells show batch chips
- Drag between cells to reschedule
- Empty cells: click to add batch

DS table styling. Replace pastel cell backgrounds with white cards + colored left borders per status.

### Phase 3.12 — `/plan` month view refit

When `?view=month`. Month grid (5 weeks × 7 days).

Similar to /calendar redesign mockup, but production-data oriented:
- Each day cell shows planned batches as chips
- Hover/click shows day summary
- Color intensity reflects utilization

Reuse calendar grid component from `calendar-redesign.html`.

---

## Phase 4 — SHOP SPACE

Six pages. Share components where possible (toolbar, count tables, transfer rows).

### Phase 4.1 — Shared shop components

Build first to reuse across all 6 shop pages:

`src/components/shop/`:
- `ShopToolbar.tsx` — category chips + search + filters bar
- `CountTableRow.tsx` — row with system stock / count input / variance
- `TransferRow.tsx` — product + qty input + destination select + button
- `RecentLogPanel.tsx` — paginated history list with status chips

### Phase 4.2 — `/shop` overview refit

File: `src/app/(app)/shop/page.tsx`

Custom inline header → DS PageHeader with status pill (Open/Closed) inline.

Destination pills (Counter / Daily count / Transfer in / Stock out) → keep as quick-action row using new `HubCard` smaller variant OR DS button group.

Left column 3 cards (Pickups today / Arriving from production / Online orders):
- Each card → `Section` with `ListRow` per item
- Pickups: customer + channel + items + time
- Arriving: product + qty + ETA
- Online: order # + customer + items + status

Right column:
- Shop stock grid: refit as 3-column visual grid of product chips
  - Each chip: product name (truncated 12 chars) + qty
  - Color border: mint (ok) / caramel (low) / rose (out) / blush (over)
  - Click chip → drawer with batch details
- Hours card: single view (compact) with edit button → opens dialog
- Remove "Label printing" placeholder card entirely (vaporware)

### Phase 4.3 — `/shop/counter` refit

File: `src/app/(app)/shop/counter/page.tsx`

4-step wizard. Keep flow, restyle.

- Step tracker (top): numbered circles in DS style (deep teal active, mint done, gray pending)
- Step 1 (size): replace 90px buttons with smaller `DsButton` group (4/8/16/other)
- Step 2 (bonbon grid): keep grid but expand cards (current aspect-square cards too tiny for +/- on tablet)
  - Each card: product image (if available, fallback letter), name, +/- buttons, picked count badge
  - Larger touch targets (min 44×44px)
- Step 3 (review): same 2-col layout, restyle label preview area as monospace block with proper Section wrapper
- Step 4 (print confirm): cleaner success state

Header: replace elapsed timer at 11px with larger tabular display (16px serif).

### Phase 4.4 — `/shop/daily-count` refit

File: `src/app/(app)/shop/daily-count/page.tsx`

Two tabs → `DsTabNav`.

Tab 1 (Variants & singles):
- Variant rows in `Section`
- Each row: name + composition info + qty input + price override
- Single-product entry: separate inline form below variants

Tab 2 (Bonbon count):
- Table with row striping (zebra)
- Columns: Product | Start | Sold (T1) | Expected | Counted | Variance | Reason
- Zero values consistent: show "0" or "—" uniformly (decision: show "0" for actual zero counts, "—" for not-yet-entered)
- Variance auto-color (rose negative, caramel positive surplus, gray zero)
- Reason dropdown only appears when variance != 0

Summary footer: `Section` with pcs sold / revenue / products counted.

Success feedback: `useToast()` on save.

### Phase 4.5 — `/shop/transfer` refit

File: `src/app/(app)/shop/transfer/page.tsx`

Three sections → `Section` per section.

Suggestions panel: `ListRow` per suggestion with:
- Product (1fr)
- Stock breakdown chips (shop X · min Y · production Z)
- Qty input + Transfer button on right

Manual transfer form: cleaner layout
- Product select (wide)
- From / To selects (with arrow icon between)
- Qty input
- Transfer button
- Validate qty > 0 inline with `FormError`

Recent transfers panel: `RecentLogPanel` (shared component from Phase 4.1) with pagination (20 per page, load more button).

### Phase 4.6 — `/shop/breakage` refit (stock-out)

File: `src/app/(app)/shop/breakage/page.tsx`

Reason pills (sold/tasting/gift/event_sample/staff/waste) → DS pill row, single-select.

Product grid: replace 3-col tight grid with 2-col `ListRow` pattern:
- Product name + category (1fr)
- Qty input on right (larger, min 80px width)
- Hide rows with qty=0 unless filter says "show all"

Column headers above grid: "Product" + "Quantity".

Notes textarea below.

Save: batch save (not loop) — if partial failure, surface specific failures via Toast.

Recent log → `RecentLogPanel` with pagination.

### Phase 4.7 — `/shop/count` refit (monthly count)

File: `src/app/(app)/shop/count/page.tsx`

Table with row striping. Columns: Product | System | Count | Variance.

Count input: replace `placeholder="—"` (doesn't render in number input) with empty state indicator inline.

System column: italic muted text + lock icon to indicate read-only.

Variance: color + direction arrow.

Save error: show product NAME, not UUID. Map back to product name from product hooks.

Confirm dialog before live save: "Apply N variance adjustments to live stock? This cannot be undone."

Success: Toast with summary.

Notes textarea wired to save with adjustment.

---

## Phase 5 — CUSTOMERS SPACE

Four pages. Share card pattern between subscriptions + price-lists.

### Phase 5.1 — `/customers` refit

File: `src/app/(app)/customers/page.tsx`

DS PageHeader.

Search + sort + archive toggle in toolbar.

Filter pills for tags (currently inline).

Customer list as `ListRow`:
- Company name + tags + warning triangle if missing required fields (1fr)
- Contact name/email in secondary (italic muted)
- Right side: order count + lifetime value (EUR, tabular) + last order relative ("2d ago" / "no orders yet")
- Hover: shows "Open →" action

"New customer" → modal (`DsDialog`), not inline expandable form.

Bulk actions: checkboxes per row + footer toolbar (archive selected, export selected) when ≥1 selected.

Empty state: serif italic centered in `Section`.

### Phase 5.2 — `/quotes` refit

File: `src/app/(app)/quotes/page.tsx`

DS PageHeader + toolbar (search + status filter dropdown + sort).

Status filter as filter pills (All / Draft / Sent / Won / Expired) with counts.

Quote list as `ListRow`:
- Quote title + customer + status label (1fr)
- Feasibility chip if `feasible=false` ("⚠ tight capacity", caramel)
- Expiry date if soon (within 7 days): caramel chip
- Expired: rose strikethrough or gray opacity
- Right side: sell price (EUR, 2dp, tabular) + margin %
- Click row → opens quote detail

Add sort dropdown: by date / price / margin / customer.

Pagination (50 per page).

Empty state: serif italic in Section.

"New quote" → modal or navigate to `/quotes/new` (whichever exists).

### Phase 5.3 — `/price-lists` refit

File: `src/app/(app)/pricing/lists/page.tsx`

DS PageHeader.

Search above grid.

Card grid (2-col on desktop, 1 on mobile).

`PriceListCard` (new component):
- Name (serif, larger)
- Description (italic muted, 2 lines max)
- Metadata chips row: discount % + valid from/to + customer count
- Rule count chip (if data available): "12 rules"
- Hover: border highlight
- Click: opens detail

Archived section below with "Archived" subhead, cards at 60% opacity.

"New price list" → modal (`DsDialog`) with quick fields, then navigate to detail for full edit.

### Phase 5.4 — `/subscriptions` refit

File: `src/app/(app)/subscriptions/page.tsx`

Same pattern as `/price-lists` (share `PriceListCard`-like component named `SubscriptionCard`):

- Template name (serif)
- Frequency badge top-right (uppercase: "MONTHLY" / "WEEKLY" / etc.)
- Metadata: piece count + cycle count + active/inactive
- Upcoming vs past cycles count
- Card opacity 60% if inactive

Sort + search + filter (active/inactive).

"New subscription" → modal.

---

## Phase 6 — OBSERVATORY / ANALYTICS SUITE

Seven pages. Share `StatCard` + chart patterns.

### Phase 6.1 — `/observatory` overview refit

File: `src/app/(app)/observatory/page.tsx`

DS PageHeader.

Four KPI cards in 2×2 grid → replace bespoke KPIs with `StatCard`:
1. Revenue MTD — value + previous-month delta (color: mint up / rose down)
2. Quotes open — count + "X won ever" sub
3. Batches MTD — count
4. Products — count

No pastel fills. White cards with colored left borders by health.

Two-column body section:
- Left: "Recent completed batches" → `Section` with `ListRow` per batch (last 5)
- Right: "This month highlights" → 2×2 stat grid inside `Section`

Quick actions row → `HubCard` group (5 cards):
- Monthly review → /reports/monthly
- Pricing → /pricing
- Stats → /stats
- Product Cost → /observatory/product-cost
- CSV imports → /imports

Add date range picker top-right for cross-page filter (currently MTD hardcoded).

### Phase 6.2 — `/reports/sales` refit

File: `src/app/(app)/reports/sales/page.tsx`

DS PageHeader + back button.

Date range card → DS pattern (Section with three preset buttons + From/To inputs).

Four KPI tiles (Pieces sold / Given / Waste / Revenue) → `StatCard` with colored borders:
- Pieces sold: default
- Given: blush border
- Waste: rose border + warn icon if waste > threshold
- Revenue: mint border

Products table: better column hierarchy, sticky header on scroll, sort by column (click header).

Reason pivot section → grid of `StatCard` per reason category.

Channel breakdown: pie chart (recharts) + per-channel order list inside `Section`.

Slow movers section: clickable list — each name links to `/products/[id]`.

Export button (top-right): CSV export of full report.

### Phase 6.3 — `/reports/monthly` refit

File: `src/app/(app)/reports/monthly/page.tsx`

(Margin fix already shipped in Phase 0.1.)

Month picker → DS pattern.

Three KPI cards → `StatCard`.

"Revenue by channel" table: sortable columns, DeltaPill component restyled to DS.

"Margin per product (top 10)" table: sortable, click product to drill into cost.

"Yield actual vs target" table: sortable, click product to see batch history.

Remove "Coming next" placeholder section (or replace with actual roadmap if maintained).

Export button.

### Phase 6.4 — `/pricing` refit

File: `src/app/(app)/pricing/page.tsx`

DS PageHeader.

Summary banner: 4 KPIs as compact `StatCard` row.

Search + filter toolbar (variant status / cost data availability).

Variant cards (list view):
- Header row: name (serif, link to `/variants/[id]`) + description + status badge + cost meta
- Box pricing as inner list:
  - Box name + capacity → cost → price → margin% bar (taller, 4px not 1px)
  - Margin bar: full-width inside card, color-coded
- Shared ingredients section if comparing
- "Open variant →" link in card footer

Sort by margin (worst first by default).

### Phase 6.5 — `/stats` refit

File: `src/app/(app)/stats/page.tsx`

DS PageHeader.

Time preset pills → DS pills (replace stone-800 with deep teal).

Custom date range inputs (when "custom"): DS inputs.

Variant + product filter dropdowns: top of section.

Four KPI cards → `StatCard`:
- To stock (actual yield)
- Yield %
- Batches
- Top product

Stacked bar chart → swap custom impl for recharts. Use brand colors.

Tooltip: position smart (avoid clip).

Product leaderboard table: sortable columns, trend label as colored chip.

### Phase 6.6 — `/observatory/product-cost` refit

File: `src/app/(app)/observatory/product-cost/page.tsx`

DS PageHeader.

Overview mode toolbar: search (with autocomplete) + sort dropdown + filter dropdowns.

Filling category filter: replace toggle chips with multi-select dropdown for many categories.

Products table:
- Sortable columns
- CategoryBar component restyled to DS palette
- Cost / Cost-per-gram as tabular-nums
- Click row → analysis mode

Analysis mode:
- Focus card: serif name + status + cost figures via `StatCard`
- CategoryBar + legend
- Similar products section: `ListRow` per match with similarity %, delta, pin button
- Comparison table: 4 columns max (Focus + up to 3 compare), each compare column has remove button (X) in header
- Shared ingredients section: `Section` with chip list

Export button.

### Phase 6.7 — `/imports` refit

File: `src/app/(app)/imports/page.tsx`

DS PageHeader.

New import section in `Section`:
- Source dropdown (grouped: Shopify / HelloCash / Other)
- File input → drag-drop zone (DsPhotoUpload pattern but for CSV)
- Show filename + size after select

Preview section (if file selected): row count + table preview + unmapped SKUs warning.

Unmapped SKU resolution: each row has searchable product dropdown (not full unscrollable list).

Confirm button: shows progress bar during import.

History section: `ListRow` per past import with:
- Filename + source + timestamp (1fr)
- Status chip (ok / warn / failed)
- Rows: imported/total
- Click row → drawer with failure details if failed
- Undo button if within 24h window

---

## Phase 7 — LAB + UTILITIES

### Phase 7.1 — `/lab` container refit

File: `src/app/(app)/lab/page.tsx`

DS PageHeader.

Tab strip → `DsTabNav` (Experiments / Ganache calculator / Recipe calculator / Audit).

URL state via `?tab=`.

### Phase 7.2 — `/lab` Experiments tab refit

File: `src/components/lab/experiments-tab.tsx` (or wherever)

Empty state: keep large CTAs but restyle with `HubCard` pattern.

ExperimentCard: replace with `ListRow` variant:
- Title + version + chocolate type + date (1fr)
- Status badges (caramel "Needs work" / mint "Promoted ✓")
- Action buttons (Play / Edit / Branch / View) as icon group on right
- Delete via × → confirm via `DsDialog` modal (not inline)

Keep keyboard shortcuts.

### Phase 7.3 — `/lab` Ganache Calculator tab refit

Layout stays 2-col.

Left: ingredient editor → wrap in `Section`, use `ListRow` per ingredient row.

Composition bars: more visible (height 6px, not faint). Color-coded by severity.

Right sidebar (sticky):
- Verdict card → use `Section` with colored left border by severity
- Suggestions list as collapsible `ListRow` items
- Issues list as `ListRow` with icon prefix

Batch size: rename "Make today" → "Batch size (g)".

Missing composition warning: surface as inline `FormError` warn, not small icon.

### Phase 7.4 — `/lab` Recipe Calculator tab refit

Layout 2-col stays.

Left sidebar: category nav as DS list.

Right:
- Template header: serif h2 + summary + optional AW hint + notes
- SlotCard: redesign with clearer severity borders (3px not thin)
- Nested ingredient table: inherit parent card styling (use nested `ListRow` not bare table)

Add batch-size scaler input (currently absolute grams only).

### Phase 7.5 — `/lab` Audit tab refit

Filter pills via DS pill row.

4 summary tiles → `StatCard`:
- Well balanced (mint)
- Tweak suggested (caramel)
- Out of band (rose)
- Skipped (gray)

AuditCard → use `ListRow` collapsible variant:
- Header: severity icon + name + category tag + AW + composition % + issue count
- Collapsed: only shown for "well balanced"; others auto-expand
- Expanded: composition bars + issues + suggestions + "Open filling →" link
- ChevronRight rotates on expand with CSS transition

Missing composition warnings: surface in collapsed view too (with rose icon).

Export .md button → `DsButton` secondary.

### Phase 7.6 — `/audit` refit

File: `src/app/(app)/audit/page.tsx`

(Note: `/audit` is the standalone page; `/lab/audit` tab is different.)

DS PageHeader.

Replace iOS-glass cards entirely.

Summary card: large status indicator (CheckCircle mint or AlertTriangle rose) + count + summary text. Use `Section` with colored left border.

6 groups (Variants / Products / Ingredients / Fillings / Moulds / Packaging):
- Each as `Section` with collapsible header
- Header: name + count badge (colored per severity)
- Hand-tuned hex colors → DS CSS vars
- Issue items as `ListRow` with deep-link to fix page
- ChevronRight icon (not "▾" / "▸" strings)

Groups auto-expand if count ≤ 10 (less arbitrary).

### Phase 7.7 — `/shopping` refit

File: `src/app/(app)/shopping/page.tsx`

DS PageHeader.

Multiple sections → each in `Section` with serif header + count badge.

"Below stock threshold" table: `ListRow` per item.

"Needs ordering" section: per-type sub-sections:
- Ingredients
- Packaging
- Decoration
- Other

Each item as `ListRow`:
- Dot indicator (caramel warn / rose alert)
- Name + category/date (1fr)
- Action buttons: View / Ordered / Delete (icon group)

Add item form: inline expandable `Section` (not always visible).

"Ordered — awaiting delivery" section: similar `ListRow` with Undo / Restocked actions.

"Planned demand" section:
- Vendor group headers in `Section`
- Items as `ListRow` with: ingredient / short qty / buy qty + unit / unit € / subtotal / Received cell
- Received cell: number input + unit toggle (kg/g/pack) with clearer affordance
- Remove .slice(0, 5) truncation — show all warnings with pagination

Add "Mark all as received" bulk action.

### Phase 7.8 — `/wall` refit (workshop TV display)

File: `src/app/(app)/wall/page.tsx`

Full-screen display, no nav. Restyle for clarity at distance.

- Increase plan limit from 6 to dynamic (fits available space)
- HACCP cards: show actual temperatures + last reading time + in-range status (not just "when")
- Proposals waiting: keep big number but add subtitle "click to open" with link
- Staff pills: keep terracotta but use DS bg var (--ds-tier-active)
- Workshop status: "Active" or "Quiet" inline as colored chip

Auto-refresh every 30s (already there, verify).

### Phase 7.9 — `/settings` landing refit

(Settings monolith already split in Phase 0.3. This phase styles the landing page.)

File: `src/app/(app)/settings/page.tsx` (now thin)

DS PageHeader.

Grid of 8 `HubCard` (or extended Section grid):
- Backup
- Import
- Capacity
- Equipment
- Steps
- Market
- Printing
- Demo

Each card: icon + title + 1-line description + optional stat ("12 people configured").

### Phase 7.10 — `/settings/setup` refit

File: `src/app/(app)/settings/setup/page.tsx`

DS PageHeader.

Overall progress bar at top: "{done}/8 sections complete".

8 sections as `Section` with collapsible header:
- Title + description + count badge
- Sample list as `ListRow` items
- Deep-links use clean routes (not `/settings#people` anchors — link to per-tab subroutes from Phase 0.3)
- "Mark as done" button per section → stores in user settings

### Phase 7.11 — `/settings/skills` refit

File: `src/app/(app)/settings/skills/page.tsx`

DS PageHeader.

"Add new skill" section: `Section` with text input + Add button.

Assignments matrix:
- Sticky person column (left) AND sticky person row header for horizontal scroll
- Checkboxes → use `DsCheckbox` (consistent style)
- Default vs custom skills: visually distinguish (default = caramel left border on column header, custom = default)
- Admin column moved out of matrix to person row metadata
- Add bulk operations: "Copy skills from another person" dropdown per row

---

## Phase 8 — TABS WITHIN ALREADY-REDESIGNED LIST PAGES

These are tabs that exist on already-redesigned pantry pages. Quick refits.

### Phase 8.1 — `/products` Categories tab

Use `DsTabNav` to switch between main grid and Categories.

Categories tab:
- Search + filter via `ShopToolbar` (or new pantry toolbar)
- Category list as `ListRow`:
  - Name + shell range + default % + usage count
  - Edit inline via `DsInlineField` for the range fields
  - Archive toggle
- "+ New category" form as inline `Section`

### Phase 8.2 — `/fillings` Categories tab

Same pattern as Products Categories. Add `shelfStable` indicator badge per row.

### Phase 8.3 — `/ingredients` Stock tab

Currently has Receive / Recount / Waste inline forms. Improve UX:

- Each ingredient row: name + current stock + threshold + level badge
- Action buttons (Receive / Recount / Waste) as icon group
- Click action → drawer (not inline cramped form)
- Drawer has qty input + notes + submit
- Confirm before negative adjustments (waste with notes required)

### Phase 8.4 — `/ingredients` Categories tab

Same pattern as Products Categories.

### Phase 8.5 — `/decoration` Categories tab

Same pattern as Products Categories. Type definitions list.

### Phase 8.6 — `/decoration` Designs tab

Shell design techniques.

Same `ListRow` pattern with:
- Name + "apply at" stage badge (Colour / On mould / etc.)
- Archived marker
- Edit inline

---

## SHARED REQUIREMENTS

Every phase must follow these.

### Design system

- White card backgrounds, page bg `#fbf6f1`
- 0.5px border-warm `#e8e3d6`
- Tier accents only on LEFT BORDERS (2-3px): caramel, deep teal, blush, rose, mint
- NO pastel-filled card backgrounds
- NO gradients, NO drop shadows
- Serif headers: Playfair Display
- Body sans: system stack
- Sentence case throughout
- Tabler outline icons only
- Italic muted for secondary meta
- Tabular-nums for numbers
- Replace all `bg-white/70 backdrop-blur-2xl` iOS-glass → white DS cards
- Replace all `--accent-*-bg` pastel fills → white card + colored border

### Data handling

- For missing data: show `—` placeholder, flag deferred with reason
- Never invent numbers (no hardcoded margins, no fake counts)
- Empty states use Section empty state pattern (italic muted, centered)
- Loading states: skeleton or spinner via DS pattern
- Error states: red border + FormError component

### Forms

- Replace all-or-nothing "Edit mode" with inline-edit per field
- All form actions toast on success/error
- Validation inline below field via FormError
- Disable submit until valid
- Confirm dialog before destructive/live-data actions

### Tables/lists

- Use `ListRow` for row pattern
- Sortable columns: click header to toggle asc/desc
- Pagination for >50 items
- Sticky headers on long tables
- Row striping (zebra) on tables with >10 rows
- Hover state changes bg to `--card-bg-hover`

### Accessibility

- Min touch target 44×44px
- Keyboard navigation: Tab through, Enter to activate, Esc to close
- Focus rings visible
- Alt text on images
- Semantic HTML

---

## ORDER OF SHIPPING

Recommended sequence. Each independently shippable.

```
Phase 0.1   Margin fix                              [bug]
Phase 0.2   Production-brain hub                    [bug]
Phase 0.3   Settings split                          [bug, multi-commit]

Phase 1.1   DsTabNav component                      [shared]
Phase 1.2   DsToast + FormError system              [shared]
Phase 1.3   HubCard component                       [shared]

Phase 2.1   DsDetailPage template                   [shared]
Phase 2.2   DsInlineField + variants                [shared]
Phase 2.3   DsTagInput                              [shared]
Phase 2.4   DsPhotoUpload                           [shared]
Phase 2.5   /products/[id]                          [detail]
Phase 2.6   /fillings/[id]                          [detail]
Phase 2.7   /ingredients/[id]                       [detail]
Phase 2.8   /moulds/[id]                            [detail]
Phase 2.9   /packaging/[id]                         [detail]
Phase 2.10  /variants/[id]                          [detail]
Phase 2.11  /decoration/[id]                        [detail]

Phase 3.1   /orders refit
Phase 3.2   /picking refit
Phase 3.3   /production-orders refit
Phase 3.4   /stock refit
Phase 3.5   /production-brain/planner refit
Phase 3.6   /production-brain/daily refit
Phase 3.7   /production-brain/needed refit
Phase 3.8   /production-brain/equipment refit
Phase 3.9   /production-brain/haccp refit
Phase 3.10  /plan day view refit
Phase 3.11  /plan pivot view refit
Phase 3.12  /plan month view refit

Phase 4.1   Shared shop components
Phase 4.2   /shop overview
Phase 4.3   /shop/counter
Phase 4.4   /shop/daily-count
Phase 4.5   /shop/transfer
Phase 4.6   /shop/breakage
Phase 4.7   /shop/count

Phase 5.1   /customers
Phase 5.2   /quotes
Phase 5.3   /price-lists
Phase 5.4   /subscriptions

Phase 6.1   /observatory overview
Phase 6.2   /reports/sales
Phase 6.3   /reports/monthly
Phase 6.4   /pricing
Phase 6.5   /stats
Phase 6.6   /observatory/product-cost
Phase 6.7   /imports

Phase 7.1   /lab container
Phase 7.2   /lab Experiments tab
Phase 7.3   /lab Ganache Calculator tab
Phase 7.4   /lab Recipe Calculator tab
Phase 7.5   /lab Audit tab
Phase 7.6   /audit (standalone)
Phase 7.7   /shopping
Phase 7.8   /wall
Phase 7.9   /settings landing
Phase 7.10  /settings/setup
Phase 7.11  /settings/skills

Phase 8.1   /products Categories tab
Phase 8.2   /fillings Categories tab
Phase 8.3   /ingredients Stock tab
Phase 8.4   /ingredients Categories tab
Phase 8.5   /decoration Categories tab
Phase 8.6   /decoration Designs tab
```

Total: ~58 commits. Each phase = one commit minimum.

---

## COMMIT MESSAGE TEMPLATE

```
{phase_number} — {phase_name}

✓ {item 1} — {file path}
✓ {item 2} — {file path}
✗ {deferred item} — reason

Notes: {anything unexpected, data gaps, follow-up}
```

---

## SCHEMA-BLOCKED ITEMS (flag deferred, don't block phase ship)

From audit findings, these need database changes:

1. **Workshop `step.startedAt` column** — `productionDayLineItems` table
   - Blocks: elapsed time in NOW bar (workshop dashboard)
   - Workaround: show only step name + progress count

2. **Mould drying/blocked state** — `mouldPoolInstances` table
   - Blocks: mould blocked state on workshop dashboard + equipment page
   - Workaround: show only in-use vs free

3. **HACCP calibrations model** — new `calibrations` table
   - Blocks: calibration checks display on workshop dashboard + haccp page
   - Workaround: hide compliance section row

4. **Real margin per product** — needs cost-per-product aggregation
   - Already addressed in Phase 0.1

For each blocked item: ship the UI with placeholder, flag deferred with the migration that would unblock it.

---

## NON-NEGOTIABLES

- Evidence per item on EVERY commit
- No silent partial ships
- No hardcoded data (numbers, dates, counts, percentages)
- No "TODO" / "Coming soon" placeholders in shipped UI — either build it or hide it
- All deferred items flagged with specific reason
- Each phase verified visually before next phase starts

---

**End of spec.**

This is a 6-month-equivalent design refresh for a typical team. In Cursor + AI workflow, this is ~10-20 hours of sequenced commits. Phases ship one after another in continuous chain. No pause between batches.
