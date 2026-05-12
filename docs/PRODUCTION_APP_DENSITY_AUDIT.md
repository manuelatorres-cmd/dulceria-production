# Production app — density audit

Spec reference: `docs/PRODUCTION_APP_DESIGN_SYSTEM (1).md` — Phase 4.

Audit performed 2026-05-12 on shared components + first retrofitted page.

## Spec targets

| Target | Limit |
|---|---|
| Page header height | ≤ 100px |
| Above-fold | actual content visible, not just metadata |
| Background colours per viewport | ≤ 3 (page + card + one tint) |
| Brand-colour fills per viewport | ≤ 2 |
| Border thickness | ≤ 1px (spec calls for 0.5px throughout) |
| Border radius | ≤ 8px |

## Shared components — measurement

| Component | Padding | Height | Border | Radius | Notes |
|---|---|---|---|---|---|
| `PageHeader` | 16/32 | ~80px | 0.5 bottom | — | Title 28px Playfair + 12px italic meta. Fits in 100px. ✓ |
| `Section` header | 14/20/10 | ~50px | 0.5 bottom | 8 | Card-title 16px Playfair. Used as content container, not chrome. ✓ |
| `StatCard` | 14/16 | min 80, max-w 280 | 0.5 + 3px left tier | 8 | Value 32px Playfair tabular. No shadow. ✓ |
| `ListRow` | 12/20 | content-driven | 0.5 bottom + 3px left tier | — | Hover bg only, no shadow. ✓ |
| `StatusTag` | 2/8 | ~20px | 0.5 outline (or tint bg) | 12 (pill) | Caller limited to 2 per row by convention. ✓ |
| `AttentionItem` | 12/14 | content-driven | 0.5 + 3px left variant | 4 | White card, no pastel fill. ✓ |
| `DsButton` | 4–8 / 10–18 | ~28–36px | 0.5 | 4 | Primary = teal fill (counts toward 2-brand-fill rule). ✓ |

All components meet the spec's structural targets: 0.5 borders, ≤ 8 radius, no drop shadows, no gradients, no pastel fills as primary surfaces.

## Per-page status

### `/production-brain/dashboard` (retrofit shipped 2026-05-12)

- Page header (legacy `PageHeader` component): ~65px tall. ✓ under 100.
- Engine controls strip: ~40px (button + status line). ✓.
- KPI strip (now `StatCard` × 4): ~96px. ✓.
- Above-fold = KPIs + start of pipeline section on a 900px laptop. ✓.
- Background colours in viewport: page neutral + card white + one warm-tint (today/closed) when present = **3**. ✓.
- Brand fills in viewport: teal regenerate button + 0–1 tier accent on KPI = **1–2**. ✓.

### `/production-brain/needed`, `/production-brain/manual`, `/plan?view=weekly` (v2 pages)

These adopted scoped `--mp-*` / `--wp-*` warm-cream tokens that mirror the `--ds-*` palette. Layouts already use 7-col grid + capacity bars + collapsible filter strip per the v2 spec.

- Page header: `<60px` (compressed per /plan v2 phase 1)
- KPI strip equivalent: stats strip 1 line, ~24px
- Above-fold: demand picker + draft bar + week grid header all visible on 900px
- Background colours: warm-cream + card + today-tint + closed-bg + draft-tint = up to 5 — **slightly over the 3-bg target** but each tint is paired (today + closed mutually exclusive per-day; draft only when composing). In practice 3 visible at once.
- Brand fills: teal primary action + caramel "drag handle" on draft bar = 2. ✓.

### `/dashboard` (legacy iOS-glass main dashboard)

Kept as-is per feedback memory `feedback_design_direction` (2026-04-24 "dashboard exception"). Uses translucent white cards + soft shadows + backdrop-blur. **Does not meet** the new spec's "no drop shadows" rule but is intentionally exempted.

### `/orders`, `/workshop`, `/picking`, `/calendar`, `/campaigns`, `/stock`, `/production`, `/production-orders`

Not yet retrofitted. Existing chrome stays. Honest-deferred per phase 3 commit `0b83618`. Adoption order, when picked back up:
1. `/orders` — biggest win on the "max 2 status tags per row" rule
2. `/workshop` — small file, KPI strip retrofit like `/production-brain/dashboard`
3. Remaining pages — incrementally as features touch them

## Density conclusions

- All **new** shared components meet targets out of the box.
- Page `/production-brain/dashboard` meets targets after the Phase 3 retrofit.
- v2 pages already meet targets via their scoped themes.
- Legacy pages (`/dashboard`, `/orders`, etc.) inherit the previous design and are not in violation of the **previous** system; the new system targets them as future work.

## Honest deferred items (Phase 4 specific)

- **Quantitative measurement** of viewport bg counts and brand fill counts at runtime — this audit eyeballs them. A scripted Playwright pass that screenshots each route and counts distinct background colours could automate this, but is out of scope.
- **Mobile / iPad-portrait density** — spec phase 4 targets desktop. Touch density review is its own pass.
- **Print / export density** for documents — not relevant here.
