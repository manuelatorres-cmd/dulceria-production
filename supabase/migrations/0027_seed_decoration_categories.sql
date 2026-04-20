-- =============================================================
-- Dulceria Production — default decoration categories + back-fill
-- Migration 0027: seed the four canonical categories, plus any
--                 slug referenced by existing decoration materials
--                 that isn't in the categories table yet
-- =============================================================
--
-- Symptom: users report they can't select a category on a decoration
-- material even after creating one. Root cause is usually that the
-- decorationCategories table is empty (no seed fired, or the table
-- was wiped by clearAllData) and the material still carries a legacy
-- slug like "cocoa_butter" with no matching row.
--
-- This migration:
--   1. Inserts the four default categories (cocoa_butter, lustre_dust,
--      transfer_sheet, other) if their slugs aren't already present.
--   2. Back-fills a category row for every distinct slug currently
--      used on a decorationMaterials row that isn't yet in the table
--      (covers imported data or custom slugs typed over the years).
--
-- Idempotent via NOT EXISTS — re-running does nothing when everything
-- is already in place.
-- =============================================================

-- 1. Default set (name + slug pairs match DEFAULT_DECORATION_CATEGORIES
--    in src/types/index.ts).

insert into public."decorationCategories" (id, name, slug, archived, "createdAt", "updatedAt")
select gen_random_uuid(), src.name, src.slug, false, now(), now()
from (values
  ('Cocoa Butter',    'cocoa_butter'),
  ('Lustre Dust',     'lustre_dust'),
  ('Transfer Sheet',  'transfer_sheet'),
  ('Other',           'other')
) as src(name, slug)
where not exists (
  select 1 from public."decorationCategories" c
  where lower(trim(c.slug)) = lower(trim(src.slug))
);

-- 2. Back-fill any slug already used by a material but missing from
--    the categories table. name = slug until the user renames it in
--    the UI — better than nothing, and prevents the Type dropdown
--    from being empty.

insert into public."decorationCategories" (id, name, slug, archived, "createdAt", "updatedAt")
select
  gen_random_uuid(),
  src.slug,       -- placeholder display name; user can rename
  src.slug,
  false,
  now(),
  now()
from (
  select distinct type as slug
  from public."decorationMaterials"
  where type is not null and trim(type) <> ''
) src
where not exists (
  select 1 from public."decorationCategories" c
  where lower(trim(c.slug)) = lower(trim(src.slug))
);
