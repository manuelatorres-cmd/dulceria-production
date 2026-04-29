-- production-brain-migration-0071.sql
-- Adds userPreferences.lastRegenAt column. Stamped after regen so the
-- UI shows "last update X". Idempotent.

ALTER TABLE "userPreferences"
  ADD COLUMN IF NOT EXISTS "lastRegenAt" timestamptz;

NOTIFY pgrst, 'reload schema';
