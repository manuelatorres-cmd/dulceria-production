-- =============================================================
-- Dulceria Production — auto-created production batch per order
-- Migration 0036: productionPlans.sourceOrderId
-- =============================================================
--
-- Depends on 0001 (productionPlans, orders).
--
-- A "produce fresh" order line needs a batch on the production board
-- so the team can see it. Auto-sync creates one `productionPlans` row
-- per source order, with planProducts consolidated by product. This
-- migration adds the link column so the sync layer can find and
-- rebuild it on every edit.
--
-- On delete cascade: if the order disappears, its auto-batch goes
-- with it (and planProducts cascade from productionPlans.id already).
-- =============================================================

alter table public."productionPlans"
  add column if not exists "sourceOrderId" uuid
    references public.orders(id) on delete cascade;

create index if not exists "productionPlans_sourceOrderId_idx"
  on public."productionPlans" ("sourceOrderId");

notify pgrst, 'reload schema';
