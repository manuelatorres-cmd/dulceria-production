-- =============================================================
-- Dulceria Production Brain — Phase 1 core tables + column extensions
-- Migration 0051
-- =============================================================
--
-- Introduces three new tables and extends six existing ones so the
-- production-brain rewrite can track:
--   1) replenishment proposals (sidebar pile, drag-to-schedule)
--   2) daily sell estimates (rolling averages per product/location)
--   3) campaigns (limited editions / seasonal boxes)
--
-- All additive. No destructive changes. Existing data keeps working
-- unchanged. New columns default to safe values so legacy rows read
-- the same.
--
-- RLS: every new table gets the project's standard
-- `authenticated_full_access` policy matching prior migrations.
--
-- Idempotent — safe to re-run.
-- =============================================================

-- ─── 1) replenishmentProposals ────────────────────────────────
-- Engine writes rows whenever projected stock dips below the
-- per-location min within a 14-day horizon. Rows start pending,
-- user drags them onto the calendar → scheduled, or dismisses.
-- Dismissals suppress re-proposal for 7 days unless conditions
-- change.
create table if not exists public."replenishmentProposals" (
  id uuid primary key default gen_random_uuid(),
  "productId" uuid not null references public.products(id) on delete cascade,
  "suggestedBatchSize" integer not null default 40,
  "earliestNeededDate" date not null,
  "priorityTier" integer not null default 2 check ("priorityTier" in (1, 2, 3)),
  reason text not null default 'auto-replen'
    check (reason in (
      'auto-replen',
      'campaign-prep',
      'custom-box-buffer',
      'manual'
    )),
  status text not null default 'pending'
    check (status in ('pending', 'scheduled', 'dismissed')),
  "scheduledPlanId" uuid references public."productionPlans"(id) on delete set null,
  "dismissedUntil" date,
  "locationId" text,
  notes text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists replenishment_proposals_product_status_idx
  on public."replenishmentProposals" ("productId", status);

create index if not exists replenishment_proposals_status_earliest_idx
  on public."replenishmentProposals" (status, "earliestNeededDate");

alter table public."replenishmentProposals" enable row level security;
drop policy if exists "authenticated_full_access" on public."replenishmentProposals";
create policy "authenticated_full_access" on public."replenishmentProposals"
  for all to authenticated using (true) with check (true);


-- ─── 2) dailySellEstimates ────────────────────────────────────
-- Rolling averages per product per location per day. Sourced
-- from HelloCash CSV imports + Shopify CSV + manual shop
-- deductions. Engine reads the rolling 30d avg to forecast
-- demand for #1.
create table if not exists public."dailySellEstimates" (
  id uuid primary key default gen_random_uuid(),
  "productId" uuid not null references public.products(id) on delete cascade,
  "locationId" text not null,
  date date not null,
  "soldCount" integer not null default 0,
  "customBoxPickCount" integer not null default 0,
  "rollingAvg30d" numeric(10, 3) not null default 0,
  "updatedAt" timestamptz not null default now(),
  unique ("productId", "locationId", date)
);

create index if not exists daily_sell_estimates_product_date_idx
  on public."dailySellEstimates" ("productId", date desc);

alter table public."dailySellEstimates" enable row level security;
drop policy if exists "authenticated_full_access" on public."dailySellEstimates";
create policy "authenticated_full_access" on public."dailySellEstimates"
  for all to authenticated using (true) with check (true);


-- ─── 3) campaigns ─────────────────────────────────────────────
-- Limited editions, seasonal boxes, launches. Drives
-- auto-proposed ramp-up batches (reason='campaign-prep').
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  "type" text not null default 'seasonal'
    check ("type" in ('seasonal', 'limited', 'collaboration', 'launch')),
  "startDate" date not null,
  "endDate" date not null,
  "productionStartDate" date,
  "targetTotalUnits" integer,
  "productIds" uuid[] not null default '{}'::uuid[],
  status text not null default 'planned'
    check (status in ('planned', 'active', 'wrapping', 'done', 'cancelled')),
  "colorTag" text,
  notes text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists campaigns_status_dates_idx
  on public.campaigns (status, "startDate");

alter table public.campaigns enable row level security;
drop policy if exists "authenticated_full_access" on public.campaigns;
create policy "authenticated_full_access" on public.campaigns
  for all to authenticated using (true) with check (true);


