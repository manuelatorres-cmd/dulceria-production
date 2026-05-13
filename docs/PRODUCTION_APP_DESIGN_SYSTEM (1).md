# Production app — design system spec

Goal: apply Dulceria visual system consistently across ALL pages in the production app. One pass that defines the patterns, then verify page-by-page.

Reference: matches the visual system used in Dulceria Business Hub. Same tokens, same component patterns, same density rules. Two apps should look like siblings.

---

## Phase 1 — Tokens + global styles

### CSS custom properties

Add to global stylesheet (likely `app/globals.css` or equivalent):

```css
:root {
  /* Page surfaces */
  --page-bg: #fbf6f1;
  --card-bg: #ffffff;
  --card-bg-hover: #f5f0e3;
  --border-warm: #e8e3d6;
  --closed-bg: #f3eee2;
  --today-tint: #fdf6e8;
  
  /* Text */
  --text-primary: #2c2515;
  --text-muted: #8a7e64;
  --text-inverse: #ffffff;
  
  /* Brand tier accents (LEFT BORDERS, NOT FILLS) */
  --tier-north-star: #dab73f;     /* caramel — only for true north-star items */
  --tier-quarter-focus: #264443;  /* deep teal — dominant */
  --tier-active: #fbccb9;          /* blush */
  --tier-parked: #b4b2a9;          /* gray */
  --tier-urgent: #993556;          /* warm rose — overdue / critical */
  --tier-positive: #5dcaa5;        /* mint — completed / healthy */
  
  /* Semantic */
  --semantic-warn: #dab73f;
  --semantic-critical: #993556;
  --semantic-ok: #5dcaa5;
  --semantic-info: #264443;
  
  /* Tints (very light bg shades, NEVER as fills on main content) */
  --tint-warn: #fff7e9;
  --tint-critical: #fdeae3;
  --tint-ok: #ecf7f1;
  --tint-info: #ebf0ee;
}
```

### Global element rules

```css
body {
  background: var(--page-bg);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 14px;
  line-height: 1.5;
}

.serif {
  font-family: "Playfair Display", Georgia, serif;
}

.muted { color: var(--text-muted); }
.italic { font-style: italic; }
.tabular { font-variant-numeric: tabular-nums; }

/* Borders are always 0.5px, never thicker */
.border, .border-warm, .card {
  border: 0.5px solid var(--border-warm);
}

/* No drop shadows except modal/drawer overlays */
.shadow-none { box-shadow: none !important; }
```

### Typography scale

```css
.text-page-title  { font-family: "Playfair Display", Georgia, serif; font-size: 28px; font-weight: 600; }
.text-section     { font-family: "Playfair Display", Georgia, serif; font-size: 20px; font-weight: 600; }
.text-card-title  { font-family: "Playfair Display", Georgia, serif; font-size: 16px; font-weight: 600; }
.text-body        { font-size: 14px; }
.text-small       { font-size: 13px; }
.text-meta        { font-size: 12px; color: var(--text-muted); font-style: italic; }
.text-label       { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); font-weight: 500; }
```

### Forbidden styles (audit and remove site-wide)

- Drop shadows on cards, lists, stat blocks (only allowed on floating overlays)
- Gradients (anywhere)
- Border-radius > 8px
- Border thickness > 1px
- Backgrounds with brand colors as FILLS (e.g., a card with full pale-blue background) — use white cards with colored LEFT BORDERS instead
- Pill/badge backgrounds with brand color fills except: tier indicators (caramel, teal, blush, gray, rose, mint), status badges (pending/scheduled/done)
- Multiple tags/badges on the same row (max 2-3 visible at once)

---

## Phase 2 — Component patterns

### StatCard (top of dashboards)

Replace current colorful filled cards with white cards + thin colored top-left accent:

