# Mega-page bodies — final batch

The 4 remaining heavyweight pages + settings monolith. Each tab body specified. Ship in continuous chain. Use shared DS components already built (DsDetailPage, DsInlineField, DsTagInput, DsPhotoUpload, DsTabNav, DsToast, FormError, Section, StatCard, ListRow, DsButton, HubCard).

Evidence-per-item rule on every commit.

---

## Phase A — `/products/[id]` (3314 LOC, 6 tabs)

**File:** `src/app/(app)/products/[id]/page.tsx`

Wrap entire page in `<DsDetailPage>` (already built). Remove `InlineNameEditor` + custom `DetailNav` + custom tab strip + custom Save/Cancel mode toggle. Use `DsTabNav` for tabs. URL state via `?tab=`.

Inline-edit per field. No "Edit mode" toggle. Save-on-blur with toast.

### Tab A.1 — Product (default)

Three-column layout on desktop, single column on mobile. Each column is a `Section`.

**Column 1 — Identity:**
- DsPhotoUpload (large square aspect)
- DsInlineField: name (serif title, already in header but exposes here for accessibility)
- DsInlineSelect: category
- DsInlineSelect: priority tier (T1/T2/T3)
- DsInlineField: aliases → DsTagInput
- DsInlineField: tags → DsTagInput
- DsInlineTextarea: notes

**Column 2 — Composition:**
- DsInlineSelect: fill mode (% / grams)
- DsInlineSelect: shell source (ingredient OR filling — radio toggle inside select drop)
- DsInlineField: shell % (if fill mode = %)
- DsInlineField: coating
- DsInlineSelect: default mould → shows derived "filling grams / cavity = X g" inline below when mould selected
- DsInlineField: default batch qty
- Read-only block: shell design steps list with "Edit steps →" link to dedicated editor (deferred — flag ✗ if not built)

**Column 3 — Commercial:**
- DsInlineField: shelf life (days)
- DsInlineField: lead time (days)
- DsInlineField: default VAT %
- DsInlineField: default discount on seconds %
- DsInlineField: min stock — store
- DsInlineField: min stock — production
- DsInlineToggle: custom-boxes flag
- DsInlineToggle: seconds-allowed flag

### Tab A.2 — Shell

Single column, 2 Sections.

**Section "Shell source":**
- Source type (ingredient vs filling) — already chosen in Product tab, show as read-only badge with "← edit in Product tab" link
- If ingredient: DsInlineSelect ingredient + DsInlineField %
- If filling: DsInlineSelect filling + DsInlineField %

**Section "Computed":**
- Composition breakdown table (read-only, ListRow per component): cacao fat %, sugar %, milk fat %, water, solids, other fats, alcohol — pulled from selected source
- Allergen chips row (red border for "contains", caramel for "may contain")
- "Recomputes when source changes" muted italic footer

### Tab A.3 — Filling history

Single column, paginated list.

**Toolbar:** DsTabNav (sub-pills) — All / Active / Past — counts inline. Search input right side.

**Body:** ListRow per batch:
- Left: batch label + filling name + date (serif)
- Middle: qty produced + qty used + qty remaining
- Right: status chip (active/done/scrapped) + link "Open batch →"

**Pagination:** 30 per page, "Load more" button at bottom.

Empty state: italic muted "No batches yet" in centered Section.

### Tab A.4 — Batches

Grid of batch cards (3 cols desktop, 1 mobile).

**Each card:**
- Section wrapper, white card, colored left border by status (mint done, caramel in_production, blush pending, rose cancelled)
- Header: batch label (serif) + status chip + date
- Body: qty + mould + production day link
- Footer: "Open day →" link

**Toolbar:** filter pills (All / Active / Done / Cancelled) + date range picker.

Empty state: italic muted.

### Tab A.5 — Cost

Two columns desktop, stacked mobile.

**Column 1 — Current cost:**
- StatCard grid 2×2:
  - Cost per unit (€, 2dp, tabular)
  - Margin % (color-coded health: mint ≥30, caramel 15-30, rose <15)
  - Sell price (€)
  - Last computed (relative time)
- Section "Cost breakdown": ListRow per component — Shell / Filling / Packaging / Labor / Other with € and %
- "Recompute now" DsButton secondary

**Column 2 — History:**
- Section "Snapshot history": ListRow per snapshot — date + cost + margin + delta vs previous (▲ rose / ▼ mint chip)
- Sparkline chart at top (cost over time, recharts simple line)
- "Export CSV" DsButton secondary

