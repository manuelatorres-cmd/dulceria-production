/**
 * Shared types for the source-first manual planner
 * (MANUAL_PLANNER_SOURCE_FIRST_BATCH.md §4.1–§4.3).
 *
 * Imported by the new hooks (useSchedulableSources / useSourceItems /
 * useScheduledSources), the helpers (computeCombineMath /
 * scheduleSourceToDay / generateBatchName), and every component in
 * src/components/manual-planner/source-first/.
 */

export type SourceKind =
  | "restock-po"
  | "campaign"
  | "customer-order"
  | "online-bucket";

export interface SchedulableSource {
  kind: SourceKind;
  id: string;
  name: string;
  dueDate: string | null;
  itemCount: number;
  isolated?: boolean;
  priority: "urgent" | "normal";
}

export interface SourceItem {
  sourceKind: SourceKind;
  sourceId: string;
  sourceName: string;

  productId: string;
  productName: string;
  productCategory: string; // category name, joins productionSteps.productType
  mouldId: string;
  mouldName: string;
  mouldCavities: number;

  remainingQty: number;
  fillsNeeded: number;

  sourceItemId: string;
  sourceItemKind: "productionOrderItem" | "orderItem";

  isolated: boolean;
  dueDate: string | null;
  priority: "urgent" | "normal";
}

export interface ScheduledSourceCard {
  sourceKind: SourceKind | "unscheduled";
  sourceId: string;
  sourceName: string;
  pinnedDate: string;
  planIds: string[];
  batchCount: number;
  totalActiveMinutes: number;
  isolated: boolean;
}
