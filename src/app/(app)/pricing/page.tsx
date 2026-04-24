"use client";

import { useMemo } from "react";
import {
  useVariants,
  useAllVariantPackagings,
  useAllVariantProducts,
  usePackagingList,
  useAllPackagingOrders,
  useCurrencySymbol,
} from "@/lib/hooks";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import type { Variant, VariantPackaging, Packaging, PackagingOrder, ProductCostSnapshot, VariantProduct } from "@/types";
import {
  latestPackagingUnitCost,
  averageProductCost,
  calculateBoxPricing,
  marginHealth,
  formatPrice,
  formatMarginPercent,
  type ProductCostEntry,
  type BoxPricingResult,
  type MarginHealth,
} from "@/lib/variantPricing";

type VariantStatus = "active" | "upcoming" | "past" | "permanent";

function getStatus(startDate: string, endDate?: string): VariantStatus {
  const today = new Date().toISOString().split("T")[0];
  if (!endDate) return startDate <= today ? "permanent" : "upcoming";
  if (startDate > today) return "upcoming";
  if (endDate < today) return "past";
  return "active";
}

const STATUS_LABEL: Record<VariantStatus, string> = {
  permanent: "Standard",
  active: "Active",
  upcoming: "Upcoming",
  past: "Past",
};

const STATUS_CLASS: Record<VariantStatus, string> = {
  permanent: "text-primary bg-primary/10",
  active: "text-emerald-700 bg-emerald-50",
  upcoming: "text-status-warn bg-status-warn-bg",
  past: "text-muted-foreground bg-muted",
};

