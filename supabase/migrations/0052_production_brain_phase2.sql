-- =============================================================
-- Dulceria Production Brain — Phase 2 equipment + mould + staff
-- Migration 0052
-- =============================================================
--
-- Six new tables. All additive, idempotent, RLS under the standard
-- `authenticated_full_access` policy.
--
--   1) equipmentInstances  — physical copies hanging off equipment types
--   2) machineLoads        — what chocolate is in which machine right now
--   3) coldStorageUnits    — per-fridge/freezer identity + HACCP targets
--   4) mouldUsageLog       — every mould instance's cycle history
--   5) staffShifts         — shift-level clock-in/out per person per day
--   6) personAvailabilityExceptions — vacation/sick/course leading windows
-- =============================================================

-- ─── 1) equipmentInstances ───────────────────────────────────
-- The existing `equipment` table describes equipment *types*
-- (occupancyMinutes, tempCheck flag). This table represents each
-- physical machine/pot the workshop owns so we can track chocolate
-- loaded, days aging, brand/model, serial.
create table if not exists public."equipmentInstances" (
  id uuid primary key default gen_random_uuid(),
  "equipmentId" uuid not null references public.equipment(id) on delete cascade,
  name text not null,
  brand text,
  model text,
  "serialNumber" text,
  "capacityKg" numeric(8, 3),
  "location" text,
  status text not null default 'idle'
    check (status in ('idle', 'running', 'maintenance', 'retired')),
  notes text,
  archived boolean not null default false,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists equipment_instances_equipment_idx
  on public."equipmentInstances" ("equipmentId");

alter table public."equipmentInstances" enable row level security;
drop policy if exists "authenticated_full_access" on public."equipmentInstances";
create policy "authenticated_full_access" on public."equipmentInstances"
  for all to authenticated using (true) with check (true);


-- ─── 2) machineLoads ─────────────────────────────────────────
-- One row per active chocolate load in a machine. When the
-- chocolate is fully drained or switched, row moves to status
-- 'idle' / 'draining' or a new row is inserted for the next load.
create table if not exists public."machineLoads" (
  id uuid primary key default gen_random_uuid(),
  "equipmentInstanceId" uuid not null
    references public."equipmentInstances"(id) on delete cascade,
  "ingredientId" uuid not null references public.ingredients(id) on delete restrict,
  "loadedQuantityG" numeric(12, 2) not null,
  "remainingQuantityG" numeric(12, 2) not null,
  "loadedAt" timestamptz not null default now(),
  "lastUsedAt" timestamptz,
  status text not null default 'in_use'
    check (status in ('in_use', 'idle', 'draining', 'switched')),
  "agingAlertThresholdDays" integer not null default 7
    check ("agingAlertThresholdDays" > 0),
  notes text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists machine_loads_equipment_idx
  on public."machineLoads" ("equipmentInstanceId", status);

alter table public."machineLoads" enable row level security;
drop policy if exists "authenticated_full_access" on public."machineLoads";
create policy "authenticated_full_access" on public."machineLoads"
  for all to authenticated using (true) with check (true);


-- ─── 3) coldStorageUnits ─────────────────────────────────────
-- Each fridge/freezer/ambient unit with its HACCP target range.
-- Temperature readings hang off this table (phase 3 migration
-- will add the `temperatureReadings` child table).
create table if not exists public."coldStorageUnits" (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  "location" text not null
    check ("location" in ('production', 'shop', 'storage', 'other')),
  "type" text not null default 'fridge'
    check ("type" in ('fridge', 'freezer', 'ambient')),
  "targetTempMinC" numeric(4, 1),
  "targetTempMaxC" numeric(4, 1),
  "requiresTempCheck" boolean not null default true,
  "checkFrequencyPerDay" integer not null default 2
    check ("checkFrequencyPerDay" > 0),
  archived boolean not null default false,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

alter table public."coldStorageUnits" enable row level security;
drop policy if exists "authenticated_full_access" on public."coldStorageUnits";
create policy "authenticated_full_access" on public."coldStorageUnits"
  for all to authenticated using (true) with check (true);


-- ─── 4) mouldUsageLog ────────────────────────────────────────
-- Full cycle history per mould instance — needed for traceability
-- and deep-wash scheduling.
create table if not exists public."mouldUsageLog" (
  id uuid primary key default gen_random_uuid(),
  "mouldPoolId" uuid not null references public."mouldPool"(id) on delete cascade,
  "planId" uuid references public."productionPlans"(id) on delete set null,
  "startedAt" timestamptz not null default now(),
  "freedAt" timestamptz,
  "cycleCompleted" boolean not null default false,
  "deepWashDone" boolean not null default false,
  notes text,
  "createdAt" timestamptz not null default now()
);

