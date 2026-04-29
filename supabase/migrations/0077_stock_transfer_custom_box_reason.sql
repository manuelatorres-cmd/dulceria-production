-- 0077_stock_transfer_custom_box_reason.sql
--
-- Adds "custom_box" to stockTransfers.reason CHECK. Variance during
-- daily count of products that landed in custom-box assemblies (no
-- separate sales line — price was on the box) was missing a reason.
-- Idempotent.

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
    'sold',
    'custom_box'
  ));

NOTIFY pgrst, 'reload schema';
