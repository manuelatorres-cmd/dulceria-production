-- =============================================================
-- Dulceria Production — fully custom production steps
-- Migration 0011: drop the fixed-phase productTypeStepDurations
--                 table, replace with free-text productionSteps
-- =============================================================
--
-- Depends on migration 0002 (productTypeStepDurations exists but
-- has never been written to from app code).
--
-- Decision (2026-04-20): steps are fully custom. Each product type
-- has its own ordered list of steps with free-text names. Step
-- names are reused across types via UI autocomplete, not enforced
-- at the DB level.
--
-- Ships empty per house rule. activeMinutes + waitingMinutes are
-- NOT NULL (the form gates on them) but have no defaults.

drop table if exists public."productTypeStepDurations";

create table public."productionSteps" (
  id               uuid primary key,
  "productType"    text not null,
  name             text not null,
  "activeMinutes"  numeric(8,2) not null check ("activeMinutes" >= 0),
  "waitingMinutes" numeric(8,2) not null check ("waitingMinutes" >= 0),
  "sortOrder"      integer not null,
  "createdAt"      timestamptz not null default now(),
  "updatedAt"      timestamptz not null default now(),
  unique ("productType", name)
);
create index on public."productionSteps" ("productType", "sortOrder");

alter table public."productionSteps" enable row level security;
create policy "authenticated_full_access" on public."productionSteps"
  for all to authenticated
  using (true) with check (true);
