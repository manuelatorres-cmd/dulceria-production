"use client";

import { useState } from "react";
import { IconBuildingWarehouse as Warehouse, IconSnowflake as Snowflake, IconTrash as Trash2 } from "@tabler/icons-react";
import { DsModalShell, DsButton } from "@/components/dulceria";

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

  function select(d: SurplusDestination) {
    setPending(d);
    onConfirm(d);
  }

  return (
    <DsModalShell
      open
      title={`Surplus: ${surplusPieces} piece${surplusPieces === 1 ? "" : "s"}`}
      subtitle="This batch produced more than the linked orders need. Where should the extras go?"
      onClose={onCancel}
      footer={<DsButton onClick={onCancel}>Decide later</DsButton>}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SurplusChoice
          icon={<Warehouse size={18} />}
          label="Send to Store"
          description="Available for walk-in sales."
          onClick={() => select("store")}
          active={pending === "store"}
        />
        <SurplusChoice
          icon={<Snowflake size={18} />}
          label="Freeze"
          description="Preserve for a future order."
          onClick={() => select("freezer")}
          active={pending === "freezer"}
        />
        <SurplusChoice
          icon={<Trash2 size={18} />}
          label="Waste"
          description="Log as production loss."
          onClick={() => select("waste")}
          active={pending === "waste"}
        />
      </div>
    </DsModalShell>
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
      className="w-full flex items-center gap-3 rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-3 py-3 text-left hover:border-primary hover:bg-[color:var(--ds-tint-info)] transition-colors disabled:opacity-60"
    >
      <div className="w-9 h-9 rounded-[4px] bg-[color:var(--ds-tint-info)] text-primary flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}
