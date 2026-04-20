-- =============================================================
-- Dulceria Production — 4-location stock model
-- Migration 0016: stockLocations, stockMovements, stockLocationMinimums
-- =============================================================
--
-- Depends on 0001 (products, planProducts), 0002 (orders, stockMinimums),
-- and 0003 (RLS pattern).
--
-- What this migration introduces
--   Until now, a produced batch's remaining count lived in
--   planProducts.currentStock (non-frozen) + planProducts.frozenQty
--   (frozen). That is effectively a single virtual location with a
--   frozen/available split. The production planning spec (§6 of the
--   handover) requires FOUR physical locations:
--
--     store       — Physical Store (walk-in customers)
--     production  — Production Storage (default after unmoulding)
--     freezer     — Freezer (paused shelf life)
--     allocated   — Reserved for a specific order
--
--   This migration splits the batch count across those four locations
--   and records every movement between them.
--
-- Design
--   stockLocations          per-batch, per-location quantity (source of
--                           truth — the batch count is SUM(quantity)).
--                           'allocated' rows carry an orderId; the
--                           other three must not.
--   stockMovements          append-only audit log of every transfer
--                           (including external intake at unmould and
--                           external exit at sale/waste/discard).
--   stockLocationMinimums   per-product, per-location minimum stock
--                           level. Supersedes the channel-based
--                           stockMinimums from 0002 — the old table is
--                           kept for now (used elsewhere) and will be
--                           retired once the UI has fully migrated.
--
-- Backfill
--   One-time data backfill seeds stockLocations from the existing
--   planProducts numbers so reads don't go dark the moment this lands:
--     currentStock → production
--     frozenQty    → freezer
--   This is data preservation, not a business default, so it's exempt
--   from the "ship empty" house rule.
--
-- Not in this migration (on purpose)
--   - No triggers. Location totals are SUM'd in the app layer.
--   - No unique constraint on (planProductId, 'allocated', orderId)
--     uniqueness by NULLs — NULLs are distinct in Postgres but 0rderId
--     is NOT NULL on allocated rows (CHECK below), so the composite
--     key is deterministic for that location.
--   - currentStock / frozenQty remain on planProducts for this migration.
--     A follow-up will refactor reads to derive everything from
--     stockLocations and drop those columns.
-- =============================================================

-- ---------- Stock locations (per-batch, per-location) ----------

create table "stockLocations" (
  id               uuid primary key,
  "planProductId"  uuid not null references "planProducts"(id) on delete cascade,
  location         text not null
                   check (location in ('store','production','freezer','allocated')),
  -- Set only for location = 'allocated'. Enforced by the CHECK below.
  "orderId"        uuid references orders(id) on delete set null,
  quantity         integer not null default 0 check (quantity >= 0),
  "updatedAt"      timestamptz not null default now(),
  -- One row per (batch, location) — except 'allocated', which is one
  -- row per (batch, order) so a single batch can be split across
  -- multiple confirmed orders simultaneously.
  unique ("planProductId", location, "orderId"),
  check (
    (location = 'allocated' and "orderId" is not null) or
    (location <> 'allocated' and "orderId" is null)
  )
);
create index on "stockLocations" ("planProductId");
create index on "stockLocations" (location);
create index on "stockLocations" ("orderId");
-- "what's in store right now" — location filter + batch join
create index on "stockLocations" (location, quantity) where quantity > 0;

-- ---------- Stock movements (append-only audit log) ----------

