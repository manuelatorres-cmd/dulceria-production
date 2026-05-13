# Main dashboard — hybrid redesign implementation spec

Replace current dashboard at `/` (or wherever the main dashboard lives — likely `app/page.tsx` or `app/dashboard/page.tsx`).

Reference mockup: `dashboard-hybrid.html` (save to `/docs/`).

**If you (Cursor) find yourself about to defer this page citing "iOS-glass exception" or any other reason — STOP. The user has explicitly approved this design and wants it implemented. No deferrals.**

The components shipped to `@/components/dulceria` in the design system chain (StatCard, Section, ListRow, AttentionItem, PageHeader, DsButton, DsIcon) are USED in this spec. If you find any component doesn't exist or doesn't have the API this spec describes, build/extend it — don't skip.

---

## What replaces what

**Current dashboard:**
- 4 large pastel-filled stat cards (Open Orders / Batches Today / Capacity / Attention)
- "Today's Pipeline" — 7 step cards in a grid, each ~150px tall with redundant tags + product lists
- "Attention" panel — 5 items with alternating pastel fills
- "This Week · Next 7 Days" — 7 button-like day boxes
- "Upcoming Deadlines" — flat list

**New dashboard:**
- Compressed page header (one row)
- 6 zone cards across the top (production / orders / stock / this-week / compliance / campaigns)
- Today's pipeline as horizontal step flow (one row, 7 pills with chevrons)
- Two-column body: attention + deadlines (left) and week + stock + campaigns (right)

Net effect: above the fold shows zones (instant scan) + pipeline (current state). Detail below.

---

## Layout structure

```
<DashboardPage>
  <DashboardHeader />              {/* page header */}
  <DashboardZones />               {/* 6 zone cards */}
  <DashboardPipeline />            {/* horizontal step flow */}
  <DashboardBody>                  {/* two-column grid */}
    <DashboardBodyLeft>
      <NeedsAttention />
      <UpcomingDeadlines />
    </DashboardBodyLeft>
    <DashboardBodyRight>
      <Next7Days />
      <StockSnapshot />
      <ActiveCampaigns />
    </DashboardBodyRight>
  </DashboardBody>
</DashboardPage>
```

CSS:
```css
.page-body {
  padding: 0 32px 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.body-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.zone-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
}
```

---

## Section 1 — Page header

```tsx
<PageHeader
  title="Welcome back"
  meta={`${dateLabel} · ${currentTime} · ${batchesScheduled} batches scheduled${currentStepText}`}
  actions={
    <>
      {urgentCount > 0 && <span className="badge badge-urgent">{urgentCount} urgent</span>}
      {attentionCount > 0 && <span className="badge badge-warn">{attentionCount} attention</span>}
      <DsButton variant="secondary" onClick={handleCloseDay}>Close production day</DsButton>
    </>
  }
/>
```

Where:
- `dateLabel` = "Di., 12. Mai" (use date-fns with German locale)
- `currentTime` = "08:14" (current clock time, refresh every minute)
- `batchesScheduled` = count from today's productionDayLineItems
- `currentStepText` = if a step is in progress today, " · {stepName} in progress". Otherwise empty.

Header is ONE row. ~70-80px tall total including padding.

---

## Section 2 — 6 zone cards

This replaces the current 4-card stat strip. Each zone is a clickable card with:
- Label (uppercase 10px, letterspaced)
- Status badge (small, colored by severity)
- Big number (Playfair 32px)
- Subtitle (12px italic muted, max 2 lines)
- Footer "open →" link

