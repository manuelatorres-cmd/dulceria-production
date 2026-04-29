-- 0060_people_richer_fields.sql
-- Broadens the `people` record to support richer employee setup and
-- labour-cost calculations:
--   - hourlyCostEuros  — used for per-batch labour cost
--   - breakMinutesPerDay — subtracted from daily capacity
--   - contactEmail / contactPhone — optional
--   - contractType (enum text) — full-time / part-time / contractor
-- Also adds an `absenceType` and `approved` flag to `personUnavailability`
-- so vacation / sick / appointment / course entries can be distinguished
-- (replaces the need to migrate to the newer `personAvailabilityExceptions`
-- table, which was spec'd but never rolled out — this keeps the live
-- table in use and avoids a data copy).

alter table public.people
  add column if not exists "hourlyCostEuros"    numeric(8, 2),
  add column if not exists "breakMinutesPerDay" integer,
  add column if not exists "contactEmail"       text,
  add column if not exists "contactPhone"       text,
  add column if not exists "contractType"       text;

-- Soft constraint: break 0–240 min (4 h), hourly 0–200 €.
alter table public.people
  drop constraint if exists people_breakMinutes_range;
alter table public.people
  add constraint people_breakMinutes_range
  check ("breakMinutesPerDay" is null or ("breakMinutesPerDay" >= 0 and "breakMinutesPerDay" <= 240));

alter table public.people
  drop constraint if exists people_hourlyCost_range;
alter table public.people
  add constraint people_hourlyCost_range
  check ("hourlyCostEuros" is null or ("hourlyCostEuros" >= 0 and "hourlyCostEuros" <= 200));

alter table public.people
  drop constraint if exists people_contractType_check;
alter table public.people
  add constraint people_contractType_check
  check ("contractType" is null or "contractType" in ('full_time', 'part_time', 'contractor'));

-- --- personUnavailability: absence type + approved flag ----------------

alter table public."personUnavailability"
  add column if not exists "absenceType" text,
  add column if not exists "approved"    boolean not null default true;

alter table public."personUnavailability"
  drop constraint if exists personUnavailability_absenceType_check;
alter table public."personUnavailability"
  add constraint personUnavailability_absenceType_check
  check ("absenceType" is null or "absenceType" in (
    'vacation',
    'sick',
    'appointment',
    'course_taught',
    'personal',
    'other'
  ));

notify pgrst, 'reload schema';
