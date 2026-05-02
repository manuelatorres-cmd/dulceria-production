-- Migration 0085 — Allow variant-only stockMovements rows
--
-- mig 0016 declared `stockMovements.planProductId` + `productId` as
-- NOT NULL with FKs to planProducts + products. Worked when every
-- movement traced back to a specific batch + product. Box-up rows
-- introduced in 0084 sometimes have no per-batch source (the headline
-- "built N boxes" audit row, manual variant recounts via
-- setVariantStockOnHand). Inserts with empty strings fail the FK
-- check + return 400.
--
-- Drop NOT NULL on both. Per-composition trace rows still carry
-- planProductId + productId (the bars-from-batch-X provenance) so
-- HACCP recall stays intact.

ALTER TABLE "stockMovements"
  ALTER COLUMN "planProductId" DROP NOT NULL;

ALTER TABLE "stockMovements"
  ALTER COLUMN "productId" DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
