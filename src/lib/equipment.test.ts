import { describe, it, expect } from "vitest";
import { equipmentAvailability, equipmentReadiness } from "./equipment";
import type { Equipment } from "@/types";

const base = (over: Partial<Equipment> = {}): Equipment => ({
  name: "Tempering A",
  kind: "tempering",
  quantity: 1,
  kgPerHour: 5,
  ...over,
});

describe("equipmentAvailability", () => {
  it("returns 'archived' when archived, regardless of assignments", () => {
    expect(equipmentAvailability(base({ archived: true, currentPlanId: "p-1" }))).toBe("archived");
  });

  it("returns 'in_use' when a plan or schedule row is assigned", () => {
    expect(equipmentAvailability(base({ currentPlanId: "p-1" }))).toBe("in_use");
    expect(equipmentAvailability(base({ currentScheduleId: "s-1" }))).toBe("in_use");
  });

  it("returns 'available' otherwise", () => {
    expect(equipmentAvailability(base())).toBe("available");
  });
});

describe("equipmentReadiness", () => {
  it("flags empty list as incomplete", () => {
    const r = equipmentReadiness([]);
    expect(r.isComplete).toBe(false);
    expect(r.incompleteCount).toBe(0);
  });

  it("is complete when every active row has quantity + kgPerHour > 0", () => {
    const r = equipmentReadiness([base(), base({ name: "Coater" })]);
    expect(r.isComplete).toBe(true);
    expect(r.incompleteCount).toBe(0);
  });

  it("counts incomplete active rows", () => {
    const r = equipmentReadiness([
      base(),
      base({ name: "No qty", quantity: undefined }),
      base({ name: "No rate", kgPerHour: undefined }),
    ]);
    expect(r.isComplete).toBe(false);
    expect(r.incompleteCount).toBe(2);
  });

  it("ignores archived rows for readiness", () => {
    const r = equipmentReadiness([
      base({ archived: true, quantity: undefined, kgPerHour: undefined }),
      base(),
    ]);
    expect(r.isComplete).toBe(true);
    expect(r.incompleteCount).toBe(0);
  });

  it("treats non-positive values as incomplete", () => {
    const r = equipmentReadiness([base({ quantity: 0, kgPerHour: 0 })]);
    expect(r.isComplete).toBe(false);
    expect(r.incompleteCount).toBe(1);
  });
});
