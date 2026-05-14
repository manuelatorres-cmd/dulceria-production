"use client";

import { use, useEffect, useMemo, useState } from "react";
import {
  useProductionPlan, usePlanProducts, usePlanStepStatuses,
  useProductsList, useProductFillingsForProducts, useFillings, useFillingIngredientsForFillings,
  useMouldsList, useIngredients, saveProductionPlan, savePlanProduct, toggleStep,
  useDecorationMaterials, setDecorationMaterialLowStock,
  saveFillingStock, deductFillingStock, useShelfStableCategoryNames,
  recordUnmouldIntake, checkDeadlineImpactForProduct,
  usePackagingList, consumePackaging,
  useLinksForPlan, useOrders, useAllOrderItems,
  promoteOrdersForPlan, startProductionPlan,
  useAllProductionDayLineItems, useProductionDays, useProductionSteps,
  deductShellForPlanProduct, prepareFillingForBatch, consumeFillingStockForPlanProduct,
  consumeProductStockForPacking, commitAllocationSplit,
  useProductionOrders, useAllProductionOrderItems,
  usePeople, useAllIngredientStock, useMouldPool, useEquipmentInstances,
  useMachineLoads, useEquipment,
} from "@/lib/hooks";
import { PackingModal } from "@/components/packing-modal";
import { generateSteps, calculateFillingAmounts, consolidateSharedFillings, generateBatchSummary, FILL_FACTOR, DENSITY_G_PER_ML } from "@/lib/production";
import { calculateShellWeightG } from "@/lib/costCalculation";
import type { Filling, Mould, PlanProduct, Product, DecorationMaterial, Ingredient } from "@/types";
import { normalizeApplyAt } from "@/types";
import { IconRotate as RotateCcw, IconPencil as Pencil, IconCheck as Check, IconX as X, IconBookmark as BookOpen, IconNote as StickyNote, IconPlus as Plus, IconClipboardList as ClipboardList, IconPrinter as Printer, IconPlayerPlay as Play, IconGripVertical } from "@tabler/icons-react";
import {
  DsDetailPage, Section, ListRow, StatCard, DsButton, DsDrawer, DsDialog, StatusTag, type StatusTagKind,
  DsInlineSelect, DsInlineField, DsInlineTextarea,
} from "@/components/dulceria";
import { YieldModal } from "@/components/yield-modal";
import type { YieldEntry } from "@/components/yield-modal";
import {
  AllocationSplitModal,
  type AllocationSplitOrderRow,
  type AllocationSplitPoRow,
  type AllocationSplitResult,
} from "@/components/allocation-split-modal";
import { LeftoverModal } from "@/components/leftover-modal";
import type { LeftoverEntry } from "@/components/leftover-modal";
import { LowStockFlagButton } from "@/components/pantry";
import { printLabels } from "@/lib/printer";
import type { LabelData } from "@/lib/printer";
import Link from "next/link";

/**
 * 8 phase tabs shown at the top of every batch detail page. The `id`
 * values are the canonical step-group tokens (kept stable so old
 * planStepStatus rows keep working); only the `label` text reflects
 * the operator-facing vocabulary: Polishing / Painting / Shelling /
 * Filling Prep / Filling / Capping / Unmoulding / Packing. Transfer
 * is NOT present — transfer sheets are a decoration material applied
 * during Capping, not a step.
 */
const PHASES = [
  { id: "polishing", label: "Polishing"    },
  { id: "colour",    label: "Painting"     },
  { id: "shell",     label: "Shelling"     },
  { id: "filling",   label: "Filling Prep" },
  { id: "fill",      label: "Filling"      },
  { id: "cap",       label: "Capping"      },
  { id: "unmould",   label: "Unmoulding"   },
  { id: "packing",   label: "Packing"      },
] as const;

type PhaseId = typeof PHASES[number]["id"];

/** Phase C wizard steps. Replaces the legacy single-screen 8-phase
 *  view with a linear 5-step flow. URL state via ?step=. The 8 phase
 *  tabs live under step=production. */
const WIZARD_STEPS = [
  { id: "plan",       label: "1 Plan"       },
  { id: "prep",       label: "2 Prep"       },
  { id: "production", label: "3 Production" },
  { id: "packing",    label: "4 Packing"    },
  { id: "wrapup",     label: "5 Wrap up"    },
] as const;
type WizardStepId = typeof WIZARD_STEPS[number]["id"];

/** Per-phase left-border colour for the C.4 phase cards. Mirrors the
 *  /production-brain/daily palette so both surfaces feel like the
 *  same workshop, just at different zoom levels. */
const PHASE_COLOR: Record<PhaseId, string> = {
  polishing: "var(--accent-butter-ink)",
  colour:    "var(--accent-blush-ink)",
  shell:     "var(--accent-butter-ink)",
  filling:   "var(--accent-lilac-ink)",
  fill:      "var(--ds-semantic-info)",
  cap:       "var(--ds-tier-positive)",
  unmould:   "var(--accent-mint-ink)",
  packing:   "var(--accent-cocoa-ink)",
};

/** Map a user-facing step name to one of our 8 canonical phases.
 *  Exact match first (handles "Filling Prep" vs "Filling" correctly);
 *  keyword fallback for custom step names. Returns null for unmappable
 *  names. */
function stepNameToPhase(name: string): PhaseId | null {
  const n = name.toLowerCase().trim();
  // Exact matches take precedence — "Filling Prep" must NOT collide
  // with "Filling" just because both contain "filling".
  if (n === "polishing") return "polishing";
  if (n === "painting" || n === "colour" || n === "color") return "colour";
  if (n === "shelling" || n === "tempering") return "shell";
  if (n === "filling prep") return "filling";
  if (n === "filling") return "fill";
  if (n === "capping") return "cap";
  if (n === "unmoulding" || n === "unmolding") return "unmould";
  if (n === "packing") return "packing";
  // Keyword fallback — order matters; more specific phases first so
  // "Filling Prep" is caught by the "prep" keyword before the generic
  // "fill" rule fires.
  if (n.includes("polish")) return "polishing";
  if (n.includes("paint") || n.includes("colour") || n.includes("color")) return "colour";
  if (n.includes("temper")) return "shell";
  if (n.includes("shell")) return "shell";
  if (n.includes("prep")) return "filling";
  if (n.includes("pack")) return "packing";
  if (n.includes("unmould") || n.includes("unmold")) return "unmould";
  if (n.includes("cap")) return "cap";
  if (n.includes("fill")) return "fill";
  return null;
}

export default function ProductionPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = use(params);
  const planId = decodeURIComponent(idStr);

  const plan = useProductionPlan(planId);
  const planProducts = usePlanProducts(planId);
  const stepStatuses = usePlanStepStatuses(planId);
  const products = useProductsList();
  const allFillings = useFillings();
  const moulds = useMouldsList(true);

  // Build lookup maps
  const productNames = useMemo(() => new Map(products.map((r) => [r.id!, r.name])), [products]);
  const productsMap = useMemo(() => new Map(products.map((r) => [r.id!, r])), [products]);
  const fillingsMap = useMemo(() => new Map(allFillings.map((l) => [l.id!, l])), [allFillings]);
  const mouldsMap = useMemo(() => new Map(moulds.map((m) => [m.id!, m])), [moulds]);
  const statusMap = useMemo(() => {
    const map = new Map(stepStatuses.map((s) => [s.stepKey, s.done]));
    // Backward compat: legacy filling step keys were filling-{planProductId}-{fillingId}.
    // If any legacy key is done, propagate to the new consolidated key filling-{fillingId}.
    for (const s of stepStatuses) {
      const match = s.stepKey.match(/^filling-.+-(.+)$/);
      if (match && s.done) {
        const newKey = `filling-${match[1]}`;
        if (!map.has(newKey)) map.set(newKey, true);
      }
    }
    // Cross-view sync: when a higher-level row is marked done (a phase
    // key like "polishing" or a per-product key like "polishing-<ppId>"),
    // synthesise done state for every concrete sub-step that shares
    // the same prefix. Keeps the wizard's checkboxes aligned with
    // ticks made on /orders/<id>/production or /campaigns/<id>/production
    // even though those views don't enumerate sub-steps. The sub-step
    // rows in DB stay missing — saving them all there would require
    // running the full generateSteps logic in the higher-level view.
    const wrapped: Map<string, boolean> = new Map(map);
    const get = (key: string): boolean => {
      if (wrapped.get(key) === true) return true;
      // Walk the dash-separated prefixes: "polish-X-Y" → check "polish-X" → check "polish".
      const parts = key.split("-");
      for (let i = parts.length - 1; i > 0; i--) {
        const prefix = parts.slice(0, i).join("-");
        if (wrapped.get(prefix) === true) return true;
      }
      return false;
    };
    return new Proxy(wrapped, {
      get(target, prop, receiver) {
        if (prop === "get") return (k: string) => get(k);
        return Reflect.get(target, prop, receiver);
      },
    });
  }, [stepStatuses]);

  if (!plan) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <PlanContent
      planId={planId}
      plan={plan}
      planProducts={planProducts}
      productNames={productNames}
      productsMap={productsMap}
      fillingsMap={fillingsMap}
      mouldsMap={mouldsMap}
      statusMap={statusMap}
      productIds={planProducts.map((pb) => pb.productId)}
    />
  );
}

