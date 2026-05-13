"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { IconArrowLeft as ArrowLeft, IconCheck as Check } from "@tabler/icons-react";
import { PageHeader } from "@/components/dulceria";
import {
  useVariants,
  useAllVariantPackagings,
  useAllVariantPackagingComponents,
  useAllVariantPackagingProducts,
  useProductsList,
  usePackagingList,
  useProductLocationTotals,
  useCampaigns,
  useProductCategories,
  saveStockTransfer,
  applyStockAdjustments,
} from "@/lib/hooks";
import {
  STOCK_TRANSFER_REASON_LABELS,
  type StockTransferReason,
} from "@/types";

/**
 * Daily count — single end-of-shop-day flow.
 *
 *   Tab 1 — Variants sold
 *     Bulk entry: pick a variant size + qty + price. Auto-revenue.
 *     On save:
 *       • curated variant: writes stockTransfer reason='sold' for
 *         each composition product × qty + each packaging component
 *         × qty.
 *       • free-pick variant (no composition): packaging deductions
 *         only — products are caught by tab 2's variance reasoning.
 *       • single product (bar / special): direct product deduction.
 *
 *   Tab 2 — Bonbon count
 *     Recount each product on the shelf. App computes:
 *       expected = current_db_stock − variants-deducted-in-tab-1
 *     Variance = counted − expected. Negative variance → require
 *     reason (sold via custom box, tasting, gift, waste, etc.).
 *     Positive variance = "found" (already in the reason list).
 *
 *   Submit writes everything in one go: variant sales + variances.
 *   Future: hellocash sync + freezing the recount as a baseline.
 */

const VARIANCE_REASONS: StockTransferReason[] = [
  "custom_box",
  "sold",
  "tasting",
  "gift",
  "event_sample",
  "staff",
  "waste",
];

