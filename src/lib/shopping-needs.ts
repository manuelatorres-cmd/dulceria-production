/**
 * Planned-demand shopping list — pure logic.
 *
 * For every open order (pending / in_production) we walk:
 *   order → orderItems → products → productFillings → fillingIngredients
 *   × product mould cavity weight × quantity × (1 + fillingBufferPercent)
 *
 * Summed per ingredient. Subtract `currentStockG` to get the shortage
 * that actually needs buying.
 *
 * Keep it simple: gram-equivalent throughout (kg/L × 1000, ml × 1). Units
 * outside {g, kg, ml, L} are skipped with a warning.
 */

import type {
  Order, OrderItem, Product, ProductFilling, FillingIngredient, Ingredient,
  Mould, CapacityConfig, IngredientStock, Campaign, ProductionOrder, ProductionOrderItem,
} from "@/types";

export interface ShoppingNeedRow {
  ingredientId: string;
  name: string;
  /** Total grams needed across every active order. */
  neededG: number;
  /** Grams on hand (0 when unset). */
  onHandG: number;
  /** neededG − onHandG, clamped to 0. */
  shortageG: number;
  /** Ingredient's purchase unit (for display — "buy X kg" vs "X g"). */
  purchaseUnit?: string;
  gramsPerUnit?: number;
}

export interface ShoppingNeedsInput {
  orders: Order[];
  orderItems: OrderItem[];
  products: Product[];
  moulds: Mould[];
  productFillings: ProductFilling[];
  fillingIngredientsByFillingId: Map<string, FillingIngredient[]>;
  ingredients: Ingredient[];
  config: CapacityConfig | null;
  /** New stock-of-truth (migration 0044). When passed, overrides
   *  the legacy `ingredient.currentStockG` mirror so shopping
   *  always sees the same number as the Stock tab. Optional for
   *  backward compat — fall back to currentStockG when omitted. */
  ingredientStock?: IngredientStock[];
  /** Internal production demand sources to add into the needed-grams
   *  total: campaign productTargets and pending production orders.
   *  All optional — omit for the legacy "orders only" calc. */
  campaigns?: Campaign[];
  productionOrders?: ProductionOrder[];
  productionOrderItems?: ProductionOrderItem[];
}

export interface ShoppingNeedsResult {
  rows: ShoppingNeedRow[];
  warnings: string[];
}