```html
<div class="stat-card">
  <div class="stat-card-header">
    <span class="text-label">OPEN ORDERS</span>
    <Icon name="clipboard" size="14" class="muted" />
  </div>
  <div class="stat-card-value">11</div>
  <div class="stat-card-meta">0 rush · 11 overdue</div>
</div>
```

```css
.stat-card {
  background: var(--card-bg);
  border: 0.5px solid var(--border-warm);
  border-left: 3px solid var(--tier-quarter-focus); /* tier color per card type */
  border-radius: 8px;
  padding: 14px 16px;
  min-height: 80px;
  max-width: 280px;
}
.stat-card.urgent { border-left-color: var(--tier-urgent); }
.stat-card.warn { border-left-color: var(--semantic-warn); }
.stat-card.ok { border-left-color: var(--tier-positive); }

.stat-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.stat-card-value {
  font-family: "Playfair Display", Georgia, serif;
  font-size: 32px;
  font-weight: 600;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.stat-card-meta {
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
}
```

Apply to: main dashboard (Open orders / Batches today / Capacity / Attention), workshop dashboard (Active batches / Due in 7 days / Rush / Campaigns), any other dashboard stat cards.

### Section card (list containers)

```html
<div class="section">
  <div class="section-header">
    <h2 class="text-card-title">Today's pipeline</h2>
    <a class="section-action">16 batches · full schedule →</a>
  </div>
  <div class="section-body">
    <!-- content -->
  </div>
</div>
```

```css
.section {
  background: var(--card-bg);
  border: 0.5px solid var(--border-warm);
  border-radius: 8px;
  overflow: hidden;
}
.section-header {
  padding: 14px 20px 10px;
  border-bottom: 0.5px solid var(--border-warm);
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.section-action {
  font-size: 12px;
  color: var(--text-muted);
  text-decoration: none;
}
.section-action:hover { color: var(--tier-quarter-focus); }
.section-body { padding: 12px 0; }
```

### List row (orders, batches, tasks, etc.)

```html
<div class="list-row" data-tier="urgent">
  <div class="list-row-main">
    <div class="list-row-title">
      <strong>Margot Löbl</strong>
      <span class="badge">#4425</span>
      <span class="text-meta">Online · Ship</span>
    </div>
    <div class="list-row-meta">
      5 lines · 9 pieces · Strawberry-Lemon Bar, Almond Praline +2
    </div>
    <div class="list-row-meta">
      Next: <strong>Shelling</strong> · overdue — was Sa., 9. Mai
    </div>
  </div>
  <div class="list-row-side">
    <div class="text-meta">3. Mai 2026</div>
    <div class="status-tag overdue">overdue</div>
  </div>
</div>
```

```css
.list-row {
  border-left: 3px solid transparent;
  padding: 12px 20px;
  border-bottom: 0.5px solid var(--border-warm);
  display: flex;
  justify-content: space-between;
  gap: 16px;
  cursor: pointer;
  transition: background 0.1s;
}
.list-row:hover { background: var(--card-bg-hover); }
.list-row:last-child { border-bottom: none; }

.list-row[data-tier="urgent"] { border-left-color: var(--tier-urgent); }
.list-row[data-tier="active"] { border-left-color: var(--tier-active); }
.list-row[data-tier="parked"] { border-left-color: var(--tier-parked); opacity: 0.7; }
.list-row[data-tier="done"] { opacity: 0.5; }

.list-row-main {
  flex: 1;
  min-width: 0;
}
.list-row-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 14px;
  font-weight: 500;
}
.list-row-meta {
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
  margin-top: 2px;
}
.list-row-side {
  text-align: right;
  white-space: nowrap;
  font-size: 12px;
}
```

### Status tags (replace current pill row)

Current: 6 tags side by side per row (Online / Ship / Pending / Scheduled / Normal / etc.). Too noisy.

New rule: max 2 status tags per row. Channel (Online/Wholesale) + Status (Pending/Ready to pack/Done). Everything else lives in meta line.

