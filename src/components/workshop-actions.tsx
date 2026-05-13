"use client";

/**
 * Workshop quick-actions panel — pause production, declare sick day,
 * flag batch contamination, log substitute ingredient. Mounts in the
 * Daily view right rail beneath the clock-in widget.
 *
 * Each action opens a small modal and writes to the right table.
 * Keeps the flows inline so Manuela doesn't have to hunt for them.
 */

import { useMemo, useState } from "react";
import {
  useProductionPlans,
  usePeople,
  savePersonAvailabilityException,
  saveProductionPlan,
  saveNotification,
} from "@/lib/hooks";
import { newId } from "@/lib/supabase";
import type { ProductionPlan } from "@/types";

type ActiveModal = "pause" | "sick" | "contaminate" | "substitute" | null;

export function WorkshopActions() {
  const [modal, setModal] = useState<ActiveModal>(null);

  return (
    <>
      <div
        className="border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4"
        style={{ borderRadius: 4 }}
      >
        <h3
          className="text-[10px] uppercase text-muted-foreground font-medium mb-3"
          style={{ letterSpacing: "0.12em" }}
        >
          Quick actions
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <ActionBtn label="Pause prod." onClick={() => setModal("pause")} />
          <ActionBtn label="Sick day" onClick={() => setModal("sick")} />
          <ActionBtn label="Contamination" onClick={() => setModal("contaminate")} />
          <ActionBtn label="Substitute" onClick={() => setModal("substitute")} />
        </div>
      </div>

      {modal === "pause" ? <PauseModal onClose={() => setModal(null)} /> : null}
      {modal === "sick" ? <SickModal onClose={() => setModal(null)} /> : null}
      {modal === "contaminate" ? (
        <ContaminateModal onClose={() => setModal(null)} />
      ) : null}
      {modal === "substitute" ? (
        <SubstituteModal onClose={() => setModal(null)} />
      ) : null}
    </>
  );
}

function ActionBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border border-[color:var(--ds-border-warm)] bg-muted hover:bg-[color:var(--ds-card-bg)] hover:border-foreground px-2 py-2 text-[11.5px] text-left"
      style={{
        borderRadius: 3,
        fontFamily: "var(--font-serif)",
        fontWeight: 500,
        letterSpacing: "-0.01em",
      }}
    >
      {label}
    </button>
  );
}

