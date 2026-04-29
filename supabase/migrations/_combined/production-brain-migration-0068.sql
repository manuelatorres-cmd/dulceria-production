-- 0068_order_variant_lines.sql
-- Customer-facing variant lines on orders. The price the customer
-- sees is "4 × Fruit Lover Box 4 @ €13 = €52". The brain still works
-- off `orderItems` (productId × qty); a variant line auto-creates
-- those product items as derived demand, but the variant line is the
-- single priced row the customer + invoice show.

create table if not exists public."orderVariantLines" (
  id                    uuid primary key,
  "orderId"             uuid not null
                         references public.orders(id) on delete cascade,
  "variantId"           uuid not null
                         references public.variants(id) on delete restrict,
  "variantPackagingId"  uuid
                         references public."variantPackagings"(id) on delete set null,
  quantity              integer not null check (quantity > 0),
  "unitPrice"           numeric(10, 2) not null check ("unitPrice" >= 0),
  "sortOrder"           integer not null default 0,
  notes                 text,
  "createdAt"           timestamptz not null default now(),
  "updatedAt"           timestamptz not null default now()
);

create index if not exists "orderVariantLines_orderId_idx"
  on public."orderVariantLines" ("orderId");
create index if not exists "orderVariantLines_variantId_idx"
  on public."orderVariantLines" ("variantId");

alter table public."orderVariantLines" enable row level security;
drop policy if exists "orderVariantLines_authenticated_full_access"
  on public."orderVariantLines";
create policy "orderVariantLines_authenticated_full_access"
  on public."orderVariantLines"
  for all to authenticated using (true) with check (true);

notify pgrst, 'reload schema';
