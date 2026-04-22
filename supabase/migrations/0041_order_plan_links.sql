-- =============================================================
-- Dulceria Production — order ↔ batch many-to-many links
-- Migration 0041
-- =============================================================
--
-- Replaces the single-FK linking (orderItems.linkedBatchId and
-- productionPlans.sourceOrderId) with a proper join table so:
--   - one order line can be fulfilled by multiple batches (e.g. a
--     large shortfall split across days);
--   - one batch can serve multiple order lines (consolidation).
--
-- The old FK columns are NOT dropped here — they stay in place for
-- one release so rollback is trivial. A follow-up migration will
-- drop them once the app has stopped reading/writing them.
--
-- Also in this migration:
--   - productionPlans.status gains 'cancelled' and 'orphaned' so
--     the batch lifecycle can track cancel-before-start vs
--     cancel-after-start-in-progress separately;
--   - productionPlans.surplusDestination captures the operator's
--     choice at unmould time when a batch overproduces vs the
--     order(s) it was for. Actual stock movement lives in the
--     stock-rewrite task; here we only record the intent.
--
-- Idempotent: safe to re-run on any state.
-- =============================================================

-- 1) Join table: orderPlanLinks
--
-- allocatedQuantity: how many pieces of this batch are earmarked for
-- the linked order line. Sum across a batch's links should equal the
-- batch's yield (with any remainder being surplus); we don't enforce
-- that in the DB because mid-state transitions are noisy — the
-- reconciler function is the source of truth.

create table if not exists public."orderPlanLinks" (
  id                  uuid primary key,
  "orderItemId"       uuid not null references public."orderItems"(id) on delete cascade,
  "planId"            uuid not null references public."productionPlans"(id) on delete cascade,
  "allocatedQuantity" integer not null check ("allocatedQuantity" >= 0),
  "createdAt"         timestamptz not null default now(),
  "updatedAt"         timestamptz not null default now(),
  unique ("orderItemId", "planId")
);

create index if not exists "orderPlanLinks_orderItemId_idx"
  on public."orderPlanLinks" ("orderItemId");
create index if not exists "orderPlanLinks_planId_idx"
  on public."orderPlanLinks" ("planId");

-- 2) productionPlans status enum: add 'cancelled' + 'orphaned'
--
-- Same drop-and-recreate pattern used in 0028 for orders.status.
-- Covers any auto-named leftovers from 0001.

do $$
declare
  con text;
begin
  for con in
    select constraint_name
    from information_schema.check_constraints
    where constraint_schema = 'public'
      and constraint_name like 'productionPlans_status_check%'
  loop
    execute format('alter table public."productionPlans" drop constraint %I', con);
  end loop;
end$$;

alter table public."productionPlans"
  add constraint "productionPlans_status_check"
  check (status in ('draft','active','done','cancelled','orphaned'));

-- 3) productionPlans.surplusDestination
--
-- Nullable text: one of 'store', 'freezer', 'waste'. Set by the
-- unmould modal when actualYield > sum(allocatedQuantity). The
-- stock-rewrite task will read this and issue the corresponding
-- stockMovement. Until then it is informational only.

alter table public."productionPlans"
  add column if not exists "surplusDestination" text
    check ("surplusDestination" is null
           or "surplusDestination" in ('store','freezer','waste'));

-- 4) Backfill: each existing orderItems.linkedBatchId becomes a row
--    in orderPlanLinks with allocatedQuantity = item.quantity. ON
--    CONFLICT keeps this idempotent across re-runs.

insert into public."orderPlanLinks" (id, "orderItemId", "planId", "allocatedQuantity")
select
  gen_random_uuid(),
  oi.id,
  oi."linkedBatchId",
  oi.quantity
from public."orderItems" oi
where oi."linkedBatchId" is not null
on conflict ("orderItemId", "planId") do nothing;

notify pgrst, 'reload schema';
