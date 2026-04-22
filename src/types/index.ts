/** @deprecated Use the `ingredientCategories` table instead. Kept as a fallback
 *  for tests, CSV import validation, and pre-v6 migration code. */
export const INGREDIENT_CATEGORIES = [
  "Alcohol",
  "Chocolate",
  "Essential Oils",
  "Extra",
  "Fats",
  "Flavors & Additives",
  "Infusions",
  "Liquids",
  "Nuts / Nut Pastes / Pralines",
  "Sugars",
] as const;

export interface IngredientCategory {
  id?: string;
  name: string;
  /** Soft-delete: archived categories are hidden from create pickers but preserved on existing ingredients. */
  archived?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Default seeded ingredient categories — created on first run and re-created if missing. */
export const DEFAULT_INGREDIENT_CATEGORIES: ReadonlyArray<{ name: string }> = [
  { name: "Alcohol" },
  { name: "Chocolate" },
  { name: "Essential Oils" },
  { name: "Extra" },
  { name: "Fats" },
  { name: "Flavors & Additives" },
  { name: "Infusions" },
  { name: "Liquids" },
  { name: "Nuts / Nut Pastes / Pralines" },
  { name: "Sugars" },
];

export interface Ingredient {
  id?: string;
  name: string;
  manufacturer: string;
  brand?: string;           // product brand (e.g. "Valrhona", "Callebaut") — free-text with suggestions
  vendor?: string;           // where purchased (e.g. "Keylink", "Chocolate Trading Co") — free-text with suggestions
  source: string;
  cost: number; // legacy — superseded by purchaseCost
  notes: string;
  category?: string; // e.g. "Chocolate", "Fats" — from INGREDIENT_CATEGORIES
  // Purchase pricing
  purchaseCost?: number;    // total price paid
  purchaseDate?: string;    // ISO date string e.g. "2025-03-01"
  purchaseQty?: number;     // quantity purchased
  purchaseUnit?: string;    // unit of purchase e.g. "g", "kg", "pcs"
  gramsPerUnit?: number;    // grams per purchase unit — auto-set when purchaseUnit is "g" or "kg"
  // Composition (percentages, must sum to 100%)
  cacaoFat: number;
  sugar: number;
  milkFat: number;
  water: number;
  solids: number;
  otherFats: number;
  alcohol?: number;  // % alcohol content (spirits, liqueurs) — optional, defaults to 0
  // Allergens & food compatibility
  allergens: string[];
  archived?: boolean; // soft-delete: hidden from lists, preserved for production history
  pricingIrrelevant?: boolean; // true = ingredient has no meaningful cost (e.g. water, salt) — treated as zero cost, no missing-pricing warning
  /** True when this ingredient can serve as a product shell (couverture/coating chocolate).
   *  Only meaningful when category === "Chocolate"; UI shows the checkbox only for that category.
   *  Drives the shell-ingredient picker on the product detail page. */
  shellCapable?: boolean;
  commercialName?: string; // commercial/product name (e.g. "Guanaja 70%")
  updatedAt?: Date;
  // Shopping / restock tracking
  lowStock?: boolean;         // true = flagged as running low, shown on shopping list
  lowStockSince?: number;     // Date.now() when flagged
  lowStockOrdered?: boolean;  // true = order placed, awaiting delivery
  outOfStock?: boolean;       // true = completely out, higher urgency than lowStock
  /** Current stock in grams. Nullable — treated as 0 when unset.
   *  Feeds the planned-demand minus stock calculation on /shopping. */
  currentStockG?: number;
  // Nutrition data (all values per 100g of ingredient)
  nutrition?: import("@/lib/nutrition").NutritionData;
  /** Optional text-only breakdown of what this compound ingredient is made of.
   *  Used to generate ingredient-list text at filling / product / collection
   *  level. Not FK-linked; not used for nutrition rollup (nutrition comes from
   *  the compound ingredient's own `nutrition` field). Percentages are
   *  optional and not required to sum to 100 — when present they drive
   *  sort order on the ingredient-list display. */
  subIngredients?: SubIngredient[];
  /** Default VAT rate (percent, e.g. 10) applied to this ingredient's
   *  purchase cost. Used by the stock-entry form to prefill the VAT
   *  field and by the purchase log to split net / gross. Null → the
   *  app-level food default (10%) is used. */
  defaultVatRate?: number;
}

/** One entry in an Ingredient's `subIngredients` breakdown — the label that
 *  will appear on ingredient-list text (e.g. "Cocoa mass"), optionally with a
 *  percentage for display/sorting. Text-only by design (see migration 0007
 *  header for rationale). */
export interface SubIngredient {
  name: string;
  /** Optional 0–100. Not required to sum to 100 across siblings. */
  percentage?: number;
}

/** Derive cost per gram from purchase fields. Returns null if data is insufficient.
 *  Returns 0 for ingredients marked pricingIrrelevant (e.g. water, salt) — contributes zero cost without raising a missing-data warning.
 *  purchaseQty defaults to 1 when absent — supports the simplified "price for X grams" model. */
export function costPerGram(ing: Ingredient): number | null {
  if (ing.pricingIrrelevant) return 0;
  const { purchaseCost, purchaseQty, gramsPerUnit } = ing;
  if (!purchaseCost || !gramsPerUnit) return null;
  const totalGrams = (purchaseQty ?? 1) * gramsPerUnit;
  if (totalGrams <= 0) return null;
  return purchaseCost / totalGrams;
}

/** Returns true if the ingredient has pricing data or is explicitly marked as pricing-irrelevant. */
export function hasPricingData(ing: Ingredient): boolean {
  return costPerGram(ing) !== null;
}

export const SHELL_TECHNIQUES = [
  "Airbrushing",
  "Brushing",
  "Droplet / Water Spotting",
  "Dual-Tone Swirling",
  "Finger Painting",
  "Layered Scratch-Back",
  "Masking / Taping",
  "Piping (Inside the Mould)",
  "Splattering / Speckling",
  "Spin & Drip",
  "Sponging",
  "Stamping",
  "Stenciling",
  "Transfer Sheet",
] as const;

/** Production phase where a decoration step can be applied.
 *  Maps 1:1 to production plan phase IDs, except "filling" which is not decoration-relevant.
 *  Legacy values "on_mould" and "after_cap" are kept for backward compat and treated as
 *  aliases for "colour" and "cap" respectively. */
export type ShellDesignApplyAt = "colour" | "shell" | "fill" | "cap" | "unmould" | "on_mould" | "after_cap";

/** Normalise legacy applyAt values to canonical production phase IDs. */
export function normalizeApplyAt(applyAt: string | undefined): "colour" | "shell" | "fill" | "cap" | "unmould" {
  if (applyAt === "on_mould" || applyAt === "colour" || !applyAt) return "colour";
  if (applyAt === "after_cap" || applyAt === "cap") return "cap";
  if (applyAt === "shell") return "shell";
  if (applyAt === "fill") return "fill";
  if (applyAt === "unmould") return "unmould";
  return "colour";
}

/** All production phases available as decoration step targets (excludes "filling"). */
export const DECORATION_APPLY_AT_OPTIONS: ReadonlyArray<{ value: "colour" | "shell" | "fill" | "cap" | "unmould"; label: string }> = [
  { value: "colour",  label: "Colour" },
  { value: "shell",   label: "Shell" },
  { value: "fill",    label: "Fill" },
  { value: "cap",     label: "Cap" },
  { value: "unmould", label: "Unmould" },
];

export interface ShellDesignStep {
  technique: string;
  materialIds: string[]; // references to DecorationMaterial.id
  notes?: string;
  /** When to apply this decoration step. Default "on_mould" = colour tab.
   *  Transfer sheet materials always apply at cap regardless of this field. */
  applyAt?: ShellDesignApplyAt;
}

export interface Product {
  id?: string;
  name: string;
  photo?: string; // base64 encoded image
  popularity?: number; // 1–5 stars
  productCategoryId?: string; // FK → ProductCategory.id (replaces the old free-text productType)
  /** Direct FK to the shell chocolate ingredient (must have shellCapable=true).
   *  Replaces the old `coating` string + CoatingChocolateMapping lookup. */
  shellIngredientId?: string;
  /** Shell as a percentage of total cavity weight (0–100). Bounded by the product
   *  category's [shellPercentMin, shellPercentMax]. Defaults to the category's
   *  defaultShellPercent. When 0 → no shell (e.g. bean-to-bar). When 100 → shell only. */
  shellPercentage?: number;
  /** How fill amounts are specified: "percentage" (default) = each filling gets a % of the
   *  fill volume; "grams" = user enters exact grams per filling per cavity, shell = remainder. */
  fillMode?: "percentage" | "grams";
  /** @deprecated Legacy coating name (e.g. "dark", "milk"). Kept on old records for
   *  backward-compatible display and production grouping. Not written by new code. */
  coating?: string;
  tags?: string[]; // user-defined labels e.g. "christmas", "spring"
  notes?: string;
  shelfLifeWeeks?: string;
  /** Threshold below which the product is flagged as "low stock" in the production wizard.
   *  Compared against the sum of `currentStock` across in-stock batches. When unset,
   *  the wizard falls back to the legacy per-batch `stockStatus` flag. */
  lowStockThreshold?: number;
  /** Timestamp (ms) of the most recent manual stock count. Set by `updateProductStockCount`. */
  stockCountedAt?: number;
  defaultMouldId?: string;
  defaultBatchQty?: number; // default: 1
  shellDesign?: ShellDesignStep[]; // ordered decoration steps for moulded products
  vegan?: boolean; // user-set flag; shown as a leaf icon on printed batch labels
  /** Production lead time in whole days. Editable per product; when unset
   *  the UI shows a suggested value derived from productionSteps × capacity.
   *  Used by the borrow-from-Store decision: borrow is only allowed if
   *  the next shop opening day is at least this many days away, so the
   *  replenishment batch can be produced in time. */
  leadTimeDays?: number;
  /** Default VAT rate (percent, e.g. 10) applied when this product
   *  appears on an order line and the line hasn't overridden it. Null →
   *  app-level food default (10%). */
  defaultVatRate?: number;
  archived?: boolean; // soft-delete: hidden from lists, preserved for production history
  createdAt: Date;
  updatedAt: Date;
}

/**
 * ProductCategory — user-managed top-level grouping for products (e.g. "moulded", "bar").
 * Replaces the old free-text `productType` string. Each category configures the
 * recommended shell-percentage range and default for products in that category.
 *
 * Bar-like behaviour is implicit from the range:
 *   - shellPercentMin === 0  → category allows the layers section to be the whole product (e.g. bean-to-bar)
 *   - shellPercentMax === 100 → category allows shell-only products (e.g. plain bar)
 */
export interface ProductCategory {
  id?: string;
  name: string;
  /** Lower bound of the recommended shell percentage (0–100). */
  shellPercentMin: number;
  /** Upper bound of the recommended shell percentage (0–100, must be >= min). */
  shellPercentMax: number;
  /** Default shell percentage for new products in this category (must lie within [min, max]). */
  defaultShellPercent: number;
  /** Soft-delete: archived categories are hidden from create pickers but preserved on existing products. */
  archived?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Default seeded categories — created on first run and re-created if missing. */
export const DEFAULT_PRODUCT_CATEGORIES: ReadonlyArray<{
  name: string;
  shellPercentMin: number;
  shellPercentMax: number;
  defaultShellPercent: number;
}> = [
  { name: "moulded", shellPercentMin: 15, shellPercentMax: 50, defaultShellPercent: 37 },
  { name: "bar",     shellPercentMin: 0,  shellPercentMax: 100, defaultShellPercent: 50 },
];

export type FillMode = "percentage" | "grams";
export const FILL_MODES: readonly FillMode[] = ["percentage", "grams"];

export const DEFAULT_COATINGS = ["dark", "milk", "white", "vegan white", "vegan milk", "caramel"] as const;

export const DEFAULT_FILLING_STATUSES = ["to try", "testing", "confirmed"] as const;
/** @deprecated Use DEFAULT_FILLING_STATUSES — kept for backward compat */
export const FILLING_STATUSES = DEFAULT_FILLING_STATUSES;
export type FillingStatus = string;

// Filling is a standalone, reusable entity — the core component of a product
export interface Filling {
  id?: string;
  name: string;
  category: string;
  subcategory?: string; // legacy field — no longer used in UI
  source: string; // e.g. book name, website, "original"
  description: string;
  allergens: string[]; // auto-aggregated from ingredients
  instructions: string;
  status?: FillingStatus;
  shelfLifeWeeks?: number; // shelf life in weeks — relevant for shelf-stable categories (Pralines, Fruit-Based)
  /** Water activity (Aw) measurement — 0.000–1.000. Measured with a
   *  meter on the finished filling; a primary food-safety indicator
   *  (thresholds like 0.85 matter for microbial safety). Optional. */
  waterActivity?: number;
  // Versioning fields
  rootId?: string;        // undefined for unforked fillings; set to v1.id once any fork is made
  version?: number;       // 1-indexed; undefined = legacy unforked filling (treat as v1)
  createdAt?: Date;       // when this version was created
  supersededAt?: Date;    // set when a newer version is forked; undefined = current version
  versionNotes?: string;  // optional notes describing what changed in this version
  archived?: boolean;     // soft-delete: hidden from lists, preserved for production history
}

// Tracks which filling version was used in a product and when it was swapped out
export interface ProductFillingHistory {
  id?: string;
  productId: string;
  fillingId: string;            // the old (superseded) filling version id
  replacedByFillingId: string;  // the new filling version id
  fillPercentage: number;
  sortOrder: number;
  replacedAt: Date;
}

export interface CategoryDef {
  name: string;
}

export const FILLING_CATEGORIES: CategoryDef[] = [
  { name: "Ganaches (Emulsions)" },
  { name: "Pralines & Giandujas (Nut-Based)" },
  { name: "Caramels & Syrups (Sugar-Based)" },
  { name: "Fruit-Based (Pectins & Acids)" },
  { name: "Croustillants & Biscuits (The \"Crunch\" Filling)" },
];

/** Configurable filling category record. The `name` is the link key —
 *  `Filling.category` stores the same string. Renames cascade. */
export interface FillingCategory {
  id?: string;
  name: string;
  /** When true, the production wizard prompts the user for a batch multiplier
   *  instead of scaling the recipe to fit the cavities. */
  shelfStable: boolean;
  archived?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Initial seed for the fillingCategories table. Names match FILLING_CATEGORIES;
 *  Pralines and Fruit-Based default to shelfStable=true to preserve prior behavior. */
export const DEFAULT_FILLING_CATEGORIES: { name: string; shelfStable: boolean }[] = [
  { name: "Ganaches (Emulsions)", shelfStable: false },
  { name: "Pralines & Giandujas (Nut-Based)", shelfStable: true },
  { name: "Caramels & Syrups (Sugar-Based)", shelfStable: false },
  { name: "Fruit-Based (Pectins & Acids)", shelfStable: true },
  { name: "Croustillants & Biscuits (The \"Crunch\" Filling)", shelfStable: false },
];

// Join table: which fillings belong to which product, and in what order
export interface ProductFilling {
  id?: string;
  productId: string;
  fillingId: string;
  sortOrder: number;
  /** Percentage of the fill volume this filling occupies (0–100). Must sum to 100 across
   *  all fillings for a product. Used when `Product.fillMode === "percentage"` (the default). */
  fillPercentage: number;
  /** Exact grams of this filling per cavity. Used when `Product.fillMode === "grams"`.
   *  Shell weight is derived as cavity weight minus the sum of all fillGrams (÷ density). */
  fillGrams?: number;
}

export interface FillingIngredient {
  id?: string;
  fillingId: string;
  ingredientId: string;
  amount: number;
  unit: string;
  sortOrder?: number;
  note?: string;
}

// Key-value settings store for user-extendable option lists
/** @deprecated Use UserPreferences instead — AppSetting used `key` as primary key
 *  which prevented Dexie Cloud sync. Kept for backward-compatible backup import. */
export interface AppSetting {
  key: string; // e.g. "coatings", "marketRegion", "currency"
  value: string; // JSON-encoded value
}

/**
 * Single-record preferences table that syncs across devices via Dexie Cloud.
 * Replaces the old key-value `settings` table (which used `key` as primary key
 * and therefore stayed device-local).
 */
export interface UserPreferences {
  id?: string;
  marketRegion: MarketRegion;
  currency: CurrencyCode;
  defaultFillMode: FillMode;
  facilityMayContain: string[];
  coatings: string[];
  updatedAt: Date;
}

export interface Mould {
  id?: string;
  name: string;
  productNumber?: string;
  brand?: string;
  cavityWeightG: number;          // manufacturer's stated weight of a fully filled solid cavity (g)
  numberOfCavities: number;
  fillingGramsPerCavity?: number; // net filling weight per cavity in grams (excluding shell + cap)
  quantityOwned?: number; // how many physical copies of this mould the user owns
  photo?: string; // base64 encoded image
  notes?: string;
  archived?: boolean;
}

// --- Production Planning ---

/** One shelf-stable filling entry sourced from a prior batch rather than made fresh */
export interface FillingPreviousBatch {
  madeAt: string;            // ISO date string — when the previous batch was made
  shelfLifeWeeks?: number;   // shelf life of that filling in weeks (optional — omitted when unknown)
  fillingName?: string;      // captured at plan-creation time for the batch summary
  /** When true, frozen FillingStock entries are eligible for consumption alongside
   *  available ones. Any frozen entry touched is implicitly defrosted. */
  includeFrozen?: boolean;
}

export interface ProductionPlan {
  id?: string;
  batchNumber?: string; // e.g. "20260322-001" — assigned on creation, never changes
  name: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  status: "draft" | "active" | "done" | "cancelled" | "orphaned";
  notes?: string;
  // JSON-encoded Record<fillingId, multiplier> for shelf-stable fillings (Fruit & Acid, Nut-Based)
  fillingOverrides?: string;
  // JSON-encoded Record<fillingId, FillingPreviousBatch> — fillings sourced from a prior batch
  fillingPreviousBatches?: string;
  // Plain-text snapshot generated when the batch is marked done — used for recall tracing
  batchSummary?: string;
  /** @deprecated Single-FK link to the source order. Kept for one
   *  release during the orderPlanLinks rollout; new code should read
   *  OrderPlanLink rows instead. */
  sourceOrderId?: string;
  /** Operator's choice at unmould time when this batch overproduces
   *  vs its allocated order demand. 'store' / 'freezer' / 'waste'.
   *  Currently informational — the stock-rewrite task will read this
   *  and issue the corresponding stockMovement. */
  surplusDestination?: "store" | "freezer" | "waste";
}

/**
 * Many-to-many link between an orderItem and a productionPlan.
 *
 * One order line can be fulfilled by multiple batches (a large
 * shortfall split across days) and one batch can serve multiple
 * order lines (consolidation). `allocatedQuantity` captures how many
 * pieces of the batch are earmarked for this specific line; the
 * batch's actualYield minus the sum of its allocations is surplus.
 */
export interface OrderPlanLink {
  id?: string;
  orderItemId: string;
  planId: string;
  allocatedQuantity: number;
  createdAt?: Date;
  updatedAt?: Date;
}

/** @deprecated Shelf-stability is now a per-category flag stored on `fillingCategories.shelfStable`.
 *  Kept as a legacy fallback (used only when the FillingCategory record is missing). */
export const SHELF_STABLE_CATEGORIES = ["Fruit-Based (Pectins & Acids)", "Pralines & Giandujas (Nut-Based)"] as const;

export interface PlanProduct {
  id?: string;
  planId: string;
  productId: string;
  mouldId: string;
  quantity: number; // number of moulds used
  sortOrder: number;
  notes?: string;
  stockStatus?: "low" | "gone"; // undefined = in stock
  actualYield?: number; // products added to stock after unmoulding (default = quantity × cavities)
  /** Current pieces remaining in stock for this batch. Defaults to `actualYield` until
   *  a manual count adjusts it. `updateProductStockCount` mutates this FIFO across batches. */
  currentStock?: number;
  /** Pieces in the freezer for this batch. Tracked separately from `currentStock` —
   *  frozen pieces don't count toward low-stock alerts and are skipped by manual
   *  stock-count reconciliation. */
  frozenQty?: number;
  /** Timestamp of the most recent freeze action (ms). Undefined when `frozenQty === 0`. */
  frozenAt?: number;
  /** Days of shelf life captured at the time of freezing — applied from `defrostedAt`
   *  to compute the new sell-by date once defrosted. User-editable in the freeze modal
   *  (defaults to the remaining shelf life at freeze time). */
  preservedShelfLifeDays?: number;
  /** Timestamp of the most recent defrost (ms). Sell-by date for defrosted pieces
   *  becomes `defrostedAt + preservedShelfLifeDays`. */
  defrostedAt?: number;
}

// Step completion is keyed by a deterministic string derived at runtime.
// stepKey formats:
//   "color-{mouldId}"                 — colour/brush mould
//   "shell-{mouldId}"                 — shell mould
//   "filling-{planProductId}-{fillingId}" — make a filling
//   "fill-{planProductId}"            — fill shells for a product
//   "cap-{mouldId}"                   — cap mould
export interface PlanStepStatus {
  id?: string;
  planId: string;
  stepKey: string;
  done: boolean;
  doneAt?: Date;
}

// --- Filling Stock (leftover filling) ---

export interface FillingStock {
  id?: string;
  fillingId: string;
  remainingG: number;    // grams of filling left
  planId?: string;       // which production plan created this stock (optional — can be added manually)
  madeAt: string;        // ISO date string — when this filling was made
  notes?: string;
  createdAt: number;     // Date.now()
  /** When true, this stock is in the freezer — not available for use without defrosting.
   *  Freshness calculation uses `preservedShelfLifeDays` from `defrostedAt` once thawed. */
  frozen?: boolean;
  /** Timestamp of the most recent freeze (ms). */
  frozenAt?: number;
  /** Days of shelf life captured at freeze time — applied from `defrostedAt` once thawed. */
  preservedShelfLifeDays?: number;
  /** Timestamp of the most recent defrost (ms). */
  defrostedAt?: number;
}

// --- Cost tracking ---

/** One entry in the cost breakdown for a single product cavity */
export interface BreakdownEntry {
  label: string;           // e.g. "Dark ganache — cream 35%" or "Shell (dark)"
  grams: number;
  costPerGram: number;
  subtotal: number;
  kind: "filling_ingredient" | "shell" | "cap";
  ingredientId?: string;
  fillingId?: string;
}

/** Append-only log of cost-per-gram changes for an ingredient */
export interface IngredientPriceHistory {
  id?: string;
  ingredientId: string;
  costPerGram: number;
  recordedAt: Date;
  purchaseCost?: number;
  purchaseQty?: number;
  purchaseUnit?: string;
  gramsPerUnit?: number;
  note?: string;
  /** Who the ingredient was bought from — free text. */
  supplier?: string;
  /** VAT rate paid on this purchase (percent). Null → fall back to
   *  the ingredient's defaultVatRate. */
  vatRatePercent?: number;
  /** Invoice / receipt reference from the supplier. */
  invoiceNumber?: string;
  /** True when the user ticked "update default price" at purchase
   *  time. */
  updatedDefault?: boolean;
}

/** Point-in-time cost per product (1 cavity) snapshot */
export interface ProductCostSnapshot {
  id?: string;
  productId: string;
  costPerProduct: number;
  breakdown: string;        // JSON: BreakdownEntry[]
  recordedAt: Date;
  triggerType: "ingredient_price" | "filling_version" | "mould_change" | "coating_change" | "shell_change" | "manual";
  triggerDetail: string;    // human-readable reason
  mouldId?: string;
  coatingName?: string;
}

// --- Product Lab (experiments / formulation sandbox) ---

export const GANACHE_TYPES = ["dark", "milk", "white"] as const;
export type GanacheType = (typeof GANACHE_TYPES)[number];


/**
 * Universal target ranges used by the Product Lab balance checker.
 * These are type-agnostic guidelines drawn from Wybauw (Fine Chocolates Gold),
 * Mel Ogmen's whitepaper published on ganachemaster.com, and Lizi Vermaas-Viola's formulation notes.
 * The water/sugar and total-fat relationships are enforced as correlation
 * warnings rather than hard per-component limits.
 */
export const UNIVERSAL_GANACHE_RANGES: GanacheRanges = {
  water:     { min: 19, max: 22 },
  sugar:     { min: 29, max: 35 },
  cacaoFat:  { min: 15, max: 23 },
  milkFat:   { min: 15, max: 23 },
  otherFats: { min:  0, max: 20 },
  solids:    { min:  3, max: 14 },
};

export interface GanacheComponentRange {
  min: number;
  max: number;
}

export interface GanacheRanges {
  sugar: GanacheComponentRange;        // Total sugars
  cacaoFat: GanacheComponentRange;     // Cocoa butter
  milkFat: GanacheComponentRange;      // Dairy / milk fat
  otherFats: GanacheComponentRange;    // Non-dairy fats (coconut oil, nut fats, etc.)
  solids: GanacheComponentRange;       // Cocoa solids (dry mass)
  water: GanacheComponentRange;        // Water content
}


export interface Experiment {
  id?: string;
  name: string;
  ganacheType?: GanacheType;
  applicationType?: "moulded" | "coated";
  notes?: string;
  sourceFillingId?: string; // if cloned from an existing filling
  // Versioning — mirrors the Filling versioning pattern
  rootId?: string;       // undefined for v1; set to root experiment's id once any fork is made
  version?: number;      // 1-indexed; undefined = unforked (treat as v1)
  supersededAt?: Date;   // set when a newer version is forked; undefined = current version
  // Batch run outcome
  status?: "to_improve" | "promoted"; // undefined = in-progress experiment
  promotedFillingId?: string;          // set when promoted to a filling
  tasteFeedback?: number;              // 1–5 rating from test batch
  textureFeedback?: number;            // 1–5 rating from test batch
  batchNotes?: string;                 // free-text notes from test batch
  createdAt: Date;
  updatedAt: Date;
}

export interface ExperimentIngredient {
  id?: string;
  experimentId: string;
  ingredientId: string;
  amount: number; // always grams
  sortOrder?: number;
}

export interface AllergenInfo {
  id: string;
  label: string;
  group?: string;   // "nuts" = this is a nut subtype
  hint?: string;    // clarifying examples
}

/** Shared tree nut subtypes — reused across all regions.
 *  Canada requires pine nuts as a priority tree nut (Health Canada lists 9); EU/UK (8), US
 *  (FALCPA, pine nut optional but commonly declared) and AU don't mandate it but users may
 *  still tick it for cross-market labelling. */
const TREE_NUTS: AllergenInfo[] = [
  { id: "nuts_almonds",    label: "Almonds",                      group: "nuts" },
  { id: "nuts_hazelnuts",  label: "Hazelnuts",                    group: "nuts" },
  { id: "nuts_walnuts",    label: "Walnuts",                      group: "nuts" },
  { id: "nuts_cashews",    label: "Cashews",                      group: "nuts" },
  { id: "nuts_pecans",     label: "Pecan nuts",                   group: "nuts" },
  { id: "nuts_brazil",     label: "Brazil nuts",                  group: "nuts" },
  { id: "nuts_pistachios", label: "Pistachio nuts",               group: "nuts" },
  { id: "nuts_macadamia",  label: "Macadamia / Queensland nuts",  group: "nuts" },
  { id: "nuts_pine",       label: "Pine nuts",                    group: "nuts" },
];

/** All 14 EU FIC allergens (Regulation 1169/2011), with tree nuts expanded to individual subtypes */
export const EU_ALLERGENS: AllergenInfo[] = [
  { id: "gluten",       label: "Cereals containing gluten", hint: "wheat, rye, barley, oats, spelt, kamut" },
  { id: "crustaceans",  label: "Crustaceans",               hint: "shrimp, prawns, crab, lobster" },
  { id: "eggs",         label: "Eggs" },
  { id: "fish",         label: "Fish" },
  { id: "peanuts",      label: "Peanuts" },
  { id: "soybeans",     label: "Soybeans" },
  { id: "milk",         label: "Milk",                      hint: "including lactose" },
  ...TREE_NUTS,
  { id: "celery",       label: "Celery",                    hint: "including celeriac" },
  { id: "mustard",      label: "Mustard" },
  { id: "sesame",       label: "Sesame seeds" },
  { id: "sulphites",    label: "Sulphur dioxide & sulphites", hint: ">10 mg/kg or 10 mg/litre expressed as SO₂" },
  { id: "lupin",        label: "Lupin",                     hint: "including lupin flour and seeds" },
  { id: "molluscs",     label: "Molluscs",                  hint: "clams, mussels, oysters, scallops, snails, squid" },
  // Advisory ingredient flag — not part of the EU FIC 14 allergens but
  // surfaced on the same UI so the user can tag alcohol-containing
  // ingredients (rum, Grand Marnier, kirsch…) for customers who need
  // to know (children, pregnancy, religious diets).
  { id: "alcohol",      label: "Alcohol",                   hint: "rum, liqueurs, wine, beer — flag any ethanol-containing ingredient" },
];

/** UK — same 14 EU allergens (Assimilated FIC + Natasha's Law 2021).
 *  Natasha's Law: prepacked-for-direct-sale foods must show full ingredient list with allergens emphasised. */
export const UK_ALLERGENS: AllergenInfo[] = EU_ALLERGENS;

/** 9 major food allergens under US FALCPA 2004 + FASTER Act 2023 */
export const US_ALLERGENS: AllergenInfo[] = [
  { id: "milk",       label: "Milk" },
  { id: "eggs",       label: "Eggs" },
  { id: "fish",       label: "Fish",       hint: "specify type e.g. salmon, tuna, tilapia" },
  { id: "shellfish",  label: "Shellfish",  hint: "specify type e.g. shrimp, crab, lobster" },
  ...TREE_NUTS,
  { id: "wheat",      label: "Wheat" },
  { id: "peanuts",    label: "Peanuts" },
  { id: "soybeans",   label: "Soybeans" },
  { id: "sesame",     label: "Sesame seeds", hint: "FASTER Act, mandatory from Jan 1 2023" },
];

/** Australia / New Zealand — PEAL (Plain English Allergen Labelling), full force 25 Feb 2024.
 *  Drops celery, lupin, mustard vs EU. Each nut and mollusc must be named individually.
 *  Mandatory "Contains:" summary statement. Gluten + wheat must both appear in summary. */
export const AU_ALLERGENS: AllergenInfo[] = [
  { id: "gluten",       label: "Gluten",                    hint: "wheat, rye, barley, oats — each cereal named in ingredients, 'gluten' in Contains summary" },
  { id: "crustaceans",  label: "Crustaceans",               hint: "specify type e.g. prawn, crab, lobster" },
  { id: "eggs",         label: "Eggs" },
  { id: "fish",         label: "Fish",                      hint: "specify type e.g. salmon, tuna" },
  { id: "peanuts",      label: "Peanuts" },
  { id: "soybeans",     label: "Soybeans" },
  { id: "milk",         label: "Milk" },
  ...TREE_NUTS,
  { id: "sesame",       label: "Sesame seeds" },
  { id: "sulphites",    label: "Sulphur dioxide & sulphites", hint: ">10 mg/kg or 10 mg/litre expressed as SO₂" },
  { id: "molluscs",     label: "Molluscs",                  hint: "specify type e.g. oyster, mussel, squid — each must be named individually" },
];

/** Canada — Health Canada / CFIA (Food and Drugs Act, Safe Food for Canadians Act).
 *  11 priority allergens + gluten sources (barley, rye, oats, triticale — declared separately from wheat)
 *  + added sulphites. Each tree nut must be named individually (like AU). Bold emphasis is NOT required.
 *  Labels must be bilingual (English + French) — relevant once label printing is supported. */
export const CA_ALLERGENS: AllergenInfo[] = [
  { id: "wheat",        label: "Wheat",                      hint: "wheat & triticale — named in ingredients and Contains statement" },
  { id: "gluten",       label: "Gluten sources",             hint: "barley, rye, oats — declared separately from wheat" },
  { id: "crustaceans",  label: "Crustaceans",                hint: "specify type e.g. shrimp, crab, lobster" },
  { id: "molluscs",     label: "Molluscs",                   hint: "specify type e.g. oyster, mussel, squid" },
  { id: "eggs",         label: "Eggs" },
  { id: "fish",         label: "Fish",                       hint: "specify type e.g. salmon, tuna" },
  { id: "peanuts",      label: "Peanuts" },
  { id: "soybeans",     label: "Soy" },
  { id: "milk",         label: "Milk" },
  ...TREE_NUTS,
  { id: "sesame",       label: "Sesame seeds" },
  { id: "mustard",      label: "Mustard" },
  { id: "sulphites",    label: "Sulphites",                  hint: "≥10 ppm declared as added sulphites" },
];

export type MarketRegion = "EU" | "UK" | "US" | "AU" | "CA";

/** Label formatting rules per market */
export interface MarketLabelRules {
  /** Display name for the market */
  label: string;
  /** Short description of the governing regulation */
  regulation: string;
  /** Whether a separate "Contains: ..." summary statement is mandatory */
  requiresContainsSummary: boolean;
  /** Whether allergens must be emphasised (bold/underline) in the ingredients list */
  requiresEmphasisInIngredients: boolean;
  /** Additional notes for the label output (e.g. Natasha's Law) */
  notes?: string;
}

export const MARKET_LABEL_RULES: Record<MarketRegion, MarketLabelRules> = {
  EU: {
    label: "European Union",
    regulation: "FIC Regulation 1169/2011",
    requiresContainsSummary: false,
    requiresEmphasisInIngredients: true,
  },
  UK: {
    label: "United Kingdom",
    regulation: "Assimilated FIC + Natasha's Law 2021",
    requiresContainsSummary: false,
    requiresEmphasisInIngredients: true,
    notes: "Natasha's Law: prepacked-for-direct-sale requires full ingredient list with allergens emphasised",
  },
  US: {
    label: "United States",
    regulation: "FALCPA 2004 + FASTER Act 2023",
    requiresContainsSummary: false,
    requiresEmphasisInIngredients: false,
  },
  AU: {
    label: "Australia / New Zealand",
    regulation: "PEAL / Food Standards Code (25 Feb 2024)",
    requiresContainsSummary: true,
    requiresEmphasisInIngredients: true,
    notes: "Each nut and mollusc must be named individually. Gluten + wheat must both appear in Contains summary.",
  },
  CA: {
    label: "Canada",
    regulation: "Health Canada / CFIA — Food and Drugs Act",
    requiresContainsSummary: false,
    requiresEmphasisInIngredients: false,
    notes: "Bilingual labels (English + French) are mandatory. Each tree nut must be named individually. Gluten sources (barley, rye, oats) declared separately from wheat.",
  },
};

// --- Currency ---

export const SUPPORTED_CURRENCIES = ["EUR", "USD", "CAD", "GBP", "CHF", "AUD", "NZD"] as const;
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

export interface CurrencyInfo {
  code: CurrencyCode;
  symbol: string;
  label: string;
}

export const CURRENCIES: CurrencyInfo[] = [
  { code: "EUR", symbol: "€", label: "Euro (€)" },
  { code: "USD", symbol: "$", label: "US Dollar ($)" },
  { code: "CAD", symbol: "CA$", label: "Canadian Dollar (CA$)" },
  { code: "GBP", symbol: "£", label: "British Pound (£)" },
  { code: "CHF", symbol: "CHF", label: "Swiss Franc (CHF)" },
  { code: "AUD", symbol: "A$", label: "Australian Dollar (A$)" },
  { code: "NZD", symbol: "NZ$", label: "New Zealand Dollar (NZ$)" },
];

export function getCurrencySymbol(code: CurrencyCode): string {
  return CURRENCIES.find(c => c.code === code)?.symbol ?? "€";
}

export function getAllergensByRegion(region: MarketRegion): AllergenInfo[] {
  switch (region) {
    case "US": return US_ALLERGENS;
    case "AU": return AU_ALLERGENS;
    case "CA": return CA_ALLERGENS;
    case "UK": return UK_ALLERGENS;
    default:   return EU_ALLERGENS;
  }
}

/** Flat list of valid allergen IDs (all regions + legacy IDs for backward compat) */
export const ALLERGEN_LIST = [
  ...EU_ALLERGENS.map(a => a.id),
  ...US_ALLERGENS.map(a => a.id),
  // Legacy IDs kept so old DB records still pass validation
  "lactose",
  "nuts",
] as const;

export const DIET_LIST = [
  "vegan",
] as const;

export type Allergen = (typeof EU_ALLERGENS)[number]["id"];
export type Diet = (typeof DIET_LIST)[number];

/** Maps old 3-value allergen IDs to their new EU equivalents */
export const LEGACY_ALLERGEN_MAP: Record<string, string[]> = {
  lactose: ["milk"],
  nuts: ["nuts_almonds", "nuts_hazelnuts", "nuts_walnuts", "nuts_cashews", "nuts_pecans", "nuts_brazil", "nuts_pistachios", "nuts_macadamia", "nuts_pine"],
};

// All known allergens across all regions, for label lookup
const ALL_KNOWN_ALLERGENS: AllergenInfo[] = [
  ...EU_ALLERGENS,
  // US-only entries not already covered by EU list
  { id: "shellfish", label: "Shellfish" },
  { id: "wheat",     label: "Wheat" },
];

/** Resolve any allergen ID (any region, including legacy) to its display label */
export function allergenLabel(id: string): string {
  const found = ALL_KNOWN_ALLERGENS.find(a => a.id === id);
  if (found) return found.label;
  if (id === "lactose") return "Milk (lactose)";
  if (id === "nuts") return "Tree nuts";
  return id;
}

/** Migrate legacy allergen IDs to new EU IDs. Deduplicates. */
export function migrateAllergens(allergens: string[]): string[] {
  const result = new Set<string>();
  for (const a of allergens) {
    const mapped = LEGACY_ALLERGEN_MAP[a];
    if (mapped) {
      mapped.forEach(m => result.add(m));
    } else {
      result.add(a);
    }
  }
  return Array.from(result);
}

export const COMPOSITION_FIELDS = [
  { key: "cacaoFat", label: "Cacao fat" },
  { key: "sugar", label: "Sugar" },
  { key: "milkFat", label: "Milk fat" },
  { key: "water", label: "Water" },
  { key: "solids", label: "Solids" },
  { key: "otherFats", label: "Other fats" },
  { key: "alcohol", label: "Alcohol" },
] as const;

export type CompositionKey = (typeof COMPOSITION_FIELDS)[number]["key"];

// --- Packaging ---

export interface Packaging {
  id?: string;
  name: string;           // e.g. "Box of 9 with natural inserts"
  capacity: number;       // how many products fit per unit
  manufacturer?: string;  // free-text
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  archived?: boolean;
  // Shopping / restock tracking
  lowStock?: boolean;
  lowStockSince?: number;
  lowStockOrdered?: boolean;
  outOfStock?: boolean;       // true = completely out, higher urgency than lowStock
  /** Current on-hand count. Incremented when a PackagingOrder is received;
   *  decremented by the Packing step in the production wizard. */
  quantityOnHand?: number;
  /** Alert threshold (units). When `quantityOnHand` < this, the low-stock
   *  flag auto-flips to true and the dashboard surfaces the shortage. */
  lowStockThreshold?: number;
  /** Supplier lead time in days — reserved for the "auto-add to shopping
   *  list" escalation. */
  leadTimeDays?: number;
  /** Minutes of hands-on packing time per unit of this packaging. Feeds
   *  directly into the labour-hours rollup on orders + quotes. */
  packingTimePerUnit?: number;
  /** Default VAT rate (percent, e.g. 10). Null → app default. */
  defaultVatRate?: number;
}

/** One consumption log entry from the Packing step. */
export interface PackagingConsumption {
  id?: string;
  packagingId: string;
  quantity: number;
  planId?: string;
  planProductId?: string;
  orderId?: string;
  loggedBy?: string;
  note?: string;
  loggedAt: Date;
}

export interface PackagingOrder {
  id?: string;
  packagingId: string;
  quantity: number;       // units received in this order (e.g. 1500 boxes)
  pricePerUnit: number;   // NET cost per unit (e.g. 1.99)
  supplier?: string;      // free-text, e.g. "Keylink"
  orderedAt: Date;        // date of order / receipt
  notes?: string;
  /** VAT rate paid on this purchase (percent). Null → use the
   *  packaging's defaultVatRate, then the app default. */
  vatRatePercent?: number;
  /** Invoice / receipt reference from the supplier. */
  invoiceNumber?: string;
  /** True when the user ticked "update default price" at purchase
   *  time — means the catalogue's most-recent pricePerUnit now points
   *  at this row. Preserved for audit. */
  updatedDefault?: boolean;
}

// --- Shopping list ---

export const SHOPPING_ITEM_CATEGORIES = [
  "Ingredient",
  "Packaging",
  "Equipment",
  "Other",
] as const;

/** Free-text shopping list item for things not tracked as ingredients or packaging */
export interface ShoppingItem {
  id?: string;
  name: string;
  category?: string; // from SHOPPING_ITEM_CATEGORIES
  note?: string;
  addedAt: number;      // Date.now()
  orderedAt?: number;   // set when marked as ordered
}

// --- Decoration materials (cocoa butters, lustre dusts, chocolate, transfer sheets, other) ---

export const DECORATION_MATERIAL_TYPES = ["cocoa_butter", "lustre_dust", "chocolate", "transfer_sheet", "other"] as const;
export type DecorationMaterialType = (typeof DECORATION_MATERIAL_TYPES)[number];

export const COCOA_BUTTER_TYPES = ["Type A", "Type B", "Type C", "Type D"] as const;
export type CocoaButterType = (typeof COCOA_BUTTER_TYPES)[number];

export const DECORATION_MATERIAL_TYPE_LABELS: Record<DecorationMaterialType, string> = {
  cocoa_butter: "Cocoa Butter",
  lustre_dust: "Lustre Dust",
  chocolate: "Chocolate",
  transfer_sheet: "Transfer Sheet",
  other: "Other",
};

/** A coloured decoration material used in shell design (cocoa butters, lustre dusts, chocolate, transfer sheets, other).
 *  Tracked separately from filling ingredients — never used in fillings or experiments. */
export interface DecorationMaterial {
  id?: string;
  name: string;                        // e.g. "Gold Shimmer", "Ivory CB"
  type: DecorationMaterialType;        // "cocoa_butter" | "lustre_dust" | "chocolate" | "transfer_sheet" | "other"
  cocoaButterType?: CocoaButterType;   // only relevant when type === "cocoa_butter"
  color?: string;                      // CSS color for swatch (hex or named)
  manufacturer?: string;
  vendor?: string;                     // where purchased (e.g. "Keylink") — free-text with suggestions
  source?: string;                     // Supplier / where to buy
  notes?: string;
  // Stock tracking
  lowStock?: boolean;
  lowStockSince?: number;              // Date.now() when flagged
  lowStockOrdered?: boolean;
  outOfStock?: boolean;
  archived?: boolean;                  // soft-delete: hidden from lists, preserved for shell design history
  createdAt?: Date;
  updatedAt?: Date;
}

// --- Decoration Categories (configurable material types) ---

/** A user-configurable category for decoration materials (replaces the old hardcoded DECORATION_MATERIAL_TYPES).
 *  The `slug` field matches the legacy `DecorationMaterial.type` string for backward compat. */
export interface DecorationCategory {
  id?: string;
  name: string;           // display name: "Cocoa Butter", "Lustre Dust", etc.
  slug: string;           // machine key matching DecorationMaterial.type: "cocoa_butter", etc.
  archived?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Default seeded decoration categories — mirrors the original DECORATION_MATERIAL_TYPES (minus "chocolate"). */
export const DEFAULT_DECORATION_CATEGORIES: ReadonlyArray<{ name: string; slug: string }> = [
  { name: "Cocoa Butter",    slug: "cocoa_butter" },
  { name: "Lustre Dust",     slug: "lustre_dust" },
  { name: "Transfer Sheet",  slug: "transfer_sheet" },
  { name: "Other",           slug: "other" },
];

// --- Shell Designs (configurable decoration techniques) ---

/** A user-configurable shell decoration technique (replaces the old hardcoded SHELL_TECHNIQUES).
 *  The `name` field matches the legacy `ShellDesignStep.technique` string for backward compat. */
export interface ShellDesign {
  id?: string;
  name: string;                          // e.g. "Airbrushing", "Transfer Sheet"
  defaultApplyAt?: ShellDesignApplyAt;   // "on_mould" | "after_cap" — default phase in production
  archived?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Default seeded shell designs — mirrors the original SHELL_TECHNIQUES. */
export const DEFAULT_SHELL_DESIGNS: ReadonlyArray<{ name: string; defaultApplyAt: ShellDesignApplyAt }> = [
  { name: "Airbrushing",              defaultApplyAt: "colour" },
  { name: "Brushing",                 defaultApplyAt: "colour" },
  { name: "Droplet / Water Spotting", defaultApplyAt: "colour" },
  { name: "Dual-Tone Swirling",       defaultApplyAt: "colour" },
  { name: "Finger Painting",          defaultApplyAt: "colour" },
  { name: "Layered Scratch-Back",     defaultApplyAt: "colour" },
  { name: "Masking / Taping",         defaultApplyAt: "colour" },
  { name: "Piping (Inside the Mould)", defaultApplyAt: "colour" },
  { name: "Splattering / Speckling",  defaultApplyAt: "colour" },
  { name: "Spin & Drip",              defaultApplyAt: "colour" },
  { name: "Sponging",                 defaultApplyAt: "colour" },
  { name: "Stamping",                 defaultApplyAt: "colour" },
  { name: "Stenciling",               defaultApplyAt: "colour" },
  { name: "Transfer Sheet",           defaultApplyAt: "cap" },
];

// --- Collections ---

/**
 * A curated set of products for a season, event, or permanent range.
 * startDate = when the collection first goes on offer.
 * endDate = undefined means it runs indefinitely (e.g. "standard" range).
 */
export interface Collection {
  id?: string;
  name: string;
  description?: string;
  startDate: string; // ISO date string, e.g. "2025-01-01"
  endDate?: string;  // ISO date string; undefined = ongoing / no end date
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Join table: which products belong to which collection, and in what order.
 *  A Collection doubles as a price list — `unitPrice` is the NET price
 *  to use for this product whenever a customer whose defaultPriceListId
 *  points at this collection adds it to an order. Null = fall back to
 *  the product's retail price. */
export interface CollectionProduct {
  id?: string;
  collectionId: string;
  productId: string;
  sortOrder: number;
  unitPrice?: number;
}

/** Links a collection to a packaging option with the retail sell price for that box */
export interface CollectionPackaging {
  id?: string;
  collectionId: string;
  packagingId: string;
  sellPrice: number;      // retail price for this box configuration (e.g. €24.95)
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A point-in-time snapshot of the margin for one (collection, packaging) combination.
 * Created when the sell price is changed, when ingredient/coating/packaging costs change,
 * or on manual recalculation. Used to draw the pricing history chart.
 */
export interface CollectionPricingSnapshot {
  id?: string;
  collectionId: string;
  packagingId: string;
  /** Average product material cost at time of snapshot */
  avgProductCost: number;
  /** Packaging unit cost at time of snapshot */
  packagingUnitCost: number;
  /** Total box cost = avgProductCost × capacity + packagingUnitCost */
  totalCost: number;
  /** Retail sell price at time of snapshot */
  sellPrice: number;
  /** Gross margin % = (sellPrice − totalCost) / sellPrice × 100 */
  marginPercent: number;
  recordedAt: Date;
  /** What caused this snapshot */
  triggerType: "sell_price_change" | "ingredient_price" | "coating_change" | "packaging_cost" | "manual";
  /** Human-readable description, e.g. "Sell price updated to €15.95" */
  triggerDetail: string;
}

// --- Production planning: capacity + calendar ---------------------------

export const WEEKDAYS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/**
 * Singleton config row: workshop-wide buffers + dashboard thresholds.
 *
 * People are now per-person (see `Person`) — the scheduler sums each
 * person's own default hours × working days minus their unavailability.
 * The fields here stay workshop-wide because they apply regardless of
 * which person is on duty.
 *
 * All fields are nullable because the schema ships empty — the Settings →
 * Capacity & People form gates completeness. The scheduler refuses to run
 * until `capacityConfigStatus(config, people).isComplete` is true.
 */
export interface CapacityConfig {
  id?: string;
  /** Percent utilisation at which the dashboard shows a warning (0–100). */
  warnThresholdPercent?: number;
  /** Percent utilisation at which the dashboard shows a critical alert (0–100). */
  criticalThresholdPercent?: number;
  /** General capacity safety margin (0–100). Applied to the aggregated
   *  per-day people-hours budget so alerts fire before 100% utilisation. */
  capacityBufferPercent?: number;
  /** Filling-specific overproduction buffer (0–100). Filling batches
   *  scale up by this factor to cover yield loss during production. */
  fillingBufferPercent?: number;
  /** Days before sell-by that a stock batch starts appearing on the
   *  dashboard expiry warning list. */
  stockExpiryWarnDays?: number;
  /** Labour hourly rate (currency units/hour) used in quote + margin
   *  calculations. Nullable until the user sets it in Settings. */
  labourHourlyRate?: number;
  /** Working-day buffer between the last scheduled active work and an
   *  order's deadline. The scheduler won't place work later than
   *  `deadline − productionBufferDays`. Default 2 when null. */
  productionBufferDays?: number;
  updatedAt?: Date;
}

// --- Stock adjustments (opening balance + corrections) ---

export const STOCK_ADJUSTMENT_ITEM_TYPES = [
  "product", "filling", "packaging", "ingredient",
] as const;
export type StockAdjustmentItemType = (typeof STOCK_ADJUSTMENT_ITEM_TYPES)[number];

export const STOCK_ADJUSTMENT_ITEM_TYPE_LABELS: Record<StockAdjustmentItemType, string> = {
  product: "Finished product",
  filling: "Filling",
  packaging: "Packaging",
  ingredient: "Ingredient",
};

export const STOCK_ADJUSTMENT_REASONS = [
  "opening_balance", "found", "damaged", "correction", "other",
] as const;
export type StockAdjustmentReason = (typeof STOCK_ADJUSTMENT_REASONS)[number];

export const STOCK_ADJUSTMENT_REASON_LABELS: Record<StockAdjustmentReason, string> = {
  opening_balance: "Opening balance",
  found: "Found during count",
  damaged: "Damaged / discarded",
  correction: "Correction",
  other: "Other",
};

/** One stock adjustment — a permanent audit row. Never deleted; a
 *  reversal is a second row with the opposite deltaQty. */
export interface StockAdjustment {
  id?: string;
  itemType: StockAdjustmentItemType;
  itemId: string;
  /** Only meaningful for products. */
  location?: StockLocation;
  /** Signed delta — positive to add stock, negative to remove. */
  deltaQty: number;
  reason: StockAdjustmentReason;
  note?: string;
  createdBy?: string;
  createdAt: Date;
}

/** One waste entry, typically created at unmould when actual yield falls
 *  short of the planned (moulds × cavities) count. */
export interface WasteLogEntry {
  id?: string;
  planProductId?: string;
  productId: string;
  quantity: number;
  reason?: string;
  loggedBy?: string;
  loggedAt: Date;
}

// --- B2B CRM + quotes (Phase 7) ---

export const CUSTOMER_TYPES = ["b2b", "private"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  b2b: "B2B",
  private: "Private",
};

/** One customer profile — B2B or Private. Analytics (lifetime value,
 *  avg order, frequency, last order) are derived in the app from
 *  `orders` + `orderItems` — not stored here. */
export interface Customer {
  id?: string;
  companyName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  /** Default delivery / shop address. Separate from invoiceAddress so
   *  the customer can have goods shipped to a different place than the
   *  invoice goes. */
  address?: string;
  /** UID / tax ID — e.g. Austrian ATU number, German USt-IdNr. */
  vatNumber?: string;
  /** Free-form tags for segmenting: "wholesale", "hotel", "pastry_shop", etc. */
  tags: string[];
  notes?: string;
  archived?: boolean;
  /** B2B vs. private. Used by the order page to decide which fields
   *  are required + how the invoice is labelled. */
  type?: CustomerType;
  /** Preferred fulfilment method — pre-populates on new orders. */
  defaultDeliveryMethod?: DeliveryType;
  /** Invoice-only address; defaults to `address` if null. */
  invoiceAddress?: string;
  /** Free text: "Net 30", "Vorkasse", "Abholung = bar", etc. */
  paymentTerms?: string;
  /** Allergen notes the kitchen should respect for every order from
   *  this customer ("no nuts", "lactose-free only"). Free text. */
  allergenNotes?: string;
  /** Packaging preferences ("always with ribbon", "no plastic"). */
  packagingPrefs?: string;
  /** ISO-ish language code — 'de', 'en', 'it'. Used to pick the
   *  quote / invoice language. */
  language?: string;
  /** Collection used as this customer's default price list. When a
   *  line's product appears in the list, its unitPrice there wins
   *  over the product default. */
  defaultPriceListId?: string;
  /** Blanket discount applied when no per-product / price-list
   *  override exists. Percent 0..100. */
  defaultDiscountPercent?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Per-customer override for a specific product's unit price. Top of
 *  the pricing hierarchy — checked before price lists and defaults. */
export interface CustomerProductPrice {
  id?: string;
  customerId: string;
  productId: string;
  /** Net price in the workspace currency. */
  unitPrice: number;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const CUSTOMER_CONTACT_KINDS = ["call", "email", "meeting", "note"] as const;
export type CustomerContactKind = (typeof CUSTOMER_CONTACT_KINDS)[number];

export const CUSTOMER_CONTACT_LABELS: Record<CustomerContactKind, string> = {
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  note: "Note",
};

/** One entry in the contact log. `body` holds the full text; `summary`
 *  is what the log list renders. */
export interface CustomerContact {
  id?: string;
  customerId: string;
  kind: CustomerContactKind;
  summary: string;
  body?: string;
  contactedAt: Date;
  loggedBy?: string;
  createdAt?: Date;
}

export const FOLLOWUP_ORIGINS = ["manual", "seasonal"] as const;
export type FollowupOrigin = (typeof FOLLOWUP_ORIGINS)[number];

/** A reminder to get back in touch with a customer by a given date. */
export interface CustomerFollowup {
  id?: string;
  customerId: string;
  dueDate: string; // ISO date
  subject: string;
  notes?: string;
  relatedOrderId?: string;
  relatedContactId?: string;
  origin: FollowupOrigin;
  completedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export const QUOTE_STATUSES = ["draft", "sent", "won", "lost", "expired"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  won: "Accepted",
  lost: "Declined",
  expired: "Expired",
};

/** Line item inside a quote. `packagingId` + `boxContents` are set when
 *  the line represents a box of assorted products (B2B gift box). */
export interface QuoteItem {
  productId?: string;
  quantity: number;
  unitPrice?: number;
  packagingId?: string;
  /** For boxes: [{ productId, pieces }]. */
  boxContents?: Array<{ productId: string; pieces: number }>;
  notes?: string;
}

/** Cost-breakdown snapshot saved alongside the quote so the PDF view
 *  stays stable even as ingredient prices drift afterwards. */
export interface QuoteCostBreakdown {
  ingredientsCost: number;
  decorationCost: number;
  packagingCost: number;
  labourCost: number;
  totalCost: number;
  /** Per-line attribution for the PDF/summary view. */
  perLine: Array<{
    productId?: string;
    label: string;
    quantity: number;
    unitCost: number;
    lineCost: number;
  }>;
}

export interface Quote {
  id?: string;
  customerId?: string;
  /** Hypothetical quote that does not affect capacity or convert to an
   *  order. Used by the What-If mode. */
  isWhatIf: boolean;
  title: string;
  status: QuoteStatus;
  deadline?: Date;
  items: QuoteItem[];
  costBreakdown?: QuoteCostBreakdown;
  totalCost?: number;
  sellPrice?: number;
  marginPercent?: number;
  labourHoursEstimate?: number;
  /** Discount % vs the standard retail price for the same mix (negative
   *  = premium over retail). */
  retailComparePct?: number;
  feasible?: boolean;
  feasibilityNote?: string;
  expiresAt?: Date;
  convertedToOrderId?: string;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** One packaging-unit line for a B2B order: N boxes of packaging P,
 *  each containing a specific product mix. */
export interface OrderBox {
  id?: string;
  orderId: string;
  packagingId?: string;
  quantity: number;
  priceOverride?: number;
  contents: Array<{ productId: string; pieces: number }>;
  sortOrder: number;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** App-level default VAT rate (percent) for food items. Used whenever
 *  a line doesn't override VAT and the item has no defaultVatRate of
 *  its own. Matches the German / Austrian reduced-rate food VAT. */
export const DEFAULT_FOOD_VAT_RATE = 10;

export const DELIVERY_TYPES = ["pickup", "delivery", "ship"] as const;
export type DeliveryType = (typeof DELIVERY_TYPES)[number];

export const DELIVERY_TYPE_LABELS: Record<DeliveryType, string> = {
  pickup: "Pickup",
  delivery: "Local delivery",
  ship: "Shipping",
};

/**
 * A production worker. The reverse scheduler sums available hours per
 * day across every non-archived person, after filtering for:
 *   - day ∈ person.workingDays
 *   - no personUnavailability row covering the date
 *   - no workshop-wide `eventCalendar(kind='blocked')` row covering it
 *
 * `roles` is free-text multi-select — the UI shows every role already
 * used across the team as an autocomplete pick but any string is allowed.
 */
export interface Person {
  id?: string;
  name: string;
  /** Free-text role labels, e.g. ["chocolatier", "owner"]. */
  roles?: string[];
  /** Typical availability per working day (hours, ≤ 24).
   *  Legacy field; `startTimeOfDay` / `endTimeOfDay` take precedence
   *  when both are set, for a precise work window. */
  defaultHoursPerDay?: number;
  /** Daily work window start (24h "HH:MM" or "HH:MM:SS"). When set
   *  together with `endTimeOfDay`, the scheduler uses (end-start) as
   *  this person's contribution to daily capacity. Range 07:00–23:00. */
  startTimeOfDay?: string;
  /** Daily work window end. Must be later than `startTimeOfDay`. */
  endTimeOfDay?: string;
  /** Days this person works, independent of the workshop. */
  workingDays?: Weekday[];
  /** Soft-delete — archived people are excluded from scheduling
   *  but preserved on historical productionSchedule assignments. */
  archived?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/** A person-specific unavailability window (vacation, doctor's appointment,
 *  sick day). Workshop-wide closures live on `EventCalendarEntry` with
 *  kind='blocked' so they apply to everyone at once. */
export interface PersonUnavailability {
  id?: string;
  personId: string;
  /** Inclusive start date, ISO-date string. */
  startDate: string;
  /** Inclusive end date, ISO-date string. Must be ≥ startDate. */
  endDate: string;
  notes?: string;
  createdAt?: Date;
}

// --- Equipment ---------------------------------------------------------

export const EQUIPMENT_KINDS = ["tempering", "melting_pot", "coating_belt", "cooling_system", "other"] as const;
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number];

export const EQUIPMENT_KIND_LABELS: Record<EquipmentKind, string> = {
  tempering: "Tempering machine",
  melting_pot: "Melting pot",
  coating_belt: "Coating belt",
  cooling_system: "Cooling system",
  other: "Other",
};

/** Equipment kinds that participate in throughput scheduling and therefore
 *  require quantity + kgPerHour fields. Cooling systems (fridges / freezers)
 *  are tracked for HACCP temperature logs only and don't need them. */
export const THROUGHPUT_EQUIPMENT_KINDS: ReadonlySet<EquipmentKind> = new Set([
  "tempering",
  "melting_pot",
  "coating_belt",
  "other",
]);

/** Derived availability status shown on the Equipment list. The stored
 *  columns `currentPlanId`/`currentScheduleId`/`occupiedSince` drive it;
 *  the scheduler (§5) is the only writer. */
export type EquipmentAvailability = "available" | "in_use" | "archived";

// --- Orders -------------------------------------------------------------

export const ORDER_CHANNELS = ["b2b", "event", "online", "shop"] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

export const ORDER_CHANNEL_LABELS: Record<OrderChannel, string> = {
  b2b: "B2B",
  event: "Event",
  online: "Online",
  shop: "Shop",
};

export const ORDER_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type OrderPriority = (typeof ORDER_PRIORITIES)[number];

export const ORDER_PRIORITY_LABELS: Record<OrderPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const ORDER_STATUSES = ["pending", "in_production", "done", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Pending",
  in_production: "In production",
  done: "Done",
  cancelled: "Cancelled",
};

export interface Order {
  id?: string;
  channel: OrderChannel;
  customerName?: string;
  /** Link to a B2B customer record. Nullable so non-B2B channels
   *  (events, walk-in shop replenishment) can skip it. Text
   *  `customerName` is preserved for display + legacy rows. */
  customerId?: string;
  /** Only set when channel = 'event'. */
  eventName?: string;
  /** ISO-timestamp string (timestamptz). Reverse scheduler works
   *  backwards from this. */
  deadline: string;
  priority: OrderPriority;
  status: OrderStatus;
  notes?: string;
  /** External reference for imported orders (e.g. Shopify's order
   *  name "#1001"). Used to dedup re-imports. */
  sourceRef?: string;
  /** Order that triggered the creation of this one. Only set on
   *  auto-generated "Shop Replenishment" orders — points at the
   *  customer order whose borrow decision created the replenishment.
   *  null for normal customer orders. */
  sourceOrderId?: string;
  /** Invoiced amount — what the customer actually paid. Editable,
   *  separate from any calculated retail / quote total. */
  pricePaid?: number;
  deliveryType?: DeliveryType;
  /** ISO-timestamp string for the delivery/pickup appointment. */
  deliveryAt?: string;
  deliveryAddress?: string;
  deliveryNotes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** A packaging line on an order — ribbons / gift bags / shipping
 *  boxes / sticker packs. Separate from orderItems (products) and
 *  orderBoxes (composition of a single gift box). */
export interface OrderPackagingLine {
  id?: string;
  orderId: string;
  packagingId: string;
  quantity: number;
  sortOrder: number;
  notes?: string;
  /** Agreed NET unit price. Null → derive from latest PackagingOrder
   *  cost (same hierarchy used by the quote flow). */
  unitPrice?: number;
  /** Per-line VAT rate (percent). Null → packaging.defaultVatRate,
   *  then app default. */
  vatRate?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export const FULFILMENT_MODES = ["produce", "borrow"] as const;
export type FulfilmentMode = (typeof FULFILMENT_MODES)[number];

export interface OrderItem {
  id?: string;
  orderId: string;
  productId: string;
  quantity: number;
  /** Agreed NET unit price for this line. Nullable — when absent,
   *  analytics fall back to the product's current retail price.
   *  All line prices on orders are stored net; gross is derived via
   *  `vatRate` or the product / app default. */
  unitPrice?: number;
  sortOrder: number;
  notes?: string;
  /** How this line is fulfilled. 'produce' = full production cycle runs.
   *  'borrow' = pieces come from Store stock (already made); Store stock
   *  moves to Allocated at save time, and only finishing-steps are
   *  scheduled. Defaults to 'produce'. */
  fulfilmentMode?: FulfilmentMode;
  /** Per-line VAT rate override (percent). Null → fall back to the
   *  product's defaultVatRate, then the app default (10%). */
  vatRate?: number;
  /** References the productionPlan this line is fulfilled from.
   *  Nullable — unlinked lines surface as "No batch" on the order UI
   *  and the user is prompted to create / pick a batch. */
  linkedBatchId?: string;
}

/** One row on the production schedule — the scheduler's output. One per
 *  step per order item. `isActive=true` rows count toward the daily
 *  people-hours budget; `false` rows (dry/wait) don't. */
export interface ProductionScheduleEntry {
  id?: string;
  orderId?: string;
  productId: string;
  mouldId?: string;
  fillingId?: string;
  planId?: string;
  planProductId?: string;
  stepId?: string;
  equipmentId?: string;
  /** Step name at the time the row was scheduled (convenience label). */
  phase: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  isActive: boolean;
  assignedTo?: string;
  status: "pending" | "in_progress" | "done" | "skipped" | "blocked";
  dependsOnId?: string;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** One step in the production sequence for a specific product type.
 *  Step names are free-text; reuse across types is via UI autocomplete,
 *  not enforced at the DB level. Duration has two parts so the scheduler
 *  can distinguish hands-on work (activeMinutes, counts against the
 *  people-hours budget) from drying/resting (waitingMinutes, doesn't). */
export interface ProductionStep {
  id?: string;
  productType: string;
  name: string;
  activeMinutes: number;
  waitingMinutes: number;
  sortOrder: number;
  /** Packing-into-boxes task for a specific customer order (load gift
   *  boxes, tie ribbons, apply order-specific labels). Store pralines
   *  are already fully finished — polished, painted, decorated — so when
   *  an order line is fulfilled by borrowing from Store stock, only the
   *  steps with isPackingStep=true are scheduled. The full production
   *  cycle (everything else) runs on the replenishment order instead.
   *  Per-packaging-item time lives on packaging.packingTimePerUnit;
   *  this flag is for workshop-level packing tasks that don't map
   *  cleanly to one packaging SKU. */
  isPackingStep?: boolean;
  /** When true, `activeMinutes` is the FIXED total for the step — the
   *  scheduler does NOT multiply it by mouldsNeeded. Use for batch-prep
   *  tasks whose duration is independent of yield: cooking a filling,
   *  tempering a vat of chocolate, etc. The pot takes the same hour
   *  whether it serves one mould or twenty. */
  perBatch?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * A piece of production equipment. Availability is not stored directly —
 * it's derived from whatever the scheduler has assigned to `currentPlanId`
 * / `currentScheduleId`. Users edit name / kind / quantity / kgPerHour
 * and metadata; the scheduler owns the occupancy columns.
 */
export const EQUIPMENT_LOCATIONS = ["shop", "production", "storage"] as const;
export type EquipmentLocation = (typeof EQUIPMENT_LOCATIONS)[number];
export const EQUIPMENT_LOCATION_LABELS: Record<EquipmentLocation, string> = {
  shop: "Shop",
  production: "Production",
  storage: "Storage",
};

export interface Equipment {
  id?: string;
  name: string;
  kind: EquipmentKind;
  /** How many identical copies exist. The scheduler uses this for
   *  parallelism (two units = two tasks at once). */
  quantity?: number;
  /** Throughput per unit in kg/hour. */
  kgPerHour?: number;
  /** Per-cycle load capacity (kg). Legacy from migration 0002 — not
   *  exposed in the Settings form today but kept on the row. */
  capacityKg?: number;
  manufacturer?: string;
  model?: string;
  notes?: string;
  /** Scheduler-managed — do not edit from the form. */
  currentPlanId?: string;
  currentScheduleId?: string;
  occupiedSince?: Date;
  expectedFreeAt?: Date;
  archived?: boolean;
  // HACCP extensions (migration 0020)
  /** When true, this device appears in the daily HACCP temperature log. */
  requiresTempCheck?: boolean;
  /** Target temperature range in Celsius. min ≤ max when both are set. */
  tempMinC?: number;
  tempMaxC?: number;
  /** Physical location — drives the HACCP history grouping. */
  location?: EquipmentLocation;
  createdAt?: Date;
  updatedAt?: Date;
}

/** One row per calendar day the workshop is open. Created by the
 *  "Open Production" action on the dashboard. */
export interface ProductionDay {
  id?: string;
  /** ISO-date string "YYYY-MM-DD". Unique per row. */
  date: string;
  openedAt: Date;
  openedBy?: string;
  closedAt?: Date;
  closedBy?: string;
  tempLogComplete: boolean;
  cleaningComplete: boolean;
  /** Free-form daily diary snapshot. Written by Close Production. */
  summary?: {
    batchesRun?: number;
    piecesProduced?: number;
    stepsCompleted?: number;
    stepsCarriedForward?: number;
    notes?: string;
  };
  createdAt?: Date;
  updatedAt?: Date;
}

/** One temperature reading against a piece of equipment. */
export interface HaccpTemperatureLog {
  id?: string;
  equipmentId: string;
  temperatureC: number;
  isWithinRange: boolean;
  note?: string;
  loggedBy?: string;
  loggedAt: Date;
  productionDayId?: string;
}

export type EventCalendarKind = "event" | "peak" | "blocked" | "holiday";

/**
 * Date-range entries that affect scheduling or the dashboard — events,
 * predicted demand peaks, blocked days (vacation, equipment service),
 * holidays. `kind='blocked'` days are excluded from the scheduler's
 * working-day set even when they fall on a configured working weekday.
 */
export interface EventCalendarEntry {
  id?: string;
  name: string;
  kind: EventCalendarKind;
  /** Inclusive start date, ISO-date string ("YYYY-MM-DD"). */
  startDate: string;
  /** Inclusive end date, ISO-date string. Must be ≥ startDate. */
  endDate: string;
  /** Optional link back to an order (e.g. an event's delivery slot). */
  relatedOrderId?: string;
  /** Optional CSS colour (hex or named) for the dashboard calendar dot. */
  color?: string;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// --- Stock locations (4-location model — §6 of the handover) ---

export const STOCK_LOCATIONS = ["store", "production", "freezer", "allocated"] as const;
export type StockLocation = (typeof STOCK_LOCATIONS)[number];

export const STOCK_LOCATION_LABELS: Record<StockLocation, string> = {
  store: "Physical Store",
  production: "Production Storage",
  freezer: "Freezer",
  allocated: "Allocated",
};

export const STOCK_LOCATION_SHORT_LABELS: Record<StockLocation, string> = {
  store: "Store",
  production: "Production",
  freezer: "Freezer",
  allocated: "Allocated",
};

/** Movement reason classifications written by the app. Free-text on the
 *  server — this list is the one the UI uses consistently. */
export type StockMovementReason =
  | "unmould"
  | "freeze"
  | "defrost"
  | "transfer"
  | "allocate"
  | "unallocate"
  | "sold"
  | "waste"
  | "breakage"
  | "recount"
  | "initial_backfill";

/** Per-batch, per-location quantity. Batch count = SUM(quantity) across
 *  a planProductId. `orderId` is set iff location === 'allocated'. */
export interface StockLocationRow {
  id?: string;
  planProductId: string;
  location: StockLocation;
  /** Only set when location === 'allocated'. */
  orderId?: string;
  quantity: number;
  updatedAt: Date;
}

/** Append-only audit log. `fromLocation`/`toLocation` null when the
 *  movement crosses a system boundary (intake from unmould, sale, waste). */
export interface StockMovement {
  id?: string;
  planProductId: string;
  productId: string;
  fromLocation?: StockLocation;
  toLocation?: StockLocation;
  quantity: number;
  orderId?: string;
  reason?: StockMovementReason | string;
  movedBy?: string;
  notes?: string;
  movedAt: Date;
}

/** Per-product, per-location minimum stock level. Supersedes the
 *  channel-based `stockMinimums` from migration 0002 for new UI. */
export interface StockLocationMinimum {
  id?: string;
  productId: string;
  location: StockLocation;
  minimumUnits: number;
  /** Optional "restock to this level" target. When null, the replenishment
   *  engine falls back to minimumUnits as the top-up target. */
  maximumUnits?: number;
  reorderPoint?: number;
  notes?: string;
  updatedAt: Date;
}

// --- Shop opening hours + closures ---

/** Weekly shop schedule. One row per day-of-week (0 = Sunday … 6 = Saturday,
 *  matching JS Date.getDay()). isOpen = false means closed that weekday;
 *  isOpen = true requires openAt + closeAt as 'HH:MM' strings. */
export interface ShopOpeningHours {
  id?: string;
  dayOfWeek: number;
  isOpen: boolean;
  openAt?: string;
  closeAt?: string;
  updatedAt?: Date;
}

/** One-off closure (holiday, vacation, illness). Overrides the weekly
 *  schedule — the shop is treated as closed on every date in
 *  [startDate, endDate]. Single-day closures repeat the date. */
export interface ShopClosure {
  id?: string;
  /** ISO date 'YYYY-MM-DD'. */
  startDate: string;
  /** ISO date 'YYYY-MM-DD'. */
  endDate: string;
  reason?: string;
  createdAt?: Date;
}
