-- 0095_line_item_locked.sql
-- Per-line-item lock flag on productionDayLineItems.
--
-- Until now the only "locked" signal lived on productionPlans.pinnedDate.
-- That's a per-plan flag, so the weekly + manual planner showed every
-- step of a multi-day plan as locked the moment any of its days was
-- pinned. The user wanted per-line-item granularity: lock the
-- appearance of a batch on a specific day without freezing its other
-- days.
--
-- Statement-level idempotency per feedback_supabase_migration_idempotency.md.

alter table public."productionDayLineItems"
  add column if not exists "locked" boolean not null default false;

create index if not exists "productionDayLineItems_locked_idx"
  on public."productionDayLineItems" ("locked")
  where "locked" = true;

notify pgrst, 'reload schema';
