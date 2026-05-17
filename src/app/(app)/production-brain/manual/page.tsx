"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  MouseSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  pointerWithin,
} from "@dnd-kit/core";

import {
  useOrders,
  useAllOrderItems,
  useProductionOrders,
  useAllProductionOrderItems,
  useProductsList,
  useMoulds,
  useAllPlanProducts,
  useProductionPlans,
  useAllOrderPlanLinks,
  useAllPoPlanLinks,
  useDraftPlans,
  useProductLocationTotals,
  useAllProductionDayLineItems,
  useProductionDays,
  useCapacityConfig,
  usePeople,
  usePersonUnavailability,
  useEventCalendar,
  useProductionSteps,
  useProductCategories,
} from "@/lib/hooks";
import { queryClient } from "@/lib/query-client";
import { aggregateDemandByProduct } from "@/lib/manual-planner/aggregate-demand";
import type { SmartSuggestion } from "@/lib/manual-planner/smart-suggestions";
import { computeBatchActiveMinutes } from "@/lib/manual-planner/compute-batch-time";
import { effectiveDailyCapacityMinutes } from "@/lib/capacity";
import {
  type DraftBatch,
  type DraftAllocation,
  loadDraft,
  saveDraft,
  newDraft,
  recomputeBatchTotals,
} from "@/lib/manual-planner/draft-state";
import { saveDraftToPlan } from "@/lib/manual-planner/save-draft-to-plan";
import { loadDraftFromPlan } from "@/lib/manual-planner/load-draft-from-plan";
import { deleteParkedDraft } from "@/lib/manual-planner/delete-parked-draft";
import { DraftsTray, buildTrayCards, type TrayCard } from "@/components/manual-planner/drafts-tray";

import { DemandPicker } from "@/components/manual-planner/demand-picker/demand-picker";
import { DraftBar } from "@/components/manual-planner/draft-bar/draft-bar";
import {
  FillMouldModal,
  type FillMouldChoice,
  type PoFillOption,
} from "@/components/manual-planner/draft-bar/fill-mould-modal";
import { ManualWeekGantt } from "@/components/manual-planner/manual-week-gantt";
import { moveStageDay } from "@/lib/manual-planner/move-stage-day";
import { BackButton } from "@/components/back-button";
import { IconAlertTriangle as AlertTriangle } from "@tabler/icons-react";

const DAY_MS = 1000 * 60 * 60 * 24;

function startOfWeekMonday(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = out.getUTCDay();
  const offset = (dow + 6) % 7;
  out.setUTCDate(out.getUTCDate() - offset);
  return out;
}

