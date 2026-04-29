// Ganache balance engine — Jungstedt-derived rules.
// Compute %-breakdown and validate against target bands.
// Operates on the app's Ingredient model (composition stored as percentages).

import type { Ingredient } from "@/types";
import { asFractions, type Component, COMPONENT_LABEL, COMPONENT_ORDER, missingComposition } from "./ingredients";

export interface GanacheLine {
  /** Ingredient.id from the app's ingredient table */
  ingredientId: string;
  /** weight in grams */
  grams: number;
}

export interface GanacheBreakdown {
  totalGrams: number;
  components: Record<Component, number>; // grams per component
  percent: Record<Component, number>; // % of total
  totalFatPercent: number;
  /** ingredient ids referenced by lines but missing composition data */
  missingComposition: string[];
  /** ingredient ids referenced by lines but not present in the byId map */
  unknownIngredients: string[];
}

export function computeGanacheBreakdown(
  lines: GanacheLine[],
  byId: Record<string, Ingredient>,
): GanacheBreakdown {
  const components: Record<Component, number> = {
    cacaoFat: 0,
    milkFat: 0,
    otherFat: 0,
    sugar: 0,
    water: 0,
    solids: 0,
  };

  let total = 0;
  const missing: string[] = [];
  const unknown: string[] = [];

  for (const line of lines) {
    if (!line.grams) continue;
    const ing = byId[line.ingredientId];
    if (!ing) {
      unknown.push(line.ingredientId);
      continue;
    }
    if (missingComposition(ing)) missing.push(line.ingredientId);
    total += line.grams;
    const fr = asFractions(ing);
    for (const c of COMPONENT_ORDER) {
      components[c] += line.grams * fr[c];
    }
  }

  const percent: Record<Component, number> = {
    cacaoFat: 0,
    milkFat: 0,
    otherFat: 0,
    sugar: 0,
    water: 0,
    solids: 0,
  };
  if (total > 0) {
    for (const k of COMPONENT_ORDER) {
      percent[k] = (components[k] / total) * 100;
    }
  }
  const totalFatPercent = percent.cacaoFat + percent.milkFat + percent.otherFat;

  return {
    totalGrams: total,
    components,
    percent,
    totalFatPercent,
    missingComposition: Array.from(new Set(missing)),
    unknownIngredients: Array.from(new Set(unknown)),
  };
}

// ── Target bands (Jungstedt) ───────────────────────────────────────────────
export interface Band {
  label: string;
  min: number;
  max: number;
  /** beyond max but still tolerable up to this value (warn, not fail) */
  softMax?: number;
  unit: "%";
  description: string;
}

export const GANACHE_BANDS: Record<Component | "totalFat", Band> = {
  water: {
    label: "Water",
    min: 19,
    max: 22,
    softMax: 25,
    unit: "%",
    description: "19–22% ideal. Above 22% needs sorbitol or higher sugar to keep AW down.",
  },
  sugar: {
    label: "Sugar",
    min: 29,
    max: 35,
    unit: "%",
    description: "29–35%. Lower for dark (let cacao shine), higher to lower AW.",
  },
  cacaoFat: {
    label: "Cacao fat",
    min: 15,
    max: 23,
    unit: "%",
    description: "15–23%. More = firmer, more stable. Less = softer, less stable.",
  },
  milkFat: {
    label: "Milk fat",
    min: 15,
    max: 23,
    unit: "%",
    description: "15–23%. More = softer/smoother. Less = firmer set.",
  },
  solids: {
    label: "Dry mass",
    min: 3,
    max: 14,
    unit: "%",
    description: "3–14%. Builds chocolate flavor + stabilises emulsion. Above 14% → thick/hard to pipe.",
  },
  otherFat: {
    label: "Other fats",
    min: 0,
    max: 23,
    unit: "%",
    description: "Coconut, nut fats, ethanol. Counts toward total fat.",
  },
  totalFat: {
    label: "Total fat",
    min: 25,
    max: 40,
    unit: "%",
    description: "Keep <40%. Above → splits, hard to handle. White ganaches tolerate higher.",
  },
};

