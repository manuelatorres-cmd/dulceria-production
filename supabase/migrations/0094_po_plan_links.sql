-- 0094_po_plan_links.sql
-- Production-order line ↔ batch many-to-many links.
--
-- Until now, PO allocations on a draft survived only as free-text in
-- productionPlans.notes ("PO {label}: {qty} pcs"). Parked drafts that
-- referenced PO lines were silently lossy on reload, and the demand
-- aggregator could not subtract PO allocations to drive accurate
-- "X of Y left" pills.
--
-- This table mirrors orderPlanLinks (mig 0041): one row per
-- (productionOrderItemId, planId) pair, carrying the allocated qty.
--
-- Statement-level idempotency per feedback_supabase_migration_idempotency.md
-- (no DO blocks wrapping DDL).

create table if not exists public."poPlanLinks" (
  id                       uuid primary key,
  "productionOrderItemId"  uuid not null
                            references public."productionOrderItems"(id) on delete cascade,
  "planId"                 uuid not null
                            references public."productionPlans"(id) on delete cascade,
  "allocatedQuantity"      integer not null check ("allocatedQuantity" >= 0),
  "createdAt"              timestamptz not null default now(),
  "updatedAt"              timestamptz not null default now(),
  unique ("productionOrderItemId", "planId")
);

create index if not exists "poPlanLinks_productionOrderItemId_idx"
  on public."poPlanLinks" ("productionOrderItemId");
create index if not exists "poPlanLinks_planId_idx"
  on public."poPlanLinks" ("planId");

alter table public."poPlanLinks" enable row level security;
drop policy if exists "poPlanLinks_authenticated_full_access" on public."poPlanLinks";
create policy "poPlanLinks_authenticated_full_access"
  on public."poPlanLinks"
  for all to authenticated using (true) with check (true);

notify pgrst, 'reload schema';
