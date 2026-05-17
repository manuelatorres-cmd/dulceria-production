"use client";

/**
 * Inline hint shown above the active draft when another parked or
 * active draft uses the same mould. Spec §3.5.
 *
 * Clicking "Merge" calls mergeDrafts(activeDraft, otherPlanId) and
 * replaces the active draft state with the combined result.
 */

import { useState } from "react";
import type { DraftBatch } from "@/lib/manual-planner/draft-state";
import type { DraftPlanCard } from "@/lib/hooks";
import { mergeDrafts } from "@/lib/manual-planner/merge-drafts";

export function CombineHintCard({
  activeDraft,
  otherDrafts,
  onMerged,
}: {
  activeDraft: DraftBatch | null;
  otherDrafts: DraftPlanCard[];
  /** Caller updates active draft state with the merged result. */
  onMerged: (merged: DraftBatch) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!activeDraft) return null;
  // Find every parked composition draft that shares the same mould
  // but is a different plan from the active one. Source list is
  // already filtered by isCompositionDraft in useDraftPlans (hotfix
  // 2026-05-18), so regenerate-seeded "PO: ..." / "Campaign: ..."
  // rows can't pollute candidates here.
  const candidates = otherDrafts
    .filter(
      (d) =>
        d.numberOfCavities === activeDraft.numberOfCavities &&
        d.mouldName === activeDraft.mouldName &&
        d.planId !== activeDraft.id,
    )
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  if (candidates.length === 0) return null;
  // Spec §4 step 3: show ONE card pointing to the most-recently-updated
  // match. Drop the rest to avoid the "stack of hint cards" bug.
  const top = candidates[0];

  async function handleMerge(planId: string): Promise<void> {
    if (!activeDraft) return;
    setBusy(true);
    setErr(null);
    try {
      const merged = await mergeDrafts(activeDraft, planId);
      onMerged(merged);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        background: "var(--mp-today-tint)",
        border: "1px solid var(--mp-draft-border, #dab73f)",
        borderRadius: 6,
        padding: "8px 12px",
        marginBottom: 8,
        fontSize: 12,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <span style={{ fontWeight: 600 }}>💡 Combine?</span>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "2px 0",
        }}
      >
        <span style={{ flex: 1 }}>
          <strong>{top.productName}</strong>{" "}
          <span style={{ color: "var(--mp-text-muted)" }}>
            ({top.numberOfCavities}-cav · {top.totalDemand} pcs)
          </span>{" "}
          could be combined with this batch.
          {candidates.length > 1 ? (
            <span style={{ color: "var(--mp-text-muted)", marginLeft: 4 }}>
              (+{candidates.length - 1} more in pool)
            </span>
          ) : null}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => { void handleMerge(top.planId); }}
          style={{
            padding: "3px 10px",
            borderRadius: 4,
            border: "1px solid var(--mp-teal, #1c5651)",
            background: "var(--mp-teal, #1c5651)",
            color: "#fff",
            fontSize: 11,
            fontWeight: 600,
            cursor: busy ? "wait" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {busy ? "Merging…" : "Merge?"}
        </button>
      </div>
      {err ? (
        <span style={{ color: "var(--mp-rose, #993556)", fontSize: 11 }}>{err}</span>
      ) : null}
    </div>
  );
}
