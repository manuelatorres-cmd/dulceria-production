"use client";

import { use, useState, useEffect, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useVariant,
  useVariants,
  useVariantProducts,
  useVariantPackagings,
  useVariantPackagingProducts,
  useAllVariantPackagingProducts,
  useVariantPricingSnapshots,
  useAllVariantLabels,
  saveVariant,
  deleteVariant,
  duplicateVariant,
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
  useVariantStockLocations,
  setVariantStockOnHand,
} from "@/lib/hooks";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import { deriveShellPercentageFromGrams } from "@/lib/costCalculation";
import { DENSITY_G_PER_ML } from "@/lib/production";
import { calculateProductNutrition, calculateVariantNutrition, getNutrientsByMarket, getNutritionPanelTitle, formatNutrientValue } from "@/lib/nutrition";
import { buildVariantIngredientList, type ProductIngredientListInput } from "@/lib/ingredientList";
import { ShopifyFormatBlock } from "@/components/ShopifyFormatBlock";
import { containsAllergen } from "@/lib/allergenKeywordsDe";
import { IconPlus as Plus, IconSearch as Search, IconX as X, IconTrash as Trash2, IconPencil as Pencil, IconCopy as Copy, IconChevronDown as ChevronDown, IconRefresh as RefreshCw, IconAlertTriangle as AlertTriangle } from "@tabler/icons-react";
import { BackButton } from "@/components/back-button";
import { InlineNameEditor } from "@/components/inline-name-editor";
import { DetailNav } from "@/components/detail-nav";
import { useNavigationGuard } from "@/lib/useNavigationGuard";
import Link from "next/link";
import type { ProductCostSnapshot, Packaging, PackagingOrder, VariantPricingSnapshot, VariantPackaging, Ingredient, VariantKind, OrderChannel } from "@/types";
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
  active: "text-status-ok bg-status-ok-bg",
  upcoming: "text-status-warn bg-status-warn-bg",
  past: "text-muted-foreground bg-muted",
};

