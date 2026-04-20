-- =============================================================
-- Dulceria Production — ingredient stock in grams
-- Migration 0014: add `currentStockG` to ingredients
-- =============================================================
--
-- Depends on 0001 (ingredients table).
--
-- Lets the shopping list compute "planned demand − stock on hand"
-- shortages. Nullable — treated as 0 (no stock) when unset so the
-- user only has to fill it in for ingredients they actually track.

alter table public.ingredients
  add column if not exists "currentStockG" numeric(10,2)
    check ("currentStockG" is null or "currentStockG" >= 0);

comment on column public.ingredients."currentStockG" is
  'Current stock in grams. Nullable — treated as 0 for shopping-list '
  'shortage math when unset. Unit-agnostic: everything converts to grams '
  'for planning (kg/L × 1000, ml × 1).';
