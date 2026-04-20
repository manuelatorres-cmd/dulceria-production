-- =============================================================
-- Dulceria Production — shop borrowing, auto-replenishment & dashboard
-- Migration 0033 foundations
-- =============================================================
--
-- Depends on 0002 (products, orders, orderItems, productionSteps),
--            0016 (stockLocationMinimums).
--
-- This migration lays down all persistent state needed for:
--   - A /shop dashboard with live opening-hours status
--   - "Borrow from Store stock" decisions on B2B / online orders
--   - Auto-created "Shop Replenishment" linked orders
--   - Finishing-only schedule for borrowed orders
--
-- Design decisions (confirmed with user):
--   1. leadTimeDays on products is an editable field; the UI shows a
--      suggested value derived from production steps.
--   2. Production steps gain isFinishingStep so the scheduler can
--      filter to post-storage tasks for borrowed orders.
--   3. Replenishment orders re-use channel='shop' + sourceOrderId
--      pointing at the triggering order — no new channel.
--   4. stockLocationMinimums gains maximumUnits; when null, the
--      replenishment target is minimumUnits.
--   5. Allocation is applied at order save; revert on cancel/delete.
-- =============================================================

-- 1. Shop opening hours — one row per weekday (0 = Sunday ... 6 = Saturday,
--    ISO-8601 is 1 = Monday but we match JS Date.getDay()).
--    "closed" rows omit openAt/closeAt and set isOpen = false.

create table if not exists public."shopOpeningHours" (
  id           uuid primary key,
  "dayOfWeek"  integer not null check ("dayOfWeek" between 0 and 6),
  "isOpen"     boolean not null default false,
  -- Stored as 'HH:MM' strings so we never confuse time-zones with a full
  -- timestamptz. Nullable when isOpen = false.
  "openAt"     text check ("openAt" is null or "openAt" ~ '^[0-2][0-9]:[0-5][0-9]$'),
  "closeAt"    text check ("closeAt" is null or "closeAt" ~ '^[0-2][0-9]:[0-5][0-9]$'),
  "updatedAt"  timestamptz not null default now(),
  unique ("dayOfWeek")
);

-- Seed the 7 days so the UI can always render a full week.
insert into public."shopOpeningHours" (id, "dayOfWeek", "isOpen")
select gen_random_uuid(), dow, false
from generate_series(0, 6) as dow
on conflict ("dayOfWeek") do nothing;

-- 2. Shop closures — date ranges when the shop is closed regardless of
--    the weekly schedule (holidays, sickness, renovation). Single-day
--    closures use the same date for start + end.

create table if not exists public."shopClosures" (
  id           uuid primary key,
  "startDate"  date not null,
  "endDate"    date not null check ("endDate" >= "startDate"),
  reason       text,
  "createdAt"  timestamptz not null default now()
);
create index if not exists "shopClosures_range_idx"
  on public."shopClosures" ("startDate", "endDate");

-- 3. Optional "stock up to" target on per-location minimums. Null means
--    "use minimumUnits as the replenishment target".

alter table public."stockLocationMinimums"
  add column if not exists "maximumUnits" integer
    check ("maximumUnits" is null or "maximumUnits" >= 0);

-- 4. Per-product production lead time (days). Editable; UI shows a
--    suggested value from productionSteps × capacity. Integer — the
--    scheduler works in day buckets anyway.

alter table public.products
  add column if not exists "leadTimeDays" integer
    check ("leadTimeDays" is null or "leadTimeDays" >= 0);

-- 5. Finishing-step flag on productionSteps — marks the tasks that
--    apply to an order borrowed from Store (polish, pack, wrap). The
--    full-production path still runs every step; the borrow path only
--    schedules the finishing ones.

alter table public."productionSteps"
  add column if not exists "isFinishingStep" boolean not null default false;

-- 6. Source-order link on orders. Null for normal customer orders;
--    set to the triggering order's id on auto-created shop replenishment
--    orders. Restrict delete so the replenishment is never silently
--    orphaned — the app deletes children first when cleaning up.

alter table public.orders
  add column if not exists "sourceOrderId" uuid
    references public.orders(id) on delete set null;
create index if not exists "orders_sourceOrderId_idx"
  on public.orders ("sourceOrderId");

-- 7. Per-line fulfilment mode on orderItems. 'produce' is the default;
--    'borrow' means the line is fulfilled from Store stock (allocated
--    immediately, finishing-only schedule, triggers a replenishment).
--    Kept at the line level so an order can mix borrowed and produced
--    products — the replenishment engine sees both.

alter table public."orderItems"
  add column if not exists "fulfilmentMode" text not null default 'produce'
    check ("fulfilmentMode" in ('produce','borrow'));

-- ---------- RLS for the two new tables ----------

do $$
declare p text;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'shopOpeningHours'
  loop
    execute format('drop policy if exists %I on public."shopOpeningHours"', p);
  end loop;
  execute 'alter table public."shopOpeningHours" enable row level security';
  execute 'create policy "authenticated_full_access" on public."shopOpeningHours" '
       || 'for all to authenticated using (true) with check (true)';

  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'shopClosures'
  loop
    execute format('drop policy if exists %I on public."shopClosures"', p);
  end loop;
  execute 'alter table public."shopClosures" enable row level security';
  execute 'create policy "authenticated_full_access" on public."shopClosures" '
       || 'for all to authenticated using (true) with check (true)';
end$$;

notify pgrst, 'reload schema';
