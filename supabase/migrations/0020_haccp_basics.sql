-- =============================================================
-- Dulceria Production — HACCP basics (temperature log + production days)
-- Migration 0020: Phase 1 minimum for legal compliance (partial)
-- =============================================================
--
-- Depends on 0002 (equipment, productionPlans, productionSchedule).
--
-- Scope of this migration
--   Temperature log only. The cleaning checklist (handover §3.4) is
--   intentionally skipped until Manuela wants to turn it on — the
--   schema for `haccp_cleaning_items` / `haccp_cleaning_logs` will
--   come in a later migration when the UI is built.
--
-- What this introduces
--   equipment.requiresTempCheck    — whether this device shows up in
--                                    the daily HACCP popup.
--   equipment.tempMinC / tempMaxC  — target temperature range (°C),
--                                    CHECK ensures min ≤ max when both
--                                    are set.
--   equipment.location             — shop / production / storage. Drives
--                                    the "location" column in the HACCP
--                                    history export.
--
--   productionDays                 — one row per calendar date the
--                                    workshop is open. Records when
--                                    the day was opened / closed and
--                                    holds a summary JSON (batches run,
--                                    pieces produced, steps completed)
--                                    for the daily diary.
--
--   haccpTemperatureLogs           — append-only reading log. One row
--                                    per (device, reading). `isWithinRange`
--                                    is evaluated at write time against
--                                    the equipment row's range.
-- =============================================================

alter table equipment
  add column if not exists "requiresTempCheck" boolean not null default false,
  add column if not exists "tempMinC" numeric(5,2),
  add column if not exists "tempMaxC" numeric(5,2),
  add column if not exists "location" text
    check ("location" is null or "location" in ('shop','production','storage'));

-- min ≤ max when both are populated. Added as a named CHECK so the app
-- can surface a clear error on save if the user inverts the range.
alter table equipment
  drop constraint if exists equipment_temp_range_check;
alter table equipment
  add constraint equipment_temp_range_check
  check (
    "tempMinC" is null
    or "tempMaxC" is null
    or "tempMinC" <= "tempMaxC"
  );

create table "productionDays" (
  id              uuid primary key,
  -- Stored as a date column (one row per calendar day, no timezone
  -- ambiguity). The `openedAt` / `closedAt` timestamps record when the
  -- day was actually opened and closed for deeper audit.
  date            date not null,
  "openedAt"      timestamptz not null default now(),
  "openedBy"      text,
  "closedAt"      timestamptz,
  "closedBy"      text,
  "tempLogComplete" boolean not null default false,
  -- Cleaning flag reserved for the later cleaning-checklist migration.
  "cleaningComplete" boolean not null default false,
  -- Summary of what happened that day — written by Close Production.
  -- Free-form JSON so the shape can evolve as the dashboard's daily
  -- diary grows.
  "summaryJson"   jsonb not null default '{}'::jsonb,
  "createdAt"     timestamptz not null default now(),
  "updatedAt"     timestamptz not null default now(),
  unique (date)
);
create index on "productionDays" ("date" desc);

create table "haccpTemperatureLogs" (
  id              uuid primary key,
  "equipmentId"   uuid not null references equipment(id) on delete cascade,
  "temperatureC"  numeric(5,2) not null,
  "isWithinRange" boolean not null,
  note            text,
  "loggedBy"      text,
  "loggedAt"      timestamptz not null default now(),
  "productionDayId" uuid references "productionDays"(id) on delete set null
);
create index on "haccpTemperatureLogs" ("equipmentId", "loggedAt" desc);
create index on "haccpTemperatureLogs" ("productionDayId");
create index on "haccpTemperatureLogs" ("loggedAt" desc);
-- Out-of-range readings are the ones inspectors care about; index
-- them partially so "show me every incident" stays cheap.
create index on "haccpTemperatureLogs" ("loggedAt" desc) where "isWithinRange" = false;

-- =============================================================
-- RLS for the new tables.
-- =============================================================

do $$
declare
  t text;
  p text;
begin
  for t in
    select unnest(array['productionDays','haccpTemperatureLogs'])
  loop
    for p in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "authenticated_full_access" on public.%I ' ||
      'for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end$$;
