-- =============================================================
-- Dulceria Production — free-form step names on the schedule
-- Migration 0013: drop the hardcoded phase enum on productionSchedule;
--                 add stepId FK to productionSteps and equipmentId FK.
-- =============================================================
--
-- Depends on 0002 (productionSchedule), 0010 (equipment), 0011
-- (productionSteps). Schedule has never been written to from app
-- code — safe to loosen the constraint.
--
-- Why: §3 replaced the fixed-phase table with free-text productionSteps,
-- so schedule rows need to reference whatever step the user defined.
-- We keep `phase` as a convenience label (step name copied in) but drop
-- the enum CHECK so custom names fit.

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