const MARGIN_COLORS: Record<MarginHealth, { bar: string; text: string; bg: string }> = {
  healthy: { bar: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50" },
  thin: { bar: "bg-status-warn", text: "text-status-warn", bg: "bg-status-warn-bg" },
  negative: { bar: "bg-status-alert", text: "text-status-alert", bg: "bg-status-alert-bg" },
};

interface VariantWithPricing {
  variant: Variant;
  status: VariantStatus;
  avgProductCost: number | null;
  productCount: number;
  costDataCount: number;
  boxes: {
    packaging: Packaging;
    pricing: BoxPricingResult;
    health: MarginHealth;
  }[];
  bestMargin: number | null;
  worstMargin: number | null;
}

export default function PricingPage() {
  const variants = useVariants();
  const allCPs = useAllVariantPackagings();
  const allPackaging = usePackagingList(true);
  const allOrders = useAllPackagingOrders();
  const sym = useCurrencySymbol();

  // Load all variantProducts and productCostSnapshots in bulk
  const allVariantProducts = useAllVariantProducts();
  const { data: allSnapshots = [] } = useQuery({
    queryKey: ["product-cost-snapshots", "all"],
    queryFn: async () => assertOk(await supabase.from("productCostSnapshots").select("*")) as ProductCostSnapshot[],
  });

  // Build lookup maps
  const packagingMap = useMemo(() => {
    const m = new Map<string, Packaging>();
    for (const p of allPackaging) if (p.id) m.set(p.id, p);
    return m;
  }, [allPackaging]);

  const ordersByPackaging = useMemo(() => {
    const m = new Map<string, PackagingOrder[]>();
    for (const o of allOrders) {
      const arr = m.get(o.packagingId) ?? [];
      arr.push(o);
      m.set(o.packagingId, arr);
    }
    return m;
  }, [allOrders]);

  // Group variant products by variantId
  const productsByVariant = useMemo(() => {
    const m = new Map<string, VariantProduct[]>();
    for (const cr of allVariantProducts) {
      const arr = m.get(cr.variantId) ?? [];
      arr.push(cr);
      m.set(cr.variantId, arr);
    }
    return m;
  }, [allVariantProducts]);

  // Latest snapshot per product (pick the most recent recordedAt per productId)
  const latestSnapshotByProduct = useMemo(() => {
    const m = new Map<string, ProductCostSnapshot>();
    for (const snap of allSnapshots) {
      const existing = m.get(snap.productId);
      if (!existing || new Date(snap.recordedAt).getTime() > new Date(existing.recordedAt).getTime()) {
        m.set(snap.productId, snap);
      }
    }
    return m;
  }, [allSnapshots]);

  // Group CPs by variantId
  const cpsByVariant = useMemo(() => {
    const m = new Map<string, VariantPackaging[]>();
    for (const cp of allCPs) {
      const arr = m.get(cp.variantId) ?? [];
      arr.push(cp);
      m.set(cp.variantId, arr);
    }
    return m;
  }, [allCPs]);

  // Build pricing data per variant
  const pricedVariants: VariantWithPricing[] = useMemo(() => {
    return variants
      .filter((c) => {
        const cps = cpsByVariant.get(c.id ?? "") ?? [];
        return cps.length > 0; // only show variants that have box pricing configured
      })
      .map((c) => {
        const cId = c.id ?? "";
        const status = getStatus(c.startDate, c.endDate);
        const crs = productsByVariant.get(cId) ?? [];
        const costs: ProductCostEntry[] = [];
        for (const cr of crs) {
          const snap = latestSnapshotByProduct.get(cr.productId);
          if (snap) costs.push({ productId: cr.productId, costPerProduct: snap.costPerProduct });
        }
        const avg = averageProductCost(costs);
        const cps = cpsByVariant.get(cId) ?? [];

        const boxes = avg
          ? cps.map((cp) => {
              const pkg = packagingMap.get(cp.packagingId);
              const orders = ordersByPackaging.get(cp.packagingId) ?? [];
              const unitCost = latestPackagingUnitCost(orders) ?? 0;
              const capacity = pkg?.capacity ?? 0;
              const pricing = calculateBoxPricing(avg.avg, capacity, unitCost, cp.sellPrice);
              const health = marginHealth(pricing.marginPercent);
              return { packaging: pkg!, pricing, health };
            }).filter((b) => b.packaging)
          : [];

        const margins = boxes.map((b) => b.pricing.marginPercent);
        const bestMargin = margins.length > 0 ? Math.max(...margins) : null;
        const worstMargin = margins.length > 0 ? Math.min(...margins) : null;

        return {
          variant: c,
          status,
          avgProductCost: avg?.avg ?? null,
          productCount: crs.length,
          costDataCount: costs.length,
          boxes,
          bestMargin,
          worstMargin,
        };
      });
  }, [variants, cpsByVariant, productsByVariant, latestSnapshotByProduct, packagingMap, ordersByPackaging]);

  // Sort: active/permanent first, then by worst margin ascending (worst margins at top = needs attention)
  const sorted = useMemo(() => {
    const statusOrder: Record<VariantStatus, number> = { active: 0, permanent: 1, upcoming: 2, past: 3 };
    return [...pricedVariants].sort((a, b) => {
      const sa = statusOrder[a.status] ?? 9;
      const sb = statusOrder[b.status] ?? 9;
      if (sa !== sb) return sa - sb;
      // Within same status, worst margin first
      const ma = a.worstMargin ?? 999;
      const mb = b.worstMargin ?? 999;
      return ma - mb;
    });
  }, [pricedVariants]);

  // Summary stats
  const summary = useMemo(() => {
    const allMargins = sorted.flatMap((c) => c.boxes.map((b) => b.pricing.marginPercent));
    const negativeCount = allMargins.filter((m) => m < 0).length;
    const thinCount = allMargins.filter((m) => m >= 0 && m < 40).length;
    const healthyCount = allMargins.filter((m) => m >= 40).length;
    const avgMargin = allMargins.length > 0 ? allMargins.reduce((s, m) => s + m, 0) / allMargins.length : null;
    return { total: allMargins.length, negativeCount, thinCount, healthyCount, avgMargin };
  }, [sorted]);

  // Variants without pricing (for the prompt)
  const unpricedCount = variants.length - pricedVariants.length;

  return (
    <div>
      <PageHeader title="Pricing & Margins" />

      <div className="px-4 space-y-6 pb-10">
        {/* Summary banner */}
        {summary.total > 0 && (
          <div className="rounded-sm border border-border bg-card p-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Avg. margin</p>
                <p className="text-lg font-semibold tabular-nums mt-0.5">
                  {summary.avgMargin !== null ? formatMarginPercent(summary.avgMargin) : "—"}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Healthy</p>
                <p className="text-lg font-semibold text-emerald-700 tabular-nums mt-0.5">{summary.healthyCount}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Thin</p>
                <p className="text-lg font-semibold text-status-warn tabular-nums mt-0.5">{summary.thinCount}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Negative</p>
                <p className="text-lg font-semibold text-status-alert tabular-nums mt-0.5">{summary.negativeCount}</p>
              </div>
            </div>
          </div>
        )}

        {/* No data state */}
        {sorted.length === 0 && (
          <div className="text-center py-12 space-y-2">
            <p className="text-sm text-muted-foreground">No variants with box pricing yet.</p>
            <p className="text-xs text-muted-foreground">
              Open a variant and add a box configuration with a sell price to see margins here.
            </p>
          </div>
        )}

        {/* Variant cards */}
        <div className="space-y-4">
          {sorted.map((item) => {
            const cId = item.variant.id ?? "";
            return (
              <div key={cId} className="rounded-sm border border-border bg-card overflow-hidden">
                {/* Variant header */}
                <div className="px-4 pt-3.5 pb-2 flex items-start justify-between">
                  <div className="min-w-0">
                    <Link
                      href={`/variants/${encodeURIComponent(cId)}?from=pricing`}
                      className="text-sm font-semibold hover:underline block truncate"
                    >
                      {item.variant.name}
                    </Link>
                    {item.variant.description && (
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">{item.variant.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    {item.avgProductCost !== null && (
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        avg. {formatPrice(item.avgProductCost, sym)}/pc
                      </span>
                    )}
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_CLASS[item.status]}`}>
                      {STATUS_LABEL[item.status]}
                    </span>
                  </div>
                </div>

                {/* Products count */}
                <div className="px-4 pb-2">
                  <p className="text-[11px] text-muted-foreground">
                    {item.productCount} products{item.costDataCount < item.productCount && (
                      <span className="text-status-warn"> ({item.productCount - item.costDataCount} without cost data)</span>
                    )}
                  </p>
                </div>

                {/* Box pricing rows */}
                {item.boxes.length > 0 ? (
                  <div className="border-t border-border/50">
                    {item.boxes.map((box, i) => {
                      const colors = MARGIN_COLORS[box.health];
                      const barWidth = Math.min(Math.max(box.pricing.marginPercent, 0), 100);
                      return (
                        <div
                          key={i}
                          className={`px-4 py-2.5 flex items-center gap-3 ${
                            i > 0 ? "border-t border-border/30" : ""
                          }`}
                        >
                          {/* Box name + capacity */}
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium truncate">{box.packaging.name}</p>
                            <p className="text-[10px] text-muted-foreground">{box.packaging.capacity} pcs</p>
                          </div>

                          {/* Cost → Price */}
                          <div className="text-right shrink-0">
                            <p className="text-xs tabular-nums">
                              <span className="text-muted-foreground">{formatPrice(box.pricing.totalCost, sym)}</span>
                              <span className="text-muted-foreground/50 mx-1">&rarr;</span>
                              <span className="font-medium">{formatPrice(box.pricing.sellPrice, sym)}</span>
                            </p>
                          </div>

                          {/* Margin indicator */}
                          <div className="w-24 shrink-0">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className={`text-[11px] font-bold tabular-nums ${colors.text}`}>
                                {formatMarginPercent(box.pricing.marginPercent)}
                              </span>
                            </div>
                            <div className="h-1 rounded-full bg-black/5 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${colors.bar}`}
                                style={{ width: `${barWidth}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="px-4 py-3 border-t border-border/50">
                    <p className="text-xs text-muted-foreground">No cost data for products yet.</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Unpriced variants hint */}
        {unpricedCount > 0 && sorted.length > 0 && (
          <p className="text-xs text-muted-foreground text-center pt-2">
            {unpricedCount} variant(s) not shown &mdash; add box pricing on their detail page to include them.
          </p>
        )}
      </div>
    </div>
  );
}
