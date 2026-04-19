import { supabase, newId } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";

const BACKUP_VERSION = 1;

export interface BackupData {
  version: number;
  exportedAt: string;
  ingredients: unknown[];
  products: unknown[];
  productCategories?: unknown[];
  fillings: unknown[];
  productFillings: unknown[];
  fillingIngredients: unknown[];
  moulds: unknown[];
  productionPlans: unknown[];
  planProducts: unknown[];
  planStepStatus: unknown[];
  settings?: unknown[];
  userPreferences?: unknown[];
  productFillingHistory?: unknown[];
  ingredientPriceHistory?: unknown[];
  productCostSnapshots?: unknown[];
  packaging?: unknown[];
  packagingOrders?: unknown[];
  decorationMaterials?: unknown[];
  decorationCategories?: unknown[];
  shellDesigns?: unknown[];
  experiments?: unknown[];
  experimentIngredients?: unknown[];
  shoppingItems?: unknown[];
  collections?: unknown[];
  collectionProducts?: unknown[];
  collectionPackagings?: unknown[];
  collectionPricingSnapshots?: unknown[];
  fillingStock?: unknown[];
  fillingCategories?: unknown[];
  ingredientCategories?: unknown[];

  // --- Legacy key compat (older backups written before the Product/Filling rename) ---
  // These are accepted on import and remapped to the new tables above.
  recipes?: unknown[];
  layers?: unknown[];
  recipeLayers?: unknown[];
  layerIngredients?: unknown[];
  planBonbons?: unknown[];
  recipeLayerHistory?: unknown[];
  recipeCostSnapshots?: unknown[];
  collectionRecipes?: unknown[];
  layerStock?: unknown[];
}

// All Supabase tables included in the backup payload, in export order.
// Insert order (import) is the reverse of the delete order inside importBackup.
const EXPORT_TABLES = [
  "ingredients",
  "products",
  "productCategories",
  "fillings",
  "productFillings",
  "fillingIngredients",
  "moulds",
  "productionPlans",
  "planProducts",
  "planStepStatus",
  "userPreferences",
  "productFillingHistory",
  "ingredientPriceHistory",
  "productCostSnapshots",
  "packaging",
  "packagingOrders",
  "decorationMaterials",
  "decorationCategories",
  "shellDesigns",
  "experiments",
  "experimentIngredients",
  "shoppingItems",
  "collections",
  "collectionProducts",
  "collectionPackagings",
  "collectionPricingSnapshots",
  "fillingStock",
  "fillingCategories",
  "ingredientCategories",
] as const;

