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
   *  Used to generate ingredient-list text at filling / product / variant
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
   *  Replaces the old `coating` string + CoatingChocolateMapping lookup.
   *  Mutually exclusive with `shellFillingId` (DB check
   *  `products_shell_source_exclusive`, migration 0062). */
  shellIngredientId?: string | null;
  /** Alternative shell source: use a filling's recipe as the shell.
   *  For self-made chocolates (pistachio, strawberry, single-origin
   *  blends) where the shell is itself a recipe, not a single
   *  ingredient. Cost / nutrition / allergens derive from the
   *  filling's own ingredient list. */
  shellFillingId?: string | null;
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
  /** Alternative names this product is known by externally (Shopify
   *  storefront title, German label, abbreviation, etc.). Importers
   *  match Lineitem name against this list before falling back to
   *  manual assignment. Built up automatically: when the user picks
   *  a product for an unresolved import line, the source name lands
   *  here so future imports auto-resolve. */
  aliases?: string[];
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
  /** Skip this product from automatic replenishment seeding (mig 0079).
   *  When true, the replen brain ignores under-min gaps for this product.
   *  Used for limited-edition / campaign-only chocolates whose
   *  production should only be hand-driven via Production Orders. */
  excludeFromReplen?: boolean;
  archived?: boolean; // soft-delete: hidden from lists, preserved for production history
  // --- Production brain additions (phase 1) ---
  /** Replenishment + displacement ladder. 1 = top-seller (never displace),
   *  2 = normal, 3 = nice-to-have (first to displace when capacity crunched).
   *  Defaults to 2 for new rows. */
  priorityTier?: 1 | 2 | 3;
  /** Whether this product can appear inside a custom box sold in shop.
   *  Excluded: limited-edition B2B-only, fragile items, near-expiry. */
  includedInCustomBoxes?: boolean;
  /** Learned pick weight [0..1] — share of custom boxes this product
   *  appears in. Engine uses it to size buffer stock. Updated by the
   *  custom-box sale event pipeline. */
  customBoxPickWeight?: number;
  /** True for products that can be sold as "seconds" (B-ware) when
   *  cosmetically flawed — typically only bars. Bonbon seconds are
   *  given as free tastings, not sold. */
  secondsAllowed?: boolean;
  /** Default discount percent applied when a piece is tagged as
   *  seconds and sold. Overridable per sale. */
  defaultDiscountPercentSeconds?: number;
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

/** One component in a filling's recipe — either a raw ingredient or
 *  another filling used as a pre-made sub-component. Exactly one of
 *  `ingredientId` / `componentFillingId` is set (DB check constraint
 *  `fillingIngredients_component_exclusive`, migration 0061). */
export interface FillingIngredient {
  id?: string;
  fillingId: string;
  /** Raw-ingredient row. Set when the line is an ingredient. */
  ingredientId?: string | null;
  /** Sub-filling row. Set when the line reuses another filling as a
   *  component (e.g. a praline filling that includes a caramel
   *  filling as one of its layers). */
  componentFillingId?: string | null;
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
  /** Stamped after every successful `regenerateAllPlansAndSchedule`.
   *  Surfaced near the Regenerate button so she sees freshness. */
  lastRegenAt?: Date | null;
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
  /** Free-text labels for organising the catalogue: "Christmas",
   *  "Easter", "seasonal", "bars-only", "special-order", … (mig 0069) */
  tags?: string[];
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
  /** Manual day pin (mig 0078). When set, regenerate forces this
   *  plan's lineItems onto this exact date instead of recomputing.
   *  Set by the user via drag-drop in /plan week view + "Lock"
   *  confirmation. Cleared by the "Unpin" button on the same row. */
  pinnedDate?: string | null;
  /** Free-text "issues encountered today" written during /production/[id]
   *  Wrap up step. Kept distinct from `notes` (which doubles as a batch-
   *  level sticky note). Migration 0089. */
  issuesNotes?: string;
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
  /** Person responsible for this batch. Free-text reference to people.id —
   *  surfaced in /production/[id] Plan step. Migration 0089. */
  assignedPersonId?: string;
  /** Operator note explaining why actualYield ≠ planned (broken pieces,
   *  overfilled moulds, bloom, etc.). Captured in /production/[id] Wrap up
   *  step. Migration 0089. */
  varianceReason?: string;
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
  /** Timestamp when this step first transitioned to in-progress.
   *  Drives elapsed-time display on /production-brain/daily +
   *  the wizard step-detail drawer. Migration 0090. */
  startedAt?: Date;
  /** Person actively working this step (free-text reference to
   *  people.id). Migration 0090. */
  personId?: string;
  /** Timestamp when the step was paused. Cleared on resume. Migration 0090. */
  pausedAt?: Date;
}

// --- Ingredient Stock ---

/** Grams-on-hand for a single ingredient. One row per ingredient
 *  (unique on ingredientId). Populated by "Receive stock" when the
 *  user buys ingredients; drained automatically when production
 *  steps tick done (shelling deducts shell chocolate, filling prep
 *  deducts the filling's recipe ingredients).
 *  Lives in migration 0044. */
