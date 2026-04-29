-- 0075_variant_aliases.sql
--
-- Adds `aliases` (text[]) to variants. Mirrors products.aliases —
-- alternative names this variant is known by externally (Shopify
-- storefront title, German label, abbreviation). The Shopify CSV
-- importer matches `Lineitem name` against these to auto-resolve.
-- Built up automatically when the user picks a variant for an
-- unresolved import line. Idempotent.

ALTER TABLE public.variants
  ADD COLUMN IF NOT EXISTS aliases text[];

NOTIFY pgrst, 'reload schema';
