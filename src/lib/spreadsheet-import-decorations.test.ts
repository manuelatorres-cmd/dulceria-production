import { describe, it, expect } from "vitest";
import { mapDecorationRow, validateDecorationRow, DECORATION_TEMPLATE_COLUMNS } from "./spreadsheet-import-decorations";

describe("mapDecorationRow", () => {
  it("parses a cocoa butter row with a type", () => {
    const result = mapDecorationRow({
      name: "Gold Shimmer",
      type: "cocoa_butter",
      cocoaButterType: "Type B",
      color: "#C9A959",
      manufacturer: "Roxy & Rich",
      vendor: "Keylink",
      source: "keylink.co.uk",
      notes: "",
    });
    expect(result.name).toBe("Gold Shimmer");
    expect(result.type).toBe("cocoa_butter");
    expect(result.cocoaButterType).toBe("Type B");
    expect(result.color).toBe("#C9A959");
  });
});

describe("validateDecorationRow", () => {
  it("requires name and type", () => {
    const issues = validateDecorationRow({ name: "", type: "" as never });
    expect(issues.find((i) => i.field === "name")?.severity).toBe("error");
    expect(issues.find((i) => i.field === "type")?.severity).toBe("error");
  });

  it("errors on an unknown type", () => {
    const issues = validateDecorationRow({ name: "X", type: "glitter" as never });
    expect(issues.find((i) => i.field === "type")?.severity).toBe("error");
  });

  it("warns if cocoaButterType is set on a non-cocoa-butter material", () => {
    const issues = validateDecorationRow({
      name: "Some dust",
      type: "lustre_dust",
      cocoaButterType: "Type A",
    });
    expect(issues.find((i) => i.field === "cocoaButterType")?.severity).toBe("warning");
  });
});

describe("DECORATION_TEMPLATE_COLUMNS", () => {
  it("includes the key fields", () => {
    expect(DECORATION_TEMPLATE_COLUMNS).toContain("type");
    expect(DECORATION_TEMPLATE_COLUMNS).toContain("cocoaButterType");
  });
});
