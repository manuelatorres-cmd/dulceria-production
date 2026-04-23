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
--   Each variant has one or more sizes (distinct packagings). Each
--   size carries a default price, per-channel price overrides
--   (b2b/event/online/shop), and, for curated variants, a product
--   list with per-product qty that sums to packaging.capacity.
--
-- Idempotency
--   Uses `add column if not exists` and pg_constraint lookups instead
--   of wrapping every add in a DO block. DO-block-only idempotency
--   previously flaked on Supabase (schema state cached mid-migration),
--   so `if not exists` at the statement level is the reliable path.
--
-- Order pipeline contract
--   orderItems (productId + qty) is UNCHANGED. Production reads that
--   same shape. Variant/size traceability is added in migration 0050.
-- =============================================================

-- ---------- variants: kind + vat ----------

alter table public.variants add column if not exists kind text not null default 'curated';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'variants_kind_check') then
    alter table public.variants add constraint variants_kind_check check (kind in ('free-pick', 'curated'));
  end if;
end $$;

alter table public.variants add column if not exists "vatRatePercent" numeric(5,2) not null default 10;

-- ---------- variantPackagings: price + channel overrides ----------

alter table public."variantPackagings" add column if not exists price numeric(12,4);
update public."variantPackagings" set price = "sellPrice" where price is null;
alter table public."variantPackagings" alter column price set not null;
alter table public."variantPackagings" alter column price set default 0;

alter table public."variantPackagings" add column if not exists "channelPrices" jsonb not null default '{}'::jsonb;

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

-- ---------- Schema cache ----------
-- PostgREST caches the schema; reload so the new columns / table are
-- visible. Without this, the next request hits PGRST204 (column not
-- in schema cache) even though the DDL is committed.
notify pgrst, 'reload schema';
