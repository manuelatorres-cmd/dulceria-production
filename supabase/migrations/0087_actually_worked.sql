-- ====================================================================
-- 0087 — productionDayLineItems.actuallyWorked
-- ====================================================================
--
-- Spec: docs/WEEKLY_PLAN_REDESIGN_SPEC.md, phase 5.
--
-- Marks individual line items as having actually been worked. Set by
-- the day-detail drawer's "Mark as worked" action. The flag prevents
-- the auto-planner from rescheduling history once a day's work is
-- captured.
--
-- Idempotent — `add column if not exists` so repeated runs are safe
-- (memory: avoid DO blocks; plain DDL is the rule here).

alter table public."productionDayLineItems"
  add column if not exists "actuallyWorked" boolean not null default false;

comment on column public."productionDayLineItems"."actuallyWorked" is
  'When true, this line item is locked-in as a historical record. The reconciler skips it; the day-detail drawer flips it via "Mark as worked".';
