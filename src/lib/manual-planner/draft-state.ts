/**
 * Manual planner v2 — single-draft state.
 *
 * One draft batch in progress at a time, persisted to localStorage so
 * a refresh mid-composition doesn't lose work. Multi-draft composition
 * is intentionally out of scope (see spec "Honest deferred items"
 * section: multi-draft simultaneous composition).
 */

export type DraftAllocationSource = "order" | "po";

export interface DraftAllocation {
  source: DraftAllocationSource;
  /** orderItemId for source='order'; productionOrderItemId for 'po'. */
  parentId: string;
  /** Pieces this allocation reserves out of the batch. */
  qty: number;
  /** Display label (customer name / PO name). */
  label: string;
  /** ISO yyyy-mm-dd or null if no deadline on the source. */
  dueDate: string | null;
}

export type SurplusDestination = "store" | "freezer" | "waste" | "po-fill" | null;

export interface DraftBatch {
  /** Local-only id (server gives a real one on save). */
  id: string;
  productId: string;
  productName: string;
  mouldId: string;
  mouldName: string;
  numberOfCavities: number;
  /** Number of mould fills — recomputed when allocations change. */
  mouldCount: number;
  /** mouldCount × numberOfCavities. */
  totalPieces: number;
  /** Sum of allocation qtys — what's earmarked for actual demand. */
  totalDemand: number;
  /** totalPieces − totalDemand. */
  surplus: number;
  surplusDestination: SurplusDestination;
  /** When surplusDestination = 'po-fill': the PO that absorbs surplus. */
  poFillPlanId: string | null;
  allocations: DraftAllocation[];
  /** ISO yyyy-mm-dd once dropped on calendar. */
  pinnedDate: string | null;
  notes: string;
  /** Free-form name shown on the chip + the saved plan. */
  name: string;
}

const STORAGE_KEY = "dulceria.manual-planner.draft.v2";

export function loadDraft(): DraftBatch | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.id) return parsed as DraftBatch;
    return null;
  } catch {
    return null;
  }
}

export function saveDraft(d: DraftBatch | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!d) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  } catch {
    // ignore quota / serialisation errors
  }
}

/** Recompute mouldCount + totalPieces + totalDemand + surplus from
 *  the current allocation list. Always pick the minimum mould count
 *  that covers totalDemand. */
export function recomputeBatchTotals(d: DraftBatch): DraftBatch {
  const totalDemand = d.allocations.reduce((s, a) => s + a.qty, 0);
  const mouldCount =
    d.numberOfCavities > 0
      ? Math.max(1, Math.ceil(totalDemand / d.numberOfCavities))
      : 1;
  const totalPieces = mouldCount * d.numberOfCavities;
  const surplus = Math.max(0, totalPieces - totalDemand);
  return { ...d, mouldCount, totalPieces, totalDemand, surplus };
}

export function newDraft(input: {
  productId: string;
  productName: string;
  mouldId: string;
  mouldName: string;
  numberOfCavities: number;
}): DraftBatch {
  return {
    id: crypto.randomUUID(),
    productId: input.productId,
    productName: input.productName,
    mouldId: input.mouldId,
    mouldName: input.mouldName,
    numberOfCavities: input.numberOfCavities,
    mouldCount: 1,
    totalPieces: input.numberOfCavities,
    totalDemand: 0,
    surplus: input.numberOfCavities,
    surplusDestination: null,
    poFillPlanId: null,
    allocations: [],
    pinnedDate: null,
    notes: "",
    name: `${input.productName} batch`,
  };
}