-- ─── 4) products — new columns ────────────────────────────────
alter table public.products
  add column if not exists "priorityTier" integer not null default 2
    check ("priorityTier" in (1, 2, 3));
alter table public.products
  add column if not exists "includedInCustomBoxes" boolean not null default true;
alter table public.products
  add column if not exists "customBoxPickWeight" numeric(6, 4) not null default 0;
alter table public.products
  add column if not exists "secondsAllowed" boolean not null default false;
alter table public.products
  add column if not exists "defaultDiscountPercentSeconds" integer not null default 30
    check ("defaultDiscountPercentSeconds" >= 0 and "defaultDiscountPercentSeconds" <= 100);

-- Bars default to seconds allowed. Heuristic: any product whose category name
-- contains 'bar' in a case-insensitive match. Non-bar products keep the false
-- default. Safe to re-run — UPDATE is idempotent on steady categories.
update public.products p
  set "secondsAllowed" = true
  from public."productCategories" pc
  where p."productCategoryId" = pc.id
    and pc.name ilike '%bar%';


-- ─── 5) orders — new columns ──────────────────────────────────
alter table public.orders
  add column if not exists "fulfillmentType" text not null default 'pickup'
    check ("fulfillmentType" in ('pickup', 'delivery', 'ship'));
alter table public.orders
  add column if not exists "fulfillmentLeadDays" integer not null default 0
    check ("fulfillmentLeadDays" >= 0);
alter table public.orders
  add column if not exists "timeSensitive" boolean not null default false;
alter table public.orders
  add column if not exists "rushReason" text;
alter table public.orders
  add column if not exists "quoteId" text;
alter table public.orders
  add column if not exists "priceListId" text;
alter table public.orders
  add column if not exists "totalNet" numeric(12, 2);
alter table public.orders
  add column if not exists "totalGross" numeric(12, 2);
alter table public.orders
  add column if not exists "taxTotal" numeric(12, 2);
alter table public.orders
  add column if not exists "invoiceExternalRef" text;


-- ─── 6) orderItems — new columns ──────────────────────────────
alter table public."orderItems"
  add column if not exists "unitPriceNet" numeric(12, 2);
alter table public."orderItems"
  add column if not exists "unitPriceGross" numeric(12, 2);
alter table public."orderItems"
  add column if not exists "discountPercent" numeric(5, 2) not null default 0
    check ("discountPercent" >= 0 and "discountPercent" <= 100);
alter table public."orderItems"
  add column if not exists "taxRatePercent" numeric(5, 2) not null default 10
    check ("taxRatePercent" >= 0 and "taxRatePercent" <= 100);
alter table public."orderItems"
  add column if not exists "packagingId" uuid references public.packaging(id) on delete set null;


-- ─── 7) mouldPool — new columns ──────────────────────────────
-- Per-instance deep-wash counter and richer state machine.
-- Existing instances backfill to the default state 'available'.
alter table public."mouldPool"
  add column if not exists "usesSinceDeepWash" integer not null default 0
    check ("usesSinceDeepWash" >= 0);
alter table public."mouldPool"
  add column if not exists "deepWashThreshold" integer not null default 10
    check ("deepWashThreshold" > 0);
alter table public."mouldPool"
  add column if not exists "currentState" text not null default 'available'
    check ("currentState" in (
      'available',
      'loaded',
      'filled',
      'sealed',
      'needs-wash',
      'in-deep-wash',
      'retired'
    ));
alter table public."mouldPool"
  add column if not exists "stateChangedAt" timestamptz;
alter table public."mouldPool"
  add column if not exists retired boolean not null default false;
alter table public."mouldPool"
  add column if not exists notes text;


-- ─── 8) people — new columns ──────────────────────────────────
alter table public.people
  add column if not exists skills text[] not null default '{}'::text[];
alter table public.people
  add column if not exists "primaryRole" text not null default 'both'
    check ("primaryRole" in ('production', 'shop', 'both', 'other'));
alter table public.people
  add column if not exists "weeklyCustomSchedule" jsonb;


-- ─── 9) touch triggers for updatedAt on new tables ────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new."updatedAt" = now();
  return new;
end;
$$;

drop trigger if exists set_replenishment_proposals_updated_at on public."replenishmentProposals";
create trigger set_replenishment_proposals_updated_at
  before update on public."replenishmentProposals"
  for each row execute function public.set_updated_at();

