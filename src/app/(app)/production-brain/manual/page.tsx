"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  MouseSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  pointerWithin,
} from "@dnd-kit/core";
import {
  useOrders,
  useAllOrderItems,
  useAllOrderVariantLines,
  useProductionOrders,
  useAllProductionOrderItems,
  useSubscriptionRuns,
  useSubscriptionTemplates,
  useProductsList,
  useVariants,
  useAllVariantPackagings,
  useAllVariantPackagingProducts,
  usePackagingList,
  useMoulds,
  useAllPlanProducts,
  useProductionPlans,
  useAllOrderPlanLinks,
  useProductLocationTotals,
  saveProductionPlan,
  savePlanProduct,
  saveOrderPlanLink,
} from "@/lib/hooks";
import { aggregateDemandByProduct } from "@/lib/manual-planner/aggregate-demand";
import { DemandPicker } from "@/components/manual-planner/demand-picker/demand-picker";
import { newId } from "@/lib/supabase";
import { ORDER_CHANNEL_LABELS } from "@/types";
import type { Mould, Product } from "@/types";
import { BackButton } from "@/components/back-button";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  X,
  AlertTriangle,
  Check,
  Save,
  FileText,
  GripVertical,
  Trash2,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────

type DemandSource = "order" | "po" | "subscription";

interface DemandLine {
  /** Unique id of the source line (orderItemId, productionOrderItemId, subscriptionRun:productId). */
  sourceLineId: string;
  source: DemandSource;
  productId: string;
  qty: number;
  /** Human label for the source — "Order #1234 Müller", "PO Restock-Shop", "Sub: Mar 2026". */
  sourceLabel: string;
  /** Underlying source row id — for OrderPlanLink we use orderItemId; for PO we capture poItemId. */
  parentId: string;
  /** Due date / deadline for sorting + display. ISO 'YYYY-MM-DD' or null. */
  dueDate: string | null;
}

interface ComposerItem {
  /** local id within the draft. */
  id: string;
  productId: string;
  mouldId: string;
  /** Number of moulds (matches PlanProduct.quantity). */
  mouldCount: number;
  /** Optional allocations to source lines — orderItem only (POs/subs informational). */
  allocations: Array<{
    sourceLineId: string;
    parentId: string; // orderItemId
    source: DemandSource;
    qty: number;
  }>;
}

interface DraftBatch {
  /** local-only id. */
  id: string;
  name: string;
  notes: string;
  pinnedDate: string | null; // ISO yyyy-mm-dd
  items: ComposerItem[];
}

const STORAGE_KEY = "dulceria.manual-planner.drafts.v1";

// ─── Utils ──────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function startOfWeekMonday(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = out.getUTCDay(); // 0 = Sunday
  const offset = (dow + 6) % 7;
  out.setUTCDate(out.getUTCDate() - offset);
  return out;
}

