-- production-brain-migration-0075.sql
-- Adds variants.aliases (text[]) so importers can match Shopify
-- storefront titles to variants alongside products.

ALTER TABLE public.variants
  ADD COLUMN IF NOT EXISTS aliases text[];

NOTIFY pgrst, 'reload schema';
