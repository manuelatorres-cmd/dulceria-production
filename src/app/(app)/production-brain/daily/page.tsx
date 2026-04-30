"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  useProductionPlans,
  useAllPlanProducts,
  useProductsList,
  useAllPlanStepStatuses,
  useProductionSteps,
  useProductionDays,
  useAllProductionDayLineItems,
  useTodayProductionDay,
  usePeople,
  usePersonUnavailability,
  useEquipmentInstances,
  useMachineLoads,
  useEquipment,
  useMouldPool,
  useMouldsList,
  useIngredients,
  useCampaigns,
  useProductCategories,
  useDecorationMaterials,
  useFillings,
  useProductFillingsForProducts,
  useOrders,
  useAllOrderItems,
  useAllOrderPlanLinks,
  useProductionOrders,
  useAllProductionOrderItems,
  useFillingStockItems,
  toggleStep,
  recordUnmouldIntake,
  commitAllocationSplit,
  consumeFillingStockForPlanProduct,
  adjustFillingStock,
  closeProductionDay,
} from "@/lib/hooks";
import { YieldModal, type YieldEntry } from "@/components/yield-modal";
import {
  AllocationSplitModal,
  type AllocationSplitOrderRow,
  type AllocationSplitPoRow,
  type AllocationSplitResult,
} from "@/components/allocation-split-modal";
import { Thermometer, X } from "lucide-react";
import { ProductGroupedChecklist, type ChecklistRow } from "@/components/product-grouped-checklist";
import { scheduleColorSteps, type ColorTask } from "@/lib/production";

/* ─────────────────────────────────────────────────────────────
 * Daily v2 — workshop-floor focus
 * Big "Right now" focus card, clickable peek cards for all
 * production phases, and a side rail with machines / mould pool /
 * staff / live event feed.
 * ───────────────────────────────────────────────────────────── */

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

type PhaseId = (typeof PHASES)[number]["id"];

const PHASE_TINT: Record<PhaseId, { from: string; to: string; ink: string }> = {
  polishing: { from: "#fdf8e2", to: "#fdf1e2", ink: "#8a7030" },
  colour:    { from: "#fdeeea", to: "#fdf1e2", ink: "#9b4f48" },
  shell:     { from: "#fdf8e2", to: "#fdf1e2", ink: "#8a7030" },
  filling:   { from: "#f3eef6", to: "#fdeeea", ink: "#6a4d89" },
  fill:      { from: "#eff5fb", to: "#f3eef6", ink: "#4b6b8f" },
  cap:       { from: "#eff3ec", to: "#f1faf4", ink: "#5c7050" },
  unmould:   { from: "#f1faf4", to: "#fdf8e2", ink: "#4a7a5e" },
  packing:   { from: "#fdf1e2", to: "#fdeeea", ink: "#9a6640" },
};

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const WEEKDAY_NAMES = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
] as const;

function isWorkingToday(workingDays: readonly string[] | undefined): boolean {
  if (!workingDays || workingDays.length === 0) return true; // null = always
  const name = WEEKDAY_NAMES[new Date().getDay()];
  return workingDays.includes(name);
}

