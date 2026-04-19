-- =============================================================
-- Dulceria Production — drop coating chocolate mappings
-- Migration 0006: retire the coatingChocolateMappings table
-- =============================================================
--
-- Depends on migrations 0001–0005.
--
-- The `coatingChocolateMappings` table was part of ChocCollab's legacy
-- coating system: ingredients tagged with `shellCapable=true` would also
-- register a `(coatingName, ingredientId, effectiveFrom)` mapping so
-- products with a `coating` string ("dark", "milk") could resolve to an
-- actual chocolate ingredient at a given date.
--
-- That system is redundant in Dulceria: products now point at their shell
-- chocolate directly via `products.shellIngredientId`, so the mapping
-- layer adds no information. We're also simplifying the ingredient form
-- (per Manuela's 2026-04-19 decision) to just a "can be used as shell
-- chocolate" boolean — no coating-type input, no seed-tempering flag.
--
-- This migration:
--   1. Drops the `coatingChocolateMappings` table.
--   2. Recreates `clear_all_data()` without the line that deleted from
--      that table (so the import-restore RPC keeps working if we ever
--      revive the UI). Same security properties as migration 0004.
--
-- NOT dropped here (deliberately):
--   - `products.coating` free-text column. Still used by the production
--     wizard to group/sort the batch-to-make list by coating string.
--     Removing it is a bigger refactor (switch grouping to
--     `shellIngredientId`), deferred to a later migration.
--   - `productCostSnapshots.coatingName` column. Empty for new snapshots
--     but harmless to keep.
-- =============================================================

drop table if exists public."coatingChocolateMappings";

create or replace function public.clear_all_data()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'authenticated' then
    raise exception 'clear_all_data: caller must be authenticated (got %)', auth.role();
  end if;

  delete from public."collectionPricingSnapshots";
  delete from public."collectionPackagings";
  delete from public."collectionProducts";
  delete from public."productCostSnapshots";
  delete from public."ingredientPriceHistory";
  delete from public."productFillingHistory";
  delete from public."fillingIngredients";
  delete from public."productFillings";
  delete from public."experimentIngredients";
  delete from public."planStepStatus";
  delete from public."planProducts";
  delete from public."fillingStock";
  delete from public."packagingOrders";
  delete from public."productionPlans";
  delete from public.experiments;
  delete from public.fillings;
  delete from public.products;
  delete from public.collections;
  delete from public.packaging;
  delete from public."decorationMaterials";
  delete from public."shellDesigns";
  delete from public."decorationCategories";
  delete from public."fillingCategories";
  delete from public."ingredientCategories";
  delete from public."productCategories";
  delete from public.ingredients;
  delete from public.moulds;
  delete from public."userPreferences";
  delete from public."shoppingItems";
end;
$$;

revoke execute on function public.clear_all_data() from public;
grant execute on function public.clear_all_data() to authenticated;