drop trigger if exists set_daily_sell_estimates_updated_at on public."dailySellEstimates";
create trigger set_daily_sell_estimates_updated_at
  before update on public."dailySellEstimates"
  for each row execute function public.set_updated_at();

drop trigger if exists set_campaigns_updated_at on public.campaigns;
create trigger set_campaigns_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();

-- =============================================================
-- End of 0051 — production-brain phase 1
-- =============================================================
-- =============================================================
-- Dulceria Production Brain — Phase 2 equipment + mould + staff
-- Migration 0052
-- =============================================================
--
-- Six new tables. All additive, idempotent, RLS under the standard
-- `authenticated_full_access` policy.
--
--   1) equipmentInstances  — physical copies hanging off equipment types
--   2) machineLoads        — what chocolate is in which machine right now
--   3) coldStorageUnits    — per-fridge/freezer identity + HACCP targets
--   4) mouldUsageLog       — every mould instance's cycle history
--   5) staffShifts         — shift-level clock-in/out per person per day
--   6) personAvailabilityExceptions — vacation/sick/course leading windows
-- =============================================================

-- ─── 1) equipmentInstances ───────────────────────────────────
-- The existing `equipment` table describes equipment *types*
-- (occupancyMinutes, tempCheck flag). This table represents each
-- physical machine/pot the workshop owns so we can track chocolate
-- loaded, days aging, brand/model, serial.
create table if not exists public."equipmentInstances" (
  id uuid primary key default gen_random_uuid(),
  "equipmentId" uuid not null references public.equipment(id) on delete cascade,
  name text not null,
  brand text,
  model text,
  "serialNumber" text,
  "capacityKg" numeric(8, 3),
  "location" text,
  status text not null default 'idle'
    check (status in ('idle', 'running', 'maintenance', 'retired')),
  notes text,
  archived boolean not null default false,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists equipment_instances_equipment_idx
  on public."equipmentInstances" ("equipmentId");

alter table public."equipmentInstances" enable row level security;
drop policy if exists "authenticated_full_access" on public."equipmentInstances";
create policy "authenticated_full_access" on public."equipmentInstances"
  for all to authenticated using (true) with check (true);


-- ─── 2) machineLoads ─────────────────────────────────────────
-- One row per active chocolate load in a machine. When the
-- chocolate is fully drained or switched, row moves to status
-- 'idle' / 'draining' or a new row is inserted for the next load.
create table if not exists public."machineLoads" (
  id uuid primary key default gen_random_uuid(),
  "equipmentInstanceId" uuid not null
    references public."equipmentInstances"(id) on delete cascade,
  "ingredientId" uuid not null references public.ingredients(id) on delete restrict,
  "loadedQuantityG" numeric(12, 2) not null,
  "remainingQuantityG" numeric(12, 2) not null,
  "loadedAt" timestamptz not null default now(),
  "lastUsedAt" timestamptz,
  status text not null default 'in_use'
    check (status in ('in_use', 'idle', 'draining', 'switched')),
  "agingAlertThresholdDays" integer not null default 7
    check ("agingAlertThresholdDays" > 0),
  notes text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists machine_loads_equipment_idx
  on public."machineLoads" ("equipmentInstanceId", status);

alter table public."machineLoads" enable row level security;
drop policy if exists "authenticated_full_access" on public."machineLoads";
create policy "authenticated_full_access" on public."machineLoads"
  for all to authenticated using (true) with check (true);


-- ─── 3) coldStorageUnits ─────────────────────────────────────
-- Each fridge/freezer/ambient unit with its HACCP target range.
-- Temperature readings hang off this table (phase 3 migration
-- will add the `temperatureReadings` child table).
create table if not exists public."coldStorageUnits" (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  "location" text not null
    check ("location" in ('production', 'shop', 'storage', 'other')),
  "type" text not null default 'fridge'
    check ("type" in ('fridge', 'freezer', 'ambient')),
  "targetTempMinC" numeric(4, 1),
  "targetTempMaxC" numeric(4, 1),
  "requiresTempCheck" boolean not null default true,
  "checkFrequencyPerDay" integer not null default 2
    check ("checkFrequencyPerDay" > 0),
  archived boolean not null default false,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

alter table public."coldStorageUnits" enable row level security;
drop policy if exists "authenticated_full_access" on public."coldStorageUnits";
create policy "authenticated_full_access" on public."coldStorageUnits"
  for all to authenticated using (true) with check (true);


-- ─── 4) mouldUsageLog ────────────────────────────────────────
-- Full cycle history per mould instance — needed for traceability
-- and deep-wash scheduling.
create table if not exists public."mouldUsageLog" (
  id uuid primary key default gen_random_uuid(),
  "mouldPoolId" uuid not null references public."mouldPool"(id) on delete cascade,
  "planId" uuid references public."productionPlans"(id) on delete set null,
  "startedAt" timestamptz not null default now(),
  "freedAt" timestamptz,
  "cycleCompleted" boolean not null default false,
  "deepWashDone" boolean not null default false,
  notes text,
  "createdAt" timestamptz not null default now()
);