```css
.status-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  border: 0.5px solid var(--border-warm);
  background: var(--card-bg);
  color: var(--text-muted);
}
.status-tag.pending { color: var(--semantic-warn); border-color: var(--semantic-warn); }
.status-tag.scheduled { color: var(--tier-positive); border-color: var(--tier-positive); }
.status-tag.ready { color: var(--tier-positive); background: var(--tint-ok); border-color: transparent; }
.status-tag.overdue { color: var(--semantic-critical); border-color: var(--semantic-critical); }
.status-tag.done { color: var(--text-muted); opacity: 0.6; }
```

Channel info ("Online", "Pickup", "Ship") moves to plain text in the meta line, not a tag.

### Attention items (right panel on dashboards)

Current: alternating pastel filled backgrounds (rose / yellow / blush / blue / yellow). Replace with white cards + thin colored left border.

```html
<div class="attention-item critical">
  <div class="attention-icon">⚠</div>
  <div class="attention-body">
    <div class="attention-title">11 orders past deadline</div>
    <div class="attention-detail">Re-schedule or contact customer.</div>
    <button class="btn-sm">Open orders →</button>
  </div>
</div>
```

```css
.attention-item {
  background: var(--card-bg);
  border: 0.5px solid var(--border-warm);
  border-left: 3px solid var(--text-muted);
  border-radius: 4px;
  padding: 12px 14px;
  margin-bottom: 8px;
  display: flex;
  gap: 10px;
}
.attention-item.critical { border-left-color: var(--semantic-critical); }
.attention-item.warn { border-left-color: var(--semantic-warn); }
.attention-item.info { border-left-color: var(--semantic-info); }
.attention-item.positive { border-left-color: var(--tier-positive); }

.attention-icon {
  font-size: 14px;
  color: var(--text-muted);
}
.attention-title {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 2px;
}
.attention-detail {
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
  margin-bottom: 8px;
}
```

### Buttons

```css
.btn {
  padding: 6px 14px;
  border: 0.5px solid var(--border-warm);
  border-radius: 4px;
  background: var(--card-bg);
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
}
.btn:hover { background: var(--card-bg-hover); }
.btn-primary {
  background: var(--tier-quarter-focus);
  color: var(--text-inverse);
  border-color: var(--tier-quarter-focus);
}
.btn-primary:hover { background: #1a3433; }
.btn-sm { padding: 4px 10px; font-size: 12px; }
.btn-lg { padding: 8px 18px; font-size: 14px; }
```

### Header pattern (per page)

Every page header follows this structure:

```html
<header class="page-header">
  <div class="page-header-row">
    <div>
      <h1 class="text-page-title">Dashboard</h1>
      <p class="text-meta">Welcome back · Di., 12. Mai</p>
    </div>
    <div class="page-header-actions">
      <span class="badge-warn">1 urgent</span>
      <span class="badge-warn">3 attention</span>
      <button class="btn">Close production day</button>
    </div>
  </div>
</header>
```

Title + subtitle on left. Status badges + actions on right. Border-bottom 0.5px. Padding 16px 32px.

---

## Phase 3 — Per-page audit

After global system applied (phases 1 + 2), audit each page for:

1. **Are stat cards using new white-with-accent pattern?** No more pastel-filled cards.
2. **Are list rows using tier-based left borders?** No more multi-tag pill rows.
3. **Is the header consistent?** Title + meta + actions pattern.
4. **Are attention items white with colored left borders?** Not alternating pastel fills.
5. **Are there any drop shadows or gradients?** Remove.
6. **Are borders 0.5px max?** Audit and adjust.
7. **Are buttons consistent?** btn / btn-primary / btn-sm patterns.

### Specific page notes

**Main dashboard:**
- Top stats row: 4 white cards with tier-colored left borders, ~80px tall each
- "Today's Pipeline" section: keep structure but remove redundant product list per step (just show product count if needed: "16 batches"). Capacity bar stays.
- "Attention" panel: white cards with colored borders, no pastel fills
- "This week" 7-day strip: cleaner cells, less button-like, today highlighted with cream bg
- "Upcoming deadlines": list-row pattern with tier-colored borders for overdue

