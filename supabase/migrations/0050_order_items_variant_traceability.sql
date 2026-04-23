-- =============================================================
-- Dulceria Production — order items variant traceability
-- Migration 0050: nullable variantId + variantPackagingId on orderItems
-- =============================================================
--
-- Why
--   The order entry UI now picks a (variant, size) and either
--   auto-expands curated products or lets the user free-pick.
--   Regardless of path, the rows that land in `orderItems` keep the
--   same productId + qty shape the production pipeline has always
--   read. These two new columns are metadata only — they let the
--   order UI group lines by their originating variant/size for
--   display, editing, and per-channel pricing.
--
--   Production code ignores them. Both are nullable so legacy lines
--   saved pre-variant stay valid.
--
-- Idempotent.
-- =============================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orderItems' and column_name = 'variantId'
  ) then
    execute 'alter table public."orderItems" add column "variantId" uuid references public.variants(id) on delete set null';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orderItems' and column_name = 'variantPackagingId'
  ) then
    execute 'alter table public."orderItems" add column "variantPackagingId" uuid references public."variantPackagings"(id) on delete set null';
  end if;
end $$;

create index if not exists "orderItems_variantId_idx"
  on public."orderItems" ("variantId");

create index if not exists "orderItems_variantPackagingId_idx"
  on public."orderItems" ("variantPackagingId");

notify pgrst, 'reload schema';
