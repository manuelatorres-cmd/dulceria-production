# Sidebar redesign — implementation spec

Reference mockup: `sidebar-redesign.html` (save to `/docs/`).
Reference inventory: `docs/SIDEBAR_INVENTORY_2026-05-13.md` (already committed).

Goal: replace current sidebar pattern (per-space drawer that hides other spaces) with a single unified sidebar where all 6 spaces stay visible and the active space auto-expands inline.

This is a global change. Touches the layout component used across all routes.

---

## What changes

**Current behavior:**
- Top-level sidebar shows Dashboard + 6 spaces
- Click a space → sidebar swaps to that space's sub-nav, OTHER SPACES DISAPPEAR
- Must click "‹ Dashboard" tiny link at top to return to main view
- /production-brain pages (Manual planner, Needed vs stock, Equipment, HACCP) NOT in any sidebar — reachable only via URL

**New behavior:**
- Single sidebar always shows: Dashboard + 6 spaces (with chevrons)
- Click a space → expands inline below the space label, showing grouped sub-items
- Other spaces stay visible (collapsed) below the expanded one
- Multiple spaces can be expanded simultaneously
- When user navigates to a route, the parent space auto-expands
- All `/production-brain/*` routes reachable from Workshop's expanded nav
- Persistent Dashboard link at top (not the "‹ Dashboard" tiny link)
- Bottom utility section: Shopping, Workshop wall, Settings + user email

---

## Component architecture

Likely current structure (verify and adapt):
```
src/components/layout/sidebar.tsx        — top-level sidebar
src/components/layout/space-sidebar.tsx  — per-space drawer (DELETE)
```

New structure:
```
src/components/layout/sidebar.tsx                  — single component, drives everything
src/components/layout/sidebar-space.tsx            — one expandable space row + subitems
src/components/layout/sidebar-subitem.tsx          — single sub-nav item with badge
src/components/layout/sidebar-utility.tsx          — bottom section (Shopping, Wall, Settings)
src/lib/layout/sidebar-config.ts                   — the static nav tree (see below)
src/lib/layout/sidebar-badges.ts                   — live badge counts logic
```

Delete `space-sidebar.tsx` and its routing logic that swaps sidebars per space.

---

## The nav tree (single source of truth)

`src/lib/layout/sidebar-config.ts`:

```typescript
export interface SidebarSubItem {
  label: string;
  href: string;
  icon: string;              // Tabler icon name
  badgeKey?: BadgeKey;       // optional live badge
}

export interface SidebarSubGroup {
  label: string;             // sub-section heading ("Work queue", "Schedule", etc.)
  items: SidebarSubItem[];
}

export interface SidebarSpace {
  id: string;
  label: string;
  icon: string;
  defaultHref: string;       // landing route when space is clicked directly
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
    defaultHref: "/pantry",
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

**Verify each `href`** against the inventory before shipping. If any route differs (e.g., `/products` is actually at `/pantry/products`), update the config.

Critical href notes:
- `Plan (week)` uses `/plan?view=weekly` — preserves the query-param view switching
- `Daily` points to `/production-brain/daily` (NOT `/daily` — that route may not exist)
- `Planner` points to `/production-brain/planner`
- `Manual planner` points to `/production-brain/manual`
- All other /production-brain/* routes use full path

**Routes NOT in config (intentional):**
- `/calculator` — legacy redirect to /lab, no nav entry
- `/library` — fold into Pantry overview (Cursor flagged this in inventory)
- `/collections` — derived from variants only, remove from nav (Cursor flagged this)
- `/production-brain/dashboard` — second dashboard variant, accessible from main dashboard if needed
- `/production-brain` (hub) — not needed since groups expose all sub-pages

---

## Badge logic

`src/lib/layout/sidebar-badges.ts`:

```typescript
import { useQuery } from "@tanstack/react-query";

interface BadgeData {
  count: number;
  variant: "urgent" | "warn" | "ok";
}

