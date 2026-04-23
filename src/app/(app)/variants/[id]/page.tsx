"use client";

import { use, useState, useEffect, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useVariant,
  useVariantProducts,
  useVariantPackagings,
  useVariantPackagingProducts,
  useVariantPricingSnapshots,
  useAllVariantLabels,
  saveVariant,
  deleteVariant,
  addProductToVariant,
  removeProductFromVariant,
  saveVariantPackaging,
  saveVariantPricingSnapshot,
  deleteVariantPackaging,
  replaceVariantPackagingProducts,
  useProductsList,
  usePackagingList,
  useAllPackagingOrders,
  useCurrencySymbol,
  useProductCategoryMap,
  useIngredients,
  useMouldsList,
  useProductFillingsForProducts,
  useFillingIngredientsForFillings,
  useMarketRegion,
} from "@/lib/hooks";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import { deriveShellPercentageFromGrams } from "@/lib/costCalculation";
import { DENSITY_G_PER_ML } from "@/lib/production";
import { calculateProductNutrition, calculateVariantNutrition, getNutrientsByMarket, getNutritionPanelTitle, formatNutrientValue } from "@/lib/nutrition";
import { buildVariantIngredientList, type ProductIngredientListInput } from "@/lib/ingredientList";
import { ArrowLeft, Plus, Search, X, Trash2, Pencil, ChevronDown, RefreshCw, AlertTriangle } from "lucide-react";
import { InlineNameEditor } from "@/components/inline-name-editor";
import { useNavigationGuard } from "@/lib/useNavigationGuard";
import Link from "next/link";
import type { ProductCostSnapshot, Packaging, PackagingOrder, VariantPricingSnapshot, Ingredient, VariantKind, OrderChannel } from "@/types";
import { ORDER_CHANNELS, ORDER_CHANNEL_LABELS } from "@/types";
import { costPerGram } from "@/types";
import {
  latestPackagingUnitCost,
  averageProductCost,
  calculateBoxPricing,
  marginHealth,
  marginDelta,
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

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const STATUS_LABEL: Record<VariantStatus, string> = {
  permanent: "Standard / ongoing",
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

/** Bulk-fetch the latest cost snapshot per product (single query, stable hook count) */
function useProductCosts(_productIds: string[]): Map<string, ProductCostSnapshot> {
  const { data } = useQuery({
    queryKey: ["product-cost-snapshots", "latest-per-product"],
    queryFn: async () => {
      const all = assertOk(
        await supabase.from("productCostSnapshots").select("*"),
      ) as ProductCostSnapshot[];
      const latest = new Map<string, ProductCostSnapshot>();
      for (const snap of all) {
        const existing = latest.get(snap.productId);
        if (!existing || new Date(snap.recordedAt).getTime() > new Date(existing.recordedAt).getTime()) {
          latest.set(snap.productId, snap);
        }
      }
      return latest;
    },
  });
  return data ?? new Map();
}

export default function VariantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = use(params);
  const variantId = decodeURIComponent(idStr);
  const router = useRouter();
  const searchParams = useSearchParams();
  const isNew = searchParams.get("new") === "1";
  const from = searchParams.get("from");
  const backHref = from === "pricing" ? "/pricing" : "/variants";
  const backLabel = from === "pricing" ? "Pricing & Margins" : "Variants";

  const sym = useCurrencySymbol();

  const variant = useVariant(variantId);
  const variantProducts = useVariantProducts(variantId);
  const variantPackagings = useVariantPackagings(variantId);
  // Include archived so the name lookup map still resolves names for
  // products that were archived after being added to this variant.
  // Archived products are filtered out of the "Add product" form separately.
  const allProducts = useProductsList(true);
  const productCategoryMap = useProductCategoryMap();
  const allPackaging = usePackagingList(true);
  const allOrders = useAllPackagingOrders();
  const allPricingSnapshots = useVariantPricingSnapshots(variantId);

  // Build product ID list for cost hooks (stable reference)
  const productIds = useMemo(
    () => variantProducts.map((cr) => cr.productId),
    [variantProducts]
  );
  const productCostMap = useProductCosts(productIds);

  // Check if any ingredients used in this variant's products have missing pricing
  const productIdsKey = productIds.join(",");
  const { data: hasMissingIngredientPricing } = useQuery({
    queryKey: ["variant-missing-ingredient-pricing", productIdsKey],
    enabled: productIds.length > 0,
    queryFn: async () => {
      const rls = assertOk(
        await supabase.from("productFillings").select("fillingId").in("productId", productIds),
      ) as { fillingId: string }[];
      if (rls.length === 0) return false;
      const fillingIds = [...new Set(rls.map((rl) => rl.fillingId))];
      const lis = assertOk(
        await supabase.from("fillingIngredients").select("ingredientId").in("fillingId", fillingIds),
      ) as { ingredientId: string }[];
      if (lis.length === 0) return false;
      const ingredientIds = [...new Set(lis.map((li) => li.ingredientId))];
      const ingredients = assertOk(
        await supabase.from("ingredients").select("*").in("id", ingredientIds),
      ) as Ingredient[];
      return ingredients.some((ing) => costPerGram(ing) === null);
    },
  });

  // Edit mode
  const [editing, setEditing] = useState(isNew);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [labelInput, setLabelInput] = useState("");
  const [kind, setKind] = useState<VariantKind>("curated");
  const [vatRateStr, setVatRateStr] = useState("10");

  // Add-box form: channel price overrides (empty string = use default).
  const [channelPriceB2B, setChannelPriceB2B]       = useState("");
  const [channelPriceShop, setChannelPriceShop]     = useState("");
  const [channelPriceEvent, setChannelPriceEvent]   = useState("");
  const [channelPriceOnline, setChannelPriceOnline] = useState("");
  // Curated composition for the box being added: productId → qty
  const [newBoxComposition, setNewBoxComposition] = useState<Array<{ productId: string; qty: number }>>([]);

  // Autocomplete source: every label used on any variant
  const knownLabels = useAllVariantLabels();

  // Product management
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  // Pricing management
  const [showAddBox, setShowAddBox] = useState(false);
  const [selectedPackagingId, setSelectedPackagingId] = useState("");
  const [sellPriceStr, setSellPriceStr] = useState("");
  const [pendingRemoveBox, setPendingRemoveBox] = useState<string | null>(null);
  const [editingSellPrice, setEditingSellPrice] = useState<string | null>(null);
  const [editSellPriceStr, setEditSellPriceStr] = useState("");
  // Tracks which box history panels are expanded (keyed by cp.id)
  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(new Set());

  // Delete confirmation
  const [showDelete, setShowDelete] = useState(false);

  // Sync local state from DB when variant first loads
  useEffect(() => {
    if (!variant) return;
    setName(variant.name || "");
    setDescription(variant.description || "");
    setStartDate(variant.startDate || "");
    setEndDate(variant.endDate || "");
    setNotes(variant.notes || "");
    setLabels(variant.labels ?? []);
    setKind(variant.kind ?? "curated");
    setVatRateStr(String(variant.vatRatePercent ?? 10));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant?.id]);

  // Escape key: cancel edit mode or dismiss delete confirmation
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (showDelete) setShowDelete(false);
      else if (editing) handleCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDelete, editing]);

  function enterEdit() {
    if (!variant) return;
    setName(variant.name || "");
    setDescription(variant.description || "");
    setStartDate(variant.startDate || "");
    setEndDate(variant.endDate || "");
    setNotes(variant.notes || "");
    setLabels(variant.labels ?? []);
    setLabelInput("");
    setKind(variant.kind ?? "curated");
    setVatRateStr(String(variant.vatRatePercent ?? 10));
    setEditing(true);
  }

  function handleAddLabel(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (labels.some((l) => l.toLowerCase() === lower)) return; // case-insensitive dedupe
    setLabels([...labels, trimmed]);
    setLabelInput("");
  }

  function handleRemoveLabel(label: string) {
    setLabels(labels.filter((l) => l !== label));
  }

  const fromSuffix = from ? `?from=${from}` : "";

  function handleCancel() {
    setEditing(false);
    if (isNew) router.replace(`/variants/${encodeURIComponent(variantId)}${fromSuffix}`);
  }

  async function handleSave() {
    if (!variant?.id || !name.trim() || !startDate) return;
    const vatN = parseFloat(vatRateStr);
    await saveVariant({
      ...variant,
      id: variant.id,
      name: name.trim(),
      description: description.trim() || undefined,
      startDate,
      endDate: endDate || undefined,
      notes: notes.trim() || undefined,
      labels,
      kind,
      vatRatePercent: Number.isFinite(vatN) && vatN >= 0 ? vatN : 10,
    });
    setSavedOnce(true);
    setEditing(false);
    if (isNew) router.replace(`/variants/${encodeURIComponent(variantId)}${fromSuffix}`);
  }

  async function handleDelete() {
    if (!variant?.id) return;
    await deleteVariant(variant.id);
    router.replace(backHref);
  }

  async function handleAddProduct(productId: string) {
    await addProductToVariant(variantId, productId);
    setProductSearch("");
  }

  async function handleRemoveProduct(variantProductId: string) {
    await removeProductFromVariant(variantProductId);
    setPendingRemove(null);
  }

  /** Record a pricing snapshot for a given packaging + sell price using current avg cost */
  async function recordPricingSnapshot(
    packagingId: string,
    sellPrice: number,
    triggerType: VariantPricingSnapshot["triggerType"],
    triggerDetail: string,
  ) {
    if (!avgCost) return;
    const pkg = packagingMap.get(packagingId);
    const orders = ordersByPackaging.get(packagingId) ?? [];
    const packagingUnitCost = latestPackagingUnitCost(orders) ?? 0;
    // Don't record when packaging has no cost data — the snapshot would be meaningless
    if (packagingUnitCost === 0) return;
    const capacity = pkg?.capacity ?? 0;
    const pricing = calculateBoxPricing(avgCost.avg, capacity, packagingUnitCost, sellPrice);
    await saveVariantPricingSnapshot({
      variantId,
      packagingId,
      avgProductCost: avgCost.avg,
      packagingUnitCost,
      totalCost: pricing.totalCost,
      sellPrice,
      marginPercent: pricing.marginPercent,
      recordedAt: new Date(),
      triggerType,
      triggerDetail,
    });
  }

  async function handleAddBox() {
    if (!selectedPackagingId || !sellPriceStr) return;
    const price = parseFloat(sellPriceStr);
    if (isNaN(price) || price < 0) return;

    // Curated kind enforces: composition qtys sum to capacity.
    const pkg = packagingMap.get(selectedPackagingId);
    const capacity = pkg?.capacity ?? 0;
    const compSum = newBoxComposition.reduce((s, x) => s + x.qty, 0);
    if (kind === "curated" && compSum !== capacity) {
      alert(`Curated box composition must sum to ${capacity} (packaging capacity). Currently: ${compSum}.`);
      return;
    }

    // Build sparse channel overrides map from the 4 inputs.
    const channelPrices: Partial<Record<OrderChannel, number>> = {};
    const pushChannel = (c: OrderChannel, raw: string) => {
      if (!raw.trim()) return;
      const n = parseFloat(raw);
      if (Number.isFinite(n) && n >= 0) channelPrices[c] = n;
    };
    pushChannel("b2b", channelPriceB2B);
    pushChannel("shop", channelPriceShop);
    pushChannel("event", channelPriceEvent);
    pushChannel("online", channelPriceOnline);

    const newVpId = await saveVariantPackaging({
      variantId,
      packagingId: selectedPackagingId,
      price,
      channelPrices,
      sellPrice: price, // mirror for legacy consumers
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    if (kind === "curated" && newBoxComposition.length > 0) {
      await replaceVariantPackagingProducts(
        newVpId,
        newBoxComposition.map((x, i) => ({ ...x, sortOrder: i })),
      );
    }

    await recordPricingSnapshot(selectedPackagingId, price, "sell_price_change", `Box pricing configured at ${formatPrice(price, sym)}`);
    setSelectedPackagingId("");
    setSellPriceStr("");
    setChannelPriceB2B("");
    setChannelPriceShop("");
    setChannelPriceEvent("");
    setChannelPriceOnline("");
    setNewBoxComposition([]);
    setShowAddBox(false);
  }

  async function handleUpdateSellPrice(cpId: string) {
    const price = parseFloat(editSellPriceStr);
    if (isNaN(price) || price < 0) return;
    const existing = variantPackagings.find((cp) => cp.id === cpId);
    if (!existing) return;
    await saveVariantPackaging({ ...existing, id: cpId, sellPrice: price });
    await recordPricingSnapshot(existing.packagingId, price, "sell_price_change", `Sell price updated to ${formatPrice(price, sym)}`);
    setEditingSellPrice(null);
    setEditSellPriceStr("");
  }

  async function handleRecalculate(cp: { id?: string; packagingId: string; sellPrice: number }) {
    await recordPricingSnapshot(cp.packagingId, cp.sellPrice, "manual", "Manual recalculation");
  }

  async function handleRemoveBox(cpId: string) {
    await deleteVariantPackaging(cpId);
    setPendingRemoveBox(null);
  }

  const productIdSet = useMemo(
    () => new Set(variantProducts.map((cr) => cr.productId)),
    [variantProducts]
  );

  const availableProducts = useMemo(() => {
    const q = productSearch.toLowerCase();
    return allProducts.filter(
      (r) => !r.archived && !productIdSet.has(r.id ?? "") && (!q || r.name.toLowerCase().includes(q))
    );
  }, [allProducts, productIdSet, productSearch]);

  const productMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of allProducts) if (r.id) m.set(r.id, r.name);
    return m;
  }, [allProducts]);

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

  // Group pricing history snapshots by packagingId (already newest-first from hook)
  const snapshotsByPackaging = useMemo(() => {
    const m = new Map<string, VariantPricingSnapshot[]>();
    for (const s of allPricingSnapshots) {
      const arr = m.get(s.packagingId) ?? [];
      arr.push(s);
      m.set(s.packagingId, arr);
    }
    return m;
  }, [allPricingSnapshots]);

  // Average product cost for this variant
  const productCosts: ProductCostEntry[] = useMemo(() => {
    const entries: ProductCostEntry[] = [];
    for (const rid of productIds) {
      const snap = productCostMap.get(rid);
      if (snap) entries.push({ productId: rid, costPerProduct: snap.costPerProduct });
    }
    return entries;
  }, [productIds, productCostMap]);

  const avgCost = useMemo(() => averageProductCost(productCosts), [productCosts]);

  // Box pricing for each configured packaging
  const boxPricings = useMemo(() => {
    if (!avgCost) return [];
    return variantPackagings.map((cp) => {
      const pkg = packagingMap.get(cp.packagingId);
      const orders = ordersByPackaging.get(cp.packagingId) ?? [];
      const unitCost = latestPackagingUnitCost(orders) ?? 0;
      const capacity = pkg?.capacity ?? 0;
      const pricing = calculateBoxPricing(avgCost.avg, capacity, unitCost, cp.sellPrice);
      const health = marginHealth(pricing.marginPercent);
      return { cp, pkg, pricing, health, unitCost };
    });
  }, [avgCost, variantPackagings, packagingMap, ordersByPackaging]);

  // Packaging already added (to exclude from dropdown)
  const usedPackagingIds = useMemo(
    () => new Set(variantPackagings.map((cp) => cp.packagingId)),
    [variantPackagings]
  );

  const [savedOnce, setSavedOnce] = useState(false);
  const formDirty = editing && variant != null && (
    name !== (variant.name || "") ||
    description !== (variant.description || "") ||
    startDate !== (variant.startDate || "") ||
    endDate !== (variant.endDate || "") ||
    notes !== (variant.notes || "") ||
    kind !== (variant.kind ?? "curated") ||
    vatRateStr !== String(variant.vatRatePercent ?? 10) ||
    JSON.stringify([...labels].map((l) => l.toLowerCase()).sort()) !==
      JSON.stringify([...(variant.labels ?? [])].map((l) => l.toLowerCase()).sort())
  );
  const isDirty = (isNew && !savedOnce) || formDirty;

  const handleConfirmLeave = useCallback(async () => {
    if (isNew && variant?.id) {
      await deleteVariant(variant.id);
    }
  }, [isNew, variant?.id]);

  useNavigationGuard(isDirty, isNew ? handleConfirmLeave : undefined);

  if (variant === undefined) {
    return <div className="p-6 text-muted-foreground text-sm">Loading...</div>;
  }
  if (variant === null) {
    return <div className="p-6 text-muted-foreground text-sm">Variant not found.</div>;
  }

  const status = getStatus(variant.startDate, variant.endDate);

  return (
    <div>
      {/* Back */}
      <div className="px-4 pt-6 pb-2">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft aria-hidden="true" className="w-4 h-4" /> {backLabel}
        </Link>
      </div>

      <div className="px-4 space-y-6 pb-10">
        {/* Name row + edit button */}
        <div className="flex items-start justify-between gap-2">
          <InlineNameEditor
            name={variant.name}
            onSave={async (n) => { await saveVariant({ ...variant, name: n }); }}
            className="text-xl font-bold"
          />
          {!editing && (
            <button
              onClick={enterEdit}
              className="p-1.5 rounded-full hover:bg-muted transition-colors shrink-0"
              aria-label="Edit variant"
            >
              <Pencil className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Edit form */}
        {editing ? (
          <section className="space-y-3">
            <div>
              <label className="label">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus={isNew}
                className="input"
                placeholder="Variant name"
              />
            </div>
            <div>
              <label className="label">Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="input"
                placeholder="e.g. Easter 2026 gift box selection"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Start date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                  className="input"
                />
              </div>
              <div>
                <label className="label">End date <span className="text-muted-foreground font-normal">(optional)</span></label>
                <div className="relative">
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="input pr-8"
                    min={startDate}
                  />
                  {endDate && (
                    <button
                      type="button"
                      onClick={() => setEndDate("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label="Clear end date"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {!endDate && <p className="text-xs text-muted-foreground mt-1">No end date = ongoing standard range</p>}
              </div>
            </div>
            <div>
              <label className="label">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="input min-h-[72px] resize-none"
                placeholder="Internal notes..."
              />
            </div>

            <div>
              <label className="label">Kind</label>
              <div className="flex gap-2">
                <label className={`flex-1 rounded-lg border px-3 py-2 cursor-pointer text-sm transition-colors ${kind === "curated" ? "border-primary bg-primary/5 text-primary font-medium" : "border-border text-muted-foreground hover:bg-muted"}`}>
                  <input
                    type="radio"
                    name="variant-kind"
                    value="curated"
                    checked={kind === "curated"}
                    onChange={() => setKind("curated")}
                    className="sr-only"
                  />
                  Curated
                  <span className="block text-[11px] font-normal mt-0.5">
                    Fixed products per size. Locked on orders.
                  </span>
                </label>
                <label className={`flex-1 rounded-lg border px-3 py-2 cursor-pointer text-sm transition-colors ${kind === "free-pick" ? "border-primary bg-primary/5 text-primary font-medium" : "border-border text-muted-foreground hover:bg-muted"}`}>
                  <input
                    type="radio"
                    name="variant-kind"
                    value="free-pick"
                    checked={kind === "free-pick"}
                    onChange={() => setKind("free-pick")}
                    className="sr-only"
                  />
                  Free pick
                  <span className="block text-[11px] font-normal mt-0.5">
                    User picks products on each order.
                  </span>
                </label>
              </div>
            </div>

            <div>
              <label className="label">VAT rate (%)</label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={vatRateStr}
                onChange={(e) => setVatRateStr(e.target.value)}
                className="input"
                placeholder="10"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Prices entered below are gross; net is derived from this rate.
              </p>
            </div>

            <div>
              <label className="label">Label</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {labels.map((label) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium"
                  >
                    {label}
                    <button
                      type="button"
                      onClick={() => handleRemoveLabel(label)}
                      aria-label={`Remove label ${label}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  list="variant-label-suggestions"
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddLabel(labelInput); } }}
                  placeholder="Add label (e.g. B2B, standard)"
                  className="input"
                />
                {knownLabels.length > 0 && (
                  <datalist id="variant-label-suggestions">
                    {knownLabels
                      .filter((t) => !labels.some((l) => l.toLowerCase() === t.toLowerCase()))
                      .map((t) => (
                        <option key={t} value={t} />
                      ))}
                  </datalist>
                )}
                <button
                  type="button"
                  onClick={() => handleAddLabel(labelInput)}
                  disabled={!labelInput.trim()}
                  className="btn-primary px-3 py-1.5"
                >
                  Add
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Labels group this variant into Collections. Case-insensitive — &quot;B2B&quot; and &quot;b2b&quot; are the same label.
              </p>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSave}
                disabled={!name.trim() || !startDate}
                className="btn-primary px-4 py-2 disabled:opacity-40"
              >
                Save
              </button>
              <button onClick={handleCancel} className="btn-secondary px-4 py-2">
                Cancel
              </button>
            </div>
          </section>
        ) : (
          /* View mode */
          <section className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS_CLASS[status]}`}>
                {STATUS_LABEL[status]}
              </span>
              <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
                {variant.kind ?? "curated"}
              </span>
              <span className="text-[11px] text-muted-foreground">
                VAT {variant.vatRatePercent ?? 10}%
              </span>
            </div>
            {variant.description && (
              <p className="text-sm text-muted-foreground">{variant.description}</p>
            )}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">From</span>
              <span className="font-medium">{formatDate(variant.startDate)}</span>
              {variant.endDate ? (
                <>
                  <span className="text-muted-foreground">&rarr;</span>
                  <span className="font-medium">{formatDate(variant.endDate)}</span>
                </>
              ) : (
                <span className="text-muted-foreground">&middot; no end date</span>
              )}
            </div>
            {variant.notes && (
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">{variant.notes}</p>
            )}
            {(variant.labels ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {(variant.labels ?? []).map((label) => (
                  <Link
                    key={label}
                    href={`/collections/${encodeURIComponent(label.toLowerCase())}`}
                    className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium hover:bg-primary/20 transition-colors"
                  >
                    {label}
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Products */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-primary">
              Products <span className="text-xs font-normal text-muted-foreground">({variantProducts.length})</span>
            </h2>
            {editing && (
              <button
                onClick={() => setShowAddProduct((v) => !v)}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Plus className="w-3.5 h-3.5" /> Add product
              </button>
            )}
          </div>

          {editing && showAddProduct && (
            <div className="rounded-lg border border-border bg-card p-3 mb-3 space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Search products to add..."
                  autoFocus
                  className="input !pl-9"
                />
              </div>
              {availableProducts.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2 text-center">
                  {allProducts.length === 0 ? "No products in library yet." : "All products already added."}
                </p>
              ) : (
                <ul className="space-y-1 max-h-52 overflow-y-auto">
                  {availableProducts.map((r) => (
                    <li key={r.id}>
                      <button
                        onClick={() => handleAddProduct(r.id ?? "")}
                        className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-muted transition-colors"
                      >
                        {r.name}
                        {r.productCategoryId && productCategoryMap.get(r.productCategoryId) && (
                          <span className="ml-1.5 text-xs text-muted-foreground capitalize">
                            {productCategoryMap.get(r.productCategoryId)!.name}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                onClick={() => { setShowAddProduct(false); setProductSearch(""); }}
                className="text-xs text-muted-foreground hover:underline"
              >
                Done
              </button>
            </div>
          )}

          {variantProducts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border rounded-lg">
              {editing ? 'No products yet \u2014 use "Add product" above.' : "No products in this variant."}
            </p>
          ) : (
            <ul className="space-y-2">
              {variantProducts.map((cr) => {
                const snap = productCostMap.get(cr.productId);
                return (
                  <li key={cr.id} className="rounded-lg border border-border bg-card flex items-center gap-2 px-3 py-2.5">
                    <Link
                      href={`/products/${encodeURIComponent(cr.productId)}`}
                      className="flex-1 min-w-0 text-sm font-medium truncate hover:underline"
                    >
                      {productMap.get(cr.productId) ?? cr.productId}
                    </Link>
                    {snap && (
                      <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                        {formatPrice(snap.costPerProduct, sym)}/pc
                      </span>
                    )}
                    {editing && (
                      pendingRemove === cr.id ? (
                        <span className="flex items-center gap-1.5 text-xs shrink-0">
                          <span className="text-muted-foreground">Remove?</span>
                          <button
                            onClick={() => handleRemoveProduct(cr.id ?? "")}
                            className="text-red-600 font-medium hover:underline"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setPendingRemove(null)}
                            className="text-muted-foreground hover:underline"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setPendingRemove(cr.id ?? "")}
                          className="text-muted-foreground/40 hover:text-muted-foreground shrink-0"
                          aria-label="Remove product from variant"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Per-product cost summary */}
          {avgCost && productCosts.length > 0 && (
            <div className="mt-3 rounded-lg bg-muted/50 px-3 py-2.5 flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">
                Avg. product cost <span className="text-[10px]">({avgCost.count} products with pricing)</span>
              </span>
              <span className="text-sm font-semibold tabular-nums">{formatPrice(avgCost.avg, sym)}</span>
            </div>
          )}
          {productCosts.length > 0 && avgCost && avgCost.count < productIds.length && (
            <p className="text-[11px] text-status-warn mt-1">
              {productIds.length - avgCost.count} product(s) have no cost data yet &mdash; assign a mould and ingredients to include them.
            </p>
          )}
        </section>

        {/* ═══════════════════════════════════════════════════════════════
            Nutrition & Ingredients
           ═══════════════════════════════════════════════════════════════ */}
        {productIds.length > 0 && (
          <VariantNutritionSection productIds={productIds} />
        )}

        {/* ═══════════════════════════════════════════════════════════════
            Pricing & Margins
           ═══════════════════════════════════════════════════════════════ */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-primary">
              Pricing &amp; Margins
            </h2>
            <button
              onClick={() => setShowAddBox((v) => !v)}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <Plus className="w-3.5 h-3.5" /> Add box
            </button>
          </div>

          {/* Add box form */}
          {showAddBox && (() => {
            const pkgForForm = selectedPackagingId ? packagingMap.get(selectedPackagingId) : undefined;
            const capacityForForm = pkgForForm?.capacity ?? 0;
            const compSum = newBoxComposition.reduce((s, x) => s + x.qty, 0);
            const compValid = kind !== "curated" || (capacityForForm > 0 && compSum === capacityForForm);
            const vatN = parseFloat(vatRateStr) || 0;
            const priceGross = parseFloat(sellPriceStr);
            const priceNet = Number.isFinite(priceGross) && vatN >= 0
              ? priceGross / (1 + vatN / 100)
              : null;
            return (
            <div className="rounded-lg border border-border bg-card p-3 mb-3 space-y-3">
              <div>
                <label className="label">Packaging</label>
                <select
                  value={selectedPackagingId}
                  onChange={(e) => {
                    setSelectedPackagingId(e.target.value);
                    setNewBoxComposition([]); // reset composition on packaging change
                  }}
                  className="input"
                >
                  <option value="">Select packaging...</option>
                  {allPackaging
                    .filter((p) => p.id && !usedPackagingIds.has(p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.capacity} pcs)
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="label">Default price (gross, VAT-incl)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">&euro;</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={sellPriceStr}
                    onChange={(e) => setSellPriceStr(e.target.value)}
                    className="input !pl-7"
                    placeholder="24.95"
                  />
                </div>
                {priceNet !== null && priceNet > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Net at {vatN}% VAT: {formatPrice(priceNet, sym)}
                  </p>
                )}
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">
                  Per-Type prices <span className="font-normal">(leave blank to use default)</span>
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {ORDER_CHANNELS.map((c) => {
                    const val =
                      c === "b2b"    ? channelPriceB2B :
                      c === "shop"   ? channelPriceShop :
                      c === "event"  ? channelPriceEvent :
                                       channelPriceOnline;
                    const setter =
                      c === "b2b"    ? setChannelPriceB2B :
                      c === "shop"   ? setChannelPriceShop :
                      c === "event"  ? setChannelPriceEvent :
                                       setChannelPriceOnline;
                    return (
                      <div key={c}>
                        <label className="text-[11px] text-muted-foreground">
                          {ORDER_CHANNEL_LABELS[c]}
                        </label>
                        <div className="relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">&euro;</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={val}
                            onChange={(e) => setter(e.target.value)}
                            className="input text-sm !pl-6 py-1.5"
                            placeholder="—"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {kind === "curated" && selectedPackagingId && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">
                    Box composition
                    <span className="font-normal ml-1">
                      ({compSum}/{capacityForForm} pieces)
                    </span>
                  </p>
                  {newBoxComposition.map((line, idx) => (
                    <div key={idx} className="flex items-center gap-2 mb-1.5">
                      <select
                        value={line.productId}
                        onChange={(e) => {
                          const next = [...newBoxComposition];
                          next[idx] = { ...next[idx], productId: e.target.value };
                          setNewBoxComposition(next);
                        }}
                        className="input flex-1 text-sm py-1.5"
                      >
                        <option value="">Select product...</option>
                        {allProducts.filter((p) => !p.archived).map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="1"
                        value={line.qty}
                        onChange={(e) => {
                          const next = [...newBoxComposition];
                          next[idx] = { ...next[idx], qty: parseInt(e.target.value) || 0 };
                          setNewBoxComposition(next);
                        }}
                        className="input w-16 text-sm py-1.5"
                      />
                      <button
                        type="button"
                        onClick={() => setNewBoxComposition(newBoxComposition.filter((_, i) => i !== idx))}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Remove product from box"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setNewBoxComposition([...newBoxComposition, { productId: "", qty: 1 }])}
                    className="text-xs text-primary hover:underline"
                  >
                    <Plus className="w-3 h-3 inline" /> Add product
                  </button>
                  {!compValid && compSum !== 0 && (
                    <p className="text-[11px] text-status-warn mt-1">
                      Must sum to {capacityForForm} pieces (currently {compSum}).
                    </p>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleAddBox}
                  disabled={!selectedPackagingId || !sellPriceStr || !compValid}
                  className="btn-primary px-3 py-1.5 text-sm disabled:opacity-40"
                >
                  Add
                </button>
                <button
                  onClick={() => {
                    setShowAddBox(false);
                    setSelectedPackagingId("");
                    setSellPriceStr("");
                    setChannelPriceB2B("");
                    setChannelPriceShop("");
                    setChannelPriceEvent("");
                    setChannelPriceOnline("");
                    setNewBoxComposition([]);
                  }}
                  className="btn-secondary px-3 py-1.5 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
            );
          })()}

          {hasMissingIngredientPricing && (
            <div className="flex items-start gap-2 rounded-md bg-status-warn-bg border border-status-warn-edge px-3 py-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-status-warn shrink-0 mt-0.5" />
              <p className="text-xs text-status-warn">
                Some ingredients in this variant&apos;s products have no pricing data — margin calculations may be understated. Check individual product cost tabs.
              </p>
            </div>
          )}

          {variantPackagings.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center border border-dashed border-border rounded-lg space-y-1">
              <p>No box pricing configured yet.</p>
              <p className="text-xs">Add a box to see cost breakdowns and margins.</p>
            </div>
          ) : !avgCost ? (
            <div className="text-sm text-muted-foreground py-6 text-center border border-dashed border-border rounded-lg space-y-1">
              <p>No product cost data available.</p>
              <p className="text-xs">Ensure products have a default mould and costed ingredients.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {boxPricings.map(({ cp, pkg, pricing, health, unitCost }) => {
                const cpId = cp.id ?? "";
                // Only show snapshots where packaging was actually priced — filter out initialisation entries
                const history = (snapshotsByPackaging.get(cp.packagingId) ?? []).filter((s) => s.packagingUnitCost > 0);
                return (
                  <div key={cpId}>
                    <BoxCard
                      packagingName={pkg?.name ?? "Unknown"}
                      capacity={pkg?.capacity ?? 0}
                      pricing={pricing}
                      health={health}
                      packagingUnitCost={unitCost}
                      history={history}
                      historyExpanded={expandedHistory.has(cpId)}
                      onToggleHistory={() => setExpandedHistory((prev) => {
                        const next = new Set(prev);
                        next.has(cpId) ? next.delete(cpId) : next.add(cpId);
                        return next;
                      })}
                      isEditingSellPrice={editingSellPrice === cpId}
                      editSellPriceStr={editSellPriceStr}
                      pendingRemove={pendingRemoveBox === cpId}
                      onStartEditSellPrice={() => {
                        setEditingSellPrice(cpId);
                        setEditSellPriceStr(String(cp.sellPrice));
                      }}
                      onEditSellPriceChange={setEditSellPriceStr}
                      onSaveSellPrice={() => handleUpdateSellPrice(cpId)}
                      onCancelEditSellPrice={() => setEditingSellPrice(null)}
                      onStartRemove={() => setPendingRemoveBox(cpId)}
                      onConfirmRemove={() => handleRemoveBox(cpId)}
                      onCancelRemove={() => setPendingRemoveBox(null)}
                      onRecalculate={() => handleRecalculate(cp)}
                      sym={sym}
                    />
                    <BoxExtras
                      variantPackagingId={cpId}
                      kind={variant?.kind ?? "curated"}
                      channelPrices={cp.channelPrices ?? {}}
                      defaultPrice={cp.price ?? cp.sellPrice}
                      productMap={productMap}
                      sym={sym}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* Link to full pricing overview */}
          {variantPackagings.length > 0 && (
            <div className="mt-3">
              <Link
                href="/pricing"
                className="text-xs text-primary hover:underline"
              >
                Compare across all variants &rarr;
              </Link>
            </div>
          )}
        </section>

        {/* Delete */}
        <section className="pt-4 border-t border-border">
          {!showDelete ? (
            <button
              onClick={() => setShowDelete(true)}
              className="flex items-center gap-2 text-sm text-destructive hover:underline"
            >
              <Trash2 className="w-4 h-4" /> Delete variant
            </button>
          ) : (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
              <p className="text-sm font-medium text-destructive">Delete this variant?</p>
              <p className="text-xs text-muted-foreground">
                This removes the variant, its product list, and box pricing. The products themselves are not affected.
              </p>
              <div className="flex gap-2">
                <button onClick={handleDelete} className="btn-destructive px-4 py-2 text-sm">
                  Yes, delete
                </button>
                <button onClick={() => setShowDelete(false)} className="btn-secondary px-4 py-2 text-sm">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/* ─── Box pricing card ─── */

/* ─── Per-box channel prices + curated composition (view mode) ─── */

function BoxExtras({
  variantPackagingId,
  kind,
  channelPrices,
  defaultPrice,
  productMap,
  sym,
}: {
  variantPackagingId: string;
  kind: VariantKind;
  channelPrices: Partial<Record<OrderChannel, number>>;
  defaultPrice: number;
  productMap: Map<string, string>;
  sym: string;
}) {
  const composition = useVariantPackagingProducts(variantPackagingId);
  const overrides = ORDER_CHANNELS
    .map((c) => ({ c, price: channelPrices[c] }))
    .filter((x) => x.price != null);

  if (overrides.length === 0 && (kind === "free-pick" || composition.length === 0)) {
    return null;
  }

  return (
    <div className="mt-1 ml-3 pl-3 border-l border-border/40 space-y-1.5 py-1.5">
      {overrides.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/80 mb-0.5">
            Per-Type prices
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {overrides.map(({ c, price }) => (
              <span key={c} className="text-[11px] text-muted-foreground tabular-nums">
                {ORDER_CHANNEL_LABELS[c]}: <span className="font-medium text-foreground">{formatPrice(price!, sym)}</span>
              </span>
            ))}
            <span className="text-[11px] text-muted-foreground/70">
              (default: {formatPrice(defaultPrice, sym)})
            </span>
          </div>
        </div>
      )}
      {kind === "curated" && composition.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/80 mb-0.5">
            Composition
          </p>
          <ul className="flex flex-wrap gap-1">
            {composition.map((vpp) => (
              <li key={vpp.id} className="text-[11px] rounded-full bg-muted text-foreground px-2 py-0.5">
                {productMap.get(vpp.productId) ?? vpp.productId} &times; {vpp.qty}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const TRIGGER_LABELS: Record<VariantPricingSnapshot["triggerType"], string> = {
  sell_price_change: "Sell price",
  ingredient_price: "Ingredient cost",
  coating_change: "Coating change",
  packaging_cost: "Packaging cost",
  manual: "Recalculated",
};

const TRIGGER_COLORS: Record<VariantPricingSnapshot["triggerType"], string> = {
  sell_price_change: "bg-primary/80",
  ingredient_price: "bg-status-warn-edge",
  coating_change: "bg-purple-400",
  packaging_cost: "bg-blue-400",
  manual: "bg-muted-foreground/40",
};

function BoxCard({
  packagingName,
  capacity,
  pricing,
  health,
  packagingUnitCost,
  history,
  historyExpanded,
  onToggleHistory,
  isEditingSellPrice,
  editSellPriceStr,
  pendingRemove,
  onStartEditSellPrice,
  onEditSellPriceChange,
  onSaveSellPrice,
  onCancelEditSellPrice,
  onStartRemove,
  onConfirmRemove,
  onCancelRemove,
  onRecalculate,
  sym = "€",
}: {
  packagingName: string;
  capacity: number;
  pricing: BoxPricingResult;
  health: MarginHealth;
  packagingUnitCost: number;
  history: VariantPricingSnapshot[];
  historyExpanded: boolean;
  onToggleHistory: () => void;
  isEditingSellPrice: boolean;
  sym?: string;
  editSellPriceStr: string;
  pendingRemove: boolean;
  onStartEditSellPrice: () => void;
  onEditSellPriceChange: (v: string) => void;
  onSaveSellPrice: () => void;
  onCancelEditSellPrice: () => void;
  onStartRemove: () => void;
  onConfirmRemove: () => void;
  onCancelRemove: () => void;
  onRecalculate: () => void;
}) {
  const colors = MARGIN_COLORS[health];
  const barWidth = Math.min(Math.max(pricing.marginPercent, 0), 100);

  // Build sparkline from history (oldest→newest for left-to-right trend)
  const chartData = [...history].reverse();
  const margins = chartData.map((s) => s.marginPercent);
  const minM = margins.length > 1 ? Math.min(...margins) : 0;
  const maxM = margins.length > 1 ? Math.max(...margins) : 100;
  const rangeM = maxM - minM || 10;
  const chartW = 120;
  const chartH = 32;
  const pad = 2;

  function toX(i: number) {
    return margins.length === 1
      ? chartW / 2
      : pad + (i / (margins.length - 1)) * (chartW - pad * 2);
  }
  function toY(m: number) {
    return chartH - pad - ((m - minM) / rangeM) * (chartH - pad * 2);
  }

  const points = margins.map((m, i) => `${toX(i).toFixed(1)},${toY(m).toFixed(1)}`).join(" ");

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold">{packagingName}</p>
          <p className="text-[11px] text-muted-foreground">{capacity} products per box</p>
        </div>
        <div className="flex items-center gap-1.5">
          {pendingRemove ? (
            <span className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Remove?</span>
              <button onClick={onConfirmRemove} className="text-red-600 font-medium hover:underline">Yes</button>
              <button onClick={onCancelRemove} className="text-muted-foreground hover:underline">Cancel</button>
            </span>
          ) : (
            <button
              onClick={onStartRemove}
              className="text-muted-foreground/40 hover:text-muted-foreground"
              aria-label="Remove box configuration"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Cost breakdown */}
      <div className="px-3 pb-2 space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">{capacity} products &times; {formatPrice(pricing.productCost / (capacity || 1), sym)}</span>
          <span className="tabular-nums">{formatPrice(pricing.productCost, sym)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Packaging</span>
          <span className="tabular-nums">{formatPrice(packagingUnitCost, sym)}</span>
        </div>
        <div className="flex justify-between text-xs font-medium border-t border-border/50 pt-1">
          <span>Total cost</span>
          <span className="tabular-nums">{formatPrice(pricing.totalCost, sym)}</span>
        </div>
      </div>

      {/* Sell price + margin */}
      <div className={`px-3 py-2.5 ${colors.bg} border-t border-border/30`}>
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium">Sell price</span>
            {isEditingSellPrice ? (
              <span className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">{sym}</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editSellPriceStr}
                  onChange={(e) => onEditSellPriceChange(e.target.value)}
                  onBlur={onSaveSellPrice}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onSaveSellPrice();
                    if (e.key === "Escape") onCancelEditSellPrice();
                  }}
                  autoFocus
                  className="w-20 text-xs px-1.5 py-0.5 rounded border border-border bg-card"
                />
              </span>
            ) : (
              <button
                onClick={onStartEditSellPrice}
                className="text-xs font-semibold tabular-nums hover:underline"
              >
                {formatPrice(pricing.sellPrice, sym)}
              </button>
            )}
          </div>
          <span className={`text-xs font-bold tabular-nums ${colors.text}`}>
            {formatMarginPercent(pricing.marginPercent)} margin
          </span>
        </div>

        {/* Margin bar */}
        <div className="h-1.5 rounded-full bg-black/5 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${colors.bar}`}
            style={{ width: `${barWidth}%` }}
          />
        </div>

        <div className="flex justify-between mt-1.5">
          <span className={`text-[11px] ${colors.text}`}>
            {formatPrice(pricing.marginAbsolute, sym)} per box
          </span>
          <span className="text-[11px] text-muted-foreground">
            {formatPrice(pricing.marginAbsolute / (capacity || 1), sym)} per product
          </span>
        </div>
      </div>

      {/* Pricing history */}
      <div className="border-t border-border/40">
        <div className="flex items-center px-3 py-2 text-[11px] text-muted-foreground hover:bg-muted/30 transition-colors">
          <button
            onClick={onToggleHistory}
            className="flex-1 flex items-center gap-1.5 hover:text-foreground text-left"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${historyExpanded ? "" : "-rotate-90"}`} />
            Pricing history
            {history.length > 0 && <span className="opacity-60">({history.length})</span>}
          </button>
          {history.length === 0 ? (
            packagingUnitCost > 0 ? (
              <button
                onClick={onRecalculate}
                className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                title="Record current margin as first snapshot"
              >
                <RefreshCw className="w-2.5 h-2.5" /> Record
              </button>
            ) : null
          ) : (
            <button
              onClick={onRecalculate}
              className="flex items-center gap-1 text-[11px] hover:text-foreground"
              title="Record current margin as a new snapshot"
            >
              <RefreshCw className="w-2.5 h-2.5" />
            </button>
          )}
        </div>

        {historyExpanded && history.length > 0 && (
          <div className="px-3 pb-3 space-y-3">
            {/* Sparkline */}
            {margins.length > 1 && (
              <div className="flex items-center gap-2">
                <svg width={chartW} height={chartH} className="shrink-0">
                  <polyline
                    points={points}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className="text-primary/60"
                  />
                  {margins.map((m, i) => {
                    const h = marginHealth(m);
                    const dotColor = h === "healthy" ? "#10b981" : h === "thin" ? "#f59e0b" : "#ef4444";
                    return (
                      <circle key={i} cx={toX(i)} cy={toY(m)} r="2" fill={dotColor} />
                    );
                  })}
                </svg>
                <div className="text-[10px] text-muted-foreground leading-tight">
                  <p>{formatMarginPercent(margins[0])} → {formatMarginPercent(margins[margins.length - 1])}</p>
                  {margins.length > 1 && (() => {
                    const delta = marginDelta(margins[margins.length - 1], margins[0]);
                    return (
                      <p className={delta.improved ? "text-emerald-600" : "text-red-600"}>
                        {delta.label} overall
                      </p>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Event list */}
            <ul className="space-y-1.5">
              {history.map((snap, i) => {
                const prev = history[i + 1];
                const delta = prev ? marginDelta(snap.marginPercent, prev.marginPercent) : null;
                const snapDate = new Date(snap.recordedAt);
                const dateStr = `${snapDate.getDate().toString().padStart(2, "0")}/${(snapDate.getMonth() + 1).toString().padStart(2, "0")}/${snapDate.getFullYear()}`;
                return (
                  <li key={snap.id ?? i} className="flex items-start gap-2 text-[11px]">
                    <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${TRIGGER_COLORS[snap.triggerType]}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-1">
                        <span className="font-medium tabular-nums">{formatMarginPercent(snap.marginPercent)}</span>
                        {delta && (
                          <span className={`tabular-nums ${delta.improved ? "text-emerald-600" : "text-red-600"}`}>
                            {delta.label}
                          </span>
                        )}
                        <span className="text-muted-foreground ml-auto shrink-0">{dateStr}</span>
                      </div>
                      <p className="text-muted-foreground truncate">
                        <span className="font-medium">{TRIGGER_LABELS[snap.triggerType]}</span>
                        {" · "}{snap.triggerDetail}
                      </p>
                      <p className="text-muted-foreground/70">
                        Cost {formatPrice(snap.totalCost, sym)} · Sell {formatPrice(snap.sellPrice, sym)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {historyExpanded && history.length === 0 && (
          <p className="px-3 pb-3 text-[11px] text-muted-foreground">
            {packagingUnitCost === 0
              ? "No pricing history yet — log a packaging order to record the first snapshot."
              : "No history yet — click the refresh icon above to record the current margin."}
          </p>
        )}
      </div>
    </div>
  );
}

/* ─── Nutrition & Ingredients (variant-level rollup) ─── */

function VariantNutritionSection({ productIds }: { productIds: string[] }) {
  const allProducts = useProductsList(true);
  const allIngredients = useIngredients(true);
  const allMoulds = useMouldsList(true);
  const productFillingsMap = useProductFillingsForProducts(productIds);

  const fillingIds = useMemo(() => {
    const set = new Set<string>();
    for (const pid of productIds) {
      for (const pf of productFillingsMap.get(pid) ?? []) set.add(pf.fillingId);
    }
    return [...set];
  }, [productIds, productFillingsMap]);
  const fillingIngredientsMap = useFillingIngredientsForFillings(fillingIds);

  const market = useMarketRegion();

  const ingredientMap = useMemo(
    () => new Map(allIngredients.map((i) => [i.id!, i])),
    [allIngredients],
  );
  const productMap = useMemo(
    () => new Map(allProducts.map((r) => [r.id!, r])),
    [allProducts],
  );
  const mouldMap = useMemo(
    () => new Map(allMoulds.map((m) => [m.id!, m])),
    [allMoulds],
  );

  // Per-product rollup specs — one entry per product in the variant.
  // Products missing a mould are skipped (same guard as the product helper).
  const perProductInputs: ProductIngredientListInput[] = useMemo(() => {
    const inputs: ProductIngredientListInput[] = [];
    for (const pid of productIds) {
      const product = productMap.get(pid);
      if (!product) continue;
      const mould = product.defaultMouldId ? mouldMap.get(product.defaultMouldId) : null;
      if (!mould) continue;
      const productFillings = productFillingsMap.get(pid) ?? [];
      const shellIngredient = product.shellIngredientId ? ingredientMap.get(product.shellIngredientId) ?? null : null;

      let shellPercentage = product.shellPercentage ?? 37;
      if (product.fillMode === "grams") {
        const totalFillGrams = productFillings.reduce((s, pf) => s + (pf.fillGrams ?? 0), 0);
        shellPercentage = deriveShellPercentageFromGrams(mould.cavityWeightG, totalFillGrams, DENSITY_G_PER_ML);
      }

      inputs.push({
        mould,
        productFillings,
        fillingIngredientsMap,
        ingredientMap,
        shellIngredient,
        shellPercentage,
        fillMode: product.fillMode,
      });
    }
    return inputs;
  }, [productIds, productMap, mouldMap, ingredientMap, productFillingsMap, fillingIngredientsMap]);

  const perProductNutrition = useMemo(
    () => perProductInputs.map((input) => calculateProductNutrition({
      mould: input.mould ?? null,
      productFillings: input.productFillings,
      fillingIngredientsMap: input.fillingIngredientsMap,
      ingredientMap: input.ingredientMap,
      shellIngredient: input.shellIngredient ?? null,
      shellPercentage: input.shellPercentage,
    })),
    [perProductInputs],
  );

  const variantNutrition = useMemo(
    () => calculateVariantNutrition(perProductNutrition),
    [perProductNutrition],
  );

  const ingredientList = useMemo(
    () => buildVariantIngredientList(perProductInputs),
    [perProductInputs],
  );

  const nutrients = getNutrientsByMarket(market);
  const panelTitle = getNutritionPanelTitle(market);
  const { per100g, totalWeightG, productsWithData, productsTotal } = variantNutrition;
  const hasData = Object.keys(per100g).length > 0;
  const productsWithoutMould = productIds.length - perProductInputs.length;

  return (
    <section>
      <h2 className="text-sm font-semibold text-primary mb-3">Nutrition &amp; Ingredients</h2>

      {productsWithoutMould > 0 && (
        <div className="flex items-start gap-2 text-xs text-amber-700 mb-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            {productsWithoutMould} product(s) have no default mould and are excluded from this rollup.
          </span>
        </div>
      )}

      {hasData && productsWithData < productsTotal && (
        <div className="flex items-start gap-2 text-xs text-amber-700 mb-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            Nutrition data for {productsWithData} of {productsTotal} products. Values are
            partial — add ingredient nutrition to complete the rollup.
          </span>
        </div>
      )}

      {/* Nutrition panel */}
      {hasData ? (
        <>
          <p className="text-xs text-muted-foreground mb-2">
            {panelTitle} · weighted average across products ({totalWeightG.toFixed(0)}g total)
          </p>
          <div className="rounded-lg border border-border bg-card overflow-hidden mb-4">
            <div className="flex items-center px-3 py-2 bg-muted/40 border-b border-border text-xs font-semibold text-muted-foreground">
              <span className="flex-1">Nutrient</span>
              <span className="w-24 text-right">Per 100g</span>
            </div>
            {nutrients.map((n) => {
              const val = per100g[n.key];
              return (
                <div
                  key={n.key}
                  className={`flex items-baseline px-3 py-1.5 text-sm border-b border-border last:border-b-0 ${
                    n.indent === 0 ? "font-medium" : "font-normal"
                  }`}
                >
                  <span className={`flex-1 ${n.indent === 1 ? "ml-4 text-muted-foreground" : n.indent === 2 ? "ml-8 text-muted-foreground" : ""}`}>
                    {n.label}
                  </span>
                  <span className={`w-24 text-right ${val == null ? "text-muted-foreground/50" : ""}`}>
                    {formatNutrientValue(val, n.unit)}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground py-3 mb-4">
          No products in this variant have nutrition data yet.
        </p>
      )}

      {/* Ingredient list */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Ingredients list</h3>
        <p className="text-xs text-muted-foreground mb-2">
          Listed in descending order of weight. Allergen-bearing ingredients are shown in bold.
        </p>
        {ingredientList.length > 0 ? (
          <p className="text-sm leading-relaxed">
            {ingredientList.map((entry, i) => (
              <span key={i}>
                {i > 0 ? ", " : ""}
                {entry.allergens.length > 0 ? <strong>{entry.label}</strong> : entry.label}
              </span>
            ))}
            .
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No ingredients yet.</p>
        )}
      </div>
    </section>
  );
}
