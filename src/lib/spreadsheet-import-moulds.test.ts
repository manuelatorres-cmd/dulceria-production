import { describe, it, expect } from "vitest";
import { mapMouldRow, validateMouldRow, MOULD_TEMPLATE_COLUMNS } from "./spreadsheet-import-moulds";

describe("mapMouldRow", () => {
  it("parses a complete row", () => {
    const result = mapMouldRow({
      name: "Hemisphere 20mm",
      productNumber: "MA1500",
      brand: "Matfer",
      cavityWeightG: "6",
      numberOfCavities: "24",
      fillingGramsPerCavity: "4",
      quantityOwned: "2",
      notes: "Good ejection",
    });
    expect(result).toEqual({
      name: "Hemisphere 20mm",
      productNumber: "MA1500",
      brand: "Matfer",
      cavityWeightG: 6,
      numberOfCavities: 24,
      fillingGramsPerCavity: 4,
      quantityOwned: 2,
      notes: "Good ejection",
    });
  });

  it("leaves optionals undefined when blank", () => {
    const result = mapMouldRow({
      name: "Square",
      cavityWeightG: "10",
      numberOfCavities: "12",
    });
    expect(result.productNumber).toBeUndefined();
    expect(result.fillingGramsPerCavity).toBeUndefined();
    expect(result.quantityOwned).toBeUndefined();
    expect(result.notes).toBeUndefined();
  });
});

describe("validateMouldRow", () => {
  it("requires name, cavityWeightG > 0, numberOfCavities > 0", () => {
    const issues = validateMouldRow({ name: "", cavityWeightG: 0, numberOfCavities: 0 });
    expect(issues.map((i) => i.field).sort()).toEqual(["cavityWeightG", "name", "numberOfCavities"]);
    expect(issues.every((i) => i.severity === "error")).toBe(true);
  });

  it("warns when filling grams per cavity >= cavity weight", () => {
    const issues = validateMouldRow({
      name: "Mini",
      cavityWeightG: 5,
      numberOfCavities: 20,
      fillingGramsPerCavity: 5,
    });
    expect(issues.find((i) => i.field === "fillingGramsPerCavity")?.severity).toBe("warning");
  });
});

describe("MOULD_TEMPLATE_COLUMNS", () => {
  it("starts with name and covers the required schema", () => {
    expect(MOULD_TEMPLATE_COLUMNS[0]).toBe("name");
    expect(MOULD_TEMPLATE_COLUMNS).toContain("cavityWeightG");
    expect(MOULD_TEMPLATE_COLUMNS).toContain("numberOfCavities");
  });
});
