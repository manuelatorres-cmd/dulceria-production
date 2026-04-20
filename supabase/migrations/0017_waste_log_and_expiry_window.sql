-- =============================================================
-- Dulceria Production — waste log + expiry warn window
-- Migration 0017: Phase 2 tail-end tables for batch-failure tracking
-- =============================================================
--
-- Depends on 0002 (products, capacityConfig) and 0003 (RLS pattern).
--
-- Adds:
--   wasteLog                 per-batch waste entries written at unmould.
--                            Separate from stockMovements because waste
--                            never enters stock — it's the yield deficit
--                            between the planned (moulds × cavities) count
--                            and the actual yield.
--
--   capacityConfig.stockExpiryWarnDays
--                            how many days before sell-by a batch should
--                            turn orange on the dashboard. Nullable —
--                            first-run Settings UI collects it, matching
--                            the ship-empty house rule.
-- =============================================================

create table "wasteLog" (
  id               uuid primary key,
  "planProductId"  uuid references "planProducts"(id) on delete cascade,
  "productId"      uuid not null references products(id) on delete restrict,
  quantity         integer not null check (quantity >= 0),
  reason           text,
  "loggedBy"       text,
  "loggedAt"       timestamptz not null default now()
);
create index on "wasteLog" ("productId", "loggedAt" desc);
create index on "wasteLog" ("planProductId");

alter table "capacityConfig"
  add column if not exists "stockExpiryWarnDays" integer check ("stockExpiryWarnDays" >= 0);

-- RLS: match the 0003 pattern for the new table.

do $$
declare p text;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'wasteLog'
  loop
    execute format('drop policy if exists %I on public.%I', p, 'wasteLog');
  end loop;
  execute 'alter table public."wasteLog" enable row level security';
  execute 'create policy "authenticated_full_access" on public."wasteLog" ' ||
          'for all to authenticated using (true) with check (true)';
end$$;
