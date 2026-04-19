import { describe, it, expect } from "vitest";
import { buildFillingImportConfig, buildIngredientLookup, FILLING_TEMPLATE_COLUMNS } from "./spreadsheet-import-fillings";
import type { Ingredient } from "@/types";

const ingSugar = { id: "ing-sugar", name: "Sugar", manufacturer: "", source: "", cost: 0, notes: "", cacaoFat: 0, sugar: 100, milkFat: 0, water: 0, solids: 0, otherFats: 0, allergens: [] } satisfies Ingredient;
const ingCream = { id: "ing-cream", name: "Cream 35%", manufacturer: "", source: "", cost: 0, notes: "", cacaoFat: 0, sugar: 0, milkFat: 35, water: 60, solids: 5, otherFats: 0, allergens: ["milk"] } satisfies Ingredient;

const lookup = buildIngredientLookup([ingSugar, ingCream]);
const config = buildFillingImportConfig(lookup);

describe("filling mapRow", () => {
  it("resolves ingredient names to ids and parses amounts/units", () => {
    const row = config.mapRow({
      name: "Caramel",
      category: "Caramels & Syrups (Sugar-Based)",
      source: "",
      description: "",
      instructions: "",
      ingredients: "Sugar:100g | Cream 35%:200ml",
    });
    expect(row.filling.name).toBe("Caramel");
    expect(row.ingredients).toEqual([
      { ingredientId: "ing-sugar", amount: 100, unit: "g", sortOrder: 0 },
      { ingredientId: "ing-cream", amount: 200, unit: "ml", sortOrder: 1 },
    ]);
    expect(row.resolutionIssues).toEqual([]);
    // Snapshot allergens from cream
    expect(row.filling.allergens).toEqual(["milk"]);
  });

  it("errors when an ingredient name doesn't resolve", () => {
    const row = config.mapRow({
      name: "Mystery",
      category: "Ganaches (Emulsions)",
      source: "",
      description: "",
      instructions: "",
      ingredients: "Unicorn dust:50g",
    });
    expect(row.resolutionIssues.length).toBe(1);
    expect(row.resolutionIssues[0].severity).toBe("error");
    expect(row.resolutionIssues[0].message).toContain("Unicorn dust");
  });

  it("errors when a segment doesn't match <name>:<amount><unit>", () => {
    const row = config.mapRow({
      name: "Bad",
      category: "Ganaches (Emulsions)",
      source: "",
      description: "",
      instructions: "",
      ingredients: "Sugar 100g",
    });
    expect(row.resolutionIssues.length).toBe(1);
    expect(row.resolutionIssues[0].severity).toBe("error");
  });

  it("case-insensitive matching on ingredient names", () => {
    const row = config.mapRow({
      name: "Mix",
      category: "Ganaches (Emulsions)",
      source: "",
      description: "",
      instructions: "",
      ingredients: "SUGAR:10g",
    });
    expect(row.ingredients[0].ingredientId).toBe("ing-sugar");
  });
});

describe("filling validateRow", () => {
  it("requires name and category and warns when no ingredients", () => {
    const row = config.mapRow({
      name: "",
      category: "",
      source: "",
      description: "",
      instructions: "",
      ingredients: "",
    });
    const issues = config.validateRow(row, 0);
    expect(issues.find((i) => i.field === "name")?.severity).toBe("error");
    expect(issues.find((i) => i.field === "category")?.severity).toBe("error");
    expect(issues.find((i) => i.field === "ingredients")?.severity).toBe("warning");
  });
});

describe("FILLING_TEMPLATE_COLUMNS", () => {
  it("has name first and includes ingredients", () => {
    expect(FILLING_TEMPLATE_COLUMNS[0]).toBe("name");
    expect(FILLING_TEMPLATE_COLUMNS).toContain("ingredients");
    expect(FILLING_TEMPLATE_COLUMNS).toContain("category");
  });
});
