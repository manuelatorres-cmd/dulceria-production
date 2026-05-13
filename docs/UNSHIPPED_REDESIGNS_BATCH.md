# Unshipped redesigns — batch spec

One spec covering everything designed but not yet shipped to production app. Ship in the order listed. Each section is independent — phase boundaries shown.

Reference mockups (save all to `/docs/`):
- `workshop-dashboard.html`
- `campaigns-redesign.html`
- `pantry-redesign.html`
- `sidebar-redesign.html`

Reference specs already in /docs/ that this builds on:
- `PRODUCTION_APP_DESIGN_SYSTEM.md` (foundation — already shipped)
- `SIDEBAR_INVENTORY_2026-05-13.md` (route inventory)

Total scope: 4 redesigns, ~25 phases. Evidence-per-item on every commit. No silent partial shipments.

---

## REDESIGN 1 — SIDEBAR (global navigation)

Replaces the per-space drawer pattern with a single unified sidebar where all 6 spaces stay visible and active space auto-expands.

**Why this first:** all other redesigns reference sidebar items. Doing this first means subsequent redesigns are tested against the new nav.

### Phase 1.1 — Config + components

NEW FILES:

`src/lib/layout/sidebar-config.ts`:

```typescript
export interface SidebarSubItem {
  label: string;
  href: string;
  icon: string;
  badgeKey?: BadgeKey;
}

export interface SidebarSubGroup {
  label: string;
  items: SidebarSubItem[];
}

export interface SidebarSpace {
  id: string;
  label: string;
  icon: string;
  defaultHref: string;
  groups: SidebarSubGroup[];
}

export type BadgeKey =
  | "orders.overdue"
  | "picking.ready"
  | "haccp.incomplete"
  | "stock.belowMin"
  | "ingredients.short"
  | "campaigns.urgent";

export const SIDEBAR_CONFIG: SidebarSpace[] = [
  {
    id: "workshop",
    label: "Workshop",
    icon: "clipboard",
    defaultHref: "/workshop",
    groups: [
      {
        label: "Work queue",
        items: [
          { label: "Orders", href: "/orders", icon: "list", badgeKey: "orders.overdue" },
          { label: "Picking", href: "/picking", icon: "package", badgeKey: "picking.ready" },
          { label: "Production orders", href: "/production-orders", icon: "clipboard-list" }
        ]
      },
      {
        label: "Schedule",
        items: [
          { label: "Calendar (month)", href: "/calendar", icon: "calendar" },
          { label: "Plan (week)", href: "/plan?view=weekly", icon: "layout-grid" },
          { label: "Daily", href: "/production-brain/daily", icon: "calendar-event" }
        ]
      },
      {
        label: "Planning tools",
        items: [
          { label: "Planner (replen)", href: "/production-brain/planner", icon: "layout-board-split" },
          { label: "Manual planner", href: "/production-brain/manual", icon: "edit" },
          { label: "Needed vs stock", href: "/production-brain/needed", icon: "list-check" }
        ]
      },
      {
        label: "Resources",
        items: [
          { label: "Stock", href: "/stock", icon: "box", badgeKey: "stock.belowMin" },
          { label: "Equipment", href: "/production-brain/equipment", icon: "settings" },
          { label: "HACCP", href: "/production-brain/haccp", icon: "alert-triangle", badgeKey: "haccp.incomplete" }
        ]
      },
      {
        label: "Campaigns",
        items: [
          { label: "Campaigns", href: "/campaigns", icon: "rocket", badgeKey: "campaigns.urgent" }
        ]
      }
    ]
  },
  
  {
    id: "pantry",
    label: "Pantry",
    icon: "book",
    defaultHref: "/products",
    groups: [
      {
        label: "Catalog",
        items: [
          { label: "Products", href: "/products", icon: "package" },
          { label: "Variants", href: "/variants", icon: "tag" }
        ]
      },
      {
        label: "Recipe building blocks",
        items: [
          { label: "Ingredients", href: "/ingredients", icon: "droplet", badgeKey: "ingredients.short" },
          { label: "Fillings", href: "/fillings", icon: "layers" },
          { label: "Decoration", href: "/decoration", icon: "brush" }
        ]
      },
      {
        label: "Production materials",
        items: [
          { label: "Moulds", href: "/moulds", icon: "layout-grid" },
          { label: "Packaging", href: "/packaging", icon: "box" }
        ]
      }
    ]
  },
  
  {
    id: "shop",
    label: "Shop",
    icon: "shopping-bag",
    defaultHref: "/shop",
    groups: [
      {
        label: "",
        items: [
          { label: "Overview", href: "/shop", icon: "home" }
        ]
      },
      {
        label: "Daily operations",
        items: [
          { label: "Counter (custom box)", href: "/shop/counter", icon: "credit-card" },
          { label: "Daily count", href: "/shop/daily-count", icon: "list" }
        ]
      },
      {
        label: "Stock movements",
        items: [
          { label: "Transfer in", href: "/shop/transfer-in", icon: "arrow-down" },
          { label: "Stock out", href: "/shop/stock-out", icon: "arrow-up" },
          { label: "Monthly count", href: "/shop/monthly-count", icon: "list-numbers" }
        ]
      }
    ]
  },
  
  {
    id: "customers",
    label: "Customers",
    icon: "users",
    defaultHref: "/customers",
    groups: [
      {
        label: "",
        items: [
          { label: "Customer list", href: "/customers", icon: "users" },
          { label: "Quotes", href: "/quotes", icon: "file-text" },
          { label: "Price lists", href: "/price-lists", icon: "list" },
          { label: "Subscriptions", href: "/subscriptions", icon: "refresh" }
        ]
      }
    ]
  },
  
  {
    id: "observatory",
    label: "Observatory",
    icon: "chart-bar",
    defaultHref: "/observatory",
    groups: [
      {
        label: "Performance",
        items: [
          { label: "Sales (weekly)", href: "/observatory/sales", icon: "trending-up" },
          { label: "Monthly review", href: "/observatory/monthly", icon: "calendar" },
          { label: "Stats", href: "/observatory/stats", icon: "chart-line" }
        ]
      },
      {
        label: "Economics",
        items: [
          { label: "Pricing (cost + margin)", href: "/observatory/pricing", icon: "currency-euro" },
          { label: "Product cost", href: "/observatory/product-cost", icon: "calculator" }
        ]
      },
      {
        label: "Data",
        items: [
          { label: "CSV imports", href: "/observatory/imports", icon: "upload" }
        ]
      }
    ]
  },
  
  {
    id: "lab",
    label: "Lab",
    icon: "flask",
    defaultHref: "/lab",
    groups: [
      {
        label: "",
        items: [
          { label: "Data audit", href: "/lab/audit", icon: "shield-check" },
          { label: "Product Lab", href: "/lab", icon: "flask" }
        ]
      }
    ]
  }
];

export const UTILITY_ITEMS: SidebarSubItem[] = [
  { label: "Shopping", href: "/shopping", icon: "shopping-cart" },
  { label: "Workshop wall", href: "/wall", icon: "device-tv" },
  { label: "Settings", href: "/settings", icon: "settings" }
];
```