```tsx
<div className="zone-grid">
  <ZoneCard
    label="Production"
    status={productionStatus}        // "in progress" | "idle" | "blocked"
    statusVariant={productionVariant} // "warn" | "info" | "urgent"
    value={
      <>
        {productionStepsDone}
        <span className="unit">/{productionStepsTotal}</span>
      </>
    }
    subtitle={`${currentStepName} · ${currentStepPct}% · ~${nextStepEta}`}
    href="/production-brain/plan"
    accentVariant={productionVariant}
  />
  
  <ZoneCard
    label="Orders"
    status={overdueCount > 0 ? "overdue" : "all current"}
    statusVariant={overdueCount > 0 ? "urgent" : "ok"}
    value={overdueCount > 0 ? overdueCount : totalOpenOrders}
    subtitle={overdueCount > 0 ? `oldest ${oldestOverdueDays} days` : `${totalOpenOrders} open orders`}
    href="/orders"
    accentVariant={overdueCount > 0 ? "urgent" : "info"}
  />
  
  <ZoneCard
    label="Stock"
    status={belowMinCount > 30 ? "attention" : "stable"}
    statusVariant={belowMinCount > 30 ? "warn" : "ok"}
    value={belowMinCount}
    subtitle={`below min · ${ingredientsShortCount} ingr. short`}
    href="/stock"
    accentVariant={belowMinCount > 30 ? "warn" : "info"}
  />
  
  <ZoneCard
    label="This week"
    status="on track"
    statusVariant="info"
    value={weekBatchCount}
    subtitle={`batches · peak ${peakDayLabel} ${peakDayPct}%`}
    href="/production-brain/plan"
    accentVariant="info"
  />
  
  <ZoneCard
    label="Compliance"
    status={complianceTodos > 0 ? `${complianceTodos} todo` : "all clear"}
    statusVariant={complianceTodos > 0 ? "warn" : "ok"}
    value={complianceTodos}
    subtitle={complianceTodos > 0 ? `${primaryTodoLabel} incomplete` : "logs up to date"}
    href="/haccp"
    accentVariant={complianceTodos > 0 ? "warn" : "ok"}
  />
  
  <ZoneCard
    label="Campaigns"
    status={runningCount > 0 ? "running" : "idle"}
    statusVariant={runningCount > 0 ? "ok" : "info"}
    value={campaignCount}
    subtitle={`planned + running`}
    href="/campaigns"
    accentVariant={runningCount > 0 ? "ok" : "info"}
  />
</div>
```

### ZoneCard component

```tsx
// src/components/dulceria/zone-card.tsx
interface ZoneCardProps {
  label: string;
  status: string;
  statusVariant: "urgent" | "warn" | "ok" | "info";
  value: ReactNode;
  subtitle: string;
  href?: string;
  onClick?: () => void;
  accentVariant: "urgent" | "warn" | "ok" | "info";
}
```

Build this component if it doesn't exist yet. Add to `@/components/dulceria/index.ts` barrel export.

CSS:
```css
.zone {
  background: var(--card-bg);
  border: 0.5px solid var(--border-warm);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.15s;
  display: flex;
  flex-direction: column;
}
.zone:hover { border-color: var(--ds-tier-quarter-focus); }
.zone[data-accent="urgent"] { border-left: 3px solid var(--ds-tier-urgent); }
.zone[data-accent="warn"] { border-left: 3px solid var(--ds-semantic-warn); }
.zone[data-accent="ok"] { border-left: 3px solid var(--ds-tier-positive); }
.zone[data-accent="info"] { border-left: 3px solid var(--ds-semantic-info); }

.zone-header { padding: 12px 14px 8px; }
.zone-label {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--ds-text-muted); font-weight: 600;
  display: flex; justify-content: space-between; align-items: center;
}
.zone-status { text-transform: none; letter-spacing: 0; font-weight: 500; font-size: 10px; }
.zone-status[data-variant="urgent"] { color: var(--ds-tier-urgent); }
.zone-status[data-variant="warn"] { color: var(--ds-semantic-warn); }
.zone-status[data-variant="ok"] { color: var(--ds-tier-positive); }
.zone-status[data-variant="info"] { color: var(--ds-semantic-info); }

.zone-count {
  font-family: "Playfair Display", Georgia, serif;
  font-size: 32px; font-weight: 600; line-height: 1.1;
  margin-top: 4px; font-variant-numeric: tabular-nums;
}
.zone-count[data-variant="urgent"] { color: var(--ds-tier-urgent); }
.zone-count[data-variant="warn"] { color: var(--ds-semantic-warn); }
.zone-count[data-variant="ok"] { color: var(--ds-tier-positive); }
.zone-count .unit { font-size: 16px; color: var(--ds-text-muted); font-weight: 400; }

.zone-subtitle {
  font-size: 11px; color: var(--ds-text-muted);
  font-style: italic; margin-top: 2px; line-height: 1.3;
}
.zone-footer {
  padding: 8px 14px; background: var(--ds-page-bg);
  border-top: 0.5px solid var(--ds-border-warm); margin-top: auto;
}
.zone-footer a {
  font-size: 11px; color: var(--ds-text-muted); text-decoration: none;
}
.zone:hover .zone-footer a { color: var(--ds-tier-quarter-focus); }
```

