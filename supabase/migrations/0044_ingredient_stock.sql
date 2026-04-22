-- =============================================================
-- Dulceria Production — Ingredient stock (grams on hand)
-- Migration 0044
-- =============================================================
--
-- Tracks grams-on-hand per ingredient. One row per ingredient
-- (unique on ingredientId). Receives on purchase intake, drains on
-- Shelling (shell chocolate) and Filling Prep (recipe ingredients).
-- Feeds the shopping list when below lowStockThresholdG.
--
-- Separate from the product stockMovements audit log because the
-- piece/gram model doesn't fit the existing schema (productId +
-- planProductId are NOT NULL there). We add ingredientStockMovements
-- as a parallel audit stream.
-- =============================================================

-- 1. ingredientStock — balance per ingredient.
create table if not exists public."ingredientStock" (
  id                      uuid primary key,
  "ingredientId"          uuid not null unique
                           references public.ingredients(id) on delete cascade,
  "quantityG"             numeric(14,3) not null default 0
                           check ("quantityG" >= 0),
  "lowStockThresholdG"    numeric(14,3)
                           check ("lowStockThresholdG" is null or "lowStockThresholdG" >= 0),
  "createdAt"             timestamptz not null default now(),
  "updatedAt"             timestamptz not null default now()
);
create index if not exists "ingredientStock_ingredientId_idx"
  on public."ingredientStock" ("ingredientId");

alter table public."ingredientStock" enable row level security;
drop policy if exists "authenticated_full_access" on public."ingredientStock";
create policy "authenticated_full_access" on public."ingredientStock"
  for all to authenticated using (true) with check (true);

-- 2. ingredientStockMovements — audit log.
-- reason: 'receive' (purchase intake), 'shelling' (step deduction),
-- 'filling_prep' (step deduction), 'recount' (manual adjustment),
-- 'waste' (discard).
-- deltaG is signed: positive = intake, negative = outake.
create table if not exists public."ingredientStockMovements" (
  id              uuid primary key,
  "ingredientId"  uuid not null
                  references public.ingredients(id) on delete cascade,
  "deltaG"        numeric(14,3) not null,
  reason          text not null,
  "planId"        uuid references public."productionPlans"(id) on delete set null,
  "stepKey"       text,   -- e.g. "shell-<planProductId>" for traceability
  "movedBy"       text,
  notes           text,
  "movedAt"       timestamptz not null default now()
);
create index if not exists "ingredientStockMovements_ingredientId_idx"
  on public."ingredientStockMovements" ("ingredientId");
create index if not exists "ingredientStockMovements_planId_idx"
  on public."ingredientStockMovements" ("planId");
create index if not exists "ingredientStockMovements_movedAt_idx"
  on public."ingredientStockMovements" ("movedAt" desc);

alter table public."ingredientStockMovements" enable row level security;
drop policy if exists "authenticated_full_access" on public."ingredientStockMovements";
create policy "authenticated_full_access" on public."ingredientStockMovements"
  for all to authenticated using (true) with check (true);

notify pgrst, 'reload schema';
