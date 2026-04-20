-- =============================================================
-- Dulceria Production — ensure productionSteps table exists
-- Migration 0023: idempotent re-apply of the 0011 schema
-- =============================================================
--
-- Symptom: /rest/v1/productionSteps returns 404 in the browser.
-- That means PostgREST can't see the table in the `public` schema —
-- either migration 0011 was never applied on this Supabase project,
-- or the table was dropped along the way.
--
-- This migration re-creates the table, index, and RLS policy with
-- `IF NOT EXISTS` guards so it's a no-op when the table already
-- exists in the right shape. Safe to run on any environment.
-- =============================================================

create table if not exists public."productionSteps" (
  id               uuid primary key,
  "productType"    text not null,
  name             text not null,
  "activeMinutes"  numeric(8,2) not null check ("activeMinutes" >= 0),
  "waitingMinutes" numeric(8,2) not null check ("waitingMinutes" >= 0),
  "sortOrder"      integer not null,
  "createdAt"      timestamptz not null default now(),
  "updatedAt"      timestamptz not null default now(),
  unique ("productType", name)
);

create index if not exists "productionSteps_productType_sortOrder_idx"
  on public."productionSteps" ("productType", "sortOrder");

-- RLS: same authenticated-only pattern as every other Dulceria table.
-- Drops any prior policy of the same name before recreating it, so the
-- migration is re-runnable even if an older policy exists.

do $$
declare p text;
begin
  -- Ensure RLS is on (alter is a no-op when already enabled).
  execute 'alter table public."productionSteps" enable row level security';

  -- Drop any policy with the canonical name, then recreate it.
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'productionSteps'
  loop
    execute format('drop policy if exists %I on public."productionSteps"', p);
  end loop;

  execute 'create policy "authenticated_full_access" on public."productionSteps" ' ||
          'for all to authenticated using (true) with check (true)';
end$$;

-- Nudge PostgREST to reload its schema cache so the new table starts
-- serving at /rest/v1/productionSteps immediately. Supabase listens to
-- this channel; it's a no-op on plain Postgres.
notify pgrst, 'reload schema';