create index if not exists mould_usage_pool_idx
  on public."mouldUsageLog" ("mouldPoolId", "startedAt" desc);

alter table public."mouldUsageLog" enable row level security;
drop policy if exists "authenticated_full_access" on public."mouldUsageLog";
create policy "authenticated_full_access" on public."mouldUsageLog"
  for all to authenticated using (true) with check (true);


-- ─── 5) staffShifts ──────────────────────────────────────────
-- Per-person per-day shift tracking. Powers the clock-in/out
-- widget + labor cost per batch attribution.
create table if not exists public."staffShifts" (
  id uuid primary key default gen_random_uuid(),
  "personId" uuid not null references public.people(id) on delete cascade,
  "shiftDate" date not null,
  "clockInAt" timestamptz not null default now(),
  "clockOutAt" timestamptz,
  "breakMinutes" integer not null default 0 check ("breakMinutes" >= 0),
  "location" text
    check ("location" in ('production', 'shop', 'course', 'other') or "location" is null),
  "linkedPlanIds" uuid[] not null default '{}'::uuid[],
  notes text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists staff_shifts_person_date_idx
  on public."staffShifts" ("personId", "shiftDate" desc);

alter table public."staffShifts" enable row level security;
drop policy if exists "authenticated_full_access" on public."staffShifts";
create policy "authenticated_full_access" on public."staffShifts"
  for all to authenticated using (true) with check (true);


-- ─── 6) personAvailabilityExceptions ─────────────────────────
-- Sits next to the existing `personUnavailability` table (which is
-- vacation-style "person is off"). This richer table lets HR-style
-- cases (course-leading, training, partial days) model themselves
-- without the constraints of the legacy table.
create table if not exists public."personAvailabilityExceptions" (
  id uuid primary key default gen_random_uuid(),
  "personId" uuid not null references public.people(id) on delete cascade,
  "dateFrom" date not null,
  "dateTo" date not null,
  "type" text not null default 'vacation'
    check ("type" in (
      'vacation',
      'sick',
      'course-leading',
      'training',
      'partial',
      'other'
    )),
  "allDay" boolean not null default true,
  "hoursFrom" time,
  "hoursTo" time,
  approved boolean not null default false,
  notes text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists person_availability_person_idx
  on public."personAvailabilityExceptions" ("personId", "dateFrom");

alter table public."personAvailabilityExceptions" enable row level security;
drop policy if exists "authenticated_full_access" on public."personAvailabilityExceptions";
create policy "authenticated_full_access" on public."personAvailabilityExceptions"
  for all to authenticated using (true) with check (true);


-- ─── 7) updated_at touch triggers ────────────────────────────
-- Reuses the set_updated_at() function from migration 0051.
do $$
declare tbl text;
begin
  for tbl in
    select unnest(array[
      'equipmentInstances',
      'machineLoads',
      'coldStorageUnits',
      'staffShifts',
      'personAvailabilityExceptions'
    ])
  loop
    execute format(
      'drop trigger if exists set_%s_updated_at on public.%I;',
      tbl,
      tbl
    );
    execute format(
      'create trigger set_%s_updated_at before update on public.%I
       for each row execute function public.set_updated_at();',
      tbl,
      tbl
    );
  end loop;
end$$;

-- =============================================================
-- End of 0052 — production-brain phase 2
-- =============================================================
-- =============================================================
-- Dulceria Production Brain — Phase 3 multi-location stock + HACCP
-- Migration 0053
-- =============================================================
--
-- Seven new tables. All additive, idempotent, RLS under
-- authenticated_full_access.
--
--   1) productStock              — per-batch finished-goods stock row
--   2) stockTransfers            — moves between locations
--   3) temperatureReadings       — HACCP logs per cold storage unit
--   4) haccpIncidents            — out-of-range events + resolutions
--   5) csvImports                — log of Shopify/HelloCash CSV imports
--   6) externalSkuMapping        — resolve unknown external SKUs
--   7) locationStockMinimums     — per-entity per-location min/target/max
-- =============================================================

