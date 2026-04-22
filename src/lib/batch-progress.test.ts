import { describe, it, expect } from "vitest";
import { batchPhaseProgress } from "./batch-progress";
import type { PlanStepStatus } from "@/types";

function status(planId: string, key: string, done: boolean): PlanStepStatus {
  return { planId, stepKey: key, done };
}

describe("batchPhaseProgress", () => {
  it("returns Polishing 1/8 when no steps have been recorded yet", () => {
    const r = batchPhaseProgress("p1", []);
    expect(r).toMatchObject({ index: 1, total: 8, phase: "polishing", label: "Polishing", done: false });
  });

  it("stays on the current phase while it still has pending rows", () => {
    const r = batchPhaseProgress("p1", [
      status("p1", "polishing-x", true),
      status("p1", "colour-task-a", true),
      status("p1", "colour-task-b", false),
    ]);
    expect(r).toMatchObject({ index: 2, phase: "colour", label: "Painting", done: false });
  });

  it("advances past a fully-done phase when the next phase has no rows yet", () => {
    const r = batchPhaseProgress("p1", [
      status("p1", "polishing-a", true),
      status("p1", "polishing-b", true),
    ]);
    expect(r).toMatchObject({ index: 2, phase: "colour" });
  });

  it("lands on Shelling (3/8) after Polishing and Painting are complete", () => {
    const r = batchPhaseProgress("p1", [
      status("p1", "polishing-a", true),
      status("p1", "colour-task", true),
    ]);
    expect(r).toMatchObject({ index: 3, phase: "shell", label: "Shelling" });
  });

  it("reports done=true with Packing 8/8 once every phase is complete", () => {
    const r = batchPhaseProgress("p1", [
      status("p1", "polishing-a", true),
      status("p1", "colour-task", true),
      status("p1", "shell-task", true),
      status("p1", "filling-task", true),
      status("p1", "fill-task", true),
      status("p1", "cap-task", true),
      status("p1", "unmould-task", true),
      status("p1", "packing-task", true),
    ]);
    expect(r).toMatchObject({ index: 8, total: 8, phase: "packing", label: "Packing", done: true });
  });

  it("ignores rows belonging to a different plan", () => {
    const r = batchPhaseProgress("p1", [
      status("other", "polishing-x", true),
      status("other", "colour-x", true),
    ]);
    expect(r).toMatchObject({ index: 1, phase: "polishing" });
  });

  it("ignores rows with an unknown phase prefix (defensive)", () => {
    const r = batchPhaseProgress("p1", [
      status("p1", "bogus-key", true),
      status("p1", "transfer-x", true), // must not slip in
    ]);
    expect(r).toMatchObject({ index: 1, phase: "polishing" });
  });
});
