import { describe, it, expect } from "vitest";
import { parseCsvRow, parseCsvText, parseShopifyCsv } from "./shopifyImport";
import type { Product } from "@/types";

function p(id: string, name: string, sku?: string): Product {
  return {
    id,
    name,
    createdAt: new Date(),
    updatedAt: new Date(),
    // sku lives outside the canonical Product type today but the parser
    // reads it via an `unknown` cast so a future schema migration can add
    // it without touching this file.
    ...(sku ? { sku } : {}),
  } as Product;
}

describe("parseCsvRow", () => {
  it("splits a plain row on commas", () => {
    expect(parseCsvRow("a,b,c")).toEqual(["a", "b", "c"]);
  });
  it("preserves commas inside quoted fields", () => {
    expect(parseCsvRow('"a,b",c,"d,e"')).toEqual(["a,b", "c", "d,e"]);
  });
  it("unescapes doubled quotes", () => {
    expect(parseCsvRow('"she said ""hi""",x')).toEqual(['she said "hi"', "x"]);
  });
  it("trims whitespace around unquoted cells", () => {
    expect(parseCsvRow("a ,  b ,c")).toEqual(["a", "b", "c"]);
  });
});

describe("parseCsvText", () => {
  it("keeps multi-line quoted fields as one row", () => {
    const input = '"a","line\none","b"\n"c","d","e"';
    const rows = parseCsvText(input);
    expect(rows).toHaveLength(2);
    expect(rows[0][1]).toBe("line\none");
  });
});

describe("parseShopifyCsv", () => {
  const products: Product[] = [
    p("p1", "Salted caramel bonbon", "SC-01"),
    p("p2", "Dark ganache bonbon"),
  ];

  it("reports missing required columns", () => {
    const result = parseShopifyCsv("Email,Total\nfoo@bar.com,10", { products });
    expect(result.missingRequiredColumns).toContain("Name");
    expect(result.orders).toHaveLength(0);
  });

  it("groups multiple line items under one order name", () => {
    const csv = [
      "Name,Email,Lineitem quantity,Lineitem name,Lineitem sku",
      "#1001,foo@bar.com,3,Salted caramel bonbon,SC-01",
      "#1001,,2,Dark ganache bonbon,",
      "#1002,bar@baz.com,5,Salted caramel bonbon,SC-01",
    ].join("\n");
    const result = parseShopifyCsv(csv, { products });
    expect(result.orders).toHaveLength(2);
    const first = result.orders.find((o) => o.name === "#1001")!;
    expect(first.email).toBe("foo@bar.com");
    expect(first.lineItems).toHaveLength(2);
    expect(first.lineItems[0].resolvedProductId).toBe("p1");
    expect(first.lineItems[1].resolvedProductId).toBe("p2");
  });

  it("flags unresolved line items with a reason", () => {
    const csv = [
      "Name,Lineitem quantity,Lineitem name,Lineitem sku",
      "#1001,3,Nonexistent bonbon,",
    ].join("\n");
    const result = parseShopifyCsv(csv, { products });
    const line = result.orders[0].lineItems[0];
    expect(line.resolvedProductId).toBeUndefined();
    expect(line.resolutionNote).toMatch(/no product named/i);
  });

  it("strips ' - variant' suffix when matching by name", () => {
    const csv = [
      "Name,Lineitem quantity,Lineitem name",
      "#1001,2,Dark ganache bonbon - Box of 9",
    ].join("\n");
    const result = parseShopifyCsv(csv, { products });
    expect(result.orders[0].lineItems[0].resolvedProductId).toBe("p2");
  });

  it("prefers SKU over name match", () => {
    const csv = [
      "Name,Lineitem quantity,Lineitem name,Lineitem sku",
      "#1001,2,Wrong name entirely,SC-01",
    ].join("\n");
    const result = parseShopifyCsv(csv, { products });
    expect(result.orders[0].lineItems[0].resolvedProductId).toBe("p1");
  });

  it("rolls up shipping address across split columns", () => {
    const csv = [
      "Name,Lineitem quantity,Lineitem name,Shipping Name,Shipping Address1,Shipping City,Shipping Country",
      "#1001,1,Salted caramel bonbon,Alice,123 Main,Vienna,Austria",
    ].join("\n");
    const result = parseShopifyCsv(csv, { products });
    expect(result.orders[0].shippingName).toBe("Alice");
    expect(result.orders[0].shippingAddress).toContain("123 Main");
    expect(result.orders[0].shippingAddress).toContain("Vienna");
  });

  it("rejects zero / negative quantities with a warning", () => {
    const csv = [
      "Name,Lineitem quantity,Lineitem name",
      "#1001,0,Salted caramel bonbon",
      "#1001,2,Dark ganache bonbon",
    ].join("\n");
    const result = parseShopifyCsv(csv, { products });
    const order = result.orders[0];
    expect(order.lineItems).toHaveLength(1);
    expect(order.warnings.some((w) => /invalid quantity/i.test(w))).toBe(true);
  });

  it("flags duplicate orders against existingOrderNames", () => {
    const csv = [
      "Name,Lineitem quantity,Lineitem name",
      "#1001,2,Salted caramel bonbon",
      "#1002,1,Dark ganache bonbon",
    ].join("\n");
    const result = parseShopifyCsv(csv, {
      products,
      existingOrderNames: new Set(["#1001"]),
    });
    expect(result.duplicateNames).toEqual(["#1001"]);
  });

  it("reports unknown columns as a soft warning", () => {
    const csv = [
      "Name,Lineitem quantity,Lineitem name,Completely Custom Col",
      "#1001,2,Salted caramel bonbon,abc",
    ].join("\n");
    const result = parseShopifyCsv(csv, { products });
    expect(result.unknownColumns).toContain("Completely Custom Col");
  });
});