**Verify each `href` against the inventory.** If any route differs, update the config. Critical:
- `Plan (week)` MUST use `/plan?view=weekly` (query-param view switching)
- `Daily` is `/production-brain/daily` (NOT `/daily`)
- `Planner` is `/production-brain/planner`
- `Manual planner` is `/production-brain/manual`
- `Needed vs stock` is `/production-brain/needed`
- `Equipment` is `/production-brain/equipment`
- `HACCP` is `/production-brain/haccp`

**NOT in config (intentional):**
- `/calculator` — legacy redirect to /lab
- `/library` — fold into Pantry overview (separate task)
- `/collections` — derived from variants only
- `/production-brain` (hub) — sub-pages cover it
- `/production-brain/dashboard` — second variant, accessible from main dashboard

NEW FILES — components:

```
src/components/layout/sidebar.tsx
src/components/layout/sidebar-space.tsx
src/components/layout/sidebar-subitem.tsx
src/components/layout/sidebar-utility.tsx
src/lib/layout/sidebar-badges.ts
src/hooks/use-sidebar-state.ts
```

Implementation pattern in `sidebar.tsx`:

```tsx
export function Sidebar() {
  const pathname = usePathname();
  const { expandedSpaces, toggleSpace } = useSidebarState();
  const badges = useSidebarBadges();
  
  return (
    <aside className="sidebar">
      <div className="sb-logo"><span className="sb-logo-text">Dulceria</span></div>
      
      <Link href="/dashboard" className={cn("sb-home", { active: pathname === "/dashboard" })}>
        <DsIcon name="home" size={16} />
        <span>Dashboard</span>
      </Link>
      
      <div className="sb-spaces-label">Spaces</div>
      
      {SIDEBAR_CONFIG.map(space => (
        <SidebarSpace
          key={space.id}
          space={space}
          expanded={expandedSpaces.has(space.id)}
          activeRoute={pathname}
          badges={badges}
          onToggle={() => toggleSpace(space.id)}
        />
      ))}
      
      <div className="sb-bottom">
        {UTILITY_ITEMS.map(item => (
          <SidebarUtility key={item.href} item={item} active={pathname === item.href} />
        ))}
      </div>
      
      <UserFooter />
    </aside>
  );
}
```

`useSidebarState.ts` — auto-expand parent on route change, allow multi-expand:

```typescript
export function useSidebarState() {
  const pathname = usePathname();
  const [manuallyToggled, setManuallyToggled] = useState<Set<string>>(new Set());
  
  const autoExpanded = useMemo(() => {
    const set = new Set<string>();
    for (const space of SIDEBAR_CONFIG) {
      const inSpace = space.groups.some(g =>
        g.items.some(i => pathname === i.href.split("?")[0] || pathname.startsWith(i.href.split("?")[0] + "/"))
      );
      if (inSpace) set.add(space.id);
    }
    return set;
  }, [pathname]);
  
  const expandedSpaces = useMemo(() => {
    return new Set([...autoExpanded, ...manuallyToggled]);
  }, [autoExpanded, manuallyToggled]);
  
  const toggleSpace = (id: string) => {
    setManuallyToggled(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  
  return { expandedSpaces, toggleSpace };
}
```

Styling tokens (add to global stylesheet):

