-- =============================================================
-- Dulceria Production — import helpers
-- Migration 0004: clear_all_data() RPC for atomic "wipe before restore"
-- =============================================================
--
-- Depends on migrations 0001 + 0002 + 0003.
--
-- Why an RPC instead of a REST-level DELETE loop:
--   The JS import flow used to issue 13+ sequential REST DELETEs (one per
--   table), each with a `?id=not.is.null` filter. That pattern is fragile:
--   every call is a separate Postgres transaction, none are atomic, and a
--   transient stuck request anywhere in the chain (Cloudflare edge glitch,
--   PgBouncer pool hiccup) leaves the DB in a partially-wiped state. One
--   server-side RPC call is atomic — either every DELETE commits or none
--   do — and takes a single round-trip.
--
-- Scope:
--   Only the tables that appear in the ChocCollab backup payload. The new
--   Dulceria planning tables from 0002 (orders, productionSchedule,
--   mouldPool, equipment, productTypeStepDurations, capacityConfig,
--   eventCalendar, stockMinimums) are NOT deleted directly — no backup
--   data exists for them, so we leave them alone.
--
--   Caveat: a handful of 0002 tables have FK references to 0001 tables
--   (orderItems → products, stockMinimums → products, mouldPool → moulds /
--   productionPlans / planProducts, productionSchedule → products / moulds
--   / fillings / productionPlans / planProducts, equipment →
--   productionPlans / productionSchedule). Those references are
--   ON DELETE CASCADE or ON DELETE SET NULL per the migration 0002 schema.
--   When this function DELETEs the parent rows, Postgres automatically
--   applies the configured cascade. For the current state of the app
--   (Phase 4 Settings not yet built → 0002 tables empty) this is a no-op;
--   once Phase 4 lands, we'll revisit whether "import backup" should
--   preserve planning config or not.
--
-- Security:
--   SECURITY DEFINER so authenticated users (who have no DELETE privileges
--   on the underlying tables) can invoke it through the function owner's
--   privileges. `auth.role()` check inside the function is defence-in-depth.
--   EXECUTE granted only to the `authenticated` role; anonymous callers
--   get nothing.

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

  -- Delete in FK-child-first order so each parent's dependents are gone by
  -- the time we get to it. Single plpgsql function body = one implicit
  -- transaction = atomic commit/rollback. Mirrors INSERT_ORDER (reversed)
  -- in src/lib/backup.ts.
  delete from public."collectionPricingSnapshots";
  delete from public."collectionPackagings";
  delete from public."collectionProducts";
  delete from public."productCostSnapshots";
  delete from public."coatingChocolateMappings";
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
