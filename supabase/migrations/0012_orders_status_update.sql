-- =============================================================
-- Dulceria Production — simplify orders.status lifecycle
-- Migration 0012: pending / in_production / done / cancelled
-- =============================================================
--
-- Depends on migration 0002 (orders table exists).
--
-- The brief collapses the old draft / confirmed / in_production /
-- ready / delivered / cancelled set into three user-facing states
-- plus cancelled. Existing rows (none yet — orders table has never
-- been written to from app code) would need remapping if present.
--
-- Also changes the default from 'draft' to 'pending' so new rows
-- land in the simplified set.

do $$
declare
  con text;
begin
  select constraint_name into con
  from information_schema.check_constraints
  where constraint_schema = 'public'
    and constraint_name like 'orders_status_check%'
  limit 1;
  if con is not null then
    execute format('alter table public.orders drop constraint %I', con);
  end if;
end$$;

alter table public.orders
  alter column status set default 'pending';

alter table public.orders
  add constraint orders_status_check
  check (status in ('pending', 'in_production', 'done', 'cancelled'));
