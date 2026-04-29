-- 0079_product_exclude_from_replen.sql
-- Per-product opt-out from automatic replenishment. When true, the
-- replen seeder skips this product even if its on-hand stock is below
-- the location minimum. Used for limited editions / campaign-only
-- products where Manuela hand-creates the production order instead.

alter table public.products
  add column if not exists "excludeFromReplen" boolean not null default false;

create index if not exists "products_excludeFromReplen_idx"
  on public.products ("excludeFromReplen")
  where "excludeFromReplen" = true;

notify pgrst, 'reload schema';
