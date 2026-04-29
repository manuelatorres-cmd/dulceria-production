-- 0064_variant_packaging_components.sql
-- A variant "size" is more than one packaging item: a 9-bonbon box has
-- a box + a cushion + N paper liners + a sticker + maybe a ribbon. Each
-- of those is a separate `packaging` row with its own stock + purchase
-- history. This table links them to a variantPackaging size.
--
-- The legacy `variantPackagings.packagingId` column stays — it now
-- represents the PRIMARY (outer) packaging, used for display + shelf-
-- life. Component rows below add the rest with quantities.
--
-- Migration is idempotent.

create table if not exists public."variantPackagingComponents" (
  id                       uuid primary key,
  "variantPackagingId"     uuid not null
                            references public."variantPackagings"(id) on delete cascade,
  "packagingId"            uuid not null
                            references public.packaging(id) on delete restrict,
  "qtyPerVariant"          numeric(8, 2) not null default 1
                            check ("qtyPerVariant" > 0),
  "sortOrder"              integer not null default 0,
  "isPrimary"              boolean not null default false,
  "createdAt"              timestamptz not null default now(),
  "updatedAt"              timestamptz not null default now()
);

create index if not exists "variantPackagingComponents_vpId_idx"
  on public."variantPackagingComponents" ("variantPackagingId");
create index if not exists "variantPackagingComponents_packagingId_idx"
  on public."variantPackagingComponents" ("packagingId");

-- One-time RLS: the same authenticated_full_access policy used elsewhere.
alter table public."variantPackagingComponents" enable row level security;

drop policy if exists "variantPackagingComponents_authenticated_full_access"
  on public."variantPackagingComponents";
create policy "variantPackagingComponents_authenticated_full_access"
  on public."variantPackagingComponents"
  for all
  to authenticated
  using (true)
  with check (true);

-- Backfill: for any existing variantPackaging row, add a single
-- component pointing at its packagingId, marked primary, qty 1. Skips
-- if a component already exists for that VP (re-run safe).
insert into public."variantPackagingComponents"
  (id, "variantPackagingId", "packagingId", "qtyPerVariant", "isPrimary", "sortOrder")
select gen_random_uuid(), vp.id, vp."packagingId", 1, true, 0
  from public."variantPackagings" vp
 where vp."packagingId" is not null
   and not exists (
     select 1
       from public."variantPackagingComponents" vpc
      where vpc."variantPackagingId" = vp.id
   );

notify pgrst, 'reload schema';
