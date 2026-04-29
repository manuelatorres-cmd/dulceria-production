-- 0065_campaign_type_market_event.sql
-- Allow `campaigns.type = 'market_event'` (booth / fair / pop-up
-- where Manuela sells in person). The TS enum was widened in code
-- but the DB check constraint still rejected the new value.
--
-- Drop the old constraint (whatever it's currently named) and re-
-- create with the full set. Idempotent.

do $$
declare
  cname text;
begin
  select tc.constraint_name into cname
    from information_schema.check_constraints cc
    join information_schema.constraint_column_usage ccu
      on cc.constraint_name = ccu.constraint_name
    join information_schema.table_constraints tc
      on tc.constraint_name = cc.constraint_name
   where ccu.table_schema = 'public'
     and ccu.table_name = 'campaigns'
     and ccu.column_name = 'type'
   limit 1;

  if cname is not null then
    execute format('alter table public.campaigns drop constraint %I', cname);
  end if;
end $$;

alter table public.campaigns
  add constraint campaigns_type_check
  check (type in (
    'seasonal',
    'limited',
    'collaboration',
    'launch',
    'market_event'
  ));

notify pgrst, 'reload schema';