// ── Validation ────────────────────────────────────────────────────────────
export type Severity = "ok" | "warn" | "bad";

export interface Issue {
  severity: Severity;
  component: Component | "totalFat" | "structure" | "data";
  message: string;
  fix?: string;
}

export function validateGanache(b: GanacheBreakdown, byId: Record<string, Ingredient>): Issue[] {
  const issues: Issue[] = [];
  if (b.totalGrams === 0) return issues;

  for (const [key, band] of Object.entries(GANACHE_BANDS)) {
    if (key === "totalFat") continue;
    const comp = key as Component;
    const v = b.percent[comp];
    if (v < band.min) {
      issues.push({
        severity: comp === "otherFat" ? "ok" : "warn",
        component: comp,
        message: `${band.label} ${v.toFixed(1)}% — below ideal (${band.min}–${band.max}%).`,
        fix: lowFix(comp),
      });
    } else if (v > (band.softMax ?? band.max)) {
      issues.push({
        severity: "bad",
        component: comp,
        message: `${band.label} ${v.toFixed(1)}% — too high (max ${band.softMax ?? band.max}%).`,
        fix: highFix(comp),
      });
    } else if (v > band.max) {
      issues.push({
        severity: "warn",
        component: comp,
        message: `${band.label} ${v.toFixed(1)}% — above ideal (${band.min}–${band.max}%).`,
        fix: highFix(comp),
      });
    }
  }

  // total fat
  const tfBand = GANACHE_BANDS.totalFat;
  if (b.totalFatPercent > tfBand.max) {
    issues.push({
      severity: b.totalFatPercent > 45 ? "bad" : "warn",
      component: "totalFat",
      message: `Total fat ${b.totalFatPercent.toFixed(1)}% — above ${tfBand.max}%. Risk: separation, thick texture.`,
      fix: "Reduce butter or chocolate — or increase liquid (cream / fruit / water).",
    });
  } else if (b.totalFatPercent < tfBand.min && b.totalGrams > 0) {
    issues.push({
      severity: "warn",
      component: "totalFat",
      message: `Total fat ${b.totalFatPercent.toFixed(1)}% — quite low. Texture may be thin.`,
      fix: "Add butter or use a higher-cocoa chocolate.",
    });
  }

  // water/sugar correlation
  if (b.percent.water > 22 && b.percent.sugar < 32) {
    issues.push({
      severity: "warn",
      component: "structure",
      message: `High water (${b.percent.water.toFixed(1)}%) with sugar only ${b.percent.sugar.toFixed(1)}% — AW likely too high.`,
      fix: "Either reduce water, raise sugar to ≥32%, or add sorbitol (~3–5g per 100g batch).",
    });
  }

  // missing-composition warnings
  for (const id of b.missingComposition) {
    const ing = byId[id];
    if (!ing) continue;
    issues.push({
      severity: "bad",
      component: "data",
      message: `${ing.name}: composition not filled in.`,
      fix: "Open this ingredient and set the cacao fat / sugar / milk fat / water / solids / other-fats % so the calculator can see it.",
    });
  }

  return issues;
}

function lowFix(comp: Component): string {
  switch (comp) {
    case "water": return "Add cream or fruit purée — or reduce chocolate/butter slightly.";
    case "sugar": return "Add glucose or invert sugar (also adds a little water).";
    case "cacaoFat": return "Add cacao butter — or switch to a higher-cocoa chocolate.";
    case "milkFat": return "Add butter or use a milk/dark-milk chocolate.";
    case "solids": return "Use a higher-cocoa dark chocolate, or add some chocolate.";
    case "otherFat": return "";
    default: return "";
  }
}

function highFix(comp: Component): string {
  switch (comp) {
    case "water": return "Reduce cream/fruit/water — or raise sugar to ≥32% and add sorbitol.";
    case "sugar": return "Reduce glucose/invert sugar — flavour will be muddied if too sweet.";
    case "cacaoFat": return "Reduce cacao butter — or switch to lower-cocoa chocolate. Will set firmer.";
    case "milkFat": return "Reduce butter — ganache will be very soft.";
    case "solids": return "Reduce chocolate quantity — ganache will be too thick to pipe.";
    case "otherFat": return "Reduce coconut oil / nut fats / spirits — risk of unstable emulsion at room temp.";
    default: return "";
  }
}