### Data computation

Production zone (most complex):
```typescript
function computeProductionStatus(today: Date) {
  const todayLineItems = lineItems.filter(li => li.date === toISODate(today));
  
  // Group by step to compute "done" count
  const stepGroups = groupBy(todayLineItems, li => li.stepName);
  const totalSteps = Object.keys(stepGroups).length;
  const doneSteps = Object.values(stepGroups).filter(items =>
    items.every(item => item.status === 'done')
  ).length;
  
  // Find the currently in-progress step
  const activeStep = Object.entries(stepGroups).find(([_, items]) =>
    items.some(item => item.status === 'in_progress')
  );
  
  if (activeStep) {
    const [stepName, items] = activeStep;
    const totalMoulds = items.reduce((s, i) => s + i.mouldCount, 0);
    const doneMoulds = items.filter(i => i.status === 'done').reduce((s, i) => s + i.mouldCount, 0);
    const pct = totalMoulds > 0 ? Math.round((doneMoulds / totalMoulds) * 100) : 0;
    
    return {
      status: "in progress",
      statusVariant: pct > 75 ? "ok" : "warn",
      stepsDone: doneSteps,
      stepsTotal: totalSteps,
      currentStepName: stepName,
      currentStepPct: pct,
      nextStepEta: computeNextStepEta(stepGroups, activeStep)
    };
  }
  
  // No active step — either done or idle
  return doneSteps === totalSteps 
    ? { status: "done for today", statusVariant: "ok", stepsDone: totalSteps, stepsTotal: totalSteps }
    : { status: "idle", statusVariant: "info", stepsDone: doneSteps, stepsTotal: totalSteps };
}
```

Stock zone:
```typescript
function computeStockStatus() {
  const belowMin = products.filter(p => p.currentStock < p.minStock).length;
  const ingredientsShort = ingredients.filter(i => i.shortageQty > 0).length;
  return {
    belowMinCount: belowMin,
    ingredientsShortCount: ingredientsShort
  };
}
```

