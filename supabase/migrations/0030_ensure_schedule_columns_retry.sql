-- =============================================================
-- Dulceria Production — ensure productionSchedule columns (retry)
-- Migration 0030: self-contained replacement for 0029's DO block
-- =============================================================
--
-- 0029 used the classic `SELECT constraint_name INTO con` pattern
-- to drop the legacy phase CHECK. The Supabase SQL editor parses
-- that as a table reference (`relation "con" does not exist`),
-- same quirk that bit 0021. Rewriting with a FOR … LOOP —
-- identical technique we used successfully in 0022 and 0028.
--
-- Everything else from 0029 is idempotent via IF NOT EXISTS, so
-- this file fully supersedes it: safe on any database state
-- whether 0029 ran partially, completely, or not at all.
-- =============================================================

-- Drop any leftover productionSchedule_phase_check constraint.
do $$
declare
  con text;
begin
  for con in
    select constraint_name
    from information_schema.check_constraints
    where constraint_schema = 'public'
      and constraint_name like 'productionSchedule_phase_check%'
  loop
    execute format('alter table public."productionSchedule" drop constraint %I', con);
  end loop;
end$$;

-- Add the two columns 0013 was supposed to add.
alter table public."productionSchedule"
  add column if not exists "stepId" uuid references public."productionSteps"(id) on delete set null,
  add column if not exists "equipmentId" uuid references public.equipment(id) on delete set null;

-- Supporting indexes.
create index if not exists "productionSchedule_stepId_idx"
  on public."productionSchedule" ("stepId");
create index if not exists "productionSchedule_equipmentId_idx"
  on public."productionSchedule" ("equipmentId");

-- Nudge PostgREST to refresh its schema cache so the new columns
-- show up in the REST API immediately (Supabase listens for this
-- channel; it's a no-op on plain Postgres).
notify pgrst, 'reload schema';
