-- ====================================================================
-- 0091 — productionDayNotes table
-- ====================================================================
--
-- Backs the day-detail drawer's "Day notes" textarea on
-- /production-brain/plan + /plan day view (per WEEKLY_PLAN_REDESIGN_SPEC
-- phase 5.5). One row per production day; the drawer upserts on save.
--
-- Kept separate from `productionDays.summary` (which holds the
-- close-of-day summary JSON) so users can scribble notes throughout
-- the day without colliding with the summary write at close-out.
--
-- Idempotent — `create table if not exists`. Re-runs only re-issue
-- comments + the PostgREST schema-reload notify.

create table if not exists public."productionDayNotes" (
  id text primary key,
  "productionDayId" uuid not null references public."productionDays" (id) on delete cascade,
  notes text not null default '',
  "updatedAt" timestamptz not null default now(),
  "updatedBy" text
);

create unique index if not exists "productionDayNotes_dayId_unique"
  on public."productionDayNotes" ("productionDayId");

comment on table public."productionDayNotes" is
  'Free-text notes scribbled throughout a production day. Distinct from productionDays.summary (close-of-day) so mid-day notes do not collide with the close-out write.';
comment on column public."productionDayNotes"."productionDayId" is
  'FK to productionDays — one note row per day.';
comment on column public."productionDayNotes"."updatedBy" is
  'Free-text reference to people.id — who last edited the notes.';

notify pgrst, 'reload schema';