Apply same pattern for all 6 zones. Each zone has its own computation function. All read from existing data hooks (don't introduce new endpoints).

---

## Section 3 — Today's pipeline (horizontal step flow)

Replaces the current 7-card grid with one horizontal row of step pills connected by chevrons.

```tsx
<div className="progress-strip">
  <div className="progress-strip-header">
    <span className="progress-strip-title">Today's pipeline</span>
    <span className="progress-strip-meta">
      {todayBatchCount} batches · {topProductsString} · ends ~{endTimeLabel} ·{" "}
      <Link href="/production-brain/plan">full schedule →</Link>
    </span>
  </div>
  
  <div className="step-flow">
    {orderedSteps.map(step => (
      <StepPill
        key={step.name}
        name={step.name}
        progress={`${step.doneMoulds}/${step.totalMoulds}`}
        meta={
          step.status === "done" ? `done · ${step.completedAt}` :
          step.status === "in_progress" ? "in progress" :
          `~${step.eta}`
        }
        status={step.status}  // "done" | "in_progress" | "pending"
      />
    ))}
  </div>
</div>
```

### StepPill component

```css
.step-pill {
  background: var(--ds-page-bg);
  border: 0.5px solid var(--ds-border-warm);
  border-radius: 4px;
  padding: 8px 10px;
  text-align: center;
  position: relative;
  cursor: pointer;
}
.step-pill[data-status="done"] {
  background: var(--ds-tint-ok);
  border-color: var(--ds-tier-positive);
}
.step-pill[data-status="in_progress"] {
  background: var(--ds-tint-warn);
  border-color: var(--ds-semantic-warn);
}
.step-pill::after {
  content: "›";
  position: absolute;
  right: -7px; top: 50%;
  transform: translateY(-50%);
  color: var(--ds-border-warm);
  font-size: 14px;
}
.step-pill:last-child::after { display: none; }

.step-pill .step-name {
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.step-pill .step-progress {
  font-size: 18px;
  font-family: "Playfair Display", Georgia, serif;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  margin-top: 4px;
}
.step-pill .step-meta {
  font-size: 10px;
  color: var(--ds-text-muted);
  font-style: italic;
  margin-top: 2px;
}
```

Click a step pill → navigates to Plan view with that step filtered.

The `topProductsString` is the same product list currently shown on every step card (e.g., "Apple Walnut, Crunchy Nougat +14"). Show it ONCE in the header instead of repeated on every step.

---

## Section 4 — Body grid (2 columns)

```tsx
<div className="body-grid">
  <div className="body-left">
    <NeedsAttention items={attentionItems} />
    <UpcomingDeadlines orders={overdueOrders} />
  </div>
  <div className="body-right">
    <Next7Days days={weekData} />
    <StockSnapshot products={stockSnapshotProducts} />
    <ActiveCampaigns campaigns={runningCampaigns} />
  </div>
</div>
```

### NeedsAttention

Replaces current right-side "Attention" panel. Uses AttentionItem component from design system.

```tsx
<Section title="Needs attention" action={<a>{attentionItems.length} items</a>}>
  {attentionItems.map(item => (
    <AttentionItem
      key={item.id}
      severity={item.severity}        // "critical" | "warn" | "info" | "ok"
      title={item.title}
      detail={item.detail}
      action={<a href={item.href}>{item.actionLabel} →</a>}
    />
  ))}
</Section>
```

Item compute logic:
```typescript
const attentionItems = [
  overdueOrderCount > 0 && {
    id: "overdue-orders",
    severity: "critical",
    title: `${overdueOrderCount} orders past deadline`,
    detail: "Re-schedule or contact customer",
    href: "/orders?filter=overdue",
    actionLabel: "open"
  },
  ingredientsShortCount > 0 && {
    id: "ingredients-short",
    severity: "warn",
    title: `${ingredientsShortCount} ingredients short`,
    detail: "Place supplier order",
    href: "/shopping",
    actionLabel: "list"
  },
  belowMinCount > 30 && {
    id: "below-min",
    severity: "warn",
    title: `${belowMinCount} products below minimum`,
    detail: "Production Store thinning · consider replen",
    href: "/stock",
    actionLabel: "stock"
  },
  fillingsToCookCount > 0 && {
    id: "fillings-to-cook",
    severity: "info",
    title: `${fillingsToCookCount} fillings to cook this week`,
    detail: fillingNames.join(" · "),
    href: "/pantry/fillings",
    actionLabel: "plan"
  },
  !tempLogCompletedToday && {
    id: "temp-log",
    severity: "warn",
    title: "Temperature log not completed",
    detail: `${devicesNeedingCheck} device needs check`,
    href: "/haccp/temperature",
    actionLabel: "log"
  }
].filter(Boolean);
```

### UpcomingDeadlines

```tsx
<Section title="Upcoming deadlines" action={<Link href="/orders">all orders →</Link>}>
  {topOverdueOrders.slice(0, 5).map(order => (
    <ListRow
      key={order.id}
      tier={order.daysOverdue > 0 ? "urgent" : "default"}
      title={`${order.customerName} · #${order.orderNumber}`}
      meta={`${order.totalPieces} pcs · ${order.topProducts.join(", ")}`}
      right={
        order.daysOverdue > 0
          ? <span className="days-overdue">{order.daysOverdue}d overdue</span>
          : <span className="text-meta">{formatDate(order.dueDate)}</span>
      }
      onClick={() => router.push(`/orders/${order.id}`)}
    />
  ))}
</Section>
```

Show top 5 by `daysOverdue` desc, then by `dueDate` asc.

### Next7Days

```tsx
<Section title="Next 7 days" action={<Link href="/production-brain/plan">full plan →</Link>}>
  <div className="mini-week">
    {next7Days.map(day => (
      <MiniDay
        key={day.iso}
        label={day.dayName}              // "Di"
        num={day.dayNum}                  // "12"
        isToday={day.isToday}
        capacityPct={day.capacityPct}
        capacityVariant={day.capacityVariant}  // "ok" | "warn" | "over"
        batchCount={day.batchCount}
        onClick={() => router.push(`/production-brain/daily?date=${day.iso}`)}
      />
    ))}
  </div>
