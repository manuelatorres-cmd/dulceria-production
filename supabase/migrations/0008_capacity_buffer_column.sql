-- =============================================================
-- Dulceria Production — general capacity buffer
-- Migration 0008: add `capacityBufferPercent` to capacityConfig
-- =============================================================
--
-- Depends on 0002 (capacityConfig table exists) + 0003 (RLS enabled).
--
-- The brief calls for a general capacity buffer separate from the
-- existing filling-specific `fillingBufferPercent`. Alerts trigger
-- when scheduled work exceeds (100 - capacityBufferPercent)% of the
-- per-day people-hours budget, giving the user headroom before the
-- warn / critical thresholds kick in.
--
-- Nullable on purpose — "ship empty, user writes everything on first
-- run" (house rule, 2026-04-19). The scheduler refuses to run until
-- the Settings → Capacity form is complete.

alter table public."capacityConfig"
  add column if not exists "capacityBufferPercent" numeric(5,2);

comment on column public."capacityConfig"."capacityBufferPercent" is
  'General capacity safety margin (0–100). The scheduler treats the per-day '
  'people-hours budget as (1 - capacityBufferPercent/100) of the raw total, '
  'so alerts fire before 100% utilisation. Separate from fillingBufferPercent '
  'which targets filling-specific overproduction.';
