-- 0086_isolated_production.sql
--
-- Adds an `isolated` flag to campaigns and orders so the user can mark
-- a source as "do not mix with other production." Phase 1: storage +
-- UI surface only. Engine respect (replen seeder ignoring isolated
-- output, mould allocator treating isolated batches as single-tenant)
-- is deferred — the flag is informational on first ship; once the
-- workflow proves out we can wire enforcement.
--
-- Statement-level idempotency per feedback_supabase_migration_idempotency.md.

alter table "campaigns"
  add column if not exists "isolated" boolean not null default false;

alter table "orders"
  add column if not exists "isolated" boolean not null default false;

notify pgrst, 'reload schema';