```css
.sidebar {
  background: #1a3433;
  color: rgba(255,255,255,0.85);
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-radius: 0 12px 12px 0;
  overflow-y: auto;
  height: 100vh;
  position: sticky;
  top: 0;
}
.sb-logo { padding: 16px 20px; border-bottom: 0.5px solid rgba(255,255,255,0.08); }
.sb-logo-text { font-family: "Playfair Display", Georgia, serif; font-size: 20px; font-weight: 600; color: white; }

.sb-home {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 20px;
  color: rgba(255,255,255,0.85); font-size: 13px; text-decoration: none;
  border-bottom: 0.5px solid rgba(255,255,255,0.08);
}
.sb-home:hover { background: rgba(255,255,255,0.04); }
.sb-home.active { background: rgba(255,255,255,0.1); color: white; }

.sb-spaces-label {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em;
  color: rgba(255,255,255,0.3); padding: 14px 20px 6px; font-weight: 600;
}

.sb-space {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 20px;
  color: rgba(255,255,255,0.85); font-size: 13px;
  cursor: pointer; background: transparent; border: none;
  text-align: left; width: 100%; font-family: inherit;
}
.sb-space:hover { background: rgba(255,255,255,0.04); }
.sb-space.active { background: rgba(255,255,255,0.1); color: white; font-weight: 500; }
.sb-space-chevron { margin-left: auto; font-size: 10px; color: rgba(255,255,255,0.45); }

.sb-subsection { background: #142827; }
.sb-subgroup-label {
  font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em;
  color: rgba(255,255,255,0.3); padding: 10px 20px 4px 36px; font-weight: 600;
}
.sb-subitem {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 20px 6px 36px;
  color: rgba(255,255,255,0.45); font-size: 12.5px;
  text-decoration: none; cursor: pointer;
}
.sb-subitem:hover { background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.85); }
.sb-subitem.active {
  color: white; background: rgba(255,255,255,0.04);
  border-left: 2px solid #5dcaa5; padding-left: 34px;
}

.sb-subitem-badge {
  margin-left: auto; background: #993556; color: white;
  font-size: 9px; padding: 1px 6px; border-radius: 8px; font-weight: 600;
}
.sb-subitem-badge.warn { background: #dab73f; color: #142827; }
.sb-subitem-badge.ok { background: #5dcaa5; color: #142827; }

.sb-bottom { margin-top: auto; border-top: 0.5px solid rgba(255,255,255,0.08); padding: 8px 0; }
.sb-user {
  padding: 12px 20px; border-top: 0.5px solid rgba(255,255,255,0.08);
  display: flex; align-items: center; gap: 10px;
  font-size: 11px; color: rgba(255,255,255,0.45);
}
.sb-user-email { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

Keep old sidebar code in place temporarily — both can live in parallel during Phase 1.

### Phase 1.2 — Replace existing sidebar

- Switch layout to use new `Sidebar` component
- Delete `space-sidebar.tsx` and any per-space drawer logic
- Delete the "‹ Dashboard" tiny back-link
- Verify all routes still navigable
- Verify active states work for all pages

### Phase 1.3 — Badges (live status)

Build `useSidebarBadges` hook. Use existing hooks where possible:

```typescript
export function useSidebarBadges(): Record<BadgeKey, BadgeData | null> {
  const { data: orders } = useOrders();
  const { data: picking } = usePickingQueue();
  const { data: haccpStatus } = useHaccpToday();
  const { data: stock } = useStockBelowMin();
  const { data: ingredients } = useIngredientsShort();
  const { data: campaigns } = useCampaignsUrgent();
  
  return {
    "orders.overdue": orders ? { count: orders.filter(o => o.daysOverdue > 0).length, variant: "urgent" } : null,
    "picking.ready": picking ? { count: picking.filter(p => p.status === "ready").length, variant: "ok" } : null,
    "haccp.incomplete": haccpStatus ? { count: haccpStatus.incompleteCount, variant: "warn" } : null,
    "stock.belowMin": stock ? { count: stock.length, variant: stock.length > 20 ? "urgent" : "warn" } : null,
    "ingredients.short": ingredients ? { count: ingredients.length, variant: "warn" } : null,
    "campaigns.urgent": campaigns ? { count: campaigns.length, variant: "warn" } : null
  };
}
```

If a hook doesn't exist for a badge, defer that specific badge (show no badge) — flag as deferred. Don't block phase ship.

Badges should:
- Show only when count > 0
- Refetch every 60s while sidebar mounted
- Render at right edge of sub-item
- Use status colors: rose urgent / caramel warn / mint ok

### Phase 1.4 — Polish

- Persist `manuallyToggled` in localStorage (optional)
- Verify mobile/tablet behavior — sidebar collapses to drawer/hamburger
- Confirm keyboard accessibility (tab through items)

---

## REDESIGN 2 — WORKSHOP DASHBOARD

Target route: `/workshop`
Reference mockup: `workshop-dashboard.html`

Replaces the current "Active batches" page (which actually shows 6 drafts) with an operational dashboard answering "what's running NOW and what resources do I have."

Different from main dashboard (`/dashboard` — cross-business status) and different from `/plan` (the planned schedule). This is operational reality.

### Phase 2.1 — Page scaffolding + page header

`src/app/(app)/workshop/page.tsx`

Replace existing content. New structure:

```
<PageHeader>
  <h1>Workshop</h1>
  <meta>{currentTime} · {nowStepLabel} · {slackRemaining} slack remaining today</meta>
  <actions>
    <badge variant="warn">{attentionCount} attention</badge>
    <button>New batch</button>
    <button primary>Quick add to today</button>
  </actions>
</PageHeader>
```

`currentTime` = formatted current time (08:14 style)
`nowStepLabel` = if active batch exists "Painting in progress", else "Workshop idle"
`slackRemaining` = computed from capacityConfig - today's planned hours
`attentionCount` = sum of HACCP incomplete + stock-blocked batches

### Phase 2.2 — NOW bar (top, full width)

Single most important strip on the page. Pinned at top.

States:

**A — Active batch in progress:**
```
[caramel left border, caramel tint bg]
NOW IN PROGRESS
{stepName} · {productName}
{moulds done}/{total} moulds · {elapsed} elapsed · ~{remaining} remaining · ends ~{endTime}
{progressPct}% [progress bar] [Pause] [Mark step done] [Open daily →]
```

**B — Workshop idle, next batch later today:**
```
[default border]
WORKSHOP IDLE
Next batch at {nextBatchTime} — {nextBatchName}
[empty progress] [Open daily →]
```

**C — All done for today:**
```
[mint left border]
ALL DONE FOR TODAY
{batchCount} batches completed · {totalMinutes} active minutes
[Close production day →]
```

Data needed:
- Current step from active `productionDayLineItem`
- `step.startedAt` timestamp for elapsed (defer if not tracked, fall back to "estimated ~Nm")
- "Mark step done" mutation (likely exists)

**Defer flag:** if `step.startedAt` doesn't exist as a column, omit elapsed/remaining time and show only step name + progress count. Flag deferred with reason in commit.

### Phase 2.3 — Utilization strip (4 cards)

4 equal-width cards. Use new `ZoneCard` component (or extend existing `StatCard`). White bg, 3px colored left border, NO pastel fills.

```
1. TODAY'S CAPACITY     warn border
   8h / 14h             value (serif, 28px)
   [bar 57%]            caramel fill
   5h slack · 1 production day open

2. MOULDS IN USE        warn border
   1 / 8                
   [bar 13%]
   3-cav booked · 7 moulds free

3. INGREDIENTS          urgent border
   12 short
   [bar showing severity]
   blocks 3 planned batches · order today

4. READY TO PACK        mint border
   2
   [bar 100%]
   3 batches unmoulded · pack today