// ── Suggested fixes (numeric levers) ──────────────────────────────────────
export interface Suggestion {
  component: Component | "totalFat";
  ingredientId: string;
  ingredientName: string;
  /** positive = add this many grams, negative = remove this many grams */
  deltaG: number;
  reason: string;
}

/** Solve Δ for component pct = target after adding (or removing) Δg of an
 *  ingredient with component fraction f. (X + Δ·f) / (T + Δ) = t  →
 *  Δ = (t·T − X) / (f − t). Returns null if signs / magnitudes don't make sense. */
function solveDelta(targetPct: number, currentG: number, totalG: number, fraction: number): number | null {
  const t = targetPct / 100;
  const denom = fraction - t;
  if (Math.abs(denom) < 1e-6) return null;
  const delta = (t * totalG - currentG) / denom;
  if (!Number.isFinite(delta)) return null;
  return delta;
}

/** From the pantry, the ingredient richest in `comp` that's plausible to add.
 *  Prefers ingredients already used in the recipe (so the user keeps a coherent recipe). */
function pickRichest(
  pantry: Ingredient[],
  comp: Component,
  linesIds: Set<string>,
): Ingredient | null {
  const scored = pantry
    .filter((i) => i.id && !missingComposition(i))
    .map((i) => ({ i, frac: asFractions(i)[comp], inRecipe: linesIds.has(i.id!) }))
    .filter((x) => x.frac > 0.05); // only meaningful sources
  if (scored.length === 0) return null;
  scored.sort((a, b) => {
    // prefer in-recipe + higher fraction
    const aScore = a.frac + (a.inRecipe ? 0.2 : 0);
    const bScore = b.frac + (b.inRecipe ? 0.2 : 0);
    return bScore - aScore;
  });
  return scored[0].i;
}

/** From the recipe lines, the line whose ingredient contributes the most of `comp` (by grams). */
function dominantContributor(
  lines: GanacheLine[],
  byId: Record<string, Ingredient>,
  comp: Component,
): { line: GanacheLine; ing: Ingredient } | null {
  let best: { line: GanacheLine; ing: Ingredient; contributionG: number } | null = null;
  for (const line of lines) {
    if (!line.grams) continue;
    const ing = byId[line.ingredientId];
    if (!ing) continue;
    const contributionG = line.grams * asFractions(ing)[comp];
    if (contributionG <= 0) continue;
    if (!best || contributionG > best.contributionG) {
      best = { line, ing, contributionG };
    }
  }
  return best ? { line: best.line, ing: best.ing } : null;
}

