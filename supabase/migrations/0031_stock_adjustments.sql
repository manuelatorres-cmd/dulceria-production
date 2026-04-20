-- =============================================================
-- Dulceria Production — stock adjustments (opening balance + audit)
-- Migration 0031: one table, one audit log for every stock tweak
-- =============================================================
--
-- Purpose: let the user enter real physical stock that the app
-- doesn't yet know about (opening balances, recounts, breakage) with
-- a permanent audit trail suitable for HACCP / tax inspection.
--
-- Polymorphic itemId: the row applies to a product, filling,
-- packaging, or ingredient. Not a real FK — the target table depends
-- on itemType — but the app enforces the reference at the hook
-- layer. Keeps one log table instead of four.
--
-- Rows are append-only from the UI's point of view. A "reversal" is
-- just a second row with the opposite deltaQty, linking back via the
-- `note` field. Nothing is ever deleted.
-- =============================================================

create table public."stockAdjustments" (
  id          uuid primary key,
  "itemType"  text not null
              check ("itemType" in ('product','filling','packaging','ingredient')),
  "itemId"    uuid not null,
  -- Only meaningful for products (which have per-location stock via
  -- stockLocations). Null for fillings / packaging / ingredients.
  location    text
              check (location is null or location in ('store','production','freezer','allocated')),
  -- Signed delta. numeric(12,3) so we can represent grams of
  -- ingredient stock as well as integer piece counts.
  "deltaQty"  numeric(12,3) not null,
  reason      text not null
              check (reason in ('opening_balance','found','damaged','correction','other')),
  note        text,
  "createdBy" text,
  "createdAt" timestamptz not null default now()
);
create index on public."stockAdjustments" ("itemType", "itemId", "createdAt" desc);
create index on public."stockAdjustments" (reason, "createdAt" desc);
create index on public."stockAdjustments" ("createdAt" desc);

-- RLS — same authenticated-only pattern as every other Dulceria table.
do $$
declare p text;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'stockAdjustments'
  loop
    execute format('drop policy if exists %I on public."stockAdjustments"', p);
  end loop;
  execute 'alter table public."stockAdjustments" enable row level security';
  execute 'create policy "authenticated_full_access" on public."stockAdjustments" '
       || 'for all to authenticated using (true) with check (true)';
end$$;

notify pgrst, 'reload schema';
