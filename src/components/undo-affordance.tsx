"use client";

import { useCallback, useEffect, useState } from "react";
import { IconRotate as RotateCcw } from "@tabler/icons-react";
import {
  useLastUndoableIngredientMovement,
  undoIngredientStockMovement,
  useIngredients,
} from "@/lib/hooks";

/**
 * Floating "Undo last stock change" affordance. Appears bottom-right
 * on every app page when the most recent ingredient stock movement
 * was made in the last 10 minutes and hasn't already been undone.
 *
 * Scope note: this only covers ingredient stock movements — the
 * common "oh wait, I ticked the wrong step" case. Product-stock and
 * filling-stock reversals are out of scope for this pass; unticking
 * a step doesn't auto-revert either.
 */
export function UndoAffordance() {
  const mv = useLastUndoableIngredientMovement();
  const ingredients = useIngredients(false);
  const ingredientName = mv
    ? ingredients.find((i) => i.id === mv.ingredientId)?.name ?? "an ingredient"
    : null;
  const [busy, setBusy] = useState(false);
  const [justDone, setJustDone] = useState(false);

  const handleUndo = useCallback(async () => {
    if (!mv?.id || busy) return;
    setBusy(true);
    try {
      await undoIngredientStockMovement(mv.id);
      setJustDone(true);
      setTimeout(() => setJustDone(false), 2500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`Undo failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }, [mv?.id, busy]);

  // Cmd/Ctrl+Z shortcut — only when focus is NOT on a form input
  // (otherwise we'd interfere with native text-field undo).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      if (e.shiftKey) return; // leave redo to browser
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      if (!mv?.id) return;
      e.preventDefault();
      handleUndo();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mv?.id, handleUndo]);

  if (justDone) {
    return (
      <div className="fixed bottom-4 right-4 z-40 rounded-full bg-status-ok text-white px-4 py-2 text-xs font-medium shadow-lg">
        Undone.
      </div>
    );
  }

  if (!mv) return null;

  const delta = Number(mv.deltaG);
  const absDelta = Math.abs(delta).toLocaleString("en-GB", { maximumFractionDigits: 1 });
  const verb = delta < 0 ? `Deducted ${absDelta}g` : `Added ${absDelta}g`;
  const label = `${verb} of ${ingredientName} · ${mv.reason.replace(/_/g, " ")}`;

  return (
    <button
      onClick={handleUndo}
      disabled={busy}
      title={`${label} — click or press Ctrl+Z to undo.`}
      className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-sm border border-border bg-card shadow-lg px-3 py-2 text-xs font-medium hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
    >
      <RotateCcw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
      <span className="truncate max-w-[42ch]">
        Undo: {verb} {ingredientName}
      </span>
    </button>
  );
}
