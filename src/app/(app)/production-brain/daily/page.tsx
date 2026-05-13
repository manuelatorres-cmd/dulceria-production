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
  useStaffShifts,
  toggleStep,
  recordUnmouldIntake,
  commitAllocationSplit,
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
import {
  IconTemperature as Thermometer,
  IconX as X,
  IconChevronDown,
  IconChevronRight,
  IconCheck,
} from "@tabler/icons-react";
import { PlanTabs } from "@/components/plan-tabs";
import { Section, ListRow, DsButton, DsDrawer } from "@/components/dulceria";

/* ─────────────────────────────────────────────────────────────
 * Daily — workshop floor view (Phase D refit)
 * Two-column layout. Left: Right-now focus + Phase cards.
 * Right: Machines / Mould pool / Staff / Event feed.
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

// Phase left-border colour. Spec Phase C.3 / D.2 mapping.
const PHASE_COLOR: Record<PhaseId, string> = {
  polishing: "var(--accent-butter-ink)",
  colour:    "var(--accent-blush-ink)",
  shell:     "var(--accent-butter-ink)",
  filling:   "var(--accent-lilac-ink)",   // lavender — no --ds-semantic-lavender token
  fill:      "var(--ds-semantic-info)",
  cap:       "var(--ds-tier-positive)",
  unmould:   "var(--accent-mint-ink)",
  packing:   "var(--accent-cocoa-ink)",   // caramel — closest to spec
};

const CARAMEL = "var(--accent-cocoa-ink)";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const WEEKDAY_NAMES = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
] as const;

function isWorkingToday(workingDays: readonly string[] | undefined): boolean {
  if (!workingDays || workingDays.length === 0) return true;
  const name = WEEKDAY_NAMES[new Date().getDay()];
  return workingDays.includes(name);
}

export default function DailyV2Page() {
  const today = todayIso();
  const [viewDate, setViewDate] = useState<string>(today);
  const isViewingToday = viewDate === today;

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
  const allOrders = useOrders();
  const allOrderItems = useAllOrderItems();
  const allOrderPlanLinks = useAllOrderPlanLinks();
  const allProductionOrders = useProductionOrders();
  const allProductionOrderItems = useAllProductionOrderItems();
  const allFillingStock = useFillingStockItems();
  const staffShiftsToday = useStaffShifts(undefined, today, today);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Day-id for viewed date — drives line-item filter.
  const todayDayId = isViewingToday
    ? (todayDay?.id ?? productionDays.find((d) => d.date === viewDate)?.id)
    : productionDays.find((d) => d.date === viewDate)?.id;
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
  const mouldById = useMemo(() => new Map(moulds.map((m) => [m.id!, m])), [moulds]);
  const fillingById = useMemo(() => new Map(fillings.map((f) => [f.id!, f])), [fillings]);
  const materialById = useMemo(() => new Map(materials.map((m) => [m.id!, m])), [materials]);
  const ingredientByIdLocal = useMemo(() => new Map(ingredients.map((i) => [i.id!, i])), [ingredients]);
  const personById = useMemo(() => new Map(people.map((p) => [p.id!, p])), [people]);
  void campaigns;

  // Plan → source tokens (campaign/po/order) for the filter dropdown.
  const planSourcesByPlan = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const plan of plans) {
      if (!plan.id) continue;
      const tokens = new Set<string>();
      const name = plan.name ?? "";
      const camp = name.match(/^Campaign:\s+(.+?)\s+—\s/);
      const po = name.match(/^PO:\s+(.+?)\s+—\s/);
      if (camp) tokens.add(`campaign:${camp[1]}`);
      else if (po) tokens.add(`po:${po[1]}`);
      m.set(plan.id, tokens);
    }
    const itemById = new Map(allOrderItems.map((i) => [i.id!, i]));
    for (const link of allOrderPlanLinks) {
      const item = itemById.get(link.orderItemId);
      if (!item) continue;
      const set = m.get(link.planId) ?? new Set<string>();
      set.add(`order:${item.orderId}`);
      m.set(link.planId, set);
    }
    return m;
  }, [plans, allOrderItems, allOrderPlanLinks]);

  const [sourceFilter, setSourceFilter] = useState<Set<string>>(() => new Set());
  const [filterOpen, setFilterOpen] = useState(false);

  const todayPlanProducts = useMemo(() => {
    let pps = planProducts.filter((pp) => todayPlanIds.has(pp.planId));
    if (sourceFilter.size > 0) {
      pps = pps.filter((pp) => {
        const tokens = planSourcesByPlan.get(pp.planId);
        if (!tokens) return false;
        for (const t of sourceFilter) if (tokens.has(t)) return true;
        return false;
      });
    }
    return pps;
  }, [planProducts, todayPlanIds, sourceFilter, planSourcesByPlan]);

  function toggleSourceFilter(token: string) {
    setSourceFilter((prev) => {
      const next = new Set(prev);
      if (next.has(token)) next.delete(token);
      else next.add(token);
      return next;
    });
  }

  const todaySources = useMemo(() => {
    type Src = { token: string; kind: "campaign" | "po" | "order"; label: string; fulfillmentType?: string };
    const seen = new Map<string, Src>();
    for (const planId of todayPlanIds) {
      const tokens = planSourcesByPlan.get(planId);
      if (!tokens) continue;
      for (const tok of tokens) {
        if (seen.has(tok)) continue;
        if (tok.startsWith("campaign:")) {
          seen.set(tok, { token: tok, kind: "campaign", label: tok.slice("campaign:".length) });
        } else if (tok.startsWith("po:")) {
          seen.set(tok, { token: tok, kind: "po", label: tok.slice("po:".length) });
        } else {
          const oid = tok.slice("order:".length);
          const o = allOrders.find((x) => x.id === oid);
          if (!o) continue;
          if (o.status !== "pending" && o.status !== "in_production") continue;
          const label = o.sourceRef ?? o.customerName ?? o.eventName ?? oid.slice(0, 6);
          seen.set(tok, { token: tok, kind: "order", label, fulfillmentType: o.fulfillmentType });
        }
      }
    }
    const arr = [...seen.values()];
    arr.sort((a, b) => a.label.localeCompare(b.label));
    return {
      campaigns: arr.filter((s) => s.kind === "campaign"),
      pos: arr.filter((s) => s.kind === "po"),
      orders: arr.filter((s) => s.kind === "order"),
      total: arr.length,
    };
  }, [todayPlanIds, planSourcesByPlan, allOrders]);

  const todayProductIds = useMemo(
    () => [...new Set(todayPlanProducts.map((pp) => pp.productId))],
    [todayPlanProducts],
  );
  const productFillingsByProduct = useProductFillingsForProducts(todayProductIds);

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

  // Step rows by (category, phase) — drives remaining-minutes estimate.
  const stepsByCatPhase = useMemo(() => {
    const m = new Map<string, typeof steps[number][]>();
    for (const s of steps) {
      const phase = phaseKeyForStepName(s.name);
      if (!phase) continue;
      const key = `${s.productType}|${phase}`;
      const arr = m.get(key) ?? [];
      arr.push(s);
      m.set(key, arr);
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

  const colourSubStepCountByPp = useMemo(() => {
    const m = new Map<string, number>();
    for (const pp of todayPlanProducts) {
      const product = productById.get(pp.productId);
      if (!product) continue;
      if (!productHasPhase(pp.productId, "colour")) continue;
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
      m.set(ppId, designSteps.length);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayPlanProducts, productById, materialById]);

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

  function planProductPhaseDone(planId: string, ppId: string, phase: PhaseId): boolean {
    const set = doneByPlan.get(planId);
    if (!set) return false;
    const aliases: string[] = phase === "colour" ? ["colour", "color"] : [phase];
    if (phase === "colour") {
      for (const k of set) {
        for (const a of aliases) {
          if (k === a) return true;
          if (k === `${a}-${ppId}`) return true;
        }
      }
      const expected = colourSubStepCountByPp.get(ppId) ?? 0;
      if (expected === 0) return false;
      const seen = new Set<number>();
      for (const a of aliases) {
        const prefix = `${a}-${ppId}-`;
        for (const k of set) {
          if (!k.startsWith(prefix)) continue;
          const idx = Number(k.slice(prefix.length));
          if (Number.isFinite(idx)) seen.add(idx);
        }
      }
      return seen.size >= expected;
    }
    for (const k of set) {
      for (const a of aliases) {
        if (k === a) return true;
        if (k === `${a}-${ppId}`) return true;
        if (k.startsWith(`${a}-${ppId}-`)) return true;
      }
    }
    return false;
  }

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

  type PhaseRoll = { phase: PhaseId; doneBatches: number; totalBatches: number; pendingBatches: number };
  const rollups = useMemo<Record<PhaseId, PhaseRoll>>(() => {
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

  // First phase with pending = "active now".
  const activePhase = useMemo<PhaseId>(() => {
    for (const ph of PHASES) {
      if (rollups[ph.id].pendingBatches > 0) return ph.id;
    }
    return "polishing";
  }, [rollups]);
  const activeLabel = PHASES.find((p) => p.id === activePhase)!.label;

  // ── Filling readiness helpers (preserved from previous build). ──
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

  const FILLING_DENSITY_G_PER_ML = 1.2;
  type FillingNeed = {
    fillingId: string;
    fillingName: string;
    perMouldG: number;
    haveG: number;
    mouldsCoverable: number;
  };
  function fillingNeedsForPlanProduct(pp: import("@/types").PlanProduct): FillingNeed[] {
    const product = productById.get(pp.productId);
    const mould = pp.mouldId ? mouldById.get(pp.mouldId) : undefined;
    if (!product || !mould) return [];
    const shellPct = product.shellPercentage ?? 37;
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
  function mouldsFillableForPlanProduct(pp: import("@/types").PlanProduct): number {
    const needs = fillingNeedsForPlanProduct(pp);
    if (needs.length === 0) return pp.quantity;
    const tightest = Math.min(...needs.map((n) => n.mouldsCoverable));
    return Math.max(0, Math.min(pp.quantity, tightest));
  }
  function mouldsAlreadyFilled(pp: import("@/types").PlanProduct): number {
    const ppId = pp.id ?? `${pp.planId}-${pp.productId}`;
    const set = doneByPlan.get(pp.planId);
    if (!set) return 0;
    let max = 0;
    for (const k of set) {
      const m = k.match(new RegExp(`^filling-${ppId}-mould-(\\d+)$`));
      if (m) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n) && n > max) max = n;
      }
      if (k === `filling-${ppId}` || k === "filling") return pp.quantity;
    }
    return max;
  }
  function isFillingReadyForPlanProduct(pp: import("@/types").PlanProduct): boolean {
    const filled = mouldsAlreadyFilled(pp);
    const fillable = mouldsFillableForPlanProduct(pp);
    return filled + fillable >= pp.quantity;
  }
  function isFillingReadyForPlan(planId: string): boolean {
    const pps = todayPlanProducts.filter((pp) => pp.planId === planId);
    if (pps.length === 0) return true;
    return pps.every((pp) => isFillingReadyForPlanProduct(pp));
  }

  // ── Per-phase detail rows for ALL phases. ──
  type DetailRow = {
    key: string;
    phase: PhaseId;
    planId: string;
    ppId: string;
    productId: string;
    productName: string;
    batchLabel: string;
    mouldName: string;
    qty: number;
    lines: string[];
    done: boolean;
    chip: string;
  };
  const phaseDetailsByPhase = useMemo<Record<PhaseId, DetailRow[]>>(() => {
    const out = {} as Record<PhaseId, DetailRow[]>;
    for (const ph of PHASES) out[ph.id] = [];

    for (const pp of todayPlanProducts) {
      const plan = plansById.get(pp.planId);
      const product = productById.get(pp.productId);
      if (!plan || !product) continue;
      const mould = pp.mouldId ? mouldById.get(pp.mouldId) : undefined;
      const ppDbId = pp.id ?? `${pp.planId}-${pp.productId}`;
      const chip = (() => {
        const n = plan.name ?? "";
        const camp = n.match(/^Campaign:\s*(.+?)\s*—/i)?.[1];
        if (camp) return camp;
        if (plan.sourceOrderId) return "order";
        if (/^Restock/i.test(n) || /^PO: Replen/i.test(n)) return "restock";
        return n.split(":")[0]?.toLowerCase() ?? "batch";
      })();
      const batchLabel = plan.batchNumber ?? plan.name ?? "Batch";

      for (const ph of PHASES) {
        if (!productHasPhase(pp.productId, ph.id)) continue;

        const lines: string[] = [];
        if (ph.id === "polishing") {
          lines.push(`${pp.quantity} × ${mould?.name ?? "no mould"}${mould ? ` · ${mould.numberOfCavities} cavities` : ""}`);
          lines.push("Wipe each mould clean before any colour goes on.");
        } else if (ph.id === "colour") {
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
        } else if (ph.id === "shell") {
          const shellName = product.shellIngredientId
            ? ingredientByIdLocal.get(product.shellIngredientId)?.name
            : product.shellFillingId
            ? fillingById.get(product.shellFillingId)?.name
            : null;
          lines.push(`Shell: ${shellName ?? "— not set —"}`);
          if (mould) lines.push(`Mould: ${pp.quantity} × ${mould.name} · ${pp.quantity * mould.numberOfCavities} pcs`);
        } else if (ph.id === "filling" || ph.id === "fill") {
          const pf = productFillingsByProduct.get(pp.productId) ?? [];
          if (pf.length === 0) {
            lines.push("No fillings recorded for this product.");
          } else {
            for (const layer of pf) {
              const fl = fillingById.get(layer.fillingId);
              const pct = layer.fillPercentage != null ? ` · ${layer.fillPercentage}%` : "";
              lines.push(`${fl?.name ?? "Filling"}${pct}`);
            }
            if (ph.id === "filling") lines.push("Cook / temper according to recipe before piping.");
          }
        } else if (ph.id === "cap") {
          const shellName = product.shellIngredientId
            ? ingredientByIdLocal.get(product.shellIngredientId)?.name
            : null;
          lines.push(`Cap chocolate: ${shellName ?? "matches shell"}`);
          if (mould) lines.push(`${pp.quantity} × ${mould.name}`);
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
        } else if (ph.id === "unmould") {
          if (mould) {
            lines.push(`${pp.quantity} × ${mould.name} → ${pp.quantity * mould.numberOfCavities} pcs expected`);
          } else {
            lines.push(`${pp.quantity} moulds (cavities unknown)`);
          }
          lines.push("Tap row to capture yield + split between orders.");
        } else if (ph.id === "packing") {
          lines.push(`${pp.actualYield ?? pp.quantity} pcs to pack`);
        }

        // Done detection — same per-pp logic as before.
        let done = false;
        if (ph.id === "filling") {
          const filled = mouldsAlreadyFilled(pp);
          done = filled >= pp.quantity;
        } else {
          done = planProductPhaseDone(pp.planId, ppDbId, ph.id);
        }

        out[ph.id].push({
          key: `${ph.id}|${pp.planId}|${ppDbId}`,
          phase: ph.id,
          planId: pp.planId,
          ppId: ppDbId,
          productId: pp.productId,
          productName: product.name,
          batchLabel,
          mouldName: mould?.name ?? "—",
          qty: pp.quantity,
          lines,
          done,
          chip,
        });
      }
    }

    for (const ph of PHASES) {
      out[ph.id].sort((a, b) => {
        if (a.done !== b.done) return Number(a.done) - Number(b.done);
        return a.productName.localeCompare(b.productName);
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    todayPlanProducts, plansById, productById, mouldById,
    materialById, fillingById, ingredientByIdLocal, productFillingsByProduct,
    doneByPlan, phasesByCategoryName, categoryNameById,
  ]);

  // Estimated remaining minutes per phase — sum of activeMinutes across
  // pending pp rows × qty (per-batch tasks count once).
  const remainingMinsByPhase = useMemo<Record<PhaseId, number>>(() => {
    const out = {} as Record<PhaseId, number>;
    for (const ph of PHASES) {
      let mins = 0;
      for (const pp of todayPlanProducts) {
        if (!productHasPhase(pp.productId, ph.id)) continue;
        const ppDbId = pp.id ?? `${pp.planId}-${pp.productId}`;
        if (planProductPhaseDone(pp.planId, ppDbId, ph.id)) continue;
        const product = productById.get(pp.productId);
        const catName = product?.productCategoryId ? categoryNameById.get(product.productCategoryId) : null;
        if (!catName) continue;
        const stepRows = stepsByCatPhase.get(`${catName}|${ph.id}`) ?? [];
        for (const s of stepRows) {
          const m = (s.activeMinutes ?? 0) * (s.perBatch ? 1 : pp.quantity);
          mins += m;
        }
      }
      out[ph.id] = Math.round(mins);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayPlanProducts, productById, categoryNameById, stepsByCatPhase, doneByPlan]);

  // Right-now: first pending row in active phase + next-up pointer.
  const rightNow = useMemo(() => {
    const rows = phaseDetailsByPhase[activePhase] ?? [];
    const pending = rows.filter((r) => !r.done);
    const current = pending[0] ?? null;
    let nextUp: { phase: PhaseId; phaseLabel: string; row: DetailRow } | null = null;
    if (pending[1]) {
      nextUp = { phase: activePhase, phaseLabel: activeLabel, row: pending[1] };
    } else {
      const i = PHASES.findIndex((p) => p.id === activePhase);
      for (let j = i + 1; j < PHASES.length; j++) {
        const r = (phaseDetailsByPhase[PHASES[j].id] ?? []).find((x) => !x.done);
        if (r) {
          nextUp = { phase: PHASES[j].id, phaseLabel: PHASES[j].label, row: r };
          break;
        }
      }
    }
    return { current, nextUp };
  }, [phaseDetailsByPhase, activePhase, activeLabel]);

  // ── Collapsed phases — auto-expand the active phase. ──
  const [collapsedOverride, setCollapsedOverride] = useState<Map<PhaseId, boolean>>(new Map());
  function isCollapsed(ph: PhaseId): boolean {
    const v = collapsedOverride.get(ph);
    if (v !== undefined) return v;
    return ph !== activePhase;
  }
  function toggleCollapsed(ph: PhaseId) {
    setCollapsedOverride((prev) => {
      const next = new Map(prev);
      next.set(ph, !isCollapsed(ph));
      return next;
    });
  }

  // ── Drawer (step detail). ──
  const [drawerKey, setDrawerKey] = useState<string | null>(null);
  const drawerRow: DetailRow | null = useMemo(() => {
    if (!drawerKey) return null;
    for (const ph of PHASES) {
      const r = (phaseDetailsByPhase[ph.id] ?? []).find((x) => x.key === drawerKey);
      if (r) return r;
    }
    return null;
  }, [drawerKey, phaseDetailsByPhase]);

  // ── Inline unmould flow (preserved). ──
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
    const baseName = name.replace(/\s+·\s+\d+\/\d+$/, "");
    if (!baseName.startsWith("PO: ")) return [];
    const rest = baseName.slice("PO: ".length);
    const dash = rest.indexOf(" — ");
    const poName = dash > 0 ? rest.slice(0, dash) : rest;
    const matchingPos = allProductionOrders.filter((po) => {
      if (po.status !== "pending" && po.status !== "in_production") return false;
      return (po.name ?? "") === poName;
    });
    if (matchingPos.length === 0) return [];
    const planPps = todayPlanProducts.filter((pp) => pp.planId === planId);
    const planProductIds = new Set(planPps.map((pp) => pp.productId));
    const slicePiecesByProduct = new Map<string, number>();
    for (const pp of planPps) {
      const m = pp.mouldId ? mouldById.get(pp.mouldId) : undefined;
      const cavities = m?.numberOfCavities ?? 0;
      slicePiecesByProduct.set(
        pp.productId,
        (slicePiecesByProduct.get(pp.productId) ?? 0) + pp.quantity * cavities,
      );
    }
    const rows: AllocationSplitPoRow[] = [];
    for (const po of matchingPos) {
      const items = allProductionOrderItems.filter((it) => it.productionOrderId === po.id);
      for (const it of items) {
        if (!planProductIds.has(it.productId)) continue;
        const slice = slicePiecesByProduct.get(it.productId) ?? it.targetUnits;
        rows.push({
          productionOrderItemId: it.id!,
          productionOrderId: po.id!,
          productId: it.productId,
          poLabel: po.name ?? "PO",
          requested: Math.min(it.targetUnits, slice),
        });
      }
    }
    return rows;
  }

  function previousPhaseGap(
    planId: string,
    ppId: string | null,
    productId: string | null,
    phase: PhaseId,
  ): { phase: PhaseId; label: string } | null {
    const idx = PHASES.findIndex((p) => p.id === phase);
    if (idx <= 0) return null;
    const productPhases = productId
      ? new Set<PhaseId>(PHASES.filter((p) => productHasPhase(productId, p.id)).map((p) => p.id))
      : null;
    const planPhases = phasesByPlan.get(planId);
    for (let i = 0; i < idx; i++) {
      const prev = PHASES[i];
      const inSet = productPhases ? productPhases.has(prev.id) : !!planPhases?.has(prev.id);
      if (!inSet) continue;
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

  // ── Toggle a single batch row's done state. Each phase has its own
  //    side-effects (filling consumption / yield modal / packing redirect).
  async function toggleRow(phase: PhaseId, row: DetailRow) {
    const phaseLabel = PHASES.find((p) => p.id === phase)!.label;
    const planId = row.planId;
    const planProductId = row.ppId;

    if (phase === "filling") {
      const pp = todayPlanProducts.find((x) => (x.id ?? `${x.planId}-${x.productId}`) === planProductId);
      if (!pp) return;
      const ppDbId = pp.id ?? `${pp.planId}-${pp.productId}`;
      const fullKey = `filling-${ppDbId}`;
      const filled = mouldsAlreadyFilled(pp);
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
        if (confirm(`Not enough filling on stock for the next mould of this batch. Open the weekly cook view?`)) {
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
        for (const need of needs) {
          let needLeft = Math.round(need.perMouldG * willFill * 10) / 10;
          if (needLeft <= 0) continue;
          const stockRows = allFillingStock
            .filter((s) => effectiveFillingId(s.fillingId) === effectiveFillingId(need.fillingId) && !s.frozen && Number(s.remainingG) > 0)
            .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
          for (const r of stockRows) {
            if (needLeft <= 0) break;
            const take = Math.min(Number(r.remainingG), needLeft);
            const nextRem = Math.round((Number(r.remainingG) - take) * 10) / 10;
            await adjustFillingStock(r.id!, nextRem);
            needLeft -= take;
          }
        }
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

    if (phase === "unmould") {
      const pp = todayPlanProducts.find((x) => (x.id ?? `${x.planId}-${x.productId}`) === planProductId);
      const ppDbId = pp?.id ?? null;
      const productIdHere = pp?.productId ?? null;
      const currentlyDone = ppDbId ? planProductPhaseDone(planId, ppDbId, phase) : planPhaseDone(planId, phase);
      if (currentlyDone) {
        const stepKey = ppDbId ? `unmould-${ppDbId}` : phase;
        await toggleStep(planId, stepKey, false);
        return;
      }
      const gap = previousPhaseGap(planId, ppDbId, productIdHere, phase);
      if (gap) {
        alert(`Can't unmould yet — "${gap.label}" isn't done for this batch.`);
        return;
      }
      const entries = ppDbId && pp
        ? buildYieldEntries(planId).filter((e) => e.planProductId === ppDbId)
        : buildYieldEntries(planId);
      if (entries.length === 0) {
        const stepKey = ppDbId ? `unmould-${ppDbId}` : phase;
        await toggleStep(planId, stepKey, true);
        return;
      }
      setUnmouldYield({ planId, entries });
      return;
    }

    if (phase === "packing") {
      window.location.href = `/production/${encodeURIComponent(planId)}`;
      return;
    }

    const pp = todayPlanProducts.find((x) => (x.id ?? `${x.planId}-${x.productId}`) === planProductId);
    const ppDbId = pp?.id ?? null;
    const productIdHere = pp?.productId ?? null;
    const currentlyDone = ppDbId ? planProductPhaseDone(planId, ppDbId, phase) : planPhaseDone(planId, phase);
    if (!currentlyDone) {
      const gap = previousPhaseGap(planId, ppDbId, productIdHere, phase);
      if (gap) {
        alert(`Can't tick "${phaseLabel}" yet — "${gap.label}" isn't done for this batch.`);
        return;
      }
    }
    const stepKey = ppDbId ? `${phase}-${ppDbId}` : phase;
    await toggleStep(planId, stepKey, !currentlyDone);
  }

  async function applyUnmouldYield(yieldEntries: YieldEntry[]) {
    if (!unmouldYield) return;
    const planId = unmouldYield.planId;
    try {
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
      for (const ppId of unmouldAlloc.ppIds) {
        await toggleStep(planId, `unmould-${ppId}`, true);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Allocation save failed");
    } finally {
      setUnmouldAlloc(null);
    }
  }

  // ── Side rail data ─────────────────────────────────────────
  const equipmentById = useMemo(() => new Map(equipment.map((e) => [e.id!, e])), [equipment]);
  const ingredientById = useMemo(() => new Map(ingredients.map((i) => [i.id!, i])), [ingredients]);
  const loadsByInstance = useMemo(() => {
    const m = new Map<string, typeof machineLoads[number]>();
    for (const l of machineLoads) {
      if (l.status === "in_use") m.set(l.equipmentInstanceId, l);
    }
    return m;
  }, [machineLoads]);
  const temperingInstances = useMemo(
    () =>
      equipmentInstances
        .filter((inst) => !inst.archived)
        .filter((inst) => {
          const eq = equipmentById.get(inst.equipmentId);
          return eq?.kind === "tempering" || (inst.capacityKg ?? 0) > 0;
        }),
    [equipmentInstances, equipmentById],
  );

  // Mould pool grouped by mould type with state counts.
  type PoolRow = {
    mouldId: string;
    name: string;
    inUse: number;
    drying: number;
    free: number;
    blocked: number;
  };
  const mouldPoolByType = useMemo<PoolRow[]>(() => {
    const g = new Map<string, PoolRow>();
    for (const inst of mouldPool) {
      const mould = mouldById.get(inst.mouldId);
      const name = mould?.name ?? inst.mouldId.slice(0, 8);
      const cur = g.get(inst.mouldId) ?? { mouldId: inst.mouldId, name, inUse: 0, drying: 0, free: 0, blocked: 0 };
      const s = inst.currentState;
      if (s === "loaded" || s === "filled") cur.inUse += 1;
      else if (s === "sealed") cur.drying += 1;
      else if (s === "available") cur.free += 1;
      else if (s === "needs-wash" || s === "in-deep-wash" || s === "broken" || s === "retired") cur.blocked += 1;
      g.set(inst.mouldId, cur);
    }
    return [...g.values()].sort((a, b) => (b.inUse + b.drying) - (a.inUse + a.drying));
  }, [mouldPool, mouldById]);

  // Staff today — workingDays + not unavailable + clock-in time from shifts.
  const todayMs = new Date(`${today}T12:00:00`).getTime();
  const offToday = useMemo(
    () =>
      new Set(
        unavailability
          .filter((u) => {
            const from = new Date(u.startDate).getTime();
            const to = new Date(u.endDate).getTime();
            return u.approved !== false && from <= todayMs && todayMs <= to;
          })
          .map((u) => u.personId),
      ),
    [unavailability, todayMs],
  );
  const shiftByPerson = useMemo(() => {
    const m = new Map<string, typeof staffShiftsToday[number]>();
    for (const s of staffShiftsToday) {
      const prev = m.get(s.personId);
      if (!prev || new Date(s.clockInAt).getTime() < new Date(prev.clockInAt).getTime()) {
        m.set(s.personId, s);
      }
    }
    return m;
  }, [staffShiftsToday]);
  const staffOnFloor = useMemo(() => {
    return people
      .filter((p) => !p.archived)
      .filter((p) => !offToday.has(p.id!))
      .filter((p) => isWorkingToday(p.workingDays))
      .map((p) => {
        const shift = shiftByPerson.get(p.id!);
        return {
          id: p.id!,
          name: p.name,
          roles: p.roles ?? [],
          clockIn: shift?.clockInAt ?? null,
          window: p.startTimeOfDay && p.endTimeOfDay ? `${p.startTimeOfDay}–${p.endTimeOfDay}` : null,
        };
      });
  }, [people, offToday, shiftByPerson]);

  // ── Event feed (filter pills). Only "steps" wired today. ──
  type FeedKind = "all" | "steps" | "stock" | "haccp" | "notes";
  const [feedFilter, setFeedFilter] = useState<FeedKind>("all");
  const stepsFeed = useMemo(() => {
    const items = allStatuses
      .filter((s) => s.done && s.doneAt)
      .map((s) => ({ ...s, doneAtDate: new Date(s.doneAt as unknown as string) }))
      .filter((s) => s.doneAtDate.toISOString().slice(0, 10) === today)
      .sort((a, b) => b.doneAtDate.getTime() - a.doneAtDate.getTime())
      .slice(0, 20);
    return items.map((s) => {
      const plan = plansById.get(s.planId);
      const phase = PHASES.find((p) => s.stepKey === p.id || s.stepKey.startsWith(`${p.id}-`));
      return {
        id: s.id ?? `${s.planId}-${s.stepKey}`,
        kind: "steps" as const,
        time: s.doneAtDate.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" }),
        actor: "—",
        desc: `${phase?.label ?? s.stepKey} · ${plan?.batchNumber ?? plan?.name ?? "—"}`,
      };
    });
  }, [allStatuses, plansById, today]);
  const visibleFeed = feedFilter === "all" || feedFilter === "steps" ? stepsFeed : [];

  // ── Close-day ──
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

  // ──────────────────────────────────────────────────────────
  return (
    <div className="ds px-2 sm:px-4 pt-4 pb-10" style={{ background: "var(--ds-page-bg)", minHeight: "100vh" }}>
      <PlanTabs />

      {/* Header — title + ViewDate picker + source filter + close. */}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <h1
          className="text-[28px] tracking-tight"
          style={{ fontFamily: "var(--font-serif)", fontWeight: 400, letterSpacing: "-0.02em" }}
        >
          Daily
        </h1>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setViewDate((d) => addDaysIso(d, -1))}
            className="w-7 h-7 rounded-full border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] hover:bg-muted text-sm leading-none"
            title="Previous day"
          >
            ‹
          </button>
          <span
            className="text-muted-foreground text-[20px] min-w-[160px] text-center"
            style={{ fontFamily: "var(--font-serif)", letterSpacing: "-0.015em" }}
          >
            {new Date(viewDate + "T00:00:00").toLocaleDateString("de-AT", { weekday: "short", day: "numeric", month: "short" })}
            {isViewingToday && (
              <span className="text-[12px] ml-1.5 opacity-65">· {now.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" })}</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => setViewDate((d) => addDaysIso(d, 1))}
            className="w-7 h-7 rounded-full border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] hover:bg-muted text-sm leading-none"
            title="Next day"
          >
            ›
          </button>
          {!isViewingToday && (
            <button
              type="button"
              onClick={() => setViewDate(today)}
              className="ml-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] hover:bg-muted"
              title="Jump back to today"
            >
              Today
            </button>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {todaySources.total > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setFilterOpen((v) => !v)}
                className="rounded-full px-3 py-1.5 text-xs font-medium border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] hover:bg-muted inline-flex items-center gap-1.5"
                title="Scope today's checklist to selected sources"
              >
                {sourceFilter.size === 0
                  ? `All sources (${todaySources.total})`
                  : `${sourceFilter.size} selected`}
                <span className="opacity-60">▾</span>
              </button>
              {filterOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setFilterOpen(false)} />
                  <div className="absolute right-0 mt-1 z-40 w-[280px] max-h-[60vh] overflow-y-auto rounded-[12px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] shadow-lg p-2 text-xs">
                    <div className="flex items-center justify-between px-1.5 py-1">
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Filter sources</span>
                      {sourceFilter.size > 0 && (
                        <button
                          type="button"
                          onClick={() => setSourceFilter(new Set())}
                          className="text-[11px] text-primary hover:underline"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    {todaySources.campaigns.length > 0 && (
                      <div className="mt-1">
                        <p className="px-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Campaigns</p>
                        {todaySources.campaigns.map((s) => (
                          <FilterOptionRow
                            key={s.token}
                            label={s.label}
                            checked={sourceFilter.has(s.token)}
                            onToggle={() => toggleSourceFilter(s.token)}
                          />
                        ))}
                      </div>
                    )}
                    {todaySources.pos.length > 0 && (
                      <div className="mt-1">
                        <p className="px-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Production orders</p>
                        {todaySources.pos.map((s) => (
                          <FilterOptionRow
                            key={s.token}
                            label={s.label}
                            checked={sourceFilter.has(s.token)}
                            onToggle={() => toggleSourceFilter(s.token)}
                          />
                        ))}
                      </div>
                    )}
                    {todaySources.orders.length > 0 && (
                      <div className="mt-1">
                        <p className="px-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Orders</p>
                        {todaySources.orders.map((s) => (
                          <FilterOptionRow
                            key={s.token}
                            label={s.label}
                            tag={s.fulfillmentType}
                            checked={sourceFilter.has(s.token)}
                            onToggle={() => toggleSourceFilter(s.token)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
          <button
            onClick={handleClose}
            disabled={closing || !isViewingToday}
            title={isViewingToday ? "Close today's production day" : "Switch to today to close the day"}
            className="rounded-full px-3 py-1.5 text-xs font-medium border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] hover:bg-muted disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <X className="w-3.5 h-3.5" /> {closing ? "Closing…" : "Close production day"}
          </button>
        </div>
      </div>

      {/* HACCP strip — quick link, retained from previous layout. */}
      <div className="mb-4 flex items-center gap-2.5 rounded-full bg-[#f5e1d6]/55 border border-[#cfa68a]/40 px-3.5 py-1.5">
        <Thermometer className="w-3.5 h-3.5 text-[#804d2a] shrink-0" />
        <span className="text-[10px] font-semibold uppercase text-[#804d2a] tracking-[0.08em]">HACCP</span>
        <span className="text-[11.5px] text-foreground/70">Log cold-storage temperatures + open incidents</span>
        <Link
          href="/production-brain/haccp"
          className="ml-auto text-[11px] font-medium text-[var(--accent-mint-ink)] hover:underline"
        >
          Log →
        </Link>
      </div>

      {/* ───── Two-column body ───── */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        {/* LEFT COLUMN — Right-now + Phase cards */}
        <div className="flex flex-col gap-3">
          {/* D.1 — Right now card */}
          <section
            style={{
              background: "var(--ds-card-bg)",
              border: "0.5px solid var(--ds-border-warm)",
              borderLeft: `3px solid ${CARAMEL}`,
              borderRadius: 8,
              overflow: "hidden",
              color: "var(--ds-text-primary)",
            }}
          >
            <header
              style={{
                padding: "14px 20px 10px",
                borderBottom: "0.5px solid var(--ds-border-warm)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 12,
              }}
            >
              <h2
                style={{
                  fontFamily: "var(--font-serif)",
                  fontWeight: 500,
                  fontSize: 20,
                  letterSpacing: "-0.012em",
                }}
              >
                Right now — {activeLabel}
              </h2>
              <span className="text-ds-meta shrink-0">
                {rollups[activePhase].doneBatches}/{rollups[activePhase].totalBatches} batches ·{" "}
                {remainingMinsByPhase[activePhase]}m left
              </span>
            </header>
            <div style={{ padding: "16px 20px" }}>
              {rightNow.current ? (
                <>
                  <p style={{ fontSize: 16, lineHeight: 1.4, marginBottom: 10 }}>
                    {rightNow.current.lines[0] ?? `${activeLabel} step`}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px]" style={{ color: "var(--ds-text-muted)" }}>
                    <span>
                      <b style={{ color: "var(--ds-text-primary)" }}>{rightNow.current.productName}</b> · {rightNow.current.qty} ×{" "}
                      {rightNow.current.mouldName}
                    </span>
                    <span style={{ opacity: 0.7 }}>· {rightNow.current.batchLabel}</span>
                    {/* Assignee chip — ✗ deferred (PlanStepStatus has no personId). */}
                    <span
                      title="Assignee per step — deferred (mig: add personId on planStepStatus)"
                      style={{
                        background: "var(--accent-terracotta-bg)",
                        color: "var(--accent-terracotta-ink)",
                        padding: "1px 8px",
                        borderRadius: 999,
                        fontSize: 11,
                        opacity: 0.55,
                      }}
                    >
                      unassigned ✗
                    </span>
                    {/* Started / elapsed — ✗ deferred (PlanStepStatus has no startedAt). */}
                    <span
                      title="Started + elapsed timer — deferred (mig: add startedAt on planStepStatus)"
                      style={{ opacity: 0.55, fontVariantNumeric: "tabular-nums" }}
                    >
                      started — · elapsed —  ✗
                    </span>
                  </div>
                  <div className="h-1.5 rounded-[3px] overflow-hidden mt-3" style={{ background: "rgba(0,0,0,0.06)" }}>
                    <div
                      className="h-full"
                      style={{
                        background: PHASE_COLOR[activePhase],
                        width:
                          rollups[activePhase].totalBatches === 0
                            ? "0%"
                            : `${Math.round(
                                (rollups[activePhase].doneBatches / rollups[activePhase].totalBatches) * 100,
                              )}%`,
                      }}
                    />
                  </div>
                </>
              ) : (
                <p style={{ fontSize: 14, fontStyle: "italic", color: "var(--ds-text-muted)" }}>
                  Workshop quiet — nothing in progress.
                </p>
              )}
              <p
                style={{
                  fontStyle: "italic",
                  marginTop: 12,
                  fontSize: 12,
                  color: "var(--ds-text-muted)",
                }}
              >
                {rightNow.nextUp
                  ? `Next up: ${rightNow.nextUp.phaseLabel} — ${rightNow.nextUp.row.productName} (${rightNow.nextUp.row.batchLabel})`
                  : "Next up: —"}
              </p>
            </div>
          </section>

          {/* D.2 — Phase cards. White cards, coloured left border per phase. */}
          {PHASES.filter((ph) => rollups[ph.id].totalBatches > 0).map((ph) => {
            const r = rollups[ph.id];
            const collapsed = isCollapsed(ph.id);
            const rows = phaseDetailsByPhase[ph.id] ?? [];
            const isActive = ph.id === activePhase;
            return (
              <section
                key={ph.id}
                style={{
                  background: "var(--ds-card-bg)",
                  border: "0.5px solid var(--ds-border-warm)",
                  borderLeft: `3px solid ${PHASE_COLOR[ph.id]}`,
                  borderRadius: 8,
                  overflow: "hidden",
                  color: "var(--ds-text-primary)",
                }}
              >
                <header
                  onClick={() => toggleCollapsed(ph.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleCollapsed(ph.id);
                    }
                  }}
                  style={{
                    padding: "12px 20px",
                    borderBottom: collapsed ? "none" : "0.5px solid var(--ds-border-warm)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    cursor: "pointer",
                  }}
                  className="hover:bg-[color:var(--ds-card-bg-hover)]"
                >
                  <div className="flex items-center gap-2.5">
                    {collapsed ? (
                      <IconChevronRight size={14} style={{ opacity: 0.55 }} />
                    ) : (
                      <IconChevronDown size={14} style={{ opacity: 0.55 }} />
                    )}
                    <h3
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontWeight: 500,
                        fontSize: 17,
                        letterSpacing: "-0.012em",
                      }}
                    >
                      {ph.label}
                    </h3>
                    <span className="text-ds-meta tabular-nums">
                      {r.doneBatches}/{r.totalBatches}
                    </span>
                    <span className="text-ds-meta" style={{ opacity: 0.7 }}>
                      · {remainingMinsByPhase[ph.id]}m left
                    </span>
                  </div>
                  {isActive && (
                    <span
                      style={{
                        background: CARAMEL,
                        color: "#fff",
                        fontSize: 10,
                        padding: "2px 9px",
                        borderRadius: 999,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        fontWeight: 600,
                      }}
                    >
                      active now
                    </span>
                  )}
                </header>
                {!collapsed && (
                  <div>
                    {rows.length === 0 ? (
                      <p
                        style={{
                          padding: "14px 20px",
                          fontStyle: "italic",
                          color: "var(--ds-text-muted)",
                          fontSize: 13,
                        }}
                      >
                        Nothing scheduled.
                      </p>
                    ) : (
                      rows.map((row) => (
                        <ListRow
                          key={row.key}
                          tier={row.done ? "done" : isActive ? "active" : "default"}
                          onClick={() => setDrawerKey(row.key)}
                          title={
                            <>
                              <span>{row.lines[0] ?? `${ph.label} step`}</span>
                            </>
                          }
                          meta={
                            <>
                              <span style={{ marginRight: 8 }}>{row.productName}</span>
                              <span
                                style={{
                                  display: "inline-block",
                                  padding: "1px 7px",
                                  borderRadius: 999,
                                  background: "var(--ds-card-bg-hover)",
                                  color: "var(--ds-text-muted)",
                                  fontSize: 10,
                                  marginRight: 8,
                                }}
                              >
                                {row.batchLabel}
                              </span>
                              <span style={{ opacity: 0.7 }}>{row.qty} × {row.mouldName}</span>
                            </>
                          }
                          side={
                            <>
                              {/* Assignee — ✗ deferred. */}
                              <span
                                title="Per-step assignee deferred (mig: planStepStatus.personId)"
                                style={{
                                  fontSize: 10,
                                  opacity: 0.55,
                                  background: "var(--accent-terracotta-bg)",
                                  color: "var(--accent-terracotta-ink)",
                                  padding: "1px 7px",
                                  borderRadius: 999,
                                }}
                              >
                                — ✗
                              </span>
                              <StepStatusIcon
                                done={row.done}
                                active={isActive && row === rightNow.current}
                              />
                            </>
                          }
                        />
                      ))
                    )}
                  </div>
                )}
              </section>
            );
          })}

          {PHASES.every((ph) => rollups[ph.id].totalBatches === 0) && (
            <Section title="No work scheduled">
              <p style={{ padding: "8px 20px", fontStyle: "italic", color: "var(--ds-text-muted)", fontSize: 13 }}>
                No batches scheduled for this day. Open the planner to add or pull batches forward.
              </p>
            </Section>
          )}
        </div>

        {/* RIGHT COLUMN — Side rail */}
        <div className="flex flex-col gap-3">
          {/* D.3 — Machines */}
          <Section title="Machines">
            {temperingInstances.length === 0 ? (
              <p style={{ padding: "8px 20px", color: "var(--ds-text-muted)", fontSize: 13, fontStyle: "italic" }}>
                No tempering machines tracked.
              </p>
            ) : (
              temperingInstances.map((inst) => {
                const load = loadsByInstance.get(inst.id!);
                const ing = load ? ingredientById.get(load.ingredientId) : null;
                const cap = inst.capacityKg ?? 0;
                const remKg = load ? Math.round(load.remainingQuantityG / 100) / 10 : 0;
                const capKg = cap;
                const pct = capKg > 0 ? Math.min(100, Math.round((remKg / capKg) * 100)) : 0;
                const agingDays = load
                  ? Math.floor((Date.now() - new Date(load.loadedAt).getTime()) / (1000 * 60 * 60 * 24))
                  : 0;
                const aging = load && agingDays >= load.agingAlertThresholdDays;
                return (
                  <ListRow
                    key={inst.id!}
                    tier={aging ? "urgent" : load ? "active" : "default"}
                    title={inst.name}
                    meta={
                      load ? (
                        <>
                          <span>{ing?.name ?? "—"}</span>
                          <span style={{ marginLeft: 8, opacity: 0.7 }}>
                            {remKg.toFixed(1)} / {capKg}kg
                          </span>
                        </>
                      ) : (
                        <span style={{ opacity: 0.6 }}>idle</span>
                      )
                    }
                    secondary={
                      load ? (
                        <div
                          style={{
                            background: "rgba(0,0,0,0.06)",
                            borderRadius: 3,
                            height: 4,
                            overflow: "hidden",
                            marginTop: 4,
                          }}
                        >
                          <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent-cocoa-ink)" }} />
                        </div>
                      ) : undefined
                    }
                    side={
                      load ? (
                        <span
                          style={{
                            fontSize: 10,
                            padding: "1px 7px",
                            borderRadius: 999,
                            background: aging ? "rgba(153,53,86,0.12)" : "rgba(0,0,0,0.05)",
                            color: aging ? "var(--ds-tier-urgent)" : "var(--ds-text-muted)",
                          }}
                          title={`Loaded ${agingDays}d ago`}
                        >
                          {agingDays}d
                        </span>
                      ) : null
                    }
                  />
                );
              })
            )}
          </Section>

          {/* D.3 — Mould pool */}
          <Section title="Mould pool">
            {mouldPoolByType.length === 0 ? (
              <p style={{ padding: "8px 20px", color: "var(--ds-text-muted)", fontSize: 13, fontStyle: "italic" }}>
                No mould instances tracked.
              </p>
            ) : (
              mouldPoolByType.slice(0, 10).map((m) => {
                // State colour: drying=caramel, free=mint, blocked=rose, default=neutral.
                const stateColor = m.blocked > 0
                  ? "var(--ds-tier-urgent)"
                  : m.drying > 0
                  ? CARAMEL
                  : m.free > 0
                  ? "var(--accent-mint-ink)"
                  : "var(--ds-text-muted)";
                return (
                  <ListRow
                    key={m.mouldId}
                    title={m.name}
                    meta={
                      <>
                        <span style={{ color: "var(--ds-text-muted)" }}>in use </span>
                        <b style={{ color: "var(--ds-text-primary)" }}>{m.inUse}</b>
                        <span style={{ marginLeft: 8, color: "var(--ds-text-muted)" }}>free </span>
                        <b style={{ color: "var(--ds-text-primary)" }}>{m.free}</b>
                        {m.drying > 0 && (
                          <>
                            <span style={{ marginLeft: 8, color: CARAMEL }}>drying </span>
                            <b style={{ color: CARAMEL }}>{m.drying}</b>
                          </>
                        )}
                      </>
                    }
                    side={
                      <>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 999,
                            background: stateColor,
                            display: "inline-block",
                          }}
                        />
                        {m.blocked > 0 && (
                          <span style={{ fontSize: 10, color: "var(--ds-tier-urgent)" }}>{m.blocked} blocked</span>
                        )}
                      </>
                    }
                  />
                );
              })
            )}
          </Section>

          {/* D.3 — Staff */}
          <Section title="Staff on floor">
            {staffOnFloor.length === 0 ? (
              <p style={{ padding: "8px 20px", color: "var(--ds-text-muted)", fontSize: 13, fontStyle: "italic" }}>
                Nobody scheduled today.
              </p>
            ) : (
              staffOnFloor.map((p) => (
                <ListRow
                  key={p.id}
                  title={
                    <span
                      style={{
                        background: "var(--accent-terracotta-bg)",
                        color: "var(--accent-terracotta-ink)",
                        padding: "1px 9px",
                        borderRadius: 999,
                        fontSize: 12,
                      }}
                    >
                      {p.name}
                    </span>
                  }
                  meta={
                    <span style={{ color: "var(--ds-text-muted)" }}>
                      {/* "Current task" — ✗ deferred (no per-person assignment on planStepStatus). */}
                      <span title="Current task — deferred (mig: planStepStatus.personId)">— ✗</span>
                    </span>
                  }
                  side={
                    p.clockIn ? (
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>
                        {new Date(p.clockIn).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    ) : p.window ? (
                      <span style={{ opacity: 0.6 }}>{p.window}</span>
                    ) : (
                      <span style={{ opacity: 0.55 }}>—</span>
                    )
                  }
                />
              ))
            )}
          </Section>

          {/* D.3 — Event feed */}
          <Section
            title="Event feed"
            action={
              <span style={{ display: "inline-flex", gap: 4 }}>
                {(["all", "steps", "stock", "haccp", "notes"] as FeedKind[]).map((k) => {
                  const isOn = feedFilter === k;
                  // Stock/HACCP/Notes feeds not wired — flag ✗.
                  const deferred = k === "stock" || k === "haccp" || k === "notes";
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setFeedFilter(k)}
                      title={deferred ? "Feed source deferred — only step ticks logged today" : ""}
                      style={{
                        fontSize: 10,
                        padding: "1px 8px",
                        borderRadius: 999,
                        border: `0.5px solid ${isOn ? "var(--ds-tier-quarter-focus)" : "var(--ds-border-warm)"}`,
                        background: isOn ? "var(--ds-tier-quarter-focus)" : "var(--ds-card-bg)",
                        color: isOn ? "#fff" : "var(--ds-text-muted)",
                        cursor: "pointer",
                        textTransform: "capitalize",
                        opacity: deferred && !isOn ? 0.55 : 1,
                      }}
                    >
                      {k}
                      {deferred ? " ✗" : ""}
                    </button>
                  );
                })}
              </span>
            }
          >
            {visibleFeed.length === 0 ? (
              <p style={{ padding: "8px 20px", color: "var(--ds-text-muted)", fontSize: 13, fontStyle: "italic" }}>
                {feedFilter === "all" || feedFilter === "steps"
                  ? "No events yet today."
                  : "Feed source not wired yet — step ticks only."}
              </p>
            ) : (
              visibleFeed.map((e) => (
                <ListRow
                  key={e.id}
                  title={e.desc}
                  meta={<span>{e.actor}</span>}
                  side={<span style={{ fontVariantNumeric: "tabular-nums" }}>{e.time}</span>}
                />
              ))
            )}
          </Section>
        </div>
      </div>

      {/* Step detail drawer (D.2). */}
      <DsDrawer
        open={!!drawerRow}
        onClose={() => setDrawerKey(null)}
        title={drawerRow ? `${PHASES.find((p) => p.id === drawerRow.phase)!.label} · ${drawerRow.productName}` : ""}
        width={460}
      >
        {drawerRow && (
          <div>
            <p className="text-ds-meta" style={{ marginBottom: 12 }}>
              {drawerRow.batchLabel} · {drawerRow.qty} × {drawerRow.mouldName}
            </p>
            <p
              className="text-ds-meta"
              style={{ textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8, fontSize: 10 }}
            >
              Step detail
            </p>
            {drawerRow.lines.length === 0 ? (
              <p style={{ fontSize: 13, fontStyle: "italic", color: "var(--ds-text-muted)" }}>
                No detail recorded.
              </p>
            ) : (
              <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                {drawerRow.lines.map((ln, i) => (
                  <li
                    key={i}
                    style={{
                      background: "var(--ds-card-bg-hover)",
                      borderRadius: 6,
                      padding: "8px 12px",
                      fontSize: 13,
                    }}
                  >
                    {ln}
                  </li>
                ))}
              </ol>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
              {/* Start — ✗ deferred (no startedAt). */}
              <DsButton
                disabled
                title="Start timer — deferred (mig: planStepStatus.startedAt)"
              >
                Start ✗
              </DsButton>
              {/* Pause — ✗ deferred. */}
              <DsButton disabled title="Pause — deferred (mig: planStepStatus.startedAt + pausedAt)">
                Pause ✗
              </DsButton>
              <DsButton
                variant="primary"
                onClick={async () => {
                  await toggleRow(drawerRow.phase, drawerRow);
                  setDrawerKey(null);
                }}
              >
                {drawerRow.done ? "Undo done" : "Mark done"}
              </DsButton>
              {/* Reassign — ✗ deferred. */}
              <DsButton disabled title="Reassign — deferred (mig: planStepStatus.personId)">
                Reassign ✗
              </DsButton>
            </div>
            <Link
              href={`/production/${encodeURIComponent(drawerRow.planId)}?from=daily`}
              style={{ display: "inline-block", marginTop: 14, fontSize: 12, textDecoration: "underline", opacity: 0.75 }}
            >
              → open full wizard
            </Link>
          </div>
        )}
      </DsDrawer>

      {/* Inline unmould flow. */}
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

function StepStatusIcon({ done, active }: { done: boolean; active: boolean }) {
  if (done) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 16,
          height: 16,
          borderRadius: 999,
          background: "var(--ds-tier-positive)",
          color: "#fff",
        }}
      >
        <IconCheck size={11} />
      </span>
    );
  }
  if (active) {
    return (
      <span
        aria-label="in progress"
        style={{
          display: "inline-block",
          width: 9,
          height: 9,
          borderRadius: 999,
          background: "var(--accent-cocoa-ink)",
          boxShadow: "0 0 0 0 rgba(166,127,85,0.55)",
          animation: "daily-pulse 1.4s ease-in-out infinite",
        }}
      />
    );
  }
  return (
    <span
      aria-label="pending"
      style={{
        display: "inline-block",
        width: 9,
        height: 9,
        borderRadius: 999,
        border: "1.5px solid var(--ds-text-muted)",
      }}
    />
  );
}

function FilterOptionRow({
  label, tag, checked, onToggle,
}: {
  label: string;
  tag?: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={
        "w-full flex items-center gap-2 px-1.5 py-1 rounded-[6px] text-left transition " +
        (checked ? "bg-[color:var(--ds-tint-info)] text-foreground" : "hover:bg-muted text-foreground")
      }
    >
      <span className="w-3.5 h-3.5 shrink-0 rounded-[4px] border border-[color:var(--ds-border-warm)] flex items-center justify-center text-[10px]">
        {checked ? "✓" : ""}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {tag && (
        <span className="rounded-full border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)]/70 px-1.5 py-[1px] text-[9.5px] text-muted-foreground capitalize shrink-0">
          {tag}
        </span>
      )}
    </button>
  );
}
