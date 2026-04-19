-- =============================================================
-- Dulceria Production — planning tables
-- Migration 0002: the 9 new tables that turn ChocCollab into a
--                 production planning system (Section 4 of brief)
-- =============================================================
--
-- Depends on 0001_initial_schema.sql (products, moulds, fillings,
-- productionPlans, planProducts must already exist).
--
-- Conventions inherited from 0001:
--   uuid primary keys, generated client-side
--   camelCase, double-quoted identifiers
--   numeric for money + percentages, integer for counts
--   text with CHECK constraints for small enums (keeps the
--     app's TS union types honest without needing pg enums)
--   RLS off — added in 0003 together with shared-workspace auth
--   No seed data and no business-value defaults on columns
--     (house rule, 2026-04-19). Every configurable number —
--     capacity, step durations, thresholds, filling buffer —
--     is user-written via the Settings UI on first run. Schema
--     ships empty; only structural defaults (now(), '{}',
--     boolean flags, zero-counters, 'draft' lifecycle start)
--     remain.
-- =============================================================

-- ---------- Orders ----------
--
-- Every demand driver (B2B purchase order, event like Veganmania,
-- online sale, shop-floor replenishment) enters the system here.
-- The scheduler reads open orders, works backwards from deadline,
-- and writes productionSchedule rows.

create table orders (
  id             uuid primary key,
  channel        text not null
                 check (channel in ('b2b','event','online','shop')),
  -- B2B buyer, online customer; null for shop-replenishment orders
  "customerName" text,
  -- e.g. "Veganmania 2026"; only set when channel = 'event'
  "eventName"    text,
  deadline       timestamptz not null,
  priority       text not null default 'normal'
                 check (priority in ('low','normal','high','urgent')),
  status         text not null default 'draft'
                 check (status in ('draft','confirmed','in_production','ready','delivered','cancelled')),
  notes          text,
  "createdAt"    timestamptz not null default now(),
  "updatedAt"    timestamptz not null default now()
);
create index on orders (status);
-- "what's due next" — deadline ASC scan
create index on orders (deadline);
create index on orders (channel);
-- dashboard: open orders by urgency (status filter + deadline sort)
create index on orders (status, deadline);

-- ---------- Order items ----------
--
-- What products + how many. One order can repeat the same product
-- with different notes (e.g. two packaging options), so no unique
-- constraint on (orderId, productId).

create table "orderItems" (
  id          uuid primary key,
  "orderId"   uuid not null references orders(id) on delete cascade,
  "productId" uuid not null references products(id) on delete restrict,
  quantity    integer not null check (quantity > 0),
  "sortOrder" integer not null default 0,
  notes       text
);
create index on "orderItems" ("orderId");
create index on "orderItems" ("productId");

-- ---------- Production schedule ----------
--
-- Output of the reverse scheduler (src/lib/scheduler.ts, coming
-- later). One row per production phase per batch: paint, dry-paint,
-- shell, dry-shell, fill, dry-fill, cap, dry-cap, unmould — plus
-- make_filling for shelf-stable precursors scheduled ahead of time.
--
-- Phase durations are NOT hardcoded. The scheduler reads them at
-- runtime from productTypeStepDurations, with per-product overrides
-- on products.stepDurationOverrides.
--
-- isActive = true for active work, false for drying / resting
-- windows (capacity engine only counts active time against the
-- per-person day budget from capacityConfig).
--
-- dependsOnId lets the scheduler express the DAG (e.g. "fill can't
-- start until shell drying is done") without a separate edge table.

create table "productionSchedule" (
  id                uuid primary key,
  "orderId"         uuid references orders(id) on delete cascade,
  "productId"       uuid not null references products(id) on delete restrict,
  "mouldId"         uuid references moulds(id) on delete set null,
  "fillingId"       uuid references fillings(id) on delete set null,
  "planId"          uuid references "productionPlans"(id) on delete set null,
  "planProductId"   uuid references "planProducts"(id) on delete set null,
  phase             text not null
                    check (phase in (
                      'paint','dry_paint','shell','dry_shell',
                      'fill','dry_fill','cap','dry_cap','unmould',
                      'make_filling'
                    )),
  "startAt"         timestamptz not null,
  "endAt"           timestamptz not null,
  "durationMinutes" integer not null check ("durationMinutes" >= 0),
  "isActive"        boolean not null default true,
  -- free-text name for now; becomes a users-table FK once auth lands (migration 0003)
  "assignedTo"      text,
  status            text not null default 'pending'
                    check (status in ('pending','in_progress','done','skipped','blocked')),
  "dependsOnId"     uuid references "productionSchedule"(id) on delete set null,
  notes             text,
  "createdAt"       timestamptz not null default now(),
  "updatedAt"       timestamptz not null default now(),
  check ("endAt" >= "startAt")
);
create index on "productionSchedule" ("orderId");
create index on "productionSchedule" ("planId");
create index on "productionSchedule" ("productId");
create index on "productionSchedule" ("startAt");
create index on "productionSchedule" (status, "startAt");
create index on "productionSchedule" (phase, status);

-- ---------- Mould pool (real-time occupancy) ----------
--
-- One row per physical mould copy currently in use. A row is
-- inserted when the production flow claims a mould and deleted
-- when the mould is freed (unmoulded + washed). Free count =
-- moulds.quantityOwned − count(rows per mouldId).
--
-- instanceIndex (1..quantityOwned) identifies which physical
-- copy of the mould — prevents double-booking the same copy.

create table "mouldPool" (
  id               uuid primary key,
  "mouldId"        uuid not null references moulds(id) on delete cascade,
  "instanceIndex"  integer not null check ("instanceIndex" >= 1),
  "planId"         uuid references "productionPlans"(id) on delete cascade,
  "planProductId"  uuid references "planProducts"(id) on delete set null,
  "scheduleId"     uuid references "productionSchedule"(id) on delete set null,
  -- free-form phase string so it can track new phases without a schema change
  phase            text not null,
  "occupiedSince"  timestamptz not null default now(),
  "expectedFreeAt" timestamptz,
  notes            text,
  unique ("mouldId", "instanceIndex")
);
create index on "mouldPool" ("mouldId");
create index on "mouldPool" ("planId");
create index on "mouldPool" ("expectedFreeAt");

-- ---------- Equipment ----------
--
-- Tempering machines, melting pots, coating belt — fully user-
-- managed via the Settings -> Equipment UI (CRUD: name, kind,
-- capacity, model, notes, archive). Ships with zero rows; the
-- user adds their own equipment on first run.
--
-- Occupancy is tracked in-place (currentPlanId null = free). If
-- we later need a history of who-used-what-when, we'll add an
-- equipmentUsage log table.

create table equipment (
  id                  uuid primary key,
  name                text not null,
  kind                text not null
                      check (kind in ('tempering','melting_pot','coating_belt','other')),
  "capacityKg"        numeric(8,2),
  manufacturer        text,
  model               text,
  notes               text,
  "currentPlanId"     uuid references "productionPlans"(id) on delete set null,
  "currentScheduleId" uuid references "productionSchedule"(id) on delete set null,
  "occupiedSince"     timestamptz,
  "expectedFreeAt"    timestamptz,
  archived            boolean not null default false,
  "createdAt"         timestamptz not null default now(),
  "updatedAt"         timestamptz not null default now()
);
create index on equipment (kind);
create index on equipment ("currentPlanId");
create index on equipment (archived);

-- ---------- Product-type step durations ----------
--
-- One row per (productType, phase). Written by the Settings ->
-- Production Timings UI; read by the scheduler when planning a
-- batch. productType links by string to productCategories.name
-- (same pattern as fillings.category / ingredients.category), so
-- a custom category created in Settings automatically qualifies.
--
-- Per-product exceptions live on products.stepDurationOverrides
-- (jsonb) rather than here, so a single deviating product doesn't
-- require cloning the whole productType.
--
-- Ships empty. The brief's suggested numbers (praline paint 5m,
-- dry_paint 10m, etc.) are shown only as placeholder text in the
-- Settings form — never committed via this migration.

create table "productTypeStepDurations" (
  id                uuid primary key,
  "productType"     text not null,
  phase             text not null
                    check (phase in (
                      'paint','dry_paint','shell','dry_shell',
                      'fill','dry_fill','cap','dry_cap','unmould',
                      'make_filling'
                    )),
  "durationMinutes" integer not null check ("durationMinutes" >= 0),
  "isActive"        boolean not null default true,
  "createdAt"       timestamptz not null default now(),
  "updatedAt"       timestamptz not null default now(),
  unique ("productType", phase)
);
create index on "productTypeStepDurations" ("productType");

-- ---------- Capacity config ----------
--
-- Single-row table (by convention — enforced at the app layer).
-- Ships EMPTY: no defaults, no business assumptions. The Settings
-- -> Capacity UI is the only writer; the scheduler refuses to run
-- until all fields are populated. Check constraints apply when
-- values are set (e.g. peopleCount > 0), so partial rows remain
-- internally consistent.

create table "capacityConfig" (
  id                         uuid primary key,
  "peopleCount"              integer check ("peopleCount" > 0),
  "hoursPerPersonPerDay"     numeric(4,2)
                             check ("hoursPerPersonPerDay" > 0 and "hoursPerPersonPerDay" <= 24),
  "workingDays"              text[],
  "warnThresholdPercent"     numeric(5,2),
  "criticalThresholdPercent" numeric(5,2),
  "fillingBufferPercent"     numeric(5,2),
  "updatedAt"                timestamptz not null default now()
);

-- ---------- Event calendar ----------
--
-- Events the shop is delivering for (Veganmania, Christmas market),
-- predicted demand peaks, blocked production days (vacation,
-- equipment service), holidays. The dashboard + scheduler read
-- this to avoid scheduling work into unavailable days.

create table "eventCalendar" (
  id               uuid primary key,
  name             text not null,
  kind             text not null
                   check (kind in ('event','peak','blocked','holiday')),
  "startDate"      date not null,
  "endDate"        date not null,
  "relatedOrderId" uuid references orders(id) on delete set null,
  -- CSS colour for the UI calendar dot (hex or named)
  color            text,
  notes            text,
  "createdAt"      timestamptz not null default now(),
  "updatedAt"      timestamptz not null default now(),
  check ("endDate" >= "startDate")
);
create index on "eventCalendar" ("startDate");
create index on "eventCalendar" (kind, "startDate");

-- ---------- Stock minimums (per product per channel) ----------
--
-- Drives low-stock alerts and replenishment orders. channel='both'
-- is a shortcut for "same minimum regardless of destination"; the
-- app splits it into shop + online when computing shortages.

create table "stockMinimums" (
  id             uuid primary key,
  "productId"    uuid not null references products(id) on delete cascade,
  channel        text not null
                 check (channel in ('shop','online','both')),
  "minimumUnits" integer not null check ("minimumUnits" >= 0),
  "reorderPoint" integer check ("reorderPoint" >= 0),
  notes          text,
  "updatedAt"    timestamptz not null default now(),
  unique ("productId", channel)
);
create index on "stockMinimums" ("productId");

-- =============================================================
-- Notes for migration 0003 (auth + RLS):
--   Every table above gets `alter table ... enable row level
--     security;` plus an "authenticated users can do everything"
--     policy — single shared workspace, two users (Manuela +
--     partner).
--   capacityConfig is a singleton; the app always upserts the
--     same uuid. A check constraint will be added in 0003 once
--     we've confirmed the app-side key.
--
-- First-run Settings flow (for the UI to enforce, not the DB):
--   1. If capacityConfig has no row (or required fields null),
--      route to Settings -> Capacity before the scheduler runs.
--   2. If productTypeStepDurations has no rows for a product's
--      category, block plan creation for that product until the
--      durations are filled in.
--   3. Equipment page is plain CRUD from empty — no blocking gate.
-- =============================================================