</Section>
```

```css
.mini-week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
  padding: 12px 18px;
}
.mini-day {
  text-align: center;
  padding: 8px 4px;
  border-radius: 4px;
  border: 0.5px solid var(--ds-border-warm);
  cursor: pointer;
}
.mini-day:hover { background: var(--ds-card-bg-hover); }
.mini-day[data-today="true"] {
  background: var(--ds-today-tint);
  border-color: var(--ds-tier-quarter-focus);
}
.mini-day-label {
  font-size: 10px; color: var(--ds-text-muted);
  text-transform: uppercase; letter-spacing: 0.05em;
}
.mini-day-num {
  font-size: 14px; font-weight: 500;
  margin-top: 2px; font-variant-numeric: tabular-nums;
}
.mini-day-bar {
  height: 2px; background: var(--ds-border-warm);
  margin-top: 6px; border-radius: 1px; overflow: hidden;
}
.mini-day-fill[data-variant="ok"] { background: var(--ds-tier-positive); }
.mini-day-fill[data-variant="warn"] { background: var(--ds-semantic-warn); }
.mini-day-fill[data-variant="over"] { background: var(--ds-tier-urgent); }
.mini-day-batches {
  font-size: 10px; color: var(--ds-text-muted);
  font-style: italic; margin-top: 4px;
  font-variant-numeric: tabular-nums;
}
```

### StockSnapshot

5 products sorted by urgency (critical → low → ok):

```tsx
<Section title="Stock snapshot" action={<Link href="/stock">full stock →</Link>}>
  {stockSnapshotProducts.map(product => (
    <ListRow
      key={product.id}
      tier={product.severity}  // "urgent" | "warn" | "default"
      title={product.name}
      meta={`${product.currentStock} in stock · ${product.demand} pcs demand`}
      right={
        <span className={`status-tag ${product.severity}`}>
          {product.severity === "urgent" ? "critical" :
           product.severity === "warn" ? "low" : "ok"}
        </span>
      }
      onClick={() => router.push(`/stock/${product.id}`)}
    />
  ))}
</Section>
```

Selection logic: sort all products by `(severity, demand desc)` and take top 5.

### ActiveCampaigns

```tsx
<Section title="Active campaigns" action={<Link href="/campaigns">all {campaignCount} →</Link>}>
  {topCampaigns.slice(0, 3).map(campaign => (
    <ListRow
      key={campaign.id}
      tier={campaign.daysToDeadline < 3 ? "urgent" : "default"}
      title={campaign.name}
      meta={`${campaign.batchCount} batches · ${campaign.status} · ${campaign.deadlineLabel}`}
      right={
        campaign.daysToDeadline >= 0 && campaign.daysToDeadline < 7
          ? <span className="days-overdue">{campaign.daysToDeadline}d left</span>
          : <span className="text-meta">{campaign.statusLabel}</span>
      }
      onClick={() => router.push(`/campaigns/${campaign.id}`)}
    />
  ))}
</Section>
```

Sort by `(daysToDeadline asc, batchCount desc)` and show top 3.

---

## Status tag styling

```css
.status-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  border: 0.5px solid var(--ds-border-warm);
  background: var(--ds-card-bg);
  color: var(--ds-text-muted);
}
.status-tag.urgent, .status-tag.critical {
  color: var(--ds-tier-urgent);
  border-color: var(--ds-tier-urgent);
}
.status-tag.warn, .status-tag.low {
  color: var(--ds-semantic-warn);
  border-color: var(--ds-semantic-warn);
}
.status-tag.ok {
  color: var(--ds-tier-positive);
  border-color: var(--ds-tier-positive);
}
.days-overdue {
  color: var(--ds-tier-urgent);
  font-weight: 500;
  font-size: 11px;
}
```

---

## Files to touch

```
src/app/page.tsx (or app/dashboard/page.tsx)
  └─ Replace entire body with new layout

src/components/dashboard/zone-grid.tsx          [NEW]
src/components/dashboard/pipeline-flow.tsx      [NEW]
src/components/dashboard/needs-attention.tsx    [NEW]
src/components/dashboard/upcoming-deadlines.tsx [NEW]
src/components/dashboard/next-7-days.tsx        [NEW]
src/components/dashboard/stock-snapshot.tsx     [NEW]
src/components/dashboard/active-campaigns.tsx   [NEW]

