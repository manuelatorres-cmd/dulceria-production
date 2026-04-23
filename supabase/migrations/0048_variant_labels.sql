-- =============================================================
-- Dulceria Production — variant labels (Collections feature)
-- Migration 0048: add labels text[] column to variants
-- =============================================================
--
-- Why
--   The Collections page is a derived view over variant labels.
--   Every unique label across all variants becomes a collection;
--   variants show up under each of their labels. Labels are free
--   text (case-preserved as typed, de-duplicated case-insensitively
--   in the UI).
--
-- Schema
--   labels text[] not null default '{}' on public.variants
--   GIN index so filtering "variants with label X" is efficient
--
-- Idempotent: guards the column add so re-running is safe.
-- =============================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'variants'
      and column_name = 'labels'
  ) then
    execute 'alter table public.variants add column labels text[] not null default ''{}''::text[]';
  end if;
end $$;

create index if not exists "variants_labels_gin_idx"
  on public.variants using gin (labels);

notify pgrst, 'reload schema';