export default function DailyV2Page() {
  const today = todayIso();
  const plans = useProductionPlans();
  const planProducts = useAllPlanProducts();
  const products = useProductsList(true);
  const allStatuses = useAllPlanStepStatuses();
  const steps = useProductionSteps();
  const productionDays = useProductionDays(60);
  const allLineItems = useAllProductionDayLineItems();
  const todayDay = useTodayProductionDay();
  const people = usePeople(false);
  const unavailability = usePersonUnavailability();
  const equipmentInstances = useEquipmentInstances();
  const equipment = useEquipment();
  const machineLoads = useMachineLoads();
  const mouldPool = useMouldPool();
  const moulds = useMouldsList(true);
  const ingredients = useIngredients();
  const campaigns = useCampaigns();
  const productCategories = useProductCategories(true);
  const materials = useDecorationMaterials(true);
  const fillings = useFillings(true);
  // For inline unmould flow — yield + allocation split happen on this
  // page now instead of redirecting to the wizard.
  const allOrders = useOrders();
  const allOrderItems = useAllOrderItems();
  const allOrderPlanLinks = useAllOrderPlanLinks();
  const allProductionOrders = useProductionOrders();
  const allProductionOrderItems = useAllProductionOrderItems();
  const allFillingStock = useFillingStockItems();

  // Tick clock every minute for the header.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Resolve which plans run today via productionDayLineItems linked to
  // the current ProductionDay row. Falls back to plans whose status is
  // "active" if no day exists yet (new day not opened).
  const todayDayId = todayDay?.id ?? productionDays.find((d) => d.date === today)?.id;
  const todayLineItems = useMemo(
    () => allLineItems.filter((li) => todayDayId && li.productionDayId === todayDayId),
    [allLineItems, todayDayId],
  );
  const todayPlanIds = useMemo(() => {
    const ids = new Set<string>(todayLineItems.map((li) => li.planId));
    if (ids.size === 0) {
      for (const p of plans) if (p.status === "active" && p.id) ids.add(p.id);
    }
    return ids;
  }, [todayLineItems, plans]);

  const plansById = useMemo(() => new Map(plans.map((p) => [p.id!, p])), [plans]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  // Lookup maps used by the filling-readiness helpers below — pulled
  // up here so the checklist memo (which calls those helpers) doesn't
  // hit a temporal-dead-zone ReferenceError when filling phase is
  // active. The duplicate declarations later in the file have been
  // removed.
  const mouldById = useMemo(() => new Map(moulds.map((m) => [m.id!, m])), [moulds]);
  const fillingById = useMemo(() => new Map(fillings.map((f) => [f.id!, f])), [fillings]);
  const materialById = useMemo(() => new Map(materials.map((m) => [m.id!, m])), [materials]);
  const ingredientByIdLocal = useMemo(() => new Map(ingredients.map((i) => [i.id!, i])), [ingredients]);
  void campaigns;

  const todayPlanProducts = useMemo(
    () => planProducts.filter((pp) => todayPlanIds.has(pp.planId)),
    [planProducts, todayPlanIds],
  );

  // Pull product-fillings only for products running today so the
  // PhaseDetailsPanel can render filling lists without one query per
  // product.
  const todayProductIds = useMemo(
    () => [...new Set(todayPlanProducts.map((pp) => pp.productId))],
    [todayPlanProducts],
  );
  const productFillingsByProduct = useProductFillingsForProducts(todayProductIds);

  // Phase-key from step name — same mapping the wizard uses to write
  // planStepStatus rows. A product "has" a phase only when at least
  // one ProductionStep exists for its category whose name maps here.
  function phaseKeyForStepName(name: string): PhaseId | null {
    const n = (name ?? "").toLowerCase().trim();
    if (n.includes("polish")) return "polishing";
    if (n.includes("paint") || n.includes("colour") || n.includes("color")) return "colour";
    if (n.includes("shell") || n.includes("temper")) return "shell";
    if (n.includes("filling prep") || n === "prep" || n.startsWith("prep")) return "filling";
    if (n.includes("fill")) return "fill";
    if (n.includes("cap")) return "cap";
    if (n.includes("unmould") || n.includes("unmold")) return "unmould";
    if (n.includes("pack")) return "packing";
    return null;
  }

  // ProductCategory.name → set of phases that category runs.
  // Built from ProductionStep rows whose `productType` text equals the
  // category name. A product showing up under "Painting" with no
  // matching step row was the bug: the checklist was iterating every
  // plan-product without checking the product actually does that
  // phase.
  const phasesByCategoryName = useMemo(() => {
    const m = new Map<string, Set<PhaseId>>();
    for (const s of steps) {
      const phase = phaseKeyForStepName(s.name);
      if (!phase) continue;
      const set = m.get(s.productType) ?? new Set<PhaseId>();
      set.add(phase);
      m.set(s.productType, set);
    }
    return m;
  }, [steps]);

  const categoryNameById = useMemo(
    () => new Map(productCategories.map((c) => [c.id!, c.name])),
    [productCategories],
  );

  function productHasPhase(productId: string, phase: PhaseId): boolean {
    const product = productById.get(productId);
    if (!product) return false;
    const catName = product.productCategoryId
      ? categoryNameById.get(product.productCategoryId)
      : undefined;
    if (!catName) return false;
    const phases = phasesByCategoryName.get(catName);
    return !!phases && phases.has(phase);
  }

  // Done lookup per plan.
  const doneByPlan = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const s of allStatuses) {
      if (!s.done) continue;
      const set = m.get(s.planId) ?? new Set<string>();
      set.add(s.stepKey);
      m.set(s.planId, set);
    }
    return m;
  }, [allStatuses]);

  // Prefix-aware done check. Wizard writes per-product keys like
  // `polishing-<planProductId>`; this view's PhaseId is the bare
  // phase. Match either form so a tick on /production propagates.
  // Colour phase has an extra alias — wizard's generateSteps emits
  // `color-...` (American), this page's PhaseId is "colour".
  function planPhaseDone(planId: string, phase: PhaseId): boolean {
    const set = doneByPlan.get(planId);
    if (!set) return false;
    const aliases: string[] = phase === "colour" ? ["colour", "color"] : [phase];
    for (const k of set) {
      for (const a of aliases) {
        if (k === a || k.startsWith(`${a}-`)) return true;
      }
    }
    return false;
  }

  // Per-plan-product done check. Used so individual batches inside a
  // shared plan can be marked done independently — Manuela may need
  // one of two double-caramel batches done urgently while the other
  // waits. We treat a key as matching this pp when:
  //   - it equals "phase-<ppId>" (exact pp tick)
  //   - it starts with "phase-<ppId>-" (sub-step like color step idx)
  //   - it equals the bare phase, "phase" (legacy plan-wide tick — keep
  //     for backwards compat with anything ticked before per-pp keys)
  function planProductPhaseDone(planId: string, ppId: string, phase: PhaseId): boolean {
    const set = doneByPlan.get(planId);
    if (!set) return false;
    const aliases: string[] = phase === "colour" ? ["colour", "color"] : [phase];
    for (const k of set) {
      for (const a of aliases) {
        if (k === a) return true;                              // legacy plan-wide tick
        if (k === `${a}-${ppId}`) return true;                 // exact pp tick
        if (k.startsWith(`${a}-${ppId}-`)) return true;        // pp sub-step (color idx etc)
      }
    }
    return false;
  }

  // Plan → set of phases its products run today. A plan "has" a phase
  // only when at least one of its scheduled products actually has a
  // ProductionStep for that phase. Drives both rollups and the
  // checklist filter so e.g. Toasty (no Paint step) never appears
  // under Painting.
  const phasesByPlan = useMemo(() => {
    const m = new Map<string, Set<PhaseId>>();
    for (const pp of todayPlanProducts) {
      const set = m.get(pp.planId) ?? new Set<PhaseId>();
      for (const ph of PHASES) {
        if (productHasPhase(pp.productId, ph.id)) set.add(ph.id);
      }
      m.set(pp.planId, set);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayPlanProducts, productById, categoryNameById, phasesByCategoryName]);

  // Phase rollup — for each phase, count moulds/batches done vs total.
  type PhaseRoll = { phase: PhaseId; doneBatches: number; totalBatches: number; pendingBatches: number };
  const rollups = useMemo<Record<PhaseId, PhaseRoll>>(() => {
    // Count per plan-product (each row in the checklist is one batch
    // = one pp). Two pps in the same plan with mixed state should
    // show as 1/2 done, not 0/1 or 2/2 depending on prefix-match
    // behaviour.
    const out = {} as Record<PhaseId, PhaseRoll>;
    for (const phase of PHASES) {
      let done = 0;
      let total = 0;
      for (const pp of todayPlanProducts) {
        if (!pp.id) continue;
        if (!productHasPhase(pp.productId, phase.id)) continue;
        total += 1;
        if (planProductPhaseDone(pp.planId, pp.id, phase.id)) done += 1;
      }
      out[phase.id] = { phase: phase.id, doneBatches: done, totalBatches: total, pendingBatches: total - done };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayPlanProducts, doneByPlan]);

  // Default focus = first phase that has any pending batch today.
  const defaultPhase: PhaseId = useMemo(() => {
    for (const ph of PHASES) {
      if (rollups[ph.id].pendingBatches > 0) return ph.id;
    }
    return "polishing";
  }, [rollups]);
  const [activePhase, setActivePhase] = useState<PhaseId>(defaultPhase);
  // Sync focus when default changes (first load) but keep operator's manual pick.
  const [userPicked, setUserPicked] = useState(false);
  useEffect(() => {
    if (!userPicked) setActivePhase(defaultPhase);
  }, [defaultPhase, userPicked]);

  function pickPhase(p: PhaseId) {
    setUserPicked(true);
    setActivePhase(p);
    setSelectedPlanProductId(null);
  }

  // Right-pane preview: tracks the planProductId the operator clicked
  // in the checklist. When set, the focus card splits into a 2-col
  // layout — checklist on the left, full step details for that one
  // batch on the right.
  const [selectedPlanProductId, setSelectedPlanProductId] = useState<string | null>(null);

  // ── Filling readiness (pulled up so the checklist memo can read
  //    it). Filling Prep doesn't get ticked from this page — Manuela
  //    cooks the whole batch via /plan/fillings (the weekly cook
  //    view). Treat filling as ready when every required filling for
  //    the plan's products has a fillingStock row with > 0 g left.
  // Effective filling id: collapses every versioned fork onto its
  // rootId so a productFilling pointing at v1 still finds stock that
  // was cooked against v2 (and vice versa). Without this, the
  // readiness flag stayed red even when the operator had cooked the
  // current version into stock.
  function effectiveFillingId(fillingId: string): string {
    const f = fillings.find((x) => x.id === fillingId);
    return f?.rootId ?? fillingId;
  }
  const fillingStockByFilling = useMemo(() => {
    const m = new Map<string, number>();
    for (const fs of allFillingStock) {
      const key = effectiveFillingId(fs.fillingId);
      m.set(key, (m.get(key) ?? 0) + Number(fs.remainingG ?? 0));
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFillingStock, fillings]);
  // Per-mould filling readiness. A pp.quantity > 1 means "this row
  // is N moulds". We compute per-mould need so the operator can fill
  // 1 of 2 moulds when there's only enough cooked for one — then
  // come back later when more is cooked and fill the rest.
  const FILLING_DENSITY_G_PER_ML = 1.2;
  type FillingNeed = {
    fillingId: string;
    fillingName: string;
    /** Grams to fill ONE mould's worth of this layer. */
    perMouldG: number;
    /** Grams on stock (rootId-aware). */
    haveG: number;
    /** How many moulds this layer's stock can fill on its own. */
    mouldsCoverable: number;
  };
  function fillingNeedsForPlanProduct(pp: import("@/types").PlanProduct): FillingNeed[] {
    const product = productById.get(pp.productId);
    const mould = pp.mouldId ? mouldById.get(pp.mouldId) : undefined;
    if (!product || !mould) return [];
    const shellPct = product.shellPercentage ?? 37;
    // Per-mould (one mould unit) filling grams.
    const perMouldChocolateG = mould.cavityWeightG * mould.numberOfCavities;
    const perMouldTotalFillG = perMouldChocolateG * ((100 - shellPct) / 100) * FILLING_DENSITY_G_PER_ML;
    const layers = productFillingsByProduct.get(pp.productId) ?? [];
    const out: FillingNeed[] = [];
    for (const layer of layers) {
      const fillingPct = (layer.fillPercentage ?? 100) / 100;
      const perMouldG = Math.round(perMouldTotalFillG * fillingPct * 10) / 10;
      const key = effectiveFillingId(layer.fillingId);
      const haveG = fillingStockByFilling.get(key) ?? 0;
      const filling = fillings.find((f) => f.id === layer.fillingId);
      out.push({
        fillingId: layer.fillingId,
        fillingName: filling?.name ?? layer.fillingId.slice(0, 6),
        perMouldG,
        haveG,
        mouldsCoverable: perMouldG > 0 ? Math.floor(haveG / perMouldG) : 0,
      });
    }
    return out;
  }
  /** How many moulds of this pp can be filled with current stock —
   *  bounded by the tightest layer + the pp's own mould count. */
  function mouldsFillableForPlanProduct(pp: import("@/types").PlanProduct): number {
    const needs = fillingNeedsForPlanProduct(pp);
    if (needs.length === 0) return pp.quantity;
    const tightest = Math.min(...needs.map((n) => n.mouldsCoverable));
    return Math.max(0, Math.min(pp.quantity, tightest));
  }
  /** How many moulds of this pp the operator has already filled —
   *  read from any `filling-<ppId>` step keys we've written. */
  function mouldsAlreadyFilled(pp: import("@/types").PlanProduct): number {
    const ppId = pp.id ?? `${pp.planId}-${pp.productId}`;
    const set = doneByPlan.get(pp.planId);
    if (!set) return 0;
    let max = 0;
    for (const k of set) {
      // Match `filling-<ppId>-mould-<n>` to track the highest n.
      const m = k.match(new RegExp(`^filling-${ppId}-mould-(\\d+)$`));
      if (m) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n) && n > max) max = n;
      }
      // A bare `filling-<ppId>` or plain `filling` counts as fully filled.
      if (k === `filling-${ppId}` || k === "filling") return pp.quantity;
    }
    return max;
  }
  function isFillingReadyForPlanProduct(pp: import("@/types").PlanProduct): boolean {
    const filled = mouldsAlreadyFilled(pp);
    const fillable = mouldsFillableForPlanProduct(pp);
    return filled + fillable >= pp.quantity;
  }
  /** True when the operator can tick at least ONE more mould right
   *  now (used for the green dot — partial-fill green). */
  function canFillAtLeastOneMore(pp: import("@/types").PlanProduct): boolean {
    const filled = mouldsAlreadyFilled(pp);
    if (filled >= pp.quantity) return false;
    return mouldsFillableForPlanProduct(pp) > 0;
  }
  function isFillingReadyForPlan(planId: string): boolean {
    const pps = todayPlanProducts.filter((pp) => pp.planId === planId);
    if (pps.length === 0) return true;
    return pps.every((pp) => isFillingReadyForPlanProduct(pp));
  }

  // Mould checklist for the active phase — one row per planProduct on
  // every plan that runs today AND whose product runs the active phase.
  // Click toggles the step done/undone.
  const checklist = useMemo<ChecklistRow[]>(() => {
    const rows: ChecklistRow[] = [];
    for (const pp of todayPlanProducts) {
      const plan = plansById.get(pp.planId);
      if (!plan) continue;
      if (!productHasPhase(pp.productId, activePhase)) continue;
      const doneSet = doneByPlan.get(pp.planId) ?? new Set<string>();
      const product = productById.get(pp.productId);
      const chip = (() => {
        const n = plan.name ?? "";
        const camp = n.match(/^Campaign:\s*(.+?)\s*—/i)?.[1];
        if (camp) return camp;
        if (plan.sourceOrderId) return "order";
        if (/^Restock/i.test(n) || /^PO: Replen/i.test(n)) return "restock";
        return n.split(":")[0]?.toLowerCase() ?? "batch";
      })();
      const batchNumber = plan.batchNumber ?? plan.name ?? "—";
      // Filling Prep: "done" = enough on stock for THIS specific
      // batch (rootId-aware quantity check). When green, click ticks
      // the per-product step + deducts from filling stock; when red,
      // shows a per-layer shortfall summary in the subline.
      let done = false;
      let filledSubline = `${batchNumber} · ${pp.quantity} pcs`;
      if (activePhase === "filling") {
        const filled = mouldsAlreadyFilled(pp);
        const total = pp.quantity;
        const fillable = mouldsFillableForPlanProduct(pp);
        if (filled >= total) {
          done = true;
          filledSubline = `${batchNumber} · ${pp.quantity} pcs · ✓ all ${total} mould${total === 1 ? "" : "s"} filled`;
        } else if (fillable > 0) {
          done = true; // green — at least one more mould fillable now
          const willFill = Math.min(fillable, total - filled);
          filledSubline = `${batchNumber} · filled ${filled}/${total} · enough for ${willFill} more — tap`;
        } else {
          done = false;
          const needs = fillingNeedsForPlanProduct(pp);
          const tightest = needs.length > 0
            ? needs.reduce((min, n) => n.mouldsCoverable < min.mouldsCoverable ? n : min, needs[0])
            : null;
          if (tightest) {
            filledSubline = `${batchNumber} · filled ${filled}/${total} · short on ${tightest.fillingName} (need ${Math.round(tightest.perMouldG)} have ${Math.round(tightest.haveG)} g)`;
          } else {
            filledSubline = `${batchNumber} · filled ${filled}/${total} · cook fillings first`;
          }
        }
      } else {
        // Per-plan-product check so two batches in the same plan can
        // sit at different stages — ticking polish on batch 1
        // doesn't auto-tick batch 2.
        const ppDbId = pp.id ?? `${pp.planId}-${pp.productId}`;
        done = planProductPhaseDone(pp.planId, ppDbId, activePhase);
      }
      rows.push({
        planId: pp.planId,
        planProductId: pp.id ?? `${pp.planId}-${pp.productId}`,
        productId: pp.productId,
        productName: product?.name ?? pp.productId.slice(0, 8),
        qty: pp.quantity,
        done,
        subline: filledSubline,
        chip,
      });
    }
    // Sort: pending first, then alphabetical inside each.
    return rows.sort((a, b) => {
      if (a.done !== b.done) return Number(a.done) - Number(b.done);
      return a.productName.localeCompare(b.productName);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayPlanProducts, plansById, productById, doneByPlan, activePhase, fillingStockByFilling, productFillingsByProduct]);

  // ── Inline unmould flow state. Two modals chain: YieldModal first
  //    (per-product yield/seconds/scrap), then AllocationSplitModal
  //    (split delivered yield across linked orders + PO items, pick
  //    surplus destination). Both run inline so the operator never
  //    has to leave /production-brain/daily.
  const [unmouldYield, setUnmouldYield] = useState<
    | { planId: string; entries: YieldEntry[] }
    | null
  >(null);
  const [unmouldAlloc, setUnmouldAlloc] = useState<
    | {
        planId: string;
        totalYield: number;
        orders: AllocationSplitOrderRow[];
        poItems: AllocationSplitPoRow[];
        /** plan-products that just had their yield captured — only
         *  these get their unmould-<ppId> step ticked when the alloc
         *  modal saves. Lets a 2-batch plan unmould one batch at a
         *  time without auto-ticking the other. */
        ppIds: string[];
      }
    | null
  >(null);

  function buildYieldEntries(planId: string): YieldEntry[] {
    const pps = todayPlanProducts.filter((pp) => pp.planId === planId);
    return pps.map((pp) => {
      const product = productById.get(pp.productId);
      const mould = pp.mouldId ? mouldById.get(pp.mouldId) : undefined;
      const cavities = mould?.numberOfCavities ?? 0;
      const totalProducts = pp.quantity * cavities;
      const cat = product?.productCategoryId
        ? categoryNameById.get(product.productCategoryId)
        : undefined;
      // Bonbons don't allow seconds (cosmetic flaws → tasting). Bars
      // do. Use category name as a heuristic — same rule the wizard
      // applies.
      const secondsAllowed = cat ? !/(bonbon|moulded|praline)/i.test(cat) : true;
      return {
        planProductId: pp.id ?? `${pp.planId}-${pp.productId}`,
        productName: product?.name ?? pp.productId.slice(0, 8),
        totalProducts,
        yield: totalProducts,
        seconds: 0,
        scrap: 0,
        reason: "",
        secondsAllowed,
      };
    });
  }

  function buildAllocOrderRows(planId: string): AllocationSplitOrderRow[] {
    const linksForPlan = allOrderPlanLinks.filter((l) => l.planId === planId);
    const itemById = new Map(allOrderItems.map((i) => [i.id!, i]));
    const orderById = new Map(allOrders.map((o) => [o.id!, o]));
    const rows: AllocationSplitOrderRow[] = [];
    for (const link of linksForPlan) {
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

  function buildAllocPoRows(planId: string): AllocationSplitPoRow[] {
    const plan = plansById.get(planId);
    if (!plan) return [];
    const name = plan.name ?? "";
    if (!name.startsWith("PO: ")) return [];
    const rest = name.slice("PO: ".length);
    const dash = rest.indexOf(" — ");
    const poName = dash > 0 ? rest.slice(0, dash) : rest;
    const matchingPos = allProductionOrders.filter((po) => {
      if (po.status !== "pending" && po.status !== "in_production") return false;
      return (po.name ?? "") === poName;
    });
    if (matchingPos.length === 0) return [];
    const planProductIds = new Set(
      todayPlanProducts.filter((pp) => pp.planId === planId).map((pp) => pp.productId),
    );
    const rows: AllocationSplitPoRow[] = [];
    for (const po of matchingPos) {
      const items = allProductionOrderItems.filter((it) => it.productionOrderId === po.id);
      for (const it of items) {
        if (!planProductIds.has(it.productId)) continue;
        rows.push({
          productionOrderItemId: it.id!,
          productionOrderId: po.id!,
          productId: it.productId,
          poLabel: po.name ?? "PO",
          requested: it.targetUnits,
        });
      }
    }
    return rows;
  }

  // Guard: block ticking a phase ON when an earlier phase the plan's
  // products actually run isn't done yet. Going OUT of order
  // (capping before unmoulding etc) is always a mistake — usually the
  // operator clicked the wrong row. Un-ticking (done → not done) is
  // never blocked.
  function previousPhaseGap(
    planId: string,
    ppId: string | null,
    productId: string | null,
    phase: PhaseId,
  ): { phase: PhaseId; label: string } | null {
    const idx = PHASES.findIndex((p) => p.id === phase);
    if (idx <= 0) return null;
    // Phase set: prefer per-product (so a category that doesn't run a
    // phase doesn't false-block), fall back to plan-aggregate.
    const productPhases = productId
      ? new Set<PhaseId>(PHASES.filter((p) => productHasPhase(productId, p.id)).map((p) => p.id))
      : null;
    const planPhases = phasesByPlan.get(planId);
    for (let i = 0; i < idx; i++) {
      const prev = PHASES[i];
      const inSet = productPhases ? productPhases.has(prev.id) : !!planPhases?.has(prev.id);
      if (!inSet) continue;
      // Filling prep is informational — counts as done when the
      // specific batch has enough on stock OR an explicit tick.
      if (prev.id === "filling") {
        if (ppId) {
          const pp = todayPlanProducts.find((x) => (x.id ?? `${x.planId}-${x.productId}`) === ppId);
          if (pp && isFillingReadyForPlanProduct(pp)) continue;
          if (planProductPhaseDone(planId, ppId, prev.id)) continue;
        } else if (isFillingReadyForPlan(planId)) {
          continue;
        }
        return { phase: prev.id, label: `${prev.label} (cook in weekly view first)` };
      }
      const isDone = ppId
        ? planProductPhaseDone(planId, ppId, prev.id)
        : planPhaseDone(planId, prev.id);
      if (!isDone) {
        return { phase: prev.id, label: prev.label };
      }
    }
    return null;
  }

  async function toggleRow(arg: string | ChecklistRow) {
    // Accept either a row (preferred — has planProductId) or a bare
    // planId for legacy call sites. Filling consumption needs the
    // planProductId; everything else just uses planId.
    const planId = typeof arg === "string" ? arg : arg.planId;
    const planProductId = typeof arg === "string" ? null : arg.planProductId;

    // Filling Prep: per-mould consumption. Each click fills as many
    // moulds as stock can cover (up to remaining unfilled). When all
    // moulds done, also writes the canonical `filling-<ppId>` key
    // for downstream guards.
    if (activePhase === "filling") {
      const pp = planProductId
        ? todayPlanProducts.find((x) => (x.id ?? `${x.planId}-${x.productId}`) === planProductId)
        : todayPlanProducts.find((x) => x.planId === planId);
      if (!pp) return;
      const ppDbId = pp.id ?? `${pp.planId}-${pp.productId}`;
      const fullKey = `filling-${ppDbId}`;
      const filled = mouldsAlreadyFilled(pp);
      // Already at or past full → un-tick the latest mould stamp.
      if (filled >= pp.quantity) {
        const lastKey = `filling-${ppDbId}-mould-${filled}`;
        await toggleStep(planId, lastKey, false);
        await toggleStep(planId, fullKey, false);
        return;
      }
      const fillable = mouldsFillableForPlanProduct(pp);
      const remaining = pp.quantity - filled;
      const willFill = Math.min(fillable, remaining);
      if (willFill <= 0) {
        if (confirm(
          `Not enough filling on stock for the next mould of this batch. Open the weekly cook view?`,
        )) {
          window.location.href = "/plan/fillings";
        }
        return;
      }
      const needs = fillingNeedsForPlanProduct(pp);
      const summary = needs
        .map((n) => `${n.fillingName}: ${Math.round(n.perMouldG * willFill)} g`)
        .join("\n");
      const productName = productById.get(pp.productId)?.name ?? "batch";
      if (!confirm(
        `Fill ${willFill} of ${pp.quantity} mould${pp.quantity === 1 ? "" : "s"} for ${productName}?\n\n${summary}\n\nWill deduct from filling stock.`,
      )) return;
      try {
        // Deduct directly per layer × willFill moulds. We don't call
        // consumeFillingStockForPlanProduct because that consumes
        // for the WHOLE pp (every mould). Iterate layers, take FIFO
        // from non-frozen stock.
        for (const need of needs) {
          let needLeft = Math.round(need.perMouldG * willFill * 10) / 10;
          if (needLeft <= 0) continue;
          const stockRows = allFillingStock
            .filter((s) => effectiveFillingId(s.fillingId) === effectiveFillingId(need.fillingId) && !s.frozen && Number(s.remainingG) > 0)
            .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
          for (const row of stockRows) {
            if (needLeft <= 0) break;
            const take = Math.min(Number(row.remainingG), needLeft);
            const nextRem = Math.round((Number(row.remainingG) - take) * 10) / 10;
            await adjustFillingStock(row.id!, nextRem);
            needLeft -= take;
          }
        }
        // Stamp the cumulative mould count so we know how many we've
        // filled on this pp.
        const newFilled = filled + willFill;
        await toggleStep(planId, `filling-${ppDbId}-mould-${newFilled}`, true);
        if (newFilled >= pp.quantity) {
          await toggleStep(planId, fullKey, true);
        }
      } catch (e) {
        alert(e instanceof Error ? e.message : "Filling consumption failed");
      }
      return;
    }
    // Unmould opens the inline yield + allocation flow. Other phases
    // are simple boolean toggles on planStepStatus.
    if (activePhase === "unmould") {
      // Per-plan-product unmould. Each batch row has its own ppId
      // and ticks unmould-<ppId> independently. If no ppId came in
      // (legacy bare planId) fall back to plan-wide behaviour.
      const pp = planProductId
        ? todayPlanProducts.find((x) => (x.id ?? `${x.planId}-${x.productId}`) === planProductId)
        : todayPlanProducts.find((x) => x.planId === planId);
      const ppDbId = pp?.id ?? null;
      const productIdHere = pp?.productId ?? null;
      const currentlyDone = ppDbId
        ? planProductPhaseDone(planId, ppDbId, activePhase)
        : planPhaseDone(planId, activePhase);
      if (currentlyDone) {
        const stepKey = ppDbId ? `unmould-${ppDbId}` : activePhase;
        await toggleStep(planId, stepKey, false);
        return;
      }
      const gap = previousPhaseGap(planId, ppDbId, productIdHere, activePhase);
      if (gap) {
        alert(`Can't unmould yet — "${gap.label}" isn't done for this batch.`);
        return;
      }
      const entries = ppDbId && pp
        ? buildYieldEntries(planId).filter((e) => e.planProductId === ppDbId)
        : buildYieldEntries(planId);
      if (entries.length === 0) {
        const stepKey = ppDbId ? `unmould-${ppDbId}` : activePhase;
        await toggleStep(planId, stepKey, true);
        return;
      }
      setUnmouldYield({ planId, entries });
      return;
    }
    if (activePhase === "packing") {
      window.location.href = `/production/${encodeURIComponent(planId)}`;
      return;
    }
    // Generic phase tick (polishing / colour / shell / fill / cap):
    // write per-plan-product step keys so two batches in the same
    // plan don't share state. Falls back to plan-wide tick when only
    // a planId is available (legacy / right-pane bare-id call site).
    const pp = planProductId
      ? todayPlanProducts.find((x) => (x.id ?? `${x.planId}-${x.productId}`) === planProductId)
      : null;
    const ppDbId = pp?.id ?? null;
    const productIdHere = pp?.productId ?? null;
    const currentlyDone = ppDbId
      ? planProductPhaseDone(planId, ppDbId, activePhase)
      : planPhaseDone(planId, activePhase);
    if (!currentlyDone) {
      const gap = previousPhaseGap(planId, ppDbId, productIdHere, activePhase);
      if (gap) {
        alert(`Can't tick "${activeLabel}" yet — "${gap.label}" isn't done for this batch.`);
        return;
      }
    }
    const stepKey = ppDbId ? `${activePhase}-${ppDbId}` : activePhase;
    await toggleStep(planId, stepKey, !currentlyDone);
  }

  async function applyUnmouldYield(yieldEntries: YieldEntry[]) {
    if (!unmouldYield) return;
    const planId = unmouldYield.planId;
    try {
      // Land the yield: each entry → recordUnmouldIntake (writes
      // production-storage stock + waste log for shortfall).
      let totalYield = 0;
      for (const e of yieldEntries) {
        const pp = todayPlanProducts.find((p) => (p.id ?? `${p.planId}-${p.productId}`) === e.planProductId);
        if (!pp) continue;
        const reasonParts = [
          e.seconds && e.seconds > 0 ? `${e.seconds} seconds` : null,
          e.scrap && e.scrap > 0 ? `${e.scrap} scrap` : null,
          e.reason?.trim() || null,
        ].filter(Boolean);
        await recordUnmouldIntake({
          planProductId: e.planProductId,
          productId: pp.productId,
          actualYield: e.yield,
          planned: e.totalProducts,
          reason: reasonParts.length > 0 ? reasonParts.join(" · ") : undefined,
        });
        totalYield += e.yield;
      }
      // Build allocation rows; if none (no orders/POs linked), skip
      // the split modal and tick the per-pp unmould keys immediately
      // so two batches in the same plan can settle independently.
      const orderRows = buildAllocOrderRows(planId);
      const poRows = buildAllocPoRows(planId);
      setUnmouldYield(null);
      if (orderRows.length === 0 && poRows.length === 0) {
        for (const e of yieldEntries) {
          await toggleStep(planId, `unmould-${e.planProductId}`, true);
        }
        return;
      }
      setUnmouldAlloc({
        planId,
        totalYield,
        orders: orderRows,
        poItems: poRows,
        ppIds: yieldEntries.map((e) => e.planProductId),
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Yield save failed");
      setUnmouldYield(null);
    }
  }

  async function applyUnmouldAlloc(result: AllocationSplitResult) {
    if (!unmouldAlloc) return;
    const planId = unmouldAlloc.planId;
    try {
      await commitAllocationSplit({
        planId,
        perLink: result.perLink,
        perPo: result.perPo,
        surplus: result.surplus,
        surplusDestination: result.surplusDestination,
      });
      // Tick exactly the pp(s) that just had their yield captured.
      for (const ppId of unmouldAlloc.ppIds) {
        await toggleStep(planId, `unmould-${ppId}`, true);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Allocation save failed");
    } finally {
      setUnmouldAlloc(null);
    }
  }

  const activeLabel = PHASES.find((p) => p.id === activePhase)!.label;
  const tint = PHASE_TINT[activePhase];
  const focusRoll = rollups[activePhase];

  // ── Phase-specific detail rows. For the operator working from this
  // page, each row carries the info she needs to actually do the
  // step — colours + technique on Painting, coating ingredient on
  // Shell, filling list on Filling/Fill, etc. Without this she had
  // to flip into the wizard to look up which colour goes on which
  // mould.
  // (Lookup maps moved up above the filling helpers to avoid TDZ.)

  type DetailRow = {
    key: string;
    planId: string;
    productName: string;
    batchLabel: string;
    mouldName: string;
    qty: number;
    lines: string[];   // bullet lines of the actionable info
    done: boolean;
  };
  const phaseDetails = useMemo<DetailRow[]>(() => {
    const rows: DetailRow[] = [];
    for (const pp of todayPlanProducts) {
      if (!productHasPhase(pp.productId, activePhase)) continue;
      const plan = plansById.get(pp.planId);
      const product = productById.get(pp.productId);
      if (!plan || !product) continue;
      const mould = pp.mouldId ? mouldById.get(pp.mouldId) : undefined;
      const lines: string[] = [];

      if (activePhase === "polishing") {
        lines.push(`${pp.quantity} × ${mould?.name ?? "no mould"}${mould ? ` · ${mould.numberOfCavities} cavities` : ""}`);
        lines.push("Wipe each mould clean before any colour goes on.");
      } else if (activePhase === "colour") {
        const designSteps = (product.shellDesign ?? []).filter((d) => {
          const apply = d.applyAt ?? "on_mould";
          if (apply === "after_cap") return false;
          // Transfer-sheet materials are applied at cap; skip from colour
          // listing.
          const allTransfer = (d.materialIds ?? []).every(
            (mid) => materialById.get(mid)?.type === "transfer_sheet",
          );
          if (allTransfer && (d.materialIds?.length ?? 0) > 0) return false;
          return true;
        });
        if (designSteps.length === 0) {
          lines.push("No design recorded — colour & brush plain.");
        } else {
          designSteps.forEach((d, i) => {
            const colors = (d.materialIds ?? [])
              .map((mid) => materialById.get(mid)?.name ?? mid)
              .filter(Boolean)
              .join(", ");
            const note = d.notes ? ` — ${d.notes}` : "";
            lines.push(`${i + 1}. ${d.technique || "Apply"} · ${colors || "no colour set"}${note}`);
          });
        }
      } else if (activePhase === "shell") {
        const shellName = product.shellIngredientId
          ? ingredientByIdLocal.get(product.shellIngredientId)?.name
          : product.shellFillingId
          ? fillingById.get(product.shellFillingId)?.name
          : null;
        lines.push(`Shell: ${shellName ?? "— not set —"}`);
        if (mould) lines.push(`Mould: ${pp.quantity} × ${mould.name} · ${pp.quantity * mould.numberOfCavities} pcs`);
      } else if (activePhase === "filling" || activePhase === "fill") {
        const pf = productFillingsByProduct.get(pp.productId) ?? [];
        if (pf.length === 0) {
          lines.push("No fillings recorded for this product.");
        } else {
          for (const layer of pf) {
            const fl = fillingById.get(layer.fillingId);
            const pct = layer.fillPercentage != null ? ` · ${layer.fillPercentage}%` : "";
            lines.push(`${fl?.name ?? "Filling"}${pct}`);
          }
          if (activePhase === "filling") lines.push("Cook / temper according to recipe before piping.");
        }
      } else if (activePhase === "cap") {
        const shellName = product.shellIngredientId
          ? ingredientByIdLocal.get(product.shellIngredientId)?.name
          : null;
        lines.push(`Cap chocolate: ${shellName ?? "matches shell"}`);
        if (mould) lines.push(`${pp.quantity} × ${mould.name}`);
        // Surface transfer-sheet decorations (applied at cap).
        const sheets = (product.shellDesign ?? []).filter((d) =>
          (d.materialIds ?? []).some((mid) => materialById.get(mid)?.type === "transfer_sheet"),
        );
        for (const d of sheets) {
          const names = (d.materialIds ?? [])
            .map((mid) => materialById.get(mid))
            .filter((m) => m?.type === "transfer_sheet")
            .map((m) => m!.name)
            .join(", ");
          lines.push(`Transfer sheet: ${names}`);
        }
      } else if (activePhase === "unmould") {
        if (mould) {
          lines.push(`${pp.quantity} × ${mould.name} → ${pp.quantity * mould.numberOfCavities} pcs expected`);
        } else {
          lines.push(`${pp.quantity} moulds (cavities unknown)`);
        }
        lines.push("Open the wizard to record actual yield.");
      } else if (activePhase === "packing") {
        lines.push(`${pp.actualYield ?? pp.quantity} pcs to pack`);
      }

      // Per-plan-product done check so two batches in the same plan
      // can show different states in the right pane (one ✓ done, one
      // pending).
      const ppDbId = pp.id ?? `${pp.planId}-${pp.productId}`;
      const done = planProductPhaseDone(pp.planId, ppDbId, activePhase);

      rows.push({
        key: `${pp.planId}|${ppDbId}`,
        planId: pp.planId,
        productName: product.name,
        batchLabel: plan.batchNumber ?? plan.name ?? "Batch",
        mouldName: mould?.name ?? "—",
        qty: pp.quantity,
        lines,
        done,
      });
    }
    rows.sort((a, b) => {
      if (a.done !== b.done) return Number(a.done) - Number(b.done);
      return a.productName.localeCompare(b.productName);
    });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    todayPlanProducts, activePhase, plansById, productById, mouldById,
    materialById, fillingById, ingredientByIdLocal, productFillingsByProduct,
    doneByPlan, phasesByCategoryName, categoryNameById,
  ]);

  // ── Colour worklist (paint phase only). ────────────────────────
  // Mirrors what generateSteps + scheduleColorSteps produce on
  // /production/[id], but consolidated across every batch running
  // colour today. Operator picks a colour, runs every task that
  // needs it across all moulds, then "switch to" next colour.
  type WorkRow = {
    kind: "task";
    stepKey: string;          // matches what wizard wrote — toggles sync both ways
    planId: string;
    productName: string;
    batchLabel: string;
    mouldName: string;
    technique: string;
    colors: string[];          // material ids
    notes?: string;
    qty: number;
    cavities: number;
    primaryColorId: string | null;
    done: boolean;
  };
  type SwitchRow = { kind: "switch"; toColorId: string };
  type DoneHeaderRow = { kind: "done-header"; count: number };
  type WorklistRow = WorkRow | SwitchRow | DoneHeaderRow;

  const colourWorklist = useMemo<WorklistRow[]>(() => {
    if (activePhase !== "colour") return [];
    const tasks: ColorTask[] = [];
    const taskMeta = new Map<string, {
      planId: string; productName: string; batchLabel: string;
      mouldName: string; qty: number; cavities: number;
      stepKey: string; notes?: string;
    }>();

    for (const pp of todayPlanProducts) {
      const product = productById.get(pp.productId);
      if (!product) continue;
      const plan = plansById.get(pp.planId);
      if (!plan) continue;
      // Skip products whose category has no colour phase.
      if (!productHasPhase(pp.productId, "colour")) continue;
      const mould = pp.mouldId ? mouldById.get(pp.mouldId) : undefined;
      const mouldName = mould?.name ?? "—";
      const cavities = mould?.numberOfCavities ?? 0;
      const ppId = pp.id ?? `${pp.planId}-${pp.productId}`;

      const designSteps = (product.shellDesign ?? []).filter((d) => {
        const apply = d.applyAt ?? "on_mould";
        if (apply === "after_cap") return false;
        const allTransfer = (d.materialIds ?? []).every(
          (mid) => materialById.get(mid)?.type === "transfer_sheet",
        );
        if (allTransfer && (d.materialIds?.length ?? 0) > 0) return false;
        return true;
      });

      if (designSteps.length === 0) {
        // Wildcard: fallback "Colour & brush mould" task. Wizard's
        // step key is `color-<ppId>` (no idx) for this case.
        tasks.push({
          planProductId: ppId,
          mouldId: pp.mouldId ?? "",
          stepIndex: 0,
          technique: "",
          colors: [],
          mouldName,
          mouldDetail: undefined,
          productName: product.name,
        });
        taskMeta.set(`${ppId}|0`, {
          planId: pp.planId,
          productName: product.name,
          batchLabel: plan.batchNumber ?? plan.name ?? "Batch",
          mouldName,
          qty: pp.quantity,
          cavities,
          stepKey: `color-${ppId}`,
        });
        continue;
      }

      designSteps.forEach((d, i) => {
        const filteredMats = (d.materialIds ?? []).filter(
          (mid) => materialById.get(mid)?.type !== "transfer_sheet",
        );
        tasks.push({
          planProductId: ppId,
          mouldId: pp.mouldId ?? "",
          stepIndex: i,
          technique: d.technique,
          colors: filteredMats,
          mouldName,
          productName: product.name,
          notes: d.notes,
        });
        taskMeta.set(`${ppId}|${i}`, {
          planId: pp.planId,
          productName: product.name,
          batchLabel: plan.batchNumber ?? plan.name ?? "Batch",
          mouldName,
          qty: pp.quantity,
          cavities,
          stepKey: `color-${ppId}-${i}`,
          notes: d.notes,
        });
      });
    }

    if (tasks.length === 0) return [];

    const ordered = scheduleColorSteps(tasks);

    // Walk ordered result, emit "switch to" headers when the active
    // colour group changes. Active colour for a task = the first of
    // its colors that's in scope; for wildcard tasks (no colours)
    // we keep the previously-active colour.
    //
    // Within each colour run we re-sort by productName so duplicates
    // (two batches of the same product needing the same colour)
    // surface next to each other — the operator sees "two Crunchy
    // Nougats" rather than them split apart by an unrelated row.
    const out: WorklistRow[] = [];
    let activeColorId: string | null = null;
    let currentRun: WorkRow[] = [];
    // Done tasks accumulate in a separate bucket so they all collapse
    // to a single "Done · N" section at the bottom of the worklist —
    // operator's eye stays on what's left to paint, doesn't scroll
    // past completed rows interleaved between colour groups.
    const doneBucket: WorkRow[] = [];
    function flushRun() {
      if (currentRun.length === 0) return;
      currentRun.sort((a, b) => {
        const cmp = a.productName.localeCompare(b.productName);
        if (cmp !== 0) return cmp;
        const t = a.technique.localeCompare(b.technique);
        if (t !== 0) return t;
        return a.mouldName.localeCompare(b.mouldName);
      });
      for (const r of currentRun) {
        if (r.done) doneBucket.push(r);
        else out.push(r);
      }
      currentRun = [];
    }
    for (const t of ordered) {
      const meta = taskMeta.get(`${t.planProductId}|${t.stepIndex}`);
      if (!meta) continue;
      let primary: string | null = activeColorId;
      if (t.colors.length > 0) {
        primary = t.colors.includes(activeColorId ?? "") ? activeColorId : t.colors[0];
      }
      if (primary !== activeColorId && primary !== null) {
        flushRun();
        out.push({ kind: "switch", toColorId: primary });
        activeColorId = primary;
      } else if (out.length === 0 && primary !== null) {
        out.push({ kind: "switch", toColorId: primary });
        activeColorId = primary;
      }
      const doneSet = doneByPlan.get(meta.planId) ?? new Set<string>();
      const done = doneSet.has(meta.stepKey);
      currentRun.push({
        kind: "task",
        stepKey: meta.stepKey,
        planId: meta.planId,
        productName: meta.productName,
        batchLabel: meta.batchLabel,
        mouldName: meta.mouldName,
        technique: t.technique,
        colors: t.colors,
        notes: meta.notes,
        qty: meta.qty,
        cavities: meta.cavities,
        primaryColorId: primary,
        done,
      });
    }
    flushRun();
    // Drop orphan "switch to" headers — colour runs whose only tasks
    // were already done leave a trailing switch with no rows below.
    const compacted: WorklistRow[] = [];
    for (let i = 0; i < out.length; i++) {
      const cur = out[i];
      if (cur.kind === "switch") {
        const next = out[i + 1];
        if (!next || next.kind === "switch") continue;
      }
      compacted.push(cur);
    }
    if (doneBucket.length > 0) {
      doneBucket.sort((a, b) => a.productName.localeCompare(b.productName));
      compacted.push({ kind: "done-header", count: doneBucket.length });
      for (const r of doneBucket) compacted.push(r);
    }
    return compacted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activePhase, todayPlanProducts, productById, plansById, mouldById,
    materialById, doneByPlan, phasesByCategoryName, categoryNameById,
  ]);

  // ── Mould summary per phase. Polishing + painting are mould-level
  //    operations: she polishes the whole mould pool at once, paints
  //    every cavity of a mould in one pass — not per-product. So the
  //    operator wants a flat "N × Heart Mould, M × CW2206" list, not
  //    a per-product breakdown.
  //
  //    Polishing → every today plan-product whose category has the
  //                polishing phase, grouped by mouldId.
  //    Painting  → same, but only plan-products with at least one
  //                non-transfer-sheet colour design step (no design =
  //                no paint, doesn't need a mould pre-loaded with
  //                colour).
  const mouldSummary = useMemo<Array<{ mouldId: string; mouldName: string; count: number }>>(() => {
    const grouped = new Map<string, { name: string; count: number }>();
    for (const pp of todayPlanProducts) {
      if (!pp.mouldId) continue;
      if (!productHasPhase(pp.productId, activePhase)) continue;
      if (activePhase === "colour") {
        const product = productById.get(pp.productId);
        if (!product) continue;
        const designSteps = (product.shellDesign ?? []).filter((d) => {
          const apply = d.applyAt ?? "on_mould";
          if (apply === "after_cap") return false;
          const allTransfer = (d.materialIds ?? []).every(
            (mid) => materialById.get(mid)?.type === "transfer_sheet",
          );
          if (allTransfer && (d.materialIds?.length ?? 0) > 0) return false;
          return true;
        });
        if (designSteps.length === 0) continue;
      }
      const mould = mouldById.get(pp.mouldId);
      const name = mould?.name ?? pp.mouldId;
      const cur = grouped.get(pp.mouldId) ?? { name, count: 0 };
      cur.count += pp.quantity;
      grouped.set(pp.mouldId, cur);
    }
    return [...grouped.entries()]
      .map(([mouldId, v]) => ({ mouldId, mouldName: v.name, count: v.count }))
      .sort((a, b) => b.count - a.count);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePhase, todayPlanProducts, productById, mouldById, materialById, phasesByCategoryName, categoryNameById]);

  const totalMouldsThisPhase = useMemo(
    () => mouldSummary.reduce((s, m) => s + m.count, 0),
    [mouldSummary],
  );

  // Materials needed = unique material ids across every task in the
  // worklist (excluding switch rows). Sorted by appearance in order.
  const materialsNeeded = useMemo<string[]>(() => {
    if (activePhase !== "colour") return [];
    const seen: string[] = [];
    const set = new Set<string>();
    for (const r of colourWorklist) {
      if (r.kind !== "task") continue;
      for (const c of r.colors) {
        if (set.has(c)) continue;
        set.add(c);
        seen.push(c);
      }
    }
    return seen;
  }, [colourWorklist, activePhase]);

  async function toggleColourTask(stepKey: string, planId: string, currentlyDone: boolean) {
    if (!currentlyDone) {
      // Colour worklist stepKey shape is `color-<ppId>-<idx>` or
      // `color-<ppId>` (fallback). Pull the ppId out so the gap check
      // is per-pp, not plan-wide.
      const m = stepKey.match(/^color-([^-]+(?:-[^-]+)*?)(?:-\d+)?$/);
      const ppId = m ? m[1] : null;
      const pp = ppId ? todayPlanProducts.find((x) => x.id === ppId || (x.id ?? `${x.planId}-${x.productId}`) === ppId) : null;
      const productIdHere = pp?.productId ?? null;
      const gap = previousPhaseGap(planId, ppId, productIdHere, "colour");
      if (gap) {
        alert(`Can't paint yet — "${gap.label}" isn't done for this batch.`);
        return;
      }
    }
    await toggleStep(planId, stepKey, !currentlyDone);
  }

  // ── Check-all / uncheck-all the active phase across every plan
  //    running today. Called from the focus-card header. Uses the
  //    bare phase key (matches the daily page's existing toggleRow
  //    behaviour) so the prefix-aware reads pick it up everywhere.
  const [bulkBusy, setBulkBusy] = useState(false);
  async function toggleAllForPhase() {
    // Bulk-tick is meaningless for phases with per-batch side-effects
    // (yield + allocation split for unmould, packaging consumption for
    // packing). Operator clicks each row instead.
    if (activePhase === "unmould" || activePhase === "packing") {
      alert(
        `${activeLabel} runs per batch — click each row's checkbox to capture yield and split between orders / POs / surplus.`,
      );
      return;
    }
    if (activePhase === "filling") {
      alert(
        "Filling Prep is informational here — cook the whole week's worth in /plan/fillings. The green/red badge per batch reflects whether the filling is on stock.",
      );
      return;
    }
    setBulkBusy(true);
    try {
      // Iterate per plan-product, not per plan, so two batches in
      // the same plan can sit at different stages and bulk Check All
      // ticks each independently with its own previous-phase guard.
      const ppList = todayPlanProducts.filter(
        (pp) => pp.id && productHasPhase(pp.productId, activePhase),
      );
      const allDone = ppList.every((pp) =>
        planProductPhaseDone(pp.planId, pp.id!, activePhase),
      );
      const target = !allDone;
      if (target) {
        const blocked: Array<{ ppId: string; gap: string }> = [];
        for (const pp of ppList) {
          if (planProductPhaseDone(pp.planId, pp.id!, activePhase)) continue;
          const gap = previousPhaseGap(pp.planId, pp.id!, pp.productId, activePhase);
          if (gap) blocked.push({ ppId: pp.id!, gap: gap.label });
        }
        if (blocked.length > 0) {
          alert(
            `Can't bulk-check ${activeLabel} — ${blocked.length} batch${blocked.length === 1 ? " has" : "es have"} an earlier phase still pending (e.g. ${blocked[0].gap}).\n\n` +
            `Finish those first or click each batch individually.`,
          );
          return;
        }
      }
      for (const pp of ppList) {
        const isDone = planProductPhaseDone(pp.planId, pp.id!, activePhase);
        if (isDone === target) continue;
        await toggleStep(pp.planId, `${activePhase}-${pp.id!}`, target);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Bulk toggle failed");
    } finally {
      setBulkBusy(false);
    }
  }

  // Live event feed — last 12 done step-statuses with doneAt today.
  const feed = useMemo(() => {
    const todayPrefix = today;
    const items = allStatuses
      .filter((s) => s.done && s.doneAt)
      .map((s) => ({ ...s, doneAtDate: new Date(s.doneAt as unknown as string) }))
      .filter((s) => {
        const iso = s.doneAtDate.toISOString().slice(0, 10);
        return iso === todayPrefix;
      })
      .sort((a, b) => b.doneAtDate.getTime() - a.doneAtDate.getTime())
      .slice(0, 12);
    return items.map((s) => {
      const plan = plansById.get(s.planId);
      const phase = PHASES.find((p) => s.stepKey === p.id || s.stepKey.startsWith(`${p.id}-`));
      return {
        id: s.id ?? `${s.planId}-${s.stepKey}`,
        time: s.doneAtDate.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" }),
        label: phase?.label ?? s.stepKey,
        plan: plan?.batchNumber ?? plan?.name ?? "—",
      };
    });
  }, [allStatuses, plansById, today]);

  // On-shift staff — workingDays includes today's DOW + not on
  // approved unavailability spanning today.
  const todayMs = new Date(`${today}T12:00:00`).getTime();
  const offToday = new Set(
    unavailability
      .filter((u) => {
        const from = new Date(u.startDate).getTime();
        const to = new Date(u.endDate).getTime();
        return u.approved !== false && from <= todayMs && todayMs <= to;
      })
      .map((u) => u.personId),
  );
  const staff = people
    .filter((p) => !p.archived)
    .map((p) => ({ ...p, off: offToday.has(p.id!) || !isWorkingToday(p.workingDays) }))
    .sort((a, b) => Number(a.off) - Number(b.off));

  // Workshop floor: temper machines (ones with capacityKg). Loads
  // currently in use show the chocolate ingredient + remaining kg.
  const equipmentById = new Map(equipment.map((e) => [e.id!, e]));
  const ingredientById = new Map(ingredients.map((i) => [i.id!, i]));
  const loadsByInstance = new Map<string, typeof machineLoads[number]>();
  for (const l of machineLoads) {
    if (l.status === "in_use") loadsByInstance.set(l.equipmentInstanceId, l);
  }
  const tempering = equipmentInstances
    .filter((inst) => {
      const eq = equipmentById.get(inst.equipmentId);
      return eq?.kind === "tempering" || (inst.capacityKg ?? 0) > 0;
    })
    .filter((inst) => !inst.archived)
    .slice(0, 6);

  // Mould pool dots — first 60 instances. Counts grouped by state.
  const dots = mouldPool.slice(0, 60);
  const dotCounts = (() => {
    const c = { available: 0, busy: 0, sealed: 0, wash: 0, broken: 0 };
    for (const m of mouldPool) {
      const s = m.currentState;
      if (s === "available") c.available++;
      else if (s === "loaded" || s === "filled") c.busy++;
      else if (s === "sealed") c.sealed++;
      else if (s === "needs-wash" || s === "in-deep-wash") c.wash++;
      else if (s === "broken" || s === "retired") c.broken++;
    }
    return c;
  })();
  void moulds; // referenced for future per-instance lookup

  const [tempOpen, setTempOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  async function handleClose() {
    if (!confirm("Close production for today? Unfinished steps roll forward to the next regenerate.")) return;
    setClosing(true);
    try {
      await closeProductionDay();
    } catch (err) {
      alert(`Close failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setClosing(false);
    }
  }

  return (
    <div className="px-2 sm:px-4 pt-4 pb-10">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <h1
          className="text-[28px] tracking-tight"
          style={{ fontFamily: "var(--font-serif)", fontWeight: 400, letterSpacing: "-0.02em" }}
        >
          Daily
        </h1>
        <span
          className="text-muted-foreground text-[20px]"
          style={{ fontFamily: "var(--font-serif)", letterSpacing: "-0.015em" }}
        >
          {now.toLocaleDateString("de-AT", { weekday: "short", day: "numeric", month: "short" })} · {now.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" })}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/production-brain/haccp"
            className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted inline-flex items-center gap-1.5"
          >
            <Thermometer className="w-3.5 h-3.5" /> Log temperatures
          </Link>
          <button
            onClick={handleClose}
            disabled={closing}
            className="rounded-full px-3 py-1.5 text-xs font-medium border border-blush-border bg-blush-bg text-blush-ink hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <X className="w-3.5 h-3.5" /> {closing ? "Closing…" : "Close production day"}
          </button>
        </div>
      </div>

      {/* Horizontal step progress bar — every phase as a tinted
          segment showing done / pending counts so the workshop
          floor sees the day's shape at a glance. Click to focus. */}
      <div className="flex gap-1 mb-4 overflow-x-auto">
        {PHASES.map((ph) => {
          const r = rollups[ph.id];
          const phTint = PHASE_TINT[ph.id];
          const isActive = activePhase === ph.id;
          const total = r.totalBatches;
          const done = r.doneBatches;
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
          return (
            <button
              key={ph.id}
              onClick={() => pickPhase(ph.id)}
              className={
                "flex-1 min-w-[90px] text-left rounded-[10px] px-2 py-1.5 transition border " +
                (isActive ? "border-foreground" : "border-transparent hover:border-foreground/20")
              }
              style={{
                background: `linear-gradient(180deg, ${phTint.from}, ${phTint.to})`,
                color: phTint.ink,
              }}
            >
              <div className="flex items-baseline justify-between gap-1">
                <span className="text-[10.5px] font-medium uppercase truncate" style={{ letterSpacing: "0.06em" }}>
                  {ph.label}
                </span>
                <span className="text-[10.5px] tabular-nums opacity-75">
                  {done}/{total}
                </span>
              </div>
              <div className="h-[3px] mt-1 rounded-sm overflow-hidden" style={{ background: "rgba(0,0,0,0.06)" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: phTint.ink }} />
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        {/* LEFT */}
        <div className="space-y-3">
          {/* Right now focus card */}
          <div
            className="rounded-[24px] p-5 sm:p-6 shadow-[0_4px_24px_rgba(138,112,48,0.12)]"
            style={{
              background: `linear-gradient(135deg, ${tint.from}, ${tint.to})`,
              color: tint.ink,
            }}
          >
            <p
              className="text-[11px] font-semibold uppercase opacity-80 mb-1"
              style={{ letterSpacing: "0.1em" }}
            >
              Right now · in progress
            </p>
            <h2
              className="font-serif"
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: 42,
                fontWeight: 500,
                letterSpacing: "-0.03em",
                lineHeight: 1,
                marginBottom: 10,
              }}
            >
              {activeLabel}
            </h2>
            <div className="flex gap-4 text-[13px] opacity-85 mb-3 flex-wrap items-baseline">
              <span><b>{focusRoll.doneBatches} / {focusRoll.totalBatches}</b> batches done</span>
              <span><b>{focusRoll.pendingBatches}</b> pending</span>
              {focusRoll.totalBatches > 0 && (() => {
                const allDone = focusRoll.doneBatches === focusRoll.totalBatches;
                return (
                  <button
                    type="button"
                    onClick={toggleAllForPhase}
                    disabled={bulkBusy}
                    className="ml-auto text-[11.5px] px-3 py-1 rounded-full transition disabled:opacity-50"
                    style={{
                      background: allDone ? "rgba(255,255,255,0.6)" : tint.ink,
                      color: allDone ? tint.ink : "#fff",
                      border: allDone ? `1px solid ${tint.ink}` : "none",
                    }}
                    title={allDone ? "Uncheck every batch in this phase" : "Mark every batch in this phase done"}
                  >
                    {bulkBusy ? "…" : allDone ? "Uncheck all" : "Check all"}
                  </button>
                );
              })()}
            </div>
            <div className="h-2 bg-white/50 rounded-md overflow-hidden mb-4">
              <div
                className="h-full"
                style={{
                  background: tint.ink,
                  width: focusRoll.totalBatches === 0
                    ? "0%"
                    : `${Math.round((focusRoll.doneBatches / focusRoll.totalBatches) * 100)}%`,
                }}
              />
            </div>

            {/* 2-column layout — checklist on the left, full step
                detail for the selected batch on the right. Without a
                selection the right pane prompts the operator to pick
                one. */}
            {checklist.length === 0 ? (
              <p className="text-sm italic opacity-75">
                No batches scheduled for {activeLabel.toLowerCase()} today.
              </p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                <div>
                  <ProductGroupedChecklist
                    rows={checklist}
                    tintInk={tint.ink}
                    onToggle={toggleRow}
                    selectedPlanProductId={selectedPlanProductId ?? undefined}
                    onSelect={(row) => {
                      setSelectedPlanProductId((cur) => cur === row.planProductId ? null : row.planProductId);
                    }}
                    infoOnly={activePhase === "filling"}
                    doneLabel="filling ready"
                    notDoneLabel="cook in weekly"
                  />
                </div>
                <div
                  className="rounded-[14px] p-3 sm:p-4"
                  style={{ background: "rgba(255,255,255,0.6)", color: tint.ink, minHeight: 180 }}
                >
                  {/* Colour phase: show consolidated worklist instead of
                      a per-batch detail. Mirrors the old app — every
                      paint task across every batch grouped by
                      "SWITCH TO <colour>" so the operator paints all
                      reds, then all whites, etc., minimising swaps. */}
                  {activePhase === "colour" ? (
                    colourWorklist.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-center px-2 py-8">
                        <p className="text-[13px] opacity-70 max-w-[260px]">
                          No paint tasks scheduled for any batch today.
                        </p>
                      </div>
                    ) : (
                      <div>
                        {/* Moulds to paint summary */}
                        {mouldSummary.length > 0 && (
                          <div className="mb-3">
                            <p
                              className="text-[10px] uppercase opacity-60 mb-1.5"
                              style={{ letterSpacing: "0.1em" }}
                            >
                              Moulds to paint · {totalMouldsThisPhase} total
                            </p>
                            <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[12.5px]" style={{ color: "#1c1d1f" }}>
                              {mouldSummary.map((m) => (
                                <li key={m.mouldId} className="flex items-baseline justify-between gap-2">
                                  <span className="truncate">{m.mouldName}</span>
                                  <span className="tabular-nums opacity-70">{m.count}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {/* Materials needed list */}
                        <div className="mb-3">
                          <p
                            className="text-[10px] uppercase opacity-60 mb-1.5"
                            style={{ letterSpacing: "0.1em" }}
                          >
                            Materials needed for this step
                          </p>
                          <ul className="space-y-1">
                            {materialsNeeded.map((mid) => {
                              const mat = materialById.get(mid);
                              return (
                                <li key={mid} className="flex items-center gap-2 text-[12.5px]">
                                  <span
                                    className="inline-block rounded-full"
                                    style={{
                                      width: 12, height: 12,
                                      background: mat?.color ?? "#ddd",
                                      border: "1px solid rgba(0,0,0,0.12)",
                                    }}
                                  />
                                  <span style={{ color: "#1c1d1f" }}>{mat?.name ?? mid}</span>
                                  {mat?.lowStock && (
                                    <span className="text-[9.5px] uppercase opacity-70">low</span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                        {/* Worklist with switch dividers */}
                        <ol className="space-y-1.5" style={{ listStyle: "none", padding: 0 }}>
                          {colourWorklist.map((row, idx) => {
                            if (row.kind === "done-header") {
                              return (
                                <li
                                  key={`done-header-${idx}`}
                                  className="flex items-center gap-2 mt-4 mb-1"
                                >
                                  <span className="flex-1 h-px" style={{ background: "rgba(74,122,94,0.25)" }} />
                                  <span
                                    className="text-[10.5px] uppercase tracking-wider"
                                    style={{ letterSpacing: "0.1em", color: "#4a7a5e", opacity: 0.85 }}
                                  >
                                    Done · {row.count}
                                  </span>
                                  <span className="flex-1 h-px" style={{ background: "rgba(74,122,94,0.25)" }} />
                                </li>
                              );
                            }
                            if (row.kind === "switch") {
                              const mat = materialById.get(row.toColorId);
                              return (
                                <li
                                  key={`switch-${idx}`}
                                  className="flex items-center gap-2 my-2"
                                >
                                  <span className="flex-1 h-px" style={{ background: "rgba(0,0,0,0.12)" }} />
                                  <span
                                    className="text-[10.5px] uppercase tracking-wider flex items-center gap-1.5"
                                    style={{ letterSpacing: "0.1em", color: "#1c1d1f", opacity: 0.7 }}
                                  >
                                    Switch to
                                    <span
                                      className="inline-block rounded-full"
                                      style={{
                                        width: 10, height: 10,
                                        background: mat?.color ?? "#ddd",
                                        border: "1px solid rgba(0,0,0,0.12)",
                                      }}
                                    />
                                    <span style={{ color: "#1c1d1f" }}>{mat?.name ?? row.toColorId}</span>
                                  </span>
                                  <span className="flex-1 h-px" style={{ background: "rgba(0,0,0,0.12)" }} />
                                </li>
                              );
                            }
                            return (
                              <li
                                key={`task-${idx}-${row.stepKey}`}
                                className="rounded-[10px] px-3 py-2 cursor-pointer hover:opacity-95 transition flex items-start gap-2.5"
                                style={{
                                  background: "rgba(255,255,255,0.85)",
                                  opacity: row.done ? 0.5 : 1,
                                  textDecoration: row.done ? "line-through" : undefined,
                                }}
                                onClick={async () => {
                                  await toggleColourTask(row.stepKey, row.planId, row.done);
                                }}
                              >
                                <span
                                  className="mt-1 inline-block rounded-sm flex-shrink-0"
                                  style={{
                                    width: 14, height: 14,
                                    background: row.done ? "#4a7a5e" : "transparent",
                                    border: row.done ? "1px solid #4a7a5e" : "1.5px solid rgba(0,0,0,0.4)",
                                  }}
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="text-[13px]" style={{ color: "#1c1d1f", fontWeight: 500 }}>
                                    {row.technique || "Colour & brush mould"}: {row.mouldName}
                                    <span className="opacity-70 font-normal"> ({row.productName})</span>
                                  </div>
                                  <div className="text-[10.5px] opacity-75 mt-0.5" style={{ color: "#1c1d1f" }}>
                                    {row.qty} × {row.cavities} cavities = {row.qty * row.cavities} products
                                    {row.colors.length > 0 && (
                                      <>
                                        <span className="mx-1">·</span>
                                        {row.colors.map((mid, i) => {
                                          const mat = materialById.get(mid);
                                          return (
                                            <span key={mid} className="inline-flex items-center gap-1 mr-1.5">
                                              <span
                                                className="inline-block rounded-full"
                                                style={{
                                                  width: 8, height: 8,
                                                  background: mat?.color ?? "#ddd",
                                                  border: "1px solid rgba(0,0,0,0.12)",
                                                }}
                                              />
                                              {mat?.name ?? mid}
                                              {i < row.colors.length - 1 ? "," : ""}
                                            </span>
                                          );
                                        })}
                                      </>
                                    )}
                                    {row.notes && (
                                      <span className="opacity-80"> · {row.notes}</span>
                                    )}
                                  </div>
                                  <div className="text-[10px] opacity-55 mt-0.5" style={{ color: "#1c1d1f" }}>
                                    {row.batchLabel}
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                    )
                  ) : (() => {
                    const sel = selectedPlanProductId
                      ? phaseDetails.find((d) => d.key.endsWith(`|${selectedPlanProductId}`))
                      : null;
                    // Mould-level summary at the top of the right pane
                    // for every phase except colour (colour has its own
                    // worklist branch above with the same summary).
                    // The operator runs each phase per mould type, not
                    // per product, so the consolidated count is the
                    // useful surface.
                    const mouldSummaryBlock = mouldSummary.length > 0 ? (
                      <div className="mb-3">
                        <p
                          className="text-[10px] uppercase opacity-60 mb-1.5"
                          style={{ letterSpacing: "0.1em" }}
                        >
                          Moulds for {activeLabel.toLowerCase()} · {totalMouldsThisPhase} total
                        </p>
                        <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[12.5px]" style={{ color: "#1c1d1f" }}>
                          {mouldSummary.map((m) => (
                            <li key={m.mouldId} className="flex items-baseline justify-between gap-2">
                              <span className="truncate">{m.mouldName}</span>
                              <span className="tabular-nums opacity-70">{m.count}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null;
                    if (!sel) {
                      return (
                        <div className="h-full flex flex-col">
                          {mouldSummaryBlock}
                          <div className="flex-1 flex items-center justify-center text-center px-2 py-8">
                            <p className="text-[13px] opacity-70 max-w-[260px]">
                              Click a batch on the left to see its {activeLabel.toLowerCase()} steps — colours, mould, filling, whatever applies to this phase.
                            </p>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div>
                        {mouldSummaryBlock}
                        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
                          <div>
                            <h3
                              style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 22, letterSpacing: "-0.012em" }}
                            >
                              {sel.productName}
                            </h3>
                            <p className="text-[11.5px] opacity-70 mt-0.5" style={{ fontFamily: "system-ui" }}>
                              {sel.batchLabel} · {sel.qty} × {sel.mouldName}
                            </p>
                          </div>
                          {activePhase === "filling" ? (
                            // Filling Prep is read-only — readiness
                            // comes from filling stock. Show a status
                            // pill instead of a Mark-done button.
                            (() => {
                              const ready = isFillingReadyForPlan(sel.planId);
                              return (
                                <span
                                  className="text-[11.5px] px-3 py-1.5 rounded-full inline-flex items-center gap-1.5"
                                  style={{
                                    background: ready ? "rgba(74,122,94,0.15)" : "rgba(155,79,72,0.15)",
                                    color: ready ? "#4a7a5e" : "#9b4f48",
                                  }}
                                >
                                  <span
                                    className="inline-block rounded-full"
                                    style={{ width: 8, height: 8, background: ready ? "#4a7a5e" : "#9b4f48" }}
                                  />
                                  {ready ? "Filling ready" : "Cook in /plan/fillings"}
                                </span>
                              );
                            })()
                          ) : (
                            <button
                              type="button"
                              onClick={async () => {
                                // Build a ChecklistRow stub so toggleRow
                                // routes through the per-pp path. Pull
                                // ppId from sel.key (`<planId>|<ppId>`).
                                const parts = sel.key.split("|");
                                const ppId = parts[1] ?? "";
                                const pp = todayPlanProducts.find(
                                  (x) => (x.id ?? `${x.planId}-${x.productId}`) === ppId,
                                );
                                await toggleRow({
                                  planId: sel.planId,
                                  planProductId: ppId,
                                  productId: pp?.productId ?? "",
                                  productName: sel.productName,
                                  qty: sel.qty,
                                  done: sel.done,
                                });
                              }}
                              className="text-[11.5px] px-3 py-1.5 rounded-full"
                              style={{
                                background: sel.done ? "rgba(74,122,94,0.15)" : tint.ink,
                                color: sel.done ? "#4a7a5e" : "#fff",
                              }}
                            >
                              {sel.done ? "✓ done — undo" : `Mark ${activeLabel.toLowerCase()} done`}
                            </button>
                          )}
                        </div>
                        <p className="text-[10px] uppercase opacity-60 mb-1.5" style={{ letterSpacing: "0.1em" }}>
                          {activeLabel} steps
                        </p>
                        {sel.lines.length === 0 ? (
                          <p className="text-[12px] italic opacity-70">No detail recorded for this phase.</p>
                        ) : (
                          <ol className="space-y-1.5 text-[13px]" style={{ listStyle: "none", padding: 0 }}>
                            {sel.lines.map((ln, i) => (
                              <li
                                key={i}
                                className="rounded-[8px] px-3 py-2"
                                style={{ background: "rgba(255,255,255,0.85)" }}
                              >
                                {ln}
                              </li>
                            ))}
                          </ol>
                        )}
                        <Link
                          href={`/production/${encodeURIComponent(sel.planId)}`}
                          className="inline-block mt-3 text-[11.5px] underline opacity-75 hover:opacity-100"
                        >
                          → open full wizard
                        </Link>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>

          {/* Phase peek-card grid — compact, click to focus. */}
          <section className="rounded-[14px] bg-white/65 backdrop-blur-2xl border border-white/60 p-2">
            <ul className="grid grid-cols-4 lg:grid-cols-8 gap-1.5">
              {PHASES.map((ph) => {
                const r = rollups[ph.id];
                const pct = r.totalBatches === 0 ? 0 : Math.round((r.doneBatches / r.totalBatches) * 100);
                const status: "done" | "active" | "todo" =
                  r.totalBatches > 0 && r.doneBatches === r.totalBatches
                    ? "done"
                    : ph.id === activePhase
                    ? "active"
                    : "todo";
                const palette = (() => {
                  if (status === "done") return { bg: "#f1faf4", ink: "#4a7a5e", bar: "#4a7a5e" };
                  if (status === "active") return { bg: "#eff5fb", ink: "#4b6b8f", bar: "#4b6b8f" };
                  return { bg: "rgba(245,243,239,0.7)", ink: "#1c1d1f", bar: "#bdbcc1" };
                })();
                return (
                  <li key={ph.id}>
                    <button
                      onClick={() => pickPhase(ph.id)}
                      className={
                        "w-full text-left rounded-[10px] px-2 py-1.5 transition border " +
                        (ph.id === activePhase ? "border-foreground/30" : "border-transparent hover:border-foreground/10")
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
                        {ph.label}
                      </div>
                      <div className="text-[10px] tabular-nums opacity-75 leading-tight">
                        {r.doneBatches}/{r.totalBatches}
                      </div>
                      <div className="h-[2px] bg-white/45 rounded-sm overflow-hidden mt-1">
                        <div className="h-full" style={{ background: palette.bar, width: `${pct}%` }} />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        {/* RIGHT rail */}
        <aside className="space-y-3">
          <div className="rounded-[18px] bg-white/65 backdrop-blur-2xl border border-white/60 p-4">
            <p
              className="text-[10px] font-semibold uppercase text-muted-foreground mb-2.5"
              style={{ letterSpacing: "0.08em" }}
            >
              Workshop floor
            </p>
            {tempering.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No machines configured.</p>
            ) : (
              <ul className="space-y-2">
                {tempering.map((inst) => {
                  const load = loadsByInstance.get(inst.id!);
                  const ing = load ? ingredientById.get(load.ingredientId) : undefined;
                  const dotColor = !load
                    ? "#bdbcc1"
                    : inst.status === "running"
                    ? "#4a7a5e"
                    : "#8a7030";
                  const fillPct = load && load.loadedQuantityG > 0
                    ? Math.round((load.remainingQuantityG / load.loadedQuantityG) * 100)
                    : 0;
                  return (
                    <li key={inst.id} className="rounded-[12px] bg-white/50 px-3 py-2.5">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: dotColor }} />
                        <span className="text-[12px] font-medium flex-1 truncate">{inst.name}</span>
                        <span className="text-[11px] text-muted-foreground capitalize">{inst.status}</span>
                      </div>
                      {load && ing ? (
                        <>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {ing.name} · {(load.remainingQuantityG / 1000).toFixed(1)} kg
                          </div>
                          <div className="h-[3px] bg-foreground/10 rounded-sm overflow-hidden mt-1">
                            <div className="h-full" style={{ background: "#5a3522", width: `${fillPct}%` }} />
                          </div>
                        </>
                      ) : (
                        <div className="text-[11px] text-muted-foreground italic">empty</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="rounded-[18px] bg-white/65 backdrop-blur-2xl border border-white/60 p-4">
            <p
              className="text-[10px] font-semibold uppercase text-muted-foreground mb-1.5"
              style={{ letterSpacing: "0.08em" }}
            >
              Mould pool · {mouldPool.length}
            </p>
            <p className="text-[11px] text-muted-foreground mb-2">
              {dotCounts.available} free · {dotCounts.busy} busy · {dotCounts.sealed} sealed · {dotCounts.wash} wash
              {dotCounts.broken > 0 ? ` · ${dotCounts.broken} out` : ""}
            </p>
            <div className="grid gap-[2px]" style={{ gridTemplateColumns: "repeat(20, 1fr)" }}>
              {dots.map((m, i) => {
                const c = (() => {
                  switch (m.currentState) {
                    case "available": return "#f1faf4";
                    case "loaded":
                    case "filled": return "#fdf8e2";
                    case "sealed": return "#eff5fb";
                    case "needs-wash":
                    case "in-deep-wash": return "#fdeeea";
                    default: return "rgba(28,29,31,0.08)";
                  }
                })();
                return <span key={m.id ?? i} className="aspect-square rounded-sm" style={{ background: c }} />;
              })}
            </div>
          </div>

          <div className="rounded-[18px] bg-white/65 backdrop-blur-2xl border border-white/60 p-4">
            <p
              className="text-[10px] font-semibold uppercase text-muted-foreground mb-1.5"
              style={{ letterSpacing: "0.08em" }}
            >
              On shift
            </p>
            {staff.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No staff configured.</p>
            ) : (
              <ul>
                {staff.map((p) => (
                  <li
                    key={p.id}
                    className={
                      "flex items-center gap-2.5 py-2 border-b border-border last:border-b-0 " +
                      (p.off ? "opacity-50" : "")
                    }
                  >
                    <span
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-semibold flex-shrink-0"
                      style={{ background: "#fdf1e2", color: "#9a6640" }}
                    >
                      {p.name?.[0]?.toUpperCase() ?? "?"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] font-medium truncate">{p.name}</div>
                      <div className="text-[10.5px] text-muted-foreground truncate">
                        {p.off ? "Off today" : `${p.defaultHoursPerDay ?? 8}h day · ${(p.roles?.[0]) ?? p.primaryRole ?? "production"}`}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-[18px] bg-white/65 backdrop-blur-2xl border border-white/60 p-4">
            <p
              className="text-[10px] font-semibold uppercase text-muted-foreground mb-1.5"
              style={{ letterSpacing: "0.08em" }}
            >
              Live event feed
            </p>
            {feed.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No events logged yet today.</p>
            ) : (
              <ul>
                {feed.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center gap-2.5 py-1.5 border-b border-border last:border-b-0 text-[11.5px]"
                  >
                    <span className="w-10 text-[10px] text-muted-foreground tabular-nums flex-shrink-0">
                      {f.time}
                    </span>
                    <span
                      className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] flex-shrink-0"
                      style={{ background: "#f1faf4", color: "#4a7a5e" }}
                    >
                      ✓
                    </span>
                    <span className="flex-1 min-w-0 truncate">
                      <b className="font-medium">{f.label}</b>
                      <span className="text-muted-foreground"> · {f.plan}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      {tempOpen && null /* reserved */}

      {/* Inline unmould flow — yield first, then allocation split. */}
      {unmouldYield && (
        <YieldModal
          entries={unmouldYield.entries}
          mode={unmouldYield.entries.length === 1 ? "single" : "batch"}
          onConfirm={(e) => applyUnmouldYield(e)}
          onCancel={() => setUnmouldYield(null)}
        />
      )}
      {unmouldAlloc && (
        <AllocationSplitModal
          totalYield={unmouldAlloc.totalYield}
          orders={unmouldAlloc.orders}
          poItems={unmouldAlloc.poItems}
          onConfirm={applyUnmouldAlloc}
          onCancel={() => setUnmouldAlloc(null)}
        />
      )}
    </div>
  );
}
