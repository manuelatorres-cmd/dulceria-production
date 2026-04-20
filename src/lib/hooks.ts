import { useQuery } from "@tanstack/react-query";
import { supabase, newId } from "@/lib/supabase";
import { queryClient } from "@/lib/query-client";
import { assertOk, assertOkMaybe } from "@/lib/supabase-query";
import type { Ingredient, Product, ProductCategory, Filling, FillingCategory, ProductFilling, FillingIngredient, Mould, ProductionPlan, PlanProduct, PlanStepStatus, UserPreferences, ProductFillingHistory, IngredientPriceHistory, ProductCostSnapshot, Experiment, ExperimentIngredient, Packaging, PackagingOrder, PackagingConsumption, ShoppingItem, Collection, CollectionProduct, CollectionPackaging, CollectionPricingSnapshot, DecorationMaterial, DecorationCategory, ShellDesign, FillingStock, IngredientCategory, CapacityConfig, EventCalendarEntry, Person, PersonUnavailability, Equipment, ProductionStep, Order, OrderItem, ProductionScheduleEntry, StockLocation, StockLocationRow, StockMovement, StockLocationMinimum, StockMovementReason, WasteLogEntry, Customer, CustomerContact, CustomerFollowup, Quote, OrderBox, ProductionDay, HaccpTemperatureLog } from "@/types";
import { DEFAULT_PRODUCT_CATEGORIES, DEFAULT_INGREDIENT_CATEGORIES, DEFAULT_COATINGS, SHELF_STABLE_CATEGORIES, costPerGram as deriveIngredientCostPerGram, hasPricingData, type MarketRegion, type CurrencyCode, type FillMode, getCurrencySymbol } from "@/types";
import { validateCategoryRange } from "@/lib/productCategories";
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

export async function saveIngredient(ingredient: Omit<Ingredient, "id"> & { id?: string }) {
  let savedId: string;
  let priceChanged = false;

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
    const { error } = await supabase
      .from("ingredients")
      .update(stripUndef({ ...ingredient, updatedAt: new Date() }))
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
    await saveIngredientPriceEntry(savedId, savedIngredient);
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
        await supabase.from("products").select("id, name, popularity, productCategoryId, shellIngredientId, shellPercentage, fillMode, coating, productType, tags, notes, shelfLifeWeeks, lowStockThreshold, stockCountedAt, defaultMouldId, defaultBatchQty, shellDesign, stepDurationOverrides, vegan, archived, createdAt, updatedAt"),
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
      const rows = assertOk(await supabase.from("productionPlans").select("*")) as ProductionPlan[];
      return rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },
  });
  return data ?? [];
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

export async function generateBatchNumber(date: Date): Promise<string> {
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
  const { count, error } = await supabase
    .from("productionPlans")
    .select("*", { count: "exact", head: true });
  if (error) throw error;
  const seq = String((count ?? 0) + 1).padStart(3, "0");
  return `${dateStr}-${seq}`;
}

