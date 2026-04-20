-- =============================================================
-- Dulceria Production — back-fill categories from existing rows
-- Migration 0024: one-shot recovery for imports that landed before
--                 the auto-create-categories fix
-- =============================================================
--
-- Symptom: ingredients (and/or fillings) were imported from a CSV
-- that populated the `category` text field on each row, but the
-- `ingredientCategories` / `fillingCategories` tables stayed empty.
-- The UI reads categories from those tables for dropdowns and
-- filter chips, so the edit form shows "no category selected" and
-- the list page shows no category filter, even though each row's
-- own category column is correct.
--
-- Fix forward: the CSV import code now auto-creates missing category
-- rows during commit. This migration repairs databases that already
-- imported before the fix landed by inserting one category row per
-- distinct non-empty category string used on existing rows.
--
-- Idempotent: only inserts categories that aren't already present
-- (case-insensitive match). Re-running is a no-op.
-- =============================================================

-- Ingredient categories
insert into public."ingredientCategories" (id, name, archived, "createdAt", "updatedAt")
select
  gen_random_uuid(),
  trim(src.category),
  false,
  now(),
  now()
from (
  select distinct category from public.ingredients where category is not null and trim(category) <> ''
) src
where not exists (
  select 1 from public."ingredientCategories" c
  where lower(trim(c.name)) = lower(trim(src.category))
);

-- Filling categories — same pattern. shelfStable defaults to false;
-- users flip it in Settings for Pralines / Fruit-based etc. where the
-- production wizard should treat the filling as shelf-stable.
insert into public."fillingCategories" (id, name, "shelfStable", archived, "createdAt", "updatedAt")
select
  gen_random_uuid(),
  trim(src.category),
  false,
  false,
  now(),
  now()
from (
  select distinct category from public.fillings where category is not null and trim(category) <> ''
) src
where not exists (
  select 1 from public."fillingCategories" c
  where lower(trim(c.name)) = lower(trim(src.category))
);
