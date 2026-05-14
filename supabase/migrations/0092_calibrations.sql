-- ====================================================================
-- 0092 — calibrations table
-- ====================================================================
--
-- Backs the HACCP calibration history table on the workshop dashboard
-- + /production-brain/haccp. One row per equipment calibration event
-- (scale tare check, thermometer ice-point verification, etc.).
--
-- Distinct from HaccpTemperatureLog (which tracks daily readings of
-- fridges/freezers); this table is for periodic device-accuracy
-- verifications keyed to specific equipment + a recurrence cadence.
--
-- Idempotent — `create table if not exists` + nullable columns so
-- re-runs are safe.

create table if not exists public.calibrations (
  id text primary key,
  "equipmentId" uuid not null references public.equipment (id) on delete cascade,
  "calibratedAt" timestamptz not null,
  "calibratedBy" text,
  -- "ok" / "out_of_tolerance" / "adjusted" / "retired"
  outcome text not null default 'ok',
  -- "monthly" / "quarterly" / "annual" / "ad_hoc"
  cadence text not null default 'ad_hoc',
  "nextDueAt" timestamptz,
  "referenceValue" numeric(10, 3),
  "measuredValue" numeric(10, 3),
  "deltaTolerance" numeric(10, 3),
  notes text,
  "createdAt" timestamptz not null default now()
);

create index if not exists "calibrations_equipmentId_idx"
  on public.calibrations ("equipmentId");

create index if not exists "calibrations_nextDueAt_idx"
  on public.calibrations ("nextDueAt");

comment on table public.calibrations is
  'Periodic equipment calibration events for HACCP. Distinct from daily HaccpTemperatureLog readings.';
comment on column public.calibrations.outcome is
  'ok / out_of_tolerance / adjusted / retired';
comment on column public.calibrations.cadence is
  'monthly / quarterly / annual / ad_hoc — drives nextDueAt suggestion in the UI';
comment on column public.calibrations."nextDueAt" is
  'When this device should be re-calibrated next. Surfaced as an overdue chip on the workshop dashboard.';

notify pgrst, 'reload schema';