-- ─── 1) productStock ─────────────────────────────────────────
-- Finished bonbon / bar / box stock tracked per-batch per-location
-- so FIFO allocation + shelf-life countdown can work.
create table if not exists public."productStock" (
  id uuid primary key default gen_random_uuid(),
  "productId" uuid not null references public.products(id) on delete restrict,
  "planId" uuid references public."productionPlans"(id) on delete set null,
  "quantityPieces" integer not null default 0 check ("quantityPieces" >= 0),
  "lockedPieces" integer not null default 0 check ("lockedPieces" >= 0),
  "locationId" text not null,
  "producedAt" timestamptz,
  "bestBeforeDate" date,
  "lotNumber" text,
  "isSeconds" boolean not null default false,
  "secondsReason" text
    check (
      "secondsReason" is null
      or "secondsReason" in ('broken', 'flawed', 'near-expiry', 'other')
    ),
  "discountPercent" numeric(5, 2)
    check ("discountPercent" is null or ("discountPercent" >= 0 and "discountPercent" <= 100)),
  notes text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists product_stock_product_location_idx
  on public."productStock" ("productId", "locationId");
create index if not exists product_stock_bbd_idx
  on public."productStock" ("bestBeforeDate");

alter table public."productStock" enable row level security;
drop policy if exists "authenticated_full_access" on public."productStock";
create policy "authenticated_full_access" on public."productStock"
  for all to authenticated using (true) with check (true);


-- ─── 2) stockTransfers ──────────────────────────────────────
-- Moves of ingredients / fillings / products / packaging between
-- stock locations. `entityId` is a uuid but left without an FK
-- because it can point at several different tables; the entityType
-- discriminator tells the app which one.
create table if not exists public."stockTransfers" (
  id uuid primary key default gen_random_uuid(),
  "entityType" text not null
    check ("entityType" in ('ingredient', 'filling', 'product', 'packaging')),
  "entityId" uuid not null,
  quantity numeric(12, 3) not null,
  "fromLocationId" text,
  "toLocationId" text not null,
  "transferredAt" timestamptz not null default now(),
  "transferredByPersonId" uuid references public.people(id) on delete set null,
  reason text not null default 'manual'
    check (reason in (
      'auto-replenish',
      'shop-request',
      'manual',
      'return',
      'waste',
      'gift',
      'tasting'
    )),
  notes text,
  "createdAt" timestamptz not null default now()
);

create index if not exists stock_transfers_entity_idx
  on public."stockTransfers" ("entityType", "entityId", "transferredAt" desc);

alter table public."stockTransfers" enable row level security;
drop policy if exists "authenticated_full_access" on public."stockTransfers";
create policy "authenticated_full_access" on public."stockTransfers"
  for all to authenticated using (true) with check (true);


-- ─── 3) temperatureReadings ─────────────────────────────────
-- One row per manual temperature check against a cold storage unit.
create table if not exists public."temperatureReadings" (
  id uuid primary key default gen_random_uuid(),
  "coldStorageUnitId" uuid not null
    references public."coldStorageUnits"(id) on delete cascade,
  "readingC" numeric(5, 2) not null,
  "loggedAt" timestamptz not null default now(),
  "loggedByPersonId" uuid references public.people(id) on delete set null,
  "inRange" boolean,
  "actionTaken" text,
  "productionDayId" uuid references public."productionDays"(id) on delete set null,
  notes text,
  "createdAt" timestamptz not null default now()
);

create index if not exists temperature_readings_unit_time_idx
  on public."temperatureReadings" ("coldStorageUnitId", "loggedAt" desc);

alter table public."temperatureReadings" enable row level security;
drop policy if exists "authenticated_full_access" on public."temperatureReadings";
create policy "authenticated_full_access" on public."temperatureReadings"
  for all to authenticated using (true) with check (true);


