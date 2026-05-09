"use client";

import { useState, useEffect } from "react";
import { ArrowRight, X } from "lucide-react";
import type { DraftBatch, SurplusDestination } from "@/lib/manual-planner/draft-state";

export interface PoFillOption {
  poItemId: string;
  poName: string;
  /** Pieces still owed to this PO. */
  remaining: number;
  /** Total pieces on the PO line — for the "covers X%" detail. */
  originalQty: number;
}

export interface FillMouldChoice {
  surplusDestination: SurplusDestination;
  /** Set when surplusDestination === 'po-fill'. */
  poFillPick: { poItemId: string; poName: string; qty: number } | null;
}

export function FillMouldModal({
  draft,
  availablePos,
  currentStock,
  onCancel,
  onConfirm,
}: {
  draft: DraftBatch;
  availablePos: PoFillOption[];
  currentStock: number;
  onCancel: () => void;
  onConfirm: (choice: FillMouldChoice) => void;
}) {
  type SelectedKey = "po-fill" | "store" | "decide-later";
  const [selected, setSelected] = useState<SelectedKey>(
    availablePos.length > 0 ? "po-fill" : "store",
  );
  const [poChoice, setPoChoice] = useState<string | null>(
    availablePos.length > 0 ? availablePos[0].poItemId : null,
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function confirm() {
    if (selected === "po-fill" && poChoice) {
      const po = availablePos.find((p) => p.poItemId === poChoice);
      if (!po) return;
      const qty = Math.min(draft.surplus, po.remaining);
      onConfirm({
        surplusDestination: "po-fill",
        poFillPick: { poItemId: po.poItemId, poName: po.poName, qty },
      });
      return;
    }
    if (selected === "store") {
      onConfirm({ surplusDestination: "store", poFillPick: null });
      return;
    }
    onConfirm({ surplusDestination: null, poFillPick: null });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Fill mould — choose surplus destination"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.35)" }}
    >
      <div
        className="manual-planner-v2 w-full max-w-md"
        style={{
          background: "var(--mp-card-bg)",
          border: "0.5px solid var(--mp-border-warm)",
          borderRadius: 8,
          color: "var(--mp-text-primary)",
        }}
      >
        <div
          className="px-5 pt-4 pb-3 flex items-start justify-between gap-2"
          style={{ borderBottom: "0.5px solid var(--mp-border-warm)" }}
        >
          <div>
            <h2
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: 18,
                fontWeight: 600,
                marginBottom: 2,
              }}
            >
              {draft.productName} · {draft.numberOfCavities}-cav mould
            </h2>
            <p className="text-[12px] italic" style={{ color: "var(--mp-text-muted)" }}>
              Mould produces {draft.totalPieces} pcs per run. You have {draft.totalDemand} pcs
              selected = {draft.surplus} pcs surplus. How to use the rest?
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="close"
            style={{ color: "var(--mp-text-muted)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-2">
          {availablePos.length > 0 && (
            <div>
              <OptionCard
                title={`Fill from PO${availablePos.length > 1 ? "s" : ""}`}
                subtitle="(recommended)"
                detail={
                  poChoice
                    ? buildPoDetail(
                        availablePos.find((p) => p.poItemId === poChoice),
                        draft.surplus,
                      )
                    : "pick a PO below"
                }
                selected={selected === "po-fill"}
                recommended
                onClick={() => setSelected("po-fill")}
              />
              {selected === "po-fill" && availablePos.length > 1 && (
                <ul className="mt-1.5 ml-3 space-y-1">
                  {availablePos.map((p) => (
                    <li key={p.poItemId}>
                      <label className="flex items-center gap-2 text-[12px]">
                        <input
                          type="radio"
                          name="po-fill-choice"
                          checked={poChoice === p.poItemId}
                          onChange={() => setPoChoice(p.poItemId)}
                        />
                        <span style={{ color: "var(--mp-text-primary)" }}>{p.poName}</span>
                        <span className="tabular-nums" style={{ color: "var(--mp-text-muted)" }}>
                          · {p.remaining} pcs open
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <OptionCard
            title="Add to stock"
            detail={`${draft.surplus} pcs to inventory · current ${currentStock} → ${currentStock + draft.surplus}`}
            selected={selected === "store"}
            onClick={() => setSelected("store")}
          />

          <OptionCard
            title="Decide at unmould"
            detail={`Make full ${draft.totalPieces}, choose store / freezer / waste at unmould time.`}
            selected={selected === "decide-later"}
            onClick={() => setSelected("decide-later")}
          />
        </div>

        <div
          className="px-5 py-3 flex items-center justify-end gap-2"
          style={{ borderTop: "0.5px solid var(--mp-border-warm)" }}
        >
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-[12px]"
            style={{
              border: "0.5px solid var(--mp-border-warm)",
              background: "var(--mp-card-bg)",
              color: "var(--mp-text-primary)",
              borderRadius: 4,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={selected === "po-fill" && !poChoice}
            className="px-3 py-1.5 text-[12px] inline-flex items-center gap-1"
            style={{
              border: "0.5px solid var(--mp-teal)",
              background: "var(--mp-teal)",
              color: "#ffffff",
              borderRadius: 4,
              opacity: selected === "po-fill" && !poChoice ? 0.5 : 1,
            }}
          >
            Use selection <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function buildPoDetail(po: PoFillOption | undefined, surplus: number): string {
  if (!po) return "";
  const taken = Math.min(po.remaining, surplus);
  const pct = po.originalQty > 0 ? Math.round((taken / po.originalQty) * 100) : 0;
  return `${taken} pcs toward ${po.originalQty} pc PO · covers ${pct}%`;
}

function OptionCard({
  title,
  subtitle,
  detail,
  selected,
  recommended,
  onClick,
}: {
  title: string;
  subtitle?: string;
  detail: string;
  selected: boolean;
  recommended?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-3 py-2.5"
      style={{
        background: selected
          ? recommended
            ? "var(--mp-draft-tint)"
            : "var(--mp-hover-bg)"
          : "var(--mp-card-bg)",
        border: `1px solid ${selected ? (recommended ? "var(--mp-draft-border)" : "var(--mp-teal)") : "var(--mp-border-warm)"}`,
        borderRadius: 6,
      }}
    >
      <div className="flex items-baseline gap-1.5">
        {selected && (
          <ArrowRight className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--mp-teal)" }} />
        )}
        <span className="text-[13px]" style={{ fontWeight: 500 }}>
          {title}
        </span>
        {subtitle && (
          <span className="text-[11px] italic" style={{ color: "var(--mp-text-muted)" }}>
            {subtitle}
          </span>
        )}
      </div>
      <p className="text-[11.5px] mt-0.5" style={{ color: "var(--mp-text-muted)" }}>
        {detail}
      </p>
    </button>
  );
}
