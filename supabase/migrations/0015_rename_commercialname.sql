-- =============================================================
-- Dulceria Production — fix ingredients.commercialName casing
-- Migration 0015: rename the unquoted commercialname column so
--                 PostgREST can find it from JSON payloads
-- =============================================================
--
-- Depends on migration 0001 where the column was originally created.
--
-- Bug: migration 0001 declared `commercialName text` (without double
-- quotes). Postgres folds unquoted identifiers to lowercase, so the
-- actual column landed as `commercialname`. Every other camelCase
-- column on ingredients IS double-quoted (`"purchaseCost"`,
-- `"cacaoFat"`, etc.), so this was the only stray one.
--
-- PostgREST matches JSON keys to column names exactly as they exist
-- in pg_catalog — so an insert with `{"commercialName": "Guanaja 70%"}`
-- fails with PGRST204 ("Could not find the 'commercialName' column
-- of 'ingredients' in the schema cache") even though the column does
-- exist under a lowercase name.
--
-- Fix: rename the lowercase column to the quoted camelCase version so
-- it matches both the TS type and what every app write sends. Done
-- idempotently so re-runs are harmless.

do $$
declare
  exists_cc boolean := false;
  exists_lc boolean := false;
begin
  select true into exists_cc
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'ingredients'
    and column_name = 'commercialName';

  select true into exists_lc
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'ingredients'
    and column_name = 'commercialname';

  if exists_lc and not exists_cc then
    execute 'alter table public.ingredients rename column commercialname to "commercialName"';
  end if;
end$$;
