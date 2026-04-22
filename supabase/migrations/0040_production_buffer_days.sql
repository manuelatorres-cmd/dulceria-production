-- Production buffer days
--
-- How many working days before an order's deadline the scheduler should
-- leave as buffer — so work lands at latest on (deadline − N working days).
-- Default 2. Configurable in Settings → Buffers.
--
-- Nullable so existing partial capacityConfig rows keep loading; the
-- scheduler reads `productionBufferDays ?? 2` at runtime.

alter table public."capacityConfig"
  add column if not exists "productionBufferDays" integer default 2;

notify pgrst, 'reload schema';