### Tab A.6 — Nutrition

Single column.

**Section "Per 100g":** Two-column key/value grid. Calories / Fat / Sat fat / Carbs / Sugar / Protein / Salt. Each row tabular-nums.

**Section "Per piece":** Same grid using piece weight. Show piece weight as editable inline at top.

**Section "Allergens":** Chips for contains (red border) + may contain (caramel border) + dietary tags (vegan/gluten-free/etc.). Computed live from shell + fillings.

**Section "Source breakdown":** Collapsed by default. Expand shows ListRow per component (shell + each filling) with nutrition contribution.

**Read-only ✗:** "Computed from shell + fillings — edit those to change values."

### Modal/drawer fixes for /products/[id]

- Duplicate panel: convert to drawer (DsDrawer if exists, otherwise right-side panel using Section pattern)
- Photo removal confirm: DsDialog
- Filling assignment form: drawer not nested modal
- Delete confirm: DsDialog

---

## Phase B — `/orders/[id]` (3183 LOC)

**File:** `src/app/(app)/orders/[id]/page.tsx`

No tabs in current structure. Single-page detail with order header + line items grid + history.

Wrap in `<DsDetailPage>`. Header shows order # + customer + status badge + total. Right side: prev/next + actions (Edit / Duplicate / Cancel / Delete).

### Section B.1 — Order metadata

Two-column Section, inline-edit fields.

**Left:**
- DsInlineSelect: customer (with search)
- DsInlineField: order date
- DsInlineField: due date
- DsInlineSelect: channel (B2B/Shop/Event/Online)
- DsInlineSelect: status (Draft/Confirmed/In production/Ready/Delivered/Cancelled)
- DsInlineTextarea: notes

**Right:**
- DsInlineField: PO number
- DsInlineField: shipping address
- DsInlineSelect: delivery method
- DsInlineField: requested delivery time
- DsInlineToggle: gift wrap
- DsInlineTextarea: customer note

### Section B.2 — Line items grid

**Toolbar:** search + filter pills (All / Variants / Singles / Decoration). "+ Add line" DsButton primary.

**Grid:** Table with sticky header.

Columns:
- Product / Variant name (1fr, click → opens drawer to swap product)
- Qty (number input, inline-edit)
- Unit price (€, inline-edit, shows price source below in 10px muted: "from price list X" / "retail fallback")
- Discount % (inline-edit, defaults from customer)
- VAT % (inline-edit)
- Subtotal (€, computed, tabular)
- Actions (× to remove → confirm DsDialog)

**Footer row:** Subtotal / VAT / Total in tabular-nums, sticky bottom.

**Add line:** opens drawer with product picker (search + recent + category filter). On select, line appended with resolved unit price.

### Section B.3 — History

ListRow per event:
- Timestamp (relative + absolute on hover)
- Event type chip (Created / Confirmed / Edited / Status changed / Note added / etc.)
- Actor (person who did it)
- Detail line italic muted

Collapsible — default shows last 10, "Show all" expands.

### Section B.4 — Related

- Linked production batches (ListRow per batch)
- Linked invoices (ListRow per invoice)
- Linked picking jobs (ListRow per job)

Each row links to respective detail page.

---

## Phase C — `/production/[id]` (1641 LOC, wizard)

**File:** `src/app/(app)/production/[id]/page.tsx`

Production day wizard. Multi-step linear flow.

Wrap in `<DsDetailPage>`. Header: date + status badge + total batches + total minutes planned vs capacity (color-coded utilization bar).

### Wizard structure

Replace custom wizard chrome with DsTabNav (variant: pills, with step numbers) horizontal at top:

1. Plan
2. Prep
3. Production
4. Packing
5. Wrap up

Active step in deep teal pill. Completed steps in mint with check icon. Future in muted.

URL state via `?step=`.

### Step C.1 — Plan

Section "Batches scheduled":
- ListRow per batch: product + qty + mould + estimated time + assigned person
- Drag handles for reorder
- Click row → drawer with full batch detail + edit
- "+ Add batch" DsButton primary opens drawer

Section "Day summary":
- StatCard grid: total minutes / capacity / utilization % / batch count

### Step C.2 — Prep

Section "Mise en place":
- Aggregated ingredient list from all batches
- ListRow per ingredient: name + total qty needed + on-hand + delta (rose if short)
- "Mark all prepped" bulk action button

Section "Moulds ready":
- ListRow per mould type + count needed
- Toggle: clean / not clean

