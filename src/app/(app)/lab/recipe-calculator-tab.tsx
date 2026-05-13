"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { IconPlus as Plus, IconTrash as Trash2, IconAlertTriangle as AlertTriangle, IconCircleCheckFilled as CheckCircle2, IconAlertCircle as AlertCircle, IconTemperature as Thermometer, IconInfoCircle as Info, IconExternalLink as ExternalLink } from "@tabler/icons-react";
import { useIngredients } from "@/lib/hooks";
import { ingredientsForCategories, missingComposition } from "@/lib/lab/ingredients";
import { RECIPE_TEMPLATES, RECIPE_TEMPLATE_BY_ID, type RecipeCategoryId, type RecipeSlot } from "@/lib/lab/recipe-templates";
import type { Ingredient } from "@/types";

interface SlotLine {
  /** index of slot in the template */
  slotIndex: number;
  ingredientId: string;
  grams: number;
}

export function RecipeCalculatorTab() {
  const ingredients = useIngredients();
  const [categoryId, setCategoryId] = useState<RecipeCategoryId>("ganache");
  const template = RECIPE_TEMPLATE_BY_ID[categoryId];
  const [lines, setLines] = useState<SlotLine[]>([]);

  const byId = useMemo<Record<string, Ingredient>>(() => {
    const out: Record<string, Ingredient> = {};
    for (const i of ingredients) if (i.id) out[i.id] = i;
    return out;
  }, [ingredients]);

  function changeCategory(id: RecipeCategoryId) {
    setCategoryId(id);
    setLines([]);
  }

  const total = lines.reduce((s, l) => s + (l.grams || 0), 0);

  const slotEvals = useMemo(() => {
    return template.slots.map((slot, slotIdx) => {
      const slotLines = lines.filter((l) => l.slotIndex === slotIdx);
      const sumG = slotLines.reduce((s, l) => s + (l.grams || 0), 0);
      const sumPct = total > 0 ? (sumG / total) * 100 : 0;
      const filled = slotLines.length > 0 && sumG > 0;
      let severity: "ok" | "warn" | "bad" | "missing" = "ok";
      if (!filled) {
        severity = slot.required ? "bad" : "missing";
      } else if (sumPct < slot.min || sumPct > slot.max) {
        severity = "warn";
      }
      return { slot, slotIdx, sumG, sumPct, severity, hasLines: filled };
    });
  }, [lines, template, total]);

  function addLineForSlot(slotIdx: number) {
    const slot = template.slots[slotIdx];
    const candidates = ingredientsForCategories(ingredients, slot.acceptCategories);
    const first = candidates[0];
    if (!first?.id) {
      setLines((prev) => [...prev, { slotIndex: slotIdx, ingredientId: "", grams: 0 }]);
      return;
    }
    setLines((prev) => [...prev, { slotIndex: slotIdx, ingredientId: first.id!, grams: 0 }]);
  }

  function updateLine(idx: number, patch: Partial<SlotLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  if (ingredients.length === 0) {
    return (
      <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-4 py-6 max-w-md">
        <p className="text-sm text-muted-foreground">
          No ingredients in your pantry yet. Add ingredients on the{" "}
          <Link href="/ingredients" className="text-primary underline">Ingredients</Link> page first.
        </p>
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-[260px_1fr] gap-6">
      {/* ── Left: category nav ──────────────────────────────────────── */}
      <aside>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
          Categories
        </h2>
        <ul className="space-y-1">
          {RECIPE_TEMPLATES.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => changeCategory(t.id)}
                className={`w-full text-left px-3 py-2 rounded-sm text-sm transition-colors ${
                  t.id === categoryId
                    ? "bg-primary/5 text-foreground border border-primary/20"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground border border-transparent"
                }`}
              >
                {t.name}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* ── Right: template editor ──────────────────────────────────── */}
      <div className="space-y-6">
        <header>
          <h2 className="text-xl serif">{template.name}</h2>
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{template.summary}</p>
          {template.awHint && (
            <div className="inline-flex items-center gap-1.5 mt-2 px-2 py-0.5 rounded-full bg-muted text-[11px] text-muted-foreground">
              <span className="font-medium">Typical AW:</span> {template.awHint}
            </div>
          )}
          {template.notes && template.notes.length > 0 && (
            <ul className="mt-3 space-y-1">
              {template.notes.map((n, i) => (
                <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {n}
                </li>
              ))}
            </ul>
          )}
        </header>

        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Slots
            </h3>
            <span className="text-xs text-muted-foreground tabular-nums">
              total {total.toFixed(0)} g
            </span>
          </div>

          <div className="space-y-3">
            {slotEvals.map(({ slot, slotIdx, sumPct, severity, hasLines }) => {
              const slotLines = lines
                .map((line, lineIdx) => ({ line, lineIdx }))
                .filter(({ line }) => line.slotIndex === slotIdx);
              const candidates = ingredientsForCategories(ingredients, slot.acceptCategories);

              return (
                <SlotCard
                  key={slotIdx}
                  slot={slot}
                  sumPct={sumPct}
                  severity={severity}
                  hasLines={hasLines}
                  candidateCount={candidates.length}
                  onAdd={() => addLineForSlot(slotIdx)}
                >
                  {slotLines.length > 0 && (
                    <div className="rounded-sm border border-[color:var(--ds-border-warm)]/60 bg-[color:var(--ds-card-bg)] overflow-hidden">
                      {slotLines.map(({ line, lineIdx }) => {
                        const ing = byId[line.ingredientId];
                        const missing = ing ? missingComposition(ing) : false;
                        return (
                          <div
                            key={lineIdx}
                            className={`grid grid-cols-[1fr_88px_60px_28px] gap-2 px-3 py-2 border-b border-[color:var(--ds-border-warm)]/40 last:border-b-0 items-center ${missing ? "bg-status-alert-bg/15" : ""}`}
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <select
                                value={line.ingredientId}
                                onChange={(e) => updateLine(lineIdx, { ingredientId: e.target.value })}
                                className="input py-1.5 text-sm flex-1 min-w-0"
                              >
                                {candidates.length === 0 && <option value="">(no ingredients in {slot.acceptCategories.join(" / ")})</option>}
                                {candidates.map((i) => (
                                  <option key={i.id} value={i.id!}>{i.name}</option>
                                ))}
                              </select>
                              {missing && ing?.id && (
                                <Link
                                  href={`/ingredients/${encodeURIComponent(ing.id)}?tab=composition`}
                                  title="Composition not set"
                                  className="p-1 text-status-alert hover:text-status-alert/80 transition-colors flex-shrink-0"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </Link>
                              )}
                            </div>
                            <input
                              type="number"
                              step="any"
                              value={line.grams || ""}
                              onChange={(e) => updateLine(lineIdx, { grams: Number(e.target.value) || 0 })}
                              className="input py-1.5 text-sm text-right"
                            />
                            <span className="text-xs text-muted-foreground tabular-nums text-right">
                              {total > 0 ? ((line.grams / total) * 100).toFixed(1) : "0.0"}%
                            </span>
                            <button
                              onClick={() => removeLine(lineIdx)}
                              className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                              aria-label="Remove"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </SlotCard>
              );
            })}
          </div>
        </section>

        {template.steps && template.steps.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              Process
            </h3>
            <ol className="space-y-2">
              {template.steps.map((step, i) => (
                <li
                  key={i}
                  className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-4 py-3 flex items-start gap-3"
                >
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-muted text-xs flex items-center justify-center font-medium tabular-nums">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{step.stage}</span>
                      {step.temperatureC != null && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Thermometer className="w-3 h-3" /> {step.temperatureC}°C
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{step.instruction}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </div>
  );
}

function SlotCard({
  slot,
  sumPct,
  severity,
  hasLines,
  candidateCount,
  onAdd,
  children,
}: {
  slot: RecipeSlot;
  sumPct: number;
  severity: "ok" | "warn" | "bad" | "missing";
  hasLines: boolean;
  candidateCount: number;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  const tone =
    severity === "bad"
      ? "border-status-alert-edge"
      : severity === "warn"
      ? "border-status-warn-edge"
      : severity === "missing"
      ? "border-[color:var(--ds-border-warm)]/60"
      : "border-status-ok-edge";

  const Icon = severity === "bad" ? AlertCircle : severity === "warn" ? AlertTriangle : severity === "ok" ? CheckCircle2 : Info;
  const iconTone =
    severity === "bad"
      ? "text-status-alert"
      : severity === "warn"
      ? "text-status-warn"
      : severity === "ok"
      ? "text-status-ok"
      : "text-muted-foreground";

  return (
    <div className={`rounded-sm border ${tone} bg-[color:var(--ds-card-bg)]`}>
      <div className="px-4 py-3 flex items-start gap-3">
        <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${iconTone}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{slot.role}</span>
            {slot.required && (
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">required</span>
            )}
            <span className="text-xs text-muted-foreground tabular-nums ml-auto">
              {hasLines ? `${sumPct.toFixed(1)}% / target ${slot.min}–${slot.max}%` : `target ${slot.min}–${slot.max}%`}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{slot.hint}</p>
          <p className="text-[10px] text-muted-foreground/70 mt-1 uppercase tracking-widest">
            from: {slot.acceptCategories.join(" / ")}
            {candidateCount === 0 && (
              <span className="text-status-warn ml-1.5 normal-case tracking-normal">
                — no matching ingredients in pantry
              </span>
            )}
          </p>
        </div>
      </div>
      {children && <div className="px-4 pb-3">{children}</div>}
      <button
        onClick={onAdd}
        disabled={candidateCount === 0}
        className="w-full px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors flex items-center gap-1.5 border-t border-[color:var(--ds-border-warm)]/60 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        <Plus className="w-3.5 h-3.5" /> Add ingredient
      </button>
    </div>
  );
}
