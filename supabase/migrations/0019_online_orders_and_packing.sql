-- =============================================================
-- Dulceria Production — Online orders + Packing step
-- Migration 0019: Phase 6 + Phase 3-remaining tables
-- =============================================================
--
-- Depends on 0002 (orders, packaging, packagingOrders).
--
-- What this migration introduces
--   orders.sourceRef         External reference for imported orders
--                            (e.g. Shopify's order name "#1001"). Used
--                            to dedup re-imports so the same CSV can be
--                            uploaded twice without creating duplicates.
--
--   packaging.quantityOnHand Numeric stock count for each packaging
--                            type. Auto-incremented when a PackagingOrder
--                            row is inserted; decremented by the Packing
--                            step in the production wizard.
--
--   packaging.lowStockThreshold
--                            Minimum quantity below which the packaging
--                            is flagged for reorder. Nullable — leaves
--                            the existing boolean `lowStock` flag as the
--                            fallback signal for old rows.
--
--   packaging.leadTimeDays   Supplier lead time. Not used in maths yet —
--                            reserved for the "auto-add to shopping
--                            list" escalation in a later phase.
--
--   packagingConsumption     Append-only log: which plan/order consumed
--                            how many units of which packaging, and
--                            when. Mirrors stockMovements for products.
-- =============================================================

alter table orders
  add column if not exists "sourceRef" text;
create index if not exists "orders_sourceRef_idx" on orders ("sourceRef");

alter table packaging
  add column if not exists "quantityOnHand" integer not null default 0
    check ("quantityOnHand" >= 0),
  add column if not exists "lowStockThreshold" integer
    check ("lowStockThreshold" is null or "lowStockThreshold" >= 0),
  add column if not exists "leadTimeDays" integer
    check ("leadTimeDays" is null or "leadTimeDays" >= 0);

create table "packagingConsumption" (
  id              uuid primary key,
  "packagingId"   uuid not null references packaging(id) on delete cascade,
  quantity        integer not null check (quantity > 0),
  "planId"        uuid references "productionPlans"(id) on delete set null,
  "planProductId" uuid references "planProducts"(id) on delete set null,
  "orderId"       uuid references orders(id) on delete set null,
  "loggedBy"      text,
  note            text,
  "loggedAt"      timestamptz not null default now()
);
create index on "packagingConsumption" ("packagingId", "loggedAt" desc);
create index on "packagingConsumption" ("planId");
create index on "packagingConsumption" ("orderId");

-- RLS for the new table.

do $$
declare p text;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'packagingConsumption'
  loop
    execute format('drop policy if exists %I on public.%I', p, 'packagingConsumption');
  end loop;
  execute 'alter table public."packagingConsumption" enable row level security';
  execute 'create policy "authenticated_full_access" on public."packagingConsumption" ' ||
          'for all to authenticated using (true) with check (true)';
end$$;
