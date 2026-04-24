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
