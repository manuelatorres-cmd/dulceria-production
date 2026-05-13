"use client";

import { useState, useRef, useEffect, useMemo, useCallback, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useProduct, useProductFillings, useFillings, useFilling, useMouldsList, useProductCategories, useProductCategory, useCoatings, useShellCapableIngredients, saveProduct, saveVariant, addFillingToProduct, removeFillingFromProduct, updateProductFillingPercentage, updateProductFillingGrams, reorderProductFillings, deleteProduct, duplicateProduct, archiveProduct, unarchiveProduct, hasProductBeenProduced, usePlanProductsForProduct, useProductionPlans, useProductCostSnapshots, useLatestProductCostSnapshot, recalculateProductCost, useIngredients, useFillingIngredients, useFillingIngredientsForFillings, useDecorationMaterials, saveDecorationMaterial, useCurrencySymbol, useMarketRegion, useDefaultFillMode, useShellDesigns, useDecorationCategoryLabels, useProductsList, useProductLeadTimeSuggestions, useStockLocationMinimums, saveStockLocationMinimum, useFacilityMayContain } from "@/lib/hooks";
import { SHELL_TECHNIQUES, DECORATION_MATERIAL_TYPE_LABELS, DECORATION_APPLY_AT_OPTIONS, normalizeApplyAt, COMPOSITION_FIELDS, type ShellDesignStep, type ShellDesignApplyAt, type ProductCostSnapshot, type BreakdownEntry, type ProductFilling, costPerGram, type DecorationMaterial, allergenLabel, type FillMode, type Ingredient, type Filling, type ProductCategory, type FillingIngredient } from "@/types";
import { colorToCSS } from "@/lib/colors";
import { deserializeBreakdown, enrichBreakdownLabels, formatCost, costDelta, deriveShellPercentageFromGrams } from "@/lib/costCalculation";
import { DENSITY_G_PER_ML } from "@/lib/production";
import { getNutrientsByMarket, getNutritionPanelTitle, scaleToServing, formatNutrientValue, percentDailyValue, calculateProductNutrition } from "@/lib/nutrition";
import { buildProductIngredientList } from "@/lib/ingredientList";
import { ShopifyFormatBlock } from "@/components/ShopifyFormatBlock";
import { containsAllergen } from "@/lib/allergenKeywordsDe";
import { calculateShellWeightG, calculateCapWeightG } from "@/lib/costCalculation";
import type { MarketRegion } from "@/types";
import { IconCamera as Camera, IconPlus as Plus, IconX as X, IconSearch as Search, IconTrash as Trash2, IconPencil as Pencil, IconChevronRight as ChevronRight, IconRefresh as RefreshCw, IconAlertTriangle as AlertTriangle, IconCopy as Copy, IconArchive as Archive, IconArchiveOff as ArchiveRestore, IconGripVertical as GripVertical } from "@tabler/icons-react";
import { BackButton } from "@/components/back-button";
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DragEndEvent } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import type { DraggableAttributes } from "@dnd-kit/core";
import { InlineNameEditor } from "@/components/inline-name-editor";
import { DetailNav } from "@/components/detail-nav";
import {
  DsTabNav,
  Section,
  DsInlineField,
  DsInlineTextarea,
  DsInlineSelect,
  DsInlineToggle,
  DsTagInput,
  DsPhotoUpload,
  ListRow,
  StatusTag,
  type StatusTagKind,
  useToast,
} from "@/components/dulceria";
import type { Product } from "@/types";
import Link from "next/link";
import { useNavigationGuard } from "@/lib/useNavigationGuard";

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = use(params);
  const productId = decodeURIComponent(idStr);
  const router = useRouter();
  const product = useProduct(productId);
  const productFillings = useProductFillings(productId);
  const allFillings = useFillings();
  const allMoulds = useMouldsList(true);
  const productCategories = useProductCategories();
  const productCategory = useProductCategory(product?.productCategoryId);
  const shellCapableIngredients = useShellCapableIngredients();
  // Only chocolate-category fillings can be used as shell — apple
  // puree etc. can't be tempered. Filling.category is a string
  // matching the FillingCategory.name (case-insensitive "chocolate").
  const shellCapableFillings = useMemo(
    () => allFillings.filter((f) => (f.category ?? "").toLowerCase().trim() === "chocolate"),
    [allFillings],
  );
  // All products (incl. archived) so the tag autocomplete picks up every
  // tag ever used across the catalogue, not just the active subset.
  const allProducts = useProductsList(true);
  const allLocationMinimums = useStockLocationMinimums();
  const productMins = useMemo(
    () => allLocationMinimums.filter((m) => m.productId === productId),
    [allLocationMinimums, productId],
  );
  const minStoreRow = productMins.find((m) => m.location === "store");
  const minProdRow = productMins.find((m) => m.location === "production");
  const knownTags = useMemo(() => {
    const set = new Set<string>();
    for (const p of allProducts) for (const t of p.tags ?? []) set.add(t);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allProducts]);
  const coatings = useCoatings();
  const sym = useCurrencySymbol();
  const leadTimeSuggestions = useProductLeadTimeSuggestions();
  const suggestedLeadTime = productId ? leadTimeSuggestions.get(productId) : undefined;

  const searchParams = useSearchParams();
  const isNew = searchParams.get("new") === "1";

  const market = useMarketRegion();
  const defaultFillMode = useDefaultFillMode();
  type ProductTab = "product" | "shell" | "fillingHistory" | "batches" | "cost" | "nutrition";
  const VALID_TABS: ProductTab[] = ["product", "shell", "fillingHistory", "batches", "cost", "nutrition"];
  const initialTab: ProductTab = (() => {
    const raw = searchParams.get("tab");
    if (raw === "history") return "batches"; // legacy alias
    return VALID_TABS.includes(raw as ProductTab) ? (raw as ProductTab) : "product";
  })();
  const [activeTab, setActiveTab] = useState<ProductTab>(initialTab);

  function switchTab(t: ProductTab) {
    setActiveTab(t);
    const sp = new URLSearchParams(Array.from(searchParams.entries()));
    if (t === "product") sp.delete("tab"); else sp.set("tab", t);
    const next = sp.toString();
    router.replace(`/products/${encodeURIComponent(productId)}${next ? `?${next}` : ""}`, { scroll: false });
  }

  const [editing, setEditing] = useState(isNew);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [productProduced, setProductProduced] = useState(false);
  const [confirmRemovePhoto, setConfirmRemovePhoto] = useState(false);
  const [showDuplicatePanel, setShowDuplicatePanel] = useState(false);
  const [duplicateFillings, setDuplicateFillings] = useState(false);
  const [duplicatingProduct, setDuplicatingProduct] = useState(false);

  // Local buffered state for edit mode
  const [localFillMode, setLocalFillMode] = useState<FillMode>("percentage");
  const [localProductCategoryId, setLocalProductCategoryId] = useState("");
  const [localShellIngredientId, setLocalShellIngredientId] = useState("");
  const [localShellFillingId, setLocalShellFillingId] = useState("");
  const [localShellPercentageStr, setLocalShellPercentageStr] = useState("");
  const [localCoating, setLocalCoating] = useState("");
  const [localTags, setLocalTags] = useState<string[]>([]);
  const [localAliases, setLocalAliases] = useState<string[]>([]);
  const [aliasInput, setAliasInput] = useState("");
  const [notes, setNotes] = useState("");
  const [localShelfLife, setLocalShelfLife] = useState("");
  const [localMinStore, setLocalMinStore] = useState("");
  const [localMinProduction, setLocalMinProduction] = useState("");
  const [localPriorityTier, setLocalPriorityTier] = useState<1 | 2 | 3>(2);
  const [localIncludedInCustomBoxes, setLocalIncludedInCustomBoxes] = useState<boolean>(false);
  const [localSecondsAllowed, setLocalSecondsAllowed] = useState<boolean>(false);
  const [localExcludeFromReplen, setLocalExcludeFromReplen] = useState<boolean>(false);
  const [localDefaultDiscountPercentSeconds, setLocalDefaultDiscountPercentSeconds] = useState("");
  const [localDefaultVatRate, setLocalDefaultVatRate] = useState("");
  const [localLeadTimeDays, setLocalLeadTimeDays] = useState("");
  const [localMouldId, setLocalMouldId] = useState("");
  const [batchQtyInput, setBatchQtyInput] = useState("");
  const [localShellDesign, setLocalShellDesign] = useState<ShellDesignStep[]>([]);

  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [showAssign, setShowAssign] = useState(false);
  const [fillingSearch, setFillingSearch] = useState("");
  const [tagInput, setTagInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (showAssign) { setShowAssign(false); setFillingSearch(""); }
      else if (confirmRemovePhoto) { setConfirmRemovePhoto(false); }
      else if (showDuplicatePanel) { setShowDuplicatePanel(false); setDuplicateFillings(false); }
      else if (confirmDelete) { setConfirmDelete(false); }
      else if (editing) { handleCancel(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showAssign, confirmRemovePhoto, showDuplicatePanel, confirmDelete, editing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync form state when product first loads
  useEffect(() => {
    if (product && (!editing || isNew)) {
      setLocalFillMode(product.fillMode ?? defaultFillMode);
      setLocalProductCategoryId(product.productCategoryId || "");
      setLocalShellIngredientId(product.shellIngredientId || "");
      setLocalShellFillingId(product.shellFillingId || "");
      setLocalShellPercentageStr(String(product.shellPercentage ?? productCategory?.defaultShellPercent ?? 37));
      setLocalCoating(product.coating || "");
      setLocalTags(product.tags ?? []);
      setLocalAliases(product.aliases ?? []);
      setNotes(product.notes || "");
      setLocalShelfLife(product.shelfLifeWeeks || "");
      setLocalLeadTimeDays(product.leadTimeDays != null ? String(product.leadTimeDays) : "");
      setLocalMouldId(product.defaultMouldId || "");
      setBatchQtyInput(String(product.defaultBatchQty ?? 1));
      setLocalShellDesign(product.shellDesign ?? []);
      setLocalPriorityTier(((product.priorityTier as 1 | 2 | 3 | undefined) ?? 2));
      setLocalIncludedInCustomBoxes(!!product.includedInCustomBoxes);
      setLocalSecondsAllowed(!!product.secondsAllowed);
      setLocalExcludeFromReplen(!!product.excludeFromReplen);
      setLocalDefaultDiscountPercentSeconds(product.defaultDiscountPercentSeconds != null ? String(product.defaultDiscountPercentSeconds) : "");
      setLocalDefaultVatRate(product.defaultVatRate != null ? String(product.defaultVatRate) : "");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id]);

  // Check production status on load to determine Archive vs Delete
  useEffect(() => {
    if (product?.id && !product.archived) {
      hasProductBeenProduced(product.id).then(setProductProduced);
    }
  }, [product?.id, product?.archived]);

  // For ?new=1 products, the record was already created with just a name on the
  // list page. Treat it as always dirty so the navigation guard fires — if the
  // user confirms "leave without saving", we delete the incomplete record.
  const [savedOnce, setSavedOnce] = useState(false);
  const formDirty = editing && product != null && (
    localFillMode !== (product.fillMode ?? defaultFillMode) ||
    localProductCategoryId !== (product.productCategoryId || "") ||
    localShellIngredientId !== (product.shellIngredientId || "") ||
    localShellFillingId !== (product.shellFillingId || "") ||
    localShellPercentageStr !== String(product.shellPercentage ?? productCategory?.defaultShellPercent ?? 37) ||
    localCoating !== (product.coating || "") ||
    notes !== (product.notes || "") ||
    localShelfLife !== (product.shelfLifeWeeks || "") ||
    localLeadTimeDays !== (product.leadTimeDays != null ? String(product.leadTimeDays) : "") ||
    localMouldId !== (product.defaultMouldId || "") ||
    batchQtyInput !== String(product.defaultBatchQty ?? 1) ||
    JSON.stringify([...localTags].sort()) !== JSON.stringify([...(product.tags ?? [])].sort()) ||
    JSON.stringify([...localAliases].sort()) !== JSON.stringify([...(product.aliases ?? [])].sort()) ||
    JSON.stringify(localShellDesign) !== JSON.stringify(product.shellDesign ?? [])
  );
  const isDirty = (isNew && !savedOnce) || formDirty;
  // When leaving a ?new=1 product without saving, delete the incomplete record
  const handleConfirmLeave = useCallback(async () => {
    if (isNew && product?.id) {
      await deleteProduct(product.id);
    }
  }, [isNew, product?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const { safeBack } = useNavigationGuard(isDirty, isNew ? handleConfirmLeave : undefined);

  // Recommended shelf life: shortest filling shelf life among assigned fillings
  const recommendedShelfLife = useMemo(() => {
    let min: number | null = null;
    let limitingFilling: string | null = null;
    for (const rl of productFillings) {
      const filling = allFillings.find((l) => l.id === rl.fillingId);
      if (filling?.shelfLifeWeeks != null) {
        if (min === null || filling.shelfLifeWeeks < min) {
          min = filling.shelfLifeWeeks;
          limitingFilling = filling.name;
        }
      }
    }
    return min !== null ? { weeks: min, fillingName: limitingFilling! } : null;
  }, [productFillings, allFillings]);

  // Auto-sync product shelf life to the soonest-expiring filling
  // every time the recommendation changes. Manuela measures Aw on
  // each filling and stamps a shelf life there — the product is
  // only as fresh as its bottleneck filling, so we propagate that
  // value automatically. (Manual edits are still allowed and stick
  // until the underlying recommendation moves again.)
  useEffect(() => {
    if (!product) return;
    if (!recommendedShelfLife) return;
    const desired = String(recommendedShelfLife.weeks);
    if (localShelfLife === desired) return;
    setLocalShelfLife(desired);
  }, [product?.id, recommendedShelfLife?.weeks]); // eslint-disable-line react-hooks/exhaustive-deps

  // Aggregated product allergens — union of the shell ingredient's
  // allergens plus every linked filling's allergens (fillings already
  // roll up their own ingredient allergens, so this inherits for free).
  // Computed live rather than stored: the UI always shows the current
  // ingredient state, even if a filling's composition changed after
  // the product was last opened.
  const productAllergens = useMemo(() => {
    const ids = new Set<string>();
    // Shell chocolate's allergens.
    const shell = product?.shellIngredientId
      ? shellCapableIngredients.find((i) => i.id === product.shellIngredientId)
      : undefined;
    if (shell?.allergens) for (const a of shell.allergens) ids.add(a);
    // Each filling's pre-aggregated allergen list.
    for (const pf of productFillings) {
      const f = allFillings.find((l) => l.id === pf.fillingId);
      if (!f?.allergens) continue;
      for (const a of f.allergens) ids.add(a);
    }
    return Array.from(ids).sort((a, b) => a.localeCompare(b));
  }, [product?.shellIngredientId, shellCapableIngredients, productFillings, allFillings]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  async function handleFillingDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = productFillings.findIndex((rl) => rl.id === active.id);
    const newIndex = productFillings.findIndex((rl) => rl.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = [...productFillings];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    await reorderProductFillings(reordered);
  }

  if (!product) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  // IDs of fillings already assigned to this product
  const assignedFillingIds = new Set(productFillings.map((rl) => rl.fillingId));

  // Available fillings not yet assigned
  const availableFillings = allFillings.filter((l) => !assignedFillingIds.has(l.id!));
  const filteredAvailable = fillingSearch
    ? availableFillings.filter((l) => {
        const q = fillingSearch.toLowerCase();
        return l.name.toLowerCase().includes(q) || l.description?.toLowerCase().includes(q);
      })
    : availableFillings;

  function startEditing() {
    if (!product) return;
    setLocalFillMode(product.fillMode ?? defaultFillMode);
    setLocalProductCategoryId(product.productCategoryId || "");
    setLocalShellIngredientId(product.shellIngredientId || "");
    setLocalShellFillingId(product.shellFillingId || "");
    setLocalShellPercentageStr(String(product.shellPercentage ?? productCategory?.defaultShellPercent ?? 37));
    setLocalCoating(product.coating || "");
    setLocalTags(product.tags ?? []);
    setNotes(product.notes || "");
    setLocalShelfLife(product.shelfLifeWeeks || "");
    setLocalMouldId(product.defaultMouldId || "");
    setBatchQtyInput(String(product.defaultBatchQty ?? 1));
    setLocalShellDesign(product.shellDesign ?? []);
    setEditing(true);
  }

  async function handleSave() {
    const batchQty = Math.max(1, parseInt(batchQtyInput) || 1);
    const shellPct = parseFloat(localShellPercentageStr);

    // Validate required fields
    const errors: string[] = [];
    if (!localProductCategoryId) errors.push("Category is required.");
    if (localFillMode === "grams" && !localMouldId) errors.push("Default mould is required when fill mode is By grams — shell % is derived from the cavity weight.");
    // Determine effective shell % (derived in grams mode, explicit in percentage mode)
    let effectiveShellPct = isNaN(shellPct) ? 0 : shellPct;
    if (localFillMode === "grams" && localMouldId && localProductCategoryId) {
      const mould = allMoulds.find((m) => m.id === localMouldId);
      const category = productCategories.find((c) => c.id === localProductCategoryId);
      if (mould && category) {
        const totalFillGrams = productFillings.reduce((sum, pf) => sum + (pf.fillGrams ?? 0), 0);
        const derived = deriveShellPercentageFromGrams(mould.cavityWeightG, totalFillGrams, DENSITY_G_PER_ML);
        effectiveShellPct = derived;
        if (derived < category.shellPercentMin || derived > category.shellPercentMax) {
          errors.push(`Derived shell % (${derived}%) is outside the ${category.name} category range (${category.shellPercentMin}%–${category.shellPercentMax}%). Adjust fill grams or pick a different mould.`);
        }
      }
    }
    if (effectiveShellPct > 0 && !localShellIngredientId && !localShellFillingId) {
      errors.push("Shell source is required when shell % is greater than 0 — pick a chocolate ingredient or a self-made chocolate filling.");
    }
    if (localShellIngredientId && localShellFillingId) {
      errors.push("Shell cannot reference both an ingredient and a filling — pick one.");
    }
    if (errors.length > 0) {
      setSaveErrors(errors);
      switchTab("product");
      return;
    }
    setSaveErrors([]);

    await saveProduct({
      id: productId,
      name: product!.name,
      photo: product!.photo,
      popularity: product!.popularity,
      productCategoryId: localProductCategoryId,
      shellIngredientId: localShellIngredientId || null,
      shellFillingId: localShellFillingId || null,
      shellPercentage: isNaN(shellPct) ? undefined : shellPct,
      coating: localCoating || undefined,
      tags: localTags.length > 0 ? localTags : undefined,
      aliases: localAliases.length > 0 ? localAliases : undefined,
      notes: notes.trim() || undefined,
      shelfLifeWeeks: localShelfLife.trim() || undefined,
      leadTimeDays: (() => {
        const v = parseInt(localLeadTimeDays.trim(), 10);
        return isNaN(v) || v < 0 ? undefined : v;
      })(),
      defaultMouldId: localMouldId || undefined,
      defaultBatchQty: batchQty,
      shellDesign: localShellDesign,
      fillMode: localFillMode,
      priorityTier: localPriorityTier,
      includedInCustomBoxes: localIncludedInCustomBoxes,
      secondsAllowed: localSecondsAllowed,
      excludeFromReplen: localExcludeFromReplen,
      defaultDiscountPercentSeconds: (() => {
        const v = parseFloat(localDefaultDiscountPercentSeconds);
        return isNaN(v) || v < 0 ? undefined : v;
      })(),
      defaultVatRate: (() => {
        const v = parseFloat(localDefaultVatRate);
        return isNaN(v) || v < 0 ? undefined : v;
      })(),
    });
    // Persist per-location minimums separately — they live on the
    // `stockLocationMinimums` table, not on the product row.
    const minStoreVal = parsePositiveIntOrNull(localMinStore);
    const minProdVal = parsePositiveIntOrNull(localMinProduction);
    if (localMinStore !== "" && minStoreVal !== null) {
      await saveStockLocationMinimum({
        id: minStoreRow?.id,
        productId,
        location: "store",
        minimumUnits: minStoreVal,
      });
    }
    if (localMinProduction !== "" && minProdVal !== null) {
      await saveStockLocationMinimum({
        id: minProdRow?.id,
        productId,
        location: "production",
        minimumUnits: minProdVal,
      });
    }
    setEditing(false);
    setSavedOnce(true);
    if (isNew) router.replace(`/products/${encodeURIComponent(productId)}`);
  }

  function parsePositiveIntOrNull(s: string): number | null {
    const v = parseInt(s.trim(), 10);
    return isNaN(v) || v < 0 ? null : v;
  }

  function handleCancel() {
    if (!product) return;
    setLocalFillMode(product.fillMode ?? defaultFillMode);
    setLocalProductCategoryId(product.productCategoryId || "");
    setLocalShellIngredientId(product.shellIngredientId || "");
    setLocalShellFillingId(product.shellFillingId || "");
    setLocalShellPercentageStr(String(product.shellPercentage ?? productCategory?.defaultShellPercent ?? 37));
    setLocalCoating(product.coating || "");
    setLocalTags(product.tags ?? []);
    setNotes(product.notes || "");
    setLocalShelfLife(product.shelfLifeWeeks || "");
    setLocalLeadTimeDays(product.leadTimeDays != null ? String(product.leadTimeDays) : "");
    setLocalMouldId(product.defaultMouldId || "");
    setBatchQtyInput(String(product.defaultBatchQty ?? 1));
    setLocalShellDesign(product.shellDesign ?? []);
    setEditing(false);
    setShowAssign(false);
    setFillingSearch("");
    setSaveErrors([]);
    if (isNew) router.replace(`/products/${encodeURIComponent(productId)}`);
  }

  async function handlePopularity(stars: number) {
    const newVal = product!.popularity === stars ? undefined : stars;
    await saveProduct({ id: productId, name: product!.name, photo: product!.photo, popularity: newVal });
  }

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result as string;
      await saveProduct({ id: productId, name: product!.name, photo: base64 });
    };
    reader.readAsDataURL(file);
  }

  async function handleAssignFilling(fillingId: string) {
    await addFillingToProduct(productId, fillingId);
    setFillingSearch("");
    setShowAssign(false);
  }

  async function handleRemoveFilling(productFillingId: string) {
    await removeFillingFromProduct(productFillingId);
  }

  const toast = useToast();
  // Inline patch helper: each Product-tab field saves on its own.
  // Supabase update only writes the fields we pass — name is required by
  // the saveProduct signature, so we always include the current name.
  async function patchProduct(patch: Partial<Product>) {
    if (!product) return;
    await saveProduct({ id: productId, name: product.name, ...patch });
  }

  function handleAddTag(tag: string) {
    const trimmed = tag.trim().toLowerCase();
    if (!trimmed || localTags.includes(trimmed)) return;
    setLocalTags([...localTags, trimmed]);
    setTagInput("");
  }

  function handleRemoveTag(tag: string) {
    setLocalTags(localTags.filter((t) => t !== tag));
  }

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      {/* Back + prev/next pager */}
      <div className="px-4 pt-6 pb-2 space-y-2">
        <BackButton fallbackHref="/products" fallbackLabel="All products" onBack={() => safeBack()} />
        <DetailNav
          items={[...allProducts].filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name))}
          currentId={productId}
          hrefFor={(p) => `/products/${encodeURIComponent(p.id!)}`}
          labelFor={(p) => p.name}
        />
      </div>

      {/* Photo + Name */}
      <div className="px-4 pb-4">
        <div className="flex gap-4 items-start">
          <div className="relative shrink-0 group">
            {product.photo ? (
              <>
                <img
                  src={product.photo}
                  alt={product.name}
                  width={80}
                  height={80}
                  className="w-20 h-20 rounded-[4px] object-cover cursor-pointer"
                  onClick={() => { if (!confirmRemovePhoto) fileInputRef.current?.click(); }}
                />
                {confirmRemovePhoto ? (
                  <div className="absolute -top-1.5 -right-1.5 flex gap-1">
                    <button
                      onClick={() => { saveProduct({ id: productId, name: product!.name, photo: undefined }); setConfirmRemovePhoto(false); }}
                      className="h-5 px-1.5 rounded-full bg-red-600 text-white text-[10px] font-medium"
                    >Remove</button>
                    <button
                      onClick={() => setConfirmRemovePhoto(false)}
                      className="w-5 h-5 rounded-full bg-stone-400 text-white flex items-center justify-center"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmRemovePhoto(true)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-stone-700 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove photo"
                    aria-label="Remove photo"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-20 h-20 rounded-[4px] bg-muted flex flex-col items-center justify-center text-muted-foreground gap-1"
              >
                <Camera className="w-5 h-5" />
                <span className="text-[10px]">Photo</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhoto}
              className="hidden"
            />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <InlineNameEditor
                    name={product.name}
                    onSave={async (n) => { await saveProduct({ id: productId, name: n, photo: product.photo }); }}
                    className="text-xl font-bold"
                  />
                  {product.archived && (
                    <span className="rounded-[4px] bg-muted text-muted-foreground px-2.5 py-0.5 text-[10px] font-medium flex items-center gap-1 shrink-0">
                      <Archive className="w-3 h-3" /> Archived
                    </span>
                  )}
                </div>
                {!editing && (
                  <div className="flex gap-0.5 mt-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        onClick={() => handlePopularity(star)}
                        aria-label={`Rate ${star} star${star !== 1 ? "s" : ""}`}
                        className="p-0.5 transition-transform active:scale-110"
                      >
                        <svg className={`w-5 h-5 ${(product.popularity ?? 0) >= star ? "text-primary fill-primary" : "text-border fill-transparent"}`} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.563.563 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
                        </svg>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {!editing && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={async () => {
                      if (!product?.id) return;
                      const id = await saveVariant({
                        name: `${product.name} (variant)`,
                        description: product.notes ?? undefined,
                        startDate: new Date().toISOString().slice(0, 10),
                        labels: product.tags ?? [],
                        aliases: product.aliases ?? [],
                        kind: "curated",
                        vatRatePercent: product.defaultVatRate ?? 10,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                      });
                      router.push(`/variants/${encodeURIComponent(String(id))}?new=1`);
                    }}
                    aria-label="Use as variant template"
                    title="Create a variant pre-filled from this product"
                    className="p-1.5 rounded-full hover:bg-muted transition-colors"
                  >
                    <Copy aria-hidden="true" className="w-4 h-4 text-muted-foreground" />
                  </button>
                  {activeTab !== "product" && (
                    <button
                      onClick={startEditing}
                      aria-label="Edit product"
                      className="p-1.5 rounded-full hover:bg-muted transition-colors"
                    >
                      <Pencil aria-hidden="true" className="w-4 h-4 text-muted-foreground" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 mb-4">
        <DsTabNav
          tabs={[
            { id: "product", label: "Product" },
            { id: "shell", label: "Shell design" },
            { id: "fillingHistory", label: "Filling history" },
            { id: "batches", label: "Batches" },
            { id: "cost", label: "Cost" },
            { id: "nutrition", label: "Nutrition" },
          ]}
          activeTab={activeTab}
          onChange={(id) => switchTab(id as ProductTab)}
        />
      </div>

      {activeTab === "shell" && (
        <ProductShellTab
          product={product}
          productCategory={productCategory}
          shellCapableIngredients={shellCapableIngredients}
          shellCapableFillings={shellCapableFillings}
          patchProduct={patchProduct}
          onSwitchToProductTab={() => switchTab("product")}
        />
      )}

      {activeTab === "fillingHistory" && (
        <ProductFillingHistorySection productId={productId} />
      )}

      {activeTab === "batches" && (
        <BatchHistoryTab productId={productId} />
      )}

      {activeTab === "cost" && (
        <ProductCostTab productId={productId} product={product} productFillings={productFillings} allMoulds={allMoulds} sym={sym} />
      )}

      {activeTab === "nutrition" && (
        <ProductNutritionTab productId={productId} productFillings={productFillings} market={market} />
      )}

      {activeTab === "product" && (
      <>

      {/* === Phase A.1 — three-column inline-edit body === */}
      <div className="px-4 pb-6 space-y-4">
        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            alignItems: "start",
          }}
        >
          {/* Column 1 — Identity */}
          <Section title="Identity">
            <div style={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              <DsPhotoUpload
                value={product.photo}
                aspectRatio={1}
                onChange={async (url) => {
                  await patchProduct({ photo: url ?? undefined });
                  toast.success(url ? "Photo updated" : "Photo removed");
                }}
              />
              <DsInlineField
                label="Name"
                value={product.name}
                onSave={async (v) => {
                  const next = v.trim();
                  if (!next) throw new Error("Name cannot be empty");
                  await patchProduct({ name: next });
                  toast.success("Name saved");
                }}
              />
              <DsInlineSelect
                label="Category"
                value={product.productCategoryId ?? ""}
                options={[
                  { value: "", label: "— None —" },
                  ...productCategories.map((c) => ({ value: c.id!, label: c.name })),
                ]}
                onSave={async (v) => {
                  await patchProduct({ productCategoryId: v || undefined });
                  toast.success("Category saved");
                }}
              />
              <DsInlineSelect
                label="Priority tier"
                value={String(product.priorityTier ?? 2)}
                options={[
                  { value: "1", label: "1 · Top seller" },
                  { value: "2", label: "2 · Normal" },
                  { value: "3", label: "3 · Nice-to-have" },
                ]}
                onSave={async (v) => {
                  await patchProduct({ priorityTier: parseInt(v, 10) as 1 | 2 | 3 });
                  toast.success("Priority saved");
                }}
              />
              <DsTagInput
                label="Aliases · names used externally"
                values={product.aliases ?? []}
                onChange={async (next) => {
                  await patchProduct({ aliases: next.length ? next : undefined });
                  toast.success("Aliases saved");
                }}
              />
              <DsTagInput
                label="Tags"
                values={product.tags ?? []}
                suggestions={knownTags}
                onChange={async (next) => {
                  await patchProduct({ tags: next.length ? next : undefined });
                  toast.success("Tags saved");
                }}
              />
              <DsInlineTextarea
                label="Notes"
                value={product.notes ?? ""}
                onSave={async (v) => {
                  await patchProduct({ notes: v.trim() || undefined });
                  toast.success("Notes saved");
                }}
              />
            </div>
          </Section>

          {/* Column 2 — Composition */}
          <Section title="Composition">
            <div style={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              <DsInlineSelect
                label="Fill mode"
                value={product.fillMode ?? defaultFillMode}
                options={[
                  { value: "percentage", label: "By percentage" },
                  { value: "grams", label: "By grams" },
                ]}
                onSave={async (v) => {
                  await patchProduct({ fillMode: v as FillMode });
                  toast.success("Fill mode saved");
                }}
              />
              <DsInlineSelect
                label="Shell source"
                value={
                  product.shellIngredientId
                    ? `ing:${product.shellIngredientId}`
                    : product.shellFillingId
                      ? `fil:${product.shellFillingId}`
                      : ""
                }
                options={[
                  { value: "", label: "— None —" },
                  ...shellCapableIngredients.map((ing) => ({
                    value: `ing:${ing.id!}`,
                    label: `Ingredient · ${ing.name}`,
                  })),
                  ...shellCapableFillings.map((f) => ({
                    value: `fil:${f.id!}`,
                    label: `Self-made · ${f.name}`,
                  })),
                ]}
                onSave={async (v) => {
                  if (!v) {
                    await patchProduct({ shellIngredientId: null, shellFillingId: null });
                  } else if (v.startsWith("ing:")) {
                    await patchProduct({ shellIngredientId: v.slice(4), shellFillingId: null });
                  } else if (v.startsWith("fil:")) {
                    await patchProduct({ shellIngredientId: null, shellFillingId: v.slice(4) });
                  }
                  toast.success("Shell source saved");
                }}
              />
              {(product.fillMode ?? defaultFillMode) === "percentage" && (
                <DsInlineField
                  label="Shell %"
                  type="number"
                  suffix="%"
                  value={
                    product.shellPercentage != null
                      ? String(product.shellPercentage)
                      : productCategory?.defaultShellPercent != null
                        ? String(productCategory.defaultShellPercent)
                        : ""
                  }
                  validate={(v) => {
                    const n = parseFloat(v);
                    if (isNaN(n)) return "Must be a number";
                    if (productCategory) {
                      if (n < productCategory.shellPercentMin || n > productCategory.shellPercentMax) {
                        return `Out of range ${productCategory.shellPercentMin}–${productCategory.shellPercentMax}%`;
                      }
                    }
                    return true;
                  }}
                  onSave={async (v) => {
                    const n = parseFloat(v);
                    await patchProduct({ shellPercentage: isNaN(n) ? undefined : n });
                    toast.success("Shell % saved");
                  }}
                />
              )}
              <DsInlineField
                label="Coating (legacy)"
                value={product.coating ?? ""}
                onSave={async (v) => {
                  await patchProduct({ coating: v.trim() || undefined });
                  toast.success("Coating saved");
                }}
              />
              <div>
                <DsInlineSelect
                  label="Default mould"
                  value={product.defaultMouldId ?? ""}
                  options={[
                    { value: "", label: "— No default —" },
                    ...allMoulds.map((m) => ({
                      value: m.id!,
                      label: `${m.name} (${m.cavityWeightG} g · ${m.numberOfCavities} cav.)`,
                    })),
                  ]}
                  onSave={async (v) => {
                    await patchProduct({ defaultMouldId: v || undefined });
                    toast.success("Mould saved");
                  }}
                />
                {(() => {
                  if (!product.defaultMouldId) return null;
                  const mould = allMoulds.find((m) => m.id === product.defaultMouldId);
                  if (!mould) return null;
                  const totalFillGrams = productFillings.reduce((sum, pf) => sum + (pf.fillGrams ?? 0), 0);
                  return (
                    <p
                      style={{
                        marginTop: 4,
                        fontSize: 11,
                        fontStyle: "italic",
                        color: "var(--ds-text-muted)",
                      }}
                    >
                      filling grams / cavity = {totalFillGrams.toFixed(1)} g
                      {" · cavity total "}
                      {mould.cavityWeightG} g
                    </p>
                  );
                })()}
              </div>
              <DsInlineField
                label="Default batch qty"
                type="number"
                value={String(product.defaultBatchQty ?? 1)}
                onSave={async (v) => {
                  const n = Math.max(1, parseInt(v, 10) || 1);
                  await patchProduct({ defaultBatchQty: n });
                  toast.success("Batch qty saved");
                }}
              />
              <div>
                <span className="text-ds-label">Shell design</span>
                <p style={{ marginTop: 4, fontSize: 13, color: "var(--ds-text-primary)" }}>
                  {(product.shellDesign ?? []).length === 0 ? (
                    <em style={{ color: "var(--ds-text-muted)" }}>No steps yet — </em>
                  ) : (
                    `${(product.shellDesign ?? []).length} step${(product.shellDesign ?? []).length === 1 ? "" : "s"} · `
                  )}
                  <button
                    type="button"
                    onClick={() => switchTab("shell")}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--ds-tier-quarter-focus)",
                      cursor: "pointer",
                      fontSize: 12,
                      padding: 0,
                      textDecoration: "underline",
                    }}
                  >
                    Edit steps →
                  </button>
                </p>
              </div>
            </div>
          </Section>

          {/* Column 3 — Commercial */}
          <Section title="Commercial">
            <div style={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <DsInlineField
                  label="Shelf life (weeks)"
                  value={product.shelfLifeWeeks ?? ""}
                  onSave={async (v) => {
                    await patchProduct({ shelfLifeWeeks: v.trim() || undefined });
                    toast.success("Shelf life saved");
                  }}
                />
                {recommendedShelfLife && (
                  <p style={{ marginTop: 4, fontSize: 11, color: "var(--ds-text-muted)" }}>
                    Suggested: {recommendedShelfLife.weeks} wks (limited by {recommendedShelfLife.fillingName})
                  </p>
                )}
              </div>
              <div>
                <DsInlineField
                  label="Lead time (days)"
                  type="number"
                  value={product.leadTimeDays != null ? String(product.leadTimeDays) : ""}
                  onSave={async (v) => {
                    const n = parseInt(v, 10);
                    await patchProduct({ leadTimeDays: isNaN(n) || n < 0 ? undefined : n });
                    toast.success("Lead time saved");
                  }}
                />
                {suggestedLeadTime != null && (
                  <p style={{ marginTop: 4, fontSize: 11, color: "var(--ds-text-muted)" }}>
                    Suggested: {suggestedLeadTime} day{suggestedLeadTime === 1 ? "" : "s"} — production steps ÷ team capacity
                  </p>
                )}
              </div>
              <DsInlineField
                label="Default VAT (%)"
                type="number"
                suffix="%"
                value={product.defaultVatRate != null ? String(product.defaultVatRate) : ""}
                onSave={async (v) => {
                  const n = parseFloat(v);
                  await patchProduct({ defaultVatRate: isNaN(n) || n < 0 ? undefined : n });
                  toast.success("VAT saved");
                }}
              />
              <DsInlineField
                label="Default discount on seconds (%)"
                type="number"
                suffix="%"
                value={
                  product.defaultDiscountPercentSeconds != null
                    ? String(product.defaultDiscountPercentSeconds)
                    : ""
                }
                onSave={async (v) => {
                  const n = parseFloat(v);
                  await patchProduct({
                    defaultDiscountPercentSeconds: isNaN(n) || n < 0 ? undefined : n,
                  });
                  toast.success("Discount saved");
                }}
              />
              <DsInlineField
                label="Min stock — store"
                type="number"
                value={minStoreRow?.minimumUnits != null ? String(minStoreRow.minimumUnits) : ""}
                onSave={async (v) => {
                  const n = parseInt(v, 10);
                  if (isNaN(n) || n < 0) throw new Error("Must be a non-negative number");
                  await saveStockLocationMinimum({
                    id: minStoreRow?.id,
                    productId,
                    location: "store",
                    minimumUnits: n,
                  });
                  toast.success("Min stock — store saved");
                }}
              />
              <DsInlineField
                label="Min stock — production"
                type="number"
                value={minProdRow?.minimumUnits != null ? String(minProdRow.minimumUnits) : ""}
                onSave={async (v) => {
                  const n = parseInt(v, 10);
                  if (isNaN(n) || n < 0) throw new Error("Must be a non-negative number");
                  await saveStockLocationMinimum({
                    id: minProdRow?.id,
                    productId,
                    location: "production",
                    minimumUnits: n,
                  });
                  toast.success("Min stock — production saved");
                }}
              />
              <DsInlineToggle
                label="Available in shop custom-box builder"
                checked={!!product.includedInCustomBoxes}
                onChange={async (next) => {
                  await patchProduct({ includedInCustomBoxes: next });
                  toast.success("Custom-box flag saved");
                }}
              />
              <DsInlineToggle
                label={'Can be sold as "seconds" (B-ware)'}
                description="Typically only bars."
                checked={!!product.secondsAllowed}
                onChange={async (next) => {
                  await patchProduct({ secondsAllowed: next });
                  toast.success("Seconds flag saved");
                }}
              />
              <DsInlineToggle
                label="Skip from auto-replen"
                description="Limited / campaign-only — manual production order."
                checked={!!product.excludeFromReplen}
                onChange={async (next) => {
                  await patchProduct({ excludeFromReplen: next });
                  toast.success("Replen flag saved");
                }}
              />
            </div>
          </Section>
        </div>

        {/* Allergens (aggregated) — read-only */}
        {productAllergens.length > 0 && (
          <Section title="Allergens">
            <div style={{ padding: "0 20px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {productAllergens.map((a) => (
                  <span
                    key={a}
                    style={{
                      border: "0.5px solid var(--ds-semantic-warn)",
                      background: "var(--ds-tint-warn)",
                      color: "var(--ds-semantic-warn)",
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: 11,
                    }}
                  >
                    {allergenLabel(a)}
                  </span>
                ))}
              </div>
              <p style={{ marginTop: 6, fontSize: 11, fontStyle: "italic", color: "var(--ds-text-muted)" }}>
                Aggregated from the shell chocolate and every filling&apos;s ingredients.
              </p>
            </div>
          </Section>
        )}

        {/* Fillings — kept inline (always-editable). Out-of-A.1-scope detail. */}
        {(() => {
          const effShellPct = product.shellPercentage ?? productCategory?.defaultShellPercent ?? 37;
          if (effShellPct >= 100) return null;
          return (
            <Section
              title={`Fillings (${productFillings.length})`}
              action={
                <span style={{ display: "inline-flex", gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => setShowAssign(true)}
                    style={{
                      fontSize: 11,
                      color: "var(--ds-tier-quarter-focus)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontWeight: 500,
                    }}
                  >
                    + Assign filling
                  </button>
                  <Link href="/fillings" style={{ fontSize: 11, color: "var(--ds-text-muted)", textDecoration: "underline" }}>
                    Create new
                  </Link>
                </span>
              }
            >
              <div style={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                {showAssign && (
                  <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-3 space-y-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        type="text"
                        value={fillingSearch}
                        onChange={(e) => setFillingSearch(e.target.value)}
                        placeholder="Search fillings to assign..."
                        autoFocus
                        className="input !pl-8"
                      />
                    </div>
                    {filteredAvailable.length > 0 ? (
                      <ul className="max-h-48 overflow-y-auto space-y-1">
                        {filteredAvailable.map((filling) => (
                          <li key={filling.id}>
                            <button
                              onClick={() => handleAssignFilling(filling.id!)}
                              className="w-full text-left rounded-full px-2 py-1.5 hover:bg-muted transition-colors"
                            >
                              <span className="text-sm font-medium">{filling.name}</span>
                              {(filling.category || filling.description) && (
                                <div className="text-xs text-muted-foreground truncate">
                                  {[filling.category, filling.description].filter(Boolean).join(" · ")}
                                </div>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground py-2 text-center">
                        {availableFillings.length === 0
                          ? "All fillings are already assigned."
                          : "No fillings match your search."}
                      </p>
                    )}
                    <button
                      onClick={() => { setShowAssign(false); setFillingSearch(""); }}
                      className="text-xs text-muted-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {productFillings.length === 0 && !showAssign ? (
                  <p className="text-muted-foreground text-sm py-4 text-center">
                    No fillings assigned yet. Assign an existing filling or create a new one.
                  </p>
                ) : (
                  <>
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleFillingDragEnd}>
                      <SortableContext items={productFillings.map((bl) => bl.id!)} strategy={verticalListSortingStrategy}>
                        <ul className="space-y-2">
                          {productFillings.map((bl) => (
                            <SortableProductFillingRow
                              key={bl.id}
                              productFilling={bl}
                              fillMode={product.fillMode ?? defaultFillMode}
                              onRemove={() => handleRemoveFilling(bl.id!)}
                              onUpdatePercentage={(pct) => updateProductFillingPercentage(bl.id!, pct)}
                              onUpdateGrams={(g) => updateProductFillingGrams(bl.id!, g)}
                            />
                          ))}
                        </ul>
                      </SortableContext>
                    </DndContext>
                    {productFillings.length > 1 && (product.fillMode ?? defaultFillMode) !== "grams" && (
                      <FillBar productFillings={productFillings.map((bl) => ({
                        ...bl,
                        fillingName: allFillings.find((l) => l.id === bl.fillingId)?.name ?? "Filling",
                      }))} />
                    )}
                  </>
                )}
              </div>
            </Section>
          );
        })()}
      </div>

      {/* Delete / Archive / Duplicate — always visible (was gated on !editing) */}
      <div className="px-4 pb-8 border-t border-[color:var(--ds-border-warm)] pt-4 space-y-4">
        {/* Duplicate */}
        {showDuplicatePanel ? (
          <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Copy className="w-4 h-4 text-muted-foreground shrink-0" />
              <p className="text-sm font-medium">Duplicate &ldquo;{product?.name}&rdquo;</p>
            </div>
            <p className="text-xs text-muted-foreground">
              A new product will be created with the same type, coating, tags, notes, shell design, and production defaults.
            </p>
            {productFillings.length > 0 && (
              <>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={duplicateFillings}
                    onChange={(e) => setDuplicateFillings(e.target.checked)}
                    className="rounded border-[color:var(--ds-border-warm)]"
                  />
                  <span className="text-xs">
                    Also duplicate {productFillings.length === 1 ? "the filling" : `all ${productFillings.length} fillings`} as new copies
                  </span>
                </label>
                <p className="text-xs text-muted-foreground ml-6 -mt-2">
                  {duplicateFillings
                    ? "Each filling will be copied as an independent filling you can edit separately."
                    : "The duplicate will share the same fillings as the original."}
                </p>
              </>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={async () => {
                  setDuplicatingProduct(true);
                  try {
                    const newId = await duplicateProduct(productId, { duplicateFillings });
                    router.push(`/products/${encodeURIComponent(newId)}?new=1`);
                  } finally {
                    setDuplicatingProduct(false);
                  }
                }}
                disabled={duplicatingProduct}
                className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {duplicatingProduct ? "Duplicating…" : "Duplicate product"}
              </button>
              <button
                onClick={() => { setShowDuplicatePanel(false); setDuplicateFillings(false); }}
                className="btn-secondary px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => { setShowDuplicatePanel(true); setConfirmDelete(false); }}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Copy className="w-4 h-4" /> Duplicate product
          </button>
        )}

        {/* Unarchive (for archived products) */}
        {product?.archived && (
          <button
            onClick={async () => { await unarchiveProduct(productId); }}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArchiveRestore className="w-4 h-4" /> Unarchive product
          </button>
        )}

        {/* Archive (for produced products) */}
        {!product?.archived && productProduced && (
          confirmDelete ? (
            <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Archive className="w-4 h-4 text-muted-foreground shrink-0" />
                <p className="text-sm font-medium">Archive this product?</p>
              </div>
              <p className="text-xs text-muted-foreground">This product has been used in production and cannot be deleted. Archiving will hide it from lists but preserve it for production history.</p>
              <div className="flex gap-2">
                <button
                  onClick={async () => { await archiveProduct(productId); router.replace("/products"); }}
                  className="btn-primary px-4 py-2 text-sm"
                >
                  Yes, archive product
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="btn-secondary px-4 py-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Archive className="w-4 h-4" /> Archive product
            </button>
          )
        )}

        {/* Delete (only for non-archived, non-produced products) */}
        {!product?.archived && !productProduced && (
          confirmDelete ? (
            <div className="rounded-[4px] border border-destructive/30 bg-destructive/5 p-4 space-y-3">
              <p className="text-sm font-medium text-destructive">Delete this product?</p>
              <p className="text-xs text-muted-foreground">This will permanently remove the product and all its filling assignments. This cannot be undone.</p>
              <div className="flex gap-2">
                <button
                  onClick={async () => { await deleteProduct(productId); router.replace("/products"); }}
                  className="inline-flex items-center justify-center rounded-[4px] bg-destructive text-white px-4 py-2 text-sm font-medium transition-colors hover:bg-destructive/90"
                >
                  Yes, delete product
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="btn-secondary px-4 py-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="w-4 h-4" /> Delete product
            </button>
          )
        )}
      </div>

      </>
      )}
    </div>
  );
}

// Phase A.3 — Filling history tab. Sub-pills (All / Active / Past) + search +
// paginated ListRow per batch (label · filling · date / qty produced/used/remaining /
// status chip + Open batch).
function ProductFillingHistorySection({ productId }: { productId: string }) {
  const planProducts = usePlanProductsForProduct(productId);
  const allPlans = useProductionPlans();
  const productFillings = useProductFillings(productId);
  const allFillings = useFillings();
  const [subTab, setSubTab] = useState<"all" | "active" | "past">("all");
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(30);

  const planMap = useMemo(() => new Map(allPlans.map((p) => [p.id!, p])), [allPlans]);
  const fillingMap = useMemo(() => new Map(allFillings.map((f) => [f.id!, f])), [allFillings]);
  const fillingLabel = useMemo(() => {
    const names = productFillings
      .map((pf) => fillingMap.get(pf.fillingId)?.name)
      .filter((n): n is string => Boolean(n));
    return names.join(" + ") || "—";
  }, [productFillings, fillingMap]);

  const rows = useMemo(() => {
    return planProducts
      .map((pb) => {
        const plan = planMap.get(pb.planId);
        return plan ? { pb, plan } : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => {
        const aT = a.plan.completedAt ?? a.plan.createdAt;
        const bT = b.plan.completedAt ?? b.plan.createdAt;
        return new Date(bT).getTime() - new Date(aT).getTime();
      });
  }, [planProducts, planMap]);

  const counts = useMemo(() => {
    let active = 0, past = 0;
    for (const r of rows) {
      const s = r.plan.status;
      if (s === "done" || s === "cancelled" || s === "orphaned") past++;
      else active++;
    }
    return { all: rows.length, active, past };
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (subTab === "active") {
      list = list.filter((r) => r.plan.status === "draft" || r.plan.status === "active");
    } else if (subTab === "past") {
      list = list.filter((r) => r.plan.status === "done" || r.plan.status === "cancelled" || r.plan.status === "orphaned");
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) =>
        (r.plan.name?.toLowerCase().includes(q) ||
          r.plan.batchNumber?.toLowerCase().includes(q) ||
          fillingLabel.toLowerCase().includes(q))
      );
    }
    return list;
  }, [rows, subTab, search, fillingLabel]);

  const shown = filtered.slice(0, visible);

  if (rows.length === 0) {
    return (
      <div className="px-4 pb-8">
        <p style={{ fontStyle: "italic", color: "var(--ds-text-muted)", textAlign: "center", padding: "40px 0" }}>
          No batches yet
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-8" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, justifyContent: "space-between" }}>
        <DsTabNav
          variant="pills"
          tabs={[
            { id: "all", label: "All", count: counts.all },
            { id: "active", label: "Active", count: counts.active },
            { id: "past", label: "Past", count: counts.past },
          ]}
          activeTab={subTab}
          onChange={(id) => { setSubTab(id as "all" | "active" | "past"); setVisible(30); }}
        />
        <div
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "4px 10px",
            border: "0.5px solid var(--ds-border-warm)",
            background: "var(--ds-card-bg)",
            borderRadius: 14,
            minWidth: 200,
            flex: "0 1 320px",
          }}
        >
          <Search size={13} stroke={1.5} style={{ color: "var(--ds-text-muted)" }} />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setVisible(30); }}
            placeholder="Search batch label or filling…"
            style={{ fontSize: 12, border: "none", background: "transparent", outline: "none", flex: 1, color: "var(--ds-text-primary)" }}
          />
        </div>
      </div>

      <Section title="Batches" noBody>
        {shown.length === 0 ? (
          <p style={{ fontStyle: "italic", color: "var(--ds-text-muted)", textAlign: "center", padding: "32px 0" }}>
            No batches match
          </p>
        ) : (
          shown.map(({ pb, plan }) => {
            const produced = pb.actualYield ?? 0;
            const remaining = pb.currentStock ?? produced;
            const used = Math.max(0, produced - remaining);
            const date = new Date(plan.completedAt ?? plan.createdAt);
            const dateStr = date.toLocaleDateString("de-AT", { day: "numeric", month: "short", year: "numeric" });
            const isDone = plan.status === "done";
            const isCancelled = plan.status === "cancelled" || plan.status === "orphaned";
            const chipKind: StatusTagKind = isDone ? "done" : isCancelled ? "overdue" : "scheduled";
            const chipLabel = isDone ? "Done" : isCancelled ? "Scrapped" : "Active";
            const href = isDone
              ? `/production/${plan.id}/summary?from=${encodeURIComponent(`/products/${productId}?tab=fillingHistory`)}`
              : `/production/${plan.id}?from=${encodeURIComponent(`/products/${productId}?tab=fillingHistory`)}`;
            return (
              <ListRow
                key={pb.id}
                title={
                  <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
                    {plan.batchNumber && (
                      <span style={{ fontFamily: "ui-monospace, SF Mono, monospace", fontSize: 10, padding: "1px 6px", borderRadius: 4, color: "var(--ds-text-muted)", border: "0.5px solid var(--ds-border-warm)" }}>{plan.batchNumber}</span>
                    )}
                    <span className="serif" style={{ fontSize: 14 }}>{plan.name}</span>
                  </span>
                }
                meta={
                  <span style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                    <span>{fillingLabel}</span>
                    <span>{dateStr}</span>
                  </span>
                }
                secondary={
                  <span style={{ display: "flex", gap: 14, flexWrap: "wrap", fontVariantNumeric: "tabular-nums" }}>
                    <span>Produced <strong style={{ color: "var(--ds-text-primary)" }}>{produced}</strong></span>
                    <span>Used <strong style={{ color: "var(--ds-text-primary)" }}>{used}</strong></span>
                    <span>Remaining <strong style={{ color: "var(--ds-text-primary)" }}>{remaining}</strong></span>
                  </span>
                }
                side={
                  <>
                    <StatusTag kind={chipKind}>{chipLabel}</StatusTag>
                    <Link href={href} style={{ fontSize: 11, color: "var(--ds-tier-quarter-focus)", display: "inline-flex", alignItems: "center", gap: 2 }}>
                      Open batch <ChevronRight className="w-3 h-3" />
                    </Link>
                  </>
                }
              />
            );
          })
        )}
      </Section>

      {filtered.length > visible && (
        <div style={{ display: "flex", justifyContent: "center" }}>
          <button
            type="button"
            onClick={() => setVisible((v) => v + 30)}
            style={{
              padding: "6px 16px", fontSize: 12,
              border: "0.5px solid var(--ds-border-warm)",
              background: "var(--ds-card-bg)",
              color: "var(--ds-text-primary)",
              borderRadius: 14, cursor: "pointer",
            }}
          >
            Load more · {filtered.length - visible} remaining
          </button>
        </div>
      )}
    </div>
  );
}

function batchDateInputStyle(): React.CSSProperties {
  return {
    padding: "3px 8px",
    fontSize: 11,
    border: "0.5px solid var(--ds-border-warm)",
    background: "var(--ds-card-bg)",
    color: "var(--ds-text-primary)",
    borderRadius: 12,
    outline: "none",
    fontFamily: "inherit",
  };
}

// Phase A.4 — Batches tab. 3-col grid (auto-fill min 260px), card per batch with
// colored left border by status, filter pills + date range toolbar.
function BatchHistoryTab({ productId }: { productId: string }) {
  const planProducts = usePlanProductsForProduct(productId);
  const allPlans = useProductionPlans();
  const moulds = useMouldsList(true);
  const [filter, setFilter] = useState<"all" | "active" | "done" | "cancelled">("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const planMap = useMemo(() => new Map(allPlans.map((p) => [p.id!, p])), [allPlans]);
  const mouldMap = useMemo(() => new Map(moulds.map((m) => [m.id!, m])), [moulds]);

  const all = useMemo(() => {
    return planProducts
      .map((pb) => {
        const plan = planMap.get(pb.planId);
        if (!plan) return null;
        const mould = mouldMap.get(pb.mouldId);
        return { pb, plan, mould };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => {
        const aT = a.plan.completedAt ?? a.plan.createdAt;
        const bT = b.plan.completedAt ?? b.plan.createdAt;
        return new Date(bT).getTime() - new Date(aT).getTime();
      });
  }, [planProducts, planMap, mouldMap]);

  const counts = useMemo(() => {
    let active = 0, done = 0, cancelled = 0;
    for (const r of all) {
      const s = r.plan.status;
      if (s === "done") done++;
      else if (s === "cancelled" || s === "orphaned") cancelled++;
      else active++;
    }
    return { all: all.length, active, done, cancelled };
  }, [all]);

  const fromMs = fromDate ? new Date(fromDate + "T00:00:00").getTime() : null;
  const toMs = toDate ? new Date(toDate + "T23:59:59").getTime() : null;

  const filtered = useMemo(() => {
    return all.filter((r) => {
      const s = r.plan.status;
      if (filter === "active" && !(s === "draft" || s === "active")) return false;
      if (filter === "done" && s !== "done") return false;
      if (filter === "cancelled" && !(s === "cancelled" || s === "orphaned")) return false;
      const ms = new Date(r.plan.completedAt ?? r.plan.createdAt).getTime();
      if (fromMs !== null && ms < fromMs) return false;
      if (toMs !== null && ms > toMs) return false;
      return true;
    });
  }, [all, filter, fromMs, toMs]);

  if (all.length === 0) {
    return (
      <div className="px-4 pb-8">
        <p style={{ fontStyle: "italic", color: "var(--ds-text-muted)", textAlign: "center", padding: "40px 0" }}>
          No batches yet
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-8" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <DsTabNav
          variant="pills"
          tabs={[
            { id: "all", label: "All", count: counts.all },
            { id: "active", label: "Active", count: counts.active },
            { id: "done", label: "Done", count: counts.done },
            { id: "cancelled", label: "Cancelled", count: counts.cancelled },
          ]}
          activeTab={filter}
          onChange={(id) => setFilter(id as "all" | "active" | "done" | "cancelled")}
        />
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            style={batchDateInputStyle()}
            aria-label="From date"
          />
          <span style={{ color: "var(--ds-text-muted)", fontSize: 11 }}>→</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            style={batchDateInputStyle()}
            aria-label="To date"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p style={{ fontStyle: "italic", color: "var(--ds-text-muted)", textAlign: "center", padding: "40px 0" }}>
          No batches match
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          }}
        >
          {filtered.map(({ pb, plan, mould }) => {
            const status = plan.status;
            const isDone = status === "done";
            const isCancelled = status === "cancelled" || status === "orphaned";
            const isActive = status === "active";
            // Spec: mint done / caramel in_production / blush pending / rose cancelled.
            const borderColor = isDone
              ? "var(--ds-tier-positive)"
              : isActive
              ? "var(--ds-tier-north-star)"
              : isCancelled
              ? "var(--ds-tier-urgent)"
              : "var(--ds-tier-active)";
            const chipKind: StatusTagKind = isDone
              ? "done"
              : isCancelled
              ? "overdue"
              : isActive
              ? "scheduled"
              : "pending";
            const chipLabel = isDone ? "Done" : isCancelled ? "Cancelled" : isActive ? "Active" : "Pending";
            const date = new Date(plan.completedAt ?? plan.createdAt);
            const dateStr = date.toLocaleDateString("de-AT", { day: "numeric", month: "short", year: "numeric" });
            const productCount = pb.actualYield ?? (mould ? mould.numberOfCavities * pb.quantity : null);
            const href = isDone
              ? `/production/${plan.id}/summary?from=${encodeURIComponent(`/products/${productId}?tab=batches`)}`
              : `/production/${plan.id}?from=${encodeURIComponent(`/products/${productId}?tab=batches`)}`;
            return (
              <article
                key={pb.id}
                style={{
                  background: "var(--ds-card-bg)",
                  border: "0.5px solid var(--ds-border-warm)",
                  borderLeft: `3px solid ${borderColor}`,
                  borderRadius: 8,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                <header style={{ padding: "12px 16px 10px", borderBottom: "0.5px solid var(--ds-border-warm)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    {plan.batchNumber && (
                      <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 10, color: "var(--ds-text-muted)" }}>
                        {plan.batchNumber}
                      </div>
                    )}
                    <h3 className="serif" style={{ fontSize: 15, margin: "2px 0 0", lineHeight: 1.2 }}>{plan.name}</h3>
                    <div style={{ fontSize: 11, color: "var(--ds-text-muted)", marginTop: 4 }}>{dateStr}</div>
                  </div>
                  <StatusTag kind={chipKind}>{chipLabel}</StatusTag>
                </header>

                <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ds-text-primary)", flex: 1 }}>
                  <div style={{ fontVariantNumeric: "tabular-nums" }}>
                    <strong>{pb.quantity}</strong> mould{pb.quantity !== 1 ? "s" : ""}
                    {productCount !== null && (
                      <span style={{ color: "var(--ds-text-muted)" }}> · {productCount} pieces</span>
                    )}
                  </div>
                  <div style={{ color: "var(--ds-text-muted)" }}>
                    {mould ? mould.name : "No mould"}
                  </div>
                </div>

                <footer style={{ padding: "8px 16px", borderTop: "0.5px solid var(--ds-border-warm)" }}>
                  <Link href={href} style={{ fontSize: 12, color: "var(--ds-tier-quarter-focus)", display: "inline-flex", alignItems: "center", gap: 2 }}>
                    Open day <ChevronRight className="w-3 h-3" />
                  </Link>
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Cost Tab ---

function ProductCostTab({
  productId,
  product,
  productFillings,
  allMoulds,
  sym = "€",
}: {
  productId: string;
  product: { defaultMouldId?: string; shellIngredientId?: string | null; name: string };
  productFillings: import("@/types").ProductFilling[];
  allMoulds: import("@/types").Mould[];
  sym?: string;
}) {
  const snapshots = useProductCostSnapshots(productId);
  const latest = useLatestProductCostSnapshot(productId);
  const allIngredients = useIngredients();
  const fillingIds = productFillings.map((rl) => rl.fillingId);
  const fillingIngredientsMap = useFillingIngredientsForFillings(fillingIds);
  const allFillings = useFillings();

  const [recalculating, setRecalculating] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [sortKey, setSortKey] = useState<"layer" | "ingredient" | "grams" | "costPerGram" | "subtotal" | "pct">("subtotal");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [breakdownView, setBreakdownView] = useState<"grouped" | "flat">("grouped");
  const [collapsedLayers, setCollapsedLayers] = useState<Set<string>>(new Set());

  const mould = allMoulds.find((m) => m.id === product.defaultMouldId);
  const hasMould = !!mould;

  const ingredientsMap = new Map(allIngredients.map((i) => [i.id!, i]));
  const shellIngredient = product.shellIngredientId ? ingredientsMap.get(product.shellIngredientId) : undefined;
  const hasShell = !!shellIngredient;
  const shellPriced = hasShell && costPerGram(shellIngredient) !== null;
  const fillingsMap = new Map(allFillings.map((l) => [l.id!, l]));

  // Ingredients used in this product that have no pricing (and aren't marked irrelevant)
  const missingPricingIngredients = useMemo(() => {
    const names = new Set<string>();
    for (const rl of productFillings) {
      const lis = fillingIngredientsMap.get(rl.fillingId) ?? [];
      for (const li of lis) {
        if (!li.ingredientId) continue;
        const ing = ingredientsMap.get(li.ingredientId);
        if (ing && costPerGram(ing) === null) names.add(ing.name);
      }
    }
    return Array.from(names);
  }, [productFillings, fillingIngredientsMap, ingredientsMap]);

  const latestBreakdown: BreakdownEntry[] = latest
    ? enrichBreakdownLabels(deserializeBreakdown(latest.breakdown), ingredientsMap, fillingsMap)
    : [];

  const totalCost = useMemo(() => latestBreakdown.reduce((s, e) => s + e.subtotal, 0), [latestBreakdown]);

  function handleSort(key: "layer" | "ingredient" | "grams" | "costPerGram" | "subtotal" | "pct") {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  // Split each breakdown row into layer + ingredient parts so both can be columns.
  // Shell/cap rows share the synthetic layer id "__shell__"; their ingredient label
  // is extracted from "Shell (chocolate name)".
  const enrichedBreakdown = useMemo(() => {
    return latestBreakdown.map(e => {
      const pct = totalCost > 0 ? e.subtotal / totalCost : 0;
      if (e.kind === "shell" || e.kind === "cap") {
        // Legacy snapshots emit separate shell + cap rows; the current cost engine
        // combines them into a single "shell" row. Treat both as shell-like here so
        // old data renders with a real layer/ingredient name instead of "Unknown".
        const labelPrefix = e.kind === "cap" ? "Cap" : "Shell";
        const re = new RegExp(`^${labelPrefix}\\s*\\((.+)\\)\\s*$`);
        const m = re.exec(e.label);
        const ingredientName = m ? m[1] : e.label.replace(new RegExp(`^${labelPrefix}\\s*`), "") || "chocolate";
        return { ...e, pct, layerId: "__shell__", layerName: "Shell", ingredientName };
      }
      const filling = e.fillingId ? fillingsMap.get(e.fillingId) : undefined;
      const ingredient = e.ingredientId ? ingredientsMap.get(e.ingredientId) : undefined;
      return {
        ...e,
        pct,
        layerId: e.fillingId ?? "__unknown__",
        layerName: filling?.name ?? "Unknown layer",
        ingredientName: ingredient?.name ?? "Unknown ingredient",
      };
    });
  }, [latestBreakdown, totalCost, fillingsMap, ingredientsMap]);

  // Flat view merges rows by ingredient: if butter is used in multiple layers,
  // a single row sums the weight + subtotal and lists all source layers.
  // Shell entries stay separate (no ingredientId) and key on their own name.
  const mergedBreakdown = useMemo(() => {
    type Merged = {
      key: string;
      ingredientName: string;
      layerNames: string[];
      grams: number;
      subtotal: number;
      pct: number;
      costPerGram: number;
      isShell: boolean;
    };
    const merged = new Map<string, Merged>();
    for (const row of enrichedBreakdown) {
      const isShellLike = row.kind === "shell" || row.kind === "cap";
      const key = isShellLike ? `__shell__:${row.ingredientName}` : (row.ingredientId ?? `__ing__:${row.ingredientName}`);
      const existing = merged.get(key);
      if (existing) {
        existing.grams += row.grams;
        existing.subtotal += row.subtotal;
        existing.pct += row.pct;
        if (!existing.layerNames.includes(row.layerName)) existing.layerNames.push(row.layerName);
      } else {
        merged.set(key, {
          key,
          ingredientName: row.ingredientName,
          layerNames: [row.layerName],
          grams: row.grams,
          subtotal: row.subtotal,
          pct: row.pct,
          costPerGram: row.costPerGram,
          isShell: isShellLike,
        });
      }
    }
    return Array.from(merged.values());
  }, [enrichedBreakdown]);

  const sortedMergedBreakdown = useMemo(() => {
    return [...mergedBreakdown].sort((a, b) => {
      const mult = sortDir === "asc" ? 1 : -1;
      if (sortKey === "layer") {
        const byLayer = a.layerNames[0].localeCompare(b.layerNames[0]);
        return mult * (byLayer !== 0 ? byLayer : a.ingredientName.localeCompare(b.ingredientName));
      }
      if (sortKey === "ingredient") {
        const byIng = a.ingredientName.localeCompare(b.ingredientName);
        return mult * (byIng !== 0 ? byIng : a.layerNames[0].localeCompare(b.layerNames[0]));
      }
      const diff: Record<string, number> = {
        grams: a.grams - b.grams,
        costPerGram: a.costPerGram - b.costPerGram,
        subtotal: a.subtotal - b.subtotal,
        pct: a.pct - b.pct,
      };
      return mult * (diff[sortKey] ?? 0);
    });
  }, [mergedBreakdown, sortKey, sortDir]);

  // Group by layer for the "Grouped" view. Layer order follows first appearance
  // in latestBreakdown so the visual order matches the product's filling order,
  // with Shell floating to the bottom.
  const groupedBreakdown = useMemo(() => {
    const groups = new Map<string, {
      layerId: string;
      layerName: string;
      rows: typeof enrichedBreakdown;
      weight: number;
      subtotal: number;
      pct: number;
    }>();
    for (const row of enrichedBreakdown) {
      const existing = groups.get(row.layerId);
      if (existing) {
        existing.rows.push(row);
        existing.weight += row.grams;
        existing.subtotal += row.subtotal;
        existing.pct += row.pct;
      } else {
        groups.set(row.layerId, {
          layerId: row.layerId,
          layerName: row.layerName,
          rows: [row],
          weight: row.grams,
          subtotal: row.subtotal,
          pct: row.pct,
        });
      }
    }
    // Legacy snapshots emit separate shell + cap rows. Collapse them into a single
    // row per ingredient so the Shell group matches the current engine's output.
    const shellGroup = groups.get("__shell__");
    if (shellGroup && shellGroup.rows.length > 1) {
      const byIngredient = new Map<string, typeof shellGroup.rows[number]>();
      for (const row of shellGroup.rows) {
        const existing = byIngredient.get(row.ingredientName);
        if (existing) {
          existing.grams += row.grams;
          existing.subtotal += row.subtotal;
          existing.pct += row.pct;
        } else {
          byIngredient.set(row.ingredientName, { ...row });
        }
      }
      shellGroup.rows = Array.from(byIngredient.values());
    }
    const arr = Array.from(groups.values());
    // Push Shell to the bottom; preserve filling insertion order for the rest.
    return arr.sort((a, b) => {
      if (a.layerId === "__shell__") return 1;
      if (b.layerId === "__shell__") return -1;
      return 0;
    });
  }, [enrichedBreakdown]);

  function toggleLayer(layerId: string) {
    setCollapsedLayers(prev => {
      const next = new Set(prev);
      if (next.has(layerId)) next.delete(layerId);
      else next.add(layerId);
      return next;
    });
  }

  // Chronological for chart, newest-first for change log
  const chronological = [...snapshots].reverse();
  const displayedHistory = showAllHistory ? snapshots : snapshots.slice(0, 10);

  async function handleRecalculate() {
    setRecalculating(true);
    try {
      await recalculateProductCost(productId);
    } finally {
      setRecalculating(false);
    }
  }

  return (
    <div className="px-4 pb-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          {latest ? (
            <div>
              <p className="text-2xl font-bold text-primary">{formatCost(latest.costPerProduct, sym)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">per product · 1 cavity</p>
            </div>
          ) : (
            <div>
              <p className="text-lg font-medium text-muted-foreground">No cost data yet</p>
              <p className="text-xs text-muted-foreground mt-0.5">Click Recalculate to compute</p>
            </div>
          )}
          <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
            {mould && <span>Mould: {mould.name} ({mould.cavityWeightG}g)</span>}
            {shellIngredient && <span>Shell: {shellIngredient.name}</span>}
          </div>
        </div>
        <button
          onClick={handleRecalculate}
          disabled={recalculating}
          className="flex items-center gap-1.5 rounded-[4px] border border-[color:var(--ds-border-warm)] px-3 py-2 text-sm hover:bg-muted transition-colors disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${recalculating ? "animate-spin" : ""}`} />
          Recalculate
        </button>
      </div>

      {/* Warnings */}
      {!hasMould && (
        <div className="flex items-start gap-2 rounded-[6px] bg-status-warn-bg border border-status-warn-edge px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-status-warn shrink-0 mt-0.5" />
          <p className="text-xs text-status-warn">
            Set a <strong>default mould</strong> on this product to enable cost calculation.
          </p>
        </div>
      )}
      {hasMould && !hasShell && (
        <div className="flex items-start gap-2 rounded-[6px] bg-status-warn-bg border border-status-warn-edge px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-status-warn shrink-0 mt-0.5" />
          <p className="text-xs text-status-warn">
            No shell chocolate set — shell and cap costs are excluded. Pick one on the
            <strong> Shell</strong> tab.
          </p>
        </div>
      )}
      {hasMould && hasShell && !shellPriced && (
        <div className="flex items-start gap-2 rounded-[6px] bg-status-warn-bg border border-status-warn-edge px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-status-warn shrink-0 mt-0.5" />
          <p className="text-xs text-status-warn">
            Shell chocolate <strong>{shellIngredient!.name}</strong> has no pricing data —
            shell and cap costs are excluded until its pricing is set.
          </p>
        </div>
      )}
      {missingPricingIngredients.length > 0 && (
        <div className="flex items-start gap-2 rounded-[6px] bg-status-warn-bg border border-status-warn-edge px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-status-warn shrink-0 mt-0.5" />
          <div className="text-xs text-status-warn">
            <p><strong>{missingPricingIngredients.length} ingredient{missingPricingIngredients.length > 1 ? "s" : ""}</strong> have no pricing data — cost may be understated:</p>
            <p className="mt-0.5 text-status-warn">{missingPricingIngredients.join(", ")}</p>
          </div>
        </div>
      )}

      {/* Chart */}
      {chronological.length >= 2 && (
        <div>
          <h2 className="text-sm font-semibold text-primary mb-2">Cost over time</h2>
          <CostHistoryChart snapshots={chronological} sym={sym} />
        </div>
      )}

      {/* Breakdown */}
      {latestBreakdown.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2 gap-3">
            <h2 className="text-sm font-semibold text-primary">Current breakdown</h2>
            <div className="inline-flex rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-0.5 text-xs">
              <button
                onClick={() => setBreakdownView("grouped")}
                className={`px-2.5 py-1 rounded transition-colors ${breakdownView === "grouped" ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}
              >
                By layer
              </button>
              <button
                onClick={() => setBreakdownView("flat")}
                className={`px-2.5 py-1 rounded transition-colors ${breakdownView === "flat" ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}
              >
                Sortable
              </button>
            </div>
          </div>

          {breakdownView === "grouped" ? (
            <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] overflow-hidden">
              {groupedBreakdown.map((group, gi) => {
                const collapsed = collapsedLayers.has(group.layerId);
                return (
                  <div key={group.layerId} className={gi > 0 ? "border-t border-[color:var(--ds-border-warm)]" : ""}>
                    <button
                      onClick={() => toggleLayer(group.layerId)}
                      className="w-full grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 px-3 py-2.5 bg-muted hover:bg-muted transition-colors text-left"
                    >
                      <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${collapsed ? "" : "rotate-90"}`} />
                      <span className="text-sm font-medium">{group.layerName}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{group.weight.toFixed(2)}g</span>
                      <div className="flex items-center gap-1.5 min-w-[4.5rem] justify-end">
                        <div className="h-1 w-12 rounded-[4px] bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-status-warn-edge"
                            style={{ width: `${group.pct * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">{(group.pct * 100).toFixed(1)}%</span>
                      </div>
                      <span className="text-sm font-semibold text-primary tabular-nums">{formatCost(group.subtotal, sym)}</span>
                    </button>
                    {!collapsed && (
                      <ul className="divide-y divide-border">
                        {group.rows.map((row, ri) => (
                          <li key={ri} className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 px-3 py-1.5 pl-9 hover:bg-muted/20 transition-colors">
                            <span />
                            <span className="text-xs">{row.ingredientName}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">{row.grams.toFixed(2)}g</span>
                            <span className="text-xs text-muted-foreground tabular-nums w-[4.5rem] text-right">{sym}{row.costPerGram.toFixed(4)}/g</span>
                            <span className="text-xs font-medium tabular-nums">{formatCost(row.subtotal, sym)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
              <div className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 px-3 py-2.5 border-t border-[color:var(--ds-border-warm)] bg-muted">
                <span />
                <span className="text-sm font-semibold">Total</span>
                <span />
                <span />
                <span className="text-sm font-bold text-primary tabular-nums">{formatCost(totalCost, sym)}</span>
              </div>
            </div>
          ) : (
            <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[color:var(--ds-border-warm)] bg-muted">
                    <th
                      className="text-left px-3 py-2 text-xs font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                      onClick={() => handleSort("layer")}
                    >
                      Layer{sortKey === "layer" && <span className="ml-0.5 opacity-60">{sortDir === "desc" ? "↓" : "↑"}</span>}
                    </th>
                    <th
                      className="text-left px-3 py-2 text-xs font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                      onClick={() => handleSort("ingredient")}
                    >
                      Ingredient{sortKey === "ingredient" && <span className="ml-0.5 opacity-60">{sortDir === "desc" ? "↓" : "↑"}</span>}
                    </th>
                    <th
                      className="text-right px-3 py-2 text-xs font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                      onClick={() => handleSort("grams")}
                    >
                      Weight{sortKey === "grams" && <span className="ml-0.5 opacity-60">{sortDir === "desc" ? "↓" : "↑"}</span>}
                    </th>
                    <th
                      className="text-right px-3 py-2 text-xs font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                      onClick={() => handleSort("costPerGram")}
                    >
                      {sym}/g{sortKey === "costPerGram" && <span className="ml-0.5 opacity-60">{sortDir === "desc" ? "↓" : "↑"}</span>}
                    </th>
                    <th
                      className="text-right px-3 py-2 text-xs font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                      onClick={() => handleSort("pct")}
                    >
                      % cost{sortKey === "pct" && <span className="ml-0.5 opacity-60">{sortDir === "desc" ? "↓" : "↑"}</span>}
                    </th>
                    <th
                      className="text-right px-3 py-2 text-xs font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                      onClick={() => handleSort("subtotal")}
                    >
                      Subtotal{sortKey === "subtotal" && <span className="ml-0.5 opacity-60">{sortDir === "desc" ? "↓" : "↑"}</span>}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sortedMergedBreakdown.map((entry, i) => (
                    <tr key={i} className="hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-2 text-xs">
                        <div className="flex flex-wrap gap-1">
                          {entry.layerNames.map((name, li) => (
                            <span key={li} className="inline-flex items-center rounded-[4px] border border-[color:var(--ds-border-warm)] bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                              {name}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs">{entry.ingredientName}</td>
                      <td className="px-3 py-2 text-xs text-right text-muted-foreground tabular-nums">{entry.grams.toFixed(2)}g</td>
                      <td className="px-3 py-2 text-xs text-right text-muted-foreground tabular-nums">{entry.costPerGram.toFixed(4)}</td>
                      <td className="px-3 py-2 text-xs text-right">
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-muted-foreground tabular-nums">{(entry.pct * 100).toFixed(1)}%</span>
                          <div className="h-1 w-10 rounded-[4px] bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-status-warn-edge"
                              style={{ width: `${entry.pct * 100}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-right font-medium tabular-nums">{formatCost(entry.subtotal, sym)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-[color:var(--ds-border-warm)] bg-muted">
                    <td colSpan={5} className="px-3 py-2 text-xs font-semibold">Total</td>
                    <td className="px-3 py-2 text-xs text-right font-bold text-primary tabular-nums">
                      {formatCost(totalCost, sym)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {latest && (
            <p className="text-xs text-muted-foreground mt-1.5">
              Calculated {new Date(latest.recordedAt).toLocaleDateString("de-AT", { day: "numeric", month: "short", year: "numeric" })}
              {" · "}{latest.triggerDetail}
            </p>
          )}
        </div>
      )}

      {/* Change log */}
      {snapshots.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-primary mb-2">Change history</h2>
          <ul className="space-y-1.5">
            {displayedHistory.map((snap, i) => {
              const prev = snapshots[i + 1];
              const delta = prev ? costDelta(snap.costPerProduct, prev.costPerProduct, sym) : null;
              return (
                <li key={snap.id} className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{formatCost(snap.costPerProduct, sym)}</span>
                    <div className="flex items-center gap-2">
                      {delta && (
                        <span className={`text-xs font-medium ${delta.positive ? "text-status-alert" : "text-status-ok"}`}>
                          {delta.label}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {new Date(snap.recordedAt).toLocaleDateString("de-AT", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{snap.triggerDetail}</p>
                  <div className="flex gap-2 mt-0.5 text-xs text-muted-foreground">
                    {snap.mouldId && snap.mouldId !== product.defaultMouldId && (
                      <span>Mould: {allMoulds.find((m) => m.id === snap.mouldId)?.name ?? `#${snap.mouldId}`}</span>
                    )}
                    {snap.coatingName && <span className="capitalize">{snap.coatingName}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
          {snapshots.length > 10 && !showAllHistory && (
            <button
              onClick={() => setShowAllHistory(true)}
              className="mt-2 text-xs text-primary hover:underline"
            >
              Show all {snapshots.length} entries
            </button>
          )}
        </div>
      )}

      {snapshots.length === 0 && hasMould && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No cost history yet. Press Recalculate to create the first entry.
        </p>
      )}
    </div>
  );
}

// Minimal SVG line chart — no external deps
function CostHistoryChart({ snapshots, sym = "€" }: { snapshots: ProductCostSnapshot[]; sym?: string }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; snap: ProductCostSnapshot } | null>(null);

  if (snapshots.length < 2) return null;

  const W = 320;
  const H = 100;
  const PAD = { top: 8, right: 8, bottom: 20, left: 48 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const costs = snapshots.map((s) => s.costPerProduct);
  const times = snapshots.map((s) => new Date(s.recordedAt).getTime());
  const minCost = Math.min(...costs);
  const maxCost = Math.max(...costs);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);

  // Add vertical padding so data points don't sit flush at the chart edges
  const dataCostRange = maxCost - minCost || maxCost * 0.1 || 0.01;
  const vPad = dataCostRange * 0.25;
  const yMin = Math.max(0, minCost - vPad);
  const yMax = maxCost + vPad;
  const yRange = yMax - yMin;
  const timeRange = maxTime - minTime || 1;

  function toX(t: number) { return PAD.left + ((t - minTime) / timeRange) * innerW; }
  function toY(c: number) { return PAD.top + (1 - (c - yMin) / yRange) * innerH; }

  const points = snapshots.map((s) => `${toX(new Date(s.recordedAt).getTime())},${toY(s.costPerProduct)}`).join(" ");

  // 3 Y ticks: top data value, midpoint, bottom data value
  const yTicks = [maxCost, (minCost + maxCost) / 2, minCost];

  const triggerColors: Record<ProductCostSnapshot["triggerType"], string> = {
    ingredient_price: "#c2410c",  // orange
    filling_version: "#7c3aed",     // purple
    mould_change: "#0369a1",      // blue
    coating_change: "#065f46",    // green
    shell_change: "#b45309",      // amber
    manual: "#6b7280",            // grey
  };

  // Date labels: first and last
  const dateLabel = (t: number) => new Date(t).toLocaleDateString("de-AT", { day: "numeric", month: "short" });

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 120 }}
        onMouseLeave={() => setTooltip(null)}
      >
        {/* Y gridlines + labels */}
        {yTicks.map((tick, i) => {
          const y = toY(tick);
          return (
            <g key={i}>
              <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="#e5e7eb" strokeWidth={1} strokeDasharray={tick === minCost || tick === maxCost ? "none" : "3 3"} />
              <text x={PAD.left - 4} y={y} textAnchor="end" fontSize={9} fill="#9ca3af" dominantBaseline="middle">{formatCost(tick, sym)}</text>
            </g>
          );
        })}

        {/* Vertical axis line */}
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + innerH} stroke="#e5e7eb" strokeWidth={1} />

        {/* X axis date labels */}
        <text x={PAD.left} y={H - 4} textAnchor="start" fontSize={9} fill="#9ca3af">{dateLabel(minTime)}</text>
        <text x={W - PAD.right} y={H - 4} textAnchor="end" fontSize={9} fill="#9ca3af">{dateLabel(maxTime)}</text>

        {/* Line */}
        <polyline points={points} fill="none" stroke="var(--color-primary, #78350f)" strokeWidth={1.5} strokeLinejoin="round" />

        {/* Data points */}
        {snapshots.map((snap, i) => {
          const cx = toX(new Date(snap.recordedAt).getTime());
          const cy = toY(snap.costPerProduct);
          const color = triggerColors[snap.triggerType];
          return (
            <circle
              key={snap.id}
              cx={cx}
              cy={cy}
              r={4}
              fill={color}
              stroke="white"
              strokeWidth={1.5}
              className="cursor-pointer"
              onMouseEnter={(e) => {
                const svg = (e.target as SVGElement).closest("svg")!;
                const rect = svg.getBoundingClientRect();
                setTooltip({ x: cx, y: cy, snap });
              }}
            />
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
        {(Object.entries(triggerColors) as [ProductCostSnapshot["triggerType"], string][])
          .filter(([type]) => snapshots.some((s) => s.triggerType === type))
          .map(([type, color]) => (
            <span key={type} className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} />
              {{ ingredient_price: "ingredient price", filling_version: "filling updated", mould_change: "mould changed", coating_change: "coating changed", shell_change: "shell change", manual: "initial" }[type]}
            </span>
          ))}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute z-10 pointer-events-none rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] shadow-md px-2.5 py-1.5 text-xs"
          style={{
            left: Math.min(tooltip.x / W * 100, 70) + "%",
            top: (tooltip.y / 120 * 100) + "%",
            transform: "translate(-50%, -120%)",
          }}
        >
          <p className="font-semibold">{formatCost(tooltip.snap.costPerProduct, sym)}</p>
          <p className="text-muted-foreground">{new Date(tooltip.snap.recordedAt).toLocaleDateString("de-AT", { day: "numeric", month: "short", year: "numeric" })}</p>
          <p className="text-muted-foreground max-w-[160px] truncate">{tooltip.snap.triggerDetail}</p>
        </div>
      )}
    </div>
  );
}

// MaterialPicker lets the user search and select a DecorationMaterial to add to a step.
// When the typed name has no exact match, a "+ Create" row appears inline.
function MaterialPicker({
  allMaterials,
  excludeIds,
  onAdd,
  filterType,
  categoryLabels,
}: {
  allMaterials: DecorationMaterial[];
  excludeIds: string[];
  onAdd: (id: string) => void;
  filterType?: string;
  categoryLabels?: Map<string, string>;
}) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const trimmed = input.trim();

  const filtered = useMemo(() => {
    const query = trimmed.toLowerCase();
    return allMaterials
      .filter((m) => !excludeIds.includes(m.id!))
      .filter((m) => !filterType || m.type === filterType)
      .filter((m) => !query || m.name.toLowerCase().includes(query));
  }, [trimmed, allMaterials, excludeIds, filterType]);

  const exactMatch = trimmed
    ? allMaterials.some((m) => m.name.toLowerCase() === trimmed.toLowerCase())
    : false;
  const showCreate = !!trimmed && !exactMatch;
  const totalOptions = filtered.length + (showCreate ? 1 : 0);

  useEffect(() => { setHighlightIdx(-1); }, [input]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function select(material: DecorationMaterial) {
    onAdd(material.id!);
    setInput("");
    setOpen(false);
    setHighlightIdx(-1);
  }

  async function handleCreateNew() {
    if (!trimmed) return;
    const id = await saveDecorationMaterial({
      name: trimmed,
      type: "cocoa_butter",
      color: colorToCSS(trimmed),
    });
    onAdd(id);
    setInput("");
    setOpen(false);
    setHighlightIdx(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const showDropdown = !!trimmed && totalOptions > 0;
    if (!showDropdown) {
      if (e.key === "Escape") { setOpen(false); }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlightIdx((prev) => Math.min(prev + 1, totalOptions - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightIdx >= 0 && highlightIdx < filtered.length) {
        select(filtered[highlightIdx]);
      } else if (showCreate && highlightIdx === filtered.length) {
        handleCreateNew();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlightIdx(-1);
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        value={input}
        onChange={(e) => { setInput(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Search decoration materials…"
        className="input"
      />
      {open && (filtered.length > 0 || showCreate) && (
        <ul className="absolute z-20 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] shadow-lg">
          {filtered.map((m, idx) => (
            <li key={m.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(m)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                  idx === highlightIdx ? "bg-[color:var(--ds-tint-info)]" : "hover:bg-muted"
                }`}
              >
                <span
                  className="inline-block w-3.5 h-3.5 rounded-[4px] border border-black/10 shrink-0"
                  style={{ backgroundColor: m.color ?? "#9ca3af" }}
                />
                <span>{m.name} <span className="text-xs text-muted-foreground font-normal">· {categoryLabels?.get(m.type) ?? DECORATION_MATERIAL_TYPE_LABELS[m.type] ?? m.type}</span></span>
              </button>
            </li>
          ))}
          {showCreate && (
            <li>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleCreateNew}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors border-t border-[color:var(--ds-border-warm)] ${
                  highlightIdx === filtered.length ? "bg-[color:var(--ds-tint-info)] text-primary" : "hover:bg-muted text-muted-foreground"
                }`}
              >
                + Create <span className="font-medium text-foreground ml-1">"{trimmed}"</span>
                <span className="ml-auto text-xs">Cocoa Butter</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function ShellDesignSection({
  steps,
  onUpdate,
  readonly = false,
}: {
  steps: ShellDesignStep[];
  onUpdate: (steps: ShellDesignStep[]) => void;
  readonly?: boolean;
}) {
  const allMaterials = useDecorationMaterials();
  const materialsMap = useMemo(
    () => new Map(allMaterials.map((m) => [m.id!, m])),
    [allMaterials]
  );
  const shellDesigns = useShellDesigns();
  const categoryLabels = useDecorationCategoryLabels();

  function update(newSteps: ShellDesignStep[]) {
    onUpdate(newSteps);
  }

  function addStep() {
    const defaultTechnique = shellDesigns.length > 0 ? shellDesigns[0].name : (SHELL_TECHNIQUES[0] as string);
    const defaultApplyAt = shellDesigns.length > 0 ? normalizeApplyAt(shellDesigns[0].defaultApplyAt) : "colour";
    update([...steps, { technique: defaultTechnique, materialIds: [], notes: "", applyAt: defaultApplyAt }]);
  }

  function removeStep(i: number) {
    update(steps.filter((_, idx) => idx !== i));
  }

  function updateTechnique(i: number, technique: string) {
    update(steps.map((s, idx) => (idx === i ? { ...s, technique } : s)));
  }

  function addMaterial(stepIdx: number, materialId: string) {
    if (steps[stepIdx].materialIds.includes(materialId)) return;
    update(steps.map((s, i) =>
      i === stepIdx ? { ...s, materialIds: [...s.materialIds, materialId] } : s
    ));
  }

  function removeMaterial(stepIdx: number, materialId: string) {
    update(
      steps.map((s, i) =>
        i === stepIdx ? { ...s, materialIds: s.materialIds.filter((id) => id !== materialId) } : s
      )
    );
  }

  function updateNotes(i: number, notes: string) {
    update(steps.map((s, idx) => (idx === i ? { ...s, notes } : s)));
  }

  function updateApplyAt(i: number, applyAt: ShellDesignApplyAt) {
    update(steps.map((s, idx) => (idx === i ? { ...s, applyAt } : s)));
  }

  return (
    <div className="px-4 pb-6 border-t border-[color:var(--ds-border-warm)] pt-4 space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">Shell design</h2>

      {steps.length > 0 && (
        <ol className="space-y-3">
          {steps.map((step, i) => (
            <li key={i} className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-3 space-y-3">
              {/* Technique row */}
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-[4px] bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center shrink-0 select-none">
                  {i + 1}
                </span>
                {readonly ? (
                  <span className="text-sm font-medium">{step.technique}</span>
                ) : (
                  <>
                    <select
                      value={step.technique}
                      onChange={(e) => {
                        updateTechnique(i, e.target.value);
                        // Auto-set applyAt from the design's default when switching technique
                        const design = shellDesigns.find((d) => d.name === e.target.value);
                        if (design?.defaultApplyAt) {
                          updateApplyAt(i, normalizeApplyAt(design.defaultApplyAt));
                        }
                      }}
                      className="input"
                    >
                      {shellDesigns.map((d) => (
                        <option key={d.id} value={d.name}>{d.name}</option>
                      ))}
                      {/* Fallback for legacy techniques not in the DB */}
                      {shellDesigns.length === 0 && SHELL_TECHNIQUES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                      {shellDesigns.length > 0 && !shellDesigns.some((d) => d.name === step.technique) && (
                        <option value={step.technique}>{step.technique}</option>
                      )}
                    </select>
                    <button
                      onClick={() => removeStep(i)}
                      className="p-1 rounded-full hover:bg-muted transition-colors shrink-0"
                      aria-label="Remove step"
                    >
                      <X className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </>
                )}
              </div>

              {/* Decoration materials */}
              <div>
                <label className="label">Decoration materials</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {step.materialIds.map((id) => {
                    const m = materialsMap.get(id);
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 rounded-[4px] bg-[color:var(--ds-tint-info)] text-primary px-2.5 py-0.5 text-xs font-medium"
                      >
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-[4px] border border-black/10 shrink-0"
                          style={{ backgroundColor: m?.color ?? "#9ca3af" }}
                        />
                        {m?.name ?? id}
                        {m && (
                          <span className="text-primary/60 font-normal">· {categoryLabels.get(m.type) ?? DECORATION_MATERIAL_TYPE_LABELS[m.type] ?? m.type}</span>
                        )}
                        {!readonly && (
                          <button
                            onClick={() => removeMaterial(i, id)}
                            aria-label={`Remove ${m?.name ?? id}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
                {!readonly && (
                  <MaterialPicker
                    allMaterials={allMaterials}
                    excludeIds={step.materialIds}
                    onAdd={(id) => addMaterial(i, id)}
                    filterType={step.technique === "Transfer Sheet" ? "transfer_sheet" : undefined}
                    categoryLabels={categoryLabels}
                  />
                )}
              </div>

              {/* Apply timing */}
              {(() => {
                const isTransferSheet = step.materialIds.some(
                  (id) => materialsMap.get(id)?.type === "transfer_sheet"
                );
                const normalized = normalizeApplyAt(step.applyAt);
                const phaseLabel = DECORATION_APPLY_AT_OPTIONS.find((o) => o.value === normalized)?.label ?? normalized;
                if (readonly) {
                  if (isTransferSheet) {
                    return (
                      <p className="text-xs text-muted-foreground italic">Applied at capping (transfer sheet)</p>
                    );
                  }
                  if (normalized !== "colour") {
                    return (
                      <p className="text-xs text-muted-foreground italic">Applied during: {phaseLabel}</p>
                    );
                  }
                  return null;
                }
                if (isTransferSheet) {
                  return (
                    <p className="text-xs text-muted-foreground">
                      Applied at capping — transfer sheets are always placed during capping
                    </p>
                  );
                }
                return (
                  <div>
                    <label className="label">Apply when</label>
                    <select
                      value={normalized}
                      onChange={(e) => updateApplyAt(i, e.target.value as ShellDesignApplyAt)}
                      className="input"
                    >
                      {DECORATION_APPLY_AT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                );
              })()}

              {/* Notes */}
              {readonly ? (
                step.notes && <p className="text-xs text-muted-foreground">{step.notes}</p>
              ) : (
                <div>
                  <label className="label">Technique notes</label>
                  <input
                    type="text"
                    value={step.notes ?? ""}
                    onChange={(e) => updateNotes(i, e.target.value)}
                    placeholder="e.g. Use a soft brush, keep cocoa butter at 31°C…"
                    className="input"
                  />
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {!readonly && (
        <button
          onClick={addStep}
          className="flex items-center gap-1 text-xs text-primary font-medium"
          title="Add decoration step"
        >
          <Plus className="w-3.5 h-3.5" /> Add decoration step
        </button>
      )}
    </div>
  );
}

function SortableProductFillingRow({
  productFilling,
  fillMode,
  onRemove,
  onUpdatePercentage,
  onUpdateGrams,
}: {
  productFilling: ProductFilling;
  fillMode: FillMode;
  onRemove: () => void;
  onUpdatePercentage: (pct: number) => void;
  onUpdateGrams: (g: number) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: productFilling.id! });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} suppressHydrationWarning>
      <ProductFillingRow
        productFilling={productFilling}
        fillMode={fillMode}
        onRemove={onRemove}
        onUpdatePercentage={onUpdatePercentage}
        onUpdateGrams={onUpdateGrams}
        readonly={false}
        dragHandleListeners={listeners}
        dragHandleAttributes={attributes}
        isDragging={isDragging}
      />
    </div>
  );
}

function ProductFillingRow({
  productFilling,
  fillMode,
  onRemove,
  onUpdatePercentage,
  onUpdateGrams,
  readonly = false,
  dragHandleListeners,
  dragHandleAttributes,
  isDragging,
}: {
  productFilling: ProductFilling;
  fillMode: FillMode;
  onRemove: () => void;
  onUpdatePercentage: (pct: number) => void;
  onUpdateGrams: (g: number) => void;
  readonly?: boolean;
  dragHandleListeners?: SyntheticListenerMap;
  dragHandleAttributes?: DraggableAttributes;
  isDragging?: boolean;
}) {
  const filling = useFilling(productFilling.fillingId);
  const isGrams = fillMode === "grams";
  const [pctInput, setPctInput] = useState(String(productFilling.fillPercentage ?? 100));
  const [gramsInput, setGramsInput] = useState(String(productFilling.fillGrams ?? ""));
  const [focused, setFocused] = useState(false);
  const [pendingRemove, setPendingRemove] = useState(false);

  useEffect(() => {
    if (!focused) {
      setPctInput(String(productFilling.fillPercentage ?? 100));
      setGramsInput(String(productFilling.fillGrams ?? ""));
    }
  }, [productFilling.fillPercentage, productFilling.fillGrams, focused]);

  if (!filling) return null;

  function commitPercentage() {
    const val = parseInt(pctInput);
    if (!isNaN(val) && val > 0 && val <= 100) {
      onUpdatePercentage(val);
    } else {
      setPctInput(String(productFilling.fillPercentage ?? 100));
    }
  }

  function commitGrams() {
    const val = parseFloat(gramsInput);
    if (!isNaN(val) && val >= 0) {
      onUpdateGrams(val);
    } else {
      setGramsInput(String(productFilling.fillGrams ?? ""));
    }
  }

  return (
    <li className={`rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-3 flex items-start gap-2 ${isDragging ? "opacity-50" : ""}`}>
      {!readonly && (
        <button
          type="button"
          className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 mt-0.5 text-muted-foreground/40 hover:text-muted-foreground touch-none shrink-0"
          aria-label="Drag to reorder"
          suppressHydrationWarning
          {...dragHandleListeners}
          {...dragHandleAttributes}
        >
          <GripVertical className="w-4 h-4" />
        </button>
      )}
      <Link href={`/fillings/${encodeURIComponent(filling.id ?? '')}?from=products&fromId=${encodeURIComponent(productFilling.productId)}`} className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-sm">{filling.name}</h3>
          <span className="rounded-[4px] bg-[color:var(--ds-tint-info)] text-primary px-2 py-0.5 text-[10px] font-semibold shrink-0 tabular-nums">
            {isGrams ? `${productFilling.fillGrams ?? 0}g` : `${productFilling.fillPercentage ?? 100}%`}
          </span>
        </div>
        {(filling.category || filling.subcategory) && (
          <p className="text-xs text-primary/80 truncate">
            {filling.category}{filling.subcategory && ` › ${filling.subcategory}`}
          </p>
        )}
        {filling.description && (
          <p className="text-xs text-muted-foreground truncate">{filling.description}</p>
        )}
        {filling.allergens.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {filling.allergens.map((a) => (
              <span
                key={a}
                className="rounded-full bg-status-warn-bg text-status-warn border border-status-warn-edge px-2 py-0.5 text-[10px] font-medium"
              >
                {allergenLabel(a)}
              </span>
            ))}
          </div>
        )}
      </Link>
      {readonly ? (
        <span className="text-xs text-muted-foreground shrink-0">
          {isGrams ? `${productFilling.fillGrams ?? 0}g` : `${productFilling.fillPercentage ?? 100}%`}
        </span>
      ) : (
        <>
          <div className="flex items-center gap-1 shrink-0">
            {isGrams ? (
              <>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={gramsInput}
                  onChange={(e) => setGramsInput(e.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => { setFocused(false); commitGrams(); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
                  placeholder="0"
                  title="Grams of filling per cavity — shell % is derived from the mould's cavity weight minus the total fill grams."
                  className="input w-16 text-right"
                />
                <span className="text-xs text-muted-foreground">g</span>
              </>
            ) : (
              <>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={pctInput}
                  onChange={(e) => setPctInput(e.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => { setFocused(false); commitPercentage(); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
                  className="input w-14 text-right"
                />
                <span className="text-xs text-muted-foreground">%</span>
              </>
            )}
          </div>
          {pendingRemove ? (
            <span className="flex items-center gap-1.5 text-xs shrink-0">
              <span className="text-muted-foreground">Remove?</span>
              <button
                onClick={() => { onRemove(); setPendingRemove(false); }}
                className="text-status-alert font-medium hover:underline"
              >
                Yes
              </button>
              <button
                onClick={() => setPendingRemove(false)}
                className="text-muted-foreground hover:underline"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={() => setPendingRemove(true)}
              className="p-1 rounded-full hover:bg-muted transition-colors shrink-0"
              aria-label={`Remove ${filling.name}`}
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
        </>
      )}
    </li>
  );
}

// Distinct hues for up to 5 fillings — using Tailwind bg classes
const SEGMENT_COLORS = [
  "bg-primary",
  "bg-status-warn-edge",
  "bg-status-ok",
  "bg-violet-400",
  "bg-rose-400",
];

function FillBar({ productFillings }: { productFillings: { id?: string; fillingId: string; fillPercentage: number; fillingName: string }[] }) {
  const total = productFillings.reduce((s, bl) => s + (bl.fillPercentage ?? 0), 0);
  const isValid = total === 100;
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // Calculate left offset (%) for the tooltip anchor
  let offset = 0;
  const offsets = productFillings.map((bl) => {
    const mid = offset + (bl.fillPercentage ?? 0) / 2;
    offset += bl.fillPercentage ?? 0;
    return mid;
  });

  return (
    <div className="space-y-1.5">
      <div className="relative">
        {/* Tooltip */}
        {hoveredIdx !== null && (
          <div
            className="absolute -top-7 z-10 pointer-events-none"
            style={{ left: `${offsets[hoveredIdx]}%`, transform: "translateX(-50%)" }}
          >
            <div className="rounded bg-[color:var(--ds-tier-quarter-focus)] text-white text-[10px] font-medium px-1.5 py-0.5 whitespace-nowrap">
              {productFillings[hoveredIdx].fillingName} · {productFillings[hoveredIdx].fillPercentage}%
            </div>
          </div>
        )}
        <div className="flex rounded-full overflow-hidden h-3 gap-px bg-muted">
          {productFillings.map((bl, i) => {
            const pct = bl.fillPercentage ?? 0;
            return (
              <div
                key={bl.id}
                className={`${SEGMENT_COLORS[i % SEGMENT_COLORS.length]} transition-all cursor-default`}
                style={{ width: `${pct}%` }}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
                onTouchStart={() => setHoveredIdx(i)}
                onTouchEnd={() => setHoveredIdx(null)}
              />
            );
          })}
          {!isValid && total < 100 && (
            <div className="flex-1 bg-destructive/20" />
          )}
        </div>
      </div>
      {!isValid && (
        <p className="text-[10px] text-destructive font-medium">
          Fill percentages total {total}% — adjust to reach 100%
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nutrition tab — aggregated per-product and per-100g nutrition data
// ---------------------------------------------------------------------------

function ProductNutritionTab({ productId, productFillings, market }: { productId: string; productFillings: ProductFilling[]; market: MarketRegion }) {
  const product = useProduct(productId);
  const allIngredients = useIngredients(true);
  const allMoulds = useMouldsList(true);
  const fillingIds = useMemo(() => productFillings.map(rl => rl.fillingId), [productFillings]);
  const fillingIngredientsMap = useFillingIngredientsForFillings(fillingIds);

  const ingredientMap = useMemo(() => new Map(allIngredients.map(i => [i.id!, i])), [allIngredients]);
  const mould = allMoulds.find(m => m.id === product?.defaultMouldId);
  const shellIngredient = product?.shellIngredientId ? (ingredientMap.get(product.shellIngredientId) ?? null) : null;

  // In grams mode, derive shell percentage from fillGrams on the product fillings
  const effectiveShellPercentage = useMemo(() => {
    if (product?.fillMode === "grams" && mould) {
      const totalFillGrams = productFillings.reduce((sum, pf) => sum + (pf.fillGrams ?? 0), 0);
      return deriveShellPercentageFromGrams(mould.cavityWeightG, totalFillGrams, DENSITY_G_PER_ML);
    }
    return product?.shellPercentage ?? 37;
  }, [product?.fillMode, product?.shellPercentage, mould, productFillings]);

  const result = useMemo(
    () => calculateProductNutrition({
      mould: mould ?? null,
      productFillings,
      fillingIngredientsMap,
      ingredientMap,
      shellIngredient: shellIngredient ?? null,
      shellPercentage: effectiveShellPercentage,
    }),
    [mould, productFillings, fillingIngredientsMap, ingredientMap, shellIngredient, effectiveShellPercentage],
  );

  const ingredientList = useMemo(
    () => buildProductIngredientList({
      mould: mould ?? null,
      productFillings,
      fillingIngredientsMap,
      ingredientMap,
      shellIngredient: shellIngredient ?? null,
      shellPercentage: effectiveShellPercentage,
    }),
    [mould, productFillings, fillingIngredientsMap, ingredientMap, shellIngredient, effectiveShellPercentage],
  );

  const { per100g, perProduct, productWeightG, ingredientsWithData, ingredientsTotal, missingIngredients, warnings } = result;
  const nutrients = getNutrientsByMarket(market);
  const panelTitle = getNutritionPanelTitle(market);
  const showDV = market === "US";
  const showPerProduct = true; // always show per-product column
  // US also shows per-serving (RACC 30g for candy)
  const showPerServing = market === "US";
  const perServing = showPerServing ? scaleToServing(per100g, 30) : perProduct;

  const hasData = Object.keys(per100g).length > 0;

  if (!product) return null;

  if (productFillings.length === 0 && !shellIngredient) {
    return (
      <div className="px-4 pb-6">
        <p className="text-sm text-muted-foreground py-8 text-center">
          Add fillings to this product to see nutrition data.
        </p>
      </div>
    );
  }

  if (!mould) {
    return (
      <div className="px-4 pb-6">
        <p className="text-sm text-muted-foreground py-8 text-center">
          Set a default mould on this product to calculate per-product nutrition.
          The mould determines shell, cap, and fill weights.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-6">
      <h2 className="text-sm font-medium text-muted-foreground mb-1">{panelTitle}</h2>

      {warnings.map((w, i) => (
        <div key={i} className="flex items-start gap-2 text-xs text-[color:var(--ds-semantic-warn)] mb-1">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{w}</span>
        </div>
      ))}

      {hasData && ingredientsWithData < ingredientsTotal && (
        <div className="flex items-start gap-2 text-xs text-[color:var(--ds-semantic-warn)] mb-1">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            Nutrition data for {ingredientsWithData} of {ingredientsTotal} ingredients.
            Values are partial — add data to{" "}
            {missingIngredients.length > 0 ? (
              <>
                {missingIngredients.map((name, i) => (
                  <span key={name}>
                    {i > 0 && ", "}
                    <strong>{name}</strong>
                  </span>
                ))}
                {" "}for complete figures.
              </>
            ) : (
              "remaining ingredients for complete figures."
            )}
          </span>
        </div>
      )}

      {hasData ? (
        <>
          <p className="text-xs text-muted-foreground mb-3 mt-2">
            Product weight: {productWeightG.toFixed(1)}g
            {" "}(shell + cap: {mould ? (calculateShellWeightG(mould) + calculateCapWeightG(mould)).toFixed(1) : "?"}g
            {shellIngredient ? ` of ${shellIngredient.name}` : ""}
            {", "}fill: {mould ? (productWeightG - calculateShellWeightG(mould) - calculateCapWeightG(mould)).toFixed(1) : "?"}g)
            {showPerServing && " · FDA serving: 30g"}
          </p>

          {/* Nutrition table */}
      <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] overflow-hidden">
        {/* Header row */}
        <div className="flex items-center px-3 py-2 bg-muted border-b border-[color:var(--ds-border-warm)] text-xs font-semibold text-muted-foreground">
          <span className="flex-1">Nutrient</span>
          <span className="w-24 text-right">Per 100g</span>
          {showPerProduct && (
            <span className="w-24 text-right">Per product</span>
          )}
          {showPerServing && (
            <span className="w-24 text-right">Per serving</span>
          )}
          {showDV && (
            <span className="w-16 text-right">%DV</span>
          )}
        </div>

        {/* Nutrient rows */}
        {nutrients.map((n) => {
          const val100 = per100g[n.key];
          const valProduct = perProduct[n.key];
          const valServing = showPerServing ? perServing[n.key] : undefined;
          const dv = showDV ? percentDailyValue(valServing, n.dailyValue) : undefined;

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
              <span className={`w-24 text-right ${val100 == null ? "text-muted-foreground/50" : ""}`}>
                {formatNutrientValue(val100, n.unit)}
              </span>
              {showPerProduct && (
                <span className={`w-24 text-right ${valProduct == null ? "text-muted-foreground/50" : ""}`}>
                  {formatNutrientValue(valProduct, n.unit)}
                </span>
              )}
              {showPerServing && (
                <span className={`w-24 text-right ${valServing == null ? "text-muted-foreground/50" : ""}`}>
                  {formatNutrientValue(valServing, n.unit)}
                </span>
              )}
              {showDV && (
                <span className="w-16 text-right text-xs text-muted-foreground">
                  {dv != null ? `${dv}%` : ""}
                </span>
              )}
            </div>
          );
        })}
      </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground py-4">
          None of the ingredients in this product have nutrition data.
          Add nutrition values to your ingredients to see aggregated data here.
        </p>
      )}

      {/* Ingredient list — customer-facing label text */}
      <div className="mt-6">
        <h2 className="text-sm font-medium text-muted-foreground mb-1">Ingredients list</h2>
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell tab — read-only source-type badge (set in Product tab) + composition
// rollup + allergen chips. Inline-edit per A.2 spec; no edit-mode toggle.
// ---------------------------------------------------------------------------

function toGramsForComposition(amount: number, unit: string): number | null {
  if (unit === "g" || unit === "ml") return amount;
  if (unit === "kg" || unit === "L") return amount * 1000;
  return null;
}

function ProductShellTab({
  product,
  productCategory,
  shellCapableIngredients,
  shellCapableFillings,
  patchProduct,
  onSwitchToProductTab,
}: {
  product: Product;
  productCategory: ProductCategory | null | undefined;
  shellCapableIngredients: Ingredient[];
  shellCapableFillings: Filling[];
  patchProduct: (patch: Partial<Product>) => Promise<void>;
  onSwitchToProductTab: () => void;
}) {
  const toast = useToast();
  const allIngredients = useIngredients(true);
  const facilityMayContain = useFacilityMayContain();

  const sourceType: "ingredient" | "filling" | null = product.shellIngredientId
    ? "ingredient"
    : product.shellFillingId
      ? "filling"
      : null;

  const shellIngredient = sourceType === "ingredient"
    ? shellCapableIngredients.find((i) => i.id === product.shellIngredientId) ?? null
    : null;
  const shellFilling = sourceType === "filling"
    ? shellCapableFillings.find((f) => f.id === product.shellFillingId) ?? null
    : null;

  const shellFillingItems: FillingIngredient[] = useFillingIngredients(shellFilling?.id);

  const ingMap = useMemo(
    () => new Map(allIngredients.map((i) => [i.id!, i])),
    [allIngredients],
  );

  const composition = useMemo<Record<string, number> | null>(() => {
    if (shellIngredient) {
      return {
        cacaoFat: shellIngredient.cacaoFat ?? 0,
        sugar: shellIngredient.sugar ?? 0,
        milkFat: shellIngredient.milkFat ?? 0,
        water: shellIngredient.water ?? 0,
        solids: shellIngredient.solids ?? 0,
        otherFats: shellIngredient.otherFats ?? 0,
        alcohol: shellIngredient.alcohol ?? 0,
      };
    }
    if (shellFilling && shellFillingItems.length > 0) {
      let total = 0;
      const acc = { cacaoFat: 0, sugar: 0, milkFat: 0, water: 0, solids: 0, otherFats: 0, alcohol: 0 };
      for (const it of shellFillingItems) {
        if (!it.ingredientId) continue;
        const ing = ingMap.get(it.ingredientId);
        if (!ing) continue;
        const g = toGramsForComposition(it.amount, it.unit);
        if (g == null || g <= 0) continue;
        total += g;
        acc.cacaoFat += (g * (ing.cacaoFat ?? 0)) / 100;
        acc.sugar += (g * (ing.sugar ?? 0)) / 100;
        acc.milkFat += (g * (ing.milkFat ?? 0)) / 100;
        acc.water += (g * (ing.water ?? 0)) / 100;
        acc.solids += (g * (ing.solids ?? 0)) / 100;
        acc.otherFats += (g * (ing.otherFats ?? 0)) / 100;
        acc.alcohol += (g * (ing.alcohol ?? 0)) / 100;
      }
      if (total === 0) return null;
      const k = 100 / total;
      return {
        cacaoFat: acc.cacaoFat * k,
        sugar: acc.sugar * k,
        milkFat: acc.milkFat * k,
        water: acc.water * k,
        solids: acc.solids * k,
        otherFats: acc.otherFats * k,
        alcohol: acc.alcohol * k,
      };
    }
    return null;
  }, [shellIngredient, shellFilling, shellFillingItems, ingMap]);

  const containsAllergens = useMemo(() => {
    if (shellIngredient) return shellIngredient.allergens ?? [];
    if (shellFilling) return shellFilling.allergens ?? [];
    return [];
  }, [shellIngredient, shellFilling]);

  const mayContainAllergens = useMemo(() => {
    const inContains = new Set(containsAllergens);
    return facilityMayContain.filter((a) => !inContains.has(a));
  }, [facilityMayContain, containsAllergens]);

  const shellPctValue = product.shellPercentage ?? productCategory?.defaultShellPercent ?? 37;

  const ingredientOptions = useMemo(
    () => shellCapableIngredients.map((i) => ({ value: i.id!, label: i.name })),
    [shellCapableIngredients],
  );
  const fillingOptions = useMemo(
    () => shellCapableFillings.map((f) => ({ value: f.id!, label: f.name })),
    [shellCapableFillings],
  );

  async function saveSourceId(next: string) {
    if (sourceType === "ingredient") {
      await patchProduct({ shellIngredientId: next || null, shellFillingId: null });
    } else if (sourceType === "filling") {
      await patchProduct({ shellFillingId: next || null, shellIngredientId: null });
    }
    toast.success("Shell source saved");
  }

  async function saveShellPct(next: string) {
    const n = parseFloat(next);
    if (isNaN(n) || n < 0 || n > 100) throw new Error("Enter 0–100");
    await patchProduct({ shellPercentage: n });
    toast.success("Shell % saved");
  }

  return (
    <div className="px-4 pb-6 space-y-4">
      <Section title="Shell source">
        <div style={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="text-ds-label">Source type</span>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "2px 10px",
                  borderRadius: 999,
                  fontSize: 12,
                  border: "0.5px solid var(--ds-border-warm)",
                  background: "var(--ds-card-bg-hover)",
                  color: "var(--ds-text-primary)",
                  fontStyle: sourceType ? "normal" : "italic",
                }}
              >
                {sourceType === "ingredient"
                  ? "Ingredient (couverture)"
                  : sourceType === "filling"
                    ? "Self-made chocolate (filling)"
                    : "Not set"}
              </span>
              <button
                type="button"
                onClick={onSwitchToProductTab}
                style={{
                  fontSize: 12,
                  color: "var(--ds-text-muted)",
                  textDecoration: "underline",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                ← edit in Product tab
              </button>
            </div>
          </div>

          {sourceType === "ingredient" && (
            <>
              <DsInlineSelect
                label="Shell ingredient"
                value={product.shellIngredientId ?? ""}
                options={ingredientOptions}
                onSave={saveSourceId}
                placeholder="Pick a chocolate ingredient"
              />
              <DsInlineField
                label="Shell %"
                value={String(shellPctValue)}
                onSave={saveShellPct}
                type="number"
                suffix="%"
              />
            </>
          )}
          {sourceType === "filling" && (
            <>
              <DsInlineSelect
                label="Shell filling"
                value={product.shellFillingId ?? ""}
                options={fillingOptions}
                onSave={saveSourceId}
                placeholder="Pick a chocolate filling"
              />
              <DsInlineField
                label="Shell %"
                value={String(shellPctValue)}
                onSave={saveShellPct}
                type="number"
                suffix="%"
              />
            </>
          )}
          {sourceType === null && (
            <p style={{ fontSize: 12, color: "var(--ds-text-muted)", fontStyle: "italic" }}>
              Pick ingredient vs filling in the Product tab first.
            </p>
          )}
        </div>
      </Section>

      <Section title="Computed" noBody>
        {composition ? (
          <div>
            {COMPOSITION_FIELDS.map(({ key, label }) => (
              <ListRow
                key={key}
                title={label}
                side={
                  <span
                    style={{
                      fontVariantNumeric: "tabular-nums",
                      fontSize: 13,
                      color: "var(--ds-text-primary)",
                    }}
                  >
                    {composition[key].toFixed(1)}%
                  </span>
                }
              />
            ))}
          </div>
        ) : (
          <p
            style={{
              padding: "14px 20px",
              fontSize: 13,
              color: "var(--ds-text-muted)",
              fontStyle: "italic",
            }}
          >
            Pick a shell source to see composition.
          </p>
        )}
        <div style={{ padding: "12px 20px", display: "flex", flexWrap: "wrap", gap: 6 }}>
          {containsAllergens.map((a) => (
            <span
              key={`c-${a}`}
              style={{
                display: "inline-flex",
                padding: "2px 8px",
                borderRadius: 999,
                fontSize: 11,
                border: "1px solid var(--ds-tier-urgent)",
                color: "var(--ds-tier-urgent)",
                background: "transparent",
              }}
            >
              {allergenLabel(a)}
            </span>
          ))}
          {mayContainAllergens.map((a) => (
            <span
              key={`m-${a}`}
              style={{
                display: "inline-flex",
                padding: "2px 8px",
                borderRadius: 999,
                fontSize: 11,
                border: "1px solid var(--ds-tier-active)",
                color: "var(--ds-text-primary)",
                background: "transparent",
              }}
            >
              may contain {allergenLabel(a)}
            </span>
          ))}
          {containsAllergens.length === 0 && mayContainAllergens.length === 0 && (
            <span
              style={{
                fontSize: 12,
                color: "var(--ds-text-muted)",
                fontStyle: "italic",
              }}
            >
              No allergens.
            </span>
          )}
        </div>
        <p
          style={{
            padding: "0 20px 14px",
            fontSize: 11,
            color: "var(--ds-text-muted)",
            fontStyle: "italic",
          }}
        >
          Recomputes when source changes.
        </p>
      </Section>
    </div>
  );
}
