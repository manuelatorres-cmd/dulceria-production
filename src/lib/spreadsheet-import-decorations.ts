/**
 * Decoration-material spreadsheet import config.
 */

import { supabase, newId } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import type { DecorationMaterial, DecorationMaterialType, CocoaButterType } from "@/types";
import { DECORATION_MATERIAL_TYPES, COCOA_BUTTER_TYPES } from "@/types";
import type { ImportConfig, RowIssue } from "@/lib/spreadsheet-import";
import { toStrOpt, stripUndefined } from "@/lib/spreadsheet-import";

export const DECORATION_TEMPLATE_COLUMNS = [
  "name",
  "type",            // one of: cocoa_butter, lustre_dust, chocolate, transfer_sheet, other
  "cocoaButterType", // optional — only when type === cocoa_butter. One of: Type A/B/C/D
  "color",           // CSS color (hex or named)
  "manufacturer",
  "vendor",
  "source",
  "notes",
];

export function mapDecorationRow(row: Record<string, string>): Omit<DecorationMaterial, "id"> {
  return {
    name: (row.name ?? "").trim(),
    type: (row.type ?? "").trim() as DecorationMaterialType,
    cocoaButterType: toStrOpt(row.cocoaButterType) as CocoaButterType | undefined,
    color: toStrOpt(row.color),
    manufacturer: toStrOpt(row.manufacturer),
    vendor: toStrOpt(row.vendor),
    source: toStrOpt(row.source),
    notes: toStrOpt(row.notes),
  };
}

export function validateDecorationRow(data: Omit<DecorationMaterial, "id">): RowIssue[] {
  const issues: RowIssue[] = [];
  if (!data.name) {
    issues.push({ field: "name", message: "Name is required", severity: "error" });
  }
  if (!data.type) {
    issues.push({ field: "type", message: "Type is required", severity: "error" });
  } else if (!(DECORATION_MATERIAL_TYPES as readonly string[]).includes(data.type)) {
    issues.push({
      field: "type",
      message: `Unknown type "${data.type}". Expected one of: ${DECORATION_MATERIAL_TYPES.join(", ")}`,
      severity: "error",
    });
  }
  if (data.cocoaButterType) {
    if (data.type !== "cocoa_butter") {
      issues.push({
        field: "cocoaButterType",
        message: "cocoaButterType only applies when type is cocoa_butter",
        severity: "warning",
      });
    } else if (!(COCOA_BUTTER_TYPES as readonly string[]).includes(data.cocoaButterType)) {
      issues.push({
        field: "cocoaButterType",
        message: `Unknown cocoa butter type "${data.cocoaButterType}". Expected one of: ${COCOA_BUTTER_TYPES.join(", ")}`,
        severity: "warning",
      });
    }
  }
  return issues;
}

export const decorationImportConfig: ImportConfig<Omit<DecorationMaterial, "id">> = {
  entityName: "decoration",
  templateColumns: DECORATION_TEMPLATE_COLUMNS,
  mapRow: mapDecorationRow,
  validateRow: (data) => validateDecorationRow(data),
  dedupKey: (data) => data.name.toLowerCase().trim(),
  commitBatch: async (items) => {
    if (items.length === 0) return 0;
    const now = new Date();
    const withIds = items.map((item) => stripUndefined({ ...item, id: newId(), createdAt: now, updatedAt: now }));
    const { error } = await supabase.from("decorationMaterials").insert(withIds);
    if (error) throw error;
    return items.length;
  },
};

export async function getExistingDecorationKeys(): Promise<Set<string>> {
  const all = assertOk(await supabase.from("decorationMaterials").select("name")) as { name: string }[];
  return new Set(all.map((d) => d.name.toLowerCase().trim()));
}