export default function DailyCountPage() {
  const router = useRouter();
  const variants = useVariants();
  const variantPackagings = useAllVariantPackagings();
  const variantComponents = useAllVariantPackagingComponents();
  const variantProducts = useAllVariantPackagingProducts();
  const products = useProductsList();
  const packaging = usePackagingList(true);
  const stockByProduct = useProductLocationTotals();
  const campaigns = useCampaigns();
  const productCategories = useProductCategories(true);

  const productById = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const categoryNameById = useMemo(
    () => new Map(productCategories.map((c) => [c.id!, c.name])),
    [productCategories],
  );

  // Tab 2 category-filter state — clickable chip row above the count table.
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set());
  const [countSearch, setCountSearch] = useState("");
  const variantById = useMemo(() => new Map(variants.map((v) => [v.id!, v])), [variants]);
  const packagingById = useMemo(() => new Map(packaging.map((p) => [p.id!, p])), [packaging]);

  // VariantPackagings × variant lookup so each row reads "Variant — size".
  type SizeRow = {
    id: string;
    variantId: string;
    label: string;
    price: number;
    components: { packagingId: string; qty: number }[];
    composition: { productId: string; qty: number }[];
  };
  const sizeRows: SizeRow[] = useMemo(() => {
    const list: SizeRow[] = [];
    for (const vp of variantPackagings) {
      const v = variantById.get(vp.variantId);
      if (!v) continue;
      const pkg = vp.packagingId ? packagingById.get(vp.packagingId) : null;
      const sizeLabel = pkg?.name ?? (vp.packagingId ? "size" : "loose");
      const components = variantComponents
        .filter((c) => c.variantPackagingId === vp.id)
        .map((c) => ({ packagingId: c.packagingId, qty: c.qtyPerVariant }));
      const composition = variantProducts
        .filter((p) => p.variantPackagingId === vp.id)
        .map((p) => ({ productId: p.productId, qty: p.qty }));
      list.push({
        id: vp.id!,
        variantId: vp.variantId,
        label: `${v.name} · ${sizeLabel}`,
        price: vp.price ?? vp.sellPrice ?? 0,
        components,
        composition,
      });
    }
    return list.sort((a, b) => a.label.localeCompare(b.label));
  }, [variantPackagings, variantById, packagingById, variantComponents, variantProducts]);

  // Active market_event campaign — auto-tag notes.
  const activeMarketEvent = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    return campaigns.find(
      (c) => c.type === "market_event"
        && c.status !== "done" && c.status !== "cancelled"
        && c.startDate <= todayIso && c.endDate >= todayIso,
    );
  }, [campaigns]);

  const [tab, setTab] = useState<"variants" | "count">("variants");

  // Variant sales + single-product sales state.
  const [variantQty, setVariantQty] = useState<Record<string, number>>({});
  const [variantPriceOverride, setVariantPriceOverride] = useState<Record<string, string>>({});
  const [singleProductSales, setSingleProductSales] = useState<Array<{ productId: string; qty: number; unitPrice: number }>>([]);

  // Counted shelf state (per productId).
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [varianceReason, setVarianceReason] = useState<Record<string, StockTransferReason>>({});

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Pieces sold per product via tab 1 variants (composition × qty).
  const variantDeductionPerProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of sizeRows) {
      const qty = variantQty[row.id] ?? 0;
      if (!qty) continue;
      for (const comp of row.composition) {
        m.set(comp.productId, (m.get(comp.productId) ?? 0) + comp.qty * qty);
      }
    }
    return m;
  }, [sizeRows, variantQty]);

  // Plus single-product sales (bars / specials).
  const singleProductPerProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const sp of singleProductSales) {
      m.set(sp.productId, (m.get(sp.productId) ?? 0) + sp.qty);
    }
    return m;
  }, [singleProductSales]);

  const variantRevenue = useMemo(() => {
    let total = 0;
    for (const row of sizeRows) {
      const qty = variantQty[row.id] ?? 0;
      const overrideStr = variantPriceOverride[row.id]?.trim();
      const price = overrideStr ? Number(overrideStr) : row.price;
      total += qty * (Number.isFinite(price) ? price : 0);
    }
    for (const sp of singleProductSales) {
      total += sp.qty * sp.unitPrice;
    }
    return Math.round(total * 100) / 100;
  }, [sizeRows, variantQty, variantPriceOverride, singleProductSales]);

  const variantPiecesSold = useMemo(() => {
    let total = 0;
    for (const v of variantDeductionPerProduct.values()) total += v;
    for (const v of singleProductPerProduct.values()) total += v;
    return total;
  }, [variantDeductionPerProduct, singleProductPerProduct]);

  // Products to render in tab 2 — every non-archived product. Showing
  // zero-stock items too lets the user reconcile from scratch (e.g.
  // first-time opening balance) rather than relying on existing stock
  // state. Filtering by category chip + search trims the visible set.
  const countableProducts = useMemo(() => {
    return products
      .filter((p) => !p.archived && p.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products]);
  void stockByProduct; // still used per-row for "Start" column lookup

  function expectedFor(productId: string): number {
    const start = stockByProduct.get(productId)?.store ?? 0;
    const variantSold = variantDeductionPerProduct.get(productId) ?? 0;
    const singleSold = singleProductPerProduct.get(productId) ?? 0;
    return Math.max(0, start - variantSold - singleSold);
  }
  function varianceFor(productId: string): number | null {
    const raw = counts[productId];
    if (raw === undefined || raw === "") return null;
    const counted = Number(raw);
    if (!Number.isFinite(counted)) return null;
    return counted - expectedFor(productId);
  }

  async function handleSubmit() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const tag = activeMarketEvent ? `[${activeMarketEvent.name}] ` : "";
      const now = new Date();

      // Build adjustment list in one go so the totals move for real
      // (productStock / stockLocations) instead of just audit rows.
      type Adj = {
        itemType: "product" | "packaging";
        itemId: string;
        location?: "store";
        deltaQty: number;
        reason: "correction" | "damaged" | "other";
        note: string;
      };
      const adjustments: Adj[] = [];

      // 1) Variant sales — composition + packaging deductions go through
      //    real stock adjustments. Revenue is captured on a separate
      //    audit-only stockTransfer row so /reports/sales rolls it up.
      for (const row of sizeRows) {
        const qty = variantQty[row.id] ?? 0;
        if (!qty) continue;
        const overrideStr = variantPriceOverride[row.id]?.trim();
        const unitPrice = overrideStr ? Number(overrideStr) : row.price;
        const noteBase = `${tag}${row.label} × ${qty}${unitPrice ? ` @ €${unitPrice.toFixed(2)}` : ""}`;
        for (const comp of row.composition) {
          adjustments.push({
            itemType: "product",
            itemId: comp.productId,
            location: "store",
            deltaQty: -comp.qty * qty,
            reason: "other",
            note: `Sold via variant — ${noteBase}`,
          });
        }
        for (const c of row.components) {
          adjustments.push({
            itemType: "packaging",
            itemId: c.packagingId,
            deltaQty: -c.qty * qty,
            reason: "other",
            note: `Used by variant — ${noteBase}`,
          });
        }
        // Revenue audit row — quantity 0, just attaches unitPrice.
        await saveStockTransfer({
          entityType: "product",
          entityId: row.composition[0]?.productId ?? row.variantId,
          quantity: qty,
          fromLocationId: "store",
          toLocationId: "consumed",
          transferredAt: now,
          reason: "sold",
          unitPrice: Number.isFinite(unitPrice) ? unitPrice : null,
          notes: `[REVENUE] ${noteBase}`,
        });
      }

      // 2) Single-product sales (bars / specials).
      for (const sp of singleProductSales) {
        if (!sp.qty) continue;
        adjustments.push({
          itemType: "product",
          itemId: sp.productId,
          location: "store",
          deltaQty: -sp.qty,
          reason: "other",
          note: `${tag}Sold ${productById.get(sp.productId)?.name ?? "—"} × ${sp.qty}`,
        });
        await saveStockTransfer({
          entityType: "product",
          entityId: sp.productId,
          quantity: sp.qty,
          fromLocationId: "store",
          toLocationId: "consumed",
          transferredAt: now,
          reason: "sold",
          unitPrice: sp.unitPrice || null,
          notes: `${tag}${productById.get(sp.productId)?.name ?? "—"} × ${sp.qty}`,
        });
      }

      // 3) Variances from tab 2 — only when user supplied a count.
      for (const p of countableProducts) {
        const v = varianceFor(p.id!);
        if (v == null || v === 0) continue;
        const reason = varianceReason[p.id!] ?? (v < 0 ? "custom_box" : "return");
        adjustments.push({
          itemType: "product",
          itemId: p.id!,
          location: "store",
          deltaQty: v, // signed (counted - expected)
          reason: v < 0 && reason === "waste" ? "damaged" : "correction",
          note: `${tag}variance during daily count (counted ${counts[p.id!]} vs expected ${expectedFor(p.id!)}) reason=${reason}`,
        });
        // Audit row preserves the chosen reason (sold/tasting/gift/etc).
        await saveStockTransfer({
          entityType: "product",
          entityId: p.id!,
          quantity: Math.abs(v),
          fromLocationId: v < 0 ? "store" : undefined,
          toLocationId: v < 0 ? "consumed" : "store",
          transferredAt: now,
          reason,
          unitPrice: null,
          notes: `${tag}variance during daily count (counted ${counts[p.id!]} vs expected ${expectedFor(p.id!)})`,
        });
      }

      const result = await applyStockAdjustments(adjustments);
      if (result.failed) {
        setSaveMsg(`Stopped after ${result.applied} adjustments. ${result.error instanceof Error ? result.error.message : "See console."}`);
        return;
      }

      setSaveMsg(`Saved · ${variantPiecesSold} pcs sold via variants/singles · revenue €${variantRevenue.toFixed(2)}`);
      setVariantQty({});
      setVariantPriceOverride({});
      setSingleProductSales([]);
      setCounts({});
      setVarianceReason({});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveMsg(`Save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title="Daily count"
        meta="End-of-day reconciliation · Tab 1 bulk-enter variant + single-product sales · Tab 2 count bonbons left on shelf — variance gets a reason"
      />

      {/* Category chip row — applies to BOTH tabs. Filters variant
          sizes (by composition products) on tab 1 and the bonbon
          count list on tab 2. Mirrors the pattern on /shop/count. */}
      {(() => {
        const ids = new Set<string>();
        for (const row of sizeRows) {
          for (const c of row.composition) {
            const product = products.find((p) => p.id === c.productId);
            if (product?.productCategoryId) ids.add(product.productCategoryId);
          }
        }
        for (const p of products) {
          if (p.productCategoryId && !p.archived) ids.add(p.productCategoryId);
        }
        const list = [...ids]
          .map((id) => ({ id, name: categoryNameById.get(id) ?? id }))
          .sort((a, b) => a.name.localeCompare(b.name));
        if (list.length === 0) return null;
        return (
          <div className="px-4 mb-3 flex items-center gap-1.5 flex-wrap">
            {list.map((c) => {
              const active = activeCategories.has(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    setActiveCategories((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.id)) next.delete(c.id);
                      else next.add(c.id);
                      return next;
                    });
                  }}
                  className={
                    "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors capitalize " +
                    (active
                      ? "bg-foreground text-background"
                      : "bg-[color:var(--ds-card-bg)] text-muted-foreground border border-[color:var(--ds-border-warm)] hover:border-foreground")
                  }
                >
                  {c.name}
                </button>
              );
            })}
            {activeCategories.size > 0 && (
              <button
                onClick={() => setActiveCategories(new Set())}
                className="text-[11px] text-muted-foreground hover:text-foreground underline"
              >
                Clear
              </button>
            )}
          </div>
        );
      })()}

      {/* Tabs */}
      <div className="px-4 mb-4 flex gap-1.5">
        <button
          onClick={() => setTab("variants")}
          className={
            "rounded-full px-3 py-1 text-[12px] font-medium border " +
            (tab === "variants"
              ? "bg-foreground text-background border-foreground"
              : "bg-[color:var(--ds-card-bg)] border-[color:var(--ds-border-warm)] hover:border-foreground")
          }
        >
          1 · Variants & singles · {variantPiecesSold} pcs · €{variantRevenue.toFixed(2)}
        </button>
        <button
          onClick={() => setTab("count")}
          className={
            "rounded-full px-3 py-1 text-[12px] font-medium border " +
            (tab === "count"
              ? "bg-foreground text-background border-foreground"
              : "bg-[color:var(--ds-card-bg)] border-[color:var(--ds-border-warm)] hover:border-foreground")
          }
        >
          2 · Bonbon count
        </button>
      </div>

      {activeMarketEvent && (
        <div className="px-4 mb-3 text-[11px] text-muted-foreground">
          Active market event: <b>{activeMarketEvent.name}</b> — sales auto-tagged.
        </div>
      )}

      {tab === "variants" ? (() => {
        // Apply category filter to sizeRows: a row matches when ANY
        // of its composition products belongs to an active category.
        const productCatById = new Map(products.map((p) => [p.id!, p.productCategoryId ?? ""]));
        const visibleSizeRows = activeCategories.size === 0
          ? sizeRows
          : sizeRows.filter((row) => row.composition.some((c) => activeCategories.has(productCatById.get(c.productId) ?? "")));
        return (
        <div className="px-4 space-y-4">
          {/* Variant sizes */}
          <section>
            <h2 className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground font-semibold mb-2">
              Variant sizes ({visibleSizeRows.length}{activeCategories.size > 0 ? ` of ${sizeRows.length}` : ""})
            </h2>
            {visibleSizeRows.length === 0 ? (
              <p className="text-sm text-muted-foreground italic px-3 py-3 border border-dashed border-[color:var(--ds-border-warm)] rounded-[6px]">
                {activeCategories.size > 0
                  ? "No variant sizes match the selected category filter."
                  : "No variants set up. Create one at /variants first."}
              </p>
            ) : (
              <ul className="rounded-[6px] border border-[color:var(--ds-border-warm)] divide-y divide-border bg-[color:var(--ds-card-bg)]">
                {visibleSizeRows.map((row) => {
                  const qty = variantQty[row.id] ?? 0;
                  const overrideStr = variantPriceOverride[row.id] ?? "";
                  const price = overrideStr.trim() ? Number(overrideStr) : row.price;
                  const total = qty * (Number.isFinite(price) ? price : 0);
                  return (
                    <li key={row.id} className="px-3 py-2 flex items-center gap-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium truncate">{row.label}</p>
                        <p className="text-[10.5px] text-muted-foreground truncate">
                          {row.composition.length > 0
                            ? `${row.composition.reduce((s, c) => s + c.qty, 0)} pcs · ${row.composition.length} products`
                            : "loose / no composition"}
                          {row.components.length > 0 && ` · ${row.components.length} packaging`}
                        </p>
                      </div>
                      <input
                        type="number"
                        min={0}
                        value={qty || ""}
                        onChange={(e) => {
                          const v = Math.max(0, Number(e.target.value) || 0);
                          setVariantQty((p) => ({ ...p, [row.id]: v }));
                        }}
                        placeholder="0"
                        className="input"
                        style={{ maxWidth: 80, padding: "4px 8px" }}
                      />
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={overrideStr}
                        onChange={(e) => setVariantPriceOverride((p) => ({ ...p, [row.id]: e.target.value }))}
                        placeholder={`€${row.price.toFixed(2)}`}
                        className="input"
                        style={{ maxWidth: 90, padding: "4px 8px" }}
                      />
                      <span className="text-[12px] tabular-nums w-16 text-right text-muted-foreground">
                        {total > 0 ? `€${total.toFixed(2)}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Single-product sales (bars / specials) */}
          <section>
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground font-semibold">
                Single-product sales (bars / specials)
              </h2>
              <button
                onClick={() => setSingleProductSales((p) => [...p, { productId: "", qty: 0, unitPrice: 0 }])}
                className="text-[11px] px-2 py-0.5 border border-[color:var(--ds-border-warm)] rounded-full hover:border-foreground"
              >
                + Add line
              </button>
            </div>
            {singleProductSales.length === 0 ? (
              <p className="text-[12px] text-muted-foreground italic">No singles. Click "+ Add line" if any bars sold individually.</p>
            ) : (
              <ul className="rounded-[6px] border border-[color:var(--ds-border-warm)] divide-y divide-border bg-[color:var(--ds-card-bg)]">
                {singleProductSales.map((sp, i) => (
                  <li key={i} className="px-3 py-2 flex items-center gap-2 flex-wrap">
                    <select
                      value={sp.productId}
                      onChange={(e) => setSingleProductSales((p) => p.map((s, j) => j === i ? { ...s, productId: e.target.value } : s))}
                      className="input"
                      style={{ maxWidth: 220 }}
                    >
                      <option value="">— pick product —</option>
                      {products
                        .filter((p) => !p.archived)
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>
                    <input
                      type="number"
                      min={0}
                      value={sp.qty || ""}
                      onChange={(e) => setSingleProductSales((p) => p.map((s, j) => j === i ? { ...s, qty: Math.max(0, Number(e.target.value) || 0) } : s))}
                      placeholder="qty"
                      className="input"
                      style={{ maxWidth: 70, padding: "4px 8px" }}
                    />
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={sp.unitPrice || ""}
                      onChange={(e) => setSingleProductSales((p) => p.map((s, j) => j === i ? { ...s, unitPrice: Math.max(0, Number(e.target.value) || 0) } : s))}
                      placeholder="€ each"
                      className="input"
                      style={{ maxWidth: 90, padding: "4px 8px" }}
                    />
                    <button
                      onClick={() => setSingleProductSales((p) => p.filter((_, j) => j !== i))}
                      className="text-[11px] text-muted-foreground hover:text-status-alert"
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        );
      })() : (
        <div className="px-4 space-y-4">
          <section>
            <h2 className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground font-semibold mb-2">
              Bonbon count · expected = current store stock − variants/singles in tab 1
            </h2>

            {/* Search box only — chip row lives at the top of the
                page now and applies to both tabs. */}
            {countableProducts.length > 0 && (
              <div className="mb-3">
                <input
                  type="text"
                  value={countSearch}
                  onChange={(e) => setCountSearch(e.target.value)}
                  placeholder="Search products…"
                  className="input"
                />
              </div>
            )}
            {countableProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground italic px-3 py-3 border border-dashed border-[color:var(--ds-border-warm)] rounded-[6px]">
                Nothing to count. Add some shop stock or variant sales first.
              </p>
            ) : (
              <div className="rounded-[6px] border border-[color:var(--ds-border-warm)] overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead className="bg-muted text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2">Product</th>
                      <th className="text-right px-2 py-2">Start</th>
                      <th className="text-right px-2 py-2">Sold (T1)</th>
                      <th className="text-right px-2 py-2">Expected</th>
                      <th className="text-right px-2 py-2">Counted</th>
                      <th className="text-right px-2 py-2">Variance</th>
                      <th className="text-left px-2 py-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {countableProducts
                      .filter((p) => {
                        if (activeCategories.size > 0) {
                          if (!p.productCategoryId || !activeCategories.has(p.productCategoryId)) return false;
                        }
                        const q = countSearch.trim().toLowerCase();
                        if (q && !p.name.toLowerCase().includes(q)) return false;
                        return true;
                      })
                      .map((p) => {
                      const start = stockByProduct.get(p.id!)?.store ?? 0;
                      const sold = (variantDeductionPerProduct.get(p.id!) ?? 0) + (singleProductPerProduct.get(p.id!) ?? 0);
                      const expected = expectedFor(p.id!);
                      const v = varianceFor(p.id!);
                      const variance = v ?? 0;
                      const needsReason = v != null && v !== 0;
                      const reason = varianceReason[p.id!] ?? "custom_box";
                      return (
                        <tr key={p.id} className="border-t border-[color:var(--ds-border-warm)]">
                          <td className="px-3 py-1.5 truncate">{p.name}</td>
                          <td className="text-right px-2 py-1.5 tabular-nums">{start}</td>
                          <td className="text-right px-2 py-1.5 tabular-nums text-muted-foreground">{sold || ""}</td>
                          <td className="text-right px-2 py-1.5 tabular-nums">{expected}</td>
                          <td className="px-2 py-1.5 text-right">
                            <input
                              type="number"
                              min={0}
                              value={counts[p.id!] ?? ""}
                              onChange={(e) => setCounts((c) => ({ ...c, [p.id!]: e.target.value }))}
                              className="input"
                              style={{ maxWidth: 70, padding: "2px 6px", textAlign: "right" }}
                              placeholder="—"
                            />
                          </td>
                          <td className={`text-right px-2 py-1.5 tabular-nums font-medium ${variance < 0 ? "text-status-alert" : variance > 0 ? "text-status-ok" : "text-muted-foreground"}`}>
                            {v == null ? "" : (variance > 0 ? `+${variance}` : variance)}
                          </td>
                          <td className="px-2 py-1.5">
                            {needsReason ? (
                              <select
                                value={reason}
                                onChange={(e) => setVarianceReason((r) => ({ ...r, [p.id!]: e.target.value as StockTransferReason }))}
                                className="input"
                                style={{ maxWidth: 140, padding: "2px 6px" }}
                              >
                                {(variance < 0 ? VARIANCE_REASONS : (["return", "manual"] as StockTransferReason[])).map((r) => (
                                  <option key={r} value={r}>{STOCK_TRANSFER_REASON_LABELS[r]}</option>
                                ))}
                              </select>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      <div className="px-4 mt-6 pb-12 flex items-center justify-between gap-3">
        <span className="text-[11px] text-muted-foreground">
          {variantPiecesSold} pcs sold · €{variantRevenue.toFixed(2)} revenue ·{" "}
          {Object.keys(counts).filter((k) => counts[k] !== "").length} products counted
        </span>
        <div className="flex items-center gap-3">
          {saveMsg && <span className="text-[11px] text-status-ok">{saveMsg}</span>}
          <button
            onClick={handleSubmit}
            disabled={saving || (variantPiecesSold === 0 && Object.keys(counts).length === 0 && singleProductSales.length === 0)}
            className="btn-primary inline-flex items-center gap-1.5"
          >
            <Check className="w-4 h-4" /> {saving ? "Saving…" : "Save daily count"}
          </button>
        </div>
      </div>
    </div>
  );
}