export function useSidebarBadges(): Record<BadgeKey, BadgeData | null> {
  const { data: orders } = useOrders();
  const { data: picking } = usePickingQueue();
  const { data: haccpStatus } = useHaccpToday();
  const { data: stock } = useStockBelowMin();
  const { data: ingredients } = useIngredientsShort();
  const { data: campaigns } = useCampaignsUrgent();
  
  return {
    "orders.overdue": orders ? {
      count: orders.filter(o => o.daysOverdue > 0).length,
      variant: "urgent"
    } : null,
    
    "picking.ready": picking ? {
      count: picking.filter(p => p.status === "ready").length,
      variant: "ok"
    } : null,
    
    "haccp.incomplete": haccpStatus ? {
      count: haccpStatus.incompleteCount,
      variant: "warn"
    } : null,
    
    "stock.belowMin": stock ? {
      count: stock.length,
      variant: stock.length > 20 ? "urgent" : "warn"
    } : null,
    
    "ingredients.short": ingredients ? {
      count: ingredients.length,
      variant: "warn"
    } : null,
    
    "campaigns.urgent": campaigns ? {
      count: campaigns.length,
      variant: "warn"
    } : null
  };
}
```

Hook list above is a sketch. Use existing hooks where possible. If a hook doesn't exist for a badge, either:
- Compute inline from existing data
- Defer that specific badge (show no badge) — flag as deferred in commit

Badges should:
- Show only when count > 0
- Refetch every 60s while sidebar is mounted (or use existing query invalidation)
- Render at right edge of sub-item
- Use status color: rose (urgent), caramel (warn), mint (ok)

---

## Component implementation

### Sidebar (root)

```tsx
// src/components/layout/sidebar.tsx
import { SIDEBAR_CONFIG, UTILITY_ITEMS } from "@/lib/layout/sidebar-config";
import { useSidebarBadges } from "@/lib/layout/sidebar-badges";
import { useSidebarState } from "@/hooks/use-sidebar-state";
import { usePathname } from "next/navigation";

