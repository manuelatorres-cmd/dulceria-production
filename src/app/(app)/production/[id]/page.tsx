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
} from "@/lib/hooks";
import { PackingModal } from "@/components/packing-modal";
import { generateSteps, calculateFillingAmounts, consolidateSharedFillings, generateBatchSummary, FILL_FACTOR, DENSITY_G_PER_ML } from "@/lib/production";
import type { Filling, Mould, PlanProduct, Product, DecorationMaterial } from "@/types";
import { normalizeApplyAt } from "@/types";
import { IconRotate as RotateCcw, IconPencil as Pencil, IconCheck as Check, IconX as X, IconBookmark as BookOpen, IconNote as StickyNote, IconPlus as Plus, IconClipboardList as ClipboardList, IconPrinter as Printer, IconPlayerPlay as Play } from "@tabler/icons-react";
import { BackButton } from "@/components/back-button";
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
  plan: { id?: string; batchNumber?: string; batchSummary?: string; name: string; status: "draft" | "active" | "done" | "cancelled" | "orphaned"; notes?: string; fillingOverrides?: string; fillingPreviousBatches?: string; createdAt: Date; updatedAt: Date; completedAt?: Date; surplusDestination?: "store" | "freezer" | "waste" };
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
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const from = params.get("from");
    if (from) { setBackHref(from); setBackLabel("Back to product"); }
    const tab = params.get("tab") as PhaseId | null;
    if (tab && PHASES.some((p) => p.id === tab)) setActivePhase(tab);
  }, []);
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

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <div className="px-4 pt-6 pb-2">
        <div className="mb-3">
          <BackButton fallbackHref={backHref} fallbackLabel={backLabel} />
        </div>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {editingName ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleRenamePlan(); if (e.key === "Escape") setEditingName(false); }}
                  className="flex-1 rounded-md border border-border bg-card px-2 py-1 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button onClick={handleRenamePlan} className="p-1 rounded-full hover:bg-muted"><Check className="w-4 h-4 text-primary" /></button>
                <button onClick={() => setEditingName(false)} className="p-1 rounded-full hover:bg-muted"><X className="w-4 h-4 text-muted-foreground" /></button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 group">
                <h1 className="text-xl font-bold truncate">{plan.name}</h1>
                <button
                  onClick={() => { setNameInput(plan.name); setEditingName(true); }}
                  className="p-1 rounded-full opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity"
                  aria-label="Rename batch"
                >
                  <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            )}
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {plan.batchNumber && (
                <>
                  <span className="font-mono text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{plan.batchNumber}</span>
                  <span className="text-xs text-muted-foreground">·</span>
                </>
              )}
              <p className="text-xs text-muted-foreground">{ageLabel}</p>
              <span className="text-xs text-muted-foreground">·</span>
              <p className="text-xs text-muted-foreground">{phaseDoneCount} / {PHASES.length} steps</p>
              {plan.batchSummary && (
                <>
                  <span className="text-xs text-muted-foreground">·</span>
                  <Link href={`/production/${encodeURIComponent(planId)}/summary`} className="inline-flex items-center gap-1 text-xs text-primary">
                    <ClipboardList className="w-3 h-3" /> Summary
                  </Link>
                </>
              )}
            </div>
            {(linkedOrders.length > 0 || surplusPlanned > 0) && (
              <div className="flex items-center gap-1.5 mt-1 flex-wrap text-xs">
                <span className="text-muted-foreground">Contributing to:</span>
                {linkedOrders.map((lo) => (
                  <Link
                    key={lo.orderId}
                    href={`/orders/${encodeURIComponent(lo.orderId)}`}
                    className="inline-flex items-center gap-1 rounded-sm border border-border bg-card px-2 py-0.5 hover:border-primary hover:text-primary"
                  >
                    <span className="truncate max-w-[14ch]">{lo.label}</span>
                    <span className="text-muted-foreground tabular-nums">· {lo.allocatedQuantity} pcs</span>
                  </Link>
                ))}
                {surplusPlanned > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-sm border border-border bg-muted/40 px-2 py-0.5 text-muted-foreground">
                    Surplus · {surplusPlanned} pcs
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Start production — lifts a draft batch into 'active' and
              promotes its linked pending orders to in_production without
              requiring the operator to tick the first step. Hidden once
              the batch is active/done/cancelled. */}
          {plan.status === "draft" && (
            <button
              onClick={async () => {
                if (!plan.id) return;
                try { await startProductionPlan(plan.id); } catch (e) { console.error(e); }
              }}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-sm bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:opacity-90"
              title="Mark this batch as in-progress and flip its linked orders to in production. Step ticks keep working as before."
            >
              <Play className="w-3.5 h-3.5" /> Start production
            </button>
          )}
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-1.5 rounded-sm bg-muted overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-300"
            style={{ width: `${(phaseDoneCount / PHASES.length) * 100}%` }}
          />
        </div>

        {/* Batch note */}
        {editingBatchNote ? (
          <div className="mt-3">
            <textarea
              autoFocus
              value={batchNoteInput}
              onChange={(e) => setBatchNoteInput(e.target.value)}
              onBlur={handleSaveBatchNote}
              onKeyDown={(e) => { if (e.key === "Escape") setEditingBatchNote(false); }}
              placeholder="Note for this batch…"
              rows={3}
              className="w-full rounded-sm border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
          </div>
        ) : plan.notes ? (
          <button
            onClick={() => { setBatchNoteInput(plan.notes ?? ""); setEditingBatchNote(true); }}
            className="mt-3 w-full flex items-start gap-2 text-left group"
          >
            <StickyNote className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground italic flex-1 leading-relaxed">{plan.notes}</p>
            <Pencil className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 mt-0.5" />
          </button>
        ) : (
          <button
            onClick={() => { setBatchNoteInput(""); setEditingBatchNote(true); }}
            className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <StickyNote className="w-3 h-3" /> Add batch note
          </button>
        )}

        {/* Deadline impact warning after an unmould yield short-stocks open orders */}
        {deadlineImpact && deadlineImpact.length > 0 && (
          <div className="mt-3 rounded-sm border border-status-alert-edge bg-status-alert-bg px-3 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-status-alert">
                  Yield short — {deadlineImpact.length === 1 ? "1 order" : `${deadlineImpact.length} orders`} at risk
                </p>
                <ul className="mt-1 space-y-0.5 text-[11px] text-foreground">
                  {deadlineImpact.map((issue) => (
                    <li key={issue.orderId}>
                      <span className="font-medium">{issue.orderName}</span>
                      {" · "}short {issue.shortfall}
                      {" · "}needs {issue.required} by {new Date(issue.deadline).toLocaleDateString("de-AT", { day: "numeric", month: "short" })}
                    </li>
                  ))}
                </ul>
              </div>
              <button
                onClick={() => setDeadlineImpact(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Print labels (Niimbot) */}
        {plan.status === "done" && printerEnabled && (
          <div className="mt-3">
            {printState === "error" && (
              <p className="text-xs text-destructive mb-1">{printError}</p>
            )}
            <button
              onClick={handlePrintLabels}
              disabled={printState === "printing"}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <Printer className="w-3.5 h-3.5" />
              {printState === "printing" ? "Generating…" : printState === "done" ? "Saved!" : "Save labels"}
            </button>
          </div>
        )}

      </div>


      {steps.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center px-4">
          No steps generated. Make sure the products in this plan have fillings assigned.
        </p>
      ) : (
        <>
          {/* Phase peek-card grid — 4 wide × 2 rows on most screens, 8 wide
              on lg. Compact: label on top, count + date stacked under. */}
          <div className="px-4 mt-3">
            <ul className="grid grid-cols-4 lg:grid-cols-8 gap-1.5">
              {PHASES.map(({ id, label }) => {
                const phaseSteps = steps.filter((s) => s.group === id);
                const phaseDone = phaseSteps.filter((s) => statusMap.get(s.key)).length;
                const allPhaseDone = phaseSteps.length > 0 && phaseDone === phaseSteps.length;
                const active = activePhase === id;
                const days = phaseDaysById.get(id) ?? [];
                const daysLabel = days.length === 0
                  ? null
                  : days.length === 1
                    ? new Date(days[0] + "T12:00:00").toLocaleDateString("de-AT", { day: "numeric", month: "short" })
                    : `${new Date(days[0] + "T12:00:00").toLocaleDateString("de-AT", { day: "numeric", month: "short" })} +${days.length - 1}`;
                const palette = (() => {
                  if (allPhaseDone) return { bg: "#f1faf4", ink: "#4a7a5e", bar: "#4a7a5e" };
                  if (active)       return { bg: "#eff5fb", ink: "#4b6b8f", bar: "#4b6b8f" };
                  return { bg: "rgba(245,243,239,0.7)", ink: "#1c1d1f", bar: "#bdbcc1" };
                })();
                const pct = phaseSteps.length === 0 ? 0 : Math.round((phaseDone / phaseSteps.length) * 100);
                return (
                  <li key={id}>
                    <button
                      onClick={() => setActivePhase(id)}
                      className={
                        "w-full text-left rounded-[10px] px-2 py-1.5 transition border " +
                        (active ? "border-foreground/30" : "border-transparent hover:border-foreground/10")
                      }
                      style={{ background: palette.bg, color: palette.ink }}
                    >
                      <div
                        className="leading-tight truncate"
                        style={{
                          fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 14,
                          letterSpacing: "-0.012em",
                        }}
                      >
                        {label}
                      </div>
                      <div className="text-[10px] tabular-nums opacity-75 leading-tight">
                        {phaseSteps.length > 0 ? `${phaseDone}/${phaseSteps.length}` : "—"}
                      </div>
                      {daysLabel && (
                        <div className="text-[9.5px] opacity-65 tabular-nums leading-tight">{daysLabel}</div>
                      )}
                      <div className="h-[2px] bg-white/45 rounded-sm overflow-hidden mt-1">
                        <div className="h-full" style={{ background: palette.bar, width: `${pct}%` }} />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Active phase content */}
          <div className="px-4 mt-3 pb-8 space-y-3">
            {/* Materials needed — Colour tab: on-mould steps only; Cap tab: transfer sheets + after-cap steps */}
            {((activePhase === "colour" && colouringMaterialIds.length > 0) ||
              (activePhase === "cap" && cappingMaterialIds.length > 0)) && (
              <div className="rounded-sm border border-border bg-card p-3 mb-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Materials needed for this step</p>
                <ul className="space-y-1.5">
                  {(activePhase === "colour" ? colouringMaterialIds : cappingMaterialIds).map((id) => {
                    const material = materialsMap.get(id);
                    return (
                      <li key={id} className="flex items-center gap-2.5">
                        <span
                          className="w-3.5 h-3.5 rounded-sm border border-black/10 shrink-0"
                          style={{ backgroundColor: material?.color ?? "#9ca3af" }}
                        />
                        <span className="text-sm flex-1">{material?.name ?? id}</span>
                        <LowStockFlagButton
                          flagged={material?.lowStock}
                          itemName={material?.name}
                          onFlag={() => setDecorationMaterialLowStock(id, true)}
                          size="sm"
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Scaled recipes link — shown only in the Fillings tab */}
            {activePhase === "filling" && fillingAmounts.length > 0 && (
              <Link
                href={`/production/${encodeURIComponent(planId)}/products?back=${activePhase}`}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <BookOpen className="w-4 h-4 shrink-0" />
                Scaled recipes
              </Link>
            )}

            {/* Step checklist for active phase */}
            {(() => {
              const activeSteps = steps.filter((s) => s.group === activePhase);
              if (activeSteps.length === 0) {
                return <p className="text-sm text-muted-foreground py-4 text-center">No steps for this phase.</p>;
              }

              const allDoneInPhase = activeSteps.every((s) => statusMap.get(s.key));
              const markAllBtn = (
                <div className="flex justify-end">
                  <button
                    onClick={() => handleTogglePhase(activePhase)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {allDoneInPhase ? "Unmark all" : "Mark all done"}
                  </button>
                </div>
              );

              // Shell + Cap tabs: group steps by chocolate/coating type
              if (activePhase === "shell" || activePhase === "cap") {
                const coatingOrder: string[] = [];
                const byCoating = new Map<string, typeof activeSteps>();
                for (const step of activeSteps) {
                  const c = step.coating ?? "chocolate";
                  if (!byCoating.has(c)) { byCoating.set(c, []); coatingOrder.push(c); }
                  byCoating.get(c)!.push(step);
                }
                return (
                  <div className="space-y-4">
                    {markAllBtn}
                    {coatingOrder.map((coating) => {
                      const coatingSteps = byCoating.get(coating)!;
                      const coatingMoulds = coatingSteps.reduce((s, st) => s + (st.mouldCount ?? 0), 0);
                      const seedTempering = false;
                      let temperingPanel: React.ReactNode = null;
                      if (seedTempering) {
                        // Sum total cavity weight (g) for all planProducts with this coating using manufacturer's cavityWeightG
                        const mouldsMissingWeight: string[] = [];
                        const totalCavityG = planProducts.reduce((sum, pb) => {
                          if ((productsMap.get(pb.productId)?.coating ?? "chocolate") !== coating) return sum;
                          const m = mouldsMap.get(pb.mouldId);
                          if (!m) return sum;
                          if (m.cavityWeightG == null) {
                            if (!mouldsMissingWeight.includes(m.name)) mouldsMissingWeight.push(m.name);
                            return sum;
                          }
                          return sum + pb.quantity * m.numberOfCavities * m.cavityWeightG;
                        }, 0);
                        if (mouldsMissingWeight.length > 0) {
                          temperingPanel = (
                            <div className="mt-2 mb-3 rounded-md bg-status-warn-bg border border-status-warn-edge px-3 py-2.5 text-xs text-status-warn">
                              <p className="font-semibold text-status-warn text-[10px] uppercase tracking-wide mb-1">Seeding method</p>
                              <p>Set <strong>Cavity weight (g)</strong> on {mouldsMissingWeight.join(", ")} to see chocolate amounts.</p>
                            </div>
                          );
                        } else {
                          const totalG = Math.round(totalCavityG * 1.1);
                          const meltedG = Math.round(totalG * 4 / 5);
                          const seedG = Math.round(totalG / 5);
                          const isDark = coating.toLowerCase() === "dark";
                          const silkPct = isDark ? 1 : 2;
                          const silkG = Math.round(totalG * silkPct / 100);
                          temperingPanel = (
                            <div className="mt-2 mb-3 rounded-md bg-status-warn-bg border border-status-warn-edge px-3 py-2.5 text-xs space-y-1.5">
                              <p className="font-semibold text-status-warn uppercase tracking-wide text-[10px]">Seeding method — chocolate amounts</p>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-status-warn">
                                <span className="text-muted-foreground">Total chocolate</span><span className="font-medium">{totalG} g</span>
                                <span className="text-muted-foreground">Melt (⁴⁄₅)</span><span className="font-medium">{meltedG} g</span>
                                <span className="text-muted-foreground">Seed (¹⁄₅)</span><span className="font-medium">{seedG} g</span>
                                <span className="text-muted-foreground">Silk / Mycryo ({silkPct}%)</span><span className="font-medium">{silkG} g</span>
                              </div>
                            </div>
                          );
                        }
                      }
                      const regularCapSteps = coatingSteps.filter((s) => s.subgroup !== "after_cap");
                      const afterCapSteps = coatingSteps.filter((s) => s.subgroup === "after_cap");
                      return (
                      <div key={coating}>
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 capitalize flex items-center gap-1.5">
                          {coating}
                          <span className="font-normal normal-case tracking-normal">· {coatingMoulds} mould{coatingMoulds !== 1 ? "s" : ""}</span>
                        </h3>
                        {temperingPanel}
                        <ul className="space-y-1.5">
                          {regularCapSteps.map((step) => (
                            <StepItem key={step.key} step={step} done={statusMap.get(step.key) ?? false} onToggle={handleToggle} materialsMap={materialsMap} />
                          ))}
                        </ul>
                        {afterCapSteps.length > 0 && (
                          <div className="mt-3">
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">After capping</p>
                            <ul className="space-y-1.5">
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

              return (
                <div className="space-y-3">
                  {markAllBtn}
                  <ul className="space-y-1.5">
                  {activeSteps.map((step, stepIdx) => {
                    const done = statusMap.get(step.key) ?? false;
                    const prevColors = activeSteps[stepIdx - 1]?.colors?.join(",") ?? "";
                    const curColors = step.colors?.join(",") ?? "";
                    const showSeparator = activePhase === "colour"
                      && stepIdx > 0
                      && step.colors && step.colors.length > 0
                      && curColors !== prevColors;
                    return (
                      <li key={step.key}>
                        {showSeparator && (
                          <div className="flex items-center gap-2 py-1.5 mb-1.5">
                            <div className="flex-1 h-px bg-border" />
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                              Switch to
                              {step.colors!.map((id) => {
                                const m = materialsMap.get(id);
                                return (
                                  <span
                                    key={id}
                                    className="inline-block w-2.5 h-2.5 rounded-sm border border-black/10"
                                    style={{ backgroundColor: m?.color ?? "#9ca3af" }}
                                    title={m?.name ?? id}
                                  />
                                );
                              })}
                              {step.colors!.map((id) => materialsMap.get(id)?.name ?? id).join(", ")}
                            </span>
                            <div className="flex-1 h-px bg-border" />
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
                </div>
              );
            })()}

            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reset all steps
            </button>
          </div>
        </>
      )}

      {/* Per-product notes */}
      {planProducts.length > 0 && (
        <div className="px-4 mt-2 pb-8 border-t border-border pt-4">
          <h2 className="text-sm font-semibold text-muted-foreground mb-3">Product notes</h2>
          <div className="space-y-2">
            {planProducts.map((pb) => {
              const productName = productNames.get(pb.productId) ?? "Unknown";
              const isEditing = editingProductNoteId === pb.id;
              return (
                <div key={pb.id} className="rounded-sm border border-border bg-card px-3 py-2.5">
                  <p className="text-xs font-medium text-foreground mb-1.5">{productName}</p>
                  {isEditing ? (
                    <textarea
                      autoFocus
                      value={productNoteInput}
                      onChange={(e) => setProductNoteInput(e.target.value)}
                      onBlur={() => handleSaveProductNote(pb)}
                      onKeyDown={(e) => { if (e.key === "Escape") setEditingProductNoteId(null); }}
                      placeholder="What happened with this product…"
                      rows={3}
                      className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                    />
                  ) : pb.notes ? (
                    <button
                      onClick={() => { setProductNoteInput(pb.notes ?? ""); setEditingProductNoteId(pb.id!); }}
                      className="w-full flex items-start gap-2 text-left group"
                    >
                      <p className="text-xs text-muted-foreground italic flex-1 leading-relaxed">{pb.notes}</p>
                      <Pencil className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 mt-0.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => { setProductNoteInput(""); setEditingProductNoteId(pb.id!); }}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Plus className="w-3 h-3" /> Add note
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Mark batch as done — placed at the bottom so it's reached only after reviewing all steps */}
      {plan.status !== "done" && (
        <div className="px-4 pt-4 pb-8 border-t border-border mt-2">
          {confirmMarkDone ? (
            <div className="rounded-sm border border-status-ok-edge bg-status-ok-bg px-3 py-2.5">
              <p className="text-sm font-medium text-status-ok mb-0.5">Mark entire batch as done?</p>
              <p className="text-xs text-status-ok mb-2.5">
                All {steps.length} steps will be marked complete and this batch will be closed out.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleMarkAllDone}
                  className="rounded-full bg-status-ok text-white px-3 py-1.5 text-sm font-medium"
                >
                  Yes, mark as done
                </button>
                <button
                  onClick={() => setConfirmMarkDone(false)}
                  className="rounded-sm border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmMarkDone(true)}
              className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              Mark batch as done
            </button>
          )}
        </div>
      )}

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
    </div>
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
      className={`w-full flex items-center gap-3 p-3 rounded-sm border text-left transition-colors ${
        done ? "border-status-ok-edge bg-status-ok-bg" : "border-border bg-card"
      }`}
    >
      <div className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
        done ? "bg-status-ok border-status-ok" : "border-border"
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
                className="inline-block w-3 h-3 rounded-sm border border-black/10"
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

