-- ====================================================================
-- 0089 — plan-level assignee + variance + issues fields
-- ====================================================================
--
-- Adds the small set of nullable columns flagged ✗ deferred across the
-- /production/[id] wizard refit (Phase C.4-C.6 + Phase B yield UI):
--
--   planProducts.assignedPersonId — who is responsible for this batch.
--     Surfaced inline in the Plan step's batch ListRow + the Edit-batch
--     drawer (DsInlineSelect bound to /people).
--   planProducts.varianceReason   — operator's free-text reason when
--     actualYield ≠ planned (broken, overfilled, bloom, etc.). Shown
--     in the Wrap up step's yield table.
--   productionPlans.issuesNotes   — separate textarea for "issues
--     encountered today" — kept distinct from `notes` (which doubles
--     as a batch-level sticky note used elsewhere).
--
-- All three are plain nullable text. No enums, no FKs (people IDs are
-- stored as free-text references like other person-bearing tables).
-- Idempotent — `add column if not exists` so re-runs are safe.

alter table public."planProducts"
  add column if not exists "assignedPersonId" text;

alter table public."planProducts"
  add column if not exists "varianceReason" text;

alter table public."productionPlans"
  add column if not exists "issuesNotes" text;

comment on column public."planProducts"."assignedPersonId" is
  'Person responsible for this batch. Free-text reference to people.id, surfaced in /production/[id] Plan step.';
comment on column public."planProducts"."varianceReason" is
  'Operator note explaining why actualYield ≠ planned. Captured in /production/[id] Wrap up step.';
comment on column public."productionPlans"."issuesNotes" is
  'Issues encountered during this batch (kept separate from `notes` which is the batch-level sticky note). Captured in /production/[id] Wrap up step.';

notify pgrst, 'reload schema';