```

Data sources:
- Capacity: `capacityConfig` singleton + sum of today's `plannedMinutes`
- Moulds: count distinct moulds in active `planProducts` for today / `moulds.quantityOwned`
- Ingredients: existing "short ingredients" query (used by main dashboard)
- Ready to pack: orders where status='unmoulded' or production complete but not picked

If a data source doesn't exist, render the card with "—" value and flag deferred.

### Phase 2.4 — Main grid (2-column body)

```
[left 60% — Active batches + drafts]
[right 40% — Moulds + Ready to pack + Compliance]
```

**Left column:**

Section 1 — Active in workshop now

Table-like rows, each with:
- Status indicator (● = active, ✓ = done, default for queued)
- Batch name + parent order/PO meta
- Current step + sub-meta (e.g., "2/16 moulds")
- ETA time

Row states (colored left border):
- Active: caramel border, caramel tint bg
- Next: deep teal border (the queued-next batch)
- Queued: default border
- Done: mint border, 60% opacity, ✓ prefix

Section 2 — Draft batches awaiting decision

Compact list (using `ListRow` component from design system). Shows up to 4 drafts + "+ N more drafts" if >4.

Each draft row:
- Name + "created Nd ago · not scheduled"
- "review →" action

**Right column:**

Section 3 — Mould occupancy

2-column grid of mould tiles (smaller than current mould cards on `/moulds` page). Each tile:
- Mould name (3-cav, Filled, Bar, etc.)
- Current state meta (batch name + qty, or "no batch assigned", or "drying · until tomorrow")
- Status pill: in use / free / blocked

Left border colors: caramel (in use), mint (free), rose (blocked).

Data: query active `planProducts` for today grouped by `mouldId`. Mould `blocked/drying` state may not exist — for v1, just show in-use vs free. Flag deferred for drying state.

Section 4 — Ready to pack

Compact list of orders/batches that finished unmoulding. Each row:
- Customer email + order number
- Item summary (qty + first product + "+N")
- Right-side: due date / overdue indicator

Section 5 — Compliance today

3 compact rows:
- Temperature log
- Calibration checks
- Cleaning log

Each shows status: "log now" (warn) / "ok" / "incomplete". Only renders if HACCP module has data; defer entire section if not.

### Phase 2.5 — Quick actions row (bottom)

Keep the 4 button row at page bottom:
- New order
- Open planner
- Stock
- Campaigns

Style consistent with rest (white bg, Tabler outline icons, no big colored boxes).

### Phase 2.6 — Wire up real data + remove old layout

- Verify each section has live data
- Delete old `/workshop` page content
- Remove deprecated KPI components if no other page uses them

---

## REDESIGN 3 — CAMPAIGNS (list + detail)

Reference mockup: `campaigns-redesign.html`

Two pages, two routes:
- `/campaigns` — list
- `/campaigns/[id]` — detail

### Phase 3.1 — Campaigns list page

Target route: `/campaigns`
File: `src/app/(app)/campaigns/page.tsx`

**Page header:**
```
Campaigns
Seasonal boxes, limited editions, launches · {total} total · {active} active · {urgent} urgent

[badge: N urgent] [Calendar view] [+ New campaign]
```

**Filter row** (compressed):
```
PILLS: All / Active / Planned / Done / Seasonal / Launch / Market event
+ search input on right
```

**Sections** (rendered as `Section` from design system with serif label + count):

For each section (Active / Planned / Done), render `CampaignCard` grid (3 columns).

**CampaignCard component** (new):

```tsx
<CampaignCard variant={status}>
  <CampaignCardHeader>
    <name>Veganmania</name>
    <typeTag variant="market">market</typeTag>
  </CampaignCardHeader>
  <dates>
    <strong>04 Jun → 07 Jun 2026</strong> · 23 days away
  </dates>
  <stats>
    <stat>20 products</stat>
    <stat>12 batches planned</stat>
    <stat>0 done</stat>
  </stats>
  <progressBar value={pct} variant={status} />
  <footer>
    <statusText variant={status}>production starts in 7 days</statusText>
    <span>{pct}%</span>
  </footer>
</CampaignCard>
```

Variant logic:
- `urgent` (rose border) — production deadline within 7 days AND <50% complete
- `warn` (caramel border) — production starting within 14 days
- `active` (deep teal border) — in window, on track
- `planned` (gray border) — not started, far future
- `done` (mint border, dimmed) — past launch date, status=shipped

Type tag colors:
- `seasonal` — blush
- `launch` — deep teal
- `market_event` — caramel

Empty `done` section: optional "+ new planned campaign" dashed card at end of Planned section.

**Data needed per card:**
- `products.length` from campaign
- `productionPlans.count` linked to campaign
- `productionDayLineItems.filter(status='done').count` for "done" stat
- Status text computed from dates + progress

If `productionPlans` linkage doesn't exist on campaigns, display "—" for batches planned and flag deferred.

### Phase 3.2 — Campaign detail page

Target route: `/campaigns/[id]`
File: `src/app/(app)/campaigns/[id]/page.tsx`

**Page header:**
```
‹ Campaigns

{Campaign name}
[typeTag] · {dateRange} · {daysToLaunch} days to launch · production starts {prodStart}

[Edit] [Production schedule →] [Plan in /plan →]
```

**NEXT UP banner** (new component, caramel tint card):

```tsx
<NextUpBanner>
  <label>⏵ NEXT UP</label>
  <title serif>Start Polishing on Pistachio Chocolate Bar</title>
  <meta>7 batches scheduled · ramp starts 30 May (18 days from today)</meta>
  <action primary>Start now</action>
</NextUpBanner>
```

Logic for what shows:
- If campaign has unstarted batches: "Start {firstStep} on {firstProduct}"
- If campaign is in production window: "Continue {currentStep} on {activeProduct}"
- If overdue: rose banner "Behind schedule — {n} batches not started"
- If complete: hide banner entirely

**Timeline strip** (new component):

```
CAMPAIGN TIMELINE                    {status text}

[========== timeline bar ===========]
            ↑                   ↑          ↑
         today 12 May      production  launch
                          30 May      4 Jun
