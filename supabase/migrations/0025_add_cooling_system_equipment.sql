-- =============================================================
-- Dulceria Production — add cooling_system equipment kind
-- Migration 0025: widen the equipment.kind CHECK constraint
-- =============================================================
--
-- Fridges, freezers, and chilled chocolate storage don't fit any of
-- the existing equipment kinds (tempering / melting_pot / coating_belt
-- / other). Adding a dedicated `cooling_system` value so they can be
-- tracked as first-class equipment.
--
-- The app knows not to require `quantity` or `kgPerHour` on cooling
-- systems — they don't participate in throughput scheduling, only in
-- HACCP temperature logs.
-- =============================================================

alter table public.equipment
  drop constraint if exists equipment_kind_check;

alter table public.equipment
  add constraint equipment_kind_check
  check (kind in ('tempering','melting_pot','coating_belt','cooling_system','other'));
