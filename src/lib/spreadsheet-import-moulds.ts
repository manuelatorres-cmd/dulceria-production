/**
 * Mould-specific spreadsheet import config.
 */

import { supabase, newId } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import type { Mould } from "@/types";
import type { ImportConfig, RowIssue } from "@/lib/spreadsheet-import";
import { toNum, toNumOpt, toStrOpt } from "@/lib/spreadsheet-import";

export const MOULD_TEMPLATE_COLUMNS = [
  "name",
  "productNumber",
  "brand",
  "cavityWeightG",
  "numberOfCavities",
  "fillingGramsPerCavity",
  "quantityOwned",
  "notes",
];

export function mapMouldRow(row: Record<string, string>): Omit<Mould, "id"> {
  return {
    name: (row.name ?? "").trim(),
    productNumber: toStrOpt(row.productNumber),
    brand: toStrOpt(row.brand),
    cavityWeightG: toNum(row.cavityWeightG),
    numberOfCavities: toNum(row.numberOfCavities),
    fillingGramsPerCavity: toNumOpt(row.fillingGramsPerCavity),
    quantityOwned: toNumOpt(row.quantityOwned),
    notes: toStrOpt(row.notes),
  };
}

export function validateMouldRow(data: Omit<Mould, "id">): RowIssue[] {
  const issues: RowIssue[] = [];
  if (!data.name) {
    issues.push({ field: "name", message: "Name is required", severity: "error" });
  }
  if (!(data.cavityWeightG > 0)) {
    issues.push({ field: "cavityWeightG", message: "Cavity weight must be > 0", severity: "error" });
  }
  if (!(data.numberOfCavities > 0)) {
    issues.push({ field: "numberOfCavities", message: "Number of cavities must be > 0", severity: "error" });
  }
  if (data.fillingGramsPerCavity != null && data.fillingGramsPerCavity >= data.cavityWeightG) {
    issues.push({
      field: "fillingGramsPerCavity",
      message: "Filling grams per cavity should be less than cavity weight",
      severity: "warning",
    });
  }
  return issues;
}

export const mouldImportConfig: ImportConfig<Omit<Mould, "id">> = {
  entityName: "mould",
  templateColumns: MOULD_TEMPLATE_COLUMNS,
  mapRow: mapMouldRow,
  validateRow: (data) => validateMouldRow(data),
  dedupKey: (data) => data.name.toLowerCase().trim(),
  commitBatch: async (items) => {
    if (items.length === 0) return 0;
    const withIds = items.map((item) => ({ ...item, id: newId() }));
    const { error } = await supabase.from("moulds").insert(withIds);
    if (error) throw error;
    return items.length;
  },
};

export async function getExistingMouldKeys(): Promise<Set<string>> {
  const all = assertOk(await supabase.from("moulds").select("name")) as { name: string }[];
  return new Set(all.map((m) => m.name.toLowerCase().trim()));
}