```

- Background: page bg color
- Elapsed shading from start to today (10% opacity teal)
- Today marker: rose 2px vertical line
- Production start marker: deep teal 2px vertical line
- Launch marker: deep teal 2px vertical line
- Each marker has a label below

Data: 4 dates needed — campaign start, production start, today, campaign end (= launch). Compute % positions on bar.

**KPI strip** (4 cards using existing `StatCard`):

1. Products in campaign — count + sub-meta "{categoryCount} category · {categoryName}"
2. Batches planned — count + sub-meta "in /plan · auto-scheduled"
3. Production progress — percentage + sub-meta "{done}/{total} steps complete" + warn variant if 0% and production due soon
4. Days to launch — count + sub-meta "deadline {launchDate} · {onTimeStatus}"

NO pastel-filled backgrounds. White cards with colored left borders only.

**Products & production steps section:**

```tsx
<Section title="Products & production steps">
  <Actions>
    add product → · expand all → · open in /plan
  </Actions>
  
  {categories.map(cat => (
    <CategoryBlock>
      <CategoryHeader>
        <name>{cat.name} · {cat.products.length} products</name>
        <meta>{cat.stepsTotal} steps total · {cat.stepsDone}/{cat.stepsTotal} done · {cat.avgPct}% avg</meta>
        <statusPill>{categoryStatus}</statusPill>
      </CategoryHeader>
      
      {cat.products.map(p => (
        <ProductRow>
          <main>
            <name>{p.name}</name>
            <meta>{mould} · {pcsPerRun} pcs/run · {batchCount} batches planned · ~{totalHours}h total</meta>
          </main>
          <step>
            <stepName>{nextStep}</stepName>
            <stepMeta>starts {startDate}</stepMeta>
          </step>
          <progress>
            <bar value={pct} />
            <pct>{pct}%</pct>
          </progress>
        </ProductRow>
      ))}
    </CategoryBlock>
  ))}
</Section>
```

Row left-border color: in-progress (caramel) / done (mint, dimmed) / not-started (transparent).

**Replace existing** `/campaigns/[id]` page entirely. Existing has 4 pastel KPI cards, simple progress bar section, basic category groups. New version has all of the above plus the NEXT UP banner and timeline strip which don't exist today.

---

## REDESIGN 4 — PANTRY PAGES (all 7)

Reference mockup: `pantry-redesign.html`

7 pages, 4 different layout patterns. All share the design system (typography, colors, spacing tokens, page header, filter pills).

### Phase 4.1 — Products page (visual grid)

Target route: `/products`
File: `src/app/(app)/products/page.tsx`

**Page header:**
```
Products
{total} products across {categories} categories · {lowStockCount} low stock

[Categories] [Import] [+ New product]
```

**Toolbar:**
- Search input (left, flex 1)
- Filters button (right)

**Pill rows:**
- CATEGORY: All / Bar / Bar filled / Moulded / Special / Toasty (with counts)
- AVOID (allergens): Cereals/gluten / Peanuts / Soybeans / Hazelnuts / Walnuts / Pistachio nuts / Alcohol

**Category sections** (serif headers):

```tsx
<CategorySection title={category.name} count={`${category.products.length} products${lowCount ? ` · ${lowCount} low stock` : ""}`}>
  <ProductsGrid>
    {products.map(p => <ProductCard product={p} />)}
    <AddCard label="new {category} product" />
  </ProductsGrid>
</CategorySection>
```

**ProductsGrid:**
```css
display: grid;
grid-template-columns: repeat(6, 1fr);
gap: 8px;
```

Responsive: 6 cols on wide / 5 on medium / 4 on tablet / 2 on mobile.

**ProductCard component** (new):

```tsx
<ProductCard variant={stockVariant}>
  <ProductImage>
    {photoUrl ? <img src={photoUrl} /> : <letter>{name[0]}</letter>}
    <StockBadge variant={stockVariant}>{stockLabel}</StockBadge>
  </ProductImage>
  <ProductBody>
    <name>{name}</name>
    <recipe>{recipeIngredients.join(" · ")}</recipe>
    <AllergenDots>
      {allergens.map(a => <AllergenDot type={a} />)}
    </AllergenDots>
  </ProductBody>
</ProductCard>
```

Card sizing (compact):
- aspect-ratio 1 for image
- 8-10px padding for body
- 12px name, 10px recipe
- 14px allergen dots
- 2px left border accent (urgent/warn/none)

Stock variants:
- `out` — urgent left border + "out · 0" badge
- `low` — warn left border + "low · N" badge
- `in` — no border accent + "in stock" badge (mint text)

**AllergenDot component** (new, reusable across Pantry):

```tsx
<AllergenDot type="gluten" />  // GL · caramel bg
<AllergenDot type="nuts" />    // NT · brown bg
<AllergenDot type="soy" />     // SY · mint bg
<AllergenDot type="alcohol" /> // AC · rose bg
<AllergenDot type="dairy" />   // DY · blush bg
```

Hover shows full allergen name. Click filters Products page by that allergen.

**Killed from existing page:**
- Tag soup (Bar, Standard, Campaign, Cereals containing gluten...)
- "10d ago" timestamp (move to detail page)
- Long thin rows
- Letter avatar AND empty box duplication

### Phase 4.2 — Fillings page (info cards)

Target route: `/fillings`
File: `src/app/(app)/fillings/page.tsx`

**Page header:**
```
Fillings
{total} fillings across {categories} categories · {ganacheCount} ganaches, {caramelCount} caramels, {fruitCount} fruit gels

[Categories] [+ New filling]
```

**Pills:**
- STATUS: All / Confirmed / Testing / To try (with counts)
- CATEGORY: Alcohol / Caramels & Syrups / Chocolates / Croustillants / Fruit-based / Ganaches / Pralines

**Category sections** with serif headers.

**FillingCard** (new, 3 columns):

```tsx
<FillingCard variant={status}>  // confirmed | testing | to-try
  <header>
    <name serif>{name}</name>
    <statusPill variant={status}>{status}</statusPill>
  </header>
  <usedIn>Used in: {usedInProducts.join(", ") || "Not yet used in products"}</usedIn>
  <AllergenDots allergens={allergens} />
</FillingCard>
```

Card padding 14-16px. 3-column grid (`repeat(3, 1fr)`, gap 12px).

Variant left borders:
- `confirmed` — mint
- `testing` — caramel
- `to-try` — blush

Status pills:
- `confirmed` — mint text, mint tint bg
- `testing` — caramel text, caramel tint bg
- `to-try` — blush text, critical tint bg

"+ new {category}" add-card at end of each category section.

### Phase 4.3 — Ingredients page (structured table)

Target route: `/ingredients`
File: `src/app/(app)/ingredients/page.tsx`

**Page header:**
```
Ingredients
{total} ingredients · {shortCount} short · {missingCompositionCount} missing composition data

