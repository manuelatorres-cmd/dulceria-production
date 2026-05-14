-- ====================================================================
-- 0090 — planStepStatus.startedAt + .personId + .pausedAt
-- ====================================================================
--
-- Unblocks per-step time-tracking + assignee on /production-brain/daily
-- + the wizard step-detail drawer. Three nullable fields:
--
--   startedAt  — timestamp when the step first transitioned to
--                in-progress (Start button pressed). Used to compute
--                elapsed time in the workshop Right-now card.
--   personId   — who's working this step. Free-text reference to
--                people.id; surfaced as a chip on the daily view + in
--                the wizard step drawer's "Reassign" menu.
--   pausedAt   — timestamp when the step was paused. Reset to null on
--                resume. When set + startedAt non-null + done=false,
--                the daily view shows "paused — Xm".
--
-- Idempotent — `add column if not exists` so repeated runs are safe.

alter table public."planStepStatus"
  add column if not exists "startedAt" timestamptz;

alter table public."planStepStatus"
  add column if not exists "personId" text;

alter table public."planStepStatus"
  add column if not exists "pausedAt" timestamptz;

comment on column public."planStepStatus"."startedAt" is
  'Timestamp when the step first transitioned to in-progress. Drives elapsed-time display on /production-brain/daily.';
comment on column public."planStepStatus"."personId" is
  'Person actively working this step. Free-text reference to people.id.';
comment on column public."planStepStatus"."pausedAt" is
  'Timestamp when the step was paused. Cleared on resume. When non-null + startedAt non-null + done=false, the daily view shows the step as paused.';

notify pgrst, 'reload schema';
