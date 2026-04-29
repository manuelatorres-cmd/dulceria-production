-- 0066_production_orders.sql
-- Internal "production orders" — sibling to customer `orders` but for
-- workshop-driven demand (restocking shop/production minimums, campaign
-- runs, launches). Drives the brain alongside customer orders.
--
-- Constraint: a PO must be either tied to a campaign OR marked as
-- channel='restock'. Never floating.

create table if not exists public."productionOrders" (
  id              uuid primary key,
  name            text,
  "dueDate"       date not null,
  status          text not null default 'pending'
                    check (status in ('pending', 'in_production', 'done', 'cancelled')),
  channel         text not null
                    check (channel in ('restock', 'campaign_run')),
  "campaignId"    uuid references public.campaigns(id) on delete set null,
  /** Where the produced pieces should land. 'store' / 'production' /
   *  'storage'. Optional — defaults derived in app code (restock →
   *  triggering location; campaign_run → production). */
  "targetLocation" text,
  notes           text,
  "createdAt"     timestamptz not null default now(),
  "updatedAt"     timestamptz not null default now(),
  /** Source-of-truth invariant: campaignId OR channel='restock'. */
  constraint productionOrders_anchor check (
    "campaignId" is not null or channel = 'restock'
  )
);

create index if not exists "productionOrders_campaignId_idx"
  on public."productionOrders" ("campaignId");
create index if not exists "productionOrders_dueDate_idx"
  on public."productionOrders" ("dueDate");
create index if not exists "productionOrders_status_idx"
  on public."productionOrders" (status);

alter table public."productionOrders" enable row level security;
drop policy if exists "productionOrders_authenticated_full_access"
  on public."productionOrders";
create policy "productionOrders_authenticated_full_access"
  on public."productionOrders"
  for all to authenticated using (true) with check (true);

create table if not exists public."productionOrderItems" (
  id                  uuid primary key,
  "productionOrderId" uuid not null
                       references public."productionOrders"(id) on delete cascade,
  "productId"         uuid not null
                       references public.products(id) on delete restrict,
  "targetUnits"       integer not null check ("targetUnits" > 0),
  "sortOrder"         integer not null default 0,
  notes               text,
  "createdAt"         timestamptz not null default now(),
  "updatedAt"         timestamptz not null default now()
);

create index if not exists "productionOrderItems_orderId_idx"
  on public."productionOrderItems" ("productionOrderId");
create index if not exists "productionOrderItems_productId_idx"
  on public."productionOrderItems" ("productId");

alter table public."productionOrderItems" enable row level security;
drop policy if exists "productionOrderItems_authenticated_full_access"
  on public."productionOrderItems";
create policy "productionOrderItems_authenticated_full_access"
  on public."productionOrderItems"
  for all to authenticated using (true) with check (true);

notify pgrst, 'reload schema';