export async function saveProductionPlan(plan: Omit<ProductionPlan, "id"> & { id?: string }): Promise<string> {
  const now = new Date();
  const completedAt = plan.status === "done"
    ? (plan.completedAt ?? now)
    : null;
  if (plan.id) {
    const { error } = await supabase
      .from("productionPlans")
      .update({ ...plan, updatedAt: now, completedAt })
      .eq("id", plan.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["production-plans"] });
    return plan.id;
  }
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
  queryClient.invalidateQueries({ queryKey: ["production-plans"] });
  return createdId;
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
 *   1. If the product has `lowStockThreshold` set → compare against the sum of
 *      `currentStock` (falling back to `actualYield`) across non-"gone" batches.
 *      0 → "gone", below threshold → "low".
 *   2. Otherwise fall back to the legacy per-batch `stockStatus` flag: "gone"
 *      only when all batches are gone, "low" when any is flagged low.
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
    const [allBatches, allProducts] = await Promise.all([
      supabase.from("planProducts").select("*").in("planId", planIds).then((r) => assertOk(r) as PlanProduct[]),
      supabase.from("products").select("*").then((r) => assertOk(r) as Product[]),
    ]);
    const productsById = new Map(allProducts.map((p) => [p.id!, p] as const));

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
      const product = productsById.get(productId);
      const threshold = product?.lowStockThreshold;
      if (typeof threshold === "number" && threshold >= 0) {
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
    queryFn: async () => assertOk(await supabase.from("planProducts").select("*")) as PlanProduct[],
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
    queryFn: async () => assertOk(await supabase.from("planStepStatus").select("*")) as PlanStepStatus[],
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

async function saveIngredientPriceEntry(ingredientId: string, ingredient: Ingredient): Promise<void> {
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
  const [fillings, ...liArrays] = await Promise.all([
    fillingIds.length > 0
      ? supabase.from("fillings").select("*").in("id", fillingIds).then((r) => assertOk(r) as Filling[])
      : Promise.resolve([] as Filling[]),
    ...fillingIds.map((lid) =>
      supabase.from("fillingIngredients").select("*").eq("fillingId", lid).then((r) => assertOk(r) as FillingIngredient[]),
    ),
  ]);

  const fillingsMap = new Map(fillings.map((l) => [l.id!, l]));
  const fillingIngredientsMap = new Map<string, typeof liArrays[0]>();
  fillingIds.forEach((lid, i) => fillingIngredientsMap.set(lid, liArrays[i]));

  const ingredientCostMap = buildIngredientCostMap(allIngredients);
  const ingredientMap = new Map(allIngredients.map((i) => [i.id!, i]));

  // Resolve the shell chocolate cost directly from the product's shellIngredientId
  const shellIngredientId = product.shellIngredientId;
  const shellCostPerGram = shellIngredientId ? (ingredientCostMap.get(shellIngredientId) ?? null) : null;
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
    const usedIngredientIds = [...new Set(allFillingIngredients.map((li) => li.ingredientId))];
    const allPriced = usedIngredientIds.every((id) => {
      const ing = ingredientMap.get(id);
      return ing && hasPricingData(ing);
    });
    const shellIngredientPriced = shellPercentage === 0 || !shellIngredientId || (shellIngredient ? hasPricingData(shellIngredient) : false);
    if (!allPriced || !shellIngredientPriced) return;

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
    shellChocolateLabel: shellIngredient?.name,
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

/** Returns true if the packaging is referenced by any collection. */
export async function isPackagingInUse(id: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("collectionPackagings")
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

// --- Collections ---

export function useCollections(): Collection[] {
  const { data } = useQuery({
    queryKey: ["collections"],
    queryFn: async () => {
      const rows = assertOk(await supabase.from("collections").select("*")) as Collection[];
      return rows.sort((a, b) => b.startDate.localeCompare(a.startDate));
    },
  });
  return data ?? [];
}

export function useCollection(id: string | undefined): Collection | undefined {
  const { data } = useQuery({
    queryKey: ["collections", id],
    enabled: !!id,
    queryFn: async () => {
      const row = assertOkMaybe(
        await supabase.from("collections").select("*").eq("id", id!).maybeSingle(),
      );
      return row as Collection | null;
    },
  });
  return data ?? undefined;
}

export async function saveCollection(obj: Omit<Collection, "id"> & { id?: string }): Promise<string> {
  const now = new Date();
  if (obj.id) {
    const { error } = await supabase
      .from("collections")
      .update({ ...obj, updatedAt: now })
      .eq("id", obj.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["collections"] });
    return obj.id;
  }
  const createdId = newId();
  const { error } = await supabase
    .from("collections")
    .insert({ ...obj, id: createdId, createdAt: now, updatedAt: now });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["collections"] });
  return createdId;
}

