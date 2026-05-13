"use client";

import { useState, useRef, useEffect, useMemo, useCallback, use, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useProduct, useProductFillings, useFillings, useFilling, useMouldsList, useProductCategories, useProductCategory, useCoatings, useShellCapableIngredients, saveProduct, saveVariant, addFillingToProduct, removeFillingFromProduct, updateProductFillingPercentage, updateProductFillingGrams, reorderProductFillings, deleteProduct, duplicateProduct, archiveProduct, unarchiveProduct, hasProductBeenProduced, usePlanProductsForProduct, useProductionPlans, useProductCostSnapshots, useLatestProductCostSnapshot, recalculateProductCost, useIngredients, useFillingIngredients, useFillingIngredientsForFillings, useDecorationMaterials, saveDecorationMaterial, useCurrencySymbol, useMarketRegion, useDefaultFillMode, useShellDesigns, useDecorationCategoryLabels, useProductsList, useProductLeadTimeSuggestions, useStockLocationMinimums, saveStockLocationMinimum, useFacilityMayContain, useAllVariantPackagingProducts, useAllVariantPackagings } from "@/lib/hooks";
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
  ListRow,
  StatCard,
  DsButton,
  DsDialog,
  DsDrawer,
  StatusTag,
  type StatusTagKind,
  type StatCardVariant,
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

  // Editing flag now only controls the Shell-tab buffered design editor
  // (Product tab body is inline-edit always). Default false even on ?new=1
  // — first inline patch on a Product field commits the record.
  const [editing, setEditing] = useState(false);
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
    // First inline save on a ?new=1 record commits it — flip savedOnce so the
    // nav guard stops threatening to delete, and drop ?new=1 from the URL.
    if (isNew && !savedOnce) {
      setSavedOnce(true);
      router.replace(`/products/${encodeURIComponent(productId)}`);
    }
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
                  onClick={() => fileInputRef.current?.click()}
                />
                <button
                  onClick={() => setConfirmRemovePhoto(true)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-stone-700 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove photo"
                  aria-label="Remove photo"
                >
                  <X className="w-3 h-3" />
                </button>
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
                {productFillings.length === 0 ? (
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

      {/* Duplicate / Archive / Delete action rail.
       *  Duplicate is a DsDrawer (form needs space). Archive + Delete are
       *  DsDialog confirms (single-tap destructive actions). */}
      <div className="px-4 pb-8 border-t border-[color:var(--ds-border-warm)] pt-4 space-y-4">
        <button
          onClick={() => setShowDuplicatePanel(true)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <Copy className="w-4 h-4" /> Duplicate product
        </button>

        {product?.archived && (
          <button
            onClick={async () => { await unarchiveProduct(productId); }}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArchiveRestore className="w-4 h-4" /> Unarchive product
          </button>
        )}

        {!product?.archived && productProduced && (
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Archive className="w-4 h-4" /> Archive product
          </button>
        )}

        {!product?.archived && !productProduced && (
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-destructive transition-colors"
          >
            <Trash2 className="w-4 h-4" /> Delete product
          </button>
        )}
      </div>

      </>
      )}

      {/* Drawers + dialogs (mounted once, controlled by ProductDetailPage
       *  state). Replaces the nested-modal / inline-panel patterns.  */}
      <DsDialog
        open={confirmRemovePhoto}
        title="Remove photo?"
        description={`The photo for "${product?.name}" will be removed. You can upload a new one any time.`}
        confirmLabel="Remove"
        tone="destructive"
        onCancel={() => setConfirmRemovePhoto(false)}
        onConfirm={async () => {
          if (!product) return;
          await saveProduct({ id: productId, name: product.name, photo: undefined });
          setConfirmRemovePhoto(false);
          toast.success("Photo removed");
        }}
      />

      <DsDialog
        open={confirmDelete && !!product && !product.archived}
        title={productProduced ? "Archive this product?" : "Delete this product?"}
        description={productProduced
          ? "This product has been used in production and can't be deleted. Archiving hides it from lists but preserves the production history."
          : "Permanently removes the product and all its filling assignments. This cannot be undone."}
        confirmLabel={productProduced ? "Archive" : "Delete"}
        tone={productProduced ? "default" : "destructive"}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (productProduced) {
            await archiveProduct(productId);
          } else {
            await deleteProduct(productId);
          }
          setConfirmDelete(false);
          router.replace("/products");
        }}
      />

      <DsDrawer
        open={showDuplicatePanel}
        title={`Duplicate "${product?.name ?? ""}"`}
        onClose={() => { setShowDuplicatePanel(false); setDuplicateFillings(false); }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ fontSize: 12, color: "var(--ds-text-muted)", lineHeight: 1.5 }}>
            A new product will be created with the same type, coating, tags, notes, shell design, and production defaults.
          </p>
          {productFillings.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={duplicateFillings}
                  onChange={(e) => setDuplicateFillings(e.target.checked)}
                />
                <span>
                  Also duplicate {productFillings.length === 1 ? "the filling" : `all ${productFillings.length} fillings`} as new copies
                </span>
              </label>
              <p style={{ fontSize: 11, color: "var(--ds-text-muted)", marginLeft: 24, lineHeight: 1.4 }}>
                {duplicateFillings
                  ? "Each filling will be copied as an independent filling you can edit separately."
                  : "The duplicate will share the same fillings as the original."}
              </p>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <DsButton
              variant="primary"
              disabled={duplicatingProduct}
              onClick={async () => {
                setDuplicatingProduct(true);
                try {
                  const newId = await duplicateProduct(productId, { duplicateFillings });
                  setShowDuplicatePanel(false);
                  router.push(`/products/${encodeURIComponent(newId)}?new=1`);
                } finally {
                  setDuplicatingProduct(false);
                }
              }}
            >
              {duplicatingProduct ? "Duplicating…" : "Duplicate product"}
            </DsButton>
            <DsButton onClick={() => { setShowDuplicatePanel(false); setDuplicateFillings(false); }}>
              Cancel
            </DsButton>
          </div>
        </div>
      </DsDrawer>

      <DsDrawer
        open={showAssign}
        title="Assign filling"
        onClose={() => { setShowAssign(false); setFillingSearch(""); }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ position: "relative" }}>
            <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: "var(--ds-text-muted)" }} />
            <input
              type="text"
              value={fillingSearch}
              onChange={(e) => setFillingSearch(e.target.value)}
              placeholder="Search fillings to assign…"
              autoFocus
              className="input"
              style={{ paddingLeft: 32, width: "100%" }}
            />
          </div>
          {filteredAvailable.length > 0 ? (
            <ul style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: "60vh", overflowY: "auto" }}>
              {filteredAvailable.map((filling) => (
                <li key={filling.id}>
                  <button
                    onClick={() => handleAssignFilling(filling.id!)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 12px",
                      borderRadius: 6,
                      background: "transparent",
                      border: "0.5px solid transparent",
                      cursor: "pointer",
                      color: "var(--ds-text-primary)",
                    }}
                    className="hover:bg-[color:var(--ds-card-bg-hover)]"
                  >
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{filling.name}</span>
                    {(filling.category || filling.description) && (
                      <div style={{ fontSize: 11, color: "var(--ds-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {[filling.category, filling.description].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ fontSize: 12, color: "var(--ds-text-muted)", fontStyle: "italic", textAlign: "center", padding: "12px 0" }}>
              {availableFillings.length === 0
                ? "All fillings are already assigned."
                : "No fillings match your search."}
            </p>
          )}
        </div>
      </DsDrawer>
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

// --- Cost Tab (Phase A.5) ---
//
// Two-column body: StatCard 2x2 + Cost breakdown ListRows + Recompute on the
// left; Sparkline + Snapshot history ListRows + Export CSV on the right.
// Margin % is colour-coded (mint ≥30 → caramel 15–30 → rose <15).
// Engine only emits shell/cap + filling_ingredient breakdown rows today, so
// Packaging / Labor / Other render as deferred (✗) muted rows.

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
  const variantPackagings = useAllVariantPackagings();
  const variantPackagingProducts = useAllVariantPackagingProducts();

  const [recalculating, setRecalculating] = useState(false);

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

  // Buckets the engine populates today vs. those still to land. Packaging /
  // labor / overhead aren't tracked on snapshots yet — flagged ✗ inline.
  const buckets = useMemo(() => {
    let shell = 0;
    let filling = 0;
    for (const e of latestBreakdown) {
      if (e.kind === "shell" || e.kind === "cap") shell += e.subtotal;
      else if (e.kind === "filling_ingredient") filling += e.subtotal;
    }
    return [
      { key: "shell", label: "Shell", value: shell, tracked: true as const },
      { key: "filling", label: "Filling", value: filling, tracked: true as const },
      { key: "packaging", label: "Packaging", value: 0, tracked: false as const },
      { key: "labor", label: "Labor", value: 0, tracked: false as const },
      { key: "other", label: "Other", value: 0, tracked: false as const },
    ];
  }, [latestBreakdown]);

  // Representative sell price: cheapest single-unit variant size whose product
  // composition is exactly [{productId, qty: 1}]. Falls back to null when no
  // single-unit variant exists for this product.
  const sellPrice = useMemo<number | null>(() => {
    const byVp = new Map<string, { productId: string; qty: number }[]>();
    for (const vpp of variantPackagingProducts) {
      const list = byVp.get(vpp.variantPackagingId) ?? [];
      list.push({ productId: vpp.productId, qty: vpp.qty });
      byVp.set(vpp.variantPackagingId, list);
    }
    let best: number | null = null;
    for (const vp of variantPackagings) {
      const entries = byVp.get(vp.id!) ?? [];
      if (entries.length !== 1) continue;
      const only = entries[0];
      if (only.productId !== productId) continue;
      if (only.qty !== 1) continue;
      const price = vp.price ?? vp.sellPrice;
      if (price == null || price <= 0) continue;
      if (best == null || price < best) best = price;
    }
    return best;
  }, [variantPackagings, variantPackagingProducts, productId]);

  const margin = useMemo<number | null>(() => {
    if (sellPrice == null || sellPrice <= 0) return null;
    if (!latest) return null;
    return ((sellPrice - latest.costPerProduct) / sellPrice) * 100;
  }, [sellPrice, latest]);

  const marginVariant: StatCardVariant = margin == null
    ? "default"
    : margin >= 30
      ? "ok"
      : margin >= 15
        ? "warn"
        : "urgent";

  const chronological = [...snapshots].reverse();

  async function handleRecalculate() {
    setRecalculating(true);
    try {
      await recalculateProductCost(productId);
    } finally {
      setRecalculating(false);
    }
  }

  function handleExportCsv() {
    if (snapshots.length === 0) return;
    const header = ["recordedAt", "costPerProduct", "trigger", "detail"].join(",");
    const rows = snapshots.map((s) => [
      new Date(s.recordedAt).toISOString(),
      s.costPerProduct.toFixed(4),
      s.triggerType,
      `"${(s.triggerDetail ?? "").replace(/"/g, '""')}"`,
    ].join(","));
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${product.name.replace(/[^a-z0-9-_]+/gi, "_")}-cost-history.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function relativeTime(date: Date | string) {
    const t = new Date(date).getTime();
    const diff = Date.now() - t;
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return "just now";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} min ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} h ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day} d ago`;
    const mo = Math.floor(day / 30);
    if (mo < 12) return `${mo} mo ago`;
    return `${Math.floor(mo / 12)} y ago`;
  }

  return (
    <div className="px-4 pb-8" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Warnings ───────────────────────────── */}
      {!hasMould && (
        <CostWarning>
          Set a <strong>default mould</strong> on this product to enable cost calculation.
        </CostWarning>
      )}
      {hasMould && !hasShell && (
        <CostWarning>
          No shell chocolate set — shell and cap costs are excluded. Pick one on the <strong>Shell</strong> tab.
        </CostWarning>
      )}
      {hasMould && hasShell && !shellPriced && (
        <CostWarning>
          Shell chocolate <strong>{shellIngredient!.name}</strong> has no pricing data — shell and cap costs are excluded until its pricing is set.
        </CostWarning>
      )}
      {missingPricingIngredients.length > 0 && (
        <CostWarning>
          <strong>{missingPricingIngredients.length} ingredient{missingPricingIngredients.length > 1 ? "s" : ""}</strong> have no pricing data — cost may be understated: {missingPricingIngredients.join(", ")}
        </CostWarning>
      )}

      {/* Two-column body ──────────────────────── */}
      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          alignItems: "start",
        }}
      >
        {/* Left column ─────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 12,
            }}
          >
            <StatCard
              label="Cost / unit"
              value={latest ? formatCost(latest.costPerProduct, sym) : "—"}
              meta={latest ? "per piece · 1 cavity" : "no snapshot"}
              variant="default"
            />
            <StatCard
              label="Margin"
              value={margin == null ? "—" : `${margin.toFixed(1)}%`}
              meta={margin == null ? "needs sell price" : margin >= 30 ? "healthy" : margin >= 15 ? "tight" : "below floor"}
              variant={marginVariant}
            />
            <StatCard
              label="Sell price"
              value={sellPrice == null ? "—" : formatCost(sellPrice, sym)}
              meta={sellPrice == null ? "no single-unit variant" : "cheapest single-unit"}
              variant="default"
            />
            <StatCard
              label="Last computed"
              value={latest ? relativeTime(latest.recordedAt) : "—"}
              meta={latest
                ? new Date(latest.recordedAt).toLocaleDateString("de-AT", { day: "numeric", month: "short", year: "numeric" })
                : "press Recompute"}
              variant="default"
            />
          </div>

          <Section title="Cost breakdown" noBody>
            {latest ? (
              <>
                {buckets.map((b) => {
                  const pct = totalCost > 0 ? (b.value / totalCost) * 100 : 0;
                  return (
                    <ListRow
                      key={b.key}
                      tier={b.tracked ? "default" : "parked"}
                      title={
                        <span style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                          <span>{b.label}</span>
                          {!b.tracked && (
                            <span style={{ fontSize: 10, color: "var(--ds-text-muted)", fontStyle: "italic" }}>
                              not tracked yet
                            </span>
                          )}
                        </span>
                      }
                      meta={b.tracked ? `${pct.toFixed(1)}% of total` : "deferred · ✗"}
                      side={
                        <span style={{ fontSize: 14, fontVariantNumeric: "tabular-nums", color: b.tracked ? "var(--ds-text-primary)" : "var(--ds-text-muted)" }}>
                          {formatCost(b.value, sym)}
                        </span>
                      }
                    />
                  );
                })}
                <div style={{ padding: "10px 20px", borderTop: "0.5px solid var(--ds-border-warm)", display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600 }}>
                  <span>Total</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatCost(totalCost, sym)}</span>
                </div>
              </>
            ) : (
              <p style={{ padding: "20px", fontSize: 13, color: "var(--ds-text-muted)", textAlign: "center", fontStyle: "italic" }}>
                No cost data yet — press Recompute now.
              </p>
            )}
          </Section>

          <div>
            <DsButton onClick={handleRecalculate} disabled={recalculating}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <RefreshCw className={`w-3.5 h-3.5 ${recalculating ? "animate-spin" : ""}`} />
                {recalculating ? "Recomputing…" : "Recompute now"}
              </span>
            </DsButton>
          </div>
        </div>

        {/* Right column ─────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Section title="Cost over time">
            <div style={{ padding: "0 20px 4px" }}>
              {chronological.length >= 2 ? (
                <CostSparkline snapshots={chronological} sym={sym} />
              ) : (
                <p style={{ fontSize: 13, color: "var(--ds-text-muted)", fontStyle: "italic", padding: "12px 0", textAlign: "center" }}>
                  Two or more snapshots needed for a sparkline.
                </p>
              )}
            </div>
          </Section>

          <Section title="Snapshot history" noBody>
            {snapshots.length === 0 ? (
              <p style={{ padding: "20px", fontSize: 13, color: "var(--ds-text-muted)", textAlign: "center", fontStyle: "italic" }}>
                No history yet — press Recompute now to create the first snapshot.
              </p>
            ) : (
              snapshots.map((snap, i) => {
                const prev = snapshots[i + 1];
                const delta = prev ? costDelta(snap.costPerProduct, prev.costPerProduct, sym) : null;
                const snapMargin = sellPrice != null && sellPrice > 0
                  ? ((sellPrice - snap.costPerProduct) / sellPrice) * 100
                  : null;
                const dateStr = new Date(snap.recordedAt).toLocaleDateString("de-AT", { day: "numeric", month: "short", year: "numeric" });
                return (
                  <ListRow
                    key={snap.id}
                    title={
                      <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatCost(snap.costPerProduct, sym)}</span>
                        {snapMargin != null && (
                          <span style={{ fontSize: 11, color: "var(--ds-text-muted)" }}>
                            margin {snapMargin.toFixed(1)}%
                          </span>
                        )}
                      </span>
                    }
                    meta={
                      <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <span>{dateStr}</span>
                        <span>·</span>
                        <span style={{ fontStyle: "italic" }}>{snap.triggerDetail}</span>
                      </span>
                    }
                    side={
                      delta ? (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: delta.positive
                              ? "var(--ds-tint-urgent, rgba(220, 38, 38, 0.08))"
                              : "var(--ds-tint-positive, rgba(16, 185, 129, 0.08))",
                            color: delta.positive ? "var(--ds-tier-urgent)" : "var(--ds-tier-positive)",
                          }}
                        >
                          {delta.positive ? "▲" : "▼"} {delta.label}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--ds-text-muted)" }}>initial</span>
                      )
                    }
                  />
                );
              })
            )}
          </Section>

          {snapshots.length > 0 && (
            <div>
              <DsButton onClick={handleExportCsv}>Export CSV</DsButton>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CostWarning({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        padding: "10px 14px",
        borderRadius: 6,
        background: "var(--ds-tint-warn, rgba(180, 83, 9, 0.06))",
        border: "0.5px solid var(--ds-semantic-warn)",
        color: "var(--ds-semantic-warn)",
        fontSize: 12,
        alignItems: "flex-start",
      }}
    >
      <AlertTriangle className="w-4 h-4 shrink-0" style={{ marginTop: 2 }} />
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

// Minimal SVG sparkline — no external deps. Replaces the older annotated chart;
// trigger detail moved into the snapshot list rows beneath it.
function CostSparkline({ snapshots, sym = "€" }: { snapshots: ProductCostSnapshot[]; sym?: string }) {
  if (snapshots.length < 2) return null;
  const W = 320;
  const H = 64;
  const PAD = 6;
  const costs = snapshots.map((s) => s.costPerProduct);
  const minCost = Math.min(...costs);
  const maxCost = Math.max(...costs);
  const range = maxCost - minCost || maxCost * 0.1 || 0.01;
  const yMin = Math.max(0, minCost - range * 0.2);
  const yMax = maxCost + range * 0.2;
  const span = yMax - yMin || 1;
  const xStep = snapshots.length > 1 ? (W - PAD * 2) / (snapshots.length - 1) : 0;
  const pointArr = snapshots.map((s, i) => {
    const x = PAD + i * xStep;
    const y = PAD + (1 - (s.costPerProduct - yMin) / span) * (H - PAD * 2);
    return { x, y };
  });
  const polyline = pointArr.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const last = pointArr[pointArr.length - 1];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 80 }}>
        <polyline
          points={polyline}
          fill="none"
          stroke="var(--ds-tier-quarter-focus)"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx={last.x} cy={last.y} r={3} fill="var(--ds-tier-quarter-focus)" />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--ds-text-muted)", marginTop: 4 }}>
        <span>{formatCost(minCost, sym)}</span>
        <span>{formatCost(maxCost, sym)}</span>
      </div>
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

// --- Nutrition Tab (Phase A.6) ---
//
// Single column. Section "Per 100g" + Section "Per piece" (computed piece
// weight at top, ✗ inline-edit deferred — schema has no override field),
// Section "Allergens" (contains = red border, may contain = caramel border,
// dietary = default chip), Section "Source breakdown" (collapsed by default,
// rows per shell + each filling contribution), Section "Ingredient list" for
// the Shopify label pasting workflow. Italic footer note.

function ProductNutritionTab({ productId, productFillings, market }: { productId: string; productFillings: ProductFilling[]; market: MarketRegion }) {
  const product = useProduct(productId);
  const allIngredients = useIngredients(true);
  const allMoulds = useMouldsList(true);
  const allFillings = useFillings();
  const fillingIds = useMemo(() => productFillings.map(rl => rl.fillingId), [productFillings]);
  const fillingIngredientsMap = useFillingIngredientsForFillings(fillingIds);
  const facilityMayContain = useFacilityMayContain();
  const [sourceOpen, setSourceOpen] = useState(false);

  const ingredientMap = useMemo(() => new Map(allIngredients.map(i => [i.id!, i])), [allIngredients]);
  const fillingMap = useMemo(() => new Map(allFillings.map(f => [f.id!, f])), [allFillings]);
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

  // Aggregate allergen IDs from shell ingredient + each filling. Filling rows
  // already carry pre-rolled-up allergens so this is a flat union.
  const containsAllergens = useMemo(() => {
    const ids = new Set<string>();
    if (shellIngredient?.allergens) for (const a of shellIngredient.allergens) ids.add(a);
    for (const pf of productFillings) {
      const f = fillingMap.get(pf.fillingId);
      if (!f?.allergens) continue;
      for (const a of f.allergens) ids.add(a);
    }
    return Array.from(ids).sort((a, b) => a.localeCompare(b));
  }, [shellIngredient, productFillings, fillingMap]);

  // Facility-may-contain minus those already in `contains` (no duplicates).
  const mayContainAllergens = useMemo(() => {
    const contained = new Set(containsAllergens);
    return facilityMayContain.filter((id) => !contained.has(id)).sort((a, b) => a.localeCompare(b));
  }, [facilityMayContain, containsAllergens]);

  const dietaryTags = useMemo(() => {
    const tags: string[] = [];
    if (product?.vegan) tags.push("vegan");
    return tags;
  }, [product?.vegan]);

  const { per100g, perProduct, productWeightG, ingredientsWithData, ingredientsTotal, missingIngredients, warnings } = result;
  const nutrients = getNutrientsByMarket(market);
  const panelTitle = getNutritionPanelTitle(market);
  const showDV = market === "US";
  const showPerServing = market === "US";
  const perServing = showPerServing ? scaleToServing(per100g, 30) : perProduct;

  const hasData = Object.keys(per100g).length > 0;

  // Per-source breakdown rows: shell + each filling with grams + contributing
  // ingredients label. Used by the collapsible Source breakdown section.
  const sourceRows = useMemo(() => {
    type Row = { key: string; label: string; grams: number; ingredients: string[] };
    const rows: Row[] = [];
    if (mould && shellIngredient) {
      const shellG = calculateShellWeightG(mould) + calculateCapWeightG(mould);
      rows.push({
        key: "__shell__",
        label: `Shell — ${shellIngredient.name}`,
        grams: shellG,
        ingredients: [shellIngredient.name],
      });
    }
    if (mould) {
      const totalFillG = mould.cavityWeightG - (calculateShellWeightG(mould) + calculateCapWeightG(mould));
      for (const pf of productFillings) {
        const f = fillingMap.get(pf.fillingId);
        if (!f) continue;
        const grams = product?.fillMode === "grams"
          ? (pf.fillGrams ?? 0)
          : totalFillG * ((pf.fillPercentage ?? 0) / 100);
        const ings = (fillingIngredientsMap.get(pf.fillingId) ?? [])
          .map((fi) => fi.ingredientId ? ingredientMap.get(fi.ingredientId)?.name : null)
          .filter((n): n is string => !!n);
        rows.push({
          key: pf.id ?? pf.fillingId,
          label: f.name,
          grams,
          ingredients: ings,
        });
      }
    }
    return rows;
  }, [mould, shellIngredient, productFillings, fillingMap, fillingIngredientsMap, ingredientMap, product?.fillMode]);

  if (!product) return null;

  if (productFillings.length === 0 && !shellIngredient) {
    return (
      <div className="px-4 pb-6">
        <p style={{ fontSize: 13, color: "var(--ds-text-muted)", padding: "32px 0", textAlign: "center" }}>
          Add fillings to this product to see nutrition data.
        </p>
      </div>
    );
  }

  if (!mould) {
    return (
      <div className="px-4 pb-6">
        <p style={{ fontSize: 13, color: "var(--ds-text-muted)", padding: "32px 0", textAlign: "center" }}>
          Set a default mould on this product to calculate per-product nutrition. The mould determines shell, cap, and fill weights.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-8" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Warnings ───────────────────────────── */}
      {warnings.map((w, i) => (
        <div key={i} style={{ fontSize: 12, color: "var(--ds-semantic-warn)", display: "flex", gap: 6, alignItems: "flex-start" }}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ marginTop: 2 }} />
          <span>{w}</span>
        </div>
      ))}
      {hasData && ingredientsWithData < ingredientsTotal && (
        <div style={{ fontSize: 12, color: "var(--ds-semantic-warn)", display: "flex", gap: 6, alignItems: "flex-start" }}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ marginTop: 2 }} />
          <span>
            Nutrition data for {ingredientsWithData} of {ingredientsTotal} ingredients. Values are partial — add data to{" "}
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

      <div style={{ fontSize: 11, color: "var(--ds-text-muted)" }}>
        {panelTitle}
      </div>

      {/* Section · Per 100g ───────────────────── */}
      <Section title="Per 100g">
        {hasData ? (
          <NutrientKeyValueGrid
            nutrients={nutrients}
            values={per100g}
            showDV={false}
          />
        ) : (
          <p style={{ padding: "0 20px", fontSize: 13, color: "var(--ds-text-muted)", fontStyle: "italic" }}>
            None of the ingredients in this product have nutrition data yet.
          </p>
        )}
      </Section>

      {/* Section · Per piece ───────────────────── */}
      <Section title="Per piece">
        <div style={{ padding: "0 20px 12px", borderBottom: "0.5px solid var(--ds-border-warm)", marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <span className="text-ds-label">Piece weight</span>
            <span style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
              {productWeightG.toFixed(1)} g
            </span>
          </div>
          <p style={{ fontSize: 10, color: "var(--ds-text-muted)", fontStyle: "italic", marginTop: 4 }}>
            Shell + cap {(calculateShellWeightG(mould) + calculateCapWeightG(mould)).toFixed(1)} g{shellIngredient ? ` of ${shellIngredient.name}` : ""} · fill {(productWeightG - calculateShellWeightG(mould) - calculateCapWeightG(mould)).toFixed(1)} g
            {" "}· inline override ✗ deferred (no schema column)
            {showPerServing && " · FDA serving 30 g"}
          </p>
        </div>
        {hasData ? (
          <NutrientKeyValueGrid
            nutrients={nutrients}
            values={showPerServing ? perServing : perProduct}
            showDV={showDV}
            dvKey={showPerServing ? "perServing" : undefined}
          />
        ) : (
          <p style={{ padding: "0 20px", fontSize: 13, color: "var(--ds-text-muted)", fontStyle: "italic" }}>
            Add nutrition data to ingredients to see per-piece values.
          </p>
        )}
      </Section>

      {/* Section · Allergens ─────────────────── */}
      <Section title="Allergens">
        <div style={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: 10 }}>
          <AllergenChipRow
            label="Contains"
            ids={containsAllergens}
            tone="contains"
          />
          <AllergenChipRow
            label="May contain"
            ids={mayContainAllergens}
            tone="may"
          />
          <AllergenChipRow
            label="Dietary"
            ids={dietaryTags}
            tone="dietary"
          />
        </div>
      </Section>

      {/* Section · Source breakdown ────────────── */}
      <Section
        title={
          <button
            type="button"
            onClick={() => setSourceOpen((o) => !o)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", cursor: "pointer", padding: 0, font: "inherit", color: "inherit" }}
          >
            <ChevronRight className={`w-3.5 h-3.5 transition-transform ${sourceOpen ? "rotate-90" : ""}`} />
            Source breakdown
          </button>
        }
        noBody
      >
        {sourceOpen && (
          sourceRows.length === 0 ? (
            <p style={{ padding: "12px 20px", fontSize: 13, color: "var(--ds-text-muted)", fontStyle: "italic" }}>
              Nothing to break down yet.
            </p>
          ) : (
            sourceRows.map((row) => {
              const pct = productWeightG > 0 ? (row.grams / productWeightG) * 100 : 0;
              return (
                <ListRow
                  key={row.key}
                  title={<span>{row.label}</span>}
                  meta={
                    row.ingredients.length > 0
                      ? row.ingredients.join(" · ")
                      : "—"
                  }
                  side={
                    <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 13 }}>
                      {row.grams.toFixed(1)} g · {pct.toFixed(1)}%
                    </span>
                  }
                />
              );
            })
          )
        )}
      </Section>

      {/* Section · Ingredient list (Shopify export) ── */}
      <Section title="Ingredient list">
        <div style={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ fontSize: 11, color: "var(--ds-text-muted)" }}>
            Descending by weight. Allergen-bearing ingredients are bold.
          </p>
          {ingredientList.length > 0 ? (
            <p style={{ fontSize: 13, lineHeight: 1.55 }}>
              {ingredientList.map((entry, i) => (
                <span key={i}>
                  {i > 0 ? ", " : ""}
                  {containsAllergen(entry.label) ? <strong>{entry.label}</strong> : entry.label}
                </span>
              ))}
              .
            </p>
          ) : (
            <p style={{ fontSize: 13, color: "var(--ds-text-muted)" }}>No ingredients yet.</p>
          )}
          <ShopifyFormatBlock entries={ingredientList} per100g={per100g} />
        </div>
      </Section>

      {/* Footer ────────────────────────────────── */}
      <p style={{ fontSize: 11, color: "var(--ds-text-muted)", fontStyle: "italic", textAlign: "center", marginTop: 4 }}>
        Computed from shell + fillings — edit those to change values.
      </p>
    </div>
  );
}

// Two-column key/value grid used for both Per 100g and Per piece sections.
function NutrientKeyValueGrid({
  nutrients,
  values,
  showDV,
  dvKey,
}: {
  nutrients: ReturnType<typeof getNutrientsByMarket>;
  values: Record<string, number | undefined>;
  showDV: boolean;
  dvKey?: "perServing";
}) {
  return (
    <div style={{ padding: "0 20px" }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {nutrients.map((n, idx) => {
          const v = values[n.key];
          const dv = showDV ? percentDailyValue(v, n.dailyValue) : undefined;
          const indentPx = n.indent === 1 ? 12 : n.indent === 2 ? 24 : 0;
          return (
            <div
              key={n.key}
              style={{
                display: "grid",
                gridTemplateColumns: showDV ? "1fr auto auto" : "1fr auto",
                gap: 12,
                padding: "6px 0",
                borderBottom: idx < nutrients.length - 1 ? "0.5px solid var(--ds-border-warm)" : "none",
                fontSize: 13,
                fontWeight: n.indent === 0 ? 500 : 400,
                color: n.indent === 0 ? "var(--ds-text-primary)" : "var(--ds-text-muted)",
              }}
            >
              <span style={{ paddingLeft: indentPx }}>{n.label}</span>
              <span style={{ fontVariantNumeric: "tabular-nums", color: v == null ? "var(--ds-text-muted)" : undefined, opacity: v == null ? 0.5 : 1 }}>
                {formatNutrientValue(v, n.unit)}
              </span>
              {showDV && (
                <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 11, color: "var(--ds-text-muted)", minWidth: 36, textAlign: "right" }}>
                  {dv != null ? `${dv}%` : ""}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Allergen chip rows: contains (red border), may contain (caramel border),
// dietary (default). Empty rows render a muted "—" placeholder.
function AllergenChipRow({
  label,
  ids,
  tone,
}: {
  label: string;
  ids: string[];
  tone: "contains" | "may" | "dietary";
}) {
  const borderColor =
    tone === "contains" ? "var(--ds-tier-urgent)"
    : tone === "may" ? "var(--ds-tier-confirmed, var(--ds-semantic-warn))"
    : "var(--ds-border-warm)";
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
      <span className="text-ds-label" style={{ minWidth: 100, paddingTop: 4 }}>
        {label}
      </span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
        {ids.length === 0 ? (
          <span style={{ fontSize: 12, color: "var(--ds-text-muted)", fontStyle: "italic", paddingTop: 4 }}>
            none
          </span>
        ) : (
          ids.map((id) => (
            <span
              key={id}
              style={{
                fontSize: 12,
                padding: "2px 10px",
                borderRadius: 999,
                border: `1px solid ${borderColor}`,
                background: "var(--ds-card-bg)",
                color: "var(--ds-text-primary)",
                whiteSpace: "nowrap",
              }}
            >
              {tone === "dietary" ? id : allergenLabel(id)}
            </span>
          ))
        )}
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
