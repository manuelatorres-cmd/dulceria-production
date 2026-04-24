-- =============================================================
-- Dulceria Production Brain — approximate deadline flag on orders
-- Migration 0055
-- =============================================================
--
-- Manuela's scheduling spec: some orders ("about next week") don't
-- have a fixed date. Flag them as approximate so the planner draws
-- the block with a dashed border + a ±1 week tolerance.
-- =============================================================

alter table public.orders
  add column if not exists "isApproxDeadline" boolean not null default false;

-- =============================================================
-- End of 0055
-- =============================================================