Section "Machines loaded":
- ListRow per machine: status + active chocolate
- "Load now" button if empty

### Step C.3 — Production

Phase-grouped execution view. Replace pastel gradient backgrounds with white cards + colored LEFT BORDER per phase.

Phase colors (left borders, 3px):
- Polishing: butter (use --ds-tier-confirmed)
- Colour: blush
- Shell: butter
- Filling prep: --ds-semantic-lavender (or fall to muted if no token)
- Filling: --ds-semantic-info
- Cap: --ds-tier-positive
- Unmould: mint
- Packing: caramel

**Each phase card:**
- Section wrapper
- Header: phase name (serif) + step count + estimated time + chip "active now" if has in-progress step
- Body: ListRow per step:
  - Batch label + step description
  - Assigned person chip
  - Status toggle (pending → in progress → done) as inline icon button
  - Time tracking inline (start time + elapsed) — flag ✗ deferred if `step.startedAt` schema column missing
- Footer: "All done in phase" mint chip when complete

### Step C.4 — Packing

Section "Boxes to pack":
- ListRow per box: variant + qty + due order
- Status toggle: queued / packing / done

Section "Singles to wrap":
- ListRow per single product + qty

### Step C.5 — Wrap up

Section "Yield":
- Table: planned qty / actual qty / variance / variance reason per batch
- Submit on save

Section "Notes":
- DsInlineTextarea: day notes
- DsInlineTextarea: issues encountered

Section "Mark complete":
- DsButton primary "Mark production day complete" with confirm DsDialog

---

## Phase D — `/production-brain/daily` (2432 LOC)

**File:** `src/app/(app)/production-brain/daily/page.tsx`

Workshop execution floor view. NOT a wizard like `/production/[id]` — this is the live "what's happening right now" view.

Wrap in DS PageHeader (already done). Replace body.

### Layout

Two-column on desktop:
- Left 70%: main content (Right now + phase cards)
- Right 30%: side rail (machines / mould pool / staff / event feed)

ViewDate picker top: chevron buttons + "Today" pill + date display (serif, prominent).

### Section D.1 — Right now (top of left column)

Large focus card. Section with caramel left border.

**Header:** "Right now — {phase name}" (serif, 20px)

**Body:**
- Active step description (large, 16px)
- Batch product + qty
- Assigned person (chip)
- Started at + elapsed (tabular) — flag ✗ if schema missing
- Progress bar (steps done / total in this batch)

**Footer:** "Next up: {step}" italic muted

If no active step: "Workshop quiet — nothing in progress" empty state italic.

### Section D.2 — Phase cards (rest of left column)

Replace pastel gradients with white cards + colored left borders (use same phase colors as Phase C.3).

**Each phase card:**
- Section, collapsible
- Header: phase name (serif) + step count "{done}/{total}" + estimated remaining minutes
- Active phase: caramel "active now" chip top-right
- Body (when expanded): ListRow per step
  - Step description (1fr)
  - Batch label chip
  - Assignee
  - Status icon (pending = empty circle / in progress = pulsing dot / done = check)
  - Click row → drawer with step detail + actions (Start / Pause / Done / Reassign)
- Auto-expand active phase, others collapsed by default

### Section D.3 — Side rail (right column)

**Machines panel (Section):**
- ListRow per machine: name + chocolate loaded + remaining kg + progress bar + aging chip if relevant
- Click row → drawer (Load / Drain / View history)

**Mould pool panel (Section):**
- ListRow per active mould: type + count in use + count free
- Color: caramel "drying" / mint "ready" / rose "blocked" — flag ✗ if state column missing, fall back to "in use" vs "free" only

**Staff panel (Section):**
- ListRow per person: name (chip with terracotta bg) + current task + clock-in time
- Click → drawer with shift detail

**Event feed (Section):**
- ListRow per event: timestamp + actor + event description
- Auto-scroll, keep last 20
- Filter pill: All / Steps / Stock / HACCP / Notes

---

## Phase E — Settings monolith split (`src/components/settings/all-tabs.tsx`)

8-tab monolith with shared parent state. Per-tab split blocked by shared state coupling.

### Strategy

Don't extract files mechanically. Refactor parent state into a `SettingsProvider` context that each subroute consumes.

### E.1 — Build SettingsProvider

`src/components/settings/settings-provider.tsx`

Lifts current parent state into Context. Provides:
- All settings data
- Dirty state tracking per section
- Save handlers
- Validation handlers

Wrap each settings subroute layout with `<SettingsProvider>`.

