-- 0063_campaign_product_targets.sql
-- Per-product target units inside a campaign. Lets the user say
-- "Mother's Day = 200 truffle boxes + 100 bonbon boxes + 50 bars"
-- instead of one aggregate `targetTotalUnits`. Stored as JSONB so
-- the shape can evolve without further migrations:
--   { productId1: 200, productId2: 100, ... }
--
-- Idempotent. Existing rows get an empty object on upsert from the
-- app side; nothing to backfill.

alter table public.campaigns
  add column if not exists "productTargets" jsonb default '{}'::jsonb;

notify pgrst, 'reload schema';
