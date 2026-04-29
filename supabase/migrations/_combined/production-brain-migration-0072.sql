-- production-brain-migration-0072.sql
-- Widen stockTransfers.reason CHECK to allow new stock-out reasons
-- used by the weekly sales report: sold (walk-in), event_sample, staff.

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