export function computeShoppingNeeds(input: ShoppingNeedsInput): ShoppingNeedsResult {
  const {
    orders, orderItems, products, moulds, productFillings,
    fillingIngredientsByFillingId, ingredients, config,
  } = input;

  const warnings: string[] = [];
  const productMap = new Map(products.map((p) => [p.id!, p]));
  const mouldMap = new Map(moulds.map((m) => [m.id!, m]));
  const ingMap = new Map(ingredients.map((i) => [i.id!, i]));

  // productId → ProductFilling[]
  const pfByProduct = new Map<string, ProductFilling[]>();
  for (const pf of productFillings) {
    const arr = pfByProduct.get(pf.productId) ?? [];
    arr.push(pf);
    pfByProduct.set(pf.productId, arr);
  }

  const fillingBufferFactor = 1 + (typeof config?.fillingBufferPercent === "number" ? config.fillingBufferPercent / 100 : 0);

  // ingredientId → grams needed across every order
  const needed = new Map<string, number>();

  const activeOrders = orders.filter((o) => o.status === "pending" || o.status === "in_production");

  for (const order of activeOrders) {
    const lineItems = orderItems.filter((i) => i.orderId === order.id);
    for (const item of lineItems) {
      const product = productMap.get(item.productId);
      if (!product) continue;
      const mould = product.defaultMouldId ? mouldMap.get(product.defaultMouldId) : undefined;
      if (!mould) {
        warnings.push(`"${product.name}" has no default mould — can't convert order quantity to grams.`);
        continue;
      }
      // Total fillings weight per product = cavityWeightG × quantity (each piece = one full cavity)
      const fillingsWeightPerProduct = mould.fillingGramsPerCavity ?? mould.cavityWeightG;
      const totalFillingsG = fillingsWeightPerProduct * item.quantity;

      const pfs = pfByProduct.get(product.id!) ?? [];
      for (const pf of pfs) {
        const pct = (pf.fillPercentage ?? 0) / 100;
        const fillingGrams = pf.fillGrams != null ? pf.fillGrams * item.quantity : totalFillingsG * pct;
        if (fillingGrams <= 0) continue;

        const lis = fillingIngredientsByFillingId.get(pf.fillingId) ?? [];
        // Ingredient-only rows for shopping math. Nested sub-fillings are
        // skipped here — recursion into them is a follow-up.
        const ingLis = lis.filter((li): li is typeof li & { ingredientId: string } => !!li.ingredientId);
        const totalRecipeG = ingLis.reduce((s, li) => s + toGrams(li.amount, li.unit, warnings, ingMap.get(li.ingredientId)?.name), 0);
        if (totalRecipeG <= 0) continue;

        for (const li of ingLis) {
          const amountG = toGrams(li.amount, li.unit, warnings, ingMap.get(li.ingredientId)?.name);
          if (amountG <= 0) continue;
          const fraction = amountG / totalRecipeG;
          const ingredientGrams = fillingGrams * fraction * fillingBufferFactor;
          needed.set(li.ingredientId, (needed.get(li.ingredientId) ?? 0) + ingredientGrams);
        }
      }

      // Shell contribution — rough: product.shellPercentage × cavityWeightG × quantity
      if (product.shellIngredientId) {
        const shellPct = (product.shellPercentage ?? 0) / 100;
        const shellG = mould.cavityWeightG * shellPct * item.quantity * fillingBufferFactor;
        if (shellG > 0) {
          needed.set(product.shellIngredientId, (needed.get(product.shellIngredientId) ?? 0) + shellG);
        }
      }
    }
  }

  // Internal-demand pass: walk each (productId, units) coming from
  // campaign productTargets + pending production-order items. Same
  // math as the order loop, just different demand source. Done as a
  // helper so the two callers reuse the exact same expansion.
  function addInternalDemand(productId: string, units: number) {
    if (units <= 0) return;
    const product = productMap.get(productId);
    if (!product) return;
    const mould = product.defaultMouldId ? mouldMap.get(product.defaultMouldId) : undefined;
    if (!mould) return;
    const fillingsWeightPerProduct = mould.fillingGramsPerCavity ?? mould.cavityWeightG;
    const totalFillingsG = fillingsWeightPerProduct * units;
    const pfs = pfByProduct.get(product.id!) ?? [];
    for (const pf of pfs) {
      const pct = (pf.fillPercentage ?? 0) / 100;
      const fillingGrams = pf.fillGrams != null ? pf.fillGrams * units : totalFillingsG * pct;
      if (fillingGrams <= 0) continue;
      const lis = fillingIngredientsByFillingId.get(pf.fillingId) ?? [];
      const ingLis = lis.filter((li): li is typeof li & { ingredientId: string } => !!li.ingredientId);
      const totalRecipeG = ingLis.reduce((s, li) => s + toGrams(li.amount, li.unit, warnings, ingMap.get(li.ingredientId)?.name), 0);
      if (totalRecipeG <= 0) continue;
      for (const li of ingLis) {
        const amountG = toGrams(li.amount, li.unit, warnings, ingMap.get(li.ingredientId)?.name);
        if (amountG <= 0) continue;
        const fraction = amountG / totalRecipeG;
        const ingredientGrams = fillingGrams * fraction * fillingBufferFactor;
        needed.set(li.ingredientId, (needed.get(li.ingredientId) ?? 0) + ingredientGrams);
      }
    }
    if (product.shellIngredientId) {
      const shellPct = (product.shellPercentage ?? 0) / 100;
      const shellG = mould.cavityWeightG * shellPct * units * fillingBufferFactor;
      if (shellG > 0) {
        needed.set(product.shellIngredientId, (needed.get(product.shellIngredientId) ?? 0) + shellG);
      }
    }
  }
  // Campaign productTargets — only count campaigns that are still
  // open (planned/active) and whose endDate is today or future.
  const todayIso = new Date().toISOString().slice(0, 10);
  for (const c of input.campaigns ?? []) {
    if (c.status !== "planned" && c.status !== "active") continue;
    if (c.endDate && c.endDate < todayIso) continue;
    for (const [pid, units] of Object.entries(c.productTargets ?? {})) {
      addInternalDemand(pid, units);
    }
  }
  // Production orders — only pending / in_production.
  const itemsByPo = new Map<string, ProductionOrderItem[]>();
  for (const it of input.productionOrderItems ?? []) {
    const arr = itemsByPo.get(it.productionOrderId) ?? [];
    arr.push(it);
    itemsByPo.set(it.productionOrderId, arr);
  }
  for (const po of input.productionOrders ?? []) {
    if (po.status !== "pending" && po.status !== "in_production") continue;
    const items = itemsByPo.get(po.id!) ?? [];
    for (const it of items) {
      addInternalDemand(it.productId, it.targetUnits);
    }
  }

  // Stock map keyed by ingredientId for the new ingredientStock table.
  // Falls back to ingredients.currentStockG when no row exists yet.
  const stockMap = new Map<string, number>();
  for (const s of input.ingredientStock ?? []) {
    stockMap.set(s.ingredientId, Number(s.quantityG));
  }

  const rows: ShoppingNeedRow[] = [];
  for (const [id, neededG] of needed.entries()) {
    const ing = ingMap.get(id);
    if (!ing) continue;
    const onHandG = stockMap.has(id) ? stockMap.get(id)! : (ing.currentStockG ?? 0);
    const shortageG = Math.max(0, neededG - onHandG);
    rows.push({
      ingredientId: id,
      name: ing.name,
      neededG: round(neededG),
      onHandG: round(onHandG),
      shortageG: round(shortageG),
      purchaseUnit: ing.purchaseUnit,
      gramsPerUnit: ing.gramsPerUnit,
    });
  }
  rows.sort((a, b) => b.shortageG - a.shortageG || a.name.localeCompare(b.name));

  return { rows, warnings };
}

function toGrams(amount: number, unit: string, warnings: string[], ingredientName?: string): number {
  if (unit === "g" || unit === "ml") return amount;
  if (unit === "kg" || unit === "L") return amount * 1000;
  if (ingredientName) warnings.push(`"${ingredientName}" uses unit "${unit}" — skipped from shopping math (needs g/kg/ml/L).`);
  return 0;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
