/**
 * Packaging-specific spreadsheet import config.
 */

import { supabase, newId } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import type { Packaging } from "@/types";
import type { ImportConfig, RowIssue } from "@/lib/spreadsheet-import";
import { toNum, toStrOpt, stripUndefined } from "@/lib/spreadsheet-import";

export const PACKAGING_TEMPLATE_COLUMNS = [
  "name",
  "capacity",
  "manufacturer",
  "notes",
];

export function mapPackagingRow(row: Record<string, string>): Omit<Packaging, "id" | "createdAt" | "updatedAt"> {
  return {
    name: (row.name ?? "").trim(),
    capacity: toNum(row.capacity),
    manufacturer: toStrOpt(row.manufacturer),
    notes: toStrOpt(row.notes),
  };
}

export function validatePackagingRow(data: Omit<Packaging, "id" | "createdAt" | "updatedAt">): RowIssue[] {
  const issues: RowIssue[] = [];
  if (!data.name) {
    issues.push({ field: "name", message: "Name is required", severity: "error" });
  }
  if (!(data.capacity > 0)) {
    issues.push({ field: "capacity", message: "Capacity must be > 0", severity: "error" });
  }
  return issues;
}

export const packagingImportConfig: ImportConfig<Omit<Packaging, "id" | "createdAt" | "updatedAt">> = {
  entityName: "packaging",
  templateColumns: PACKAGING_TEMPLATE_COLUMNS,
  mapRow: mapPackagingRow,
  validateRow: (data) => validatePackagingRow(data),
  dedupKey: (data) => data.name.toLowerCase().trim(),
  commitBatch: async (items) => {
    if (items.length === 0) return 0;
    const now = new Date();
    const withIds = items.map((item) => stripUndefined({ ...item, id: newId(), createdAt: now, updatedAt: now }));
    const { error } = await supabase.from("packaging").insert(withIds);
    if (error) throw error;
    return items.length;
  },
};

export async function getExistingPackagingKeys(): Promise<Set<string>> {
  const all = assertOk(await supabase.from("packaging").select("name")) as { name: string }[];
  return new Set(all.map((p) => p.name.toLowerCase().trim()));
}
