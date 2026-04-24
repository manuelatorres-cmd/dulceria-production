-- =============================================================
-- Dulceria Production Brain — Phase 3 multi-location stock + HACCP
-- Migration 0053
-- =============================================================
--
-- Five new tables + one column extension. All additive, idempotent,
-- RLS under authenticated_full_access.
--
--   1) productStock              — per-batch finished-goods stock row
--   2) stockTransfers            — moves between locations
--   3) temperatureReadings       — HACCP logs per cold storage unit
--   4) haccpIncidents            — out-of-range events + resolutions
--   5) csvImports                — log of Shopify/HelloCash CSV imports
--   6) externalSkuMapping        — resolve unknown external SKUs
--
-- Also: location_stock_minimums table to replace the channel-based
-- StockLocationMinimum with a richer per-entity per-location row.
-- =============================================================

-- ─── 1) productStock ─────────────────────────────────────────
-- Finished bonbon / bar / box stock tracked per-batch per-location
-- so FIFO allocation + shelf-life countdown can work.
create table if not exists public."productStock" (
  id text primary key,
  "productId" text not null references public.products(id) on delete restrict,
  "planId" text references public."productionPlans"(id) on delete set null,
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
-- stock locations.
create table if not exists public."stockTransfers" (
  id text primary key,
  "entityType" text not null
    check ("entityType" in ('ingredient', 'filling', 'product', 'packaging')),
  "entityId" text not null,
  quantity numeric(12, 3) not null,
  "fromLocationId" text,
  "toLocationId" text not null,
  "transferredAt" timestamptz not null default now(),
  "transferredByPersonId" text references public.people(id) on delete set null,
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
  id text primary key,
  "coldStorageUnitId" text not null
    references public."coldStorageUnits"(id) on delete cascade,
  "readingC" numeric(5, 2) not null,
  "loggedAt" timestamptz not null default now(),
  "loggedByPersonId" text references public.people(id) on delete set null,
  "inRange" boolean,
  "actionTaken" text,
  "productionDayId" text references public."productionDays"(id) on delete set null,
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
  id text primary key,
  "coldStorageUnitId" text not null
    references public."coldStorageUnits"(id) on delete cascade,
  "temperatureReadingId" text
    references public."temperatureReadings"(id) on delete set null,
  "startedAt" timestamptz not null default now(),
  "resolvedAt" timestamptz,
  "affectedStockNotes" text,
  "actionTaken" text,
  "resolvedByPersonId" text references public.people(id) on delete set null,
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
  id text primary key,
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
  "uploadedByPersonId" text references public.people(id) on delete set null,
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
  id text primary key,
  "source" text not null
    check ("source" in ('shopify', 'hellocash', 'other')),
  "externalSku" text not null,
  "internalProductId" text references public.products(id) on delete set null,
  "internalPackagingId" text references public.packaging(id) on delete set null,
  "createdAt" timestamptz not null default now(),
  unique ("source", "externalSku")
);

create index if not exists external_sku_mapping_source_idx
  on public."externalSkuMapping" ("source");

alter table public."externalSkuMapping" enable row level security;
drop policy if exists "authenticated_full_access" on public."externalSkuMapping";
create policy "authenticated_full_access" on public."externalSkuMapping"
  for all to authenticated using (true) with check (true);


-- ─── 7) location stock minimums (richer replacement) ────────
-- The legacy `stockMinimums` + `StockLocationMinimum` tables use a
-- channel string. This new table is generic (any entity) + linked to
-- any stock location id so multi-location expansion is trivial.
create table if not exists public."locationStockMinimums" (
  id text primary key,
  "entityType" text not null
    check ("entityType" in ('product', 'ingredient', 'filling', 'packaging')),
  "entityId" text not null,
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
