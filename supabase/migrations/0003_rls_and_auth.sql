-- =============================================================
-- Dulceria Production — Row-Level Security + shared workspace auth
-- Migration 0003: lock every table down to "authenticated role only"
-- =============================================================
--
-- Depends on migrations 0001 + 0002.
--
-- Model (decided 2026-04-19):
--   One shared Supabase user (email + password) that Manuela and her partner
--   both sign in with. No per-user row filtering — both operate on the same
--   single workspace. If the team grows past two people, or an edit log
--   becomes valuable, revisit with individual accounts + a tenant column.
--
-- What this migration does, idempotently, for every table in schema `public`:
--   1. Drop every existing policy on the table (clears any permissive
--      anon-read policies Supabase may have auto-created in the dashboard).
--   2. Enable RLS.
--   3. Create ONE policy, `authenticated_full_access`, that grants the
--      built-in `authenticated` role full SELECT / INSERT / UPDATE / DELETE
--      access to every row.
--
-- Net effect:
--   - Unauthenticated clients: no access to any table (REST returns empty
--     for reads, 42501 for writes — same error the SeedLoader used to hit).
--   - Authenticated clients (after signing in via supabase.auth): full
--     access to everything.
--
-- Safe to re-run: the DO block only touches tables in `public`, drops its
-- own named policy (plus any stale ones) before recreating it, and uses
-- `ALTER TABLE ... ENABLE RLS` which no-ops if already enabled.
-- =============================================================

do $$
declare
  t text;
  p text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    -- 1. Drop every existing policy on this table.
    for p in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;

    -- 2. Ensure RLS is enabled.
    execute format('alter table public.%I enable row level security', t);

    -- 3. Grant full access to the `authenticated` role (Supabase's built-in
    --    role assigned to any signed-in user). The `anon` role gets nothing,
    --    which is what we want — no bypass once this lands.
    execute format(
      'create policy "authenticated_full_access" on public.%I ' ||
      'for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end$$;

-- =============================================================
-- Follow-up outside this migration (done via Supabase dashboard, not SQL):
--   1. Auth → Providers: confirm Email provider is enabled with
--      password sign-in. Turn OFF "Confirm email" so the shared account
--      works without an email round-trip. Turn OFF public sign-ups so
--      strangers can't create accounts.
--   2. Auth → Users → Add user: create ONE user with the shared email +
--      password. That's the account Manuela + partner both sign in with.
-- =============================================================
