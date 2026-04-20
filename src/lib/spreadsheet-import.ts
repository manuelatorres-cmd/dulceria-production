/**
 * Spreadsheet (.xlsx) import — pure logic layer.
 *
 * Reusable across entity types. Each entity provides an `ImportConfig<T>`
 * that describes how to map spreadsheet columns → entity fields and how to
 * validate. File I/O (reading .xlsx, writing the template) uses ExcelJS,
 * lazy-loaded so it doesn't bloat the main bundle.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single validation issue on one row. */
export interface RowIssue {
  field: string;
  message: string;
  severity: "error" | "warning";
}

/** A parsed + validated row, ready for preview. */
export interface ParsedRow<T> {
  /** 0-based index in the sheet (excluding header). */
  rowIndex: number;
  /** The parsed entity object (may be incomplete if errors exist). */
  data: T;
  /** Validation issues — rows with any severity:"error" are skipped on import. */
  issues: RowIssue[];
}

/** Result of parsing an entire spreadsheet file. */
export interface ParseResult<T> {
  rows: ParsedRow<T>[];
  /** Column names found in the file header. */
  headerColumns: string[];
  /** Columns from the template that are missing in the file. */
  missingColumns: string[];
  /** Columns in the file that don't match any template column. */
  unknownColumns: string[];
}

/** Import outcome after committing. */
export interface ImportResult {
  imported: number;
  skipped: number;
  duplicates: number;
}

/**
 * Configuration for importing a specific entity type from a spreadsheet.
 * Implement one of these per entity (ingredients, moulds, etc.)
 */
export interface ImportConfig<T> {
  /** Human-readable entity name (e.g. "ingredient"). */
  entityName: string;
  /** Expected column names in order (used for template + header validation). */
  templateColumns: string[];
  /** Map one row (`Record<string, string>`) to a typed entity object. */
  mapRow: (row: Record<string, string>) => T;
  /** Validate a mapped entity, returning any issues. */
  validateRow: (data: T, rowIndex: number) => RowIssue[];
  /** Extract the dedup key from an entity (typically the name, lowercased). */
  dedupKey: (data: T) => string;
  /** Commit a batch of valid entities to the database. Returns count imported. */
  commitBatch: (items: T[]) => Promise<number>;
}

// ---------------------------------------------------------------------------
// Cell-value helpers
// ---------------------------------------------------------------------------

export function toNum(val: string | undefined): number {
  if (!val || val === "") return 0;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

export function toNumOpt(val: string | undefined): number | undefined {
  if (!val || val === "") return undefined;
  const n = parseFloat(val);
  return isNaN(n) ? undefined : n;
}

export function toStrOpt(val: string | undefined): string | undefined {
  if (!val || val === "") return undefined;
  return val.trim();
}

export function toBoolOpt(val: string | undefined): boolean | undefined {
  if (!val || val === "") return undefined;
  const v = val.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return undefined;
}

/** Split a pipe-separated cell into trimmed non-empty strings.
 *  Used for list-valued columns (tags, sub-ingredient names, etc.). */
export function toList(val: string | undefined): string[] {
  if (!val) return [];
  return val.split("|").map((s) => s.trim()).filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// xlsx I/O — lazy-loaded so ExcelJS doesn't land in the main bundle
// ---------------------------------------------------------------------------

async function loadExcelJS() {
  const mod = await import("exceljs");
  return (mod as typeof import("exceljs") & { default?: typeof import("exceljs") }).default ?? mod;
}

/** Coerce an ExcelJS cell value to a plain string for the mapper pipeline.
 *  Numbers keep full precision; dates become ISO-date strings ("YYYY-MM-DD");
 *  formula results use their computed value; booleans → "true"/"false". */
function cellToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString().split("T")[0];
  // Formula: { formula, result } — take the computed result
  if (typeof value === "object" && value !== null && "result" in value) {
    return cellToString((value as { result: unknown }).result);
  }
  // Rich text: { richText: [{ text, ... }, ...] }
  if (typeof value === "object" && value !== null && "richText" in value) {
    const parts = (value as { richText: { text: string }[] }).richText ?? [];
    return parts.map((p) => p.text).join("").trim();
  }
  // Hyperlink: { text, hyperlink }
  if (typeof value === "object" && value !== null && "text" in value) {
    return String((value as { text: unknown }).text ?? "").trim();
  }
  return String(value).trim();
}

/**
 * Pure helper: given already-extracted raw rows + header names, run the
 * config's mapper/validator and compute missing/unknown columns. Useful on
 * its own (e.g. in unit tests that sidestep the xlsx layer), and used
 * internally by `parseImport`.
 */
export function parseRawRows<T>(
  rawRows: Record<string, string>[],
  headerColumns: string[],
  config: ImportConfig<T>,
): ParseResult<T> {
  const expectedSet = new Set(config.templateColumns);
  const actualSet = new Set(headerColumns);
  const missingColumns = config.templateColumns.filter((c) => !actualSet.has(c));
  const unknownColumns = headerColumns.filter((c) => c && !expectedSet.has(c));

  const rows: ParsedRow<T>[] = rawRows.map((raw, rowIndex) => {
    const data = config.mapRow(raw);
    const issues = config.validateRow(data, rowIndex);
    return { rowIndex, data, issues };
  });

  return { rows, headerColumns, missingColumns, unknownColumns };
}

/**
 * Parse an .xlsx file (first worksheet) into validated rows using the given
 * config. Pure data-in, data-out — no DB access.
 */
export async function parseImport<T>(
  buffer: ArrayBuffer,
  config: ImportConfig<T>,
): Promise<ParseResult<T>> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) {
    return { rows: [], headerColumns: [], missingColumns: config.templateColumns.slice(), unknownColumns: [] };
  }

  // Header row = row 1. Read each cell in column order.
  const headerRow = ws.getRow(1);
  const headerColumns: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headerColumns[colNumber - 1] = cellToString(cell.value);
  });
  for (let i = headerColumns.length - 1; i >= 0; i--) {
    if (!headerColumns[i]) headerColumns.splice(i, 1);
  }

  // Data rows — ExcelJS is 1-indexed; row 1 = header, data starts at row 2.
  const rawRows: Record<string, string>[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, string> = {};
    let anyValue = false;
    headerColumns.forEach((colName, i) => {
      const cell = row.getCell(i + 1);
      const str = cellToString(cell.value);
      if (str !== "") anyValue = true;
      record[colName] = str;
    });
    if (anyValue) rawRows.push(record);
  });

  return parseRawRows(rawRows, headerColumns, config);
}

