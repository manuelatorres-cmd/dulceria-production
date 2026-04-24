-- =============================================================
-- Dulceria Production Brain — Phase 4 notifications + admin role
-- Migration 0054
-- =============================================================
--
-- Notification center (user-facing queue of non-urgent decisions)
-- plus admin-role toggle on people (restricts analytics, cost
-- breakdown, contamination/HACCP incident writes).
-- =============================================================

-- ─── 1) notifications ───────────────────────────────────────
-- One row per actionable suggestion / alert. Categories drive
-- icon + colour on the UI. Status tracks user response.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  "type" text not null
    check ("type" in (
      'tier_change',
      'surplus_routing',
      'ingredient_late',
      'ingredient_shortage',
      'ingredient_price_change',
      'campaign_conflict',
      'campaign_ingredient_advance',
      'filling_precook',
      'filling_expiry_warning',
      'transfer_proposal',
      'stock_dip',
      'near_expiry',
      'markdown_suggestion',
      'tasting_allocation',
      'replenishment_proposal',
      'haccp_incident_open',
      'contamination_flag',
      'machine_aging',
      'mould_deep_wash',
      'overtime_warning',
      'quote_expiring',
      'subscription_cycle_reminder',
      'capacity_risk',
      'rush_impossible',
      'replacement_issued',
      'other'
    )),
  urgency text not null default 'normal'
    check (urgency in ('critical', 'high', 'normal', 'low')),
  status text not null default 'open'
    check (status in ('open', 'snoozed', 'approved', 'dismissed', 'expired')),
  title text not null,
  body text,
  "entityType" text,
  "entityId" uuid,
  "snoozedUntil" timestamptz,
  "approvedAt" timestamptz,
  "dismissedAt" timestamptz,
  "approvedByPersonId" uuid references public.people(id) on delete set null,
  "adminOnly" boolean not null default false,
  "actionLabel" text,
  "actionPayload" jsonb,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists notifications_status_urgency_idx
  on public.notifications (status, urgency, "createdAt" desc);
create index if not exists notifications_entity_idx
  on public.notifications ("entityType", "entityId");

alter table public.notifications enable row level security;
drop policy if exists "authenticated_full_access" on public.notifications;
create policy "authenticated_full_access" on public.notifications
  for all to authenticated using (true) with check (true);


-- ─── 2) people — isAdmin flag ───────────────────────────────
-- Admin-only UI surfaces: analytics + cost breakdown + contamination
-- + HACCP writes. Non-admin staff still see operational banners (e.g.
-- "do not ship this batch") but can't close incidents.
alter table public.people
  add column if not exists "isAdmin" boolean not null default false;


-- ─── 3) touch trigger for notifications ─────────────────────
do $$
begin
  perform 1
  from pg_trigger
  where tgname = 'set_notifications_updated_at';
  if not found then
    execute '
      create trigger set_notifications_updated_at
        before update on public.notifications
        for each row execute function public.set_updated_at();
    ';
  end if;
end$$;


-- =============================================================
-- End of 0054 — production-brain phase 4
-- =============================================================