export async function exportBackup(): Promise<void> {
  const results = await Promise.all(
    EXPORT_TABLES.map((name) =>
      supabase.from(name).select("*").then((r) => assertOk(r) as unknown[]),
    ),
  );
  const rowsByName: Record<string, unknown[]> = {};
  EXPORT_TABLES.forEach((name, i) => {
    rowsByName[name] = results[i];
  });

  const backup: BackupData = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    ingredients: rowsByName.ingredients,
    products: rowsByName.products,
    productCategories: rowsByName.productCategories,
    fillings: rowsByName.fillings,
    productFillings: rowsByName.productFillings,
    fillingIngredients: rowsByName.fillingIngredients,
    moulds: rowsByName.moulds,
    productionPlans: rowsByName.productionPlans,
    planProducts: rowsByName.planProducts,
    planStepStatus: rowsByName.planStepStatus,
    settings: [],
    userPreferences: rowsByName.userPreferences,
    productFillingHistory: rowsByName.productFillingHistory,
    ingredientPriceHistory: rowsByName.ingredientPriceHistory,
    productCostSnapshots: rowsByName.productCostSnapshots,
    packaging: rowsByName.packaging,
    packagingOrders: rowsByName.packagingOrders,
    decorationMaterials: rowsByName.decorationMaterials,
    decorationCategories: rowsByName.decorationCategories,
    shellDesigns: rowsByName.shellDesigns,
    experiments: rowsByName.experiments,
    experimentIngredients: rowsByName.experimentIngredients,
    shoppingItems: rowsByName.shoppingItems,
    collections: rowsByName.collections,
    collectionProducts: rowsByName.collectionProducts,
    collectionPackagings: rowsByName.collectionPackagings,
    collectionPricingSnapshots: rowsByName.collectionPricingSnapshots,
    fillingStock: rowsByName.fillingStock,
    fillingCategories: rowsByName.fillingCategories,
    ingredientCategories: rowsByName.ingredientCategories,
  };

  const json = JSON.stringify(backup, (_key, value) => value ?? undefined);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const date = new Date().toISOString().slice(0, 10);
  const a = document.createElement("a");
  a.href = url;
  a.download = `choc-collab-backup-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Insert order: parents (lookup/leaf tables) first, middle tables, then
// child tables with FKs into other tables. Each row's FK targets exist by
// the time its upsert runs. Mirrors the delete order (reversed) inside the
// `clear_all_data()` RPC in migration 0004.
const INSERT_ORDER = [
  // Phase 3 — leaf / lookup tables (no outbound FKs into migratable tables)
  "shoppingItems",
  "userPreferences",
  "moulds",
  "ingredients",
  "productCategories",
  "ingredientCategories",
  "fillingCategories",
  "decorationCategories",
  // Phase 2 — middle tables
  "shellDesigns",
  "decorationMaterials",
  "packaging",
  "collections",
  "products",
  "fillings",
  "experiments",
  // Phase 1 — child tables (FKs into the tables above)
  "packagingOrders",
  "productionPlans",
  "fillingStock",
  "planProducts",
  "planStepStatus",
  "experimentIngredients",
  "productFillings",
  "fillingIngredients",
  "productFillingHistory",
  "ingredientPriceHistory",
  "productCostSnapshots",
  "collectionProducts",
  "collectionPackagings",
  "collectionPricingSnapshots",
] as const;

/** Map of table name -> the imported rows for that table. */
type ImportPayload = Partial<Record<(typeof INSERT_ORDER)[number], Record<string, unknown>[]>>;

async function bulkUpsert(table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  // Chunk so large backups don't exceed Supabase's per-request payload size.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from(table).upsert(slice, { onConflict: "id" });
    if (error) throw error;
  }
}

export async function clearAllData(): Promise<void> {
  // Atomic server-side wipe (migration 0004). One round-trip, all-or-nothing.
  const { error } = await supabase.rpc("clear_all_data");
  if (error) throw error;
  // Prevent the client-side "first run" path from re-seeding on next visit.
  localStorage.setItem("chocolatier-seeded", "true");
}

// --- Legacy-field migrators (applied on import so old Recipe/Layer/Bonbon backups keep working) ---

type AnyRec = Record<string, unknown>;

function renameField<T extends AnyRec>(obj: T, oldKey: string, newKey: string): T {
  if (obj && oldKey in obj && !(newKey in obj)) {
    const { [oldKey]: value, ...rest } = obj as AnyRec;
    return { ...rest, [newKey]: value } as T;
  }
  return obj;
}

function migrateProduct(r: AnyRec): AnyRec {
  return renameField(r, "bonbonType", "productType");
}

function migrateProductFilling(r: AnyRec): AnyRec {
  let out = renameField(r, "recipeId", "productId");
  out = renameField(out, "layerId", "fillingId");
  return out;
}

function migrateFillingIngredient(r: AnyRec): AnyRec {
  return renameField(r, "layerId", "fillingId");
}

function migratePlanProduct(r: AnyRec): AnyRec {
  return renameField(r, "recipeId", "productId");
}

function migrateProductFillingHistory(r: AnyRec): AnyRec {
  let out = renameField(r, "recipeId", "productId");
  out = renameField(out, "layerId", "fillingId");
  out = renameField(out, "replacedByLayerId", "replacedByFillingId");
  return out;
}

function migrateProductCostSnapshot(r: AnyRec): AnyRec {
  let out = renameField(r, "recipeId", "productId");
  out = renameField(out, "costPerBonbon", "costPerProduct");
  // Translate trigger type and breakdown JSON in-place
  if (typeof out.triggerType === "string" && out.triggerType === "layer_version") {
    out = { ...out, triggerType: "filling_version" };
  }
  if (typeof out.breakdown === "string") {
    try {
      const entries = JSON.parse(out.breakdown as string) as AnyRec[];
      const migrated = entries.map(e => {
        let m = { ...e };
        if (m.kind === "layer_ingredient") m.kind = "filling_ingredient";
        m = renameField(m, "layerId", "fillingId");
        return m;
      });
      out = { ...out, breakdown: JSON.stringify(migrated) };
    } catch {
      // leave unchanged if not parseable
    }
  }
  return out;
}

function migrateCollectionProduct(r: AnyRec): AnyRec {
  return renameField(r, "recipeId", "productId");
}

function migrateCollectionPricingSnapshot(r: AnyRec): AnyRec {
  return renameField(r, "avgBonbonCost", "avgProductCost");
}

function migrateFillingStock(r: AnyRec): AnyRec {
  return renameField(r, "layerId", "fillingId");
}

function migrateProductionPlan(r: AnyRec): AnyRec {
  let out = renameField(r, "layerOverrides", "fillingOverrides");
  out = renameField(out, "layerPreviousBatches", "fillingPreviousBatches");
  return out;
}

function migrateExperiment(r: AnyRec): AnyRec {
  let out = renameField(r, "sourceLayerId", "sourceFillingId");
  out = renameField(out, "promotedLayerId", "promotedFillingId");
  return out;
}

function applyAll(rows: unknown[] | undefined, fn: (r: AnyRec) => AnyRec): AnyRec[] {
  if (!rows) return [];
  return rows.map(r => fn((r ?? {}) as AnyRec));
}

/** Strip keys we don't want to forward to Supabase (e.g. residual legacy fields
 *  that aren't in the new schema). Keeps unknown keys by default — the app's schema
 *  tolerates extra columns being named in the TS types but not sent. */
function passThrough(rows: unknown[] | undefined): AnyRec[] {
  if (!rows) return [];
  return rows.map(r => (r ?? {}) as AnyRec);
}

export async function importBackup(file: File): Promise<void> {
  const text = await file.text();
  const data: BackupData = JSON.parse(text);

  if (!data.version || !data.exportedAt) {
    throw new Error("Invalid backup file: missing version or exportedAt.");
  }
  if (data.version !== BACKUP_VERSION) {
    throw new Error(`Unsupported backup version ${data.version}. Expected ${BACKUP_VERSION}.`);
  }

  // Prefer new keys, fall back to legacy keys from pre-rename backups.
  const rawIngredients             = data.ingredients             ?? [];
  const rawProductCategories       = data.productCategories       ?? [];
  const rawProducts                = data.products                ?? data.recipes                ?? [];
  const rawFillings                = data.fillings                ?? data.layers                 ?? [];
  const rawProductFillings         = data.productFillings         ?? data.recipeLayers           ?? [];
  const rawFillingIngredients      = data.fillingIngredients      ?? data.layerIngredients       ?? [];
  const rawMoulds                  = data.moulds                  ?? [];
  const rawProductionPlans         = data.productionPlans         ?? [];
  const rawPlanProducts            = data.planProducts            ?? data.planBonbons            ?? [];
  const rawPlanStepStatus          = data.planStepStatus          ?? [];
  const rawUserPreferences         = data.userPreferences          ?? [];
  const rawLegacySettings          = data.settings                ?? [];
  const rawProductFillingHistory   = data.productFillingHistory   ?? data.recipeLayerHistory     ?? [];
  const rawIngredientPriceHistory  = data.ingredientPriceHistory  ?? [];
  const rawProductCostSnapshots    = data.productCostSnapshots    ?? data.recipeCostSnapshots    ?? [];
  const rawPackaging               = data.packaging               ?? [];
  const rawPackagingOrders         = data.packagingOrders         ?? [];
  const rawDecorationMaterials     = data.decorationMaterials     ?? [];
  const rawDecorationCategories    = data.decorationCategories    ?? [];
  const rawShellDesigns            = data.shellDesigns            ?? [];
  const rawExperiments             = data.experiments             ?? [];
  const rawExperimentIngredients   = data.experimentIngredients   ?? [];
  const rawShoppingItems           = data.shoppingItems           ?? [];
  const rawCollections             = data.collections             ?? [];
  const rawCollectionProducts      = data.collectionProducts      ?? data.collectionRecipes      ?? [];
  const rawCollectionPackagings    = data.collectionPackagings    ?? [];
  const rawCollectionPricingSnaps  = data.collectionPricingSnapshots ?? [];
  const rawFillingStock            = data.fillingStock            ?? data.layerStock             ?? [];
  const rawFillingCategories       = data.fillingCategories       ?? [];
  const rawIngredientCategories    = data.ingredientCategories    ?? [];

  // Apply field-level migrations for backups written pre-rename.
  const payload: ImportPayload = {
    ingredients:                passThrough(rawIngredients),
    productCategories:          passThrough(rawProductCategories),
    products:                   applyAll(rawProducts, migrateProduct),
    fillings:                   passThrough(rawFillings),
    productFillings:            applyAll(rawProductFillings, migrateProductFilling),
    fillingIngredients:         applyAll(rawFillingIngredients, migrateFillingIngredient),
    moulds:                     passThrough(rawMoulds),
    productionPlans:            applyAll(rawProductionPlans, migrateProductionPlan),
    planProducts:               applyAll(rawPlanProducts, migratePlanProduct),
    planStepStatus:             passThrough(rawPlanStepStatus),
    userPreferences:            passThrough(rawUserPreferences),
    productFillingHistory:      applyAll(rawProductFillingHistory, migrateProductFillingHistory),
    ingredientPriceHistory:     passThrough(rawIngredientPriceHistory),
    productCostSnapshots:       applyAll(rawProductCostSnapshots, migrateProductCostSnapshot),
    packaging:                  passThrough(rawPackaging),
    packagingOrders:            passThrough(rawPackagingOrders),
    decorationMaterials:        passThrough(rawDecorationMaterials),
    decorationCategories:       passThrough(rawDecorationCategories),
    shellDesigns:               passThrough(rawShellDesigns),
    experiments:                applyAll(rawExperiments, migrateExperiment),
    experimentIngredients:      passThrough(rawExperimentIngredients),
    shoppingItems:              passThrough(rawShoppingItems),
    collections:                passThrough(rawCollections),
    collectionProducts:         applyAll(rawCollectionProducts, migrateCollectionProduct),
    collectionPackagings:       passThrough(rawCollectionPackagings),
    collectionPricingSnapshots: applyAll(rawCollectionPricingSnaps, migrateCollectionPricingSnapshot),
    fillingStock:               applyAll(rawFillingStock, migrateFillingStock),
    fillingCategories:          passThrough(rawFillingCategories),
    ingredientCategories:       passThrough(rawIngredientCategories),
  };

  // 1. Atomic server-side wipe. Single round-trip, all-or-nothing.
  const { error: clearErr } = await supabase.rpc("clear_all_data");
  if (clearErr) throw clearErr;

  // 2. Upsert each table in dependency order. Upsert (rather than insert)
  //    makes a partial failure re-runnable: rerunning picks up where it left
  //    off and overwrites anything already there with backup values.
  for (const table of INSERT_ORDER) {
    const rows = payload[table];
    if (!rows) continue;
    await bulkUpsert(table, rows);
  }

  // 3. Post-import reconciliation for pre-v2 / pre-v4 / pre-v5 / pre-v6 backups
  //    that predate some of the lookup tables.
  await reconcileProductCategoriesAfterImport();
  const { ensureDefaultDecorationCategories, ensureDefaultShellDesigns, ensureDefaultFillingCategories, ensureDefaultIngredientCategories } = await import("@/lib/hooks");
  await ensureDefaultDecorationCategories();
  await ensureDefaultShellDesigns();
  await ensureDefaultFillingCategories();
  await ensureDefaultIngredientCategories();
  await reconcileUserPreferencesAfterImport(rawLegacySettings);
}

/**
 * Idempotent post-import reconciliation. Ensures the productCategories table
 * has at least the default seeded categories, then walks every product and
 * back-fills `productCategoryId` from the legacy `productType` string for any
 * product that doesn't already have one set.
 */
async function reconcileProductCategoriesAfterImport(): Promise<void> {
  const existing = assertOk(await supabase.from("productCategories").select("*")) as {
    id: string;
    name: string;
    shellPercentMin: number;
    shellPercentMax: number;
    defaultShellPercent: number;
  }[];
  const byLower = new Map(existing.map((c) => [c.name.toLowerCase(), c]));

  const now = new Date();
  const { DEFAULT_PRODUCT_CATEGORIES } = await import("@/types");
  for (const seed of DEFAULT_PRODUCT_CATEGORIES) {
    if (byLower.has(seed.name.toLowerCase())) continue;
    const id = newId();
    const { error } = await supabase.from("productCategories").insert({
      id,
      name: seed.name,
      shellPercentMin: seed.shellPercentMin,
      shellPercentMax: seed.shellPercentMax,
      defaultShellPercent: seed.defaultShellPercent,
      createdAt: now,
      updatedAt: now,
    });
    if (error) throw error;
    byLower.set(seed.name.toLowerCase(), { ...seed, id });
  }

  const products = assertOk(await supabase.from("products").select("id, productCategoryId, productType")) as {
    id: string;
    productCategoryId: string | null;
    productType: string | null;
  }[];
  const needsLink = products.filter((p) => !p.productCategoryId);
  if (needsLink.length === 0) return;

  // Create one category per unique legacy `productType` string not already covered.
  const legacyTypes = new Set<string>();
  for (const p of needsLink) {
    const t = (p.productType ?? "").toString().trim();
    if (t && !byLower.has(t.toLowerCase())) legacyTypes.add(t);
  }
  for (const name of legacyTypes) {
    const id = newId();
    const { error } = await supabase.from("productCategories").insert({
      id,
      name,
      shellPercentMin: 0,
      shellPercentMax: 100,
      defaultShellPercent: 30,
      createdAt: now,
      updatedAt: now,
    });
    if (error) throw error;
    byLower.set(name.toLowerCase(), { id, name, shellPercentMin: 0, shellPercentMax: 100, defaultShellPercent: 30 });
  }

  const mouldedId = byLower.get("moulded")?.id;
  for (const p of needsLink) {
    const t = (p.productType ?? "").toString().trim().toLowerCase();
    const categoryId = (t && byLower.get(t)?.id) || mouldedId;
    if (!categoryId) continue;
    const { error } = await supabase
      .from("products")
      .update({ productCategoryId: categoryId })
      .eq("id", p.id);
    if (error) throw error;
  }
}

/**
 * Migrate legacy key-value settings to the new userPreferences table.
 * Called after importing a pre-v4 backup that has `settings` but no `userPreferences`.
 * No-op if userPreferences already has data (i.e. the backup was v4+).
 */
async function reconcileUserPreferencesAfterImport(rawLegacySettings: unknown[]): Promise<void> {
  const existing = assertOk(await supabase.from("userPreferences").select("id")) as { id: string }[];
  if (existing.length > 0) return;

  if (!rawLegacySettings || rawLegacySettings.length === 0) {
    const { error } = await supabase.from("userPreferences").insert({
      id: newId(),
      marketRegion: "EU",
      currency: "EUR",
      defaultFillMode: "percentage",
      facilityMayContain: [],
      coatings: ["dark", "milk", "white", "vegan white", "vegan milk", "caramel"],
      updatedAt: new Date(),
    });
    if (error) throw error;
    return;
  }

  const byKey = new Map<string, string>();
  for (const row of rawLegacySettings) {
    const r = row as { key?: string; value?: string };
    if (r?.key && r?.value) byKey.set(r.key, r.value);
  }

  function parse<T>(key: string, fallback: T): T {
    const raw = byKey.get(key);
    if (!raw) return fallback;
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  }

  const { error } = await supabase.from("userPreferences").insert({
    id: newId(),
    marketRegion: parse("marketRegion", "EU"),
    currency: parse("currency", "EUR"),
    defaultFillMode: parse("defaultFillMode", "percentage"),
    facilityMayContain: parse<string[]>("facilityMayContain", []),
    coatings: parse<string[]>("coatings", ["dark", "milk", "white", "vegan white", "vegan milk", "caramel"]),
    updatedAt: new Date(),
  });
  if (error) throw error;
}