export function suggestFixes(
  breakdown: GanacheBreakdown,
  lines: GanacheLine[],
  byId: Record<string, Ingredient>,
  pantry: Ingredient[],
): Suggestion[] {
  const out: Suggestion[] = [];
  if (breakdown.totalGrams === 0) return out;
  const usedIds = new Set(lines.map((l) => l.ingredientId));

  // per-component suggestions
  for (const comp of COMPONENT_ORDER) {
    if (comp === "otherFat") continue; // tracked but not band-policed
    const band = GANACHE_BANDS[comp];
    const v = breakdown.percent[comp];
    const X = breakdown.components[comp];
    const T = breakdown.totalGrams;

    if (v < band.min) {
      const target = (band.min + band.max) / 2;
      const cand = pickRichest(pantry, comp, usedIds);
      if (!cand?.id) continue;
      const f = asFractions(cand)[comp];
      const delta = solveDelta(target, X, T, f);
      if (delta == null || delta < 1) continue;
      out.push({
        component: comp,
        ingredientId: cand.id,
        ingredientName: cand.name,
        deltaG: Math.round(delta),
        reason: `→ ${COMPONENT_LABEL[comp]} ≈ ${target.toFixed(0)}%`,
      });
    } else if (v > (band.softMax ?? band.max)) {
      const target = band.max;
      const dom = dominantContributor(lines, byId, comp);
      if (!dom?.ing.id) continue;
      const f = asFractions(dom.ing)[comp];
      const delta = solveDelta(target, X, T, f);
      if (delta == null || delta > -1) continue; // expecting negative
      const removable = Math.min(-delta, dom.line.grams);
      if (removable < 1) continue;
      out.push({
        component: comp,
        ingredientId: dom.ing.id,
        ingredientName: dom.ing.name,
        deltaG: -Math.round(removable),
        reason: `→ ${COMPONENT_LABEL[comp]} ≈ ${target.toFixed(0)}%`,
      });
    }
  }

  // total fat — only suggest a remove (additions are handled by component-level fix)
  if (breakdown.totalFatPercent > GANACHE_BANDS.totalFat.max) {
    const target = GANACHE_BANDS.totalFat.max;
    // pick the line whose ingredient has the highest *total fat* contribution
    let best: { line: GanacheLine; ing: Ingredient; contributionG: number; totalFatFrac: number } | null = null;
    for (const line of lines) {
      if (!line.grams) continue;
      const ing = byId[line.ingredientId];
      if (!ing) continue;
      const fr = asFractions(ing);
      const tff = fr.cacaoFat + fr.milkFat + fr.otherFat;
      const contributionG = line.grams * tff;
      if (contributionG <= 0) continue;
      if (!best || contributionG > best.contributionG) {
        best = { line, ing, contributionG, totalFatFrac: tff };
      }
    }
    if (best?.ing.id) {
      const X = breakdown.components.cacaoFat + breakdown.components.milkFat + breakdown.components.otherFat;
      const delta = solveDelta(target, X, breakdown.totalGrams, best.totalFatFrac);
      if (delta != null && delta < -1) {
        const removable = Math.min(-delta, best.line.grams);
        if (removable >= 1) {
          out.push({
            component: "totalFat",
            ingredientId: best.ing.id,
            ingredientName: best.ing.name,
            deltaG: -Math.round(removable),
            reason: `→ Total fat ≈ ${target.toFixed(0)}%`,
          });
        }
      }
    }
  }

  // de-dupe: if two suggestions point to the same ingredient with the same sign, keep the larger magnitude
  const dedup = new Map<string, Suggestion>();
  for (const s of out) {
    const key = `${s.ingredientId}|${Math.sign(s.deltaG)}`;
    const existing = dedup.get(key);
    if (!existing || Math.abs(s.deltaG) > Math.abs(existing.deltaG)) dedup.set(key, s);
  }
  return Array.from(dedup.values());
}

// ── Predicted shelf life class (composition-based, not AW meter) ─────────
export interface ShelfHint {
  awEstimate: string; // textual range
  shelfLife: string;
  caveat: string;
}

export function shelfHint(b: GanacheBreakdown): ShelfHint {
  const w = b.percent.water;
  const s = b.percent.sugar;
  if (w === 0) return { awEstimate: "—", shelfLife: "—", caveat: "Add a liquid first." };
  if (w <= 19 && s >= 30) return { awEstimate: "≈ 0.75–0.80", shelfLife: "≥ 3 mo (cool)", caveat: "Estimate from composition only — verify with an AW meter before scaling production." };
  if (w <= 22 && s >= 29) return { awEstimate: "≈ 0.78–0.83", shelfLife: "~ 1–3 mo (cool)", caveat: "Estimate from composition only — verify with an AW meter before scaling production." };
  if (w <= 25 && s >= 32) return { awEstimate: "≈ 0.82–0.86", shelfLife: "~ 2–4 wk", caveat: "Borderline — sorbitol recommended. Verify with AW meter." };
  return { awEstimate: "≈ ≥ 0.86", shelfLife: "< 2 wk — risky", caveat: "AW likely too high. Mold growth possible. Re-balance before producing." };
}

export { COMPONENT_LABEL, COMPONENT_ORDER };
export type { Component };