create index if not exists mould_usage_pool_idx
  on public."mouldUsageLog" ("mouldPoolId", "startedAt" desc);

alter table public."mouldUsageLog" enable row level security;
drop policy if exists "authenticated_full_access" on public."mouldUsageLog";
create policy "authenticated_full_access" on public."mouldUsageLog"
  for all to authenticated using (true) with check (true);


-- ─── 5) staffShifts ──────────────────────────────────────────
-- Per-person per-day shift tracking. Powers the clock-in/out
-- widget + labor cost per batch attribution.
create table if not exists public."staffShifts" (
  id uuid primary key default gen_random_uuid(),
  "personId" uuid not null references public.people(id) on delete cascade,
  "shiftDate" date not null,
  "clockInAt" timestamptz not null default now(),
  "clockOutAt" timestamptz,
  "breakMinutes" integer not null default 0 check ("breakMinutes" >= 0),
  "location" text
    check ("location" in ('production', 'shop', 'course', 'other') or "location" is null),
  "linkedPlanIds" uuid[] not null default '{}'::uuid[],
  notes text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists staff_shifts_person_date_idx
  on public."staffShifts" ("personId", "shiftDate" desc);

alter table public."staffShifts" enable row level security;
drop policy if exists "authenticated_full_access" on public."staffShifts";
create policy "authenticated_full_access" on public."staffShifts"
  for all to authenticated using (true) with check (true);


-- ─── 6) personAvailabilityExceptions ─────────────────────────
-- Sits next to the existing `personUnavailability` table (which is
-- vacation-style "person is off"). This richer table lets HR-style
-- cases (course-leading, training, partial days) model themselves
-- without the constraints of the legacy table.
create table if not exists public."personAvailabilityExceptions" (
  id uuid primary key default gen_random_uuid(),
  "personId" uuid not null references public.people(id) on delete cascade,
  "dateFrom" date not null,
  "dateTo" date not null,
  "type" text not null default 'vacation'
    check ("type" in (
      'vacation',
      'sick',
      'course-leading',
      'training',
      'partial',
      'other'
    )),
  "allDay" boolean not null default true,
  "hoursFrom" time,
  "hoursTo" time,
  approved boolean not null default false,
  notes text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists person_availability_person_idx
  on public."personAvailabilityExceptions" ("personId", "dateFrom");

alter table public."personAvailabilityExceptions" enable row level security;
drop policy if exists "authenticated_full_access" on public."personAvailabilityExceptions";
create policy "authenticated_full_access" on public."personAvailabilityExceptions"
  for all to authenticated using (true) with check (true);


-- ─── 7) updated_at touch triggers ────────────────────────────
-- Reuses the set_updated_at() function from migration 0051.
do $$
declare tbl text;
begin
  for tbl in
    select unnest(array[
      'equipmentInstances',
      'machineLoads',
      'coldStorageUnits',
      'staffShifts',
      'personAvailabilityExceptions'
    ])
  loop
    execute format(
      'drop trigger if exists set_%s_updated_at on public.%I;',
      tbl,
      tbl
    );
    execute format(
      'create trigger set_%s_updated_at before update on public.%I
       for each row execute function public.set_updated_at();',
      tbl,
      tbl
    );
  end loop;
end$$;

-- =============================================================
-- End of 0052 — production-brain phase 2
-- =============================================================
