-- =============================================================
-- Dulceria Production — fix clear_all_data() RPC
-- Migration 0021: replace the hand-written DELETE list with a
--                 dynamic TRUNCATE across every public-schema table
-- =============================================================
--
-- Why the rewrite
--   Migration 0004 shipped a `clear_all_data()` function that lists
--   ~26 tables by name and DELETEs them in FK-child-first order.
--   Every migration since then (0009, 0011, 0016–0020 at minimum)
--   has added new tables that the old function never learned about:
--
--     Phase 1–3 planning (0002):  orders, orderItems, productionSchedule,
--                                 mouldPool, equipment, capacityConfig,
--                                 eventCalendar, stockMinimums,
--                                 productTypeStepDurations
--     People (0009):              people, personUnavailability
--     Production steps (0011):    productionSteps
--     Stock Phase 2 (0016):       stockLocations, stockMovements,
--                                 stockLocationMinimums
--     Waste (0017):               wasteLog
--     CRM + quotes (0018):        customers, customerContacts,
--                                 customerFollowups, quotes, orderBoxes
--     Packing (0019):             packagingConsumption
--     HACCP (0020):               productionDays, haccpTemperatureLogs
--
--   Even worse, the old function had a latent bug: `orderItems.productId`
--   and `productionSchedule.productId` both reference `products(id)` with
--   ON DELETE RESTRICT, and neither orderItems nor productionSchedule was
--   in the delete list. Any user who had ever created an order or run
--   the scheduler would get a foreign-key violation on `DELETE FROM products`
--   and the entire atomic transaction would roll back — net effect: the
--   "Delete all data" button did nothing but show an error.
--
-- Approach
--   Enumerate every table in schema `public` at call time and run a
--   single TRUNCATE ... RESTART IDENTITY CASCADE. Three properties:
--
--   1. Future-proof. New tables added in later migrations are picked up
--      automatically; nobody needs to remember to patch this RPC.
--   2. FK-safe. TRUNCATE with CASCADE + all tables in one statement
--      doesn't care about RESTRICT/CASCADE settings on individual FKs,
--      because every referenced table is in the same truncation set.
--   3. Fast. TRUNCATE is far cheaper than DELETE for large tables,
--      and RESTART IDENTITY resets any serial sequences (we mostly use
--      uuid PKs, but this covers future additions).
--
-- Safety
--   - `security definer` so the RPC runs with the owner's privileges
--     (needed: authenticated users don't own the tables).
--   - Guarded by `auth.role() = 'authenticated'` so an anonymous client
--     can't trigger a wipe by calling the RPC directly.
--   - Only touches schema `public`. Supabase-managed schemas (`auth`,
--     `storage`, `realtime`, `extensions`, etc.) are left alone.
--
-- Idempotent: uses `create or replace`, so re-running the migration is
-- a no-op.
-- =============================================================

create or replace function public.clear_all_data()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  truncate_list text;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'clear_all_data: caller must be authenticated (got %)', auth.role();
  end if;

  -- Collect every user table in schema public. pg_tables already
  -- excludes views and system catalogs. %I quotes identifiers so
  -- camelCase table names survive the dynamic SQL round-trip.
  select string_agg(format('public.%I', tablename), ', ')
    into truncate_list
  from pg_tables
  where schemaname = 'public';

  if truncate_list is null then
    return;
  end if;

  execute 'truncate table ' || truncate_list || ' restart identity cascade';
end;
$$;

-- Permissions unchanged from 0004 — authenticated users can call it,
-- anonymous clients cannot. Re-applied defensively in case the migration
-- runs on an environment where the grants drifted.
revoke execute on function public.clear_all_data() from public;
grant execute on function public.clear_all_data() to authenticated;
