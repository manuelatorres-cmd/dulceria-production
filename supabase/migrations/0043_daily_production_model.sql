-- =============================================================
-- Dulceria Production — Daily Production model
-- Migration 0043
-- =============================================================
--
-- Structural shift: scheduling moves from per-step rows
-- (productionSchedule) to a (day, batch) model. One batch can now
-- appear on many days; step progress still lives on the batch via
-- planStepStatus (unchanged). Replaces productionSchedule.
--
-- Also folds the orderPlanLinks RLS policy that 0042 failed to
-- persist. Uses plain DDL rather than a DO block so the CREATE POLICY
-- statement can't silently no-op.
--
-- Note on productionDays: the table already exists (migration 0020,
-- HACCP). Rather than introduce a parallel "scheduled days" table,
-- this migration adds a `status` column to the existing productionDays
-- so one row per date carries both the HACCP open/close state and the
-- scheduler's draft/active/done status. Scheduler creates a row (or
-- ON CONFLICT does nothing) for each date it places work on.
--
-- Idempotent. Assumes productionPlans, planProducts, planStepStatus,
-- orderPlanLinks already exist and that all orders / productions
-- have been wiped before running (orphan rows cleared 2026-04-22).
-- =============================================================

-- 1) Finish the orderPlanLinks RLS policy that 0042 didn't persist.
alter table public."orderPlanLinks" enable row level security;
drop policy if exists "authenticated_full_access" on public."orderPlanLinks";
create policy "authenticated_full_access" on public."orderPlanLinks"
  for all to authenticated using (true) with check (true);

-- 2) Extend productionDays with a scheduler-facing status column.
--    Existing HACCP rows get the default 'draft' backfill; new rows
--    inserted by the scheduler set 'draft'. Opening / closing the day
--    updates this alongside openedAt / closedAt.
alter table public."productionDays"
  add column if not exists "status" text not null default 'draft';

-- Drop any stale check constraint before adding the canonical one.
-- Constraint names vary (auto-generated vs explicit) — the loop
-- handles both.
do $$
declare con text;
begin
  for con in
    select constraint_name
    from information_schema.check_constraints
    where constraint_schema = 'public'
      and constraint_name like 'productionDays_status_check%'
  loop
    execute format('alter table public."productionDays" drop constraint %I', con);
  end loop;
end$$;
alter table public."productionDays"
  add constraint "productionDays_status_check"
  check ("status" in ('draft','active','done'));

-- Backfill status for any existing rows based on open/close state.
-- 'done' if closedAt is set, 'active' if opened but not closed, else
-- 'draft'. Safe to run on an empty table.
update public."productionDays"
   set "status" = case
     when "closedAt" is not null then 'done'
     when "openedAt" is not null then 'active'
     else 'draft'
   end
 where "status" = 'draft';

-- 3) productionDayLineItems — one row per batch's appearance on one
--    day. stepIds is a text[] of productionSteps.id values whose
--    work lands in this day for this batch. Ordering follows
--    productionSteps.sortOrder; we don't enforce it at the DB level,
--    callers canonicalise at render.
create table if not exists public."productionDayLineItems" (
  id                  uuid primary key,
  "productionDayId"   uuid not null
                      references public."productionDays"(id) on delete cascade,
  "planId"            uuid not null
                      references public."productionPlans"(id) on delete cascade,
  "stepIds"           text[] not null default '{}',
  "plannedMinutes"    integer not null default 0
                      check ("plannedMinutes" >= 0),
  "sortOrder"         integer not null default 0,
  "createdAt"         timestamptz not null default now(),
  "updatedAt"         timestamptz not null default now(),
  unique ("productionDayId", "planId")
);
create index if not exists "productionDayLineItems_day_idx"
  on public."productionDayLineItems" ("productionDayId");
create index if not exists "productionDayLineItems_plan_idx"
  on public."productionDayLineItems" ("planId");

alter table public."productionDayLineItems" enable row level security;
drop policy if exists "authenticated_full_access" on public."productionDayLineItems";
create policy "authenticated_full_access" on public."productionDayLineItems"
  for all to authenticated using (true) with check (true);

-- 4) Merging-window setting: how far out Regenerate should try to
--    merge new demand into existing forward-filled days before
--    switching to pure reverse-scheduling. Default 2 weeks, allowed
--    values 1 / 2 / 4.
alter table public."capacityConfig"
  add column if not exists "mergingWindowWeeks" integer default 2
    check ("mergingWindowWeeks" in (1, 2, 4));

-- 5) Drop productionSchedule — superseded by productionDayLineItems.
--    Orphaned rows were cleared in the 2026-04-22 wipe. CASCADE on
--    drop is safe because nothing else references it.
drop table if exists public."productionSchedule" cascade;

notify pgrst, 'reload schema';