function isoForOffset(start: Date, offset: number): string {
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

export default function ManualPlannerPage() {
  // ─── Source data ──────────────────────────────────────────────────
  const orders = useOrders();
  const orderItems = useAllOrderItems();
  const productionOrders = useProductionOrders();
  const productionOrderItems = useAllProductionOrderItems();
  const products = useProductsList();
  const moulds = useMoulds(true);
  const planProducts = useAllPlanProducts();
  const productionPlans = useProductionPlans();
  const orderPlanLinks = useAllOrderPlanLinks();
  const poPlanLinks = useAllPoPlanLinks();
  const draftPlanCards = useDraftPlans();
  const productLocations = useProductLocationTotals();
  const dayLineItems = useAllProductionDayLineItems();
  const productionDays = useProductionDays(120);
  const capacityConfig = useCapacityConfig();
  const people = usePeople();
  const personUnavailability = usePersonUnavailability();
  const eventCalendar = useEventCalendar();
  const productionSteps = useProductionSteps();
  const productCategories = useProductCategories();

  // Lookup maps
  const productById = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const mouldById = useMemo(() => new Map(moulds.map((m) => [m.id!, m])), [moulds]);
  const planById = useMemo(() => new Map(productionPlans.map((p) => [p.id!, p])), [productionPlans]);
  const planProductsByPlan = useMemo(() => {
    const m = new Map<string, typeof planProducts>();
    for (const pp of planProducts) {
      const arr = m.get(pp.planId) ?? [];
      arr.push(pp);
      m.set(pp.planId, arr);
    }
    return m;
  }, [planProducts]);
  const stepById = useMemo(
    () => new Map(productionSteps.map((s) => [s.id!, s])),
    [productionSteps],
  );
  const categoryById = useMemo(
    () => new Map(productCategories.map((c) => [c.id!, c])),
    [productCategories],
  );
  const productionDayDateById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of productionDays) {
      if (d.id && d.date) m.set(d.id, d.date.slice(0, 10));
    }
    return m;
  }, [productionDays]);

  // ─── v2 demand aggregation ────────────────────────────────────────
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
        poLinks: poPlanLinks,
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
      poPlanLinks,
      stockByProduct,
    ],
  );

  // ─── Draft state (single, localStorage-persisted) ─────────────────
  const [draft, setDraftState] = useState<DraftBatch | null>(null);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setDraftState(loadDraft());
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    saveDraft(draft);
  }, [draft, hydrated]);

  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingFillMould, setPendingFillMould] = useState<{
    availablePos: PoFillOption[];
    currentStock: number;
  } | null>(null);

  function setDraft(updater: DraftBatch | null | ((cur: DraftBatch | null) => DraftBatch | null)) {
    if (typeof updater === "function") {
      setDraftState((cur) => updater(cur));
    } else {
      setDraftState(updater);
    }
  }

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

    setSaveErr(null);
    setDraft((cur) => {
      const item = orders
        .map((o) => o)
        .find((o) => o.id === orderItems.find((it) => it.id === orderItemId)?.orderId);
      const dueDate = item?.deadline ? item.deadline.slice(0, 10) : null;
      const allocation: DraftAllocation = {
        source: "order",
        parentId: orderItemId,
        qty,
        label: customerName,
        dueDate,
      };

      if (!cur) {
        const fresh = newDraft({
          productId,
          productName: product?.name ?? productId.slice(0, 8),
          mouldId,
          mouldName: mould.name,
          numberOfCavities: mould.numberOfCavities,
        });
        fresh.allocations.push(allocation);
        return recomputeBatchTotals(fresh);
      }
      if (cur.productId !== productId) {
        // AC10: cross-product line click → prompt, park current, init new.
        const ok = window.confirm(
          `Start new draft for ${product?.name ?? "this product"}? Current draft '${cur.productName}' will be parked.`,
        );
        if (!ok) return cur;
        void autoParkIfDirty().then(() => {
          const fresh = newDraft({
            productId,
            productName: product?.name ?? productId.slice(0, 8),
            mouldId,
            mouldName: mould.name,
            numberOfCavities: mould.numberOfCavities,
          });
          fresh.allocations.push(allocation);
          setDraft(recomputeBatchTotals(fresh));
        });
        return cur;
      }
      // Same product → upsert by parentId.
      const existingIdx = cur.allocations.findIndex(
        (a) => a.source === "order" && a.parentId === orderItemId,
      );
      const next = { ...cur, allocations: [...cur.allocations] };
      if (existingIdx >= 0) {
        next.allocations[existingIdx] = allocation;
      } else {
        next.allocations.push(allocation);
      }
      return recomputeBatchTotals(next);
    });
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

    setSaveErr(null);
    setDraft((cur) => {
      const allocation: DraftAllocation = {
        source: "po",
        parentId: poItemId,
        qty,
        label: poName,
        dueDate: null,
      };
      if (!cur) {
        const fresh = newDraft({
          productId,
          productName: product?.name ?? productId.slice(0, 8),
          mouldId,
          mouldName: mould.name,
          numberOfCavities: mould.numberOfCavities,
        });
        fresh.allocations.push(allocation);
        return recomputeBatchTotals(fresh);
      }
      if (cur.productId !== productId) {
        const ok = window.confirm(
          `Start new draft for ${product?.name ?? "this product"}? Current draft '${cur.productName}' will be parked.`,
        );
        if (!ok) return cur;
        void autoParkIfDirty().then(() => {
          const fresh = newDraft({
            productId,
            productName: product?.name ?? productId.slice(0, 8),
            mouldId,
            mouldName: mould.name,
            numberOfCavities: mould.numberOfCavities,
          });
          fresh.allocations.push(allocation);
          setDraft(recomputeBatchTotals(fresh));
        });
        return cur;
      }
      const existingIdx = cur.allocations.findIndex(
        (a) => a.source === "po" && a.parentId === poItemId,
      );
      const next = { ...cur, allocations: [...cur.allocations] };
      if (existingIdx >= 0) {
        next.allocations[existingIdx] = allocation;
      } else {
        next.allocations.push(allocation);
      }
      return recomputeBatchTotals(next);
    });
  }

  function handleAcceptSuggestion(productId: string, suggestion: SmartSuggestion) {
    const product = productById.get(productId);
    const mouldId = product?.defaultMouldId;
    const mould = mouldId ? mouldById.get(mouldId) : undefined;
    if (!mouldId || !mould || !mould.numberOfCavities) {
      setSaveErr(`No default mould set for ${product?.name ?? productId.slice(0, 8)}.`);
      return;
    }

    setSaveErr(null);
    setDraft((cur) => {
      // Different product in draft → block. User cancels first.
      if (cur && cur.productId !== productId) {
        setSaveErr(
          `Draft already has ${cur.productName}. Save or cancel it before accepting a suggestion for ${product?.name ?? "this product"}.`,
        );
        return cur;
      }

      const base =
        cur ??
        newDraft({
          productId,
          productName: product?.name ?? productId.slice(0, 8),
          mouldId,
          mouldName: mould.name,
          numberOfCavities: mould.numberOfCavities,
        });

      // Merge picks into existing allocations (upsert by parentId+source).
      const merged = [...base.allocations];
      for (const p of suggestion.picks) {
        const idx = merged.findIndex(
          (a) => a.source === p.source && a.parentId === p.parentId,
        );
        const allocation: DraftAllocation = {
          source: p.source,
          parentId: p.parentId,
          qty: p.qty,
          label: p.label,
          dueDate: p.dueDate,
        };
        if (idx >= 0) merged[idx] = allocation;
        else merged.push(allocation);
      }

      const next: DraftBatch = {
        ...base,
        allocations: merged,
        // Suggestion-driven surplus destination only if user hasn't already
        // chosen one — never silently overwrite a manual choice.
        surplusDestination: base.surplusDestination ?? suggestion.surplusDestination,
      };
      return recomputeBatchTotals(next);
    });
  }

  function handleRemoveAllocation(parentId: string, source: "order" | "po") {
    setDraft((cur) => {
      if (!cur) return cur;
      const next = {
        ...cur,
        allocations: cur.allocations.filter(
          (a) => !(a.source === source && a.parentId === parentId),
        ),
      };
      if (next.allocations.length === 0) return null;
      return recomputeBatchTotals(next);
    });
  }

  function handleCancelDraft() {
    setDraft(null);
    setSaveErr(null);
  }

  function handleNameDraft(name: string) {
    setDraft((cur) => (cur ? { ...cur, name } : cur));
  }

  function isDraftDirty(d: DraftBatch | null): boolean {
    // Dirty == has at least one allocation. Surplus destination on its own
    // does NOT count — that path spawned empty parked drafts before the
    // 2026-05-17 fix.
    if (!d) return false;
    return d.allocations.length > 0;
  }

  /** Silently park the current draft if dirty. Used before switching drafts
   *  (load parked, new draft, cross-product line click). No prompt — the
   *  caller already obtained user consent. */
  async function autoParkIfDirty(): Promise<void> {
    if (!isDraftDirty(draft)) return;
    if (!draft) return;
    try {
      await saveDraftToPlan(draft, { status: "draft" });
      queryClient.invalidateQueries({ queryKey: ["production-plans"] });
      queryClient.invalidateQueries({ queryKey: ["plan-products"] });
      queryClient.invalidateQueries({ queryKey: ["order-plan-links"] });
      queryClient.invalidateQueries({ queryKey: ["po-plan-links"] });
    } catch (e) {
      setSaveErr(`Auto-park failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleParkDraft(): Promise<void> {
    if (!draft) return;
    if (draft.allocations.length === 0) {
      setSaveErr("Nothing to park — add at least one allocation first.");
      return;
    }
    setSaving(true);
    setSaveErr(null);
    try {
      const result = await saveDraftToPlan(draft, { status: "draft" });
      if (result.warnings.length > 0) {
        setSaveErr(`Parked with warnings: ${result.warnings.join("; ")}`);
      }
      setDraft(null);
      queryClient.invalidateQueries({ queryKey: ["production-plans"] });
      queryClient.invalidateQueries({ queryKey: ["plan-products"] });
      queryClient.invalidateQueries({ queryKey: ["order-plan-links"] });
      queryClient.invalidateQueries({ queryKey: ["po-plan-links"] });
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleLoadTrayCard(card: TrayCard): Promise<void> {
    if (card.kind === "active") return; // already loaded
    if (isDraftDirty(draft) && draft?.id !== card.id) {
      const ok = window.confirm(
        `Switch to '${card.name}'? Your current draft will be parked.`,
      );
      if (!ok) return;
      await autoParkIfDirty();
    }
    setSaveErr(null);
    try {
      const loaded = await loadDraftFromPlan(card.id);
      setDraft(loaded);
      // Loading from DB transfers ownership of the row to the editor —
      // delete the parked plan so it doesn't double up in the tray.
      // Re-save happens via Park or Save & pin.
      await deleteParkedDraft(card.id);
      queryClient.invalidateQueries({ queryKey: ["production-plans"] });
    } catch (e) {
      setSaveErr(`Load failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleDeleteTrayCard(card: TrayCard): Promise<void> {
    if (card.kind === "active") {
      handleCancelDraft();
      return;
    }
    const ok = window.confirm(`Delete parked draft '${card.name}'? This can't be undone.`);
    if (!ok) return;
    try {
      await deleteParkedDraft(card.id);
      queryClient.invalidateQueries({ queryKey: ["production-plans"] });
    } catch (e) {
      setSaveErr(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleNewDraft(): Promise<void> {
    if (isDraftDirty(draft)) {
      const ok = window.confirm("Park current draft and start a new one?");
      if (!ok) return;
      await autoParkIfDirty();
    }
    setDraft(null);
    setSaveErr(null);
  }

  async function commitDraftToDb(toSave: DraftBatch) {
    setSaving(true);
    setSaveErr(null);
    try {
      const result = await saveDraftToPlan(toSave, {
        status: "active",
        pinnedDate: toSave.pinnedDate,
      });
      if (result.warnings.length > 0) {
        setSaveErr(`Saved with warnings: ${result.warnings.join("; ")}`);
      }
      setDraft(null);
      queryClient.invalidateQueries({ queryKey: ["production-plans"] });
      queryClient.invalidateQueries({ queryKey: ["plan-products"] });
      queryClient.invalidateQueries({ queryKey: ["order-plan-links"] });
      queryClient.invalidateQueries({ queryKey: ["po-plan-links"] });
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function handleSaveDraft() {
    if (!draft) return;
    // Modal trigger: surplus pieces with no destination chosen + at least one
    // allocation. Skip the modal when surplus is 0 (perfect fit) or when the
    // user has already chosen a destination via a smart suggestion.
    const allocatedPo = new Map<string, number>();
    for (const a of draft.allocations) {
      if (a.source === "po") allocatedPo.set(a.parentId, a.qty);
    }
    if (draft.surplus > 0 && draft.surplusDestination == null && draft.allocations.length > 0) {
      const productDemand = productDemands.find((p) => p.productId === draft.productId);
      const availablePos: PoFillOption[] = [];
      for (const po of productDemand?.poItems ?? []) {
        const alreadyTaken = allocatedPo.get(po.poItemId) ?? 0;
        const remaining = Math.max(0, po.remaining - alreadyTaken);
        if (remaining <= 0) continue;
        availablePos.push({
          poItemId: po.poItemId,
          poName: po.poName,
          remaining,
          originalQty: po.originalQty,
        });
      }
      setPendingFillMould({
        availablePos,
        currentStock: stockByProduct.get(draft.productId) ?? 0,
      });
      return;
    }
    void commitDraftToDb(draft);
  }

  function handleFillMouldChoice(choice: FillMouldChoice) {
    if (!draft) {
      setPendingFillMould(null);
      return;
    }
    let next: DraftBatch = { ...draft, surplusDestination: choice.surplusDestination };
    if (choice.surplusDestination === "po-fill" && choice.poFillPick) {
      const allocations = [...next.allocations];
      const idx = allocations.findIndex(
        (a) => a.source === "po" && a.parentId === choice.poFillPick!.poItemId,
      );
      const alloc: DraftAllocation = {
        source: "po",
        parentId: choice.poFillPick.poItemId,
        qty:
          (idx >= 0 ? allocations[idx].qty : 0) + choice.poFillPick.qty,
        label: choice.poFillPick.poName,
        dueDate: idx >= 0 ? allocations[idx].dueDate : null,
      };
      if (idx >= 0) allocations[idx] = alloc;
      else allocations.push(alloc);
      next = recomputeBatchTotals({ ...next, allocations });
      // After absorbing surplus into a PO line, the surplus number shifts.
      // Keep destination so saveDraftToPlan stores the intent on the plan.
      next.surplusDestination = "po-fill";
    }
    setDraft(next);
    setPendingFillMould(null);
    void commitDraftToDb(next);
  }

  function handleFillMouldCancel() {
    setPendingFillMould(null);
  }

  // ─── Picker highlight sets ────────────────────────────────────────
  const draftProductId = draft?.productId ?? null;
  const draftOrderItemIds = useMemo(() => {
    const s = new Set<string>();
    if (!draft) return s;
    for (const a of draft.allocations) {
      if (a.source === "order") s.add(a.parentId);
    }
    return s;
  }, [draft]);
  const draftPoItemIds = useMemo(() => {
    const s = new Set<string>();
    if (!draft) return s;
    for (const a of draft.allocations) {
      if (a.source === "po") s.add(a.parentId);
    }
    return s;
  }, [draft]);

  // ─── Week grid data: capacity + lineItems by date ─────────────────
  const [weekAnchor, setWeekAnchor] = useState<Date>(new Date());

  const weekIsoSet = useMemo(() => {
    const start = startOfWeekMonday(weekAnchor);
    const out = new Set<string>();
    for (let i = 0; i < 7; i++) out.add(isoForOffset(start, i));
    return out;
  }, [weekAnchor]);

  const capacityByDate = useMemo(() => {
    const m = new Map<string, { used: number; capacity: number }>();
    for (const iso of weekIsoSet) {
      const d = new Date(iso + "T12:00:00");
      const cap = effectiveDailyCapacityMinutes(
        d,
        capacityConfig,
        people,
        personUnavailability,
        eventCalendar,
      );
      m.set(iso, { used: 0, capacity: cap });
    }
    for (const li of dayLineItems) {
      const date = productionDayDateById.get(li.productionDayId);
      if (!date || !weekIsoSet.has(date)) continue;
      const cur = m.get(date) ?? { used: 0, capacity: 0 };
      cur.used += li.plannedMinutes ?? 0;
      m.set(date, cur);
    }
    return m;
  }, [
    weekIsoSet,
    capacityConfig,
    people,
    personUnavailability,
    eventCalendar,
    dayLineItems,
    productionDayDateById,
  ]);

  // (Legacy itemsByDate memo removed 2026-05-17. WeekStripPills builds its
  //  own pill list internally so the redundant DayLineItemView shape is
  //  no longer needed on this page.)

  // ─── Active-minutes for the draft (informational on the bar) ─────
  const draftActiveMinutes = useMemo(() => {
    if (!draft) return 0;
    const product = productById.get(draft.productId);
    const cat = product?.productCategoryId
      ? categoryById.get(product.productCategoryId)
      : undefined;
    const productType = cat?.name;
    return computeBatchActiveMinutes(productType, draft.mouldCount, productionSteps);
  }, [draft, productById, categoryById, productionSteps]);

  const pinnedDateLabel = useMemo(() => {
    if (!draft?.pinnedDate) return null;
    return new Date(draft.pinnedDate + "T00:00:00").toLocaleDateString("de-AT", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }, [draft?.pinnedDate]);

  // ─── DnD ──────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor),
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  async function handleDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    const overId = e.over?.id ? String(e.over.id) : "";
    // Drop target id formats accepted:
    //   - `plan-day-<iso>`                ← legacy + WeekStripPills + Gantt fallback
    //   - `plan-day-<iso>-<planId>`        ← Gantt row-specific drop target
    //   - `day-<iso>`                      ← legacy manual-planner WeekGrid
    // Parse the iso date out of any of these forms.
    let date: string | null = null;
    if (overId.startsWith("plan-day-")) {
      const rest = overId.slice("plan-day-".length);
      // The iso (yyyy-mm-dd) is exactly 10 chars and may be followed by
      // `-<planId>` (uuid). Take the leading 10 chars when present.
      if (/^\d{4}-\d{2}-\d{2}/.test(rest)) date = rest.slice(0, 10);
    } else if (overId.startsWith("day-")) {
      date = overId.slice("day-".length);
    }
    if (!date) return;

    const data = e.active.data.current as
      | { kind?: string; planId?: string; stepId?: string; sourceDate?: string;
          trayCardId?: string; trayCardKind?: string }
      | undefined;

    // ── Stage chip drop (Gantt) ────────────────────────────────────
    if (data?.kind === "stage" && data.planId && data.stepId) {
      if (data.sourceDate === date) return; // same day no-op
      const today = new Date().toISOString().slice(0, 10);
      if (date < today) {
        setSaveErr("Cannot move a stage to a past day.");
        return;
      }
      try {
        await moveStageDay({ planId: data.planId, stepId: data.stepId, targetDate: date });
      } catch (err) {
        setSaveErr(`Move failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (id === "manual-draft-batch") {
      setDraft((cur) => (cur ? { ...cur, pinnedDate: date } : cur));
      return;
    }
    if (id.startsWith("draft-card-")) {
      if (!data?.trayCardId) return;
      if (data.trayCardKind === "active") {
        setDraft((cur) => (cur ? { ...cur, pinnedDate: date } : cur));
        return;
      }
      // Parked card dropped on a day: load → pin → caller must hit "Save & pin".
      if (isDraftDirty(draft) && draft?.id !== data.trayCardId) {
        const ok = window.confirm(
          "Switch drafts? Current draft will be parked.",
        );
        if (!ok) return;
        await autoParkIfDirty();
      }
      try {
        const loaded = await loadDraftFromPlan(data.trayCardId);
        await deleteParkedDraft(data.trayCardId);
        setDraft({ ...loaded, pinnedDate: date });
        queryClient.invalidateQueries({ queryKey: ["production-plans"] });
      } catch (err) {
        setSaveErr(`Load failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const warnPercent = capacityConfig?.warnThresholdPercent ?? 75;
  const criticalPercent = capacityConfig?.criticalThresholdPercent ?? 90;

  // ─── Render ───────────────────────────────────────────────────────
  // Three-zone column per CURSOR_PROMPT_MANUAL_PLANNER_WORKFLOW.md:
  //   - mp-scroll-zone owns the only scroll on the page (header + warn-strip + demand card)
  //   - mp-action-cluster is sticky-pinned to the bottom and has its own
  //     three rows: drafts row, week-nav row, week strip.
  const weekLabel = (() => {
    const start = startOfWeekMonday(weekAnchor);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const year = end.getUTCFullYear();
    return `${fmt(start)} — ${fmt(end)}, ${year}`;
  })();

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>
      <div className="ds manual-planner-v2 mp-page-root -mx-4 sm:-mx-6">
        {/* ── Middle zone: only this scrolls. ──────────────────────── */}
        <div className="mp-scroll-zone px-4 sm:px-6 pt-4 pb-3">
          <div className="mb-2">
            <BackButton />
          </div>

          <div className="mb-4">
            <h1
              className="text-2xl"
              style={{
                fontFamily: "var(--font-serif)",
                fontWeight: 700,
                letterSpacing: "-0.01em",
                color: "var(--mp-text-primary)",
              }}
            >
              Manual planner
            </h1>
            <p className="text-[12px] mt-0.5" style={{ color: "var(--mp-text-muted)" }}>
              Select demand · build a draft batch · drop on a day · save as production order.
            </p>
          </div>

          {saveErr ? (
            <div
              className="mb-3 px-3 py-1.5 text-[12px] flex items-start gap-2"
              style={{
                border: "1px solid #e8c5b1",
                background: "var(--mp-blush)",
                color: "#8a4530",
                borderRadius: 6,
              }}
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span className="flex-1">{saveErr}</span>
              <button
                type="button"
                onClick={() => setSaveErr(null)}
                className="text-[10px] uppercase font-semibold opacity-80 hover:opacity-100"
              >
                Dismiss
              </button>
            </div>
          ) : null}

          <DemandPicker
            products={productDemands}
            draftProductId={draftProductId}
            draftOrderItemIds={draftOrderItemIds}
            draftPoItemIds={draftPoItemIds}
            onPickOrderLine={handlePickOrderLine}
            onPickPoLine={handlePickPoLine}
            onAcceptSuggestion={handleAcceptSuggestion}
          />
        </div>

        {/* ── Bottom zone: sticky cluster. Three rows. ─────────────── */}
        <div className="mp-action-cluster">
          {/* Row 1 — drafts row: active draft (left) + other-drafts queue (right).
              If no active draft, queue takes the full row. */}
          <div className="mp-cluster-row drafts" style={{ alignItems: "stretch" }}>
            {draft ? (
              <div style={{ flex: "0 0 360px" }}>
                <DraftBar
                  draft={draft}
                  totalActiveMinutes={draftActiveMinutes}
                  onRemoveAllocation={handleRemoveAllocation}
                  onCancel={handleCancelDraft}
                  onSave={handleSaveDraft}
                  onPark={() => { void handleParkDraft(); }}
                  onName={handleNameDraft}
                  saving={saving}
                  pinnedDateLabel={pinnedDateLabel}
                />
              </div>
            ) : null}
            <div style={{ flex: 1, minWidth: 0 }}>
              <DraftsTray
                cards={buildTrayCards(draftPlanCards, draft)}
                onLoadCard={(c) => { void handleLoadTrayCard(c); }}
                onDeleteCard={(c) => { void handleDeleteTrayCard(c); }}
                onNewDraft={() => { void handleNewDraft(); }}
              />
            </div>
          </div>

          {/* Row 2 — week nav (prev / label / today / next + hint). */}
          <div className="mp-cluster-row week-nav">
            <button
              type="button"
              onClick={() => {
                const next = new Date(weekAnchor);
                next.setDate(next.getDate() - 7);
                setWeekAnchor(next);
              }}
              style={{
                padding: "3px 9px",
                borderRadius: 5,
                fontSize: 11.5,
                border: "1px solid var(--mp-border-warm)",
                background: "var(--mp-card-bg)",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              ← prev week
            </button>
            <span style={{ fontWeight: 600, fontSize: 12.5 }}>{weekLabel}</span>
            <button
              type="button"
              onClick={() => setWeekAnchor(new Date())}
              style={{
                padding: "3px 9px",
                borderRadius: 5,
                fontSize: 11.5,
                fontWeight: 600,
                border: "1px solid var(--mp-border-warm)",
                background: "var(--mp-card-bg)",
                cursor: "pointer",
                fontFamily: "inherit",
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
              style={{
                padding: "3px 9px",
                borderRadius: 5,
                fontSize: 11.5,
                border: "1px solid var(--mp-border-warm)",
                background: "var(--mp-card-bg)",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              next week →
            </button>
            <span style={{ flex: 1 }} />
            <span
              style={{
                fontSize: 11,
                color: "var(--mp-text-muted)",
                fontStyle: "italic",
              }}
            >
              drop active draft on a day → save &amp; pin
            </span>
          </div>

          {/* Row 3 — week view: Gantt grid per
              MANUAL_PLANNER_WEEK_VIEW_GANTT.md. Rows=batches, cols=days,
              cells=StageChips. Drag a chip to another day → moveStageDay
              rewrites the stepIds[] across productionDayLineItems rows. */}
          <div className="mp-cluster-row week-strip">
            <ManualWeekGantt
              weekAnchor={weekAnchor}
              productionDays={productionDays}
              lineItems={dayLineItems}
              plans={productionPlans}
              planProducts={planProducts}
              productionSteps={productionSteps}
              productCategories={productCategories}
              products={products}
              moulds={moulds}
              dailyActiveCapacityMinutes={effectiveDailyCapacityMinutes(
                new Date(),
                capacityConfig,
                people,
                personUnavailability,
                eventCalendar,
              ) || null}
              draftPinnedDate={draft?.pinnedDate ?? null}
              draftPreview={
                draft
                  ? {
                      name: draft.name,
                      pieces: draft.totalPieces,
                      mouldCount: draft.mouldCount,
                    }
                  : null
              }
            />
          </div>
        </div>

        {pendingFillMould && draft && (
          <FillMouldModal
            draft={draft}
            availablePos={pendingFillMould.availablePos}
            currentStock={pendingFillMould.currentStock}
            onCancel={handleFillMouldCancel}
            onConfirm={handleFillMouldChoice}
          />
        )}
      </div>
    </DndContext>
  );
}