export async function deleteCollection(id: string): Promise<void> {
  const delCp = await supabase.from("collectionProducts").delete().eq("collectionId", id);
  if (delCp.error) throw delCp.error;
  const delCpk = await supabase.from("collectionPackagings").delete().eq("collectionId", id);
  if (delCpk.error) throw delCpk.error;
  const { error } = await supabase.from("collections").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["collections"] });
  queryClient.invalidateQueries({ queryKey: ["collection-products"] });
  queryClient.invalidateQueries({ queryKey: ["collection-packagings"] });
}

export function useAllCollectionProducts(): CollectionProduct[] {
  const { data } = useQuery({
    queryKey: ["collection-products", "all"],
    queryFn: async () => assertOk(await supabase.from("collectionProducts").select("*")) as CollectionProduct[],
  });
  return data ?? [];
}

export function useCollectionProducts(collectionId: string | undefined): CollectionProduct[] {
  const { data } = useQuery({
    queryKey: ["collection-products", collectionId],
    enabled: !!collectionId,
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("collectionProducts").select("*").eq("collectionId", collectionId!),
      ) as CollectionProduct[];
      return rows.sort((a, b) => a.sortOrder - b.sortOrder);
    },
  });
  return data ?? [];
}

export async function addProductToCollection(collectionId: string, productId: string): Promise<void> {
  const existing = assertOk(
    await supabase.from("collectionProducts").select("*").eq("collectionId", collectionId),
  ) as CollectionProduct[];
  if (existing.some((r) => r.productId === productId)) return;
  const maxSort = existing.reduce((m, r) => Math.max(m, r.sortOrder), -1);
  const { error } = await supabase
    .from("collectionProducts")
    .insert({ id: newId(), collectionId, productId, sortOrder: maxSort + 1 });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["collection-products"] });
}

export async function removeProductFromCollection(id: string): Promise<void> {
  const { error } = await supabase.from("collectionProducts").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["collection-products"] });
}

// --- Collection Packagings (box pricing) ---

export function useCollectionPackagings(collectionId: string | undefined): CollectionPackaging[] {
  const { data } = useQuery({
    queryKey: ["collection-packagings", collectionId],
    enabled: !!collectionId,
    queryFn: async () =>
      assertOk(
        await supabase.from("collectionPackagings").select("*").eq("collectionId", collectionId!),
      ) as CollectionPackaging[],
  });
  return data ?? [];
}

export function useAllCollectionPackagings(): CollectionPackaging[] {
  const { data } = useQuery({
    queryKey: ["collection-packagings", "all"],
    queryFn: async () => assertOk(await supabase.from("collectionPackagings").select("*")) as CollectionPackaging[],
  });
  return data ?? [];
}

export async function saveCollectionPackaging(obj: Omit<CollectionPackaging, "id"> & { id?: string }): Promise<string> {
  const now = new Date();
  if (obj.id) {
    const { error } = await supabase
      .from("collectionPackagings")
      .update({ ...obj, updatedAt: now })
      .eq("id", obj.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["collection-packagings"] });
    return obj.id;
  }
  const createdId = newId();
  const { error } = await supabase
    .from("collectionPackagings")
    .insert({ ...obj, id: createdId, createdAt: now, updatedAt: now });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["collection-packagings"] });
  return createdId;
}

export async function deleteCollectionPackaging(id: string): Promise<void> {
  const { error } = await supabase.from("collectionPackagings").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["collection-packagings"] });
}

// --- Collection Pricing Snapshots (margin history) ---

/** All pricing snapshots for a collection, newest-first */
export function useCollectionPricingSnapshots(collectionId: string | undefined): CollectionPricingSnapshot[] {
  const { data } = useQuery({
    queryKey: ["collection-pricing-snapshots", collectionId],
    enabled: !!collectionId,
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("collectionPricingSnapshots").select("*").eq("collectionId", collectionId!),
      ) as CollectionPricingSnapshot[];
      return rows.sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());
    },
  });
  return data ?? [];
}

