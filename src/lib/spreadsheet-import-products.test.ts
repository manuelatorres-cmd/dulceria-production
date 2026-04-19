import { describe, it, expect } from "vitest";
import {
  buildProductImportConfig,
  buildFillingNameLookup,
  buildMouldNameLookup,
  buildIngredientNameLookup,
  buildProductCategoryLookup,
  PRODUCT_TEMPLATE_COLUMNS,
} from "./spreadsheet-import-products";
import type { Ingredient, Filling, Mould, ProductCategory } from "@/types";

const shellIng: Ingredient = {
  id: "ing-811", name: "Callebaut 811", manufacturer: "Callebaut", source: "", cost: 0, notes: "",
  cacaoFat: 0, sugar: 0, milkFat: 0, water: 0, solids: 0, otherFats: 0, allergens: [],
  shellCapable: true,
};

const fillingA: Filling = {
  id: "f-a", name: "Hazelnut Ganache", category: "Ganaches (Emulsions)", source: "",
  description: "", instructions: "", allergens: [],
};
const fillingB: Filling = {
  id: "f-b", name: "Salted Caramel", category: "Caramels & Syrups (Sugar-Based)", source: "",
  description: "", instructions: "", allergens: [],
};

const mould: Mould = {
  id: "m-1", name: "Hemisphere 20mm", cavityWeightG: 6, numberOfCavities: 24,
};

const cat: ProductCategory = {
  id: "c-1", name: "moulded", shellPercentMin: 15, shellPercentMax: 50, defaultShellPercent: 37,
  createdAt: new Date(), updatedAt: new Date(),
};

function makeConfig() {
  return buildProductImportConfig({
    ingredients: buildIngredientNameLookup([shellIng]),
    fillings: buildFillingNameLookup([fillingA, fillingB]),
    moulds: buildMouldNameLookup([mould]),
    productCategories: buildProductCategoryLookup([cat]),
  });
}

describe("product mapRow", () => {
  it("resolves all names to ids and parses fillings", () => {
    const config = makeConfig();
    const row = config.mapRow({
      name: "Praline Assortment",
      productCategory: "moulded",
      shellIngredient: "Callebaut 811",
      shellPercentage: "37",
      fillMode: "percentage",
      defaultMould: "Hemisphere 20mm",
      fillings: "Hazelnut Ganache:50 | Salted Caramel:50",
      tags: "christmas | gift",
    });
    expect(row.resolutionIssues).toEqual([]);
    expect(row.product.shellIngredientId).toBe("ing-811");
    expect(row.product.defaultMouldId).toBe("m-1");
    expect(row.product.productCategoryId).toBe("c-1");
    expect(row.product.tags).toEqual(["christmas", "gift"]);
    expect(row.fillings).toEqual([
      { fillingId: "f-a", fillPercentage: 50, fillGrams: undefined, sortOrder: 0 },
      { fillingId: "f-b", fillPercentage: 50, fillGrams: undefined, sortOrder: 1 },
    ]);
  });

  it("errors when shell ingredient is missing", () => {
    const config = makeConfig();
    const row = config.mapRow({
      name: "X",
      shellIngredient: "Ghost Chocolate",
      fillings: "Hazelnut Ganache:100",
    });
    expect(row.resolutionIssues.find((i) => i.field === "shellIngredient")?.severity).toBe("error");
  });

  it("warns when percentages don't sum to 100 in percentage mode", () => {
    const config = makeConfig();
    const row = config.mapRow({
      name: "Off",
      fillings: "Hazelnut Ganache:40 | Salted Caramel:40",
    });
    const issues = config.validateRow(row, 0);
    expect(issues.find((i) => i.field === "fillings")?.severity).toBe("warning");
  });

  it("supports grams fillMode with Xg syntax", () => {
    const config = makeConfig();
    const row = config.mapRow({
      name: "Grams Mode",
      fillMode: "grams",
      fillings: "Hazelnut Ganache:3g | Salted Caramel:2g",
    });
    expect(row.product.fillMode).toBe("grams");
    expect(row.fillings).toEqual([
      { fillingId: "f-a", fillPercentage: 0, fillGrams: 3, sortOrder: 0 },
      { fillingId: "f-b", fillPercentage: 0, fillGrams: 2, sortOrder: 1 },
    ]);
  });
});

describe("PRODUCT_TEMPLATE_COLUMNS", () => {
  it("includes the key relational columns", () => {
    expect(PRODUCT_TEMPLATE_COLUMNS).toContain("shellIngredient");
    expect(PRODUCT_TEMPLATE_COLUMNS).toContain("defaultMould");
    expect(PRODUCT_TEMPLATE_COLUMNS).toContain("productCategory");
    expect(PRODUCT_TEMPLATE_COLUMNS).toContain("fillings");
    expect(PRODUCT_TEMPLATE_COLUMNS).not.toContain("shellDesign");
  });
});