const MARGIN_COLORS: Record<MarginHealth, { bar: string; text: string; bg: string }> = {
  healthy: { bar: "bg-status-ok", text: "text-status-ok", bg: "bg-status-ok-bg" },
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
  const allVariants = useVariants();
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
  const [aliases, setAliases] = useState<string[]>([]);
  const [aliasInput, setAliasInput] = useState("");
  const [kind, setKind] = useState<VariantKind>("curated");
  const [vatRateStr, setVatRateStr] = useState("10");

  // Add-box form: channel price overrides (empty string = use default).
  const [channelPriceB2B, setChannelPriceB2B]       = useState("");
  const [channelPriceShop, setChannelPriceShop]     = useState("");
  const [channelPriceEvent, setChannelPriceEvent]   = useState("");
  const [channelPriceOnline, setChannelPriceOnline] = useState("");
  // Curated composition for the box being added: productId -> qty.
  // Rows come from the variant's Products list (one row per variant product);
  // user edits qty per row. Keyed by productId so re-renders don't lose state.
  const [newBoxQtys, setNewBoxQtys] = useState<Record<string, number>>({});

  // When set, the full box-edit form renders in place of that box's
  // normal BoxCard row. Reuses the same state vars (selectedPackagingId,
  // sellPriceStr, channelPrice*, newBoxQtys) — only one of add-mode /
  // edit-mode is active at a time.
  const [editingBoxId, setEditingBoxId] = useState<string | null>(null);
  const allVariantPackagingProducts = useAllVariantPackagingProducts();

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
    setAliases(variant.aliases ?? []);
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
    setAliases(variant.aliases ?? []);
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
      aliases: aliases.length > 0 ? aliases : undefined,
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
    setShowAddProduct(false);
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
    // Loose variant (no packaging) = packagingId left blank. Allowed
    // when channel sales include single-piece counter / market.
    if (!sellPriceStr) return;
    // Accept both "2.50" (en) and "2,50" (de/AT) — strip thousand
    // separators, swap comma for dot before parseFloat.
    const price = parseFloat(sellPriceStr.replace(/\./g, "").replace(",", "."));
    if (isNaN(price) || price < 0) return;
    const isLoose = !selectedPackagingId;

    // Curated: qty rows come from the variant's Products list; sum must
    // equal packaging.capacity. Loose variants skip composition.
    const pkg = isLoose ? undefined : packagingMap.get(selectedPackagingId);
    const capacity = pkg?.capacity ?? 0;
    const compEntries = variantProducts
      .map((vp, i) => ({
        productId: vp.productId,
        qty: newBoxQtys[vp.productId] ?? 0,
        sortOrder: i,
      }))
      .filter((e) => e.qty > 0);
    const compSum = compEntries.reduce((s, x) => s + x.qty, 0);
    if (!isLoose && kind === "curated" && compSum !== capacity) {
      alert(`Box composition must sum to ${capacity} (packaging capacity). Currently: ${compSum}.`);
      return;
    }
    if (isLoose && kind === "curated" && (compEntries.length !== 1 || compEntries[0].qty !== 1)) {
      alert("Pick exactly one product (qty 1) for a loose / single-piece variant size.");
      return;
    }

    // Build sparse channel overrides map from the 4 inputs.
    const channelPrices: Partial<Record<OrderChannel, number>> = {};
    const pushChannel = (c: OrderChannel, raw: string) => {
      if (!raw.trim()) return;
      const n = parseFloat(raw.replace(/\./g, "").replace(",", "."));
      if (Number.isFinite(n) && n >= 0) channelPrices[c] = n;
    };
    pushChannel("b2b", channelPriceB2B);
    pushChannel("shop", channelPriceShop);
    pushChannel("event", channelPriceEvent);
    pushChannel("online", channelPriceOnline);

    const newVpId = await saveVariantPackaging({
      variantId,
      packagingId: isLoose ? null : selectedPackagingId,
      price,
      channelPrices,
      sellPrice: price, // mirror for legacy consumers
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    if (kind === "curated" && compEntries.length > 0) {
      await replaceVariantPackagingProducts(newVpId, compEntries);
    }

    if (!isLoose) {
      await recordPricingSnapshot(selectedPackagingId, price, "sell_price_change", `Box pricing configured at ${formatPrice(price, sym)}`);
    }
    setSelectedPackagingId("");
    setSellPriceStr("");
    setChannelPriceB2B("");
    setChannelPriceShop("");
    setChannelPriceEvent("");
    setChannelPriceOnline("");
    setNewBoxQtys({});
    setShowAddBox(false);
  }

  async function handleUpdateSellPrice(cpId: string) {
    const price = parseFloat(editSellPriceStr.replace(/\./g, "").replace(",", "."));
    if (isNaN(price) || price < 0) return;
    const existing = variantPackagings.find((cp) => cp.id === cpId);
    if (!existing) return;
    // Update BOTH price and sellPrice so the canonical column reflects
    // the new value (display reads price first when positive).
    await saveVariantPackaging({ ...existing, id: cpId, price, sellPrice: price });
    if (existing.packagingId) {
      await recordPricingSnapshot(existing.packagingId, price, "sell_price_change", `Sell price updated to ${formatPrice(price, sym)}`);
    }
    setEditingSellPrice(null);
    setEditSellPriceStr("");
  }

  async function handleRecalculate(cp: { id?: string; packagingId?: string | null; sellPrice: number }) {
    if (!cp.packagingId) return;
    await recordPricingSnapshot(cp.packagingId, cp.sellPrice, "manual", "Manual recalculation");
  }

  async function handleRemoveBox(cpId: string) {
    await deleteVariantPackaging(cpId);
    setPendingRemoveBox(null);
  }

  function handleStartBoxEdit(cp: VariantPackaging) {
    if (!cp.id) return;
    setShowAddBox(false);
    setEditingBoxId(cp.id);
    setSelectedPackagingId(cp.packagingId ?? "");
    setSellPriceStr(String((cp.price && cp.price > 0) ? cp.price : (cp.sellPrice ?? "")));
    const ch = cp.channelPrices ?? {};
    setChannelPriceB2B(   ch.b2b    != null ? String(ch.b2b)    : "");
    setChannelPriceShop(  ch.shop   != null ? String(ch.shop)   : "");
    setChannelPriceEvent( ch.event  != null ? String(ch.event)  : "");
    setChannelPriceOnline(ch.online != null ? String(ch.online) : "");
    const qtys: Record<string, number> = {};
    for (const vpp of allVariantPackagingProducts.filter((x) => x.variantPackagingId === cp.id)) {
      qtys[vpp.productId] = vpp.qty;
    }
    setNewBoxQtys(qtys);
  }

  function handleCancelBoxEdit() {
    setEditingBoxId(null);
    setSelectedPackagingId("");
    setSellPriceStr("");
    setChannelPriceB2B("");
    setChannelPriceShop("");
    setChannelPriceEvent("");
    setChannelPriceOnline("");
    setNewBoxQtys({});
  }

  async function handleSaveBoxEdit() {
    if (!editingBoxId) return;
    const existing = variantPackagings.find((cp) => cp.id === editingBoxId);
    if (!existing) return;

    const price = parseFloat(sellPriceStr.replace(/\./g, "").replace(",", "."));
    if (isNaN(price) || price < 0) return;

    const isLooseEdit = !existing.packagingId;
    const pkg = existing.packagingId ? packagingMap.get(existing.packagingId) : undefined;
    const capacity = pkg?.capacity ?? 0;
    const compEntries = variantProducts
      .map((vp, i) => ({
        productId: vp.productId,
        qty: newBoxQtys[vp.productId] ?? 0,
        sortOrder: i,
      }))
      .filter((e) => e.qty > 0);
    const compSum = compEntries.reduce((s, x) => s + x.qty, 0);
    if (!isLooseEdit && kind === "curated" && compSum !== capacity) {
      alert(`Box composition must sum to ${capacity} (packaging capacity). Currently: ${compSum}.`);
      return;
    }
    if (isLooseEdit && kind === "curated" && (compEntries.length !== 1 || compEntries[0].qty !== 1)) {
      alert("Pick exactly one product (qty 1) for a loose / single-piece variant size.");
      return;
    }

    const channelPrices: Partial<Record<OrderChannel, number>> = {};
    const pushChannel = (c: OrderChannel, raw: string) => {
      if (!raw.trim()) return;
      const n = parseFloat(raw.replace(/\./g, "").replace(",", "."));
      if (Number.isFinite(n) && n >= 0) channelPrices[c] = n;
    };
    pushChannel("b2b", channelPriceB2B);
    pushChannel("shop", channelPriceShop);
    pushChannel("event", channelPriceEvent);
    pushChannel("online", channelPriceOnline);

    await saveVariantPackaging({
      ...existing,
      id: editingBoxId,
      price,
      channelPrices,
      sellPrice: price,
    });

    if (kind === "curated") {
      await replaceVariantPackagingProducts(editingBoxId, compEntries);
    }

    if (price !== (existing.price ?? existing.sellPrice) && existing.packagingId) {
      await recordPricingSnapshot(
        existing.packagingId,
        price,
        "sell_price_change",
        `Sell price updated to ${formatPrice(price, sym)}`,
      );
    }

    handleCancelBoxEdit();
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
      const isLoose = !cp.packagingId;
      const pkg = cp.packagingId ? packagingMap.get(cp.packagingId) : undefined;
      const orders = cp.packagingId ? (ordersByPackaging.get(cp.packagingId) ?? []) : [];
      const unitCost = latestPackagingUnitCost(orders) ?? 0;
      // Loose / single-piece variants have no box capacity — but they
      // still package one product per "unit", so cost math expects
      // capacity = 1 to multiply the avg product cost correctly.
      const capacity = isLoose ? 1 : (pkg?.capacity ?? 0);
      const sellPrice = (cp.price && cp.price > 0) ? cp.price : (cp.sellPrice ?? 0);
      const pricing = calculateBoxPricing(avgCost.avg, capacity, unitCost, sellPrice);
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
      JSON.stringify([...(variant.labels ?? [])].map((l) => l.toLowerCase()).sort()) ||
    JSON.stringify([...aliases].map((l) => l.toLowerCase()).sort()) !==
      JSON.stringify([...(variant.aliases ?? [])].map((l) => l.toLowerCase()).sort())
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
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      {/* Back */}
      <div className="px-4 pt-6 pb-2 space-y-2">
        <BackButton fallbackHref="/variants" fallbackLabel="All variants" onBack={() => router.back()} />
        <DetailNav
          items={[...allVariants].sort((a, b) => a.name.localeCompare(b.name))}
          currentId={variantId}
          hrefFor={(v) => `/variants/${encodeURIComponent(v.id!)}`}
          labelFor={(v) => v.name}
        />
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
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={async () => {
                  if (!variant.id) return;
                  try {
                    const id = await duplicateVariant(variant.id);
                    router.push(`/variants/${encodeURIComponent(id)}?new=1`);
                  } catch (err) {
                    alert(`Duplicate failed: ${err instanceof Error ? err.message : String(err)}`);
                  }
                }}
                className="p-1.5 rounded-full hover:bg-muted transition-colors"
                aria-label="Duplicate variant"
                title="Duplicate this variant — sizes, composition, packaging components all carry over"
              >
                <Copy className="w-4 h-4 text-muted-foreground" />
              </button>
              <button
                onClick={enterEdit}
                className="p-1.5 rounded-full hover:bg-muted transition-colors"
                aria-label="Edit variant"
              >
                <Pencil className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
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
                <label className={`flex-1 rounded-sm border px-3 py-2 cursor-pointer text-sm transition-colors ${kind === "curated" ? "border-primary bg-primary/5 text-primary font-medium" : "border-[color:var(--ds-border-warm)] text-muted-foreground hover:bg-muted"}`}>
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
                <label className={`flex-1 rounded-sm border px-3 py-2 cursor-pointer text-sm transition-colors ${kind === "free-pick" ? "border-primary bg-primary/5 text-primary font-medium" : "border-[color:var(--ds-border-warm)] text-muted-foreground hover:bg-muted"}`}>
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
                    className="inline-flex items-center gap-1 rounded-sm bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium"
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

            {/* Aliases — alt names used by external systems (Shopify, etc.) */}
            <div>
              <label className="label">Aliases · names used externally</label>
              <p className="text-[11px] text-muted-foreground mb-2">
                Shopify storefront title, German label, etc. Importers match these against incoming line items so future imports auto-resolve.
              </p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {aliases.map((a) => (
                  <span
                    key={a}
                    className="inline-flex items-center gap-1 rounded-sm bg-muted text-foreground px-2.5 py-0.5 text-xs"
                  >
                    {a}
                    <button
                      type="button"
                      onClick={() => setAliases(aliases.filter((x) => x !== a))}
                      aria-label={`Remove alias ${a}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={aliasInput}
                  onChange={(e) => setAliasInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const v = aliasInput.trim();
                      if (v && !aliases.some((x) => x.toLowerCase() === v.toLowerCase())) {
                        setAliases([...aliases, v]);
                      }
                      setAliasInput("");
                    }
                  }}
                  placeholder="Add alias (e.g. Custom Box - Standard)"
                  className="input"
                />
                <button
                  type="button"
                  onClick={() => {
                    const v = aliasInput.trim();
                    if (v && !aliases.some((x) => x.toLowerCase() === v.toLowerCase())) {
                      setAliases([...aliases, v]);
                    }
                    setAliasInput("");
                  }}
                  disabled={!aliasInput.trim()}
                  className="btn-primary px-3 py-1.5"
                >
                  Add
                </button>
              </div>
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
              <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-sm bg-muted text-muted-foreground capitalize">
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
                    className="inline-flex items-center rounded-sm bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium hover:bg-primary/20 transition-colors"
                  >
                    {label}
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Products (curated only — free-pick variants pick on each order) */}
        {(variant?.kind ?? "curated") === "curated" && (
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

          {variantProducts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center border border-dashed border-[color:var(--ds-border-warm)] rounded-sm">
              {editing ? 'No products yet \u2014 tap "Add product" to start.' : "No products in this variant."}
            </p>
          ) : (
            <ul className="space-y-2">
              {variantProducts.map((cr) => {
                const snap = productCostMap.get(cr.productId);
                return (
                  <li key={cr.id} className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] flex items-center gap-2 px-3 py-2.5">
                    <Link
                      href={`/products/${encodeURIComponent(cr.productId)}?from=variants&fromId=${encodeURIComponent(variantId)}`}
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
                            className="text-status-alert font-medium hover:underline"
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

          {editing && showAddProduct && (
            <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-3 mt-3 space-y-2">
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
                Cancel
              </button>
            </div>
          )}

          {/* Per-product cost summary */}
          {avgCost && productCosts.length > 0 && (
            <div className="mt-3 rounded-sm bg-muted/50 px-3 py-2.5 flex items-baseline justify-between">
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
        )}

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
            {!editingBoxId && (
              <button
                onClick={() => setShowAddBox((v) => !v)}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Plus className="w-3.5 h-3.5" /> Add box
              </button>
            )}
          </div>

          {/* Add / edit box form */}
          {(showAddBox || editingBoxId) && (() => {
            const isEdit = editingBoxId != null;
            const pkgForForm = selectedPackagingId ? packagingMap.get(selectedPackagingId) : undefined;
            const capacityForForm = pkgForForm?.capacity ?? 0;
            const compSum = variantProducts.reduce(
              (s, vp) => s + (newBoxQtys[vp.productId] ?? 0),
              0,
            );
            const hasVariantProducts = variantProducts.length > 0;
            // Loose variants (no packaging) skip the curated-composition
            // gate entirely — qty is implicitly 1, no box to fill.
            // Curated readiness — for packaged sizes we need composition
            // summing to capacity; for loose sizes we need exactly one
            // product picked with qty=1 so production / cost / stock can
            // still resolve which chocolate the size sells.
            const looseLockedProductId = !selectedPackagingId
              ? Object.entries(newBoxQtys).find(([, q]) => q === 1)?.[0]
              : undefined;
            const curatedReady = kind !== "curated"
              ? true
              : selectedPackagingId
                ? (capacityForForm > 0 && compSum === capacityForForm && hasVariantProducts)
                : (hasVariantProducts && !!looseLockedProductId && compSum === 1);
            const vatN = parseFloat(vatRateStr) || 0;
            const priceGross = parseFloat(sellPriceStr);
            const priceNet = Number.isFinite(priceGross) && vatN >= 0
              ? priceGross / (1 + vatN / 100)
              : null;
            return (
            <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-3 mb-3 space-y-3">
              <div className="text-xs font-semibold text-primary">
                {isEdit ? `Edit ${pkgForForm?.name ?? "box"}` : "Add a new box"}
              </div>
              <div>
                <label className="label">Packaging</label>
                <select
                  value={selectedPackagingId}
                  onChange={(e) => {
                    const next = e.target.value;
                    setSelectedPackagingId(next);
                    // Loose + curated + exactly one variant product →
                    // auto-fill the composition (productId, qty=1) so
                    // the user doesn't have to pick again.
                    if (!next && kind === "curated" && variantProducts.length === 1) {
                      setNewBoxQtys({ [variantProducts[0].productId]: 1 });
                    } else {
                      setNewBoxQtys({});
                    }
                  }}
                  disabled={isEdit}
                  className="input disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <option value="">Loose / no packaging</option>
                  {allPackaging
                    .filter((p) => p.id && (isEdit || !usedPackagingIds.has(p.id)))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.capacity} pcs)
                      </option>
                    ))}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {!selectedPackagingId
                    ? "Sold individually, no box. Just a price for the loose item."
                    : isEdit
                      ? "Packaging can't be changed on an existing box. Remove and re-add to switch."
                      : ""}
                </p>
              </div>
              <div>
                <label className="label">Default price (gross, VAT-incl)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">&euro;</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={sellPriceStr}
                    onChange={(e) => {
                      // Accept "2,50" or "2.50" — keep raw for display,
                      // parsing happens at save with a comma→dot swap.
                      const next = e.target.value;
                      const prev = sellPriceStr;
                      setSellPriceStr(next);
                      const sync = (cur: string, set: (v: string) => void) => {
                        if (cur === "" || cur === prev) set(next);
                      };
                      sync(channelPriceShop, setChannelPriceShop);
                      sync(channelPriceEvent, setChannelPriceEvent);
                      sync(channelPriceOnline, setChannelPriceOnline);
                    }}
                    className="input !pl-7"
                    placeholder="24.95 or 24,95"
                  />
                </div>
                {priceNet !== null && priceNet > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Net at {vatN}% VAT: {formatPrice(priceNet, sym)}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Auto-fills Shop / Event / Online. B2B stays separate.
                </p>
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
                            type="text"
                            inputMode="decimal"
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

              {kind === "curated" && !selectedPackagingId && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">
                    Which chocolate is sold loose?
                  </p>
                  {!hasVariantProducts ? (
                    <p className="text-[11px] text-status-warn border border-dashed border-status-warn-edge rounded-md px-2 py-2">
                      Add at least one product to this variant first (use the <strong>Products</strong> section above).
                    </p>
                  ) : (
                    <select
                      value={looseLockedProductId ?? ""}
                      onChange={(e) => {
                        const pid = e.target.value;
                        setNewBoxQtys(pid ? { [pid]: 1 } : {});
                      }}
                      className="input"
                    >
                      <option value="">— pick one product —</option>
                      {variantProducts.map((vp) => {
                        const name = productMap.get(vp.productId) ?? vp.productId;
                        return (
                          <option key={vp.id ?? vp.productId} value={vp.productId}>
                            {name}
                          </option>
                        );
                      })}
                    </select>
                  )}
                  <p className="text-[10.5px] text-muted-foreground mt-1">
                    Loose = one piece sold individually. The picked product drives production, costing and stock.
                  </p>
                </div>
              )}

              {kind === "curated" && selectedPackagingId && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">
                    Box composition
                    <span className="font-normal ml-1">
                      ({compSum}/{capacityForForm} pieces)
                    </span>
                  </p>
                  {!hasVariantProducts ? (
                    <p className="text-[11px] text-status-warn border border-dashed border-status-warn-edge rounded-md px-2 py-2">
                      Add at least one product to this variant first (use the <strong>Products</strong> section above), then configure the box qty here.
                    </p>
                  ) : (
                    <div className="rounded-md border border-[color:var(--ds-border-warm)]/70 bg-background/50 p-2 space-y-1.5">
                      {variantProducts.map((vp) => {
                        const name = productMap.get(vp.productId) ?? vp.productId;
                        const qty = newBoxQtys[vp.productId] ?? 0;
                        return (
                          <div key={vp.id ?? vp.productId} className="flex items-center gap-2">
                            <span className="flex-1 text-sm truncate">{name}</span>
                            <input
                              type="number"
                              min="0"
                              value={qty}
                              onChange={(e) => {
                                const n = parseInt(e.target.value);
                                setNewBoxQtys({
                                  ...newBoxQtys,
                                  [vp.productId]: Number.isFinite(n) && n >= 0 ? n : 0,
                                });
                              }}
                              className="input w-20 text-sm py-1.5"
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {hasVariantProducts && compSum !== capacityForForm && (
                    <p className="text-[11px] text-status-warn mt-1">
                      Must sum to {capacityForForm} pieces (currently {compSum}).
                    </p>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={isEdit ? handleSaveBoxEdit : handleAddBox}
                  disabled={!sellPriceStr || !curatedReady}
                  className="btn-primary px-3 py-1.5 text-sm disabled:opacity-40"
                >
                  {isEdit ? "Save" : "Add"}
                </button>
                <button
                  onClick={() => {
                    if (isEdit) {
                      handleCancelBoxEdit();
                    } else {
                      setShowAddBox(false);
                      setSelectedPackagingId("");
                      setSellPriceStr("");
                      setChannelPriceB2B("");
                      setChannelPriceShop("");
                      setChannelPriceEvent("");
                      setChannelPriceOnline("");
                      setNewBoxQtys({});
                    }
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
            <div className="text-sm text-muted-foreground py-6 text-center border border-dashed border-[color:var(--ds-border-warm)] rounded-sm space-y-1">
              <p>No box pricing configured yet.</p>
              <p className="text-xs">Add a box to see cost breakdowns and margins.</p>
            </div>
          ) : !avgCost ? (
            /* Cost data isn't available yet (products missing a default mould
             * or ingredients without pricing), so we can't render the margin
             * card. Still list each saved size with its price and composition
             * so the user can see and manage what they've configured. */
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground border border-dashed border-[color:var(--ds-border-warm)] rounded-md px-3 py-2">
                Margin details hidden — products need a default mould and costed ingredients for
                cost/margin math. Box prices and composition still shown below.
              </div>
              {variantPackagings.map((cp) => {
                const cpId = cp.id ?? "";
                const pkg = cp.packagingId ? packagingMap.get(cp.packagingId) : undefined;
                const defaultPrice = (cp.price && cp.price > 0) ? cp.price : (cp.sellPrice ?? 0);
                return (
                  <div
                    key={cpId}
                    id={`vp-${cpId}`}
                    className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-3 scroll-mt-24"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{pkg?.name ?? "Unknown"}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {pkg?.capacity ?? 0} pc{(pkg?.capacity ?? 0) === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="text-sm font-semibold tabular-nums shrink-0">
                        {formatPrice(defaultPrice, sym)}
                      </div>
                      {pendingRemoveBox === cpId ? (
                        <span className="flex items-center gap-1.5 text-xs shrink-0">
                          <span className="text-muted-foreground">Remove?</span>
                          <button
                            onClick={() => handleRemoveBox(cpId)}
                            className="text-status-alert font-medium hover:underline"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setPendingRemoveBox(null)}
                            className="text-muted-foreground hover:underline"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setPendingRemoveBox(cpId)}
                          className="text-muted-foreground/60 hover:text-destructive shrink-0"
                          aria-label="Remove box"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <BoxExtras
                      variantPackagingId={cpId}
                      kind={variant?.kind ?? "curated"}
                      channelPrices={cp.channelPrices ?? {}}
                      defaultPrice={defaultPrice}
                      productMap={productMap}
                      sym={sym}
                    />
                    <VariantOnHandRow variantPackagingId={cpId} />
                    <div className="mt-1">
                      <button
                        type="button"
                        onClick={() => handleStartBoxEdit(cp)}
                        className="text-xs text-primary hover:underline"
                      >
                        Edit box
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-3">
              {boxPricings.map(({ cp, pkg, pricing, health, unitCost }) => {
                const cpId = cp.id ?? "";
                // Only show snapshots where packaging was actually priced — filter out initialisation entries
                const history = (cp.packagingId ? (snapshotsByPackaging.get(cp.packagingId) ?? []) : []).filter((s) => s.packagingUnitCost > 0);
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
                        setEditSellPriceStr(String((cp.price && cp.price > 0) ? cp.price : (cp.sellPrice ?? 0)));
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
                      defaultPrice={(cp.price && cp.price > 0) ? cp.price : (cp.sellPrice ?? 0)}
                      productMap={productMap}
                      sym={sym}
                    />
                    <VariantOnHandRow variantPackagingId={cpId} />
                    <div className="mt-1 ml-3">
                      <button
                        type="button"
                        onClick={() => handleStartBoxEdit(cp)}
                        className="text-xs text-primary hover:underline"
                      >
                        Edit box
                      </button>
                    </div>
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
        <section className="pt-4 border-t border-[color:var(--ds-border-warm)]">
          {!showDelete ? (
            <button
              onClick={() => setShowDelete(true)}
              className="flex items-center gap-2 text-sm text-destructive hover:underline"
            >
              <Trash2 className="w-4 h-4" /> Delete variant
            </button>
          ) : (
            <div className="rounded-sm border border-destructive/30 bg-destructive/5 p-4 space-y-3">
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
    <div className="mt-1 ml-3 pl-3 border-l border-[color:var(--ds-border-warm)]/40 space-y-1.5 py-1.5">
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
              <li key={vpp.id} className="text-[11px] rounded-sm bg-muted text-foreground px-2 py-0.5">
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
    <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] overflow-hidden">
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
              <button onClick={onConfirmRemove} className="text-status-alert font-medium hover:underline">Yes</button>
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
        <div className="flex justify-between text-xs font-medium border-t border-[color:var(--ds-border-warm)]/50 pt-1">
          <span>Total cost</span>
          <span className="tabular-nums">{formatPrice(pricing.totalCost, sym)}</span>
        </div>
      </div>

      {/* Sell price + margin */}
      <div className={`px-3 py-2.5 ${colors.bg} border-t border-[color:var(--ds-border-warm)]/30`}>
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
                  className="w-20 text-xs px-1.5 py-0.5 rounded border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)]"
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
      <div className="border-t border-[color:var(--ds-border-warm)]/40">
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
                      <p className={delta.improved ? "text-status-ok" : "text-status-alert"}>
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
                          <span className={`tabular-nums ${delta.improved ? "text-status-ok" : "text-status-alert"}`}>
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
          <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] overflow-hidden mb-4">
            <div className="flex items-center px-3 py-2 bg-muted/40 border-b border-[color:var(--ds-border-warm)] text-xs font-semibold text-muted-foreground">
              <span className="flex-1">Nutrient</span>
              <span className="w-24 text-right">Per 100g</span>
            </div>
            {nutrients.map((n) => {
              const val = per100g[n.key];
              return (
                <div
                  key={n.key}
                  className={`flex items-baseline px-3 py-1.5 text-sm border-b border-[color:var(--ds-border-warm)] last:border-b-0 ${
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
                {containsAllergen(entry.label) ? <strong>{entry.label}</strong> : entry.label}
              </span>
            ))}
            .
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No ingredients yet.</p>
        )}
        <ShopifyFormatBlock entries={ingredientList} per100g={per100g} />
      </div>
    </section>
  );
}

// ─── Variant on-hand row (per packaging size) ──────────────────────
//
// Renders inline under each box card. Shows current count per
// stock location with editable inputs. On blur (or Enter) persists
// the new count via setVariantStockOnHand. Manual entry is the path
// for tonight's pre-built inventory; box-up via /picking is the
// ongoing path.

const ON_HAND_LOCATIONS: Array<{ id: import("@/types").StockLocation; label: string }> = [
  { id: "store",      label: "Shop" },
  { id: "production", label: "Production" },
  { id: "freezer",    label: "Freezer" },
];

function VariantOnHandRow({ variantPackagingId }: { variantPackagingId: string }) {
  const allRows = useVariantStockLocations();
  const rows = useMemo(
    () => allRows.filter((r) => r.variantPackagingId === variantPackagingId && !r.orderId && !r.productionOrderId),
    [allRows, variantPackagingId],
  );
  const byLoc = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.location, (m.get(r.location) ?? 0) + (r.quantity ?? 0));
    return m;
  }, [rows]);

  // Local edit state per location — only persists on blur / Enter.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<string>("");

  async function commit(location: import("@/types").StockLocation) {
    const raw = edits[location];
    if (raw === undefined) return;
    const n = Math.max(0, Math.floor(Number(raw) || 0));
    setBusy((b) => ({ ...b, [location]: true }));
    setErr("");
    try {
      await setVariantStockOnHand({ variantPackagingId, location, quantity: n });
      setEdits((e) => {
        const next = { ...e };
        delete next[location];
        return next;
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy((b) => ({ ...b, [location]: false }));
    }
  }

  return (
    <div className="mt-2 px-3 py-2 rounded-sm bg-muted/30 border border-[color:var(--ds-border-warm)]">
      <p className="text-[10.5px] font-medium uppercase text-muted-foreground tracking-wide mb-1.5">
        On hand
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        {ON_HAND_LOCATIONS.map((loc) => {
          const current = byLoc.get(loc.id) ?? 0;
          const editing = edits[loc.id] !== undefined;
          const value = editing ? edits[loc.id]! : String(current);
          return (
            <label key={loc.id} className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">{loc.label}:</span>
              <input
                type="number"
                min={0}
                value={value}
                onChange={(e) => setEdits((p) => ({ ...p, [loc.id]: e.target.value }))}
                onBlur={() => editing && commit(loc.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                disabled={busy[loc.id]}
                className="w-16 rounded border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-2 py-0.5 tabular-nums text-right disabled:opacity-50"
              />
            </label>
          );
        })}
      </div>
      {err && <p className="text-[11px] text-status-blush mt-1.5">{err}</p>}
    </div>
  );
}
