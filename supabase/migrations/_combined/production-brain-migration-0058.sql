-- production-brain-migration-0058.sql
-- Paste this into Supabase SQL editor.
-- Matches /supabase/migrations/0058_order_replacement.sql

alter table public.orders
  add column if not exists "replacesOrderId" uuid references public.orders(id) on delete set null,
  add column if not exists "replacementReason" text,
  add column if not exists "creditReference" text;

create index if not exists orders_replaces_order_idx
  on public.orders ("replacesOrderId")
  where "replacesOrderId" is not null;
