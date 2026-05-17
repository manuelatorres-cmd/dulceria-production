-- 0096_plan_sibling_group.sql
--
-- Adds `siblingGroupId` to productionPlans for the manual planner's
-- split-and-merge flow (spec MANUAL_PLANNER_WORKSPACE_BATCH1.md §3.9–3.10,
-- §4.6). When a pinned batch is split, the original + new plan share a
-- random uuid in this column; merge clears it when only one plan
-- remains.
--
-- Note on numbering: the spec called this mig 0095, but 0095 was taken
-- by `line_item_locked` (per-line-item lock for the weekly planner).
-- Renumbered to 0096 — no functional difference, just sequence sanity.
--
-- Statement-level idempotency per feedback_supabase_migration_idempotency.md.

alter table public."productionPlans"
  add column if not exists "siblingGroupId" uuid;

create index if not exists "productionPlans_siblingGroupId_idx"
  on public."productionPlans" ("siblingGroupId")
  where "siblingGroupId" is not null;

comment on column public."productionPlans"."siblingGroupId" is
  'UUID shared by all plans originating from a split (mig 0096). Cleared when only one plan remains in the group.';

notify pgrst, 'reload schema';