// ---------------------------------------------------------------------------
// Commit with dedup
// ---------------------------------------------------------------------------

export async function commitImport<T>(
  parsed: ParseResult<T>,
  config: ImportConfig<T>,
  existingKeys: Set<string>,
): Promise<ImportResult> {
  let duplicates = 0;
  let skipped = 0;

  const toImport: T[] = [];
  const seenKeys = new Set<string>();

  for (const row of parsed.rows) {
    const hasError = row.issues.some((i) => i.severity === "error");
    if (hasError) {
      skipped++;
      continue;
    }

    const key = config.dedupKey(row.data);
    if (existingKeys.has(key) || seenKeys.has(key)) {
      duplicates++;
      continue;
    }

    seenKeys.add(key);
    toImport.push(row.data);
  }

  const imported = toImport.length > 0 ? await config.commitBatch(toImport) : 0;

  return { imported, skipped, duplicates };
}

// ---------------------------------------------------------------------------
// Template download
// ---------------------------------------------------------------------------

/**
 * Turn any error thrown during the import flow into a readable, multi-line
 * string for the UI + the browser console. Handles:
 *   - PostgrestError (the plain-object rejection from `supabase.from(...)` —
 *     has `message` + `details` + `hint` + `code` but isn't an Error instance).
 *   - Standard Error instances.
 *   - Strings.
 *   - Anything else → JSON-stringified.
 *
 * The result gets rendered with whitespace-pre-wrap so the newlines survive.
 */
export function formatImportError(err: unknown): string {
  // Always log the raw object to the console so DevTools shows the full shape.
  if (typeof console !== "undefined") {
    console.error("[spreadsheet-import] error:", err);
  }

  if (err == null) return "Import failed (unknown error).";
  if (typeof err === "string") return err;

  if (typeof err === "object") {
    const e = err as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
      name?: unknown;
    };
    const parts: string[] = [];
    if (typeof e.message === "string" && e.message.trim()) parts.push(e.message.trim());
    if (typeof e.details === "string" && e.details.trim()) parts.push(`Details: ${e.details.trim()}`);
    if (typeof e.hint === "string" && e.hint.trim()) parts.push(`Hint: ${e.hint.trim()}`);
    if (typeof e.code === "string" && e.code.trim()) parts.push(`Code: ${e.code.trim()}`);
    if (parts.length > 0) return parts.join("\n");

    // Fallback — stringify whatever we got
    try { return JSON.stringify(err); } catch { /* fallthrough */ }
  }

  return String(err);
}

/** Download a blank template .xlsx for the given config. Header bolded,
 *  columns sized for readability. */
export async function downloadTemplate(config: ImportConfig<unknown>): Promise<void> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(config.entityName);
  ws.columns = config.templateColumns.map((name) => ({
    header: name,
    key: name,
    width: Math.min(Math.max(name.length + 2, 12), 32),
  }));
  ws.getRow(1).font = { bold: true };

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${config.entityName}-template.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
