"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/dulceria";
import {
  useOrders, useAllOrderItems, useProductsList, useMouldsList,
  useFillings, useFillingCategories, useCapacityConfig, useFillingStockItems,
  useIngredients, useAllIngredientStock,
  useCampaigns, useProductionOrders, useAllProductionOrderItems,
  useProductionPlans, useAllPlanProducts, useAllProductionDayLineItems,
  useProductionDays, useAllOrderPlanLinks,
  saveFillingStock, adjustIngredientStock,
} from "@/lib/hooks";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import type { ProductFilling, FillingIngredient } from "@/types";
import { computeWeeklyFillingNeeds } from "@/lib/weeklyFilling";
import { IconFlame as Flame, IconSnowflake as Snowflake, IconUsers as Users, IconClipboardList as ClipboardList, IconArrowLeft as ArrowLeft, IconCircleCheckFilled as CheckCircle2, IconCircleX as XCircle } from "@tabler/icons-react";

const WINDOW_OPTIONS = [
  { label: "Next 7 days", days: 7 },
  { label: "Next 14 days", days: 14 },
  { label: "Next 30 days", days: 30 },
] as const;

export default function FillingConsolidationPage() {
  const router = useRouter();
  const orders = useOrders();
  const orderItems = useAllOrderItems();
  const products = useProductsList(true);
  const moulds = useMouldsList(true);
  const fillings = useFillings(true);
  const fillingCategories = useFillingCategories(true);
  const stockItems = useFillingStockItems();
  const config = useCapacityConfig();
  const ingredients = useIngredients(true);

  const { data: productFillings = [] } = useQuery({
    queryKey: ["product-fillings", "all-for-weekly"],
    queryFn: async () => assertOk(await supabase.from("productFillings").select("*")) as ProductFilling[],
  });
  const { data: fillingIngredients = [] } = useQuery({
    queryKey: ["filling-ingredients", "all-for-weekly"],
    queryFn: async () => assertOk(await supabase.from("fillingIngredients").select("*")) as FillingIngredient[],
  });

  const [windowDays, setWindowDays] = useState<number>(7);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Mark-cooked modal state. When set, shows a confirm dialog for
  // the chosen filling — operator can tweak actual yield grams,
  // hits Save, the row goes to fillingStock + ingredients deducted.
  const [cookedModal, setCookedModal] = useState<
    | { fillingId: string; fillingName: string; defaultGrams: number; scaled: Array<{ ingredientId: string; amount: number; unit: string }> }
    | null
  >(null);
  const [cookedGrams, setCookedGrams] = useState("");
  const [cookedNotes, setCookedNotes] = useState("");
  const [cookedSaving, setCookedSaving] = useState(false);

  async function applyCooked() {
    if (!cookedModal) return;
    const grams = parseFloat(cookedGrams.replace(",", "."));
    if (isNaN(grams) || grams <= 0) return;
    setCookedSaving(true);
    try {
      // 1) Add the cooked batch to fillingStock so /shop and the
      //    consumption pipeline see it on hand.
      await saveFillingStock({
        fillingId: cookedModal.fillingId,
        remainingG: grams,
        madeAt: new Date().toISOString().slice(0, 10),
        notes: cookedNotes.trim() || undefined,
        createdAt: Date.now(),
      });
      // 2) Deduct each scaled ingredient from on-hand stock so the
      //    shopping list + cookable flag stay accurate. Scale to the
      //    actual cooked grams in case the operator made more or
      //    less than the buffered target.
      const scaleFactor = cookedModal.defaultGrams > 0
        ? grams / cookedModal.defaultGrams
        : 1;
      for (const si of cookedModal.scaled) {
        const recipeG = unitToGramsLocal(si.amount, si.unit) * scaleFactor;
        if (recipeG <= 0) continue;
        try {
          await adjustIngredientStock({
            ingredientId: si.ingredientId,
            deltaG: -recipeG,
            reason: "filling_prep",
            notes: `Used for ${cookedModal.fillingName}`,
          });
        } catch (e) {
          // Don't fail the whole cook on a single ingredient hiccup —
          // operator can fix balances on the ingredient page.
          console.warn("ingredient deduct failed", si.ingredientId, e);
        }
      }
      setCookedModal(null);
      setCookedGrams("");
      setCookedNotes("");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Mark cooked failed");
    } finally {
      setCookedSaving(false);
    }
  }
  function unitToGramsLocal(amount: number, unit: string): number {
    if (unit === "g" || unit === "ml") return amount;
    if (unit === "kg" || unit === "L") return amount * 1000;
    return amount;
  }

  const campaigns = useCampaigns();
  const productionOrdersForCook = useProductionOrders();
  const productionOrderItemsForCook = useAllProductionOrderItems();
  const productionPlans = useProductionPlans();
  const planProducts = useAllPlanProducts();
  const productionDayLineItems = useAllProductionDayLineItems();
  const productionDays = useProductionDays(120);
  const orderPlanLinks = useAllOrderPlanLinks();
  const result = useMemo(() => {
    const windowEnd = new Date();
    windowEnd.setDate(windowEnd.getDate() + windowDays);
    return computeWeeklyFillingNeeds({
      orders,
      orderItems,
      products,
      productFillings,
      fillingIngredients,
      fillings,
      fillingCategories,
      moulds,
      fillingStock: stockItems,
      fillingBufferPercent: config?.fillingBufferPercent,
      windowEnd,
      campaigns,
      productionOrders: productionOrdersForCook,
      productionOrderItems: productionOrderItemsForCook,
      // Plan-driven walk — uses what the reconciler actually decided
      // to make, so 5 orders sharing 1 consolidated mould count as 1
      // mould of demand instead of 5.
      productionPlans,
      planProducts,
      productionDayLineItems,
      productionDays,
      orderPlanLinks,
    });
  }, [orders, orderItems, products, productFillings, fillingIngredients, fillings, fillingCategories, moulds, stockItems, config?.fillingBufferPercent, windowDays, campaigns, productionOrdersForCook, productionOrderItemsForCook, productionPlans, planProducts, productionDayLineItems, productionDays, orderPlanLinks]);

  const ingredientById = useMemo(() => new Map(ingredients.map((i) => [i.id!, i])), [ingredients]);

  // Live ingredient stock keyed by id (with currentStockG fallback for
  // ingredients that don't yet have a row in the new ingredientStock
  // table). Used by the per-filling cookable check below.
  const ingredientStockRows = useAllIngredientStock();
  const onHandG = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of ingredientStockRows) {
      m.set(s.ingredientId, Number(s.quantityG));
    }
    for (const ing of ingredients) {
      if (!m.has(ing.id!) && ing.currentStockG != null) {
        m.set(ing.id!, Number(ing.currentStockG));
      }
    }
    return m;
  }, [ingredientStockRows, ingredients]);

  // Per-filling cookable status. Walks scaledIngredients, converts to
  // grams, checks against on-hand. Returns:
  //   - "covered"  → nothing to cook (existing stock already enough)
  //   - "ready"    → can cook with what's on hand (every ing has enough)
  //   - "short"    → at least one ingredient is below the recipe need
  // The expanded ingredient list also gets per-row short/ok flags.
  type Cookable = "covered" | "ready" | "short";
  type IngStatus = { ingredientId: string; need: number; onHand: number; ok: boolean };
  function unitToGrams(amount: number, unit: string): number {
    if (unit === "g" || unit === "ml") return amount;
    if (unit === "kg" || unit === "L") return amount * 1000;
    return amount; // unknown unit → trust the number
  }
  function statusFor(need: typeof result.needs[number]): { kind: Cookable; ingStatuses: IngStatus[] } {
    if (need.toCookBufferedG === 0) return { kind: "covered", ingStatuses: [] };
    const statuses: IngStatus[] = [];
    let anyShort = false;
    for (const si of need.scaledIngredients) {
      const needG = unitToGrams(si.amount, si.unit);
      const haveG = onHandG.get(si.ingredientId) ?? 0;
      const ok = haveG >= needG;
      if (!ok) anyShort = true;
      statuses.push({ ingredientId: si.ingredientId, need: needG, onHand: haveG, ok });
    }
    return { kind: anyShort ? "short" : "ready", ingStatuses: statuses };
  }

  const totalToCook = result.needs.reduce((acc, n) => acc + n.toCookBufferedG, 0);
  const bufferPct = Math.max(0, Math.min(100, config?.fillingBufferPercent ?? 0));

  function toggleExpanded(fillingId: string) {
    const next = new Set(expanded);
    if (next.has(fillingId)) next.delete(fillingId);
    else next.add(fillingId);
    setExpanded(next);
  }

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader title="Weekly filling cooking list" meta="What to cook across every active order in the window" />

      <div className="px-4 pb-8 space-y-5">
        <button onClick={() => router.back()} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>

        {/* Window selector + summary */}
        <section className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              {WINDOW_OPTIONS.map((opt) => (
                <button
                  key={opt.days}
                  onClick={() => setWindowDays(opt.days)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    windowDays === opt.days
                      ? "bg-accent text-accent-foreground"
                      : "border border-[color:var(--ds-border-warm)] text-muted-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="text-xs text-muted-foreground">
              Buffer {bufferPct}% applied to each batch
              {config?.fillingBufferPercent == null && (
                <>
                  {" "}·{" "}
                  <Link href="/settings" className="text-primary hover:underline">
                    set buffer
                  </Link>
                </>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Orders in window</p>
              <p className="text-2xl font-semibold">{result.ordersInWindow.length}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Fillings to cook</p>
              <p className="text-2xl font-semibold">{result.needs.filter((n) => n.toCookBufferedG > 0).length}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total to cook</p>
              <p className="text-2xl font-semibold tabular-nums">{formatGrams(totalToCook)}</p>
            </div>
          </div>
        </section>

        {/* Unresolved items */}
        {result.unresolved.length > 0 && (
          <section className="rounded-sm border border-status-warn-edge bg-status-warn-bg px-3 py-2.5 text-xs text-status-warn">
            <p className="font-medium">
              {result.unresolved.length} order item{result.unresolved.length > 1 ? "s" : ""} couldn&apos;t be included
            </p>
            <ul className="mt-1 space-y-0.5">
              {result.unresolved.slice(0, 5).map((u, i) => {
                const product = products.find((p) => p.id === u.productId);
                return (
                  <li key={`${u.orderId}-${u.productId}-${i}`}>
                    <span className="font-medium">{product?.name ?? u.productId}</span>
                    {" · "}{u.reason}
                  </li>
                );
              })}
              {result.unresolved.length > 5 && (
                <li>+{result.unresolved.length - 5} more</li>
              )}
            </ul>
          </section>
        )}

        {/* Cooking list */}
        {result.needs.length === 0 ? (
          <div className="rounded-sm border border-dashed border-[color:var(--ds-border-warm)] bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No fillings needed in the next {windowDays} days.
            </p>
          </div>
        ) : (
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-primary flex items-center gap-1.5">
                <Flame className="w-4 h-4" /> Cook list — earliest deadline first
              </h2>
            </div>
            <ul className="space-y-2">
              {[...result.needs].sort((a, b) => {
                // Done (or covered — nothing to cook) sinks to the
                // bottom. Within each group, alphabetical by name so
                // the operator scans the same order every time.
                const aDone = a.toCookBufferedG === 0;
                const bDone = b.toCookBufferedG === 0;
                if (aDone !== bDone) return Number(aDone) - Number(bDone);
                return a.fillingName.localeCompare(b.fillingName);
              }).map((need) => {
                const isOpen = expanded.has(need.fillingId);
                const cookBy = need.cookByDate.toLocaleDateString("de-AT", { weekday: "short", day: "numeric", month: "short" });
                const deadline = need.earliestDeadline.toLocaleDateString("de-AT", { weekday: "short", day: "numeric", month: "short" });
                const daysToCook = Math.round((need.cookByDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
                const cookCls = daysToCook <= 0
                  ? "text-status-alert"
                  : daysToCook <= 2
                    ? "text-status-warn"
                    : "text-muted-foreground";
                const nothingToCook = need.toCookBufferedG === 0;
                const { kind: cookable, ingStatuses } = statusFor(need);
                const ingStatusById = new Map(ingStatuses.map((s) => [s.ingredientId, s]));
                return (
                  <li
                    key={need.fillingId}
                    className={`rounded-sm border bg-card overflow-hidden ${
                      nothingToCook
                        ? "border-status-ok-edge"
                        : cookable === "short"
                        ? "border-status-alert/40"
                        : cookable === "ready"
                        ? "border-status-ok/50"
                        : "border-[color:var(--ds-border-warm)]"
                    }`}
                    style={
                      cookable === "short"
                        ? { boxShadow: "inset 4px 0 0 #9b4f48" }
                        : cookable === "ready"
                        ? { boxShadow: "inset 4px 0 0 #4a7a5e" }
                        : undefined
                    }
                  >
                    <button
                      onClick={() => toggleExpanded(need.fillingId)}
                      className="w-full text-left px-3 py-2.5 hover:bg-muted/20 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {!nothingToCook && cookable === "ready" && (
                              <span title="Every ingredient on stock — ready to cook">
                                <CheckCircle2 className="w-4 h-4 text-status-ok" />
                              </span>
                            )}
                            {cookable === "short" && (
                              <span title="At least one ingredient is short — buy first">
                                <XCircle className="w-4 h-4 text-status-alert" />
                              </span>
                            )}
                            <p className="font-medium text-sm">{need.fillingName}</p>
                            {need.category && (
                              <span className="text-[10px] text-muted-foreground">· {need.category}</span>
                            )}
                            {need.shared && (
                              <span className="inline-flex items-center gap-0.5 rounded-sm border border-primary/40 bg-primary/5 text-primary px-1.5 py-0 text-[10px] font-medium">
                                <Users className="w-2.5 h-2.5" /> Shared ({need.usedBy.length})
                              </span>
                            )}
                            {need.frozenG > 0 && (
                              <span className="inline-flex items-center gap-0.5 rounded-sm border border-sky-200 bg-sky-50 text-sky-700 px-1.5 py-0 text-[10px] font-medium">
                                <Snowflake className="w-2.5 h-2.5" /> {formatGrams(need.frozenG)} frozen
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            Need {formatGrams(need.requiredG)}
                            {need.availableG > 0 && (
                              <>
                                {" · "}have {formatGrams(need.availableG)} in stock
                              </>
                            )}
                            {need.shelfLifeWeeks && (
                              <>
                                {" · "}shelf life {need.shelfLifeWeeks}w
                              </>
                            )}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-sm font-semibold tabular-nums ${nothingToCook ? "text-status-ok" : ""}`}>
                            {nothingToCook ? "— covered —" : `Cook ${formatGrams(need.toCookBufferedG)}`}
                          </p>
                          {!nothingToCook && bufferPct > 0 && (
                            <p className="text-[10px] text-muted-foreground">
                              {formatGrams(need.toCookG)} + {bufferPct}% buffer
                            </p>
                          )}
                          {!nothingToCook && (
                            <p className={`text-[11px] mt-0.5 ${cookCls}`}>
                              cook by {cookBy}
                            </p>
                          )}
                          <p className="text-[10px] text-muted-foreground">deadline {deadline}</p>
                          {!nothingToCook && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCookedModal({
                                  fillingId: need.fillingId,
                                  fillingName: need.fillingName,
                                  defaultGrams: need.toCookBufferedG,
                                  scaled: need.scaledIngredients.map((s) => ({
                                    ingredientId: s.ingredientId,
                                    amount: s.amount,
                                    unit: s.unit,
                                  })),
                                });
                                setCookedGrams(String(need.toCookBufferedG));
                                setCookedNotes("");
                              }}
                              className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] px-2 py-1 rounded-sm bg-foreground text-background hover:opacity-90"
                              title="Add this batch to filling stock + deduct ingredients"
                            >
                              <CheckCircle2 className="w-3 h-3" /> Mark as cooked
                            </button>
                          )}
                        </div>
                      </div>
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 border-t border-[color:var(--ds-border-warm)]/60 bg-muted/10 space-y-3 pt-3">
                        {/* Ingredients */}
                        {need.scaledIngredients.length > 0 && !nothingToCook && (
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
                              <ClipboardList className="w-3 h-3" /> Ingredients for this batch
                            </p>
                            <ul className="divide-y divide-border rounded-md border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)]">
                              {need.scaledIngredients.map((si, i) => {
                                const ing = ingredientById.get(si.ingredientId);
                                const st = ingStatusById.get(si.ingredientId);
                                const ok = st?.ok ?? true;
                                const haveLabel = st
                                  ? (st.onHand >= 1000 ? `${(st.onHand / 1000).toFixed(2)} kg` : `${Math.round(st.onHand)} g`)
                                  : "";
                                return (
                                  <li key={`${si.ingredientId}-${i}`} className="flex items-center justify-between px-2.5 py-1.5 text-xs gap-2">
                                    <span className="flex items-center gap-1.5 min-w-0">
                                      {ok
                                        ? <CheckCircle2 className="w-3 h-3 text-status-ok shrink-0" />
                                        : <XCircle className="w-3 h-3 text-status-alert shrink-0" />}
                                      <span className="truncate">{ing?.name ?? si.ingredientId}</span>
                                    </span>
                                    <span className="tabular-nums text-muted-foreground shrink-0">
                                      {si.amount}{si.unit}
                                      {st && (
                                        <span className={`ml-1.5 text-[10px] ${ok ? "text-status-ok" : "text-status-alert"}`}>
                                          (have {haveLabel})
                                        </span>
                                      )}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}
                        {/* Used by */}
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                            Needed for
                          </p>
                          <ul className="divide-y divide-border rounded-md border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)]">
                            {need.usedBy.map((u, i) => (
                              <li key={`${u.orderId}-${i}`} className="flex items-center justify-between px-2.5 py-1.5 text-xs gap-2">
                                <div className="min-w-0">
                                  <p className="truncate">
                                    <span className="font-medium">{u.orderLabel}</span>
                                    <span className="text-muted-foreground"> · {u.productName}</span>
                                  </p>
                                  <p className="text-[10px] text-muted-foreground">
                                    due {u.deadline.toLocaleDateString("de-AT", { day: "numeric", month: "short" })}
                                  </p>
                                </div>
                                <span className="tabular-nums text-muted-foreground shrink-0">{formatGrams(u.weightG)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        {/* Instructions */}
                        {need.instructions && (
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Instructions</p>
                            <p className="text-xs text-foreground whitespace-pre-line">{need.instructions}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      {/* Mark-cooked confirm modal */}
      {cookedModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 "
          onClick={() => !cookedSaving && setCookedModal(null)}
        >
          <div
            className="bg-card rounded-sm border border-[color:var(--ds-border-warm)] p-5 max-w-[420px] w-[92vw] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold mb-1">
              Mark <span style={{ fontFamily: "var(--font-serif)" }}>{cookedModal.fillingName}</span> as cooked
            </h3>
            <p className="text-[12px] text-muted-foreground mb-4">
              Adds the batch to filling stock and deducts each recipe ingredient
              from on-hand. Edit the actual yield if you cooked more or less than
              the suggested amount.
            </p>
            <label className="block text-[11px] text-muted-foreground mb-1">Cooked amount (grams)</label>
            <input
              type="text"
              inputMode="decimal"
              value={cookedGrams}
              onChange={(e) => setCookedGrams(e.target.value)}
              className="input w-full mb-3"
              autoFocus
            />
            <label className="block text-[11px] text-muted-foreground mb-1">Notes (optional)</label>
            <input
              type="text"
              value={cookedNotes}
              onChange={(e) => setCookedNotes(e.target.value)}
              placeholder="e.g. extra batch for the freezer"
              className="input w-full mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setCookedModal(null)}
                disabled={cookedSaving}
                className="text-[12px] px-3 py-1.5 rounded-sm border border-[color:var(--ds-border-warm)] hover:bg-muted/40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyCooked}
                disabled={cookedSaving || !cookedGrams.trim()}
                className="text-[12px] px-3 py-1.5 rounded-sm bg-foreground text-background disabled:opacity-50"
              >
                {cookedSaving ? "Saving…" : "Mark cooked + deduct ingredients"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatGrams(g: number): string {
  if (g >= 1000) return `${(g / 1000).toFixed(2)} kg`;
  return `${Math.round(g)} g`;
}
