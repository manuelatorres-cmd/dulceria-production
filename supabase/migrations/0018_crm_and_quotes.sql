-- =============================================================
-- Dulceria Production — B2B CRM + Quotes
-- Migration 0018: Phase 7 tables (customers, contacts, followups,
--                  quotes, orderBoxes) + orders.customerId link
-- =============================================================
--
-- Depends on 0002 (orders, orderItems), 0003 (RLS pattern).
--
-- What this migration introduces
--   customers            One row per B2B customer. Profile fields only —
--                        analytics (lifetime value, avg order value,
--                        frequency) are computed in the app from orders.
--   customerContacts     Append-only log of calls, emails, meetings.
--   customerFollowups    Manual + system-suggested reminder items, with
--                        an optional link back to a related contact or
--                        order.
--   quotes               B2B pricing work in progress. Lines and totals
--                        live in JSON (the shape evolves with the UI;
--                        normalising now would just slow iteration).
--                        Status lifecycle: draft → sent → won/lost/expired.
--                        `convertedToOrderId` is set when a quote is
--                        accepted and turned into an order.
--   orderBoxes           Breakdown of what products go into which
--                        packaging unit for a given order (handover §8.4
--                        "Box contents: specify which products go in
--                        which box"). One row per packaging unit; the
--                        actual piece list lives in `contentsJson`.
--   orders.customerId    Nullable FK so the orders table can link to a
--                        customer record. Existing rows keep their
--                        `customerName` text — no backfill.
--   orders.delivery...   type + date + address + notes to cover the
--                        "Delivery/collection per order" requirement.
--
-- Ships empty — no seeded customers. Manuela adds the six existing
-- B2B contacts herself after the migration lands (per the updated
-- brief: no pre-loading, the system starts empty on every install).
--
-- RLS: match the 0003 pattern — authenticated-only full access.
-- =============================================================

-- ---------- Customers ----------

create table customers (
  id              uuid primary key,
  "companyName"   text not null,
  "contactName"   text,
  email           text,
  phone           text,
  address         text,
  "vatNumber"     text,
  -- Free-form tags: "wholesale", "hotel", "pastry_shop", etc. Used for
  -- segmenting on the customer list page.
  tags            text[] not null default '{}',
  notes           text,
  archived        boolean not null default false,
  "createdAt"     timestamptz not null default now(),
  "updatedAt"     timestamptz not null default now()
);
create index on customers (archived);
create index on customers ("companyName");

-- ---------- Contact log ----------

create table "customerContacts" (
  id             uuid primary key,
  "customerId"   uuid not null references customers(id) on delete cascade,
  kind           text not null check (kind in ('call','email','meeting','note')),
  summary        text not null,
  -- Full body (email copy, meeting minutes) — stored separately from the
  -- one-liner so the log can render compactly while preserving details.
  body           text,
  "contactedAt"  timestamptz not null default now(),
  "loggedBy"     text,
  "createdAt"    timestamptz not null default now()
);
create index on "customerContacts" ("customerId", "contactedAt" desc);

-- ---------- Follow-ups ----------

create table "customerFollowups" (
  id             uuid primary key,
  "customerId"   uuid not null references customers(id) on delete cascade,
  "dueDate"      date not null,
  subject        text not null,
  notes          text,
  -- Optional links so a follow-up can reference a specific touchpoint.
  "relatedOrderId"   uuid references orders(id) on delete set null,
  "relatedContactId" uuid references "customerContacts"(id) on delete set null,
  -- 'manual' = created by the user, 'seasonal' = suggested by the
  -- seasonal-pattern detector based on prior-year order timing.
  origin         text not null default 'manual' check (origin in ('manual','seasonal')),
  "completedAt"  timestamptz,
  "createdAt"    timestamptz not null default now(),
  "updatedAt"    timestamptz not null default now()
);
create index on "customerFollowups" ("customerId");
-- "what's due" — open follow-ups sorted by dueDate
create index on "customerFollowups" ("dueDate") where "completedAt" is null;

-- ---------- Quotes ----------
--
-- Line items + totals live in JSON because the UI is still iterating
-- on the shape (box contents, labour estimate, per-filling rollup,
-- margin sliders). A future migration will split them into normalised
-- tables once the data model is stable.
--
-- `feasible` is a snapshot of the feasibility check at the moment the
-- quote was generated — scheduler state changes invalidate it, so the
-- UI re-runs the check when a quote is reopened.

create table quotes (
  id                 uuid primary key,
  "customerId"       uuid references customers(id) on delete set null,
  -- When customerId is null, this is a What-If quote — the UI lets you
  -- model a hypothetical order without committing to a customer.
  "isWhatIf"         boolean not null default false,
  title              text not null,
  status             text not null default 'draft'
                     check (status in ('draft','sent','won','lost','expired')),
  deadline           timestamptz,
  -- Line items: [{ productId, quantity, unitPrice, packagingId?, boxContents? }]
  "itemsJson"        jsonb not null default '[]'::jsonb,
  -- Cost breakdown snapshot at quote time.
  "costBreakdownJson" jsonb,
  -- Totals and margin math.
  "totalCost"        numeric(10,2),
  "sellPrice"        numeric(10,2),
  "marginPercent"    numeric(6,2),
  "labourHoursEstimate" numeric(6,2),
  "retailComparePct" numeric(6,2),
  -- Feasibility snapshot.
  feasible           boolean,
  "feasibilityNote"  text,
  "expiresAt"        timestamptz,
  "convertedToOrderId" uuid references orders(id) on delete set null,
  notes              text,
  "createdAt"        timestamptz not null default now(),
  "updatedAt"        timestamptz not null default now()
);
create index on quotes ("customerId");
create index on quotes (status);
create index on quotes ("expiresAt") where status in ('draft','sent');
create index on quotes ("createdAt" desc);

-- ---------- Order boxes (B2B box contents per order) ----------
--
-- For a B2B order that specifies "X boxes of packaging P, each
-- containing Y of product A + Z of product B", we record one row per
-- box-packaging line on the order. `contentsJson` carries the per-
-- product piece list:
--   [{ productId: "...", pieces: 4 }, { productId: "...", pieces: 5 }]
-- The app derives order totals by summing boxes × contents.

create table "orderBoxes" (
  id              uuid primary key,
  "orderId"       uuid not null references orders(id) on delete cascade,
  "packagingId"   uuid references packaging(id) on delete set null,
  quantity        integer not null check (quantity > 0),
  "priceOverride" numeric(10,2),
  "contentsJson"  jsonb not null default '[]'::jsonb,
  "sortOrder"     integer not null default 0,
  notes           text,
  "createdAt"     timestamptz not null default now(),
  "updatedAt"     timestamptz not null default now()
);
create index on "orderBoxes" ("orderId");

-- ---------- orders: link to customer + delivery/collection ----------

alter table orders
  add column if not exists "customerId" uuid references customers(id) on delete set null,
  add column if not exists "deliveryType" text
    check ("deliveryType" in ('pickup','delivery','ship')),
  add column if not exists "deliveryAt" timestamptz,
  add column if not exists "deliveryAddress" text,
  add column if not exists "deliveryNotes" text;
create index if not exists "orders_customerId_idx" on orders ("customerId");

-- ---------- capacityConfig: labour hourly rate for quote costing ----------
--
-- Handover §1: "Labour hourly rate — €15.00/hour, used in all cost and
-- margin calculations." Per the ship-empty house rule, no default is
-- committed — the Settings UI collects the value on first run. Nullable
-- so a partial first-run config is still internally consistent.

alter table "capacityConfig"
  add column if not exists "labourHourlyRate" numeric(8,2)
    check ("labourHourlyRate" is null or "labourHourlyRate" >= 0);

-- ---------- orderItems: unit price for CRM value rollups ----------
--
-- Enables lifetime-value + average-order-value analytics per customer.
-- Nullable — shop orders typically have no explicit price, so the app
-- falls back to the product's retail price for those items.

alter table "orderItems"
  add column if not exists "unitPrice" numeric(10,2)
    check ("unitPrice" is null or "unitPrice" >= 0);

-- =============================================================
-- RLS: authenticated-only full access for every new table.
-- =============================================================

do $$
declare
  t text;
  p text;
begin
  for t in
    select unnest(array['customers','customerContacts','customerFollowups','quotes','orderBoxes'])
  loop
    for p in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "authenticated_full_access" on public.%I ' ||
      'for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end$$;