export async function saveCollectionPricingSnapshot(
  obj: Omit<CollectionPricingSnapshot, "id"> & { id?: string },
): Promise<string> {
  if (obj.id) {
    const { error } = await supabase.from("collectionPricingSnapshots").update(obj).eq("id", obj.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["collection-pricing-snapshots"] });
    return obj.id;
  }
  const createdId = newId();
  const { error } = await supabase
    .from("collectionPricingSnapshots")
    .insert({ ...obj, id: createdId });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["collection-pricing-snapshots"] });
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

export async function saveProductionStep(
  step: Omit<ProductionStep, "createdAt" | "updatedAt">,
): Promise<string> {
  const now = new Date();
  if (step.id) {
    const { error } = await supabase
      .from("productionSteps")
      .update({ ...step, updatedAt: now })
      .eq("id", step.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["production-steps"] });
    return step.id;
  }
  const id = newId();
  const { error } = await supabase
    .from("productionSteps")
    .insert({ ...step, id, createdAt: now, updatedAt: now });
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
    const { error } = await supabase
      .from("orders")
      .update(stripUndef({ ...order, updatedAt: now }))
      .eq("id", order.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["orders"] });
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
  const { error } = await supabase.from("orders").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["orders"] });
  queryClient.invalidateQueries({ queryKey: ["order-items"] });
}

export async function saveOrderItem(item: Omit<OrderItem, "id"> & { id?: string }): Promise<string> {
  if (item.id) {
    const { error } = await supabase.from("orderItems").update(item).eq("id", item.id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["order-items"] });
    return item.id;
  }
  const id = newId();
  const { error } = await supabase.from("orderItems").insert({ ...item, id });
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["order-items"] });
  return id;
}

export async function deleteOrderItem(id: string): Promise<void> {
  const { error } = await supabase.from("orderItems").delete().eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["order-items"] });
}

// ---------------------------------------------------------------------------
// Production schedule (scheduler output)
// ---------------------------------------------------------------------------

export function useProductionSchedule(): ProductionScheduleEntry[] {
  const { data } = useQuery({
    queryKey: ["production-schedule"],
    queryFn: async () => {
      const rows = assertOk(
        await supabase.from("productionSchedule").select("*"),
      ) as ProductionScheduleEntry[];
      return rows.sort((a, b) => a.startAt.localeCompare(b.startAt));
    },
  });
  return data ?? [];
}

/** Replace every scheduled row with the given entries, in one transaction-ish
 *  flow: delete all then bulk-insert. Triggered by the Plan page's Regenerate
 *  button. */
/** Replace the production schedule atomically-enough that a failed
 *  INSERT doesn't wipe the existing plan.
 *
 *  The old version deleted first, then inserted — if the INSERT failed
 *  (e.g. the stepId column was missing from the schema cache) the user
 *  was left with an empty schedule and no way to recover. This variant:
 *
 *    1. Reads the IDs of every existing schedule row.
 *    2. Inserts the new rows (with fresh UUIDs). The table briefly
 *       holds both old + new.
 *    3. Deletes only the old rows by their ID list.
 *
 *  If step 2 throws, step 3 never runs and the existing plan stays
 *  intact. Any stale row from a prior failed attempt gets cleaned up
 *  on the next successful regenerate. Cleanup is bounded to the
 *  known-old ID set so we never accidentally delete the new rows.
 */
export async function replaceProductionSchedule(
  entries: Omit<ProductionScheduleEntry, "id" | "createdAt" | "updatedAt">[],
): Promise<void> {
  // Snapshot existing IDs before we write anything.
  const existing = assertOk(
    await supabase.from("productionSchedule").select("id"),
  ) as Array<{ id: string }>;
  const existingIds = existing.map((r) => r.id);

  // Insert new rows first. If this throws (e.g. PGRST204 for a missing
  // column, 23502 NOT-NULL, 23503 FK violation), the caller sees the
  // error and the old schedule is still fully intact.
  if (entries.length > 0) {
    const withIds = entries.map((e) => ({ ...e, id: newId() }));
    const { error: insErr } = await supabase.from("productionSchedule").insert(withIds);
    if (insErr) throw insErr;
  }

  // Only once the insert has landed do we clean up the previous set.
  if (existingIds.length > 0) {
    const { error: delErr } = await supabase
      .from("productionSchedule")
      .delete()
      .in("id", existingIds);
    if (delErr) throw delErr;
  }

  queryClient.invalidateQueries({ queryKey: ["production-schedule"] });
}

