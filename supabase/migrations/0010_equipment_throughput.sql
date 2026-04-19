-- =============================================================
-- Dulceria Production — equipment throughput + parallelism
-- Migration 0010: add `kgPerHour` and `quantity` to equipment
-- =============================================================
--
-- Depends on migration 0002 (equipment table exists).
--
-- The scheduler needs two numbers per piece of equipment to estimate
-- how long a batch will tie it up:
--
--   kgPerHour  — throughput per unit. A 10 kg batch on a 5 kg/h
--                tempering machine takes 2 hours.
--   quantity   — how many identical copies exist, so the scheduler
--                can place parallel tasks when more than one unit is
--                available (two tempering machines = two ganache
--                batches running at once).
--
-- Both are nullable per house rule (no defaults, ship empty). The
-- Settings → Equipment form prompts the user to fill them in; the
-- scheduler refuses to place work on equipment where they're null.
-- Existing `capacityKg` stays — different meaning (per-cycle load vs.
-- throughput); not exposed in the new UI for now but kept on the row.

alter table public.equipment
  add column if not exists "kgPerHour" numeric(8,2)
    check ("kgPerHour" is null or "kgPerHour" > 0),
  add column if not exists quantity integer
    check (quantity is null or quantity > 0);

comment on column public.equipment."kgPerHour" is
  'Throughput per unit in kg/hour. The scheduler estimates phase '
  'duration from batch weight ÷ kgPerHour × number of copies used.';

comment on column public.equipment.quantity is
  'How many identical copies of this equipment exist. Scheduler uses '
  'this for parallelism — quantity=2 means two tasks can run on this '
  'equipment simultaneously.';
