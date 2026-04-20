-- =============================================================
-- Dulceria Production — initial Postgres schema
-- Migration 0001: tables, columns, indexes, foreign keys
-- =============================================================
--
-- What this is:
--   1:1 port of the current Dexie/IndexedDB schema (the upstream app v6)
--   into Supabase Postgres. Table + column names are kept in
--   camelCase and double-quoted so the TypeScript type names in
--   src/types/index.ts map straight through without a translation
--   layer.
--
-- Conventions:
--   Primary keys: uuid, generated client-side via crypto.randomUUID
--     (matches existing app code in src/lib/db.ts#newId).
--   Timestamps stored as Date objects in Dexie -> timestamptz here.
--   Epoch-millisecond fields (e.g. FillingStock.createdAt) -> bigint.
--   JSON-encoded strings (fillingOverrides, breakdown, etc.) -> jsonb.
--   String arrays (allergens, tags) -> text[].
--   Percentages + costs -> numeric (no float drift).
--   Foreign keys: ON DELETE RESTRICT by default, CASCADE only where
--     the child row has no meaning without its parent (join tables).
--
-- NOT in this migration (intentional — to be reviewed separately):
--   Row-Level Security policies. RLS is DISABLED on every table for
--     now so the data-migration script can bulk-load existing
--     the upstream app backup JSON without auth gymnastics. Migration 0003
--     will enable RLS and wire in Supabase Auth (single shared
--     workspace for Manuela + partner).
--   Seed data of ANY kind, and business-value defaults on columns.
--     House rule (2026-04-19): the app ships empty and the Settings
--     UI collects every configurable value on first run — capacity,
--     step durations, thresholds, equipment, etc. That keeps the
--     codebase reusable by a different chocolatier from scratch.
--     The one-shot import of existing Dulceria data (26 products /
--     36 fillings / 51 ingredients) is a separate user-run script,
--     not part of this SQL.
--   Triggers for updatedAt — left to the app layer for v1 to keep
--     the schema reviewable. Can be added later if drift shows up.
-- =============================================================

create extension if not exists "pgcrypto";

-- ---------- Reference / lookup tables (no FKs) ----------

-- Single-row preferences. marketRegion / currency / defaultFillMode are
-- user-answered on first run (Settings -> Preferences); nullable here so the
-- row can exist before they are chosen. The array fields default to '{}'
-- structurally (empty list of facility allergens / coating names).
create table "userPreferences" (
  id                   uuid primary key,
  "marketRegion"       text,
  currency             text,
  "defaultFillMode"    text,
  "facilityMayContain" text[] not null default '{}',
  coatings             text[] not null default '{}',
  "updatedAt"          timestamptz not null default now()
);

create table "productCategories" (
  id                    uuid primary key,
  name                  text not null,
  "shellPercentMin"     numeric(5,2) not null,
  "shellPercentMax"     numeric(5,2) not null,
  "defaultShellPercent" numeric(5,2) not null,
  archived              boolean not null default false,
  "createdAt"           timestamptz not null default now(),
  "updatedAt"           timestamptz not null default now()
);
create index on "productCategories" (archived);

create table "ingredientCategories" (
  id          uuid primary key,
  name        text not null,
  archived    boolean not null default false,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table "fillingCategories" (
  id            uuid primary key,
  name          text not null,
  "shelfStable" boolean not null default false,
  archived      boolean not null default false,
  "createdAt"   timestamptz not null default now(),
  "updatedAt"   timestamptz not null default now()
);

create table "decorationCategories" (
  id          uuid primary key,
  name        text not null,
  slug        text not null unique,
  archived    boolean not null default false,
  "createdAt" timestamptz,
  "updatedAt" timestamptz
);

create table "shellDesigns" (
  id               uuid primary key,
  name             text not null,
  "defaultApplyAt" text,
  archived         boolean not null default false,
  "createdAt"      timestamptz,
  "updatedAt"      timestamptz
);

-- ---------- Core catalogue ----------

create table ingredients (
  id                    uuid primary key,
  name                  text not null,
  manufacturer          text not null default '',
  brand                 text,
  vendor                text,
  source                text not null default '',
  -- legacy; superseded by purchaseCost/purchaseQty/gramsPerUnit, kept so v1 backups import verbatim
  cost                  numeric(12,4) not null default 0,
  notes                 text not null default '',
  -- links to "ingredientCategories".name by convention (no FK — name is the join key in TS)
  category              text,
  commercialName        text,
  "purchaseCost"        numeric(12,4),
  -- stored as ISO date string in the TS type, not a pg date
  "purchaseDate"        text,
  "purchaseQty"         numeric(12,4),
  "purchaseUnit"        text,
  "gramsPerUnit"        numeric(12,4),
  "cacaoFat"            numeric(5,2) not null default 0,
  sugar                 numeric(5,2) not null default 0,
  "milkFat"             numeric(5,2) not null default 0,
  water                 numeric(5,2) not null default 0,
  solids                numeric(5,2) not null default 0,
  "otherFats"           numeric(5,2) not null default 0,
  alcohol               numeric(5,2),
  allergens             text[] not null default '{}',
  archived              boolean not null default false,
  "pricingIrrelevant"   boolean not null default false,
  "shellCapable"        boolean not null default false,
  "lowStock"            boolean not null default false,
  "lowStockSince"       bigint,
  "lowStockOrdered"     boolean not null default false,
  "outOfStock"          boolean not null default false,
  nutrition             jsonb,
  "updatedAt"           timestamptz
);
create index on ingredients (name);
create index on ingredients (category);
create index on ingredients (archived);

create table moulds (
  id                      uuid primary key,
  name                    text not null,
  "productNumber"         text,
  brand                   text,
  "cavityWeightG"         numeric(10,3) not null,
  "numberOfCavities"      integer not null,
  "fillingGramsPerCavity" numeric(10,3),
  "quantityOwned"         integer,
  photo                   text,
  notes                   text,
  archived                boolean not null default false
);
create index on moulds (name);

create table products (
  id                  uuid primary key,
  name                text not null,
  photo               text,
  popularity          integer,
  "productCategoryId" uuid references "productCategories"(id) on delete restrict,
  "shellIngredientId" uuid references ingredients(id) on delete restrict,
  "shellPercentage"   numeric(5,2),
  "fillMode"          text,
  coating             text,
  -- legacy free-text type string, kept so pre-v2 backups import verbatim (superseded by productCategoryId)
  "productType"       text,
  tags                text[] not null default '{}',
  notes               text,
  "shelfLifeWeeks"    text,
  "lowStockThreshold" integer,
  "stockCountedAt"    bigint,
  "defaultMouldId"    uuid references moulds(id) on delete restrict,
  "defaultBatchQty"   integer,
  -- ShellDesignStep[] — see src/types/index.ts for the shape
  "shellDesign"       jsonb,
  -- Per-product override of productTypeStepDurations. Shape: { phase: durationMinutes }.
  -- Null = use productType defaults. Only set for products that deviate from their type.
  "stepDurationOverrides" jsonb,
  vegan               boolean,
  archived            boolean not null default false,
  "createdAt"         timestamptz not null default now(),
  "updatedAt"         timestamptz not null default now()
);
create index on products (name);
create index on products ("productCategoryId");
create index on products ("defaultMouldId");
create index on products ("shellIngredientId");

create table fillings (
  id               uuid primary key,
  name             text not null,
  category         text not null,
  subcategory      text,
  source           text not null default '',
  description      text not null default '',
  allergens        text[] not null default '{}',
  instructions     text not null default '',
  status           text,
  "shelfLifeWeeks" integer,
  "rootId"         uuid references fillings(id) on delete set null,
  version          integer,
  "versionNotes"   text,
  "createdAt"      timestamptz,
  "supersededAt"   timestamptz,
  archived         boolean not null default false
);
create index on fillings (name);
create index on fillings (category);
create index on fillings ("rootId");

-- ---------- Join + history tables ----------

create table "productFillings" (
  id               uuid primary key,
  "productId"      uuid not null references products(id) on delete cascade,
  "fillingId"      uuid not null references fillings(id) on delete restrict,
  "sortOrder"      integer not null default 0,
  "fillPercentage" numeric(5,2) not null default 0,
  "fillGrams"      numeric(10,3)
);
create index on "productFillings" ("productId");
create index on "productFillings" ("fillingId");

create table "fillingIngredients" (
  id             uuid primary key,
  "fillingId"    uuid not null references fillings(id) on delete cascade,
  "ingredientId" uuid not null references ingredients(id) on delete restrict,
  amount         numeric(12,4) not null default 0,
  -- Unit is required per row (amount is meaningless without it) but not
  -- assumed — no metric-vs-imperial default. The app must send it, picking
  -- from the user's configured unit list.
  unit           text not null,
  "sortOrder"    integer,
  note           text
);
create index on "fillingIngredients" ("fillingId");
create index on "fillingIngredients" ("ingredientId");

create table "productFillingHistory" (
  id                    uuid primary key,
  "productId"           uuid not null references products(id) on delete cascade,
  "fillingId"           uuid not null references fillings(id) on delete restrict,
  "replacedByFillingId" uuid not null references fillings(id) on delete restrict,
  "fillPercentage"      numeric(5,2) not null,
  "sortOrder"           integer not null,
  "replacedAt"          timestamptz not null
);
create index on "productFillingHistory" ("productId");

create table "ingredientPriceHistory" (
  id             uuid primary key,
  "ingredientId" uuid not null references ingredients(id) on delete cascade,
  "costPerGram"  numeric(16,8) not null,
  "recordedAt"   timestamptz not null,
  "purchaseCost" numeric(12,4),
  "purchaseQty"  numeric(12,4),
  "purchaseUnit" text,
  "gramsPerUnit" numeric(12,4),
  note           text
);
create index on "ingredientPriceHistory" ("ingredientId", "recordedAt" desc);

create table "coatingChocolateMappings" (
  id              uuid primary key,
  "coatingName"   text not null,
  "ingredientId"  uuid not null references ingredients(id) on delete restrict,
  "effectiveFrom" timestamptz not null,
  note            text,
  "seedTempering" boolean
);
create index on "coatingChocolateMappings" ("coatingName", "effectiveFrom" desc);

create table "productCostSnapshots" (
  id               uuid primary key,
  "productId"      uuid not null references products(id) on delete cascade,
  "costPerProduct" numeric(12,4) not null,
  breakdown        jsonb not null,
  "recordedAt"     timestamptz not null,
  "triggerType"    text not null,
  "triggerDetail"  text not null,
  "mouldId"        uuid references moulds(id) on delete set null,
  "coatingName"    text
);
create index on "productCostSnapshots" ("productId", "recordedAt" desc);

-- ---------- Production plans ----------

create table "productionPlans" (
  id                       uuid primary key,
  "batchNumber"            text,
  name                     text not null,
  "createdAt"              timestamptz not null default now(),
  "updatedAt"              timestamptz not null default now(),
  "completedAt"            timestamptz,
  status                   text not null default 'draft'
                           check (status in ('draft','active','done')),
  notes                    text,
  "fillingOverrides"       jsonb,
  "fillingPreviousBatches" jsonb,
  "batchSummary"           text
);
create index on "productionPlans" (status);
create index on "productionPlans" ("batchNumber");

create table "planProducts" (
  id                       uuid primary key,
  "planId"                 uuid not null references "productionPlans"(id) on delete cascade,
  "productId"              uuid not null references products(id) on delete restrict,
  "mouldId"                uuid not null references moulds(id) on delete restrict,
  quantity                 integer not null,
  "sortOrder"              integer not null default 0,
  notes                    text,
  "stockStatus"            text check ("stockStatus" in ('low','gone')),
  "actualYield"            integer,
  "currentStock"           integer,
  "frozenQty"              integer,
  "frozenAt"               bigint,
  "preservedShelfLifeDays" integer,
  "defrostedAt"            bigint
);
create index on "planProducts" ("planId");
create index on "planProducts" ("productId");

create table "planStepStatus" (
  id        uuid primary key,
  "planId"  uuid not null references "productionPlans"(id) on delete cascade,
  "stepKey" text not null,
  done      boolean not null default false,
  "doneAt"  timestamptz,
  unique ("planId", "stepKey")
);

create table "fillingStock" (
  id                       uuid primary key,
  "fillingId"              uuid not null references fillings(id) on delete restrict,
  "remainingG"             numeric(10,3) not null,
  "planId"                 uuid references "productionPlans"(id) on delete set null,
  -- stored as ISO date string in the TS type, not a pg date
  "madeAt"                 text not null,
  notes                    text,
  -- Date.now() in ms per the TS type, so stored as bigint rather than timestamptz
  "createdAt"              bigint not null,
  frozen                   boolean not null default false,
  "frozenAt"               bigint,
  "preservedShelfLifeDays" integer,
  "defrostedAt"            bigint
);
create index on "fillingStock" ("fillingId");
create index on "fillingStock" ("planId");

-- ---------- Experiments (Product Lab) ----------

create table experiments (
  id                  uuid primary key,
  name                text not null,
  "ganacheType"       text check ("ganacheType" in ('dark','milk','white')),
  "applicationType"   text check ("applicationType" in ('moulded','coated')),
  notes               text,
  "sourceFillingId"   uuid references fillings(id) on delete set null,
  "rootId"            uuid references experiments(id) on delete set null,
  version             integer,
  "supersededAt"      timestamptz,
  status              text check (status in ('to_improve','promoted')),
  "promotedFillingId" uuid references fillings(id) on delete set null,
  "tasteFeedback"     integer,
  "textureFeedback"   integer,
  "batchNotes"        text,
  "createdAt"         timestamptz not null default now(),
  "updatedAt"         timestamptz not null default now()
);
create index on experiments ("rootId");

create table "experimentIngredients" (
  id             uuid primary key,
  "experimentId" uuid not null references experiments(id) on delete cascade,
  "ingredientId" uuid not null references ingredients(id) on delete restrict,
  amount         numeric(12,4) not null,
  "sortOrder"    integer
);
create index on "experimentIngredients" ("experimentId");

-- ---------- Packaging + shopping ----------

create table packaging (
  id                uuid primary key,
  name              text not null,
  capacity          integer not null,
  manufacturer      text,
  notes             text,
  "createdAt"       timestamptz not null default now(),
  "updatedAt"       timestamptz not null default now(),
  archived          boolean not null default false,
  "lowStock"        boolean not null default false,
  "lowStockSince"   bigint,
  "lowStockOrdered" boolean not null default false,
  "outOfStock"      boolean not null default false
);

create table "packagingOrders" (
  id             uuid primary key,
  "packagingId"  uuid not null references packaging(id) on delete cascade,
  quantity       integer not null,
  "pricePerUnit" numeric(12,4) not null,
  supplier       text,
  "orderedAt"    timestamptz not null,
  notes          text
);
create index on "packagingOrders" ("packagingId", "orderedAt" desc);

create table "shoppingItems" (
  id          uuid primary key,
  name        text not null,
  category    text,
  note        text,
  "addedAt"   bigint not null,
  "orderedAt" bigint
);

-- ---------- Collections ----------

create table collections (
  id          uuid primary key,
  name        text not null,
  description text,
  "startDate" text not null,
  "endDate"   text,
  notes       text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table "collectionProducts" (
  id             uuid primary key,
  "collectionId" uuid not null references collections(id) on delete cascade,
  "productId"    uuid not null references products(id) on delete restrict,
  "sortOrder"    integer not null default 0
);
create index on "collectionProducts" ("collectionId");

create table "collectionPackagings" (
  id             uuid primary key,
  "collectionId" uuid not null references collections(id) on delete cascade,
  "packagingId"  uuid not null references packaging(id) on delete restrict,
  "sellPrice"    numeric(12,4) not null,
  notes          text,
  "createdAt"    timestamptz not null default now(),
  "updatedAt"    timestamptz not null default now()
);
create index on "collectionPackagings" ("collectionId");

create table "collectionPricingSnapshots" (
  id                  uuid primary key,
  "collectionId"      uuid not null references collections(id) on delete cascade,
  "packagingId"       uuid not null references packaging(id) on delete restrict,
  "avgProductCost"    numeric(12,4) not null,
  "packagingUnitCost" numeric(12,4) not null,
  "totalCost"         numeric(12,4) not null,
  "sellPrice"         numeric(12,4) not null,
  "marginPercent"     numeric(6,3) not null,
  "recordedAt"        timestamptz not null,
  "triggerType"       text not null,
  "triggerDetail"     text not null
);
create index on "collectionPricingSnapshots" ("collectionId", "recordedAt" desc);

-- ---------- Decoration ----------

create table "decorationMaterials" (
  id                uuid primary key,
  name              text not null,
  -- matches "decorationCategories".slug (no FK — slug is the join key in TS)
  type              text not null,
  "cocoaButterType" text,
  color             text,
  manufacturer      text,
  vendor            text,
  source            text,
  notes             text,
  "lowStock"        boolean not null default false,
  "lowStockSince"   bigint,
  "lowStockOrdered" boolean not null default false,
  "outOfStock"      boolean not null default false,
  archived          boolean not null default false,
  "createdAt"       timestamptz,
  "updatedAt"       timestamptz
);
create index on "decorationMaterials" (type);

-- =============================================================
-- Open questions (not blocking this migration, but next up):
--   1. Auth: Supabase email-magic-link for Manuela + partner, or
--      a single shared login? Drives the RLS policy shape.
--   2. Storage: product photos are stored as base64 in the `photo`
--      column today. Keep inline, or move to Supabase Storage and
--      replace with a public URL? Moving reduces row size + egress
--      but adds an upload step in the UI.
--   3. Import cutover: one-shot script reads the existing
--      the upstream app JSON backup and bulk-loads every table above,
--      preserving UUIDs so foreign keys line up. That script is
--      the deliverable immediately after this migration lands.
-- =============================================================
