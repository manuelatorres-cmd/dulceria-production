-- 0097_backfill_po_plan_links.sql
--
-- Backfill missing poPlanLinks for regenerate-seeded plans. Per
-- PO_PLAN_LINKS_BACKFILL_BATCH.md.
--
-- Background: seedCampaignDrivenPlans + seedProductionOrderDrivenPlans
-- materialise campaign / PO targets as productionPlans rows but never
-- wrote poPlanLinks. aggregateDemandByProduct subtracts poPlanLinks
-- to compute "X of Y left" — without the rows, the same PO target
-- gets counted twice (open PO + draft plan).
--
-- Note on numbering: spec called this 0096 but 0096 already shipped
-- (plan_sibling_group from BATCH1). Renumbered to 0097 — surfaced in
-- the commit, no functional difference.
--
-- Statement-level idempotency per feedback_supabase_migration_idempotency.md.
-- Two-step backfill + NOT EXISTS guard so re-running is a no-op.

-- Step 1: unique constraint to make going-forward upserts idempotent.
-- IF NOT EXISTS isn't valid SQL for ADD CONSTRAINT in Postgres; emulate
-- via a DO block that catches the duplicate_object error.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'uq_po_plan_links_plan_item'
  ) then
    alter table public."poPlanLinks"
      add constraint "uq_po_plan_links_plan_item"
      unique ("planId", "productionOrderItemId");
  end if;
end $$;

-- Step 2: backfill PO-seeded plans.
-- Match "PO: {po.name} — {product.name}" or "PO: {po.dueDate} — {product.name}"
-- or "PO: Replen · {po.dueDate} — {product.name}". chunkMoulds × cavities
-- = the slice's expected output. The plan name's optional ` · 1/2` suffix
-- doesn't matter for the JOIN since planProducts.quantity carries the
-- chunk-specific mould-fill count.
insert into public."poPlanLinks" (id, "planId", "productionOrderItemId", "allocatedQuantity", "createdAt", "updatedAt")
select
  gen_random_uuid()                            as id,
  pp.id                                        as plan_id,
  poi.id                                       as production_order_item_id,
  greatest(0, plp.quantity * coalesce(m."numberOfCavities", 0)) as allocated_quantity,
  now(),
  now()
from public."productionPlans" pp
join public."planProducts" plp on plp."planId" = pp.id
join public.products prod      on prod.id = plp."productId"
join public.moulds m           on m.id = plp."mouldId"
join public."productionOrders" po on (
  pp.name ilike 'PO:%'
  and (
    pp.name ilike ('PO: ' || po.name || ' — %')
    or pp.name ilike ('PO: ' || po."dueDate"::text || ' — %')
    or pp.name ilike ('PO: Replen · ' || po."dueDate"::text || ' — %')
  )
)
join public."productionOrderItems" poi on (
  poi."productionOrderId" = po.id
  and poi."productId" = prod.id
)
where pp.status in ('draft','active','done')
  and not exists (
    select 1 from public."poPlanLinks" existing
    where existing."planId" = pp.id
      and existing."productionOrderItemId" = poi.id
  );

-- Step 3: backfill Campaign-seeded plans.
-- Match "Campaign: {campaign.name} — {product.name}".
-- Joins through campaigns → productionOrders.campaignId → productionOrderItems.
insert into public."poPlanLinks" (id, "planId", "productionOrderItemId", "allocatedQuantity", "createdAt", "updatedAt")
select
  gen_random_uuid(),
  pp.id,
  poi.id,
  greatest(0, plp.quantity * coalesce(m."numberOfCavities", 0)),
  now(),
  now()
from public."productionPlans" pp
join public."planProducts" plp on plp."planId" = pp.id
join public.products prod      on prod.id = plp."productId"
join public.moulds m           on m.id = plp."mouldId"
join public.campaigns c        on pp.name ilike ('Campaign: ' || c.name || ' — %')
join public."productionOrders" po on po."campaignId" = c.id
join public."productionOrderItems" poi on (
  poi."productionOrderId" = po.id
  and poi."productId" = prod.id
)
where pp.status in ('draft','active','done')
  and not exists (
    select 1 from public."poPlanLinks" existing
    where existing."planId" = pp.id
      and existing."productionOrderItemId" = poi.id
  );

notify pgrst, 'reload schema';
