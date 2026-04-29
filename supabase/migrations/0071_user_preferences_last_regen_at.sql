-- 0071_user_preferences_last_regen_at.sql
--
-- Adds `lastRegenAt` to the singleton userPreferences row. Stamped
-- after every successful `regenerateAllPlansAndSchedule` so the UI
-- can show "Last update 14:32 · 12 min ago" beside the Regenerate
-- button. Idempotent.

ALTER TABLE "userPreferences"
  ADD COLUMN IF NOT EXISTS "lastRegenAt" timestamptz;

NOTIFY pgrst, 'reload schema';
