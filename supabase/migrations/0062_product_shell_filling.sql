-- 0062_product_shell_filling.sql
-- Products can now use a filling (e.g. a self-made pistachio chocolate
-- recipe) as their shell, instead of a single ingredient. Adds
-- `shellFillingId` nullable. Exactly one of shellIngredientId /
-- shellFillingId may be set.
--
-- No data migration needed — existing rows keep shellIngredientId.
-- Idempotent.

alter table public.products
  add column if not exists "shellFillingId" uuid;

alter table public.products
  drop constraint if exists "products_shellFillingId_fkey";
alter table public.products
  add constraint "products_shellFillingId_fkey"
  foreign key ("shellFillingId") references public.fillings(id) on delete restrict;

alter table public.products
  drop constraint if exists products_shell_source_exclusive;
alter table public.products
  add constraint products_shell_source_exclusive
  check (
    "shellIngredientId" is null or "shellFillingId" is null
  );

create index if not exists "products_shellFillingId_idx"
  on public.products ("shellFillingId");

notify pgrst, 'reload schema';
