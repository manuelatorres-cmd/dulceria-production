-- =============================================================
-- Dulceria Production — fix scheduler for batch-prep steps
-- Migration 0037: productionSteps.perBatch
-- =============================================================
--
-- The mould-wave scheduler multiplies a step's active minutes by the
-- number of moulds in the wave (`activeMinutes × mouldsNeeded`). That's
-- correct for steps that touch every mould (shell, fill, cap, polish,
-- pack) but wrong for batch-prep steps like cooking a filling: the
-- pot takes the same hour whether it serves one mould or twenty.
--
-- A 600 min "Cooking" step × 4 moulds turned a one-hour job into a
-- 40-hour day on the schedule. With this flag set, the scheduler uses
-- step.activeMinutes as-is — one batch, one duration.
-- =============================================================

alter table public."productionSteps"
  add column if not exists "perBatch" boolean not null default false;

notify pgrst, 'reload schema';
