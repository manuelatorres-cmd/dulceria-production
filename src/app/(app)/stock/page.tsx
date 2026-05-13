"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  useAllPlanProducts, useProductionPlans, useProductsList, useMouldsList,
  setPlanProductStockStatus, useFillingStockItems, useFillings, adjustFillingStock, discardFillingStock, saveFillingStock,
  updateProductStockCount,
  freezePlanProduct, defrostPlanProduct,
  freezeFillingStock, defrostFillingStock,
  useProductLocationTotals,
  useAllStockLocations,
  transferBatchStock,
  useOrders,
  useStockLocationMinimums,
  DEFAULT_LOCATION_MINIMUM,
  moveProductStockFifo,
  intakeBatchStock,
  useStockMovements,
  useVariants,
  useAllVariantPackagings,
  useVariantStockLocations,
  usePackagingList,
} from "@/lib/hooks";
import { STOCK_LOCATION_SHORT_LABELS, STOCK_LOCATIONS, type StockLocation } from "@/types";
import { TransferModal } from "@/components/transfer-modal";
import { IconArrowsMove as Move } from "@tabler/icons-react";
import { PageHeader } from "@/components/dulceria";
import { IconSearch as Search, IconAdjustmentsHorizontal as SlidersHorizontal, IconX as X, IconPlus as Plus, IconClipboardList as ClipboardList, IconSnowflake as Snowflake, IconChevronDown as ChevronDown, IconChevronRight as ChevronRight } from "@tabler/icons-react";
import type { PlanProduct, ProductionPlan, Product, Mould, FillingStock, StockMovement } from "@/types";
import { reconcileStockCount } from "@/lib/stockCount";
import { remainingShelfLifeDays, defrostedSellBy, WEEK_MS } from "@/lib/freezer";
import { FreezeModal, DefrostConfirmModal } from "@/components/freeze-modal";

function sellBeforeDate(completedAt: Date | undefined, shelfLifeWeeks: string | undefined): Date | null {
  if (!completedAt || !shelfLifeWeeks) return null;
  const weeks = parseFloat(shelfLifeWeeks);
  if (isNaN(weeks) || weeks <= 0) return null;
  const d = new Date(completedAt);
  d.setDate(d.getDate() + Math.round((weeks - 1) * 7));
  return d;
}

/** Batch sell-by — falls through to the defrosted sell-by if the batch has been
 *  thawed (uses `defrostedAt` + `preservedShelfLifeDays`). */
function batchSellBy(
  pb: PlanProduct,
  completedAt: Date | undefined,
  shelfLifeWeeks: string | undefined,
): Date | null {
  if (pb.defrostedAt && pb.preservedShelfLifeDays != null) {
    return defrostedSellBy(pb.defrostedAt, pb.preservedShelfLifeDays);
  }
  return sellBeforeDate(completedAt, shelfLifeWeeks);
}

function sellByInfo(sellBefore: Date | null): { text: string; cls: string } {
  if (!sellBefore) return { text: "No shelf life set", cls: "text-muted-foreground" };
  const diff = sellBefore.getTime() - Date.now();
  const fmt = sellBefore.toLocaleDateString("de-AT", { day: "numeric", month: "short" });
  if (diff < 0) return { text: `Sell by ${fmt} — expired`, cls: "text-status-alert" };
  if (diff < 7 * 24 * 60 * 60 * 1000) return { text: `Sell by ${fmt} — soon`, cls: "text-status-warn" };
  return { text: `Sell by ${fmt}`, cls: "text-muted-foreground" };
}

type BatchRow = {
  pb: PlanProduct;
  plan: ProductionPlan;
  product: Product | undefined;
  mould: Mould | undefined;
  sellBefore: Date | null;
  /** Available (non-frozen) piece count. */
  productCount: number | null;
  /** Frozen piece count for this batch. */
  frozenCount: number;
  originalCount: number | null;
};

type Group = {
  productId: string;
  product: Product | undefined;
  batches: BatchRow[];
  /** Sum of available (non-frozen) pieces across in-stock batches. */
  totalProducts: number;
  /** Sum of frozen pieces across batches (informational). */
  frozenProducts: number;
  earliestSellBefore: Date | null;
  isLow: boolean; // totalProducts < sum of stockLocationMinimums for this product
};

/** Format a last-counted timestamp in the user's local timezone.
 *  Today → "Today 14:32", yesterday → "Yesterday 14:32", older → "4 Apr 14:32". */
function formatCountedAt(ts: number | undefined): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(new Date()) - startOfDay(d)) / (24 * 60 * 60 * 1000));

  if (dayDiff === 0) return `Today ${time}`;
  if (dayDiff === 1) return `Yesterday ${time}`;
  const currentYear = new Date().getFullYear();
  const datePart = d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() !== currentYear ? { year: "numeric" } : {}),
  });
  return `${datePart} ${time}`;
}

export default function StockPage() {
  const [activeTab, setActiveTab] = useState<"products" | "boxes" | "fillings" | "movements">("products");

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader title="Stock" meta="Track what's still in stock" />

      {/* Tab strip + adjust link */}
      <div className="px-4 pb-3 flex items-center gap-2">
        <div className="flex gap-1">
          {(["products", "boxes", "fillings", "movements"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "bg-accent text-accent-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "products" ? "Products" : tab === "boxes" ? "Boxes" : tab === "fillings" ? "Fillings" : "Movements"}
            </button>
          ))}
        </div>
        <Link
          href="/stock/adjust"
          className="ml-auto inline-flex items-center gap-1 rounded-sm border border-border bg-card px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary"
          title="Opening balance, recounts, breakage"
        >
          Adjust stock →
        </Link>
      </div>

      {activeTab === "products" ? (
        <ProductStockTab />
      ) : activeTab === "boxes" ? (
        <BoxStockTab />
      ) : activeTab === "fillings" ? (
        <FillingStockTab />
      ) : (
        <MovementsTab />
      )}
    </div>
  );
}

// ─── Box Stock Tab ─────────────────────────────────────────────────────────
//
// Boxes (variantPackagings) live in the `variantStockLocations` table —
// /picking creates rows there as the operator boxes pieces up. The other
// tabs key on planProductId, so this tab is its own panel keyed on
// variantPackagingId. Allocated rows show their orderId so the operator
// can see which buyer the box is reserved for.

