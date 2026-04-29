-- 0076_variant_stock.sql
--
-- Variants now track on-hand counts of pre-assembled boxes (Mother's
-- Day editions, signature gift boxes — sold off the shelf without
-- needing per-customer assembly). Per-VariantPackaging quantity, not
-- per-location for v1 (boxes always live at the shop store).
--
-- Stock adjustments widen to include `variant` itemType so the
-- /stock/adjust page can record opening balances + recounts directly
-- against a variant size.
--
-- Idempotent.

ALTER TABLE public."variantPackagings"
  ADD COLUMN IF NOT EXISTS "quantityOnHand" integer NOT NULL DEFAULT 0;

ALTER TABLE public."stockAdjustments"
  DROP CONSTRAINT IF EXISTS "stockAdjustments_itemType_check";

ALTER TABLE public."stockAdjustments"
  ADD CONSTRAINT "stockAdjustments_itemType_check"
  CHECK ("itemType" IN ('product', 'variant', 'filling', 'packaging', 'ingredient'));

NOTIFY pgrst, 'reload schema';
