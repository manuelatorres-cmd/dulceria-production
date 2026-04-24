-- =============================================================
-- Dulceria Production Brain — Subscription templates + runs
-- Migration 0057
-- =============================================================
--
-- Q4 rollout. Each template is a recurring box (Spring box, Summer
-- box). Each `run` = one shipped cycle with subscriber_count +
-- contents + ship date. Subscriber count + content get filled in
-- once decided; brain schedules production backward from ship date.
-- =============================================================

create table if not exists public."subscriptionTemplates" (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  "packagingId" uuid references public.packaging(id) on delete set null,
  "pieceCount" integer not null default 8,
  frequency text not null default 'monthly'
    check (frequency in ('monthly', 'bimonthly', 'quarterly', 'seasonal')),
  active boolean not null default true,
  notes text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

alter table public."subscriptionTemplates" enable row level security;
drop policy if exists "authenticated_full_access" on public."subscriptionTemplates";
create policy "authenticated_full_access" on public."subscriptionTemplates"
  for all to authenticated using (true) with check (true);

create table if not exists public."subscriptionRuns" (
  id uuid primary key default gen_random_uuid(),
  "templateId" uuid not null references public."subscriptionTemplates"(id) on delete cascade,
  "scheduledShipDate" date not null,
  "subscriberCount" integer not null default 0,
  "selectedProductIds" uuid[] not null default '{}'::uuid[],
  status text not null default 'planned'
    check (status in ('planned', 'in-production', 'ready', 'shipped', 'cancelled')),
  "alertSentAt" timestamptz,
  "productionPlanIds" uuid[] not null default '{}'::uuid[],
  notes text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists subscription_runs_template_date_idx
  on public."subscriptionRuns" ("templateId", "scheduledShipDate" desc);

alter table public."subscriptionRuns" enable row level security;
drop policy if exists "authenticated_full_access" on public."subscriptionRuns";
create policy "authenticated_full_access" on public."subscriptionRuns"
  for all to authenticated using (true) with check (true);

do $$
declare tbl text;
begin
  for tbl in select unnest(array['subscriptionTemplates', 'subscriptionRuns'])
  loop
    execute format(
      'drop trigger if exists set_%s_updated_at on public.%I;',
      tbl,
      tbl
    );
    execute format(
      'create trigger set_%s_updated_at before update on public.%I
       for each row execute function public.set_updated_at();',
      tbl,
      tbl
    );
  end loop;
end$$;

-- =============================================================
-- End of 0057
-- =============================================================