[Categories] [Import composition] [+ New ingredient]
```

**Pills:**
- STOCK: All / In stock / Low / Out / Ordered (with counts)
- CATEGORY: Alcohol / Chocolate / Essential oils / Fats / Flavors / Infusions / Nuts / Sugars

**Category sections** with serif headers.

**Table** (5 columns):
```
| Ingredient (280px) | Supplier · composition (1fr) | Last updated (120px) | Stock (100px) | Action (100px) |
```

**Row component:**

```tsx
<IngredientRow variant={stockStatus}>
  <NameCell>
    <name>{name}</name>
    <altName>{altName}</altName>
  </NameCell>
  <SupplierCell>
    <supplier>{supplier}</supplier>
    <CompositionStatus variant={compositionStatus}>
      {compositionLabel}
    </CompositionStatus>
  </SupplierCell>
  <Updated>{updatedDate}</Updated>
  <StockStatus variant={stockStatus}>{stockLabel}</StockStatus>
  <Actions>
    <button sm>edit</button>
  </Actions>
</IngredientRow>
```

Composition status:
- ✓ composition complete · N pages (mint text)
- ⚠ no composition · add data (caramel text)

Stock status:
- `in` — "in stock" (mint)
- `low` — "low · order" (caramel)
- `out` — "out" (rose)
- `ordered` — "ordered" (deep teal)

Row left-border color:
- `low` — caramel
- `out` — rose
- else — transparent

**Killed from existing:** the right-edge shopping cart icons (since reorder is in /shopping).

### Phase 4.4 — Moulds page (visual grid)

Target route: `/moulds`
File: `src/app/(app)/moulds/page.tsx`

**Page header:**
```
Moulds
{total} moulds · used by {productCount} products · total capacity {totalCavityRuns} fills simultaneously

[+ New mould]
```

**Pills:**
- TAG: All / Bar / Filled / Moulded / Hearts / Limited / Toasty

**MouldsGrid** — 4 columns (or 5 — wider than products since each card has more spec data).

**MouldCard component** (new):

```tsx
<MouldCard>
  <MouldImage>
    {photoUrl ? <img src={photoUrl} /> : <MouldSvg shape={shape} />}
  </MouldImage>
  <MouldBody>
    <name serif>{name}</name>
    <brand>{brand}</brand>
    <MouldSpecs>
      <spec value={`${weight} g`} label="weight" />
      <spec value={cavities} label="cavities" />
    </MouldSpecs>
  </MouldBody>
</MouldCard>
```

**MouldSvg** — built-in shapes for when photo not uploaded:
- `bar` — rectangle with N cavities
- `heart` — heart silhouette
- `circle` — circles for bonbon moulds
- `default` — empty rectangle outline

Aspect ratio 1.4 (slightly wider than tall — moulds are usually wider).

"+ New mould" add-card at end.

### Phase 4.5 — Packaging page (stock-first table)

Target route: `/packaging`
File: `src/app/(app)/packaging/page.tsx`

**Page header:**
```
Packaging
{total} SKUs · €{minCost}–€{maxCost} unit cost · {lowCount} low stock

[+ New packaging]
```

**Pills:** STOCK: All / In stock / Low / Out / Ordered

**Table** (6 columns):
```
| icon (60px) | name · supplier (1fr) | fits (100px) | cost/unit (90px) | stock (100px) | last order (130px) |
```

**Row component:**

```tsx
<PackagingRow variant={stockStatus}>
  <icon>{iconGlyph}</icon>
  <main>
    <name>{name}</name>
    <supplier>{supplier}</supplier>
  </main>
  <fits><val>{fitsCount}</val> {fitsLabel}</fits>
  <cost>€{costPerUnit}</cost>
  <stock variant={stockStatus}>{stockLabel}</stock>
  <lastOrder>{date} · {qty} units</lastOrder>
</PackagingRow>
```

Icon glyphs: ▢ for boxes, ⬚ for inserts, ♥ for heart, ⊟ for trays. Or use Tabler equivalents.

Stock variants — same color logic as Ingredients.

### Phase 4.6 — Variants page (timeline list)

Target route: `/variants`
File: `src/app/(app)/variants/page.tsx`

**Page header:**
```
Variants
{total} variants · {activeCount} ongoing · {pastCount} past · seasonal & standard product assortments

[Calendar view] [+ New variant]
```

(Calendar view button = future enhancement, can be inactive for v1)

**Pills:**
- STATUS: All / Active / Past / Upcoming
- TYPE: Standard / Seasonal / Box / Bar / B2B

**Sections grouped by status:**

```tsx
<VariantSection title="Past seasonal" count="4 variants">
  <VariantsList>
    {pastVariants.map(v => <VariantRow variant="past" />)}
  </VariantsList>
</VariantSection>

<VariantSection title="Active" count="22 variants">
  <VariantsList>
    {activeVariants.map(v => <VariantRow variant="ongoing" />)}
  </VariantsList>
</VariantSection>

<VariantSection title="Upcoming" count="0 variants">
  ...
</VariantSection>
```

**VariantRow** (single-row layout, 3 columns):

```tsx
<VariantRow variant={status}>
  <main>
    <name>{name}</name>
    <sub>{type} · {productsCount} products{box ? " in box" : ""}{b2b ? " · B2B" : ""}</sub>
  </main>
  <dates>{dateRange or "from {startDate}"}</dates>
  <status variant={status}>{statusLabel}</status>
</VariantRow>
```

Row left-border color:
- `ongoing` — mint
- `past` — gray, 65% opacity
- `upcoming` — caramel

Date display:
- Active ongoing — "from DD/MM/YYYY"
- Past — "DD/MM → DD/MM/YYYY"
- Upcoming — "DD/MM → DD/MM/YYYY"

Status labels:
- "ongoing" / "past · Nd ago" / "upcoming · in Nd"

### Phase 4.7 — Collections page (tag index)

Target route: `/collections`
File: `src/app/(app)/collections/page.tsx`

**Page header:**
```
Collections
Variant labels grouped — every label is a collection · derived from Variants

