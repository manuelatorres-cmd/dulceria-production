-- =============================================================
-- Dulceria Production — sub-ingredient breakdown on ingredients
-- Migration 0007: add `subIngredients` JSONB column to ingredients
-- =============================================================
--
-- Depends on migrations 0001–0006.
--
-- Compound ingredients (e.g. "Callebaut 811 Dark Chocolate 54%") carry an
-- optional ingredient breakdown — a list of what they're made of, used to
-- generate ingredient-list text at filling / product / collection level
-- (legal labelling + "what's in the box"). The breakdown is text-only:
-- sub-entries are not FK-linked to other ingredients rows, because legal
-- ingredient labels just need names + optional percentages, not relational
-- nesting. Nutrition already lives on each Ingredient's own `nutrition`
-- column; sub-ingredients don't feed into nutrition math.
--
-- Shape per entry:
--   { "name": string, "percentage"?: number }
--
-- Percentages are optional and not required to sum to 100 — they're used
-- only for sorting on the ingredient-list display when present.

alter table public.ingredients
  add column if not exists "subIngredients" jsonb;

comment on column public.ingredients."subIngredients" is
  'Optional list of sub-ingredients (text-only): [{name, percentage?}]. Used to roll up ingredient-list text at filling/product/collection level. Nutrition stays on ingredients.nutrition at the compound level.';