create table "stockMovements" (
  id               uuid primary key,
  "planProductId"  uuid not null references "planProducts"(id) on delete cascade,
  "productId"      uuid not null references products(id) on delete restrict,
  -- null = external source (e.g. 'unmould' intake, 'initial' backfill).
  "fromLocation"   text
                   check ("fromLocation" in ('store','production','freezer','allocated')),
  -- null = external sink (e.g. sale, waste, discard — recorded in `reason`).
  "toLocation"     text
                   check ("toLocation" in ('store','production','freezer','allocated')),
  quantity         integer not null check (quantity > 0),
  "orderId"        uuid references orders(id) on delete set null,
  -- Free-text classification: 'unmould', 'freeze', 'defrost', 'transfer',
  -- 'allocate', 'unallocate', 'sold', 'waste', 'breakage', 'recount',
  -- 'initial_backfill'. Not a CHECK constraint — reasons are a UI
  -- concern and will grow over time.
  reason           text,
  -- Free-text name; becomes a users-table FK once auth adds multiple users.
  "movedBy"        text,
  notes            text,
  "movedAt"        timestamptz not null default now(),
  -- At least one of from/to must be set — a movement with both null is
  -- meaningless. (Intake: from=null. Sale: to=null. Transfer: both set.)
  check ("fromLocation" is not null or "toLocation" is not null)
);
create index on "stockMovements" ("planProductId");
create index on "stockMovements" ("productId", "movedAt" desc);
create index on "stockMovements" ("orderId");
create index on "stockMovements" ("movedAt" desc);

-- ---------- Per-location stock minimums ----------
--
-- Replaces the channel-based stockMinimums for the 4-location model.
-- The old table (0002) isn't dropped yet — it's still referenced in
-- other places — but new UI writes to this one. Default per §1 of
-- the handover: 10 units per product per location if no row is set.
-- That default is applied in the app layer, not here (ship empty).

create table "stockLocationMinimums" (
  id              uuid primary key,
  "productId"     uuid not null references products(id) on delete cascade,
  location        text not null
                  check (location in ('store','production','freezer','allocated')),
  "minimumUnits"  integer not null check ("minimumUnits" >= 0),
  "reorderPoint"  integer check ("reorderPoint" >= 0),
  notes           text,
  "updatedAt"     timestamptz not null default now(),
  unique ("productId", location)
);
create index on "stockLocationMinimums" ("productId");

-- =============================================================
-- Backfill: seed stockLocations from existing planProducts counts.
-- One-time; safe to re-run (guarded against duplicates via the
-- UNIQUE constraint on (planProductId, location, orderId)).
-- =============================================================

-- Production Storage: currentStock (falling back to actualYield) per
-- batch that isn't marked gone. Frozen pieces are excluded — they
-- seed the freezer row below.
insert into "stockLocations" (id, "planProductId", location, quantity, "updatedAt")
select
  gen_random_uuid(),
  pp.id,
  'production',
  coalesce(pp."currentStock", pp."actualYield", 0),
  now()
from "planProducts" pp
where coalesce(pp."stockStatus", '') <> 'gone'
  and coalesce(pp."currentStock", pp."actualYield", 0) > 0
on conflict ("planProductId", location, "orderId") do nothing;

-- Freezer: frozenQty per batch. Same eligibility rule (not 'gone').
insert into "stockLocations" (id, "planProductId", location, quantity, "updatedAt")
select
  gen_random_uuid(),
  pp.id,
  'freezer',
  pp."frozenQty",
  coalesce(to_timestamp(pp."frozenAt" / 1000.0), now())
from "planProducts" pp
where coalesce(pp."stockStatus", '') <> 'gone'
  and coalesce(pp."frozenQty", 0) > 0
on conflict ("planProductId", location, "orderId") do nothing;

-- Matching movement entries so the audit log reflects where the seed
-- came from (intake from an external source at migration time).
insert into "stockMovements" (id, "planProductId", "productId", "fromLocation", "toLocation", quantity, reason, "movedAt")
select
  gen_random_uuid(),
  sl."planProductId",
  pp."productId",
  null,
  sl.location,
  sl.quantity,
  'initial_backfill',
  sl."updatedAt"
from "stockLocations" sl
join "planProducts" pp on pp.id = sl."planProductId";

-- =============================================================
-- RLS: match the 0003 pattern — deny anon, allow authenticated full
-- access. Idempotent: drops any prior policy before recreating it.
-- =============================================================

do $$
declare
  t text;
  p text;
begin
  for t in
    select unnest(array['stockLocations','stockMovements','stockLocationMinimums'])
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