**Workshop dashboard:**
- Top stats: same pattern
- "Active batches" list: list-row pattern, "DRAFT" tag once per row not repeated
- 4 bottom quick-action buttons: keep but use btn-lg consistent style
- "Deadlines · next 7 days" right panel: same pattern as main dashboard attention

**Orders:**
- Reduce status tags to 2 per row (channel + status only)
- Channel info ("Online", "Pickup", "Ship") moves into meta line
- Tier border for urgency: rose for overdue, default for normal
- Right-aligned: date + overdue indicator
- Filter row at top (currently has tabs: All / Pending / Ready to pack / In production / Done / Cancelled — keep but make compact)
- Section header "Online · 13" or "Wholesale · 2" stays as group separator

**Picking, Production orders, Calendar, Plan, Planner, Daily, Campaigns, Stock:**
- Apply patterns consistently
- Don't redesign workflow, just visual layer

---

## Phase 4 — Density audit

For each page, count:
- How many visual elements compete for attention at top?
- How much vertical space before "the work" appears?
- How many distinct background colors are visible at once?

Targets:
- Page header: ≤ 100px tall total
- Above-fold should show actual content (list rows, calendar grid, etc.), not just metadata
- Max 3 background colors visible per viewport (page bg + card bg + one tint for highlights)
- Max 2 brand colors as fills per viewport (e.g., teal button + caramel accent)

---

## Phase 5 — Icons

Switch all icons to Tabler Icons (outline variant only). No filled icons. Standard sizes:
- 14px in stat card headers, attention items
- 16px in nav, list rows
- 20px in section headers
- 24px in empty states

Color: inherit (so they pick up muted/primary based on context).

---

## Files to touch

- `app/globals.css` (or equivalent) — tokens + global rules
- `tailwind.config.js` if Tailwind is used — extend with brand tokens
- `components/ui/stat-card.tsx` — new component or refactor
- `components/ui/section.tsx` — new wrapper
- `components/ui/list-row.tsx` — shared row pattern
- `components/ui/attention-item.tsx` — refactor
- `components/ui/status-tag.tsx` — refactor with new tag rules
- `components/ui/button.tsx` — align with new style scale
- `components/ui/page-header.tsx` — new pattern
- Per page: replace inline styling with shared components

---

## Verify checklist

1. Open main dashboard — 4 white stat cards with colored left borders
2. "Today's pipeline" section: no redundant product-list-per-step duplication
3. "Attention" panel: white cards with colored left borders, not pastel fills
4. Open workshop dashboard — same stat card pattern, same attention pattern
5. Open orders — max 2 status tags per row, channel info in meta
6. Tier-based left borders visible on overdue orders (rose)
7. No drop shadows visible anywhere except modal overlays
8. No gradients anywhere
9. All borders 0.5px max
10. All page headers follow title + meta + actions pattern
11. Buttons all use btn / btn-primary / btn-sm consistent classes
12. Tabler outline icons throughout
13. Playfair Display for serif headers, system sans for body
14. Tabular figures on all numbers (stat values, counts, percentages)

---

## Honest deferred items

These are NOT in this design system pass:

1. **Per-page workflow improvements** — this spec is visual only. Workflow redesigns (like Manual Planner v2 or Weekly Plan redesign) are separate specs.
2. **Mobile responsive** — design system works on desktop. Mobile audit is its own pass.
3. **Dark mode** — not part of v1. Brand uses light tones intentionally.
4. **Empty states** — global empty state component exists but designing per-page empty states is its own work.
5. **Loading states** — skeleton screens / spinner patterns deferred.
6. **Animation / micro-interactions** — basic transitions OK, choreography deferred.

---

**End of spec.**
