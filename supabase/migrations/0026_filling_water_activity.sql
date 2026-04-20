-- =============================================================
-- Dulceria Production — filling water activity (Aw)
-- Migration 0026: add fillings.waterActivity
-- =============================================================
--
-- Water activity (Aw) is the fraction of free water in a filling
-- that's available for microbial growth. It's one of the primary
-- food-safety signals for shelf stability: lower Aw = longer shelf
-- life, and thresholds like 0.85 (below which most pathogens can't
-- grow) are enforced by food inspectors.
--
-- Chocolatiers measure Aw with a dedicated meter on finished
-- ganache / caramel / praline — the number informs how long the
-- filling stays safe and lets you declare shelf life confidently.
--
-- Numeric(4,3) gives a range of 0.000–9.999 (we only need 0.000–1.000
-- but the extra room doesn't cost anything). Nullable because most
-- fillings won't have a measurement immediately.
-- =============================================================

alter table public.fillings
  add column if not exists "waterActivity" numeric(4,3)
    check ("waterActivity" is null or ("waterActivity" >= 0 and "waterActivity" <= 1));
