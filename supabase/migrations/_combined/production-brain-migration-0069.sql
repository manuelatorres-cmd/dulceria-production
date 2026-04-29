-- 0069_mould_tags.sql
-- Free-text tag array on moulds. Lets the user organise the catalogue
-- by "Christmas", "Easter", "seasonal", "bars-only", "special-order",
-- etc. Same pattern as `products.tags`. Idempotent.

alter table public.moulds
  add column if not exists tags text[];

notify pgrst, 'reload schema';
