-- 0059_mould_broken_state.sql
-- Adds 'broken' to the mouldPool.currentState check constraint. A mould
-- can fracture mid-batch — the operator marks it broken so the pool
-- counter drops and the planner can't reassign it.

do $$
declare
  constraint_name text;
begin
  select tc.constraint_name into constraint_name
    from information_schema.check_constraints cc
    join information_schema.constraint_column_usage ccu
      on cc.constraint_name = ccu.constraint_name
    join information_schema.table_constraints tc
      on tc.constraint_name = cc.constraint_name
    where ccu.table_schema = 'public'
      and ccu.table_name = 'mouldPool'
      and ccu.column_name = 'currentState'
      and cc.check_clause ilike '%available%'
    limit 1;

  if constraint_name is not null then
    execute format('alter table public."mouldPool" drop constraint %I', constraint_name);
  end if;
end $$;

alter table public."mouldPool"
  add constraint "mouldPool_currentState_check"
  check ("currentState" in (
    'available',
    'loaded',
    'filled',
    'sealed',
    'needs-wash',
    'in-deep-wash',
    'retired',
    'broken'
  ));
