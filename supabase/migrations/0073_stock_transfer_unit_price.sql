-- 0073_stock_transfer_unit_price.sql
--
-- Adds `unitPrice` (per-piece sale price, EUR) to stockTransfers so
-- the weekly sales report can roll up revenue from walk-in sales,
-- variant sales, and event handouts without joining orders. Null on
-- non-revenue rows (waste, manual transfers). Idempotent.

ALTER TABLE public."stockTransfers"
  ADD COLUMN IF NOT EXISTS "unitPrice" numeric(10, 2);

NOTIFY pgrst, 'reload schema';
