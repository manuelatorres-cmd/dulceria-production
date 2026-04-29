-- 0061_nested_fillings.sql
-- Allow a filling recipe line to point at either an ingredient OR
-- another filling (a "sub-filling"). Schema change:
--   * `fillingIngredients.ingredientId` becomes nullable.
--   * New column `componentFillingId` (nullable, FK to fillings.id).
--   * Check: exactly one of the two must be set.
--   * Check: componentFillingId cannot equal the owning fillingId
--     (self-reference) — deeper cycle detection happens in app code.
--
-- Idempotent: safe to re-run.

alter table public."fillingIngredients"
  add column if not exists "componentFillingId" uuid;

-- Relax the NOT NULL on ingredientId so either-or is possible.
do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'fillingIngredients'
       and column_name = 'ingredientId'
       and is_nullable = 'NO'
  ) then
    alter table public."fillingIngredients" alter column "ingredientId" drop not null;
  end if;
end $$;

-- FK to fillings (same table as the owner).
alter table public."fillingIngredients"
  drop constraint if exists "fillingIngredients_componentFillingId_fkey";
alter table public."fillingIngredients"
  add constraint "fillingIngredients_componentFillingId_fkey"
  foreign key ("componentFillingId") references public.fillings(id)
  on delete restrict;

-- Exactly-one-of constraint.
alter table public."fillingIngredients"
  drop constraint if exists fillingIngredients_component_exclusive;
alter table public."fillingIngredients"
  add constraint fillingIngredients_component_exclusive
  check (
    ("ingredientId" is not null and "componentFillingId" is null) or
    ("ingredientId" is null     and "componentFillingId" is not null)
  );

-- Prevent a filling from including itself as a direct child.
alter table public."fillingIngredients"
  drop constraint if exists fillingIngredients_no_self_ref;
alter table public."fillingIngredients"
  add constraint fillingIngredients_no_self_ref
  check ("componentFillingId" is null or "componentFillingId" <> "fillingId");

-- Helpful index for reverse lookups (which fillings use filling X).
create index if not exists "fillingIngredients_componentFillingId_idx"
  on public."fillingIngredients" ("componentFillingId");

notify pgrst, 'reload schema';
