-- Migration 0084 — Per-location variant on-hand inventory
--
-- Until now `variantPackagings.quantityOnHand` (mig 0076) was a single
-- integer per variant size, never written by code. The boxed-inventory
-- model needs:
--   1. Multiple locations per variant (shop floor / production storage /
--      freezer) — same 4-location model used for product pieces.
--   2. An audit row whenever pieces are boxed up into a variant or a
--      variant unit is sold / reverted, so HACCP can trace which batch's
--      pieces are in which boxes.
--
-- New `variantStockLocations` mirrors `stockLocations` shape but keys
-- on `variantPackagingId` instead of `planProductId`. The legacy
-- `quantityOnHand` column is left in place (untouched by code) so this
-- migration is reversible.
--
-- New `stockMovements.variantPackagingId` column records the variant
-- target for box-up events; existing planProductId stays as the source
-- so trace bars→boxes works in both directions.

CREATE TABLE IF NOT EXISTS "variantStockLocations" (
  id                    uuid PRIMARY KEY,
  "variantPackagingId"  uuid NOT NULL REFERENCES "variantPackagings"(id) ON DELETE CASCADE,
  location              text NOT NULL
                        CHECK (location IN ('store','production','freezer','allocated')),
  "orderId"             uuid REFERENCES orders(id) ON DELETE SET NULL,
  "productionOrderId"   uuid,
  quantity              integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  "updatedAt"           timestamptz NOT NULL DEFAULT now(),
  -- One row per (variant size, location) for the unallocated pool;
  -- 'allocated' rows split per (orderId | productionOrderId) so a single
  -- variant can be reserved for multiple buyers simultaneously.
  UNIQUE ("variantPackagingId", location, "orderId", "productionOrderId"),
  CHECK (
    (location = 'allocated') OR
    (location <> 'allocated' AND "orderId" IS NULL AND "productionOrderId" IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS "variantStockLocations_variantPackagingId_idx"
  ON "variantStockLocations"("variantPackagingId");
CREATE INDEX IF NOT EXISTS "variantStockLocations_location_idx"
  ON "variantStockLocations"(location);
CREATE INDEX IF NOT EXISTS "variantStockLocations_orderId_idx"
  ON "variantStockLocations"("orderId");

-- RLS — same authenticated-only pattern.
DO $$
DECLARE p text;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'variantStockLocations'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public."variantStockLocations"', p);
  END LOOP;
END$$;
ALTER TABLE "variantStockLocations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON "variantStockLocations"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Audit column on existing stockMovements — every box-up logs a
-- movement with planProductId (source pieces) AND variantPackagingId
-- (target variant) so the lineage is queryable.
ALTER TABLE "stockMovements"
  ADD COLUMN IF NOT EXISTS "variantPackagingId" uuid REFERENCES "variantPackagings"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "stockMovements_variantPackagingId_idx"
  ON "stockMovements"("variantPackagingId");

NOTIFY pgrst, 'reload schema';