// Separate component so we can load per-product fillings via individual hooks
function PlanContent({
  planId, plan, planProducts, productNames, productsMap, fillingsMap, mouldsMap, statusMap, productIds,
}: {
  planId: string;
  plan: { id?: string; batchNumber?: string; batchSummary?: string; name: string; status: "draft" | "active" | "done" | "cancelled" | "orphaned"; notes?: string; issuesNotes?: string; fillingOverrides?: string; fillingPreviousBatches?: string; createdAt: Date; updatedAt: Date; completedAt?: Date; surplusDestination?: "store" | "freezer" | "waste" };
  planProducts: PlanProduct[];
  productNames: Map<string, string>;
  productsMap: Map<string, Product>;
  fillingsMap: Map<string, Filling>;
  mouldsMap: Map<string, Mould>;
  statusMap: Map<string, boolean>;
  productIds: string[];
}) {
  const [backHref, setBackHref] = useState("/production");
  const [backLabel, setBackLabel] = useState("Production");
  const [activeStep, setActiveStep] = useState<WizardStepId>("production");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const from = params.get("from");
    if (from) { setBackHref(from); setBackLabel("Back to product"); }
    const tab = params.get("tab") as PhaseId | null;
    if (tab && PHASES.some((p) => p.id === tab)) {
      setActivePhase(tab);
      // Back-compat with old `?tab=…` deep links from /orders/[id] etc.:
      // open the wizard on the Production step + pre-expand that phase
      // card so the operator lands where the link promised.
      setActiveStep("production");
      setExpandedPhases(new Set<PhaseId>([tab]));
    }
    const step = params.get("step") as WizardStepId | null;
    if (step && WIZARD_STEPS.some((s) => s.id === step)) setActiveStep(step);
  }, []);

  // Persist wizard step to URL so reloads / shared links land back on
  // the same step. ?tab= continues to drive nested phase selection for
  // step=production.
  function changeStep(next: WizardStepId) {
    setActiveStep(next);
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.set("step", next);
    const qs = params.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", url);
  }
  const allFillings = useFillings();
  const shelfStableCategoryNames = useShelfStableCategoryNames();
  const allMoulds = useMouldsList(true);
  const allIngredients = useIngredients();
  const allMaterials = useDecorationMaterials();
  // Coating → chocolate mapping system removed (migration 0006). Seed-tempering
  // data used to come from that mapping; with no way to configure it, we treat
  // all coatings as non-seed-tempering now.
  const materialsMap = useMemo(() => new Map(allMaterials.map((m) => [m.id!, m])), [allMaterials]);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [activePhase, setActivePhase] = useState<PhaseId>("polishing");
  const [confirmMarkDone, setConfirmMarkDone] = useState(false);
  const [editingBatchNote, setEditingBatchNote] = useState(false);
  const [printState, setPrintState] = useState<"idle" | "printing" | "done" | "error">("idle");
  const [printError, setPrintError] = useState("");

  // Yield modal state
  const [yieldModal, setYieldModal] = useState<{
    entries: YieldEntry[];
    mode: "single" | "batch"; // single = one unmould checkbox, batch = mark all done
    pendingStepKey?: string; // for single mode: the step key that triggered the modal
  } | null>(null);

  // Allocation-split prompt — fires after yield confirm when the
  // batch has any orderPlanLinks. Lets the operator distribute the
  // actual yield across linked orders (+ surplus with a destination),
  // flagging shortfalls per-order. Captures operator intent only; the
  // stock write itself moves in the stock-rewrite task.
  const [splitModal, setSplitModal] = useState<{ totalYield: number } | null>(null);

  // Deadline-impact banner after an unmould yield short-stocks an open order.
  const [deadlineImpact, setDeadlineImpact] = useState<Array<{
    orderId: string; orderName: string; deadline: Date; required: number; projected: number; shortfall: number;
  }> | null>(null);

  // Packing modal state — open when the user ticks a "packing-*" step on.
  const packagingList = usePackagingList(false);
  const [packingTarget, setPackingTarget] = useState<{ stepKey: string; planProductId: string; productName: string; totalPieces: number } | null>(null);

  // Leftover filling modal state
  const [leftoverModal, setLeftoverModal] = useState<{
    entries: LeftoverEntry[];
    pendingStepKey?: string; // the fill step key that triggered the modal (single step)
    pendingFinishAll?: boolean; // true when triggered from "mark all done" flow
  } | null>(null);

  const printerEnabled = typeof window !== "undefined" && localStorage.getItem("niimbot-printer-enabled") === "true";

  // Linked orders: which orders is this batch serving? The reconciler
  // wires up orderPlanLinks when Regenerate plan runs. Used to render
  // the "Contributing to: [Order A · 100 pcs] · [Surplus · 20 pcs]"
  // header chips.
  const planLinks = useLinksForPlan(planId);
  const allOrders = useOrders();
  const allOrderItems = useAllOrderItems();
  const allProductionOrders = useProductionOrders();
  const allProductionOrderItems = useAllProductionOrderItems();
  const linkedOrders = useMemo(() => {
    if (planLinks.length === 0) return [] as Array<{ orderId: string; label: string; allocatedQuantity: number }>;
    const itemById = new Map(allOrderItems.map((oi) => [oi.id!, oi]));
    const orderById = new Map(allOrders.map((o) => [o.id!, o]));
    const byOrder = new Map<string, { label: string; allocatedQuantity: number }>();
    for (const link of planLinks) {
      const item = itemById.get(link.orderItemId);
      if (!item) continue;
      const order = orderById.get(item.orderId);
      if (!order) continue;
      const label = order.customerName || order.eventName || order.sourceRef || "order";
      const existing = byOrder.get(order.id!);
      byOrder.set(order.id!, {
        label,
        allocatedQuantity: (existing?.allocatedQuantity ?? 0) + link.allocatedQuantity,
      });
    }
    return [...byOrder.entries()].map(([orderId, v]) => ({ orderId, ...v }));
  }, [planLinks, allOrders, allOrderItems]);

  /** Total pieces this batch is planned to yield (moulds × cavities
   *  summed across every planProduct). Drives the surplus chip in the
   *  header + the default yield in the allocation-split modal. */
  const totalPlannedPieces = useMemo(() => {
    let total = 0;
    for (const pp of planProducts) {
      const mould = mouldsMap.get(pp.mouldId);
      const cavities = mould?.numberOfCavities ?? 0;
      total += pp.quantity * cavities;
    }
    return total;
  }, [planProducts, mouldsMap]);

  const totalAllocated = useMemo(
    () => planLinks.reduce((s, lk) => s + lk.allocatedQuantity, 0),
    [planLinks],
  );

  const surplusPlanned = Math.max(0, totalPlannedPieces - totalAllocated);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (confirmMarkDone) setConfirmMarkDone(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirmMarkDone]);
  const [batchNoteInput, setBatchNoteInput] = useState("");
  const [editingProductNoteId, setEditingProductNoteId] = useState<string | null>(null);
  const [productNoteInput, setProductNoteInput] = useState("");

  const productFillingsMap = useProductFillingsForProducts(productIds);

  // Load filling ingredients for all fillings in the plan
  const planFillingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const bls of productFillingsMap.values()) {
      for (const bl of bls) ids.add(bl.fillingId);
    }
    return Array.from(ids);
  }, [productFillingsMap]);

  const fillingIngredientsMap = useFillingIngredientsForFillings(planFillingIds);

  const fillingOverrides = useMemo<Record<string, number>>(() => {
    if (!plan.fillingOverrides) return {};
    try { return JSON.parse(plan.fillingOverrides); } catch { return {}; }
  }, [plan.fillingOverrides]);

  const fillingPreviousBatches = useMemo<Record<string, import("@/types").FillingPreviousBatch>>(() => {
    if (!plan.fillingPreviousBatches) return {};
    try { return JSON.parse(plan.fillingPreviousBatches); } catch { return {}; }
  }, [plan.fillingPreviousBatches]);

  const fillingAmounts = useMemo(() =>
    calculateFillingAmounts(planProducts, productNames, productFillingsMap, fillingIngredientsMap, fillingsMap, mouldsMap, fillingOverrides, fillingPreviousBatches, productsMap, shelfStableCategoryNames),
    [planProducts, productNames, productFillingsMap, fillingIngredientsMap, fillingsMap, mouldsMap, fillingOverrides, fillingPreviousBatches, productsMap, shelfStableCategoryNames]
  );

  const consolidatedFillings = useMemo(
    () => consolidateSharedFillings(fillingAmounts.filter((la) => !la.isFromPreviousBatch)),
    [fillingAmounts],
  );

  const steps = useMemo(() =>
    generateSteps(planProducts, productNames, productFillingsMap, fillingAmounts, fillingsMap, mouldsMap, productsMap, fillingPreviousBatches, materialsMap),
    [planProducts, productNames, productFillingsMap, fillingAmounts, fillingsMap, mouldsMap, productsMap, fillingPreviousBatches, materialsMap]
  );

  // Decoration material IDs needed for the colour phase (on_mould steps only)
  const colouringMaterialIds = useMemo(() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const pb of planProducts) {
      const product = productsMap.get(pb.productId);
      if (!product?.shellDesign) continue;
      for (const step of product.shellDesign) {
        const isTransferSheet = (step.materialIds ?? []).some(
          (id) => materialsMap.get(id)?.type === "transfer_sheet"
        );
        if (isTransferSheet || normalizeApplyAt(step.applyAt) !== "colour") continue;
        for (const id of (step.materialIds ?? [])) {
          if (!seen.has(id)) { seen.add(id); ids.push(id); }
        }
      }
    }
    return ids;
  }, [planProducts, productsMap, materialsMap]);

  // Decoration material IDs needed during capping (transfer sheets + after_cap steps)
  const cappingMaterialIds = useMemo(() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const pb of planProducts) {
      const product = productsMap.get(pb.productId);
      if (!product?.shellDesign) continue;
      for (const step of product.shellDesign) {
        const isTransferSheet = (step.materialIds ?? []).some(
          (id) => materialsMap.get(id)?.type === "transfer_sheet"
        );
        if (!isTransferSheet && normalizeApplyAt(step.applyAt) === "colour") continue;
        for (const id of (step.materialIds ?? [])) {
          if (!seen.has(id)) { seen.add(id); ids.push(id); }
        }
      }
    }
    return ids;
  }, [planProducts, productsMap, materialsMap]);

  const doneCount = steps.filter((s) => statusMap.get(s.key)).length;
  // Phase-level completion: a phase counts as done once every step in
  // that group is checked. Drives the "X / 8 steps" header counter so
  // it matches the 8 phase tabs instead of the granular sub-step count
  // (which varies with mould/product fan-out).
  const phaseDoneCount = useMemo(() => {
    let count = 0;
    for (const phase of PHASES) {
      const phaseSteps = steps.filter((s) => s.group === phase.id);
      if (phaseSteps.length > 0 && phaseSteps.every((s) => statusMap.get(s.key))) {
        count += 1;
      }
    }
    return count;
  }, [steps, statusMap]);

  // ── Cross-day annotation for phase tabs ────────────────────────
  // Each phase may land on a different day in the daily-production
  // model. Build a map phaseId → [date] from productionDayLineItems
  // for this batch, matching stepIds by their productionSteps.name.
  const allLineItemsForBatch = useAllProductionDayLineItems();
  const allProductionDays = useProductionDays(120);
  const productionStepsAll = useProductionSteps();
  const phaseDaysById = useMemo(() => {
    const dayDateById = new Map(allProductionDays.map((d) => [d.id!, d.date]));
    const stepById = new Map(productionStepsAll.map((s) => [s.id!, s]));
    const out = new Map<string, string[]>();
    for (const phase of PHASES) out.set(phase.id, []);
    for (const li of allLineItemsForBatch) {
      if (li.planId !== planId) continue;
      const date = dayDateById.get(li.productionDayId);
      if (!date) continue;
      for (const stepId of li.stepIds) {
        const step = stepById.get(stepId);
        if (!step) continue;
        const phaseId = stepNameToPhase(step.name);
        if (!phaseId) continue;
        const arr = out.get(phaseId)!;
        if (!arr.includes(date)) arr.push(date);
      }
    }
    for (const arr of out.values()) arr.sort();
    return out;
  }, [allLineItemsForBatch, allProductionDays, productionStepsAll, planId]);

  // ── Phase C wizard derivations ─────────────────────────────────
  // Drive the header utilization bar, the Plan / Prep step bodies,
  // and the step-pill completion states. All lazy memoised.

  const people = usePeople(false);
  const allIngredientStock = useAllIngredientStock();
  const ingredientById = useMemo(
    () => new Map(allIngredients.map((i) => [i.id!, i])),
    [allIngredients],
  );
  const ingredientStockByIngredientId = useMemo(
    () => new Map(allIngredientStock.map((r) => [r.ingredientId, r.quantityG])),
    [allIngredientStock],
  );
  const mouldPool = useMouldPool();
  const equipmentList = useEquipment(false);
  const equipmentInstances = useEquipmentInstances();
  const machineLoads = useMachineLoads();

  // Aggregated minutes + dates for this plan from the daily-production line
  // items. plannedMinutes already sums perBatch + per-mould scaling at the
  // time of planning so we don't recompute it here.
  const batchMinutesPlanned = useMemo(() => {
    let total = 0;
    for (const li of allLineItemsForBatch) {
      if (li.planId !== planId) continue;
      total += li.plannedMinutes ?? 0;
    }
    return total;
  }, [allLineItemsForBatch, planId]);

  const batchDates = useMemo(() => {
    const dayDateById = new Map(allProductionDays.map((d) => [d.id!, d.date]));
    const set = new Set<string>();
    for (const li of allLineItemsForBatch) {
      if (li.planId !== planId) continue;
      const date = dayDateById.get(li.productionDayId);
      if (date) set.add(date);
    }
    return [...set].sort();
  }, [allLineItemsForBatch, allProductionDays, planId]);

  // Day-capacity proxy: sum of every non-archived person's defaultHoursPerDay
  // × 60 × number of distinct days this plan touches. Falls back to a single
  // day when the plan hasn't been scheduled yet (so utilisation still renders
  // a useful comparison instead of dividing by zero).
  const dayCapacityMinutes = useMemo(() => {
    const perDay = people
      .filter((p) => !p.archived)
      .reduce((s, p) => s + ((p.defaultHoursPerDay ?? 0) * 60), 0);
    const days = Math.max(1, batchDates.length);
    return perDay * days;
  }, [people, batchDates]);

  const utilizationPct = dayCapacityMinutes > 0
    ? Math.round((batchMinutesPlanned / dayCapacityMinutes) * 100)
    : 0;
  const utilizationVariant: "ok" | "warn" | "urgent" = utilizationPct >= 100
    ? "urgent"
    : utilizationPct >= 80
      ? "warn"
      : "ok";
  const utilizationColor =
    utilizationVariant === "urgent" ? "var(--ds-tier-urgent)"
    : utilizationVariant === "warn" ? "var(--ds-semantic-warn)"
    : "var(--ds-tier-positive)";

  // Estimated minutes per planProduct ("batch" in wizard vocab) for the
  // Plan-step ListRow. activeMinutes × moulds for normal steps,
  // activeMinutes × 1 for perBatch steps. Filtered to the product's
  // category — falls back to summing every step when no match found.
  const minutesByPlanProduct = useMemo(() => {
    const productionStepsByType = new Map<string, typeof productionStepsAll>();
    for (const s of productionStepsAll) {
      const arr = productionStepsByType.get(s.productType) ?? [];
      arr.push(s);
      productionStepsByType.set(s.productType, arr);
    }
    const out = new Map<string, number>();
    for (const pp of planProducts) {
      const product = productsMap.get(pp.productId);
      const moulds = pp.quantity;
      const productType = product?.productCategoryId ?? "";
      const stepsForType = productionStepsByType.get(productType) ?? [];
      let mins = 0;
      for (const s of stepsForType) {
        mins += (s.activeMinutes ?? 0) * (s.perBatch ? 1 : moulds);
      }
      out.set(pp.id!, mins);
    }
    return out;
  }, [planProducts, productsMap, productionStepsAll]);

  // Mise en place: aggregate scaled filling-recipe ingredients across every
  // consolidated filling, plus the shell-chocolate ingredient demand per
  // planProduct. Returns { ingredientId, neededG, onHandG } sorted alpha by
  // ingredient name.
  const miseEnPlace = useMemo(() => {
    const need = new Map<string, number>();
    for (const cl of consolidatedFillings) {
      for (const si of cl.scaledIngredients) {
        need.set(si.ingredientId, (need.get(si.ingredientId) ?? 0) + si.amount);
      }
    }
    for (const pp of planProducts) {
      const product = productsMap.get(pp.productId);
      const mould = mouldsMap.get(pp.mouldId);
      if (!product?.shellIngredientId || !mould) continue;
      const shellG = calculateShellWeightG(mould, product.shellPercentage)
        * mould.numberOfCavities * pp.quantity;
      if (shellG <= 0) continue;
      need.set(
        product.shellIngredientId,
        (need.get(product.shellIngredientId) ?? 0) + shellG,
      );
    }
    const rows: Array<{
      ingredientId: string;
      ingredientName: string;
      neededG: number;
      onHandG: number;
      shortG: number;
    }> = [];
    for (const [ingredientId, neededG] of need) {
      const ing = ingredientById.get(ingredientId);
      const onHandG = ingredientStockByIngredientId.get(ingredientId) ?? 0;
      rows.push({
        ingredientId,
        ingredientName: ing?.name ?? "Unknown ingredient",
        neededG: Math.round(neededG),
        onHandG: Math.round(onHandG),
        shortG: Math.max(0, Math.round(neededG - onHandG)),
      });
    }
    rows.sort((a, b) => a.ingredientName.localeCompare(b.ingredientName));
    return rows;
  }, [consolidatedFillings, planProducts, productsMap, mouldsMap, ingredientById, ingredientStockByIngredientId]);

  // Per-phase active-minute estimate for the C.4 phase cards. Walks
  // productionStepsAll filtered by stepNameToPhase, multiplies by per-
  // planProduct moulds (or 1 for perBatch steps). Returns minutes per
  // PhaseId so each card header can show "~Xm".
  const estMinutesByPhase = useMemo(() => {
    const out: Record<PhaseId, number> = {
      polishing: 0, colour: 0, shell: 0, filling: 0, fill: 0,
      cap: 0, unmould: 0, packing: 0,
    };
    const stepsByType = new Map<string, typeof productionStepsAll>();
    for (const s of productionStepsAll) {
      const arr = stepsByType.get(s.productType) ?? [];
      arr.push(s);
      stepsByType.set(s.productType, arr);
    }
    for (const pp of planProducts) {
      const product = productsMap.get(pp.productId);
      const productType = product?.productCategoryId ?? "";
      const stepsForType = stepsByType.get(productType) ?? [];
      for (const s of stepsForType) {
        const phase = stepNameToPhase(s.name);
        if (!phase) continue;
        out[phase] += (s.activeMinutes ?? 0) * (s.perBatch ? 1 : pp.quantity);
      }
    }
    return out;
  }, [planProducts, productsMap, productionStepsAll]);

  // Which phase cards are currently expanded. Auto-expands the first
  // incomplete phase on first render so the operator sees actionable
  // work without scrolling; everything else collapses to save vertical
  // space on a long batch.
  const [expandedPhases, setExpandedPhases] = useState<Set<PhaseId> | null>(null);
  const effectiveExpanded = useMemo(() => {
    if (expandedPhases) return expandedPhases;
    const auto = new Set<PhaseId>();
    for (const ph of PHASES) {
      const phaseSteps = steps.filter((s) => s.group === ph.id);
      if (phaseSteps.length === 0) continue;
      const done = phaseSteps.every((s) => statusMap.get(s.key));
      if (!done) { auto.add(ph.id); break; }
    }
    return auto;
  }, [expandedPhases, steps, statusMap]);

  function togglePhaseCard(id: PhaseId) {
    const base = expandedPhases ?? new Set(effectiveExpanded);
    const next = new Set(base);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedPhases(next);
  }

  // Local UI state for the Prep step's "prepped" + "clean" toggles.
  // Pure UI today — no DB column persists these flags. Flag ✗ deferred
  // until per-plan prep checklist schema exists.
  const [preppedIngredientIds, setPreppedIngredientIds] = useState<Set<string>>(new Set());
  const [cleanMouldIds, setCleanMouldIds] = useState<Set<string>>(new Set());

  // Moulds needed: group planProducts by mouldId, sum quantities, and
  // surface per-mould pool counts (in-use / free / sealed) so the
  // operator knows what's already cleaned and ready to go.
  const mouldsNeeded = useMemo(() => {
    const byMould = new Map<string, { mouldId: string; needed: number; planProductIds: string[] }>();
    for (const pp of planProducts) {
      const existing = byMould.get(pp.mouldId);
      if (existing) {
        existing.needed += pp.quantity;
        existing.planProductIds.push(pp.id!);
      } else {
        byMould.set(pp.mouldId, {
          mouldId: pp.mouldId,
          needed: pp.quantity,
          planProductIds: [pp.id!],
        });
      }
    }
    const out: Array<{
      mouldId: string;
      mouldName: string;
      needed: number;
      inUse: number;
      free: number;
      sealed: number;
    }> = [];
    for (const row of byMould.values()) {
      const pool = mouldPool.filter((mp) => mp.mouldId === row.mouldId && !mp.retired);
      const inUse = pool.filter((mp) => mp.currentState === "loaded" || mp.currentState === "filled").length;
      const free = pool.filter((mp) => mp.currentState === "available").length;
      const sealed = pool.filter((mp) => mp.currentState === "sealed").length;
      out.push({
        mouldId: row.mouldId,
        mouldName: mouldsMap.get(row.mouldId)?.name ?? "Unknown mould",
        needed: row.needed,
        inUse,
        free,
        sealed,
      });
    }
    out.sort((a, b) => a.mouldName.localeCompare(b.mouldName));
    return out;
  }, [planProducts, mouldPool, mouldsMap]);

  // Machines panel: every non-archived tempering / melting equipment
  // instance with its current MachineLoad (if any) so operators can see
  // empty machines + which chocolate is loaded where before the run.
  const machinesView = useMemo(() => {
    const temperingEquipmentIds = new Set(
      equipmentList
        .filter((e) => e.kind === "tempering" || e.kind === "melting_pot")
        .map((e) => e.id!),
    );
    const insts = equipmentInstances.filter((ei) =>
      temperingEquipmentIds.has(ei.equipmentId) && ei.status !== "retired",
    );
    return insts.map((inst) => {
      const activeLoad = machineLoads.find(
        (ml) => ml.equipmentInstanceId === inst.id && ml.status === "in_use",
      );
      const loadedIngredient = activeLoad
        ? ingredientById.get(activeLoad.ingredientId)
        : null;
      return {
        instance: inst,
        load: activeLoad ?? null,
        loadedIngredientName: loadedIngredient?.name ?? null,
      };
    });
  }, [equipmentList, equipmentInstances, machineLoads, ingredientById]);

  const totalPrepIngredients = miseEnPlace.length;
  const allPrepped = totalPrepIngredients > 0
    && miseEnPlace.every((row) => preppedIngredientIds.has(row.ingredientId));

  // Wizard step state for the pill chrome.
  const productionStepDone = phaseDoneCount === PHASES.length;
  const packingPhaseSteps = useMemo(() => steps.filter((s) => s.group === "packing"), [steps]);
  const packingStepDone = packingPhaseSteps.length > 0
    && packingPhaseSteps.every((s) => statusMap.get(s.key));
  const planStepComplete = planProducts.length > 0;
  const wrapupStepComplete = plan.status === "done";

  function stepPillState(id: WizardStepId): "completed" | "active" | "future" {
    if (id === activeStep) return "active";
    const done =
      id === "plan" ? planStepComplete
      : id === "prep" ? allPrepped
      : id === "production" ? productionStepDone
      : id === "packing" ? packingStepDone
      : wrapupStepComplete;
    if (done) return "completed";
    const order = WIZARD_STEPS.findIndex((s) => s.id === id);
    const currentOrder = WIZARD_STEPS.findIndex((s) => s.id === activeStep);
    return order > currentOrder ? "future" : "completed";
  }

  // Status badge mapping for the header.
  const planStatusKind: StatusTagKind = plan.status === "done" ? "done"
    : plan.status === "active" ? "scheduled"
    : plan.status === "cancelled" || plan.status === "orphaned" ? "neutral"
    : "pending";
  const planStatusLabel = plan.status === "done" ? "Done"
    : plan.status === "active" ? "In production"
    : plan.status === "cancelled" ? "Cancelled"
    : plan.status === "orphaned" ? "Orphaned"
    : "Draft";

  // Drawers + dialogs (Plan-step edit drawer, Add-batch drawer, Mark-done dialog)
  const [editingPlanProductId, setEditingPlanProductId] = useState<string | null>(null);
  const [addBatchDrawerOpen, setAddBatchDrawerOpen] = useState(false);
  const [addBatchProductId, setAddBatchProductId] = useState<string>("");
  const [addBatchMouldId, setAddBatchMouldId] = useState<string>("");
  const [addBatchQuantity, setAddBatchQuantity] = useState<number>(1);
  const [markDoneDialogOpen, setMarkDoneDialogOpen] = useState(false);

  async function handleAddBatch() {
    if (!addBatchProductId || !addBatchMouldId || addBatchQuantity < 1) return;
    await savePlanProduct({
      planId,
      productId: addBatchProductId,
      mouldId: addBatchMouldId,
      quantity: addBatchQuantity,
      sortOrder: planProducts.length,
    });
    setAddBatchDrawerOpen(false);
    setAddBatchProductId("");
    setAddBatchMouldId("");
    setAddBatchQuantity(1);
  }

  async function reorderPlanProduct(planProductId: string, direction: -1 | 1) {
    const sorted = [...planProducts].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex((pp) => pp.id === planProductId);
    if (idx < 0) return;
    const swapWith = idx + direction;
    if (swapWith < 0 || swapWith >= sorted.length) return;
    const a = sorted[idx];
    const b = sorted[swapWith];
    await Promise.all([
      savePlanProduct({ ...a, sortOrder: b.sortOrder }),
      savePlanProduct({ ...b, sortOrder: a.sortOrder }),
    ]);
  }

  /** Deduct filling stock for all fillings marked as "use stock" (fillingPreviousBatches) */
  async function deductPreviousBatchStock() {
    for (const pb of planProducts) {
      const mould = mouldsMap.get(pb.mouldId);
      if (!mould) continue;
      const rls = productFillingsMap.get(pb.productId) ?? [];
      for (const rl of rls) {
        const prev = fillingPreviousBatches[rl.fillingId];
        if (!prev) continue;
        const fillPct = (rl.fillPercentage ?? 100) / 100;
        const fillWeightG = mould.cavityWeightG * mould.numberOfCavities * pb.quantity * FILL_FACTOR * DENSITY_G_PER_ML;
        const neededG = Math.round(fillWeightG * fillPct);
        if (neededG > 0) {
          await deductFillingStock(rl.fillingId, neededG, { includeFrozen: prev.includeFrozen });
        }
      }
    }
  }

  /** Build leftover entries for fresh fillings (skip pure previous-batch, allow hybrid).
   *  Fires for ALL filling categories — users can register leftovers for any filling, not just
   *  shelf-stable ones (the production-date field on the stock entry tracks freshness). */
  function buildAllLeftoverEntries(): LeftoverEntry[] {
    const entries: LeftoverEntry[] = [];
    for (const cl of consolidatedFillings) {
      // Skip fillings fully from previous batch (no fresh override)
      if (fillingPreviousBatches[cl.fillingId] && !fillingOverrides[cl.fillingId]) continue;
      const filling = fillingsMap.get(cl.fillingId);
      if (!filling) continue;
      const lis = fillingIngredientsMap.get(cl.fillingId) ?? [];
      const baseWeight = lis.reduce((s, li) => s + li.amount, 0);
      const multiplier = fillingOverrides[cl.fillingId] ?? 1;
      // For shelf-stable fillings the multiplier governs batch size, so leftover ≈ base × multiplier − used.
      // For other categories the recipe is fill-scaled so there's no inherent leftover; show 0 and let the user enter the actual amount.
      const isShelfStable = shelfStableCategoryNames.has(filling.category);
      // Shelf-stable fillings are scaled by multiplier, so the batch total is
      // baseWeight × multiplier. Non-shelf-stable fillings are fill-scaled, so
      // the scaled recipe yields ≈ what was needed (cl.totalWeightG).
      const totalMadeG = isShelfStable ? baseWeight * multiplier : cl.totalWeightG;
      const estimatedLeftoverG = isShelfStable ? baseWeight * multiplier - cl.totalWeightG : 0;
      entries.push({
        fillingId: cl.fillingId,
        fillingName: cl.fillingName,
        category: filling.category,
        estimatedLeftoverG,
        totalMadeG,
        shelfLifeWeeks: filling.shelfLifeWeeks,
        planId: plan.id,
        madeAt: new Date().toISOString(),
      });
    }
    return entries;
  }

  /** Run the stock-flow side-effect for a step that just transitioned
   *  false → true. Shell ticks deduct shell chocolate; filling-prep
   *  ticks deduct recipe ingredients and populate fillingStock; fill
   *  ticks consume fillingStock per mould. Warnings (insufficient
   *  stock) surface as an alert so the operator can decide whether to
   *  carry on or top up. Failures don't block the tick itself. */
  async function runStockFlowForStepTick(key: string, wasCurrent: boolean): Promise<void> {
    if (wasCurrent) return; // only on false → true
    const step = steps.find((s) => s.key === key);
    if (!step || !plan.id) return;
    const warnings: string[] = [];
    try {
      if (step.group === "shell" && step.planProductId) {
        const r = await deductShellForPlanProduct(step.planProductId, plan.id);
        warnings.push(...r.warnings);
      } else if (step.group === "filling") {
        const fillingId = key.replace(/^filling-/, "");
        if (fillingId) {
          const r = await prepareFillingForBatch(plan.id, fillingId);
          warnings.push(...r.warnings);
        }
      } else if (step.group === "fill" && step.planProductId) {
        const r = await consumeFillingStockForPlanProduct(step.planProductId, plan.id);
        warnings.push(...r.warnings);
      }
    } catch (e) {
      console.error("Stock flow error for step", key, e);
      alert(`Stock flow error: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (warnings.length > 0) {
      alert(`Stock warnings:\n\n${warnings.join("\n")}`);
    }
  }

  async function handleToggle(key: string) {
    const current = statusMap.get(key) ?? false;

    // Intercept fill steps being checked ON → show leftover filling prompt
    if (!current && key.startsWith("fill-")) {
      const planProductId = key.replace("fill-", "");
      const pb = planProducts.find((b) => b.id === planProductId);
      if (pb) {
        const productFillings = productFillingsMap.get(pb.productId) ?? [];
        const fillingIdsForProduct = productFillings.map((rl) => rl.fillingId);

        // Build leftover entries for fillings used by this product where all fill steps are now done
        const allEntries = buildAllLeftoverEntries();
        const readyFillings = allEntries.filter((entry) => {
          if (!fillingIdsForProduct.includes(entry.fillingId)) return false;
          const cl = consolidatedFillings.find((c) => c.fillingId === entry.fillingId);
          if (!cl) return false;
          return cl.usedBy.every((u) => {
            const fillKey = `fill-${u.planProductId}`;
            if (fillKey === key) return true;
            return statusMap.get(fillKey) ?? false;
          });
        });

        // Toggle the step first
        await toggleStep(planId, key, true);

        // Consume filling stock for this planProduct's fill step BEFORE
        // the leftover prompt runs — the leftover modal then shows the
        // updated remaining so the user enters "what's actually left".
        await runStockFlowForStepTick(key, current);

        const newDoneCount = doneCount + 1;
        const newStatus = newDoneCount >= steps.length ? "done" : newDoneCount > 0 ? "active" : "draft";
        await applyPlanStatusTransition(newStatus);

        if (readyFillings.length > 0) {
          // Leftover modal will call deductPreviousBatchStock on confirm/skip
          setLeftoverModal({ entries: readyFillings, pendingStepKey: key });
        } else {
          // No leftover modal, deduct stock now
          await deductPreviousBatchStock();
        }
        return;
      }
    }

    // Intercept packing steps being checked ON → show packing modal
    if (!current && key.startsWith("packing-")) {
      const step = steps.find((s) => s.key === key);
      if (step?.planProductId) {
        setPackingTarget({
          stepKey: key,
          planProductId: step.planProductId,
          productName: step.label.replace("Pack: ", ""),
          totalPieces: step.totalProducts ?? 0,
        });
        return;
      }
    }

    // Intercept unmould steps being checked ON → show yield modal
    if (!current && key.startsWith("unmould-")) {
      const step = steps.find((s) => s.key === key);
      if (step?.planProductId && step.totalProducts) {
        const pb = planProducts.find((b) => b.id === step.planProductId);
        setYieldModal({
          entries: [{
            planProductId: step.planProductId,
            productName: step.label.replace("Unmould: ", ""),
            totalProducts: step.totalProducts,
            yield: pb?.actualYield ?? step.totalProducts,
          }],
          mode: "single",
          pendingStepKey: key,
        });
        return;
      }
    }

    await toggleStep(planId, key, !current);
    // Run stock-flow side-effects for shell / filling-prep ticks that
    // don't have their own intercept block above.
    await runStockFlowForStepTick(key, current);
    const newDoneCount = doneCount + (current ? -1 : 1);
    const newStatus = newDoneCount >= steps.length ? "done" : newDoneCount > 0 ? "active" : "draft";
    await applyPlanStatusTransition(newStatus);
  }

  /** Shared transition handler used by every step-tick / phase-toggle /
   *  yield-modal path. Mirrors the pre-existing behaviour — "done" still
   *  goes through completePlan (so the batch summary gets generated),
   *  everything else uses saveProductionPlan — and adds ONE extra step:
   *  when the batch leaves 'draft' (→ active or → done), promote every
   *  pending order linked to it to 'in_production'. That keeps the
   *  orders list honest without flipping orders on Regenerate. */
  async function applyPlanStatusTransition(
    newStatus: "draft" | "active" | "done",
  ): Promise<void> {
    if (newStatus === plan.status) return;
    const leavingDraft = plan.status === "draft" && newStatus !== "draft";
    if (newStatus === "done") {
      await completePlan();
    } else {
      await saveProductionPlan({ ...plan as any, id: plan.id, status: newStatus });
    }
    if (leavingDraft) await promoteOrdersForPlan(planId);
  }

  async function completePlan() {
    const completedAt = new Date();
    const batchSummary = generateBatchSummary({
      batchNumber: plan.batchNumber,
      planName: plan.name,
      completedAt,
      planProducts,
      productNames,
      moulds: mouldsMap,
      fillingAmounts,
      ingredients: allIngredients.filter((i) => i.id != null) as { id: string; name: string; manufacturer?: string }[],
      previousBatches: Object.keys(fillingPreviousBatches).length > 0 ? fillingPreviousBatches : undefined,
      productsMap,
      productFillingsMap,
    });
    await saveProductionPlan({ ...plan as any, id: plan.id, status: "done", completedAt, batchSummary });
  }

  async function handleReset() {
    for (const step of steps) {
      if (statusMap.get(step.key)) {
        await toggleStep(planId, step.key, false);
      }
    }
    if (plan.status !== "draft") {
      await saveProductionPlan({ ...plan as any, id: plan.id, status: "draft" });
    }
  }

  async function handleTogglePhase(phaseId: PhaseId) {
    const phaseSteps = steps.filter((s) => s.group === phaseId);
    const allDoneInPhase = phaseSteps.every((s) => statusMap.get(s.key));
    const targetDone = !allDoneInPhase;

    // Intercept unmould phase "Mark all done" → show yield modal for all products
    if (targetDone && phaseId === "unmould") {
      const unmouldSteps = phaseSteps.filter((s) => s.planProductId && s.totalProducts && !(statusMap.get(s.key)));
      if (unmouldSteps.length > 0) {
        setYieldModal({
          entries: unmouldSteps.map((s) => {
            const pb = planProducts.find((b) => b.id === s.planProductId);
            return {
              planProductId: s.planProductId!,
              productName: s.label.replace("Unmould: ", ""),
              totalProducts: s.totalProducts!,
              yield: pb?.actualYield ?? s.totalProducts!,
            };
          }),
          mode: "batch",
        });
        return;
      }
    }

    for (const step of phaseSteps) {
      await toggleStep(planId, step.key, targetDone);
    }
    // Compute new doneCount after phase toggle
    const otherDone = steps.filter((s) => s.group !== phaseId && (statusMap.get(s.key) ?? false)).length;
    const newDoneCount = otherDone + (targetDone ? phaseSteps.length : 0);
    const newStatus = newDoneCount >= steps.length ? "done" : newDoneCount > 0 ? "active" : "draft";
    await applyPlanStatusTransition(newStatus);
  }

  async function handleMarkAllDone() {
    // Check if any unmould steps haven't had yield recorded yet
    const unmouldSteps = steps.filter((s) => s.group === "unmould" && s.planProductId && s.totalProducts);
    const needsYield = unmouldSteps.filter((s) => {
      const pb = planProducts.find((b) => b.id === s.planProductId);
      return pb?.actualYield == null;
    });
    if (needsYield.length > 0) {
      setYieldModal({
        entries: unmouldSteps.map((s) => {
          const pb = planProducts.find((b) => b.id === s.planProductId);
          return {
            planProductId: s.planProductId!,
            productName: s.label.replace("Unmould: ", ""),
            totalProducts: s.totalProducts!,
            yield: pb?.actualYield ?? s.totalProducts!,
          };
        }),
        mode: "batch",
      });
      return;
    }
    await finishMarkAllDone();
  }

  async function finishMarkAllDone() {
    for (const step of steps) {
      if (!statusMap.get(step.key)) {
        await toggleStep(planId, step.key, true);
      }
    }
    await completePlan();
    setConfirmMarkDone(false);
  }

  async function handleYieldConfirm(entries: YieldEntry[]) {
    // Save actual yield on each PlanProduct, record the intake into Production
    // Storage, log waste for any shortfall, then check whether any open order
    // for the affected products just became infeasible.
    const affectedProductIds = new Set<string>();
    for (const entry of entries) {
      const pb = planProducts.find((b) => b.id === entry.planProductId);
      if (pb) {
        await savePlanProduct({ ...pb, actualYield: entry.yield });
        await recordUnmouldIntake({
          planProductId: entry.planProductId,
          productId: pb.productId,
          actualYield: entry.yield,
          planned: entry.totalProducts,
        });
        affectedProductIds.add(pb.productId);
      }
    }

    // Allocation split: when the batch has links, let the operator
    // distribute the actual yield across orders (+ surplus). Fires for
    // both the "yield ≥ committed" case (surplus to place) and the
    // shortfall case (which order loses?). Gate on
    // plan.surplusDestination to avoid re-prompting after the split
    // has already been captured.
    if (!plan.surplusDestination && planLinks.length > 0) {
      const updatedYieldById = new Map<string, number>();
      for (const entry of entries) updatedYieldById.set(entry.planProductId, entry.yield);
      const totalProduced = planProducts.reduce((s, pp) => {
        const y = updatedYieldById.get(pp.id!) ?? pp.actualYield;
        return s + (typeof y === "number" ? y : 0);
      }, 0);
      if (totalProduced > 0) {
        setSplitModal({ totalYield: totalProduced });
      }
    }
    const issues: Array<{ orderId: string; orderName: string; deadline: Date; required: number; projected: number; shortfall: number }> = [];
    for (const productId of affectedProductIds) {
      const productIssues = await checkDeadlineImpactForProduct(productId);
      issues.push(...productIssues);
    }
    if (issues.length > 0) setDeadlineImpact(issues);

    if (yieldModal?.mode === "single" && yieldModal.pendingStepKey) {
      // Complete the single unmould step
      await toggleStep(planId, yieldModal.pendingStepKey, true);
      const newDoneCount = doneCount + 1;
      const newStatus = newDoneCount >= steps.length ? "done" : newDoneCount > 0 ? "active" : "draft";
      await applyPlanStatusTransition(newStatus);
    } else {
      // Batch mode — toggle all steps, then show leftover modal before finishing
      for (const step of steps) {
        if (!statusMap.get(step.key)) {
          await toggleStep(planId, step.key, true);
        }
      }

      // Show leftover modal only if some fill steps were still pending
      // (if all fill steps were already done, leftover was handled per-step)
      const hadPendingFillSteps = steps
        .filter((s) => s.group === "fill")
        .some((s) => !statusMap.get(s.key));
      if (hadPendingFillSteps) {
        const leftoverEntries = buildAllLeftoverEntries();
        if (leftoverEntries.length > 0) {
          // Leftover modal will call deductPreviousBatchStock + finishMarkAllDone
          setLeftoverModal({ entries: leftoverEntries, pendingFinishAll: true });
          setYieldModal(null);
          return;
        }
        // No leftover entries but still need to deduct stock
        await deductPreviousBatchStock();
      }

      await finishMarkAllDone();
    }
    setYieldModal(null);
  }

  async function handlePrintLabels() {
    if (!plan.completedAt) return;
    setPrintState("printing");
    setPrintError("");

    // Guard: if any filling referenced by this batch can't be resolved, allergen data
    // would silently be incomplete — block the print rather than produce a bad label.
    for (const pb of planProducts) {
      const fillings = productFillingsMap.get(pb.productId) ?? [];
      const unresolved = fillings.filter((rl) => !fillingsMap.get(rl.fillingId));
      if (unresolved.length > 0) {
        const name = productNames.get(pb.productId) ?? "a product";
        setPrintState("error");
        setPrintError(`Allergen data incomplete for "${name}" — some fillings could not be resolved. Check the product before printing.`);
        return;
      }
    }

    const labels: LabelData[] = planProducts.map((pb) => {
      const product = productsMap.get(pb.productId);
      const fillings = productFillingsMap.get(pb.productId) ?? [];
      const allergenSet = new Set<string>();
      for (const rl of fillings) {
        for (const a of fillingsMap.get(rl.fillingId)!.allergens) allergenSet.add(a);
      }
      const weeks = parseInt(product?.shelfLifeWeeks ?? "");
      const bestBefore = !isNaN(weeks) && weeks > 0
        ? new Date(new Date(plan.completedAt!).getTime() + weeks * 7 * 24 * 60 * 60 * 1000)
        : null;
      return {
        productName: productNames.get(pb.productId) ?? "Unknown",
        batchNumber: plan.batchNumber ?? "",
        bestBeforeDate: bestBefore,
        allergens: Array.from(allergenSet).sort(),
        // 100% vegan brand — leaf icon always on. Per-product flag retired.
        vegan: true,
      };
    });

    const result = await printLabels(labels);
    if (result.success) {
      setPrintState("done");
      setTimeout(() => setPrintState("idle"), 3000);
    } else {
      setPrintState("error");
      setPrintError(result.error);
    }
  }

  async function handleRenamePlan() {
    const trimmed = nameInput.trim();
    if (trimmed && trimmed !== plan.name) {
      await saveProductionPlan({ ...plan as any, id: plan.id, name: trimmed });
    }
    setEditingName(false);
  }

  async function handleSaveBatchNote() {
    const trimmed = batchNoteInput.trim();
    await saveProductionPlan({ ...plan as any, id: plan.id, notes: trimmed || undefined });
    setEditingBatchNote(false);
  }

  async function handleSaveProductNote(pb: PlanProduct) {
    const trimmed = productNoteInput.trim();
    await savePlanProduct({ ...pb, notes: trimmed || undefined });
    setEditingProductNoteId(null);
  }

  const daysSinceCreated = Math.floor((Date.now() - new Date(plan.createdAt as Date).getTime()) / 86_400_000);
  const ageLabel = plan.status === "done"
    ? `Completed · ${new Date((plan.completedAt ?? plan.createdAt) as Date).toLocaleDateString("de-AT", { day: "numeric", month: "short", year: "numeric" })}`
    : daysSinceCreated === 0 ? "Started today"
    : daysSinceCreated === 1 ? "Started yesterday"
    : `Day ${daysSinceCreated + 1} of this batch`;

  const headerMeta = [
    plan.batchNumber ?? null,
    ageLabel,
    `${phaseDoneCount} / ${PHASES.length} phases`,
    batchDates.length > 0
      ? batchDates.length === 1
        ? new Date(batchDates[0] + "T12:00:00").toLocaleDateString("de-AT", { day: "numeric", month: "short" })
        : `${new Date(batchDates[0] + "T12:00:00").toLocaleDateString("de-AT", { day: "numeric", month: "short" })} – ${new Date(batchDates[batchDates.length - 1] + "T12:00:00").toLocaleDateString("de-AT", { day: "numeric", month: "short" })}`
      : null,
    `${planProducts.length} batch${planProducts.length === 1 ? "" : "es"}`,
  ].filter(Boolean).join(" · ");

  return (
    <>
      <DsDetailPage
        title={plan.name}
        titleEditor={editingName ? (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input
              autoFocus
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleRenamePlan(); if (e.key === "Escape") setEditingName(false); }}
              style={{
                fontSize: 20, fontWeight: 600, padding: "2px 8px", minWidth: 260,
                border: "0.5px solid var(--ds-border-warm)", borderRadius: 6,
                background: "var(--ds-card-bg)", outline: "none",
                color: "var(--ds-text-primary)",
              }}
            />
            <button onClick={handleRenamePlan} style={{ padding: 4, background: "transparent", border: "none", cursor: "pointer", color: "var(--ds-tier-quarter-focus)" }} aria-label="Save"><Check size={14} /></button>
            <button onClick={() => setEditingName(false)} style={{ padding: 4, background: "transparent", border: "none", cursor: "pointer", color: "var(--ds-text-muted)" }} aria-label="Cancel"><X size={14} /></button>
          </div>
        ) : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <h1 className="text-ds-page-title">{plan.name}</h1>
            <button
              onClick={() => { setNameInput(plan.name); setEditingName(true); }}
              style={{ padding: 4, border: "none", background: "transparent", cursor: "pointer", color: "var(--ds-text-muted)" }}
              aria-label="Rename batch"
            >
              <Pencil size={13} />
            </button>
          </span>
        )}
        meta={headerMeta}
        statusBadge={<StatusTag kind={planStatusKind}>{planStatusLabel}</StatusTag>}
        breadcrumb={{ label: backLabel, href: backHref }}
        actions={
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {plan.batchSummary && (
              <Link
                href={`/production/${encodeURIComponent(planId)}/summary`}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  fontSize: 12, color: "var(--ds-text-muted)", textDecoration: "none",
                  padding: "4px 10px",
                  border: "0.5px solid var(--ds-border-warm)", borderRadius: 4,
                  background: "var(--ds-card-bg)",
                }}
              >
                <ClipboardList size={13} /> Summary
              </Link>
            )}
            {plan.status === "done" && printerEnabled && (
              <DsButton size="sm" onClick={handlePrintLabels} disabled={printState === "printing"}>
                <Printer size={13} style={{ marginRight: 4, verticalAlign: "-2px" }} />
                {printState === "printing" ? "Generating…" : printState === "done" ? "Saved!" : "Save labels"}
              </DsButton>
            )}
            {plan.status === "draft" && (
              <DsButton
                size="sm"
                variant="primary"
                onClick={async () => {
                  if (!plan.id) return;
                  try { await startProductionPlan(plan.id); } catch (e) { console.error(e); }
                }}
                title="Mark this batch as in-progress and flip its linked orders to in production."
              >
                <Play size={13} style={{ marginRight: 4, verticalAlign: "-2px" }} /> Start production
              </DsButton>
            )}
          </div>
        }
        tabs={WIZARD_STEPS.map((s) => ({
          id: s.id,
          label: s.label,
          state: stepPillState(s.id),
        }))}
        activeTab={activeStep}
        onTabChange={(id) => changeStep(id as WizardStepId)}
      >
        {/* Utilisation bar — planned vs day capacity */}
        <div style={{ marginBottom: 16 }}>
          <div style={{
            display: "flex", alignItems: "baseline", justifyContent: "space-between",
            gap: 8, marginBottom: 4, fontSize: 11, color: "var(--ds-text-muted)",
          }}>
            <span>
              <strong style={{ color: "var(--ds-text-primary)", fontWeight: 500 }}>
                {batchMinutesPlanned} min
              </strong>{" "}planned
              {dayCapacityMinutes > 0 && <> · capacity {dayCapacityMinutes} min</>}
            </span>
            {dayCapacityMinutes > 0 && (
              <span style={{ color: utilizationColor, fontWeight: 500 }}>
                {utilizationPct}% utilised
              </span>
            )}
          </div>
          <div style={{
            height: 6, borderRadius: 4, overflow: "hidden",
            background: "var(--ds-card-bg-hover, rgba(0,0,0,0.06))",
            border: "0.5px solid var(--ds-border-warm)",
          }}>
            <div style={{
              height: "100%",
              width: `${Math.min(100, utilizationPct)}%`,
              background: utilizationColor, transition: "width 0.3s",
            }} />
          </div>
          {dayCapacityMinutes === 0 && (
            <p style={{ fontSize: 10, color: "var(--ds-text-muted)", marginTop: 4, fontStyle: "italic" }}>
              ✗ Capacity unknown — set <code>defaultHoursPerDay</code> on people for utilisation %.
            </p>
          )}
        </div>

        {(linkedOrders.length > 0 || surplusPlanned > 0) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12, fontSize: 12, alignItems: "center" }}>
            <span style={{ color: "var(--ds-text-muted)" }}>Contributing to:</span>
            {linkedOrders.map((lo) => (
              <Link
                key={lo.orderId}
                href={`/orders/${encodeURIComponent(lo.orderId)}`}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "2px 8px",
                  border: "0.5px solid var(--ds-border-warm)", borderRadius: 6,
                  background: "var(--ds-card-bg)", color: "var(--ds-text-primary)",
                  textDecoration: "none",
                }}
              >
                <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lo.label}</span>
                <span style={{ color: "var(--ds-text-muted)", fontVariantNumeric: "tabular-nums" }}>· {lo.allocatedQuantity} pcs</span>
              </Link>
            ))}
            {surplusPlanned > 0 && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "2px 8px",
                border: "0.5px solid var(--ds-border-warm)", borderRadius: 4,
                background: "var(--ds-card-bg-hover, rgba(0,0,0,0.04))",
                color: "var(--ds-text-muted)", fontVariantNumeric: "tabular-nums",
              }}>
                Surplus · {surplusPlanned} pcs
              </span>
            )}
          </div>
        )}

        {editingBatchNote ? (
          <textarea
            autoFocus
            value={batchNoteInput}
            onChange={(e) => setBatchNoteInput(e.target.value)}
            onBlur={handleSaveBatchNote}
            onKeyDown={(e) => { if (e.key === "Escape") setEditingBatchNote(false); }}
            placeholder="Note for this batch…"
            rows={3}
            style={{
              width: "100%", padding: "8px 12px", marginBottom: 12,
              border: "0.5px solid var(--ds-border-warm)", borderRadius: 6,
              background: "var(--ds-card-bg)", fontSize: 13, resize: "none", outline: "none",
              color: "var(--ds-text-primary)",
            }}
          />
        ) : plan.notes ? (
          <button
            onClick={() => { setBatchNoteInput(plan.notes ?? ""); setEditingBatchNote(true); }}
            style={{
              display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 12,
              padding: 0, border: "none", background: "transparent",
              fontSize: 12, color: "var(--ds-text-muted)", fontStyle: "italic",
              cursor: "pointer", textAlign: "left", width: "100%",
            }}
          >
            <StickyNote size={13} style={{ marginTop: 2, flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{plan.notes}</span>
            <Pencil size={11} style={{ marginTop: 2, flexShrink: 0, opacity: 0.5 }} />
          </button>
        ) : (
          <button
            onClick={() => { setBatchNoteInput(""); setEditingBatchNote(true); }}
            style={{
              display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 12,
              padding: 0, border: "none", background: "transparent",
              fontSize: 12, color: "var(--ds-text-muted)", cursor: "pointer",
            }}
          >
            <StickyNote size={12} /> Add batch note
          </button>
        )}

        {deadlineImpact && deadlineImpact.length > 0 && (
          <div style={{
            marginBottom: 12, padding: "10px 12px",
            border: "0.5px solid var(--ds-tier-urgent)",
            background: "rgba(220, 80, 60, 0.06)", borderRadius: 4,
            display: "flex", justifyContent: "space-between", gap: 12,
          }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: "var(--ds-tier-urgent)" }}>
                Yield short — {deadlineImpact.length === 1 ? "1 order" : `${deadlineImpact.length} orders`} at risk
              </p>
              <ul style={{ marginTop: 4, fontSize: 11, color: "var(--ds-text-primary)", listStyle: "none", padding: 0 }}>
                {deadlineImpact.map((issue) => (
                  <li key={issue.orderId}>
                    <span style={{ fontWeight: 500 }}>{issue.orderName}</span>
                    {" · "}short {issue.shortfall}
                    {" · "}needs {issue.required} by {new Date(issue.deadline).toLocaleDateString("de-AT", { day: "numeric", month: "short" })}
                  </li>
                ))}
              </ul>
            </div>
            <button
              onClick={() => setDeadlineImpact(null)}
              style={{ fontSize: 11, color: "var(--ds-text-muted)", background: "transparent", border: "none", cursor: "pointer" }}
            >
              Dismiss
            </button>
          </div>
        )}

        {plan.status === "done" && printerEnabled && printState === "error" && (
          <p style={{ fontSize: 11, color: "var(--ds-tier-urgent)", marginBottom: 8 }}>{printError}</p>
        )}

        {/* ── Phase C.2 — Plan ───────────────────────────────────── */}
        {activeStep === "plan" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Section
              title="Batches scheduled"
              action={
                <DsButton size="sm" variant="primary" onClick={() => setAddBatchDrawerOpen(true)}>
                  <Plus size={12} style={{ marginRight: 4, verticalAlign: "-2px" }} /> Add batch
                </DsButton>
              }
              noBody
            >
              {planProducts.length === 0 ? (
                <p style={{ padding: "16px 20px", fontSize: 13, color: "var(--ds-text-muted)", fontStyle: "italic" }}>
                  No batches scheduled yet. Use “Add batch” to assign a product + mould + quantity.
                </p>
              ) : (
                [...planProducts].sort((a, b) => a.sortOrder - b.sortOrder).map((pp, idx, arr) => {
                  const product = productsMap.get(pp.productId);
                  const mould = mouldsMap.get(pp.mouldId);
                  const minutes = minutesByPlanProduct.get(pp.id!) ?? 0;
                  return (
                    <ListRow
                      key={pp.id}
                      title={
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <span style={{ display: "inline-flex", flexDirection: "column", color: "var(--ds-text-muted)", lineHeight: 0.8 }}>
                            <button
                              onClick={(e) => { e.stopPropagation(); reorderPlanProduct(pp.id!, -1); }}
                              disabled={idx === 0}
                              title="Move up"
                              style={{ background: "transparent", border: "none", cursor: idx === 0 ? "default" : "pointer", padding: 0, opacity: idx === 0 ? 0.3 : 1, fontSize: 8 }}
                            >▲</button>
                            <button
                              onClick={(e) => { e.stopPropagation(); reorderPlanProduct(pp.id!, 1); }}
                              disabled={idx === arr.length - 1}
                              title="Move down"
                              style={{ background: "transparent", border: "none", cursor: idx === arr.length - 1 ? "default" : "pointer", padding: 0, opacity: idx === arr.length - 1 ? 0.3 : 1, fontSize: 8 }}
                            >▼</button>
                          </span>
                          <IconGripVertical size={13} stroke={1.4} style={{ color: "var(--ds-text-muted)", opacity: 0.5 }} />
                          <span>{product?.name ?? "Unknown product"}</span>
                          <span style={{ fontWeight: 400, color: "var(--ds-text-muted)" }}>
                            · {pp.quantity} mould{pp.quantity === 1 ? "" : "s"}
                          </span>
                        </span>
                      }
                      meta={
                        <>
                          <span>{mould?.name ?? "—"}</span>
                          {minutes > 0 && <> · ~{minutes} min</>}
                          {pp.assignedPersonId && people.find((p) => p.id === pp.assignedPersonId) && (
                            <> · {people.find((p) => p.id === pp.assignedPersonId)?.name}</>
                          )}
                          {!pp.assignedPersonId && (
                            <> · <span style={{ fontStyle: "italic", color: "var(--ds-text-muted)" }}>unassigned</span></>
                          )}
                        </>
                      }
                      side={
                        <DsButton size="sm" onClick={() => setEditingPlanProductId(pp.id!)}>
                          <Pencil size={11} style={{ marginRight: 4, verticalAlign: "-2px" }} /> Edit
                        </DsButton>
                      }
                      onClick={() => setEditingPlanProductId(pp.id!)}
                    />
                  );
                })
              )}
            </Section>

            <Section title="Day summary">
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: 12, padding: "0 20px",
              }}>
                <StatCard
                  label="Total minutes"
                  value={batchMinutesPlanned > 0 ? `${batchMinutesPlanned}` : "—"}
                  meta={batchMinutesPlanned > 0 ? `${(batchMinutesPlanned / 60).toFixed(1)} h hands-on` : undefined}
                />
                <StatCard
                  label="Day capacity"
                  value={dayCapacityMinutes > 0 ? `${dayCapacityMinutes}` : "—"}
                  meta={dayCapacityMinutes > 0
                    ? `${batchDates.length} day${batchDates.length === 1 ? "" : "s"} · ${(dayCapacityMinutes / 60).toFixed(1)} h`
                    : "no people-hours set"}
                />
                <StatCard
                  label="Utilisation"
                  value={dayCapacityMinutes > 0 ? `${utilizationPct}%` : "—"}
                  variant={utilizationVariant}
                />
                <StatCard
                  label="Batches"
                  value={planProducts.length}
                  meta={planProducts.length === 0 ? "none scheduled" : undefined}
                />
              </div>
            </Section>

            <p style={{ fontSize: 10, color: "var(--ds-text-muted)", fontStyle: "italic" }}>
              ✗ True drag-drop reorder via grip handle is deferred — ▲▼ swap-sortOrder shipped for now.
            </p>
          </div>
        )}

        {/* ── Phase C.3 — Prep ───────────────────────────────────── */}
        {activeStep === "prep" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Section
              title="Mise en place"
              action={
                miseEnPlace.length > 0 && (
                  <button
                    onClick={() => {
                      const next = new Set(preppedIngredientIds);
                      if (allPrepped) {
                        for (const r of miseEnPlace) next.delete(r.ingredientId);
                      } else {
                        for (const r of miseEnPlace) next.add(r.ingredientId);
                      }
                      setPreppedIngredientIds(next);
                    }}
                    style={{
                      fontSize: 11, color: "var(--ds-text-muted)",
                      background: "transparent", border: "none", cursor: "pointer",
                    }}
                  >
                    {allPrepped ? "Unmark all" : "Mark all prepped"}
                  </button>
                )
              }
              noBody
            >
              {miseEnPlace.length === 0 ? (
                <p style={{ padding: "16px 20px", fontSize: 13, color: "var(--ds-text-muted)", fontStyle: "italic" }}>
                  No ingredients required yet — add planned batches first.
                </p>
              ) : (
                miseEnPlace.map((row) => {
                  const isPrepped = preppedIngredientIds.has(row.ingredientId);
                  const tier: "default" | "done" | "urgent" = isPrepped ? "done" : row.shortG > 0 ? "urgent" : "default";
                  return (
                    <ListRow
                      key={row.ingredientId}
                      tier={tier}
                      title={
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={isPrepped}
                            onChange={(e) => {
                              const next = new Set(preppedIngredientIds);
                              if (e.target.checked) next.add(row.ingredientId);
                              else next.delete(row.ingredientId);
                              setPreppedIngredientIds(next);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            style={{ cursor: "pointer" }}
                          />
                          <span style={{ textDecoration: isPrepped ? "line-through" : "none" }}>
                            {row.ingredientName}
                          </span>
                        </span>
                      }
                      meta={
                        <>
                          <span style={{ fontVariantNumeric: "tabular-nums" }}>
                            need <strong style={{ color: "var(--ds-text-primary)" }}>{formatGrams(row.neededG)}</strong>
                          </span>
                          {" · "}
                          <span style={{ fontVariantNumeric: "tabular-nums" }}>
                            on hand {formatGrams(row.onHandG)}
                          </span>
                          {row.shortG > 0 && (
                            <>
                              {" · "}
                              <span style={{ color: "var(--ds-tier-urgent)", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
                                short {formatGrams(row.shortG)}
                              </span>
                            </>
                          )}
                        </>
                      }
                    />
                  );
                })
              )}
              {miseEnPlace.length > 0 && (
                <p style={{ padding: "8px 20px 0", fontSize: 10, color: "var(--ds-text-muted)", fontStyle: "italic" }}>
                  ✗ Prepped ticks are local-only — no <code>planPrepStatus</code> schema yet to persist per-plan prep checklist state.
                </p>
              )}
            </Section>

            <Section title="Moulds ready" noBody>
              {mouldsNeeded.length === 0 ? (
                <p style={{ padding: "16px 20px", fontSize: 13, color: "var(--ds-text-muted)", fontStyle: "italic" }}>
                  No moulds required yet.
                </p>
              ) : (
                mouldsNeeded.map((row) => {
                  const isClean = cleanMouldIds.has(row.mouldId);
                  const enoughClean = row.free >= row.needed;
                  const tier: "default" | "positive" | "urgent" | "active" = isClean || enoughClean ? "positive" : row.free === 0 ? "urgent" : "active";
                  return (
                    <ListRow
                      key={row.mouldId}
                      tier={tier}
                      title={
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <span>{row.mouldName}</span>
                          <span style={{ color: "var(--ds-text-muted)", fontWeight: 400 }}>
                            · {row.needed} needed
                          </span>
                        </span>
                      }
                      meta={
                        <>
                          <span style={{ fontVariantNumeric: "tabular-nums" }}>free {row.free}</span>
                          {" · "}
                          <span style={{ fontVariantNumeric: "tabular-nums" }}>in use {row.inUse}</span>
                          {row.sealed > 0 && (
                            <>
                              {" · "}
                              <span style={{ fontVariantNumeric: "tabular-nums" }}>sealed {row.sealed}</span>
                            </>
                          )}
                        </>
                      }
                      side={
                        <button
                          onClick={() => {
                            const next = new Set(cleanMouldIds);
                            if (isClean) next.delete(row.mouldId);
                            else next.add(row.mouldId);
                            setCleanMouldIds(next);
                          }}
                          style={{
                            fontSize: 11, padding: "3px 8px",
                            border: `0.5px solid ${isClean ? "var(--accent-mint-ink, #4ea58a)" : "var(--ds-border-warm)"}`,
                            background: isClean ? "var(--accent-mint-bg, #e5f3ec)" : "var(--ds-card-bg)",
                            color: isClean ? "var(--accent-mint-ink, #2f7259)" : "var(--ds-text-muted)",
                            borderRadius: 12, cursor: "pointer",
                          }}
                        >
                          {isClean ? "Clean ✓" : "Mark clean"}
                        </button>
                      }
                    />
                  );
                })
              )}
              {mouldsNeeded.length > 0 && (
                <p style={{ padding: "8px 20px 0", fontSize: 10, color: "var(--ds-text-muted)", fontStyle: "italic" }}>
                  ✗ Clean toggles are local-only — pool state derived from <code>mouldPool.currentState</code> but per-plan cleaning isn't persisted.
                </p>
              )}
            </Section>

            <Section title="Machines loaded" noBody>
              {machinesView.length === 0 ? (
                <p style={{ padding: "16px 20px", fontSize: 13, color: "var(--ds-text-muted)", fontStyle: "italic" }}>
                  No tempering / melting equipment instances configured. Add them in Production brain → Equipment.
                </p>
              ) : (
                machinesView.map(({ instance, load, loadedIngredientName }) => {
                  const isEmpty = !load;
                  const tier: "default" | "active" = isEmpty ? "default" : "active";
                  return (
                    <ListRow
                      key={instance.id}
                      tier={tier}
                      title={<span>{instance.name}</span>}
                      meta={
                        isEmpty ? (
                          <span style={{ fontStyle: "italic", color: "var(--ds-text-muted)" }}>empty</span>
                        ) : (
                          <>
                            <span>{loadedIngredientName ?? "Loaded"}</span>
                            {" · "}
                            <span style={{ fontVariantNumeric: "tabular-nums" }}>
                              {formatGrams(load!.remainingQuantityG)} of {formatGrams(load!.loadedQuantityG)}
                            </span>
                          </>
                        )
                      }
                      side={
                        isEmpty ? (
                          <Link
                            href="/production-brain/equipment"
                            style={{
                              fontSize: 11, padding: "3px 10px",
                              border: "0.5px solid var(--ds-tier-quarter-focus)",
                              background: "var(--ds-tier-quarter-focus)", color: "#fff",
                              borderRadius: 12, textDecoration: "none",
                            }}
                          >
                            Load now
                          </Link>
                        ) : (
                          <StatusTag kind={instance.status === "running" ? "scheduled" : "neutral"}>
                            {instance.status}
                          </StatusTag>
                        )
                      }
                    />
                  );
                })
              )}
            </Section>
          </div>
        )}

        {activeStep === "production" && (
          <>
            {steps.length === 0 ? (
              <Section title="No steps generated">
                <p style={{ padding: "12px 20px", fontSize: 13, color: "var(--ds-text-muted)", fontStyle: "italic" }}>
                  Make sure the products in this plan have fillings assigned.
                </p>
              </Section>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {PHASES.map(({ id, label }) => {
                  const phaseSteps = steps.filter((s) => s.group === id);
                  if (phaseSteps.length === 0) return null;
                  const phaseDone = phaseSteps.filter((s) => statusMap.get(s.key)).length;
                  const total = phaseSteps.length;
                  const allDone = total > 0 && phaseDone === total;
                  const anyDone = phaseDone > 0;
                  const isActiveNow = anyDone && !allDone;
                  const expanded = effectiveExpanded.has(id);
                  const phaseColor = PHASE_COLOR[id];
                  const estMin = estMinutesByPhase[id] ?? 0;
                  const days = phaseDaysById.get(id) ?? [];
                  const daysLabel = days.length === 0
                    ? null
                    : days.length === 1
                      ? new Date(days[0] + "T12:00:00").toLocaleDateString("de-AT", { day: "numeric", month: "short" })
                      : `${new Date(days[0] + "T12:00:00").toLocaleDateString("de-AT", { day: "numeric", month: "short" })} +${days.length - 1}`;

                  return (
                    <div
                      key={id}
                      style={{
                        background: "var(--ds-card-bg)",
                        border: "0.5px solid var(--ds-border-warm)",
                        borderLeft: `3px solid ${phaseColor}`,
                        borderRadius: 8,
                        overflow: "hidden",
                        opacity: allDone ? 0.85 : 1,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => togglePhaseCard(id)}
                        style={{
                          width: "100%", textAlign: "left", padding: "12px 18px",
                          background: "transparent", border: "none", cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          gap: 12,
                          borderBottom: expanded ? "0.5px solid var(--ds-border-warm)" : "none",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
                          <span style={{
                            fontFamily: "var(--font-serif)", fontSize: 16, fontWeight: 500,
                            letterSpacing: "-0.012em", color: "var(--ds-text-primary)",
                          }}>{label}</span>
                          <span style={{ fontSize: 11, color: "var(--ds-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                            {phaseDone}/{total}
                          </span>
                          {estMin > 0 && (
                            <span style={{ fontSize: 11, color: "var(--ds-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                              · ~{estMin} min
                            </span>
                          )}
                          {daysLabel && (
                            <span style={{ fontSize: 11, color: "var(--ds-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                              · {daysLabel}
                            </span>
                          )}
                          {isActiveNow && <StatusTag kind="pending">active now</StatusTag>}
                          {allDone && <StatusTag kind="ready">all done</StatusTag>}
                        </div>
                        <span style={{
                          fontSize: 12, color: "var(--ds-text-muted)",
                          transform: expanded ? "rotate(90deg)" : "none",
                          transition: "transform 0.15s",
                        }}>▸</span>
                      </button>

                      {expanded && (
                        <div style={{ padding: "12px 18px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                          {/* Materials panel — colour / cap phases only */}
                          {((id === "colour" && colouringMaterialIds.length > 0) ||
                            (id === "cap" && cappingMaterialIds.length > 0)) && (
                            <div style={{
                              padding: "10px 12px",
                              border: "0.5px solid var(--ds-border-warm)", borderRadius: 6,
                              background: "var(--ds-card-bg-hover, rgba(0,0,0,0.02))",
                            }}>
                              <p style={{
                                fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em",
                                color: "var(--ds-text-muted)", fontWeight: 500, marginBottom: 6,
                              }}>Materials needed</p>
                              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                                {(id === "colour" ? colouringMaterialIds : cappingMaterialIds).map((mid) => {
                                  const material = materialsMap.get(mid);
                                  return (
                                    <li key={mid} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                      <span style={{
                                        width: 14, height: 14, borderRadius: 4,
                                        border: "0.5px solid rgba(0,0,0,0.1)",
                                        background: material?.color ?? "#9ca3af",
                                        flexShrink: 0,
                                      }} />
                                      <span style={{ fontSize: 13, flex: 1 }}>{material?.name ?? mid}</span>
                                      <LowStockFlagButton
                                        flagged={material?.lowStock}
                                        itemName={material?.name}
                                        onFlag={() => setDecorationMaterialLowStock(mid, true)}
                                        size="sm"
                                      />
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          )}

                          {/* Filling-prep scaled recipes link */}
                          {id === "filling" && fillingAmounts.length > 0 && (
                            <Link
                              href={`/production/${encodeURIComponent(planId)}/products?back=production`}
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 6,
                                fontSize: 12, color: "var(--ds-text-muted)", textDecoration: "none",
                                width: "fit-content",
                              }}
                              className="hover:[color:var(--ds-text-primary)]"
                            >
                              <BookOpen size={14} /> Scaled recipes
                            </Link>
                          )}

                          {/* Mark all done / Unmark all */}
                          <div style={{ display: "flex", justifyContent: "flex-end" }}>
                            <button
                              onClick={() => handleTogglePhase(id)}
                              style={{
                                fontSize: 11, color: "var(--ds-text-muted)",
                                background: "transparent", border: "none", cursor: "pointer",
                              }}
                            >
                              {allDone ? "Unmark all" : "Mark all done"}
                            </button>
                          </div>

                          {/* Step list — shell+cap subgroup by coating */}
                          {(id === "shell" || id === "cap")
                            ? renderCoatingGroupedSteps(phaseSteps, statusMap, handleToggle, materialsMap, planProducts, productsMap, mouldsMap)
                            : (
                              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                                {phaseSteps.map((step, stepIdx) => {
                                  const done = statusMap.get(step.key) ?? false;
                                  const prevColors = phaseSteps[stepIdx - 1]?.colors?.join(",") ?? "";
                                  const curColors = step.colors?.join(",") ?? "";
                                  const showSeparator = id === "colour"
                                    && stepIdx > 0
                                    && step.colors && step.colors.length > 0
                                    && curColors !== prevColors;
                                  return (
                                    <li key={step.key}>
                                      {showSeparator && (
                                        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
                                          <div style={{ flex: 1, height: 0.5, background: "var(--ds-border-warm)" }} />
                                          <span style={{
                                            fontSize: 10, color: "var(--ds-text-muted)",
                                            textTransform: "uppercase", letterSpacing: "0.06em",
                                            display: "inline-flex", alignItems: "center", gap: 4,
                                          }}>
                                            Switch to
                                            {step.colors!.map((cid) => {
                                              const m = materialsMap.get(cid);
                                              return (
                                                <span
                                                  key={cid}
                                                  style={{
                                                    display: "inline-block", width: 10, height: 10,
                                                    borderRadius: 4, border: "0.5px solid rgba(0,0,0,0.1)",
                                                    background: m?.color ?? "#9ca3af",
                                                  }}
                                                  title={m?.name ?? cid}
                                                />
                                              );
                                            })}
                                            {step.colors!.map((cid) => materialsMap.get(cid)?.name ?? cid).join(", ")}
                                          </span>
                                          <div style={{ flex: 1, height: 0.5, background: "var(--ds-border-warm)" }} />
                                        </div>
                                      )}
                                      <StepItem
                                        step={step}
                                        done={done}
                                        onToggle={handleToggle}
                                        materialsMap={materialsMap}
                                        yieldInfo={step.group === "unmould" && step.planProductId ? (() => {
                                          const pb = planProducts.find((b) => b.id === step.planProductId);
                                          return pb?.actualYield != null ? { actual: pb.actualYield, total: step.totalProducts ?? 0 } : null;
                                        })() : undefined}
                                      />
                                    </li>
                                  );
                                })}
                              </ul>
                            )
                          }
                        </div>
                      )}
                    </div>
                  );
                })}

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                  <button
                    onClick={handleReset}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      fontSize: 11, color: "var(--ds-text-muted)",
                      background: "transparent", border: "none", cursor: "pointer",
                    }}
                  >
                    <RotateCcw size={13} /> Reset all steps
                  </button>
                  <p style={{ fontSize: 10, color: "var(--ds-text-muted)", fontStyle: "italic", margin: 0 }}>
                    ✗ Start / Pause / per-step time-tracking deferred — no <code>planStepStatus.startedAt</code> column yet.
                  </p>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Phase C.5 — Packing ───────────────────────────────── */}
        {activeStep === "packing" && (() => {
          const packingSteps = steps.filter((s) => s.group === "packing");
          // Variant boxes vs single-product packing. The current model
          // doesn't distinguish boxes from singles — every planProduct
          // gets one packing step. We surface them all as "Boxes to
          // pack"; Singles to wrap stays ✗ until variant boxes are
          // first-class on the plan model.
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Section
                title="Boxes to pack"
                action={
                  packingSteps.length > 0 && (
                    <span style={{ fontSize: 11, color: "var(--ds-text-muted)" }}>
                      {packingSteps.filter((s) => statusMap.get(s.key)).length}/{packingSteps.length} packed
                    </span>
                  )
                }
                noBody
              >
                {packingSteps.length === 0 ? (
                  <p style={{ padding: "16px 20px", fontSize: 13, color: "var(--ds-text-muted)", fontStyle: "italic" }}>
                    No packing steps generated. Packing-only batches (e.g. borrowed-from-store orders) won't render here.
                  </p>
                ) : (
                  packingSteps.map((step) => {
                    const done = statusMap.get(step.key) ?? false;
                    const pp = step.planProductId ? planProducts.find((b) => b.id === step.planProductId) : null;
                    const product = pp ? productsMap.get(pp.productId) : null;
                    const linkedOrderLabels = pp && planLinks.length > 0
                      ? planLinks
                        .filter((lk) => allOrderItems.find((oi) => oi.id === lk.orderItemId)?.productId === pp.productId)
                        .map((lk) => {
                          const item = allOrderItems.find((oi) => oi.id === lk.orderItemId);
                          const order = item ? allOrders.find((o) => o.id === item.orderId) : null;
                          return order ? (order.customerName || order.eventName || order.sourceRef || "order") : null;
                        })
                        .filter((s): s is string => !!s)
                      : [];
                    return (
                      <ListRow
                        key={step.key}
                        tier={done ? "done" : "default"}
                        title={
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <span style={{ textDecoration: done ? "line-through" : "none" }}>
                              {product?.name ?? step.label.replace(/^Pack:\s*/, "")}
                            </span>
                            {step.totalProducts ? (
                              <span style={{ color: "var(--ds-text-muted)", fontWeight: 400, fontVariantNumeric: "tabular-nums" }}>
                                · {step.totalProducts} pc
                              </span>
                            ) : null}
                          </span>
                        }
                        meta={
                          <>
                            {linkedOrderLabels.length > 0 ? (
                              <span>for {linkedOrderLabels.slice(0, 2).join(", ")}{linkedOrderLabels.length > 2 ? ` +${linkedOrderLabels.length - 2}` : ""}</span>
                            ) : (
                              <span style={{ fontStyle: "italic", color: "var(--ds-text-muted)" }}>surplus / store</span>
                            )}
                          </>
                        }
                        side={
                          <button
                            onClick={() => handleToggle(step.key)}
                            style={{
                              fontSize: 11, padding: "4px 10px",
                              border: `0.5px solid ${done ? "var(--accent-mint-ink, #4ea58a)" : "var(--ds-tier-quarter-focus)"}`,
                              background: done ? "var(--accent-mint-bg, #e5f3ec)" : "var(--ds-tier-quarter-focus)",
                              color: done ? "var(--accent-mint-ink, #2f7259)" : "#fff",
                              borderRadius: 12, cursor: "pointer",
                            }}
                          >
                            {done ? "Packed ✓" : "Pack"}
                          </button>
                        }
                      />
                    );
                  })
                )}
              </Section>

              <Section title="Singles to wrap" noBody>
                <p style={{ padding: "16px 20px", fontSize: 13, color: "var(--ds-text-muted)", fontStyle: "italic" }}>
                  ✗ Singles-to-wrap surface deferred — schema has no flag to distinguish
                  single-product wrap tasks from boxed packing. Until then everything
                  lives under <strong style={{ color: "var(--ds-text-primary)", fontWeight: 500 }}>Boxes to pack</strong> above.
                </p>
              </Section>
            </div>
          );
        })()}

        {/* ── Phase C.6 — Wrap up ───────────────────────────────── */}
        {activeStep === "wrapup" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Section title="Yield" noBody>
              {planProducts.length === 0 ? (
                <p style={{ padding: "16px 20px", fontSize: 13, color: "var(--ds-text-muted)", fontStyle: "italic" }}>
                  No batches to record yield against.
                </p>
              ) : (
                <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "var(--ds-card-bg-hover, rgba(0,0,0,0.02))" }}>
                      <th style={{ textAlign: "left", padding: "8px 20px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ds-text-muted)", fontWeight: 500 }}>Batch</th>
                      <th style={{ textAlign: "right", padding: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ds-text-muted)", fontWeight: 500 }}>Planned</th>
                      <th style={{ textAlign: "right", padding: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ds-text-muted)", fontWeight: 500 }}>Actual</th>
                      <th style={{ textAlign: "right", padding: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ds-text-muted)", fontWeight: 500 }}>Variance</th>
                      <th style={{ textAlign: "left", padding: "8px 20px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ds-text-muted)", fontWeight: 500 }}>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {planProducts.map((pp) => {
                      const product = productsMap.get(pp.productId);
                      const mould = mouldsMap.get(pp.mouldId);
                      const planned = pp.quantity * (mould?.numberOfCavities ?? 0);
                      const actual = pp.actualYield;
                      const variance = typeof actual === "number" ? actual - planned : null;
                      return (
                        <tr key={pp.id} style={{ borderTop: "0.5px solid var(--ds-border-warm)" }}>
                          <td style={{ padding: "10px 20px" }}>
                            <span style={{ fontWeight: 500 }}>{product?.name ?? "Unknown"}</span>
                            <span style={{ color: "var(--ds-text-muted)", marginLeft: 6 }}>· {mould?.name ?? "—"}</span>
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{planned}</td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{actual ?? "—"}</td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: variance == null ? "var(--ds-text-muted)" : variance < 0 ? "var(--ds-tier-urgent)" : variance > 0 ? "var(--ds-tier-positive)" : "var(--ds-text-primary)" }}>
                            {variance == null ? "—" : variance > 0 ? `+${variance}` : variance}
                          </td>
                          <td style={{ padding: "6px 20px" }}>
                            <input
                              type="text"
                              defaultValue={pp.varianceReason ?? ""}
                              onBlur={async (e) => {
                                const next = e.target.value.trim() || undefined;
                                if (next === (pp.varianceReason ?? undefined)) return;
                                await savePlanProduct({ ...pp, varianceReason: next });
                              }}
                              placeholder={variance != null && variance !== 0 ? "Why?" : "—"}
                              style={{
                                width: "100%", padding: "4px 8px", fontSize: 12,
                                border: "0.5px solid var(--ds-border-warm)", borderRadius: 4,
                                background: "var(--ds-card-bg)", color: "var(--ds-text-primary)",
                                outline: "none",
                              }}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Section>

            {planProducts.length > 0 && (
              <Section title="Product notes" noBody>
                {planProducts.map((pb) => {
                  const productName = productNames.get(pb.productId) ?? "Unknown";
                  const isEditing = editingProductNoteId === pb.id;
                  return (
                    <div key={pb.id} style={{ padding: "12px 20px", borderTop: "0.5px solid var(--ds-border-warm)" }}>
                      <p style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>{productName}</p>
                      {isEditing ? (
                        <textarea
                          autoFocus
                          value={productNoteInput}
                          onChange={(e) => setProductNoteInput(e.target.value)}
                          onBlur={() => handleSaveProductNote(pb)}
                          onKeyDown={(e) => { if (e.key === "Escape") setEditingProductNoteId(null); }}
                          placeholder="What happened with this product…"
                          rows={3}
                          style={{
                            width: "100%", padding: "8px 10px",
                            border: "0.5px solid var(--ds-border-warm)", borderRadius: 6,
                            background: "var(--ds-card-bg)", fontSize: 13, resize: "none", outline: "none",
                            color: "var(--ds-text-primary)",
                          }}
                        />
                      ) : pb.notes ? (
                        <button
                          onClick={() => { setProductNoteInput(pb.notes ?? ""); setEditingProductNoteId(pb.id!); }}
                          style={{
                            display: "flex", alignItems: "flex-start", gap: 8, width: "100%",
                            padding: 0, background: "transparent", border: "none", cursor: "pointer",
                            textAlign: "left",
                          }}
                        >
                          <span style={{ fontSize: 12, color: "var(--ds-text-muted)", fontStyle: "italic", flex: 1, lineHeight: 1.5 }}>{pb.notes}</span>
                          <Pencil size={11} style={{ marginTop: 2, opacity: 0.5, color: "var(--ds-text-muted)" }} />
                        </button>
                      ) : (
                        <button
                          onClick={() => { setProductNoteInput(""); setEditingProductNoteId(pb.id!); }}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            padding: 0, background: "transparent", border: "none",
                            fontSize: 12, color: "var(--ds-text-muted)", cursor: "pointer",
                          }}
                        >
                          <Plus size={12} /> Add note
                        </button>
                      )}
                    </div>
                  );
                })}
              </Section>
            )}

            <Section title="Notes">
              <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
                <DsInlineTextarea
                  label="Day notes"
                  value={plan.notes ?? ""}
                  onSave={async (v) => {
                    const trimmed = (v as string).trim();
                    await saveProductionPlan({ ...plan as any, id: plan.id, notes: trimmed || undefined });
                  }}
                  placeholder="What happened today — temperature swings, supplier delays, anything noteworthy."
                />
                <DsInlineTextarea
                  label="Issues encountered"
                  value={plan.issuesNotes ?? ""}
                  onSave={async (v) => {
                    const trimmed = (v as string).trim();
                    await saveProductionPlan({ ...plan as any, id: plan.id, issuesNotes: trimmed || undefined });
                  }}
                  placeholder="What broke, what slowed us down, what to fix next time."
                />
              </div>
            </Section>

            {plan.status !== "done" && (
              <Section title="Mark complete">
                <div style={{ padding: "12px 20px" }}>
                  <DsButton variant="primary" onClick={() => setMarkDoneDialogOpen(true)}>
                    <Check size={13} style={{ marginRight: 4, verticalAlign: "-2px" }} />
                    Mark production day complete
                  </DsButton>
                  <p style={{ marginTop: 8, fontSize: 11, color: "var(--ds-text-muted)" }}>
                    All {steps.length} steps will be marked complete and the batch will close out.
                  </p>
                </div>
              </Section>
            )}
          </div>
        )}
      </DsDetailPage>

      {/* Add-batch drawer (Plan step) */}
      <DsDrawer
        open={addBatchDrawerOpen}
        title="Add batch"
        onClose={() => setAddBatchDrawerOpen(false)}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <DsInlineSelect
            label="Product"
            value={addBatchProductId}
            onSave={(v) => setAddBatchProductId(v as string)}
            options={[
              { value: "", label: "Select product…" },
              ...[...productsMap.values()].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({
                value: p.id!,
                label: p.name,
              })),
            ]}
          />
          <DsInlineSelect
            label="Mould"
            value={addBatchMouldId}
            onSave={(v) => setAddBatchMouldId(v as string)}
            options={[
              { value: "", label: "Select mould…" },
              ...[...mouldsMap.values()].sort((a, b) => a.name.localeCompare(b.name)).map((m) => ({
                value: m.id!,
                label: `${m.name} (${m.numberOfCavities} cav)`,
              })),
            ]}
          />
          <DsInlineField
            label="Moulds to run"
            type="number"
            value={String(addBatchQuantity)}
            onSave={(v) => setAddBatchQuantity(Math.max(1, parseInt(String(v)) || 1))}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <DsButton onClick={() => setAddBatchDrawerOpen(false)}>Cancel</DsButton>
            <DsButton
              variant="primary"
              onClick={handleAddBatch}
              disabled={!addBatchProductId || !addBatchMouldId || addBatchQuantity < 1}
            >
              Add batch
            </DsButton>
          </div>
        </div>
      </DsDrawer>

      {/* Edit-batch drawer (Plan step) */}
      <DsDrawer
        open={!!editingPlanProductId}
        title="Edit batch"
        onClose={() => setEditingPlanProductId(null)}
      >
        {(() => {
          const pp = planProducts.find((p) => p.id === editingPlanProductId);
          if (!pp) return null;
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <DsInlineSelect
                label="Product"
                value={pp.productId}
                onSave={async (v) => {
                  await savePlanProduct({ ...pp, productId: v as string });
                }}
                options={[...productsMap.values()].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({
                  value: p.id!,
                  label: p.name,
                }))}
              />
              <DsInlineSelect
                label="Mould"
                value={pp.mouldId}
                onSave={async (v) => {
                  await savePlanProduct({ ...pp, mouldId: v as string });
                }}
                options={[...mouldsMap.values()].sort((a, b) => a.name.localeCompare(b.name)).map((m) => ({
                  value: m.id!,
                  label: `${m.name} (${m.numberOfCavities} cav)`,
                }))}
              />
              <DsInlineField
                label="Moulds to run"
                type="number"
                value={String(pp.quantity)}
                onSave={async (v) => {
                  const q = Math.max(1, parseInt(String(v)) || 1);
                  await savePlanProduct({ ...pp, quantity: q });
                }}
              />
              <DsInlineSelect
                label="Assignee"
                value={pp.assignedPersonId ?? ""}
                onSave={async (v) => {
                  await savePlanProduct({ ...pp, assignedPersonId: (v as string) || undefined });
                }}
                options={[
                  { value: "", label: "— unassigned —" },
                  ...people
                    .filter((p) => !p.archived)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((p) => ({ value: p.id!, label: p.name })),
                ]}
              />
              <DsInlineTextarea
                label="Batch notes"
                value={pp.notes ?? ""}
                onSave={async (v) => {
                  await savePlanProduct({ ...pp, notes: (v as string).trim() || undefined });
                }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                <DsButton onClick={() => setEditingPlanProductId(null)}>Close</DsButton>
              </div>
            </div>
          );
        })()}
      </DsDrawer>

      <DsDialog
        open={markDoneDialogOpen}
        title="Mark entire batch as done?"
        description={`All ${steps.length} steps will be marked complete and this batch will close out. Unmould yields not yet recorded will prompt for entry first.`}
        confirmLabel="Yes, mark as done"
        onConfirm={async () => {
          setMarkDoneDialogOpen(false);
          await handleMarkAllDone();
        }}
        onCancel={() => setMarkDoneDialogOpen(false)}
      />

      {/* Yield modal */}
      {yieldModal && (
        <YieldModal
          entries={yieldModal.entries}
          mode={yieldModal.mode}
          onConfirm={handleYieldConfirm}
          onCancel={() => setYieldModal(null)}
        />
      )}

      {/* Allocation split — distributes actual yield across the
          batch's linked orders (+ surplus with destination). Now
          commits both the intent (links + plan.surplusDestination)
          AND the physical stock moves: Production → Allocated per
          order, and Production → Store / Freezer / waste for surplus.
          See commitAllocationSplit in hooks.ts. */}
      {splitModal && (
        <AllocationSplitModal
          totalYield={splitModal.totalYield}
          orders={buildSplitOrderRows(planLinks, allOrderItems, allOrders)}
          poItems={buildSplitPoRows(plan, planProducts, allProductionOrders, allProductionOrderItems)}
          onConfirm={async (result: AllocationSplitResult) => {
            await commitAllocationSplit({
              planId: plan.id!,
              perLink: result.perLink,
              perPo: result.perPo,
              surplus: result.surplus,
              surplusDestination: result.surplusDestination,
            });
            setSplitModal(null);
          }}
          onCancel={() => setSplitModal(null)}
        />
      )}

      {/* Packing modal */}
      {packingTarget && (
        <PackingModal
          productName={packingTarget.productName}
          totalPieces={packingTarget.totalPieces}
          packaging={packagingList}
          onConfirm={async ({ packagingId, units, note }) => {
            const actual = await consumePackaging({
              packagingId,
              quantity: units,
              planId,
              planProductId: packingTarget.planProductId,
              note,
            });
            await toggleStep(planId, packingTarget.stepKey, true);
            // Deduct packed pieces from Production stock (reason='sold').
            // Packing-only batches are skipped inside the helper.
            const prodStock = await consumeProductStockForPacking(
              packingTarget.planProductId,
              planId,
              packingTarget.totalPieces,
              packingTarget.stepKey,
            );
            setPackingTarget(null);
            const warnings: string[] = [];
            if (actual < units) {
              warnings.push(`Packaging: only ${actual} of ${units} units were on hand. Add stock on the Packaging page before the next pack.`);
            }
            warnings.push(...prodStock.warnings);
            if (warnings.length > 0) alert(warnings.join("\n"));
          }}
          onCancel={() => setPackingTarget(null)}
        />
      )}

      {leftoverModal && (
        <LeftoverModal
          entries={leftoverModal.entries}
          onConfirm={async (results) => {
            // Deduct old stock for all fillings sourced from previous batch
            await deductPreviousBatchStock();
            // Save new leftover stock — mark as frozen when the user chose
            // "Freeze leftover" (captures the full shelf life as preserved days).
            for (const r of results) {
              await saveFillingStock({
                fillingId: r.fillingId,
                remainingG: r.remainingG,
                planId: r.planId,
                madeAt: r.madeAt,
                createdAt: Date.now(),
                ...(r.frozen ? {
                  frozen: true,
                  frozenAt: Date.now(),
                  preservedShelfLifeDays: r.preservedShelfLifeDays ?? 0,
                } : {}),
              });
            }
            const shouldFinish = leftoverModal.pendingFinishAll;
            setLeftoverModal(null);
            if (shouldFinish) await finishMarkAllDone();
          }}
          onSkip={async () => {
            // Deduct old stock even when skipping leftover registration
            await deductPreviousBatchStock();
            const shouldFinish = leftoverModal.pendingFinishAll;
            setLeftoverModal(null);
            if (shouldFinish) await finishMarkAllDone();
          }}
        />
      )}
    </>
  );
}

function StepItem({ step, done, onToggle, materialsMap, yieldInfo }: {
  step: { key: string; label: string; detail?: string; colors?: string[] };
  done: boolean;
  onToggle: (key: string) => void;
  materialsMap: Map<string, DecorationMaterial>;
  yieldInfo?: { actual: number; total: number } | null;
}) {
  return (
    <button
      onClick={() => onToggle(step.key)}
      className={`w-full flex items-center gap-3 p-3 rounded-[4px] border text-left transition-colors ${
        done ? "border-status-ok-edge bg-status-ok-bg" : "border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)]"
      }`}
    >
      <div className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
        done ? "bg-status-ok border-status-ok" : "border-[color:var(--ds-border-warm)]"
      }`}>
        {done && (
          <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        )}
      </div>
      {step.colors && step.colors.length > 0 && (
        <div className="flex gap-0.5 shrink-0">
          {step.colors.map((id) => {
            const m = materialsMap.get(id);
            return (
              <span
                key={id}
                className="inline-block w-3 h-3 rounded-[4px] border border-black/10"
                style={{ backgroundColor: m?.color ?? "#9ca3af" }}
                title={m?.name ?? id}
              />
            );
          })}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${done ? "line-through text-muted-foreground" : ""}`}>{step.label}</p>
        {step.detail && <p className="text-xs text-muted-foreground">{step.detail}</p>}
        {yieldInfo && done && (
          <p className="text-xs text-status-ok mt-0.5 font-medium">
            {yieldInfo.actual === yieldInfo.total
              ? `${yieldInfo.actual} to stock`
              : `${yieldInfo.actual} to stock · ${yieldInfo.total - yieldInfo.actual} set aside`
            }
          </p>
        )}
      </div>
    </button>
  );
}

// ─── Step rendering helper ──────────────────────────────────────────

/** Render shell + cap phase steps grouped by coating (dark / milk /
 *  white). Lifted out of the production-step JSX so the phase-card map
 *  can call it inline without ballooning the parent JSX. Mirrors the
 *  pre-C.4 behaviour 1:1, including the seedTempering panel hook (kept
 *  off behind `seedTempering = false` until per-product seeding lands).
 */
function renderCoatingGroupedSteps(
  phaseSteps: Array<{
    key: string; label: string; group: string; detail?: string;
    colors?: string[]; coating?: string; subgroup?: string; mouldCount?: number;
    planProductId?: string; totalProducts?: number;
  }>,
  statusMap: Map<string, boolean>,
  handleToggle: (key: string) => void,
  materialsMap: Map<string, DecorationMaterial>,
  _planProducts: PlanProduct[],
  _productsMap: Map<string, Product>,
  _mouldsMap: Map<string, Mould>,
): React.ReactNode {
  const coatingOrder: string[] = [];
  const byCoating = new Map<string, typeof phaseSteps>();
  for (const step of phaseSteps) {
    const c = step.coating ?? "chocolate";
    if (!byCoating.has(c)) { byCoating.set(c, []); coatingOrder.push(c); }
    byCoating.get(c)!.push(step);
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {coatingOrder.map((coating) => {
        const coatingSteps = byCoating.get(coating)!;
        const coatingMoulds = coatingSteps.reduce((s, st) => s + (st.mouldCount ?? 0), 0);
        const regularSteps = coatingSteps.filter((s) => s.subgroup !== "after_cap");
        const afterCapSteps = coatingSteps.filter((s) => s.subgroup === "after_cap");
        return (
          <div key={coating}>
            <h3 style={{
              fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em",
              color: "var(--ds-text-muted)", fontWeight: 500, marginBottom: 6,
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <span style={{ textTransform: "capitalize" }}>{coating}</span>
              <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                · {coatingMoulds} mould{coatingMoulds !== 1 ? "s" : ""}
              </span>
            </h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {regularSteps.map((step) => (
                <StepItem key={step.key} step={step} done={statusMap.get(step.key) ?? false} onToggle={handleToggle} materialsMap={materialsMap} />
              ))}
            </ul>
            {afterCapSteps.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <p style={{
                  fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em",
                  color: "var(--ds-text-muted)", fontWeight: 500, marginBottom: 6,
                }}>After capping</p>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  {afterCapSteps.map((step) => (
                    <StepItem key={step.key} step={step} done={statusMap.get(step.key) ?? false} onToggle={handleToggle} materialsMap={materialsMap} />
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Display helpers ────────────────────────────────────────────────

/** Format grams using kg for ≥1000g (de-AT locale). Keeps the Prep
 *  step's "need / on hand / short" columns scannable for both 35 g
 *  hazelnut butter and 25 kg dark chocolate without two units fighting
 *  on the same line. */
function formatGrams(g: number): string {
  if (g >= 1000) {
    const kg = g / 1000;
    return `${kg.toLocaleString("de-AT", { maximumFractionDigits: 2 })} kg`;
  }
  return `${Math.round(g)} g`;
}

// ─── Allocation-split helpers ───────────────────────────────────────

/** Build the PO rows for the AllocationSplitModal. Walks the plan's
 *  name pattern (`PO: <po name> — <product>`) to find which PO this
 *  plan was seeded for, then includes every productionOrderItem whose
 *  product matches one of the plan's planProducts. Lets Maca-style
 *  POs reserve their own pieces at unmould instead of having every
 *  yield silently dumped into shop stock. */
function buildSplitPoRows(
  plan: import("@/types").ProductionPlan,
  planProducts: import("@/types").PlanProduct[],
  productionOrders: import("@/types").ProductionOrder[],
  productionOrderItems: import("@/types").ProductionOrderItem[],
): AllocationSplitPoRow[] {
  const name = plan.name ?? "";
  if (!name.startsWith("PO: ")) return [];
  const rest = name.slice("PO: ".length);
  const dash = rest.indexOf(" — ");
  const poName = dash > 0 ? rest.slice(0, dash) : rest;
  const matchingPos = productionOrders.filter((po) => {
    if (po.status !== "pending" && po.status !== "in_production") return false;
    return (po.name ?? "") === poName;
  });
  if (matchingPos.length === 0) return [];
  const planProductIds = new Set(planProducts.map((pp) => pp.productId));
  const rows: AllocationSplitPoRow[] = [];
  for (const po of matchingPos) {
    const items = productionOrderItems.filter((it) => it.productionOrderId === po.id);
    for (const it of items) {
      if (!planProductIds.has(it.productId)) continue;
      rows.push({
        productionOrderItemId: it.id!,
        productionOrderId: po.id!,
        productId: it.productId,
        poLabel: `${po.name ?? "PO"}`,
        requested: it.targetUnits,
      });
    }
  }
  return rows;
}

/** Build the row data the AllocationSplitModal renders: one entry per
 *  orderPlanLink, with the order label derived through the line. */
function buildSplitOrderRows(
  planLinks: import("@/types").OrderPlanLink[],
  orderItems: import("@/types").OrderItem[],
  orders: import("@/types").Order[],
): AllocationSplitOrderRow[] {
  const itemById = new Map(orderItems.map((oi) => [oi.id!, oi]));
  const orderById = new Map(orders.map((o) => [o.id!, o]));
  const rows: AllocationSplitOrderRow[] = [];
  for (const link of planLinks) {
    const item = itemById.get(link.orderItemId);
    if (!item) continue;
    const order = orderById.get(item.orderId);
    if (!order) continue;
    rows.push({
      orderPlanLinkId: link.id!,
      orderId: order.id!,
      orderLabel: order.customerName || order.eventName || order.sourceRef || "order",
      requested: link.allocatedQuantity,
    });
  }
  return rows;
}