export function Sidebar() {
  const pathname = usePathname();
  const { expandedSpaces, toggleSpace } = useSidebarState();
  const badges = useSidebarBadges();
  
  return (
    <aside className="sidebar">
      <div className="sb-logo">
        <span className="sb-logo-text">Dulceria</span>
      </div>
      
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

### SidebarSpace

```tsx
// src/components/layout/sidebar-space.tsx
export function SidebarSpace({ space, expanded, activeRoute, badges, onToggle }) {
  return (
    <>
      <button
        className={cn("sb-space", {
          active: isInSpace(activeRoute, space),
          expanded
        })}
        onClick={onToggle}
      >
        <DsIcon name={space.icon} size={16} />
        <span>{space.label}</span>
        <span className="sb-space-chevron">{expanded ? "▾" : "›"}</span>
      </button>
      
      {expanded && (
        <div className="sb-subsection">
          {space.groups.map((group, i) => (
            <Fragment key={i}>
              {group.label && (
                <div className="sb-subgroup-label">{group.label}</div>
              )}
              {group.items.map(item => (
                <SidebarSubitem
                  key={item.href}
                  item={item}
                  active={activeRoute === item.href || activeRoute.startsWith(item.href + "/")}
                  badge={item.badgeKey ? badges[item.badgeKey] : null}
                />
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </>
  );
}

function isInSpace(pathname: string, space: SidebarSpace): boolean {
  return space.groups.some(g =>
    g.items.some(i => pathname === i.href || pathname.startsWith(i.href + "/"))
  );
}
```

### SidebarSubitem

```tsx
// src/components/layout/sidebar-subitem.tsx
export function SidebarSubitem({ item, active, badge }) {
  return (
    <Link href={item.href} className={cn("sb-subitem", { active })}>
      <DsIcon name={item.icon} size={13} />
      <span>{item.label}</span>
      {badge && badge.count > 0 && (
        <span className={cn("sb-subitem-badge", badge.variant)}>
          {badge.count}
        </span>
      )}
    </Link>
  );
}
```

### useSidebarState (auto-expand parent on route change)

```tsx
// src/hooks/use-sidebar-state.ts
export function useSidebarState() {
  const pathname = usePathname();
  const [manuallyToggled, setManuallyToggled] = useState<Set<string>>(new Set());
  
  // Auto-expand the space containing the current route
  const autoExpanded = useMemo(() => {
    const set = new Set<string>();
    for (const space of SIDEBAR_CONFIG) {
      const inSpace = space.groups.some(g =>
        g.items.some(i => pathname === i.href || pathname.startsWith(i.href + "/"))
      );
      if (inSpace) set.add(space.id);
    }
    return set;
  }, [pathname]);
  
  // Union: auto-expanded + manually toggled
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

Persist `manuallyToggled` in localStorage if you want it to survive reloads. Optional.

---

## Styling

All from existing design system tokens. New class names below — add to existing layout stylesheet.

```css
.sidebar {
  background: #1a3433;            /* sidebar deep teal */
  color: rgba(255,255,255,0.85);
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-radius: 0 12px 12px 0;   /* optional rounded corners on right */
  overflow-y: auto;
  height: 100vh;
  position: sticky;
  top: 0;
}

.sb-logo {
  padding: 16px 20px;
  border-bottom: 0.5px solid rgba(255,255,255,0.08);
}
.sb-logo-text {
  font-family: "Playfair Display", Georgia, serif;
  font-size: 20px;
  font-weight: 600;
  color: white;
}

.sb-home {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  color: rgba(255,255,255,0.85);
  font-size: 13px;
  text-decoration: none;
  border-bottom: 0.5px solid rgba(255,255,255,0.08);
}
.sb-home:hover { background: rgba(255,255,255,0.04); }
.sb-home.active { background: rgba(255,255,255,0.1); color: white; }

.sb-spaces-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(255,255,255,0.3);
  padding: 14px 20px 6px;
  font-weight: 600;
}

.sb-space {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 20px;
  color: rgba(255,255,255,0.85);
  font-size: 13px;
  cursor: pointer;
  background: transparent;
  border: none;
  text-align: left;
  width: 100%;
  font-family: inherit;
}
.sb-space:hover { background: rgba(255,255,255,0.04); }
.sb-space.active { background: rgba(255,255,255,0.1); color: white; font-weight: 500; }
.sb-space-chevron {
  margin-left: auto;
  font-size: 10px;
  color: rgba(255,255,255,0.45);
}

.sb-subsection {
  background: #142827;            /* darker than parent */
}

.sb-subgroup-label {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(255,255,255,0.3);
  padding: 10px 20px 4px 36px;
  font-weight: 600;
}

.sb-subitem {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 20px 6px 36px;
  color: rgba(255,255,255,0.45);
  font-size: 12.5px;
  text-decoration: none;
  cursor: pointer;
}
.sb-subitem:hover { 
  background: rgba(255,255,255,0.04); 
  color: rgba(255,255,255,0.85);
}
.sb-subitem.active {
  color: white;
  background: rgba(255,255,255,0.04);
  border-left: 2px solid #5dcaa5;  /* mint accent */
  padding-left: 34px;
}

.sb-subitem-badge {
  margin-left: auto;
  background: #993556;             /* rose for urgent */
  color: white;
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 8px;
  font-weight: 600;
}
.sb-subitem-badge.warn { background: #dab73f; color: #142827; }
.sb-subitem-badge.ok { background: #5dcaa5; color: #142827; }

.sb-bottom {
  margin-top: auto;
  border-top: 0.5px solid rgba(255,255,255,0.08);
  padding: 8px 0;
}

.sb-user {
  padding: 12px 20px;
  border-top: 0.5px solid rgba(255,255,255,0.08);
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: rgba(255,255,255,0.45);
}
.sb-user-email {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

---

## Implementation phases

### Phase 1 — config + components (no behavior change yet)

- Create `sidebar-config.ts` with full nav tree
- Build `Sidebar`, `SidebarSpace`, `SidebarSubitem`, `SidebarUtility` components
- Wire to existing layout
- Keep old sidebar code in place temporarily — both live in parallel

### Phase 2 — replace existing sidebar

- Switch layout to use new `Sidebar` component
- Delete `space-sidebar.tsx` and per-space drawer logic
- Verify all routes still navigable
- Verify active states work for all pages

### Phase 3 — badges

- Build `useSidebarBadges` hook
- Wire badges into sub-items
- Test with real data — verify counts are accurate

### Phase 4 — polish

- Auto-expand parent space on route change
- Optional: persist manually-toggled expansion state in localStorage
- Verify mobile/tablet behavior (collapse to drawer on narrow viewports)

Each phase independently shippable.

---

## Verify checklist

After Phase 1+2 ship:

1. ✓ Sidebar shows: logo + Dashboard link + 6 spaces + bottom utilities + user
2. ✓ All 6 spaces visible at all times
3. ✓ Click a space → it expands inline, sub-items visible
4. ✓ Click another space → both stay expanded
5. ✓ Navigate to a route → parent space auto-expands
6. ✓ Sub-section labels visible within each space (Work queue, Schedule, etc.)
7. ✓ Workshop shows 13 sub-items in 5 groups
8. ✓ All `/production-brain/*` routes (Daily, Planner, Manual planner, Needed vs stock, Equipment, HACCP) reachable from Workshop expanded
9. ✓ Active sub-item has 2px mint left border + lighter bg
10. ✓ Active space has lighter bg + bold weight
11. ✓ "Dashboard" link at top is persistent — one click home from anywhere
12. ✓ "‹ Dashboard" tiny link at top removed (no longer needed)
13. ✓ Workshop wall, Shopping, Settings in bottom utility section
14. ✓ User email shown at very bottom in muted style
15. ✓ Mobile: sidebar collapses to drawer/hamburger (existing pattern preserved)

After Phase 3 ships:

16. ✓ Orders shows badge with overdue count (rose)
17. ✓ Picking shows badge with ready-to-pack count (mint)
18. ✓ HACCP shows badge if incomplete logs (caramel)
19. ✓ Stock shows badge with below-min count (caramel or rose if >20)
20. ✓ Ingredients shows badge with shortage count (caramel)
21. ✓ Campaigns shows badge if urgent
22. ✓ Badges hide when count is 0
23. ✓ Badge counts refetch periodically

---

## Honest deferred items

1. **Mobile/tablet sidebar behavior** — assume existing drawer pattern stays. Improving mobile sidebar is a separate pass.
2. **Keyboard navigation** — arrow keys to traverse, enter to navigate. Not in v1.
3. **Collapse all / expand all buttons** — could be a header utility. Not in v1.
4. **Custom space ordering or hiding** — fixed order in v1. User customization is v2.
5. **Multi-tenant / role-based hiding** — all spaces visible to all users. Permissions filtering is v2.
6. **Search within sidebar** — quick command-K is a separate feature.
7. **/library deprecation** — Cursor flagged this in inventory. Fold into Pantry overview is a separate task, not part of sidebar redesign.
8. **/collections route deprecation** — same as above. Remove from this sidebar config but leave route active.
9. **/production-brain/dashboard placement** — second dashboard variant not in any sidebar. Either deprecate or add to Workshop's "Schedule" group as "Production dashboard" — decide later.

---

## File changes summary

```
NEW:
  src/lib/layout/sidebar-config.ts
  src/lib/layout/sidebar-badges.ts
  src/hooks/use-sidebar-state.ts
  src/components/layout/sidebar.tsx               (new implementation)
  src/components/layout/sidebar-space.tsx
  src/components/layout/sidebar-subitem.tsx
  src/components/layout/sidebar-utility.tsx
  
MODIFY:
  src/app/(app)/layout.tsx                        (use new Sidebar)
  Global stylesheet (add .sb-* classes)
  
DELETE:
  src/components/layout/space-sidebar.tsx         (and per-space variants if they exist)
  Any "‹ Dashboard" tiny back-link components
```

---

## What NOT to do

- DO NOT add /calculator to sidebar (legacy redirect, not for nav)
- DO NOT add /library to sidebar (fold into Pantry overview separately)
- DO NOT add /collections to sidebar (derived from variants, not its own thing)
- DO NOT add /production-brain (hub page) to sidebar — sub-pages cover it
- DO NOT keep the per-space drawer pattern — replace it entirely
- DO NOT add icons other than Tabler outline
- DO NOT skip the badge implementation — they're the live status indicators

---

**End of spec.**
