-- =============================================================
-- Dulceria Production — ingredientStock recovery
-- Migration 0045
-- =============================================================
--
-- Migration 0044 intended to create ingredientStock and
-- ingredientStockMovements together, but on the live run on
-- 2026-04-22 only the movements table landed — the stock table
-- query returned "relation public.ingredientStock does not exist".
-- Best guess: the SQL was pasted in chunks and the first block
-- got skipped. Easy enough to re-apply idempotently.
--
-- This migration re-creates the table + index + RLS policy from
-- scratch with plain DDL (no DO block). Safe on a DB where it
-- partially exists.
-- =============================================================

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

notify pgrst, 'reload schema';