### E.2 — Extract per-tab components

From `all-tabs.tsx` extract into:
- `src/components/settings/backup-section.tsx`
- `src/components/settings/import-section.tsx`
- `src/components/settings/capacity-section.tsx`
- `src/components/settings/equipment-section.tsx`
- `src/components/settings/steps-section.tsx`
- `src/components/settings/market-section.tsx`
- `src/components/settings/printing-section.tsx`
- `src/components/settings/demo-section.tsx`

Each consumes `useSettings()` hook from provider.

### E.3 — Wire subroutes

Each subroute page imports its section component:
```tsx
// src/app/(app)/settings/backup/page.tsx
export default function BackupPage() {
  return <BackupSection />;
}
```

Remove tab switcher from `/settings` landing — already covered by sidebar sub-navigation. Landing becomes HubCard grid of 8 sections.

### E.4 — Delete all-tabs.tsx

Once all subroutes wired and verified, delete `src/components/settings/all-tabs.tsx`.

Evidence:
- ✓ SettingsProvider — src/components/settings/settings-provider.tsx
- ✓ Backup section extracted — src/components/settings/backup-section.tsx
- ✓ (per section)
- ✓ all-tabs.tsx deleted

---

## Phase F — Misc cleanups

### F.1 — `/lab/audit-tab.tsx`

Audit tab body still uses bespoke HACCP-style tinted strips.

Replace tinted strips with Section + StatusTag (max 2 per item).

Strips are intentional-ish (low impact) but inconsistent with rest of /lab. Refit if time permits, otherwise flag ✗ "intentional bespoke — low impact."

### F.2 — `/wall` (workshop TV display)

LEAVE ALONE. Intentional bespoke for distance reading on TV. Already uses semantic vars.

### F.3 — `/plan` PlanHeader/PlanTabs + view-mode bodies

LEAVE ALONE for now. Too tied to internal viewMode state. Separate spec needed.

### F.4 — `/production-brain/manual` week navigator

LEAVE ALONE. Tied to mp-* tokens, already covered by MANUAL_PLANNER_V2_SPEC.md.

### F.5 — Color palettes (observatory chocolate shades, variants palette, stats health dots)

LEAVE ALONE. Semantic, must stay literal hex.

---

## Order of shipping

```
Phase E.1   SettingsProvider build
Phase E.2   Extract 8 settings sections
Phase E.3   Wire subroutes
Phase E.4   Delete all-tabs.tsx

Phase A.1   /products/[id] Product tab
Phase A.2   /products/[id] Shell tab
Phase A.3   /products/[id] Filling history tab
Phase A.4   /products/[id] Batches tab
Phase A.5   /products/[id] Cost tab
Phase A.6   /products/[id] Nutrition tab
Phase A.7   /products/[id] modals/drawers cleanup

Phase D.1   /production-brain/daily Right now card
Phase D.2   /production-brain/daily Phase cards
Phase D.3   /production-brain/daily Side rail

Phase B.1   /orders/[id] metadata section
Phase B.2   /orders/[id] line items grid
Phase B.3   /orders/[id] history section
Phase B.4   /orders/[id] related section

Phase C.1   /production/[id] wizard chrome (DsTabNav step pills)
Phase C.2   /production/[id] Plan step
Phase C.3   /production/[id] Prep step
Phase C.4   /production/[id] Production step
Phase C.5   /production/[id] Packing step
Phase C.6   /production/[id] Wrap up step

Phase F.1   /lab/audit-tab refit (if time)
```

~22 commits. Each phase independently shippable.

---

## Non-negotiables

- Evidence per item on every commit
- No "Edit mode" toggle anywhere — inline-edit only
- No nested modals — use drawers for secondary flows
- All forms toast on save
- All destructive actions confirm via DsDialog
- Pastel gradient backgrounds → white cards + colored left borders
- Custom tab strips → DsTabNav
- Raw `<input type="file" />` → DsPhotoUpload
- Comma-edit tag fields → DsTagInput
- Photo data URI embeds → real upload via DsPhotoUpload backend (flag ✗ if CDN endpoint missing, fall back to data URI with deferred note)
- Schema-blocked items (step.startedAt, mould drying state, etc.): ship UI with placeholder, flag ✗ deferred with migration that unblocks

---

**End of spec.**

Reference all existing components in `src/components/dulceria/`. Read mockups in `/docs/` for reference if tab body design feels ambiguous. When in doubt: match the visual language of `/customers` (already refit, exemplary).