function buildWeeks(anchor: Date, weekCount: number): { iso: string; day: number; label: string; isToday: boolean }[][] {
  const start = startOfWeekMonday(anchor);
  const today = todayIso();
  const cursor = new Date(start);
  const weeks: { iso: string; day: number; label: string; isToday: boolean }[][] = [];
  for (let w = 0; w < weekCount; w++) {
    const week: { iso: string; day: number; label: string; isToday: boolean }[] = [];
    for (let d = 0; d < 7; d++) {
      const iso = cursor.toISOString().slice(0, 10);
      week.push({
        iso,
        day: cursor.getUTCDate(),
        label: cursor.toLocaleDateString("de-AT", { month: "short" }),
        isToday: iso === today,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function loadDrafts(): DraftBatch[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as DraftBatch[];
  } catch {
    return [];
  }
}

function saveDrafts(drafts: DraftBatch[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // ignore quota errors
  }
}

// ─── Page ───────────────────────────────────────────────────────────

export default function ManualPlannerPage() {
  // Source data
  const orders = useOrders();
  const orderItems = useAllOrderItems();
  const orderVariantLines = useAllOrderVariantLines();
  const productionOrders = useProductionOrders();
  const productionOrderItems = useAllProductionOrderItems();
  const subscriptionRuns = useSubscriptionRuns();
  const subscriptionTemplates = useSubscriptionTemplates(true);
  const products = useProductsList();
  const variants = useVariants();
  const variantPackagings = useAllVariantPackagings();
  const variantComposition = useAllVariantPackagingProducts();
  const packagings = usePackagingList(true);
  const moulds = useMoulds(true);
  const planProducts = useAllPlanProducts();
  const productionPlans = useProductionPlans();
  const orderPlanLinks = useAllOrderPlanLinks();
  const productLocations = useProductLocationTotals();

  // Lookup maps
  const productById = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const mouldById = useMemo(() => new Map(moulds.map((m) => [m.id!, m])), [moulds]);
  const variantById = useMemo(() => new Map(variants.map((v) => [v.id!, v])), [variants]);
  const vpById = useMemo(() => new Map(variantPackagings.map((vp) => [vp.id!, vp])), [variantPackagings]);
  const packagingById = useMemo(() => new Map(packagings.map((p) => [p.id!, p])), [packagings]);
  const orderById = useMemo(() => new Map(orders.map((o) => [o.id!, o])), [orders]);
  const poById = useMemo(() => new Map(productionOrders.map((p) => [p.id!, p])), [productionOrders]);
  const subTemplateById = useMemo(() => new Map(subscriptionTemplates.map((t) => [t.id!, t])), [subscriptionTemplates]);

  // Composition lookup: variantPackagingId → {productId, qty per box}
  const compByVp = useMemo(() => {
    const m = new Map<string, Array<{ productId: string; qty: number }>>();
    for (const c of variantComposition) {
      const arr = m.get(c.variantPackagingId) ?? [];
      arr.push({ productId: c.productId, qty: c.qty });
      m.set(c.variantPackagingId, arr);
    }
    return m;
  }, [variantComposition]);

  // ─── v2 demand aggregation (DemandPicker) ───────────────────────────
  const stockByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const [pid, locs] of productLocations.entries()) {
      m.set(pid, (locs.store ?? 0) + (locs.production ?? 0) + (locs.freezer ?? 0));
    }
    return m;
  }, [productLocations]);

  const productDemands = useMemo(
    () =>
      aggregateDemandByProduct({
        orders,
        orderItems,
        productionOrders,
        productionOrderItems,
        products,
        moulds,
        plans: productionPlans,
        planProducts,
        links: orderPlanLinks,
        stockByProduct,
      }),
    [
      orders,
      orderItems,
      productionOrders,
      productionOrderItems,
      products,
      moulds,
      productionPlans,
      planProducts,
      orderPlanLinks,
      stockByProduct,
    ],
  );

  // Drafts (localStorage) + pinned plans (DB)
  const [drafts, setDrafts] = useState<DraftBatch[]>([]);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setDrafts(loadDrafts());
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    saveDrafts(drafts);
  }, [drafts, hydrated]);

  // Currently-composing batch (one at a time)
  const [composer, setComposer] = useState<DraftBatch | null>(null);

  function startNewBatch() {
    setComposer({
      id: newId(),
      name: `Manual ${new Date().toLocaleDateString("de-AT", { day: "numeric", month: "short" })}`,
      notes: "",
      pinnedDate: null,
      items: [],
    });
  }

  function persistComposerAsDraft() {
    if (!composer) return;
    setDrafts((d) => {
      const others = d.filter((x) => x.id !== composer.id);
      return [...others, composer];
    });
    setComposer(null);
  }

  function loadDraftIntoComposer(id: string) {
    const draft = drafts.find((d) => d.id === id);
    if (!draft) return;
    setComposer(draft);
    setDrafts((d) => d.filter((x) => x.id !== id));
  }

  function deleteDraft(id: string) {
    setDrafts((d) => d.filter((x) => x.id !== id));
  }

  // ─── v2 pick handlers (Phase 2 transitional wiring) ─────────────────
  // Translates DemandPicker line clicks into the existing addItemFromLine
  // call. Phase 3 will replace this with a direct draft-bar accumulation
  // model that doesn't go through DemandLine.
  function handlePickOrderLine({
    orderItemId,
    productId,
    qty,
    customerName,
  }: {
    orderItemId: string;
    productId: string;
    qty: number;
    customerName: string;
  }) {
    const product = productById.get(productId);
    const mouldId = product?.defaultMouldId;
    const mould = mouldId ? mouldById.get(mouldId) : undefined;
    if (!mouldId || !mould || !mould.numberOfCavities) {
      setSaveErr(`No default mould set for ${product?.name ?? productId.slice(0, 8)}.`);
      return;
    }
    const mouldCount = Math.max(1, Math.ceil(qty / mould.numberOfCavities));
    const line: DemandLine = {
      sourceLineId: `oi:${orderItemId}`,
      source: "order",
      productId,
      qty,
      sourceLabel: customerName,
      parentId: orderItemId,
      dueDate: null,
    };
    addItemFromLine(line, mouldId, mouldCount);
  }

  function handlePickPoLine({
    poItemId,
    productId,
    qty,
    poName,
  }: {
    poItemId: string;
    productId: string;
    qty: number;
    poName: string;
  }) {
    const product = productById.get(productId);
    const mouldId = product?.defaultMouldId;
    const mould = mouldId ? mouldById.get(mouldId) : undefined;
    if (!mouldId || !mould || !mould.numberOfCavities) {
      setSaveErr(`No default mould set for ${product?.name ?? productId.slice(0, 8)}.`);
      return;
    }
    const mouldCount = Math.max(1, Math.ceil(qty / mould.numberOfCavities));
    // PO source — no OrderPlanLink-able parent, so parentId stays empty.
    const line: DemandLine = {
      sourceLineId: `poi:${poItemId}`,
      source: "po",
      productId,
      qty,
      sourceLabel: `PO · ${poName}`,
      parentId: "",
      dueDate: null,
    };
    addItemFromLine(line, mouldId, mouldCount);
  }

  // Sets used by DemandPicker to highlight rows already in draft.
  const draftProductId = composer?.items[0]?.productId ?? null;
  const draftOrderItemIds = useMemo(() => {
    const s = new Set<string>();
    if (!composer) return s;
    for (const item of composer.items) {
      for (const a of item.allocations) {
        if (a.source === "order" && a.parentId) s.add(a.parentId);
      }
    }
    return s;
  }, [composer]);
  const draftPoItemIds = useMemo(() => {
    const s = new Set<string>();
    // Phase 2 doesn't store PO allocations on composer items (PO has no
    // link table), so this will populate in Phase 3 when the draft model
    // tracks PO picks. For now the picker won't highlight PO lines as
    // "in draft" — that's an honest gap.
    return s;
  }, []);

  // Adding item from a demand line
  function addItemFromLine(line: DemandLine, mouldId: string, mouldCount: number) {
    if (!composer) {
      const fresh: DraftBatch = {
        id: newId(),
        name: `Manual ${new Date().toLocaleDateString("de-AT", { day: "numeric", month: "short" })}`,
        notes: "",
        pinnedDate: null,
        items: [],
      };
      addItemTo(fresh, line, mouldId, mouldCount);
      setComposer(fresh);
      return;
    }
    setComposer((c) => {
      if (!c) return c;
      const next = { ...c, items: [...c.items] };
      addItemTo(next, line, mouldId, mouldCount);
      return next;
    });
  }

  function addItemTo(batch: DraftBatch, line: DemandLine, mouldId: string, mouldCount: number) {
    const mould = mouldById.get(mouldId);
    if (!mould) return;
    const piecesYielded = mouldCount * (mould.numberOfCavities ?? 0);
    const allocQty = Math.min(line.qty, piecesYielded);
    const item: ComposerItem = {
      id: newId(),
      productId: line.productId,
      mouldId,
      mouldCount,
      allocations:
        line.parentId && line.source === "order"
          ? [
              {
                sourceLineId: line.sourceLineId,
                parentId: line.parentId,
                source: line.source,
                qty: allocQty,
              },
            ]
          : [],
    };
    batch.items.push(item);
  }

  function removeItem(itemId: string) {
    setComposer((c) => (c ? { ...c, items: c.items.filter((i) => i.id !== itemId) } : c));
  }

  function setItemMouldCount(itemId: string, n: number) {
    setComposer((c) => {
      if (!c) return c;
      return {
        ...c,
        items: c.items.map((i) => (i.id === itemId ? { ...i, mouldCount: Math.max(0, n) } : i)),
      };
    });
  }

  function setComposerName(name: string) {
    setComposer((c) => (c ? { ...c, name } : c));
  }
  function setComposerDate(date: string | null) {
    setComposer((c) => (c ? { ...c, pinnedDate: date } : c));
  }

  // Save composer to DB
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  async function saveComposer() {
    if (!composer) return;
    if (!composer.pinnedDate) {
      setSaveErr("Pick a day before saving (drag onto the grid or pick from the date input).");
      return;
    }
    if (composer.items.length === 0) {
      setSaveErr("Batch is empty — add at least one product.");
      return;
    }
    setSaveErr(null);
    setSaving(true);
    try {
      const planId = await saveProductionPlan({
        name: composer.name || "Manual batch",
        status: "active",
        notes: composer.notes || undefined,
        pinnedDate: composer.pinnedDate,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      for (const it of composer.items) {
        await savePlanProduct({
          planId,
          productId: it.productId,
          mouldId: it.mouldId,
          quantity: it.mouldCount,
          sortOrder: 0,
        });
        for (const a of it.allocations) {
          if (a.source !== "order" || !a.parentId) continue;
          try {
            await saveOrderPlanLink({
              orderItemId: a.parentId,
              planId,
              allocatedQuantity: a.qty,
            });
          } catch (e) {
            // Non-blocking — surface in error string but don't roll back.
            console.warn("OrderPlanLink failed", e);
          }
        }
      }
      // Clear composer + delete its draft
      setDrafts((d) => d.filter((x) => x.id !== composer.id));
      setComposer(null);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // Manual saved batches — productionPlans w/ pinnedDate set + at least one planProduct
  const planProductsByPlan = useMemo(() => {
    const m = new Map<string, typeof planProducts>();
    for (const pp of planProducts) {
      const arr = m.get(pp.planId) ?? [];
      arr.push(pp);
      m.set(pp.planId, arr);
    }
    return m;
  }, [planProducts]);

  const pinnedPlansByDate = useMemo(() => {
    const m = new Map<string, Array<{ id: string; name: string; piecesTotal: number }>>();
    for (const plan of productionPlans) {
      if (!plan.pinnedDate) continue;
      if (plan.status === "done" || plan.status === "cancelled") continue;
      const date = plan.pinnedDate.slice(0, 10);
      const items = planProductsByPlan.get(plan.id ?? "") ?? [];
      let pieces = 0;
      for (const pp of items) {
        const m2 = mouldById.get(pp.mouldId);
        const cav = m2?.numberOfCavities ?? 0;
        pieces += pp.actualYield ?? pp.quantity * cav;
      }
      const arr = m.get(date) ?? [];
      arr.push({ id: plan.id ?? "", name: plan.name ?? "Manual batch", piecesTotal: pieces });
      m.set(date, arr);
    }
    return m;
  }, [productionPlans, planProductsByPlan, mouldById]);

  // Week grid
  const [weekAnchor, setWeekAnchor] = useState<Date>(new Date());
  const weeks = useMemo(() => buildWeeks(weekAnchor, 4), [weekAnchor]);

  // Drag state — both demand cards (to compose) and pinned plans (to move)
  const [dragKind, setDragKind] = useState<"composer" | "plan" | null>(null);
  const [dragLabel, setDragLabel] = useState<string>("");
  const draggedPlanId = useRef<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor),
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function handleDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    if (id === "composer-batch") {
      setDragKind("composer");
      setDragLabel(composer?.name ?? "Batch");
      return;
    }
    if (id.startsWith("plan-")) {
      const planId = id.slice(5);
      draggedPlanId.current = planId;
      const plan = productionPlans.find((p) => p.id === planId);
      setDragKind("plan");
      setDragLabel(plan?.name ?? "Batch");
    }
  }

  async function handleDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    const overId = e.over?.id ? String(e.over.id) : "";
    setDragKind(null);
    setDragLabel("");
    const planId = draggedPlanId.current;
    draggedPlanId.current = null;

    if (!overId.startsWith("day-")) return;
    const date = overId.slice(4);

    if (id === "composer-batch") {
      setComposerDate(date);
      return;
    }
    if (id.startsWith("plan-") && planId) {
      const plan = productionPlans.find((p) => p.id === planId);
      if (!plan) return;
      try {
        await saveProductionPlan({
          ...plan,
          pinnedDate: date,
          updatedAt: new Date(),
        });
      } catch (e2) {
        setSaveErr(e2 instanceof Error ? e2.message : String(e2));
      }
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="manual-planner-v2 -mx-4 sm:-mx-6 px-4 sm:px-6 py-4">
        <div className="mb-2">
          <BackButton />
        </div>

        {/* Header — title + subtitle + week nav */}
        <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
          <div>
            <h1
              className="text-3xl"
              style={{
                fontFamily: "var(--font-serif)",
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: "var(--mp-text-primary)",
              }}
            >
              Manual planner
            </h1>
            <p
              className="text-[13px] italic mt-0.5"
              style={{ color: "var(--mp-text-muted)" }}
            >
              Select demand · build a draft batch · drop on a day · save as production order.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const next = new Date(weekAnchor);
                next.setDate(next.getDate() - 7);
                setWeekAnchor(next);
              }}
              className="px-3 py-1.5 text-[13px] hover:bg-[color:var(--mp-hover-bg)]"
              style={{
                border: "0.5px solid var(--mp-border-warm)",
                background: "var(--mp-card-bg)",
                color: "var(--mp-text-primary)",
                borderRadius: 4,
              }}
            >
              ← prev week
            </button>
            <button
              type="button"
              onClick={() => setWeekAnchor(new Date())}
              className="px-3 py-1.5 text-[13px] hover:bg-[color:var(--mp-hover-bg)]"
              style={{
                border: "0.5px solid var(--mp-border-warm)",
                background: "var(--mp-card-bg)",
                color: "var(--mp-text-primary)",
                borderRadius: 4,
              }}
            >
              today
            </button>
            <button
              type="button"
              onClick={() => {
                const next = new Date(weekAnchor);
                next.setDate(next.getDate() + 7);
                setWeekAnchor(next);
              }}
              className="px-3 py-1.5 text-[13px] hover:bg-[color:var(--mp-hover-bg)]"
              style={{
                border: "0.5px solid var(--mp-border-warm)",
                background: "var(--mp-card-bg)",
                color: "var(--mp-text-primary)",
                borderRadius: 4,
              }}
            >
              next week →
            </button>
          </div>
        </div>

        {saveErr ? (
          <div
            className="mb-4 border border-status-alert-edge bg-status-alert-bg px-3 py-2 text-[12px] text-status-alert flex items-start gap-2"
            style={{ borderRadius: 4 }}
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="flex-1">{saveErr}</span>
            <button
              type="button"
              onClick={() => setSaveErr(null)}
              className="text-[10px] uppercase opacity-70 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {/* 3-zone grid: 380px demand picker · 1fr right column (draft bar + week grid) */}
        <div className="grid grid-cols-1 lg:grid-cols-[380px,1fr] gap-6">
          {/* LEFT — DemandPicker v2 (Phase 2) */}
          <div>
            <DemandPicker
              products={productDemands}
              draftProductId={draftProductId}
              draftOrderItemIds={draftOrderItemIds}
              draftPoItemIds={draftPoItemIds}
              onPickOrderLine={handlePickOrderLine}
              onPickPoLine={handlePickPoLine}
            />
          </div>

          {/* RIGHT — draft bar (top) + week grid (main) */}
          <div className="space-y-4 min-w-0">
            <ComposerCard
              composer={composer}
              productById={productById}
              mouldById={mouldById}
              onName={setComposerName}
              onDate={setComposerDate}
              onCount={setItemMouldCount}
              onRemoveItem={removeItem}
              onSave={saveComposer}
              onSaveDraft={persistComposerAsDraft}
              onDiscard={() => setComposer(null)}
              saving={saving}
            />
            <DraftsList drafts={drafts} productById={productById} onLoad={loadDraftIntoComposer} onDelete={deleteDraft} />

            <WeekGrid
              weeks={weeks}
              pinnedPlansByDate={pinnedPlansByDate}
              composerDate={composer?.pinnedDate ?? null}
              composerLabel={composer?.name ?? null}
              composerItemsCount={composer?.items.length ?? 0}
              onShiftWeek={(deltaDays) => {
                const next = new Date(weekAnchor);
                next.setDate(next.getDate() + deltaDays);
                setWeekAnchor(next);
              }}
              onPickDate={(date) => setComposerDate(date)}
              hasComposer={!!composer}
            />
          </div>
        </div>
      </div>

      <DragOverlay>
        {dragKind ? (
          <div
            className="border border-foreground bg-card px-2.5 py-1.5 text-xs shadow-lg"
            style={{ borderRadius: 3, opacity: 0.95 }}
          >
            <strong style={{ fontFamily: "var(--font-serif)", fontWeight: 500, letterSpacing: "-0.01em" }}>
              {dragLabel}
            </strong>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ─── Composer card ─────────────────────────────────────────────────

function ComposerCard({
  composer,
  productById,
  mouldById,
  onName,
  onDate,
  onCount,
  onRemoveItem,
  onSave,
  onSaveDraft,
  onDiscard,
  saving,
}: {
  composer: DraftBatch | null;
  productById: Map<string, Product>;
  mouldById: Map<string, Mould>;
  onName: (n: string) => void;
  onDate: (d: string | null) => void;
  onCount: (id: string, n: number) => void;
  onRemoveItem: (id: string) => void;
  onSave: () => void;
  onSaveDraft: () => void;
  onDiscard: () => void;
  saving: boolean;
}) {
  const draggable = useDraggable({ id: "composer-batch", disabled: !composer });
  if (!composer) {
    return (
      <div
        className="border border-dashed border-border bg-muted/20 p-3 text-[12px] text-muted-foreground"
        style={{ borderRadius: 4 }}
      >
        No batch in progress. Click <strong className="text-foreground">+ Add</strong> on a demand
        line — or <strong className="text-foreground">New batch</strong> at the top — to start.
      </div>
    );
  }

  const totalPieces = composer.items.reduce((s, it) => {
    const m = mouldById.get(it.mouldId);
    return s + it.mouldCount * (m?.numberOfCavities ?? 0);
  }, 0);
  const totalMoulds = composer.items.reduce((s, it) => s + it.mouldCount, 0);

  return (
    <div
      ref={draggable.setNodeRef}
      className="border-2 border-foreground bg-card p-3 space-y-2.5 select-none"
      style={{ borderRadius: 4 }}
    >
      <div className="flex items-baseline gap-2">
        <span
          {...draggable.attributes}
          {...draggable.listeners}
          className="cursor-grab text-muted-foreground"
          title="Drag to a day"
        >
          <GripVertical className="w-4 h-4" />
        </span>
        <input
          value={composer.name}
          onChange={(e) => onName(e.target.value)}
          className="flex-1 text-[13px] bg-transparent border-none outline-none font-medium"
          aria-label="batch name"
        />
      </div>

      <div className="flex items-center gap-2 text-[11px]">
        <label className="text-muted-foreground">Day:</label>
        <input
          type="date"
          value={composer.pinnedDate ?? ""}
          onChange={(e) => onDate(e.target.value || null)}
          className="border border-border bg-card px-1.5 py-0.5 text-[11px]"
          style={{ borderRadius: 2 }}
        />
      </div>

      <div className="text-[10.5px] uppercase text-muted-foreground" style={{ letterSpacing: "0.1em" }}>
        Items · {composer.items.length}
      </div>
      {composer.items.length === 0 ? (
        <p className="text-[12px] text-muted-foreground italic">Drop items in via demand list.</p>
      ) : (
        <ul className="space-y-1.5">
          {composer.items.map((it) => {
            const product = productById.get(it.productId);
            const mould = mouldById.get(it.mouldId);
            const cavities = mould?.numberOfCavities ?? 0;
            const pieces = it.mouldCount * cavities;
            return (
              <li
                key={it.id}
                className="border border-border bg-muted/30 px-2 py-1.5 text-[11.5px]"
                style={{ borderRadius: 3 }}
              >
                <div className="flex items-baseline gap-2">
                  <strong className="flex-1 truncate">{product?.name ?? it.productId.slice(0, 8)}</strong>
                  <button
                    type="button"
                    onClick={() => onRemoveItem(it.id)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="remove"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <div className="text-[10.5px] text-muted-foreground truncate">
                  {mould?.name ?? "no mould"} · {cavities} cav
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <input
                    type="number"
                    min={0}
                    value={it.mouldCount}
                    onChange={(e) => onCount(it.id, Math.max(0, Number(e.target.value) || 0))}
                    className="w-14 text-[11px] border border-border bg-card px-1 py-0.5 tabular-nums"
                    style={{ borderRadius: 2 }}
                    aria-label="moulds"
                  />
                  <span className="text-[10px] text-muted-foreground">moulds → {pieces} pcs</span>
                  {it.allocations.length > 0 && (
                    <span className="ml-auto text-[10px] text-status-ok inline-flex items-center gap-0.5">
                      <Check className="w-3 h-3" />
                      {it.allocations.reduce((s, a) => s + a.qty, 0)} allocated
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center justify-between text-[11px] pt-1.5 border-t border-border">
        <span className="text-muted-foreground">
          Total: <strong className="tabular-nums text-foreground">{totalMoulds}</strong> moulds ·{" "}
          <strong className="tabular-nums text-foreground">{totalPieces}</strong> pcs
        </span>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || composer.items.length === 0 || !composer.pinnedDate}
          className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] uppercase border border-foreground bg-foreground text-background hover:opacity-90 disabled:opacity-40"
          style={{ borderRadius: 3, letterSpacing: "0.08em" }}
        >
          <Save className="w-3 h-3" />
          {saving ? "Saving…" : "Save batch"}
        </button>
        <button
          type="button"
          onClick={onSaveDraft}
          className="inline-flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] uppercase border border-border hover:border-foreground"
          style={{ borderRadius: 3, letterSpacing: "0.08em" }}
          title="Set aside as draft"
        >
          <FileText className="w-3 h-3" /> Draft
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="inline-flex items-center justify-center px-2 py-1.5 text-[11px] uppercase text-muted-foreground hover:text-foreground"
          style={{ letterSpacing: "0.08em" }}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ─── Drafts list ───────────────────────────────────────────────────

function DraftsList({
  drafts,
  productById,
  onLoad,
  onDelete,
}: {
  drafts: DraftBatch[];
  productById: Map<string, Product>;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (drafts.length === 0) return null;
  return (
    <section className="border border-border bg-card p-3" style={{ borderRadius: 4 }}>
      <h3
        className="text-[10px] uppercase text-muted-foreground font-medium mb-2"
        style={{ letterSpacing: "0.12em" }}
      >
        Drafts · {drafts.length}
      </h3>
      <ul className="space-y-1.5">
        {drafts.map((d) => {
          const products = d.items
            .map((i) => productById.get(i.productId)?.name ?? i.productId.slice(0, 6))
            .filter((x, idx, arr) => arr.indexOf(x) === idx)
            .slice(0, 3)
            .join(", ");
          return (
            <li
              key={d.id}
              className="border border-border bg-muted/40 px-2 py-1.5 text-[11px]"
              style={{ borderRadius: 3 }}
            >
              <div className="flex items-baseline gap-2">
                <strong className="flex-1 truncate">{d.name}</strong>
                <button
                  type="button"
                  onClick={() => onDelete(d.id)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="delete draft"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              <div className="text-[10px] text-muted-foreground truncate">
                {d.items.length} item{d.items.length === 1 ? "" : "s"}
                {products && " · " + products}
                {d.pinnedDate && " · " + d.pinnedDate}
              </div>
              <button
                type="button"
                onClick={() => onLoad(d.id)}
                className="mt-1 text-[10px] uppercase text-muted-foreground hover:text-foreground"
                style={{ letterSpacing: "0.08em" }}
              >
                Resume
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ─── Week grid ─────────────────────────────────────────────────────

function WeekGrid({
  weeks,
  pinnedPlansByDate,
  composerDate,
  composerLabel,
  composerItemsCount,
  onShiftWeek,
  onPickDate,
  hasComposer,
}: {
  weeks: { iso: string; day: number; label: string; isToday: boolean }[][];
  pinnedPlansByDate: Map<string, Array<{ id: string; name: string; piecesTotal: number }>>;
  composerDate: string | null;
  composerLabel: string | null;
  composerItemsCount: number;
  onShiftWeek: (deltaDays: number) => void;
  onPickDate: (date: string) => void;
  hasComposer: boolean;
}) {
  return (
    <section className="border border-border bg-card p-4" style={{ borderRadius: 4 }}>
      <div className="flex items-center justify-between mb-3">
        <h2
          className="text-[10px] uppercase text-muted-foreground font-medium"
          style={{ letterSpacing: "0.12em" }}
        >
          Week grid
        </h2>
        <div className="flex items-center gap-2 text-[11px]">
          <button
            type="button"
            onClick={() => onShiftWeek(-7)}
            className="px-2 py-0.5 border border-border hover:border-foreground"
            style={{ borderRadius: 2 }}
          >
            ← Prev week
          </button>
          <button
            type="button"
            onClick={() => onShiftWeek(7)}
            className="px-2 py-0.5 border border-border hover:border-foreground"
            style={{ borderRadius: 2 }}
          >
            Next week →
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-xs">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
          <div
            key={label}
            className="text-center text-[10px] uppercase text-muted-foreground py-1"
            style={{ letterSpacing: "0.12em" }}
          >
            {label}
          </div>
        ))}
        {weeks.flatMap((week, wi) =>
          week.map((day, di) => {
            const pinned = pinnedPlansByDate.get(day.iso) ?? [];
            const isComposer = hasComposer && composerDate === day.iso;
            return (
              <DayCell
                key={`${wi}-${di}`}
                iso={day.iso}
                day={day.day}
                label={day.label}
                isToday={day.isToday}
                pinned={pinned}
                isComposer={isComposer}
                composerLabel={composerLabel}
                composerItemsCount={composerItemsCount}
                hasComposer={hasComposer}
                onClickDay={() => onPickDate(day.iso)}
              />
            );
          }),
        )}
      </div>
    </section>
  );
}

function DayCell({
  iso,
  day,
  label,
  isToday,
  pinned,
  isComposer,
  composerLabel,
  composerItemsCount,
  hasComposer,
  onClickDay,
}: {
  iso: string;
  day: number;
  label: string;
  isToday: boolean;
  pinned: Array<{ id: string; name: string; piecesTotal: number }>;
  isComposer: boolean;
  composerLabel: string | null;
  composerItemsCount: number;
  hasComposer: boolean;
  onClickDay: () => void;
}) {
  const droppable = useDroppable({ id: `day-${iso}` });
  return (
    <div
      ref={droppable.setNodeRef}
      onClick={hasComposer ? onClickDay : undefined}
      className={
        "min-h-[100px] border p-1.5 transition-colors cursor-pointer " +
        (droppable.isOver
          ? "bg-accent-terracotta-bg border-[color:var(--accent-terracotta-ink)]"
          : isComposer
          ? "bg-accent-mustard-bg border-[color:var(--accent-mustard-ink)]"
          : isToday
          ? "bg-muted/60 border-foreground/40"
          : "bg-muted/20 border-border")
      }
      style={{ borderRadius: 3 }}
      title={hasComposer ? "Click to place batch on this day" : iso}
    >
      <div className="flex justify-between items-baseline text-[10px]">
        <span className={isToday ? "text-foreground font-semibold" : "text-muted-foreground"}>
          {day} <span className="opacity-70">{label}</span>
        </span>
        {pinned.length > 0 && <span className="tabular-nums">{pinned.length}</span>}
      </div>
      <ul className="mt-1 space-y-0.5">
        {pinned.slice(0, 3).map((p) => (
          <PinnedPlanChip key={p.id} planId={p.id} name={p.name} pieces={p.piecesTotal} />
        ))}
        {pinned.length > 3 && (
          <li className="text-[10px] text-muted-foreground">+{pinned.length - 3} more</li>
        )}
        {isComposer && (
          <li
            className="px-1.5 py-0.5 text-[10px] truncate bg-foreground text-background border border-foreground"
            style={{ borderRadius: 2 }}
          >
            {composerLabel ?? "Batch"} · {composerItemsCount}
          </li>
        )}
      </ul>
    </div>
  );
}

function PinnedPlanChip({
  planId,
  name,
  pieces,
}: {
  planId: string;
  name: string;
  pieces: number;
}) {
  const draggable = useDraggable({ id: `plan-${planId}` });
  return (
    <li
      ref={draggable.setNodeRef}
      {...draggable.attributes}
      {...draggable.listeners}
      onClick={(e) => e.stopPropagation()}
      className={
        "px-1.5 py-0.5 text-[10px] truncate bg-card border border-border cursor-grab " +
        (draggable.isDragging ? "opacity-40" : "hover:border-foreground")
      }
      style={{ borderRadius: 2 }}
      title={`${name} · ${pieces} pcs`}
    >
      {name}
      <span className="ml-1 text-muted-foreground tabular-nums">·{pieces}</span>
    </li>
  );
}
