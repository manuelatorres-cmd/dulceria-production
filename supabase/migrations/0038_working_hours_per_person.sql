-- Working hours per person
--
-- Each production worker gets a configurable daily start/end time
-- (07:00–23:00). The scheduler sums (end−start) minutes across every
-- non-archived person on a given day to compute that day's active-minutes
-- budget — replacing the coarser `defaultHoursPerDay` field for users who
-- want precise windows.
--
-- Back-compat: `defaultHoursPerDay` stays on the table and is the fallback
-- when start/end aren't set. Existing rows without start/end keep working
-- under the old 8h model.

alter table public.people
  add column if not exists "startTimeOfDay" time,
  add column if not exists "endTimeOfDay"   time;

-- Idempotent re-run of the schema cache refresh — lets the PostgREST
-- connection pool discover the new columns without a server restart.
notify pgrst, 'reload schema';
