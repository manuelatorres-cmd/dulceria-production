import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase, newId } from "@/lib/supabase";
import { queryClient } from "@/lib/query-client";
import { assertOk, assertOkMaybe } from "@/lib/supabase-query";
import type { Ingredient, Product, ProductCategory, Filling, FillingCategory, ProductFilling, FillingIngredient, Mould, ProductionPlan, PlanProduct, PlanStepStatus, UserPreferences, ProductFillingHistory, IngredientPriceHistory, ProductCostSnapshot, Experiment, ExperimentIngredient, Packaging, PackagingOrder, PackagingConsumption, ShoppingItem, Variant, VariantProduct, VariantPackaging, VariantPackagingComponent, VariantPackagingProduct, VariantStockLocation, ProductionOrder, ProductionOrderItem, OrderVariantLine, VariantPricingSnapshot, DecorationMaterial, DecorationCategory, ShellDesign, FillingStock, IngredientCategory, IngredientStock, IngredientStockMovement, CapacityConfig, EventCalendarEntry, Person, PersonUnavailability, Equipment, ProductionStep, Order, OrderChannel, OrderStatus, OrderItem, OrderPlanLink, PoPlanLink, StockLocation, StockLocationRow, StockMovement, StockLocationMinimum, StockMovementReason, WasteLogEntry, Customer, CustomerContact, CustomerFollowup, Quote, OrderBox, ProductionDay, ProductionDayLineItem, HaccpTemperatureLog, StockAdjustment, StockAdjustmentItemType, StockAdjustmentReason, OrderPackagingLine, ShopOpeningHours, ShopClosure, CustomerProductPrice, ReplenishmentProposal, ReplenishmentStatus, DailySellEstimate, Campaign, CampaignStatus, MouldPoolInstance, EquipmentInstance, MachineLoad, ColdStorageUnit, MouldUsageLog, StaffShift, PersonAvailabilityException, ProductStock, StockTransfer, StockTransferEntityType, TemperatureReading, HaccpIncident, CsvImport, ExternalSkuMapping, LocationStockMinimum, LocationMinimumEntityType, Notification, NotificationStatus, NotificationUrgency, NotificationType, PriceList, PriceListItem, SubscriptionTemplate, SubscriptionRun, ProductionDayNotes, Calibration } from "@/types";
import { DEFAULT_PRODUCT_CATEGORIES, DEFAULT_INGREDIENT_CATEGORIES, DEFAULT_COATINGS, SHELF_STABLE_CATEGORIES, CHANNEL_FULFILMENT_DEFAULTS, costPerGram as deriveIngredientCostPerGram, hasPricingData, type MarketRegion, type CurrencyCode, type FillMode, type FulfilmentMode, getCurrencySymbol } from "@/types";
import { validateCategoryRange } from "@/lib/productCategories";
import { isCompositionDraft } from "@/lib/manual-planner/is-composition-draft";
import { calculateProductCost, buildIngredientCostMap, serializeBreakdown, deriveShellPercentageFromGrams } from "@/lib/costCalculation";

// --- Ingredients ---

export function useIngredients(includeArchived = false): Ingredient[] {
  const { data } = useQuery({
    queryKey: ["ingredients", { includeArchived }],
    queryFn: async () => {
      const rows = assertOk(await supabase.from("ingredients").select("*"));
      return (rows as Ingredient[])
        .filter((i) => includeArchived || !i.archived)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    },
  });
  return data ?? [];
}

export function useIngredient(id: string | undefined): Ingredient | undefined {
  const { data } = useQuery({
    queryKey: ["ingredients", id],
    enabled: !!id,
    queryFn: async () => {
      const row = assertOkMaybe(
        await supabase.from("ingredients").select("*").eq("id", id!).maybeSingle(),
      );
      return row as Ingredient | null;
    },
  });
  return data ?? undefined;
}

/** Optional extras the purchase form can pass to record a richer
 *  purchase log (supplier, VAT, invoice #, and the "update default"
 *  flag). Existing callers that don't care about the log stay on the
 *  default — updateDefault is true so the ingredient row's purchase
 *  fields advance with each save, matching the pre-Phase-8 behaviour. */
export interface SaveIngredientOptions {
  purchaseExtras?: {
    supplier?: string;
    vatRatePercent?: number;
    invoiceNumber?: string;
    note?: string;
  };
  /** When false, the ingredient's purchase-default fields are NOT
   *  updated — we just append a history row. Use this when the user
   *  wants to log a one-off purchase without changing the go-forward
   *  default shown in the pricing tab. */
  updateDefault?: boolean;
}

export async function saveIngredient(
  ingredient: Omit<Ingredient, "id"> & { id?: string },
  options?: SaveIngredientOptions,
) {
  let savedId: string;
  let priceChanged = false;
  const updateDefault = options?.updateDefault !== false; // default true

  // Drop any `undefined` values before the payload reaches Supabase.
  // The JS client serialises `undefined` as `null` on the wire, which
  // trips NOT-NULL columns (pricingIrrelevant, shellCapable, etc.)
  // whenever a form sends an explicit undefined. Form mappers like
  // `brand: brand.trim() || undefined` are common — rather than fix
  // each one, strip here centrally.
  const stripUndef = <T extends Record<string, unknown>>(obj: T): Partial<T> => {
    const out: Partial<T> = {};
    for (const key in obj) {
      if (obj[key] !== undefined) out[key] = obj[key];
    }
    return out;
  };

  if (ingredient.id) {
    const existing = assertOkMaybe(
      await supabase.from("ingredients").select("*").eq("id", ingredient.id).maybeSingle(),
    ) as Ingredient | null;
    if (existing) {
      priceChanged =
        existing.purchaseCost !== ingredient.purchaseCost ||
        existing.purchaseQty !== ingredient.purchaseQty ||
        existing.purchaseUnit !== ingredient.purchaseUnit ||
        existing.gramsPerUnit !== ingredient.gramsPerUnit;
    }
    // Build the update payload. If the user opted out of updating the
    // go-forward default, strip the purchase fields so the Ingredient
    // row's previous defaults stay in place.
    const payload: Partial<Ingredient> & { updatedAt: Date } = {
      ...ingredient,
      updatedAt: new Date(),
    };
    if (!updateDefault) {
      delete payload.purchaseCost;
      delete payload.purchaseDate;
      delete payload.purchaseQty;
      delete payload.purchaseUnit;
      delete payload.gramsPerUnit;
    }
    const { error } = await supabase
      .from("ingredients")
      .update(stripUndef(payload as Record<string, unknown>))
      .eq("id", ingredient.id);
    if (error) throw error;
    savedId = ingredient.id;
  } else {
    savedId = newId();
    const { error } = await supabase
      .from("ingredients")
      .insert(stripUndef({ ...ingredient, id: savedId, updatedAt: new Date() }));
    if (error) throw error;
    priceChanged = deriveIngredientCostPerGram(ingredient as Ingredient) !== null;
  }

  const affected = assertOk(
    await supabase.from("fillingIngredients").select("fillingId").eq("ingredientId", savedId),
  ) as { fillingId: string }[];
  const fillingIds = [...new Set(affected.map((li) => li.fillingId))];
  await Promise.all(fillingIds.map((id) => updateFillingAllergens(id)));

  if (priceChanged) {
    const savedIngredient = ingredient.id ? ingredient as Ingredient : { ...ingredient, id: savedId } as Ingredient;
    await saveIngredientPriceEntry(savedId, savedIngredient, {
      ...options?.purchaseExtras,
      updatedDefault: updateDefault,
    });
    await computeSnapshotsForAffectedProducts(
      savedId,
      "ingredient_price",
      `${ingredient.name} price updated`,
    );
  }

  queryClient.invalidateQueries({ queryKey: ["ingredients"] });
  queryClient.invalidateQueries({ queryKey: ["ingredient-price-history", savedId] });

  return savedId;
}

export async function deleteIngredient(id: string) {
  const { error } = await supabase.from("ingredients").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["ingredients"] });
}

export interface IngredientDeleteCheck {
  activeFillings: Filling[];
  produced: boolean;
}

export async function checkIngredientBeforeDelete(ingredientId: string): Promise<IngredientDeleteCheck> {
  const lis = assertOk(
    await supabase.from("fillingIngredients").select("fillingId").eq("ingredientId", ingredientId),
  ) as { fillingId: string }[];
  if (lis.length === 0) return { activeFillings: [], produced: false };

  const fillingIds = [...new Set(lis.map((li) => li.fillingId))];
  const fillings = assertOk(
    await supabase.from("fillings").select("*").in("id", fillingIds),
  ) as Filling[];
  const activeFillings = fillings.filter((l) => !l.supersededAt);

  const rls = assertOk(
    await supabase.from("productFillings").select("productId").in("fillingId", fillingIds),
  ) as { productId: string }[];
  let produced = false;
  if (rls.length > 0) {
    const productIds = [...new Set(rls.map((rl) => rl.productId))];
    const counts = await Promise.all(productIds.map(async (id) => {
      const { count, error } = await supabase
        .from("planProducts")
        .select("*", { count: "exact", head: true })
        .eq("productId", id);
      if (error) throw error;
      return count ?? 0;
    }));
    produced = counts.some((c) => c > 0);
  }

  return { activeFillings, produced };
}

export async function archiveIngredient(id: string) {
  const { error } = await supabase.from("ingredients").update({ archived: true }).eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["ingredients"] });
}

export async function unarchiveIngredient(id: string) {
  const { error } = await supabase.from("ingredients").update({ archived: false }).eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["ingredients"] });
}

/** Reactive list of ingredients that can serve as shell chocolates.
 *  Filters purely on `shellCapable === true && !archived`. The old
 *  `category === "Chocolate"` server-side filter was a case-sensitive
 *  string match that excluded ingredients with any non-canonical
 *  category label (empty, "chocolate", "Couverture", imported with
 *  a variant name, etc.). `shellCapable` is the explicit "yes, this
 *  is couverture" flag — trust it and let the category stay free-text. */
export function useShellCapableIngredients(): Ingredient[] {
  const { data } = useQuery({
    queryKey: ["ingredients", "shell-capable"],
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("ingredients").select("*").eq("shellCapable", true),
      );
      return (rows as Ingredient[])
        .filter((i) => !i.archived)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    },
  });
  return data ?? [];
}

// --- Products ---

export function useProductsList(includeArchived = false): Omit<Product, "photo">[] {
  const { data } = useQuery({
    queryKey: ["products", "list", { includeArchived }],
    queryFn: async () => {
      // Exclude the photo column (base64, heavy) in list queries.
      const rows = assertOk(
        await supabase.from("products").select("id, name, popularity, productCategoryId, shellIngredientId, shellFillingId, shellPercentage, fillMode, coating, productType, tags, notes, shelfLifeWeeks, aliases, stockCountedAt, defaultMouldId, defaultBatchQty, shellDesign, stepDurationOverrides, vegan, excludeFromReplen, archived, createdAt, updatedAt"),
      ) as Omit<Product, "photo">[];
      return rows
        .filter((r) => includeArchived || !r.archived)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  return data ?? [];
}

export function useProduct(id: string | undefined): Product | undefined {
  const { data } = useQuery({
    queryKey: ["products", id],
    enabled: !!id,
    queryFn: async () => {
      const row = assertOkMaybe(
        await supabase.from("products").select("*").eq("id", id!).maybeSingle(),
      );
      return row as Product | null;
    },
  });
  return data ?? undefined;
}

/** Append one or more aliases to a product (deduped, case-insensitive
 *  on the trim-stripped value). No-op when nothing new. Used by the
 *  Shopify importer to remember manual mappings. */
export async function appendProductAliases(productId: string, names: string[]): Promise<void> {
  const cleaned = [...new Set(
    names.map((n) => (n ?? "").trim()).filter(Boolean),
  )];
  if (cleaned.length === 0) return;
  const existing = assertOkMaybe(
    await supabase.from("products").select("aliases").eq("id", productId).maybeSingle(),
  ) as { aliases?: string[] } | null;
  const current = (existing?.aliases ?? []).map((s) => s.toLowerCase().trim());
  const additions = cleaned.filter((n) => !current.includes(n.toLowerCase().trim()));
  if (additions.length === 0) return;
  const next = [...(existing?.aliases ?? []), ...additions];
  const { error } = await supabase
    .from("products")
    .update({ aliases: next, updatedAt: new Date() })
    .eq("id", productId);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["products"] });
}

/** Attach picked-chocolate composition to an existing order. Used by
 *  the box-builder CSV importer for free-pick variants where the
 *  Shopify CSV alone doesn't reveal which bonbons went in the box.
 *
 *  - Looks up an existing free-pick variant line on the order; uses
 *    its variantId + variantPackagingId so derived orderItems carry
 *    the right metadata.
 *  - When no variant line exists, creates plain orderItems anyway so
 *    the production demand is captured (still imported as a regular
 *    product line — order detail will show them as orphan lines).
 *  - Skips orderItems that already exist for the (orderId, variantId,
 *    productId) tuple — re-importing the same box-builder CSV is a
 *    no-op for those lines.
 *
 *  Returns how many fresh orderItems landed.
 */
export async function attachBoxContents(
  orderId: string,
  picks: Array<{ productId: string; quantity: number }>,
): Promise<number> {
  if (picks.length === 0) return 0;
  // Read the order so we can inherit its channel-driven fulfilment
  // default. Online + shop default to borrow → picks pull from shop
  // stock automatically; b2b + event default to produce → batches
  // get spawned on next regen.
  const order = assertOkMaybe(
    await supabase.from("orders").select("*").eq("id", orderId).maybeSingle(),
  ) as Order | null;
  const channel = (order?.channel ?? "online") as OrderChannel;
  const defaultMode = (CHANNEL_FULFILMENT_DEFAULTS[channel] ?? "produce") as FulfilmentMode;
  // Find an existing variant line we can attach to. Prefer the first
  // free-pick variant on the order.
  const variantLines = assertOk(
    await supabase.from("orderVariantLines").select("*").eq("orderId", orderId),
  ) as OrderVariantLine[];
  let preferredVariantId: string | null = null;
  let preferredVpId: string | null = null;
  if (variantLines.length > 0) {
    const variants = assertOk(
      await supabase
        .from("variants")
        .select("id, kind")
        .in("id", variantLines.map((l) => l.variantId)),
    ) as Array<{ id: string; kind: string }>;
    const freePick = variantLines.find((l) =>
      variants.find((v) => v.id === l.variantId)?.kind === "free-pick",
    ) ?? variantLines[0];
    preferredVariantId = freePick.variantId;
    preferredVpId = freePick.variantPackagingId ?? null;
  }
  // Existing items so we don't double-insert on re-import.
  const existingItems = assertOk(
    await supabase.from("orderItems").select("*").eq("orderId", orderId),
  ) as OrderItem[];
  const seen = new Set(
    existingItems
      .filter((it) => it.variantId === preferredVariantId)
      .map((it) => it.productId),
  );
  const nextSort = existingItems.reduce((m, it) => Math.max(m, it.sortOrder ?? 0), -1) + 1;
  const inserts: Array<Omit<OrderItem, "id"> & { id: string }> = [];
  let s = nextSort;
  for (const p of picks) {
    if (seen.has(p.productId)) continue;
    seen.add(p.productId);
    inserts.push({
      id: newId(),
      orderId,
      productId: p.productId,
      quantity: p.quantity,
      unitPrice: 0,
      sortOrder: s++,
      variantId: preferredVariantId ?? undefined,
      variantPackagingId: preferredVpId ?? undefined,
      fulfilmentMode: defaultMode,
    } as OrderItem & { id: string });
  }
  if (inserts.length === 0) return 0;
  const { error } = await supabase.from("orderItems").insert(inserts);
  if (error) throw error;

  // Borrow picks need stock allocated against the order — same flow
  // saveOrderItem runs on the native form path. Per-pick failure is
  // logged + skipped so a single shortage doesn't abort the whole
  // box-content import. After all picks land the order's
  // ready_to_pack status is re-evaluated.
  if (defaultMode === "borrow") {
    // Try variant-stock first — pre-built free-pick boxes (rare, but
    // possible) cover the line without touching loose pieces.
    let covered = new Set<string>();
    try {
      covered = await tryAllocateVariantLinesFromStock(orderId);
    } catch (e) {
      console.warn(`[attachBoxContents] variant allocation failed:`, e);
    }
    for (const ins of inserts) {
      if (ins.variantPackagingId && covered.has(ins.variantPackagingId)) continue;
      try {
        await allocateLineFromStore({
          orderId: ins.orderId,
          productId: ins.productId,
          quantity: ins.quantity,
        });
      } catch (e) {
        console.warn(
          `[attachBoxContents] borrow allocation failed for order ${orderId}, product ${ins.productId} — flipping to produce:`,
          e,
        );
        // Stock short → flip to produce so reconciler creates a batch
        // on next regen. Otherwise the pick stays borrow + stuck.
        await supabase
          .from("orderItems")
          .update({ fulfilmentMode: "produce" })
          .eq("id", ins.id);
      }
    }
    try {
      await refreshOrderReadyStatus(orderId);
    } catch (e) {
      console.warn(`[attachBoxContents] refreshOrderReadyStatus failed:`, e);
    }
  }

  queryClient.invalidateQueries({ queryKey: ["order-items"] });
  queryClient.invalidateQueries({ queryKey: ["orderItems"] });
  queryClient.invalidateQueries({ queryKey: ["stock-locations"] });
  queryClient.invalidateQueries({ queryKey: ["orders"] });
  return inserts.length;
}

/** Same as appendProductAliases but for variants — used when the
 *  Shopify importer maps a Lineitem name to a curated SKU. */
export async function appendVariantAliases(variantId: string, names: string[]): Promise<void> {
  const cleaned = [...new Set(
    names.map((n) => (n ?? "").trim()).filter(Boolean),
  )];
  if (cleaned.length === 0) return;
  const existing = assertOkMaybe(
    await supabase.from("variants").select("aliases").eq("id", variantId).maybeSingle(),
  ) as { aliases?: string[] } | null;
  const current = (existing?.aliases ?? []).map((s) => s.toLowerCase().trim());
  const additions = cleaned.filter((n) => !current.includes(n.toLowerCase().trim()));
  if (additions.length === 0) return;
  const next = [...(existing?.aliases ?? []), ...additions];
  const { error } = await supabase
    .from("variants")
    .update({ aliases: next, updatedAt: new Date() })
    .eq("id", variantId);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["variants"] });
}

export async function saveProduct(product: Omit<Product, "id" | "createdAt" | "updatedAt"> & { id?: string }) {
  const now = new Date();
  if (product.id) {
    const existing = assertOkMaybe(
      await supabase.from("products").select("*").eq("id", product.id).maybeSingle(),
    ) as Product | null;
    const { error } = await supabase
      .from("products")
      .update({ ...product, updatedAt: now })
      .eq("id", product.id);
    if (error) throw error;
    if (existing) {
      if (existing.defaultMouldId !== product.defaultMouldId) {
        await computeAndSaveProductCostSnapshot({
          productId: product.id,
          triggerType: "mould_change",
          triggerDetail: "Default mould changed",
        });
      } else if (
        existing.shellIngredientId !== product.shellIngredientId ||
        existing.shellPercentage !== product.shellPercentage
      ) {
        await computeAndSaveProductCostSnapshot({
          productId: product.id,
          triggerType: "shell_change",
          triggerDetail: existing.shellIngredientId !== product.shellIngredientId
            ? "Shell chocolate changed"
            : `Shell percentage changed to ${product.shellPercentage ?? 37}%`,
        });
      }
    }
    queryClient.invalidateQueries({ queryKey: ["products"] });
    return product.id;
  }
  const createdId = newId();
  const { error } = await supabase
    .from("products")
    .insert({ ...product, id: createdId, createdAt: now, updatedAt: now });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["products"] });
  return createdId;
}

export async function deleteProduct(id: string) {
  const delPf = await supabase.from("productFillings").delete().eq("productId", id);
  if (delPf.error) throw delPf.error;
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["products"] });
  queryClient.invalidateQueries({ queryKey: ["product-fillings"] });
}

export async function duplicateProduct(productId: string, options: { duplicateFillings: boolean }): Promise<string> {
  const product = assertOkMaybe(
    await supabase.from("products").select("*").eq("id", productId).maybeSingle(),
  ) as Product | null;
  if (!product?.id) throw new Error("Product not found");

  const now = new Date();
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, archived: _archived, ...productData } = product;
  const newProductId = newId();
  const insP = await supabase.from("products").insert({
    ...productData,
    id: newProductId,
    name: `${product.name} (copy)`,
    createdAt: now,
    updatedAt: now,
  });
  if (insP.error) throw insP.error;

  const productLinks = assertOk(
    await supabase.from("productFillings").select("*").eq("productId", productId),
  ) as ProductFilling[];

  if (options.duplicateFillings) {
    for (const rl of productLinks) {
      const filling = assertOkMaybe(
        await supabase.from("fillings").select("*").eq("id", rl.fillingId).maybeSingle(),
      ) as Filling | null;
      if (!filling?.id) continue;

      const { id: _fillingId, rootId: _rootId, version: _version, supersededAt: _supersededAt, versionNotes: _versionNotes, createdAt: _fillingCreatedAt, ...fillingData } = filling;
      const newFillingId = newId();
      const insF = await supabase.from("fillings").insert({
        ...fillingData,
        id: newFillingId,
        name: `${filling.name} (copy)`,
        createdAt: now,
      });
      if (insF.error) throw insF.error;

      const ingredients = assertOk(
        await supabase.from("fillingIngredients").select("*").eq("fillingId", rl.fillingId),
      ) as FillingIngredient[];
      if (ingredients.length > 0) {
        const insFi = await supabase.from("fillingIngredients").insert(
          ingredients.map((li) => {
            const { id: _liId, ...liData } = li;
            return { ...liData, id: newId(), fillingId: newFillingId };
          }),
        );
        if (insFi.error) throw insFi.error;
      }

      const { id: _rlId, ...rlData } = rl;
      const insPf = await supabase.from("productFillings").insert({
        ...rlData,
        id: newId(),
        productId: newProductId,
        fillingId: newFillingId,
      });
      if (insPf.error) throw insPf.error;
    }
  } else {
    if (productLinks.length > 0) {
      const { error } = await supabase.from("productFillings").insert(
        productLinks.map((rl) => {
          const { id: _rlId, ...rlData } = rl;
          return { ...rlData, id: newId(), productId: newProductId };
        }),
      );
      if (error) throw error;
    }
  }

  queryClient.invalidateQueries({ queryKey: ["products"] });
  queryClient.invalidateQueries({ queryKey: ["fillings"] });
  queryClient.invalidateQueries({ queryKey: ["filling-ingredients"] });
  queryClient.invalidateQueries({ queryKey: ["product-fillings"] });
  return newProductId;
}

// --- Fillings (standalone, reusable) ---

export function useFillings(includeArchived = false): Filling[] {
  const { data } = useQuery({
    queryKey: ["fillings", { includeArchived }],
    queryFn: async () => {
      const rows = assertOk(await supabase.from("fillings").select("*"));
      return (rows as Filling[])
        .filter((l) => !l.supersededAt && (includeArchived || !l.archived))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  return data ?? [];
}

export function useAllFillingStatuses(): string[] {
  const { data } = useQuery({
    queryKey: ["fillings", "statuses"],
    queryFn: async () => {
      const rows = assertOk(await supabase.from("fillings").select("status")) as { status: string | null }[];
      return [...new Set(rows.map((f) => f.status).filter(Boolean))] as string[];
    },
  });
  return data ?? [];
}

export function useFilling(id: string | undefined): Filling | undefined {
  const { data } = useQuery({
    queryKey: ["fillings", id],
    enabled: !!id,
    queryFn: async () => {
      const row = assertOkMaybe(
        await supabase.from("fillings").select("*").eq("id", id!).maybeSingle(),
      );
      return row as Filling | null;
    },
  });
  return data ?? undefined;
}

export async function saveFilling(filling: Omit<Filling, "id"> & { id?: string }) {
  if (filling.id) {
    const { error } = await supabase.from("fillings").update(filling).eq("id", filling.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["fillings"] });
    return filling.id;
  }
  const createdId = newId();
  const { error } = await supabase.from("fillings").insert({ ...filling, id: createdId });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["fillings"] });
  return createdId;
}

export async function deleteFilling(id: string) {
  // No single-round-trip transaction in supabase-js; run the five statements in order.
  // For a 2-user app the race window is tiny; if it ever matters, move to an RPC.
  const t1 = await supabase.from("fillingIngredients").delete().eq("fillingId", id);
  if (t1.error) throw t1.error;
  const t2 = await supabase.from("productFillings").delete().eq("fillingId", id);
  if (t2.error) throw t2.error;
  const t3 = await supabase.from("productFillingHistory").delete().eq("fillingId", id);
  if (t3.error) throw t3.error;
  const t4 = await supabase.from("productFillingHistory").delete().eq("replacedByFillingId", id);
  if (t4.error) throw t4.error;
  const t5 = await supabase.from("fillings").delete().eq("id", id);
  if (t5.error) throw t5.error;
  queryClient.invalidateQueries({ queryKey: ["fillings"] });
  queryClient.invalidateQueries({ queryKey: ["filling-ingredients"] });
  queryClient.invalidateQueries({ queryKey: ["product-fillings"] });
  queryClient.invalidateQueries({ queryKey: ["product-filling-history"] });
}

export async function getOrphanedProductsOnFillingDelete(fillingId: string): Promise<Product[]> {
  const impact = await getFillingDeleteImpact(fillingId);
  return [...impact.soleFillingProducts];
}

export interface FillingDeleteImpact {
  soleFillingProducts: Product[];   // products where this is the only filling — will become empty
  multiFillingProducts: Product[];  // products with other fillings — will have fill % redistributed
}

export async function getFillingDeleteImpact(fillingId: string): Promise<FillingDeleteImpact> {
  const links = assertOk(
    await supabase.from("productFillings").select("productId").eq("fillingId", fillingId),
  ) as { productId: string }[];
  const productIds = [...new Set(links.map((rl) => rl.productId))];
  if (productIds.length === 0) return { soleFillingProducts: [], multiFillingProducts: [] };

  const soleFillingProducts: Product[] = [];
  const multiFillingProducts: Product[] = [];

  for (const rid of productIds) {
    const product = assertOkMaybe(
      await supabase.from("products").select("*").eq("id", rid).maybeSingle(),
    ) as Product | null;
    if (!product || product.archived) continue;
    const { count, error } = await supabase
      .from("productFillings")
      .select("*", { count: "exact", head: true })
      .eq("productId", rid);
    if (error) throw error;
    if ((count ?? 0) <= 1) {
      soleFillingProducts.push(product);
    } else {
      multiFillingProducts.push(product);
    }
  }

  return {
    soleFillingProducts: soleFillingProducts.sort((a, b) => a.name.localeCompare(b.name)),
    multiFillingProducts: multiFillingProducts.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function deleteFillingWithCleanup(fillingId: string, options: { removeOrphanedProducts: boolean; archivableProductIds: string[] }): Promise<void> {
  // First, remove from multi-filling products (redistributes fill %)
  const links = assertOk(
    await supabase.from("productFillings").select("*").eq("fillingId", fillingId),
  ) as ProductFilling[];
  for (const rl of links) {
    const { count, error } = await supabase
      .from("productFillings")
      .select("*", { count: "exact", head: true })
      .eq("productId", rl.productId);
    if (error) throw error;
    if ((count ?? 0) > 1 && rl.id) {
      await removeFillingFromProduct(rl.id);
    }
  }

  // Archive produced products
  for (const productId of options.archivableProductIds) {
    await archiveProduct(productId);
  }

  // Delete orphaned unproduced products if requested
  if (options.removeOrphanedProducts) {
    const remainingLinks = assertOk(
      await supabase.from("productFillings").select("productId").eq("fillingId", fillingId),
    ) as { productId: string }[];
    const orphanedProductIds = [...new Set(remainingLinks.map((rl) => rl.productId))];
    for (const productId of orphanedProductIds) {
      const { count, error } = await supabase
        .from("productFillings")
        .select("*", { count: "exact", head: true })
        .eq("productId", productId);
      if (error) throw error;
      if ((count ?? 0) <= 1) {
        await deleteProduct(productId);
      }
    }
  }

  // Finally delete the filling itself
  await deleteFilling(fillingId);
}

export async function hasProductBeenProduced(productId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("planProducts")
    .select("*", { count: "exact", head: true })
    .eq("productId", productId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function archiveProduct(id: string) {
  const { error } = await supabase
    .from("products")
    .update({ archived: true, updatedAt: new Date() })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["products"] });
}

export async function unarchiveProduct(id: string) {
  const { error } = await supabase
    .from("products")
    .update({ archived: false, updatedAt: new Date() })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["products"] });
}

export async function archiveFilling(id: string) {
  const { error } = await supabase.from("fillings").update({ archived: true }).eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["fillings"] });
}

export interface FillingArchiveImpact {
  soleFillingProducts: Product[];   // products where this is the only filling — will become empty
  multiFillingProducts: Product[];  // products with other fillings — can remove & redistribute
}

export async function getFillingArchiveImpact(fillingId: string): Promise<FillingArchiveImpact> {
  const productLinks = assertOk(
    await supabase.from("productFillings").select("productId").eq("fillingId", fillingId),
  ) as { productId: string }[];
  if (productLinks.length === 0) return { soleFillingProducts: [], multiFillingProducts: [] };

  const productIds = [...new Set(productLinks.map((rl) => rl.productId))];
  const soleFillingProducts: Product[] = [];
  const multiFillingProducts: Product[] = [];

  for (const productId of productIds) {
    const product = assertOkMaybe(
      await supabase.from("products").select("*").eq("id", productId).maybeSingle(),
    ) as Product | null;
    if (!product || product.archived) continue;
    const { count, error } = await supabase
      .from("productFillings")
      .select("*", { count: "exact", head: true })
      .eq("productId", productId);
    if (error) throw error;
    const fillingCount = count ?? 0;
    if (fillingCount <= 1) {
      soleFillingProducts.push(product);
    } else {
      multiFillingProducts.push(product);
    }
  }

  return {
    soleFillingProducts: soleFillingProducts.sort((a, b) => a.name.localeCompare(b.name)),
    multiFillingProducts: multiFillingProducts.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function archiveFillingWithCleanup(
  fillingId: string,
  options: { archiveSoleProducts: boolean; removeFromMultiProducts: boolean }
): Promise<void> {
  const productLinks = assertOk(
    await supabase.from("productFillings").select("*").eq("fillingId", fillingId),
  ) as ProductFilling[];
  const productIds = [...new Set(productLinks.map((rl) => rl.productId))];

  // Handle sole-filling products
  if (options.archiveSoleProducts) {
    for (const productId of productIds) {
      const product = assertOkMaybe(
        await supabase.from("products").select("archived").eq("id", productId).maybeSingle(),
      ) as { archived: boolean } | null;
      if (!product || product.archived) continue;
      const { count, error } = await supabase
        .from("productFillings")
        .select("*", { count: "exact", head: true })
        .eq("productId", productId);
      if (error) throw error;
      if ((count ?? 0) <= 1) {
        await archiveProduct(productId);
      }
    }
  }

  // Handle multi-filling products: remove the filling link and redistribute
  if (options.removeFromMultiProducts) {
    for (const rl of productLinks) {
      const product = assertOkMaybe(
        await supabase.from("products").select("archived").eq("id", rl.productId).maybeSingle(),
      ) as { archived: boolean } | null;
      if (!product || product.archived) continue;
      const { count, error } = await supabase
        .from("productFillings")
        .select("*", { count: "exact", head: true })
        .eq("productId", rl.productId);
      if (error) throw error;
      if ((count ?? 0) > 1 && rl.id) {
        await removeFillingFromProduct(rl.id);
      }
    }
  }

  await archiveFilling(fillingId);
}

export async function unarchiveFilling(id: string) {
  const { error } = await supabase.from("fillings").update({ archived: false }).eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["fillings"] });
}

export async function hasFillingBeenProduced(fillingId: string): Promise<boolean> {
  const productLinks = assertOk(
    await supabase.from("productFillings").select("productId").eq("fillingId", fillingId),
  ) as { productId: string }[];
  if (productLinks.length === 0) return false;
  const productIds = [...new Set(productLinks.map((rl) => rl.productId))];
  for (const productId of productIds) {
    if (await hasProductBeenProduced(productId)) return true;
  }
  return false;
}

// --- Filling Categories ---

export function useFillingCategories(includeArchived = false): FillingCategory[] {
  const { data } = useQuery({
    queryKey: ["filling-categories", { includeArchived }],
    queryFn: async () => {
      const rows = assertOk(await supabase.from("fillingCategories").select("*"));
      return (rows as FillingCategory[])
        .filter((c) => includeArchived || !c.archived)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  return data ?? [];
}

export function useFillingCategory(id: string | undefined): FillingCategory | undefined {
  const { data } = useQuery({
    queryKey: ["filling-categories", id],
    enabled: !!id,
    queryFn: async () => {
      const row = assertOkMaybe(
        await supabase.from("fillingCategories").select("*").eq("id", id!).maybeSingle(),
      );
      return row as FillingCategory | null;
    },
  });
  return data ?? undefined;
}

/** Reactive Map<name, FillingCategory> for fast lookups by category name. */
export function useFillingCategoryMap(): Map<string, FillingCategory> {
  const { data } = useQuery({
    queryKey: ["filling-categories", "map"],
    queryFn: async () => {
      const rows = assertOk(await supabase.from("fillingCategories").select("*")) as FillingCategory[];
      return new Map(rows.map((c) => [c.name, c]));
    },
  });
  return data ?? new Map<string, FillingCategory>();
}

/** Reactive Set of category names where shelfStable === true.
 *  Replaces the old hardcoded SHELF_STABLE_CATEGORIES constant. Falls back to
 *  the legacy constant when the live query hasn't resolved yet. */
export function useShelfStableCategoryNames(): Set<string> {
  const { data } = useQuery({
    queryKey: ["filling-categories", "shelf-stable-names"],
    queryFn: async () => {
      const rows = assertOk(await supabase.from("fillingCategories").select("*")) as FillingCategory[];
      return new Set(rows.filter((c) => c.shelfStable).map((c) => c.name));
    },
  });
  if (data) return data;
  return new Set<string>(SHELF_STABLE_CATEGORIES as readonly string[]);
}

/** How many active fillings reference a given category by name. */
export function useFillingCategoryUsage(name: string | undefined): number {
  const { data } = useQuery({
    queryKey: ["filling-category-usage", name],
    enabled: !!name,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("fillings")
        .select("*", { count: "exact", head: true })
        .eq("category", name!)
        .eq("archived", false);
      if (error) throw error;
      return count ?? 0;
    },
  });
  return data ?? 0;
}

export function useFillingCategoryUsageCounts(): Map<string, number> {
  const { data } = useQuery({
    queryKey: ["filling-category-usage-counts"],
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("fillings").select("category, archived"),
      ) as { category: string; archived: boolean }[];
      const counts = new Map<string, number>();
      for (const f of rows) {
        if (f.archived) continue;
        counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
      }
      return counts;
    },
  });
  return data ?? new Map<string, number>();
}

export async function saveFillingCategory(obj: Omit<FillingCategory, "id" | "createdAt" | "updatedAt"> & { id?: string; createdAt?: Date; updatedAt?: Date }): Promise<string> {
  const now = new Date();
  if (obj.id) {
    const existing = assertOkMaybe(
      await supabase.from("fillingCategories").select("*").eq("id", obj.id).maybeSingle(),
    ) as FillingCategory | null;
    const oldName = existing?.name;
    const { error: catErr } = await supabase
      .from("fillingCategories")
      .update({ name: obj.name, shelfStable: obj.shelfStable, archived: obj.archived, updatedAt: now })
      .eq("id", obj.id);
    if (catErr) throw catErr;
    if (oldName && oldName !== obj.name) {
      const { error: cascadeErr } = await supabase
        .from("fillings")
        .update({ category: obj.name })
        .eq("category", oldName);
      if (cascadeErr) throw cascadeErr;
    }
    queryClient.invalidateQueries({ queryKey: ["filling-categories"] });
    queryClient.invalidateQueries({ queryKey: ["fillings"] });
    return obj.id;
  }
  const createdId = newId();
  const { error } = await supabase.from("fillingCategories").insert({
    id: createdId,
    name: obj.name,
    shelfStable: obj.shelfStable,
    archived: obj.archived,
    createdAt: now,
    updatedAt: now,
  });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["filling-categories"] });
  return createdId;
}

/** Refuses to delete a category that is still in use. Caller should check usage
 *  first and offer Archive instead. */
export async function deleteFillingCategory(id: string): Promise<void> {
  const cat = assertOkMaybe(
    await supabase.from("fillingCategories").select("*").eq("id", id).maybeSingle(),
  ) as FillingCategory | null;
  if (!cat) return;
  const { count, error: countErr } = await supabase
    .from("fillings")
    .select("*", { count: "exact", head: true })
    .eq("category", cat.name);
  if (countErr) throw countErr;
  if ((count ?? 0) > 0) {
    throw new Error(`Cannot delete category "${cat.name}" — ${count} filling(s) still use it.`);
  }
  const { error } = await supabase.from("fillingCategories").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["filling-categories"] });
}

export async function archiveFillingCategory(id: string): Promise<void> {
  const { error } = await supabase
    .from("fillingCategories")
    .update({ archived: true, updatedAt: new Date() })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["filling-categories"] });
}

export async function unarchiveFillingCategory(id: string): Promise<void> {
  const { error } = await supabase
    .from("fillingCategories")
    .update({ archived: false, updatedAt: new Date() })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["filling-categories"] });
}

/** Idempotent — seeds any missing default filling categories. Safe to
 *  call repeatedly; uses a per-name existence check so concurrent/double
 *  invocations (e.g. React StrictMode) can't produce duplicates. */
export async function ensureDefaultFillingCategories(): Promise<void> {
  const { DEFAULT_FILLING_CATEGORIES } = await import("@/types");
  const existing = assertOk(await supabase.from("fillingCategories").select("name")) as { name: string }[];
  const existingNames = new Set(existing.map((c) => c.name));
  const missing = DEFAULT_FILLING_CATEGORIES.filter((c) => !existingNames.has(c.name));
  if (missing.length === 0) return;
  const now = new Date();
  const { error } = await supabase.from("fillingCategories").insert(
    missing.map((cat) => ({
      id: newId(),
      name: cat.name,
      shelfStable: cat.shelfStable,
      createdAt: now,
      updatedAt: now,
    })),
  );
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["filling-categories"] });
}

// --- Filling versioning ---

export function useFillingVersionHistory(fillingId: string | undefined): Filling[] {
  const { data } = useQuery({
    queryKey: ["filling-version-history", fillingId],
    enabled: !!fillingId,
    queryFn: async () => {
      const filling = assertOkMaybe(
        await supabase.from("fillings").select("*").eq("id", fillingId!).maybeSingle(),
      ) as Filling | null;
      if (!filling) return [];
      if (!filling.rootId) return [filling];
      const versions = assertOk(
        await supabase.from("fillings").select("*").eq("rootId", filling.rootId),
      ) as Filling[];
      return versions.sort((a, b) => (a.version ?? 1) - (b.version ?? 1));
    },
  });
  return data ?? [];
}

export async function getFillingForkImpact(fillingId: string): Promise<{ products: import("@/types").Product[] }> {
  const productFillings = assertOk(
    await supabase.from("productFillings").select("productId").eq("fillingId", fillingId),
  ) as { productId: string }[];
  const productIds = [...new Set(productFillings.map((rl) => rl.productId))];
  if (productIds.length === 0) return { products: [] };
  const products = assertOk(
    await supabase.from("products").select("*").in("id", productIds),
  ) as Product[];
  return { products: products.sort((a, b) => a.name.localeCompare(b.name)) };
}

export async function forkFillingVersion(fillingId: string, versionNotes?: string): Promise<string> {
  const filling = assertOkMaybe(
    await supabase.from("fillings").select("*").eq("id", fillingId).maybeSingle(),
  ) as Filling | null;
  if (!filling?.id) throw new Error("Filling not found");

  const now = new Date();
  const rootId = filling.rootId ?? filling.id;
  const currentVersion = filling.version ?? 1;

  const supersedeErr = (await supabase
    .from("fillings")
    .update({ supersededAt: now, rootId })
    .eq("id", fillingId)).error;
  if (supersedeErr) throw supersedeErr;

  const newFillingId = newId();
  const { id: _id, ...fillingWithoutId } = filling;
  const insertErr = (await supabase.from("fillings").insert({
    ...fillingWithoutId,
    id: newFillingId,
    rootId,
    version: currentVersion + 1,
    createdAt: now,
    supersededAt: null,
    versionNotes: versionNotes?.trim() || null,
    status: "testing",
  })).error;
  if (insertErr) throw insertErr;

  const ingredients = (assertOk(
    await supabase.from("fillingIngredients").select("*").eq("fillingId", fillingId),
  ) as FillingIngredient[]).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  if (ingredients.length > 0) {
    const { error } = await supabase.from("fillingIngredients").insert(
      ingredients.map((li) => {
        const { id: _liId, ...rest } = li;
        return { ...rest, id: newId(), fillingId: newFillingId };
      }),
    );
    if (error) throw error;
  }

  const affectedProductFillings = assertOk(
    await supabase.from("productFillings").select("*").eq("fillingId", fillingId),
  ) as ProductFilling[];
  if (affectedProductFillings.length > 0) {
    const { error: histErr } = await supabase.from("productFillingHistory").insert(
      affectedProductFillings.map((rl) => ({
        id: newId(),
        productId: rl.productId,
        fillingId,
        replacedByFillingId: newFillingId,
        fillPercentage: rl.fillPercentage,
        sortOrder: rl.sortOrder,
        replacedAt: now,
      })),
    );
    if (histErr) throw histErr;
    const { error: relinkErr } = await supabase
      .from("productFillings")
      .update({ fillingId: newFillingId })
      .eq("fillingId", fillingId);
    if (relinkErr) throw relinkErr;
  }

  const affectedProductIds = [...new Set(affectedProductFillings.map((rl) => rl.productId))];

  // Cross-cluster cost snapshots — still on Dexie products cluster (chunk 4).
  await Promise.all(
    affectedProductIds.map((productId) =>
      computeAndSaveProductCostSnapshot({
        productId,
        triggerType: "filling_version",
        triggerDetail: `${filling.name} updated to v${currentVersion + 1}`,
      }),
    ),
  );

  queryClient.invalidateQueries({ queryKey: ["fillings"] });
  queryClient.invalidateQueries({ queryKey: ["filling-ingredients"] });
  queryClient.invalidateQueries({ queryKey: ["product-fillings"] });
  queryClient.invalidateQueries({ queryKey: ["product-filling-history"] });
  queryClient.invalidateQueries({ queryKey: ["filling-version-history"] });
  return newFillingId;
}

export async function duplicateFilling(fillingId: string): Promise<string> {
  const filling = assertOkMaybe(
    await supabase.from("fillings").select("*").eq("id", fillingId).maybeSingle(),
  ) as Filling | null;
  if (!filling?.id) throw new Error("Filling not found");

  const { id: _id, rootId: _rootId, version: _version, supersededAt: _supersededAt, versionNotes: _versionNotes, createdAt: _createdAt, ...fillingData } = filling;
  const newFillingId = newId();
  const { error: insertErr } = await supabase.from("fillings").insert({
    ...fillingData,
    id: newFillingId,
    name: `${filling.name} (copy)`,
    createdAt: new Date(),
  });
  if (insertErr) throw insertErr;

  const ingredients = assertOk(
    await supabase.from("fillingIngredients").select("*").eq("fillingId", fillingId),
  ) as FillingIngredient[];
  if (ingredients.length > 0) {
    const { error } = await supabase.from("fillingIngredients").insert(
      ingredients.map((li) => {
        const { id: _liId, ...liData } = li;
        return { ...liData, id: newId(), fillingId: newFillingId };
      }),
    );
    if (error) throw error;
  }

  queryClient.invalidateQueries({ queryKey: ["fillings"] });
  queryClient.invalidateQueries({ queryKey: ["filling-ingredients"] });
  return newFillingId;
}

export function useProductFillingHistory(productId: string | undefined) {
  const { data } = useQuery({
    queryKey: ["product-filling-history", productId],
    enabled: !!productId,
    queryFn: async () => {
      const history = (assertOk(
        await supabase.from("productFillingHistory").select("*").eq("productId", productId!),
      ) as ProductFillingHistory[]).sort(
        (a, b) => new Date(b.replacedAt).getTime() - new Date(a.replacedAt).getTime(),
      );
      if (history.length === 0) return [];
      const fillingIds = [...new Set([
        ...history.map((h) => h.fillingId),
        ...history.map((h) => h.replacedByFillingId),
      ])];
      const fillings = assertOk(
        await supabase.from("fillings").select("*").in("id", fillingIds),
      ) as Filling[];
      const fillingMap = new Map(fillings.map((l) => [l.id!, l]));
      return history.map((h) => ({
        ...h,
        oldFilling: fillingMap.get(h.fillingId),
        newFilling: fillingMap.get(h.replacedByFillingId),
      }));
    },
  });
  return data ?? [];
}

// --- ProductFillings (join table: product <-> filling) ---

export function useProductFillings(productId: string | undefined): ProductFilling[] {
  const { data } = useQuery({
    queryKey: ["product-fillings", productId],
    enabled: !!productId,
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("productFillings").select("*").eq("productId", productId!),
      ) as ProductFilling[];
      return rows.sort((a, b) => a.sortOrder - b.sortOrder);
    },
  });
  return data ?? [];
}

function distributePercentages(ids: string[]): Record<string, number> {
  const n = ids.length;
  if (n === 0) return {};
  const base = Math.floor(100 / n);
  const remainder = 100 - base * n;
  const result: Record<string, number> = {};
  ids.forEach((id, i) => { result[id] = i === n - 1 ? base + remainder : base; });
  return result;
}

export async function addFillingToProduct(productId: string, fillingId: string) {
  const existing = (assertOk(
    await supabase.from("productFillings").select("*").eq("productId", productId),
  ) as ProductFilling[]).sort((a, b) => a.sortOrder - b.sortOrder);
  const maxOrder = existing.reduce((max, rl) => Math.max(max, rl.sortOrder), 0);
  const createdId = newId();
  const { error: insertErr } = await supabase.from("productFillings").insert({
    id: createdId,
    productId,
    fillingId,
    sortOrder: maxOrder + 1,
    fillPercentage: 100,
  });
  if (insertErr) throw insertErr;

  const allIds = [...existing.map((rl) => rl.id!), createdId];
  const dist = distributePercentages(allIds);
  await Promise.all(
    allIds.map(async (i) => {
      const { error } = await supabase.from("productFillings").update({ fillPercentage: dist[i] }).eq("id", i);
      if (error) throw error;
    }),
  );

  await computeAndSaveProductCostSnapshot({ productId, triggerType: "manual", triggerDetail: "Filling added to product" });
  queryClient.invalidateQueries({ queryKey: ["product-fillings"] });
  return createdId;
}

export async function removeFillingFromProduct(productFillingId: string) {
  const rl = assertOkMaybe(
    await supabase.from("productFillings").select("*").eq("id", productFillingId).maybeSingle(),
  ) as ProductFilling | null;
  if (!rl) return;
  const { error: delErr } = await supabase.from("productFillings").delete().eq("id", productFillingId);
  if (delErr) throw delErr;
  const remaining = (assertOk(
    await supabase.from("productFillings").select("*").eq("productId", rl.productId),
  ) as ProductFilling[]).sort((a, b) => a.sortOrder - b.sortOrder);
  if (remaining.length > 0) {
    const dist = distributePercentages(remaining.map((r) => r.id!));
    await Promise.all(
      remaining.map(async (r) => {
        const { error } = await supabase.from("productFillings").update({ fillPercentage: dist[r.id!] }).eq("id", r.id!);
        if (error) throw error;
      }),
    );
  }
  await computeAndSaveProductCostSnapshot({ productId: rl.productId, triggerType: "manual", triggerDetail: "Filling removed from product" });
  queryClient.invalidateQueries({ queryKey: ["product-fillings"] });
}

export async function updateProductFillingPercentage(productFillingId: string, fillPercentage: number) {
  const { error } = await supabase.from("productFillings").update({ fillPercentage }).eq("id", productFillingId);
  if (error) throw error;
  const rl = assertOkMaybe(
    await supabase.from("productFillings").select("*").eq("id", productFillingId).maybeSingle(),
  ) as ProductFilling | null;
  if (rl) {
    await computeAndSaveProductCostSnapshot({ productId: rl.productId, triggerType: "manual", triggerDetail: "Fill percentage updated" });
  }
  queryClient.invalidateQueries({ queryKey: ["product-fillings"] });
}

export async function updateProductFillingGrams(productFillingId: string, fillGrams: number) {
  const { error } = await supabase.from("productFillings").update({ fillGrams }).eq("id", productFillingId);
  if (error) throw error;
  const rl = assertOkMaybe(
    await supabase.from("productFillings").select("*").eq("id", productFillingId).maybeSingle(),
  ) as ProductFilling | null;
  if (rl) {
    await computeAndSaveProductCostSnapshot({ productId: rl.productId, triggerType: "manual", triggerDetail: "Fill grams updated" });
  }
  queryClient.invalidateQueries({ queryKey: ["product-fillings"] });
}

export async function reorderProductFillings(items: ProductFilling[]) {
  await Promise.all(
    items.map(async (rl, i) => {
      const { error } = await supabase.from("productFillings").update({ sortOrder: i }).eq("id", rl.id!);
      if (error) throw error;
    }),
  );
  queryClient.invalidateQueries({ queryKey: ["product-fillings"] });
}

// --- Filling Ingredients ---

export function useFillingIngredients(fillingId: string | undefined): FillingIngredient[] {
  const { data } = useQuery({
    queryKey: ["filling-ingredients", fillingId],
    enabled: !!fillingId,
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("fillingIngredients").select("*").eq("fillingId", fillingId!),
      ) as FillingIngredient[];
      return rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    },
  });
  return data ?? [];
}

export function useAllFillingIngredients(): FillingIngredient[] {
  const { data } = useQuery({
    queryKey: ["filling-ingredients", "all"],
    queryFn: async () =>
      assertOk(await supabase.from("fillingIngredients").select("*")) as FillingIngredient[],
  });
  return data ?? [];
}

export function useProductFillingsForProducts(productIds: string[]): Map<string, ProductFilling[]> {
  const { data } = useQuery({
    queryKey: ["product-fillings", "batch", productIds.join(",")],
    enabled: productIds.length > 0,
    queryFn: async () => {
      const rows = (assertOk(
        await supabase.from("productFillings").select("*").in("productId", productIds),
      ) as ProductFilling[]).sort((a, b) => a.sortOrder - b.sortOrder);
      const map = new Map<string, ProductFilling[]>();
      for (const r of rows) {
        const arr = map.get(r.productId) ?? [];
        arr.push(r);
        map.set(r.productId, arr);
      }
      return map;
    },
  });
  return data ?? new Map<string, ProductFilling[]>();
}

export function useFillingIngredientsForFillings(fillingIds: string[]): Map<string, FillingIngredient[]> {
  const { data } = useQuery({
    queryKey: ["filling-ingredients", "batch", fillingIds.join(",")],
    enabled: fillingIds.length > 0,
    queryFn: async () => {
      const rows = (assertOk(
        await supabase.from("fillingIngredients").select("*").in("fillingId", fillingIds),
      ) as FillingIngredient[]).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      const map = new Map<string, FillingIngredient[]>();
      for (const r of rows) {
        const arr = map.get(r.fillingId) ?? [];
        arr.push(r);
        map.set(r.fillingId, arr);
      }
      return map;
    },
  });
  return data ?? new Map<string, FillingIngredient[]>();
}

export async function saveFillingIngredient(li: Omit<FillingIngredient, "id"> & { id?: string }) {
  let savedId: string;
  if (li.id) {
    const { error } = await supabase.from("fillingIngredients").update(li).eq("id", li.id);
    if (error) throw error;
    savedId = li.id;
  } else {
    const existing = assertOk(
      await supabase.from("fillingIngredients").select("sortOrder").eq("fillingId", li.fillingId),
    ) as { sortOrder: number | null }[];
    const maxOrder = existing.reduce((max, x) => Math.max(max, x.sortOrder ?? 0), -1);
    savedId = newId();
    const { error } = await supabase
      .from("fillingIngredients")
      .insert({ ...li, id: savedId, sortOrder: maxOrder + 1 });
    if (error) throw error;
  }
  await computeSnapshotsForFilling(li.fillingId, "manual", "Filling ingredient updated");
  queryClient.invalidateQueries({ queryKey: ["filling-ingredients"] });
  return savedId;
}

export async function reorderFillingIngredients(items: FillingIngredient[]) {
  await Promise.all(
    items.map(async (li, i) => {
      const { error } = await supabase.from("fillingIngredients").update({ sortOrder: i }).eq("id", li.id!);
      if (error) throw error;
    }),
  );
  queryClient.invalidateQueries({ queryKey: ["filling-ingredients"] });
}

export async function deleteFillingIngredient(id: string) {
  const li = assertOkMaybe(
    await supabase.from("fillingIngredients").select("*").eq("id", id).maybeSingle(),
  ) as FillingIngredient | null;
  const { error } = await supabase.from("fillingIngredients").delete().eq("id", id);
  if (error) throw error;
  if (li) {
    await computeSnapshotsForFilling(li.fillingId, "manual", "Filling ingredient removed");
  }
  queryClient.invalidateQueries({ queryKey: ["filling-ingredients"] });
}

// --- Moulds ---

export function useMoulds(includeArchived = false): Mould[] {
  const { data } = useQuery({
    queryKey: ["moulds", { includeArchived }],
    queryFn: async () => {
      const rows = assertOk(await supabase.from("moulds").select("*")) as Mould[];
      return rows
        .filter((m) => includeArchived || !m.archived)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  return data ?? [];
}

/** Photo-free variant of `useMoulds` for list/aggregation contexts.
 *  Excludes the `photo` column to avoid loading every mould's base64 over the wire
 *  when only metadata is needed. Return type stays `Mould` for call-site compatibility. */
export function useMouldsList(includeArchived = false): Mould[] {
  const { data } = useQuery({
    queryKey: ["moulds", "list", { includeArchived }],
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("moulds").select("id, name, \"productNumber\", brand, \"cavityWeightG\", \"numberOfCavities\", \"fillingGramsPerCavity\", \"quantityOwned\", notes, archived"),
      ) as Mould[];
      return rows
        .filter((m) => includeArchived || !m.archived)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  return data ?? [];
}

export function useMould(id: string | undefined): Mould | undefined {
  const { data } = useQuery({
    queryKey: ["moulds", id],
    enabled: !!id,
    queryFn: async () => {
      const row = assertOkMaybe(
        await supabase.from("moulds").select("*").eq("id", id!).maybeSingle(),
      );
      return row as Mould | null;
    },
  });
  return data ?? undefined;
}

export async function saveMould(mould: Omit<Mould, "id"> & { id?: string }) {
  if (mould.id) {
    const { error } = await supabase.from("moulds").update(mould).eq("id", mould.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["moulds"] });
    return mould.id;
  }
  const createdId = newId();
  const { error } = await supabase.from("moulds").insert({ ...mould, id: createdId });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["moulds"] });
  return createdId;
}

export async function deleteMould(id: string) {
  const { error } = await supabase.from("moulds").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["moulds"] });
}

export async function archiveMould(id: string) {
  const { error } = await supabase.from("moulds").update({ archived: true }).eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["moulds"] });
}

export async function unarchiveMould(id: string) {
  const { error } = await supabase.from("moulds").update({ archived: false }).eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["moulds"] });
}

/** Returns true if the mould is referenced by any product or production plan. */
export async function isMouldInUse(id: string): Promise<boolean> {
  const { count: productCount, error: pErr } = await supabase
    .from("products")
    .select("*", { count: "exact", head: true })
    .eq("defaultMouldId", id);
  if (pErr) throw pErr;
  if ((productCount ?? 0) > 0) return true;
  const { count: planProductCount, error: ppErr } = await supabase
    .from("planProducts")
    .select("*", { count: "exact", head: true })
    .eq("mouldId", id);
  if (ppErr) throw ppErr;
  return (planProductCount ?? 0) > 0;
}

/** Returns products that use this mould as their default (reactive). */
export function useMouldUsage(mouldId: string | undefined): Product[] {
  const { data } = useQuery({
    queryKey: ["mould-usage", mouldId],
    enabled: !!mouldId,
    queryFn: async () => {
      const products = assertOk(
        await supabase.from("products").select("*").eq("defaultMouldId", mouldId!),
      ) as Product[];
      return products.sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  return data ?? [];
}

// --- Production Plans ---

export function useProductionPlans(): ProductionPlan[] {
  const { data } = useQuery({
    queryKey: ["production-plans"],
    queryFn: async () => {
      // Paginate — Supabase caps at 1000 per request, and live workshops
      // accumulate thousands of plans (cancelled / orphaned + active).
      const out: ProductionPlan[] = [];
      const PAGE = 1000;
      const MAX_PAGES = 20;
      for (let i = 0; i < MAX_PAGES; i++) {
        const from = i * PAGE;
        const res = await supabase
          .from("productionPlans")
          .select("*")
          .range(from, from + PAGE - 1);
        const page = assertOk(res) as ProductionPlan[];
        out.push(...page);
        if (page.length < PAGE) break;
      }
      return out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },
  });
  return data ?? [];
}

/** Move a set of plans onto a target date by rewriting their
 *  productionDayLineItems. Creates the productionDay row if missing.
 *  When `pin` is true, the plans' `pinnedDate` flag is set so the
 *  next regenerate respects the manual placement. */
export async function moveProductionPlansToDate(args: {
  planIds: string[];
  targetDate: string;     // ISO YYYY-MM-DD
  pin?: boolean;
}): Promise<void> {
  const { planIds, targetDate, pin } = args;
  if (planIds.length === 0) return;

  // 1. Resolve / create the target productionDay row.
  const existingDay = assertOkMaybe(
    await supabase.from("productionDays").select("*").eq("date", targetDate).maybeSingle(),
  ) as { id: string; date: string } | null;
  let dayId = existingDay?.id;
  if (!dayId) {
    dayId = newId();
    const now = new Date();
    const { error } = await supabase.from("productionDays").insert({
      id: dayId,
      date: targetDate,
      status: "draft",
      tempLogComplete: false,
      cleaningComplete: false,
      summaryJson: {},
      createdAt: now,
      updatedAt: now,
    });
    if (error) throw error;
  }

  // 2. Move each plan's lineItems to the new dayId. Chunk for URL safety.
  const CHUNK = 100;
  for (let i = 0; i < planIds.length; i += CHUNK) {
    const slice = planIds.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("productionDayLineItems")
      .update({ productionDayId: dayId, updatedAt: new Date() })
      .in("planId", slice);
    if (error) throw error;
  }

  // 3. Optional pin so regenerate respects this placement.
  if (pin) {
    for (let i = 0; i < planIds.length; i += CHUNK) {
      const slice = planIds.slice(i, i + CHUNK);
      const { error } = await supabase
        .from("productionPlans")
        .update({ pinnedDate: targetDate, updatedAt: new Date() })
        .in("id", slice);
      if (error) throw error;
    }
  }

  queryClient.invalidateQueries({ queryKey: ["production-day-line-items"] });
  queryClient.invalidateQueries({ queryKey: ["production-days"] });
  queryClient.invalidateQueries({ queryKey: ["production-plans"] });
}

/** Push an order's deadline forward by N days (typically 1).
 *  Used by the "must do" view's defer button so an over-stretched
 *  day can be relieved without editing the order in detail. */
export async function bumpOrderDeadline(orderId: string, days: number): Promise<void> {
  const cur = assertOkMaybe(
    await supabase.from("orders").select("deadline").eq("id", orderId).maybeSingle(),
  ) as { deadline?: string } | null;
  if (!cur?.deadline) throw new Error("Order has no deadline to bump");
  const d = new Date(cur.deadline);
  d.setDate(d.getDate() + days);
  const { error } = await supabase
    .from("orders")
    .update({ deadline: d.toISOString(), updatedAt: new Date() })
    .eq("id", orderId);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["orders"] });
}

/** Move SPECIFIC step(s) of a plan from their current scheduled day
 *  to a new day. Splits the stepId out of the source lineItem (or
 *  deletes the row entirely if the step was the only entry on that
 *  day for this plan), then inserts/merges into the target day's
 *  lineItem for the same plan. Used by /plan week view's drag-drop
 *  on step or category headers — only the dragged step migrates,
 *  the plan's other steps stay put on their original days. */
export async function moveProductionStepsToDate(args: {
  moves: Array<{ planId: string; stepId: string }>;
  targetDate: string;
}): Promise<void> {
  const { moves, targetDate } = args;
  if (moves.length === 0) return;

  // 1. Resolve / create the target productionDay row.
  const existingDay = assertOkMaybe(
    await supabase.from("productionDays").select("*").eq("date", targetDate).maybeSingle(),
  ) as { id: string; date: string } | null;
  let targetDayId = existingDay?.id;
  if (!targetDayId) {
    targetDayId = newId();
    const now = new Date();
    const { error } = await supabase.from("productionDays").insert({
      id: targetDayId,
      date: targetDate,
      status: "draft",
      tempLogComplete: false,
      cleaningComplete: false,
      summaryJson: {},
      createdAt: now,
      updatedAt: now,
    });
    if (error) throw error;
  }

  // 2. Read every lineItem for the planIds being touched. We need
  //    them all because the step might live on any day, and we have
  //    to update both source AND target rows for the same plan.
  const planIds = [...new Set(moves.map((m) => m.planId))];
  const allLineItems = assertOk(
    await supabase
      .from("productionDayLineItems")
      .select("*")
      .in("planId", planIds),
  ) as Array<{
    id: string; planId: string; productionDayId: string;
    stepIds: string[]; plannedMinutes: number; sortOrder: number;
  }>;

  let appliedMoves = 0;
  const skippedMoves: Array<{ planId: string; stepId: string; reason: string }> = [];
  for (const m of moves) {
    const src = allLineItems.find(
      (li) => li.planId === m.planId && (li.stepIds ?? []).includes(m.stepId),
    );
    if (!src) {
      skippedMoves.push({ ...m, reason: "no source lineItem (step not scheduled)" });
      continue;
    }
    if (src.productionDayId === targetDayId) {
      skippedMoves.push({ ...m, reason: "already on target day" });
      continue;
    }
    appliedMoves++;

    // Remove the step from its source row. If that empties the row,
    // delete it; otherwise update with the trimmed stepIds.
    const remainingSteps = (src.stepIds ?? []).filter((s) => s !== m.stepId);
    if (remainingSteps.length === 0) {
      await supabase.from("productionDayLineItems").delete().eq("id", src.id);
    } else {
      await supabase
        .from("productionDayLineItems")
        .update({ stepIds: remainingSteps, updatedAt: new Date() })
        .eq("id", src.id);
    }

    // Find / merge into target day's lineItem for the same plan.
    //
    // Live-query the target row instead of reading from `allLineItems`:
    // the cache can miss a row that exists in the DB (e.g. created by a
    // recent regen) which previously caused 23505 on the
    // (productionDayId, planId) unique constraint when we then tried to
    // insert. Same fix that replaceProductionPlanning got earlier.
    const target = assertOkMaybe(
      await supabase
        .from("productionDayLineItems")
        .select("*")
        .eq("planId", m.planId)
        .eq("productionDayId", targetDayId)
        .maybeSingle(),
    ) as { id: string; stepIds: string[] | null; plannedMinutes: number; sortOrder: number } | null;

    if (target) {
      const merged = [...new Set([...(target.stepIds ?? []), m.stepId])];
      await supabase
        .from("productionDayLineItems")
        .update({ stepIds: merged, updatedAt: new Date() })
        .eq("id", target.id);
      // Update local cache so subsequent moves see the merge.
      const cached = allLineItems.find((li) => li.id === target.id);
      if (cached) cached.stepIds = merged;
      else allLineItems.push({
        id: target.id,
        planId: m.planId,
        productionDayId: targetDayId,
        stepIds: merged,
        plannedMinutes: target.plannedMinutes ?? 0,
        sortOrder: target.sortOrder ?? 0,
      });
    } else {
      const newRow = {
        id: newId(),
        productionDayId: targetDayId,
        planId: m.planId,
        stepIds: [m.stepId],
        plannedMinutes: 0, // reverse-engineered minutes are recomputed by next regen
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const { error: insertErr } = await supabase
        .from("productionDayLineItems")
        .insert(newRow);
      if (insertErr) throw insertErr;
      allLineItems.push({
        id: newRow.id,
        planId: m.planId,
        productionDayId: targetDayId,
        stepIds: [m.stepId],
        plannedMinutes: 0,
        sortOrder: 0,
      });
    }
  }

  queryClient.invalidateQueries({ queryKey: ["production-day-line-items"] });
  queryClient.invalidateQueries({ queryKey: ["production-days"] });
  if (appliedMoves === 0 && moves.length > 0) {
    console.warn("[moveProductionStepsToDate] no moves applied", { moves, skippedMoves });
    throw new Error(
      `Step couldn't be moved — ${skippedMoves[0]?.reason ?? "unknown reason"}. ` +
      `Try Regenerate plan to refresh the schedule, then drag again.`,
    );
  }
}

/** Clear a plan's pinnedDate so the next regenerate is free to
 *  reschedule it according to capacity / deadlines. */
export async function unpinProductionPlan(planId: string): Promise<void> {
  const { error } = await supabase
    .from("productionPlans")
    .update({ pinnedDate: null, updatedAt: new Date() })
    .eq("id", planId);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["production-plans"] });
}

/**
 * Per-line-item lock toggle. Updates productionDayLineItems.locked for
 * every (planId, date) target in one batch. Mig 0095. Used by the
 * weekly + manual planner's per-batch and group-level lock affordances
 * so the lock granularity matches what the user sees on screen — one
 * StepBlock = one line item = one lock state.
 */
export async function setLineItemsLocked(
  targets: Array<{ planId: string; date: string }>,
  locked: boolean,
): Promise<void> {
  if (targets.length === 0) return;
  const dates = [...new Set(targets.map((t) => t.date))];
  const days = assertOk(
    await supabase.from("productionDays").select("id, date").in("date", dates),
  ) as Array<{ id: string; date: string }>;
  const dayIdByDate = new Map(days.map((d) => [d.date.slice(0, 10), d.id]));
  const resolved = targets
    .map((t) => ({ planId: t.planId, productionDayId: dayIdByDate.get(t.date) }))
    .filter((u): u is { planId: string; productionDayId: string } => !!u.productionDayId);
  if (resolved.length === 0) return;
  // No composite-key IN in postgrest; iterate with pair-eq updates. Counts
  // stay tiny (≤ batches-per-day × group-members), so a loop is fine.
  for (const u of resolved) {
    const { error } = await supabase
      .from("productionDayLineItems")
      .update({ locked, updatedAt: new Date() })
      .eq("planId", u.planId)
      .eq("productionDayId", u.productionDayId);
    if (error) throw error;
  }
  queryClient.invalidateQueries({ queryKey: ["productionDayLineItems"] });
}

/** Bulk-unpin multiple plans. Mirrors pinProductionPlans for group-level
 *  unlock affordances in the weekly planner. */
export async function unpinProductionPlans(planIds: string[]): Promise<void> {
  if (planIds.length === 0) return;
  const CHUNK = 100;
  for (let i = 0; i < planIds.length; i += CHUNK) {
    const slice = planIds.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("productionPlans")
      .update({ pinnedDate: null, updatedAt: new Date() })
      .in("id", slice);
    if (error) throw error;
  }
  queryClient.invalidateQueries({ queryKey: ["production-plans"] });
}

/** Lock multiple plans onto an explicit date (or their currently
 *  scheduled day if `date` is omitted). The week view's lock buttons
 *  call this so an operator can fix a batch in place without dragging. */
export async function pinProductionPlans(planIds: string[], date?: string): Promise<void> {
  if (planIds.length === 0) return;
  const CHUNK = 100;
  // When no date is given we resolve each plan's current scheduled
  // day individually — a "lock here" affordance.
  if (!date) {
    const lineItems = assertOk(
      await supabase
        .from("productionDayLineItems")
        .select("planId, productionDayId")
        .in("planId", planIds),
    ) as Array<{ planId: string; productionDayId: string }>;
    const dayIds = [...new Set(lineItems.map((li) => li.productionDayId))];
    const days = dayIds.length > 0
      ? assertOk(await supabase.from("productionDays").select("id, date").in("id", dayIds)) as Array<{ id: string; date: string }>
      : [];
    const dateByDay = new Map(days.map((d) => [d.id, d.date]));
    const dateByPlan = new Map<string, string>();
    for (const li of lineItems) {
      const d = dateByDay.get(li.productionDayId);
      if (!d) continue;
      const cur = dateByPlan.get(li.planId);
      if (!cur || d < cur) dateByPlan.set(li.planId, d);
    }
    for (const pid of planIds) {
      const d = dateByPlan.get(pid);
      if (!d) continue;
      await supabase
        .from("productionPlans")
        .update({ pinnedDate: d, updatedAt: new Date() })
        .eq("id", pid);
    }
  } else {
    for (let i = 0; i < planIds.length; i += CHUNK) {
      const slice = planIds.slice(i, i + CHUNK);
      await supabase
        .from("productionPlans")
        .update({ pinnedDate: date, updatedAt: new Date() })
        .in("id", slice);
    }
  }
  queryClient.invalidateQueries({ queryKey: ["production-plans"] });
}

export function useProductionPlan(id: string | undefined): ProductionPlan | undefined {
  const { data } = useQuery({
    queryKey: ["production-plans", id],
    enabled: !!id,
    queryFn: async () => {
      const row = assertOkMaybe(
        await supabase.from("productionPlans").select("*").eq("id", id!).maybeSingle(),
      );
      return row as ProductionPlan | null;
    },
  });
  return data ?? undefined;
}

/**
 * Batch number format: DUL-YYYYMMDD-NN
 *
 * NN is the count of existing batches whose number starts with the
 * same DUL-YYYYMMDD- prefix, plus one. Resets to 01 on a new calendar
 * day. Two digits is enough for a workshop that doesn't run hundreds
 * of batches per day; overflow to three if it ever becomes an issue.
 */
export async function generateBatchNumber(date: Date): Promise<string> {
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `DUL-${dateStr}-`;
  const { count, error } = await supabase
    .from("productionPlans")
    .select("*", { count: "exact", head: true })
    .like("batchNumber", `${prefix}%`);
  if (error) throw error;
  const seq = String((count ?? 0) + 1).padStart(2, "0");
  return `${prefix}${seq}`;
}

export async function saveProductionPlan(plan: Omit<ProductionPlan, "id"> & { id?: string }): Promise<string> {
  const now = new Date();
  const completedAt = plan.status === "done"
    ? (plan.completedAt ?? now)
    : null;
  let savedId: string;
  if (plan.id) {
    const { error } = await supabase
      .from("productionPlans")
      .update({ ...plan, updatedAt: now, completedAt })
      .eq("id", plan.id);
    if (error) throw error;
    savedId = plan.id;
  } else {
    const batchNumber = plan.batchNumber ?? await generateBatchNumber(now);
    const createdId = newId();
    const { error } = await supabase.from("productionPlans").insert({
      ...plan,
      id: createdId,
      batchNumber,
      createdAt: now,
      updatedAt: now,
      completedAt,
    });
    if (error) throw error;
    savedId = createdId;
  }
  queryClient.invalidateQueries({ queryKey: ["production-plans"] });

  // Auto-flip parent Production Order to "done" when this plan flipped
  // to done AND all its sibling plans (same PO) are now done. Plans
  // are linked to their PO via name-pattern `PO: <po name> — <product>`.
  if (plan.status === "done" && plan.name && plan.name.startsWith("PO: ")) {
    try {
      const dashIdx = plan.name.indexOf(" — ");
      if (dashIdx > 4) {
        const poName = plan.name.slice(4, dashIdx);
        await maybeAutoFlipProductionOrderDone(poName);
      }
    } catch (e) {
      // Non-blocking — log only.
      console.warn("auto-flip PO done failed", e);
    }
  }

  // Auto-flip linked customer orders to "done" when EVERY orderItem
  // they carry has been fully allocated (allocatedQuantity ≥ quantity)
  // by some plan that's either active, done, or borrow-fulfilled.
  // Triggered every time a plan flips to done so the order leaves
  // the open list automatically.
  if (plan.status === "done" && savedId) {
    try {
      await maybeAutoFlipOrdersDone(savedId);
    } catch (e) {
      console.warn("auto-flip linked orders done failed", e);
    }
  }

  return savedId;
}

/** When a plan finishes, walk its orderPlanLinks and check whether
 *  every contributing order is now fully fulfilled. If yes, flip the
 *  order's status to "done". */
async function maybeAutoFlipOrdersDone(planId: string): Promise<void> {
  const planLinks = assertOk(
    await supabase.from("orderPlanLinks").select("*").eq("planId", planId),
  ) as OrderPlanLink[];
  if (planLinks.length === 0) return;

  const itemIds = [...new Set(planLinks.map((l) => l.orderItemId))];
  const items = assertOk(
    await supabase.from("orderItems").select("*").in("id", itemIds),
  ) as OrderItem[];
  const orderIds = [...new Set(items.map((it) => it.orderId))];

  for (const orderId of orderIds) {
    const order = assertOkMaybe(
      await supabase.from("orders").select("*").eq("id", orderId).maybeSingle(),
    ) as Order | null;
    if (!order) continue;
    if (order.status === "done" || order.status === "cancelled") continue;

    // Pull every item + every link for that order.
    const orderItems = assertOk(
      await supabase.from("orderItems").select("*").eq("orderId", orderId),
    ) as OrderItem[];
    if (orderItems.length === 0) continue;

    const itemIdsForOrder = orderItems.map((i) => i.id!);
    const allLinks = assertOk(
      await supabase.from("orderPlanLinks").select("*").in("orderItemId", itemIdsForOrder),
    ) as OrderPlanLink[];

    const linkedPlanIds = [...new Set(allLinks.map((l) => l.planId))];
    const linkedPlans = linkedPlanIds.length > 0
      ? assertOk(await supabase.from("productionPlans").select("id, status").in("id", linkedPlanIds)) as Array<{ id: string; status: string }>
      : [];
    const planStatusById = new Map(linkedPlans.map((p) => [p.id, p.status]));

    let allFulfilled = true;
    for (const it of orderItems) {
      if ((it.fulfilmentMode ?? "produce") === "borrow") continue; // ship deduction handled elsewhere
      const itemLinks = allLinks.filter((l) => l.orderItemId === it.id);
      const fulfilledQty = itemLinks
        .filter((l) => {
          const s = planStatusById.get(l.planId);
          return s === "done" || s === "active";
        })
        .reduce((sum, l) => sum + (l.allocatedQuantity ?? 0), 0);
      if (fulfilledQty < it.quantity) { allFulfilled = false; break; }
    }
    if (!allFulfilled) continue;

    const { error } = await supabase
      .from("orders")
      .update({ status: "done", updatedAt: new Date() })
      .eq("id", orderId);
    if (error) console.warn(`auto-flip order ${orderId} failed`, error);
  }
  queryClient.invalidateQueries({ queryKey: ["orders"] });
}

/** Look up the open (pending / in_production) Production Order by name,
 *  check if every linked plan is now "done", and flip the PO to "done"
 *  if so. Idempotent. Called from saveProductionPlan when a plan
 *  transitions to done. */
async function maybeAutoFlipProductionOrderDone(poName: string): Promise<void> {
  const po = assertOkMaybe(
    await supabase.from("productionOrders")
      .select("*")
      .eq("name", poName)
      .in("status", ["pending", "in_production"])
      .maybeSingle(),
  ) as ProductionOrder | null;
  if (!po) return;
  const namePrefix = `PO: ${poName} — `;
  const linkedPlans = assertOk(
    await supabase.from("productionPlans")
      .select("id, status")
      .like("name", `${namePrefix}%`),
  ) as Array<{ id: string; status: string }>;
  if (linkedPlans.length === 0) return;
  const allDone = linkedPlans.every((p) => p.status === "done");
  if (!allDone) return;
  await supabase.from("productionOrders")
    .update({ status: "done", updatedAt: new Date() })
    .eq("id", po.id!);
  queryClient.invalidateQueries({ queryKey: ["production-orders"] });
}

/** Manually flip a Production Order to "done" — used by the PO detail
 *  page's "Mark done" button. Skips the all-children-done check so the
 *  user can close out an order even if some plans were cancelled. */
export async function markProductionOrderDone(poId: string): Promise<void> {
  const { error } = await supabase.from("productionOrders")
    .update({ status: "done", updatedAt: new Date() })
    .eq("id", poId);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["production-orders"] });
}

export async function deleteProductionPlan(id: string) {
  // Sequential — no client-side transaction in supabase-js.
  const delPp = await supabase.from("planProducts").delete().eq("planId", id);
  if (delPp.error) throw delPp.error;
  const delSs = await supabase.from("planStepStatus").delete().eq("planId", id);
  if (delSs.error) throw delSs.error;
  const delPlan = await supabase.from("productionPlans").delete().eq("id", id);
  if (delPlan.error) throw delPlan.error;
  queryClient.invalidateQueries({ queryKey: ["production-plans"] });
  queryClient.invalidateQueries({ queryKey: ["plan-products"] });
  queryClient.invalidateQueries({ queryKey: ["plan-step-statuses"] });
}

export async function setPlanProductStockStatus(id: string, status: "low" | "gone" | undefined) {
  const { error } = await supabase
    .from("planProducts")
    .update({ stockStatus: status ?? null })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["plan-products"] });
}

/** Move pieces from `currentStock` to `frozenQty`. Captures the user-confirmed
 *  shelf-life (in days) to apply once the batch is defrosted. Also mirrors the
 *  move into `stockLocations` (production → freezer) so the 4-location view
 *  stays consistent. */
export async function freezePlanProduct(
  id: string,
  qty: number,
  preservedShelfLifeDays: number,
): Promise<void> {
  const pb = assertOkMaybe(
    await supabase.from("planProducts").select("*").eq("id", id).maybeSingle(),
  ) as PlanProduct | null;
  if (!pb) return;
  const mould = pb.mouldId
    ? (assertOkMaybe(
        await supabase.from("moulds").select("*").eq("id", pb.mouldId).maybeSingle(),
      ) as Mould | null)
    : null;
  const planned = mould ? mould.numberOfCavities * pb.quantity : 0;
  const available = pb.currentStock ?? pb.actualYield ?? planned;
  const moving = Math.max(0, Math.min(Math.round(qty), available));
  if (moving <= 0) return;
  const { error } = await supabase
    .from("planProducts")
    .update({
      currentStock: Math.max(0, available - moving),
      frozenQty: (pb.frozenQty ?? 0) + moving,
      frozenAt: Date.now(),
      preservedShelfLifeDays: Math.max(0, Math.round(preservedShelfLifeDays)),
    })
    .eq("id", id);
  if (error) throw error;
  await transferBatchStock({
    planProductId: id,
    productId: pb.productId,
    fromLocation: "production",
    toLocation: "freezer",
    quantity: moving,
    reason: "freeze",
  });
  queryClient.invalidateQueries({ queryKey: ["plan-products"] });
}

/** Move pieces from `frozenQty` back to `currentStock` and stamp `defrostedAt`.
 *  Sell-by for the defrosted stock becomes `defrostedAt + preservedShelfLifeDays`.
 *  Also mirrors the move into `stockLocations` (freezer → production). */
export async function defrostPlanProduct(id: string): Promise<void> {
  const pb = assertOkMaybe(
    await supabase.from("planProducts").select("*").eq("id", id).maybeSingle(),
  ) as PlanProduct | null;
  if (!pb || !pb.frozenQty) return;
  const moving = pb.frozenQty;
  const base = pb.currentStock ?? pb.actualYield ?? 0;
  const { error } = await supabase
    .from("planProducts")
    .update({
      currentStock: base + moving,
      frozenQty: 0,
      frozenAt: null,
      defrostedAt: Date.now(),
      stockStatus: null,
    })
    .eq("id", id);
  if (error) throw error;
  await transferBatchStock({
    planProductId: id,
    productId: pb.productId,
    fromLocation: "freezer",
    toLocation: "production",
    quantity: moving,
    reason: "defrost",
  });
  queryClient.invalidateQueries({ queryKey: ["plan-products"] });
}

/** Returns a map of productId → "low" | "gone" for products that should be prioritised
 *  in the production wizard.
 *
 *  Resolution:
 *   1. If the product has any `stockLocationMinimums` rows → sum the
 *      `minimumUnits` and compare against the total of `currentStock`
 *      (fallback `actualYield`) across non-"gone" batches. 0 → "gone",
 *      below sum → "low".
 *   2. Otherwise fall back to the legacy per-batch `stockStatus` flag.
 */
export function useProductStockAlerts(): Map<string, "low" | "gone"> {
  const { data } = useQuery({
    queryKey: ["product-stock-alerts"],
    queryFn: async () => {
    const donePlans = assertOk(
      await supabase.from("productionPlans").select("*").eq("status", "done"),
    ) as ProductionPlan[];
    if (donePlans.length === 0) return new Map<string, "low" | "gone">();
    const planIds = donePlans.map((p) => p.id!);
    const [allBatches, mins] = await Promise.all([
      supabase.from("planProducts").select("*").in("planId", planIds).then((r) => assertOk(r) as PlanProduct[]),
      supabase.from("stockLocationMinimums").select("productId, minimumUnits").then((r) => assertOk(r) as Array<{ productId: string; minimumUnits: number }>),
    ]);
    const minSumByProduct = new Map<string, number>();
    for (const m of mins) {
      const cur = minSumByProduct.get(m.productId) ?? 0;
      minSumByProduct.set(m.productId, cur + Number(m.minimumUnits ?? 0));
    }

    // Per-product aggregation. Frozen pieces (pb.frozenQty) do NOT count toward
    // available stock — they're in the freezer and unavailable until defrosted.
    type Agg = { total: number; anyInStock: boolean; legacyLow: boolean; allGone: boolean; hasBatches: boolean };
    const agg = new Map<string, Agg>();
    for (const pb of allBatches) {
      const a = agg.get(pb.productId) ?? { total: 0, anyInStock: false, legacyLow: false, allGone: true, hasBatches: false };
      a.hasBatches = true;
      if (pb.stockStatus === "gone") {
        // skip from total
      } else {
        const pieces = pb.currentStock ?? pb.actualYield ?? 0;
        if (pieces > 0) a.allGone = false;
        a.total += pieces;
        if (pb.stockStatus === "low") a.legacyLow = true;
        else if (pieces > 0) a.anyInStock = true;
      }
      agg.set(pb.productId, a);
    }

    const result = new Map<string, "low" | "gone">();
    for (const [productId, a] of agg) {
      if (!a.hasBatches) continue;
      const threshold = minSumByProduct.get(productId);
      if (typeof threshold === "number" && threshold > 0) {
        if (a.allGone || a.total <= 0) result.set(productId, "gone");
        else if (a.total < threshold) result.set(productId, "low");
      } else {
        if (a.allGone) result.set(productId, "gone");
        else if (a.legacyLow && !a.anyInStock) result.set(productId, "low");
        else if (a.legacyLow) result.set(productId, "low");
      }
    }
    return result;
    },
  });
  return data ?? new Map<string, "low" | "gone">();
}

/** Per-product aggregated stock totals for the stock page. Only includes products
 *  with at least one non-"gone" batch from a completed plan. */
export function useProductStockTotals(): Map<string, { currentStock: number; lastCountedAt?: number }> {
  const { data } = useQuery({
    queryKey: ["product-stock-totals"],
    queryFn: async () => {
      const donePlans = assertOk(
        await supabase.from("productionPlans").select("id").eq("status", "done"),
      ) as { id: string }[];
      if (donePlans.length === 0) return new Map<string, { currentStock: number; lastCountedAt?: number }>();
      const planIds = donePlans.map((p) => p.id!);
      const [batches, products] = await Promise.all([
        supabase.from("planProducts").select("*").in("planId", planIds).then((r) => assertOk(r) as PlanProduct[]),
        supabase.from("products").select("*").then((r) => assertOk(r) as Product[]),
      ]);
      const productsById = new Map(products.map((p) => [p.id!, p] as const));
      const result = new Map<string, { currentStock: number; lastCountedAt?: number }>();
      for (const pb of batches) {
        if (pb.stockStatus === "gone") continue;
        const pieces = pb.currentStock ?? pb.actualYield ?? 0;
        const existing = result.get(pb.productId);
        if (existing) existing.currentStock += pieces;
        else result.set(pb.productId, {
          currentStock: pieces,
          lastCountedAt: productsById.get(pb.productId)?.stockCountedAt,
        });
      }
      return result;
    },
  });
  return data ?? new Map<string, { currentStock: number; lastCountedAt?: number }>();
}

/** Reconcile a manual stock count: distribute the new total across in-stock batches
 *  FIFO (oldest first when deducting, newest when adding), stamp `stockCountedAt`
 *  on the product, and persist. */
export async function updateProductStockCount(productId: string, newTotal: number): Promise<void> {
  const { reconcileStockCount } = await import("./stockCount");
  const donePlans = assertOk(
    await supabase.from("productionPlans").select("*").eq("status", "done"),
  ) as ProductionPlan[];
  const donePlanIds = new Set(donePlans.map((p) => p.id!));
  const allBatches = assertOk(
    await supabase.from("planProducts").select("*").eq("productId", productId),
  ) as PlanProduct[];
  const batches = allBatches.filter((pb) => {
    if (!donePlanIds.has(pb.planId)) return false;
    if (pb.stockStatus === "gone") return false;
    const available = pb.currentStock ?? pb.actualYield ?? 0;
    if (available <= 0 && (pb.frozenQty ?? 0) > 0) return false;
    return true;
  });

  const product = assertOkMaybe(
    await supabase.from("products").select("*").eq("id", productId).maybeSingle(),
  ) as Product | null;
  const shelfWeeks = product?.shelfLifeWeeks ? parseFloat(product.shelfLifeWeeks) : NaN;
  const planById = new Map(donePlans.map((p) => [p.id!, p] as const));

  const mouldIds = Array.from(new Set(batches.map((pb) => pb.mouldId).filter(Boolean)));
  const moulds = mouldIds.length > 0
    ? (assertOk(await supabase.from("moulds").select("*").in("id", mouldIds)) as Mould[])
    : [];
  const mouldById = new Map(moulds.map((m) => [m.id!, m] as const));

  const inputs = batches.map((pb) => {
    const plan = planById.get(pb.planId);
    const completedAt = plan?.completedAt ? new Date(plan.completedAt).getTime() : 0;
    const sellBefore = completedAt && !isNaN(shelfWeeks) && shelfWeeks > 0
      ? completedAt + Math.round((shelfWeeks - 1) * 7) * 24 * 60 * 60 * 1000
      : completedAt;
    const mould = mouldById.get(pb.mouldId);
    const planned = mould ? mould.numberOfCavities * pb.quantity : 0;
    return {
      id: pb.id!,
      currentStock: pb.currentStock ?? pb.actualYield ?? planned,
      fifoOrder: sellBefore,
    };
  });

  const deltas = reconcileStockCount(inputs, newTotal);
  for (const d of deltas) {
    const patch: Record<string, unknown> = {
      currentStock: d.nextStock,
      stockStatus: d.nextStock <= 0 ? "gone" : null,
    };
    const { error } = await supabase.from("planProducts").update(patch).eq("id", d.id);
    if (error) throw error;
  }
  const { error } = await supabase
    .from("products")
    .update({ stockCountedAt: Date.now(), updatedAt: new Date() })
    .eq("id", productId);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["products"] });
  queryClient.invalidateQueries({ queryKey: ["plan-products"] });
}

export function useAllPlanProducts(): PlanProduct[] {
  const { data } = useQuery({
    queryKey: ["plan-products", "all"],
    queryFn: async () => {
      // Paginate but cap at 20 pages (20k rows) to prevent infinite
      // loops if the response keeps returning full pages.
      const out: PlanProduct[] = [];
      const PAGE = 1000;
      const MAX_PAGES = 20;
      for (let i = 0; i < MAX_PAGES; i++) {
        const from = i * PAGE;
        const res = await supabase
          .from("planProducts")
          .select("*")
          .range(from, from + PAGE - 1);
        const page = assertOk(res) as PlanProduct[];
        out.push(...page);
        if (page.length < PAGE) break;
      }
      return out;
    },
  });
  return data ?? [];
}

export function usePlanProductsForProduct(productId: string | undefined): PlanProduct[] {
  const { data } = useQuery({
    queryKey: ["plan-products", "for-product", productId],
    enabled: !!productId,
    queryFn: async () =>
      assertOk(await supabase.from("planProducts").select("*").eq("productId", productId!)) as PlanProduct[],
  });
  return data ?? [];
}

export function usePlanProducts(planId: string | undefined): PlanProduct[] {
  const { data } = useQuery({
    queryKey: ["plan-products", "for-plan", planId],
    enabled: !!planId,
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("planProducts").select("*").eq("planId", planId!),
      ) as PlanProduct[];
      return rows.sort((a, b) => a.sortOrder - b.sortOrder);
    },
  });
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Order ↔ Plan links (many-to-many)
//
// Read hooks return the raw rows; higher-level derivations (per-line
// batch lists, per-batch order lists) live on the pages that need them
// so we don't bake a specific shape into the hook API too early.
// ---------------------------------------------------------------------------

/** All links across all orders. Cheap in practice — this table stays
 *  small relative to orders/planProducts. */
export function useAllOrderPlanLinks(): OrderPlanLink[] {
  const { data } = useQuery({
    queryKey: ["order-plan-links", "all"],
    queryFn: async () => assertOk(
      await supabase.from("orderPlanLinks").select("*"),
    ) as OrderPlanLink[],
  });
  return data ?? [];
}

/** Links for a single order (joined via orderItems). Enabled only when
 *  `orderId` is defined — we short-circuit on undefined to avoid a
 *  wasted round-trip before the page has finished loading the order. */
export function useOrderPlanLinks(orderId: string | undefined): OrderPlanLink[] {
  const { data } = useQuery({
    queryKey: ["order-plan-links", "for-order", orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const items = assertOk(
        await supabase.from("orderItems").select("id").eq("orderId", orderId!),
      ) as { id: string }[];
      if (items.length === 0) return [] as OrderPlanLink[];
      return assertOk(
        await supabase.from("orderPlanLinks").select("*").in("orderItemId", items.map((i) => i.id)),
      ) as OrderPlanLink[];
    },
  });
  return data ?? [];
}

/** Links for a single batch — used on the production/batch detail page
 *  to show which orders the batch is serving. */
export function useLinksForPlan(planId: string | undefined): OrderPlanLink[] {
  const { data } = useQuery({
    queryKey: ["order-plan-links", "for-plan", planId],
    enabled: !!planId,
    queryFn: async () => assertOk(
      await supabase.from("orderPlanLinks").select("*").eq("planId", planId!),
    ) as OrderPlanLink[],
  });
  return data ?? [];
}

/**
 * Upsert a single link. Used by the reconciler when it creates or
 * updates an allocation. The unique (orderItemId, planId) constraint
 * makes this idempotent — same pair updates allocatedQuantity.
 */
export async function saveOrderPlanLink(
  link: Omit<OrderPlanLink, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<string> {
  const now = new Date();
  if (link.id) {
    const { error } = await supabase
      .from("orderPlanLinks")
      .update({
        orderItemId: link.orderItemId,
        planId: link.planId,
        allocatedQuantity: link.allocatedQuantity,
        updatedAt: now,
      })
      .eq("id", link.id);
    if (error) throw error;
    invalidateOrderPlanLinkQueries();
    return link.id;
  }
  const createdId = newId();
  const { error } = await supabase.from("orderPlanLinks").upsert({
    id: createdId,
    orderItemId: link.orderItemId,
    planId: link.planId,
    allocatedQuantity: link.allocatedQuantity,
    createdAt: now,
    updatedAt: now,
  }, { onConflict: "orderItemId,planId" });
  if (error) throw error;
  invalidateOrderPlanLinkQueries();
  return createdId;
}

export async function deleteOrderPlanLink(id: string): Promise<void> {
  const { error } = await supabase.from("orderPlanLinks").delete().eq("id", id);
  if (error) throw error;
  invalidateOrderPlanLinkQueries();
}

/**
 * Atomic-ish replacement: delete all existing links for an order line
 * then insert the provided set. No supabase-js transaction, so a mid-
 * operation failure can leave partial state — the reconciler handles
 * that by being idempotent (next save re-sync).
 */
export async function replaceLinksForOrderItem(
  orderItemId: string,
  links: Array<Omit<OrderPlanLink, "id" | "orderItemId" | "createdAt" | "updatedAt">>,
): Promise<void> {
  const del = await supabase.from("orderPlanLinks").delete().eq("orderItemId", orderItemId);
  if (del.error) throw del.error;
  if (links.length === 0) {
    invalidateOrderPlanLinkQueries();
    return;
  }
  const now = new Date();
  const rows = links.map((l) => ({
    id: newId(),
    orderItemId,
    planId: l.planId,
    allocatedQuantity: l.allocatedQuantity,
    createdAt: now,
    updatedAt: now,
  }));
  const ins = await supabase.from("orderPlanLinks").insert(rows);
  if (ins.error) throw ins.error;
  invalidateOrderPlanLinkQueries();
}

function invalidateOrderPlanLinkQueries(): void {
  queryClient.invalidateQueries({ queryKey: ["order-plan-links"] });
}

// ---------------------------------------------------------------------------
// PO ↔ Plan links (many-to-many) — mig 0094
//
// Mirrors orderPlanLinks for production-order demand. Without this the
// manual planner had to store PO allocations as free-text in
// productionPlans.notes — brittle on reload, and the demand aggregator
// could not subtract PO allocations from open-PO remaining.
// ---------------------------------------------------------------------------

export function useAllPoPlanLinks(): PoPlanLink[] {
  const { data } = useQuery({
    queryKey: ["po-plan-links", "all"],
    queryFn: async () => assertOk(
      await supabase.from("poPlanLinks").select("*"),
    ) as PoPlanLink[],
  });
  return data ?? [];
}

export function usePoLinksForPlan(planId: string | undefined): PoPlanLink[] {
  const { data } = useQuery({
    queryKey: ["po-plan-links", "for-plan", planId],
    enabled: !!planId,
    queryFn: async () => assertOk(
      await supabase.from("poPlanLinks").select("*").eq("planId", planId!),
    ) as PoPlanLink[],
  });
  return data ?? [];
}

export async function savePoPlanLink(
  link: Omit<PoPlanLink, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<string> {
  const now = new Date();
  if (link.id) {
    const { error } = await supabase
      .from("poPlanLinks")
      .update({
        productionOrderItemId: link.productionOrderItemId,
        planId: link.planId,
        allocatedQuantity: link.allocatedQuantity,
        updatedAt: now,
      })
      .eq("id", link.id);
    if (error) throw error;
    invalidatePoPlanLinkQueries();
    return link.id;
  }
  const createdId = newId();
  const { error } = await supabase.from("poPlanLinks").upsert({
    id: createdId,
    productionOrderItemId: link.productionOrderItemId,
    planId: link.planId,
    allocatedQuantity: link.allocatedQuantity,
    createdAt: now,
    updatedAt: now,
  }, { onConflict: "productionOrderItemId,planId" });
  if (error) throw error;
  invalidatePoPlanLinkQueries();
  return createdId;
}

export async function deletePoPlanLink(id: string): Promise<void> {
  const { error } = await supabase.from("poPlanLinks").delete().eq("id", id);
  if (error) throw error;
  invalidatePoPlanLinkQueries();
}

function invalidatePoPlanLinkQueries(): void {
  queryClient.invalidateQueries({ queryKey: ["po-plan-links"] });
}

// ---------------------------------------------------------------------------
// Draft plans hook — drives the DraftsTray on the manual planner.
//
// Returns compact card shapes joined from productionPlans (status='draft')
// + planProducts + products + moulds + orderPlanLinks + poPlanLinks.
// Cheap in practice (draft count is tens, not thousands) so a plain JS
// join is used rather than an RPC.
// ---------------------------------------------------------------------------

export interface DraftPlanCard {
  planId: string;
  name: string;
  productId: string;
  productName: string;
  mouldName: string;
  numberOfCavities: number;
  mouldCount: number;
  totalPieces: number;
  totalDemand: number;
  allocationCount: number;
  surplus: number;
  surplusDestination: string | null;
  /** Always null for status='draft'; exposed so the UI can type-share
   *  with active-plan card shapes. */
  pinnedDate: string | null;
  /** epoch-ms of productionPlans.updatedAt (falls back to createdAt).
   *  Used by CombineHintCard to pick the freshest same-mould match
   *  when multiple candidates exist (hotfix §4 step 3). */
  updatedAt: number;
}

/**
 * Schedule-pool feed for the manual planner (workspace batch §4.4).
 *
 * Returns parked drafts whose pinnedDate is null AND that have at
 * least one allocation. Identical to `useDraftPlans()` today — the
 * underlying query already enforces those constraints — so we just
 * re-export it under a name that matches the workspace spec.
 *
 * Kept as a separate named hook so future divergence (pool-specific
 * sort, capacity hints) lands here without polluting useDraftPlans.
 */
export function useSchedulePool(): DraftPlanCard[] {
  return useDraftPlans();
}

export function useDraftPlans(): DraftPlanCard[] {
  const { data } = useQuery({
    queryKey: ["production-plans", "draft", "cards"],
    queryFn: async () => {
      const plans = assertOk(
        await supabase.from("productionPlans").select("*").eq("status", "draft"),
      ) as ProductionPlan[];
      if (plans.length === 0) return [] as DraftPlanCard[];
      const planIds = plans.map((p) => p.id!).filter(Boolean);

      const planProductsRes = assertOk(
        await supabase.from("planProducts").select("*").in("planId", planIds),
      ) as PlanProduct[];
      const planProductByPlan = new Map<string, PlanProduct>();
      for (const pp of planProductsRes) {
        if (!planProductByPlan.has(pp.planId)) planProductByPlan.set(pp.planId, pp);
      }

      const productIds = [...new Set(planProductsRes.map((pp) => pp.productId))];
      const mouldIds = [...new Set(planProductsRes.map((pp) => pp.mouldId))];

      const products = productIds.length > 0
        ? assertOk(await supabase.from("products").select("id, name").in("id", productIds)) as Array<{ id: string; name: string }>
        : [];
      const moulds = mouldIds.length > 0
        ? assertOk(await supabase.from("moulds").select("id, name, numberOfCavities").in("id", mouldIds)) as Array<{ id: string; name: string; numberOfCavities: number }>
        : [];
      const productMap = new Map(products.map((p) => [p.id, p]));
      const mouldMap = new Map(moulds.map((m) => [m.id, m]));

      const opl = assertOk(
        await supabase.from("orderPlanLinks").select("*").in("planId", planIds),
      ) as OrderPlanLink[];
      const ppl = assertOk(
        await supabase.from("poPlanLinks").select("*").in("planId", planIds),
      ) as PoPlanLink[];

      // Track order-link presence separately from PO links — the
      // composition-draft heuristic uses orderPlanLinks specifically
      // as the positive signal (only saveDraftToPlan writes them).
      const orderLinkCountByPlan = new Map<string, number>();
      const allocSumByPlan = new Map<string, { count: number; qty: number }>();
      for (const link of opl) {
        orderLinkCountByPlan.set(
          link.planId,
          (orderLinkCountByPlan.get(link.planId) ?? 0) + 1,
        );
        const cur = allocSumByPlan.get(link.planId) ?? { count: 0, qty: 0 };
        cur.count += 1;
        cur.qty += link.allocatedQuantity;
        allocSumByPlan.set(link.planId, cur);
      }
      for (const link of ppl) {
        const cur = allocSumByPlan.get(link.planId) ?? { count: 0, qty: 0 };
        cur.count += 1;
        cur.qty += link.allocatedQuantity;
        allocSumByPlan.set(link.planId, cur);
      }

      const cards: DraftPlanCard[] = [];
      for (const plan of plans) {
        const pp = planProductByPlan.get(plan.id!);
        if (!pp) continue;
        const allocSum = allocSumByPlan.get(plan.id!) ?? { count: 0, qty: 0 };
        if (allocSum.count === 0) continue;
        // Composition-draft heuristic (HOTFIX 2026-05-18). Filters out
        // regenerate-seeded drafts (Campaign:/PO:/× N/— consolidated/
        // — packing) so the manual planner's tray + pool stay scoped
        // to user-composed drafts only. See is-composition-draft.ts
        // for the full decision tree; planType column lands in the
        // next batch.
        const hasOrderPlanLinks = (orderLinkCountByPlan.get(plan.id!) ?? 0) > 0;
        if (!isCompositionDraft({ name: plan.name, hasOrderPlanLinks })) continue;
        const product = productMap.get(pp.productId);
        const mould = mouldMap.get(pp.mouldId);
        const cav = mould?.numberOfCavities ?? 0;
        const mouldCount = pp.quantity;
        const totalPieces = mouldCount * cav;
        cards.push({
          planId: plan.id!,
          name: plan.name,
          productId: pp.productId,
          productName: product?.name ?? pp.productId.slice(0, 8),
          mouldName: mould?.name ?? "—",
          numberOfCavities: cav,
          mouldCount,
          totalPieces,
          totalDemand: allocSum.qty,
          allocationCount: allocSum.count,
          surplus: Math.max(0, totalPieces - allocSum.qty),
          surplusDestination: plan.surplusDestination ?? null,
          pinnedDate: null,
          updatedAt: plan.updatedAt
            ? new Date(plan.updatedAt).getTime()
            : plan.createdAt
              ? new Date(plan.createdAt).getTime()
              : 0,
        });
      }
      cards.sort((a, b) => a.productName.localeCompare(b.productName));
      return cards;
    },
  });
  return data ?? [];
}

/** Returns a map of productId → { lastProducedAt, inStock } for all products that have been in a completed plan. */
export function useProductProductionMap(): Map<string, { lastProducedAt: Date; inStock: boolean }> {
  const { data } = useQuery({
    queryKey: ["product-production-map"],
    queryFn: async () => {
      const donePlans = assertOk(
        await supabase.from("productionPlans").select("id, completedAt").eq("status", "done"),
      ) as { id: string; completedAt: string | null }[];
      if (donePlans.length === 0) return new Map<string, { lastProducedAt: Date; inStock: boolean }>();
      const planCompletedAt = new Map<string, Date>();
      for (const p of donePlans) {
        if (p.completedAt) planCompletedAt.set(p.id, new Date(p.completedAt));
      }
      const allProducts = assertOk(
        await supabase.from("planProducts").select("*").in("planId", donePlans.map((p) => p.id)),
      ) as PlanProduct[];
      const result = new Map<string, { lastProducedAt: Date; inStock: boolean }>();
      for (const pb of allProducts) {
        const completedAt = planCompletedAt.get(pb.planId);
        if (!completedAt) continue;
        const existing = result.get(pb.productId);
        const isInStock = pb.stockStatus !== "gone";
        if (!existing) {
          result.set(pb.productId, { lastProducedAt: completedAt, inStock: isInStock });
        } else {
          result.set(pb.productId, {
            lastProducedAt: completedAt > existing.lastProducedAt ? completedAt : existing.lastProducedAt,
            inStock: existing.inStock || isInStock,
          });
        }
      }
      return result;
    },
  });
  return data ?? new Map();
}

export async function savePlanProduct(pb: Omit<PlanProduct, "id"> & { id?: string }): Promise<string> {
  if (pb.id) {
    const { error } = await supabase.from("planProducts").update(pb).eq("id", pb.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["plan-products"] });
    return pb.id;
  }
  const createdId = newId();
  const { error } = await supabase.from("planProducts").insert({ ...pb, id: createdId });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["plan-products"] });
  return createdId;
}

export function usePlanStepStatuses(planId: string | undefined): PlanStepStatus[] {
  const { data } = useQuery({
    queryKey: ["plan-step-statuses", planId],
    enabled: !!planId,
    queryFn: async () =>
      assertOk(await supabase.from("planStepStatus").select("*").eq("planId", planId!)) as PlanStepStatus[],
  });
  return data ?? [];
}

/** Aggregate hook: every step status across every plan.
 *  Use on list pages (production history) so one query serves all rows instead
 *  of N per-plan subscriptions. Consumer builds a `Map<planId, Set<stepKey>>`. */
export function useAllPlanStepStatuses(): PlanStepStatus[] {
  const { data } = useQuery({
    queryKey: ["plan-step-statuses", "all"],
    queryFn: async () => {
      const out: PlanStepStatus[] = [];
      const PAGE = 1000;
      const MAX_PAGES = 20;
      for (let i = 0; i < MAX_PAGES; i++) {
        const from = i * PAGE;
        const res = await supabase
          .from("planStepStatus")
          .select("*")
          .range(from, from + PAGE - 1);
        const page = assertOk(res) as PlanStepStatus[];
        out.push(...page);
        if (page.length < PAGE) break;
      }
      return out;
    },
  });
  return data ?? [];
}

export async function toggleStep(planId: string, stepKey: string, done: boolean) {
  const existing = assertOkMaybe(
    await supabase.from("planStepStatus")
      .select("*")
      .eq("planId", planId)
      .eq("stepKey", stepKey)
      .maybeSingle(),
  ) as PlanStepStatus | null;
  if (existing) {
    const { error } = await supabase
      .from("planStepStatus")
      .update({ done, doneAt: done ? new Date() : null })
      .eq("id", existing.id!);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("planStepStatus").insert({
      id: newId(),
      planId,
      stepKey,
      done,
      doneAt: done ? new Date() : null,
    });
    if (error) throw error;
  }
  queryClient.invalidateQueries({ queryKey: ["plan-step-statuses"] });
}

/** Mark a step in-progress + stamp `startedAt` (or pause it / resume).
 *  Idempotent — repeated `start` calls leave the original timestamp.
 *  Migration 0090 adds the underlying columns. */
export async function setPlanStepRunState(
  planId: string,
  stepKey: string,
  state: "start" | "pause" | "resume",
): Promise<void> {
  const existing = assertOkMaybe(
    await supabase.from("planStepStatus")
      .select("*")
      .eq("planId", planId)
      .eq("stepKey", stepKey)
      .maybeSingle(),
  ) as PlanStepStatus | null;
  const now = new Date();
  if (existing) {
    const patch: Record<string, unknown> = {};
    if (state === "start") {
      if (!existing.startedAt) patch.startedAt = now;
      patch.pausedAt = null;
    } else if (state === "pause") {
      patch.pausedAt = now;
    } else {
      patch.pausedAt = null;
    }
    const { error } = await supabase
      .from("planStepStatus")
      .update(patch)
      .eq("id", existing.id!);
    if (error) throw error;
  } else if (state === "start") {
    const { error } = await supabase.from("planStepStatus").insert({
      id: newId(),
      planId,
      stepKey,
      done: false,
      startedAt: now,
    });
    if (error) throw error;
  }
  queryClient.invalidateQueries({ queryKey: ["plan-step-statuses"] });
}

/** Assign / unassign a person to a step. `personId = null` clears. */
export async function setPlanStepPerson(
  planId: string,
  stepKey: string,
  personId: string | null,
): Promise<void> {
  const existing = assertOkMaybe(
    await supabase.from("planStepStatus")
      .select("*")
      .eq("planId", planId)
      .eq("stepKey", stepKey)
      .maybeSingle(),
  ) as PlanStepStatus | null;
  if (existing) {
    const { error } = await supabase
      .from("planStepStatus")
      .update({ personId })
      .eq("id", existing.id!);
    if (error) throw error;
  } else if (personId) {
    const { error } = await supabase.from("planStepStatus").insert({
      id: newId(),
      planId,
      stepKey,
      done: false,
      personId,
    });
    if (error) throw error;
  }
  queryClient.invalidateQueries({ queryKey: ["plan-step-statuses"] });
}

// --- User Preferences (single-row config, synced via Supabase) ---

const DEFAULT_PREFERENCES: Omit<UserPreferences, "id"> = {
  marketRegion: "EU",
  currency: "EUR",
  defaultFillMode: "percentage",
  facilityMayContain: [],
  coatings: [...DEFAULT_COATINGS],
  updatedAt: new Date(),
};

/** Read the single UserPreferences record, or return defaults if none exists yet. */
async function getPreferences(): Promise<UserPreferences> {
  const all = assertOk(await supabase.from("userPreferences").select("*")) as UserPreferences[];
  return all[0] ?? { ...DEFAULT_PREFERENCES };
}

/** Update one or more fields on the preferences record, creating it if needed. */
async function updatePreference(patch: Partial<Omit<UserPreferences, "id">>): Promise<void> {
  const all = assertOk(await supabase.from("userPreferences").select("*")) as UserPreferences[];
  const existing = all[0];
  if (existing?.id) {
    const { error } = await supabase
      .from("userPreferences")
      .update({ ...patch, updatedAt: new Date() })
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("userPreferences").insert({
      ...DEFAULT_PREFERENCES,
      ...patch,
      id: newId(),
      updatedAt: new Date(),
    });
    if (error) throw error;
  }
  queryClient.invalidateQueries({ queryKey: ["user-preferences"] });
}

export function useCoatings(): string[] {
  const { data } = useQuery({
    queryKey: ["user-preferences", "coatings"],
    queryFn: async () => (await getPreferences()).coatings,
  });
  return data ?? [...DEFAULT_COATINGS];
}

/** Last successful `regenerateAllPlansAndSchedule` stamp. Used by /plan
 *  (and dashboard) to show "Last updated …" beside the Regenerate button. */
export function useLastRegenAt(): Date | null {
  const { data } = useQuery({
    queryKey: ["user-preferences", "lastRegenAt"],
    queryFn: async () => {
      const p = await getPreferences();
      const v = p.lastRegenAt;
      if (!v) return null;
      const d = v instanceof Date ? v : new Date(v as unknown as string);
      return Number.isFinite(d.getTime()) ? d : null;
    },
    refetchInterval: 30_000,
  });
  return data ?? null;
}

export async function addCoating(coating: string): Promise<void> {
  const prefs = await getPreferences();
  if (!prefs.coatings.includes(coating)) {
    await updatePreference({ coatings: [...prefs.coatings, coating] });
  }
}

// --- Product Categories ---
//
// Replaces the legacy free-text `productType` string with a managed table. Each
// category configures the recommended shell-percentage range and default. The
// list is editable via the Categories tab on /products. Bar-like UI behaviour is
// implicit from the range — see lib/productCategories.ts for the helpers.

/** Idempotently ensure the default seeded categories (moulded + bar) exist.
 *  Called from the seed loader on every app load — no-ops once seeded. Fresh users
 *  hit this path because the v2 upgrade hook only runs for users coming from v1. */
export async function ensureDefaultProductCategories(): Promise<void> {
  const existing = assertOk(
    await supabase.from("productCategories").select("name"),
  ) as { name: string }[];
  const existingNames = new Set(existing.map((c) => c.name));
  const missing = DEFAULT_PRODUCT_CATEGORIES.filter((seed) => !existingNames.has(seed.name));
  if (missing.length === 0) return;
  const now = new Date();
  const { error } = await supabase.from("productCategories").insert(
    missing.map((seed) => ({
      id: newId(),
      name: seed.name,
      shellPercentMin: seed.shellPercentMin,
      shellPercentMax: seed.shellPercentMax,
      defaultShellPercent: seed.defaultShellPercent,
      createdAt: now,
      updatedAt: now,
    })),
  );
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["product-categories"] });
}

export function useProductCategories(includeArchived = false): ProductCategory[] {
  const { data } = useQuery({
    queryKey: ["product-categories", { includeArchived }],
    queryFn: async () => {
      const rows = assertOk(await supabase.from("productCategories").select("*")) as ProductCategory[];
      return rows
        .filter((c) => includeArchived || !c.archived)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    },
  });
  return data ?? [];
}

export function useProductCategory(id: string | undefined): ProductCategory | undefined {
  const { data } = useQuery({
    queryKey: ["product-categories", id],
    enabled: !!id,
    queryFn: async () => {
      const row = assertOkMaybe(
        await supabase.from("productCategories").select("*").eq("id", id!).maybeSingle(),
      );
      return row as ProductCategory | null;
    },
  });
  return data ?? undefined;
}

/** Reactive map of categoryId → ProductCategory for fast lookup in lists. */
export function useProductCategoryMap(): Map<string, ProductCategory> {
  const { data } = useQuery({
    queryKey: ["product-categories", "map"],
    queryFn: async () => {
      const rows = assertOk(await supabase.from("productCategories").select("*")) as ProductCategory[];
      return new Map(rows.map((c) => [c.id!, c]));
    },
  });
  return data ?? new Map();
}

export async function saveProductCategory(category: Omit<ProductCategory, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<string> {
  const validation = validateCategoryRange({
    shellPercentMin: category.shellPercentMin,
    shellPercentMax: category.shellPercentMax,
    defaultShellPercent: category.defaultShellPercent,
  });
  if (!validation.valid) {
    throw new Error(validation.errors.join("; "));
  }
  const now = new Date();
  if (category.id) {
    const { error } = await supabase
      .from("productCategories")
      .update({ ...category, updatedAt: now })
      .eq("id", category.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["product-categories"] });
    return category.id;
  }
  const createdId = newId();
  const { error } = await supabase
    .from("productCategories")
    .insert({ ...category, id: createdId, createdAt: now, updatedAt: now });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["product-categories"] });
  return createdId;
}

export async function archiveProductCategory(id: string): Promise<void> {
  const { error } = await supabase
    .from("productCategories")
    .update({ archived: true, updatedAt: new Date() })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["product-categories"] });
}

export async function unarchiveProductCategory(id: string): Promise<void> {
  const { error } = await supabase
    .from("productCategories")
    .update({ archived: false, updatedAt: new Date() })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["product-categories"] });
}

/** Hard-delete a category. Throws if any product still references it — callers
 *  must call useProductCategoryUsage() first and offer Archive instead. */
export async function deleteProductCategory(id: string): Promise<void> {
  const { count, error: countErr } = await supabase
    .from("products")
    .select("*", { count: "exact", head: true })
    .eq("productCategoryId", id);
  if (countErr) throw countErr;
  if ((count ?? 0) > 0) {
    throw new Error(`Cannot delete category: ${count} product(s) still reference it. Archive it instead.`);
  }
  const { error } = await supabase.from("productCategories").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["product-categories"] });
}

/** Reactive list of products currently assigned to a category — used by the
 *  detail page to show "Used in" and to switch the delete button to Archive. */
export function useProductCategoryUsage(categoryId: string | undefined): Omit<Product, "photo">[] {
  const { data } = useQuery({
    queryKey: ["product-category-usage", categoryId],
    enabled: !!categoryId,
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("products").select("*").eq("productCategoryId", categoryId!),
      ) as Product[];
      return rows
        .filter((p) => !p.archived)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({ photo: _photo, ...rest }) => rest);
    },
  });
  return data ?? [];
}

/** Reactive map of categoryId → number of (non-archived) products using it.
 *  Used by the list page to show usage counts on each row. */
export function useProductCategoryUsageCounts(): Map<string, number> {
  const { data } = useQuery({
    queryKey: ["product-category-usage-counts"],
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("products").select("productCategoryId, archived"),
      ) as { productCategoryId: string | null; archived: boolean }[];
      const counts = new Map<string, number>();
      for (const p of rows) {
        if (p.archived) continue;
        const id = p.productCategoryId;
        if (!id) continue;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      return counts;
    },
  });
  return data ?? new Map();
}

// --- Ingredient categories ---

export async function ensureDefaultIngredientCategories(): Promise<void> {
  const existing = assertOk(
    await supabase.from("ingredientCategories").select("name"),
  ) as { name: string }[];
  const existingNames = new Set(existing.map((c) => c.name));
  const missing = DEFAULT_INGREDIENT_CATEGORIES.filter((seed) => !existingNames.has(seed.name));
  if (missing.length === 0) return;
  const now = new Date();
  const { error } = await supabase.from("ingredientCategories").insert(
    missing.map((seed) => ({
      id: newId(),
      name: seed.name,
      createdAt: now,
      updatedAt: now,
    })),
  );
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["ingredient-categories"] });
}

export function useIngredientCategories(includeArchived = false): IngredientCategory[] {
  const { data } = useQuery({
    queryKey: ["ingredient-categories", { includeArchived }],
    queryFn: async () => {
      const rows = assertOk(await supabase.from("ingredientCategories").select("*"));
      return (rows as IngredientCategory[])
        .filter((c) => includeArchived || !c.archived)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    },
  });
  return data ?? [];
}

export function useIngredientCategory(id: string | undefined): IngredientCategory | undefined {
  const { data } = useQuery({
    queryKey: ["ingredient-categories", id],
    enabled: !!id,
    queryFn: async () => {
      const row = assertOkMaybe(
        await supabase.from("ingredientCategories").select("*").eq("id", id!).maybeSingle(),
      );
      return row as IngredientCategory | null;
    },
  });
  return data ?? undefined;
}

/** Reactive list of all ingredient category names (non-archived). Used by the ingredient
 *  form select dropdown and the list page grouping/filter. */
export function useIngredientCategoryNames(): string[] {
  const { data } = useQuery({
    queryKey: ["ingredient-categories", "names"],
    queryFn: async () => {
      const rows = assertOk(await supabase.from("ingredientCategories").select("*"));
      return (rows as IngredientCategory[])
        .filter((c) => !c.archived)
        .map((c) => c.name)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    },
  });
  return data ?? [];
}

export async function saveIngredientCategory(category: Omit<IngredientCategory, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<string> {
  const now = new Date();
  if (category.id) {
    // Detect rename — cascade to all ingredients using the old name.
    // Unlike Dexie we have no client-side multi-statement transaction here;
    // the two updates run back-to-back. Acceptable for a 2-user app.
    const existing = assertOkMaybe(
      await supabase.from("ingredientCategories").select("*").eq("id", category.id).maybeSingle(),
    ) as IngredientCategory | null;
    if (existing && existing.name !== category.name) {
      const { error: categoryErr } = await supabase
        .from("ingredientCategories")
        .update({ ...category, updatedAt: now })
        .eq("id", category.id);
      if (categoryErr) throw categoryErr;
      const { error: cascadeErr } = await supabase
        .from("ingredients")
        .update({ category: category.name })
        .eq("category", existing.name);
      if (cascadeErr) throw cascadeErr;
    } else {
      const { error } = await supabase
        .from("ingredientCategories")
        .update({ ...category, updatedAt: now })
        .eq("id", category.id);
      if (error) throw error;
    }
    queryClient.invalidateQueries({ queryKey: ["ingredient-categories"] });
    queryClient.invalidateQueries({ queryKey: ["ingredients"] });
    return category.id;
  }
  const createdId = newId();
  const { error } = await supabase
    .from("ingredientCategories")
    .insert({ ...category, id: createdId, createdAt: now, updatedAt: now });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["ingredient-categories"] });
  return createdId;
}

export async function archiveIngredientCategory(id: string): Promise<void> {
  const { error } = await supabase
    .from("ingredientCategories")
    .update({ archived: true, updatedAt: new Date() })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["ingredient-categories"] });
}

export async function unarchiveIngredientCategory(id: string): Promise<void> {
  const { error } = await supabase
    .from("ingredientCategories")
    .update({ archived: false, updatedAt: new Date() })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["ingredient-categories"] });
}

/** Hard-delete an ingredient category. Throws if any ingredient still references it — callers
 *  must call useIngredientCategoryUsage() first and offer Archive instead.
 *  Also throws if attempting to delete the protected "Chocolate" category. */
export async function deleteIngredientCategory(id: string): Promise<void> {
  const cat = assertOkMaybe(
    await supabase.from("ingredientCategories").select("*").eq("id", id).maybeSingle(),
  ) as IngredientCategory | null;
  if (cat?.name === "Chocolate") {
    throw new Error('The "Chocolate" category cannot be deleted — it is required for shell ingredient selection.');
  }
  const { count, error: countErr } = await supabase
    .from("ingredients")
    .select("*", { count: "exact", head: true })
    .eq("category", cat?.name ?? "");
  if (countErr) throw countErr;
  if ((count ?? 0) > 0) {
    throw new Error(`Cannot delete category: ${count} ingredient(s) still reference it. Archive it instead.`);
  }
  const { error } = await supabase.from("ingredientCategories").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["ingredient-categories"] });
}

/** Reactive list of (non-archived) ingredients currently assigned to a category by name. */
export function useIngredientCategoryUsage(categoryName: string | undefined): Omit<Ingredient, "photo">[] {
  const { data } = useQuery({
    queryKey: ["ingredient-category-usage", categoryName],
    enabled: !!categoryName,
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("ingredients").select("*").eq("category", categoryName!),
      );
      return (rows as Ingredient[])
        .filter((i) => !i.archived)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  return data ?? [];
}

/** Reactive map of category name → number of (non-archived) ingredients using it. */
export function useIngredientCategoryUsageCounts(): Map<string, number> {
  const { data } = useQuery({
    queryKey: ["ingredient-category-usage-counts"],
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("ingredients").select("category, archived"),
      ) as { category: string | null; archived: boolean }[];
      const counts = new Map<string, number>();
      for (const ing of rows) {
        if (ing.archived) continue;
        if (!ing.category) continue;
        counts.set(ing.category, (counts.get(ing.category) ?? 0) + 1);
      }
      return counts;
    },
  });
  return data ?? new Map();
}

export function useMarketRegion(): MarketRegion {
  const { data } = useQuery({
    queryKey: ["user-preferences", "marketRegion"],
    queryFn: async () => (await getPreferences()).marketRegion,
  });
  return data ?? "EU";
}

export async function setMarketRegion(region: MarketRegion): Promise<void> {
  await updatePreference({ marketRegion: region });
}

export function useCurrency(): CurrencyCode {
  const { data } = useQuery({
    queryKey: ["user-preferences", "currency"],
    queryFn: async () => (await getPreferences()).currency,
  });
  return data ?? "EUR";
}

export async function setCurrency(code: CurrencyCode): Promise<void> {
  await updatePreference({ currency: code });
}

/** Reactive currency symbol for use in UI components. Combines useCurrency + getCurrencySymbol. */
export function useCurrencySymbol(): string {
  const code = useCurrency();
  return getCurrencySymbol(code);
}

export function useDefaultFillMode(): FillMode {
  const { data } = useQuery({
    queryKey: ["user-preferences", "defaultFillMode"],
    queryFn: async () => (await getPreferences()).defaultFillMode,
  });
  return data ?? "percentage";
}

export async function setDefaultFillMode(mode: FillMode): Promise<void> {
  await updatePreference({ defaultFillMode: mode });
}

export function useFacilityMayContain(): string[] {
  const { data } = useQuery({
    queryKey: ["user-preferences", "facilityMayContain"],
    queryFn: async () => (await getPreferences()).facilityMayContain,
  });
  return data ?? [];
}

export async function setFacilityMayContain(allergens: string[]): Promise<void> {
  await updatePreference({ facilityMayContain: allergens });
}

// --- Filling usage (which products use a filling) ---

export function useFillingUsageCounts(): Map<string, number> {
  const { data } = useQuery({
    queryKey: ["filling-usage-counts"],
    queryFn: async () => {
      const all = assertOk(
        await supabase.from("productFillings").select("fillingId, productId"),
      ) as { fillingId: string; productId: string }[];
      const counts = new Map<string, Set<string>>();
      for (const rl of all) {
        if (!counts.has(rl.fillingId)) counts.set(rl.fillingId, new Set());
        counts.get(rl.fillingId)!.add(rl.productId);
      }
      const result = new Map<string, number>();
      for (const [fillingId, productIds] of counts) result.set(fillingId, productIds.size);
      return result;
    },
  });
  return data ?? new Map();
}

export function useFillingUsage(fillingId: string | undefined): Product[] {
  const { data } = useQuery({
    queryKey: ["filling-usage", fillingId],
    enabled: !!fillingId,
    queryFn: async () => {
      const productFillings = assertOk(
        await supabase.from("productFillings").select("productId").eq("fillingId", fillingId!),
      ) as { productId: string }[];
      const productIds = [...new Set(productFillings.map((rl) => rl.productId))];
      if (productIds.length === 0) return [] as Product[];
      const products = assertOk(
        await supabase.from("products").select("*").in("id", productIds),
      ) as Product[];
      return products.sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  return data ?? [];
}

// --- Ingredient usage (which fillings + products use an ingredient) ---

export function useIngredientUsage(ingredientId: string | undefined) {
  const { data } = useQuery({
    queryKey: ["ingredient-usage", ingredientId],
    enabled: !!ingredientId,
    queryFn: async () => {
      const lis = assertOk(
        await supabase.from("fillingIngredients").select("fillingId").eq("ingredientId", ingredientId!),
      ) as { fillingId: string }[];
      const fillingIds = [...new Set(lis.map((li) => li.fillingId))];
      if (fillingIds.length === 0) return [];

      const [fillings, productFillings] = await Promise.all([
        supabase.from("fillings").select("*").in("id", fillingIds).then((r) => assertOk(r) as Filling[]),
        supabase.from("productFillings").select("*").in("fillingId", fillingIds).then((r) => assertOk(r) as ProductFilling[]),
      ]);

      const productIds = [...new Set(productFillings.map((rl) => rl.productId))];
      const products = productIds.length > 0
        ? (assertOk(await supabase.from("products").select("*").in("id", productIds)) as Product[])
        : [];

      const productMap = new Map(products.map((r) => [r.id!, r]));

      return fillings.map((filling) => ({
        filling,
        products: productFillings
          .filter((rl) => rl.fillingId === filling.id)
          .map((rl) => productMap.get(rl.productId))
          .filter((r): r is NonNullable<typeof r> => r != null),
      }));
    },
  });
  return data ?? [];
}

// --- Ingredient Price History ---

export async function deleteIngredientPriceHistoryEntry(id: string): Promise<void> {
  const { error } = await supabase.from("ingredientPriceHistory").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["ingredient-price-history"] });
}

export function useIngredientPriceHistory(ingredientId: string | undefined): IngredientPriceHistory[] {
  const { data } = useQuery({
    queryKey: ["ingredient-price-history", ingredientId],
    enabled: !!ingredientId,
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("ingredientPriceHistory").select("*").eq("ingredientId", ingredientId!),
      );
      return (rows as IngredientPriceHistory[]).sort(
        (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
      );
    },
  });
  return data ?? [];
}

async function saveIngredientPriceEntry(
  ingredientId: string,
  ingredient: Ingredient,
  extras?: {
    supplier?: string;
    vatRatePercent?: number;
    invoiceNumber?: string;
    note?: string;
    updatedDefault?: boolean;
  },
): Promise<void> {
  const cpg = deriveIngredientCostPerGram(ingredient);
  if (cpg === null) return;
  const { error } = await supabase.from("ingredientPriceHistory").insert({
    id: newId(),
    ingredientId,
    costPerGram: cpg,
    recordedAt: new Date(),
    purchaseCost: ingredient.purchaseCost,
    purchaseQty: ingredient.purchaseQty,
    purchaseUnit: ingredient.purchaseUnit,
    gramsPerUnit: ingredient.gramsPerUnit,
    supplier: extras?.supplier,
    vatRatePercent: extras?.vatRatePercent,
    invoiceNumber: extras?.invoiceNumber,
    note: extras?.note,
    updatedDefault: extras?.updatedDefault ?? true,
  });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["ingredient-price-history", ingredientId] });
}

// --- Product Cost Snapshots ---

export function useProductCostSnapshots(productId: string | undefined): ProductCostSnapshot[] {
  const { data } = useQuery({
    queryKey: ["product-cost-snapshots", productId],
    enabled: !!productId,
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("productCostSnapshots").select("*").eq("productId", productId!),
      ) as ProductCostSnapshot[];
      return rows.sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());
    },
  });
  return data ?? [];
}

/**
 * Latest cost snapshot per product. Returns a Map<productId, costPerProduct>.
 * Used by monthly margin report and any caller needing all costs at once.
 * Avoids N+1 per-product queries.
 */
export function useAllLatestProductCosts(): Map<string, number> {
  const { data } = useQuery({
    queryKey: ["product-cost-snapshots", "all-latest"],
    queryFn: async () => {
      const rows = assertOk(
        await supabase
          .from("productCostSnapshots")
          .select("productId, costPerProduct, recordedAt"),
      ) as Array<{ productId: string; costPerProduct: number; recordedAt: string | Date }>;
      const latestByProduct = new Map<string, { cost: number; at: number }>();
      for (const r of rows) {
        const at = new Date(r.recordedAt).getTime();
        const existing = latestByProduct.get(r.productId);
        if (!existing || at > existing.at) {
          latestByProduct.set(r.productId, { cost: Number(r.costPerProduct) || 0, at });
        }
      }
      const out = new Map<string, number>();
      for (const [pid, entry] of latestByProduct) out.set(pid, entry.cost);
      return out;
    },
  });
  return data ?? new Map();
}

export function useLatestProductCostSnapshot(productId: string | undefined): ProductCostSnapshot | undefined {
  const { data } = useQuery({
    queryKey: ["product-cost-snapshots", productId, "latest"],
    enabled: !!productId,
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("productCostSnapshots").select("*").eq("productId", productId!),
      ) as ProductCostSnapshot[];
      if (rows.length === 0) return null;
      return rows.reduce((latest, snap) =>
        new Date(snap.recordedAt) > new Date(latest.recordedAt) ? snap : latest,
      );
    },
  });
  return data ?? undefined;
}

export async function computeAndSaveProductCostSnapshot(params: {
  productId: string;
  triggerType: ProductCostSnapshot["triggerType"];
  triggerDetail: string;
}): Promise<void> {
  const { productId, triggerType, triggerDetail } = params;

  const [product, productFillings, allIngredients] = await Promise.all([
    supabase.from("products").select("*").eq("id", productId).maybeSingle().then((r) => assertOkMaybe(r) as Product | null),
    supabase.from("productFillings").select("*").eq("productId", productId).then((r) => assertOk(r) as ProductFilling[]),
    supabase.from("ingredients").select("*").then((r) => assertOk(r) as Ingredient[]),
  ]);

  if (!product) return;

  const fillingIds = productFillings.map((rl) => rl.fillingId);
  // When the product's shell is a filling (migration 0062), pull its
  // row + recipe too so shellCostPerGram can resolve.
  const shellFillingId = product.shellFillingId ?? null;
  const allFillingIdsToFetch = Array.from(new Set(
    shellFillingId ? [...fillingIds, shellFillingId] : fillingIds,
  ));
  const [fillings, ...liArrays] = await Promise.all([
    allFillingIdsToFetch.length > 0
      ? supabase.from("fillings").select("*").in("id", allFillingIdsToFetch).then((r) => assertOk(r) as Filling[])
      : Promise.resolve([] as Filling[]),
    ...allFillingIdsToFetch.map((lid) =>
      supabase.from("fillingIngredients").select("*").eq("fillingId", lid).then((r) => assertOk(r) as FillingIngredient[]),
    ),
  ]);

  const fillingsMap = new Map(fillings.map((l) => [l.id!, l]));
  const fillingIngredientsMap = new Map<string, typeof liArrays[0]>();
  allFillingIdsToFetch.forEach((lid, i) => fillingIngredientsMap.set(lid, liArrays[i]));

  const ingredientCostMap = buildIngredientCostMap(allIngredients);
  const ingredientMap = new Map(allIngredients.map((i) => [i.id!, i]));

  // Resolve shell cost. Two paths:
  //   1. Ingredient-based shell (legacy) — single chocolate ingredient.
  //   2. Filling-based shell (2026-04-24, migration 0062) — self-made
  //      blend stored as a filling. Cost per gram = filling recipe
  //      totalCost / totalGrams.
  const shellIngredientId = product.shellIngredientId;
  // `shellFillingId` already declared above to pre-fetch the recipe.
  let shellCostPerGram: number | null = null;
  let shellLabel: string | undefined;
  if (shellIngredientId) {
    shellCostPerGram = ingredientCostMap.get(shellIngredientId) ?? null;
    const shellIng = ingredientMap.get(shellIngredientId);
    shellLabel = shellIng?.name;
  } else if (shellFillingId) {
    const lis = fillingIngredientsMap.get(shellFillingId) ?? [];
    let totalG = 0;
    let totalCost = 0;
    for (const li of lis) {
      if (!li.ingredientId) continue; // sub-filling rows not recursed yet
      const cpg = ingredientCostMap.get(li.ingredientId);
      if (cpg == null) continue;
      totalG += li.amount;
      totalCost += li.amount * cpg;
    }
    shellCostPerGram = totalG > 0 ? totalCost / totalG : null;
    shellLabel = fillingsMap.get(shellFillingId)?.name;
  }
  const shellIngredient = shellIngredientId ? ingredientMap.get(shellIngredientId) : undefined;
  const shellPercentage = product.shellPercentage ?? 37;

  // User-initiated direct edits (changing shell chocolate, mould, or forking a
  // filling version) always refresh the cost — these are explicit changes to the
  // product itself, not ambient price drift.
  const isUserEdit = triggerType === "manual"
    || triggerType === "shell_change"
    || triggerType === "mould_change"
    || triggerType === "filling_version";

  // Gating for ambient drift (ingredient_price, coating_change) — we want a lean
  // snapshot history:
  //   1. Every ingredient must be priced (partial snapshots are noise).
  //   2. Always record the very first snapshot once pricing is complete — it powers the
  //      product's cost tab even before production.
  //   3. After that first snapshot, only keep recording automatically if the product has
  //      actually been produced. For unproduced products the user can still force a
  //      snapshot via manual recalc.
  if (!isUserEdit) {
    const allFillingIngredients = liArrays.flat();
    const usedIngredientIds = [...new Set(
      allFillingIngredients
        .map((li) => li.ingredientId)
        .filter((id): id is string => !!id),
    )];
    const allPriced = usedIngredientIds.every((id) => {
      const ing = ingredientMap.get(id);
      return ing && hasPricingData(ing);
    });
    // Shell pricing check covers both paths:
    //   - ingredient shell: the ingredient has pricing data
    //   - filling shell: shellCostPerGram resolved to a number
    const shellPriced =
      shellPercentage === 0 ||
      (shellIngredientId ? (shellIngredient ? hasPricingData(shellIngredient) : false) :
       shellFillingId ? shellCostPerGram != null :
       true);
    if (!allPriced || !shellPriced) return;

    const { count: existingCount, error: countErr } = await supabase
      .from("productCostSnapshots")
      .select("*", { count: "exact", head: true })
      .eq("productId", productId);
    if (countErr) throw countErr;
    if ((existingCount ?? 0) > 0 && !(await hasProductBeenProduced(productId))) return;
  }

  const mould = product.defaultMouldId
    ? (assertOkMaybe(
        await supabase.from("moulds").select("*").eq("id", product.defaultMouldId).maybeSingle(),
      ) as Mould | null) ?? undefined
    : undefined;

  // In grams mode, derive shell percentage from the fill grams
  const fillMode = product.fillMode ?? "percentage";
  let effectiveShellPercentage = shellPercentage;
  if (fillMode === "grams" && mould) {
    const totalFillGrams = productFillings.reduce((sum, rl) => sum + (rl.fillGrams ?? 0), 0);
    effectiveShellPercentage = deriveShellPercentageFromGrams(mould.cavityWeightG, totalFillGrams);
  }

  const { costPerProduct, breakdown } = calculateProductCost({
    mould: mould ?? null,
    productFillings,
    fillingIngredientsMap,
    fillingsMap,
    ingredientCostMap,
    shellChocolateCostPerGram: shellCostPerGram,
    shellChocolateLabel: shellLabel,
    shellPercentage: effectiveShellPercentage,
    fillMode,
  });

  // Dedupe: if the most recent snapshot for this product is byte-for-byte identical,
  // skip the write — nothing changed.
  const serializedBreakdown = serializeBreakdown(breakdown);
  const latest = (assertOk(
    await supabase.from("productCostSnapshots").select("*").eq("productId", productId),
  ) as ProductCostSnapshot[]).sort(
    (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
  );
  const mostRecent = latest[0];
  if (
    mostRecent &&
    mostRecent.costPerProduct === costPerProduct &&
    mostRecent.breakdown === serializedBreakdown &&
    mostRecent.mouldId === product.defaultMouldId &&
    mostRecent.coatingName === product.coating
  ) {
    return;
  }

  const { error } = await supabase.from("productCostSnapshots").insert({
    id: newId(),
    productId,
    costPerProduct,
    breakdown: serializedBreakdown,
    recordedAt: new Date(),
    triggerType,
    triggerDetail,
    mouldId: product.defaultMouldId,
    coatingName: product.coating,
  });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["product-cost-snapshots", productId] });
}

async function computeSnapshotsForFilling(
  fillingId: string,
  triggerType: ProductCostSnapshot["triggerType"],
  triggerDetail: string,
): Promise<void> {
  const productFillings = assertOk(
    await supabase.from("productFillings").select("productId").eq("fillingId", fillingId),
  ) as { productId: string }[];
  const productIds = [...new Set(productFillings.map((rl) => rl.productId))];
  await Promise.all(
    productIds.map((productId) => computeAndSaveProductCostSnapshot({ productId, triggerType, triggerDetail }))
  );
}

async function computeSnapshotsForAffectedProducts(
  ingredientId: string,
  triggerType: ProductCostSnapshot["triggerType"],
  triggerDetail: string,
): Promise<void> {
  const productIds = new Set<string>();

  // Products affected via filling ingredients — Supabase.
  const lis = assertOk(
    await supabase.from("fillingIngredients").select("fillingId").eq("ingredientId", ingredientId),
  ) as { fillingId: string }[];
  const fillingIds = [...new Set(lis.map((li) => li.fillingId))];
  if (fillingIds.length > 0) {
    const productFillings = assertOk(
      await supabase.from("productFillings").select("productId").in("fillingId", fillingIds),
    ) as { productId: string }[];
    for (const rl of productFillings) productIds.add(rl.productId);
  }

  // Products affected via shell ingredient (direct FK on product).
  const shellProducts = assertOk(
    await supabase.from("products").select("id").eq("shellIngredientId", ingredientId),
  ) as { id: string }[];
  for (const p of shellProducts) productIds.add(p.id);

  if (productIds.size === 0) return;
  await Promise.all(
    [...productIds].map((productId) => computeAndSaveProductCostSnapshot({ productId, triggerType, triggerDetail }))
  );
}

export async function recalculateProductCost(productId: string): Promise<void> {
  await computeAndSaveProductCostSnapshot({ productId, triggerType: "manual", triggerDetail: "Manual recalculation" });
}

export async function clearAllProductCostSnapshots(): Promise<number> {
  const { count, error: countErr } = await supabase
    .from("productCostSnapshots")
    .select("*", { count: "exact", head: true });
  if (countErr) throw countErr;
  // Supabase requires a filter on delete — use a tautology that matches every row.
  const { error } = await supabase.from("productCostSnapshots").delete().not("id", "is", null);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["product-cost-snapshots"] });
  return count ?? 0;
}


// --- Allergen aggregation ---

export async function aggregateFillingAllergens(fillingId: string): Promise<string[]> {
  const lis = assertOk(
    await supabase.from("fillingIngredients").select("ingredientId").eq("fillingId", fillingId),
  ) as { ingredientId: string }[];
  const ingredientIds = lis.map((li) => li.ingredientId);
  if (ingredientIds.length === 0) return [];
  const ingredients = assertOk(
    await supabase.from("ingredients").select("allergens").in("id", ingredientIds),
  ) as { allergens: string[] }[];
  const allergenSet = new Set<string>();
  for (const ing of ingredients) {
    for (const a of ing.allergens) {
      allergenSet.add(a);
    }
  }
  return Array.from(allergenSet).sort();
}

export async function updateFillingAllergens(fillingId: string) {
  const allergens = await aggregateFillingAllergens(fillingId);
  const { error } = await supabase.from("fillings").update({ allergens }).eq("id", fillingId);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["fillings"] });
}

// --- Lab (Experiments) ---

export function useExperiments(): Experiment[] {
  const { data } = useQuery({
    queryKey: ["experiments"],
    queryFn: async () => {
      const rows = assertOk(await supabase.from("experiments").select("*")) as Experiment[];
      return rows
        .filter((e) => !e.supersededAt)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },
  });
  return data ?? [];
}

export function useExperiment(id: string | undefined): Experiment | undefined {
  const { data } = useQuery({
    queryKey: ["experiments", id],
    enabled: !!id,
    queryFn: async () => {
      const row = assertOkMaybe(
        await supabase.from("experiments").select("*").eq("id", id!).maybeSingle(),
      );
      return row as Experiment | null;
    },
  });
  return data ?? undefined;
}

export async function saveExperiment(experiment: Omit<Experiment, "id"> & { id?: string }) {
  const now = new Date();
  if (experiment.id) {
    const { error } = await supabase
      .from("experiments")
      .update({ ...experiment, updatedAt: now })
      .eq("id", experiment.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["experiments"] });
    return experiment.id;
  }
  const createdId = newId();
  const { error } = await supabase
    .from("experiments")
    .insert({ ...experiment, id: createdId, createdAt: now, updatedAt: now });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["experiments"] });
  return createdId;
}

export async function deleteExperiment(id: string) {
  const delEi = await supabase.from("experimentIngredients").delete().eq("experimentId", id);
  if (delEi.error) throw delEi.error;
  const { error } = await supabase.from("experiments").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["experiments"] });
  queryClient.invalidateQueries({ queryKey: ["experiment-ingredients"] });
}

export function useExperimentIngredients(experimentId: string | undefined): ExperimentIngredient[] {
  const { data } = useQuery({
    queryKey: ["experiment-ingredients", experimentId],
    enabled: !!experimentId,
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("experimentIngredients").select("*").eq("experimentId", experimentId!),
      ) as ExperimentIngredient[];
      return rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    },
  });
  return data ?? [];
}

export async function saveExperimentIngredient(ei: Omit<ExperimentIngredient, "id"> & { id?: string }) {
  if (ei.id) {
    const { error } = await supabase.from("experimentIngredients").update(ei).eq("id", ei.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["experiment-ingredients"] });
    return ei.id;
  }
  const createdId = newId();
  const { error } = await supabase.from("experimentIngredients").insert({ ...ei, id: createdId });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["experiment-ingredients"] });
  return createdId;
}

export async function deleteExperimentIngredient(id: string) {
  const { error } = await supabase.from("experimentIngredients").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["experiment-ingredients"] });
}

export async function forkExperimentVersion(experimentId: string): Promise<string> {
  const old = assertOkMaybe(
    await supabase.from("experiments").select("*").eq("id", experimentId).maybeSingle(),
  ) as Experiment | null;
  if (!old) throw new Error("Experiment not found");
  const now = new Date();
  const rootId = old.rootId ?? old.id!;
  const all = assertOk(await supabase.from("experiments").select("*")) as Experiment[];
  const chain = all.filter((e) => e.id === rootId || e.rootId === rootId);
  const maxVersion = Math.max(...chain.map((e) => e.version ?? 1));
  const supErr = (await supabase
    .from("experiments")
    .update({ supersededAt: now, updatedAt: now })
    .eq("id", experimentId)).error;
  if (supErr) throw supErr;
  const newExpId = newId();
  const { error: insErr } = await supabase.from("experiments").insert({
    id: newExpId,
    name: old.name,
    ganacheType: old.ganacheType,
    applicationType: old.applicationType,
    rootId,
    version: maxVersion + 1,
    createdAt: now,
    updatedAt: now,
  });
  if (insErr) throw insErr;
  const ingredients = assertOk(
    await supabase.from("experimentIngredients").select("*").eq("experimentId", experimentId),
  ) as ExperimentIngredient[];
  if (ingredients.length > 0) {
    const { error } = await supabase.from("experimentIngredients").insert(
      ingredients.map((ei) => ({
        id: newId(),
        experimentId: newExpId,
        ingredientId: ei.ingredientId,
        amount: ei.amount,
        sortOrder: ei.sortOrder,
      })),
    );
    if (error) throw error;
  }
  queryClient.invalidateQueries({ queryKey: ["experiments"] });
  queryClient.invalidateQueries({ queryKey: ["experiment-ingredients"] });
  return newExpId;
}

// --- Packaging ---

export function usePackagingList(includeArchived = false): Packaging[] {
  const { data } = useQuery({
    queryKey: ["packaging", { includeArchived }],
    queryFn: async () => {
      const rows = assertOk(await supabase.from("packaging").select("*")) as Packaging[];
      return rows
        .filter((p) => includeArchived || !p.archived)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  return data ?? [];
}

export function usePackaging(id: string | undefined): Packaging | undefined {
  const { data } = useQuery({
    queryKey: ["packaging", id],
    enabled: !!id,
    queryFn: async () => {
      const row = assertOkMaybe(
        await supabase.from("packaging").select("*").eq("id", id!).maybeSingle(),
      );
      return row as Packaging | null;
    },
  });
  return data ?? undefined;
}

export function usePackagingOrders(packagingId: string | undefined): PackagingOrder[] {
  const { data } = useQuery({
    queryKey: ["packaging-orders", packagingId],
    enabled: !!packagingId,
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("packagingOrders").select("*").eq("packagingId", packagingId!),
      ) as PackagingOrder[];
      return rows.sort((a, b) => new Date(b.orderedAt).getTime() - new Date(a.orderedAt).getTime());
    },
  });
  return data ?? [];
}

export function useAllPackagingOrders(): PackagingOrder[] {
  const { data } = useQuery({
    queryKey: ["packaging-orders", "all"],
    queryFn: async () => assertOk(await supabase.from("packagingOrders").select("*")) as PackagingOrder[],
  });
  return data ?? [];
}

export function useAllPackagingSuppliers(): string[] {
  const { data } = useQuery({
    queryKey: ["packaging-orders", "suppliers"],
    queryFn: async () => {
      const orders = assertOk(await supabase.from("packagingOrders").select("supplier")) as { supplier: string | null }[];
      return [...new Set(orders.map((o) => o.supplier).filter(Boolean))] as string[];
    },
  });
  return data ?? [];
}

export async function savePackaging(obj: Omit<Packaging, "id"> & { id?: string }): Promise<string> {
  const now = new Date();
  if (obj.id) {
    const { error } = await supabase.from("packaging").update({ ...obj, updatedAt: now }).eq("id", obj.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["packaging"] });
    return obj.id;
  }
  const createdId = newId();
  const { error } = await supabase
    .from("packaging")
    .insert({ ...obj, id: createdId, createdAt: now, updatedAt: now });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["packaging"] });
  return createdId;
}

export async function deletePackaging(id: string): Promise<void> {
  const delOrd = await supabase.from("packagingOrders").delete().eq("packagingId", id);
  if (delOrd.error) throw delOrd.error;
  const { error } = await supabase.from("packaging").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["packaging"] });
  queryClient.invalidateQueries({ queryKey: ["packaging-orders"] });
}

export async function archivePackaging(id: string): Promise<void> {
  const { error } = await supabase
    .from("packaging")
    .update({ archived: true, updatedAt: new Date() })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["packaging"] });
}

export async function unarchivePackaging(id: string): Promise<void> {
  const { error } = await supabase
    .from("packaging")
    .update({ archived: false, updatedAt: new Date() })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["packaging"] });
}

/** Returns true if the packaging is referenced by any variant. */
export async function isPackagingInUse(id: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("variantPackagings")
    .select("*", { count: "exact", head: true })
    .eq("packagingId", id);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function savePackagingOrder(obj: Omit<PackagingOrder, "id"> & { id?: string }): Promise<string> {
  if (obj.id) {
    // Updates don't change on-hand stock — only brand-new receipts do.
    const { error } = await supabase.from("packagingOrders").update(obj).eq("id", obj.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["packaging-orders"] });
    return obj.id;
  }
  const createdId = newId();
  const { error } = await supabase.from("packagingOrders").insert({ ...obj, id: createdId });
  if (error) throw error;
  // Received receipt → bump quantityOnHand + clear low-stock flags.
  if (obj.quantity > 0) {
    await addPackagingStock(obj.packagingId, obj.quantity);
  }
  queryClient.invalidateQueries({ queryKey: ["packaging-orders"] });
  return createdId;
}

export async function deletePackagingOrder(id: string): Promise<void> {
  const { error } = await supabase.from("packagingOrders").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["packaging-orders"] });
}

// --- Shopping list ---

export async function setIngredientLowStock(id: string, lowStock: boolean): Promise<void> {
  const patch = lowStock
    ? { lowStock: true, lowStockSince: Date.now(), lowStockOrdered: false }
    : { lowStock: false, lowStockSince: null, lowStockOrdered: false, outOfStock: false };
  const { error } = await supabase.from("ingredients").update(patch).eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["ingredients"] });
}

export async function setIngredientOutOfStock(id: string, outOfStock: boolean): Promise<void> {
  const patch = outOfStock
    ? { outOfStock: true, lowStock: true, lowStockSince: Date.now(), lowStockOrdered: false }
    : { outOfStock: false, lowStock: false, lowStockSince: null, lowStockOrdered: false };
  const { error } = await supabase.from("ingredients").update(patch).eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["ingredients"] });
}

export async function markIngredientOrdered(id: string): Promise<void> {
  const { error } = await supabase.from("ingredients").update({ lowStockOrdered: true }).eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["ingredients"] });
}

export async function unorderIngredient(id: string): Promise<void> {
  const { error } = await supabase.from("ingredients").update({ lowStockOrdered: false }).eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["ingredients"] });
}

export async function setPackagingLowStock(id: string, lowStock: boolean): Promise<void> {
  const patch = lowStock
    ? { lowStock: true, lowStockSince: Date.now(), lowStockOrdered: false }
    : { lowStock: false, lowStockSince: null, lowStockOrdered: false };
  const { error } = await supabase.from("packaging").update(patch).eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["packaging"] });
}

export async function setPackagingOutOfStock(id: string, outOfStock: boolean): Promise<void> {
  const patch = outOfStock
    ? { outOfStock: true, lowStock: true, lowStockSince: Date.now(), lowStockOrdered: false }
    : { outOfStock: false };
  const { error } = await supabase.from("packaging").update(patch).eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["packaging"] });
}

export async function markPackagingOrdered(id: string): Promise<void> {
  const { error } = await supabase.from("packaging").update({ lowStockOrdered: true }).eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["packaging"] });
}

export async function unorderPackaging(id: string): Promise<void> {
  const { error } = await supabase.from("packaging").update({ lowStockOrdered: false }).eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["packaging"] });
}

// --- Decoration Materials ---

export function useDecorationMaterials(includeArchived = false): DecorationMaterial[] {
  const { data } = useQuery({
    queryKey: ["decoration-materials", { includeArchived }],
    queryFn: async () => {
      const rows = assertOk(await supabase.from("decorationMaterials").select("*")) as DecorationMaterial[];
      return rows
        .filter((m) => includeArchived || !m.archived)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  return data ?? [];
}

export function useDecorationMaterial(id: string | undefined): DecorationMaterial | undefined {
  const { data } = useQuery({
    queryKey: ["decoration-materials", id],
    enabled: !!id,
    queryFn: async () => {
      const row = assertOkMaybe(
        await supabase.from("decorationMaterials").select("*").eq("id", id!).maybeSingle(),
      );
      return row as DecorationMaterial | null;
    },
  });
  return data ?? undefined;
}

export function useDecorationMaterialUsage(materialId: string | undefined): Product[] {
  const { data } = useQuery({
    queryKey: ["decoration-material-usage", materialId],
    enabled: !!materialId,
    queryFn: async () => {
      const all = assertOk(await supabase.from("products").select("*")) as Product[];
      const products = all.filter((r) => (r.shellDesign ?? []).some((step) => step.materialIds?.includes(materialId!)));
      return products.sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  return data ?? [];
}

/**
 * Aggregate product-usage counts across all decoration materials in one pass.
 * Use on list pages instead of calling useDecorationMaterialUsage once per row.
 */
export function useDecorationMaterialUsageCounts(): Map<string, number> {
  const { data } = useQuery({
    queryKey: ["decoration-material-usage-counts"],
    queryFn: async () => {
      const products = assertOk(await supabase.from("products").select("shellDesign, archived")) as {
        shellDesign: Product["shellDesign"];
        archived: boolean;
      }[];
      const counts = new Map<string, number>();
      for (const p of products) {
        if (p.archived) continue;
        const seen = new Set<string>();
        for (const step of p.shellDesign ?? []) {
          for (const mid of step.materialIds ?? []) {
            if (seen.has(mid)) continue;
            seen.add(mid);
            counts.set(mid, (counts.get(mid) ?? 0) + 1);
          }
        }
      }
      return counts;
    },
  });
  return data ?? new Map<string, number>();
}

export function useAllDecorationManufacturers(): string[] {
  const { data } = useQuery({
    queryKey: ["decoration-materials", "manufacturers"],
    queryFn: async () => {
      const all = assertOk(await supabase.from("decorationMaterials").select("manufacturer")) as { manufacturer: string | null }[];
      return [...new Set(all.map((m) => m.manufacturer).filter(Boolean))] as string[];
    },
  });
  return data ?? [];
}

export function useAllDecorationSources(): string[] {
  const { data } = useQuery({
    queryKey: ["decoration-materials", "sources"],
    queryFn: async () => {
      const all = assertOk(await supabase.from("decorationMaterials").select("source")) as { source: string | null }[];
      return [...new Set(all.map((m) => m.source).filter(Boolean))] as string[];
    },
  });
  return data ?? [];
}

export function useAllDecorationVendors(): string[] {
  const { data } = useQuery({
    queryKey: ["decoration-materials", "vendors"],
    queryFn: async () => {
      const all = assertOk(await supabase.from("decorationMaterials").select("vendor")) as { vendor: string | null }[];
      return [...new Set(all.map((m) => m.vendor).filter(Boolean))] as string[];
    },
  });
  return data ?? [];
}

export async function saveDecorationMaterial(obj: Omit<DecorationMaterial, "id"> & { id?: string }): Promise<string> {
  const now = new Date();
  if (obj.id) {
    const { error } = await supabase
      .from("decorationMaterials")
      .update({ ...obj, updatedAt: now })
      .eq("id", obj.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["decoration-materials"] });
    return obj.id;
  }
  const createdId = newId();
  const { error } = await supabase
    .from("decorationMaterials")
    .insert({ ...obj, id: createdId, createdAt: now, updatedAt: now });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["decoration-materials"] });
  return createdId;
}

export async function deleteDecorationMaterial(id: string): Promise<void> {
  const { error } = await supabase.from("decorationMaterials").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["decoration-materials"] });
}

export async function archiveDecorationMaterial(id: string): Promise<void> {
  const { error } = await supabase
    .from("decorationMaterials")
    .update({ archived: true, updatedAt: new Date() })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["decoration-materials"] });
}

export async function unarchiveDecorationMaterial(id: string): Promise<void> {
  const { error } = await supabase
    .from("decorationMaterials")
    .update({ archived: false, updatedAt: new Date() })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["decoration-materials"] });
}

export async function setDecorationMaterialLowStock(id: string, lowStock: boolean): Promise<void> {
  const patch = lowStock
    ? { lowStock: true, lowStockSince: Date.now(), lowStockOrdered: false }
    : { lowStock: false, lowStockSince: null, lowStockOrdered: false };
  const { error } = await supabase.from("decorationMaterials").update(patch).eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["decoration-materials"] });
}

export async function setDecorationMaterialOutOfStock(id: string, outOfStock: boolean): Promise<void> {
  const patch = outOfStock
    ? { outOfStock: true, lowStock: true, lowStockSince: Date.now(), lowStockOrdered: false }
    : { outOfStock: false };
  const { error } = await supabase.from("decorationMaterials").update(patch).eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["decoration-materials"] });
}

export async function markDecorationMaterialOrdered(id: string): Promise<void> {
  const { error } = await supabase.from("decorationMaterials").update({ lowStockOrdered: true }).eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["decoration-materials"] });
}

export async function unorderDecorationMaterial(id: string): Promise<void> {
  const { error } = await supabase.from("decorationMaterials").update({ lowStockOrdered: false }).eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["decoration-materials"] });
}

// --- Decoration Categories ---

export function useDecorationCategories(includeArchived = false): DecorationCategory[] {
  const { data } = useQuery({
    queryKey: ["decoration-categories", { includeArchived }],
    queryFn: async () => {
      const rows = assertOk(await supabase.from("decorationCategories").select("*")) as DecorationCategory[];
      return rows
        .filter((c) => includeArchived || !c.archived)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  return data ?? [];
}

export function useDecorationCategory(id: string | undefined): DecorationCategory | undefined {
  const { data } = useQuery({
    queryKey: ["decoration-categories", id],
    enabled: !!id,
    queryFn: async () => {
      const row = assertOkMaybe(
        await supabase.from("decorationCategories").select("*").eq("id", id!).maybeSingle(),
      );
      return row as DecorationCategory | null;
    },
  });
  return data ?? undefined;
}

/** Returns a reactive Map<slug, DecorationCategory> for fast lookups by slug. */
export function useDecorationCategoryMap(): Map<string, DecorationCategory> {
  const { data } = useQuery({
    queryKey: ["decoration-categories", "map"],
    queryFn: async () => {
      const rows = assertOk(await supabase.from("decorationCategories").select("*")) as DecorationCategory[];
      return new Map(rows.map((c) => [c.slug, c]));
    },
  });
  return data ?? new Map<string, DecorationCategory>();
}

/** Returns a reactive Map<slug, label> for display — replaces the old DECORATION_MATERIAL_TYPE_LABELS constant. */
export function useDecorationCategoryLabels(): Map<string, string> {
  const { data } = useQuery({
    queryKey: ["decoration-categories", "labels"],
    queryFn: async () => {
      const rows = assertOk(await supabase.from("decorationCategories").select("*")) as DecorationCategory[];
      return new Map(rows.filter((c) => !c.archived).map((c) => [c.slug, c.name]));
    },
  });
  return data ?? new Map<string, string>();
}

/** Count of materials per category slug. */
export function useDecorationCategoryUsageCounts(): Map<string, number> {
  const { data } = useQuery({
    queryKey: ["decoration-categories", "usage-counts"],
    queryFn: async () => {
      const all = assertOk(await supabase.from("decorationMaterials").select("type, archived")) as { type: string; archived: boolean }[];
      const counts = new Map<string, number>();
      for (const m of all) {
        if (m.archived) continue;
        counts.set(m.type, (counts.get(m.type) ?? 0) + 1);
      }
      return counts;
    },
  });
  return data ?? new Map<string, number>();
}

export async function saveDecorationCategory(obj: Omit<DecorationCategory, "id"> & { id?: string }): Promise<string> {
  const now = new Date();
  if (obj.id) {
    const { error } = await supabase
      .from("decorationCategories")
      .update({ ...obj, updatedAt: now })
      .eq("id", obj.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["decoration-categories"] });
    return obj.id;
  }
  const createdId = newId();
  // Always send archived as an explicit boolean. The column is NOT NULL
  // with a DB default of false, but some environments drop the default
  // and reject the insert with a 23502 — mirroring the pricingIrrelevant
  // issue we hit on ingredients.
  const { error } = await supabase
    .from("decorationCategories")
    .insert({ archived: false, ...obj, id: createdId, createdAt: now, updatedAt: now });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["decoration-categories"] });
  return createdId;
}

export async function deleteDecorationCategory(id: string): Promise<void> {
  const { error } = await supabase.from("decorationCategories").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["decoration-categories"] });
}

export async function archiveDecorationCategory(id: string): Promise<void> {
  const { error } = await supabase
    .from("decorationCategories")
    .update({ archived: true, updatedAt: new Date() })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["decoration-categories"] });
}

export async function unarchiveDecorationCategory(id: string): Promise<void> {
  const { error } = await supabase
    .from("decorationCategories")
    .update({ archived: false, updatedAt: new Date() })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["decoration-categories"] });
}

/** Idempotent — seeds default decoration categories if the table is empty. */
export async function ensureDefaultDecorationCategories(): Promise<void> {
  const { DEFAULT_DECORATION_CATEGORIES } = await import("@/types");
  const existing = assertOk(await supabase.from("decorationCategories").select("slug")) as { slug: string }[];
  const existingSlugs = new Set(existing.map((c) => c.slug));
  const missing = DEFAULT_DECORATION_CATEGORIES.filter((c) => !existingSlugs.has(c.slug));
  if (missing.length === 0) return;
  const now = new Date();
  const { error } = await supabase.from("decorationCategories").insert(
    missing.map((cat) => ({ id: newId(), name: cat.name, slug: cat.slug, createdAt: now, updatedAt: now })),
  );
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["decoration-categories"] });
}

// --- Shell Designs ---

export function useShellDesigns(includeArchived = false): ShellDesign[] {
  const { data } = useQuery({
    queryKey: ["shell-designs", { includeArchived }],
    queryFn: async () => {
      const rows = assertOk(await supabase.from("shellDesigns").select("*")) as ShellDesign[];
      return rows
        .filter((d) => includeArchived || !d.archived)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  return data ?? [];
}

export function useShellDesign(id: string | undefined): ShellDesign | undefined {
  const { data } = useQuery({
    queryKey: ["shell-designs", id],
    enabled: !!id,
    queryFn: async () => {
      const row = assertOkMaybe(
        await supabase.from("shellDesigns").select("*").eq("id", id!).maybeSingle(),
      );
      return row as ShellDesign | null;
    },
  });
  return data ?? undefined;
}

/** Returns products that use this design technique in their shellDesign steps. */
export function useShellDesignUsage(designName: string | undefined): Product[] {
  const { data } = useQuery({
    queryKey: ["shell-design-usage", designName],
    enabled: !!designName,
    queryFn: async () => {
      const all = assertOk(await supabase.from("products").select("*")) as Product[];
      const products = all.filter((r) => (r.shellDesign ?? []).some((step) => step.technique === designName));
      return products.sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  return data ?? [];
}

export async function saveShellDesign(obj: Omit<ShellDesign, "id"> & { id?: string }): Promise<string> {
  const now = new Date();
  if (obj.id) {
    const { error } = await supabase
      .from("shellDesigns")
      .update({ ...obj, updatedAt: now })
      .eq("id", obj.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["shell-designs"] });
    return obj.id;
  }
  const createdId = newId();
  const { error } = await supabase
    .from("shellDesigns")
    .insert({ ...obj, id: createdId, createdAt: now, updatedAt: now });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["shell-designs"] });
  return createdId;
}

export async function deleteShellDesign(id: string): Promise<void> {
  const { error } = await supabase.from("shellDesigns").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["shell-designs"] });
}

export async function archiveShellDesign(id: string): Promise<void> {
  const { error } = await supabase
    .from("shellDesigns")
    .update({ archived: true, updatedAt: new Date() })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["shell-designs"] });
}

export async function unarchiveShellDesign(id: string): Promise<void> {
  const { error } = await supabase
    .from("shellDesigns")
    .update({ archived: false, updatedAt: new Date() })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["shell-designs"] });
}

/** Idempotent — seeds default shell designs if the table is empty. */
export async function ensureDefaultShellDesigns(): Promise<void> {
  const { DEFAULT_SHELL_DESIGNS } = await import("@/types");
  const existing = assertOk(await supabase.from("shellDesigns").select("name")) as { name: string }[];
  const existingNames = new Set(existing.map((d) => d.name));
  const missing = DEFAULT_SHELL_DESIGNS.filter((d) => !existingNames.has(d.name));
  if (missing.length === 0) return;
  const now = new Date();
  const { error } = await supabase.from("shellDesigns").insert(
    missing.map((design) => ({
      id: newId(),
      name: design.name,
      defaultApplyAt: design.defaultApplyAt,
      createdAt: now,
      updatedAt: now,
    })),
  );
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["shell-designs"] });
}

// --- Variants ---

export function useVariants(): Variant[] {
  const { data } = useQuery({
    queryKey: ["variants"],
    queryFn: async () => {
      const rows = assertOk(await supabase.from("variants").select("*")) as Variant[];
      return rows.sort((a, b) => b.startDate.localeCompare(a.startDate));
    },
  });
  return data ?? [];
}

export function useVariant(id: string | undefined): Variant | undefined {
  const { data } = useQuery({
    queryKey: ["variants", id],
    enabled: !!id,
    queryFn: async () => {
      const row = assertOkMaybe(
        await supabase.from("variants").select("*").eq("id", id!).maybeSingle(),
      );
      return row as Variant | null;
    },
  });
  return data ?? undefined;
}

export async function saveVariant(obj: Omit<Variant, "id"> & { id?: string }): Promise<string> {
  const now = new Date();
  if (obj.id) {
    const { error } = await supabase
      .from("variants")
      .update({ ...obj, updatedAt: now })
      .eq("id", obj.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["variants"] });
    return obj.id;
  }
  const createdId = newId();
  const { error } = await supabase
    .from("variants")
    .insert({ ...obj, id: createdId, createdAt: now, updatedAt: now });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["variants"] });
  return createdId;
}

/** Clone a variant with all its sizes, composition rows, and packaging
 *  components. Returns the new variant id. Copy carries every field
 *  except the name (suffixed " (copy)") so the user can immediately
 *  edit it. Used for "all the same except name + product" scenarios.
 */
export async function duplicateVariant(sourceId: string): Promise<string> {
  const src = assertOkMaybe(
    await supabase.from("variants").select("*").eq("id", sourceId).maybeSingle(),
  ) as Variant | null;
  if (!src) throw new Error(`Variant ${sourceId} not found`);

  const now = new Date();
  const newVariantId = newId();
  const { error: vErr } = await supabase.from("variants").insert({
    ...src,
    id: newVariantId,
    name: `${src.name} (copy)`,
    createdAt: now,
    updatedAt: now,
  });
  if (vErr) throw vErr;

  // Variant products (catalog of chocolates that belong to this variant).
  const variantProducts = assertOk(
    await supabase.from("variantProducts").select("*").eq("variantId", sourceId),
  ) as VariantProduct[];
  if (variantProducts.length > 0) {
    const rows = variantProducts.map((vp) => ({
      ...vp,
      id: newId(),
      variantId: newVariantId,
    }));
    const { error } = await supabase.from("variantProducts").insert(rows);
    if (error) throw error;
  }

  // Sizes (variantPackagings) — new ids needed since composition + components reference them.
  const variantPackagings = assertOk(
    await supabase.from("variantPackagings").select("*").eq("variantId", sourceId),
  ) as VariantPackaging[];
  const oldToNewVp = new Map<string, string>();
  for (const vp of variantPackagings) {
    const newVpId = newId();
    oldToNewVp.set(vp.id!, newVpId);
    const { error } = await supabase.from("variantPackagings").insert({
      ...vp,
      id: newVpId,
      variantId: newVariantId,
      // Reset on-hand count on the copy — it's a fresh SKU.
      quantityOnHand: 0,
      createdAt: now,
      updatedAt: now,
    });
    if (error) throw error;
  }

  // Composition rows (curated kind only).
  if (oldToNewVp.size > 0) {
    const composition = assertOk(
      await supabase
        .from("variantPackagingProducts")
        .select("*")
        .in("variantPackagingId", [...oldToNewVp.keys()]),
    ) as VariantPackagingProduct[];
    if (composition.length > 0) {
      const rows = composition.map((c) => ({
        ...c,
        id: newId(),
        variantPackagingId: oldToNewVp.get(c.variantPackagingId)!,
        createdAt: now,
        updatedAt: now,
      }));
      const { error } = await supabase.from("variantPackagingProducts").insert(rows);
      if (error) throw error;
    }
    // Packaging components (box + cushion + sticker per size).
    const components = assertOk(
      await supabase
        .from("variantPackagingComponents")
        .select("*")
        .in("variantPackagingId", [...oldToNewVp.keys()]),
    ) as VariantPackagingComponent[];
    if (components.length > 0) {
      const rows = components.map((c) => ({
        ...c,
        id: newId(),
        variantPackagingId: oldToNewVp.get(c.variantPackagingId)!,
        createdAt: now,
        updatedAt: now,
      }));
      const { error } = await supabase.from("variantPackagingComponents").insert(rows);
      if (error) throw error;
    }
  }

  queryClient.invalidateQueries({ queryKey: ["variants"] });
  queryClient.invalidateQueries({ queryKey: ["variant-products"] });
  queryClient.invalidateQueries({ queryKey: ["variant-packagings"] });
  queryClient.invalidateQueries({ queryKey: ["variant-packaging-products"] });
  queryClient.invalidateQueries({ queryKey: ["variant-packaging-components"] });
  queryClient.invalidateQueries({ queryKey: ["variant-packaging-components-bulk"] });
  return newVariantId;
}

export async function deleteVariant(id: string): Promise<void> {
  const delCp = await supabase.from("variantProducts").delete().eq("variantId", id);
  if (delCp.error) throw delCp.error;
  const delCpk = await supabase.from("variantPackagings").delete().eq("variantId", id);
  if (delCpk.error) throw delCpk.error;
  const { error } = await supabase.from("variants").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["variants"] });
  queryClient.invalidateQueries({ queryKey: ["variant-products"] });
  queryClient.invalidateQueries({ queryKey: ["variant-packagings"] });
}

/** Unique variant labels, case-insensitive dedupe, alphabetically sorted.
 *  The first-seen casing of each label wins (preserves "B2B" over "b2b"
 *  if "B2B" appeared on a variant first). Drives the Label autocomplete
 *  and the Collections page row list. */
export function useAllVariantLabels(): string[] {
  const variants = useVariants();
  return useMemo(() => {
    const firstByLower = new Map<string, string>();
    for (const v of variants) {
      for (const label of v.labels ?? []) {
        const key = label.toLowerCase();
        if (!firstByLower.has(key)) firstByLower.set(key, label);
      }
    }
    return Array.from(firstByLower.values()).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    );
  }, [variants]);
}

export function useAllVariantProducts(): VariantProduct[] {
  const { data } = useQuery({
    queryKey: ["variant-products", "all"],
    queryFn: async () => assertOk(await supabase.from("variantProducts").select("*")) as VariantProduct[],
  });
  return data ?? [];
}

export function useVariantProducts(variantId: string | undefined): VariantProduct[] {
  const { data } = useQuery({
    queryKey: ["variant-products", variantId],
    enabled: !!variantId,
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("variantProducts").select("*").eq("variantId", variantId!),
      ) as VariantProduct[];
      return rows.sort((a, b) => a.sortOrder - b.sortOrder);
    },
  });
  return data ?? [];
}

export async function addProductToVariant(variantId: string, productId: string): Promise<void> {
  const existing = assertOk(
    await supabase.from("variantProducts").select("*").eq("variantId", variantId),
  ) as VariantProduct[];
  if (existing.some((r) => r.productId === productId)) return;
  const maxSort = existing.reduce((m, r) => Math.max(m, r.sortOrder), -1);
  const { error } = await supabase
    .from("variantProducts")
    .insert({ id: newId(), variantId, productId, sortOrder: maxSort + 1 });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["variant-products"] });
}

export async function removeProductFromVariant(id: string): Promise<void> {
  const { error } = await supabase.from("variantProducts").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["variant-products"] });
}

// --- Variant Packagings (box pricing) ---

export function useVariantPackagings(variantId: string | undefined): VariantPackaging[] {
  const { data } = useQuery({
    queryKey: ["variant-packagings", variantId],
    enabled: !!variantId,
    queryFn: async () =>
      assertOk(
        await supabase.from("variantPackagings").select("*").eq("variantId", variantId!),
      ) as VariantPackaging[],
  });
  return data ?? [];
}

/** Components (box + cushion + paper + sticker …) for a single
 *  variantPackaging row. Migration 0064. */
export function useVariantPackagingComponents(
  variantPackagingId: string | undefined,
): VariantPackagingComponent[] {
  const { data } = useQuery({
    queryKey: ["variant-packaging-components", variantPackagingId],
    enabled: !!variantPackagingId,
    queryFn: async () =>
      assertOk(
        await supabase
          .from("variantPackagingComponents")
          .select("*")
          .eq("variantPackagingId", variantPackagingId!)
          .order("sortOrder", { ascending: true }),
      ) as VariantPackagingComponent[],
  });
  return data ?? [];
}

/** Bulk fetch components for a list of variantPackagingIds in one
 *  query — used by the variant detail page so each size renders its
 *  components without N round-trips. */
export function useVariantPackagingComponentsBulk(
  variantPackagingIds: string[],
): VariantPackagingComponent[] {
  const key = [...variantPackagingIds].sort().join(",");
  const { data } = useQuery({
    queryKey: ["variant-packaging-components-bulk", key],
    enabled: variantPackagingIds.length > 0,
    queryFn: async () =>
      assertOk(
        await supabase
          .from("variantPackagingComponents")
          .select("*")
          .in("variantPackagingId", variantPackagingIds)
          .order("sortOrder", { ascending: true }),
      ) as VariantPackagingComponent[],
  });
  return data ?? [];
}

export async function saveVariantPackagingComponent(
  row: Omit<VariantPackagingComponent, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const now = new Date();
  const payload = { ...row, id, updatedAt: now };
  const { error } = await supabase
    .from("variantPackagingComponents")
    .upsert(payload, { onConflict: "id" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["variant-packaging-components"] });
  queryClient.invalidateQueries({ queryKey: ["variant-packaging-components-bulk"] });
  return id;
}

export async function deleteVariantPackagingComponent(id: string): Promise<void> {
  const { error } = await supabase
    .from("variantPackagingComponents")
    .delete()
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["variant-packaging-components"] });
  queryClient.invalidateQueries({ queryKey: ["variant-packaging-components-bulk"] });
}

export function useAllVariantPackagings(): VariantPackaging[] {
  const { data } = useQuery({
    queryKey: ["variant-packagings", "all"],
    queryFn: async () => assertOk(await supabase.from("variantPackagings").select("*")) as VariantPackaging[],
  });
  return data ?? [];
}

/** Aggregate hook: every variantPackagingComponent across every size.
 *  Used by the daily-count page to compute composition deductions
 *  without N per-variant queries. */
export function useAllVariantPackagingComponents(): VariantPackagingComponent[] {
  const { data } = useQuery({
    queryKey: ["variant-packaging-components", "all"],
    queryFn: async () =>
      assertOk(await supabase.from("variantPackagingComponents").select("*")) as VariantPackagingComponent[],
  });
  return data ?? [];
}

export async function saveVariantPackaging(obj: Omit<VariantPackaging, "id"> & { id?: string }): Promise<string> {
  const now = new Date();
  // Mirror `price` into legacy `sellPrice` so existing consumers (pricing
  // dashboard, snapshots) keep reading a populated value until they
  // migrate to `price` directly.
  const payload = { ...obj, sellPrice: obj.price ?? obj.sellPrice ?? 0 };
  if (obj.id) {
    const { error } = await supabase
      .from("variantPackagings")
      .update({ ...payload, updatedAt: now })
      .eq("id", obj.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["variant-packagings"] });
    return obj.id;
  }
  const createdId = newId();
  const { error } = await supabase
    .from("variantPackagings")
    .insert({ ...payload, id: createdId, createdAt: now, updatedAt: now });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["variant-packagings"] });
  return createdId;
}

export async function deleteVariantPackaging(id: string): Promise<void> {
  const { error } = await supabase.from("variantPackagings").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["variant-packagings"] });
  queryClient.invalidateQueries({ queryKey: ["variant-packaging-products"] });
}

// --- Variant Packaging Products (curated per-size product composition) ---

/** Products + qty belonging to a single variant size. */
export function useVariantPackagingProducts(
  variantPackagingId: string | undefined,
): VariantPackagingProduct[] {
  const { data } = useQuery({
    queryKey: ["variant-packaging-products", variantPackagingId],
    enabled: !!variantPackagingId,
    queryFn: async () => {
      const rows = assertOk(
        await supabase
          .from("variantPackagingProducts")
          .select("*")
          .eq("variantPackagingId", variantPackagingId!),
      ) as VariantPackagingProduct[];
      return rows.sort((a, b) => a.sortOrder - b.sortOrder);
    },
  });
  return data ?? [];
}

/** Every curated-size product row across the whole workshop. Used on
 *  the order entry page to auto-populate orderItems from a curated
 *  variant pick. */
export function useAllVariantPackagingProducts(): VariantPackagingProduct[] {
  const { data } = useQuery({
    queryKey: ["variant-packaging-products", "all"],
    queryFn: async () =>
      assertOk(
        await supabase.from("variantPackagingProducts").select("*"),
      ) as VariantPackagingProduct[],
  });
  return data ?? [];
}

/** Replace the curated product list for a single variant size in one
 *  atomic step. UI edits the list all-at-once (chip rows), so the
 *  simplest safe write is delete-then-insert of the whole set. Called
 *  from saveVariantPackaging's post-save flow in the Variant form. */
export async function replaceVariantPackagingProducts(
  variantPackagingId: string,
  items: Array<{ productId: string; qty: number; sortOrder: number }>,
): Promise<void> {
  const del = await supabase
    .from("variantPackagingProducts")
    .delete()
    .eq("variantPackagingId", variantPackagingId);
  if (del.error) throw del.error;
  if (items.length > 0) {
    const rows = items.map((it) => ({
      id: newId(),
      variantPackagingId,
      productId: it.productId,
      qty: it.qty,
      sortOrder: it.sortOrder,
    }));
    const ins = await supabase.from("variantPackagingProducts").insert(rows);
    if (ins.error) throw ins.error;
  }
  queryClient.invalidateQueries({ queryKey: ["variant-packaging-products"] });
}

// --- Variant-aware borrow allocation helpers ---

/** Reserve `count` pre-built variant boxes for an order. Moves rows
 *  from `(variantPackagingId, store, null, null)` → `(variantPackagingId,
 *  allocated, orderId, null)`. Throws when shop on-hand < count. */
async function allocateVariantBoxesToOrder(args: {
  orderId: string;
  variantPackagingId: string;
  count: number;
}): Promise<void> {
  const need = Math.max(0, Math.round(args.count));
  if (need === 0) return;
  const shopRow = assertOkMaybe(
    await supabase
      .from("variantStockLocations")
      .select("*")
      .eq("variantPackagingId", args.variantPackagingId)
      .eq("location", "store")
      .is("orderId", null)
      .is("productionOrderId", null)
      .maybeSingle(),
  ) as VariantStockLocation | null;
  const shop = shopRow?.quantity ?? 0;
  if (shop < need) {
    throw new Error(
      `Variant stock short: need ${need} boxes, only ${shop} on shop shelf.`,
    );
  }
  const now = new Date();
  await supabase
    .from("variantStockLocations")
    .update({ quantity: shop - need, updatedAt: now })
    .eq("id", shopRow!.id!);
  // Insert (or top up) the per-order allocated reservation.
  const allocRow = assertOkMaybe(
    await supabase
      .from("variantStockLocations")
      .select("*")
      .eq("variantPackagingId", args.variantPackagingId)
      .eq("location", "allocated")
      .eq("orderId", args.orderId)
      .is("productionOrderId", null)
      .maybeSingle(),
  ) as VariantStockLocation | null;
  if (allocRow) {
    await supabase
      .from("variantStockLocations")
      .update({ quantity: (allocRow.quantity ?? 0) + need, updatedAt: now })
      .eq("id", allocRow.id!);
  } else {
    await supabase.from("variantStockLocations").insert({
      id: newId(),
      variantPackagingId: args.variantPackagingId,
      location: "allocated",
      orderId: args.orderId,
      productionOrderId: null,
      quantity: need,
      updatedAt: now,
    });
  }
  // Audit trail.
  await logStockMovement({
    planProductId: undefined as unknown as string,
    productId: undefined as unknown as string,
    fromLocation: "store",
    toLocation: "allocated",
    quantity: need,
    orderId: args.orderId,
    variantPackagingId: args.variantPackagingId,
    reason: "allocate",
    notes: `Variant box reserved for order`,
  });
  queryClient.invalidateQueries({ queryKey: ["variant-stock-locations"] });
  queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
}

/** Walk every orderVariantLine on the order, try to reserve variant
 *  boxes from shop on-hand. Returns the set of variantPackagingIds
 *  that ended up FULLY covered (so callers can skip per-orderItem
 *  loose allocation for those lines). */
export async function tryAllocateVariantLinesFromStock(orderId: string): Promise<Set<string>> {
  const covered = new Set<string>();
  const lines = assertOk(
    await supabase
      .from("orderVariantLines")
      .select("*")
      .eq("orderId", orderId),
  ) as OrderVariantLine[];
  for (const line of lines) {
    if (!line.variantPackagingId) continue;
    if ((line.quantity ?? 0) <= 0) continue;
    try {
      await allocateVariantBoxesToOrder({
        orderId,
        variantPackagingId: line.variantPackagingId,
        count: line.quantity,
      });
      covered.add(line.variantPackagingId);
    } catch (e) {
      // Not enough variant stock — fall through to loose allocation.
      console.warn(`[tryAllocateVariantLines] ${line.variantPackagingId}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return covered;
}

/** Release all variant-stock allocations tied to an order back to
 *  shop. Called by revertBorrowsForOrder + cancel flows. */
async function revertVariantAllocationsForOrder(orderId: string): Promise<void> {
  const allocRows = assertOk(
    await supabase
      .from("variantStockLocations")
      .select("*")
      .eq("orderId", orderId)
      .eq("location", "allocated"),
  ) as VariantStockLocation[];
  if (allocRows.length === 0) return;
  const now = new Date();
  for (const row of allocRows) {
    if ((row.quantity ?? 0) <= 0) continue;
    // Top up shop on-hand by the released amount.
    const shopRow = assertOkMaybe(
      await supabase
        .from("variantStockLocations")
        .select("*")
        .eq("variantPackagingId", row.variantPackagingId)
        .eq("location", "store")
        .is("orderId", null)
        .is("productionOrderId", null)
        .maybeSingle(),
    ) as VariantStockLocation | null;
    if (shopRow) {
      await supabase
        .from("variantStockLocations")
        .update({ quantity: (shopRow.quantity ?? 0) + row.quantity, updatedAt: now })
        .eq("id", shopRow.id!);
    } else {
      await supabase.from("variantStockLocations").insert({
        id: newId(),
        variantPackagingId: row.variantPackagingId,
        location: "store",
        orderId: null,
        productionOrderId: null,
        quantity: row.quantity,
        updatedAt: now,
      });
    }
    await supabase.from("variantStockLocations").delete().eq("id", row.id!);
    await logStockMovement({
      planProductId: undefined as unknown as string,
      productId: undefined as unknown as string,
      fromLocation: "allocated",
      toLocation: "store",
      quantity: row.quantity,
      orderId,
      variantPackagingId: row.variantPackagingId,
      reason: "unallocate",
      notes: `Variant box released back to shop on order revert`,
    });
  }
  queryClient.invalidateQueries({ queryKey: ["variant-stock-locations"] });
  queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
}

// --- Variant on-hand inventory (pre-built boxes) ---
//
// `variantStockLocations` (mig 0084) tracks how many pre-built boxes of
// a given variant size are sitting in each location (shop store /
// production storage / freezer / allocated-to-order). Operator triggers
// box-up via /picking tab 2: composition products + packaging
// components are consumed, variant on-hand goes up.
//
// Sale paths read variant on-hand FIRST when fulfilling boxed-variant
// orders, falling through to loose product pieces only if no pre-built
// box exists.

/** All variant-on-hand rows. Caller can group / filter. */
export function useVariantStockLocations(): VariantStockLocation[] {
  const { data } = useQuery({
    queryKey: ["variant-stock-locations"],
    queryFn: async () => {
      const r = await supabase.from("variantStockLocations").select("*");
      return assertOk(r) as VariantStockLocation[];
    },
  });
  return data ?? [];
}

/** Sum on-hand across all locations for one variant size. */
export function useVariantStockTotal(variantPackagingId: string | undefined): number {
  const rows = useVariantStockLocations();
  if (!variantPackagingId) return 0;
  return rows
    .filter((r) => r.variantPackagingId === variantPackagingId)
    .reduce((s, r) => s + (r.quantity ?? 0), 0);
}

/** Add `delta` (signed) to the unallocated `(variantPackagingId, location)`
 *  row, creating it on first write. Negative delta clamps at 0. */
async function adjustVariantStockLocation(
  variantPackagingId: string,
  location: StockLocation,
  delta: number,
): Promise<void> {
  if (delta === 0) return;
  const existing = assertOkMaybe(
    await supabase
      .from("variantStockLocations")
      .select("*")
      .eq("variantPackagingId", variantPackagingId)
      .eq("location", location)
      .is("orderId", null)
      .is("productionOrderId", null)
      .maybeSingle(),
  ) as VariantStockLocation | null;
  const now = new Date();
  if (existing) {
    const next = Math.max(0, (existing.quantity ?? 0) + delta);
    const { error } = await supabase
      .from("variantStockLocations")
      .update({ quantity: next, updatedAt: now })
      .eq("id", existing.id!);
    if (error) throw error;
  } else if (delta > 0) {
    const { error } = await supabase.from("variantStockLocations").insert({
      id: newId(),
      variantPackagingId,
      location,
      quantity: delta,
      updatedAt: now,
    });
    if (error) throw error;
  }
  queryClient.invalidateQueries({ queryKey: ["variant-stock-locations"] });
}

/** Manual on-hand adjustment for a single (variantPackagingId, location).
 *  Sets the absolute count rather than applying a delta — used by the
 *  variant detail page when the operator types a count to fix drift.
 *  Logs an audit row with reason='recount'. */
export async function setVariantStockOnHand(args: {
  variantPackagingId: string;
  location: StockLocation;
  quantity: number;
  notes?: string;
}): Promise<void> {
  const wanted = Math.max(0, Math.round(args.quantity));
  const existing = assertOkMaybe(
    await supabase
      .from("variantStockLocations")
      .select("*")
      .eq("variantPackagingId", args.variantPackagingId)
      .eq("location", args.location)
      .is("orderId", null)
      .is("productionOrderId", null)
      .maybeSingle(),
  ) as VariantStockLocation | null;
  const current = existing?.quantity ?? 0;
  if (wanted === current) return;
  const delta = wanted - current;
  await adjustVariantStockLocation(args.variantPackagingId, args.location, delta);
  // Audit row — direction depends on sign of delta. No
  // planProductId / productId since manual recount has no batch source.
  await logStockMovement({
    planProductId: undefined as unknown as string,
    productId: undefined as unknown as string,
    fromLocation: delta < 0 ? args.location : undefined,
    toLocation: delta > 0 ? args.location : undefined,
    quantity: Math.abs(delta),
    variantPackagingId: args.variantPackagingId,
    reason: "recount",
    notes: args.notes ?? `Manual on-hand correction (${current} → ${wanted})`,
  });
}

/**
 * Box up `count` units of one variant size: consume the composition
 * products + packaging components, increment variant on-hand at the
 * chosen destination, and log audit movements tagged with the variant
 * for HACCP trace.
 *
 * Validates availability before mutating — throws cleanly if any
 * composition product or packaging component is short. Source location
 * for pieces defaults to 'production' (where unmould lands them) but can
 * be overridden when boxing pieces already in 'store'.
 */
export async function boxUpVariant(args: {
  variantPackagingId: string;
  count: number;
  /** Where the boxed inventory lands. Usually 'store'. */
  destination: StockLocation;
  /** Locations to pull loose pieces from, in priority order. Default
   *  drains 'production' first (fresh from unmould) then falls back to
   *  'store' (already on shop floor) so the operator can box pieces
   *  wherever they happen to be. */
  sourceLocations?: Array<"production" | "store">;
}): Promise<void> {
  const count = Math.max(0, Math.round(args.count));
  if (count === 0) return;
  const sourceLocations = args.sourceLocations ?? ["production", "store"];
  if (args.destination === "allocated") {
    throw new Error("boxUpVariant: cannot land boxes directly in 'allocated' — that's reserved for sale-time tagging.");
  }

  // 1. Read composition + components.
  const composition = assertOk(
    await supabase
      .from("variantPackagingProducts")
      .select("*")
      .eq("variantPackagingId", args.variantPackagingId),
  ) as VariantPackagingProduct[];
  const components = assertOk(
    await supabase
      .from("variantPackagingComponents")
      .select("*")
      .eq("variantPackagingId", args.variantPackagingId),
  ) as VariantPackagingComponent[];

  // 2. Validate piece availability per product. Sum across all batches
  //    across every source location in priority order.
  const productIds = [...new Set(composition.map((c) => c.productId))];
  if (productIds.length === 0) {
    throw new Error("boxUpVariant: variant has no composition — cannot box up an empty variant.");
  }
  const planProducts = assertOk(
    await supabase.from("planProducts").select("id, productId").in("productId", productIds),
  ) as Array<{ id: string; productId: string }>;
  const allPpIds = planProducts.map((p) => p.id);
  const stockRows = allPpIds.length > 0
    ? assertOk(
        await supabase
          .from("stockLocations")
          .select("planProductId, location, quantity")
          .in("location", sourceLocations)
          .is("orderId", null)
          .is("productionOrderId", null)
          .in("planProductId", allPpIds),
      ) as Array<{ planProductId: string; location: StockLocation; quantity: number }>
    : [];
  const ppToProduct = new Map(planProducts.map((p) => [p.id, p.productId]));
  const onHandByProduct = new Map<string, number>();
  for (const r of stockRows) {
    const pid = ppToProduct.get(r.planProductId);
    if (!pid) continue;
    onHandByProduct.set(pid, (onHandByProduct.get(pid) ?? 0) + (r.quantity ?? 0));
  }

  for (const c of composition) {
    const need = c.qty * count;
    const have = onHandByProduct.get(c.productId) ?? 0;
    if (have < need) {
      throw new Error(
        `boxUpVariant: short on product ${c.productId} — need ${need} pieces (any of ${sourceLocations.join(" / ")}), have ${have}.`,
      );
    }
  }

  // 3. Validate packaging-component availability.
  for (const k of components) {
    const need = k.qtyPerVariant * count;
    const row = assertOkMaybe(
      await supabase.from("packaging").select("quantityOnHand").eq("id", k.packagingId).maybeSingle(),
    ) as { quantityOnHand?: number } | null;
    const have = row?.quantityOnHand ?? 0;
    if (have < need) {
      throw new Error(
        `boxUpVariant: short on packaging ${k.packagingId} — need ${need} units, have ${have}.`,
      );
    }
  }

  // 4. Consume pieces FIFO per composition product, walking the source
  //    locations in priority order until the need is met. Each
  //    moveProductStockFifo call inserts a regular stockMovement; we
  //    follow with a variant-tagged movement so HACCP can join
  //    target=variantPackagingId back to source planProductId.
  for (const c of composition) {
    let remaining = c.qty * count;
    for (const loc of sourceLocations) {
      if (remaining <= 0) break;
      const moves = await moveProductStockFifo({
        productId: c.productId,
        fromLocation: loc,
        toLocation: null,
        quantity: remaining,
        reason: "box_up",
        notes: `Box up ${count} × ${args.variantPackagingId}`,
      });
      let drained = 0;
      for (const m of moves) {
        drained += m.quantity;
        await logStockMovement({
          planProductId: m.planProductId,
          productId: c.productId,
          fromLocation: loc,
          quantity: m.quantity,
          variantPackagingId: args.variantPackagingId,
          reason: "box_up_link",
          notes: `Box-up trace: ${m.quantity} pcs of ${c.productId} from ${loc} → variant ${args.variantPackagingId}`,
        });
      }
      remaining -= drained;
    }
    if (remaining > 0) {
      // Validation should have caught this, but defensive — bail loud.
      throw new Error(
        `boxUpVariant: ran short mid-flight on product ${c.productId} (${remaining} pieces unaccounted). State may need manual reconciliation.`,
      );
    }
  }

  // 5. Consume packaging components.
  for (const k of components) {
    const need = k.qtyPerVariant * count;
    await consumePackaging({
      packagingId: k.packagingId,
      quantity: need,
      note: `Box up ${count} × variant ${args.variantPackagingId}`,
    });
  }

  // 6. Increment variant on-hand at destination.
  await adjustVariantStockLocation(args.variantPackagingId, args.destination, count);

  // 7. Headline audit row for the box-up event itself. No
  //    planProductId / productId — this row represents the variant
  //    creation, not a batch movement. Per-composition trace rows
  //    above carry the batch lineage.
  await logStockMovement({
    planProductId: undefined as unknown as string,
    productId: undefined as unknown as string,
    toLocation: args.destination,
    quantity: count,
    variantPackagingId: args.variantPackagingId,
    reason: "box_up",
    notes: `Built ${count} box${count === 1 ? "" : "es"} from ${sourceLocations.join(" / ")} pieces`,
  });

  queryClient.invalidateQueries({ queryKey: ["variant-stock-locations"] });
  queryClient.invalidateQueries({ queryKey: ["stock-locations"] });
  queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
  queryClient.invalidateQueries({ queryKey: ["packaging"] });
}

// --- Variant Pricing Snapshots (margin history) ---

/** All pricing snapshots for a variant, newest-first */
export function useVariantPricingSnapshots(variantId: string | undefined): VariantPricingSnapshot[] {
  const { data } = useQuery({
    queryKey: ["variant-pricing-snapshots", variantId],
    enabled: !!variantId,
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("variantPricingSnapshots").select("*").eq("variantId", variantId!),
      ) as VariantPricingSnapshot[];
      return rows.sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());
    },
  });
  return data ?? [];
}

export async function saveVariantPricingSnapshot(
  obj: Omit<VariantPricingSnapshot, "id"> & { id?: string },
): Promise<string> {
  if (obj.id) {
    const { error } = await supabase.from("variantPricingSnapshots").update(obj).eq("id", obj.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["variant-pricing-snapshots"] });
    return obj.id;
  }
  const createdId = newId();
  const { error } = await supabase
    .from("variantPricingSnapshots")
    .insert({ ...obj, id: createdId });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["variant-pricing-snapshots"] });
  return createdId;
}

export function useShoppingItems(): ShoppingItem[] {
  const { data } = useQuery({
    queryKey: ["shopping-items"],
    queryFn: async () => assertOk(await supabase.from("shoppingItems").select("*")) as ShoppingItem[],
  });
  return data ?? [];
}

/** Count of items pending ordering (for nav badge) */
export function usePendingShoppingCount(): number {
  const { data } = useQuery({
    queryKey: ["pending-shopping-count"],
    queryFn: async () => {
      const lowStockFilter = (q: ReturnType<typeof supabase.from>) =>
        q.select("*", { count: "exact", head: true })
          .eq("lowStock", true)
          .eq("lowStockOrdered", false)
          .eq("archived", false);

      const [ing, pkg, deco, items] = await Promise.all([
        lowStockFilter(supabase.from("ingredients")),
        lowStockFilter(supabase.from("packaging")),
        lowStockFilter(supabase.from("decorationMaterials")),
        supabase
          .from("shoppingItems")
          .select("*", { count: "exact", head: true })
          .is("orderedAt", null),
      ]);
      if (ing.error) throw ing.error;
      if (pkg.error) throw pkg.error;
      if (deco.error) throw deco.error;
      if (items.error) throw items.error;
      return (ing.count ?? 0) + (pkg.count ?? 0) + (deco.count ?? 0) + (items.count ?? 0);
    },
  });
  return data ?? 0;
}

export async function saveShoppingItem(obj: Omit<ShoppingItem, "id"> & { id?: string }): Promise<string> {
  if (obj.id) {
    const { error } = await supabase.from("shoppingItems").update(obj).eq("id", obj.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["shopping-items"] });
    return obj.id;
  }
  const createdId = newId();
  const { error } = await supabase.from("shoppingItems").insert({ ...obj, id: createdId });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["shopping-items"] });
  return createdId;
}

export async function markShoppingItemOrdered(id: string): Promise<void> {
  const { error } = await supabase
    .from("shoppingItems")
    .update({ orderedAt: Date.now() })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["shopping-items"] });
  queryClient.invalidateQueries({ queryKey: ["pending-shopping-count"] });
}

export async function deleteShoppingItem(id: string): Promise<void> {
  const { error } = await supabase.from("shoppingItems").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["shopping-items"] });
}

// --- Ingredient Stock ---
//
// Grams-on-hand per ingredient. Receives on purchase intake,
// drains on production step ticks (Shelling for shell chocolate,
// Filling Prep for recipe ingredients). Audit log lives in
// ingredientStockMovements. Migration 0044.

/** All ingredient stock rows. One per ingredient (unique). */
export function useAllIngredientStock(): IngredientStock[] {
  const { data } = useQuery({
    queryKey: ["ingredient-stock"],
    queryFn: async () =>
      assertOk(await supabase.from("ingredientStock").select("*")) as IngredientStock[],
  });
  return data ?? [];
}

/** Grams-on-hand for a single ingredient, or null if no row yet. */
export function useIngredientStock(ingredientId: string | undefined): IngredientStock | null {
  const { data } = useQuery({
    queryKey: ["ingredient-stock", "one", ingredientId ?? ""],
    enabled: !!ingredientId,
    queryFn: async () =>
      assertOkMaybe(
        await supabase
          .from("ingredientStock")
          .select("*")
          .eq("ingredientId", ingredientId!)
          .maybeSingle(),
      ) as IngredientStock | null,
  });
  return data ?? null;
}

export function useIngredientStockMovements(ingredientId?: string, limit = 100): IngredientStockMovement[] {
  const { data } = useQuery({
    queryKey: ["ingredient-stock-movements", ingredientId ?? "all", limit],
    queryFn: async () => {
      const q = supabase
        .from("ingredientStockMovements")
        .select("*")
        .order("movedAt", { ascending: false })
        .limit(limit);
      return assertOk(
        await (ingredientId ? q.eq("ingredientId", ingredientId) : q),
      ) as IngredientStockMovement[];
    },
  });
  return data ?? [];
}

/** Apply a signed delta (in grams) to an ingredient's stock row.
 *  Creates the row lazily on first touch. Logs an audit movement so
 *  /ingredients/<id> can render the history. Never lets the balance
 *  drop below zero — returns the actual delta applied (may be less
 *  than requested if stock was insufficient). */
export async function adjustIngredientStock(args: {
  ingredientId: string;
  deltaG: number;
  reason: "receive" | "shelling" | "filling_prep" | "recount" | "waste";
  planId?: string;
  stepKey?: string;
  notes?: string;
  movedBy?: string;
}): Promise<{ applied: number; balanceAfter: number }> {
  const { ingredientId, deltaG, reason } = args;
  if (!ingredientId) throw new Error("adjustIngredientStock: ingredientId required");
  const rounded = Math.round(deltaG * 1000) / 1000; // 3-dp grams
  if (rounded === 0) return { applied: 0, balanceAfter: 0 };

  const existing = assertOkMaybe(
    await supabase
      .from("ingredientStock")
      .select("*")
      .eq("ingredientId", ingredientId)
      .maybeSingle(),
  ) as IngredientStock | null;

  const current = Number(existing?.quantityG ?? 0);
  let applied = rounded;
  let next = current + rounded;
  if (next < 0) {
    // Clamp to zero. Return the actually-applied negative delta so
    // callers can report the shortfall if they need to.
    applied = -current;
    next = 0;
  }

  const now = new Date();
  if (existing) {
    const { error } = await supabase
      .from("ingredientStock")
      .update({ quantityG: next, updatedAt: now })
      .eq("id", existing.id!);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("ingredientStock").insert({
      id: newId(),
      ingredientId,
      quantityG: next,
      createdAt: now,
      updatedAt: now,
    });
    if (error) throw error;
  }

  // Audit row — always log the ATTEMPTED delta (rounded), even when
  // clamped, with a note so the history shows reality.
  const { error: mvErr } = await supabase.from("ingredientStockMovements").insert({
    id: newId(),
    ingredientId,
    deltaG: applied, // what actually happened to the balance
    reason,
    planId: args.planId ?? null,
    stepKey: args.stepKey ?? null,
    movedBy: args.movedBy ?? null,
    notes: applied !== rounded
      ? `${args.notes ? args.notes + ". " : ""}Clamped at zero; requested ${rounded}g, had ${current}g.`
      : args.notes ?? null,
    movedAt: now,
  });
  if (mvErr) throw mvErr;

  // Mirror the new total into the legacy `ingredients.currentStockG`
  // column so older call sites (shopping-needs "on hand", the
  // shopping page) show the same number as the ingredientStock table.
  // Kept deliberately — a follow-up refactor can fully retire
  // `currentStockG` once no page reads it.
  {
    const { error: mirrorErr } = await supabase
      .from("ingredients")
      .update({ currentStockG: next, updatedAt: now })
      .eq("id", ingredientId);
    if (mirrorErr) console.warn("currentStockG mirror failed", mirrorErr);
  }

  queryClient.invalidateQueries({ queryKey: ["ingredient-stock"] });
  queryClient.invalidateQueries({ queryKey: ["ingredient-stock-movements"] });
  queryClient.invalidateQueries({ queryKey: ["ingredients"] });
  return { applied, balanceAfter: next };
}

export async function receiveIngredientStock(
  ingredientId: string,
  quantityG: number,
  notes?: string,
): Promise<number> {
  if (quantityG <= 0) throw new Error("Receive quantity must be positive.");
  const r = await adjustIngredientStock({
    ingredientId,
    deltaG: quantityG,
    reason: "receive",
    notes,
  });
  return r.balanceAfter;
}

export async function setIngredientLowStockThreshold(
  ingredientId: string,
  thresholdG: number | null,
): Promise<void> {
  const existing = assertOkMaybe(
    await supabase
      .from("ingredientStock")
      .select("id")
      .eq("ingredientId", ingredientId)
      .maybeSingle(),
  ) as { id?: string } | null;
  if (existing?.id) {
    const { error } = await supabase
      .from("ingredientStock")
      .update({ lowStockThresholdG: thresholdG, updatedAt: new Date() })
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("ingredientStock").insert({
      id: newId(),
      ingredientId,
      quantityG: 0,
      lowStockThresholdG: thresholdG,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    if (error) throw error;
  }
  queryClient.invalidateQueries({ queryKey: ["ingredient-stock"] });
}

// ── Step-tick stock-flow helpers ──────────────────────────────────
//
// Each helper is triggered by ticking a production step on the batch
// page. Deductions drain ingredientStock, intakes populate fillingStock
// and productStockLocations. Every call logs a stockMovements audit
// row so /ingredients/<id> history reflects reality.
//
// Idempotency: each helper checks for a prior movement with the same
// (planId, stepKey) and bails if present. Unticking a step does NOT
// auto-revert the deduction today — see TODO for stage-2 work.

/** Shell chocolate deduction on Shelling tick.
 *  grams = cavityWeightG × numberOfCavities × moulds × shell% */
export async function deductShellForPlanProduct(
  planProductId: string,
  planId: string,
): Promise<{ warnings: string[] }> {
  const stepKey = `shell-${planProductId}`;
  const warnings: string[] = [];

  // Idempotency — have we already done this exact tick?
  const existingMv = assertOkMaybe(
    await supabase
      .from("ingredientStockMovements")
      .select("id")
      .eq("planId", planId)
      .eq("stepKey", stepKey)
      .eq("reason", "shelling")
      .maybeSingle(),
  ) as { id?: string } | null;
  if (existingMv?.id) return { warnings };

  const pp = assertOkMaybe(
    await supabase.from("planProducts").select("*").eq("id", planProductId).maybeSingle(),
  ) as PlanProduct | null;
  if (!pp) { warnings.push("planProduct not found"); return { warnings }; }

  const product = assertOkMaybe(
    await supabase.from("products").select("*").eq("id", pp.productId).maybeSingle(),
  ) as Product | null;
  if (!product) { warnings.push(`Product ${pp.productId} not found.`); return { warnings }; }
  const shellIngredientId = product.shellIngredientId;
  if (!shellIngredientId) {
    warnings.push(`"${product.name}" has no shell chocolate set — can't deduct shell stock.`);
    return { warnings };
  }

  const mould = pp.mouldId ? assertOkMaybe(
    await supabase.from("moulds").select("*").eq("id", pp.mouldId).maybeSingle(),
  ) as Mould | null : null;
  if (!mould) { warnings.push(`Mould not found for "${product.name}".`); return { warnings }; }

  const shellPct = product.shellPercentage ?? 37; // DEFAULT_SHELL_PERCENTAGE
  const totalCavityG =
    mould.cavityWeightG * mould.numberOfCavities * pp.quantity;
  const shellG = Math.round(totalCavityG * (shellPct / 100) * 10) / 10;

  if (shellG <= 0) return { warnings };

  const result = await adjustIngredientStock({
    ingredientId: shellIngredientId,
    deltaG: -shellG,
    reason: "shelling",
    planId,
    stepKey,
    notes: `Shelling — ${product.name} — ${pp.quantity} mould${pp.quantity === 1 ? "" : "s"} × ${shellPct}%`,
  });
  if (Math.abs(result.applied) < shellG) {
    warnings.push(
      `Short ${(shellG + result.applied).toFixed(1)}g of shell chocolate for "${product.name}". Stock at zero.`,
    );
  }
  return { warnings };
}

/** Filling Prep: for a given (planId, fillingId), sum the needed
 *  filling grams across all planProducts in this batch that use this
 *  filling. Apply buffer %. Deduct recipe ingredients. Create a
 *  fillingStock row with the total made. Called when the consolidated
 *  `filling-<fillingId>` step is ticked done. */
export async function prepareFillingForBatch(
  planId: string,
  fillingId: string,
  bufferPercent = 10,
): Promise<{ warnings: string[] }> {
  const stepKey = `filling-${fillingId}`;
  const warnings: string[] = [];

  // Idempotency check — any prior movement with reason=filling_prep
  // for this (planId, stepKey)?
  const existing = assertOkMaybe(
    await supabase
      .from("ingredientStockMovements")
      .select("id")
      .eq("planId", planId)
      .eq("stepKey", stepKey)
      .eq("reason", "filling_prep")
      .maybeSingle(),
  ) as { id?: string } | null;
  if (existing?.id) return { warnings };

  const pps = assertOk(
    await supabase.from("planProducts").select("*").eq("planId", planId),
  ) as PlanProduct[];
  if (pps.length === 0) return { warnings };

  // Filter to pps whose product uses this filling.
  const productFillings = assertOk(
    await supabase.from("productFillings").select("*").in("productId", pps.map((p) => p.productId)),
  ) as ProductFilling[];
  const relevantPps = pps.filter((pp) =>
    productFillings.some((pf) => pf.productId === pp.productId && pf.fillingId === fillingId),
  );
  if (relevantPps.length === 0) return { warnings };

  const moulds = assertOk(
    await supabase.from("moulds").select("*").in("id", relevantPps.map((p) => p.mouldId).filter(Boolean) as string[]),
  ) as Mould[];
  const mouldById = new Map(moulds.map((m) => [m.id!, m]));
  const products = assertOk(
    await supabase.from("products").select("*").in("id", relevantPps.map((p) => p.productId)),
  ) as Product[];
  const productById = new Map(products.map((p) => [p.id!, p]));

  // Compute total filling grams needed across all relevant planProducts.
  // fillingWeightG = cavityWeightG × cavities × moulds × (100-shellPct)/100 × fillPct/100 × density
  const DENSITY = 1.2;
  let totalNeededG = 0;
  for (const pp of relevantPps) {
    const product = productById.get(pp.productId);
    const mould = mouldById.get(pp.mouldId ?? "");
    if (!product || !mould) continue;
    const pf = productFillings.find((x) => x.productId === pp.productId && x.fillingId === fillingId);
    if (!pf) continue;
    const shellPct = product.shellPercentage ?? 37;
    const totalCavityMl = mould.cavityWeightG * mould.numberOfCavities * pp.quantity;
    const fillFactor = (100 - shellPct) / 100;
    const totalFillG = totalCavityMl * fillFactor * DENSITY;
    const fillingPct = (pf.fillPercentage ?? 100) / 100;
    totalNeededG += totalFillG * fillingPct;
  }
  if (totalNeededG <= 0) return { warnings };

  const totalToMakeG = Math.round(totalNeededG * (1 + bufferPercent / 100) * 10) / 10;

  // Look up the filling and its recipe.
  const filling = assertOkMaybe(
    await supabase.from("fillings").select("*").eq("id", fillingId).maybeSingle(),
  ) as Filling | null;
  if (!filling) { warnings.push(`Filling ${fillingId} not found.`); return { warnings }; }

  const recipe = assertOk(
    await supabase.from("fillingIngredients").select("*").eq("fillingId", fillingId),
  ) as FillingIngredient[];
  const recipeBaseG = recipe.reduce((s, r) => s + Number(r.amount || 0), 0);
  if (recipeBaseG <= 0) {
    warnings.push(`Filling "${filling.name}" has no ingredient recipe. Skipping deduction.`);
    // Still create the fillingStock row so Filling tick has something to draw from.
    await supabase.from("fillingStock").insert({
      id: newId(),
      fillingId,
      remainingG: totalToMakeG,
      planId,
      madeAt: new Date().toISOString(),
      notes: `Auto-created on Filling Prep (no recipe to deduct from).`,
      createdAt: Date.now(),
    });
    queryClient.invalidateQueries({ queryKey: ["filling-stock"] });
    return { warnings };
  }
  const scale = totalToMakeG / recipeBaseG;

  // Deduct each recipe ingredient. Sub-filling lines are skipped —
  // production-prep deduction doesn't yet recurse into nested fillings.
  for (const ri of recipe) {
    if (!ri.ingredientId) continue;
    const needG = Math.round(Number(ri.amount) * scale * 10) / 10;
    if (needG <= 0) continue;
    const r = await adjustIngredientStock({
      ingredientId: ri.ingredientId,
      deltaG: -needG,
      reason: "filling_prep",
      planId,
      stepKey,
      notes: `Filling Prep — ${filling.name} (${totalToMakeG}g, buffer ${bufferPercent}%)`,
    });
    if (Math.abs(r.applied) < needG) {
      warnings.push(
        `Short ${(needG + r.applied).toFixed(1)}g of ingredient ${ri.ingredientId} for "${filling.name}".`,
      );
    }
  }

  // Add to fillingStock.
  const { error: fsErr } = await supabase.from("fillingStock").insert({
    id: newId(),
    fillingId,
    remainingG: totalToMakeG,
    planId,
    madeAt: new Date().toISOString(),
    notes: `Made on Filling Prep tick (${bufferPercent}% buffer).`,
    createdAt: Date.now(),
  });
  if (fsErr) throw fsErr;
  queryClient.invalidateQueries({ queryKey: ["filling-stock"] });

  return { warnings };
}

/** Filling tick: consume fillingStock FIFO for a planProduct's
 *  fillings. Prefer stock rows tagged with this same planId first,
 *  fall back to older rows by createdAt ascending. */
export async function consumeFillingStockForPlanProduct(
  planProductId: string,
  planId: string,
): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];

  const pp = assertOkMaybe(
    await supabase.from("planProducts").select("*").eq("id", planProductId).maybeSingle(),
  ) as PlanProduct | null;
  if (!pp) return { warnings };

  const product = assertOkMaybe(
    await supabase.from("products").select("*").eq("id", pp.productId).maybeSingle(),
  ) as Product | null;
  if (!product) return { warnings };

  const mould = pp.mouldId ? assertOkMaybe(
    await supabase.from("moulds").select("*").eq("id", pp.mouldId).maybeSingle(),
  ) as Mould | null : null;
  if (!mould) return { warnings };

  const pfs = assertOk(
    await supabase.from("productFillings").select("*").eq("productId", pp.productId),
  ) as ProductFilling[];

  const shellPct = product.shellPercentage ?? 37;
  const DENSITY = 1.2;
  const totalCavityMl = mould.cavityWeightG * mould.numberOfCavities * pp.quantity;
  const totalFillG = totalCavityMl * ((100 - shellPct) / 100) * DENSITY;

  for (const pf of pfs) {
    const fillingPct = (pf.fillPercentage ?? 100) / 100;
    const neededG = Math.round(totalFillG * fillingPct * 10) / 10;
    if (neededG <= 0) continue;

    // Fetch filling stock rows for this filling, prefer same-plan first.
    const stocks = assertOk(
      await supabase
        .from("fillingStock")
        .select("*")
        .eq("fillingId", pf.fillingId)
        .gt("remainingG", 0),
    ) as FillingStock[];
    const sorted = [...stocks].sort((a, b) => {
      if (a.planId === planId && b.planId !== planId) return -1;
      if (b.planId === planId && a.planId !== planId) return 1;
      return (a.createdAt ?? 0) - (b.createdAt ?? 0);
    });

    let remaining = neededG;
    for (const row of sorted) {
      if (remaining <= 0) break;
      const take = Math.min(Number(row.remainingG), remaining);
      const nextRem = Math.round((Number(row.remainingG) - take) * 10) / 10;
      const { error } = await supabase
        .from("fillingStock")
        .update({ remainingG: nextRem })
        .eq("id", row.id!);
      if (error) throw error;
      remaining -= take;
    }
    if (remaining > 0) {
      const filling = assertOkMaybe(
        await supabase.from("fillings").select("name").eq("id", pf.fillingId).maybeSingle(),
      ) as { name?: string } | null;
      warnings.push(
        `Short ${remaining.toFixed(1)}g of "${filling?.name ?? pf.fillingId}". Prep more filling or increase buffer.`,
      );
    }
  }
  queryClient.invalidateQueries({ queryKey: ["filling-stock"] });
  return { warnings };
}

/**
 * Commit the AllocationSplitModal result:
 *   1. Record intent — write per-link allocatedQuantity and
 *      plan.surplusDestination (same as the old applyAllocationSplit).
 *   2. Move stock physically — for each linked order, transfer the
 *      delivered pieces Production → Allocated (orderId-tagged). For
 *      surplus, transfer to the chosen destination (store/freezer) or
 *      outake with reason='waste'.
 *
 * Idempotent: if an 'allocate' movement already exists for the
 * (planProductId, orderId) pair, the transfer is skipped so
 * re-confirming the modal doesn't double-move. Same for the surplus
 * destination (checked by a 'transfer'/'waste' movement for this
 * planProductId with from='production').
 */
export async function commitAllocationSplit(args: {
  planId: string;
  perLink: Array<{ orderPlanLinkId: string; delivered: number }>;
  /** PO-driven allocations — each row reserves pieces against a
   *  productionOrderItem (Maca PO etc). Tagged with productionOrderId
   *  on stockLocations + stockMovements so the operator can see
   *  exactly which PO is holding which pieces. */
  perPo?: Array<{
    productionOrderItemId: string;
    productionOrderId: string;
    productId: string;
    delivered: number;
  }>;
  surplus: number;
  surplusDestination?: "store" | "freezer" | "waste";
}): Promise<void> {
  const { planId } = args;
  const now = new Date();

  // 1. Fetch the data we need: plan, links, items, planProducts.
  const plan = assertOkMaybe(
    await supabase.from("productionPlans").select("*").eq("id", planId).maybeSingle(),
  ) as ProductionPlan | null;
  if (!plan) throw new Error(`commitAllocationSplit: plan ${planId} not found`);

  const links = assertOk(
    await supabase.from("orderPlanLinks").select("*").eq("planId", planId),
  ) as OrderPlanLink[];
  const itemIds = [...new Set(links.map((l) => l.orderItemId))];
  const items = itemIds.length > 0
    ? assertOk(
        await supabase.from("orderItems").select("*").in("id", itemIds),
      ) as OrderItem[]
    : [];
  const itemById = new Map(items.map((i) => [i.id!, i]));
  const planProducts = assertOk(
    await supabase.from("planProducts").select("*").eq("planId", planId),
  ) as PlanProduct[];

  // 2. Update each link's allocatedQuantity to match delivered.
  for (const p of args.perLink) {
    const { error } = await supabase
      .from("orderPlanLinks")
      .update({ allocatedQuantity: p.delivered, updatedAt: now })
      .eq("id", p.orderPlanLinkId);
    if (error) throw error;
  }

  // 3. Persist surplusDestination on the plan.
  if (args.surplusDestination) {
    const { error } = await supabase
      .from("productionPlans")
      .update({ surplusDestination: args.surplusDestination, updatedAt: now })
      .eq("id", planId);
    if (error) throw error;
  }

  // 4. Move stock per link: Production → Allocated, tagged with orderId.
  for (const p of args.perLink) {
    if (p.delivered <= 0) continue;
    const link = links.find((l) => l.id === p.orderPlanLinkId);
    if (!link) continue;
    const item = itemById.get(link.orderItemId);
    if (!item) continue;
    const pp = planProducts.find((x) => x.productId === item.productId);
    if (!pp) continue;

    // Idempotency — look for an existing 'allocate' movement for
    // this (planProductId, orderId) since unmould.
    const existing = assertOk(
      await supabase
        .from("stockMovements")
        .select("id")
        .eq("planProductId", pp.id!)
        .eq("orderId", item.orderId)
        .eq("reason", "allocate")
        .eq("fromLocation", "production")
        .limit(1),
    ) as Array<{ id: string }>;
    if (existing.length > 0) continue;

    await transferBatchStock({
      planProductId: pp.id!,
      productId: item.productId,
      fromLocation: "production",
      toLocation: "allocated",
      quantity: p.delivered,
      orderId: item.orderId,
      reason: "allocate",
      notes: "Post-unmould allocation to order",
    });
  }

  // 4b. PO-driven allocations: tagged with productionOrderId. When the
  //     PO has a `targetLocation` set ("store" / "production" /
  //     "storage"), deliver pieces straight there instead of parking
  //     them in `allocated` — that's what the PO author asked for at
  //     creation time. No targetLocation → fall back to `allocated`
  //     so the existing per-PO reservation semantics still hold.
  //     Idempotent on (planProductId, productionOrderId, fromLocation).
  let poById = new Map<string, ProductionOrder>();
  if ((args.perPo ?? []).length > 0) {
    const poIds = [...new Set((args.perPo ?? []).map((p) => p.productionOrderId))];
    const pos = assertOk(
      await supabase
        .from("productionOrders")
        .select("*")
        .in("id", poIds),
    ) as ProductionOrder[];
    poById = new Map(pos.map((p) => [p.id!, p]));
  }
  function poTargetToStockLocation(t?: string | null): StockLocation | null {
    if (!t) return null;
    if (t === "store" || t === "production") return t;
    if (t === "storage") return "freezer"; // form label "Storage" maps to back-of-house freezer
    return null;
  }
  for (const p of args.perPo ?? []) {
    if (p.delivered <= 0) continue;
    const pp = planProducts.find((x) => x.productId === p.productId);
    if (!pp) continue;
    const po = poById.get(p.productionOrderId);
    const target = poTargetToStockLocation(po?.targetLocation ?? null);
    const toLocation: StockLocation = target ?? "allocated";
    const existing = assertOk(
      await supabase
        .from("stockMovements")
        .select("id")
        .eq("planProductId", pp.id!)
        .eq("productionOrderId", p.productionOrderId)
        .eq("reason", "allocate")
        .eq("fromLocation", "production")
        .limit(1),
    ) as Array<{ id: string }>;
    if (existing.length > 0) continue;
    await transferBatchStock({
      planProductId: pp.id!,
      productId: p.productId,
      fromLocation: "production",
      toLocation,
      quantity: p.delivered,
      productionOrderId: toLocation === "allocated" ? p.productionOrderId : undefined,
      reason: "allocate",
      notes: target
        ? `Post-unmould PO delivery → ${toLocation} (PO targetLocation)`
        : "Post-unmould allocation to PO",
    });
  }

  // 5. Move surplus to its destination.
  if (args.surplus > 0 && args.surplusDestination) {
    const pp = planProducts[0];
    if (pp) {
      // Idempotency — skip if a surplus movement already exists for
      // this plan's planProduct going from production.
      const existing = assertOk(
        await supabase
          .from("stockMovements")
          .select("id, notes")
          .eq("planProductId", pp.id!)
          .eq("fromLocation", "production"),
      ) as Array<{ id: string; notes?: string }>;
      const alreadyDone = existing.some((m) => (m.notes ?? "").includes("Surplus at unmould"));
      if (!alreadyDone) {
        if (args.surplusDestination === "waste") {
          await outakeBatchStock({
            planProductId: pp.id!,
            productId: pp.productId,
            fromLocation: "production",
            quantity: args.surplus,
            reason: "waste",
            notes: `Surplus at unmould → waste (${args.surplus} pcs)`,
          });
        } else {
          await transferBatchStock({
            planProductId: pp.id!,
            productId: pp.productId,
            fromLocation: "production",
            toLocation: args.surplusDestination,
            quantity: args.surplus,
            reason: "transfer",
            notes: `Surplus at unmould → ${args.surplusDestination} (${args.surplus} pcs)`,
          });
        }
      }
    }
  }

  queryClient.invalidateQueries({ queryKey: ["production-plans"] });
  queryClient.invalidateQueries({ queryKey: ["order-plan-links"] });
  queryClient.invalidateQueries({ queryKey: ["stock-locations"] });
  queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
}

/** What's currently allocated to a specific order, joined up to
 *  productName + batchNumber so the order detail page can show
 *  "Ready to pack" rows without the consumer doing three selects. */
export interface OrderAllocatedRow {
  stockLocationId: string;
  planProductId: string;
  productId: string;
  productName: string;
  quantity: number;
  planId?: string;
  batchNumber?: string;
}

export function useAllocatedForOrder(orderId: string | undefined): OrderAllocatedRow[] {
  const { data } = useQuery({
    queryKey: ["allocated-for-order", orderId ?? ""],
    enabled: !!orderId,
    queryFn: async () => {
      const locs = assertOk(
        await supabase
          .from("stockLocations")
          .select("*")
          .eq("orderId", orderId!)
          .eq("location", "allocated"),
      ) as StockLocationRow[];
      if (locs.length === 0) return [] as OrderAllocatedRow[];
      const ppIds = [...new Set(locs.map((r) => r.planProductId))];
      const pps = assertOk(
        await supabase.from("planProducts").select("*").in("id", ppIds),
      ) as PlanProduct[];
      const productIds = [...new Set(pps.map((p) => p.productId))];
      const products = productIds.length > 0
        ? assertOk(
            await supabase.from("products").select("id, name").in("id", productIds),
          ) as Array<{ id: string; name: string }>
        : [];
      const productById = new Map(products.map((p) => [p.id, p]));
      const planIds = [...new Set(pps.map((p) => p.planId))];
      const plans = planIds.length > 0
        ? assertOk(
            await supabase.from("productionPlans").select("id, batchNumber").in("id", planIds),
          ) as Array<{ id: string; batchNumber?: string }>
        : [];
      const planById = new Map(plans.map((p) => [p.id, p]));
      const ppById = new Map(pps.map((p) => [p.id!, p]));
      return locs.map((r) => {
        const pp = ppById.get(r.planProductId);
        return {
          stockLocationId: r.id!,
          planProductId: r.planProductId,
          productId: pp?.productId ?? "",
          productName: pp ? (productById.get(pp.productId)?.name ?? pp.productId) : "Unknown",
          quantity: r.quantity,
          planId: pp?.planId,
          batchNumber: pp ? planById.get(pp.planId)?.batchNumber : undefined,
        };
      });
    },
  });
  return data ?? [];
}

// ── Undo last stock action ─────────────────────────────────────
//
// Narrow-scoped undo: reverses the most recent ingredientStockMovement
// within a short window (10 minutes). Covers the common "oh, wrong
// step ticked — give me back my shell chocolate" case. Product-stock
// movements and filling stock are out of scope for this pass.

const UNDO_WINDOW_MS = 10 * 60 * 1000;

/** The last still-undo-able ingredient stock movement, or null. */
export function useLastUndoableIngredientMovement(): IngredientStockMovement | null {
  const { data } = useQuery({
    queryKey: ["ingredient-stock-movements", "last-undoable"],
    queryFn: async () => {
      const since = new Date(Date.now() - UNDO_WINDOW_MS).toISOString();
      const rows = assertOk(
        await supabase
          .from("ingredientStockMovements")
          .select("*")
          .gte("movedAt", since)
          .order("movedAt", { ascending: false })
          .limit(20),
      ) as IngredientStockMovement[];
      if (rows.length === 0) return null;
      // Filter out reason='undo' rows and rows that have been undone
      // (a later row's notes references their id).
      const undoneIds = new Set<string>();
      for (const r of rows) {
        if (r.reason !== "undo") continue;
        const m = (r.notes ?? "").match(/undid mvt:([a-f0-9-]+)/i);
        if (m) undoneIds.add(m[1]);
      }
      for (const r of rows) {
        if (r.reason === "undo") continue;
        if (r.id && undoneIds.has(r.id)) continue;
        return r;
      }
      return null;
    },
    refetchInterval: 30_000, // every 30s — affordance fades as time runs out
  });
  return data ?? null;
}

/** Reverse an ingredient stock movement. Logs a new movement with
 *  reason='undo' and notes referencing the original, so subsequent
 *  lookups know not to offer undo on the same row again. Adjusts
 *  the ingredientStock balance by the opposite delta. */
export async function undoIngredientStockMovement(
  movementId: string,
): Promise<{ balanceAfter: number }> {
  const original = assertOkMaybe(
    await supabase
      .from("ingredientStockMovements")
      .select("*")
      .eq("id", movementId)
      .maybeSingle(),
  ) as IngredientStockMovement | null;
  if (!original) throw new Error("Movement not found.");
  if (original.reason === "undo") throw new Error("Can't undo an undo.");

  // Check this hasn't already been undone.
  const subsequent = assertOk(
    await supabase
      .from("ingredientStockMovements")
      .select("id, notes")
      .eq("ingredientId", original.ingredientId)
      .eq("reason", "undo"),
  ) as Array<{ id: string; notes?: string }>;
  for (const s of subsequent) {
    if ((s.notes ?? "").toLowerCase().includes(`undid mvt:${movementId.toLowerCase()}`)) {
      throw new Error("Already undone.");
    }
  }

  const reverseDelta = -Number(original.deltaG);
  const result = await adjustIngredientStock({
    ingredientId: original.ingredientId,
    deltaG: reverseDelta,
    reason: "recount", // stored reason below is overwritten for the audit row
    planId: original.planId,
    stepKey: original.stepKey,
    notes: `Undid mvt:${movementId}. Original reason: ${original.reason}. ${original.notes ?? ""}`.trim(),
  });

  // Rewrite the reason on the movement row we just inserted from
  // 'recount' to 'undo' so the list helper can filter it out next
  // time. Easier than plumbing a custom reason through
  // adjustIngredientStock.
  const { data: latest } = await supabase
    .from("ingredientStockMovements")
    .select("id")
    .eq("ingredientId", original.ingredientId)
    .order("movedAt", { ascending: false })
    .limit(1);
  const latestId = (latest as Array<{ id: string }> | null)?.[0]?.id;
  if (latestId) {
    await supabase
      .from("ingredientStockMovements")
      .update({ reason: "undo" })
      .eq("id", latestId);
  }

  queryClient.invalidateQueries({ queryKey: ["ingredient-stock"] });
  queryClient.invalidateQueries({ queryKey: ["ingredient-stock-movements"] });
  return { balanceAfter: result.balanceAfter };
}

/** One reassignment proposal — "this batch has Shelling-or-later
 *  progress, here are compatible orders that could absorb the
 *  already-made quantity." Shown in the pre-delete / pre-cancel
 *  modal so in-flight production doesn't get wasted silently. */
export interface ReassignmentProposal {
  planId: string;
  planName: string;
  batchNumber?: string;
  productId: string;
  productName: string;
  allocatedQuantity: number;
  orderPlanLinkId: string;
  progressStepKey: string;
  candidates: Array<{
    orderId: string;
    orderItemId: string;
    orderLabel: string;
    deadline: string;
    itemQuantity: number;
    itemRemainingDemand: number; // quantity minus already allocated
  }>;
}

/**
 * Find reassignment opportunities for an order about to be cancelled
 * or deleted. Walks the order's linked batches and, for any batch
 * whose progress has reached Shelling (step_sortOrder >= 3, by
 * convention) or later, lists compatible open orders that could
 * absorb the allocated quantity.
 *
 * "Compatible" = open order (pending or in_production) with a
 * produce-fresh orderItem for the same product.
 *
 * Returns an empty array when nothing worth reassigning — caller
 * proceeds straight to cancel/delete.
 */
export async function computeReassignmentProposals(
  orderId: string,
): Promise<ReassignmentProposal[]> {
  const items = assertOk(
    await supabase.from("orderItems").select("id, productId").eq("orderId", orderId),
  ) as Array<{ id: string; productId: string }>;
  if (items.length === 0) return [];
  const itemIds = items.map((i) => i.id);
  const links = assertOk(
    await supabase.from("orderPlanLinks").select("*").in("orderItemId", itemIds),
  ) as OrderPlanLink[];
  if (links.length === 0) return [];

  const planIds = [...new Set(links.map((l) => l.planId))];
  const plans = assertOk(
    await supabase.from("productionPlans").select("*").in("id", planIds),
  ) as ProductionPlan[];
  const planById = new Map(plans.map((p) => [p.id!, p]));

  // Only draft / active batches matter — done / cancelled are either
  // already complete or already abandoned.
  const statuses = assertOk(
    await supabase.from("planStepStatus").select("*").in("planId", planIds),
  ) as PlanStepStatus[];
  const doneByPlan = new Map<string, Set<string>>();
  for (const s of statuses) {
    if (!s.done) continue;
    const set = doneByPlan.get(s.planId) ?? new Set<string>();
    set.add(s.stepKey);
    doneByPlan.set(s.planId, set);
  }

  const proposals: ReassignmentProposal[] = [];
  const products = assertOk(
    await supabase.from("products").select("id, name"),
  ) as Array<{ id: string; name: string }>;
  const productName = new Map(products.map((p) => [p.id, p.name]));

  // For each link, detect Shelling+ progress. Step keys in the
  // canonical 8-step list are prefixed "polishing", "colour",
  // "shell", "filling", "fill", "cap", "unmould", "packing". A shell
  // tick means Shelling is underway — the batch has ingredient cost
  // sunk into it.
  const progressPrefixes = ["shell", "filling", "fill", "cap", "unmould", "packing"];

  for (const link of links) {
    const plan = planById.get(link.planId);
    if (!plan) continue;
    if (plan.status !== "draft" && plan.status !== "active") continue;
    const doneSet = doneByPlan.get(link.planId) ?? new Set<string>();
    // Find the earliest Shelling+ step that's done.
    let progressStepKey: string | null = null;
    for (const key of doneSet) {
      const prefix = key.split("-")[0];
      if (progressPrefixes.includes(prefix)) {
        progressStepKey = key;
        break;
      }
    }
    if (!progressStepKey) continue; // no meaningful sunk cost

    const item = items.find((i) => i.id === link.orderItemId);
    if (!item) continue;

    // Find candidate open orders with a produce orderItem for the
    // same product, excluding this order.
    const openOrders = assertOk(
      await supabase
        .from("orders")
        .select("id, customerName, eventName, deadline, status")
        .in("status", ["pending", "in_production"])
        .neq("id", orderId),
    ) as Array<{ id: string; customerName?: string; eventName?: string; deadline: string; status: string }>;
    if (openOrders.length === 0) {
      proposals.push({
        planId: link.planId,
        planName: plan.name,
        batchNumber: plan.batchNumber,
        productId: item.productId,
        productName: productName.get(item.productId) ?? item.productId,
        allocatedQuantity: link.allocatedQuantity,
        orderPlanLinkId: link.id!,
        progressStepKey,
        candidates: [],
      });
      continue;
    }
    const openOrderIds = openOrders.map((o) => o.id);
    const candidateItems = assertOk(
      await supabase
        .from("orderItems")
        .select("*")
        .in("orderId", openOrderIds)
        .eq("productId", item.productId),
    ) as OrderItem[];
    const produceCandidateItems = candidateItems.filter(
      (ci) => (ci.fulfilmentMode ?? "produce") === "produce",
    );

    // For each candidate item, compute remaining demand = quantity
    // minus already-allocated-elsewhere.
    const candItemIds = produceCandidateItems.map((c) => c.id!);
    const otherLinks = candItemIds.length > 0
      ? (assertOk(
          await supabase.from("orderPlanLinks").select("orderItemId, allocatedQuantity").in("orderItemId", candItemIds),
        ) as Array<{ orderItemId: string; allocatedQuantity: number }>)
      : [];
    const allocByItem = new Map<string, number>();
    for (const l of otherLinks) {
      allocByItem.set(l.orderItemId, (allocByItem.get(l.orderItemId) ?? 0) + l.allocatedQuantity);
    }

    const candidates: ReassignmentProposal["candidates"] = produceCandidateItems.map((ci) => {
      const o = openOrders.find((x) => x.id === ci.orderId);
      const allocated = allocByItem.get(ci.id!) ?? 0;
      return {
        orderId: ci.orderId,
        orderItemId: ci.id!,
        orderLabel: o?.customerName || o?.eventName || "Order",
        deadline: o?.deadline ?? "",
        itemQuantity: ci.quantity,
        itemRemainingDemand: Math.max(0, ci.quantity - allocated),
      };
    }).filter((c) => c.itemRemainingDemand > 0)
      .sort((a, b) => a.deadline.localeCompare(b.deadline));

    proposals.push({
      planId: link.planId,
      planName: plan.name,
      batchNumber: plan.batchNumber,
      productId: item.productId,
      productName: productName.get(item.productId) ?? item.productId,
      allocatedQuantity: link.allocatedQuantity,
      orderPlanLinkId: link.id!,
      progressStepKey,
      candidates,
    });
  }

  return proposals;
}

/** Reassign a single orderPlanLinks row to a different orderItem.
 *  The batch keeps its progress and identity; only the demand it
 *  fulfils changes. Caller is expected to have computed the target
 *  via computeReassignmentProposals. */
export async function reassignBatchLink(
  orderPlanLinkId: string,
  targetOrderItemId: string,
): Promise<void> {
  const { error } = await supabase
    .from("orderPlanLinks")
    .update({ orderItemId: targetOrderItemId, updatedAt: new Date() })
    .eq("id", orderPlanLinkId);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["order-plan-links"] });
  queryClient.invalidateQueries({ queryKey: ["orders"] });
  queryClient.invalidateQueries({ queryKey: ["order-items"] });
}

/**
 * Order-level "Mark as packed" — used for borrow (take-from-stock)
 * orders. Drains the allocated stock tagged with this orderId and
 * deducts the order's packaging lines. Idempotent: already-sold
 * allocations are skipped.
 *
 * Produce-fresh lines on the same order are untouched; their stock
 * flow happens on the batch via the Packing step tick. This hook
 * only handles the from-stock portion.
 *
 * Returns the number of pieces moved and a list of warnings
 * (packaging shortages, missing product refs).
 */
export async function markOrderAsPacked(orderId: string): Promise<{
  piecesMoved: number;
  warnings: string[];
}> {
  const warnings: string[] = [];
  let piecesMoved = 0;

  // 1. Drain allocated stockLocations for this order → reason='sold'.
  const allocated = assertOk(
    await supabase
      .from("stockLocations")
      .select("*")
      .eq("orderId", orderId)
      .eq("location", "allocated"),
  ) as StockLocationRow[];
  for (const row of allocated) {
    const batch = assertOkMaybe(
      await supabase
        .from("planProducts")
        .select("productId")
        .eq("id", row.planProductId)
        .maybeSingle(),
    ) as { productId?: string } | null;
    if (!batch?.productId) {
      warnings.push(`planProduct ${row.planProductId} is missing a productId — skipping.`);
      continue;
    }
    await outakeBatchStock({
      planProductId: row.planProductId,
      productId: batch.productId,
      fromLocation: "allocated",
      quantity: row.quantity,
      orderId,
      reason: "sold",
      notes: "Mark as packed — from-stock fulfilment",
    });
    piecesMoved += row.quantity;
  }

  // 2. Drain variant boxes that were reserved against this order.
  //    These represent pre-built variant boxes coming off the shelf
  //    and going out the door — pieces + their packaging components
  //    were already consumed at box-up, so this just zeroes the
  //    allocated reservation.
  const variantAllocRows = assertOk(
    await supabase
      .from("variantStockLocations")
      .select("*")
      .eq("orderId", orderId)
      .eq("location", "allocated"),
  ) as VariantStockLocation[];
  for (const row of variantAllocRows) {
    if ((row.quantity ?? 0) <= 0) continue;
    await supabase.from("variantStockLocations").delete().eq("id", row.id!);
    await logStockMovement({
      planProductId: undefined as unknown as string,
      productId: undefined as unknown as string,
      fromLocation: "allocated",
      quantity: row.quantity,
      orderId,
      variantPackagingId: row.variantPackagingId,
      reason: "sold",
      notes: "Variant box shipped (Mark as packed)",
    });
  }

  // 3. Deduct each orderPackagingLine from packaging stock — but only
  //    for packaging that's NOT bundled inside a variant box that was
  //    already drained above. Variant box packaging was consumed at
  //    box-up time. Outer shipping packaging (mailers, fillers) still
  //    deducts here.
  const variantPackagingIdsCovered = new Set<string>();
  if (variantAllocRows.length > 0) {
    // Read the components for each covered variant size — these
    // packagingIds were already consumed at box-up, so skip them now.
    const vpIds = [...new Set(variantAllocRows.map((r) => r.variantPackagingId))];
    if (vpIds.length > 0) {
      const comps = assertOk(
        await supabase
          .from("variantPackagingComponents")
          .select("packagingId")
          .in("variantPackagingId", vpIds),
      ) as Array<{ packagingId: string }>;
      for (const c of comps) variantPackagingIdsCovered.add(c.packagingId);
    }
  }
  const packagingLines = assertOk(
    await supabase.from("orderPackagingLines").select("*").eq("orderId", orderId),
  ) as OrderPackagingLine[];
  for (const line of packagingLines) {
    if (variantPackagingIdsCovered.has(line.packagingId)) continue;
    const actual = await consumePackaging({
      packagingId: line.packagingId,
      quantity: line.quantity,
      orderId,
      note: "Mark as packed — order fulfilment",
    });
    if (actual < line.quantity) {
      warnings.push(
        `Packaging ${line.packagingId}: only ${actual} of ${line.quantity} on hand. Add stock on the Packaging page before next pack.`,
      );
    }
  }

  queryClient.invalidateQueries({ queryKey: ["stock-locations"] });
  queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
  queryClient.invalidateQueries({ queryKey: ["packaging"] });
  queryClient.invalidateQueries({ queryKey: ["order-packaging-lines"] });
  queryClient.invalidateQueries({ queryKey: ["variant-stock-locations"] });
  return { piecesMoved, warnings };
}

/** Packing tick: move `quantity` pieces out of Production stock for
 *  this planProduct (reason='sold'). Called by the Packing modal
 *  confirm handler after packaging has been deducted. Idempotent via
 *  a check for an existing 'sold' movement tagged with this step.
 *
 *  Packing-only batches (name suffix "— packing") are skipped — they
 *  represent borrow-line packing work where the pieces are on a
 *  different batch's stockLocations (the donor). A follow-up task
 *  will wire borrow-line packing through allocated-→-null moves on
 *  the donor batch. */
export async function consumeProductStockForPacking(
  planProductId: string,
  planId: string,
  quantity: number,
  stepKey: string,
): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];
  const qty = Math.max(0, Math.round(quantity));
  if (qty === 0) return { warnings };

  // Packing-only batches bypass product stock deduction (no production
  // pieces under this planProduct).
  const plan = assertOkMaybe(
    await supabase.from("productionPlans").select("name").eq("id", planId).maybeSingle(),
  ) as { name?: string } | null;
  if ((plan?.name ?? "").trim().endsWith("— packing")) return { warnings };

  // Idempotency check.
  const existing = assertOk(
    await supabase
      .from("stockMovements")
      .select("id")
      .eq("planProductId", planProductId)
      .eq("reason", "sold")
      .limit(1),
  ) as Array<{ id: string }>;
  if (existing.length > 0) return { warnings };

  // Pull productId for the movement log.
  const pp = assertOkMaybe(
    await supabase.from("planProducts").select("productId").eq("id", planProductId).maybeSingle(),
  ) as { productId?: string } | null;
  if (!pp?.productId) { warnings.push("planProduct missing"); return { warnings }; }

  // Find Production-location stockLocations for this planProduct.
  const locs = assertOk(
    await supabase
      .from("stockLocations")
      .select("*")
      .eq("planProductId", planProductId)
      .eq("location", "production"),
  ) as StockLocationRow[];
  const available = locs.reduce((s, r) => s + Number(r.quantity ?? 0), 0);
  if (available <= 0) {
    warnings.push(`No Production stock for this batch to deduct — did Unmould run?`);
    return { warnings };
  }

  const toTake = Math.min(qty, available);
  await outakeBatchStock({
    planProductId,
    productId: pp.productId,
    fromLocation: "production",
    quantity: toTake,
    reason: "sold",
    notes: `Packing step ${stepKey}`,
  });
  if (toTake < qty) {
    warnings.push(
      `Packing asked for ${qty} pcs but only ${toTake} were in Production. Shortfall ${qty - toTake} pcs — reconcile via /stock.`,
    );
  }
  return { warnings };
}

// --- Filling Stock (leftover filling) ---

/** All filling stock entries with remaining > 0 */
export function useFillingStockItems(): FillingStock[] {
  const { data } = useQuery({
    queryKey: ["filling-stock"],
    queryFn: async () => {
      const rows = assertOk(await supabase.from("fillingStock").select("*")) as FillingStock[];
      return rows.filter((s) => s.remainingG > 0);
    },
  });
  return data ?? [];
}

/** All filling stock entries for a specific filling with remaining > 0 */
export function useFillingStockForFilling(fillingId: string | undefined): FillingStock[] {
  const { data } = useQuery({
    queryKey: ["filling-stock", fillingId],
    enabled: !!fillingId,
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("fillingStock").select("*").eq("fillingId", fillingId!),
      ) as FillingStock[];
      return rows.filter((s) => s.remainingG > 0);
    },
  });
  return data ?? [];
}

export async function saveFillingStock(obj: Omit<FillingStock, "id"> & { id?: string }): Promise<string> {
  if (obj.id) {
    const { error } = await supabase.from("fillingStock").update(obj).eq("id", obj.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["filling-stock"] });
    return obj.id;
  }
  const createdId = newId();
  const { error } = await supabase.from("fillingStock").insert({ ...obj, id: createdId });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["filling-stock"] });
  return createdId;
}

/** Update the remaining grams on a filling stock entry */
export async function adjustFillingStock(id: string, remainingG: number): Promise<void> {
  const { error } = await supabase
    .from("fillingStock")
    .update({ remainingG: Math.max(0, remainingG) })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["filling-stock"] });
}

/** Zero out a filling stock entry (discard) */
export async function discardFillingStock(id: string): Promise<void> {
  const { error } = await supabase.from("fillingStock").update({ remainingG: 0 }).eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["filling-stock"] });
}

/** Mark a filling stock entry as frozen. When `qty` is less than the entry's
 *  remainingG, the row is split: `qty` grams are frozen and the rest stays
 *  available in a new row. Captures the remaining shelf life (days) to apply
 *  when defrosted — user-editable in the freeze modal. */
export async function freezeFillingStock(
  id: string,
  preservedShelfLifeDays: number,
  qty?: number,
): Promise<void> {
  const entry = assertOkMaybe(
    await supabase.from("fillingStock").select("*").eq("id", id).maybeSingle(),
  ) as FillingStock | null;
  if (!entry) return;
  const total = entry.remainingG;
  const freezeQty = qty == null ? total : Math.max(0, Math.min(Math.round(qty), total));
  if (freezeQty <= 0) return;
  const days = Math.max(0, Math.round(preservedShelfLifeDays));
  if (freezeQty >= total) {
    const { error } = await supabase
      .from("fillingStock")
      .update({ frozen: true, frozenAt: Date.now(), preservedShelfLifeDays: days })
      .eq("id", id);
    if (error) throw error;
  } else {
    // Split: current row becomes the frozen portion; leftover goes into a new row.
    const u = await supabase
      .from("fillingStock")
      .update({ remainingG: freezeQty, frozen: true, frozenAt: Date.now(), preservedShelfLifeDays: days })
      .eq("id", id);
    if (u.error) throw u.error;
    const ins = await supabase.from("fillingStock").insert({
      id: newId(),
      fillingId: entry.fillingId,
      remainingG: Math.round((total - freezeQty) * 10) / 10,
      planId: entry.planId,
      madeAt: entry.madeAt,
      notes: entry.notes,
      createdAt: Date.now(),
    });
    if (ins.error) throw ins.error;
  }
  queryClient.invalidateQueries({ queryKey: ["filling-stock"] });
}

/** Defrost a filling stock entry. Sets defrostedAt so freshness is computed from
 *  that point with the captured preservedShelfLifeDays. */
export async function defrostFillingStock(id: string): Promise<void> {
  const { error } = await supabase
    .from("fillingStock")
    .update({ frozen: false, frozenAt: null, defrostedAt: Date.now() })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["filling-stock"] });
}

/** Deduct grams from filling stock for a given filling, oldest-first (FIFO). Returns total deducted.
 *  When `includeFrozen` is true, available (non-frozen) rows are consumed first; any
 *  remaining need then pulls from frozen rows (oldest first), and any frozen row that
 *  is touched is implicitly defrosted (frozen → false, defrostedAt stamped). */
export async function deductFillingStock(
  fillingId: string,
  gramsNeeded: number,
  options?: { includeFrozen?: boolean },
): Promise<number> {
  const entries = assertOk(
    await supabase.from("fillingStock").select("*").eq("fillingId", fillingId),
  ) as FillingStock[];
  const sortByMadeAt = (a: FillingStock, b: FillingStock) =>
    new Date(a.madeAt).getTime() - new Date(b.madeAt).getTime();
  const available = entries.filter((e) => e.remainingG > 0 && !e.frozen).sort(sortByMadeAt);
  const frozen = options?.includeFrozen
    ? entries.filter((e) => e.remainingG > 0 && e.frozen).sort(sortByMadeAt)
    : [];

  let remaining = gramsNeeded;
  let totalDeducted = 0;

  for (const entry of available) {
    if (remaining <= 0) break;
    const deduct = Math.min(entry.remainingG, remaining);
    const { error } = await supabase
      .from("fillingStock")
      .update({ remainingG: Math.round((entry.remainingG - deduct) * 10) / 10 })
      .eq("id", entry.id!);
    if (error) throw error;
    remaining -= deduct;
    totalDeducted += deduct;
  }

  for (const entry of frozen) {
    if (remaining <= 0) break;
    const deduct = Math.min(entry.remainingG, remaining);
    // Touching a frozen row defrosts the whole row — you can't refreeze the rest.
    const { error } = await supabase
      .from("fillingStock")
      .update({
        remainingG: Math.round((entry.remainingG - deduct) * 10) / 10,
        frozen: false,
        frozenAt: null,
        defrostedAt: Date.now(),
      })
      .eq("id", entry.id!);
    if (error) throw error;
    remaining -= deduct;
    totalDeducted += deduct;
  }

  queryClient.invalidateQueries({ queryKey: ["filling-stock"] });
  return totalDeducted;
}

// ---------------------------------------------------------------------------
// Capacity & People (singleton) + Event calendar
// ---------------------------------------------------------------------------

/**
 * capacityConfig is a singleton by convention (migration 0002). The app
 * always reads/writes the same UUID so we don't need a "first row" query.
 */
export const CAPACITY_CONFIG_ID = "00000000-0000-0000-0000-000000000001";

export function useCapacityConfig(): CapacityConfig | null {
  const { data } = useQuery({
    queryKey: ["capacity-config"],
    queryFn: async () => {
      const row = assertOkMaybe(
        await supabase.from("capacityConfig").select("*").eq("id", CAPACITY_CONFIG_ID).maybeSingle(),
      ) as CapacityConfig | null;
      return row;
    },
  });
  return data ?? null;
}

/** Upsert the singleton capacityConfig row. Missing fields stay null — the
 *  Settings form lets you save partial rows so progress isn't lost. */
export async function saveCapacityConfig(partial: Partial<CapacityConfig>): Promise<void> {
  const { error } = await supabase
    .from("capacityConfig")
    .upsert({
      id: CAPACITY_CONFIG_ID,
      warnThresholdPercent: partial.warnThresholdPercent ?? null,
      criticalThresholdPercent: partial.criticalThresholdPercent ?? null,
      capacityBufferPercent: partial.capacityBufferPercent ?? null,
      fillingBufferPercent: partial.fillingBufferPercent ?? null,
      stockExpiryWarnDays: partial.stockExpiryWarnDays ?? null,
      labourHourlyRate: partial.labourHourlyRate ?? null,
      productionBufferDays: partial.productionBufferDays ?? null,
      updatedAt: new Date(),
    }, { onConflict: "id" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["capacity-config"] });
}

// ---------------------------------------------------------------------------
// People + unavailability
// ---------------------------------------------------------------------------

export function usePeople(includeArchived = false): Person[] {
  const { data } = useQuery({
    queryKey: ["people", { includeArchived }],
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("people").select("*"),
      ) as Person[];
      return rows
        .filter((p) => (includeArchived ? true : !p.archived))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  return data ?? [];
}

export async function savePerson(person: Omit<Person, "createdAt" | "updatedAt">): Promise<string> {
  const now = new Date();
  if (person.id) {
    const { error } = await supabase
      .from("people")
      .update({ ...person, updatedAt: now })
      .eq("id", person.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["people"] });
    return person.id;
  }
  const id = newId();
  const { error } = await supabase
    .from("people")
    .insert({ ...person, id, createdAt: now, updatedAt: now });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["people"] });
  return id;
}

export async function deletePerson(id: string): Promise<void> {
  const { error } = await supabase.from("people").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["people"] });
  queryClient.invalidateQueries({ queryKey: ["person-unavailability"] });
}

export async function archivePerson(id: string, archived = true): Promise<void> {
  const { error } = await supabase
    .from("people")
    .update({ archived, updatedAt: new Date() })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["people"] });
}

/** All unavailability rows across all people, sorted by startDate asc.
 *  The UI filters by personId for per-person views; the scheduler uses
 *  the full set to deduct hours per day. */
export function usePersonUnavailability(): PersonUnavailability[] {
  const { data } = useQuery({
    queryKey: ["person-unavailability"],
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("personUnavailability").select("*"),
      ) as PersonUnavailability[];
      return rows.sort((a, b) => a.startDate.localeCompare(b.startDate));
    },
  });
  return data ?? [];
}

export async function savePersonUnavailability(
  entry: Omit<PersonUnavailability, "createdAt">,
): Promise<string> {
  const now = new Date();
  if (entry.id) {
    const { error } = await supabase
      .from("personUnavailability")
      .update(entry)
      .eq("id", entry.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["person-unavailability"] });
    return entry.id;
  }
  const id = newId();
  const { error } = await supabase
    .from("personUnavailability")
    .insert({ ...entry, id, createdAt: now });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["person-unavailability"] });
  return id;
}

export async function deletePersonUnavailability(id: string): Promise<void> {
  const { error } = await supabase
    .from("personUnavailability")
    .delete()
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["person-unavailability"] });
}

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

export function useEquipment(includeArchived = false): Equipment[] {
  const { data } = useQuery({
    queryKey: ["equipment", { includeArchived }],
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("equipment").select("*"),
      ) as Equipment[];
      return rows
        .filter((e) => (includeArchived ? true : !e.archived))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  return data ?? [];
}

export async function saveEquipment(
  equipment: Omit<Equipment, "createdAt" | "updatedAt">,
): Promise<string> {
  const now = new Date();
  if (equipment.id) {
    const { error } = await supabase
      .from("equipment")
      .update({ ...equipment, updatedAt: now })
      .eq("id", equipment.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["equipment"] });
    return equipment.id;
  }
  const id = newId();
  const { error } = await supabase
    .from("equipment")
    .insert({ ...equipment, id, createdAt: now, updatedAt: now });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["equipment"] });
  return id;
}

export async function deleteEquipment(id: string): Promise<void> {
  const { error } = await supabase.from("equipment").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["equipment"] });
}

export async function archiveEquipment(id: string, archived = true): Promise<void> {
  const { error } = await supabase
    .from("equipment")
    .update({ archived, updatedAt: new Date() })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["equipment"] });
}

// ---------------------------------------------------------------------------
// Production steps
// ---------------------------------------------------------------------------

export function useProductionSteps(): ProductionStep[] {
  const { data } = useQuery({
    queryKey: ["production-steps"],
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("productionSteps").select("*"),
      ) as ProductionStep[];
      return rows.sort(
        (a, b) => a.productType.localeCompare(b.productType) || a.sortOrder - b.sortOrder,
      );
    },
  });
  return data ?? [];
}

// Columns that arrived in later migrations (0033 / 0037). When the DB
// hasn't run those yet, PostgREST refuses any insert / update that
// references them with code PGRST204. Save is retried without them so
// the user can still edit existing fields; a console warning surfaces
// the actual cause.
const PRODUCTION_STEP_OPTIONAL_COLUMNS = ["isPackingStep", "perBatch"] as const;

function stripOptionalProductionStepCols(payload: Record<string, unknown>): Record<string, unknown> {
  const out = { ...payload };
  for (const col of PRODUCTION_STEP_OPTIONAL_COLUMNS) delete out[col];
  return out;
}

function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // PGRST204 = "column not found in schema cache"; 42703 = Postgres
  // "undefined column" if the request bypassed the cache. Either
  // points at a missing migration.
  return error.code === "PGRST204" || error.code === "42703";
}

export async function saveProductionStep(
  step: Omit<ProductionStep, "createdAt" | "updatedAt">,
): Promise<string> {
  const now = new Date();
  if (step.id) {
    const fullPayload = { ...step, updatedAt: now };
    // .select() forces Supabase to return the row(s) that matched —
    // lets us detect silent zero-row updates (e.g., wrong id, RLS
    // denial) instead of pretending the save worked.
    let resp = await supabase
      .from("productionSteps")
      .update(fullPayload)
      .eq("id", step.id)
      .select();
    if (isMissingColumnError(resp.error)) {
      console.warn(
        "saveProductionStep: schema is missing one of " + PRODUCTION_STEP_OPTIONAL_COLUMNS.join(", ")
        + " — retrying without them. Apply migrations 0033/0037 to enable per-step flags. Error:",
        resp.error,
      );
      resp = await supabase
        .from("productionSteps")
        .update(stripOptionalProductionStepCols(fullPayload))
        .eq("id", step.id)
        .select();
    }
    if (resp.error) throw resp.error;
    if (!resp.data || resp.data.length === 0) {
      throw new Error(
        `Update affected 0 rows — id ${step.id} did not match any productionSteps row, `
        + "or row-level security blocked the update. Check that the step exists and that "
        + "you're signed in.",
      );
    }
    queryClient.invalidateQueries({ queryKey: ["production-steps"] });
    return step.id;
  }
  const id = newId();
  const fullPayload = { ...step, id, createdAt: now, updatedAt: now };
  let { error } = await supabase.from("productionSteps").insert(fullPayload);
  if (isMissingColumnError(error)) {
    console.warn(
      "saveProductionStep: schema is missing one of " + PRODUCTION_STEP_OPTIONAL_COLUMNS.join(", ")
      + " — retrying without them. Apply migrations 0033/0037 to enable per-step flags. Error:",
      error,
    );
    ({ error } = await supabase
      .from("productionSteps")
      .insert(stripOptionalProductionStepCols(fullPayload)));
  }
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["production-steps"] });
  return id;
}

export async function deleteProductionStep(id: string): Promise<void> {
  const { error } = await supabase.from("productionSteps").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["production-steps"] });
}

/** Reorder every step in the given product type. Writes new sortOrder
 *  values in one batched update. */
export async function reorderProductionSteps(
  productType: string,
  orderedIds: string[],
): Promise<void> {
  const now = new Date();
  await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from("productionSteps")
        .update({ sortOrder: index, updatedAt: now })
        .eq("id", id)
        .eq("productType", productType),
    ),
  );
  queryClient.invalidateQueries({ queryKey: ["production-steps"] });
}

// ---------------------------------------------------------------------------
// Orders + order items
// ---------------------------------------------------------------------------

export function useOrders(): Order[] {
  const { data } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("orders").select("*"),
      ) as Order[];
      return rows.sort((a, b) => a.deadline.localeCompare(b.deadline));
    },
  });
  return data ?? [];
}

export function useOrder(id: string | undefined): Order | null | undefined {
  const { data } = useQuery({
    queryKey: ["orders", id],
    enabled: !!id,
    queryFn: async () => {
      const row = assertOkMaybe(
        await supabase.from("orders").select("*").eq("id", id!).maybeSingle(),
      ) as Order | null;
      return row;
    },
  });
  return data;
}

/** The linked shop-replenishment order (child) for a given parent order,
 *  if any. Returns undefined while loading, null when none exists. */
export function useReplenishmentOrderFor(parentOrderId: string | undefined): Order | null | undefined {
  const { data } = useQuery({
    queryKey: ["replenishment-order-for", parentOrderId],
    enabled: !!parentOrderId,
    queryFn: async () => {
      const row = assertOkMaybe(
        await supabase
          .from("orders")
          .select("*")
          .eq("sourceOrderId", parentOrderId!)
          .eq("channel", "shop")
          .maybeSingle(),
      ) as Order | null;
      return row;
    },
  });
  return data;
}

export function useOrderItems(orderId: string | undefined): OrderItem[] {
  const { data } = useQuery({
    queryKey: ["order-items", orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("orderItems").select("*").eq("orderId", orderId!),
      ) as OrderItem[];
      return rows.sort((a, b) => a.sortOrder - b.sortOrder);
    },
  });
  return data ?? [];
}

export function useAllOrderItems(): OrderItem[] {
  const { data } = useQuery({
    queryKey: ["order-items", "all"],
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("orderItems").select("*"),
      ) as OrderItem[];
      return rows;
    },
  });
  return data ?? [];
}

export async function saveOrder(order: Omit<Order, "createdAt" | "updatedAt">): Promise<string> {
  const now = new Date();
  // Strip undefined before sending. The Supabase client serialises
  // undefined fields as `null` on the wire, which trips NOT-NULL
  // columns (channel / deadline / priority / status) if the form
  // ever emits undefined by accident. The form's `field: x || undefined`
  // patterns only matter for nullable columns; centralising the
  // strip here makes the save safe regardless.
  const stripUndef = <T extends Record<string, unknown>>(obj: T): Partial<T> => {
    const out: Partial<T> = {};
    for (const key in obj) if (obj[key] !== undefined) out[key] = obj[key];
    return out;
  };
  if (order.id) {
    // Read the previous status so we can detect a transition (avoids
    // re-draining if the user re-saves an already-done order).
    const previous = assertOkMaybe(
      await supabase.from("orders").select("status").eq("id", order.id).maybeSingle(),
    ) as { status?: OrderStatus } | null;
    const prevStatus = previous?.status;

    const { error } = await supabase
      .from("orders")
      .update(stripUndef({ ...order, updatedAt: now }))
      .eq("id", order.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["orders"] });
    // When the order moves to cancelled, drop every allocation and its
    // linked replenishment order.
    if (order.status === "cancelled") {
      await revertBorrowsForOrder(order.id);
    }
    // When the order ships / is marked done, the Allocated pieces
    // have physically left the Store — drain them permanently so the
    // 4-location dashboard and the shop-stock view reflect reality.
    if (order.status === "done" && prevStatus !== "done") {
      await drainAllocatedForOrder(order.id);
    }
    // Batches are NOT created on order save. They're created only when
    // the operator clicks Regenerate plan on /plan, which consolidates
    // produce-fresh demand across all open orders into one batch per
    // product. See src/lib/order-batch-global-reconciler.ts.
    return order.id;
  }
  const id = newId();
  const { error } = await supabase
    .from("orders")
    .insert(stripUndef({ ...order, id, createdAt: now, updatedAt: now }));
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["orders"] });
  return id;
}

export async function deleteOrder(id: string): Promise<void> {
  // Release any allocated-from-store stock and drop the linked
  // replenishment order before the parent row goes. Without this, the
  // borrowed pieces would stay locked in the allocated location with
  // a dangling orderId.
  await revertBorrowsForOrder(id);

  // Collect plan IDs that this order's items point to BEFORE the
  // cascade deletes them. We'll check each after the order goes, so
  // ghost draft batches (no remaining links) can be cleaned up.
  const items = assertOk(
    await supabase.from("orderItems").select("id").eq("orderId", id),
  ) as Array<{ id: string }>;
  const itemIds = items.map((i) => i.id);
  const impactedPlanIds = new Set<string>();
  if (itemIds.length > 0) {
    const links = assertOk(
      await supabase.from("orderPlanLinks").select("planId").in("orderItemId", itemIds),
    ) as Array<{ planId: string }>;
    for (const l of links) impactedPlanIds.add(l.planId);
  }

  // Cascade-delete the order. orderItems go, and their orderPlanLinks
  // go with them (FK on the links table cascades on orderItemId).
  const { error } = await supabase.from("orders").delete().eq("id", id);
  if (error) throw error;

  // Now sweep the impacted plans. Draft plans with no remaining links
  // are ghost batches pointing at a dead order — delete them outright.
  // Active plans with no remaining links get marked 'orphaned' so the
  // operator can decide (batch already started, physical work done).
  // Done / cancelled plans are left alone (historical record).
  for (const planId of impactedPlanIds) {
    const remaining = assertOk(
      await supabase.from("orderPlanLinks").select("id").eq("planId", planId),
    ) as Array<{ id: string }>;
    if (remaining.length > 0) continue; // still needed by another order
    const plan = assertOkMaybe(
      await supabase.from("productionPlans").select("id, status").eq("id", planId).maybeSingle(),
    ) as { id: string; status: string } | null;
    if (!plan) continue;
    if (plan.status === "draft") {
      const { error: delErr } = await supabase.from("productionPlans").delete().eq("id", planId);
      if (delErr) throw delErr;
    } else if (plan.status === "active") {
      const { error: updErr } = await supabase
        .from("productionPlans")
        .update({ status: "orphaned", updatedAt: new Date() })
        .eq("id", planId);
      if (updErr) throw updErr;
    }
  }

  queryClient.invalidateQueries({ queryKey: ["orders"] });
  queryClient.invalidateQueries({ queryKey: ["order-items"] });
  queryClient.invalidateQueries({ queryKey: ["production-plans"] });
  queryClient.invalidateQueries({ queryKey: ["plan-products"] });
  queryClient.invalidateQueries({ queryKey: ["order-plan-links"] });
  queryClient.invalidateQueries({ queryKey: ["production-day-line-items"] });
}

export async function saveOrderItem(item: Omit<OrderItem, "id"> & { id?: string }): Promise<string> {
  if (item.id) {
    // Pre-read the existing row so we can reconcile allocations when
    // either the fulfilmentMode or the borrowed quantity changes.
    // Without this, flipping a line produce→borrow (or the reverse) or
    // bumping a borrow-line's quantity would leave stockLocations out
    // of sync with the saved line.
    const existing = assertOkMaybe(
      await supabase.from("orderItems").select("*").eq("id", item.id).maybeSingle(),
    ) as OrderItem | null;

    const { error } = await supabase.from("orderItems").update(item).eq("id", item.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["order-items"] });

    if (existing) {
      const wasBorrow = existing.fulfilmentMode === "borrow";
      const isBorrow = (item.fulfilmentMode ?? existing.fulfilmentMode) === "borrow";
      if (wasBorrow && !isBorrow) {
        // borrow → produce: release the whole allocation.
        await deallocateLineToStore({ orderId: item.orderId, productId: item.productId });
      } else if (!wasBorrow && isBorrow) {
        // produce → borrow: pull the new quantity from Store.
        await allocateLineFromStore({
          orderId: item.orderId,
          productId: item.productId,
          quantity: item.quantity,
        });
      } else if (wasBorrow && isBorrow && existing.quantity !== item.quantity) {
        // borrow → borrow with qty change: adjust the allocation delta.
        const delta = item.quantity - existing.quantity;
        if (delta > 0) {
          await allocateLineFromStore({
            orderId: item.orderId,
            productId: item.productId,
            quantity: delta,
          });
        } else if (delta < 0) {
          // Return the over-allocated portion. deallocateLineToStore
          // currently releases the whole line — fall back to a direct
          // FIFO move for partial returns.
          await partialDeallocateFromStore({
            orderId: item.orderId,
            productId: item.productId,
            quantity: -delta,
          });
        }
      }
    }

    await onOrderItemChanged(item.orderId);
    return item.id;
  }
  // Explicit fulfilmentMode is required on every new line. Every
  // caller passes it; there's no silent default.
  if (!item.fulfilmentMode) {
    throw new Error("saveOrderItem: fulfilmentMode is required on new lines");
  }
  const id = newId();
  const mode = item.fulfilmentMode;
  const { error } = await supabase
    .from("orderItems")
    .insert({ ...item, id, fulfilmentMode: mode });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["order-items"] });
  if (mode === "borrow") {
    await allocateLineFromStore({ orderId: item.orderId, productId: item.productId, quantity: item.quantity });
  }
  await onOrderItemChanged(item.orderId);
  return id;
}

export async function deleteOrderItem(id: string): Promise<void> {
  // Read the row first so we can release its allocation, if any.
  const existing = assertOkMaybe(
    await supabase.from("orderItems").select("*").eq("id", id).maybeSingle(),
  ) as OrderItem | null;
  const { error } = await supabase.from("orderItems").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["order-items"] });
  if (existing?.fulfilmentMode === "borrow") {
    await deallocateLineToStore({
      orderId: existing.orderId,
      productId: existing.productId,
    });
    await onOrderItemChanged(existing.orderId);
  } else if (existing) {
    await onOrderItemChanged(existing.orderId);
  }
}

// =====================================================================
// Borrow-from-Store engine
// =====================================================================
//
// Public surface:
//   - allocateLineFromStore / deallocateLineToStore  (low-level)
//   - revertBorrowsForOrder                          (cancel / delete path)
//   - syncReplenishmentOrder                         (keeps the child order
//                                                     in sync with current
//                                                     borrowed lines)
//
// The engine never silently picks a mode: saveOrderItem requires
// fulfilmentMode on every new line. The pure helper decideBorrowStrategy
// in src/lib/borrowDecision.ts can still be used to suggest a mode in
// the UI, but it never fires automatically on save.

/** Un-allocated store pieces available *right now* for this product —
 *  sum of all store stockLocations rows, minus any already-allocated
 *  slots earmarked to other orders for the same product. */
async function computeStoreAvailableFor(productId: string): Promise<number> {
  const batches = assertOk(
    await supabase.from("planProducts").select("id").eq("productId", productId),
  ) as Array<{ id: string }>;
  if (batches.length === 0) return 0;
  const ids = batches.map((b) => b.id);
  const rows = assertOk(
    await supabase
      .from("stockLocations")
      .select("location, quantity, planProductId")
      .in("planProductId", ids)
      .eq("location", "store"),
  ) as Array<{ quantity: number }>;
  return rows.reduce((s, r) => s + (r.quantity ?? 0), 0);
}

async function allocateLineFromStore(args: {
  orderId: string; productId: string; quantity: number;
}): Promise<void> {
  // "Use from stock" means pull from any already-made pieces — Store
  // first (front-of-shop), then Production Storage as fallback. Both
  // count as "available" on the order-create form (see availableFor);
  // allocation must match that promise or the user sees a silent
  // failure where Save reports success but the order has stale
  // unallocated stock.
  //
  // Mechanics: FIFO move from store → allocated first, then top up
  // from production → allocated if still short. If combined still
  // short, revert everything and throw.
  const movedFromStore = await moveProductStockFifo({
    productId: args.productId,
    fromLocation: "store",
    toLocation: "allocated",
    quantity: args.quantity,
    orderId: args.orderId,
    reason: "allocate",
  });
  const storeSum = movedFromStore.reduce((s, m) => s + m.quantity, 0);
  let remaining = args.quantity - storeSum;

  let movedFromProduction: FifoMoveResult[] = [];
  if (remaining > 0) {
    movedFromProduction = await moveProductStockFifo({
      productId: args.productId,
      fromLocation: "production",
      toLocation: "allocated",
      quantity: remaining,
      orderId: args.orderId,
      reason: "allocate",
    });
  }
  const productionSum = movedFromProduction.reduce((s, m) => s + m.quantity, 0);
  const totalMoved = storeSum + productionSum;

  if (totalMoved < args.quantity) {
    // Revert everything we just moved. Keep reverts paired with the
    // location we pulled from so the ledger stays balanced.
    for (const m of movedFromStore) {
      await transferBatchStock({
        planProductId: m.planProductId,
        productId: args.productId,
        fromLocation: "allocated",
        toLocation: "store",
        quantity: m.quantity,
        orderId: args.orderId,
        reason: "allocate",
      });
    }
    for (const m of movedFromProduction) {
      await transferBatchStock({
        planProductId: m.planProductId,
        productId: args.productId,
        fromLocation: "allocated",
        toLocation: "production",
        quantity: m.quantity,
        orderId: args.orderId,
        reason: "allocate",
      });
    }
    throw new Error(
      `Not enough stock to borrow: only ${totalMoved} of ${args.quantity} available (Store + Production). Please re-check stock or switch this line to "Produce fresh".`,
    );
  }
}

async function deallocateLineToStore(args: {
  orderId: string; productId: string;
}): Promise<void> {
  // Find all allocated rows for this order + product, move back to store.
  const batches = assertOk(
    await supabase.from("planProducts").select("id").eq("productId", args.productId),
  ) as Array<{ id: string }>;
  if (batches.length === 0) return;
  const allocated = assertOk(
    await supabase
      .from("stockLocations")
      .select("*")
      .eq("orderId", args.orderId)
      .eq("location", "allocated")
      .in("planProductId", batches.map((b) => b.id)),
  ) as StockLocationRow[];
  for (const row of allocated) {
    await transferBatchStock({
      planProductId: row.planProductId,
      productId: args.productId,
      fromLocation: "allocated",
      toLocation: "store",
      quantity: row.quantity,
      orderId: args.orderId,
      reason: "allocate",
    });
  }
}

/** Return only part of an order+product's allocation back to Store.
 *  Used when a borrow line's quantity is reduced (e.g. customer trims
 *  the order from 20 → 12 — we must release 8 pieces, not all 20).
 *  Walks allocated rows LIFO by quantity and peels pieces off until
 *  the target is met. Caller guarantees `quantity` ≤ total allocated. */
async function partialDeallocateFromStore(args: {
  orderId: string; productId: string; quantity: number;
}): Promise<void> {
  if (args.quantity <= 0) return;
  const batches = assertOk(
    await supabase.from("planProducts").select("id").eq("productId", args.productId),
  ) as Array<{ id: string }>;
  if (batches.length === 0) return;
  const allocated = assertOk(
    await supabase
      .from("stockLocations")
      .select("*")
      .eq("orderId", args.orderId)
      .eq("location", "allocated")
      .in("planProductId", batches.map((b) => b.id)),
  ) as StockLocationRow[];

  let remaining = args.quantity;
  for (const row of allocated) {
    if (remaining <= 0) break;
    const take = Math.min(row.quantity, remaining);
    await transferBatchStock({
      planProductId: row.planProductId,
      productId: args.productId,
      fromLocation: "allocated",
      toLocation: "store",
      quantity: take,
      orderId: args.orderId,
      reason: "allocate",
    });
    remaining -= take;
  }
}

/** Hook called after any orderItem change. Keeps the linked Shop
 *  Replenishment order (channel='shop' + sourceOrderId=parent) in sync
 *  with the current set of borrowed lines. Batches are NOT touched
 *  here — they rebuild only on Regenerate plan. */
async function onOrderItemChanged(orderId: string): Promise<void> {
  const order = assertOkMaybe(
    await supabase.from("orders").select("*").eq("id", orderId).maybeSingle(),
  ) as Order | null;
  if (!order) return;
  // A replenishment order is itself a 'shop' order with sourceOrderId set —
  // we never recursively generate children for children.
  if (order.channel === "shop" && order.sourceOrderId) return;
  await syncReplenishmentOrder(orderId);
  await refreshOrderReadyStatus(orderId);
}

/**
 * Flip order.status between 'pending' and 'ready_to_pack' based on
 * whether every line is fully fulfilled from stock. Does not touch
 * orders in terminal states (in_production / done / cancelled) — those
 * have their own life cycle.
 *
 * "Ready to pack" =
 *   - At least one orderItem exists.
 *   - Every orderItem is fulfilmentMode='borrow' (no production demand).
 *   - Every borrow line has allocated stockLocations rows for this order
 *     summing to ≥ the line quantity (per product).
 *
 * If those conditions stop holding (e.g. an allocation later released),
 * status demotes back to 'pending'.
 */
async function refreshOrderReadyStatus(orderId: string): Promise<void> {
  const order = assertOkMaybe(
    await supabase.from("orders").select("*").eq("id", orderId).maybeSingle(),
  ) as Order | null;
  if (!order) return;
  if (order.status !== "pending" && order.status !== "ready_to_pack") return;

  const items = assertOk(
    await supabase
      .from("orderItems")
      .select("productId, quantity, fulfilmentMode, variantPackagingId")
      .eq("orderId", orderId),
  ) as Array<{ productId: string; quantity: number; fulfilmentMode: string | null; variantPackagingId: string | null }>;

  const allBorrow = items.length > 0
    && items.every((i) => (i.fulfilmentMode ?? "produce") === "borrow");

  let ready = false;
  if (allBorrow) {
    // Variant boxes already reserved against the order cover every
    // derived orderItem whose parent variantPackagingId matches —
    // those lines are physically inside the variant box.
    const variantAllocRows = assertOk(
      await supabase
        .from("variantStockLocations")
        .select("variantPackagingId, quantity")
        .eq("orderId", orderId)
        .eq("location", "allocated"),
    ) as Array<{ variantPackagingId: string; quantity: number }>;
    const variantCovered = new Set<string>();
    for (const r of variantAllocRows) {
      if ((r.quantity ?? 0) > 0) variantCovered.add(r.variantPackagingId);
    }

    // Sum allocated loose stock per product for this order.
    const allocatedRows = assertOk(
      await supabase
        .from("stockLocations")
        .select("planProductId, quantity")
        .eq("orderId", orderId)
        .eq("location", "allocated"),
    ) as Array<{ planProductId: string; quantity: number }>;
    const ppIds = [...new Set(allocatedRows.map((r) => r.planProductId))];
    const pps = ppIds.length > 0
      ? assertOk(
          await supabase
            .from("planProducts")
            .select("id, productId")
            .in("id", ppIds),
        ) as Array<{ id: string; productId: string }>
      : [];
    const productByPp = new Map(pps.map((p) => [p.id, p.productId]));
    const allocatedByProduct = new Map<string, number>();
    for (const row of allocatedRows) {
      const pid = productByPp.get(row.planProductId);
      if (!pid) continue;
      allocatedByProduct.set(pid, (allocatedByProduct.get(pid) ?? 0) + row.quantity);
    }
    // Aggregate requested per product, EXCLUDING items whose parent
    // variantPackagingId is variant-covered (already in a box).
    const requestedByProduct = new Map<string, number>();
    for (const it of items) {
      if (it.variantPackagingId && variantCovered.has(it.variantPackagingId)) continue;
      requestedByProduct.set(
        it.productId,
        (requestedByProduct.get(it.productId) ?? 0) + it.quantity,
      );
    }
    ready = [...requestedByProduct.entries()].every(
      ([pid, qty]) => (allocatedByProduct.get(pid) ?? 0) >= qty,
    );
    // If every line was variant-covered → requestedByProduct is empty
    // → .every returns true → ready = true. Good.
  }

  const nextStatus = ready ? "ready_to_pack" : "pending";
  if (nextStatus === order.status) return;
  const { error } = await supabase
    .from("orders")
    .update({ status: nextStatus, updatedAt: new Date() })
    .eq("id", orderId);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["orders"] });
}

// =====================================================================
// Per-order reconciler (LEGACY — not called automatically).
//
// Was wired into saveOrder + onOrderItemChanged to auto-create batches
// on order save. That behaviour was replaced: batches are now only
// built on Regenerate plan via the global consolidator in
// src/lib/order-batch-global-reconciler.ts, which sums produce-fresh
// demand across every open order into one batch per product.
//
// Kept as an exported helper for manual callers / one-off use; nothing
// in the normal flow invokes it anymore. Safe to delete in a later
// cleanup once no callers remain.
// =====================================================================

export async function reconcileOrderNow(orderId: string): Promise<void> {
  const { reconcileOrderBatches } = await import("@/lib/order-batch-reconciler");

  const order = assertOkMaybe(
    await supabase.from("orders").select("*").eq("id", orderId).maybeSingle(),
  ) as Order | null;
  if (!order) return;

  const allItems = assertOk(
    await supabase.from("orderItems").select("*").eq("orderId", orderId),
  ) as OrderItem[];
  // Reconciler operates on produce lines only; borrow lines are
  // stock-allocated, not produced.
  const produceItems = allItems.filter((i) => (i.fulfilmentMode ?? "produce") === "produce");

  // Existing links attached to any of this order's lines.
  const itemIds = allItems.map((i) => i.id!).filter(Boolean);
  const existingLinks = itemIds.length > 0
    ? assertOk(
        await supabase.from("orderPlanLinks").select("*").in("orderItemId", itemIds),
      ) as OrderPlanLink[]
    : [];

  const existingPlanIds = [...new Set(existingLinks.map((l) => l.planId))];
  const existingPlans = existingPlanIds.length > 0
    ? assertOk(
        await supabase.from("productionPlans").select("*").in("id", existingPlanIds),
      ) as ProductionPlan[]
    : [];
  const existingPlanProducts = existingPlanIds.length > 0
    ? assertOk(
        await supabase.from("planProducts").select("*").in("planId", existingPlanIds),
      ) as PlanProduct[]
    : [];

  // Links from other orders that touch the same plans — tells the
  // reconciler whether a plan is shared and must not be cancelled /
  // orphaned when this order drops its links.
  const otherLinks = existingPlanIds.length > 0
    ? (assertOk(
        await supabase.from("orderPlanLinks").select("*").in("planId", existingPlanIds),
      ) as OrderPlanLink[]).filter((l) => !itemIds.includes(l.orderItemId))
    : [];

  // Products + moulds for every produce line (needed for sizing).
  const productIds = [...new Set(produceItems.map((i) => i.productId))];
  const products = productIds.length > 0
    ? assertOk(
        await supabase.from("products").select("*").in("id", productIds),
      ) as Product[]
    : [];
  const mouldIds = products.map((p) => p.defaultMouldId).filter((x): x is string => !!x);
  const moulds = mouldIds.length > 0
    ? assertOk(
        await supabase.from("moulds").select("*").in("id", mouldIds),
      ) as Mould[]
    : [];

  const availableByProductId = await computeAvailableByProductId(productIds);

  const decision = reconcileOrderBatches({
    order,
    orderItems: produceItems,
    products, moulds,
    existingLinks, existingPlans, existingPlanProducts,
    availableByProductId,
    otherLinks,
  });

  await applyReconcileDecision(decision);
}

/** On-hand pieces for each product, summed across store + production
 *  locations. 'allocated' pieces have already left store (handled by
 *  the borrow engine's move), so no extra subtraction is needed.
 *  'freezer' is excluded — it's preserved stock, not shippable. */
async function computeAvailableByProductId(
  productIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (productIds.length === 0) return out;
  const pps = assertOk(
    await supabase.from("planProducts").select("id, productId").in("productId", productIds),
  ) as Array<{ id: string; productId: string }>;
  if (pps.length === 0) return out;
  const productByPlanProduct = new Map(pps.map((p) => [p.id, p.productId]));

  const rows = assertOk(
    await supabase
      .from("stockLocations")
      .select("planProductId, location, quantity")
      .in("planProductId", pps.map((p) => p.id))
      .in("location", ["store", "production"]),
  ) as Array<{ planProductId: string; location: string; quantity: number }>;

  for (const r of rows) {
    if (!r.quantity || r.quantity <= 0) continue;
    const productId = productByPlanProduct.get(r.planProductId);
    if (!productId) continue;
    out.set(productId, (out.get(productId) ?? 0) + r.quantity);
  }
  return out;
}

async function applyReconcileDecision(
  decision: Awaited<ReturnType<typeof import("@/lib/order-batch-reconciler").reconcileOrderBatches>>,
): Promise<void> {
  const now = new Date();
  let didMutate = false;

  // 1) Insert new plans + planProducts + links (sequential — no
  //    client transaction; order matters because later inserts
  //    depend on earlier IDs).
  for (const newBatch of decision.newBatches) {
    const planId = newId();
    const batchNumber = await generateBatchNumber(now);
    const { error: planError } = await supabase.from("productionPlans").insert({
      id: planId,
      name: newBatch.planName,
      batchNumber,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
    if (planError) throw planError;

    const ppRows = newBatch.planProducts.map((pp, i) => ({
      id: newId(),
      planId,
      productId: pp.productId,
      mouldId: pp.mouldId,
      quantity: pp.quantity,
      sortOrder: i,
    }));
    if (ppRows.length > 0) {
      const { error: ppError } = await supabase.from("planProducts").insert(ppRows);
      if (ppError) throw ppError;
    }

    const linkRows = newBatch.allocations.map((a) => ({
      id: newId(),
      orderItemId: a.orderItemId,
      planId,
      allocatedQuantity: a.allocatedQuantity,
      createdAt: now,
      updatedAt: now,
    }));
    if (linkRows.length > 0) {
      const { error: lkError } = await supabase.from("orderPlanLinks").insert(linkRows);
      if (lkError) throw lkError;
    }
    didMutate = true;
  }

  // 2) Update allocations on existing links.
  for (const upd of decision.linksToUpdate) {
    const { error } = await supabase
      .from("orderPlanLinks")
      .update({ allocatedQuantity: upd.allocatedQuantity, updatedAt: now })
      .eq("id", upd.linkId);
    if (error) throw error;
    didMutate = true;
  }

  // 3) Delete links.
  if (decision.linksToDelete.length > 0) {
    const { error } = await supabase
      .from("orderPlanLinks")
      .delete()
      .in("id", decision.linksToDelete);
    if (error) throw error;
    didMutate = true;
  }

  // 4) Cancel + orphan plans.
  for (const planId of decision.plansToCancel) {
    const { error } = await supabase
      .from("productionPlans")
      .update({ status: "cancelled", updatedAt: now })
      .eq("id", planId);
    if (error) throw error;
    didMutate = true;
  }
  for (const planId of decision.plansToOrphan) {
    const { error } = await supabase
      .from("productionPlans")
      .update({ status: "orphaned", updatedAt: now })
      .eq("id", planId);
    if (error) throw error;
    didMutate = true;
  }

  if (didMutate) {
    queryClient.invalidateQueries({ queryKey: ["production-plans"] });
    queryClient.invalidateQueries({ queryKey: ["plan-products"] });
    queryClient.invalidateQueries({ queryKey: ["order-plan-links"] });
  }
}

// =====================================================================
// Global produce-fresh consolidator — the ONLY path that creates
// batches in the new flow. Called from /plan's Regenerate button.
//
// Walks every open order, skips lines already covered by an active
// batch, consolidates the remaining demand per product into one draft
// batch per product, then applies the diff (insert / update / cancel).
// =====================================================================

export interface RegeneratePlansResult {
  /** Batches created from scratch. */
  createdPlanIds: string[];
  /** Draft batches resized or re-linked. */
  updatedPlanIds: string[];
  /** Draft batches cancelled because their product no longer had demand. */
  cancelledPlanIds: string[];
  warnings: string[];
}

/**
 * Flip every pending order linked to `planId` (via orderItems ↔
 * orderPlanLinks) to 'in_production'. Idempotent — orders that are
 * already in_production / done / cancelled are filtered out by the
 * `status='pending'` clause, so re-calling is harmless.
 *
 * Called when a draft batch first transitions to 'active' — either
 * via the Start production button or by ticking the first step on the
 * batch page. Regenerate itself does NOT call this; scheduling and
 * starting work are separate user actions.
 */
export async function promoteOrdersForPlan(planId: string): Promise<void> {
  const links = assertOk(
    await supabase
      .from("orderPlanLinks")
      .select("orderItemId")
      .eq("planId", planId),
  ) as Array<{ orderItemId: string }>;
  if (links.length === 0) return;
  const itemIds = [...new Set(links.map((l) => l.orderItemId))];
  const items = assertOk(
    await supabase
      .from("orderItems")
      .select("orderId")
      .in("id", itemIds),
  ) as Array<{ orderId: string }>;
  const orderIds = [...new Set(items.map((i) => i.orderId))];
  if (orderIds.length === 0) return;
  const { error } = await supabase
    .from("orders")
    .update({ status: "in_production", updatedAt: new Date() })
    .in("id", orderIds)
    .eq("status", "pending");
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["orders"] });
}

/**
 * Start production on a draft batch without ticking any step. Flips
 * the plan from 'draft' → 'active' and promotes every pending order
 * linked to it. No-op if the plan is already active/done/cancelled.
 *
 * Used by the "Start production" button on the batch page for when the
 * operator wants to lock in that the batch is the one that'll fulfil
 * the order (so consolidating Regenerate runs stop touching it) even
 * before any physical work has begun.
 */
export async function startProductionPlan(planId: string): Promise<void> {
  const { error } = await supabase
    .from("productionPlans")
    .update({ status: "active", updatedAt: new Date() })
    .eq("id", planId)
    .eq("status", "draft");
  if (error) throw error;
  await promoteOrdersForPlan(planId);
  queryClient.invalidateQueries({ queryKey: ["production-plans"] });
}

export async function regenerateAllProductionPlans(): Promise<RegeneratePlansResult> {
  const { reconcileGlobalProduceDemand } = await import("@/lib/order-batch-global-reconciler");

  // 1) Read current state.
  const openOrders = (assertOk(
    await supabase.from("orders").select("*").in("status", ["pending", "in_production"]),
  ) as Order[]);
  const openOrderIds = openOrders.map((o) => o.id!);
  const openItems = openOrderIds.length > 0
    ? assertOk(
        await supabase.from("orderItems").select("*").in("orderId", openOrderIds),
      ) as OrderItem[]
    : [];
  const plans = assertOk(
    await supabase.from("productionPlans").select("*"),
  ) as ProductionPlan[];
  const planProducts = assertOk(
    await supabase.from("planProducts").select("*"),
  ) as PlanProduct[];
  const links = assertOk(
    await supabase.from("orderPlanLinks").select("*"),
  ) as OrderPlanLink[];

  const productIds = [...new Set(openItems.map((i) => i.productId))];
  const products = productIds.length > 0
    ? assertOk(
        await supabase.from("products").select("*").in("id", productIds),
      ) as Product[]
    : [];
  const mouldIds = products
    .map((p) => p.defaultMouldId)
    .filter((x): x is string => !!x);
  const moulds = mouldIds.length > 0
    ? assertOk(
        await supabase.from("moulds").select("*").in("id", mouldIds),
      ) as Mould[]
    : [];

  // 2) Run the pure consolidator.
  const decision = reconcileGlobalProduceDemand({
    openOrders, openOrderItems: openItems, products, moulds,
    plans, planProducts, links,
  });

  // 3) Apply the diff. Order matters: cancel first (frees up plan
  //    rows), then update existing drafts, then insert new ones. Links
  //    are batched where possible.
  const now = new Date();
  const result: RegeneratePlansResult = {
    createdPlanIds: [], updatedPlanIds: [], cancelledPlanIds: [],
    warnings: decision.warnings,
  };

  if (decision.linksToDelete.length > 0) {
    const { error } = await supabase
      .from("orderPlanLinks")
      .delete()
      .in("id", decision.linksToDelete);
    if (error) throw error;
  }
  for (const planId of decision.plansToCancel) {
    const { error } = await supabase
      .from("productionPlans")
      .update({ status: "cancelled", updatedAt: now })
      .eq("id", planId);
    if (error) throw error;
    result.cancelledPlanIds.push(planId);
  }
  // Hard-delete the legacy "— packing" drafts that the reconciler
  // flagged. Cascades planProducts + orderPlanLinks + lineItems. We
  // don't preserve history for these because the concept itself is
  // gone — borrow-line packing is an order-level fulfilment now.
  if (decision.plansToDelete.length > 0) {
    const { error } = await supabase
      .from("productionPlans")
      .delete()
      .in("id", decision.plansToDelete);
    if (error) throw error;
  }
  for (const upd of decision.updateBatches) {
    // Resize the single planProduct + insert replacement links.
    //
    // Wipe every existing orderPlanLink for this plan first so the
    // fresh `upd.allocations` rows don't collide with the prior set
    // on the (orderItemId, planId) unique constraint. Earlier we
    // relied on `decision.linksToDelete` to clear them upstream, but
    // when the reconciler re-emitted an allocation for an item still
    // in the old set the regenerate crashed with 23505. Deleting
    // here is idempotent and safe — the very next step rewrites them.
    const { error: ppError } = await supabase
      .from("planProducts")
      .update({ quantity: upd.moulds })
      .eq("id", upd.planProductId);
    if (ppError) throw ppError;
    // Refresh the plan name when the split shape changed: the cluster
    // may have grown into multiple sub-batches (or shrunk back to one),
    // and the existing draft's name needs to reflect its new role.
    const baseName = `${upd.productName} — consolidated`;
    const newName = upd.splitIndex && upd.splitTotal
      ? `${baseName} · ${upd.splitIndex}/${upd.splitTotal}`
      : baseName;
    const { error: planNameErr } = await supabase
      .from("productionPlans")
      .update({ name: newName, updatedAt: now })
      .eq("id", upd.planId);
    if (planNameErr) throw planNameErr;
    const { error: delLinksErr } = await supabase
      .from("orderPlanLinks")
      .delete()
      .eq("planId", upd.planId);
    if (delLinksErr) throw delLinksErr;
    // Coalesce duplicate (orderItemId, planId) rows in the incoming
    // allocations by summing allocatedQuantity. Defensive against the
    // reconciler emitting two allocations for the same orderItem on
    // the same updateBatch.
    const mergedAllocs = new Map<string, number>();
    for (const a of upd.allocations) {
      mergedAllocs.set(a.orderItemId, (mergedAllocs.get(a.orderItemId) ?? 0) + a.allocatedQuantity);
    }
    const linkRows = [...mergedAllocs.entries()].map(([orderItemId, allocatedQuantity]) => ({
      id: newId(),
      orderItemId,
      planId: upd.planId,
      allocatedQuantity,
      createdAt: now,
      updatedAt: now,
    }));
    if (linkRows.length > 0) {
      const { error: lkError } = await supabase.from("orderPlanLinks").insert(linkRows);
      if (lkError) throw lkError;
    }
    result.updatedPlanIds.push(upd.planId);
  }
  for (const b of decision.newBatches) {
    const planId = newId();
    const batchNumber = await generateBatchNumber(now);
    // Packing-only batches get the "— packing" suffix so the scheduler
    // (and later the UI) can distinguish them from produce batches.
    const nameSuffix = b.kind === "packing" ? "— packing" : "— consolidated";
    // Sub-batches from a mould-cap split get the "· i/t" tail so the
    // chocolatier sees "round 1 of 2" / "round 2 of 2" as separate
    // tickable rows.
    const splitTail = b.splitIndex && b.splitTotal ? ` · ${b.splitIndex}/${b.splitTotal}` : "";
    const { error: planError } = await supabase.from("productionPlans").insert({
      id: planId,
      name: `${b.productName} ${nameSuffix}${splitTail}`,
      batchNumber,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
    if (planError) throw planError;
    const { error: ppError } = await supabase.from("planProducts").insert({
      id: newId(),
      planId,
      productId: b.productId,
      mouldId: b.mouldId,
      quantity: b.moulds,
      sortOrder: 0,
    });
    if (ppError) throw ppError;
    // Coalesce duplicate orderItemIds in the new batch's allocations
    // — same defensive logic as the updateBatches path; without it
    // the reconciler emitting the same item twice would trip the
    // (orderItemId, planId) unique constraint.
    const mergedAllocs = new Map<string, number>();
    for (const a of b.allocations) {
      mergedAllocs.set(a.orderItemId, (mergedAllocs.get(a.orderItemId) ?? 0) + a.allocatedQuantity);
    }
    const linkRows = [...mergedAllocs.entries()].map(([orderItemId, allocatedQuantity]) => ({
      id: newId(),
      orderItemId,
      planId,
      allocatedQuantity,
      createdAt: now,
      updatedAt: now,
    }));
    if (linkRows.length > 0) {
      const { error: lkError } = await supabase.from("orderPlanLinks").insert(linkRows);
      if (lkError) throw lkError;
    }
    result.createdPlanIds.push(planId);
  }

  // 4) Invalidate queries so the UI re-reads.
  queryClient.invalidateQueries({ queryKey: ["production-plans"] });
  queryClient.invalidateQueries({ queryKey: ["plan-products"] });
  queryClient.invalidateQueries({ queryKey: ["order-plan-links"] });

  return result;
}

/**
 * End-to-end regenerate: rebuild draft batches from current order
 * demand, then run the scheduler over the full post-reconcile plan
 * state, then replace the productionSchedule rows. Done server-side
 * (DB reads, not hook state) so the schedule sees the batches this
 * regenerate just created, not the pre-reconcile cache.
 */
/** Materialise campaign-target demand into draft `productionPlans`
 *  rows so the legacy /plan view + dashboard see them. One draft
 *  plan per (campaign, product) — quantity in moulds derived from
 *  product cavities. Skips combos that already have a draft / active
 *  campaign plan. Returns warnings (missing mould, missing product,
 *  etc.) to surface in the regenerate banner. */
async function seedCampaignDrivenPlans(): Promise<{ warnings: string[]; deadlineByPlanId: Map<string, number> }> {
  const warnings: string[] = [];
  const deadlineByPlanId = new Map<string, number>();
  const todayIso = new Date().toISOString().slice(0, 10);

  // Pull every campaign that's still meant to run — planned or
  // active. Past-deadline ones are still scheduled (ASAP) so the user
  // sees a batch + warning instead of silent skip. Done / cancelled
  // are excluded.
  const campaigns = assertOk(
    await supabase
      .from("campaigns")
      .select("*")
      .in("status", ["planned", "active"]),
  ) as Campaign[];
  if (campaigns.length === 0) return { warnings, deadlineByPlanId };
  for (const c of campaigns) {
    // Campaign deadline = startDate (when products must be ready).
    if (c.startDate && c.startDate < todayIso) {
      warnings.push(`Campaign "${c.name}" start date (${c.startDate}) has passed — scheduling ASAP.`);
    }
  }

  const interestingProductIds = new Set<string>();
  for (const c of campaigns) {
    for (const pid of Object.keys(c.productTargets ?? {})) interestingProductIds.add(pid);
  }
  if (interestingProductIds.size === 0) return { warnings, deadlineByPlanId };

  const products = assertOk(
    await supabase.from("products").select("*").in("id", [...interestingProductIds]),
  ) as Product[];
  const productById = new Map(products.map((p) => [p.id!, p]));

  const mouldIds = products.map((p) => p.defaultMouldId).filter((x): x is string => !!x);
  const moulds = mouldIds.length > 0
    ? assertOk(await supabase.from("moulds").select("*").in("id", mouldIds)) as Mould[]
    : [];
  const mouldById = new Map(moulds.map((m) => [m.id!, m]));

  const existingPlans = assertOk(
    await supabase.from("productionPlans").select("*").in("status", ["draft", "active"]),
  ) as ProductionPlan[];
  const existingPP = assertOk(
    await supabase.from("planProducts").select("*"),
  ) as PlanProduct[];
  const planById = new Map(existingPlans.map((p) => [p.id!, p]));

  // Pre-load (campaignId, productId) → productionOrderItem.id so each
  // freshly-inserted plan also gets a poPlanLinks row (mig 0097 fixed
  // the missing-link bug; this is the going-forward write).
  const campaignIds = campaigns.map((c) => c.id!).filter(Boolean);
  const campaignPos = campaignIds.length > 0
    ? assertOk(
        await supabase
          .from("productionOrders")
          .select("id, campaignId")
          .in("campaignId", campaignIds),
      ) as Array<{ id: string; campaignId: string }>
    : [];
  const poIdsForCampaigns = campaignPos.map((p) => p.id);
  const poItemsForCampaigns = poIdsForCampaigns.length > 0
    ? assertOk(
        await supabase
          .from("productionOrderItems")
          .select("id, productionOrderId, productId")
          .in("productionOrderId", poIdsForCampaigns),
      ) as Array<{ id: string; productionOrderId: string; productId: string }>
    : [];
  const campaignByPoId = new Map(campaignPos.map((p) => [p.id, p.campaignId]));
  const poItemByCampaignProduct = new Map<string, string>();
  for (const item of poItemsForCampaigns) {
    const cId = campaignByPoId.get(item.productionOrderId);
    if (!cId) continue;
    const key = `${cId}|${item.productId}`;
    if (!poItemByCampaignProduct.has(key)) {
      poItemByCampaignProduct.set(key, item.id);
    }
  }

  const now = new Date();

  for (const c of campaigns) {
    const targets = c.productTargets ?? {};
    for (const [productId, units] of Object.entries(targets)) {
      if (!units || units <= 0) continue;
      const product = productById.get(productId);
      if (!product) {
        warnings.push(`Campaign "${c.name}" references unknown product ${productId} — skipped.`);
        continue;
      }
      if (!product.defaultMouldId) {
        warnings.push(`"${product.name}" in campaign "${c.name}" has no default mould — set one to schedule.`);
        continue;
      }
      const mould = mouldById.get(product.defaultMouldId);
      if (!mould) {
        warnings.push(`Mould missing for "${product.name}" in campaign "${c.name}" — skipped.`);
        continue;
      }
      const namePattern = `Campaign: ${c.name} — ${product.name}`;
      // Match the base name OR any split sub-batch ("· 1/2") so a re-run
      // doesn't double-create plans for the same campaign+product pair.
      const existing = existingPlans.find(
        (p) => p.name === namePattern || (p.name ?? "").startsWith(namePattern + " · "),
      );
      // Anchor at local noon — using end-of-day shifts to next-day in
      // some timezones once the scheduler converts back to ISO date,
      // landing batches on the day AFTER the launch.
      // Campaigns: production must be READY by the campaign's start
      // date, not its end date. End is when the campaign closes (last
      // market day, last sale day, etc) — products need to exist on
      // shelves before that. Fall back to endDate only if startDate
      // somehow missing on a legacy row.
      const deadlineDate = c.startDate ?? c.endDate;
      const campaignDeadlineMs = deadlineDate ? new Date(deadlineDate + "T12:00:00").getTime() : null;
      if (existing) {
        // Already created on a previous Regenerate — still record the
        // deadline so the scheduler can reverse-place this batch.
        if (campaignDeadlineMs != null && existing.id) {
          deadlineByPlanId.set(existing.id, campaignDeadlineMs);
        }
        continue;
      }

      const cavities = mould.numberOfCavities ?? 1;
      const totalMoulds = Math.max(1, Math.ceil(units / cavities));
      // Cap mould-fills per plan at the chocolatier's owned mould count,
      // so a campaign needing more pieces than fit in one round splits
      // into sequential sub-batches the daily checklist can tick off
      // independently. quantityOwned 0/null = no cap (legacy behaviour).
      const cap = mould.quantityOwned && mould.quantityOwned > 0 ? mould.quantityOwned : totalMoulds;
      const splitTotal = Math.ceil(totalMoulds / cap);
      const chunks: number[] = [];
      let left = totalMoulds;
      while (left > 0) {
        const take = Math.min(cap, left);
        chunks.push(take);
        left -= take;
      }

      for (let idx = 0; idx < chunks.length; idx++) {
        const chunkMoulds = chunks[idx];
        const splitTail = splitTotal > 1 ? ` · ${idx + 1}/${splitTotal}` : "";
        const planName = namePattern + splitTail;
        const planId = newId();
        const batchNumber = await generateBatchNumber(now);
        const { error: planErr } = await supabase.from("productionPlans").insert({
          id: planId,
          name: planName,
          batchNumber,
          status: "draft",
          sourceOrderId: null,
          createdAt: now,
          updatedAt: now,
        });
        if (planErr) {
          warnings.push(`Could not create campaign plan for ${product.name}: ${planErr.message}`);
          continue;
        }
        const { error: ppErr } = await supabase.from("planProducts").insert({
          id: newId(),
          planId,
          productId,
          mouldId: product.defaultMouldId,
          quantity: chunkMoulds,
          sortOrder: 0,
        });
        if (ppErr) {
          warnings.push(`Could not link campaign plan products: ${ppErr.message}`);
          continue;
        }
        existingPlans.push({
          id: planId, name: planName, batchNumber, status: "draft",
          createdAt: now, updatedAt: now,
        } as ProductionPlan);
        planById.set(planId, existingPlans[existingPlans.length - 1]);
        existingPP.push({ id: newId(), planId, productId, mouldId: product.defaultMouldId, quantity: chunkMoulds, sortOrder: 0 } as PlanProduct);
        if (campaignDeadlineMs != null) {
          deadlineByPlanId.set(planId, campaignDeadlineMs);
        }

        // Going-forward poPlanLinks write per spec PO_PLAN_LINKS_BACKFILL_BATCH.md §2.1.
        // chunkMoulds × cavities = this slice's expected output.
        const poItemId = c.id ? poItemByCampaignProduct.get(`${c.id}|${productId}`) : null;
        if (poItemId) {
          await upsertPoPlanLinkSafe({
            planId,
            productionOrderItemId: poItemId,
            allocatedQuantity: chunkMoulds * cavities,
            warnings,
          });
        } else {
          warnings.push(
            `No productionOrderItem for "${product.name}" in campaign "${c.name}" — poPlanLink skipped.`,
          );
        }
      }
    }
  }

  return { warnings, deadlineByPlanId };
}

/**
 * Idempotent poPlanLinks upsert used by the campaign + PO seeders
 * (PO_PLAN_LINKS_BACKFILL_BATCH.md §2.3). Select first to dodge a
 * unique-constraint race, then either UPDATE allocatedQuantity if the
 * recomputed chunk size changed, or INSERT a fresh row. Defensive —
 * any error appends to the warnings list and returns; the seeder loop
 * keeps going.
 */
async function upsertPoPlanLinkSafe(args: {
  planId: string;
  productionOrderItemId: string;
  allocatedQuantity: number;
  warnings: string[];
}): Promise<void> {
  try {
    const existing = assertOkMaybe(
      await supabase
        .from("poPlanLinks")
        .select("id, allocatedQuantity")
        .eq("planId", args.planId)
        .eq("productionOrderItemId", args.productionOrderItemId)
        .maybeSingle(),
    ) as { id: string; allocatedQuantity: number } | null;
    if (existing) {
      if (existing.allocatedQuantity !== args.allocatedQuantity) {
        const { error } = await supabase
          .from("poPlanLinks")
          .update({ allocatedQuantity: args.allocatedQuantity, updatedAt: new Date() })
          .eq("id", existing.id);
        if (error) args.warnings.push(`poPlanLink update failed: ${error.message}`);
      }
      return;
    }
    const { error } = await supabase.from("poPlanLinks").insert({
      id: newId(),
      planId: args.planId,
      productionOrderItemId: args.productionOrderItemId,
      allocatedQuantity: args.allocatedQuantity,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    if (error) args.warnings.push(`poPlanLink insert failed: ${error.message}`);
  } catch (e) {
    args.warnings.push(`poPlanLink upsert raised: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Materialise low-stock-vs-minimum gaps into draft plans. Reads
 *  every (product, location) row from `stockLocationMinimums`, sums
 *  current pieces at that location from `productStock`, and creates
 *  a draft plan when current < minimum. Skips when a replen plan
 *  for that combo already exists. Mirrors `seedCampaignDrivenPlans`
 *  but for the location-minimum signal. */
/** Materialise pending `productionOrders` into draft batches. Each
 *  productionOrderItem becomes one draft plan named
 *  `PO: {orderName} — {productName}`. The PO's dueDate becomes the
 *  scheduler deadline so reverse-placement works the same as for
 *  campaigns. Skips POs that are done/cancelled and items already
 *  scheduled (matched by plan name). */
async function seedProductionOrderDrivenPlans(): Promise<{ warnings: string[]; deadlineByPlanId: Map<string, number> }> {
  const warnings: string[] = [];
  const deadlineByPlanId = new Map<string, number>();

  const pos = assertOk(
    await supabase
      .from("productionOrders")
      .select("*")
      .in("status", ["pending", "in_production"]),
  ) as ProductionOrder[];
  if (pos.length === 0) return { warnings, deadlineByPlanId };

  const poItems = assertOk(
    await supabase.from("productionOrderItems").select("*"),
  ) as ProductionOrderItem[];
  const itemsByOrder = new Map<string, ProductionOrderItem[]>();
  for (const it of poItems) {
    const arr = itemsByOrder.get(it.productionOrderId) ?? [];
    arr.push(it);
    itemsByOrder.set(it.productionOrderId, arr);
  }

  const productIds = [...new Set(poItems.map((i) => i.productId))];
  const products = productIds.length > 0
    ? assertOk(await supabase.from("products").select("*").in("id", productIds)) as Product[]
    : [];
  const productById = new Map(products.map((p) => [p.id!, p]));
  const mouldIds = products.map((p) => p.defaultMouldId).filter((x): x is string => !!x);
  const moulds = mouldIds.length > 0
    ? assertOk(await supabase.from("moulds").select("*").in("id", mouldIds)) as Mould[]
    : [];
  const mouldById = new Map(moulds.map((m) => [m.id!, m]));

  const existingPlans = assertOk(
    await supabase.from("productionPlans").select("*").in("status", ["draft", "active"]),
  ) as ProductionPlan[];

  const now = new Date();
  for (const po of pos) {
    const items = itemsByOrder.get(po.id!) ?? [];
    if (items.length === 0) continue;
    const dueMs = po.dueDate ? new Date(po.dueDate + "T12:00:00").getTime() : null;
    for (const it of items) {
      const product = productById.get(it.productId);
      if (!product) {
        warnings.push(`PO "${po.name ?? po.dueDate}" references unknown product — skipped.`);
        continue;
      }
      if (!product.defaultMouldId) {
        warnings.push(`"${product.name}" in PO "${po.name ?? po.dueDate}" has no default mould — set one.`);
        continue;
      }
      const mould = mouldById.get(product.defaultMouldId);
      if (!mould) continue;
      const namePattern = `PO: ${po.name ?? po.dueDate} — ${product.name}`;
      const existing = existingPlans.find(
        (p) => p.name === namePattern || (p.name ?? "").startsWith(namePattern + " · "),
      );
      if (existing) {
        if (dueMs != null && existing.id) deadlineByPlanId.set(existing.id, dueMs);
        continue;
      }
      const cavities = mould.numberOfCavities ?? 1;
      const totalMoulds = Math.max(1, Math.ceil(it.targetUnits / cavities));
      // Same mould-cap split as the campaign seeder — keeps each plan
      // within one round of the chocolatier's physical mould count.
      const cap = mould.quantityOwned && mould.quantityOwned > 0 ? mould.quantityOwned : totalMoulds;
      const splitTotal = Math.ceil(totalMoulds / cap);
      const chunks: number[] = [];
      let left = totalMoulds;
      while (left > 0) {
        const take = Math.min(cap, left);
        chunks.push(take);
        left -= take;
      }
      for (let idx = 0; idx < chunks.length; idx++) {
        const chunkMoulds = chunks[idx];
        const splitTail = splitTotal > 1 ? ` · ${idx + 1}/${splitTotal}` : "";
        const planName = namePattern + splitTail;
        const planId = newId();
        const batchNumber = await generateBatchNumber(now);
        const { error: planErr } = await supabase.from("productionPlans").insert({
          id: planId,
          name: planName,
          batchNumber,
          status: "draft",
          sourceOrderId: null,
          createdAt: now,
          updatedAt: now,
        });
        if (planErr) { warnings.push(`Could not create plan for ${product.name}: ${planErr.message}`); continue; }
        const { error: ppErr } = await supabase.from("planProducts").insert({
          id: newId(),
          planId,
          productId: it.productId,
          mouldId: product.defaultMouldId,
          quantity: chunkMoulds,
          sortOrder: 0,
        });
        if (ppErr) { warnings.push(`Could not link plan products: ${ppErr.message}`); continue; }
        existingPlans.push({
          id: planId, name: planName, batchNumber, status: "draft",
          createdAt: now, updatedAt: now,
        } as ProductionPlan);
        if (dueMs != null) deadlineByPlanId.set(planId, dueMs);

        // Going-forward poPlanLinks write per spec PO_PLAN_LINKS_BACKFILL_BATCH.md §2.2.
        // `it` is the productionOrderItems row we're materialising — link
        // directly to its id with the chunk's expected output as the
        // allocated quantity.
        if (it.id) {
          await upsertPoPlanLinkSafe({
            planId,
            productionOrderItemId: it.id,
            allocatedQuantity: chunkMoulds * cavities,
            warnings,
          });
        } else {
          warnings.push(
            `productionOrderItem for "${product.name}" has no id — poPlanLink skipped (unexpected DB state).`,
          );
        }
      }
    }
  }
  return { warnings, deadlineByPlanId };
}

/**
 * Update planProducts.mouldId to match products.defaultMouldId for
 * draft plans. Plans cache the mould at creation time, so a later
 * mould change on the product doesn't propagate. The daily view's
 * capacity math reads planProducts.mouldId × moulds.numberOfCavities,
 * so the wrong mould silently shows the wrong cavity count.
 *
 * Active / done plans are left alone — those are mid-run and must
 * not move.
 */
async function syncDraftPlanMoulds(): Promise<void> {
  const draftPlans = assertOk(
    await supabase
      .from("productionPlans")
      .select("id")
      .eq("status", "draft"),
  ) as Array<{ id: string }>;
  if (draftPlans.length === 0) return;

  const draftPlanIds = draftPlans.map((p) => p.id);
  const pps = assertOk(
    await supabase
      .from("planProducts")
      .select("id, planId, productId, mouldId")
      .in("planId", draftPlanIds),
  ) as Array<{ id: string; planId: string; productId: string; mouldId: string }>;
  if (pps.length === 0) return;

  const productIds = [...new Set(pps.map((p) => p.productId))];
  const products = assertOk(
    await supabase
      .from("products")
      .select("id, defaultMouldId")
      .in("id", productIds),
  ) as Array<{ id: string; defaultMouldId: string | null }>;
  const defaultMouldByProduct = new Map(products.map((p) => [p.id, p.defaultMouldId]));

  const updates: Array<{ id: string; mouldId: string }> = [];
  for (const pp of pps) {
    const want = defaultMouldByProduct.get(pp.productId);
    if (!want) continue; // product has no default mould — leave existing alone
    if (pp.mouldId === want) continue;
    updates.push({ id: pp.id, mouldId: want });
  }
  if (updates.length === 0) return;

  for (const u of updates) {
    await supabase
      .from("planProducts")
      .update({ mouldId: u.mouldId })
      .eq("id", u.id);
  }
  console.log(`[regen] synced mouldId on ${updates.length} draft planProduct row(s)`);
}

/**
 * Drop replen PO items + plans whose product no longer has an active
 * `stockLocationMinimums` row. Without this step, deleting a min via
 * /stock left the original Replen PO item + draft plan in place — the
 * existing zombie sweep keyed off the parent PO **name**, which still
 * exists if other products in the same daily bucket still have mins.
 *
 * Skips items whose plan is already in flight (active, or any planStepStatus
 * row done). Those get to finish; future regens won't re-create them.
 */
async function dropStaleReplenItemsAndPlans(): Promise<void> {
  const mins = assertOk(
    await supabase.from("stockLocationMinimums").select("productId, location, minimumUnits"),
  ) as Array<{ productId: string; location: string; minimumUnits: number }>;
  const productsWithMin = new Set(
    mins.filter((m) => (m.minimumUnits ?? 0) > 0).map((m) => m.productId),
  );

  const replenPos = assertOk(
    await supabase
      .from("productionOrders")
      .select("id, name, status")
      .eq("channel", "restock")
      .ilike("name", "Replen ·%")
      .in("status", ["pending", "in_production"]),
  ) as Array<{ id: string; name: string; status: string }>;
  if (replenPos.length === 0) return;

  const poIds = replenPos.map((p) => p.id);
  const items = assertOk(
    await supabase
      .from("productionOrderItems")
      .select("id, productionOrderId, productId")
      .in("productionOrderId", poIds),
  ) as Array<{ id: string; productionOrderId: string; productId: string }>;

  // Compute current unallocated stock per (product, location) so we can
  // tell whether an open replen item is still needed. An item is
  // "satisfied" when summed (min - current) across every (product, *)
  // min row drops to ≤ 0 — i.e. operator topped up the shop manually
  // since the replen was seeded.
  const stockRows = assertOk(
    await supabase
      .from("stockLocations")
      .select("planProductId, location, quantity")
      .is("orderId", null)
      .is("productionOrderId", null),
  ) as Array<{ planProductId: string; location: string; quantity: number }>;
  const allPlanProducts = assertOk(
    await supabase.from("planProducts").select("id, productId"),
  ) as Array<{ id: string; productId: string }>;
  const ppToProduct = new Map(allPlanProducts.map((pp) => [pp.id, pp.productId]));
  const stockByProductLocation = new Map<string, number>();
  for (const r of stockRows) {
    const pid = ppToProduct.get(r.planProductId);
    if (!pid) continue;
    const key = `${pid}|${r.location}`;
    stockByProductLocation.set(key, (stockByProductLocation.get(key) ?? 0) + (r.quantity ?? 0));
  }
  const productsSatisfied = new Set<string>();
  for (const pid of productsWithMin) {
    const productMins = mins.filter((m) => m.productId === pid && (m.minimumUnits ?? 0) > 0);
    let totalGap = 0;
    for (const m of productMins) {
      const cur = stockByProductLocation.get(`${pid}|${m.location}`) ?? 0;
      totalGap += Math.max(0, (m.minimumUnits ?? 0) - cur);
    }
    if (totalGap === 0) productsSatisfied.add(pid);
  }

  // Stale = product has no active min OR product's mins are now fully covered.
  const staleItems = items.filter(
    (it) => !productsWithMin.has(it.productId) || productsSatisfied.has(it.productId),
  );
  if (staleItems.length === 0) return;

  const poById = new Map(replenPos.map((p) => [p.id, p]));

  const replenPlans = assertOk(
    await supabase
      .from("productionPlans")
      .select("id, name, status")
      .ilike("name", "PO: Replen ·%")
      .in("status", ["draft", "active"]),
  ) as Array<{ id: string; name: string; status: string }>;
  const replenPlanIds = replenPlans.map((p) => p.id);
  const ppRows = replenPlanIds.length > 0
    ? assertOk(
        await supabase
          .from("planProducts")
          .select("planId, productId")
          .in("planId", replenPlanIds),
      ) as Array<{ planId: string; productId: string }>
    : [];
  const productByPlan = new Map<string, string>();
  for (const r of ppRows) productByPlan.set(r.planId, r.productId);

  // A plan is "in flight" if its status is active OR any **per-pp** step
  // key is done. Bare keys like `polishing` / `shell` (no `-` suffix) are
  // legacy plan-wide markers from before the per-pp model and don't count
  // as in-flight — without this, an old plan whose user once ticked the
  // legacy bare keys is forever undeletable even after the underlying
  // demand has been removed.
  const startedPlanIds = new Set<string>();
  if (replenPlanIds.length > 0) {
    const stepDone = assertOk(
      await supabase.from("planStepStatus")
        .select("planId, stepKey, done")
        .in("planId", replenPlanIds),
    ) as Array<{ planId: string; stepKey: string; done: boolean }>;
    for (const s of stepDone) {
      if (!s.done) continue;
      // Per-pp step keys all contain a hyphen (e.g. `polishing-<ppId>`,
      // `colour-<ppId>-<idx>`, `filling-<ppId>-mould-<n>`). Bare-word keys
      // are pre-per-pp legacy.
      if (!s.stepKey || !s.stepKey.includes("-")) continue;
      startedPlanIds.add(s.planId);
    }
    for (const p of replenPlans) if (p.status === "active") startedPlanIds.add(p.id);
  }

  // Pass 1 — items whose product no longer has a min: delete the item
  // and cancel its linked plan (when one exists and isn't in flight).
  const itemsToDelete: string[] = [];
  const plansToCancel = new Set<string>();
  for (const it of staleItems) {
    const poName = poById.get(it.productionOrderId)?.name;
    if (!poName) continue;
    const namePrefix = `PO: ${poName} — `;
    const matchingPlans = replenPlans.filter(
      (pl) => pl.name.startsWith(namePrefix) && productByPlan.get(pl.id) === it.productId,
    );
    if (matchingPlans.some((pl) => startedPlanIds.has(pl.id))) continue;
    itemsToDelete.push(it.id);
    for (const pl of matchingPlans) plansToCancel.add(pl.id);
  }

  // Pass 2 — replen plans that are orphans because their PO item was
  // already deleted (e.g. by an earlier cleanup, manual delete, or
  // legacy code path). Detection: plan's planProducts.productId not
  // present in any item of the parent PO whose name matches the plan
  // name's prefix. Same in-flight guard.
  const itemsByPo = new Map<string, Array<{ productId: string }>>();
  for (const it of items) {
    const arr = itemsByPo.get(it.productionOrderId) ?? [];
    arr.push({ productId: it.productId });
    itemsByPo.set(it.productionOrderId, arr);
  }
  const poByName = new Map(replenPos.map((p) => [p.name, p]));
  for (const pl of replenPlans) {
    if (startedPlanIds.has(pl.id)) continue;
    if (plansToCancel.has(pl.id)) continue;
    if (!pl.name.startsWith("PO: ")) continue;
    const rest = pl.name.slice("PO: ".length);
    const dash = rest.indexOf(" — ");
    if (dash < 0) continue;
    const parentName = rest.slice(0, dash);
    const parent = poByName.get(parentName);
    if (!parent) continue; // existing zombie sweep handles missing parent
    const planProductId = productByPlan.get(pl.id);
    if (!planProductId) {
      // No planProducts row at all — definite orphan, cancel.
      plansToCancel.add(pl.id);
      continue;
    }
    const itemsOnParent = itemsByPo.get(parent.id) ?? [];
    if (!itemsOnParent.some((it) => it.productId === planProductId)) {
      plansToCancel.add(pl.id);
    }
  }

  const CHUNK = 100;
  for (let i = 0; i < itemsToDelete.length; i += CHUNK) {
    const slice = itemsToDelete.slice(i, i + CHUNK);
    await supabase.from("productionOrderItems").delete().in("id", slice);
  }
  const cancelIds = [...plansToCancel];
  for (let i = 0; i < cancelIds.length; i += CHUNK) {
    const slice = cancelIds.slice(i, i + CHUNK);
    await supabase
      .from("productionPlans")
      .update({ status: "cancelled", updatedAt: new Date() })
      .in("id", slice);
  }
  console.log(
    `[regen] dropped ${itemsToDelete.length} stale replen item(s); cancelled ${cancelIds.length} plan(s)`,
  );
}

/**
 * Replenishment seeder — converts (product × location) stock gaps into
 * **production orders**, not raw plans. The PO seeder downstream picks
 * them up and creates the actual plans, so replen work appears in
 * `/production-orders` alongside campaign / market POs.
 *
 * Idempotent: skips a (product, location) pair that already has an
 * open replen PO ('pending' or 'in_production').
 */
async function seedReplenishmentDrivenPlans(): Promise<string[]> {
  const warnings: string[] = [];

  const minimums = assertOk(
    await supabase.from("stockLocationMinimums").select("*"),
  ) as StockLocationMinimum[];
  if (minimums.length === 0) return warnings;

  // Shop hours: when location === "store", the stock isn't actually
  // needed until the next time the shop opens. Pull hours + closures
  // and compute that anchor; we only seed a store-replen plan when
  // production lead time would push completion AT/AFTER the opening
  // day. Otherwise we skip with a note so the next Regenerate (or
  // tomorrow's auto-regen) re-evaluates closer to opening.
  const [hoursRes, closuresRes] = await Promise.all([
    supabase.from("shopOpeningHours").select("*"),
    supabase.from("shopClosures").select("*"),
  ]);
  const shopHours = (hoursRes.data ?? []) as ShopOpeningHours[];
  const shopClosures = (closuresRes.data ?? []) as ShopClosure[];
  const { nextShopOpeningDay } = await import("@/lib/shopHours");
  const nextOpening = nextShopOpeningDay(shopHours, shopClosures, new Date());
  // Local-date format (NOT toISOString which drifts in UTC+ zones).
  const nextOpeningIso = nextOpening
    ? `${nextOpening.getFullYear()}-${String(nextOpening.getMonth() + 1).padStart(2, "0")}-${String(nextOpening.getDate()).padStart(2, "0")}`
    : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  function shouldDeferStoreReplen(productLeadDays: number): { defer: boolean; reason: string | null } {
    if (!nextOpeningIso) return { defer: false, reason: null };
    const opening = new Date(nextOpeningIso + "T00:00:00").getTime();
    // Reserve enough days BEFORE opening to actually produce + cap.
    // Most chocolates need ~3 days end-to-end (polishing → painting →
    // shelling → filling → capping → unmoulding). leadTimeDays per
    // product is rarely set, so fall back to a 3-day floor — that
    // matches Manuela's expectation that store replen for an opening
    // 2 days away should already be in this week's plan.
    const PRODUCTION_BUFFER_DAYS = 3;
    const buffer = Math.max(productLeadDays, PRODUCTION_BUFFER_DAYS);
    const earliestUseful = opening - buffer * 86_400_000;
    if (earliestUseful > today.getTime()) {
      return { defer: true, reason: nextOpeningIso };
    }
    return { defer: false, reason: null };
  }

  // Current pieces on hand per (product, location). Read from
  // stockLocations (single source of truth — every transfer / box-up
  // / allocation / mark-as-packed writes here). The legacy productStock
  // table from mig 0053 is no longer kept in sync; reading it caused
  // seeded replens to ignore manual /shop/transfer moves.
  const slRows = assertOk(
    await supabase
      .from("stockLocations")
      .select("planProductId, location, quantity")
      .is("orderId", null)
      .is("productionOrderId", null),
  ) as Array<{ planProductId: string; location: string; quantity: number }>;
  const allPP = assertOk(
    await supabase.from("planProducts").select("id, productId"),
  ) as Array<{ id: string; productId: string }>;
  const ppToProd = new Map(allPP.map((p) => [p.id, p.productId]));
  const onHand = new Map<string, number>();
  for (const r of slRows) {
    const pid = ppToProd.get(r.planProductId);
    if (!pid) continue;
    const key = `${pid}|${r.location}`;
    onHand.set(key, (onHand.get(key) ?? 0) + Number(r.quantity ?? 0));
  }

  const productIds = [...new Set(minimums.map((m) => m.productId))];
  const products = productIds.length > 0
    ? assertOk(await supabase.from("products").select("*").in("id", productIds)) as Product[]
    : [];
  const productById = new Map(products.map((p) => [p.id!, p]));

  const mouldIds = products.map((p) => p.defaultMouldId).filter((x): x is string => !!x);
  const moulds = mouldIds.length > 0
    ? assertOk(await supabase.from("moulds").select("*").in("id", mouldIds)) as Mould[]
    : [];
  const mouldById = new Map(moulds.map((m) => [m.id!, m]));

  // Existing open replen POs — find the most recent open one created
  // today and APPEND items to it instead of spawning a fresh PO per
  // (product, location). One bucket per day = clean list view.
  const openPOs = assertOk(
    await supabase
      .from("productionOrders")
      .select("*")
      .in("status", ["pending", "in_production"]),
  ) as ProductionOrder[];
  const openPOItems = openPOs.length > 0
    ? assertOk(
        await supabase
          .from("productionOrderItems")
          .select("*")
          .in("productionOrderId", openPOs.map((p) => p.id!)),
      ) as ProductionOrderItem[]
    : [];
  const itemsByPo = new Map<string, ProductionOrderItem[]>();
  for (const it of openPOItems) {
    const arr = itemsByPo.get(it.productionOrderId) ?? [];
    arr.push(it);
    itemsByPo.set(it.productionOrderId, arr);
  }

  // Pick a bucket to append to: prefer any open NON-LOCKED Replen PO.
  // We sort newest-first so the most recent (and probably still
  // mutable) one wins. Locked POs (production started) are excluded
  // — adding to them would mutate work in flight. If no open non-
  // locked bucket exists, lazy-create today's.
  const todayIso = todayDateString();
  const todayBucketName = `Replen · ${todayIso}`;
  // When today's base name is taken by a LOCKED PO already in flight,
  // we fall back to a `· v2` / `· v3` suffix so the new bucket has a
  // unique name and the locked one stays visually distinct.
  function nextFreshBucketName(): string {
    const used = new Set(openPOs.map((p) => p.name).filter((n): n is string => !!n));
    if (!used.has(todayBucketName)) return todayBucketName;
    for (let i = 2; i < 50; i++) {
      const candidate = `${todayBucketName} · v${i}`;
      if (!used.has(candidate)) return candidate;
    }
    return `${todayBucketName} · v${Date.now()}`;
  }
  // Detect which open replen POs are "locked" — production already
  // started on at least one of their derived plans. Locked POs do
  // NOT count as covering their items (the production order is now
  // a sealed batch in flight; new gaps need a fresh bucket so we
  // don't mutate work the chocolatier is mid-run on).
  //
  // Linkage: seedProductionOrderDrivenPlans names plans
  // `PO: <po name> — <product>`. We match by name prefix.
  const allPlansForLockCheck = assertOk(
    await supabase.from("productionPlans").select("id, name, status"),
  ) as Array<{ id: string; name: string; status: string }>;
  const allDoneStatuses = assertOk(
    await supabase.from("planStepStatus").select("planId, done"),
  ) as Array<{ planId: string; done: boolean }>;
  const startedPlanIds = new Set<string>();
  for (const p of allPlansForLockCheck) {
    if (p.status === "active") startedPlanIds.add(p.id);
  }
  for (const s of allDoneStatuses) {
    if (s.done) startedPlanIds.add(s.planId);
  }
  const lockedPoIds = new Set<string>();
  for (const po of openPOs) {
    if (po.channel !== "restock" || !(po.name ?? "").startsWith("Replen ·")) continue;
    const namePrefix = `PO: ${po.name} — `;
    const linkedPlans = allPlansForLockCheck.filter((p) => (p.name ?? "").startsWith(namePrefix));
    if (linkedPlans.some((p) => startedPlanIds.has(p.id))) {
      lockedPoIds.add(po.id!);
    }
  }

  let bucketPo: ProductionOrder | null = (() => {
    const candidates = openPOs
      .filter((p) => p.channel === "restock" && (p.name ?? "").startsWith("Replen ·"))
      .filter((p) => !lockedPoIds.has(p.id!))
      .sort((a, b) => (b.dueDate ?? "").localeCompare(a.dueDate ?? ""));
    return candidates[0] ?? null;
  })();

  // Already-covered productId set — pulls items from every open
  // replen PO, locked or not.
  //
  // Earlier this excluded locked POs on the theory that "fresh demand
  // on the same item needs a fresh bucket." In practice that ran the
  // chocolatier through duplicate POs: a locked PO mid-flight produces
  // 120 hazelnut, the gap calc still sees onHand below minimum
  // (locked PO hasn't unmoulded yet), and the next regenerate seeded
  // a SECOND PO with the same 120-hazelnut item. Two PO Replen rows,
  // identical quantities.
  //
  // Treating locked POs as covering their items doesn't mutate them
  // — it just stops a redundant fresh bucket from being created
  // against the same demand. Once the locked PO completes and stock
  // lands, future regenerates will re-evaluate the gap normally.
  const coveredInBucket = new Set<string>();
  const coveredDebug: Array<{ poName: string; poStatus: string; productId: string; productName: string; targetUnits: number }> = [];
  for (const po of openPOs) {
    if (po.channel !== "restock") continue;
    if (!(po.name ?? "").startsWith("Replen ·")) continue;
    for (const it of itemsByPo.get(po.id!) ?? []) {
      coveredInBucket.add(it.productId);
      coveredDebug.push({
        poName: po.name ?? "(no name)",
        poStatus: po.status,
        productId: it.productId,
        productName: productById.get(it.productId)?.name ?? "(unknown)",
        targetUnits: it.targetUnits,
      });
    }
  }
  console.log(`[replen] open replen POs: ${openPOs.filter((p) => p.channel === "restock" && (p.name ?? "").startsWith("Replen ·")).length}`);
  console.log(`[replen] coveredInBucket products (${coveredInBucket.size}):`, coveredDebug);

  // ── Step 1 — migrate legacy "Replen: <product> → <location>" plans
  //    into the bucket so they show up in /production-orders. We keep
  //    the plan rows but rename them to the PO-driven pattern so the PO
  //    seeder finds them on its match-by-name pass and skips re-creating.
  const legacyReplenPlans = assertOk(
    await supabase
      .from("productionPlans")
      .select("*")
      .in("status", ["draft", "active"])
      .like("name", "Replen:%"),
  ) as ProductionPlan[];
  const now = new Date();
  if (legacyReplenPlans.length > 0) {
    if (!bucketPo) {
      const poId = newId();
      const poName = nextFreshBucketName();
      const bucketDueDate = nextOpeningIso ?? todayIso;
      const { error: poErr } = await supabase.from("productionOrders").insert({
        id: poId,
        name: poName,
        dueDate: bucketDueDate,
        status: "pending",
        channel: "restock",
        campaignId: null,
        targetLocation: null,
        notes: "Auto-bucket for daily replenishment needs.",
        createdAt: now,
        updatedAt: now,
      });
      if (poErr) {
        warnings.push(`Could not create replen bucket PO: ${poErr.message}`);
      } else {
        bucketPo = {
          id: poId, name: poName, dueDate: bucketDueDate, status: "pending",
          channel: "restock", campaignId: null, targetLocation: null,
          notes: null, createdAt: now, updatedAt: now,
        } as unknown as ProductionOrder;
      }
    }
    if (bucketPo) {
      // Need planProducts to know quantity-per-mould for each legacy plan.
      const planIds = legacyReplenPlans.map((p) => p.id!).filter(Boolean);
      const legacyPP = planIds.length > 0
        ? assertOk(await supabase.from("planProducts").select("*").in("planId", planIds)) as PlanProduct[]
        : [];
      const ppByPlan = new Map<string, PlanProduct[]>();
      for (const pp of legacyPP) {
        const arr = ppByPlan.get(pp.planId) ?? [];
        arr.push(pp);
        ppByPlan.set(pp.planId, arr);
      }
      for (const plan of legacyReplenPlans) {
        const pps = ppByPlan.get(plan.id!) ?? [];
        for (const pp of pps) {
          const product = productById.get(pp.productId);
          if (!product) continue;
          const mould = product.defaultMouldId ? mouldById.get(product.defaultMouldId) : undefined;
          const cavities = mould?.numberOfCavities ?? 1;
          const targetUnits = Math.max(1, pp.quantity * cavities);
          if (!coveredInBucket.has(pp.productId)) {
            const { error: itemErr } = await supabase.from("productionOrderItems").insert({
              id: newId(),
              productionOrderId: bucketPo.id,
              productId: pp.productId,
              targetUnits,
              sortOrder: 0,
              notes: null,
              createdAt: now,
              updatedAt: now,
            });
            if (itemErr) {
              warnings.push(`Could not migrate legacy replen item for ${product.name}: ${itemErr.message}`);
              continue;
            }
            coveredInBucket.add(pp.productId);
          }
        }
        // Rename the plan so the PO seeder claims it on its next pass
        // via its name-pattern match (`PO: <po name> — <product>`).
        const firstPP = pps[0];
        const productName = firstPP ? productById.get(firstPP.productId)?.name : null;
        if (productName && bucketPo.name) {
          const newName = `PO: ${bucketPo.name} — ${productName}`;
          await supabase.from("productionPlans").update({
            name: newName,
            updatedAt: now,
          }).eq("id", plan.id!);
        }
      }
    }
  }

  // ── Step 2 — seed fresh gaps that aren't already covered.
  for (const m of minimums) {
    if (m.minimumUnits == null || m.minimumUnits <= 0) continue;
    const current = onHand.get(`${m.productId}|${m.location}`) ?? 0;
    const gap = m.minimumUnits - current;
    if (gap <= 0) continue;
    const product = productById.get(m.productId);
    if (!product) continue;
    // Per-product opt-out: limited-edition / campaign-only chocolates
    // whose production runs are hand-driven via Production Orders.
    if (product.excludeFromReplen) continue;
    if (!product.defaultMouldId) {
      warnings.push(`"${product.name}" needs ${gap} pcs at ${m.location} — set a default mould to schedule.`);
      continue;
    }
    if (!mouldById.get(product.defaultMouldId)) continue;

    // Already in today's bucket (likely from legacy plan migration or
    // a prior gap-loop iteration) → skip silently. No duplicate item,
    // no misleading "deferred" warning either.
    if (coveredInBucket.has(m.productId)) {
      console.log(`[replen] skip (covered): ${product.name} @ ${m.location} (gap ${gap})`);
      continue;
    }
    console.log(`[replen] gap NOT covered → will add to bucket: ${product.name} @ ${m.location} (current ${current} / min ${m.minimumUnits} → gap ${gap})`);

    // Defer store-location replen when shop won't open for a while.
    if (m.location === "store") {
      const lead = Math.max(0, Number(product.leadTimeDays ?? 0));
      const { defer, reason } = shouldDeferStoreReplen(lead);
      if (defer && reason) {
        warnings.push(`"${product.name}" → store replen deferred — shop next opens ${reason}, will seed closer to that date.`);
        continue;
      }
    }

    // Lazy-create the bucket PO on first new gap of the run.
    if (!bucketPo) {
      const poId = newId();
      const poName = nextFreshBucketName();
      // Due date = next shop opening day if known, else today. The
      // scheduler reads this as the deadline for downstream plans —
      // setting it to today wrongly tells the scheduler "produce all of
      // this NOW" with zero lead, so capacity can't spread the load
      // across the lead-time window.
      const bucketDueDate = nextOpeningIso ?? todayIso;
      const { error: poErr } = await supabase.from("productionOrders").insert({
        id: poId,
        name: poName,
        dueDate: bucketDueDate,
        status: "pending",
        channel: "restock",
        campaignId: null,
        targetLocation: null,
        notes: "Auto-bucket for daily replenishment needs.",
        createdAt: now,
        updatedAt: now,
      });
      if (poErr) {
        warnings.push(`Could not create replen bucket PO: ${poErr.message}`);
        break;
      }
      bucketPo = {
        id: poId, name: poName, dueDate: bucketDueDate, status: "pending",
        channel: "restock", campaignId: null, targetLocation: null,
        notes: null, createdAt: now, updatedAt: now,
      } as unknown as ProductionOrder;
    }

    const { error: poItemErr } = await supabase.from("productionOrderItems").insert({
      id: newId(),
      productionOrderId: bucketPo.id,
      productId: m.productId,
      targetUnits: gap,
      sortOrder: 0,
      notes: `${m.location} · current ${current} / min ${m.minimumUnits}`,
      createdAt: now,
      updatedAt: now,
    });
    if (poItemErr) {
      warnings.push(`Could not add replen PO item for ${product.name}: ${poItemErr.message}`);
      continue;
    }
    coveredInBucket.add(m.productId);
  }
  return warnings;
}

export async function regenerateAllPlansAndSchedule(staticInputs: {
  config: CapacityConfig | null;
  people: Person[];
  unavailability: PersonUnavailability[];
  blockedDays: EventCalendarEntry[];
  productionSteps: ProductionStep[];
  categoryNameById: Map<string, string>;
}): Promise<{
  reconcile: RegeneratePlansResult;
  scheduleCount: number;
  warnings: string[];
  unscheduledPlanIds: string[];
}> {
  // Wrap each step so a failure in one phase logs which phase fired.
  // The catch site in /plan only sees a final thrown object — without
  // a tag we can't tell whether seedReplenishment or buildDailySchedule
  // is the culprit. Tag log + console.log so a phase trail appears
  // even when the error itself is opaque ("Bad Request" with no body).
  const tag = (name: string) => (err: unknown) => {
    const e = (err ?? {}) as Record<string, unknown>;
    const msg = (e.message as string) ?? String(err);
    console.error(`[regen] step "${name}" failed:`, err);
    const enriched = new Error(`${name}: ${msg}`);
    Object.assign(enriched, e);
    throw enriched;
  };
  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    console.log(`[regen] starting ${name}…`);
    try {
      const out = await fn();
      console.log(`[regen] ✓ ${name}`);
      return out;
    } catch (err) {
      tag(name)(err);
      throw err; // unreachable — tag throws
    }
  };
  const reconcileResult = await step("regenerateAllProductionPlans", regenerateAllProductionPlans);
  const { warnings: campaignWarnings, deadlineByPlanId: campaignDeadlines } =
    await step("seedCampaignDrivenPlans", seedCampaignDrivenPlans);
  await step("drop stale replen items + plans", dropStaleReplenItemsAndPlans);
  const replenWarnings = await step("seedReplenishmentDrivenPlans", seedReplenishmentDrivenPlans);
  const { warnings: poWarnings, deadlineByPlanId: poDeadlines } =
    await step("seedProductionOrderDrivenPlans", seedProductionOrderDrivenPlans);
  reconcileResult.warnings.push(...campaignWarnings, ...replenWarnings, ...poWarnings);
  for (const [k, v] of poDeadlines) {
    const cur = campaignDeadlines.get(k);
    if (cur === undefined || v < cur) campaignDeadlines.set(k, v);
  }

  // Sync planProducts.mouldId ← products.defaultMouldId for any plan
  // still in draft. PlanProducts copy the mould at insert time, so when
  // the user later changes a product's default mould (different
  // cavity count), existing draft plans go stale and the daily view
  // computes capacity off the old mould. Active / done plans are
  // skipped — those are mid-run and must not move.
  await step("sync planProducts.mouldId from products.defaultMouldId", syncDraftPlanMoulds);

  // Fresh reads — the post-reconcile state is what the scheduler must
  // see. Hook state at this point is stale (invalidation is async).
  const [plans, planProducts, orderPlanLinks, orders, orderItems, products, moulds] = await step(
    "fresh-reads",
    () => Promise.all([
      supabase.from("productionPlans").select("*").then((r) => assertOk(r) as ProductionPlan[]),
      supabase.from("planProducts").select("*").then((r) => assertOk(r) as PlanProduct[]),
      supabase.from("orderPlanLinks").select("*").then((r) => assertOk(r) as OrderPlanLink[]),
      supabase.from("orders").select("*").then((r) => assertOk(r) as Order[]),
      supabase.from("orderItems").select("*").then((r) => assertOk(r) as OrderItem[]),
      supabase.from("products").select("*").then((r) => assertOk(r) as Product[]),
      supabase.from("moulds").select("*").then((r) => assertOk(r) as Mould[]),
    ]),
  );

  // planStepStatus is passed to the scheduler so day-level session
  // locks can respect in-progress work. Empty after a wipe, so the
  // scheduler treats every day as freely mergeable.
  const planStepStatus = await step(
    "read-planStepStatus",
    async () => assertOk(await supabase.from("planStepStatus").select("*")) as PlanStepStatus[],
  );

  // Pull every productionDay row that's already been closed and treat
  // those dates as zero-capacity for the scheduler. Without this, regen
  // happily back-fills work onto a "done" day, which surfaces as
  // unfinished steps reappearing on today after Close.
  const closedDays = assertOk(
    await supabase
      .from("productionDays")
      .select("date")
      .eq("status", "done"),
  ) as Array<{ date: string }>;
  const closedDayBlockers: EventCalendarEntry[] = closedDays.map((d) => ({
    name: "Production day closed",
    kind: "blocked" as const,
    startDate: d.date,
    endDate: d.date,
  }));
  const blockedWithClosed = [...staticInputs.blockedDays, ...closedDayBlockers];

  const { buildDailySchedule } = await import("@/lib/scheduler");
  const preview = await step("buildDailySchedule", async () =>
    buildDailySchedule({
      plans, planProducts, orders, orderItems, orderPlanLinks,
      products, moulds, planStepStatus,
      extraDeadlineByPlanId: campaignDeadlines,
      ...staticInputs,
      blockedDays: blockedWithClosed,
    }),
  );

  // Honour manually-pinned plans: any plan with a pinnedDate gets all
  // its proposed lineItems forced onto that date, regardless of what
  // the scheduler chose. The user pinned it explicitly via /plan
  // drag-drop "Move + lock", so regenerate must not move it back.
  const pinnedByPlanId = new Map<string, string>();
  for (const p of plans) {
    if (p.pinnedDate && p.id) pinnedByPlanId.set(p.id, p.pinnedDate);
  }
  if (pinnedByPlanId.size > 0) {
    const seenDates = new Set(preview.days.map((d) => d.date));
    for (const date of pinnedByPlanId.values()) {
      if (!seenDates.has(date)) {
        preview.days.push({ date });
        seenDates.add(date);
      }
    }
    for (const li of preview.lineItems) {
      const pinned = pinnedByPlanId.get(li.planId);
      if (pinned) li.dateRef = pinned;
    }
  }

  await step("replaceProductionPlanning", () => replaceProductionPlanning(preview.days, preview.lineItems));

  // Sweep zombie PO/campaign plans whose parent row has been
  // deleted. The legacy delete-cascades for productionOrders +
  // campaigns weren't always wired, so deletions from /production-
  // orders or /campaigns left "PO: <gone-name> — <product>" plans
  // lingering in /plan with no way to remove them via the UI.
  // Detection: plan name starts with "PO: …" or "Campaign: …" but
  // no row in productionOrders / campaigns matches the prefix.
  await step("mark zombie PO/campaign plans cancelled", async () => {
    const allPlans = assertOk(
      await supabase
        .from("productionPlans")
        .select("id, name, status")
        .in("status", ["draft", "active"]),
    ) as Array<{ id: string; name: string; status: string }>;
    const poNames = new Set<string>(
      (assertOk(await supabase.from("productionOrders").select("name")) as Array<{ name: string | null }>)
        .map((p) => p.name)
        .filter((n): n is string => !!n),
    );
    const campNames = new Set<string>(
      (assertOk(await supabase.from("campaigns").select("name")) as Array<{ name: string | null }>)
        .map((c) => c.name)
        .filter((n): n is string => !!n),
    );
    const toCancel: string[] = [];
    for (const p of allPlans) {
      const name = p.name ?? "";
      if (name.startsWith("PO: ")) {
        const rest = name.slice("PO: ".length);
        const dash = rest.indexOf(" — ");
        const poName = dash > 0 ? rest.slice(0, dash) : rest;
        if (!poNames.has(poName)) toCancel.push(p.id);
      } else if (name.startsWith("Campaign: ")) {
        const rest = name.slice("Campaign: ".length);
        const dash = rest.indexOf(" — ");
        const campName = dash > 0 ? rest.slice(0, dash) : rest;
        if (!campNames.has(campName)) toCancel.push(p.id);
      }
    }
    if (toCancel.length === 0) return;
    const CHUNK = 100;
    for (let i = 0; i < toCancel.length; i += CHUNK) {
      const slice = toCancel.slice(i, i + CHUNK);
      await supabase
        .from("productionPlans")
        .update({ status: "cancelled", updatedAt: new Date() })
        .in("id", slice);
    }
    console.log(`[regen] marked ${toCancel.length} zombie PO/campaign plan(s) cancelled`);
  });

  // Sweep cancelled / orphaned plans + their bookkeeping rows so
  // /production-orders detail and the audit pages don't pile up
  // with bookkeeping junk. Active + done + draft plans are left
  // alone. Errors are logged but never fail the whole regen — the
  // sweep is a cleanup nicety, not a correctness step.
  await step("purge cancelled / orphaned plans", async () => {
    const stale = assertOk(
      await supabase.from("productionPlans")
        .select("id")
        .in("status", ["cancelled", "orphaned"]),
    ) as Array<{ id: string }>;
    if (stale.length === 0) return;
    const ids = stale.map((p) => p.id);
    const CHUNK = 100;
    // 1) Wipe their lineItems first (FK constraint).
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      await supabase.from("productionDayLineItems").delete().in("planId", slice);
    }
    // 2) Wipe planStepStatus + planProducts (also FK to plans).
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      await supabase.from("planStepStatus").delete().in("planId", slice);
      await supabase.from("planProducts").delete().in("planId", slice);
    }
    // 3) Wipe orderPlanLinks pointing at these plans.
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      await supabase.from("orderPlanLinks").delete().in("planId", slice);
    }
    // 4) Finally delete the plans themselves.
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      await supabase.from("productionPlans").delete().in("id", slice);
    }
  });

  // Stamp the regen timestamp so the UI can show "last updated …".
  try {
    await updatePreference({ lastRegenAt: new Date() });
  } catch (e) {
    // Don't fail the whole regen on a preferences write — log only.
    console.warn("regen: lastRegenAt write failed", e);
  }

  return {
    reconcile: reconcileResult,
    scheduleCount: preview.lineItems.length,
    warnings: [...reconcileResult.warnings, ...preview.warnings],
    unscheduledPlanIds: preview.unscheduledPlanIds,
  };
}

/** Short day+month label for fallback names — "05 Mar", "21 Apr".
 *  Used when an order has no customer / event / sourceRef to anchor a
 *  name on. Locale-stable across browsers because we pin en-GB. */
function formatOrderDate(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  return d.toLocaleDateString("de-AT", { day: "2-digit", month: "short" });
}

export async function syncReplenishmentOrder(parentOrderId: string): Promise<void> {
  const parent = assertOkMaybe(
    await supabase.from("orders").select("*").eq("id", parentOrderId).maybeSingle(),
  ) as Order | null;
  if (!parent) return;

  const parentItems = assertOk(
    await supabase.from("orderItems").select("*").eq("orderId", parentOrderId),
  ) as OrderItem[];
  const borrowedItems = parentItems.filter((i) => i.fulfilmentMode === "borrow");

  const existing = assertOkMaybe(
    await supabase
      .from("orders")
      .select("*")
      .eq("sourceOrderId", parentOrderId)
      .eq("channel", "shop")
      .maybeSingle(),
  ) as Order | null;

  // Nothing to replenish — drop the child if it exists.
  if (borrowedItems.length === 0) {
    if (existing?.id) {
      await deleteOrder(existing.id);
    }
    return;
  }

  // Target deadline = next shop opening from now. If the parent's own
  // deadline is sooner we still aim for shop opening — the purpose of
  // the replenishment is to refill the store before it reopens.
  const [hoursRes, closuresRes] = await Promise.all([
    supabase.from("shopOpeningHours").select("*"),
    supabase.from("shopClosures").select("*"),
  ]);
  const hours = (hoursRes.data ?? []) as ShopOpeningHours[];
  const closures = (closuresRes.data ?? []) as ShopClosure[];
  const { nextShopOpeningDay } = await import("@/lib/shopHours");
  const deadline = nextShopOpeningDay(hours, closures, new Date()) ?? new Date(parent.deadline);
  // Shop opens that morning — aim to finish production the evening
  // before. Set the deadline to 08:00 of the opening day.
  deadline.setHours(8, 0, 0, 0);

  // Name anchors on whatever's most distinctive about the parent:
  // its external ref (imported orders), its customer name, or the
  // deadline date. Never the raw UUID — the name shows up in Active
  // batches and the Orders list, so it has to be human-readable.
  const parentRef = parent.sourceRef?.trim()
    || parent.customerName?.trim()
    || parent.eventName?.trim()
    || formatOrderDate(parent.deadline);
  const replenishmentName = `Shop Replenishment — ${parentRef}`;

  let childId = existing?.id;
  if (!childId) {
    childId = newId();
    const { error } = await supabase.from("orders").insert({
      id: childId,
      channel: "shop",
      customerName: replenishmentName,
      deadline: deadline.toISOString(),
      priority: parent.priority,
      status: "pending",
      notes: `Auto-created to restock Store after borrowing for ${parentRef}.`,
      sourceOrderId: parentOrderId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    if (error) throw error;
  } else {
    // Keep deadline + priority + name fresh in case the parent changed.
    // The name anchors on parent.sourceRef/customerName, so a late
    // rename propagates to the replenishment order automatically.
    await supabase
      .from("orders")
      .update({
        customerName: replenishmentName,
        deadline: deadline.toISOString(),
        priority: parent.priority,
        updatedAt: new Date(),
      })
      .eq("id", childId);
  }

  // Rebuild child orderItems to match the current borrowed set. Replace
  // strategy — simpler and correct for small N — delete all child items,
  // insert fresh ones with the computed replenishment quantity.
  await supabase.from("orderItems").delete().eq("orderId", childId);

  // Load minimums once for all borrowed products.
  const productIds = borrowedItems.map((i) => i.productId);
  const [minsRes, totals] = await Promise.all([
    supabase
      .from("stockLocationMinimums")
      .select("*")
      .in("productId", productIds)
      .eq("location", "store"),
    Promise.all(productIds.map((pid) => computeStoreAvailableFor(pid))),
  ]);
  const minsByProduct = new Map<string, StockLocationMinimum>();
  for (const m of (minsRes.data ?? []) as StockLocationMinimum[]) {
    minsByProduct.set(m.productId, m);
  }
  const storeByProduct = new Map<string, number>();
  productIds.forEach((pid, idx) => storeByProduct.set(pid, totals[idx]));

  const { computeReplenishmentQuantity } = await import("@/lib/borrowDecision");

  let sortOrder = 0;
  const inserts = borrowedItems
    .map((bi) => {
      const mins = minsByProduct.get(bi.productId);
      const qty = computeReplenishmentQuantity({
        borrowedQuantity: bi.quantity,
        currentStore: storeByProduct.get(bi.productId) ?? 0,
        minimumUnits: mins?.minimumUnits ?? bi.quantity,
        maximumUnits: mins?.maximumUnits,
      });
      return { bi, qty };
    })
    .filter(({ qty }) => qty > 0)
    .map(({ bi, qty }) => ({
      id: newId(),
      orderId: childId,
      productId: bi.productId,
      quantity: qty,
      sortOrder: sortOrder++,
      fulfilmentMode: "produce" as const,
      notes: `Replenish Store after borrowing ${bi.quantity} pc for order ${parentOrderId.slice(0, 8)}.`,
    }));
  if (inserts.length === 0) {
    // All borrowed lines still leave Store above min — no replenishment needed.
    await deleteOrder(childId);
    return;
  }
  const { error } = await supabase.from("orderItems").insert(inserts);
  if (error) throw error;

  queryClient.invalidateQueries({ queryKey: ["orders"] });
  queryClient.invalidateQueries({ queryKey: ["order-items"] });
}

/** Done / delivered path: the order's Allocated pieces have physically
 *  left the shop. Drain every Allocated stockLocations row tagged with
 *  this orderId (outake — no destination; logs the movement as 'sold').
 *  Called from saveOrder when status transitions to 'done'. Idempotent —
 *  safe to call on an order that has no allocated rows. */
export async function drainAllocatedForOrder(orderId: string): Promise<void> {
  const allocated = assertOk(
    await supabase
      .from("stockLocations")
      .select("*")
      .eq("orderId", orderId)
      .eq("location", "allocated"),
  ) as StockLocationRow[];
  if (allocated.length === 0) return;

  for (const row of allocated) {
    // productId for the movement log — look up the batch.
    const batch = assertOkMaybe(
      await supabase
        .from("planProducts")
        .select("productId")
        .eq("id", row.planProductId)
        .maybeSingle(),
    ) as { productId?: string } | null;
    await outakeBatchStock({
      planProductId: row.planProductId,
      productId: batch?.productId ?? "",
      fromLocation: "allocated",
      quantity: row.quantity,
      orderId,
      reason: "sold",
      notes: "Order marked done — allocated stock shipped.",
    });
  }
  queryClient.invalidateQueries({ queryKey: ["stock-locations"] });
  queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
}

/** Cancel-path: release every Allocated piece this order holds and drop
 *  its linked replenishment order. Called from deleteOrder and from the
 *  status flip to 'cancelled'. Idempotent. */
export async function revertBorrowsForOrder(orderId: string): Promise<void> {
  // 0. Release any pre-built variant boxes reserved for this order
  //    back to shop on-hand. Done before the loose-stock revert so
  //    audit ordering reads variant first → loose second.
  try {
    await revertVariantAllocationsForOrder(orderId);
  } catch (e) {
    console.warn(`[revertBorrowsForOrder] variant revert failed for ${orderId}:`, e);
  }

  // 1. Flip any borrowed orderItems back to produce first — so UI shows
  //    the correct state even if the transfer step fails.
  await supabase
    .from("orderItems")
    .update({ fulfilmentMode: "produce" })
    .eq("orderId", orderId)
    .eq("fulfilmentMode", "borrow");
  queryClient.invalidateQueries({ queryKey: ["order-items"] });

  // 2. Move every 'allocated' row tagged with this orderId back to its
  //    origin location. Origin is read from the most-recent 'allocate'
  //    movement for (planProductId, orderId) — so pieces pulled from
  //    Production go back to Production, pieces pulled from Store go
  //    back to Store. Falls back to 'store' if no movement row is
  //    found (defensive for legacy rows that predate the
  //    store-or-production allocation path).
  const allocated = assertOk(
    await supabase
      .from("stockLocations")
      .select("*")
      .eq("orderId", orderId)
      .eq("location", "allocated"),
  ) as StockLocationRow[];
  for (const row of allocated) {
    const batch = assertOkMaybe(
      await supabase
        .from("planProducts")
        .select("productId")
        .eq("id", row.planProductId)
        .maybeSingle(),
    ) as { productId?: string } | null;
    // Find the last allocate movement for this (plan product, order).
    const movement = assertOkMaybe(
      await supabase
        .from("stockMovements")
        .select("fromLocation")
        .eq("planProductId", row.planProductId)
        .eq("orderId", orderId)
        .eq("reason", "allocate")
        .eq("toLocation", "allocated")
        .order("movedAt", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ) as { fromLocation?: StockLocation | string } | null;
    const origin: StockLocation = (movement?.fromLocation === "production"
      || movement?.fromLocation === "freezer"
      || movement?.fromLocation === "store")
      ? (movement!.fromLocation as StockLocation)
      : "store";
    await transferBatchStock({
      planProductId: row.planProductId,
      productId: batch?.productId ?? "",
      fromLocation: "allocated",
      toLocation: origin,
      quantity: row.quantity,
      orderId,
      reason: "allocate",
      notes: `Reverted on order cancel/delete (→ ${origin}).`,
    });
  }

  // 3. Drop the linked replenishment order outright — its reason to
  //    exist (the parent's demand) is gone.
  const child = assertOkMaybe(
    await supabase
      .from("orders")
      .select("id")
      .eq("sourceOrderId", orderId)
      .eq("channel", "shop")
      .maybeSingle(),
  ) as { id?: string } | null;
  if (child?.id) {
    await supabase.from("orderItems").delete().eq("orderId", child.id);
    await supabase.from("orders").delete().eq("id", child.id);
    queryClient.invalidateQueries({ queryKey: ["orders"] });
    queryClient.invalidateQueries({ queryKey: ["order-items"] });
  }
}

// ---------------------------------------------------------------------------
// Production planning (scheduler output)
//
// Replaces the old productionSchedule model with a (day, batch) shape.
// productionDays are rows in the existing table (shared with HACCP);
// productionDayLineItems are one row per batch-on-day with a stepIds[]
// array. Step progress continues to live on planStepStatus.
// ---------------------------------------------------------------------------

export function useAllProductionDayLineItems(): ProductionDayLineItem[] {
  const { data } = useQuery({
    queryKey: ["production-day-line-items", "all"],
    queryFn: async () => {
      const out: ProductionDayLineItem[] = [];
      const PAGE = 1000;
      const MAX_PAGES = 20;
      for (let i = 0; i < MAX_PAGES; i++) {
        const from = i * PAGE;
        const res = await supabase
          .from("productionDayLineItems")
          .select("*")
          .range(from, from + PAGE - 1);
        const page = assertOk(res) as ProductionDayLineItem[];
        out.push(...page);
        if (page.length < PAGE) break;
      }
      return out.sort((a, b) => a.sortOrder - b.sortOrder);
    },
  });
  return data ?? [];
}

export function useProductionDayLineItems(
  productionDayId: string | undefined,
): ProductionDayLineItem[] {
  const { data } = useQuery({
    queryKey: ["production-day-line-items", productionDayId ?? ""],
    enabled: !!productionDayId,
    queryFn: async () => {
      const rows = assertOk(
        await supabase
          .from("productionDayLineItems")
          .select("*")
          .eq("productionDayId", productionDayId!),
      ) as ProductionDayLineItem[];
      return rows.sort((a, b) => a.sortOrder - b.sortOrder);
    },
  });
  return data ?? [];
}

/**
 * Replace the scheduler output for every DRAFT plan. Active plans
 * keep their existing line items untouched (physical work underway).
 *
 * Flow (delete-before-insert, scoped to draft plans):
 *
 *   1. Read all draft plan ids.
 *   2. Delete every productionDayLineItem whose planId is a draft
 *      plan. Anywhere they live — draft day, active day, whatever —
 *      they go. This is the move that prevents the duplicate-key
 *      crash we hit when the old code tried to insert a new row for
 *      a (productionDayId, planId) pair that still had the previous
 *      row alive.
 *   3. Ensure a productionDay row exists per proposed date.
 *   4. Insert the fresh line items. The unique constraint is now
 *      guaranteed satisfiable because we wiped overlapping rows in
 *      step 2.
 *   5. Delete orphan draft productionDays that no longer carry any
 *      work.
 *
 * Failure modes: if step 4 throws, draft plans have no scheduled
 * work until the next Regenerate — acceptable because Regenerate is
 * cheap and idempotent. Active plans' line items are never at risk.
 */
export async function replaceProductionPlanning(
  proposedDays: Array<{ date: string }>,
  proposedLineItems: Array<{
    dateRef: string; planId: string; stepIds: string[];
    plannedMinutes: number; sortOrder: number;
  }>,
): Promise<void> {
  const now = new Date();
  console.log(`[replaceProductionPlanning] proposed: ${proposedDays.length} days, ${proposedLineItems.length} line items`);

  // 1. Find every plan the scheduler is allowed to rewrite. That's
  //    anything NOT currently active or done: draft (the normal case),
  //    plus cancelled / orphaned, both of which are "no longer the
  //    operator's concern" and whose stale lineItems would otherwise
  //    linger on /plan and /production pointing at ghost orders.
  const rewritablePlansRes = await supabase
    .from("productionPlans")
    .select("id")
    .in("status", ["draft", "cancelled", "orphaned"]);
  if (rewritablePlansRes.error) {
    console.error("[replaceProductionPlanning] step 1 (read rewritablePlans) failed:", rewritablePlansRes.error);
    throw rewritablePlansRes.error;
  }
  const rewritablePlans = rewritablePlansRes.data as Array<{ id: string }>;
  const rewritablePlanIds = rewritablePlans.map((p) => p.id);

  // 2. Delete every line item whose planId is rewritable. Handles
  //    both the duplicate-key crash (same (dayId, planId) alive from
  //    a previous run) and the ghost-lineItem bug where a cancelled
  //    plan's old schedule rows kept rendering on the UI.
  //
  //    Chunked: a single `.in("planId", [<1000 uuids>])` exceeds
  //    PostgREST's URL length cap and 400s. Slice into batches.
  if (rewritablePlanIds.length > 0) {
    const CHUNK = 100;
    for (let i = 0; i < rewritablePlanIds.length; i += CHUNK) {
      const slice = rewritablePlanIds.slice(i, i + CHUNK);
      const delRes = await supabase
        .from("productionDayLineItems")
        .delete()
        .in("planId", slice);
      if (delRes.error) {
        console.error(
          "[replaceProductionPlanning] step 2 (delete lineItems) failed:",
          delRes.error,
          "chunk start:", i, "size:", slice.length,
          "first 5 ids:", slice.slice(0, 5),
        );
        throw delRes.error;
      }
    }
  }

  // 3. Snapshot existing productionDays so we can reuse ids by date.
  //    Active / done days are preserved regardless of what the
  //    scheduler outputs.
  const existingDaysRes = await supabase.from("productionDays").select("id, date, status");
  if (existingDaysRes.error) {
    console.error("[replaceProductionPlanning] step 3 (read productionDays) failed:", existingDaysRes.error);
    throw existingDaysRes.error;
  }
  const existingDays = existingDaysRes.data as Array<{ id: string; date: string; status: string }>;
  const dayByDate = new Map(existingDays.map((d) => [d.date, d]));
  const dayIdByDate = new Map<string, string>();
  const daysToInsert: Array<{
    id: string; date: string; status: string;
    tempLogComplete: boolean; cleaningComplete: boolean;
    summaryJson: Record<string, unknown>;
    createdAt: Date; updatedAt: Date;
  }> = [];
  for (const d of proposedDays) {
    const existing = dayByDate.get(d.date);
    if (existing) {
      dayIdByDate.set(d.date, existing.id);
      continue;
    }
    const id = newId();
    dayIdByDate.set(d.date, id);
    daysToInsert.push({
      id, date: d.date, status: "draft",
      tempLogComplete: false, cleaningComplete: false, summaryJson: {},
      createdAt: now, updatedAt: now,
    });
  }
  if (daysToInsert.length > 0) {
    console.log(`[replaceProductionPlanning] inserting ${daysToInsert.length} productionDays`, daysToInsert);
    const { error } = await supabase.from("productionDays").insert(daysToInsert);
    if (error) {
      console.error("[replaceProductionPlanning] productionDays insert failed:", error, "rows:", daysToInsert);
      throw error;
    }
  }

  // 4. Insert the fresh line items. The (productionDayId, planId)
  //    unique constraint is now satisfiable because step 2 wiped any
  //    overlaps.
  //
  //    Coalesce proposedLineItems on (dateRef, planId) before insert.
  //    The scheduler can emit multiple entries for the same plan on
  //    the same day when steps come from different phase groups; the
  //    table's unique constraint forbids that, and the operator-facing
  //    semantics we want is "one row per plan-day with the union of
  //    its steps". Merging here means the constraint can't be hit by
  //    benign multi-emit; a real bug (e.g. crossed planIds) would
  //    surface elsewhere.
  if (proposedLineItems.length > 0) {
    const merged = new Map<string, {
      dateRef: string; planId: string; stepIds: string[];
      plannedMinutes: number; sortOrder: number;
    }>();
    for (const li of proposedLineItems) {
      const key = `${li.dateRef}|${li.planId}`;
      const cur = merged.get(key);
      if (!cur) {
        merged.set(key, {
          dateRef: li.dateRef,
          planId: li.planId,
          stepIds: [...li.stepIds],
          plannedMinutes: li.plannedMinutes,
          sortOrder: li.sortOrder,
        });
        continue;
      }
      // Union step ids, sum minutes, keep earliest sort order so the
      // merged row appears at the same place a single emit would.
      const seen = new Set(cur.stepIds);
      for (const sid of li.stepIds) if (!seen.has(sid)) { cur.stepIds.push(sid); seen.add(sid); }
      cur.plannedMinutes += li.plannedMinutes;
      if (li.sortOrder < cur.sortOrder) cur.sortOrder = li.sortOrder;
    }
    const dupCount = proposedLineItems.length - merged.size;
    if (dupCount > 0) {
      console.warn(`[replaceProductionPlanning] merged ${dupCount} duplicate (date, plan) line item${dupCount === 1 ? "" : "s"} before insert`);
    }
    const rows = [...merged.values()].map((li) => {
      const dayId = dayIdByDate.get(li.dateRef);
      if (!dayId) throw new Error(`Scheduler produced a line item for unknown date ${li.dateRef}`);
      return {
        id: newId(),
        productionDayId: dayId,
        planId: li.planId,
        stepIds: li.stepIds,
        plannedMinutes: li.plannedMinutes,
        sortOrder: li.sortOrder,
        createdAt: now,
        updatedAt: now,
      };
    });
    console.log(`[replaceProductionPlanning] inserting ${rows.length} productionDayLineItems · sample:`, rows.slice(0, 3));
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const { error } = await supabase.from("productionDayLineItems").insert(slice);
      if (error) {
        console.error("[replaceProductionPlanning] productionDayLineItems insert failed:", error, "chunk start:", i, "first row:", slice[0]);
        throw error;
      }
    }
  }

  // 5. Delete orphan draft productionDays that no longer carry work
  //    after this regenerate. Active / done days are preserved.
  const draftDayIds = existingDays.filter((d) => d.status === "draft").map((d) => d.id);
  if (draftDayIds.length > 0) {
    const stillUsedDayIds = new Set(proposedLineItems.map((li) => dayIdByDate.get(li.dateRef)!));
    const toDelete = draftDayIds.filter((id) => !stillUsedDayIds.has(id));
    if (toDelete.length > 0) {
      const CHUNK = 100;
      for (let i = 0; i < toDelete.length; i += CHUNK) {
        const slice = toDelete.slice(i, i + CHUNK);
        const delDaysRes = await supabase.from("productionDays").delete().in("id", slice);
        if (delDaysRes.error) {
          console.error(
            "[replaceProductionPlanning] step 5 (delete orphan productionDays) failed:",
            delDaysRes.error,
            "chunk start:", i, "size:", slice.length,
          );
          throw delDaysRes.error;
        }
      }
    }
  }

  queryClient.invalidateQueries({ queryKey: ["production-days"] });
  queryClient.invalidateQueries({ queryKey: ["production-day-line-items"] });
}

export function useEventCalendar(): EventCalendarEntry[] {
  const { data } = useQuery({
    queryKey: ["event-calendar"],
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("eventCalendar").select("*"),
      ) as EventCalendarEntry[];
      return rows.sort((a, b) => a.startDate.localeCompare(b.startDate));
    },
  });
  return data ?? [];
}

/** Blocked-day entries only (kind='blocked'), sorted by start date asc. */
export function useBlockedDays(): EventCalendarEntry[] {
  const all = useEventCalendar();
  return all.filter((e) => e.kind === "blocked");
}

export async function saveEventCalendarEntry(
  entry: Omit<EventCalendarEntry, "createdAt" | "updatedAt">,
): Promise<string> {
  const now = new Date();
  if (entry.id) {
    const { error } = await supabase
      .from("eventCalendar")
      .update({ ...entry, updatedAt: now })
      .eq("id", entry.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["event-calendar"] });
    return entry.id;
  }
  const id = newId();
  const { error } = await supabase
    .from("eventCalendar")
    .insert({ ...entry, id, createdAt: now, updatedAt: now });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["event-calendar"] });
  return id;
}

export async function deleteEventCalendarEntry(id: string): Promise<void> {
  const { error } = await supabase.from("eventCalendar").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["event-calendar"] });
}

// ---------------------------------------------------------------
// Stock locations (4-location model — §6 of the handover)
// ---------------------------------------------------------------
//
// Source of truth for "how many pieces of this batch are in which
// location". The single-counter currentStock/frozenQty fields on
// planProducts stay around for this migration — freeze/defrost dual-
// writes into both — but reads for the new stock UI go through here.
//
// Allocated rows carry an orderId (enforced at the DB layer via a
// CHECK constraint). All other locations must not set orderId.

export function useAllStockLocations(): StockLocationRow[] {
  const { data } = useQuery({
    queryKey: ["stock-locations", "all"],
    queryFn: async () =>
      assertOk(await supabase.from("stockLocations").select("*")) as StockLocationRow[],
  });
  return data ?? [];
}

export function useStockLocationsForBatch(planProductId: string | undefined): StockLocationRow[] {
  const { data } = useQuery({
    queryKey: ["stock-locations", "batch", planProductId],
    enabled: !!planProductId,
    queryFn: async () =>
      assertOk(
        await supabase.from("stockLocations").select("*").eq("planProductId", planProductId!),
      ) as StockLocationRow[],
  });
  return data ?? [];
}

/** Movements newest-first. Optionally scoped to a specific batch. */
export function useStockMovements(planProductId?: string): StockMovement[] {
  const { data } = useQuery({
    queryKey: ["stock-movements", planProductId ?? "all"],
    queryFn: async () => {
      const q = supabase.from("stockMovements").select("*").order("movedAt", { ascending: false });
      const rows = assertOk(
        await (planProductId ? q.eq("planProductId", planProductId) : q),
      ) as StockMovement[];
      return rows;
    },
  });
  return data ?? [];
}

/** productId → (location → total quantity across all batches). Useful for the
 *  4-location dashboard breakdown. Excludes 'allocated' per-order detail — the
 *  allocated total is the sum of all allocated rows for the product. */
export function useProductLocationTotals(): Map<string, Record<StockLocation, number>> {
  const { data } = useQuery({
    queryKey: ["stock-locations", "product-totals"],
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const [locations, batches] = await Promise.all([
        supabase.from("stockLocations").select("*").then((r) => assertOk(r) as StockLocationRow[]),
        supabase.from("planProducts").select("id, productId").then((r) =>
          assertOk(r) as Array<{ id: string; productId: string }>,
        ),
      ]);
      const productByBatch = new Map(batches.map((b) => [b.id, b.productId] as const));
      const result = new Map<string, Record<StockLocation, number>>();
      for (const row of locations) {
        const productId = productByBatch.get(row.planProductId);
        if (!productId) continue;
        const existing =
          result.get(productId) ??
          ({ store: 0, production: 0, freezer: 0, allocated: 0 } as Record<StockLocation, number>);
        existing[row.location] += row.quantity;
        result.set(productId, existing);
      }
      return result;
    },
  });
  return data ?? new Map<string, Record<StockLocation, number>>();
}

// ---------------------------------------------------------------
// Stock location minimums
// ---------------------------------------------------------------

/** Default minimum applied when no row is set — 10 units per product per
 *  location (handover §1). Real values are per-product per-location, written
 *  from the Settings UI. */
export const DEFAULT_LOCATION_MINIMUM = 10;

export function useStockLocationMinimums(): StockLocationMinimum[] {
  const { data } = useQuery({
    queryKey: ["stock-location-minimums"],
    queryFn: async () =>
      assertOk(await supabase.from("stockLocationMinimums").select("*")) as StockLocationMinimum[],
  });
  return data ?? [];
}

export async function saveStockLocationMinimum(
  row: Omit<StockLocationMinimum, "id" | "updatedAt"> & { id?: string },
): Promise<string> {
  const now = new Date();
  // A min of 0 is not a min — leaving the row in the table makes the
  // replen seeder treat the (product, location) pair as "configured"
  // and the regen sweep can't tell zombie restock plans apart from
  // legitimate reduced thresholds. Saving 0 deletes the row.
  const isZero = (row.minimumUnits ?? 0) <= 0;
  if (isZero) {
    if (row.id) {
      const { error } = await supabase
        .from("stockLocationMinimums")
        .delete()
        .eq("id", row.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["stock-location-minimums"] });
      return row.id;
    }
    // No id + zero → nothing to save and nothing to delete; act as no-op.
    queryClient.invalidateQueries({ queryKey: ["stock-location-minimums"] });
    return "";
  }
  if (row.id) {
    const { error } = await supabase
      .from("stockLocationMinimums")
      .update({ ...row, updatedAt: now })
      .eq("id", row.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["stock-location-minimums"] });
    return row.id;
  }
  const id = newId();
  const { error } = await supabase
    .from("stockLocationMinimums")
    .insert({ ...row, id, updatedAt: now });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["stock-location-minimums"] });
  return id;
}

export async function deleteStockLocationMinimum(id: string): Promise<void> {
  const { error } = await supabase.from("stockLocationMinimums").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["stock-location-minimums"] });
}

// ---------------------------------------------------------------
// Stock movement helpers
// ---------------------------------------------------------------
//
// Core primitives for changing where pieces live. Every mutation
//   1. Upserts the affected stockLocations rows (creating the row if
//      missing, deleting when it drops to 0), and
//   2. Appends a stockMovements audit entry.
//
// Callers should ensure fromLocation has enough stock — the helpers
// clamp to available rather than throwing (matches the forgiving UI
// style already used by freeze/defrost). A clamp to 0 is a no-op.

async function upsertStockLocationRow(
  planProductId: string,
  location: StockLocation,
  orderId: string | null,
  delta: number,
  productionOrderId: string | null = null,
): Promise<void> {
  if (delta === 0) return;
  let q = supabase
    .from("stockLocations")
    .select("*")
    .eq("planProductId", planProductId)
    .eq("location", location);
  q = orderId == null ? q.is("orderId", null) : q.eq("orderId", orderId);
  q = productionOrderId == null ? q.is("productionOrderId", null) : q.eq("productionOrderId", productionOrderId);
  const existing = assertOk(await q) as StockLocationRow[];
  const current = existing[0];
  const next = Math.max(0, (current?.quantity ?? 0) + delta);
  if (current) {
    if (next === 0) {
      const { error } = await supabase.from("stockLocations").delete().eq("id", current.id!);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("stockLocations")
        .update({ quantity: next, updatedAt: new Date() })
        .eq("id", current.id!);
      if (error) throw error;
    }
    return;
  }
  // No existing row — only insert when we're adding positive quantity.
  if (next <= 0) return;
  const { error } = await supabase.from("stockLocations").insert({
    id: newId(),
    planProductId,
    location,
    orderId: orderId ?? null,
    productionOrderId: productionOrderId ?? null,
    quantity: next,
    updatedAt: new Date(),
  });
  if (error) throw error;
}

async function logStockMovement(m: Omit<StockMovement, "id" | "movedAt"> & { movedAt?: Date }): Promise<void> {
  const { error } = await supabase.from("stockMovements").insert({
    id: newId(),
    ...m,
    movedAt: m.movedAt ?? new Date(),
  });
  if (error) throw error;
}

export interface TransferBatchStockArgs {
  planProductId: string;
  productId: string;
  fromLocation: StockLocation;
  toLocation: StockLocation;
  quantity: number;
  /** Only required when `fromLocation` or `toLocation` is 'allocated'
   *  AND the reservation is a customer order. */
  orderId?: string;
  /** Only required when `fromLocation` or `toLocation` is 'allocated'
   *  AND the reservation is a production order (PO/replen/internal). */
  productionOrderId?: string;
  reason?: StockMovementReason | string;
  movedBy?: string;
  notes?: string;
}

/** Move `quantity` pieces of a single batch from one location to another. */
export async function transferBatchStock(args: TransferBatchStockArgs): Promise<void> {
  const qty = Math.max(0, Math.round(args.quantity));
  if (qty === 0) return;
  const fromOrderId = args.fromLocation === "allocated" ? args.orderId ?? null : null;
  const toOrderId = args.toLocation === "allocated" ? args.orderId ?? null : null;
  const fromPoId = args.fromLocation === "allocated" ? args.productionOrderId ?? null : null;
  const toPoId = args.toLocation === "allocated" ? args.productionOrderId ?? null : null;
  await upsertStockLocationRow(args.planProductId, args.fromLocation, fromOrderId, -qty, fromPoId);
  await upsertStockLocationRow(args.planProductId, args.toLocation, toOrderId, qty, toPoId);
  await logStockMovement({
    planProductId: args.planProductId,
    productId: args.productId,
    fromLocation: args.fromLocation,
    toLocation: args.toLocation,
    quantity: qty,
    orderId: args.orderId,
    productionOrderId: args.productionOrderId,
    reason: args.reason ?? "transfer",
    movedBy: args.movedBy,
    notes: args.notes,
  });
  queryClient.invalidateQueries({ queryKey: ["stock-locations"] });
  queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
}

export interface IntakeBatchStockArgs {
  planProductId: string;
  productId: string;
  toLocation: StockLocation;
  quantity: number;
  orderId?: string;
  reason?: StockMovementReason | string;
  movedBy?: string;
  notes?: string;
}

/** Record an intake (external source → location). Use this at unmould to
 *  land the produced pieces into Production Storage. */
export async function intakeBatchStock(args: IntakeBatchStockArgs): Promise<void> {
  const qty = Math.max(0, Math.round(args.quantity));
  if (qty === 0) return;
  const toOrderId = args.toLocation === "allocated" ? args.orderId ?? null : null;
  await upsertStockLocationRow(args.planProductId, args.toLocation, toOrderId, qty);
  await logStockMovement({
    planProductId: args.planProductId,
    productId: args.productId,
    fromLocation: undefined,
    toLocation: args.toLocation,
    quantity: qty,
    orderId: args.orderId,
    reason: args.reason ?? "unmould",
    movedBy: args.movedBy,
    notes: args.notes,
  });
  queryClient.invalidateQueries({ queryKey: ["stock-locations"] });
  queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
}

export interface OutakeBatchStockArgs {
  planProductId: string;
  productId: string;
  fromLocation: StockLocation;
  quantity: number;
  orderId?: string;
  reason: StockMovementReason | string;
  movedBy?: string;
  notes?: string;
}

/** Record an exit (location → external). Use for sales, waste, breakage,
 *  or discarding stock. `reason` is required — it's the classification the
 *  variance report groups by. */
export async function outakeBatchStock(args: OutakeBatchStockArgs): Promise<void> {
  const qty = Math.max(0, Math.round(args.quantity));
  if (qty === 0) return;
  const fromOrderId = args.fromLocation === "allocated" ? args.orderId ?? null : null;
  await upsertStockLocationRow(args.planProductId, args.fromLocation, fromOrderId, -qty);
  await logStockMovement({
    planProductId: args.planProductId,
    productId: args.productId,
    fromLocation: args.fromLocation,
    toLocation: undefined,
    quantity: qty,
    orderId: args.orderId,
    reason: args.reason,
    movedBy: args.movedBy,
    notes: args.notes,
  });
  queryClient.invalidateQueries({ queryKey: ["stock-locations"] });
  queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
}

// ---------------------------------------------------------------
// FIFO allocation across batches
// ---------------------------------------------------------------
//
// Moving stock for a PRODUCT (not a specific batch) — pull oldest sell-by
// first. Used by sale fulfilment, store replenishment, and anywhere the
// UI says "deduct N pieces of this product" without picking a batch.

export interface FifoMoveResult {
  planProductId: string;
  quantity: number;
}

export interface FifoMoveArgs {
  productId: string;
  fromLocation: StockLocation;
  toLocation: StockLocation | null; // null = outake (sale/waste)
  quantity: number;
  orderId?: string;
  reason?: StockMovementReason | string;
  movedBy?: string;
  notes?: string;
}

/** Move up to `quantity` pieces of `productId` from `fromLocation`, FIFO by
 *  batch sell-by (oldest first). Returns which batches were drained and by
 *  how much. Short-stocks silently (returns less than requested) — callers
 *  are expected to check the sum for shortfall handling. */
export async function moveProductStockFifo(args: FifoMoveArgs): Promise<FifoMoveResult[]> {
  const wanted = Math.max(0, Math.round(args.quantity));
  if (wanted === 0) return [];

  // Candidate batches in `fromLocation` for this product.
  const batches = assertOk(
    await supabase.from("planProducts").select("*").eq("productId", args.productId),
  ) as PlanProduct[];
  if (batches.length === 0) return [];
  const batchIds = batches.map((b) => b.id!);
  const plans = assertOk(
    await supabase.from("productionPlans").select("id, completedAt").in("id", batches.map((b) => b.planId)),
  ) as Array<{ id: string; completedAt?: string | Date | null }>;
  const planById = new Map(plans.map((p) => [p.id, p] as const));
  const fromOrderId = args.fromLocation === "allocated" ? args.orderId ?? null : null;
  const locsQ = supabase
    .from("stockLocations")
    .select("*")
    .eq("location", args.fromLocation)
    .in("planProductId", batchIds);
  const locs = assertOk(
    await (fromOrderId == null ? locsQ.is("orderId", null) : locsQ.eq("orderId", fromOrderId)),
  ) as StockLocationRow[];

  // Sort by production-plan completedAt ASC (oldest first). Batches without
  // a completedAt sort last — they're not yet in stock anyway.
  const product = assertOkMaybe(
    await supabase.from("products").select("shelfLifeWeeks").eq("id", args.productId).maybeSingle(),
  ) as { shelfLifeWeeks?: string } | null;
  const shelfWeeks = product?.shelfLifeWeeks ? parseFloat(product.shelfLifeWeeks) : NaN;
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const batchById = new Map(batches.map((b) => [b.id!, b] as const));
  const sellByFor = (planProductId: string): number => {
    const b = batchById.get(planProductId);
    if (!b) return Infinity;
    const plan = planById.get(b.planId);
    if (!plan?.completedAt) return Infinity;
    const completed = new Date(plan.completedAt).getTime();
    if (b.defrostedAt && b.preservedShelfLifeDays != null) {
      return b.defrostedAt + b.preservedShelfLifeDays * 24 * 60 * 60 * 1000;
    }
    return !isNaN(shelfWeeks) && shelfWeeks > 0 ? completed + shelfWeeks * WEEK : completed;
  };
  const sorted = [...locs].sort(
    (a, b) => sellByFor(a.planProductId) - sellByFor(b.planProductId),
  );

  const results: FifoMoveResult[] = [];
  let remaining = wanted;
  for (const row of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(row.quantity, remaining);
    if (take <= 0) continue;
    const batch = batchById.get(row.planProductId)!;
    if (args.toLocation) {
      await transferBatchStock({
        planProductId: row.planProductId,
        productId: batch.productId,
        fromLocation: args.fromLocation,
        toLocation: args.toLocation,
        quantity: take,
        orderId: args.orderId,
        reason: args.reason,
        movedBy: args.movedBy,
        notes: args.notes,
      });
    } else {
      await outakeBatchStock({
        planProductId: row.planProductId,
        productId: batch.productId,
        fromLocation: args.fromLocation,
        quantity: take,
        orderId: args.orderId,
        reason: args.reason ?? "sold",
        movedBy: args.movedBy,
        notes: args.notes,
      });
    }
    results.push({ planProductId: row.planProductId, quantity: take });
    remaining -= take;
  }
  return results;
}

// ---------------------------------------------------------------
// Waste log
// ---------------------------------------------------------------

export function useWasteLog(productId?: string): WasteLogEntry[] {
  const { data } = useQuery({
    queryKey: ["waste-log", productId ?? "all"],
    queryFn: async () => {
      const q = supabase.from("wasteLog").select("*").order("loggedAt", { ascending: false });
      return assertOk(
        await (productId ? q.eq("productId", productId) : q),
      ) as WasteLogEntry[];
    },
  });
  return data ?? [];
}

export async function logBatchWaste(entry: Omit<WasteLogEntry, "id" | "loggedAt"> & { loggedAt?: Date }): Promise<string> {
  const id = newId();
  const { error } = await supabase.from("wasteLog").insert({
    id,
    ...entry,
    loggedAt: entry.loggedAt ?? new Date(),
  });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["waste-log"] });
  return id;
}

// ---------------------------------------------------------------
// Unmould intake + waste
// ---------------------------------------------------------------

export interface UnmouldIntakeArgs {
  planProductId: string;
  productId: string;
  /** Pieces that came out of the mould and are now in Production Storage. */
  actualYield: number;
  /** Pieces that were planned (moulds × cavities). The difference goes to waste. */
  planned: number;
  reason?: string;
  movedBy?: string;
}

/** Single entry-point for unmould completion. Lands `actualYield` pieces in
 *  Production Storage via a stockLocations row + movement, and logs any
 *  yield shortfall in wasteLog. Idempotent on re-run for the same
 *  planProductId by checking for an existing `reason='unmould'` movement. */
export async function recordUnmouldIntake(args: UnmouldIntakeArgs): Promise<void> {
  const yielded = Math.max(0, Math.round(args.actualYield));
  const planned = Math.max(0, Math.round(args.planned));

  const existing = assertOk(
    await supabase
      .from("stockMovements")
      .select("id")
      .eq("planProductId", args.planProductId)
      .eq("reason", "unmould")
      .limit(1),
  ) as Array<{ id: string }>;
  if (existing.length > 0) return;

  if (yielded > 0) {
    await intakeBatchStock({
      planProductId: args.planProductId,
      productId: args.productId,
      toLocation: "production",
      quantity: yielded,
      reason: "unmould",
      movedBy: args.movedBy,
      notes: args.reason,
    });
  }
  const waste = Math.max(0, planned - yielded);
  if (waste > 0) {
    await logBatchWaste({
      planProductId: args.planProductId,
      productId: args.productId,
      quantity: waste,
      reason: args.reason,
      loggedBy: args.movedBy,
    });
  }
}

/** After an unmould yield is recorded, warn if any open order for the same
 *  product has a deadline so close that the remaining planned production
 *  (across all not-yet-done plans for this product) plus current stock in
 *  Production Storage may not cover it. Pure computation — no DB writes. */
export async function checkDeadlineImpactForProduct(productId: string): Promise<Array<{
  orderId: string;
  orderName: string;
  deadline: Date;
  required: number;
  projected: number;
  shortfall: number;
}>> {
  const [openOrders, orderItems, batches, donePlans, stockLocations] = await Promise.all([
    supabase.from("orders").select("*").in("status", ["pending", "in_production"]).then((r) => assertOk(r) as Order[]),
    supabase.from("orderItems").select("*").eq("productId", productId).then((r) => assertOk(r) as OrderItem[]),
    supabase.from("planProducts").select("*").eq("productId", productId).then((r) => assertOk(r) as PlanProduct[]),
    supabase.from("productionPlans").select("id, status, completedAt").then((r) => assertOk(r) as Array<Pick<ProductionPlan, "id" | "status" | "completedAt">>),
    supabase.from("stockLocations").select("*").eq("location", "production").then((r) => assertOk(r) as StockLocationRow[]),
  ]);

  const planById = new Map(donePlans.map((p) => [p.id, p] as const));
  const mouldIds = Array.from(new Set(batches.map((b) => b.mouldId).filter(Boolean)));
  const moulds = mouldIds.length > 0
    ? (assertOk(await supabase.from("moulds").select("*").in("id", mouldIds)) as Mould[])
    : [];
  const mouldById = new Map(moulds.map((m) => [m.id!, m] as const));

  // Total stock currently in Production Storage for this product.
  const batchIds = new Set(batches.map((b) => b.id!));
  const stockOnHand = stockLocations
    .filter((r) => batchIds.has(r.planProductId))
    .reduce((acc, r) => acc + r.quantity, 0);

  // Planned capacity from every not-yet-done plan batch for this product,
  // minus the yield the batch has already produced.
  const remainingPlanned = batches.reduce((acc, pb) => {
    const plan = planById.get(pb.planId);
    if (plan?.status === "done") return acc;
    const mould = mouldById.get(pb.mouldId);
    if (!mould) return acc;
    const expected = mould.numberOfCavities * pb.quantity;
    const yielded = pb.actualYield ?? 0;
    return acc + Math.max(0, expected - yielded);
  }, 0);

  const projected = stockOnHand + remainingPlanned;

  const ordersById = new Map(openOrders.map((o) => [o.id!, o] as const));
  const ordersWithItem = orderItems
    .map((oi) => ({ order: ordersById.get(oi.orderId), quantity: oi.quantity }))
    .filter((x): x is { order: Order; quantity: number } => !!x.order);

  let running = projected;
  const issues: Array<{ orderId: string; orderName: string; deadline: Date; required: number; projected: number; shortfall: number }> = [];
  // Walk orders in deadline order — earliest first consumes projected first.
  ordersWithItem.sort((a, b) => new Date(a.order.deadline).getTime() - new Date(b.order.deadline).getTime());
  for (const { order, quantity } of ordersWithItem) {
    const shortfall = Math.max(0, quantity - running);
    if (shortfall > 0) {
      issues.push({
        orderId: order.id!,
        orderName: order.customerName || order.eventName || "Order",
        deadline: new Date(order.deadline),
        required: quantity,
        projected: Math.max(0, running),
        shortfall,
      });
    }
    running = Math.max(0, running - quantity);
  }
  return issues;
}

// ---------------------------------------------------------------
// Customers (Phase 7 — B2B CRM)
// ---------------------------------------------------------------

export function useCustomers(includeArchived = false): Customer[] {
  const { data } = useQuery({
    queryKey: ["customers", { includeArchived }],
    queryFn: async () => {
      const rows = assertOk(await supabase.from("customers").select("*")) as Customer[];
      return rows
        .filter((c) => includeArchived || !c.archived)
        .sort((a, b) => a.companyName.localeCompare(b.companyName));
    },
  });
  return data ?? [];
}

export function useCustomer(id: string | undefined): Customer | null | undefined {
  const { data } = useQuery({
    queryKey: ["customers", "one", id],
    enabled: !!id,
    queryFn: async () => assertOkMaybe(
      await supabase.from("customers").select("*").eq("id", id!).maybeSingle(),
    ) as Customer | null,
  });
  return data;
}

export async function saveCustomer(c: Omit<Customer, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<string> {
  const now = new Date();
  if (c.id) {
    const { error } = await supabase
      .from("customers")
      .update({ ...c, updatedAt: now })
      .eq("id", c.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["customers"] });
    return c.id;
  }
  const id = newId();
  const { error } = await supabase
    .from("customers")
    .insert({ ...c, id, createdAt: now, updatedAt: now });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["customers"] });
  return id;
}

export async function setCustomerArchived(id: string, archived: boolean): Promise<void> {
  const { error } = await supabase
    .from("customers")
    .update({ archived, updatedAt: new Date() })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["customers"] });
}

// Contact log

export function useCustomerContacts(customerId: string | undefined): CustomerContact[] {
  const { data } = useQuery({
    queryKey: ["customer-contacts", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("customerContacts").select("*").eq("customerId", customerId!)
          .order("contactedAt", { ascending: false }),
      ) as CustomerContact[];
      return rows;
    },
  });
  return data ?? [];
}

export async function saveCustomerContact(entry: Omit<CustomerContact, "id" | "createdAt"> & { id?: string }): Promise<string> {
  const now = new Date();
  if (entry.id) {
    const { error } = await supabase.from("customerContacts").update(entry).eq("id", entry.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["customer-contacts"] });
    return entry.id;
  }
  const id = newId();
  const { error } = await supabase
    .from("customerContacts")
    .insert({ ...entry, id, createdAt: now });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["customer-contacts"] });
  return id;
}

export async function deleteCustomerContact(id: string): Promise<void> {
  const { error } = await supabase.from("customerContacts").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["customer-contacts"] });
}

// Follow-ups

export function useCustomerFollowups(customerId?: string): CustomerFollowup[] {
  const { data } = useQuery({
    queryKey: ["customer-followups", customerId ?? "all"],
    queryFn: async () => {
      const q = supabase.from("customerFollowups").select("*").order("dueDate", { ascending: true });
      const rows = assertOk(
        await (customerId ? q.eq("customerId", customerId) : q),
      ) as CustomerFollowup[];
      return rows;
    },
  });
  return data ?? [];
}

export async function saveCustomerFollowup(entry: Omit<CustomerFollowup, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<string> {
  const now = new Date();
  if (entry.id) {
    const { error } = await supabase
      .from("customerFollowups")
      .update({ ...entry, updatedAt: now })
      .eq("id", entry.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["customer-followups"] });
    return entry.id;
  }
  const id = newId();
  const { error } = await supabase
    .from("customerFollowups")
    .insert({ ...entry, id, createdAt: now, updatedAt: now });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["customer-followups"] });
  return id;
}

export async function completeCustomerFollowup(id: string, completed: boolean): Promise<void> {
  const { error } = await supabase
    .from("customerFollowups")
    .update({ completedAt: completed ? new Date() : null, updatedAt: new Date() })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["customer-followups"] });
}

export async function deleteCustomerFollowup(id: string): Promise<void> {
  const { error } = await supabase.from("customerFollowups").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["customer-followups"] });
}

// Quotes

export function useQuotes(filter?: { customerId?: string; status?: Quote["status"] }): Quote[] {
  const { data } = useQuery({
    queryKey: ["quotes", filter ?? null],
    queryFn: async () => {
      let q = supabase.from("quotes").select("*").order("createdAt", { ascending: false });
      if (filter?.customerId) q = q.eq("customerId", filter.customerId);
      if (filter?.status) q = q.eq("status", filter.status);
      const rows = assertOk(await q) as Quote[];
      // The JSON columns come back as parsed objects — they don't need post-processing here.
      return rows;
    },
  });
  return data ?? [];
}

export function useQuote(id: string | undefined): Quote | null | undefined {
  const { data } = useQuery({
    queryKey: ["quotes", "one", id],
    enabled: !!id,
    queryFn: async () => assertOkMaybe(
      await supabase.from("quotes").select("*").eq("id", id!).maybeSingle(),
    ) as Quote | null,
  });
  return data;
}

export async function saveQuote(q: Omit<Quote, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<string> {
  const now = new Date();
  // Map the flat TS Quote onto the DB shape (items + costBreakdown live in jsonb
  // columns, so we pass them through as-is).
  const payload: Record<string, unknown> = {
    customerId: q.customerId ?? null,
    isWhatIf: q.isWhatIf,
    title: q.title,
    status: q.status,
    deadline: q.deadline ?? null,
    itemsJson: q.items ?? [],
    costBreakdownJson: q.costBreakdown ?? null,
    totalCost: q.totalCost ?? null,
    sellPrice: q.sellPrice ?? null,
    marginPercent: q.marginPercent ?? null,
    labourHoursEstimate: q.labourHoursEstimate ?? null,
    retailComparePct: q.retailComparePct ?? null,
    feasible: q.feasible ?? null,
    feasibilityNote: q.feasibilityNote ?? null,
    expiresAt: q.expiresAt ?? null,
    convertedToOrderId: q.convertedToOrderId ?? null,
    notes: q.notes ?? null,
    updatedAt: now,
  };
  if (q.id) {
    const { error } = await supabase.from("quotes").update(payload).eq("id", q.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["quotes"] });
    return q.id;
  }
  const id = newId();
  const { error } = await supabase.from("quotes").insert({ ...payload, id, createdAt: now });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["quotes"] });
  return id;
}

export async function deleteQuote(id: string): Promise<void> {
  const { error } = await supabase.from("quotes").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["quotes"] });
}

/** Rehydrate a raw DB row into the flat TS Quote shape (items/costBreakdown
 *  come back in *Json columns). */
export function quoteFromRow(row: Record<string, unknown>): Quote {
  return {
    id: row.id as string,
    customerId: (row.customerId as string) ?? undefined,
    isWhatIf: Boolean(row.isWhatIf),
    title: (row.title as string) ?? "",
    status: (row.status as Quote["status"]) ?? "draft",
    deadline: row.deadline ? new Date(row.deadline as string) : undefined,
    items: (row.itemsJson as Quote["items"]) ?? [],
    costBreakdown: (row.costBreakdownJson as Quote["costBreakdown"]) ?? undefined,
    totalCost: row.totalCost == null ? undefined : Number(row.totalCost),
    sellPrice: row.sellPrice == null ? undefined : Number(row.sellPrice),
    marginPercent: row.marginPercent == null ? undefined : Number(row.marginPercent),
    labourHoursEstimate: row.labourHoursEstimate == null ? undefined : Number(row.labourHoursEstimate),
    retailComparePct: row.retailComparePct == null ? undefined : Number(row.retailComparePct),
    feasible: row.feasible == null ? undefined : Boolean(row.feasible),
    feasibilityNote: (row.feasibilityNote as string) ?? undefined,
    expiresAt: row.expiresAt ? new Date(row.expiresAt as string) : undefined,
    convertedToOrderId: (row.convertedToOrderId as string) ?? undefined,
    notes: (row.notes as string) ?? undefined,
    createdAt: row.createdAt ? new Date(row.createdAt as string) : undefined,
    updatedAt: row.updatedAt ? new Date(row.updatedAt as string) : undefined,
  };
}

/** Convert a quote into a confirmed order. Creates an Order row + OrderItem
 *  rows from the quote's items, links the quote back via convertedToOrderId,
 *  and bumps the quote status to 'won'. Returns the new order id. */
export async function convertQuoteToOrder(
  quoteId: string,
  overrides?: { deadline?: string | Date },
): Promise<string> {
  const row = assertOkMaybe(
    await supabase.from("quotes").select("*").eq("id", quoteId).maybeSingle(),
  );
  if (!row) throw new Error(`Quote ${quoteId} not found`);
  const quote = quoteFromRow(row as Record<string, unknown>);

  // Must have a customer to convert — What-If quotes can't become orders.
  if (quote.isWhatIf || !quote.customerId) {
    throw new Error("What-If quotes cannot be converted into orders");
  }

  const now = new Date();
  const orderId = newId();
  const customer = assertOkMaybe(
    await supabase.from("customers").select("*").eq("id", quote.customerId).maybeSingle(),
  ) as Customer | null;

  // Deadline: override wins, then the quote's deadline, and only then
  // fall back to "now" (caller is expected to have prompted for one
  // when the quote had none — we don't silently ship with now).
  const deadline = overrides?.deadline ?? quote.deadline ?? now;

  // Channel inference from customer.type. Private → online (catch-all
  // for individual buyers); B2B → b2b; otherwise leave as b2b.
  const channel: OrderChannel = customer?.type === "private" ? "online" : "b2b";

  const { error: insOrderErr } = await supabase.from("orders").insert({
    id: orderId,
    channel,
    customerId: quote.customerId,
    customerName: customer?.companyName ?? "",
    deadline,
    priority: "normal",
    status: "pending",
    notes: quote.notes ?? null,
    createdAt: now,
    updatedAt: now,
  });
  if (insOrderErr) throw insOrderErr;

  // Product-line items — anything with a productId and no box contents.
  const productLines = quote.items.filter((it) => it.productId && !(it.boxContents && it.boxContents.length > 0));
  if (productLines.length > 0) {
    const { error: insItemsErr } = await supabase.from("orderItems").insert(
      productLines.map((it, i) => ({
        id: newId(),
        orderId,
        productId: it.productId!,
        quantity: it.quantity,
        unitPrice: it.unitPrice ?? null,
        sortOrder: i,
        notes: it.notes ?? null,
      })),
    );
    if (insItemsErr) throw insItemsErr;
  }

  // Box lines → orderBoxes rows (legacy B2B gift-box composition).
  const boxLines = quote.items.filter((it) => it.boxContents && it.boxContents.length > 0);
  if (boxLines.length > 0) {
    const { error: insBoxesErr } = await supabase.from("orderBoxes").insert(
      boxLines.map((it, i) => ({
        id: newId(),
        orderId,
        packagingId: it.packagingId ?? null,
        quantity: it.quantity,
        priceOverride: it.unitPrice ?? null,
        contentsJson: it.boxContents ?? [],
        sortOrder: i,
        notes: it.notes ?? null,
        createdAt: now,
        updatedAt: now,
      })),
    );
    if (insBoxesErr) throw insBoxesErr;
  }

  // Standalone packaging lines (packagingId set, no productId, no box
  // contents) → orderPackagingLines. These didn't make it across in
  // the original convert path, leaving ribbons + outer boxes off the
  // order.
  const packagingOnlyLines = quote.items.filter(
    (it) => it.packagingId && !it.productId && !(it.boxContents && it.boxContents.length > 0),
  );
  if (packagingOnlyLines.length > 0) {
    const { error: insPackErr } = await supabase.from("orderPackagingLines").insert(
      packagingOnlyLines.map((it, i) => ({
        id: newId(),
        orderId,
        packagingId: it.packagingId!,
        quantity: it.quantity,
        unitPrice: it.unitPrice ?? null,
        sortOrder: i,
        notes: it.notes ?? null,
        createdAt: now,
        updatedAt: now,
      })),
    );
    if (insPackErr) throw insPackErr;
  }

  // Update quote status + link back to order.
  const { error: updQErr } = await supabase
    .from("quotes")
    .update({ status: "won", convertedToOrderId: orderId, updatedAt: now })
    .eq("id", quoteId);
  if (updQErr) throw updQErr;

  queryClient.invalidateQueries({ queryKey: ["quotes"] });
  queryClient.invalidateQueries({ queryKey: ["orders"] });
  queryClient.invalidateQueries({ queryKey: ["order-items"] });
  queryClient.invalidateQueries({ queryKey: ["order-packaging-lines"] });
  return orderId;
}

// Order boxes

export function useOrderBoxes(orderId: string | undefined): OrderBox[] {
  const { data } = useQuery({
    queryKey: ["order-boxes", orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("orderBoxes").select("*").eq("orderId", orderId!).order("sortOrder"),
      ) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        id: r.id as string,
        orderId: r.orderId as string,
        packagingId: (r.packagingId as string) ?? undefined,
        quantity: Number(r.quantity),
        priceOverride: r.priceOverride == null ? undefined : Number(r.priceOverride),
        contents: (r.contentsJson as Array<{ productId: string; pieces: number }>) ?? [],
        sortOrder: Number(r.sortOrder ?? 0),
        notes: (r.notes as string) ?? undefined,
        createdAt: r.createdAt ? new Date(r.createdAt as string) : undefined,
        updatedAt: r.updatedAt ? new Date(r.updatedAt as string) : undefined,
      }) as OrderBox);
    },
  });
  return data ?? [];
}

// ---------------------------------------------------------------
// Phase 6 — Online order import (Shopify CSV)
// ---------------------------------------------------------------

export interface OnlineOrderImportInput {
  sourceRef: string;
  customerName?: string;
  email?: string;
  placedAt?: string;
  shippingAddress?: string;
  phone?: string;
  deadline: string;
  /** Each line is either a single product OR a curated variant (with size).
   *  Variant lines spawn their composition as derived orderItems via
   *  addVariantToOrder. */
  items: Array<
    | {
        kind?: "product";
        productId: string;
        quantity: number;
        unitPrice?: number;
        notes?: string;
        fulfilmentMode?: "produce" | "borrow";
      }
    | {
        kind: "variant";
        variantId: string;
        variantPackagingId?: string | null;
        quantity: number;
        unitPrice?: number;
        notes?: string;
        fulfilmentMode?: "produce" | "borrow";
      }
  >;
}

/** Import multiple online orders (+ their items). Rows whose
 *  `sourceRef` already exists in the database are skipped — re-
 *  importing the same Shopify CSV is a no-op for already-imported
 *  orders. Returns how many new orders landed. */
export async function importOnlineOrders(input: OnlineOrderImportInput[]): Promise<number> {
  if (input.length === 0) return 0;

  const refs = input.map((o) => o.sourceRef);
  const existing = assertOk(
    await supabase.from("orders").select("id, sourceRef").in("sourceRef", refs),
  ) as Array<{ id: string; sourceRef: string }>;
  const existingRefs = new Set(existing.map((e) => e.sourceRef));
  const fresh = input.filter((o) => !existingRefs.has(o.sourceRef));
  if (fresh.length === 0) return 0;

  const now = new Date();
  const orderRows = fresh.map((o) => {
    const fulfillment = o.shippingAddress ? "ship" : "pickup";
    return {
      id: newId(),
      channel: "online",
      customerName: o.customerName ?? o.email ?? null,
      customerId: null,
      deadline: o.deadline,
      priority: "normal",
      status: "pending",
      notes: o.email ? `Email: ${o.email}` : null,
      sourceRef: o.sourceRef,
      deliveryAddress: o.shippingAddress ?? null,
      deliveryType: fulfillment,
      // Mirror to the production-brain field so /orders + /plan can
      // surface pickup/ship pills without re-deriving from the legacy
      // `deliveryType`.
      fulfillmentType: fulfillment,
      createdAt: o.placedAt ?? now,
      updatedAt: now,
    };
  });

  const { error: insOrdersErr } = await supabase.from("orders").insert(orderRows);
  if (insOrdersErr) throw insOrdersErr;

  // Pre-fetch variant composition once for all variant-kind items so
  // addVariantToOrder calls don't re-query per line.
  const variantIds = new Set<string>();
  const variantPackagingIds = new Set<string>();
  for (const o of fresh) {
    for (const it of o.items) {
      if (it.kind === "variant") {
        variantIds.add(it.variantId);
        if (it.variantPackagingId) variantPackagingIds.add(it.variantPackagingId);
      }
    }
  }
  const compositionByVp = new Map<string, Array<{ productId: string; qty: number }>>();
  if (variantPackagingIds.size > 0) {
    const vps = assertOk(
      await supabase
        .from("variantPackagingProducts")
        .select("*")
        .in("variantPackagingId", [...variantPackagingIds]),
    ) as VariantPackagingProduct[];
    for (const v of vps) {
      const arr = compositionByVp.get(v.variantPackagingId) ?? [];
      arr.push({ productId: v.productId, qty: v.qty });
      compositionByVp.set(v.variantPackagingId, arr);
    }
  }

  // Walk every fresh order, splitting items into product + variant
  // paths. Product items batch-insert. Variant items go through
  // addVariantToOrder so derived orderItems get spawned correctly.
  type ProductItemRow = {
    id: string;
    orderId: string;
    productId: string;
    quantity: number;
    unitPrice: number | null;
    sortOrder: number;
    notes: string | null;
    fulfilmentMode: "produce" | "borrow";
  };
  const productItemRows: ProductItemRow[] = [];
  for (let oi = 0; oi < fresh.length; oi++) {
    const o = fresh[oi];
    const orderId = orderRows[oi].id;
    let sortIdx = 0;
    for (const it of o.items) {
      if (it.kind === "variant") {
        const composition = it.variantPackagingId
          ? compositionByVp.get(it.variantPackagingId) ?? []
          : [];
        await addVariantToOrder({
          orderId,
          variantId: it.variantId,
          variantPackagingId: it.variantPackagingId ?? null,
          quantity: it.quantity,
          unitPrice: it.unitPrice ?? 0,
          composition,
          fulfilmentMode: it.fulfilmentMode ?? CHANNEL_FULFILMENT_DEFAULTS.online,
        });
      } else {
        productItemRows.push({
          id: newId(),
          orderId,
          productId: it.productId,
          quantity: it.quantity,
          unitPrice: it.unitPrice ?? null,
          sortOrder: sortIdx++,
          notes: it.notes ?? null,
          fulfilmentMode: it.fulfilmentMode ?? CHANNEL_FULFILMENT_DEFAULTS.online,
        });
      }
    }
  }
  if (productItemRows.length > 0) {
    const { error: insItemsErr } = await supabase.from("orderItems").insert(productItemRows);
    if (insItemsErr) throw insItemsErr;
  }

  // Variant-aware allocation:
  //   1. For each new order, try to reserve pre-built variant boxes
  //      from variantStockLocations.store. Returns the set of variant
  //      sizes that ended up fully covered.
  //   2. Loose-piece allocation runs only for derived orderItems whose
  //      parent variantLine is NOT covered (or for non-variant items).
  //      Avoids double-counting when a Mothersday Box of 4 already
  //      sits pre-built on the shelf.
  const newOrderIds = orderRows.map((o) => o.id);
  const coveredByOrder = new Map<string, Set<string>>();
  for (const oid of newOrderIds) {
    try {
      coveredByOrder.set(oid, await tryAllocateVariantLinesFromStock(oid));
    } catch (e) {
      console.warn(`[importOnlineOrders] tryAllocateVariantLines failed for ${oid}:`, e);
      coveredByOrder.set(oid, new Set<string>());
    }
  }

  // Loose piece allocation for derived orderItems on the same orders.
  // Read all derived rows so we can check parent-variant coverage; the
  // batched insert above has already written productItemRows, but
  // variant-driven items came through addVariantToOrder.
  const derivedItems = newOrderIds.length > 0
    ? assertOk(
        await supabase
          .from("orderItems")
          .select("id, orderId, productId, quantity, fulfilmentMode, variantPackagingId")
          .in("orderId", newOrderIds),
      ) as Array<{
        id: string;
        orderId: string;
        productId: string;
        quantity: number;
        fulfilmentMode: string | null;
        variantPackagingId: string | null;
      }>
    : [];
  for (const row of derivedItems) {
    if ((row.fulfilmentMode ?? "produce") !== "borrow") continue;
    if (row.variantPackagingId) {
      const covered = coveredByOrder.get(row.orderId);
      if (covered?.has(row.variantPackagingId)) continue; // already covered by box stock
    }
    try {
      await allocateLineFromStore({
        orderId: row.orderId,
        productId: row.productId,
        quantity: row.quantity,
      });
    } catch (e) {
      console.warn(
        `[importOnlineOrders] borrow allocation failed for order ${row.orderId}, product ${row.productId} — flipping to produce so reconciler picks it up:`,
        e,
      );
      // Stock short → flip this orderItem to fulfilmentMode='produce'
      // so the next Regenerate creates a batch. Without this the line
      // stays in borrow mode forever and the order is stuck pending.
      const flipErr = await supabase
        .from("orderItems")
        .update({ fulfilmentMode: "produce" })
        .eq("id", row.id);
      if (flipErr.error) {
        console.warn(`[importOnlineOrders] failed to flip orderItem ${row.id} to produce:`, flipErr.error);
      }
    }
  }

  // Promote any fully-allocated orders to ready_to_pack so the operator
  // sees a clear "ship me" badge without drilling in.
  for (const oid of newOrderIds) {
    try {
      await refreshOrderReadyStatus(oid);
    } catch (e) {
      console.warn(`[importOnlineOrders] refreshOrderReadyStatus failed for ${oid}:`, e);
    }
  }

  queryClient.invalidateQueries({ queryKey: ["orders"] });
  queryClient.invalidateQueries({ queryKey: ["order-items"] });
  queryClient.invalidateQueries({ queryKey: ["order-variant-lines"] });
  queryClient.invalidateQueries({ queryKey: ["stock-locations"] });
  queryClient.invalidateQueries({ queryKey: ["variant-stock-locations"] });
  return fresh.length;
}

/** Ship an online order: deduct required pieces from Production Storage
 *  FIFO and mark the order 'done'. Short stock is tolerated — the
 *  fulfilment view surfaces the shortage first. */
export async function shipOnlineOrder(orderId: string): Promise<void> {
  const order = assertOkMaybe(
    await supabase.from("orders").select("*").eq("id", orderId).maybeSingle(),
  ) as Order | null;
  if (!order) throw new Error(`Order ${orderId} not found`);
  const items = assertOk(
    await supabase.from("orderItems").select("*").eq("orderId", orderId),
  ) as OrderItem[];

  for (const it of items) {
    await moveProductStockFifo({
      productId: it.productId,
      fromLocation: "production",
      toLocation: null,
      quantity: it.quantity,
      orderId,
      reason: "sold",
    });
  }
  const { error } = await supabase
    .from("orders")
    .update({ status: "done", updatedAt: new Date() })
    .eq("id", orderId);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["orders"] });
  queryClient.invalidateQueries({ queryKey: ["stock-locations"] });
  queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
}

// ---------------------------------------------------------------
// Phase 3 — Packaging numeric stock + consumption
// ---------------------------------------------------------------

/** Add stock to a packaging type. Called when a new PackagingOrder is
 *  received; also exposed for manual adjustments. Clears the
 *  `lowStock` / `outOfStock` flags when the new total is back above
 *  the threshold. */
export async function addPackagingStock(packagingId: string, quantity: number): Promise<void> {
  if (quantity <= 0) return;
  const row = assertOkMaybe(
    await supabase.from("packaging").select("quantityOnHand, lowStockThreshold").eq("id", packagingId).maybeSingle(),
  ) as { quantityOnHand?: number; lowStockThreshold?: number } | null;
  const current = row?.quantityOnHand ?? 0;
  const next = current + Math.round(quantity);
  const threshold = row?.lowStockThreshold;
  const patch: Record<string, unknown> = { quantityOnHand: next, updatedAt: new Date() };
  if (threshold != null && next >= threshold) {
    patch.lowStock = false;
    patch.outOfStock = false;
  }
  const { error } = await supabase.from("packaging").update(patch).eq("id", packagingId);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["packaging"] });
}

export interface ConsumePackagingArgs {
  packagingId: string;
  quantity: number;
  planId?: string;
  planProductId?: string;
  orderId?: string;
  loggedBy?: string;
  note?: string;
}

/** Decrement packaging stock and append a consumption log entry. Called
 *  by the Packing step. Clamps to the current quantity so we never go
 *  below zero; returns the actual amount decremented (caller should
 *  warn if `actual < requested`). */
export async function consumePackaging(args: ConsumePackagingArgs): Promise<number> {
  const row = assertOkMaybe(
    await supabase.from("packaging").select("quantityOnHand, lowStockThreshold").eq("id", args.packagingId).maybeSingle(),
  ) as { quantityOnHand?: number; lowStockThreshold?: number } | null;
  const current = row?.quantityOnHand ?? 0;
  const requested = Math.max(0, Math.round(args.quantity));
  const actual = Math.min(current, requested);
  if (actual === 0) return 0;

  const next = current - actual;
  const threshold = row?.lowStockThreshold;
  const patch: Record<string, unknown> = { quantityOnHand: next, updatedAt: new Date() };
  if (next === 0) {
    patch.outOfStock = true;
    patch.lowStock = true;
    patch.lowStockSince = Date.now();
  } else if (threshold != null && next < threshold) {
    patch.lowStock = true;
    if (current >= threshold) patch.lowStockSince = Date.now();
  }

  const { error: upErr } = await supabase.from("packaging").update(patch).eq("id", args.packagingId);
  if (upErr) throw upErr;

  const { error: logErr } = await supabase.from("packagingConsumption").insert({
    id: newId(),
    packagingId: args.packagingId,
    quantity: actual,
    planId: args.planId ?? null,
    planProductId: args.planProductId ?? null,
    orderId: args.orderId ?? null,
    loggedBy: args.loggedBy ?? null,
    note: args.note ?? null,
    loggedAt: new Date(),
  });
  if (logErr) throw logErr;

  queryClient.invalidateQueries({ queryKey: ["packaging"] });
  queryClient.invalidateQueries({ queryKey: ["packaging-consumption"] });
  return actual;
}

export function usePackagingConsumption(packagingId?: string): PackagingConsumption[] {
  const { data } = useQuery({
    queryKey: ["packaging-consumption", packagingId ?? "all"],
    queryFn: async () => {
      const q = supabase.from("packagingConsumption").select("*").order("loggedAt", { ascending: false });
      return assertOk(
        await (packagingId ? q.eq("packagingId", packagingId) : q),
      ) as PackagingConsumption[];
    },
  });
  return data ?? [];
}

// ---------------------------------------------------------------
// Phase 1 HACCP — production days + temperature log
// ---------------------------------------------------------------

function todayDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function useTodayProductionDay(): ProductionDay | null | undefined {
  const { data } = useQuery({
    queryKey: ["production-day", "today"],
    queryFn: async () => {
      const today = todayDateString();
      const row = assertOkMaybe(
        await supabase.from("productionDays").select("*").eq("date", today).maybeSingle(),
      ) as ProductionDay | null;
      return row ?? null;
    },
  });
  return data;
}

export function useProductionDays(limit = 30): ProductionDay[] {
  const { data } = useQuery({
    queryKey: ["production-days", limit],
    queryFn: async () =>
      assertOk(
        await supabase.from("productionDays").select("*").order("date", { ascending: false }).limit(limit),
      ) as ProductionDay[],
  });
  return data ?? [];
}

/** Create or promote today's productionDay. Idempotent.
 *
 *  Three cases:
 *    - no row exists → insert with status='active', openedAt=now;
 *    - row exists with status='draft' (the scheduler created it) →
 *      promote to 'active', stamp openedAt;
 *    - row already active / done → return as-is.
 */
export async function openProductionDay(openedBy?: string): Promise<ProductionDay> {
  const today = todayDateString();
  const existing = assertOkMaybe(
    await supabase.from("productionDays").select("*").eq("date", today).maybeSingle(),
  ) as ProductionDay | null;
  const now = new Date();
  if (existing) {
    if (existing.status === "draft") {
      const { error } = await supabase
        .from("productionDays")
        .update({ status: "active", openedAt: now, openedBy: openedBy ?? null, updatedAt: now })
        .eq("id", existing.id!);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["production-day"] });
      queryClient.invalidateQueries({ queryKey: ["production-days"] });
      return { ...existing, status: "active", openedAt: now, openedBy, updatedAt: now };
    }
    return existing;
  }
  const id = newId();
  const { error } = await supabase.from("productionDays").insert({
    id,
    date: today,
    status: "active",
    openedAt: now,
    openedBy: openedBy ?? null,
    tempLogComplete: false,
    cleaningComplete: false,
    summaryJson: {},
    createdAt: now,
    updatedAt: now,
  });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["production-day"] });
  queryClient.invalidateQueries({ queryKey: ["production-days"] });
  return {
    id, date: today, status: "active", openedAt: now, openedBy,
    tempLogComplete: false, cleaningComplete: false, summary: {},
    createdAt: now, updatedAt: now,
  };
}

export function useHaccpTemperatureLogs(productionDayId?: string): HaccpTemperatureLog[] {
  const { data } = useQuery({
    queryKey: ["haccp-temperature-logs", productionDayId ?? "all"],
    queryFn: async () => {
      const q = supabase.from("haccpTemperatureLogs").select("*").order("loggedAt", { ascending: false });
      return assertOk(
        await (productionDayId ? q.eq("productionDayId", productionDayId) : q),
      ) as HaccpTemperatureLog[];
    },
  });
  return data ?? [];
}

export interface TempLogEntry {
  equipmentId: string;
  temperatureC: number;
  note?: string;
  isWithinRange: boolean;
}

/** Save one round of temperature readings and mark the day's temp-log
 *  flag complete. Each call appends a fresh set of rows — a device can
 *  be re-logged later the same day. */
export async function saveTemperatureReadings(
  entries: TempLogEntry[],
  productionDayId: string,
  loggedBy?: string,
): Promise<void> {
  if (entries.length === 0) return;
  const now = new Date();
  const rows = entries.map((e) => ({
    id: newId(),
    equipmentId: e.equipmentId,
    temperatureC: e.temperatureC,
    isWithinRange: e.isWithinRange,
    note: e.note ?? null,
    loggedBy: loggedBy ?? null,
    productionDayId,
    loggedAt: now,
  }));
  const { error } = await supabase.from("haccpTemperatureLogs").insert(rows);
  if (error) throw error;
  const { error: upErr } = await supabase
    .from("productionDays")
    .update({ tempLogComplete: true, updatedAt: now })
    .eq("id", productionDayId);
  if (upErr) throw upErr;
  queryClient.invalidateQueries({ queryKey: ["haccp-temperature-logs"] });
  queryClient.invalidateQueries({ queryKey: ["production-day"] });
  queryClient.invalidateQueries({ queryKey: ["production-days"] });
}

/** Latest reading per equipment in the last 48h. Drives the pre-fill
 *  behaviour of the temperature log popup. */
export async function yesterdayTemperatureReadings(): Promise<Map<string, number>> {
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const rows = assertOk(
    await supabase
      .from("haccpTemperatureLogs")
      .select("equipmentId, temperatureC, loggedAt")
      .gte("loggedAt", since.toISOString()),
  ) as Array<{ equipmentId: string; temperatureC: number; loggedAt: string }>;
  const latest = new Map<string, { t: number; reading: number }>();
  for (const r of rows) {
    const t = new Date(r.loggedAt).getTime();
    const prev = latest.get(r.equipmentId);
    if (!prev || t > prev.t) latest.set(r.equipmentId, { t, reading: Number(r.temperatureC) });
  }
  return new Map(Array.from(latest.entries()).map(([k, v]) => [k, v.reading]));
}

// ---------------------------------------------------------------
// Close Production — carry forward unfinished schedule rows
// ---------------------------------------------------------------

export interface CloseProductionSummary {
  productionDayId: string;
  stepsCompleted: number;
  stepsCarriedForward: number;
  piecesProduced: number;
  batchesRun: number;
  /** Orders whose deadline is today or tomorrow and had steps carried
   *  forward — these need Manuela's attention. */
  carriedDeadlineAffected: Array<{ orderId: string; orderName: string; deadline: string }>;
}

/** Close today's production day.
 *
 *  In the daily-production model, productionDayLineItems stay on their
 *  date — they're the record of what was planned. Step progress lives
 *  on planStepStatus (per-batch). Close Production simply flips the
 *  day to status='done' and records a summary.
 *
 *  "Unfinished" steps (stepIds listed on today's lineItems but not
 *  done in planStepStatus) are NOT automatically reshuffled — the
 *  next Regenerate picks them up. If a batch has incomplete steps
 *  after its day closes, the operator runs Regenerate to replan the
 *  remaining work forward. */
export async function closeProductionDay(
  closedBy?: string,
  dateIso?: string,
): Promise<CloseProductionSummary> {
  // `dateIso` lets callers close a stale day from yesterday or earlier
  // (e.g. she didn't tap Close last night). Defaults to today.
  const target = dateIso ?? todayDateString();
  const dayRow = assertOkMaybe(
    await supabase.from("productionDays").select("*").eq("date", target).maybeSingle(),
  ) as ProductionDay | null;
  if (!dayRow) throw new Error(`No production day is open for ${target}.`);

  const startOfToday = new Date(target + "T00:00:00");
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(target + "T00:00:00");
  endOfToday.setHours(23, 59, 59, 999);

  // Line items scheduled for today — we count how many steps are
  // done vs still pending to feed the summary. Progress lives on
  // planStepStatus, so "done" means a row with done=true exists for
  // the (planId, stepKey) pair the lineItem listed.
  const todaysLineItems = assertOk(
    await supabase
      .from("productionDayLineItems")
      .select("*")
      .eq("productionDayId", dayRow.id!),
  ) as ProductionDayLineItem[];

  const planIds = [...new Set(todaysLineItems.map((li) => li.planId))];
  const statuses = planIds.length > 0
    ? (assertOk(
        await supabase
          .from("planStepStatus")
          .select("*")
          .in("planId", planIds),
      ) as PlanStepStatus[])
    : [];
  const doneKeysByPlan = new Map<string, Set<string>>();
  for (const s of statuses) {
    if (!s.done) continue;
    const set = doneKeysByPlan.get(s.planId) ?? new Set<string>();
    set.add(s.stepKey);
    doneKeysByPlan.set(s.planId, set);
  }

  let stepsCompleted = 0;
  let stepsCarriedForward = 0;
  for (const li of todaysLineItems) {
    const doneSet = doneKeysByPlan.get(li.planId) ?? new Set<string>();
    for (const stepId of li.stepIds) {
      // Match loosely — stepKey in planStepStatus may embed the planProduct
      // id as a suffix (e.g. "polish-pp1"). Anything starting with the
      // stepId token counts as "done".
      const matched = [...doneSet].some((k) => k === stepId || k.startsWith(`${stepId}-`));
      if (matched) stepsCompleted++;
      else stepsCarriedForward++;
    }
  }

  // Pieces produced today — unchanged; read from stockMovements.
  const movements = assertOk(
    await supabase
      .from("stockMovements")
      .select("quantity, reason, movedAt")
      .eq("reason", "unmould")
      .gte("movedAt", startOfToday.toISOString())
      .lte("movedAt", endOfToday.toISOString()),
  ) as Array<{ quantity: number }>;
  const piecesProduced = movements.reduce((a, m) => a + m.quantity, 0);

  const batchesRun = new Set(
    todaysLineItems
      .filter((li) => {
        const doneSet = doneKeysByPlan.get(li.planId) ?? new Set<string>();
        return li.stepIds.every((sid) =>
          [...doneSet].some((k) => k === sid || k.startsWith(`${sid}-`)),
        );
      })
      .map((li) => li.planId),
  ).size;

  // Deadline impact: orders linked to batches with carry-forward steps
  // whose deadline falls today/tomorrow.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const unfinishedPlanIds = [...new Set(
    todaysLineItems
      .filter((li) => {
        const doneSet = doneKeysByPlan.get(li.planId) ?? new Set<string>();
        return !li.stepIds.every((sid) =>
          [...doneSet].some((k) => k === sid || k.startsWith(`${sid}-`)),
        );
      })
      .map((li) => li.planId),
  )];
  let carriedDeadlineAffected: CloseProductionSummary["carriedDeadlineAffected"] = [];
  if (unfinishedPlanIds.length > 0) {
    const links = assertOk(
      await supabase
        .from("orderPlanLinks")
        .select("orderItemId, planId")
        .in("planId", unfinishedPlanIds),
    ) as Array<{ orderItemId: string; planId: string }>;
    const itemIds = [...new Set(links.map((l) => l.orderItemId))];
    if (itemIds.length > 0) {
      const items = assertOk(
        await supabase.from("orderItems").select("id, orderId").in("id", itemIds),
      ) as Array<{ id: string; orderId: string }>;
      const orderIds = [...new Set(items.map((i) => i.orderId))];
      const orders = orderIds.length > 0
        ? (assertOk(
            await supabase
              .from("orders")
              .select("id, customerName, eventName, deadline")
              .in("id", orderIds),
          ) as Array<{ id: string; customerName?: string; eventName?: string; deadline: string }>)
        : [];
      carriedDeadlineAffected = orders
        .filter((o) => new Date(o.deadline).getTime() <= endOfToday.getTime() + DAY_MS)
        .map((o) => ({
          orderId: o.id,
          orderName: o.customerName ?? o.eventName ?? "Order",
          deadline: o.deadline,
        }));
    }
  }

  const summary: CloseProductionSummary = {
    productionDayId: dayRow.id!,
    stepsCompleted,
    stepsCarriedForward,
    piecesProduced,
    batchesRun,
    carriedDeadlineAffected,
  };

  const now = new Date();
  const { error } = await supabase
    .from("productionDays")
    .update({
      status: "done",
      closedAt: now,
      closedBy: closedBy ?? null,
      summaryJson: {
        batchesRun,
        piecesProduced,
        stepsCompleted,
        stepsCarriedForward,
      },
      updatedAt: now,
    })
    .eq("id", dayRow.id!);
  if (error) throw error;

  queryClient.invalidateQueries({ queryKey: ["production-day"] });
  queryClient.invalidateQueries({ queryKey: ["production-days"] });
  queryClient.invalidateQueries({ queryKey: ["production-day-line-items"] });
  return summary;
}

// ---------------------------------------------------------------
// Stock adjustments (opening balance, recounts, breakage) — §0031
// ---------------------------------------------------------------
//
// Four item types live in four different stock tables. The
// adjustment log is a single polymorphic `stockAdjustments` row per
// tweak; the actual stock total update depends on the type:
//
//   product     → synthetic "Opening balance" plan + stockLocations
//                 (re-uses the batch-based Phase 2 machinery)
//   filling     → fillingStock row (grams)
//   packaging   → packaging.quantityOnHand column (units)
//   ingredient  → ingredients.currentStockG column (grams)
//
// A positive delta adds stock, a negative delta subtracts.
// Subtractions are clamped at zero so we never go negative — the
// adjustment log still records what was attempted.

export function useStockAdjustments(
  filter?: { itemType?: StockAdjustmentItemType; itemId?: string; limit?: number },
): StockAdjustment[] {
  const { data } = useQuery({
    queryKey: ["stock-adjustments", filter ?? null],
    queryFn: async () => {
      let q = supabase.from("stockAdjustments").select("*").order("createdAt", { ascending: false });
      if (filter?.itemType) q = q.eq("itemType", filter.itemType);
      if (filter?.itemId) q = q.eq("itemId", filter.itemId);
      if (filter?.limit) q = q.limit(filter.limit);
      return assertOk(await q) as StockAdjustment[];
    },
  });
  return data ?? [];
}

export interface StockAdjustmentInput {
  itemType: StockAdjustmentItemType;
  itemId: string;
  /** Required for products, ignored for other item types. */
  location?: StockLocation;
  deltaQty: number;
  reason: StockAdjustmentReason;
  note?: string;
  createdBy?: string;
}

/** The shared virtual plan that holds opening-balance product stock.
 *  Created lazily the first time a product adjustment is applied.
 *  Stable name + status='done' so it doesn't clutter active-plan lists. */
const OPENING_BALANCE_PLAN_NAME = "Opening balance";

async function ensureOpeningBalancePlanId(): Promise<string> {
  const existing = assertOkMaybe(
    await supabase
      .from("productionPlans")
      .select("id")
      .eq("name", OPENING_BALANCE_PLAN_NAME)
      .maybeSingle(),
  ) as { id: string } | null;
  if (existing) return existing.id;
  const id = newId();
  const now = new Date();
  const { error } = await supabase.from("productionPlans").insert({
    id,
    name: OPENING_BALANCE_PLAN_NAME,
    status: "done",
    notes: "Synthetic plan holding pre-app opening-balance stock adjustments.",
    createdAt: now,
    updatedAt: now,
    completedAt: now,
  });
  if (error) throw error;
  return id;
}

/** Find (or create) the virtual planProduct used to hold opening-balance
 *  stock for this product. One planProduct per product, re-used across
 *  every adjustment to the same product. */
async function ensureOpeningBalancePlanProductId(productId: string): Promise<string> {
  const planId = await ensureOpeningBalancePlanId();
  const existing = assertOkMaybe(
    await supabase
      .from("planProducts")
      .select("id")
      .eq("planId", planId)
      .eq("productId", productId)
      .maybeSingle(),
  ) as { id: string } | null;
  if (existing) return existing.id;
  // Look up default mould + batch qty for sensible seed values.
  const product = assertOkMaybe(
    await supabase.from("products").select("defaultMouldId, defaultBatchQty").eq("id", productId).maybeSingle(),
  ) as { defaultMouldId?: string; defaultBatchQty?: number } | null;
  const id = newId();
  const { error } = await supabase.from("planProducts").insert({
    id,
    planId,
    productId,
    mouldId: product?.defaultMouldId ?? null,
    quantity: product?.defaultBatchQty ?? 1,
    sortOrder: 0,
  });
  if (error) throw error;
  return id;
}

async function applyProductAdjustment(args: StockAdjustmentInput): Promise<void> {
  // Default to Store when the caller doesn't specify. Matches the
  // /stock/adjust UI preset — finished pieces added as opening
  // balance or a recount belong on the shop floor, not in Production
  // Storage (which is for pieces just unmoulded and awaiting move-out).
  const location: StockLocation = args.location ?? "store";
  const planProductId = await ensureOpeningBalancePlanProductId(args.itemId);
  const qty = Math.abs(Math.round(args.deltaQty));
  if (qty === 0) return;
  if (args.deltaQty > 0) {
    await intakeBatchStock({
      planProductId,
      productId: args.itemId,
      toLocation: location,
      quantity: qty,
      reason: args.reason === "opening_balance" ? "transfer" : "recount",
      notes: args.note,
    });
  } else {
    await outakeBatchStock({
      planProductId,
      productId: args.itemId,
      fromLocation: location,
      quantity: qty,
      reason: args.reason === "damaged" ? "waste" : "recount",
      notes: args.note,
    });
  }
}

async function applyFillingAdjustment(args: StockAdjustmentInput): Promise<void> {
  const now = new Date();
  if (args.deltaQty > 0) {
    // Positive → new stock row.
    const { error } = await supabase.from("fillingStock").insert({
      id: newId(),
      fillingId: args.itemId,
      remainingG: Math.round(args.deltaQty),
      madeAt: now.toISOString(),
      notes: args.note ?? null,
      createdAt: now.getTime(),
    });
    if (error) throw error;
  } else {
    // Negative → draw down from existing stock, oldest first.
    const rows = assertOk(
      await supabase
        .from("fillingStock")
        .select("id, remainingG, madeAt")
        .eq("fillingId", args.itemId)
        .order("madeAt", { ascending: true }),
    ) as Array<{ id: string; remainingG: number; madeAt: string }>;
    let remaining = Math.abs(Math.round(args.deltaQty));
    for (const row of rows) {
      if (remaining <= 0) break;
      const take = Math.min(row.remainingG, remaining);
      const next = row.remainingG - take;
      if (next <= 0) {
        await supabase.from("fillingStock").delete().eq("id", row.id);
      } else {
        await supabase.from("fillingStock").update({ remainingG: next }).eq("id", row.id);
      }
      remaining -= take;
    }
  }
  queryClient.invalidateQueries({ queryKey: ["filling-stock"] });
}

async function applyPackagingAdjustment(args: StockAdjustmentInput): Promise<void> {
  if (args.deltaQty > 0) {
    await addPackagingStock(args.itemId, Math.round(args.deltaQty));
  } else {
    await consumePackaging({
      packagingId: args.itemId,
      quantity: Math.abs(Math.round(args.deltaQty)),
      note: args.note,
    });
  }
}

async function applyIngredientAdjustment(args: StockAdjustmentInput): Promise<void> {
  const row = assertOkMaybe(
    await supabase.from("ingredients").select("currentStockG").eq("id", args.itemId).maybeSingle(),
  ) as { currentStockG?: number } | null;
  const current = row?.currentStockG ?? 0;
  const next = Math.max(0, current + args.deltaQty);
  const { error } = await supabase
    .from("ingredients")
    .update({ currentStockG: next, updatedAt: new Date() })
    .eq("id", args.itemId);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["ingredients"] });
}

async function applyVariantAdjustment(args: StockAdjustmentInput): Promise<void> {
  // For variants, `itemId` references a variantPackaging.id — the
  // specific size of the variant whose pre-assembled box count is
  // being tracked. Adjust the row's `quantityOnHand` (clamped at 0).
  const row = assertOkMaybe(
    await supabase
      .from("variantPackagings")
      .select("quantityOnHand")
      .eq("id", args.itemId)
      .maybeSingle(),
  ) as { quantityOnHand?: number } | null;
  const current = row?.quantityOnHand ?? 0;
  const next = Math.max(0, current + Math.round(args.deltaQty));
  const { error } = await supabase
    .from("variantPackagings")
    .update({ quantityOnHand: next, updatedAt: new Date() })
    .eq("id", args.itemId);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["variant-packagings"] });
}

/** Apply a single stock adjustment: update the relevant stock total +
 *  append an audit row to stockAdjustments. Throws on any error. */
export async function applyStockAdjustment(args: StockAdjustmentInput): Promise<void> {
  if (args.deltaQty === 0) return;
  switch (args.itemType) {
    case "product":    await applyProductAdjustment(args); break;
    case "variant":    await applyVariantAdjustment(args); break;
    case "filling":    await applyFillingAdjustment(args); break;
    case "packaging":  await applyPackagingAdjustment(args); break;
    case "ingredient": await applyIngredientAdjustment(args); break;
  }
  const { error } = await supabase.from("stockAdjustments").insert({
    id: newId(),
    itemType: args.itemType,
    itemId: args.itemId,
    location: args.itemType === "product" ? (args.location ?? "store") : null,
    deltaQty: args.deltaQty,
    reason: args.reason,
    note: args.note ?? null,
    createdBy: args.createdBy ?? null,
    createdAt: new Date(),
  });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["stock-adjustments"] });
}

/** Apply a batch of adjustments one at a time. Stops at the first
 *  failure and returns how many succeeded — caller can report partial
 *  success to the user. */
export async function applyStockAdjustments(
  inputs: StockAdjustmentInput[],
): Promise<{ applied: number; failed: StockAdjustmentInput | null; error?: unknown }> {
  let applied = 0;
  for (const input of inputs) {
    try {
      await applyStockAdjustment(input);
      applied++;
    } catch (error) {
      return { applied, failed: input, error };
    }
  }
  return { applied, failed: null };
}

// ---------------------------------------------------------------
// Order detail rework — packaging lines, labour rollup helpers
// ---------------------------------------------------------------

export function useOrderPackagingLines(orderId: string | undefined): OrderPackagingLine[] {
  const { data } = useQuery({
    queryKey: ["order-packaging-lines", orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const rows = assertOk(
        await supabase
          .from("orderPackagingLines")
          .select("*")
          .eq("orderId", orderId!)
          .order("sortOrder", { ascending: true }),
      ) as OrderPackagingLine[];
      return rows;
    },
  });
  return data ?? [];
}

/** Aggregate hook: every packaging line across every order. Used by
 *  the weekly sales report so we don't fan out N per-order queries. */
export function useOrderPackagingLinesAll(): OrderPackagingLine[] {
  const { data } = useQuery({
    queryKey: ["order-packaging-lines", "all"],
    queryFn: async () =>
      assertOk(await supabase.from("orderPackagingLines").select("*")) as OrderPackagingLine[],
  });
  return data ?? [];
}

export async function saveOrderPackagingLine(
  line: Omit<OrderPackagingLine, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<string> {
  const now = new Date();
  if (line.id) {
    const { error } = await supabase
      .from("orderPackagingLines")
      .update({ ...line, updatedAt: now })
      .eq("id", line.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["order-packaging-lines"] });
    return line.id;
  }
  const id = newId();
  const { error } = await supabase
    .from("orderPackagingLines")
    .insert({ ...line, id, createdAt: now, updatedAt: now });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["order-packaging-lines"] });
  return id;
}

export async function deleteOrderPackagingLine(id: string): Promise<void> {
  const { error } = await supabase.from("orderPackagingLines").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["order-packaging-lines"] });
}

/** Computes per-product active production minutes derived from the
 *  user-defined productionSteps. For a given product, we sum the
 *  activeMinutes of every step configured for its category and
 *  divide by the typical batch output (default mould cavities ×
 *  default batch qty). Returns 0 when the product has no mould,
 *  no category, or no matching steps — caller decides how to
 *  flag the gap. */
export function useProductActiveMinutesMap(): Map<string, number> {
  const products = useProductsList(true);
  const moulds = useMouldsList(true);
  const categories = useProductCategories(true);
  const steps = useProductionSteps();

  return useMemo(() => {
    const categoryById = new Map(categories.map((c) => [c.id!, c.name] as const));
    const mouldById = new Map(moulds.map((m) => [m.id!, m] as const));
    const stepsByType = new Map<string, number>();
    for (const s of steps) {
      stepsByType.set(s.productType, (stepsByType.get(s.productType) ?? 0) + (s.activeMinutes ?? 0));
    }
    const out = new Map<string, number>();
    for (const p of products) {
      const categoryName = p.productCategoryId ? categoryById.get(p.productCategoryId) : undefined;
      const totalBatchMinutes = categoryName ? (stepsByType.get(categoryName) ?? 0) : 0;
      const mould = p.defaultMouldId ? mouldById.get(p.defaultMouldId) : undefined;
      const cavities = mould?.numberOfCavities ?? 0;
      const batchQty = p.defaultBatchQty ?? 1;
      const piecesPerBatch = cavities * batchQty;
      const perPiece = piecesPerBatch > 0 ? totalBatchMinutes / piecesPerBatch : 0;
      out.set(p.id!, perPiece);
    }
    return out;
  }, [products, moulds, categories, steps]);
}

// =====================================================================
// Shop opening hours + closures
// =====================================================================

/** Seven rows, one per day-of-week. Migration 0033 seeds all seven, so
 *  this always returns a full week (even if every day is isOpen=false). */
export function useShopOpeningHours(): ShopOpeningHours[] {
  const { data } = useQuery({
    queryKey: ["shop-opening-hours"],
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("shopOpeningHours").select("*").order("dayOfWeek", { ascending: true }),
      ) as ShopOpeningHours[];
      return rows;
    },
  });
  return data ?? [];
}

/** Upsert a single day's schedule. Matches on dayOfWeek so the UI can
 *  flip isOpen + times without juggling row ids. */
export async function saveShopOpeningHours(
  row: Omit<ShopOpeningHours, "id" | "updatedAt"> & { id?: string },
): Promise<string> {
  const now = new Date();
  if (row.id) {
    const { error } = await supabase
      .from("shopOpeningHours")
      .update({ ...row, updatedAt: now })
      .eq("id", row.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["shop-opening-hours"] });
    return row.id;
  }
  // Fallback for a brand-new row (if the seed didn't run for some reason).
  const id = newId();
  const { error } = await supabase
    .from("shopOpeningHours")
    .insert({ ...row, id, updatedAt: now });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["shop-opening-hours"] });
  return id;
}

export function useShopClosures(): ShopClosure[] {
  const { data } = useQuery({
    queryKey: ["shop-closures"],
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("shopClosures").select("*").order("startDate", { ascending: true }),
      ) as ShopClosure[];
      return rows;
    },
  });
  return data ?? [];
}

export async function saveShopClosure(
  row: Omit<ShopClosure, "id" | "createdAt"> & { id?: string },
): Promise<string> {
  if (row.id) {
    const { error } = await supabase
      .from("shopClosures")
      .update(row)
      .eq("id", row.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["shop-closures"] });
    return row.id;
  }
  const id = newId();
  const { error } = await supabase
    .from("shopClosures")
    .insert({ ...row, id, createdAt: new Date() });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["shop-closures"] });
  return id;
}

export async function deleteShopClosure(id: string): Promise<void> {
  const { error } = await supabase.from("shopClosures").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["shop-closures"] });
}

// =====================================================================
// Per-product Store availability (un-allocated)
// =====================================================================

/** productId → pieces in Store that are *not* already allocated to an
 *  order. Used by the borrow decision. "Allocated" rows carry an
 *  orderId and are parked at location='allocated', so Store stock is
 *  always un-allocated by definition — but we still subtract any
 *  pending-borrow reservations the caller layers on top. */
export function useProductStoreAvailable(): Map<string, number> {
  const totals = useProductLocationTotals();
  return useMemo(() => {
    const out = new Map<string, number>();
    for (const [productId, byLoc] of totals) {
      out.set(productId, byLoc.store ?? 0);
    }
    return out;
  }, [totals]);
}

/** productId → suggested lead time in days, derived from production
 *  steps + daily people-hours. Rounded up so a 6-hour batch still
 *  shows as 1 day. Used as the hint below the product lead-time input
 *  when the user hasn't set an explicit value. */
export function useProductLeadTimeSuggestions(): Map<string, number> {
  const products = useProductsList(true);
  const categories = useProductCategories(true);
  const steps = useProductionSteps();
  const people = usePeople(false);
  return useMemo(() => {
    const categoryById = new Map(categories.map((c) => [c.id!, c.name] as const));
    const batchMinutesByType = new Map<string, number>();
    for (const s of steps) {
      const prev = batchMinutesByType.get(s.productType) ?? 0;
      batchMinutesByType.set(s.productType, prev + (s.activeMinutes ?? 0) + (s.waitingMinutes ?? 0));
    }
    const dailyCapacityMinutes = people
      .filter((p) => !p.archived)
      .reduce((s, p) => s + ((p.defaultHoursPerDay ?? 0) * 60), 0);

    const out = new Map<string, number>();
    for (const p of products) {
      const categoryName = p.productCategoryId ? categoryById.get(p.productCategoryId) : undefined;
      const totalBatchMinutes = categoryName ? (batchMinutesByType.get(categoryName) ?? 0) : 0;
      if (dailyCapacityMinutes <= 0 || totalBatchMinutes <= 0) {
        out.set(p.id!, 1);
        continue;
      }
      out.set(p.id!, Math.max(1, Math.ceil(totalBatchMinutes / dailyCapacityMinutes)));
    }
    return out;
  }, [products, categories, steps, people]);
}

// =====================================================================
// Customer-specific product pricing (top of the pricing hierarchy)
// =====================================================================

export function useCustomerProductPrices(customerId: string | undefined): CustomerProductPrice[] {
  const { data } = useQuery({
    queryKey: ["customer-product-prices", customerId],
    enabled: !!customerId,
    queryFn: async () =>
      assertOk(
        await supabase.from("customerProductPrices").select("*").eq("customerId", customerId!),
      ) as CustomerProductPrice[],
  });
  return data ?? [];
}

/** All per-customer prices across every customer — useful when the UI
 *  has already got the full customer + product list and we want a single
 *  Map to look up from. */
export function useAllCustomerProductPrices(): CustomerProductPrice[] {
  const { data } = useQuery({
    queryKey: ["customer-product-prices", "all"],
    queryFn: async () =>
      assertOk(await supabase.from("customerProductPrices").select("*")) as CustomerProductPrice[],
  });
  return data ?? [];
}

export async function saveCustomerProductPrice(
  row: Omit<CustomerProductPrice, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<string> {
  const now = new Date();
  if (row.id) {
    const { error } = await supabase
      .from("customerProductPrices")
      .update({ ...row, updatedAt: now })
      .eq("id", row.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["customer-product-prices"] });
    return row.id;
  }
  // Upsert on (customerId, productId) — the unique constraint handles it.
  const id = newId();
  const { error } = await supabase
    .from("customerProductPrices")
    .upsert(
      { ...row, id, createdAt: now, updatedAt: now },
      { onConflict: "customerId,productId" },
    );
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["customer-product-prices"] });
  return id;
}

export async function deleteCustomerProductPrice(id: string): Promise<void> {
  const { error } = await supabase.from("customerProductPrices").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["customer-product-prices"] });
}

// =====================================================================
// Production Brain — replenishment proposals
// =====================================================================

export function useReplenishmentProposals(
  status?: ReplenishmentStatus | ReplenishmentStatus[],
): ReplenishmentProposal[] {
  const statusList: ReplenishmentStatus[] | undefined = Array.isArray(status)
    ? status
    : status
      ? [status]
      : undefined;
  const key = statusList ? statusList.join(",") : "all";
  const { data } = useQuery({
    queryKey: ["replenishmentProposals", key],
    queryFn: async () => {
      let q = supabase.from("replenishmentProposals").select("*");
      if (statusList && statusList.length > 0) q = q.in("status", statusList);
      const rows = assertOk(await q) as ReplenishmentProposal[];
      return rows.sort((a, b) => {
        const pa = a.priorityTier ?? 2;
        const pb = b.priorityTier ?? 2;
        if (pa !== pb) return pa - pb;
        return (a.earliestNeededDate ?? "").localeCompare(b.earliestNeededDate ?? "");
      });
    },
  });
  return data ?? [];
}

export async function saveReplenishmentProposal(
  row: Omit<ReplenishmentProposal, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const payload = { ...row, id };
  const { error } = await supabase
    .from("replenishmentProposals")
    .upsert(payload, { onConflict: "id" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["replenishmentProposals"] });
  return id;
}

/** Mark a proposal as scheduled. Call this when the user drags the
 *  proposal from the sidebar onto a calendar day — after the
 *  corresponding productionPlan is created. */
export async function markProposalScheduled(
  proposalId: string,
  planId: string,
): Promise<void> {
  const { error } = await supabase
    .from("replenishmentProposals")
    .update({ status: "scheduled", scheduledPlanId: planId })
    .eq("id", proposalId);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["replenishmentProposals"] });
}

/** Drag-to-schedule helper. Creates a draft productionPlan, a
 *  planProducts row for the proposed qty, ensures a productionDays
 *  row exists for the target date, adds a productionDayLineItem
 *  linking the plan to that day, and flips the proposal status.
 *
 *  Returns the new plan id so the caller can navigate to the batch
 *  detail if needed.
 */
export async function scheduleProposalOnDay(
  proposalId: string,
  targetDateISO: string,
): Promise<string> {
  // 1) Load the proposal + the product so we can name the batch.
  const proposalRow = assertOkMaybe(
    await supabase
      .from("replenishmentProposals")
      .select("*")
      .eq("id", proposalId)
      .maybeSingle(),
  );
  if (!proposalRow) throw new Error("Proposal not found");
  const proposal = proposalRow as ReplenishmentProposal;

  const productRow = assertOkMaybe(
    await supabase
      .from("products")
      .select("id, name")
      .eq("id", proposal.productId)
      .maybeSingle(),
  );
  const productName = (productRow as { name?: string } | null)?.name ?? "Product";

  // 2) Create the productionPlan (draft). Batch number uses
  //    YYYYMMDD-### derived from the target date + random suffix.
  const now = new Date();
  const isoDate = targetDateISO.slice(0, 10);
  const compactDate = isoDate.replace(/-/g, "");
  const batchNumber = `${compactDate}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

  const planId = newId();
  const planPayload = {
    id: planId,
    batchNumber,
    name: `${productName} × ${proposal.suggestedBatchSize}`,
    status: "draft" as const,
    createdAt: now,
    updatedAt: now,
  };
  const { error: planErr } = await supabase.from("productionPlans").insert(planPayload);
  if (planErr) throw planErr;

  // 3) planProducts row — ties plan to product + qty.
  const planProductId = newId();
  const planProductPayload = {
    id: planProductId,
    planId,
    productId: proposal.productId,
    quantity: proposal.suggestedBatchSize,
  };
  const { error: ppErr } = await supabase.from("planProducts").insert(planProductPayload);
  if (ppErr) throw ppErr;

  // 4) Ensure productionDays row exists for that date (re-use if already
  //    there — HACCP or prior scheduling may have created it).
  const dayRow = assertOkMaybe(
    await supabase
      .from("productionDays")
      .select("id")
      .eq("date", isoDate)
      .maybeSingle(),
  );
  let productionDayId: string;
  if (dayRow) {
    productionDayId = (dayRow as { id: string }).id;
  } else {
    productionDayId = newId();
    const { error: dayErr } = await supabase.from("productionDays").insert({
      id: productionDayId,
      date: isoDate,
      status: "draft",
    });
    if (dayErr) throw dayErr;
  }

  // 5) productionDayLineItems — link plan to the day.
  const lineItemId = newId();
  const { error: liErr } = await supabase.from("productionDayLineItems").insert({
    id: lineItemId,
    productionDayId,
    planId,
    stepIds: [],
    plannedMinutes: 0,
    sortOrder: 0,
  });
  if (liErr) throw liErr;

  // 6) Flip proposal status.
  await markProposalScheduled(proposalId, planId);

  queryClient.invalidateQueries({ queryKey: ["productionPlans"] });
  queryClient.invalidateQueries({ queryKey: ["planProducts"] });
  queryClient.invalidateQueries({ queryKey: ["productionDays"] });
  queryClient.invalidateQueries({ queryKey: ["productionDayLineItems"] });
  return planId;
}

/** Dismiss a proposal for N days. Engine will not re-propose the same
 *  product until dismissedUntil passes — except when stock projection
 *  enters critical zone, in which case the engine runner auto-revives
 *  the proposal (see engineRunner.ts).
 *
 *  Default quiet period is 2 days per Manuela's spec (2026-04-24);
 *  callers can pass an explicit date for snooze-for-week flows. */
export async function dismissProposal(
  proposalId: string,
  untilDate?: string,
): Promise<void> {
  const resolvedUntil =
    untilDate ??
    new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { error } = await supabase
    .from("replenishmentProposals")
    .update({ status: "dismissed", dismissedUntil: resolvedUntil })
    .eq("id", proposalId);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["replenishmentProposals"] });
}

export async function deleteReplenishmentProposal(id: string): Promise<void> {
  const { error } = await supabase
    .from("replenishmentProposals")
    .delete()
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["replenishmentProposals"] });
}

// =====================================================================
// Production Brain — daily sell estimates
// =====================================================================

export function useDailySellEstimates(
  productId: string | undefined,
  fromDate?: string,
  toDate?: string,
): DailySellEstimate[] {
  const { data } = useQuery({
    queryKey: ["dailySellEstimates", productId, fromDate, toDate],
    enabled: !!productId,
    queryFn: async () => {
      let q = supabase
        .from("dailySellEstimates")
        .select("*")
        .eq("productId", productId!);
      if (fromDate) q = q.gte("date", fromDate);
      if (toDate) q = q.lte("date", toDate);
      const rows = assertOk(await q) as DailySellEstimate[];
      return rows.sort((a, b) => a.date.localeCompare(b.date));
    },
  });
  return data ?? [];
}

export async function saveDailySellEstimate(
  row: Omit<DailySellEstimate, "id" | "updatedAt"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const payload = { ...row, id };
  const { error } = await supabase
    .from("dailySellEstimates")
    .upsert(payload, { onConflict: "productId,locationId,date" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["dailySellEstimates"] });
  return id;
}

// =====================================================================
// Production Brain — campaigns (limited editions / seasonal boxes)
// =====================================================================

export function useCampaigns(status?: CampaignStatus | CampaignStatus[]): Campaign[] {
  const statusList: CampaignStatus[] | undefined = Array.isArray(status)
    ? status
    : status
      ? [status]
      : undefined;
  const key = statusList ? statusList.join(",") : "all";
  const { data } = useQuery({
    queryKey: ["campaigns", key],
    queryFn: async () => {
      let q = supabase.from("campaigns").select("*");
      if (statusList && statusList.length > 0) q = q.in("status", statusList);
      const rows = assertOk(await q) as Campaign[];
      return rows.sort((a, b) => a.startDate.localeCompare(b.startDate));
    },
  });
  return data ?? [];
}

export function useCampaign(id: string | undefined): Campaign | undefined {
  const { data } = useQuery({
    queryKey: ["campaigns", id],
    enabled: !!id,
    queryFn: async () => {
      const row = assertOkMaybe(
        await supabase.from("campaigns").select("*").eq("id", id!).maybeSingle(),
      );
      return row as Campaign | null;
    },
  });
  return data ?? undefined;
}

export async function saveCampaign(
  row: Omit<Campaign, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const payload = { ...row, id };
  const { error } = await supabase.from("campaigns").upsert(payload, { onConflict: "id" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["campaigns"] });
  return id;
}

export async function deleteCampaign(id: string): Promise<void> {
  const { error } = await supabase.from("campaigns").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["campaigns"] });
}

// =====================================================================
// Production Brain — mould pool (physical instance tracking)
// =====================================================================

export function useMouldPool(mouldId?: string): MouldPoolInstance[] {
  const { data } = useQuery({
    queryKey: ["mouldPool", mouldId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("mouldPool").select("*");
      if (mouldId) q = q.eq("mouldId", mouldId);
      const rows = assertOk(await q) as MouldPoolInstance[];
      return rows.sort((a, b) => {
        if (a.mouldId !== b.mouldId) return a.mouldId.localeCompare(b.mouldId);
        return a.instanceIndex - b.instanceIndex;
      });
    },
  });
  return data ?? [];
}

export async function saveMouldPoolInstance(
  row: Omit<MouldPoolInstance, "id"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const payload = { ...row, id };
  const { error } = await supabase
    .from("mouldPool")
    .upsert(payload, { onConflict: "id" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["mouldPool"] });
  return id;
}

// =====================================================================
// Production Brain — equipment instances + machine loads
// =====================================================================

export function useEquipmentInstances(equipmentId?: string): EquipmentInstance[] {
  const { data } = useQuery({
    queryKey: ["equipmentInstances", equipmentId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("equipmentInstances").select("*");
      if (equipmentId) q = q.eq("equipmentId", equipmentId);
      const rows = assertOk(await q) as EquipmentInstance[];
      return rows
        .filter((r) => !r.archived)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  return data ?? [];
}

export async function saveEquipmentInstance(
  row: Omit<EquipmentInstance, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const payload = { ...row, id };
  const { error } = await supabase
    .from("equipmentInstances")
    .upsert(payload, { onConflict: "id" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["equipmentInstances"] });
  return id;
}

export async function deleteEquipmentInstance(id: string): Promise<void> {
  const { error } = await supabase.from("equipmentInstances").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["equipmentInstances"] });
}

export function useMachineLoads(
  equipmentInstanceId?: string,
): MachineLoad[] {
  const { data } = useQuery({
    queryKey: ["machineLoads", equipmentInstanceId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("machineLoads").select("*");
      if (equipmentInstanceId) q = q.eq("equipmentInstanceId", equipmentInstanceId);
      const rows = assertOk(await q) as MachineLoad[];
      return rows.sort(
        (a, b) => new Date(b.loadedAt).getTime() - new Date(a.loadedAt).getTime(),
      );
    },
  });
  return data ?? [];
}

export async function saveMachineLoad(
  row: Omit<MachineLoad, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const payload = { ...row, id };
  const { error } = await supabase
    .from("machineLoads")
    .upsert(payload, { onConflict: "id" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["machineLoads"] });
  return id;
}

// =====================================================================
// Production Brain — cold storage units
// =====================================================================

export function useColdStorageUnits(): ColdStorageUnit[] {
  const { data } = useQuery({
    queryKey: ["coldStorageUnits"],
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("coldStorageUnits").select("*"),
      ) as ColdStorageUnit[];
      return rows
        .filter((r) => !r.archived)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  return data ?? [];
}

export async function saveColdStorageUnit(
  row: Omit<ColdStorageUnit, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const payload = { ...row, id };
  const { error } = await supabase
    .from("coldStorageUnits")
    .upsert(payload, { onConflict: "id" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["coldStorageUnits"] });
  return id;
}

// =====================================================================
// Production Brain — productionDayNotes (mig 0091)
// =====================================================================

export function useProductionDayNotes(
  productionDayId: string | undefined,
): ProductionDayNotes | null {
  const { data } = useQuery({
    queryKey: ["productionDayNotes", productionDayId ?? ""],
    enabled: !!productionDayId,
    queryFn: async () =>
      assertOkMaybe(
        await supabase
          .from("productionDayNotes")
          .select("*")
          .eq("productionDayId", productionDayId!)
          .maybeSingle(),
      ) as ProductionDayNotes | null,
  });
  return data ?? null;
}

export async function saveProductionDayNotes(args: {
  productionDayId: string;
  notes: string;
  updatedBy?: string;
}): Promise<void> {
  const trimmed = args.notes.trim();
  // Upsert by productionDayId. We selected a unique index on the
  // column so PostgREST happily upserts on conflict.
  const existing = assertOkMaybe(
    await supabase
      .from("productionDayNotes")
      .select("id")
      .eq("productionDayId", args.productionDayId)
      .maybeSingle(),
  ) as { id?: string } | null;
  if (existing?.id) {
    if (!trimmed) {
      const { error } = await supabase
        .from("productionDayNotes")
        .delete()
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("productionDayNotes")
        .update({ notes: trimmed, updatedAt: new Date(), updatedBy: args.updatedBy ?? null })
        .eq("id", existing.id);
      if (error) throw error;
    }
  } else if (trimmed) {
    const { error } = await supabase.from("productionDayNotes").insert({
      id: newId(),
      productionDayId: args.productionDayId,
      notes: trimmed,
      updatedAt: new Date(),
      updatedBy: args.updatedBy ?? null,
    });
    if (error) throw error;
  }
  queryClient.invalidateQueries({ queryKey: ["productionDayNotes"] });
}

// =====================================================================
// Production Brain — calibrations (mig 0092)
// =====================================================================

export function useCalibrations(equipmentId?: string): Calibration[] {
  const { data } = useQuery({
    queryKey: ["calibrations", equipmentId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("calibrations").select("*");
      if (equipmentId) q = q.eq("equipmentId", equipmentId);
      const rows = assertOk(await q) as Calibration[];
      return rows.sort((a, b) =>
        new Date(b.calibratedAt).getTime() - new Date(a.calibratedAt).getTime(),
      );
    },
  });
  return data ?? [];
}

export async function saveCalibration(
  row: Omit<Calibration, "id" | "createdAt"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const payload = { ...row, id };
  const { error } = await supabase
    .from("calibrations")
    .upsert(payload, { onConflict: "id" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["calibrations"] });
  return id;
}

export async function deleteCalibration(id: string): Promise<void> {
  const { error } = await supabase.from("calibrations").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["calibrations"] });
}

// =====================================================================
// Production Brain — mould usage log
// =====================================================================

export function useMouldUsageLog(mouldPoolId?: string): MouldUsageLog[] {
  const { data } = useQuery({
    queryKey: ["mouldUsageLog", mouldPoolId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("mouldUsageLog").select("*");
      if (mouldPoolId) q = q.eq("mouldPoolId", mouldPoolId);
      const rows = assertOk(await q) as MouldUsageLog[];
      return rows.sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      );
    },
  });
  return data ?? [];
}

export async function saveMouldUsageLog(
  row: Omit<MouldUsageLog, "id" | "createdAt"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const payload = { ...row, id };
  const { error } = await supabase
    .from("mouldUsageLog")
    .upsert(payload, { onConflict: "id" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["mouldUsageLog"] });
  return id;
}

// =====================================================================
// Production Brain — staff shifts (clock-in / clock-out)
// =====================================================================

export function useStaffShifts(
  personId?: string,
  fromDate?: string,
  toDate?: string,
): StaffShift[] {
  const { data } = useQuery({
    queryKey: ["staffShifts", personId ?? "all", fromDate, toDate],
    queryFn: async () => {
      let q = supabase.from("staffShifts").select("*");
      if (personId) q = q.eq("personId", personId);
      if (fromDate) q = q.gte("shiftDate", fromDate);
      if (toDate) q = q.lte("shiftDate", toDate);
      const rows = assertOk(await q) as StaffShift[];
      return rows.sort(
        (a, b) =>
          b.shiftDate.localeCompare(a.shiftDate) ||
          new Date(b.clockInAt).getTime() - new Date(a.clockInAt).getTime(),
      );
    },
  });
  return data ?? [];
}

export async function saveStaffShift(
  row: Omit<StaffShift, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const payload = { ...row, id };
  const { error } = await supabase
    .from("staffShifts")
    .upsert(payload, { onConflict: "id" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["staffShifts"] });
  return id;
}

/** Close an open shift — sets clockOutAt to now (or a supplied timestamp). */
export async function clockOutShift(
  shiftId: string,
  clockOutAt: Date = new Date(),
): Promise<void> {
  const { error } = await supabase
    .from("staffShifts")
    .update({ clockOutAt })
    .eq("id", shiftId);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["staffShifts"] });
}

// =====================================================================
// Production Brain — person availability exceptions (vacation / sick / etc)
// =====================================================================

export function usePersonAvailabilityExceptions(
  personId?: string,
): PersonAvailabilityException[] {
  const { data } = useQuery({
    queryKey: ["personAvailabilityExceptions", personId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("personAvailabilityExceptions").select("*");
      if (personId) q = q.eq("personId", personId);
      const rows = assertOk(await q) as PersonAvailabilityException[];
      return rows.sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
    },
  });
  return data ?? [];
}

export async function savePersonAvailabilityException(
  row: Omit<PersonAvailabilityException, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const payload = { ...row, id };
  const { error } = await supabase
    .from("personAvailabilityExceptions")
    .upsert(payload, { onConflict: "id" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["personAvailabilityExceptions"] });
  return id;
}

export async function deletePersonAvailabilityException(id: string): Promise<void> {
  const { error } = await supabase
    .from("personAvailabilityExceptions")
    .delete()
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["personAvailabilityExceptions"] });
}

// =====================================================================
// Production Brain — product stock (finished goods per batch per location)
// =====================================================================

export function useProductStock(
  productId?: string,
  locationId?: string,
): ProductStock[] {
  const { data } = useQuery({
    queryKey: ["productStock", productId ?? "all", locationId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("productStock").select("*");
      if (productId) q = q.eq("productId", productId);
      if (locationId) q = q.eq("locationId", locationId);
      const rows = assertOk(await q) as ProductStock[];
      return rows.sort((a, b) => {
        if (a.bestBeforeDate && b.bestBeforeDate) {
          return a.bestBeforeDate.localeCompare(b.bestBeforeDate);
        }
        return 0;
      });
    },
  });
  return data ?? [];
}

export async function saveProductStock(
  row: Omit<ProductStock, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const payload = { ...row, id };
  const { error } = await supabase
    .from("productStock")
    .upsert(payload, { onConflict: "id" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["productStock"] });
  return id;
}

// =====================================================================
// Production Brain — stock transfers
// =====================================================================

export function useStockTransfers(
  entityType?: StockTransferEntityType,
  entityId?: string,
): StockTransfer[] {
  const { data } = useQuery({
    queryKey: ["stockTransfers", entityType ?? "all", entityId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("stockTransfers").select("*");
      if (entityType) q = q.eq("entityType", entityType);
      if (entityId) q = q.eq("entityId", entityId);
      const rows = assertOk(await q) as StockTransfer[];
      return rows.sort(
        (a, b) =>
          new Date(b.transferredAt).getTime() - new Date(a.transferredAt).getTime(),
      );
    },
  });
  return data ?? [];
}

export async function saveStockTransfer(
  row: Omit<StockTransfer, "id" | "createdAt"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const payload = { ...row, id };
  const { error } = await supabase
    .from("stockTransfers")
    .upsert(payload, { onConflict: "id" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["stockTransfers"] });
  return id;
}

// =====================================================================
// Production Brain — HACCP temperature readings + incidents
// =====================================================================

export function useTemperatureReadings(
  coldStorageUnitId?: string,
  fromDate?: string,
  toDate?: string,
): TemperatureReading[] {
  const { data } = useQuery({
    queryKey: [
      "temperatureReadings",
      coldStorageUnitId ?? "all",
      fromDate,
      toDate,
    ],
    queryFn: async () => {
      let q = supabase.from("temperatureReadings").select("*");
      if (coldStorageUnitId) q = q.eq("coldStorageUnitId", coldStorageUnitId);
      if (fromDate) q = q.gte("loggedAt", fromDate);
      if (toDate) q = q.lte("loggedAt", toDate);
      const rows = assertOk(await q) as TemperatureReading[];
      return rows.sort(
        (a, b) => new Date(b.loggedAt).getTime() - new Date(a.loggedAt).getTime(),
      );
    },
  });
  return data ?? [];
}

export async function saveTemperatureReading(
  row: Omit<TemperatureReading, "id" | "createdAt"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const payload = { ...row, id };
  const { error } = await supabase
    .from("temperatureReadings")
    .upsert(payload, { onConflict: "id" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["temperatureReadings"] });
  return id;
}

export function useHaccpIncidents(open = false): HaccpIncident[] {
  const { data } = useQuery({
    queryKey: ["haccpIncidents", open ? "open" : "all"],
    queryFn: async () => {
      let q = supabase.from("haccpIncidents").select("*");
      if (open) q = q.is("resolvedAt", null);
      const rows = assertOk(await q) as HaccpIncident[];
      return rows.sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      );
    },
  });
  return data ?? [];
}

export async function saveHaccpIncident(
  row: Omit<HaccpIncident, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const payload = { ...row, id };
  const { error } = await supabase
    .from("haccpIncidents")
    .upsert(payload, { onConflict: "id" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["haccpIncidents"] });
  return id;
}

// =====================================================================
// Production Brain — CSV imports + external SKU mapping
// =====================================================================

export function useCsvImports(): CsvImport[] {
  const { data } = useQuery({
    queryKey: ["csvImports"],
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("csvImports").select("*"),
      ) as CsvImport[];
      return rows.sort(
        (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
      );
    },
  });
  return data ?? [];
}

export async function saveCsvImport(
  row: Omit<CsvImport, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const payload = { ...row, id };
  const { error } = await supabase
    .from("csvImports")
    .upsert(payload, { onConflict: "id" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["csvImports"] });
  return id;
}

export function useExternalSkuMapping(): ExternalSkuMapping[] {
  const { data } = useQuery({
    queryKey: ["externalSkuMapping"],
    queryFn: async () =>
      assertOk(
        await supabase.from("externalSkuMapping").select("*"),
      ) as ExternalSkuMapping[],
  });
  return data ?? [];
}

export async function saveExternalSkuMapping(
  row: Omit<ExternalSkuMapping, "id" | "createdAt"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const payload = { ...row, id };
  const { error } = await supabase
    .from("externalSkuMapping")
    .upsert(payload, { onConflict: "source,externalSku" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["externalSkuMapping"] });
  return id;
}

// =====================================================================
// Production Brain — location stock minimums (generic per-entity)
// =====================================================================

export function useLocationStockMinimums(
  entityType?: LocationMinimumEntityType,
): LocationStockMinimum[] {
  const { data } = useQuery({
    queryKey: ["locationStockMinimums", entityType ?? "all"],
    queryFn: async () => {
      let q = supabase.from("locationStockMinimums").select("*");
      if (entityType) q = q.eq("entityType", entityType);
      const rows = assertOk(await q) as LocationStockMinimum[];
      return rows;
    },
  });
  return data ?? [];
}

export async function saveLocationStockMinimum(
  row: Omit<LocationStockMinimum, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const payload = { ...row, id };
  const { error } = await supabase
    .from("locationStockMinimums")
    .upsert(payload, { onConflict: "entityType,entityId,locationId" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["locationStockMinimums"] });
  return id;
}

// =====================================================================
// Production Brain — notification center
// =====================================================================

export function useNotifications(
  status: NotificationStatus | NotificationStatus[] = "open",
): Notification[] {
  const statusList: NotificationStatus[] = Array.isArray(status) ? status : [status];
  const key = statusList.join(",");
  const { data } = useQuery({
    queryKey: ["notifications", key],
    queryFn: async () => {
      const rows = assertOk(
        await supabase
          .from("notifications")
          .select("*")
          .in("status", statusList),
      ) as Notification[];
      const urgencyWeight: Record<NotificationUrgency, number> = {
        critical: 0,
        high: 1,
        normal: 2,
        low: 3,
      };
      return rows.sort((a, b) => {
        if (a.urgency !== b.urgency) return urgencyWeight[a.urgency] - urgencyWeight[b.urgency];
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });
    },
  });
  return data ?? [];
}

/** Count of open, non-snoozed notifications — drives the bell badge. */
export function useOpenNotificationCount(): number {
  const rows = useNotifications("open");
  const now = Date.now();
  return rows.filter(
    (n) => !n.snoozedUntil || new Date(n.snoozedUntil).getTime() <= now,
  ).length;
}

/** Create or update a notification. Engines call this to queue
 *  suggestions; the UI never writes directly. */
export async function saveNotification(
  row: Omit<Notification, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const payload = { ...row, id };
  const { error } = await supabase
    .from("notifications")
    .upsert(payload, { onConflict: "id" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["notifications"] });
  return id;
}

/** Approve a notification — confirms the suggested action ran. */
export async function approveNotification(
  id: string,
  approvedByPersonId?: string,
): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({
      status: "approved",
      approvedAt: new Date(),
      approvedByPersonId: approvedByPersonId ?? null,
    })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["notifications"] });
}

/** Snooze a notification until the given timestamp (default +1 day). */
export async function snoozeNotification(
  id: string,
  until: Date = new Date(Date.now() + 24 * 60 * 60 * 1000),
): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({
      status: "snoozed",
      snoozedUntil: until,
    })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["notifications"] });
}

/** Dismiss a notification — user rejected the suggestion. */
export async function dismissNotification(id: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({
      status: "dismissed",
      dismissedAt: new Date(),
    })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["notifications"] });
}

/** Bulk approve all notifications of a given type.
 *  Used by the "approve all tier changes" shortcut. */
export async function bulkApproveByType(
  type: NotificationType,
  approvedByPersonId?: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("notifications")
    .update({
      status: "approved",
      approvedAt: new Date(),
      approvedByPersonId: approvedByPersonId ?? null,
    })
    .eq("status", "open")
    .eq("type", type)
    .select("id");
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["notifications"] });
  return (data ?? []).length;
}

/** Bulk dismiss all notifications of a given type. */
export async function bulkDismissByType(type: NotificationType): Promise<number> {
  const { data, error } = await supabase
    .from("notifications")
    .update({
      status: "dismissed",
      dismissedAt: new Date(),
    })
    .eq("status", "open")
    .eq("type", type)
    .select("id");
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["notifications"] });
  return (data ?? []).length;
}

// =====================================================================
// Production Brain — B2B price lists
// =====================================================================

export function usePriceLists(includeArchived = false): PriceList[] {
  const { data } = useQuery({
    queryKey: ["priceLists", { includeArchived }],
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("priceLists").select("*"),
      ) as PriceList[];
      return rows
        .filter((r) => includeArchived || !r.archived)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  return data ?? [];
}

export function usePriceList(id: string | undefined): PriceList | undefined {
  const { data } = useQuery({
    queryKey: ["priceLists", id],
    enabled: !!id,
    queryFn: async () => {
      const row = assertOkMaybe(
        await supabase.from("priceLists").select("*").eq("id", id!).maybeSingle(),
      );
      return row as PriceList | null;
    },
  });
  return data ?? undefined;
}

export async function savePriceList(
  row: Omit<PriceList, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const payload = { ...row, id };
  const { error } = await supabase
    .from("priceLists")
    .upsert(payload, { onConflict: "id" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["priceLists"] });
  return id;
}

export async function deletePriceList(id: string): Promise<void> {
  const { error } = await supabase.from("priceLists").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["priceLists"] });
  queryClient.invalidateQueries({ queryKey: ["priceListItems"] });
}

export function usePriceListItems(priceListId: string | undefined): PriceListItem[] {
  const { data } = useQuery({
    queryKey: ["priceListItems", priceListId],
    enabled: !!priceListId,
    queryFn: async () =>
      assertOk(
        await supabase
          .from("priceListItems")
          .select("*")
          .eq("priceListId", priceListId!),
      ) as PriceListItem[],
  });
  return data ?? [];
}

export async function savePriceListItem(
  row: Omit<PriceListItem, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const payload = { ...row, id };
  const { error } = await supabase
    .from("priceListItems")
    .upsert(payload, { onConflict: "id" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["priceListItems"] });
  return id;
}

export async function deletePriceListItem(id: string): Promise<void> {
  const { error } = await supabase.from("priceListItems").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["priceListItems"] });
}

// =====================================================================
// Production Brain — subscriptions (templates + runs)
// =====================================================================

export function useSubscriptionTemplates(includeInactive = false): SubscriptionTemplate[] {
  const { data } = useQuery({
    queryKey: ["subscriptionTemplates", { includeInactive }],
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("subscriptionTemplates").select("*"),
      ) as SubscriptionTemplate[];
      return rows
        .filter((r) => includeInactive || r.active)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  return data ?? [];
}

export function useSubscriptionTemplate(
  id: string | undefined,
): SubscriptionTemplate | undefined {
  const { data } = useQuery({
    queryKey: ["subscriptionTemplates", id],
    enabled: !!id,
    queryFn: async () => {
      const row = assertOkMaybe(
        await supabase
          .from("subscriptionTemplates")
          .select("*")
          .eq("id", id!)
          .maybeSingle(),
      );
      return row as SubscriptionTemplate | null;
    },
  });
  return data ?? undefined;
}

export async function saveSubscriptionTemplate(
  row: Omit<SubscriptionTemplate, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const payload = { ...row, id };
  const { error } = await supabase
    .from("subscriptionTemplates")
    .upsert(payload, { onConflict: "id" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["subscriptionTemplates"] });
  return id;
}

export async function deleteSubscriptionTemplate(id: string): Promise<void> {
  const { error } = await supabase
    .from("subscriptionTemplates")
    .delete()
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["subscriptionTemplates"] });
}

export function useSubscriptionRuns(templateId?: string): SubscriptionRun[] {
  const { data } = useQuery({
    queryKey: ["subscriptionRuns", templateId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("subscriptionRuns").select("*");
      if (templateId) q = q.eq("templateId", templateId);
      const rows = assertOk(await q) as SubscriptionRun[];
      return rows.sort(
        (a, b) => b.scheduledShipDate.localeCompare(a.scheduledShipDate),
      );
    },
  });
  return data ?? [];
}

export async function saveSubscriptionRun(
  row: Omit<SubscriptionRun, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const payload = { ...row, id };
  const { error } = await supabase
    .from("subscriptionRuns")
    .upsert(payload, { onConflict: "id" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["subscriptionRuns"] });
  return id;
}

export async function deleteSubscriptionRun(id: string): Promise<void> {
  const { error } = await supabase.from("subscriptionRuns").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["subscriptionRuns"] });
}


// =====================================================================
// Production orders — internal demand sibling of customer orders
// (migration 0066). Drives the brain alongside `orders`.
// =====================================================================

export function useProductionOrders(): ProductionOrder[] {
  const { data } = useQuery({
    queryKey: ["productionOrders"],
    queryFn: async () =>
      assertOk(await supabase.from("productionOrders").select("*")) as ProductionOrder[],
  });
  return data ?? [];
}

export function useProductionOrder(id: string | undefined): ProductionOrder | null {
  const { data } = useQuery({
    queryKey: ["productionOrders", "one", id ?? ""],
    enabled: !!id,
    queryFn: async () =>
      assertOkMaybe(
        await supabase.from("productionOrders").select("*").eq("id", id!).maybeSingle(),
      ) as ProductionOrder | null,
  });
  return data ?? null;
}

export function useProductionOrderItems(productionOrderId: string | undefined): ProductionOrderItem[] {
  const { data } = useQuery({
    queryKey: ["productionOrderItems", productionOrderId ?? ""],
    enabled: !!productionOrderId,
    queryFn: async () =>
      assertOk(
        await supabase
          .from("productionOrderItems")
          .select("*")
          .eq("productionOrderId", productionOrderId!)
          .order("sortOrder", { ascending: true }),
      ) as ProductionOrderItem[],
  });
  return data ?? [];
}

export function useAllProductionOrderItems(): ProductionOrderItem[] {
  const { data } = useQuery({
    queryKey: ["productionOrderItems", "all"],
    queryFn: async () =>
      assertOk(
        await supabase.from("productionOrderItems").select("*"),
      ) as ProductionOrderItem[],
  });
  return data ?? [];
}

export async function saveProductionOrder(
  row: Omit<ProductionOrder, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const now = new Date();
  const payload = { ...row, id, updatedAt: now };
  const { error } = await supabase
    .from("productionOrders")
    .upsert(payload, { onConflict: "id" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["productionOrders"] });
  return id;
}

export async function deleteProductionOrder(id: string): Promise<void> {
  // Read the PO first so we know its name — every derived plan is
  // named `PO: <po name> — <product>` and we have to clean those up
  // too. Without the cascade the operator deletes a Replen PO from
  // /production-orders but its child plans linger in /plan, scheduled
  // and untouchable.
  const po = assertOkMaybe(
    await supabase.from("productionOrders").select("name").eq("id", id).maybeSingle(),
  ) as { name: string | null } | null;

  const { error } = await supabase.from("productionOrders").delete().eq("id", id);
  if (error) throw error;

  if (po?.name) {
    const namePrefix = `PO: ${po.name} — `;
    const linkedPlans = assertOk(
      await supabase
        .from("productionPlans")
        .select("id, status")
        .like("name", `${namePrefix}%`),
    ) as Array<{ id: string; status: string }>;

    // Hard-delete draft plans (no work done yet, safe to remove).
    // Mark active plans `orphaned` so they survive for audit / yield
    // recovery but stop scheduling. Done / cancelled stay as-is.
    const draftIds = linkedPlans.filter((p) => p.status === "draft").map((p) => p.id);
    const activeIds = linkedPlans.filter((p) => p.status === "active").map((p) => p.id);

    if (draftIds.length > 0) {
      // Drop downstream rows first to satisfy FKs.
      await supabase.from("productionDayLineItems").delete().in("planId", draftIds);
      await supabase.from("planStepStatus").delete().in("planId", draftIds);
      await supabase.from("planProducts").delete().in("planId", draftIds);
      await supabase.from("orderPlanLinks").delete().in("planId", draftIds);
      await supabase.from("productionPlans").delete().in("id", draftIds);
    }
    if (activeIds.length > 0) {
      await supabase
        .from("productionPlans")
        .update({ status: "orphaned", updatedAt: new Date() })
        .in("id", activeIds);
    }
  }

  queryClient.invalidateQueries({ queryKey: ["productionOrders"] });
  queryClient.invalidateQueries({ queryKey: ["productionOrderItems"] });
  queryClient.invalidateQueries({ queryKey: ["production-plans"] });
  queryClient.invalidateQueries({ queryKey: ["plan-products"] });
  queryClient.invalidateQueries({ queryKey: ["production-day-line-items"] });
  queryClient.invalidateQueries({ queryKey: ["plan-step-statuses"] });
}

export async function saveProductionOrderItem(
  row: Omit<ProductionOrderItem, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const now = new Date();
  const payload = { ...row, id, updatedAt: now };
  const { error } = await supabase
    .from("productionOrderItems")
    .upsert(payload, { onConflict: "id" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["productionOrderItems"] });
  return id;
}

export async function deleteProductionOrderItem(id: string): Promise<void> {
  const { error } = await supabase.from("productionOrderItems").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["productionOrderItems"] });
}

// =====================================================================
// Order variant lines — customer-facing priced lines tied to a variant
// (migration 0068). Brain still reads orderItems; these are display +
// invoice pricing only.
// =====================================================================

export function useOrderVariantLines(orderId: string | undefined): OrderVariantLine[] {
  const { data } = useQuery({
    queryKey: ["orderVariantLines", orderId ?? ""],
    enabled: !!orderId,
    queryFn: async () =>
      assertOk(
        await supabase
          .from("orderVariantLines")
          .select("*")
          .eq("orderId", orderId!)
          .order("sortOrder", { ascending: true }),
      ) as OrderVariantLine[],
  });
  return data ?? [];
}

export function useAllOrderVariantLines(): OrderVariantLine[] {
  const { data } = useQuery({
    queryKey: ["orderVariantLines", "all"],
    queryFn: async () =>
      assertOk(
        await supabase.from("orderVariantLines").select("*"),
      ) as OrderVariantLine[],
  });
  return data ?? [];
}

export async function saveOrderVariantLine(
  row: Omit<OrderVariantLine, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<string> {
  const id = row.id ?? newId();
  const now = new Date();
  const payload = { ...row, id, updatedAt: now };
  const { error } = await supabase
    .from("orderVariantLines")
    .upsert(payload, { onConflict: "id" });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["orderVariantLines"] });
  return id;
}

export async function deleteOrderVariantLine(id: string): Promise<void> {
  const { error } = await supabase.from("orderVariantLines").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["orderVariantLines"] });
}

/** Add a variant to an order: creates the priced variantLine PLUS
 *  derived orderItems for each product in the variant's composition.
 *  Item qty = compositionQty × variant qty. Each derived item carries
 *  variantId + variantPackagingId metadata so the order display can
 *  group them under their parent variant line. Returns the variantLine id. */
export async function addVariantToOrder(args: {
  orderId: string;
  variantId: string;
  variantPackagingId: string | null;
  quantity: number;
  unitPrice: number;
  composition: Array<{ productId: string; qty: number }>; // from variantPackagingProducts
  fulfilmentMode?: "produce" | "borrow";
}): Promise<string> {
  const { orderId, variantId, variantPackagingId, quantity, unitPrice, composition, fulfilmentMode = "produce" } = args;
  // 1. Variant line — what the customer sees / pays.
  const existingLines = assertOk(
    await supabase
      .from("orderVariantLines")
      .select("sortOrder")
      .eq("orderId", orderId),
  ) as Array<{ sortOrder: number }>;
  const nextSort = existingLines.reduce((m, x) => Math.max(m, x.sortOrder ?? 0), -1) + 1;
  const variantLineId = await saveOrderVariantLine({
    orderId,
    variantId,
    variantPackagingId,
    quantity,
    unitPrice,
    sortOrder: nextSort,
  });

  // 2. Derived production-demand orderItems — one per product in the
  //    variant composition. Price = 0 (variantLine carries the money).
  const existingItems = assertOk(
    await supabase
      .from("orderItems")
      .select("sortOrder")
      .eq("orderId", orderId),
  ) as Array<{ sortOrder: number }>;
  let nextItemSort = existingItems.reduce((m, x) => Math.max(m, x.sortOrder ?? 0), -1) + 1;
  for (const c of composition) {
    if (c.qty <= 0) continue;
    await supabase.from("orderItems").insert({
      id: newId(),
      orderId,
      productId: c.productId,
      quantity: c.qty * quantity,
      unitPrice: 0,
      sortOrder: nextItemSort++,
      variantId,
      variantPackagingId: variantPackagingId ?? null,
      fulfilmentMode,
    });
  }
  queryClient.invalidateQueries({ queryKey: ["order-items"] });
  queryClient.invalidateQueries({ queryKey: ["orderItems"] });
  return variantLineId;
}

/** Remove a variant line from an order — also cascade-delete its
 *  derived orderItems (matched on variantId + variantPackagingId). */
export async function removeVariantFromOrder(variantLineId: string): Promise<void> {
  const line = assertOkMaybe(
    await supabase.from("orderVariantLines").select("*").eq("id", variantLineId).maybeSingle(),
  ) as OrderVariantLine | null;
  if (!line) return;
  // Cascade-delete derived orderItems for this (orderId, variantId, vpId).
  let q = supabase.from("orderItems").delete().eq("orderId", line.orderId).eq("variantId", line.variantId);
  if (line.variantPackagingId) {
    q = q.eq("variantPackagingId", line.variantPackagingId);
  } else {
    q = q.is("variantPackagingId", null);
  }
  const { error: itemErr } = await q;
  if (itemErr) throw itemErr;
  await deleteOrderVariantLine(variantLineId);
  queryClient.invalidateQueries({ queryKey: ["order-items"] });
  queryClient.invalidateQueries({ queryKey: ["orderItems"] });
}
