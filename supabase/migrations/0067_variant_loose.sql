-- 0067_variant_loose.sql
-- Allow a variant size to have NO packaging — sold loose / individual.
-- Manuela sells some products without any box (single bonbons at the
-- counter, market events, …) but still needs a sell-price. Today the
-- VariantPackaging row requires `packagingId`. Drop NOT NULL.

do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'variantPackagings'
       and column_name = 'packagingId'
       and is_nullable = 'NO'
  ) then
    alter table public."variantPackagings" alter column "packagingId" drop not null;
  end if;
end $$;

notify pgrst, 'reload schema';
