import { describe, it, expect } from "vitest";
import { mapPackagingRow, validatePackagingRow, PACKAGING_TEMPLATE_COLUMNS } from "./spreadsheet-import-packaging";

describe("mapPackagingRow", () => {
  it("parses a complete row", () => {
    const result = mapPackagingRow({
      name: "Box of 9",
      capacity: "9",
      manufacturer: "Keylink",
      notes: "Natural insert",
    });
    expect(result).toEqual({
      name: "Box of 9",
      capacity: 9,
      manufacturer: "Keylink",
      notes: "Natural insert",
    });
  });
});

describe("validatePackagingRow", () => {
  it("requires name and capacity", () => {
    const issues = validatePackagingRow({ name: "", capacity: 0 });
    expect(issues.map((i) => i.field).sort()).toEqual(["capacity", "name"]);
    expect(issues.every((i) => i.severity === "error")).toBe(true);
  });
});

describe("PACKAGING_TEMPLATE_COLUMNS", () => {
  it("contains the core columns", () => {
    expect(PACKAGING_TEMPLATE_COLUMNS).toEqual(["name", "capacity", "manufacturer", "notes"]);
  });
});
