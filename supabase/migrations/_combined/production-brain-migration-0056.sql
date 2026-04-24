-- =============================================================
-- Dulceria Production Brain — B2B price lists
-- Migration 0056
-- =============================================================
--
-- Dedicated price-list infrastructure so Manuela can build named
-- wholesale lists ("Wholesale 2026", "Café partners Q1") with
-- product-specific overrides + collection + tag rules. Customers
-- point at one list via customers.defaultPriceListId (existing
-- column, currently a Variant id — migrates naturally).
-- =============================================================

create table if not exists public."priceLists" (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  "validFrom" date,
  "validTo" date,
  "defaultDiscountPercent" numeric(5, 2),
  archived boolean not null default false,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

alter table public."priceLists" enable row level security;
drop policy if exists "authenticated_full_access" on public."priceLists";
create policy "authenticated_full_access" on public."priceLists"
  for all to authenticated using (true) with check (true);

create table if not exists public."priceListItems" (
  id uuid primary key default gen_random_uuid(),
  "priceListId" uuid not null references public."priceLists"(id) on delete cascade,
  "productId" uuid references public.products(id) on delete cascade,
  "variantId" uuid references public.variants(id) on delete cascade,
  tag text,
  "discountPercent" numeric(5, 2),
  "fixedPrice" numeric(12, 2),
  "minQuantity" integer,
  notes text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  -- At least one scope must be set.
  check (
    "productId" is not null
    or "variantId" is not null
    or tag is not null
  ),
  -- Either discount OR fixed price, not both.
  check (
    "discountPercent" is not null or "fixedPrice" is not null
  )
);

create index if not exists price_list_items_list_idx
  on public."priceListItems" ("priceListId");
create index if not exists price_list_items_product_idx
  on public."priceListItems" ("productId");

alter table public."priceListItems" enable row level security;
drop policy if exists "authenticated_full_access" on public."priceListItems";
create policy "authenticated_full_access" on public."priceListItems"
  for all to authenticated using (true) with check (true);

-- Triggers
do $$
declare tbl text;
begin
  for tbl in select unnest(array['priceLists', 'priceListItems'])
  loop
    execute format(
      'drop trigger if exists set_%s_updated_at on public.%I;',
      tbl,
      tbl
    );
    execute format(
      'create trigger set_%s_updated_at before update on public.%I
       for each row execute function public.set_updated_at();',
      tbl,
      tbl
    );
  end loop;
end$$;

-- =============================================================
-- End of 0056
-- =============================================================