export interface IngredientStock {
  id?: string;
  ingredientId: string;
  quantityG: number;
  /** When non-null, drops below this trigger low-stock alerts +
   *  shopping-list shortage lines. */
  lowStockThresholdG?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Append-only audit log for ingredientStock changes. Signed deltaG —
 *  positive = intake (receive, recount-up), negative = outake
 *  (step deduction, recount-down, waste). Lives in migration 0044. */
export interface IngredientStockMovement {
  id?: string;
  ingredientId: string;
  /** Positive = added, negative = removed. Grams. */
  deltaG: number;
  /** 'receive' | 'shelling' | 'filling_prep' | 'recount' | 'waste' */
  reason: string;
  planId?: string;
  /** Links the movement to a specific step tick when known (e.g.
   *  `"shell-<planProductId>"`) for traceability on the batch page. */
  stepKey?: string;
  movedBy?: string;
  notes?: string;
  movedAt?: Date;
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

/** Short EU-FIC letter codes used on German/Austrian food labels:
 *  A = Gluten, B = Crustaceans, C = Eggs, D = Fish, E = Peanuts,
 *  F = Soy, G = Milk, H = Tree nuts, L = Celery, M = Mustard,
 *  N = Sesame, O = Sulphites, P = Lupin, R = Molluscs.
 *  Alcohol flag is an extra "ALK" badge — not an EU FIC letter. */
export function allergenShortCode(id: string): string | null {
  // Any tree-nut variant collapses to H.
  if (id.startsWith("nuts_")) return "H";
  switch (id) {
    case "gluten":      return "A";
    case "crustaceans": return "B";
    case "eggs":        return "C";
    case "fish":        return "D";
    case "peanuts":     return "E";
    case "soybeans":    return "F";
    case "milk":        return "G";
    case "lactose":     return "G"; // legacy → maps to milk
    case "nuts":        return "H"; // legacy → tree nuts
    case "celery":      return "L";
    case "mustard":     return "M";
    case "sesame":      return "N";
    case "sulphites":   return "O";
    case "lupin":       return "P";
    case "molluscs":    return "R";
    case "alcohol":     return "ALK";
    default:            return null; // unknown / diet / custom tag
  }
}

/** True if `id` is a real EU/US allergen (not a diet tag like "vegan",
 *  not a free-form label). Used to gate "bold allergen" styling so only
 *  actual allergens show emphasised. */
export function isRealAllergen(id: string): boolean {
  return allergenShortCode(id) !== null;
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

// --- Variants ---

/**
 * A curated set of products for a season, event, or permanent range.
 * startDate = when the variant first goes on offer.
 * endDate = undefined means it runs indefinitely (e.g. "standard" range).
 */
export const VARIANT_KINDS = ["free-pick", "curated"] as const;
export type VariantKind = (typeof VARIANT_KINDS)[number];

export const VARIANT_KIND_LABELS: Record<VariantKind, string> = {
  "free-pick": "Free pick",
  "curated":   "Curated",
};

export interface Variant {
  id?: string;
  name: string;
  description?: string;
  startDate: string; // ISO date string, e.g. "2025-01-01"
  endDate?: string;  // ISO date string; undefined = ongoing / no end date
  notes?: string;
  /** Free-form labels — each unique label (case-insensitive) becomes a
   *  "collection" on the Collections page. */
  labels: string[];
  /** Alternative names this variant is known by externally (Shopify
   *  storefront title, German name, abbreviation). Used by importers
   *  to match Lineitem names against the catalogue. */
  aliases?: string[];
  /** 'curated' = products fixed per size, locked on orders.
   *  'free-pick' = no stored product list; user picks on each order. */
  kind: VariantKind;
  /** VAT rate used to derive the net price from the gross price shown on
   *  the variant size rows. Austria chocolate default is 10. */
  vatRatePercent: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Join table: which products belong to which variant, and in what order.
 *  A Variant doubles as a price list — `unitPrice` is the NET price
 *  to use for this product whenever a customer whose defaultPriceListId
 *  points at this variant adds it to an order. Null = fall back to
 *  the product's retail price. */
export interface VariantProduct {
  id?: string;
  variantId: string;
  productId: string;
  sortOrder: number;
  unitPrice?: number;
}

/** One "size" of a variant — a packaging + its gross sell price + any
 *  per-channel overrides. A variant has one row per size it is sold in
 *  (e.g. Easter Box → 4, 8, 16). Curated variants also have a product
 *  list per size via {@link VariantPackagingProduct}. `packagingId`
 *  is nullable so a variant can also be sold loose / without packaging
 *  (single bonbon at counter, market event sales). Migration 0067. */
export interface VariantPackaging {
  id?: string;
  variantId: string;
  packagingId?: string | null;
  /** Default gross price (VAT-inc). Used when the order's channel has
   *  no override in {@link channelPrices}. */
  price: number;
  /** Sparse map of gross price overrides per order channel. Missing
   *  channels fall back to {@link price}. Keys are OrderChannel values:
   *  "b2b" | "event" | "online" | "shop". */
  channelPrices: Partial<Record<OrderChannel, number>>;
  /** Legacy single-price column kept for backwards-compat with live
   *  rows pre-0049. Mirrors {@link price} on write. */
  sellPrice: number;
  /** On-hand count of pre-assembled boxes of this size. Mother's Day
   *  / signature edition variants are typically packed in advance and
   *  sold off the shelf — this number tracks how many are ready.
   *  Decremented at sale (daily count → variants tab); incremented at
   *  pack-out time. Migration 0076. */
  quantityOnHand?: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** A packaging component on a variant size — box + cushion + paper
 *  liners + sticker, etc. Each row points at a `packaging` entry that
 *  carries its own stock + purchase history. `isPrimary` marks the
 *  outer container that drives display + shelf-life. Migration 0064. */
export interface VariantPackagingComponent {
  id?: string;
  variantPackagingId: string;
  packagingId: string;
  qtyPerVariant: number;
  sortOrder: number;
  isPrimary: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/** A curated variant's product-in-size composition. For each variant
 *  size, one row per distinct product with its quantity. Sum of qty
 *  must equal the packaging's capacity (enforced in UI). */
export interface VariantPackagingProduct {
  id?: string;
  variantPackagingId: string;
  productId: string;
  qty: number;
  sortOrder: number;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * A point-in-time snapshot of the margin for one (variant, packaging) combination.
 * Created when the sell price is changed, when ingredient/coating/packaging costs change,
 * or on manual recalculation. Used to draw the pricing history chart.
 */
export interface VariantPricingSnapshot {
  id?: string;
  variantId: string;
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
  /** How far ahead Regenerate tries to merge new demand into existing
   *  forward-filled days before switching to reverse-scheduling. 1 / 2
   *  / 4 weeks. Default 2. Migration 0043. */
  mergingWindowWeeks?: 1 | 2 | 4;
  updatedAt?: Date;
}

// --- Stock adjustments (opening balance + corrections) ---

export const STOCK_ADJUSTMENT_ITEM_TYPES = [
  "product", "variant", "filling", "packaging", "ingredient",
] as const;
export type StockAdjustmentItemType = (typeof STOCK_ADJUSTMENT_ITEM_TYPES)[number];

export const STOCK_ADJUSTMENT_ITEM_TYPE_LABELS: Record<StockAdjustmentItemType, string> = {
  product: "Finished product",
  variant: "Box / variant",
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
  /** Variant used as this customer's default price list. When a
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
  // --- Production brain additions (phase 1) ---
  /** Skill tags used to gate step assignment (e.g. ["tempering",
   *  "shelling", "packing", "decoration", "cooking"]). Engine refuses
   *  to assign a step to a person missing its required skill. */
  skills?: string[];
  /** Where this person mainly works — production lane, shop lane, or
   *  both. Engine uses it to bias assignment + capacity calc. */
  primaryRole?: PrimaryRole;
  /** Free-form per-weekday schedule overrides (e.g. "Mon/Wed full
   *  day, Tue/Thu shop AM then production PM"). JSON shape is
   *  intentionally open so UI can evolve without migrations. */
  weeklyCustomSchedule?: Record<string, unknown>;
  /** Admin-role flag. True for owners / managers — unlocks analytics,
   *  full cost breakdown, contamination + HACCP incident writes. */
  isAdmin?: boolean;
  /** Labour rate used for per-batch / per-day cost calculations. Null
   *  means the person doesn't feed into labour cost (volunteer, owner
   *  who doesn't self-invoice). Euros per hour. */
  hourlyCostEuros?: number | null;
  /** Unpaid break / lunch subtracted from the daily working window
   *  when computing capacity. Minutes. */
  breakMinutesPerDay?: number | null;
  /** Optional contact fields — surfaced on the team card, not required
   *  for scheduling. */
  contactEmail?: string | null;
  contactPhone?: string | null;
  /** Contract classification — affects nothing automatic today, useful
   *  for reports and quick-glance labels on the people list. */
  contractType?: "full_time" | "part_time" | "contractor" | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/** A person-specific unavailability window (vacation, doctor's appointment,
 *  sick day). Workshop-wide closures live on `EventCalendarEntry` with
 *  kind='blocked' so they apply to everyone at once. */
export const ABSENCE_TYPES = [
  "vacation",
  "sick",
  "appointment",
  "course_taught",
  "personal",
  "other",
] as const;
export type AbsenceType = (typeof ABSENCE_TYPES)[number];

export const ABSENCE_TYPE_LABELS: Record<AbsenceType, string> = {
  vacation: "Vacation",
  sick: "Sick",
  appointment: "Appointment",
  course_taught: "Teaching a course",
  personal: "Personal",
  other: "Other",
};

export interface PersonUnavailability {
  id?: string;
  personId: string;
  /** Inclusive start date, ISO-date string. */
  startDate: string;
  /** Inclusive end date, ISO-date string. Must be ≥ startDate. */
  endDate: string;
  /** What kind of absence — drives colouring in the calendar and the
   *  reason in scheduler warnings. Optional so existing rows stay
   *  valid until an editor visits them. */
  absenceType?: AbsenceType | null;
  /** Approval state — false for "requested, pending sign-off". Default
   *  true because most entries are recorded after the fact. */
  approved?: boolean;
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

export const ORDER_STATUSES = ["pending", "ready_to_pack", "in_production", "done", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Pending",
  ready_to_pack: "Ready to pack",
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
  // --- Production brain additions (phase 1) ---
  /** Pickup (customer comes), delivery (we deliver locally), or ship
   *  (courier). Drives pack buffer + lead-day expectations in the
   *  scheduler. Legacy rows default to 'pickup'. */
  fulfillmentType?: FulfillmentType;
  /** Manual override for fulfillment lead days (courier transit etc.)
   *  baked into backward-scheduling math. 0 = ready on deadline day. */
  fulfillmentLeadDays?: number;
  /** Rush flag — brain auto-places + displaces lower tiers per
   *  priority ladder on save. */
  timeSensitive?: boolean;
  rushReason?: string;
  /** Link back to the quote that was accepted to create this order. */
  quoteId?: string;
  /** Price-list snapshot at save time. Nullable for shop/online
   *  orders that use global retail pricing. */
  priceListId?: string;
  /** Snapshot totals (net/gross/tax). Stored at save time so later
   *  price changes don't retroactively affect the order. */
  totalNet?: number;
  totalGross?: number;
  taxTotal?: number;
  /** True when the customer said "about next week" rather than a
   *  fixed date. Planner draws these blocks dashed and treats the
   *  deadline as flexible within a ±1-week window. */
  isApproxDeadline?: boolean;
  /** External invoice reference — Shopify order id (#1001) or
   *  HelloCash invoice number, added manually after the invoice is
   *  issued externally. Used to reconcile payment status. */
  invoiceExternalRef?: string;
  /** Replace + Credit flow — set on the NEW order that re-ships a
   *  broken/lost/complaint shipment. Points at the original order. */
  replacesOrderId?: string;
  /** Free-text reason stamped on the replacement order. */
  replacementReason?: string;
  /** HelloCash invoice number (or similar) of the credit note issued
   *  to the customer for the original order. Lives on the ORIGINAL
   *  order so bookkeeping can tie the two records together. */
  creditReference?: string;
  /** When true, this order's batches stay separate from other
   *  production for the same products — batches don't share moulds
   *  or get folded into replen plans. Mig 0086. */
  isolated?: boolean;
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

/** Default fulfilment mode per order channel. Online + shop sales pull
 *  from existing shop stock (borrow); B2B + event orders create fresh
 *  production demand (produce). Override per line in the order form
 *  when needed (e.g. a B2B walk-in that takes shelf stock). */
export const CHANNEL_FULFILMENT_DEFAULTS: Record<OrderChannel, FulfilmentMode> = {
  b2b:    "produce",
  event:  "produce",
  online: "borrow",
  shop:   "borrow",
};

/** Customer-facing variant line on an order. The price the customer
 *  sees per unit. Brain ignores this — production demand still flows
 *  via `orderItems`. Saving a variant line auto-creates derived
 *  orderItems (one per product in the variant's composition) so the
 *  scheduler/shopping picks them up. Migration 0068. */
export interface OrderVariantLine {
  id?: string;
  orderId: string;
  variantId: string;
  variantPackagingId?: string | null;
  quantity: number;
  /** Gross unit price as customer pays — what shows on the invoice. */
  unitPrice: number;
  sortOrder: number;
  notes?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

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
  /** Variant this line originated from. Metadata only — production
   *  reads productId + qty and ignores this. Lets the order UI group
   *  lines by their originating variant/size and show the right price
   *  breakdown. */
  variantId?: string;
  /** The specific variant size (packaging row) this line came from.
   *  Metadata only — production ignores it. */
  variantPackagingId?: string;
  // --- Production brain additions (phase 1) ---
  /** Explicit net/gross snapshot. `unitPrice` above stays the
   *  writable source; these cache net/gross after VAT is applied so
   *  analytics / invoices don't recompute on every render. */
  unitPriceNet?: number;
  unitPriceGross?: number;
  /** Per-line discount percent [0..100]. Applied on top of the
   *  resolved unit price. */
  discountPercent?: number;
  /** Per-line VAT rate (percent). Mirrors legacy `vatRate` with an
   *  explicit name for UI forms that need both net + gross. */
  taxRatePercent?: number;
  /** Packaging the product ships in on this order line — e.g. the
   *  specific gift box or sleeve chosen for B2B / online orders. */
  packagingId?: string;
}

/**
 * One batch's appearance on one production day. `stepIds` lists every
 * productionStep.id that will be run today for this batch. Step
 * progress itself lives on the batch (planStepStatus), not here — this
 * table only says "which steps happen when". Lives in migration 0043.
 */
export interface ProductionDayLineItem {
  id?: string;
  productionDayId: string;
  planId: string;
  stepIds: string[];
  plannedMinutes: number;
  sortOrder: number;
  /** Set when the day's work has actually been performed; flipped by
   *  the day-detail drawer's "Mark as worked" action so the auto-planner
   *  treats it as historical. Migration 0087. */
  actuallyWorked?: boolean;
  /** Per-line-item lock. When true, this batch's appearance on this
   *  specific day is frozen — other days for the same plan stay
   *  freely draggable. Replaces the old plan-level lock that used
   *  productionPlans.pinnedDate as a coarse signal. Migration 0095. */
  locked?: boolean;
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

/** One row per calendar day the workshop is open or has scheduled
 *  work. Two creation paths share this row:
 *    - the scheduler (migration 0043) inserts a row with status='draft'
 *      when it places at least one batch's step on that date;
 *    - the dashboard's "Open Production" action sets openedAt and
 *      flips status to 'active'; "Close Production" sets closedAt and
 *      status='done'.
 *  openedAt is therefore optional (absent on scheduler-created rows
 *  that haven't been physically opened yet). */
export interface ProductionDay {
  id?: string;
  /** ISO-date string "YYYY-MM-DD". Unique per row. */
  date: string;
  /** Scheduling / HACCP lifecycle. draft = planned only; active = day
   *  opened and work in progress; done = closed. */
  status: "draft" | "active" | "done";
  openedAt?: Date;
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

/** Free-text notes scribbled throughout a production day — one row per
 *  productionDay. Distinct from `productionDays.summary` (close-of-day
 *  snapshot) so mid-day edits don't collide with the close-out write.
 *  Migration 0091. */
export interface ProductionDayNotes {
  id?: string;
  productionDayId: string;
  notes: string;
  updatedAt?: Date;
  updatedBy?: string;
}

export const CALIBRATION_OUTCOMES = ["ok", "out_of_tolerance", "adjusted", "retired"] as const;
export type CalibrationOutcome = (typeof CALIBRATION_OUTCOMES)[number];

export const CALIBRATION_CADENCES = ["monthly", "quarterly", "annual", "ad_hoc"] as const;
export type CalibrationCadence = (typeof CALIBRATION_CADENCES)[number];

/** Periodic equipment calibration event — scale tare, thermometer
 *  ice-point verification, etc. Distinct from HaccpTemperatureLog
 *  (daily fridge/freezer readings). Migration 0092. */
export interface Calibration {
  id?: string;
  equipmentId: string;
  calibratedAt: Date;
  calibratedBy?: string;
  outcome: CalibrationOutcome;
  cadence: CalibrationCadence;
  nextDueAt?: Date;
  referenceValue?: number;
  measuredValue?: number;
  deltaTolerance?: number;
  notes?: string;
  createdAt?: Date;
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
  /** Only set when location === 'allocated' AND it's a customer-order reservation. */
  orderId?: string;
  /** Only set when location === 'allocated' AND it's a PO-driven reservation. */
  productionOrderId?: string;
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
  /** Set when the movement reserves pieces against an internal
   *  productionOrder (PO Maca, replen bucket etc). Mutually exclusive
   *  with orderId in practice — a row tags either a customer order
   *  or a production order, never both. */
  productionOrderId?: string;
  /** Set when pieces are consumed by box-up into a variant size, or
   *  when a variant unit is sold / returned. Lets HACCP trace
   *  bars-from-batch-X → boxes-of-variant-Y in either direction
   *  (mig 0084). */
  variantPackagingId?: string;
  reason?: StockMovementReason | string;
  movedBy?: string;
  notes?: string;
  movedAt: Date;
}

/** Per-variant, per-location pre-built box inventory. Mirrors
 *  `stockLocations` shape but keys on variantPackagingId. Mig 0084. */
export interface VariantStockLocation {
  id?: string;
  variantPackagingId: string;
  location: StockLocation;
  orderId?: string | null;
  productionOrderId?: string | null;
  quantity: number;
  updatedAt?: Date;
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

// =============================================================
// Production Brain — Phase 1 types
// =============================================================

export const FULFILLMENT_TYPES = ["pickup", "delivery", "ship"] as const;
export type FulfillmentType = (typeof FULFILLMENT_TYPES)[number];

export const PRIMARY_ROLES = ["production", "shop", "both", "other"] as const;
export type PrimaryRole = (typeof PRIMARY_ROLES)[number];

export const REPLENISHMENT_REASONS = [
  "auto-replen",
  "campaign-prep",
  "custom-box-buffer",
  "manual",
] as const;
export type ReplenishmentReason = (typeof REPLENISHMENT_REASONS)[number];

export const REPLENISHMENT_STATUSES = ["pending", "scheduled", "dismissed"] as const;
export type ReplenishmentStatus = (typeof REPLENISHMENT_STATUSES)[number];

/** Engine proposal that a product needs a fresh batch soon.
 *  Never auto-placed — lives in the planner sidebar until the user
 *  drags it onto a day (→ 'scheduled') or dismisses it. */
export interface ReplenishmentProposal {
  id?: string;
  productId: string;
  /** Batch size suggestion in whole pieces. Engine rounds to the
   *  product's mould floor before writing. */
  suggestedBatchSize: number;
  /** ISO date 'YYYY-MM-DD' — latest day production can start without
   *  breaching the min_stock projection. */
  earliestNeededDate: string;
  priorityTier: 1 | 2 | 3;
  reason: ReplenishmentReason;
  status: ReplenishmentStatus;
  /** Set when status = 'scheduled' — FK to the productionPlan the
   *  user dragged the proposal onto. */
  scheduledPlanId?: string;
  /** When status = 'dismissed', suppress re-proposal until this date. */
  dismissedUntil?: string;
  /** Stock location the projection was evaluated against. Nullable
   *  for global (cross-location) proposals. */
  locationId?: string;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Rolling demand signal per product per location per day. Sourced
 *  from HelloCash sales CSV, Shopify order CSV, manual shop
 *  deductions, and custom-box pick logs. */
export interface DailySellEstimate {
  id?: string;
  productId: string;
  locationId: string;
  /** ISO date 'YYYY-MM-DD' — one row per product/location/day. */
  date: string;
  soldCount: number;
  customBoxPickCount: number;
  /** 30-day rolling mean of soldCount + customBoxPickCount,
   *  recomputed on each import. */
  rollingAvg30d: number;
  updatedAt?: Date;
}

export const CAMPAIGN_TYPES = [
  "seasonal",
  "limited",
  "collaboration",
  "launch",
  /** Market booth / fair / pop-up where Manuela sells in person.
   *  Drives a target stock-on-hand by the event date, then sales come
   *  in via the counter on the day. Distinct from a customer-event
   *  order (which has a committed €). */
  "market_event",
] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];

export const CAMPAIGN_STATUSES = [
  "planned",
  "active",
  "wrapping",
  "done",
  "cancelled",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** Named production campaign: Easter collection, Mother's Day box,
 *  new limited bonbon launch. Engine auto-proposes ramp-up
 *  replenishment batches (reason='campaign-prep') between
 *  `productionStartDate` and `startDate`. */
export const PRODUCTION_ORDER_CHANNELS = ["restock", "campaign_run"] as const;
export type ProductionOrderChannel = (typeof PRODUCTION_ORDER_CHANNELS)[number];

export const PRODUCTION_ORDER_STATUSES = [
  "pending",
  "in_production",
  "done",
  "cancelled",
] as const;
export type ProductionOrderStatus = (typeof PRODUCTION_ORDER_STATUSES)[number];

/** Internal production order — sibling to customer `Order` but the
 *  demand source is the workshop itself: restocking minimums, market
 *  events, campaign runs, launches. Drives the brain alongside
 *  customer orders. Migration 0066. */
export interface ProductionOrder {
  id?: string;
  name?: string;
  /** ISO date 'YYYY-MM-DD' — when these pieces need to be ready. */
  dueDate: string;
  status: ProductionOrderStatus;
  channel: ProductionOrderChannel;
  /** Optional link to a campaign for context + roll-up. Required when
   *  channel = 'campaign_run' (DB check). */
  campaignId?: string | null;
  /** Where produced pieces should land — 'store' / 'production' /
   *  'storage'. Optional; app defaults: restock → triggering location,
   *  campaign_run → production. */
  targetLocation?: string | null;
  notes?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ProductionOrderItem {
  id?: string;
  productionOrderId: string;
  productId: string;
  targetUnits: number;
  sortOrder: number;
  notes?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * PO-line ↔ batch allocation. Mirrors OrderPlanLink for the
 * productionOrders demand stream. Added with mig 0094 so parked drafts
 * that allocate PO lines can be persisted/reloaded without the brittle
 * notes-text parse path used in v1.
 */
export interface PoPlanLink {
  id?: string;
  productionOrderItemId: string;
  planId: string;
  allocatedQuantity: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface Campaign {
  id?: string;
  name: string;
  type: CampaignType;
  /** ISO date 'YYYY-MM-DD' — when the campaign goes live (sale window). */
  startDate: string;
  /** ISO date 'YYYY-MM-DD' — last day in the sale window. */
  endDate: string;
  /** ISO date 'YYYY-MM-DD' — first day production ramp-up should start.
   *  Null = use a default lead based on targetTotalUnits. */
  productionStartDate?: string;
  /** Aggregate unit target across all included products. Optional —
   *  use `productTargets` for per-product breakdown when each item
   *  needs its own target quantity. */
  targetTotalUnits?: number;
  /** Per-product target units. Map of `productId → units`. Drives
   *  campaign-replenishment scheduling per product. Migration 0063.
   *  Legacy: new Volume planning writes `variantPackagingTargets`
   *  instead and expands at PO-creation time. */
  productTargets?: Record<string, number>;
  /** Per-variant-size target units. Map of `variantPackagingId → units`
   *  (count of boxes / sized units). PO creation expands via
   *  variantPackagingProducts.qty into per-product piece counts.
   *  Migration 0093. */
  variantPackagingTargets?: Record<string, number>;
  /** Product IDs belonging to this campaign. Stored as array so a
   *  single read pulls the full set. */
  productIds: string[];
  status: CampaignStatus;
  /** Optional color tag for calendar display (maps to --plan-campaign
   *  variants). */
  colorTag?: string;
  notes?: string;
  /** When true, this campaign's batches stay separate from other
   *  production for the same products — batches don't share moulds
   *  or get folded into replen plans. Mig 0086. */
  isolated?: boolean;
  /** Manual revenue goal for the campaign (currency units, not cents).
   *  Compared against projected revenue (Σ target_units × list price)
   *  on the /campaigns/[id] Volume planning widget. Mig 0088. */
  revenueTarget?: number;
  /** Free-text reference to a linked Business Hub campaign. When set,
   *  a follow-up sync hook can push projected revenue back to the hub.
   *  Mig 0088. */
  businessHubCampaignId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const MOULD_STATES = [
  "available",
  "loaded",
  "filled",
  "sealed",
  "needs-wash",
  "in-deep-wash",
  "retired",
  "broken",
] as const;
export type MouldState = (typeof MOULD_STATES)[number];

/** Single physical mould instance tracked by the mouldPool table.
 *  The `moulds` table describes the *type* (cavity count, shape).
 *  mouldPool tracks each individual copy — usage counter, current
 *  state, deep-wash schedule. */
export interface MouldPoolInstance {
  id?: string;
  mouldId: string;
  instanceIndex: number;
  planId?: string;
  phase?: string;
  occupiedSince?: Date;
  expectedFreeAt?: Date;
  usesSinceDeepWash: number;
  deepWashThreshold: number;
  currentState: MouldState;
  stateChangedAt?: Date;
  retired: boolean;
  notes?: string;
}

// =============================================================
// Production Brain — Phase 2 types (equipment + mould log + staff)
// =============================================================

export const EQUIPMENT_INSTANCE_STATUSES = [
  "idle",
  "running",
  "maintenance",
  "retired",
] as const;
export type EquipmentInstanceStatus = (typeof EQUIPMENT_INSTANCE_STATUSES)[number];

export const EQUIPMENT_INSTANCE_LOCATIONS = [
  "production",
  "shop",
  "storage",
  "other",
] as const;
export type EquipmentInstanceLocation = (typeof EQUIPMENT_INSTANCE_LOCATIONS)[number];

/** Physical copy of an equipment type the workshop owns. The
 *  `equipment` table stays the type-level descriptor (e.g.
 *  "Tempering machine, 15kg"); this table represents each actual
 *  machine on the floor (brand, model, serial, current state). */
export interface EquipmentInstance {
  id?: string;
  equipmentId: string;
  name: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  capacityKg?: number;
  location?: EquipmentInstanceLocation;
  status: EquipmentInstanceStatus;
  notes?: string;
  archived: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export const MACHINE_LOAD_STATUSES = [
  "in_use",
  "idle",
  "draining",
  "switched",
] as const;
export type MachineLoadStatus = (typeof MACHINE_LOAD_STATUSES)[number];

/** What chocolate is currently loaded in which tempering machine /
 *  melting pot. One row per active load. Aging is computed from
 *  (now - loadedAt) and flagged once it exceeds
 *  agingAlertThresholdDays. */
export interface MachineLoad {
  id?: string;
  equipmentInstanceId: string;
  ingredientId: string;
  loadedQuantityG: number;
  remainingQuantityG: number;
  loadedAt: Date;
  lastUsedAt?: Date;
  status: MachineLoadStatus;
  agingAlertThresholdDays: number;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const COLD_STORAGE_LOCATIONS = [
  "production",
  "shop",
  "storage",
  "other",
] as const;
export type ColdStorageLocation = (typeof COLD_STORAGE_LOCATIONS)[number];

export const COLD_STORAGE_TYPES = ["fridge", "freezer", "ambient"] as const;
export type ColdStorageType = (typeof COLD_STORAGE_TYPES)[number];

/** A fridge, freezer, or ambient storage unit tracked for HACCP.
 *  Temperature readings join on `coldStorageUnitId` (added by the
 *  phase-3 migration). */
export interface ColdStorageUnit {
  id?: string;
  name: string;
  location: ColdStorageLocation;
  type: ColdStorageType;
  targetTempMinC?: number;
  targetTempMaxC?: number;
  requiresTempCheck: boolean;
  checkFrequencyPerDay: number;
  archived: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/** One row per mould instance cycle. Written on phase-change
 *  transitions so we keep full traceability history after the
 *  batch is done. */
export interface MouldUsageLog {
  id?: string;
  mouldPoolId: string;
  planId?: string;
  startedAt: Date;
  freedAt?: Date;
  cycleCompleted: boolean;
  deepWashDone: boolean;
  notes?: string;
  createdAt?: Date;
}

export const SHIFT_LOCATIONS = ["production", "shop", "course", "other"] as const;
export type ShiftLocation = (typeof SHIFT_LOCATIONS)[number];

/** Per-person per-day shift record. Clock-in/out timestamps power
 *  labor cost per batch and daily capacity consumption. */
export interface StaffShift {
  id?: string;
  personId: string;
  shiftDate: string;
  clockInAt: Date;
  clockOutAt?: Date;
  breakMinutes: number;
  location?: ShiftLocation;
  linkedPlanIds: string[];
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const AVAILABILITY_EXCEPTION_TYPES = [
  "vacation",
  "sick",
  "course-leading",
  "training",
  "partial",
  "other",
] as const;
export type AvailabilityExceptionType =
  (typeof AVAILABILITY_EXCEPTION_TYPES)[number];

/** Richer alternative to the legacy `personUnavailability` table —
 *  supports partial-day exceptions, course leading, training, etc.
 *  Legacy table kept; new UI writes here. */
export interface PersonAvailabilityException {
  id?: string;
  personId: string;
  dateFrom: string;
  dateTo: string;
  type: AvailabilityExceptionType;
  allDay: boolean;
  hoursFrom?: string;
  hoursTo?: string;
  approved: boolean;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// =============================================================
// Production Brain — Phase 3 types (stock, HACCP, CSV imports)
// =============================================================

export const PRODUCT_STOCK_SECONDS_REASONS = [
  "broken",
  "flawed",
  "near-expiry",
  "other",
] as const;
export type ProductStockSecondsReason =
  (typeof PRODUCT_STOCK_SECONDS_REASONS)[number];

/** Finished-goods stock row per batch per location. Enables FIFO
 *  allocation + shelf-life countdown + seconds tagging. */
export interface ProductStock {
  id?: string;
  productId: string;
  planId?: string;
  quantityPieces: number;
  lockedPieces: number;
  locationId: string;
  producedAt?: Date;
  bestBeforeDate?: string;
  lotNumber?: string;
  isSeconds: boolean;
  secondsReason?: ProductStockSecondsReason;
  discountPercent?: number;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const STOCK_TRANSFER_ENTITY_TYPES = [
  "ingredient",
  "filling",
  "product",
  "packaging",
] as const;
export type StockTransferEntityType =
  (typeof STOCK_TRANSFER_ENTITY_TYPES)[number];

export const STOCK_TRANSFER_REASONS = [
  "auto-replenish",
  "shop-request",
  "manual",
  "return",
  "waste",
  "gift",
  "tasting",
  "event_sample",
  "staff",
  "sold",
  "custom_box",
] as const;
export type StockTransferReason = (typeof STOCK_TRANSFER_REASONS)[number];

export const STOCK_TRANSFER_REASON_LABELS: Record<StockTransferReason, string> = {
  "auto-replenish": "Auto replenish",
  "shop-request":   "Shop request",
  manual:           "Manual",
  return:           "Return",
  waste:            "Waste",
  gift:             "Gift / giveaway",
  tasting:          "Tasting",
  event_sample:     "Event sample",
  staff:            "Staff / owner",
  sold:             "Sold (counter walk-in)",
  custom_box:       "Used in custom box",
};

/** Movement of any stock entity between two locations. */
export interface StockTransfer {
  id?: string;
  entityType: StockTransferEntityType;
  entityId: string;
  quantity: number;
  fromLocationId?: string;
  toLocationId: string;
  transferredAt: Date;
  transferredByPersonId?: string;
  reason: StockTransferReason;
  /** Per-piece sale price in euros, captured for sold rows so the
   *  weekly sales report can roll up revenue without joining orders.
   *  Null for non-revenue movements (waste, transfer, etc). */
  unitPrice?: number | null;
  notes?: string;
  createdAt?: Date;
}

/** HACCP-compliant temperature reading against a cold storage unit. */
export interface TemperatureReading {
  id?: string;
  coldStorageUnitId: string;
  readingC: number;
  loggedAt: Date;
  loggedByPersonId?: string;
  inRange?: boolean;
  actionTaken?: string;
  productionDayId?: string;
  notes?: string;
  createdAt?: Date;
}

/** Out-of-range incident opened against a reading. */
export interface HaccpIncident {
  id?: string;
  coldStorageUnitId: string;
  temperatureReadingId?: string;
  startedAt: Date;
  resolvedAt?: Date;
  affectedStockNotes?: string;
  actionTaken?: string;
  resolvedByPersonId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const CSV_IMPORT_SOURCES = [
  "shopify-orders",
  "shopify-stock",
  "hellocash-sales",
  "hellocash-inventory",
  "other",
] as const;
export type CsvImportSource = (typeof CSV_IMPORT_SOURCES)[number];

export const CSV_IMPORT_STATUSES = [
  "pending",
  "processing",
  "ok",
  "partial",
  "failed",
] as const;
export type CsvImportStatus = (typeof CSV_IMPORT_STATUSES)[number];

/** Log row for every CSV upload. */
export interface CsvImport {
  id?: string;
  source: CsvImportSource;
  filename?: string;
  uploadedAt: Date;
  uploadedByPersonId?: string;
  rowsTotal: number;
  rowsImported: number;
  rowsSkipped: number;
  rowsFailed: number;
  status: CsvImportStatus;
  errorSummary?: string;
  dryRun: boolean;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const EXTERNAL_SKU_SOURCES = ["shopify", "hellocash", "other"] as const;
export type ExternalSkuSource = (typeof EXTERNAL_SKU_SOURCES)[number];

/** Map external SKU → internal product/packaging row. Populated
 *  during CSV import dry-runs when user resolves unmapped rows. */
export interface ExternalSkuMapping {
  id?: string;
  source: ExternalSkuSource;
  externalSku: string;
  internalProductId?: string;
  internalPackagingId?: string;
  createdAt?: Date;
}

export const LOCATION_MINIMUM_ENTITY_TYPES = [
  "product",
  "ingredient",
  "filling",
  "packaging",
] as const;
export type LocationMinimumEntityType =
  (typeof LOCATION_MINIMUM_ENTITY_TYPES)[number];

// =============================================================
// Production Brain — Phase 4 types (notifications)
// =============================================================

export const NOTIFICATION_TYPES = [
  "tier_change",
  "surplus_routing",
  "ingredient_late",
  "ingredient_shortage",
  "ingredient_price_change",
  "campaign_conflict",
  "campaign_ingredient_advance",
  "filling_precook",
  "filling_expiry_warning",
  "transfer_proposal",
  "stock_dip",
  "near_expiry",
  "markdown_suggestion",
  "tasting_allocation",
  "replenishment_proposal",
  "haccp_incident_open",
  "contamination_flag",
  "machine_aging",
  "mould_deep_wash",
  "overtime_warning",
  "quote_expiring",
  "subscription_cycle_reminder",
  "capacity_risk",
  "rush_impossible",
  "replacement_issued",
  "other",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_URGENCIES = [
  "critical",
  "high",
  "normal",
  "low",
] as const;
export type NotificationUrgency = (typeof NOTIFICATION_URGENCIES)[number];

export const NOTIFICATION_STATUSES = [
  "open",
  "snoozed",
  "approved",
  "dismissed",
  "expired",
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

// =============================================================
// Production Brain — Phase 5 types (B2B price lists)
// =============================================================

/** Named wholesale price list. Assigned to a customer via
 *  customers.defaultPriceListId (existing). Each list holds
 *  zero-or-more PriceListItem rows — product-, collection-, or
 *  tag-scoped overrides. */
export interface PriceList {
  id?: string;
  name: string;
  description?: string;
  validFrom?: string;
  validTo?: string;
  defaultDiscountPercent?: number;
  archived: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export const SUBSCRIPTION_FREQUENCIES = [
  "monthly",
  "bimonthly",
  "quarterly",
  "seasonal",
] as const;
export type SubscriptionFrequency = (typeof SUBSCRIPTION_FREQUENCIES)[number];

export const SUBSCRIPTION_RUN_STATUSES = [
  "planned",
  "in-production",
  "ready",
  "shipped",
  "cancelled",
] as const;
export type SubscriptionRunStatus = (typeof SUBSCRIPTION_RUN_STATUSES)[number];

/** Recurring subscription box template. Each run (ship cycle)
 *  references a template + has its own subscriber count + contents. */
export interface SubscriptionTemplate {
  id?: string;
  name: string;
  packagingId?: string;
  pieceCount: number;
  frequency: SubscriptionFrequency;
  active: boolean;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** One cycle of a subscription — fixed ship date, subscriber count,
 *  chosen contents. Brain schedules production backward from
 *  scheduledShipDate using templateId + pieceCount × subscriberCount. */
export interface SubscriptionRun {
  id?: string;
  templateId: string;
  scheduledShipDate: string;
  subscriberCount: number;
  selectedProductIds: string[];
  status: SubscriptionRunStatus;
  alertSentAt?: Date;
  productionPlanIds: string[];
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** One rule inside a price list — can scope by product, variant
 *  (collection), or tag. Discount % OR fixed price (mutually
 *  exclusive, enforced by DB check). The original questionnaire
 *  talked about 'collection' but the active schema calls them
 *  variants since migration 0047. */
export interface PriceListItem {
  id?: string;
  priceListId: string;
  productId?: string;
  variantId?: string;
  tag?: string;
  discountPercent?: number;
  fixedPrice?: number;
  minQuantity?: number;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Brain-surfaced decision / alert awaiting user response. Lives in
 *  the notification center (bell icon + dedicated page). Popups
 *  fire only for urgency='critical'. Everything else queues here. */
export interface Notification {
  id?: string;
  type: NotificationType;
  urgency: NotificationUrgency;
  status: NotificationStatus;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  snoozedUntil?: Date;
  approvedAt?: Date;
  dismissedAt?: Date;
  approvedByPersonId?: string;
  adminOnly: boolean;
  actionLabel?: string;
  actionPayload?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Generic per-entity per-location min/target/max. Supersedes the
 *  channel-based `stockLocationMinimum` for any new feature. Legacy
 *  table kept for backwards compatibility. */
export interface LocationStockMinimum {
  id?: string;
  entityType: LocationMinimumEntityType;
  entityId: string;
  locationId: string;
  minQuantity: number;
  targetQuantity?: number;
  maxQuantity?: number;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
