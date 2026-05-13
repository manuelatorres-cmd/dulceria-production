# Main dashboard retrofit — `/`

Page: production app main dashboard ("Welcome back · Di., 12. Mai" header).

Apply the Dulceria design system. No deferral. No "iOS-glass exception." This page gets fully retrofitted.

**If you (Cursor) find yourself about to skip this page or defer to "later," STOP. The user has explicitly asked for this page to be retrofitted.**

---

## What changes (visible diff)

### 1. Top stat row — 4 cards

**Current:** 4 large pastel-filled cards (pale blue Open Orders, pale mint Batches Today, pale yellow Capacity, pale pink Attention). Each ~150px tall.

**New:** 4 white cards with thin colored left border (3px). Each ~80px tall. Use the StatCard component from `@/components/dulceria`.

Each card structure:

```tsx
<StatCard 
  label="OPEN ORDERS"           // 11px uppercase muted letterspaced
  value={11}                    // Playfair Display 32px weight 600 tabular-nums
  meta="0 rush · 11 overdue"    // 12px muted italic
  tier="info"                   // deep teal left border (default)
  icon="clipboard"              // 14px Tabler outline, top-right corner, muted
/>
```

Per-card tier assignments:
- Open Orders → `tier="info"` (deep teal left border)
- Batches Today → `tier="positive"` (mint left border)
- Capacity Next 7d → `tier="warn"` (caramel left border)
- Attention → `tier="urgent"` (warm rose left border)

NO pastel-filled backgrounds. NO icon-in-large-circle. Just white card + thin colored accent + clean number.

### 2. "Today's pipeline" section

**Current:** 7 step cards (Polishing / Painting / Shelling / Fill / Filling Prep / Cap / Unmould) each with: title + SHOW button + 3 "STANDARD / STANDARD / NUT" tags + progress fraction + capacity bar + "16 batches · Apple Walnut, Crunchy Nougat +14".

**Issues:**
- The "16 batches · Apple Walnut, Crunchy Nougat +14" line is IDENTICAL on every card (redundant — drop from non-active steps)
- Three "STANDARD / STANDARD / NUT" tags are visual clutter on every card

**New:**

Wrap section using the `<Section>` component:

```tsx
<Section 
  title="Today's pipeline"
  action={<a className="section-action">16 batches · full schedule →</a>}
>
  ...
</Section>
```

Each step card:

```tsx
<div className="step-card" data-active={isActive}>
  <div className="step-card-header">
    <h3 className="step-card-title">Polishing</h3>
    <button className="text-muted">show</button>
  </div>
  <div className="step-card-progress">
    <span className="progress-fraction">16 / 16 moulds</span>
    <span className="progress-pct">100%</span>
  </div>
  <div className="step-card-bar">
    <div className="step-card-fill" style={{ width: '100%' }} />
  </div>
  {isActive && (
    <div className="step-card-meta">Apple Walnut, Crunchy Nougat +14</div>
  )}
</div>
```

```css
.step-card {
  background: var(--card-bg);
  border: 0.5px solid var(--border-warm);
  border-left: 3px solid var(--border-warm);
  border-radius: 6px;
  padding: 14px 16px;
  min-height: 100px;
}
.step-card[data-active="true"] {
  border-left-color: var(--tier-positive);  /* current step in progress = mint */
}
.step-card[data-completed="true"] {
  border-left-color: var(--tier-positive);
  opacity: 0.7;
}
.step-card[data-pending="true"] {
  border-left-color: var(--border-warm);
}

.step-card-title {
  font-family: "Playfair Display", Georgia, serif;
  font-size: 16px;
  font-weight: 600;
}
.step-card-progress {
  font-size: 13px;
  margin-top: 8px;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.progress-fraction { font-weight: 500; font-variant-numeric: tabular-nums; }
.progress-pct { color: var(--text-muted); font-size: 12px; }
.step-card-bar {
  height: 3px;
  background: var(--border-warm);
  border-radius: 2px;
  margin-top: 6px;
  overflow: hidden;
}
.step-card-fill {
  height: 100%;
  background: var(--tier-positive);
  transition: width 0.3s;
}
.step-card-meta {
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
  margin-top: 8px;
}
```

**Drop the 3 STANDARD/STANDARD/NUT tags entirely.** They don't add information at the step level — those are mould-type categories that vary per batch, surfaced in the SHOW detail view. On the dashboard summary card, hide them.

**Drop the product list ("Apple Walnut, Crunchy Nougat +14") on non-active cards.** Show it only on the currently-active step (the one with progress > 0% but < 100%).

### 3. Attention panel (right side)

**Current:** 5 items each with full pastel fills (rose, yellow, blush, blue, yellow). Heavy visual noise.

**New:** Use the AttentionItem component. White cards with colored left borders.

```tsx
<Section title="Attention" action={<span>5 items</span>}>
  <AttentionItem
    severity="critical"
    title="11 orders past deadline"
    detail="Re-schedule or contact customer."
    action={<DsButton size="sm">Open orders →</DsButton>}
  />
  <AttentionItem
    severity="warn"
    title="12 ingredients short"
    detail="Open orders are short upstream. Place a supplier order."
    action={<DsButton size="sm">Shopping list →</DsButton>}
  />
  <AttentionItem
    severity="warn"
    title="39 product/location below minimum"
    detail="Production Store thinning out — consider a replen batch."
    action={<DsButton size="sm">Stock page →</DsButton>}
  />
  <AttentionItem
    severity="info"
    title="5 fillings to cook this week"
    detail="Kalamansi Ganache · Raspberry Passionfruit Ganache"
    action={<DsButton size="sm">Cook plan →</DsButton>}
  />
  <AttentionItem
    severity="warn"
    title="Daily temperature log not completed"
    detail="1 device needs a check."
    action={<DsButton size="sm">Log now →</DsButton>}
  />
</Section>
```