src/components/dulceria/zone-card.tsx           [NEW — extend design system]
src/components/dulceria/step-pill.tsx           [NEW — extend design system]
src/components/dulceria/mini-day.tsx            [NEW — extend design system]
src/components/dulceria/index.ts                [update barrel export]

src/lib/dashboard/compute-zones.ts              [NEW — zone computation logic]
src/lib/dashboard/compute-attention.ts          [NEW]
src/lib/dashboard/compute-pipeline.ts           [NEW]

DELETE:
- The old stat-card-with-pastel-fill components
- The 7-step grid card component (replaced by horizontal flow)
- The old "Attention" panel with alternating pastel fills
```

---

## Data sources

All from existing hooks. No new endpoints required.

- `useProductionDayLineItems` — for pipeline + capacity
- `useOrders` — for overdue counts + customers
- `useProducts` + `usePlanProducts` — for stock + demand
- `useIngredients` — for ingredient shortage
- `useCampaigns` — for campaigns
- `useCapacityConfig` — for daily capacity
- `useHaccpLogs` (or equivalent) — for compliance

If any of these don't exist, surface as deferred item and compute from raw queries instead.

---

## Verify checklist

Open dashboard after retrofit. Walk through:

1. ✓ Header: one row, ~70px tall. Title + meta + actions.
2. ✓ NO pastel-filled stat cards anywhere on page.
3. ✓ 6 zone cards across the top, each ~120px tall.
4. ✓ Each zone has: label (uppercase 10px), status badge (10px colored), big number (Playfair 32px), subtitle (12px italic), footer link.
5. ✓ Zone accents = left-border only (3px), NOT background fill.
6. ✓ Today's pipeline = single horizontal row with 7 step pills + chevrons.
7. ✓ Done step = mint tint + mint border.
8. ✓ Active step = caramel tint + caramel border.
9. ✓ Pending steps = white with default border.
10. ✓ NO "STANDARD / STANDARD / NUT" tags on step pills.
11. ✓ Product list "Apple Walnut, Crunchy Nougat +14" shown ONCE in pipeline header, not on every step.
12. ✓ Body has two columns: Attention + Deadlines (left), Week + Stock + Campaigns (right).
13. ✓ Attention items use AttentionItem component (white card + colored left border, NOT pastel fill).
14. ✓ Mini-week shows 7 day cells. Today highlighted with cream + deep teal border.
15. ✓ Stock snapshot shows 5 products with critical/low/ok tags.
16. ✓ Active campaigns shows 3 with urgency tags.
17. ✓ All icons are Tabler outline.
18. ✓ No drop shadows.
19. ✓ No gradients.
20. ✓ Tabular figures on ALL numbers.

---

## What NOT to do

- DO NOT defer this page citing "iOS-glass exception"
- DO NOT keep ANY pastel-filled card backgrounds
- DO NOT keep the redundant product list lines on every step card
- DO NOT keep STANDARD/STANDARD/NUT tags
- DO NOT use lucide-react — use @tabler/icons-react via DsIcon
- DO NOT defer "per-page audit" — this IS the per-page audit for the dashboard
- DO NOT skip the ZoneCard / StepPill / MiniDay components if they don't exist — build them
- DO NOT add visual flourishes (animations, gradients, glass) not in this spec

---

## Honest deferred items (out of v1)

These came up during design but are NOT in this spec:

1. **Equipment status zone** — equipment model exists but scheduler ignores it. Until scheduler integrates equipment, no real signal to show.
2. **Revenue / financial KPIs** — not in the morning status-check goal. Belongs on a separate financial dashboard.
3. **Mobile responsive** — design system works on desktop. Mobile audit is its own pass.
4. **Real-time WebSocket updates for "Painting in progress 2/16"** — initial v1 reads on page load + periodic refetch. WebSocket later.
5. **Zone customization (drag to reorder)** — fixed 6 zones in v1. User customization is v2.
6. **Localization (DE/EN toggle)** — labels are EN in this spec, DE labels can come later. The dateLabel uses German locale already.

---

**End of spec.**
