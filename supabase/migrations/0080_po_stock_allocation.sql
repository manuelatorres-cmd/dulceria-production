-- Migration 0080 — PO-level stock allocation
--
-- Until now, stock allocations were keyed only by `orderId` (customer
-- orders). Production orders (PO/replen/internal) drove production
-- but their pieces ended up in shop stock untagged — so when a PO
-- finished, the operator could not see "63 of these are reserved
-- for Maca PO" the way she could for a customer order.
--
-- Adds a parallel `productionOrderId` column on both stockMovements
-- and stockLocations. A row with location='allocated', orderId=NULL,
-- productionOrderId=<X> is the PO equivalent of a customer-order
-- allocation. Postgres treats NULL as distinct in unique indexes by
-- default, so multiple PO allocations can coexist for the same
-- (planProductId, location='allocated') tuple without colliding with
-- the existing customer-order rows.

ALTER TABLE "stockMovements"
  ADD COLUMN IF NOT EXISTS "productionOrderId" UUID;

CREATE INDEX IF NOT EXISTS "stockMovements_productionOrderId_idx"
  ON "stockMovements"("productionOrderId");

ALTER TABLE "stockLocations"
  ADD COLUMN IF NOT EXISTS "productionOrderId" UUID;

CREATE INDEX IF NOT EXISTS "stockLocations_productionOrderId_idx"
  ON "stockLocations"("productionOrderId");

COMMENT ON COLUMN "stockMovements"."productionOrderId" IS
  'Tag for PO-driven allocations — when a piece is reserved against an internal production order (vs a customer order), this links the movement back to the productionOrders row. Mutually exclusive with orderId in practice.';

COMMENT ON COLUMN "stockLocations"."productionOrderId" IS
  'Per-PO reservation of allocated stock. Set on rows where orderId IS NULL and the pieces are earmarked for a productionOrderItem.';
