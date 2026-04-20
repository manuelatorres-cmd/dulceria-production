-- =============================================================
-- Dulceria Production — order detail rework foundations
-- Migration 0032: pricePaid on orders, packingTimePerUnit on
--                 packaging, orderPackagingLines join table
-- =============================================================
--
-- Depends on 0002 (orders, packaging), 0018 (orderBoxes).
--
-- Prompt 1 in the current batch asks for:
--   - "Price paid" editable on every order, separate from any
--     calculated / quoted price → orders.pricePaid (numeric).
--   - Packaging section on the order with an auto-flowing labour
--     contribution → packaging.packingTimePerUnit (minutes per unit).
--   - A simple "this order uses N of packaging X" relationship
--     (distinct from the orderBoxes composition model, which
--     describes what products go inside a single gift box).
--     → new table orderPackagingLines.
-- =============================================================

-- 1. Order-level "price paid" (invoiced amount).

alter table public.orders
  add column if not exists "pricePaid" numeric(10,2)
    check ("pricePaid" is null or "pricePaid" >= 0);

-- 2. Packing time per unit of a packaging SKU. Minutes per unit so
--    it lines up with productionSteps.activeMinutes for the labour
--    rollup on the order + quote flows. Nullable — users fill it
--    in as they measure the actual work.

alter table public.packaging
  add column if not exists "packingTimePerUnit" numeric(6,2)
    check ("packingTimePerUnit" is null or "packingTimePerUnit" >= 0);

-- 3. Lightweight "packaging line" on an order. An order's packaging
--    list is independent of orderItems and orderBoxes — it's for
--    consumables that aren't defining a product mix (ribbons, sticker
--    packs, gift bags, outer shipping boxes, thank-you cards).

create table if not exists public."orderPackagingLines" (
  id             uuid primary key,
  "orderId"      uuid not null references public.orders(id) on delete cascade,
  "packagingId"  uuid not null references public.packaging(id) on delete restrict,
  quantity       integer not null check (quantity > 0),
  "sortOrder"    integer not null default 0,
  notes          text,
  "createdAt"    timestamptz not null default now(),
  "updatedAt"    timestamptz not null default now()
);
create index if not exists "orderPackagingLines_orderId_idx"
  on public."orderPackagingLines" ("orderId");

-- RLS — authenticated-only, matching every other Dulceria table.
do $$
declare p text;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'orderPackagingLines'
  loop
    execute format('drop policy if exists %I on public."orderPackagingLines"', p);
  end loop;
  execute 'alter table public."orderPackagingLines" enable row level security';
  execute 'create policy "authenticated_full_access" on public."orderPackagingLines" '
       || 'for all to authenticated using (true) with check (true)';
end$$;

notify pgrst, 'reload schema';
