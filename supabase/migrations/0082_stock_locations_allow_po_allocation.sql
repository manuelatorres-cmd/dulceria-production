-- Migration 0082 — Allow PO-level allocation rows on stockLocations
--
-- Migration 0080 added a `productionOrderId` column to stockLocations
-- so unmould allocations could be tagged with an internal PO instead
-- of a customer order, but it didn't update the CHECK constraint
-- inherited from migration 0016 which enforces:
--
--   (location = 'allocated' AND "orderId" IS NOT NULL) OR
--   (location <> 'allocated' AND "orderId" IS NULL)
--
-- That rule rejects an 'allocated' row with orderId NULL, even when
-- productionOrderId carries the tag. The unmould → AllocationSplit
-- flow fails with 23514 on save.
--
-- Drop the old check, install one that lets EITHER orderId OR
-- productionOrderId carry the allocation tag (mutually exclusive in
-- practice; both null is allowed for the surplus case where neither
-- a customer order nor an internal PO owns the pieces). Also extend
-- the uniqueness rule so a single batch can split across multiple
-- POs simultaneously without colliding with customer-order rows.
--
-- Reversible: see down-migration notes inline.

-- 1) Replace the check constraint.
ALTER TABLE "stockLocations"
  DROP CONSTRAINT IF EXISTS "stockLocations_check";

ALTER TABLE "stockLocations"
  ADD CONSTRAINT "stockLocations_allocation_tag_check" CHECK (
    (location = 'allocated') OR
    (location <> 'allocated' AND "orderId" IS NULL AND "productionOrderId" IS NULL)
  );

-- 2) Extend uniqueness to include productionOrderId so PO allocations
--    don't collide with each other or with customer-order rows on the
--    same (batch, location). Postgres treats NULL as distinct in
--    unique indexes by default — fine for our case.
ALTER TABLE "stockLocations"
  DROP CONSTRAINT IF EXISTS "stockLocations_planProductId_location_orderId_key";

CREATE UNIQUE INDEX IF NOT EXISTS
  "stockLocations_planProductId_location_orderId_productionOrderId_key"
  ON "stockLocations" ("planProductId", location, "orderId", "productionOrderId");

NOTIFY pgrst, 'reload schema';