function BoxStockTab() {
  const rows = useVariantStockLocations();
  const variants = useVariants();
  const vps = useAllVariantPackagings();
  const orders = useOrders();
  const packagings = usePackagingList();

  const variantById = useMemo(() => new Map(variants.map((v) => [v.id!, v])), [variants]);
  const vpById = useMemo(() => new Map(vps.map((v) => [v.id!, v])), [vps]);
  const orderById = useMemo(() => new Map(orders.map((o) => [o.id!, o])), [orders]);
  const packagingById = useMemo(() => new Map(packagings.map((p) => [p.id!, p])), [packagings]);

  type GroupRow = {
    key: string;
    variantName: string;
    sizeLabel: string;
    location: StockLocation;
    quantity: number;
    orderRef?: string;
  };
  const grouped = useMemo<GroupRow[]>(() => {
    const out: GroupRow[] = [];
    for (const r of rows) {
      if ((r.quantity ?? 0) <= 0) continue;
      const vp = vpById.get(r.variantPackagingId);
      if (!vp) continue;
      const variant = variantById.get(vp.variantId);
      if (!variant) continue;
      const sizeLabel = vp.packagingId
        ? packagingById.get(vp.packagingId)?.name ?? `vp ${vp.id?.slice(0, 4)}`
        : "loose";
      let orderRef: string | undefined;
      if (r.location === "allocated" && r.orderId) {
        const o = orderById.get(r.orderId);
        if (o) orderRef = o.sourceRef ?? o.customerName ?? o.eventName ?? r.orderId.slice(0, 6);
      }
      out.push({
        key: `${r.id}`,
        variantName: variant.name,
        sizeLabel,
        location: r.location as StockLocation,
        quantity: r.quantity,
        orderRef,
      });
    }
    out.sort((a, b) => {
      const cmp = a.variantName.localeCompare(b.variantName);
      if (cmp !== 0) return cmp;
      if (a.location !== b.location) return a.location.localeCompare(b.location);
      return (a.orderRef ?? "").localeCompare(b.orderRef ?? "");
    });
    return out;
  }, [rows, vpById, variantById, orderById, packagingById]);

  const totalBoxes = grouped.reduce((s, r) => s + r.quantity, 0);
  const sellable = grouped
    .filter((r) => r.location !== "allocated")
    .reduce((s, r) => s + r.quantity, 0);
  const allocated = grouped
    .filter((r) => r.location === "allocated")
    .reduce((s, r) => s + r.quantity, 0);

  if (grouped.length === 0) {
    return (
      <div className="px-4">
        <p className="text-sm text-muted-foreground py-6 text-center">
          No boxes on hand. Build some via /picking.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-border bg-card px-2.5 py-1">
          Total · <span className="tabular-nums font-medium">{totalBoxes}</span>
        </span>
        <span className="rounded-full border border-status-ok-edge bg-status-ok-bg/30 px-2.5 py-1 text-status-ok">
          Sellable · <span className="tabular-nums font-medium">{sellable}</span>
        </span>
        <span className="rounded-full border border-status-warn-edge bg-status-warn-bg/30 px-2.5 py-1 text-status-warn">
          Allocated · <span className="tabular-nums font-medium">{allocated}</span>
        </span>
      </div>
      <ul className="rounded-sm border border-border bg-card divide-y divide-border">
        {grouped.map((r) => (
          <li key={r.key} className="px-3 py-2 flex items-center gap-2 text-sm">
            <span className="font-medium truncate flex-1">{r.variantName}</span>
            <span className="text-xs text-muted-foreground">{r.sizeLabel}</span>
            <span className={`text-[10.5px] rounded-full border px-1.5 py-[1px] capitalize ${
              r.location === "allocated"
                ? "border-status-warn-edge bg-status-warn-bg/30 text-status-warn"
                : "border-border bg-card/70 text-muted-foreground"
            }`}>
              {r.location}
            </span>
            {r.orderRef && (
              <span className="text-[10.5px] text-muted-foreground">→ {r.orderRef}</span>
            )}
            <span className="tabular-nums font-medium w-8 text-right">{r.quantity}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Product Stock Tab ─────────────────────────────────────────────────────

function ProductStockTab() {
  const allPlanProducts = useAllPlanProducts();
  const allPlans = useProductionPlans();
  const products = useProductsList();
  const moulds = useMouldsList(true);
  const locationTotals = useProductLocationTotals();
  const allStockLocations = useAllStockLocations();
  const locationMinimums = useStockLocationMinimums();
  const allOrders = useOrders();
  const openOrders = useMemo(
    () => allOrders.filter((o) => o.status === "pending" || o.status === "in_production"),
    [allOrders],
  );
  const [transferPbId, setTransferPbId] = useState<string | null>(null);
  const [countingProductLocation, setCountingProductLocation] = useState<{ productId: string; location: StockLocation } | null>(null);
  const [locationCountInput, setLocationCountInput] = useState("");

  const minimumFor = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of locationMinimums) {
      map.set(`${m.productId}:${m.location}`, m.minimumUnits);
    }
    return (productId: string, location: StockLocation): number =>
      map.get(`${productId}:${location}`) ?? DEFAULT_LOCATION_MINIMUM;
  }, [locationMinimums]);

  /** Sum of all `minimumUnits` for a product across configured locations.
   *  Replaces the old `product.lowStockThreshold` for the page-wide
   *  "low stock" indicator. Zero / no rows → no minimum configured. */
  const minimumSumByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of locationMinimums) {
      m.set(row.productId, (m.get(row.productId) ?? 0) + row.minimumUnits);
    }
    return m;
  }, [locationMinimums]);

  const distributionByBatch = useMemo(() => {
    const map = new Map<string, Record<StockLocation, number>>();
    for (const row of allStockLocations) {
      const existing =
        map.get(row.planProductId) ??
        ({ store: 0, production: 0, freezer: 0, allocated: 0 } as Record<StockLocation, number>);
      existing[row.location] += row.quantity;
      map.set(row.planProductId, existing);
    }
    return map;
  }, [allStockLocations]);
  const [search, setSearch] = useState("");
  const [confirmGone, setConfirmGone] = useState<string | null>(null);
  // Per-product expand state — starts collapsed so the page reads as
  // a compact overview (one row per product with aggregated location
  // pills). Clicking the chevron reveals the per-batch breakdown.
  const [expandedProductIds, setExpandedProductIds] = useState<Set<string>>(new Set());
  const toggleProductExpanded = (productId: string) => {
    setExpandedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };
  const [countingProductId, setCountingProductId] = useState<string | null>(null);
  const [countInput, setCountInput] = useState("");
  const [pendingCountConfirm, setPendingCountConfirm] = useState<{
    productId: string;
    newTotal: number;
    goneBatchLabels: string[];
  } | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filterLowOnly, setFilterLowOnly] = useState(false);
  const [filterSellBy, setFilterSellBy] = useState("");
  const [filterHasNotes, setFilterHasNotes] = useState(false);
  const [filterFreezer, setFilterFreezer] = useState<"all" | "available" | "frozen">("all");
  const [freezingPbId, setFreezingPbId] = useState<string | null>(null);
  const [defrostingPbId, setDefrostingPbId] = useState<string | null>(null);
  const activeFilterCount = (filterLowOnly ? 1 : 0) + (filterSellBy ? 1 : 0) + (filterHasNotes ? 1 : 0) + (filterFreezer !== "all" ? 1 : 0);

  const planMap = useMemo(() => new Map(allPlans.map((p) => [p.id!, p])), [allPlans]);
  const productMap = useMemo(() => new Map(products.map((r) => [r.id!, r])), [products]);
  const mouldMap = useMemo(() => new Map(moulds.map((m) => [m.id!, m])), [moulds]);

  const inStockRows: BatchRow[] = useMemo(() => {
    return allPlanProducts
      .filter((pb) => {
        if (planMap.get(pb.planId)?.status !== "done") return false;
        if (pb.stockStatus === "gone") return false;
        // Show the batch while it has either available OR frozen pieces.
        const available = pb.currentStock ?? pb.actualYield ?? (mouldMap.get(pb.mouldId) ? mouldMap.get(pb.mouldId)!.numberOfCavities * pb.quantity : 0);
        const frozen = pb.frozenQty ?? 0;
        return available > 0 || frozen > 0;
      })
      .map((pb) => {
        const plan = planMap.get(pb.planId)!;
        const product = productMap.get(pb.productId);
        const mould = mouldMap.get(pb.mouldId);
        const completedAt = plan.completedAt ? new Date(plan.completedAt) : undefined;
        const sellBefore = batchSellBy(pb, completedAt, product?.shelfLifeWeeks);
        const planned = mould ? mould.numberOfCavities * pb.quantity : null;
        const productCount = pb.currentStock ?? pb.actualYield ?? planned;
        const frozenCount = pb.frozenQty ?? 0;
        // Original = what came out of production (or the planned yield if actualYield was
        // never set). Shown alongside the current count so users see how much has been
        // sold/consumed since the batch was made.
        const originalCount = pb.actualYield ?? planned;
        return { pb, plan, product, mould, sellBefore, productCount, frozenCount, originalCount };
      });
  }, [allPlanProducts, planMap, productMap, mouldMap]);

  const groups: Group[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    const filtered = inStockRows.filter(({ product, plan, pb, sellBefore, productCount, frozenCount }) => {
      if (q) {
        const productMatch = product?.name.toLowerCase().includes(q);
        const batchMatch = plan.batchNumber?.toLowerCase().includes(q) ||
          plan.name.toLowerCase().includes(q) ||
          (plan.completedAt
            ? new Date(plan.completedAt).toLocaleDateString("de-AT", { day: "numeric", month: "short", year: "numeric" }).toLowerCase().includes(q)
            : false);
        if (!productMatch && !batchMatch) return false;
      }
      if (filterHasNotes && !plan.notes && !pb.notes) return false;
      if (filterSellBy) {
        if (!sellBefore) return false;
        const diff = sellBefore.getTime() - now;
        if (filterSellBy === "expired" && diff >= 0) return false;
        if (filterSellBy === "7d" && diff >= 7 * DAY) return false;
        if (filterSellBy === "30d" && diff >= 30 * DAY) return false;
      }
      if (filterFreezer === "frozen" && frozenCount <= 0) return false;
      if (filterFreezer === "available" && (productCount ?? 0) <= 0) return false;
      return true;
    });

    const map = new Map<string, Group>();
    for (const row of filtered) {
      const key = row.pb.productId;
      if (!map.has(key)) {
        map.set(key, { productId: key, product: row.product, batches: [], totalProducts: 0, frozenProducts: 0, earliestSellBefore: null, isLow: false });
      }
      const g = map.get(key)!;
      g.batches.push(row);
      if (row.productCount) g.totalProducts += row.productCount;
      g.frozenProducts += row.frozenCount;
      if (row.sellBefore && (!g.earliestSellBefore || row.sellBefore < g.earliestSellBefore)) {
        g.earliestSellBefore = row.sellBefore;
      }
    }

    for (const g of map.values()) {
      g.batches.sort((a, b) => {
        const aT = a.sellBefore?.getTime() ?? Infinity;
        const bT = b.sellBefore?.getTime() ?? Infinity;
        return aT - bT;
      });
      const t = minimumSumByProduct.get(g.productId);
      g.isLow = typeof t === "number" && t > 0 && g.totalProducts < t;
    }

    // Add "ghost" groups for non-archived products that have NO in-stock
    // batch yet — so the operator can see every product, even when stock
    // is zero. Skipped when sell-by/freezer/notes filters are active
    // (those filters only make sense against existing batch data) or
    // when a search is typed and the product name doesn't match.
    const ghostsAllowed =
      !filterSellBy && !filterHasNotes && filterFreezer === "all";
    if (ghostsAllowed) {
      for (const p of products) {
        if (!p.id || p.archived) continue;
        if (map.has(p.id)) continue;
        if (q && !p.name.toLowerCase().includes(q)) continue;
        const t = minimumSumByProduct.get(p.id);
        map.set(p.id, {
          productId: p.id,
          product: p,
          batches: [],
          totalProducts: 0,
          frozenProducts: 0,
          earliestSellBefore: null,
          // Out-of-stock product is always low when any minimum is set;
          // when no minimum is set, still flag as low so the user notices.
          isLow: typeof t === "number" ? t > 0 : true,
        });
      }
    }

    const groupsOut = Array.from(map.values());
    const filteredGroups = filterLowOnly ? groupsOut.filter((g) => g.isLow) : groupsOut;

    return filteredGroups.sort((a, b) => {
      // Out-of-stock groups (no batches) sink to the bottom so live stock
      // stays at the top.
      const aEmpty = a.batches.length === 0;
      const bEmpty = b.batches.length === 0;
      if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
      // Low-stock groups float to the top so users see what needs producing first
      if (a.isLow !== b.isLow) return a.isLow ? -1 : 1;
      const aT = a.earliestSellBefore?.getTime() ?? Infinity;
      const bT = b.earliestSellBefore?.getTime() ?? Infinity;
      if (aT !== bT) return aT - bT;
      return (a.product?.name ?? "").localeCompare(b.product?.name ?? "");
    });
  }, [inStockRows, search, filterLowOnly, filterSellBy, filterHasNotes, filterFreezer, products, minimumSumByProduct]);

  async function handleSetStatus(pbId: string, status: "low" | "gone" | undefined) {
    await setPlanProductStockStatus(pbId, status);
    setConfirmGone(null);
  }

  async function commitCount(productId: string, newTotal: number) {
    await updateProductStockCount(productId, newTotal);
    setCountingProductId(null);
    setCountInput("");
    setPendingCountConfirm(null);
  }

  async function handleSaveCount(productId: string) {
    const val = parseInt(countInput, 10);
    if (isNaN(val) || val < 0) return;
    const group = groups.find((g) => g.productId === productId);
    if (!group) return;

    // Dry-run the same reconciliation the hook will perform so we can warn the user
    // before any batch is silently marked gone.
    const inputs = group.batches.map(({ pb, productCount, sellBefore, plan }) => ({
      id: pb.id!,
      currentStock: productCount ?? 0,
      fifoOrder: sellBefore?.getTime() ?? (plan.completedAt ? new Date(plan.completedAt).getTime() : 0),
      batchNumber: plan.batchNumber ?? plan.name,
    }));
    const deltas = reconcileStockCount(inputs, val);
    const zeroedIds = new Set(deltas.filter((d) => d.nextStock <= 0).map((d) => d.id));
    const goneBatchLabels = inputs
      .filter((i) => zeroedIds.has(i.id))
      .map((i) => i.batchNumber);

    if (goneBatchLabels.length > 0) {
      setPendingCountConfirm({ productId, newTotal: val, goneBatchLabels });
      return;
    }
    await commitCount(productId, val);
  }

  const isEmpty = inStockRows.length === 0;

  return (
    <div className="px-4 pb-8 space-y-3">
      <div className="flex gap-2">
        <div className="flex-1 relative min-w-0">
          <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by product or batch…"
            aria-label="Search stock"
            className="input !pl-9"
          />
        </div>
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={`relative rounded-sm border p-2 transition-colors ${showFilters ? "bg-primary text-primary-foreground border-primary" : "border-border bg-background"}`}
          aria-label="Filters"
        >
          <SlidersHorizontal className="w-5 h-5" />
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-sm bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* Quick filters under search — baseline pattern. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground font-medium mr-1">Stock</span>
          <button
            onClick={() => setFilterLowOnly((v) => !v)}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
              filterLowOnly
                ? "bg-[var(--accent-butter-bg)] text-[var(--accent-butter-ink)]"
                : "bg-card text-muted-foreground border border-border hover:bg-muted"
            }`}
          >
            Low only
          </button>
          {(["all", "available", "frozen"] as const).map((opt) => {
            const active = filterFreezer === opt;
            const label = opt === "all" ? "All" : opt === "available" ? "Available" : "Frozen";
            return (
              <button
                key={opt}
                onClick={() => setFilterFreezer(opt)}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-accent text-accent-foreground"
                    : "bg-card text-muted-foreground border border-border hover:bg-muted"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground font-medium mr-1">Sell-by</span>
          {(["expired", "7d", "30d"] as const).map((opt) => {
            const label = opt === "expired" ? "Expired" : opt === "7d" ? "≤ 7 days" : "≤ 30 days";
            const active = filterSellBy === opt;
            return (
              <button
                key={opt}
                onClick={() => setFilterSellBy(active ? "" : opt)}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-[var(--accent-blush-bg)] text-[var(--accent-blush-ink)]"
                    : "bg-card text-muted-foreground border border-border hover:bg-muted"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {showFilters && (
        <div className="rounded-sm border border-border bg-card p-3 space-y-3">
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Stock level</p>
            <button
              onClick={() => setFilterLowOnly((v) => !v)}
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${filterLowOnly ? "bg-status-warn-bg text-status-warn" : "border border-border text-muted-foreground"}`}
            >
              Low stock only
            </button>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Sell-by date</p>
            <div className="flex flex-wrap gap-1">
              {(["expired", "7d", "30d"] as const).map((opt) => {
                const label = opt === "expired" ? "Expired" : opt === "7d" ? "Within 7 days" : "Within 30 days";
                return (
                  <button
                    key={opt}
                    onClick={() => setFilterSellBy(filterSellBy === opt ? "" : opt)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${filterSellBy === opt ? "bg-accent text-accent-foreground" : "border border-border text-muted-foreground"}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Freezer</p>
            <div className="flex flex-wrap gap-1">
              {(["all", "available", "frozen"] as const).map((opt) => {
                const label = opt === "all" ? "All" : opt === "available" ? "Available" : "Frozen only";
                const isFrozenOpt = opt === "frozen";
                return (
                  <button
                    key={opt}
                    onClick={() => setFilterFreezer(opt)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors inline-flex items-center gap-1 ${
                      filterFreezer === opt
                        ? isFrozenOpt ? "bg-sky-600 text-white" : "bg-accent text-accent-foreground"
                        : "border border-border text-muted-foreground"
                    }`}
                  >
                    {isFrozenOpt && <Snowflake className="w-3 h-3" />}
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Notes</p>
            <button
              onClick={() => setFilterHasNotes((v) => !v)}
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${filterHasNotes ? "bg-accent text-accent-foreground" : "border border-border text-muted-foreground"}`}
            >
              Has notes
            </button>
          </div>
          {activeFilterCount > 0 && (
            <button
              onClick={() => { setFilterLowOnly(false); setFilterSellBy(""); setFilterHasNotes(false); setFilterFreezer("all"); }}
              className="text-xs text-muted-foreground flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Clear filters
            </button>
          )}
        </div>
      )}

      {isEmpty ? (
        <p className="text-sm text-muted-foreground py-10 text-center">
          No batches in stock. Completed production batches will appear here.
        </p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No results match your search.</p>
      ) : (
        groups.map((group) => (
          <div
            key={group.productId}
            className={`rounded-sm border bg-card overflow-hidden ${
              group.isLow ? "border-status-warn-edge border-l-4" : "border-border"
            }`}
          >
            <div className={`px-3 py-2 border-b border-border ${group.isLow ? "bg-status-warn-bg" : "bg-muted/30"}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate flex items-center gap-1.5 flex-wrap">
                    <button
                      onClick={() => toggleProductExpanded(group.productId)}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                      aria-label={expandedProductIds.has(group.productId) ? "Collapse batches" : "Expand batches"}
                      title={expandedProductIds.has(group.productId) ? "Hide batch detail" : "Show batch detail"}
                    >
                      {expandedProductIds.has(group.productId)
                        ? <ChevronDown className="w-4 h-4" />
                        : <ChevronRight className="w-4 h-4" />}
                    </button>
                    {group.product?.name ?? "Unknown product"}
                    {(() => {
                      const minSum = minimumSumByProduct.get(group.productId);
                      const belowThreshold = typeof minSum === "number" && minSum > 0 && group.totalProducts < minSum;
                      const pillCls = belowThreshold
                        ? "border-status-warn-edge bg-status-warn-bg text-status-warn"
                        : "border-border bg-background text-foreground";
                      return (
                        <span className={`shrink-0 rounded-sm border ${pillCls} px-1.5 py-0 text-[10px] font-semibold tabular-nums inline-flex items-center gap-0.5`}>
                          {group.totalProducts} pcs
                        </span>
                      );
                    })()}
                    {group.isLow && (
                      <span className="shrink-0 rounded-sm border border-status-warn-edge bg-status-warn-bg text-status-warn px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide">
                        Low
                      </span>
                    )}
                    {group.frozenProducts > 0 && (
                      <span className="shrink-0 rounded-sm border border-sky-200 bg-sky-50 text-sky-700 px-1.5 py-0 text-[10px] font-semibold inline-flex items-center gap-0.5">
                        <Snowflake className="w-2.5 h-2.5" />
                        {group.frozenProducts}
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap mt-0.5">
                    {(() => {
                      const minSum = minimumSumByProduct.get(group.productId);
                      if (typeof minSum !== "number" || minSum <= 0) return null;
                      return (
                        <span className={`text-[11px] tabular-nums ${group.totalProducts < minSum ? "text-status-warn" : "text-muted-foreground"}`}>
                          min {minSum}
                        </span>
                      );
                    })()}
                    {group.product?.stockCountedAt && (
                      <span className="text-[11px] text-muted-foreground">
                        {minimumSumByProduct.get(group.productId) ? "· " : ""}Last count {formatCountedAt(group.product.stockCountedAt)}
                      </span>
                    )}
                  </div>
                  {(() => {
                    const totals = locationTotals.get(group.productId);
                    return (
                      <div className="flex items-center gap-1 flex-wrap mt-1">
                        {STOCK_LOCATIONS.map((loc) => {
                          const qty = totals?.[loc] ?? 0;
                          const minimum = minimumFor(group.productId, loc);
                          const below = loc === "store" || loc === "production"
                            ? qty < minimum
                            : false;
                          const empty = qty === 0;
                          const editing = countingProductLocation?.productId === group.productId
                            && countingProductLocation?.location === loc;
                          let cls = "border-border bg-background text-foreground";
                          if (editing) cls = "border-primary bg-primary/5 text-primary";
                          else if (below) cls = "border-status-warn-edge bg-status-warn-bg text-status-warn";
                          else if (empty) cls = "border-border/50 bg-muted/30 text-muted-foreground";
                          if (editing) {
                            return (
                              <span key={loc} className={`rounded-sm border px-1.5 py-0 text-[10px] font-medium inline-flex items-center gap-1 ${cls}`}>
                                {STOCK_LOCATION_SHORT_LABELS[loc]}
                                <input
                                  autoFocus
                                  type="number"
                                  min={0}
                                  value={locationCountInput}
                                  onChange={(e) => setLocationCountInput(e.target.value)}
                                  onKeyDown={async (e) => {
                                    if (e.key === "Escape") {
                                      setCountingProductLocation(null);
                                      setLocationCountInput("");
                                      return;
                                    }
                                    if (e.key !== "Enter") return;
                                    const val = parseInt(locationCountInput, 10);
                                    if (!Number.isFinite(val) || val < 0) return;
                                    const delta = val - qty;
                                    if (delta === 0) {
                                      setCountingProductLocation(null);
                                      setLocationCountInput("");
                                      return;
                                    }
                                    // Shortfall: outake waste from FIFO oldest batch in this location.
                                    // Excess: log an intake on the oldest batch for this product.
                                    if (delta < 0) {
                                      await moveProductStockFifo({
                                        productId: group.productId,
                                        fromLocation: loc,
                                        toLocation: null,
                                        quantity: Math.abs(delta),
                                        reason: "recount",
                                      });
                                    } else {
                                      const anyBatch = group.batches[0]?.pb;
                                      if (anyBatch) {
                                        await intakeBatchStock({
                                          planProductId: anyBatch.id!,
                                          productId: group.productId,
                                          toLocation: loc,
                                          quantity: delta,
                                          reason: "recount",
                                        });
                                      }
                                    }
                                    setCountingProductLocation(null);
                                    setLocationCountInput("");
                                  }}
                                  onBlur={() => { setCountingProductLocation(null); setLocationCountInput(""); }}
                                  className="w-12 bg-transparent text-[10px] text-center tabular-nums focus:outline-none"
                                />
                              </span>
                            );
                          }
                          return (
                            <button
                              key={loc}
                              onClick={() => {
                                setCountingProductLocation({ productId: group.productId, location: loc });
                                setLocationCountInput(String(qty));
                              }}
                              className={`rounded-sm border px-1.5 py-0 text-[10px] font-medium tabular-nums inline-flex items-center gap-0.5 hover:border-primary transition-colors ${cls}`}
                              title={`${STOCK_LOCATION_SHORT_LABELS[loc]}: ${qty} pcs${below ? ` (below minimum ${minimum})` : ""}. Click to recount.`}
                            >
                              {STOCK_LOCATION_SHORT_LABELS[loc]} {qty}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
                {countingProductId !== group.productId && (
                  <button
                    onClick={() => { setCountingProductId(group.productId); setCountInput(String(group.totalProducts)); }}
                    className="shrink-0 inline-flex items-center gap-1 rounded-sm border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                    title="Record the latest stock count for this product"
                  >
                    <ClipboardList className="w-3 h-3" /> Latest stock count
                  </button>
                )}
              </div>
              {countingProductId === group.productId && pendingCountConfirm?.productId !== group.productId && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={countInput}
                    onChange={(e) => setCountInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSaveCount(group.productId); if (e.key === "Escape") { setCountingProductId(null); setCountInput(""); } }}
                    autoFocus
                    aria-label="New stock count"
                    className="input text-sm h-8 w-24"
                  />
                  <span className="text-xs text-muted-foreground">pcs</span>
                  <button onClick={() => handleSaveCount(group.productId)} className="text-xs font-medium text-primary">Save</button>
                  <button onClick={() => { setCountingProductId(null); setCountInput(""); }} className="text-xs text-muted-foreground">Cancel</button>
                </div>
              )}
              {pendingCountConfirm?.productId === group.productId && (
                <div className="mt-2 rounded-md bg-status-warn-bg border border-status-warn-edge px-2.5 py-2 text-xs">
                  <p className="text-foreground">
                    Saving <span className="font-semibold">{pendingCountConfirm.newTotal} pcs</span> will
                    mark {pendingCountConfirm.goneBatchLabels.length === 1 ? "1 batch" : `${pendingCountConfirm.goneBatchLabels.length} batches`} as gone:{" "}
                    <span className="font-mono">{pendingCountConfirm.goneBatchLabels.join(", ")}</span>.
                  </p>
                  <div className="mt-1.5 flex items-center gap-3">
                    <button
                      onClick={() => commitCount(pendingCountConfirm.productId, pendingCountConfirm.newTotal)}
                      className="text-xs font-medium text-status-warn"
                    >
                      Yes, save
                    </button>
                    <button
                      onClick={() => setPendingCountConfirm(null)}
                      className="text-xs text-muted-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {expandedProductIds.has(group.productId) && group.batches.map(({ pb, plan, productCount, frozenCount, originalCount, sellBefore }, i) => {
              const { text: sellByText, cls: sellByCls } = sellByInfo(sellBefore);
              const completedDate = plan.completedAt
                ? new Date(plan.completedAt).toLocaleDateString("de-AT", { day: "numeric", month: "short", year: "numeric" })
                : null;
              const isLast = i === group.batches.length - 1;
              const availableCount = productCount ?? 0;

              if (confirmGone === pb.id) {
                return (
                  <div key={pb.id} className={`px-3 py-2 bg-muted/40 flex items-center gap-3 ${!isLast ? "border-b border-border" : ""}`}>
                    <p className="text-xs text-muted-foreground flex-1">Mark as gone?</p>
                    <button onClick={() => handleSetStatus(pb.id!, "gone")} className="text-xs font-medium text-foreground">Yes</button>
                    <button onClick={() => setConfirmGone(null)} className="text-xs text-muted-foreground">Cancel</button>
                  </div>
                );
              }

              return (
                <div key={pb.id} className={!isLast ? "border-b border-border" : ""}>
                  {/* Available row — hidden when all pieces are in the freezer */}
                  {availableCount > 0 && (
                    <div className="px-3 py-2.5 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {plan.batchNumber && <span className="font-mono text-[10px] text-muted-foreground">{plan.batchNumber}</span>}
                          {completedDate && <span className="text-[10px] text-muted-foreground">· Made {completedDate}</span>}
                          <span className="text-[10px] text-muted-foreground">
                            · {availableCount} pcs
                            {originalCount != null && originalCount !== availableCount && (
                              <span className="text-muted-foreground/70"> of {originalCount} made</span>
                            )}
                          </span>
                          {pb.defrostedAt && (
                            <span className="text-[10px] text-sky-700" title="Sell-by shifted from defrost date">
                              · defrosted
                            </span>
                          )}
                        </div>
                        <p className={`text-xs mt-0.5 ${sellByCls}`}>{sellByText}</p>
                        {plan.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">Batch: {plan.notes}</p>}
                        {pb.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">Note: {pb.notes}</p>}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                        <button
                          onClick={() => setTransferPbId(pb.id!)}
                          className="rounded-sm border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:border-foreground hover:text-foreground transition-colors inline-flex items-center gap-0.5"
                          title="Move pieces between Store / Production / Freezer / Allocated"
                        >
                          <Move className="w-3 h-3" /> Move
                        </button>
                        <button
                          onClick={() => setFreezingPbId(pb.id!)}
                          className="rounded-sm border border-border px-2 py-0.5 text-[10px] font-medium text-sky-700 hover:border-sky-500 hover:bg-sky-50 transition-colors inline-flex items-center gap-0.5"
                          title="Move pieces to the freezer"
                        >
                          <Snowflake className="w-3 h-3" /> Freeze
                        </button>
                        <button
                          onClick={() => setConfirmGone(pb.id!)}
                          className="rounded-sm border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
                        >
                          Gone
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Freezer sub-row */}
                  {frozenCount > 0 && (
                    <div className={`px-3 py-2.5 flex items-start justify-between gap-2 bg-sky-50/40 ${availableCount > 0 ? "border-t border-border/60" : ""}`}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Snowflake className="w-3 h-3 text-sky-600" />
                          <span className="text-[10px] font-semibold text-sky-700 uppercase tracking-wide">
                            In freezer
                          </span>
                          <span className="text-[10px] text-muted-foreground">· {frozenCount} pcs</span>
                          {plan.batchNumber && <span className="font-mono text-[10px] text-muted-foreground">· {plan.batchNumber}</span>}
                          {completedDate && (
                            <span className="text-[10px] text-muted-foreground">· Made {completedDate}</span>
                          )}
                          {pb.frozenAt && (
                            <span className="text-[10px] text-muted-foreground">
                              · frozen since {new Date(pb.frozenAt).toLocaleDateString("de-AT", { day: "numeric", month: "short" })}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Not for sale · {pb.preservedShelfLifeDays ?? 0} days shelf life on defrost
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                        <button
                          onClick={() => setDefrostingPbId(pb.id!)}
                          className="rounded-sm border border-sky-200 bg-white px-2 py-0.5 text-[10px] font-medium text-sky-700 hover:bg-sky-100 transition-colors"
                        >
                          Defrost
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))
      )}

      {/* Freeze modal */}
      {freezingPbId && (() => {
        const row = inStockRows.find((r) => r.pb.id === freezingPbId);
        if (!row) return null;
        const { pb, plan, product, productCount } = row;
        const available = productCount ?? 0;
        const madeAtMs = plan.completedAt ? new Date(plan.completedAt).getTime() : undefined;
        const remaining = remainingShelfLifeDays(madeAtMs, product?.shelfLifeWeeks);
        return (
          <FreezeModal
            title="Freeze pieces"
            itemName={product?.name ?? "Product"}
            itemSubtitle={plan.batchNumber}
            unit="pcs"
            availableQty={available}
            defaultQty={available}
            defaultShelfLifeDays={remaining}
            onConfirm={async (qty, days) => {
              await freezePlanProduct(pb.id!, qty, days);
              setFreezingPbId(null);
            }}
            onCancel={() => setFreezingPbId(null)}
          />
        );
      })()}

      {/* Defrost modal */}
      {defrostingPbId && (() => {
        const row = inStockRows.find((r) => r.pb.id === defrostingPbId);
        if (!row) return null;
        const { pb, product } = row;
        return (
          <DefrostConfirmModal
            itemName={product?.name ?? "product"}
            qty={pb.frozenQty ?? 0}
            unit="pcs"
            preservedShelfLifeDays={pb.preservedShelfLifeDays}
            onConfirm={async () => {
              await defrostPlanProduct(pb.id!);
              setDefrostingPbId(null);
            }}
            onCancel={() => setDefrostingPbId(null)}
          />
        );
      })()}

      {/* Transfer modal */}
      {transferPbId && (() => {
        const row = inStockRows.find((r) => r.pb.id === transferPbId);
        if (!row) return null;
        const { pb, plan, product } = row;
        const distribution = distributionByBatch.get(pb.id!) ??
          ({ store: 0, production: 0, freezer: 0, allocated: 0 } as Record<StockLocation, number>);
        // If the batch has no stockLocations rows yet (e.g. migration hasn't
        // run, or this batch pre-dates it), fall back to its legacy counters.
        const hasAny = STOCK_LOCATIONS.some((l) => distribution[l] > 0);
        const effective = hasAny
          ? distribution
          : ({
              store: 0,
              production: pb.currentStock ?? pb.actualYield ?? 0,
              freezer: pb.frozenQty ?? 0,
              allocated: 0,
            } as Record<StockLocation, number>);
        return (
          <TransferModal
            productName={product?.name ?? "Product"}
            batchLabel={plan.batchNumber}
            distribution={effective}
            openOrders={openOrders}
            onConfirm={async ({ from, to, quantity, orderId, notes }) => {
              await transferBatchStock({
                planProductId: pb.id!,
                productId: pb.productId,
                fromLocation: from,
                toLocation: to,
                quantity,
                orderId,
                reason: to === "allocated" ? "allocate" : from === "allocated" ? "unallocate" : "transfer",
                notes,
              });
              setTransferPbId(null);
            }}
            onCancel={() => setTransferPbId(null)}
          />
        );
      })()}
    </div>
  );
}

// ─── Filling Stock Tab ──────────────────────────────────────────────────────

function FillingStockTab() {
  const fillingStockItems = useFillingStockItems();
  const allFillings = useFillings();
  const allPlans = useProductionPlans();
  const [search, setSearch] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [adjustInput, setAdjustInput] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addFillingId, setAddFillingId] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [addDate, setAddDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [showFilters, setShowFilters] = useState(false);
  const [filterFreezer, setFilterFreezer] = useState<"all" | "available" | "frozen">("all");
  const [freezingId, setFreezingId] = useState<string | null>(null);
  const [defrostingId, setDefrostingId] = useState<string | null>(null);

  const fillingsMap = useMemo(() => new Map(allFillings.map((l) => [l.id!, l])), [allFillings]);
  const plansMap = useMemo(() => new Map(allPlans.map((p) => [p.id!, p])), [allPlans]);

  // Group stock entries by filling
  type FillingGroup = {
    fillingId: string;
    fillingName: string;
    category: string;
    shelfLifeWeeks?: number;
    entries: (FillingStock & { planName?: string })[];
    totalG: number;
    frozenG: number;
  };

  const groups: FillingGroup[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, FillingGroup>();

    for (const item of fillingStockItems) {
      const filling = fillingsMap.get(item.fillingId);
      const fillingName = filling?.name ?? "Unknown filling";
      if (q && !fillingName.toLowerCase().includes(q)) continue;
      if (filterFreezer === "frozen" && !item.frozen) continue;
      if (filterFreezer === "available" && item.frozen) continue;

      if (!map.has(item.fillingId)) {
        map.set(item.fillingId, {
          fillingId: item.fillingId,
          fillingName,
          category: filling?.category ?? "",
          shelfLifeWeeks: filling?.shelfLifeWeeks ?? undefined,
          entries: [],
          totalG: 0,
          frozenG: 0,
        });
      }
      const g = map.get(item.fillingId)!;
      const plan = item.planId ? plansMap.get(item.planId) : undefined;
      g.entries.push({ ...item, planName: plan?.name });
      if (item.frozen) g.frozenG += item.remainingG;
      else g.totalG += item.remainingG;
    }

    // Surface every defined filling — even those with no stock rows
    // yet — so the operator can see "Mango Chili: 0 g, needs
    // cooking". Without this, fillings without stock simply
    // disappeared from the page and looked like configuration loss.
    // Skip when the freezer filter is active (no stock = nothing
    // frozen / nothing available, so the row is noise in those tabs).
    if (filterFreezer === "all") {
      for (const filling of allFillings) {
        if (!filling.id) continue;
        if (map.has(filling.id)) continue;
        if (filling.archived) continue;
        if (q && !filling.name.toLowerCase().includes(q)) continue;
        map.set(filling.id, {
          fillingId: filling.id,
          fillingName: filling.name,
          category: filling.category ?? "",
          shelfLifeWeeks: filling.shelfLifeWeeks ?? undefined,
          entries: [],
          totalG: 0,
          frozenG: 0,
        });
      }
    }

    // Sort entries oldest-first within each group
    for (const g of map.values()) {
      g.entries.sort((a, b) => new Date(a.madeAt).getTime() - new Date(b.madeAt).getTime());
    }

    const now = Date.now();
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

    // Sort groups: most urgent first (expired → least remaining shelf life → oldest made)
    // Fillings without shelf life sort after those with shelf life, by oldest entry
    return Array.from(map.values()).sort((a, b) => {
      const aOldest = a.entries[0] ? new Date(a.entries[0].madeAt).getTime() : now;
      const bOldest = b.entries[0] ? new Date(b.entries[0].madeAt).getTime() : now;

      // Compute remaining weeks for the oldest entry (most urgent)
      const aRemaining = a.shelfLifeWeeks != null
        ? a.shelfLifeWeeks - (now - aOldest) / WEEK_MS
        : null;
      const bRemaining = b.shelfLifeWeeks != null
        ? b.shelfLifeWeeks - (now - bOldest) / WEEK_MS
        : null;

      // Both have shelf life: sort by remaining (expired first, then least remaining)
      if (aRemaining !== null && bRemaining !== null) return aRemaining - bRemaining;
      // Only one has shelf life: it sorts first (more actionable)
      if (aRemaining !== null) return -1;
      if (bRemaining !== null) return 1;
      // Neither has shelf life: oldest production date first
      return aOldest - bOldest;
    });
  }, [fillingStockItems, fillingsMap, plansMap, search, filterFreezer]);

  async function handleDiscard(id: string) {
    await discardFillingStock(id);
    setConfirmDiscard(null);
  }

  async function handleAdjust(id: string) {
    const val = parseFloat(adjustInput);
    if (!isNaN(val) && val >= 0) {
      await adjustFillingStock(id, Math.round(val));
    }
    setAdjustingId(null);
    setAdjustInput("");
  }

  async function handleAddManual() {
    if (!addFillingId || !addAmount) return;
    const val = parseFloat(addAmount);
    if (isNaN(val) || val <= 0) return;
    // Clamp date to today if somehow a future date was entered
    const today = new Date().toISOString().slice(0, 10);
    const clampedDate = addDate > today ? today : addDate;
    await saveFillingStock({
      fillingId: addFillingId,
      remainingG: Math.round(val),
      madeAt: new Date(clampedDate).toISOString(),
      createdAt: Date.now(),
    });
    setShowAdd(false);
    setAddFillingId("");
    setAddAmount("");
    setAddDate(new Date().toISOString().slice(0, 10));
  }

  const isEmpty = fillingStockItems.length === 0 && !showAdd;

  return (
    <div className="px-4 pb-8 space-y-3">
      <div className="flex gap-2">
        <div className="flex-1 relative min-w-0">
          <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search fillings…"
            aria-label="Search filling stock"
            className="input !pl-9"
          />
        </div>
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={`relative rounded-sm border p-2 transition-colors ${showFilters ? "bg-primary text-primary-foreground border-primary" : "border-border bg-background"}`}
          aria-label="Filters"
        >
          <SlidersHorizontal className="w-5 h-5" />
          {filterFreezer !== "all" && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-sm bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
              1
            </span>
          )}
        </button>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="rounded-sm border border-border bg-background p-2 transition-colors hover:bg-muted"
          aria-label="Add filling stock"
          title="Add filling stock manually"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      {showFilters && (
        <div className="rounded-sm border border-border bg-card p-3 space-y-3">
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Freezer</p>
            <div className="flex flex-wrap gap-1">
              {(["all", "available", "frozen"] as const).map((opt) => {
                const label = opt === "all" ? "All" : opt === "available" ? "Available" : "Frozen only";
                const isFrozenOpt = opt === "frozen";
                return (
                  <button
                    key={opt}
                    onClick={() => setFilterFreezer(opt)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors inline-flex items-center gap-1 ${
                      filterFreezer === opt
                        ? isFrozenOpt ? "bg-sky-600 text-white" : "bg-accent text-accent-foreground"
                        : "border border-border text-muted-foreground"
                    }`}
                  >
                    {isFrozenOpt && <Snowflake className="w-3 h-3" />}
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Manual add form */}
      {showAdd && (
        <div className="rounded-sm border border-border bg-card p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Add leftover filling manually</p>
          <select
            value={addFillingId}
            onChange={(e) => setAddFillingId(e.target.value)}
            className="input text-sm"
          >
            <option value="">Select filling…</option>
            {allFillings
              .filter((l) => !l.archived && !l.supersededAt)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((l) => (
                <option key={l.id} value={l.id!}>{l.name}</option>
              ))}
          </select>
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              value={addAmount}
              onChange={(e) => setAddAmount(e.target.value)}
              placeholder="Amount in grams"
              className="input flex-1 text-sm"
            />
            <span className="self-center text-xs text-muted-foreground">g</span>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-0.5">Production date</label>
            <input
              type="date"
              value={addDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setAddDate(e.target.value)}
              className="input text-sm"
            />
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <button onClick={() => { setShowAdd(false); setAddFillingId(""); setAddAmount(""); setAddDate(new Date().toISOString().slice(0, 10)); }} className="text-xs text-muted-foreground">Cancel</button>
            <button
              onClick={handleAddManual}
              disabled={!addFillingId || !addAmount}
              className="rounded-sm bg-accent text-accent-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {isEmpty ? (
        <p className="text-sm text-muted-foreground py-10 text-center">
          No leftover fillings tracked. After filling products in a production batch, you can register leftover filling here.
        </p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No fillings match your search.</p>
      ) : (
        groups.map((group) => (
          <div key={group.fillingId} className="rounded-sm border border-border bg-card overflow-hidden">
            {/* Group header */}
            <div className="px-3 py-2 bg-muted/30 border-b border-border flex justify-between items-baseline">
              <div>
                <p className="font-semibold text-sm">{group.fillingName}</p>
                <p className="text-[10px] text-muted-foreground">
                  {group.category}{group.shelfLifeWeeks ? ` · ${group.shelfLifeWeeks}-week shelf life` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {group.frozenG > 0 && (
                  <span className="shrink-0 rounded-sm border border-sky-200 bg-sky-50 text-sky-700 px-1.5 py-0 text-[10px] font-semibold inline-flex items-center gap-0.5">
                    <Snowflake className="w-2.5 h-2.5" />
                    {Math.round(group.frozenG)}g
                  </span>
                )}
                <span className="text-sm font-semibold tabular-nums">{Math.round(group.totalG)}g</span>
              </div>
            </div>

            {/* Stock entries */}
            {group.entries.map((entry, i) => {
              const madeDate = new Date(entry.madeAt).toLocaleDateString("de-AT", { day: "numeric", month: "short", year: "numeric" });
              const isLast = i === group.entries.length - 1;

              // Freshness based on filling shelf life. Frozen entries pause
              // the shelf-life clock; defrosted entries use the captured
              // preservedShelfLifeDays from defrostedAt.
              let freshness: { text: string; cls: string } | null = null;
              if (entry.frozen) {
                freshness = { text: "Paused (frozen)", cls: "text-sky-700" };
              } else if (entry.defrostedAt && entry.preservedShelfLifeDays != null) {
                const sellBy = entry.defrostedAt + entry.preservedShelfLifeDays * 24 * 60 * 60 * 1000;
                const remainingDays = Math.round((sellBy - Date.now()) / (24 * 60 * 60 * 1000));
                if (remainingDays <= 0) freshness = { text: "Expired", cls: "text-status-alert" };
                else if (remainingDays <= 7) freshness = { text: `${remainingDays}d left · defrosted`, cls: "text-status-warn" };
                else freshness = { text: `${remainingDays}d left · defrosted`, cls: "text-status-ok" };
              } else if (group.shelfLifeWeeks) {
                const ageMs = Date.now() - new Date(entry.madeAt).getTime();
                const ageWeeks = ageMs / (7 * 24 * 60 * 60 * 1000);
                const remaining = Math.round((group.shelfLifeWeeks - ageWeeks) * 10) / 10;
                if (remaining <= 0) {
                  freshness = { text: "Expired", cls: "text-status-alert" };
                } else if (remaining <= 1) {
                  freshness = { text: `${remaining} wk left`, cls: "text-status-warn" };
                } else {
                  freshness = { text: `${remaining} wks left`, cls: "text-status-ok" };
                }
              }

              if (confirmDiscard === entry.id) {
                return (
                  <div key={entry.id} className={`px-3 py-2 bg-muted/40 flex items-center gap-3 ${!isLast ? "border-b border-border" : ""}`}>
                    <p className="text-xs text-muted-foreground flex-1">Discard this stock?</p>
                    <button onClick={() => handleDiscard(entry.id!)} className="text-xs font-medium text-status-alert">Yes</button>
                    <button onClick={() => setConfirmDiscard(null)} className="text-xs text-muted-foreground">Cancel</button>
                  </div>
                );
              }

              if (adjustingId === entry.id) {
                return (
                  <div key={entry.id} className={`px-3 py-2 flex items-center gap-2 ${!isLast ? "border-b border-border" : ""}`}>
                    <input
                      type="number"
                      min={0}
                      value={adjustInput}
                      onChange={(e) => setAdjustInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAdjust(entry.id!); if (e.key === "Escape") { setAdjustingId(null); setAdjustInput(""); } }}
                      autoFocus
                      className="input flex-1 text-sm h-7"
                    />
                    <span className="text-xs text-muted-foreground">g</span>
                    <button onClick={() => handleAdjust(entry.id!)} className="text-xs font-medium text-primary">Save</button>
                    <button onClick={() => { setAdjustingId(null); setAdjustInput(""); }} className="text-xs text-muted-foreground">Cancel</button>
                  </div>
                );
              }

              return (
                <div
                  key={entry.id}
                  className={`px-3 py-2.5 flex items-start justify-between gap-2 ${!isLast ? "border-b border-border" : ""} ${entry.frozen ? "bg-sky-50/40" : ""}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {entry.frozen && <Snowflake className="w-3 h-3 text-sky-600" />}
                      <span className="text-sm font-medium tabular-nums">{Math.round(entry.remainingG)}g</span>
                      {entry.frozen && (
                        <span className="text-[10px] font-semibold text-sky-700 uppercase tracking-wide">
                          In freezer
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground">· Made {madeDate}</span>
                      {freshness && (
                        <span className={`text-[10px] font-medium ${freshness.cls}`}>· {freshness.text}</span>
                      )}
                    </div>
                    {entry.planName && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">From: {entry.planName}</p>
                    )}
                    {entry.frozen && entry.preservedShelfLifeDays != null && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {entry.preservedShelfLifeDays} days shelf life on defrost
                      </p>
                    )}
                    {entry.notes && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{entry.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                    {entry.frozen ? (
                      <button
                        onClick={() => setDefrostingId(entry.id!)}
                        className="rounded-sm border border-sky-200 bg-white px-2 py-0.5 text-[10px] font-medium text-sky-700 hover:bg-sky-100 transition-colors"
                      >
                        Defrost
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => setFreezingId(entry.id!)}
                          className="rounded-sm border border-border px-2 py-0.5 text-[10px] font-medium text-sky-700 hover:border-sky-500 hover:bg-sky-50 transition-colors inline-flex items-center gap-0.5"
                          title="Move to freezer"
                        >
                          <Snowflake className="w-3 h-3" /> Freeze
                        </button>
                        <button
                          onClick={() => { setAdjustingId(entry.id!); setAdjustInput(String(Math.round(entry.remainingG))); }}
                          className="rounded-sm border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
                        >
                          Adjust
                        </button>
                        <button
                          onClick={() => setConfirmDiscard(entry.id!)}
                          className="rounded-sm border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:border-status-alert hover:text-status-alert transition-colors"
                        >
                          Discard
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))
      )}

      {/* Freeze filling modal */}
      {freezingId && (() => {
        const entry = fillingStockItems.find((e) => e.id === freezingId);
        if (!entry) return null;
        const filling = fillingsMap.get(entry.fillingId);
        const madeAtMs = new Date(entry.madeAt).getTime();
        const remaining = remainingShelfLifeDays(madeAtMs, filling?.shelfLifeWeeks);
        return (
          <FreezeModal
            title="Freeze filling"
            itemName={filling?.name ?? "Filling"}
            itemSubtitle={filling?.category}
            unit="g"
            availableQty={entry.remainingG}
            defaultQty={entry.remainingG}
            defaultShelfLifeDays={remaining}
            onConfirm={async (qty, days) => {
              await freezeFillingStock(entry.id!, days, qty);
              setFreezingId(null);
            }}
            onCancel={() => setFreezingId(null)}
          />
        );
      })()}

      {/* Defrost filling modal */}
      {defrostingId && (() => {
        const entry = fillingStockItems.find((e) => e.id === defrostingId);
        if (!entry) return null;
        const filling = fillingsMap.get(entry.fillingId);
        return (
          <DefrostConfirmModal
            itemName={filling?.name ?? "filling"}
            qty={entry.remainingG}
            unit="g"
            preservedShelfLifeDays={entry.preservedShelfLifeDays}
            onConfirm={async () => {
              await defrostFillingStock(entry.id!);
              setDefrostingId(null);
            }}
            onCancel={() => setDefrostingId(null)}
          />
        );
      })()}
    </div>
  );
}

// ─── Movements Tab ─────────────────────────────────────────────────
//
// Read-only feed of recent stockMovements rows. Joins planProductId →
// product name, variantPackagingId → variant + size for display.
// Filterable by location + reason. Most-recent-first.

function MovementsTab() {
  const movements = useStockMovements();
  const products = useProductsList();
  const allPlanProducts = useAllPlanProducts();
  const variants = useVariants();
  const variantPackagings = useAllVariantPackagings();

  const [locationFilter, setLocationFilter] = useState<"all" | StockLocation>("all");
  const [reasonFilter, setReasonFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const productByPlanProduct = useMemo(() => {
    const m = new Map<string, string>();
    for (const pp of allPlanProducts) {
      if (pp.id && pp.productId) m.set(pp.id, pp.productId);
    }
    return m;
  }, [allPlanProducts]);
  const productById = useMemo(
    () => new Map(products.map((p) => [p.id!, p])),
    [products],
  );
  const variantById = useMemo(
    () => new Map(variants.map((v) => [v.id!, v])),
    [variants],
  );
  const vpById = useMemo(
    () => new Map(variantPackagings.map((vp) => [vp.id!, vp])),
    [variantPackagings],
  );

  const allReasons = useMemo(() => {
    const set = new Set<string>();
    for (const m of movements) if (m.reason) set.add(m.reason);
    return [...set].sort();
  }, [movements]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return movements.filter((m) => {
      if (locationFilter !== "all") {
        if (m.fromLocation !== locationFilter && m.toLocation !== locationFilter) return false;
      }
      if (reasonFilter !== "all" && m.reason !== reasonFilter) return false;
      if (q) {
        const pid = m.planProductId ? productByPlanProduct.get(m.planProductId) : undefined;
        const product = pid ? productById.get(pid) : undefined;
        const vp = m.variantPackagingId ? vpById.get(m.variantPackagingId) : undefined;
        const variant = vp ? variantById.get(vp.variantId) : undefined;
        const haystack = `${product?.name ?? ""} ${variant?.name ?? ""} ${m.notes ?? ""} ${m.reason ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    }).slice(0, 200);
  }, [movements, locationFilter, reasonFilter, search, productByPlanProduct, productById, vpById, variantById]);

  function labelFor(m: StockMovement): string {
    if (m.variantPackagingId) {
      const vp = vpById.get(m.variantPackagingId);
      const variant = vp ? variantById.get(vp.variantId) : undefined;
      return `${variant?.name ?? "Variant"} (box)`;
    }
    if (m.planProductId) {
      const pid = productByPlanProduct.get(m.planProductId);
      const product = pid ? productById.get(pid) : undefined;
      return product?.name ?? `Batch ${m.planProductId.slice(0, 8)}`;
    }
    return "—";
  }

  function arrowFor(m: StockMovement): string {
    const from = m.fromLocation ?? "—";
    const to = m.toLocation ?? "—";
    return `${from} → ${to}`;
  }

  return (
    <div className="px-4 pb-6">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-1 text-xs">
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by product / variant / note…"
            className="w-64 rounded border border-border bg-card px-2 py-1"
          />
        </div>
        <select
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value as typeof locationFilter)}
          className="rounded border border-border bg-card px-2 py-1 text-xs"
        >
          <option value="all">All locations</option>
          {STOCK_LOCATIONS.map((loc) => (
            <option key={loc} value={loc}>{STOCK_LOCATION_SHORT_LABELS[loc] ?? loc}</option>
          ))}
        </select>
        <select
          value={reasonFilter}
          onChange={(e) => setReasonFilter(e.target.value)}
          className="rounded border border-border bg-card px-2 py-1 text-xs"
        >
          <option value="all">All reasons</option>
          {allReasons.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <span className="text-[11px] text-muted-foreground ml-auto">
          {filtered.length} of {movements.length} movements
        </span>
      </div>

      <div className="rounded-sm border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-[150px_1fr_140px_60px_120px_1fr] gap-2 px-3 py-2 bg-muted/40 border-b border-border text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
          <span>When</span>
          <span>Item</span>
          <span>Move</span>
          <span className="text-right">Qty</span>
          <span>Reason</span>
          <span>Note</span>
        </div>
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground italic px-3 py-6 text-center">
            No movements match these filters.
          </p>
        ) : (
          filtered.map((m, i) => (
            <div
              key={m.id ?? i}
              className="grid grid-cols-[150px_1fr_140px_60px_120px_1fr] gap-2 px-3 py-1.5 text-xs border-b border-border last:border-b-0"
            >
              <span className="text-muted-foreground tabular-nums">
                {new Date(m.movedAt).toLocaleString("de-AT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className="truncate">{labelFor(m)}</span>
              <span className="text-muted-foreground">{arrowFor(m)}</span>
              <span className="text-right tabular-nums">{m.quantity}</span>
              <span className="text-muted-foreground">{m.reason ?? "—"}</span>
              <span className="text-muted-foreground truncate" title={m.notes ?? ""}>
                {m.notes ?? ""}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
