-- =============================================================
-- Dulceria Production — drop import helpers
-- Migration 0005: rollback of 0004 (clear_all_data RPC)
-- =============================================================
--
-- The bulk-restore / import-backup flow in the app has been retired for now
-- (see src/app/(app)/settings/page.tsx — UI removed 2026-04-19). The RPC
-- added in migration 0004 is dead code server-side; drop it so the Supabase
-- project doesn't carry around unused security-definer functions.
--
-- Safe to run whether or not 0004 was ever applied — DROP FUNCTION IF EXISTS
-- is a no-op when the function isn't there.
--
-- If we ever revive the bulk-restore UI, resurrect it by re-running 0004 or
-- writing a 0006 equivalent.

drop function if exists public.clear_all_data();
