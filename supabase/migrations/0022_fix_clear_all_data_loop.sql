-- =============================================================
-- Dulceria Production — clear_all_data() retry
-- Migration 0022: replace 0021's SELECT … INTO variant with a plain
--                 per-table TRUNCATE loop
-- =============================================================
--
-- Why a follow-up
--   0021 used `SELECT string_agg(...) INTO truncate_list` inside the
--   PL/pgSQL body. In the Supabase SQL editor that raised:
--
--     ERROR 42P01: relation "truncate_list" does not exist
--
--   The parser treated `truncate_list` as a table reference rather
--   than the declared local variable — a known sharp edge when
--   SELECT … INTO sits between a variable binding and the SQL
--   statement of the same name.
--
-- Fix
--   Skip the variable assignment entirely. Loop over pg_tables and
--   issue one TRUNCATE … CASCADE per table. The CASCADE chain handles
--   foreign keys as each table is visited — later iterations just
--   find their targets already empty, which is a no-op.
--
-- Same guarantees as 0021:
--   - future-proof (new tables picked up automatically),
--   - FK-safe (CASCADE on every table covers all RESTRICT FKs),
--   - `security definer` + authenticated-only,
--   - leaves Supabase-managed schemas alone (only touches `public`).
--
-- Idempotent: `create or replace` replaces whatever 0021 created.
-- =============================================================

create or replace function public.clear_all_data()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'clear_all_data: caller must be authenticated (got %)', auth.role();
  end if;

  -- Truncate every user table in public. CASCADE handles FK fan-out;
  -- RESTART IDENTITY resets any serial sequences (we use uuid PKs, but
  -- this keeps the RPC correct if a future migration adds a serial).
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format('truncate table public.%I restart identity cascade', r.tablename);
  end loop;
end;
$$;

revoke execute on function public.clear_all_data() from public;
grant execute on function public.clear_all_data() to authenticated;
