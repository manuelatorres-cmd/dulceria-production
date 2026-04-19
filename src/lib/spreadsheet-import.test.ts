import { describe, it, expect } from "vitest";
import { toNum, toNumOpt, toStrOpt, toBoolOpt, toList, parseRawRows } from "./spreadsheet-import";
import type { ImportConfig, RowIssue } from "./spreadsheet-import";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe("toNum", () => {
  it("returns 0 for empty/undefined", () => {
    expect(toNum("")).toBe(0);
    expect(toNum(undefined)).toBe(0);
  });
  it("parses valid numbers", () => {
    expect(toNum("42")).toBe(42);
    expect(toNum("3.14")).toBe(3.14);
  });
  it("returns 0 for NaN", () => {
    expect(toNum("abc")).toBe(0);
  });
});

describe("toNumOpt", () => {
  it("returns undefined for empty/undefined", () => {
    expect(toNumOpt("")).toBeUndefined();
    expect(toNumOpt(undefined)).toBeUndefined();
  });
  it("parses valid numbers", () => {
    expect(toNumOpt("42")).toBe(42);
  });
  it("returns undefined for NaN", () => {
    expect(toNumOpt("abc")).toBeUndefined();
  });
});

describe("toStrOpt", () => {
  it("returns undefined for empty/undefined", () => {
    expect(toStrOpt("")).toBeUndefined();
    expect(toStrOpt(undefined)).toBeUndefined();
  });
  it("trims whitespace", () => {
    expect(toStrOpt("  hello  ")).toBe("hello");
  });
});

describe("toBoolOpt", () => {
  it("returns undefined for empty/undefined", () => {
    expect(toBoolOpt("")).toBeUndefined();
    expect(toBoolOpt(undefined)).toBeUndefined();
  });
  it("recognises truthy values", () => {
    expect(toBoolOpt("true")).toBe(true);
    expect(toBoolOpt("TRUE")).toBe(true);
    expect(toBoolOpt("1")).toBe(true);
    expect(toBoolOpt("yes")).toBe(true);
    expect(toBoolOpt("Yes")).toBe(true);
  });
  it("recognises falsy values", () => {
    expect(toBoolOpt("false")).toBe(false);
    expect(toBoolOpt("0")).toBe(false);
    expect(toBoolOpt("no")).toBe(false);
  });
  it("returns undefined for unknown strings", () => {
    expect(toBoolOpt("maybe")).toBeUndefined();
  });
});

describe("toList", () => {
  it("returns [] for empty/undefined", () => {
    expect(toList(undefined)).toEqual([]);
    expect(toList("")).toEqual([]);
  });
  it("splits on |, trims, drops empties", () => {
    expect(toList("alpha | beta |  gamma ")).toEqual(["alpha", "beta", "gamma"]);
    expect(toList("one")).toEqual(["one"]);
    expect(toList(" | mid | ")).toEqual(["mid"]);
  });
});

// ---------------------------------------------------------------------------
// parseRawRows — pure mapping/validation layer shared by xlsx + tests
// ---------------------------------------------------------------------------

interface TestEntity {
  name: string;
  value: number;
}

const testConfig: ImportConfig<TestEntity> = {
  entityName: "widget",
  templateColumns: ["name", "value"],
  mapRow: (row) => ({
    name: (row.name ?? "").trim(),
    value: toNum(row.value),
  }),
  validateRow: (data) => {
    const issues: RowIssue[] = [];
    if (!data.name) issues.push({ field: "name", message: "Name is required", severity: "error" });
    if (data.value < 0) issues.push({ field: "value", message: "Value must be non-negative", severity: "warning" });
    return issues;
  },
  dedupKey: (data) => data.name.toLowerCase(),
  commitBatch: async (items) => items.length,
};

describe("parseRawRows", () => {
  it("parses valid rows with no issues", () => {
    const result = parseRawRows(
      [{ name: "Alpha", value: "10" }, { name: "Beta", value: "20" }],
      ["name", "value"],
      testConfig,
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].data).toEqual({ name: "Alpha", value: 10 });
    expect(result.rows[0].issues).toEqual([]);
    expect(result.rows[1].data).toEqual({ name: "Beta", value: 20 });
    expect(result.headerColumns).toEqual(["name", "value"]);
    expect(result.missingColumns).toEqual([]);
    expect(result.unknownColumns).toEqual([]);
  });

  it("detects missing columns", () => {
    const result = parseRawRows(
      [{ name: "Alpha" }],
      ["name"],
      testConfig,
    );

    expect(result.missingColumns).toEqual(["value"]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].data.value).toBe(0); // toNum default
  });

  it("detects unknown columns", () => {
    const result = parseRawRows(
      [{ name: "Alpha", value: "10", extra: "foo" }],
      ["name", "value", "extra"],
      testConfig,
    );

    expect(result.unknownColumns).toEqual(["extra"]);
  });

  it("reports validation errors on rows", () => {
    const result = parseRawRows(
      [{ name: "", value: "10" }, { name: "Beta", value: "-5" }],
      ["name", "value"],
      testConfig,
    );

    expect(result.rows[0].issues).toHaveLength(1);
    expect(result.rows[0].issues[0].severity).toBe("error");
    expect(result.rows[0].issues[0].field).toBe("name");

    expect(result.rows[1].issues).toHaveLength(1);
    expect(result.rows[1].issues[0].severity).toBe("warning");
  });

  it("assigns sequential rowIndex starting from 0", () => {
    const result = parseRawRows(
      [{ name: "A", value: "1" }, { name: "B", value: "2" }, { name: "C", value: "3" }],
      ["name", "value"],
      testConfig,
    );
    expect(result.rows.map((r) => r.rowIndex)).toEqual([0, 1, 2]);
  });
});
