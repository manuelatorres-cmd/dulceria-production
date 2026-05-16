-- ====================================================================
-- 0093 — campaigns.variantPackagingTargets
-- ====================================================================
--
-- Volume planning now picks at the variant-size level (a specific
-- VariantPackaging — e.g. "PB Cups · 1 cup of 15") instead of the
-- product level. Each entry maps `variantPackagingId → units` (count
-- of boxes / sized units to produce). Production-Order creation
-- expands these into per-product piece counts via
-- variantPackagingProducts.qty.
--
-- Kept alongside the existing `productTargets` jsonb (legacy) so old
-- campaigns keep rendering until users explicitly re-pick at the
-- variant-size level. New volume-planning UI writes only to
-- variantPackagingTargets.
--
-- Idempotent — `add column if not exists`.

alter table public.campaigns
  add column if not exists "variantPackagingTargets" jsonb not null default '{}'::jsonb;

comment on column public.campaigns."variantPackagingTargets" is
  'Volume-planning targets at the variant-size level. Map of variantPackagingId → units (boxes / sized units). PO creation expands these to per-product piece counts via variantPackagingProducts.qty.';

notify pgrst, 'reload schema';
