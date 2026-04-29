-- production-brain-migration-0073.sql
-- Adds stockTransfers.unitPrice (numeric 10,2 nullable). Captures
-- per-piece sale price on `sold` / `event_sample` rows so the weekly
-- sales report rolls up revenue from walk-in sales and variant sales.

ALTER TABLE public."stockTransfers"
  ADD COLUMN IF NOT EXISTS "unitPrice" numeric(10, 2);

NOTIFY pgrst, 'reload schema';
