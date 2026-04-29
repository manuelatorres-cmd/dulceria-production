-- production-brain-migration-0076.sql
-- Add variant stock tracking — quantityOnHand on variantPackagings.
-- Widen stockAdjustments.itemType CHECK to include 'variant'.
-- Idempotent.

ALTER TABLE public."variantPackagings"
  ADD COLUMN IF NOT EXISTS "quantityOnHand" integer NOT NULL DEFAULT 0;

ALTER TABLE public."stockAdjustments"
  DROP CONSTRAINT IF EXISTS "stockAdjustments_itemType_check";

ALTER TABLE public."stockAdjustments"
  ADD CONSTRAINT "stockAdjustments_itemType_check"
  CHECK ("itemType" IN ('product', 'variant', 'filling', 'packaging', 'ingredient'));

NOTIFY pgrst, 'reload schema';