export async function updateScheduleStatus(
  id: string,
  status: ProductionScheduleEntry["status"],
): Promise<void> {
  const { error } = await supabase
    .from("productionSchedule")
    .update({ status, updatedAt: new Date() })
    .eq("id", id);
  if (error) throw error;
  queryClient.invalidateQueries({ queryKey: ["production-schedule"] });
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
): Promise<void> {
  if (delta === 0) return;
  const q = supabase
    .from("stockLocations")
    .select("*")
    .eq("planProductId", planProductId)
    .eq("location", location);
  const existing = assertOk(
    await (orderId == null ? q.is("orderId", null) : q.eq("orderId", orderId)),
  ) as StockLocationRow[];
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
  /** Only required when `fromLocation` or `toLocation` is 'allocated'. */
  orderId?: string;
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
  await upsertStockLocationRow(args.planProductId, args.fromLocation, fromOrderId, -qty);
  await upsertStockLocationRow(args.planProductId, args.toLocation, toOrderId, qty);
  await logStockMovement({
    planProductId: args.planProductId,
    productId: args.productId,
    fromLocation: args.fromLocation,
    toLocation: args.toLocation,
    quantity: qty,
    orderId: args.orderId,
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
export async function convertQuoteToOrder(quoteId: string): Promise<string> {
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

  const { error: insOrderErr } = await supabase.from("orders").insert({
    id: orderId,
    channel: "b2b",
    customerId: quote.customerId,
    customerName: customer?.companyName ?? "",
    deadline: quote.deadline ?? now,
    priority: "normal",
    status: "pending",
    notes: quote.notes ?? null,
    createdAt: now,
    updatedAt: now,
  });
  if (insOrderErr) throw insOrderErr;

  // Product-line items (box lines are captured in orderBoxes instead).
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

  // Box lines → orderBoxes rows.
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

  // Update quote status + link back to order.
  const { error: updQErr } = await supabase
    .from("quotes")
    .update({ status: "won", convertedToOrderId: orderId, updatedAt: now })
    .eq("id", quoteId);
  if (updQErr) throw updQErr;

  queryClient.invalidateQueries({ queryKey: ["quotes"] });
  queryClient.invalidateQueries({ queryKey: ["orders"] });
  queryClient.invalidateQueries({ queryKey: ["order-items"] });
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
  items: Array<{ productId: string; quantity: number; unitPrice?: number; notes?: string }>;
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
  const orderRows = fresh.map((o) => ({
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
    deliveryType: o.shippingAddress ? "ship" : null,
    createdAt: o.placedAt ?? now,
    updatedAt: now,
  }));

  const { error: insOrdersErr } = await supabase.from("orders").insert(orderRows);
  if (insOrdersErr) throw insOrdersErr;

  const itemRows = fresh.flatMap((o, oi) =>
    o.items.map((it, ii) => ({
      id: newId(),
      orderId: orderRows[oi].id,
      productId: it.productId,
      quantity: it.quantity,
      unitPrice: it.unitPrice ?? null,
      sortOrder: ii,
      notes: it.notes ?? null,
    })),
  );
  if (itemRows.length > 0) {
    const { error: insItemsErr } = await supabase.from("orderItems").insert(itemRows);
    if (insItemsErr) throw insItemsErr;
  }

  queryClient.invalidateQueries({ queryKey: ["orders"] });
  queryClient.invalidateQueries({ queryKey: ["order-items"] });
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

/** Create — or return — today's productionDay row. Fires when the user
 *  clicks "Open Production" on the dashboard. Idempotent so clicking it
 *  twice is safe. */
export async function openProductionDay(openedBy?: string): Promise<ProductionDay> {
  const today = todayDateString();
  const existing = assertOkMaybe(
    await supabase.from("productionDays").select("*").eq("date", today).maybeSingle(),
  ) as ProductionDay | null;
  if (existing) return existing;
  const id = newId();
  const now = new Date();
  const { error } = await supabase.from("productionDays").insert({
    id,
    date: today,
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
    id, date: today, openedAt: now, openedBy,
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

/** Close today's production day. Unfinished productionSchedule rows whose
 *  startAt falls today or earlier get pushed forward by one day, preserving
 *  their status + duration. Returns a summary for the UI to display. */
export async function closeProductionDay(closedBy?: string): Promise<CloseProductionSummary> {
  const today = todayDateString();
  const dayRow = assertOkMaybe(
    await supabase.from("productionDays").select("*").eq("date", today).maybeSingle(),
  ) as ProductionDay | null;
  if (!dayRow) throw new Error("No production day is open. Click Open Production first.");

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const schedule = assertOk(
    await supabase.from("productionSchedule").select("*").lte("startAt", endOfToday.toISOString()),
  ) as ProductionScheduleEntry[];

  let stepsCompleted = 0;
  const toCarry: ProductionScheduleEntry[] = [];
  for (const s of schedule) {
    if (s.status === "done" || s.status === "skipped") stepsCompleted++;
    else if (s.status === "pending" || s.status === "in_progress" || s.status === "blocked") toCarry.push(s);
  }

  const DAY_MS = 24 * 60 * 60 * 1000;
  if (toCarry.length > 0) {
    await Promise.all(toCarry.map(async (s) => {
      const newStart = new Date(new Date(s.startAt).getTime() + DAY_MS);
      const newEnd = new Date(new Date(s.endAt).getTime() + DAY_MS);
      const { error } = await supabase
        .from("productionSchedule")
        .update({
          startAt: newStart.toISOString(),
          endAt: newEnd.toISOString(),
          updatedAt: new Date(),
        })
        .eq("id", s.id!);
      if (error) throw error;
    }));
  }

  // Pieces produced today — sum of unmould intake movements that landed
  // between startOfToday and now.
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
    schedule.filter((s) => s.status === "done" && s.planId != null).map((s) => s.planId),
  ).size;

  const carriedOrderIds = Array.from(new Set(toCarry.map((s) => s.orderId).filter((x): x is string => !!x)));
  let carriedDeadlineAffected: CloseProductionSummary["carriedDeadlineAffected"] = [];
  if (carriedOrderIds.length > 0) {
    const orders = assertOk(
      await supabase.from("orders").select("id, customerName, eventName, deadline").in("id", carriedOrderIds),
    ) as Array<{ id: string; customerName?: string; eventName?: string; deadline: string }>;
    carriedDeadlineAffected = orders
      .filter((o) => new Date(o.deadline).getTime() <= endOfToday.getTime() + DAY_MS)
      .map((o) => ({
        orderId: o.id,
        orderName: o.customerName ?? o.eventName ?? "Order",
        deadline: o.deadline,
      }));
  }

  const summary: CloseProductionSummary = {
    productionDayId: dayRow.id!,
    stepsCompleted,
    stepsCarriedForward: toCarry.length,
    piecesProduced,
    batchesRun,
    carriedDeadlineAffected,
  };

  const now = new Date();
  const { error } = await supabase
    .from("productionDays")
    .update({
      closedAt: now,
      closedBy: closedBy ?? null,
      summaryJson: {
        batchesRun,
        piecesProduced,
        stepsCompleted,
        stepsCarriedForward: toCarry.length,
      },
      updatedAt: now,
    })
    .eq("id", dayRow.id!);
  if (error) throw error;

  queryClient.invalidateQueries({ queryKey: ["production-day"] });
  queryClient.invalidateQueries({ queryKey: ["production-days"] });
  queryClient.invalidateQueries({ queryKey: ["production-schedule"] });
  return summary;
}
