-- production-brain-migration-0077.sql
-- Add 'custom_box' to stockTransfers.reason — used when daily-count
-- variance equals bonbons that went into custom-box assemblies.

ALTER TABLE public."stockTransfers"
  DROP CONSTRAINT IF EXISTS "stockTransfers_reason_check";

ALTER TABLE public."stockTransfers"
  ADD CONSTRAINT "stockTransfers_reason_check"
  CHECK (reason IN (
    'auto-replenish',
    'shop-request',
    'manual',
    'return',
    'waste',
    'gift',
    'tasting',
    'event_sample',
    'staff',
    'sold',
    'custom_box'
  ));

NOTIFY pgrst, 'reload schema';