Severity mapping:
- `critical` → warm rose left border
- `warn` → caramel left border
- `info` → deep teal left border
- `positive` → mint left border

All cards are WHITE with thin colored LEFT BORDER. No pastel fill backgrounds.

### 4. "This week · Next 7 days" 7-day strip

**Current:** 7 boxes that look like buttons (rounded with borders).

**New:** Same row of 7 boxes but cleaner — less button-like, more calendar-cell-like.

```tsx
<Section title="This week · Next 7 days" action={<a>full plan →</a>}>
  <div className="week-strip">
    {days.map(day => (
      <div className="week-cell" data-today={day.isToday}>
        <div className="week-cell-date">{day.label}</div>
        <div className="week-cell-pct">{day.capacityPct}%</div>
        <div className="cap-bar">
          <div className="cap-fill" style={{ width: `${day.capacityPct}%` }} />
        </div>
        <div className="week-cell-batches">{day.batchCount > 0 ? `${day.batchCount} batches` : '—'}</div>
      </div>
    ))}
  </div>
</Section>
```

```css
.week-strip {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 8px;
  padding: 14px 20px;
}
.week-cell {
  background: var(--card-bg);
  border: 0.5px solid var(--border-warm);
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 12px;
}
.week-cell[data-today="true"] {
  background: var(--today-tint);
  border-color: var(--tier-quarter-focus);
}
.week-cell-date { 
  font-weight: 500; 
  font-size: 13px; 
}
.week-cell-pct {
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  margin-top: 2px;
}
.cap-bar {
  height: 2px;
  background: var(--border-warm);
  border-radius: 1px;
  margin-top: 6px;
}
.cap-fill {
  height: 100%;
  background: var(--tier-positive);
}
.week-cell-batches {
  margin-top: 6px;
  color: var(--text-muted);
  font-style: italic;
  font-size: 11px;
}
```

Today cell: cream-tinted background + deep teal border. Other days: white card.

### 5. "Upcoming deadlines" panel (right, below Attention)

**Current:** Plain rows with "overdue" right-aligned in rose.

**New:** Use ListRow component with tier-based left border for overdue.

```tsx
<Section title="Upcoming deadlines" action={<a>all orders →</a>}>
  {orders.map(order => (
    <ListRow
      key={order.id}
      tier={order.isOverdue ? "urgent" : "default"}
      title={<>
        <strong>{order.customerName}</strong>
        <span className="text-meta">{order.channel} · {order.priority}</span>
      </>}
      right={
        <div>
          <div className="text-meta">{formatDate(order.dueDate)}</div>
          {order.isOverdue && <span className="status-tag overdue">overdue</span>}
        </div>
      }
    />
  ))}
</Section>
```

Each overdue order row gets warm-rose 3px left border. Non-overdue rows: no left accent.

### 6. Page header

**Current:** "Welcome back · Di., 12. Mai" + 3 badges + button on right.

**New:** Use PageHeader component.

```tsx
<PageHeader
  title="Welcome back"
  meta="Di., 12. Mai · 16 batches scheduled"
  actions={<>
    <span className="badge-urgent">1 urgent</span>
    <span className="badge-warn">3 attention</span>
    <DsButton variant="secondary">Close production day</DsButton>
  </>}
/>
```

Title: Playfair 28px weight 600. Meta: 13px muted italic. Actions: right-aligned.

---

## Files to touch

```
src/app/page.tsx (or wherever main dashboard lives)
  └─ Replace all inline styling with shared components
src/components/dashboard/today-pipeline.tsx
  └─ Use Section wrapper, redesigned step cards, drop redundant tags + product list
src/components/dashboard/attention-panel.tsx
  └─ Use AttentionItem component, no pastel fills
src/components/dashboard/week-strip.tsx
  └─ Use new cell pattern
src/components/dashboard/upcoming-deadlines.tsx
  └─ Use ListRow component
```

---

## Verify checklist

Open `/` after retrofit. Compare to current screenshot:

1. ✓ 4 stat cards at top are WHITE (not pastel-filled)
2. ✓ Each stat card has thin colored LEFT BORDER (3px)
3. ✓ Stat card values use Playfair Display serif font
4. ✓ Step cards in "Today's pipeline" have no STANDARD/STANDARD/NUT tags
5. ✓ "Apple Walnut, Crunchy Nougat +14" line ONLY appears on the currently-active step card (Polishing in current state, or whichever is in progress)
6. ✓ Attention panel items are WHITE cards with colored left borders (NOT pastel fills)
7. ✓ "This week" 7-day strip cells look like calendar cells, not buttons
8. ✓ Today's cell highlighted with cream tint
9. ✓ "Upcoming deadlines" overdue rows have warm-rose left border
10. ✓ Page header uses PageHeader component
11. ✓ All icons are Tabler outline (14/16/20/24)
12. ✓ No drop shadows anywhere
13. ✓ No gradients anywhere
14. ✓ All borders 0.5px max (except the 3px tier accent borders)

---

## What NOT to do

- DO NOT skip this page citing "iOS-glass exception"
- DO NOT keep ANY pastel-filled backgrounds on cards
- DO NOT keep the redundant product list lines on every step card
- DO NOT keep the STANDARD/STANDARD/NUT tags on step cards
- DO NOT use lucide-react icons — use Tabler outline only
- DO NOT defer "for visual polish later"

The components were shipped to `@/components/dulceria` in the previous chain. They exist. Use them.

---

**End of spec.**
