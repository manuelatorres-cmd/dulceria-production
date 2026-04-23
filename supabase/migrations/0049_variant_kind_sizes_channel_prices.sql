-- =============================================================
-- Dulceria Production — variant structure for order entry
-- Migration 0049: kind on variants, per-size channel pricing,
--                 per-size curated product list
-- =============================================================
--
-- Why
--   Variants become the order-entry unit. A variant has one `kind`:
--     - 'curated'   — exact product list + qty, locked on orders
--     - 'free-pick' — user picks products on each order
--   Each variant can have several sizes (distinct packagings). Each
--   size carries a default price, per-channel price overrides
--   (b2b/event/online/shop), and, for curated variants, a product
--   list with per-product qty that sums to packaging.capacity.
--
-- What this migration does
--   variants:
--     + kind text check ('free-pick','curated') default 'curated'
--     + vatRatePercent numeric default 10
--   variantPackagings:
--     + price numeric (gross, VAT-incl; fallback when channel override
--       missing) — backfilled from existing sellPrice
--     + channelPrices jsonb default '{}' (sparse: {b2b:24, shop:28})
--     (existing sellPrice column kept for backwards compat; UI reads
--      `price` going forward)
--   variantPackagingProducts (NEW):
--     which products + qty live in a curated size; hard-capped in the
--     form to sum to packaging.capacity
--
-- Order pipeline contract
--   orderItems (productId + qty) is UNCHANGED. Production reads
--   that same shape. Variant info is a traceability stamp added in
--   migration 0050.
--
-- Idempotent: every add guarded by existence checks.
-- =============================================================

-- ---------- variants: kind + vat ----------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'variants' and column_name = 'kind'
  ) then
    execute 'alter table public.variants add column kind text not null default ''curated''';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'variants_kind_check'
  ) then
    execute 'alter table public.variants add constraint variants_kind_check check (kind in (''free-pick'', ''curated''))';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'variants' and column_name = 'vatRatePercent'
  ) then
    execute 'alter table public.variants add column "vatRatePercent" numeric(5,2) not null default 10';
  end if;
end $$;

-- ---------- variantPackagings: price + channel overrides ----------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'variantPackagings' and column_name = 'price'
  ) then
    execute 'alter table public."variantPackagings" add column price numeric(12,4)';
    -- Backfill from existing sellPrice so no box loses its price.
    execute 'update public."variantPackagings" set price = "sellPrice" where price is null';
    execute 'alter table public."variantPackagings" alter column price set not null';
    execute 'alter table public."variantPackagings" alter column price set default 0';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'variantPackagings' and column_name = 'channelPrices'
  ) then
    execute 'alter table public."variantPackagings" add column "channelPrices" jsonb not null default ''{}''::jsonb';
  end if;
end $$;

-- ---------- variantPackagingProducts (new) ----------

create table if not exists public."variantPackagingProducts" (
  id                   uuid primary key,
  "variantPackagingId" uuid not null references public."variantPackagings"(id) on delete cascade,
  "productId"          uuid not null references public.products(id) on delete restrict,
  qty                  integer not null check (qty > 0),
  "sortOrder"          integer not null default 0,
  "createdAt"          timestamptz not null default now(),
  "updatedAt"          timestamptz not null default now()
);

create index if not exists "variantPackagingProducts_variantPackagingId_idx"
  on public."variantPackagingProducts" ("variantPackagingId");

create index if not exists "variantPackagingProducts_productId_idx"
  on public."variantPackagingProducts" ("productId");

notify pgrst, 'reload schema';
