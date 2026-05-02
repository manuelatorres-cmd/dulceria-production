-- Migration 0083 — Add 'ready_to_pack' to orders.status
--
-- Online orders default to fulfilmentMode='borrow' (per CHANNEL_FULFILMENT_DEFAULTS,
-- shipped in commit 2639c4e). When every borrow line has stock allocated against
-- it at intake time, the order is logistically complete from a production view —
-- no batch needs to spawn, just a pick-and-ship at dispatch.
--
-- New status 'ready_to_pack' captures that state so the operator sees a green
-- "ready" badge instead of a vague "pending" + has to drill in to verify.
-- Status flips back to 'pending' if a borrow line later fails (e.g. shop count
-- correction reveals a phantom). markOrderAsPacked still drives the eventual
-- 'done' transition.

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'ready_to_pack', 'in_production', 'done', 'cancelled'));

NOTIFY pgrst, 'reload schema';
