-- 0070_drop_product_low_stock_threshold.sql
--
-- Removes the legacy `products.lowStockThreshold` column. The "is product
-- low?" flag is now derived entirely from `stockLocationMinimums`
-- (sum across configured locations). Idempotent.

ALTER TABLE products DROP COLUMN IF EXISTS "lowStockThreshold";

-- Refresh PostgREST schema cache so the column disappears from API
-- response payloads on the next request.
NOTIFY pgrst, 'reload schema';
