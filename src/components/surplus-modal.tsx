"use client";

import { useEffect, useState } from "react";
import { Warehouse, Snowflake, Trash2 } from "lucide-react";

export type SurplusDestination = "store" | "freezer" | "waste";

/**
 * Prompt shown after unmould when a batch produced more pieces than
 * were allocated to order lines. The operator picks where the extras
 * go; the choice is saved on `productionPlans.surplusDestination`.
 *
 * IMPORTANT: this modal does NOT write to stock. Recording the actual
 * stock move is a separate concern handled by the stock-rewrite task.
 * Here we only capture the operator's intent.
 */
export function SurplusModal({ surplusPieces, onConfirm, onCancel }: {
  surplusPieces: number;
  onConfirm: (destination: SurplusDestination) => void;
  onCancel: () => void;
}) {
  const [pending, setPending] = useState<SurplusDestination | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  function select(d: SurplusDestination) {
    setPending(d);
    onConfirm(d);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onCancel} />
      <div className="relative w-full max-w-md mx-4 mb-4 sm:mb-0 rounded-2xl border border-border bg-card shadow-xl overflow-hidden">
        <div className="bg-gradient-to-b from-amber-50 to-card px-5 pt-5 pb-3">
          <h3 className="text-base font-bold text-foreground">Surplus: {surplusPieces} piece{surplusPieces === 1 ? "" : "s"}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            This batch produced more than the linked orders need. Where should the extras go?
          </p>
        </div>

        <div className="px-5 py-4 space-y-2">
          <SurplusChoice
            icon={<Warehouse className="w-5 h-5" />}
            label="Send to Store"
            description="Available for walk-in sales."
            onClick={() => select("store")}
            active={pending === "store"}
          />
          <SurplusChoice
            icon={<Snowflake className="w-5 h-5" />}
            label="Freeze"
            description="Preserve for a future order."
            onClick={() => select("freezer")}
            active={pending === "freezer"}
          />
          <SurplusChoice
            icon={<Trash2 className="w-5 h-5" />}
            label="Waste"
            description="Log as production loss."
            onClick={() => select("waste")}
            active={pending === "waste"}
          />
        </div>

        <div className="px-5 py-4 border-t border-border flex justify-end">
          <button
            onClick={onCancel}
            className="rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          >
            Decide later
          </button>
        </div>
      </div>
    </div>
  );
}

function SurplusChoice({ icon, label, description, onClick, active }: {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
  active: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={active}
      className="w-full flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 text-left hover:border-primary hover:bg-primary/5 transition-colors disabled:opacity-60"
    >
      <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}