[Manage labels →]
```

NOTE: this page should be considered for deprecation per inventory note ("/collections derived from variant labels only"). But while it exists, redesign it.

**No pills, no filters.** Just the grid.

**CollectionsGrid** — 4 columns.

**CollectionCard:**

```tsx
<CollectionCard variant={hasLabels ? "default" : "unlabelled"}>
  <name serif>{labelName}</name>
  <count>{variantCount} variants{unlabelled ? " · no labels" : ""}</count>
</CollectionCard>
```

Unlabelled card: dashed border, 60% opacity.

Click → navigates to `/variants?filter=label:{labelName}`.

### Phase 4.8 — Decoration page (visual swatch grid)

Target route: `/decoration`
File: `src/app/(app)/decoration/page.tsx`

**Page header:**
```
Decoration
Manage your decoration materials, material categories, and shell design techniques · {totalColors} colors, {lustreCount} lustre dusts, {sheetCount} transfer sheets

[Categories] [Designs] [+ New material]
```

**Type tabs** (top-level tabs, underline style):
```
[Materials (19)] [Categories (5)] [Designs (12)]
```

Active tab: bottom border deep teal, bold weight.

**Pills (Materials tab):**
- STOCK: All / In stock / Low / Out
- TYPE: Cocoa Butter / Cocoa Butter Colored / Lustre Dust / Transfer Sheet / Other

**Type sections** (serif headers):

```tsx
<TypeSection title="Cocoa Butter Colored" count="11 colors">
  <DecoSwatchGrid>
    {swatches.map(s => <DecoSwatch material={s} />)}
    <AddSwatch label="new color" />
  </DecoSwatchGrid>
</TypeSection>
```

**DecoSwatchGrid** — 6 columns, gap 10px.

**DecoSwatch component:**

```tsx
<DecoSwatch>
  <DecoColor style={{ background: colorHex }}>
    <StockBadge variant={stockVariant}>{stockLabel}</StockBadge>
  </DecoColor>
  <DecoSwatchBody>
    <name>{name}</name>
    <brand>{brand}</brand>
    <usage>used in {productCount} products</usage>
  </DecoSwatchBody>
</DecoSwatch>
```

Color area: aspect ratio 1.4 (wider than tall), full color fill from material `colorHex` field.

If no colorHex (lustre dust, transfer sheet), render as image OR pattern OR muted placeholder with material name big in serif.

For non-color materials (lustre dust, transfer sheets, etc.), the design SHOULD scale gracefully:
- Lustre Dust → shimmer gradient placeholder + name
- Transfer Sheet → small thumbnail + name
- Other → letter avatar fallback

**Killed:** the thin row layout. For decoration the VISUAL is the data.

---

## SHARED COMPONENT WORK

These components are used across Workshop Dashboard / Campaigns / Pantry. Build once, reuse.

### NEW components to add to `@/components/dulceria`:

**ZoneCard** (used in Workshop dashboard utilization strip)
```tsx
<ZoneCard variant="warn">
  <ZoneCardHeader>
    <label>Today's capacity</label>
    <status>57%</status>
  </ZoneCardHeader>
  <ZoneCardValue>8h<unit>/14h</unit></ZoneCardValue>
  <ZoneCardBar value={57} variant="warn" />
  <ZoneCardDetail>5h slack · 1 production day open</ZoneCardDetail>
</ZoneCard>
```

Similar to StatCard but with progress bar + detail line.

**NextUpBanner** (used in Campaign detail)
```tsx
<NextUpBanner variant="warn">
  <label>⏵ NEXT UP</label>
  <title serif>Start Polishing on Pistachio Chocolate Bar</title>
  <meta>7 batches scheduled · ramp starts 30 May</meta>
  <action primary>Start now</action>
</NextUpBanner>
```

Caramel tint bg, caramel left border, primary action button.

**TimelineStrip** (used in Campaign detail)
```tsx
<TimelineStrip
  start="2026-05-13"
  end="2026-06-04"
  markers={[
    { date: "2026-05-13", label: "today · 12 May", variant: "today" },
    { date: "2026-05-30", label: "production · 30 May" },
    { date: "2026-06-04", label: "launch · 04 Jun" }
  ]}
  status="production starts in 18 days · 25 days total window"