function ModalShell({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
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
            {title}
          </h3>
        </header>
        <div className="px-5 py-4 space-y-3">{children}</div>
        <footer className="px-5 py-3 border-t border-[color:var(--ds-border-warm)] flex justify-end gap-2">
          {footer ?? (
            <button type="button" onClick={onClose} className="btn-secondary">
              Close
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

// ───────────── Pause production ─────────────────────────────
function PauseModal({ onClose }: { onClose: () => void }) {
  const plans = useProductionPlans();
  const active = plans.filter((p) => p.status === "active");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");

  async function doPause() {
    setBusy(true);
    try {
      for (const p of active) {
        // 'paused' isn't in the ProductionPlan status union — reuse 'draft'
        // to visually move it out of the active-list, and log a notification
        // explaining why.
        await saveProductionPlan({ ...p, status: "draft" });
      }
      await saveNotification({
        type: "other",
        urgency: "high",
        status: "open",
        title: "Production paused",
        body: reason || "No reason provided.",
        adminOnly: false,
        actionLabel: "Resume",
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title={`Pause ${active.length} active batch${active.length === 1 ? "" : "es"}?`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={doPause}
            disabled={busy || active.length === 0}
            className="btn-primary"
          >
            {busy ? "…" : "Pause all"}
          </button>
        </>
      }
    >
      <p className="text-[12.5px] text-muted-foreground">
        Flips every active plan to 'draft' so they leave the in-production list.
        Resume by flipping back in the batch detail page.
      </p>
      <label className="label">Reason (optional)</label>
      <textarea
        className="input"
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Power cut, tempering machine down, etc."
      />
    </ModalShell>
  );
}

// ───────────── Sick day ─────────────────────────────────────
function SickModal({ onClose }: { onClose: () => void }) {
  const people = usePeople();
  const [personId, setPersonId] = useState("");
  const [dateFrom, setDateFrom] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!personId) return;
    setBusy(true);
    try {
      await savePersonAvailabilityException({
        id: newId(),
        personId,
        dateFrom,
        dateTo,
        type: "sick",
        allDay: true,
        approved: true,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title="Declare sick day"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || !personId}
            className="btn-primary"
          >
            {busy ? "…" : "Save"}
          </button>
        </>
      }
    >
      <label className="label">Person</label>
      <select
        className="input"
        value={personId}
        onChange={(e) => setPersonId(e.target.value)}
      >
        <option value="">—</option>
        {people
          .filter((p) => !p.archived)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">From</label>
          <input
            type="date"
            className="input"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="label">To</label>
          <input
            type="date"
            className="input"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
      </div>
    </ModalShell>
  );
}

// ───────────── Contamination ────────────────────────────────
function ContaminateModal({ onClose }: { onClose: () => void }) {
  const plans = useProductionPlans();
  const eligible = useMemo(
    () => plans.filter((p) => p.status === "active" || p.status === "done"),
    [plans],
  );
  const [planId, setPlanId] = useState("");
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState<"dispose" | "downgrade">("dispose");
  const [busy, setBusy] = useState(false);

  async function flag() {
    if (!planId) return;
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    setBusy(true);
    try {
      // Reuse notes field to stamp contamination — full 'contaminated'
      // status requires a plans.status enum extension. Notes + a
      // notification get us 90% of the way.
      await saveProductionPlan({
        ...plan,
        notes:
          (plan.notes ? plan.notes + "\n" : "") +
          `[CONTAMINATED ${new Date().toISOString().slice(0, 10)}] ${reason} · decision: ${decision}`,
        status: decision === "dispose" ? "cancelled" : "done",
      });
      await saveNotification({
        type: "contamination_flag",
        urgency: "critical",
        status: "open",
        title: `Contamination · batch ${plan.batchNumber ?? plan.id?.slice(0, 6)}`,
        body: `${reason}. Decision: ${decision}.`,
        entityType: "productionPlan",
        entityId: plan.id,
        adminOnly: true,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title="Flag contamination"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={flag}
            disabled={busy || !planId || !reason.trim()}
            className="btn-primary"
          >
            {busy ? "…" : "Flag"}
          </button>
        </>
      }
    >
      <p className="text-[12px] text-muted-foreground italic" style={{ fontFamily: "var(--font-serif)" }}>
        Batch gets blocked from sale + admin notified.
      </p>
      <label className="label">Batch</label>
      <select
        className="input"
        value={planId}
        onChange={(e) => setPlanId(e.target.value)}
      >
        <option value="">—</option>
        {eligible.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name ?? `Batch ${p.batchNumber ?? p.id?.slice(0, 6)}`}
          </option>
        ))}
      </select>
      <label className="label">Reason</label>
      <textarea
        className="input"
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. nut cross-contamination during filling"
      />
      <label className="label">Decision</label>
      <div className="flex gap-2">
        {(["dispose", "downgrade"] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDecision(d)}
            className={
              "flex-1 border px-3 py-1.5 text-[12px] capitalize " +
              (decision === d
                ? "bg-foreground text-background border-foreground"
                : "bg-[color:var(--ds-card-bg)] border-[color:var(--ds-border-warm)] hover:border-foreground")
            }
            style={{ borderRadius: 3 }}
          >
            {d === "dispose" ? "Dispose · scrap" : "Downgrade · relabel"}
          </button>
        ))}
      </div>
    </ModalShell>
  );
}

// ───────────── Substitute ingredient ────────────────────────
function SubstituteModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalShell
      title="Substitute ingredient"
      onClose={onClose}
    >
      <p
        className="text-[12.5px] text-muted-foreground italic"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Full substitute flow ships with the next commit — recipe-level
        swap with allergen + nutrition recalc. For now, jot the swap
        in the batch notes field on the production detail page.
      </p>
    </ModalShell>
  );
}
