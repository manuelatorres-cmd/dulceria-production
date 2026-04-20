-- =============================================================
-- Dulceria Production — borrow scheduling: rename finishing → packing
-- Migration 0034
-- =============================================================
--
-- The original 0033 introduced `productionSteps.isFinishingStep` for the
-- borrow-from-Store scheduler. That name was too broad: Store pralines
-- are already fully finished (polished, painted, decorated) — the only
-- real work left for a borrow is packing them into boxes / ribbons for
-- the specific order. Rename the column so the semantics are obvious
-- and the scheduler filter can be read at a glance.
--
-- Idempotent both ways: handles the case where 0033 was already applied
-- (rename the existing column) and the case where 0033 was never applied
-- (add a fresh isPackingStep column).
-- =============================================================

do $$
declare
  has_old boolean;
  has_new boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'productionSteps'
      and column_name = 'isFinishingStep'
  ) into has_old;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'productionSteps'
      and column_name = 'isPackingStep'
  ) into has_new;

  if has_old and not has_new then
    -- Typical path: 0033 was applied; rename in place.
    execute 'alter table public."productionSteps" rename column "isFinishingStep" to "isPackingStep"';
  elsif not has_new then
    -- 0033 never ran (prod was stuck on an old bundle). Add fresh.
    execute 'alter table public."productionSteps" '
         || 'add column "isPackingStep" boolean not null default false';
  end if;

  -- If old + new both exist (shouldn't happen, but be safe) copy values
  -- forward and drop the orphan.
  if has_old and has_new then
    execute 'update public."productionSteps" '
         || 'set "isPackingStep" = coalesce("isPackingStep", false) or coalesce("isFinishingStep", false)';
    execute 'alter table public."productionSteps" drop column "isFinishingStep"';
  end if;
end$$;

notify pgrst, 'reload schema';
