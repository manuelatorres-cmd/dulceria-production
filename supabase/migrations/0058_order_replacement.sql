-- 0058_order_replacement.sql
-- Replace + Credit flow. When an order ships broken / lost / complaint,
-- Manuela clones its items into a new order and stamps the original as
-- replaced. creditReference stores the HelloCash invoice number of the
-- credit note so the bookkeeper can tie them together.

alter table public.orders
  add column if not exists "replacesOrderId" uuid references public.orders(id) on delete set null,
  add column if not exists "replacementReason" text,
  add column if not exists "creditReference" text;

create index if not exists orders_replaces_order_idx
  on public.orders ("replacesOrderId")
  where "replacesOrderId" is not null;
