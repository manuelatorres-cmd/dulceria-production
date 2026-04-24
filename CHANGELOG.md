# Changelog

All notable user-facing changes to Dulceria are documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (pre-1.0 — minor bumps may include breaking changes).

## [Unreleased]

### Added
- **Production Brain (preview)** — new top-level rewrite of the planner,
  daily view, and dashboard, gated behind a per-device feature flag
  (`localStorage.setItem('dulceria.ff.production-brain', '1')` or use
  the in-page "Enable" button). Lives at `/production-brain/{dashboard,daily,planner}`.
- **Replenishment proposals** — engine projects per-location stock 14d
  forward and writes proposals when projection dips below min. Proposals
  appear in the planner sidebar; the user drags them onto the calendar
  (or dismisses) — never auto-placed.
- **Rush scheduling engine** — `time_sensitive` orders auto-split into
  per-day slices and displace lower-priority blocks (R&D → tier-3 →
  tier-2 → tier-1 → standard). Campaigns and existing rush blocks are
  never displaced.
- **Campaigns** — limited-edition / seasonal box scheduling. Engine
  proposes ramp-up replenishment batches between `productionStartDate`
  and `startDate`.
- **Per-product priority tier** (1/2/3) on `products`, used by both
  the rush displacement ladder and the dashboard.
- **Pastel planner palette** — semantic CSS tokens
  (`--plan-order/replen/campaign/cook/course/ok/tight/short`) for
  consistent calendar block styling, plus `--accent-blush-*` and
  `--accent-sky-*`.

### Schema
- Migration `0051_production_brain_phase1.sql` (additive). New tables:
  `replenishmentProposals`, `dailySellEstimates`, `campaigns`. New
  columns on `products`, `orders`, `orderItems`, `mouldPool`, `people`.
  Default values keep legacy rows compatible.

## [0.1.0] — 2026-04-19

### Added
- Initial public release.
