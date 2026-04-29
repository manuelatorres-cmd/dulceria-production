-- 0072_stock_transfer_reasons.sql
--
-- Widens the stockTransfers.reason CHECK constraint to cover the new
-- shop stock-out flow: walk-in sales (`sold`), event handouts
-- (`event_sample`), and staff/owner consumption (`staff`). The weekly
-- sales report aggregates by these reason values. Idempotent.

ALTER TABLE public."stockTransfers"
  DROP CONSTRAINT IF EXISTS "stockTransfers_reason_check";

ALTER TABLE public."stockTransfers"
  ADD CONSTRAINT "stockTransfers_reason_check"
  CHECK (reason IN (
    'auto-replenish',
    'shop-request',
    'manual',
    'return',
    'waste',
    'gift',
    'tasting',
    'event_sample',
    'staff',
    'sold'
  ));

NOTIFY pgrst, 'reload schema';
