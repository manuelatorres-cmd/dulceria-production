-- =============================================================
-- Dulceria Production — RLS for orderPlanLinks
-- Migration 0042
-- =============================================================
--
-- Migration 0041 created public.orderPlanLinks but omitted the
-- authenticated_full_access policy that every other Dulceria table
-- carries (set up in 0003, re-applied per-table on every later
-- migration that creates a new table — see 0032 for an example).
-- Without the policy, authenticated clients hit
--   new row violates row-level security policy for table "orderPlanLinks"
--   (code 42501)
-- on every INSERT from Regenerate plan — which is exactly what the
-- consolidator needs to do.
--
-- Applies the standard pattern: drop any stale policies, enable RLS,
-- grant full SELECT / INSERT / UPDATE / DELETE to the built-in
-- `authenticated` role. Anonymous clients get nothing, matching every
-- other table.
--
-- Idempotent — safe to re-run on any state.
-- =============================================================

do $$
declare p text;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'orderPlanLinks'
  loop
    execute format('drop policy if exists %I on public."orderPlanLinks"', p);
  end loop;
  execute 'alter table public."orderPlanLinks" enable row level security';
  execute 'create policy "authenticated_full_access" on public."orderPlanLinks" '
       || 'for all to authenticated using (true) with check (true)';
end$$;

notify pgrst, 'reload schema';
