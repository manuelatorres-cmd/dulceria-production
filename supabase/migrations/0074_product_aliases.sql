-- 0074_product_aliases.sql
--
-- Adds `aliases` (text[]) to products. Stores alternative names this
-- product is known by externally — Shopify storefront titles, German
-- labels, abbreviations. Used by the Shopify CSV importer to
-- auto-resolve "Lineitem name" against the user's catalogue. Aliases
-- accumulate automatically: when the user manually maps an unresolved
-- import line, the source name is appended here. Idempotent.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS aliases text[];

NOTIFY pgrst, 'reload schema';
