"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import {
  useOrders, useAllOrderItems, useProductsList, useMouldsList,
  useFillings, useFillingCategories, useCapacityConfig, useFillingStockItems,
  useIngredients,
} from "@/lib/hooks";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import type { ProductFilling, FillingIngredient } from "@/types";
import { computeWeeklyFillingNeeds } from "@/lib/weeklyFilling";
import { Flame, Snowflake, Users, ClipboardList, ArrowLeft } from "lucide-react";

const WINDOW_OPTIONS = [
  { label: "Next 7 days", days: 7 },
  { label: "Next 14 days", days: 14 },
  { label: "Next 30 days", days: 30 },
] as const;

export default function FillingConsolidationPage() {
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
    });
  }, [orders, orderItems, products, productFillings, fillingIngredients, fillings, fillingCategories, moulds, stockItems, config?.fillingBufferPercent, windowDays]);

  const ingredientById = useMemo(() => new Map(ingredients.map((i) => [i.id!, i])), [ingredients]);

  const totalToCook = result.needs.reduce((acc, n) => acc + n.toCookBufferedG, 0);
  const bufferPct = Math.max(0, Math.min(100, config?.fillingBufferPercent ?? 0));

  function toggleExpanded(fillingId: string) {
    const next = new Set(expanded);
    if (next.has(fillingId)) next.delete(fillingId);
    else next.add(fillingId);
    setExpanded(next);
  }

  return (
    <div>
      <PageHeader
        title="Weekly filling cooking list"
        description="What to cook across every active order in the window"
      />

      <div className="px-4 pb-8 space-y-5">
        <Link href="/plan" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to plan
        </Link>

        {/* Window selector + summary */}
        <section className="rounded-sm border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              {WINDOW_OPTIONS.map((opt) => (
                <button
                  key={opt.days}
                  onClick={() => setWindowDays(opt.days)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    windowDays === opt.days
                      ? "bg-accent text-accent-foreground"
                      : "border border-border text-muted-foreground"
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
          <div className="rounded-sm border border-dashed border-border bg-card p-8 text-center">
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
              {result.needs.map((need) => {
                const isOpen = expanded.has(need.fillingId);
                const cookBy = need.cookByDate.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
                const deadline = need.earliestDeadline.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
                const daysToCook = Math.round((need.cookByDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
                const cookCls = daysToCook <= 0
                  ? "text-status-alert"
                  : daysToCook <= 2
                    ? "text-status-warn"
                    : "text-muted-foreground";
                const nothingToCook = need.toCookBufferedG === 0;
                return (
                  <li
                    key={need.fillingId}
                    className={`rounded-sm border bg-card overflow-hidden ${
                      nothingToCook ? "border-status-ok-edge" : "border-border"
                    }`}
                  >
                    <button
                      onClick={() => toggleExpanded(need.fillingId)}
                      className="w-full text-left px-3 py-2.5 hover:bg-muted/20 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-medium text-sm">{need.fillingName}</p>
                            {need.category && (
                              <span className="text-[10px] text-muted-foreground">· {need.category}</span>
                            )}
                            {need.shared && (
                              <span className="inline-flex items-center gap-0.5 rounded-full border border-primary/40 bg-primary/5 text-primary px-1.5 py-0 text-[10px] font-medium">
                                <Users className="w-2.5 h-2.5" /> Shared ({need.usedBy.length})
                              </span>
                            )}
                            {need.frozenG > 0 && (
                              <span className="inline-flex items-center gap-0.5 rounded-full border border-sky-200 bg-sky-50 text-sky-700 px-1.5 py-0 text-[10px] font-medium">
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
                        </div>
                      </div>
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 border-t border-border/60 bg-muted/10 space-y-3 pt-3">
                        {/* Ingredients */}
                        {need.scaledIngredients.length > 0 && !nothingToCook && (
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
                              <ClipboardList className="w-3 h-3" /> Ingredients for this batch
                            </p>
                            <ul className="divide-y divide-border rounded-md border border-border bg-card">
                              {need.scaledIngredients.map((si, i) => {
                                const ing = ingredientById.get(si.ingredientId);
                                return (
                                  <li key={`${si.ingredientId}-${i}`} className="flex items-center justify-between px-2.5 py-1.5 text-xs">
                                    <span>{ing?.name ?? si.ingredientId}</span>
                                    <span className="tabular-nums text-muted-foreground">{si.amount}{si.unit}</span>
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
                          <ul className="divide-y divide-border rounded-md border border-border bg-card">
                            {need.usedBy.map((u, i) => (
                              <li key={`${u.orderId}-${i}`} className="flex items-center justify-between px-2.5 py-1.5 text-xs gap-2">
                                <div className="min-w-0">
                                  <p className="truncate">
                                    <span className="font-medium">{u.orderLabel}</span>
                                    <span className="text-muted-foreground"> · {u.productName}</span>
                                  </p>
                                  <p className="text-[10px] text-muted-foreground">
                                    due {u.deadline.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
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
    </div>
  );
}

function formatGrams(g: number): string {
  if (g >= 1000) return `${(g / 1000).toFixed(2)} kg`;
  return `${Math.round(g)} g`;
}
