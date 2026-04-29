-- production-brain-migration-0074.sql
-- Adds products.aliases (text[]) — alternative names for importer
-- auto-resolution. Shopify storefront titles, German labels,
-- abbreviations. Built up automatically from manual import mappings.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS aliases text[];

NOTIFY pgrst, 'reload schema';
