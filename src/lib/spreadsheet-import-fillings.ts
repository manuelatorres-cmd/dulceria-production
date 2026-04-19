/**
 * Filling spreadsheet import config — with ingredient-list name resolution.
 *
 * Ingredient names in the `ingredients` column are resolved to `ingredientId`
 * by matching against an in-memory lookup built by the caller (the settings
 * page loads all ingredients via the existing hook and passes them in).
 *
 * Child rows (`fillingIngredients`) are inserted as part of `commitBatch`.
 * If the child insert fails we best-effort roll back the just-created
 * filling rows so the DB doesn't end up with orphan fillings.
 */

import { supabase, newId } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import type { Filling, FillingIngredient, Ingredient } from "@/types";
import type { ImportConfig, RowIssue } from "@/lib/spreadsheet-import";
import { toStrOpt, toNumOpt, toList } from "@/lib/spreadsheet-import";

export const FILLING_TEMPLATE_COLUMNS = [
  "name",
  "category",
  "source",
  "description",
  "instructions",
  "status",            // e.g. "to try", "testing", "confirmed"
  "shelfLifeWeeks",
  // Pipe-separated ingredient list, each item "<ingredientName>:<amount><unit>"
  // Example: "Sugar:100g | Cream 35%:200ml | Vanilla:2g"
  "ingredients",
];

/** One filling ready to import, plus its resolved child rows. */
export interface FillingImportRow {
  filling: Omit<Filling, "id">;
  ingredients: ResolvedFillingIngredient[];
  /** Issues picked up during name resolution — these bubble into validation. */
  resolutionIssues: RowIssue[];
}

interface ResolvedFillingIngredient {
  ingredientId: string;
  amount: number;
  unit: string;
  sortOrder: number;
}

/** Parse one `"<name>:<amount><unit>"` segment. Returns null on a shape error. */
function parseIngredientSegment(segment: string): { name: string; amount: number; unit: string } | null {
  const colonAt = segment.indexOf(":");
  if (colonAt < 0) return null;
  const name = segment.slice(0, colonAt).trim();
  const rest = segment.slice(colonAt + 1).trim();
  if (!name || !rest) return null;
  // Match amount (number, optional decimal) + unit (letters)
  const m = rest.match(/^([0-9]*\.?[0-9]+)\s*([A-Za-z]+)$/);
  if (!m) return null;
  const amount = parseFloat(m[1]);
  const unit = m[2];
  if (isNaN(amount) || amount <= 0) return null;
  return { name, amount, unit };
}

/** Build a case-insensitive name → ingredient lookup. Later entries win on
 *  ties; the caller should pre-filter archived if desired. */
export function buildIngredientLookup(ingredients: Ingredient[]): Map<string, Ingredient> {
  const m = new Map<string, Ingredient>();
  for (const ing of ingredients) m.set(ing.name.toLowerCase().trim(), ing);
  return m;
}

/** Build a filling import config bound to the given ingredient lookup.
 *  The lookup is baked into the closure so mapRow stays synchronous. */
