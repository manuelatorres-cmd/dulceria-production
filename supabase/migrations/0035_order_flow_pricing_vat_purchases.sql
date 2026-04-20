-- =============================================================
-- Dulceria Production — order-flow redesign: customer CRM fields,
-- pricing hierarchy, VAT, purchase tracking
-- Migration 0035
-- =============================================================
--
-- Depends on: 0001 (products/packaging/ingredients), 0018 (customers +
-- contacts + quotes), 0032 (orderPackagingLines, pricePaid).
--
-- This migration lays the persistent layer for:
--   - Customer CRM expansion (type, default delivery, pricing prefs,
--     allergen notes, packaging prefs, language, invoice address,
--     payment terms, default price list, default discount %)
--   - Per-customer product-specific pricing (new table)
--   - VAT handling across products, packaging, ingredients, orderItems,
--     and orderPackagingLines — all prices stored net; vatRate is a
--     percent, nullable on line rows (null = fall back to the item
--     default, which itself falls back to the catalogue default).
--   - Purchase-cost tracking extensions on ingredientPriceHistory and
--     packagingOrders: supplier (ingredient only — packaging already
--     has it), vatRatePercent, invoiceNumber, and an updatedDefault
--     flag that records whether the user ticked "update default price"
--     at the moment of purchase.
--   - Collections repurposed as price lists: unitPrice on
--     collectionProducts (null = use product's retail price).
--
-- The quote→order link already exists as quotes.convertedToOrderId.
-- Status enum already includes 'won' — that's the "accepted/converted"
-- state the spec asks for.
--
-- Every alter is additive + idempotent so replays are safe.
-- =============================================================

-- 1. Customer CRM expansion.

alter table public.customers
  add column if not exists "type" text
    check ("type" is null or "type" in ('b2b','private'));

alter table public.customers
  add column if not exists "defaultDeliveryMethod" text
    check ("defaultDeliveryMethod" is null or "defaultDeliveryMethod" in ('pickup','delivery','ship'));

alter table public.customers add column if not exists "invoiceAddress" text;
alter table public.customers add column if not exists "paymentTerms" text;
alter table public.customers add column if not exists "allergenNotes" text;
alter table public.customers add column if not exists "packagingPrefs" text;

-- Language as a short ISO code; free text so we don't need to curate
-- an enum. UI picks from a list but stores 'de' / 'en' / 'it' etc.
alter table public.customers add column if not exists "language" text;

-- Default price list — a Collection serves as the list. Optional.
alter table public.customers
  add column if not exists "defaultPriceListId" uuid
    references public.collections(id) on delete set null;

-- Default discount (percent, 0..100). Applied when no per-product and
-- no price-list override matches.
alter table public.customers
  add column if not exists "defaultDiscountPercent" numeric(5,2)
    check ("defaultDiscountPercent" is null or ("defaultDiscountPercent" >= 0 and "defaultDiscountPercent" <= 100));

-- 2. Per-customer product pricing — top of the hierarchy.

create table if not exists public."customerProductPrices" (
  id           uuid primary key,
  "customerId" uuid not null references public.customers(id) on delete cascade,
  "productId"  uuid not null references public.products(id)  on delete cascade,
  "unitPrice"  numeric(10,2) not null check ("unitPrice" >= 0),
  notes        text,
  "createdAt"  timestamptz not null default now(),
  "updatedAt"  timestamptz not null default now(),
  unique ("customerId", "productId")
);
create index if not exists "customerProductPrices_customerId_idx"
  on public."customerProductPrices" ("customerId");
create index if not exists "customerProductPrices_productId_idx"
  on public."customerProductPrices" ("productId");

-- 3. VAT: default rates on catalogue items. Percent (10 = 10%).
--    Null everywhere = callers fall back to the app-level default
--    (10% food VAT).

alter table public.products   add column if not exists "defaultVatRate" numeric(5,2)
    check ("defaultVatRate" is null or ("defaultVatRate" >= 0 and "defaultVatRate" <= 100));
alter table public.packaging  add column if not exists "defaultVatRate" numeric(5,2)
    check ("defaultVatRate" is null or ("defaultVatRate" >= 0 and "defaultVatRate" <= 100));
alter table public.ingredients add column if not exists "defaultVatRate" numeric(5,2)
    check ("defaultVatRate" is null or ("defaultVatRate" >= 0 and "defaultVatRate" <= 100));

-- Per-line VAT on order rows — null means "use the item default".
alter table public."orderItems"
  add column if not exists "vatRate" numeric(5,2)
    check ("vatRate" is null or ("vatRate" >= 0 and "vatRate" <= 100));
alter table public."orderPackagingLines"
  add column if not exists "vatRate" numeric(5,2)
    check ("vatRate" is null or ("vatRate" >= 0 and "vatRate" <= 100));

-- 4. Collections as price lists: per-product unit price on a collection.

alter table public."collectionProducts"
  add column if not exists "unitPrice" numeric(10,2)
    check ("unitPrice" is null or "unitPrice" >= 0);

-- 5. Purchase-cost tracking — extend the existing history tables so
--    we don't fork the purchase log.

alter table public."ingredientPriceHistory"
  add column if not exists supplier text,
  add column if not exists "vatRatePercent" numeric(5,2)
    check ("vatRatePercent" is null or ("vatRatePercent" >= 0 and "vatRatePercent" <= 100)),
  add column if not exists "invoiceNumber" text,
  add column if not exists "updatedDefault" boolean not null default false;

alter table public."packagingOrders"
  add column if not exists "vatRatePercent" numeric(5,2)
    check ("vatRatePercent" is null or ("vatRatePercent" >= 0 and "vatRatePercent" <= 100)),
  add column if not exists "invoiceNumber" text,
  add column if not exists "updatedDefault" boolean not null default false;

-- 6. RLS for the new customerProductPrices table — matches the rest
--    of the codebase (authenticated-only).

do $$
declare p text;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'customerProductPrices'
  loop
    execute format('drop policy if exists %I on public."customerProductPrices"', p);
  end loop;
  execute 'alter table public."customerProductPrices" enable row level security';
  execute 'create policy "authenticated_full_access" on public."customerProductPrices" '
       || 'for all to authenticated using (true) with check (true)';
end$$;

notify pgrst, 'reload schema';
