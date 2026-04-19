-- =============================================================
-- Dulceria Production — per-person capacity model
-- Migration 0009: people + personUnavailability tables; drop the
--                 now-obsolete global people columns from capacityConfig
-- =============================================================
--
-- Depends on migrations 0001-0008.
--
-- Replaces the global "peopleCount × hoursPerPersonPerDay × workingDays"
-- trio on capacityConfig with a per-person model. Each person has their
-- own default hours, own working days, own unavailability ranges, and
-- one or more free-text roles. The scheduler sums available hours across
-- every person per day after honoring the per-person calendar and the
-- workshop-wide `eventCalendar(kind='blocked')` entries.
--
-- Buffer + threshold fields on capacityConfig stay put — those are
-- still workshop-wide.
-- =============================================================

-- ---------- People ----------
--
-- Fully user-managed via Settings → Capacity & People. Ships empty.
-- "No defaults, no business values" (house rule, 2026-04-19):
--   - roles, workingDays, defaultHoursPerDay are all nullable
--   - archived has a structural default of false (flag column)
--
-- roles is a text[] so a person can hold multiple (e.g. "chocolatier"
-- and "owner"). The UI offers existing roles as autocomplete picks but
-- any new string is allowed — we don't constrain to a fixed enum.

create table people (
  id                    uuid primary key,
  name                  text not null,
  roles                 text[],
  "defaultHoursPerDay"  numeric(4,2)
                        check ("defaultHoursPerDay" is null or
                               ("defaultHoursPerDay" > 0 and "defaultHoursPerDay" <= 24)),
  "workingDays"         text[],
  archived              boolean not null default false,
  "createdAt"           timestamptz not null default now(),
  "updatedAt"           timestamptz not null default now()
);
create index on people (archived);

-- ---------- Person unavailability ----------
--
-- One row per unavailability window. Separate table (rather than a
-- jsonb column on people) so we can query "who's out this week"
-- cheaply and let the scheduler deduct hours per-day in a single join.
--
-- Workshop-wide closures (equipment service, public holidays that
-- close the whole shop) live in eventCalendar with kind='blocked'.

create table "personUnavailability" (
  id          uuid primary key,
  "personId"  uuid not null references people(id) on delete cascade,
  "startDate" date not null,
  "endDate"   date not null,
  notes       text,
  "createdAt" timestamptz not null default now(),
  check ("endDate" >= "startDate")
);
create index on "personUnavailability" ("personId");
create index on "personUnavailability" ("startDate");

-- RLS — 0003's DO loop only covers tables present at that point, so
-- new tables need their policy wired in their own migration.

alter table people enable row level security;
create policy "authenticated_full_access" on people
  for all to authenticated
  using (true) with check (true);

alter table "personUnavailability" enable row level security;
create policy "authenticated_full_access" on "personUnavailability"
  for all to authenticated
  using (true) with check (true);

-- ---------- Retire the global people columns on capacityConfig ----------
--
-- peopleCount / hoursPerPersonPerDay / workingDays are now per-person
-- (people.defaultHoursPerDay + people.workingDays, aggregated by the
-- scheduler). Buffer + threshold fields stay on capacityConfig.

alter table public."capacityConfig" drop column if exists "peopleCount";
alter table public."capacityConfig" drop column if exists "hoursPerPersonPerDay";
alter table public."capacityConfig" drop column if exists "workingDays";
