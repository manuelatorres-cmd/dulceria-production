-- =============================================================
-- Dulceria Production — ensure orders.status uses the simplified set
-- Migration 0028: idempotent re-application of 0012's check
-- =============================================================
--
-- Symptom: creating an order fails with
--   23514 "new row for relation orders violates check constraint
--   orders_status_check"
--
-- The app writes status='pending', but the DB still carries the
-- original 0002 check constraint which only allows
--   ('draft','confirmed','in_production','ready','delivered','cancelled')
-- Migration 0012 was supposed to replace it with the simplified set
--   ('pending','in_production','done','cancelled')
-- but never ran on this project.
--
-- This migration repeats 0012 defensively: drops every check
-- constraint whose name starts with `orders_status_check`, normalises
-- any existing legacy status values, sets the default to 'pending',
-- and installs the simplified check.
--
-- Idempotent: safe to re-run on any database state.
-- =============================================================

-- Drop any leftover status checks (0002 may have created one,
-- 0012 may have dropped + recreated, 0028 may have replaced).
do $$
declare
  con text;
begin
  for con in
    select constraint_name
    from information_schema.check_constraints
    where constraint_schema = 'public'
      and constraint_name like 'orders_status_check%'
  loop
    execute format('alter table public.orders drop constraint %I', con);
  end loop;
end$$;

-- Normalise any existing rows whose status wouldn't pass the new
-- check. The app never wrote 'draft' / 'confirmed' / 'ready' /
-- 'delivered' via the current codebase, but migrations can replay
-- on environments with legacy data.
update public.orders set status = 'pending'        where status = 'draft';
update public.orders set status = 'pending'        where status = 'confirmed';
update public.orders set status = 'done'           where status = 'ready';
update public.orders set status = 'done'           where status = 'delivered';

-- Default + check.
alter table public.orders
  alter column status set default 'pending';

alter table public.orders
  add constraint orders_status_check
  check (status in ('pending', 'in_production', 'done', 'cancelled'));