-- ─── 4) haccpIncidents ──────────────────────────────────────
-- Out-of-range events opened against a reading; closed manually
-- with resolution notes.
create table if not exists public."haccpIncidents" (
  id uuid primary key default gen_random_uuid(),
  "coldStorageUnitId" uuid not null
    references public."coldStorageUnits"(id) on delete cascade,
  "temperatureReadingId" uuid
    references public."temperatureReadings"(id) on delete set null,
  "startedAt" timestamptz not null default now(),
  "resolvedAt" timestamptz,
  "affectedStockNotes" text,
  "actionTaken" text,
  "resolvedByPersonId" uuid references public.people(id) on delete set null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists haccp_incidents_unit_idx
  on public."haccpIncidents" ("coldStorageUnitId", "startedAt" desc);

alter table public."haccpIncidents" enable row level security;
drop policy if exists "authenticated_full_access" on public."haccpIncidents";
create policy "authenticated_full_access" on public."haccpIncidents"
  for all to authenticated using (true) with check (true);


-- ─── 5) csvImports ──────────────────────────────────────────
-- Log of every CSV upload (Shopify orders, HelloCash sales, stock
-- counts). One row per upload, with preview + commit counts.
create table if not exists public."csvImports" (
  id uuid primary key default gen_random_uuid(),
  "source" text not null
    check ("source" in (
      'shopify-orders',
      'shopify-stock',
      'hellocash-sales',
      'hellocash-inventory',
      'other'
    )),
  filename text,
  "uploadedAt" timestamptz not null default now(),
  "uploadedByPersonId" uuid references public.people(id) on delete set null,
  "rowsTotal" integer not null default 0,
  "rowsImported" integer not null default 0,
  "rowsSkipped" integer not null default 0,
  "rowsFailed" integer not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'ok', 'partial', 'failed')),
  "errorSummary" text,
  "dryRun" boolean not null default false,
  notes text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists csv_imports_source_time_idx
  on public."csvImports" ("source", "uploadedAt" desc);

alter table public."csvImports" enable row level security;
drop policy if exists "authenticated_full_access" on public."csvImports";
create policy "authenticated_full_access" on public."csvImports"
  for all to authenticated using (true) with check (true);


-- ─── 6) externalSkuMapping ──────────────────────────────────
-- Resolve external SKUs (Shopify / HelloCash) to internal product
-- or packaging IDs. Populated when the user matches an unmapped
-- row during a dry-run import.
create table if not exists public."externalSkuMapping" (
  id uuid primary key default gen_random_uuid(),
  "source" text not null
    check ("source" in ('shopify', 'hellocash', 'other')),
  "externalSku" text not null,
  "internalProductId" uuid references public.products(id) on delete set null,
  "internalPackagingId" uuid references public.packaging(id) on delete set null,
  "createdAt" timestamptz not null default now(),
  unique ("source", "externalSku")
);

create index if not exists external_sku_mapping_source_idx
  on public."externalSkuMapping" ("source");

alter table public."externalSkuMapping" enable row level security;
drop policy if exists "authenticated_full_access" on public."externalSkuMapping";
create policy "authenticated_full_access" on public."externalSkuMapping"
  for all to authenticated using (true) with check (true);


-- ─── 7) locationStockMinimums ───────────────────────────────
-- Generic replacement for the channel-based stockLocationMinimums.
-- entityId is a uuid (points at products/ingredients/etc depending
-- on entityType); not FK-constrained since the target varies.
create table if not exists public."locationStockMinimums" (
  id uuid primary key default gen_random_uuid(),
  "entityType" text not null
    check ("entityType" in ('product', 'ingredient', 'filling', 'packaging')),
  "entityId" uuid not null,
  "locationId" text not null,
  "minQuantity" numeric(12, 3) not null default 0,
  "targetQuantity" numeric(12, 3),
  "maxQuantity" numeric(12, 3),
  notes text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique ("entityType", "entityId", "locationId")
);

alter table public."locationStockMinimums" enable row level security;
drop policy if exists "authenticated_full_access" on public."locationStockMinimums";
create policy "authenticated_full_access" on public."locationStockMinimums"
  for all to authenticated using (true) with check (true);


-- ─── 8) touch triggers ───────────────────────────────────────
do $$
declare tbl text;
begin
  for tbl in
    select unnest(array[
      'productStock',
      'haccpIncidents',
      'csvImports',
      'locationStockMinimums'
    ])
  loop
    execute format(
      'drop trigger if exists set_%s_updated_at on public.%I;',
      tbl,
      tbl
    );
    execute format(
      'create trigger set_%s_updated_at before update on public.%I
       for each row execute function public.set_updated_at();',
      tbl,
      tbl
    );
  end loop;
end$$;

-- =============================================================
-- End of 0053 — production-brain phase 3
-- =============================================================
