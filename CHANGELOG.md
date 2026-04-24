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
- Migration `0052_production_brain_phase2.sql` (additive). New tables:
  `equipmentInstances`, `machineLoads`, `coldStorageUnits`,
  `mouldUsageLog`, `staffShifts`, `personAvailabilityExceptions`.
  Hooks + backup/restore updated to match.
- Migration `0053_production_brain_phase3.sql` (additive). New tables:
  `productStock`, `stockTransfers`, `temperatureReadings`,
  `haccpIncidents`, `csvImports`, `externalSkuMapping`,
  `locationStockMinimums`. Hooks + backup/restore updated to match.

### Added (continued)
- **Equipment dashboard** at `/production-brain/equipment` — live
  machine cards (chocolate loaded, aging warning), mould-pool grid
  coloured by state, cold-storage list with HACCP targets.
- **Clock-in widget** (`src/components/clock-in-widget.tsx`) mounted
  on the Daily view right rail. One-tap Start/Stop per person.
  Shifts link to the selected batch's plan id so labor cost
  attribution is automatic.
- **Engine runner** (`src/lib/engineRunner.ts`) ties the pure
  scheduling engines to live Supabase data. `Run scheduling engine`
  button on the dashboard triggers replenishment + campaign cycles
  and upserts resulting proposals.
- Side-nav links to `/production-brain` under the Workshop section
  (still flag-gated; hidden until enabled on each device).

## [0.1.0] — 2026-04-19

### Added
- Initial public release.
