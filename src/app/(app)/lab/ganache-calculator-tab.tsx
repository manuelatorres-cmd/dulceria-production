"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { IconPlus as Plus, IconTrash as Trash2, IconAlertTriangle as AlertTriangle, IconCircleCheckFilled as CheckCircle2, IconAlertCircle as AlertCircle, IconExternalLink as ExternalLink, IconWand as Wand2 } from "@tabler/icons-react";
import { useIngredients } from "@/lib/hooks";
import {
  computeGanacheBreakdown,
  validateGanache,
  shelfHint,
  suggestFixes,
  GANACHE_BANDS,
  COMPONENT_LABEL,
  COMPONENT_ORDER,
  type GanacheLine,
  type Severity,
  type Component,
  type Suggestion,
} from "@/lib/lab/ganache-rules";
import { groupByCategory, missingComposition } from "@/lib/lab/ingredients";
import type { Ingredient } from "@/types";

export function GanacheCalculatorTab() {
  const ingredients = useIngredients();
  const byId = useMemo<Record<string, Ingredient>>(() => {
    const out: Record<string, Ingredient> = {};
    for (const i of ingredients) if (i.id) out[i.id] = i;
    return out;
  }, [ingredients]);

  const [lines, setLines] = useState<GanacheLine[]>([]);
  const [batchG, setBatchG] = useState<number>(500);

  // seed with five empty lines once ingredients are loaded
  useEffect(() => {
    if (lines.length === 0 && ingredients.length > 0) {
      const firstId = ingredients[0]?.id;
      if (firstId) setLines([
        { ingredientId: firstId, grams: 0 },
        { ingredientId: firstId, grams: 0 },
        { ingredientId: firstId, grams: 0 },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingredients]);

  const breakdown = useMemo(() => computeGanacheBreakdown(lines, byId), [lines, byId]);
  const issues = useMemo(() => validateGanache(breakdown, byId), [breakdown, byId]);
  const hint = useMemo(() => shelfHint(breakdown), [breakdown]);
  const suggestions = useMemo(
    () => suggestFixes(breakdown, lines, byId, ingredients),
    [breakdown, lines, byId, ingredients],
  );

  const overall: Severity = severityRank(issues.map((i) => i.severity));

  function addLine() {
    const firstId = ingredients[0]?.id;
    if (!firstId) return;
    setLines((prev) => [...prev, { ingredientId: firstId, grams: 0 }]);
  }
  function updateLine(idx: number, patch: Partial<GanacheLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }
  function clear() {
    const firstId = ingredients[0]?.id;
    setLines(firstId ? [{ ingredientId: firstId, grams: 0 }] : []);
  }
  function applySuggestion(s: Suggestion) {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.ingredientId === s.ingredientId);
      if (idx >= 0) {
        const next = [...prev];
        const newGrams = Math.max(0, (next[idx].grams || 0) + s.deltaG);
        next[idx] = { ...next[idx], grams: newGrams };
        return next;
      }
      // adding fresh — only meaningful when delta is positive
      if (s.deltaG <= 0) return prev;
      return [...prev, { ingredientId: s.ingredientId, grams: s.deltaG }];
    });
  }
  function applyAllSuggestions() {
    for (const s of suggestions) applySuggestion(s);
  }

  const scale = breakdown.totalGrams > 0 ? batchG / breakdown.totalGrams : 1;
  const grouped = useMemo(() => groupByCategory(ingredients), [ingredients]);

  if (ingredients.length === 0) {
    return (
      <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-4 py-6 max-w-md">
        <p className="text-sm text-muted-foreground">
          No ingredients in your pantry yet. Add ingredients (with composition % filled in) on the{" "}
          <Link href="/ingredients" className="text-primary underline">Ingredients</Link> page first, then come back here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-6">
      {/* ── Left: ingredient editor ─────────────────────────────────── */}
      <div className="space-y-5">
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Recipe
            </h2>
            <button onClick={clear} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Clear
            </button>
          </div>

          <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] overflow-hidden">
            <div className="grid grid-cols-[1fr_88px_72px_88px_28px] gap-2 px-3 py-2 border-b border-[color:var(--ds-border-warm)] bg-muted/40 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              <div>Ingredient</div>
              <div className="text-right">Grams</div>
              <div className="text-right">% of mix</div>
              <div className="text-right">Batch g</div>
              <div />
            </div>
            {lines.map((line, idx) => {
              const pct = breakdown.totalGrams > 0 ? (line.grams / breakdown.totalGrams) * 100 : 0;
              const batched = line.grams * scale;
              const ing = byId[line.ingredientId];
              const missing = ing ? missingComposition(ing) : false;
              return (
                <div
                  key={idx}
                  className={`grid grid-cols-[1fr_88px_72px_88px_28px] gap-2 px-3 py-2 border-b border-[color:var(--ds-border-warm)]/50 last:border-b-0 items-center ${missing ? "bg-status-alert-bg/15" : ""}`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <select
                      value={line.ingredientId}
                      onChange={(e) => updateLine(idx, { ingredientId: e.target.value })}
                      className="input py-1.5 text-sm flex-1 min-w-0"
                    >
                      {grouped.map(([group, items]) => (
                        <optgroup key={group} label={group}>
                          {items.map((i) => (
                            <option key={i.id} value={i.id!}>{i.name}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    {missing && ing?.id && (
                      <Link
                        href={`/ingredients/${encodeURIComponent(ing.id)}?tab=composition`}
                        title="Composition not set — open ingredient to fill it in"
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
                    onChange={(e) => updateLine(idx, { grams: Number(e.target.value) || 0 })}
                    className="input py-1.5 text-sm text-right"
                  />
                  <div className="text-right text-sm text-muted-foreground tabular-nums">
                    {pct.toFixed(1)}%
                  </div>
                  <div className="text-right text-sm text-muted-foreground tabular-nums">
                    {batched ? batched.toFixed(0) : "—"}
                  </div>
                  <button
                    onClick={() => removeLine(idx)}
                    className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                    aria-label="Remove"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
            <button
              onClick={addLine}
              className="w-full px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> Add ingredient
            </button>
          </div>
        </section>

        {/* Composition bars */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">
            Composition
          </h2>
          <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] divide-y divide-border/60">
            {COMPONENT_ORDER.map((comp) => (
              <ComponentRow key={comp} comp={comp} value={breakdown.percent[comp]} />
            ))}
            <div className="grid grid-cols-[120px_1fr_72px] items-center gap-3 px-4 py-3 bg-muted/30">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">Total fat</span>
              <BandBar
                value={breakdown.totalFatPercent}
                min={GANACHE_BANDS.totalFat.min}
                max={GANACHE_BANDS.totalFat.max}
              />
              <span className="text-sm tabular-nums text-right">{breakdown.totalFatPercent.toFixed(1)}%</span>
            </div>
          </div>
        </section>
      </div>

      {/* ── Right: verdict + issues ─────────────────────────────────── */}
      <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">
            Verdict
          </h2>
          <VerdictCard severity={overall} totalG={breakdown.totalGrams} hint={hint} />
        </section>

        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Batch size
            </h2>
            <span className="text-xs text-muted-foreground tabular-nums">
              recipe = {breakdown.totalGrams.toFixed(0)} g
            </span>
          </div>
          <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4 space-y-2">
            <label className="label">Make today</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="any"
                value={batchG}
                onChange={(e) => setBatchG(Number(e.target.value) || 0)}
                className="input text-right"
              />
              <span className="text-sm text-muted-foreground">g</span>
            </div>
            <p className="text-xs text-muted-foreground">
              The &ldquo;Batch g&rdquo; column scales each ingredient to this total.
            </p>
          </div>
        </section>

        {suggestions.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                Suggestions
              </h2>
              <button
                onClick={applyAllSuggestions}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                <Wand2 className="w-3 h-3" /> Apply all
              </button>
            </div>
            <ul className="space-y-2">
              {suggestions.map((s, i) => (
                <SuggestionRow key={i} suggestion={s} onApply={() => applySuggestion(s)} />
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
              Suggestions are first-order — applying one will shift other components, so re-check after each.
            </p>
          </section>
        )}

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">
            Issues
          </h2>
          {issues.length === 0 && breakdown.totalGrams > 0 ? (
            <div className="rounded-sm border border-status-ok-edge bg-status-ok-bg/30 px-4 py-3 text-sm text-status-ok flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>All bands within ideal range. Good balance.</span>
            </div>
          ) : issues.length === 0 ? (
            <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-4 py-3 text-sm text-muted-foreground">
              Add ingredients with weights to see issues.
            </div>
          ) : (
            <ul className="space-y-2">
              {issues.map((issue, i) => (
                <IssueRow key={i} issue={issue} />
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────
function severityRank(arr: Severity[]): Severity {
  if (arr.includes("bad")) return "bad";
  if (arr.includes("warn")) return "warn";
  return "ok";
}

function ComponentRow({ comp, value }: { comp: Component; value: number }) {
  const band = GANACHE_BANDS[comp];
  const sev = severityFor(value, band);
  return (
    <div className="grid grid-cols-[120px_1fr_72px] items-center gap-3 px-4 py-3">
      <div>
        <div className="text-sm">{COMPONENT_LABEL[comp]}</div>
        <div className="text-[10px] text-muted-foreground tabular-nums">
          target {band.min}–{band.max}%
        </div>
      </div>
      <BandBar value={value} min={band.min} max={band.max} severity={sev} />
      <span className={`text-sm tabular-nums text-right ${sevText(sev)}`}>
        {value.toFixed(1)}%
      </span>
    </div>
  );
}

function severityFor(v: number, band: { min: number; max: number; softMax?: number }): Severity {
  if (v < band.min) return "warn";
  if (v > (band.softMax ?? band.max)) return "bad";
  if (v > band.max) return "warn";
  return "ok";
}

function sevText(s: Severity): string {
  if (s === "bad") return "text-status-alert";
  if (s === "warn") return "text-status-warn";
  return "text-foreground";
}

function BandBar({
  value,
  min,
  max,
  severity = "ok",
}: {
  value: number;
  min: number;
  max: number;
  severity?: Severity;
}) {
  const scaleMax = Math.max(max * 1.5, value * 1.2, 50);
  const left = (min / scaleMax) * 100;
  const right = 100 - (max / scaleMax) * 100;
  const valuePos = Math.min(100, Math.max(0, (value / scaleMax) * 100));
  const barColor = severity === "bad" ? "bg-status-alert" : severity === "warn" ? "bg-status-warn" : "bg-status-ok";

  return (
    <div className="relative h-2 rounded-full bg-muted">
      <div
        className="absolute top-0 bottom-0 rounded-full bg-muted-foreground/15"
        style={{ left: `${left}%`, right: `${right}%` }}
      />
      <div
        className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full ${barColor} ring-2 ring-background`}
        style={{ left: `${valuePos}%` }}
      />
    </div>
  );
}

function VerdictCard({ severity, totalG, hint }: { severity: Severity; totalG: number; hint: ReturnType<typeof shelfHint> }) {
  if (totalG === 0) {
    return (
      <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-4 py-3 text-sm text-muted-foreground">
        Add ingredients to start balancing.
      </div>
    );
  }
  const tone =
    severity === "bad"
      ? "border-status-alert-edge bg-status-alert-bg/40 text-status-alert"
      : severity === "warn"
      ? "border-status-warn-edge bg-status-warn-bg/40 text-status-warn"
      : "border-status-ok-edge bg-status-ok-bg/40 text-status-ok";
  const label = severity === "bad" ? "Out of band" : severity === "warn" ? "Tweak suggested" : "Well balanced";
  const Icon = severity === "bad" ? AlertCircle : severity === "warn" ? AlertTriangle : CheckCircle2;

  return (
    <div className={`rounded-sm border px-4 py-3 ${tone}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="w-4 h-4" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="text-xs text-foreground/80 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Estimated AW</span>
          <span className="tabular-nums">{hint.awEstimate}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Shelf life (cool)</span>
          <span>{hint.shelfLife}</span>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">{hint.caveat}</p>
    </div>
  );
}

function SuggestionRow({ suggestion, onApply }: { suggestion: Suggestion; onApply: () => void }) {
  const adding = suggestion.deltaG > 0;
  const sign = adding ? "+" : "−";
  const magnitude = Math.abs(suggestion.deltaG);
  return (
    <li className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-3 py-2.5 flex items-start gap-2">
      <Wand2 className="w-4 h-4 mt-0.5 flex-shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className={`font-medium tabular-nums ${adding ? "text-status-ok" : "text-status-warn"}`}>
            {sign}{magnitude} g
          </span>{" "}
          <span className="text-foreground">{suggestion.ingredientName}</span>
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">{suggestion.reason}</p>
      </div>
      <button
        onClick={onApply}
        className="flex-shrink-0 text-xs px-2 py-1 rounded-sm border border-[color:var(--ds-border-warm)] hover:bg-muted transition-colors"
      >
        Apply
      </button>
    </li>
  );
}

function IssueRow({ issue }: { issue: ReturnType<typeof validateGanache>[number] }) {
  const tone =
    issue.severity === "bad"
      ? "border-status-alert-edge bg-status-alert-bg/30"
      : issue.severity === "warn"
      ? "border-status-warn-edge bg-status-warn-bg/30"
      : "border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)]";
  const Icon = issue.severity === "bad" ? AlertCircle : issue.severity === "warn" ? AlertTriangle : CheckCircle2;
  const iconTone = issue.severity === "bad" ? "text-status-alert" : issue.severity === "warn" ? "text-status-warn" : "text-status-ok";

  return (
    <li className={`rounded-sm border ${tone} px-3 py-2.5`}>
      <div className="flex items-start gap-2">
        <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${iconTone}`} />
        <div className="min-w-0 text-sm">
          <p className="font-medium text-foreground/90">{issue.message}</p>
          {issue.fix && (
            <p className="text-xs text-muted-foreground mt-1">{issue.fix}</p>
          )}
        </div>
      </div>
    </li>
  );
}
