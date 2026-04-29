-- production-brain-migration-0070.sql
-- Drop legacy products.lowStockThreshold column. Low-stock is now
-- computed from sum of stockLocationMinimums per product. Idempotent.

ALTER TABLE products DROP COLUMN IF EXISTS "lowStockThreshold";

NOTIFY pgrst, 'reload schema';