/>
```

Horizontal bar with elapsed shading + vertical marker lines + labels below.

**ProductCard** (used in Pantry/Products)
Visual grid card with image, stock badge, name, recipe, allergens.

**FillingCard** (used in Pantry/Fillings)
Info card with status pill, used-in list, allergens.

**MouldCard** (used in Pantry/Moulds)
Visual card with mould shape SVG + specs.

**VariantRow** (used in Pantry/Variants)
Single-row layout with status left-border, dates, status text.

**CollectionCard** (used in Pantry/Collections)
Minimal card with label name + count.

**DecoSwatch** (used in Pantry/Decoration)
Visual color swatch with stock badge + name + brand + usage.

**AllergenDot** (used across Pantry)
Small colored circle for allergen indication.

**CategorySection** (used across Pantry)
Wrapper with serif header + count meta + content slot.

**AddCard** (used across Pantry)
Dashed-border placeholder card with "+ new X" label.

### EXTENDED components (modify existing):

**ListRow** — used in many places, already in library. Verify variant prop accepts: `urgent | warn | info | ok | default`.

**StatusTag** — already exists. Verify max-2 enforcement on workshop pages.

**Section** — already exists. Add optional `<Actions>` slot in header.

---

## DATA REQUIREMENTS — flag deferred items

These are the data points the redesigns assume. For each, verify availability and flag deferred if missing:

### Workshop dashboard
- `productionDayLineItem.startedAt` — for "elapsed" display in NOW bar
- `productionDayLineItem.status` updates — for active step detection
- Mould "drying" / "blocked" state — currently no field; show only in-use vs free
- "Ready to pack" derived state — orders where production complete but not picked
- HACCP "incomplete today" count — depends on HACCP module

### Campaigns
- `productionPlans` linkage to campaigns — for batches count
- `productionDayLineItems.status` aggregation per category
- Campaign "production start date" — vs launch date (may need explicit field, or derive from earliest `productionDayLineItem.day`)
- "Days to launch" / "Days to production start" — date math

### Pantry / Products
- Product `photoUrl` — if not stored, use letter avatar fallback
- Product `recipeIngredients` (array of filling names) — should derive from existing data
- Product `allergens` (computed from ingredients → fillings → products chain) — may need computed field
- Product `stockStatus` — computed from on-hand inventory

### Pantry / Fillings
- Filling `status` enum: `confirmed | testing | to-try` — verify field exists
- `usedInProducts` — relation query

### Pantry / Ingredients
- Composition completeness boolean — `composition.length > 0`
- `altName` — verify field

### Pantry / Decoration
- Material `colorHex` field for swatch rendering
- Material `type` enum: cocoa_butter | cocoa_butter_colored | lustre_dust | transfer_sheet | other

For each missing data point: ship the UI with `—` placeholder and flag deferred. Do NOT block phase ship on data work.

---

## VERIFY CHECKLIST (per redesign)

### Sidebar
- [ ] All 6 spaces visible at all times
- [ ] Active space auto-expands
- [ ] Multiple spaces can be expanded simultaneously
- [ ] Sub-section labels visible (Work queue / Schedule / etc.)
- [ ] Workshop has 13 sub-items across 5 groups
- [ ] All `/production-brain/*` routes reachable
- [ ] Dashboard link at top is persistent
- [ ] Bottom utility: Shopping / Workshop wall / Settings
- [ ] User email at bottom

### Workshop dashboard
- [ ] NOW bar at top with active step + progress
- [ ] 4 utilization cards: Capacity / Moulds / Ingredients / Ready to pack
- [ ] Left column: Active batches table + Drafts list
- [ ] Right column: Mould occupancy + Ready to pack + Compliance
- [ ] Quick actions row at bottom
- [ ] No pastel-filled cards anywhere

### Campaigns
- [ ] List page: filter pills + 3 status sections + cards with progress
- [ ] Campaign cards differentiate by status (border color + status text)
- [ ] Type tags color-coded (seasonal/launch/market)
- [ ] Detail page: NEXT UP banner + timeline + KPI strip + products
- [ ] Timeline shows today + production start + launch markers
- [ ] No pastel-filled cards anywhere

### Pantry / Products
- [ ] 6-column visual grid
- [ ] Stock badge on each card image
- [ ] Allergen dots replace tag soup
- [ ] Category sections with serif headers
- [ ] "+ new" add-card at end of each category

### Pantry / Fillings
- [ ] 3-column info cards
- [ ] Status pill (confirmed/testing/to-try)
- [ ] "Used in" line on each card
- [ ] Status-colored left borders

### Pantry / Ingredients
- [ ] 5-column structured table
- [ ] Composition status visible (✓ or ⚠)
- [ ] Stock status color-coded
- [ ] Inline edit button per row
- [ ] No shopping cart icons (reorder lives in /shopping)

### Pantry / Moulds
- [ ] 4-column visual grid
- [ ] Mould shape SVG or photo per card
- [ ] Specs visible (weight + cavities)
- [ ] Brand visible

### Pantry / Packaging
- [ ] 6-column stock-first table
- [ ] Fits / Cost / Stock as separate columns
- [ ] Last order date + qty visible
- [ ] Stock status color-coded

### Pantry / Variants
- [ ] Grouped by Past / Active / Upcoming
- [ ] Status-colored left borders
- [ ] Date range visible
- [ ] Type + product count in meta

### Pantry / Collections
- [ ] 4-column tag-index grid
- [ ] Variant count per label
- [ ] Unlabelled card dashed

### Pantry / Decoration
- [ ] Type tabs (Materials / Categories / Designs)
- [ ] 6-column swatch grid
- [ ] Real color squares with stock badge
- [ ] Brand + usage count visible
- [ ] Scales for non-color material types

---

## NON-NEGOTIABLES

For ALL redesigns:

- **Page bg `#fbf6f1`, card bg `#ffffff`, NO pastel-filled cards anywhere**
- **Border-warm `#e8e3d6` at 0.5px**
- **Tier accents only on LEFT BORDERS**: caramel `#dab73f`, deep teal `#264443`, blush `#fbccb9`, urgent rose `#993556`, mint `#5dcaa5`
- **Text: primary `#2c2515`, muted `#8a7e64`**
- **Serif headers: Playfair Display**
- **Body sans: system stack**
- **Sentence case throughout** (no Title Case in body)
- **Tabler outline icons only**
- **NO drop shadows, NO gradients**
- **Italic muted for secondary meta lines**
- **Tabular-nums for numbers**

For UI behavior:
- Click row → opens detail / drawer (per existing pattern)
- Hover row → bg → `--card-bg-hover`
- Mobile: responsive grid collapse per page

---

## ORDER OF SHIPPING

Suggested sequence (each phase independently shippable):

1. **Sidebar Phase 1.1** — config + components (parallel install)
2. **Sidebar Phase 1.2** — replace old sidebar
3. **Sidebar Phase 1.3** — badges
4. **Workshop dashboard Phase 2.1-2.6** — full page
5. **Campaigns list Phase 3.1** — replace existing
6. **Campaigns detail Phase 3.2** — replace existing
7. **Pantry Products Phase 4.1** — replace existing
8. **Pantry Fillings Phase 4.2** — replace existing
9. **Pantry Ingredients Phase 4.3** — replace existing
10. **Pantry Moulds Phase 4.4** — replace existing
11. **Pantry Packaging Phase 4.5** — replace existing
12. **Pantry Variants Phase 4.6** — replace existing
13. **Pantry Collections Phase 4.7** — replace existing (or deprecate)
14. **Pantry Decoration Phase 4.8** — replace existing
15. **Sidebar Phase 1.4** — polish (localStorage persistence, mobile pass)

Total: 15 commits minimum. Evidence per item on each.

---

## COMMIT MESSAGE TEMPLATE

Each commit must include:

```
{commit_number} — {phase_name}

✓ {item 1} — {file/migration}
✓ {item 2} — {file/migration}
✗ {deferred item} — {reason}

Notes: {anything unexpected, data gaps found, follow-up needed}
```

No silent partial ships. No "done" without paths. No deferred items without reasons.

---

**End of batch spec.**
