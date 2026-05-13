"use client";

import { useState } from "react";
import {
  useIngredients,
  saveMachineLoad,
  saveEquipmentInstance,
} from "@/lib/hooks";
import { newId } from "@/lib/supabase";
import type { EquipmentInstance, MachineLoad } from "@/types";

/**
 * Modal for loading/unloading/switching chocolate in a tempering
 * machine. Writes a new machineLoads row + flips the instance's
 * status when needed.
 */
export function MachineLoadModal({
  instance,
  activeLoad,
  onClose,
}: {
  instance: EquipmentInstance;
  activeLoad?: MachineLoad;
  onClose: () => void;
}) {
  const ingredients = useIngredients();
  const chocolateOptions = ingredients.filter((i) => !i.archived);

  const [action, setAction] = useState<"load" | "drain" | "switch">(
    activeLoad ? "drain" : "load",
  );
  const [ingredientId, setIngredientId] = useState("");
  const [qtyG, setQtyG] = useState<number>(10000);
  const [busy, setBusy] = useState(false);

  async function apply() {
    if (!instance.id) return;
    setBusy(true);
    try {
      if (action === "load") {
        if (!ingredientId) return;
        await saveMachineLoad({
          id: newId(),
          equipmentInstanceId: instance.id,
          ingredientId,
          loadedQuantityG: qtyG,
          remainingQuantityG: qtyG,
          loadedAt: new Date(),
          status: "in_use",
          agingAlertThresholdDays: 7,
        });
        await saveEquipmentInstance({
          ...instance,
          status: "running",
        });
      } else if (action === "drain" && activeLoad) {
        await saveMachineLoad({
          ...activeLoad,
          remainingQuantityG: 0,
          status: "idle",
          lastUsedAt: new Date(),
        });
        await saveEquipmentInstance({ ...instance, status: "idle" });
      } else if (action === "switch" && activeLoad) {
        if (!ingredientId) return;
        await saveMachineLoad({
          ...activeLoad,
          status: "switched",
          lastUsedAt: new Date(),
        });
        await saveMachineLoad({
          id: newId(),
          equipmentInstanceId: instance.id,
          ingredientId,
          loadedQuantityG: qtyG,
          remainingQuantityG: qtyG,
          loadedAt: new Date(),
          status: "in_use",
          agingAlertThresholdDays: 7,
        });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-md mx-4 border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] shadow-xl"
        style={{ borderRadius: 4 }}
      >
        <header className="px-5 pt-4 pb-3 border-b border-[color:var(--ds-border-warm)]">
          <h3
            className="text-[16px]"
            style={{
              fontFamily: "var(--font-serif)",
              fontWeight: 500,
              letterSpacing: "-0.015em",
            }}
          >
            {instance.name}
          </h3>
          <p className="text-[11px] text-muted-foreground">
            {activeLoad
              ? `Currently loaded — manage chocolate`
              : `Idle — load chocolate`}
          </p>
        </header>

        <div className="px-5 py-4 space-y-3">
          {/* Action picker */}
          <div className="flex gap-2">
            {(["load", "drain", "switch"] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAction(a)}
                disabled={a !== "load" && !activeLoad}
                className={
                  "flex-1 border px-3 py-1.5 text-[12px] capitalize disabled:opacity-40 " +
                  (action === a
                    ? "bg-foreground text-background border-foreground"
                    : "bg-[color:var(--ds-card-bg)] border-[color:var(--ds-border-warm)] hover:border-foreground")
                }
                style={{ borderRadius: 3 }}
              >
                {a}
              </button>
            ))}
          </div>

          {/* Fields per action */}
          {action === "drain" ? (
            <p className="text-[12.5px] text-muted-foreground italic" style={{ fontFamily: "var(--font-serif)" }}>
              Drain the remaining chocolate out of the machine. Sets the
              machine to idle.
            </p>
          ) : (
            <>
              <div>
                <label className="label">Chocolate</label>
                <select
                  className="input"
                  value={ingredientId}
                  onChange={(e) => setIngredientId(e.target.value)}
                >
                  <option value="">—</option>
                  {chocolateOptions.map((ing) => (
                    <option key={ing.id} value={ing.id}>
                      {ing.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Quantity (grams)</label>
                <input
                  type="number"
                  min={0}
                  step={100}
                  className="input"
                  value={qtyG}
                  onChange={(e) => setQtyG(Math.max(0, Number(e.target.value) || 0))}
                />
              </div>
            </>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-[color:var(--ds-border-warm)] flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={busy || (action !== "drain" && !ingredientId)}
            className="btn-primary"
          >
            {busy
              ? "…"
              : action === "load"
                ? "Load chocolate"
                : action === "drain"
                  ? "Drain"
                  : "Switch"}
          </button>
        </footer>
      </div>
    </div>
  );
}