export function buildFillingImportConfig(ingredientLookup: Map<string, Ingredient>): ImportConfig<FillingImportRow> {
  function mapRow(row: Record<string, string>): FillingImportRow {
    const resolutionIssues: RowIssue[] = [];
    const ingredients: ResolvedFillingIngredient[] = [];
    const segments = toList(row.ingredients);
    segments.forEach((seg, i) => {
      const parsed = parseIngredientSegment(seg);
      if (!parsed) {
        resolutionIssues.push({
          field: "ingredients",
          message: `Could not parse "${seg}" — expected format "<name>:<amount><unit>"`,
          severity: "error",
        });
        return;
      }
      const ing = ingredientLookup.get(parsed.name.toLowerCase());
      if (!ing?.id) {
        resolutionIssues.push({
          field: "ingredients",
          message: `Ingredient "${parsed.name}" not found — create it first or fix the spelling`,
          severity: "error",
        });
        return;
      }
      ingredients.push({
        ingredientId: ing.id,
        amount: parsed.amount,
        unit: parsed.unit,
        sortOrder: i,
      });
    });

    const filling: Omit<Filling, "id"> = {
      name: (row.name ?? "").trim(),
      category: (row.category ?? "").trim(),
      source: (row.source ?? "").trim(),
      description: (row.description ?? "").trim(),
      instructions: (row.instructions ?? "").trim(),
      status: toStrOpt(row.status),
      shelfLifeWeeks: toNumOpt(row.shelfLifeWeeks),
      // Auto-aggregated from ingredients at save time by the app; we compute
      // a snapshot here from the resolved list so imported fillings show the
      // right allergens in lists before the next edit.
      allergens: aggregateAllergens(ingredients, ingredientLookup),
      createdAt: new Date(),
    };

    return { filling, ingredients, resolutionIssues };
  }

  function validateRow(row: FillingImportRow): RowIssue[] {
    const issues: RowIssue[] = [...row.resolutionIssues];
    if (!row.filling.name) {
      issues.push({ field: "name", message: "Name is required", severity: "error" });
    }
    if (!row.filling.category) {
      issues.push({ field: "category", message: "Category is required", severity: "error" });
    }
    if (row.ingredients.length === 0 && row.resolutionIssues.length === 0) {
      issues.push({
        field: "ingredients",
        message: "At least one ingredient is required",
        severity: "warning",
      });
    }
    return issues;
  }

  async function commitBatch(items: FillingImportRow[]): Promise<number> {
    if (items.length === 0) return 0;
    const insertedIds: string[] = [];
    const fillingInserts: (Omit<Filling, "id"> & { id: string })[] = [];
    const ingredientInserts: (Omit<FillingIngredient, "id"> & { id: string })[] = [];

    for (const item of items) {
      const fillingId = newId();
      insertedIds.push(fillingId);
      fillingInserts.push({ ...item.filling, id: fillingId });
      for (const li of item.ingredients) {
        ingredientInserts.push({
          id: newId(),
          fillingId,
          ingredientId: li.ingredientId,
          amount: li.amount,
          unit: li.unit,
          sortOrder: li.sortOrder,
        });
      }
    }

    const { error: fErr } = await supabase.from("fillings").insert(fillingInserts);
    if (fErr) throw fErr;

    if (ingredientInserts.length > 0) {
      const { error: iErr } = await supabase.from("fillingIngredients").insert(ingredientInserts);
      if (iErr) {
        // Best-effort rollback so we don't leave orphan fillings
        await supabase.from("fillings").delete().in("id", insertedIds);
        throw iErr;
      }
    }

    return items.length;
  }

  return {
    entityName: "filling",
    templateColumns: FILLING_TEMPLATE_COLUMNS,
    mapRow,
    validateRow: (data) => validateRow(data),
    dedupKey: (data) => data.filling.name.toLowerCase().trim(),
    commitBatch,
  };
}

/** Union the allergens from each resolved ingredient — snapshot at import time. */
function aggregateAllergens(
  resolved: ResolvedFillingIngredient[],
  ingredientLookup: Map<string, Ingredient>,
): string[] {
  const set = new Set<string>();
  // Build id-based lookup from the name-based one
  const byId = new Map<string, Ingredient>();
  for (const ing of ingredientLookup.values()) {
    if (ing.id) byId.set(ing.id, ing);
  }
  for (const li of resolved) {
    const ing = byId.get(li.ingredientId);
    for (const a of ing?.allergens ?? []) set.add(a);
  }
  return [...set];
}

export async function getExistingFillingKeys(): Promise<Set<string>> {
  const all = assertOk(await supabase.from("fillings").select("name")) as { name: string }[];
  return new Set(all.map((f) => f.name.toLowerCase().trim()));
}
