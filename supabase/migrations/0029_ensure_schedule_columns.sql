-- =============================================================
-- Dulceria Production — ensure productionSchedule has stepId + equipmentId
-- Migration 0029: idempotent re-application of 0013
-- =============================================================
--
-- Symptom: Regenerate Plan fails with
--   PGRST204: Could not find the 'stepId' column of
--   'productionSchedule' in the schema cache
--
-- Migration 0013 was supposed to add `stepId` + `equipmentId`
-- columns referencing productionSteps / equipment. On this project
-- it never ran, so the INSERT hits PostgREST and rejects the
-- payload before reaching Postgres — by which point the DELETE
-- already ran, wiping the existing schedule.
--
-- Fix forward: re-apply 0013's structural changes with IF NOT
-- EXISTS guards, drop the legacy phase CHECK if it's still in
-- place, and nudge PostgREST to refresh its cache so the new
-- columns show up immediately.
-- =============================================================

-- Drop the legacy phase CHECK — 0013 did this, but only if it
-- existed. On any project where 0013 didn't run the check is still
-- there and blocks inserts with free-form step names.

do $$
declare
  con text;
begin
  select constraint_name into con
  from information_schema.check_constraints
  where constraint_schema = 'public'
    and constraint_name like 'productionSchedule_phase_check%'
  limit 1;
  if con is not null then
    execute format('alter table public."productionSchedule" drop constraint %I', con);
  end if;
end$$;

alter table public."productionSchedule"
  add column if not exists "stepId" uuid references public."productionSteps"(id) on delete set null,
  add column if not exists "equipmentId" uuid references public.equipment(id) on delete set null;

create index if not exists "productionSchedule_stepId_idx"
  on public."productionSchedule" ("stepId");
create index if not exists "productionSchedule_equipmentId_idx"
  on public."productionSchedule" ("equipmentId");

-- Refresh PostgREST's schema cache so the new columns are
-- immediately visible to the REST API.
notify pgrst, 'reload schema';
