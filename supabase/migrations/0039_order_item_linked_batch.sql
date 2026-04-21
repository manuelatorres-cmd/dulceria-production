-- Link orderItems into a production batch
--
-- Every line on a customer order is fulfilled by a specific production
-- batch (productionPlan). A null means "no batch yet" — the UI surfaces
-- this as a flag so the user can create a batch on the Production page
-- and link it back here.
--
-- Historical state: lines created before this migration have
-- linkedBatchId = null. That's fine; they'll be flagged as unlinked
-- and the user can either create/link a batch or leave them unlinked
-- (the scheduler will skip them).

alter table public."orderItems"
  add column if not exists "linkedBatchId" uuid
    references public."productionPlans" (id)
    on delete set null;

create index if not exists orderItems_linkedBatchId_idx
  on public."orderItems" ("linkedBatchId");

notify pgrst, 'reload schema';
