-- 0078_plan_pinned_date.sql
-- Manual day pin for a production plan. When set, the scheduler
-- treats that plan's day-assignment as locked: it forces the plan's
-- productionDayLineItems onto that date during regenerate, skipping
-- the normal capacity-based scheduling. Cleared when the user
-- "unpins" via the UI.

alter table public."productionPlans"
  add column if not exists "pinnedDate" date;

create index if not exists "productionPlans_pinnedDate_idx"
  on public."productionPlans" ("pinnedDate")
  where "pinnedDate" is not null;

notify pgrst, 'reload schema';
