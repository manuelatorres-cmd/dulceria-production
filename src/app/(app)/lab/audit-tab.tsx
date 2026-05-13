"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { IconDownload as Download, IconChevronRight as ChevronRight, IconAlertCircle as AlertCircle, IconAlertTriangle as AlertTriangle, IconCircleCheckFilled as CheckCircle2, IconFileAlert as FileWarning } from "@tabler/icons-react";
import { useFillings, useIngredients, useAllFillingIngredients } from "@/lib/hooks";
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
  type Issue,
  type Suggestion,
} from "@/lib/lab/ganache-rules";
import type { Component } from "@/lib/lab/ingredients";
import type { Filling, Ingredient, FillingIngredient } from "@/types";

const GANACHE_CATEGORY = "Ganaches (Emulsions)";

interface AuditRow {
  filling: Filling;
  totalG: number;
  componentLineCount: number;
  hasComponentFilling: boolean;
  breakdown: ReturnType<typeof computeGanacheBreakdown>;
  issues: Issue[];
  suggestions: Suggestion[];
  awRecorded?: number;
  awEstimated: string;
  shelfText: string;
  overall: Severity | "skip";
  /** ingredient ids referenced but missing composition */
  missingCompositionNames: string[];
}

export function AuditTab() {
  const fillings = useFillings();
  const ingredients = useIngredients();
  const allFillingIngredients = useAllFillingIngredients();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "ganaches" | "issues">("ganaches");

  const byId = useMemo<Record<string, Ingredient>>(() => {
    const out: Record<string, Ingredient> = {};
    for (const i of ingredients) if (i.id) out[i.id] = i;
    return out;
  }, [ingredients]);

  const linesByFilling = useMemo<Map<string, FillingIngredient[]>>(() => {
    const m = new Map<string, FillingIngredient[]>();
    for (const fi of allFillingIngredients) {
      const arr = m.get(fi.fillingId) || [];
      arr.push(fi);
      m.set(fi.fillingId, arr);
    }
    return m;
  }, [allFillingIngredients]);

  const audit: AuditRow[] = useMemo(() => {
    return fillings
      .filter((f) => !f.archived)
      .map((f) => buildRow(f, linesByFilling, byId, ingredients))
      .sort(sortBySeverity);
  }, [fillings, linesByFilling, byId, ingredients]);

  const filtered = audit.filter((r) => {
    if (filter === "ganaches") return r.filling.category === GANACHE_CATEGORY;
    if (filter === "issues") return r.overall === "warn" || r.overall === "bad";
    return true;
  });

  const counts = {
    total: audit.length,
    ok: audit.filter((r) => r.overall === "ok").length,
    warn: audit.filter((r) => r.overall === "warn").length,
    bad: audit.filter((r) => r.overall === "bad").length,
    skip: audit.filter((r) => r.overall === "skip").length,
  };

  function exportMarkdown() {
    const md = renderMarkdown(filtered);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `recipe-audit-${stamp}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-1 text-sm">
          {(
            [
              { id: "ganaches", label: `Ganaches only` },
              { id: "issues", label: `Issues (${counts.warn + counts.bad})` },
              { id: "all", label: `All fillings (${counts.total})` },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              onClick={() => setFilter(opt.id)}
              className={`px-3 py-1.5 rounded-sm transition-colors ${
                filter === opt.id
                  ? "bg-primary/5 text-foreground border border-primary/20"
                  : "text-muted-foreground hover:text-foreground border border-transparent"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <button
          onClick={exportMarkdown}
          className="btn-secondary text-xs flex items-center gap-1.5"
        >
          <Download className="w-3.5 h-3.5" />
          Export .md
        </button>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Tile label="Well balanced" value={counts.ok} tone="ok" />
        <Tile label="Tweak suggested" value={counts.warn} tone="warn" />
        <Tile label="Out of band" value={counts.bad} tone="bad" />
        <Tile label="Skipped (data)" value={counts.skip} tone="muted" />
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-4 py-8 text-sm text-muted-foreground text-center">
          No fillings match this filter.
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((row) => (
            <AuditCard
              key={row.filling.id ?? row.filling.name}
              row={row}
              expanded={expandedId === row.filling.id}
              onToggle={() => setExpandedId((cur) => (cur === row.filling.id ? null : row.filling.id ?? null))}
            />
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
        Audit checks ganache balance against Jungstedt&apos;s target bands. Non-ganache categories (caramels, fruit gels, giandujas, cookie layers) aren&apos;t band-validated yet — they&apos;re shown for completeness but skipped. Suggestions are first-order; verify on an AW meter before scaling.
      </p>
    </div>
  );
}

// ── Row builders ──────────────────────────────────────────────────────────
function buildRow(
  f: Filling,
  linesByFilling: Map<string, FillingIngredient[]>,
  byId: Record<string, Ingredient>,
  ingredients: Ingredient[],
): AuditRow {
  const rawLines = (f.id && linesByFilling.get(f.id)) || [];
  const ingredientLines: GanacheLine[] = rawLines
    .filter((r) => r.ingredientId && r.amount > 0)
    .map((r) => ({ ingredientId: r.ingredientId!, grams: r.amount }));
  const hasComponentFilling = rawLines.some((r) => r.componentFillingId);
  const totalG = ingredientLines.reduce((s, l) => s + l.grams, 0);

  const breakdown = computeGanacheBreakdown(ingredientLines, byId);
  const isGanache = f.category === GANACHE_CATEGORY;
  const issues: Issue[] = isGanache ? validateGanache(breakdown, byId) : [];
  const suggestions: Suggestion[] = isGanache ? suggestFixes(breakdown, ingredientLines, byId, ingredients) : [];
  const hint = shelfHint(breakdown);

  // overall severity
  let overall: Severity | "skip";
  if (!isGanache) overall = "skip";
  else if (totalG === 0 || hasComponentFilling) overall = "skip";
  else if (issues.some((i) => i.severity === "bad")) overall = "bad";
  else if (issues.some((i) => i.severity === "warn")) overall = "warn";
  else overall = "ok";

  const missingCompositionNames = breakdown.missingComposition
    .map((id) => byId[id]?.name)
    .filter((n): n is string => !!n);

  return {
    filling: f,
    totalG,
    componentLineCount: ingredientLines.length,
    hasComponentFilling,
    breakdown,
    issues,
    suggestions,
    awRecorded: f.waterActivity,
    awEstimated: hint.awEstimate,
    shelfText: hint.shelfLife,
    overall,
    missingCompositionNames,
  };
}

function sortBySeverity(a: AuditRow, b: AuditRow): number {
  const order = { bad: 0, warn: 1, skip: 2, ok: 3 } as const;
  const oa = order[a.overall];
  const ob = order[b.overall];
  if (oa !== ob) return oa - ob;
  return a.filling.name.localeCompare(b.filling.name);
}

// ── UI parts ──────────────────────────────────────────────────────────────
function Tile({ label, value, tone }: { label: string; value: number; tone: "ok" | "warn" | "bad" | "muted" }) {
  const cls =
    tone === "ok"
      ? "border-status-ok-edge bg-status-ok-bg/30 text-status-ok"
      : tone === "warn"
      ? "border-status-warn-edge bg-status-warn-bg/30 text-status-warn"
      : tone === "bad"
      ? "border-status-alert-edge bg-status-alert-bg/30 text-status-alert"
      : "border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] text-muted-foreground";
  return (
    <div className={`rounded-sm border ${cls} px-4 py-3`}>
      <div className="text-2xl font-medium tabular-nums">{value}</div>
      <div className="text-[11px] uppercase tracking-widest mt-0.5 opacity-90">{label}</div>
    </div>
  );
}

function AuditCard({
  row,
  expanded,
  onToggle,
}: {
  row: AuditRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { filling, breakdown, issues, suggestions, overall, totalG, missingCompositionNames, hasComponentFilling } = row;
  const Icon =
    overall === "bad"
      ? AlertCircle
      : overall === "warn"
      ? AlertTriangle
      : overall === "ok"
      ? CheckCircle2
      : FileWarning;
  const iconTone =
    overall === "bad"
      ? "text-status-alert"
      : overall === "warn"
      ? "text-status-warn"
      : overall === "ok"
      ? "text-status-ok"
      : "text-muted-foreground";

  const ganacheCat = filling.category === GANACHE_CATEGORY;
  const skipReason =
    !ganacheCat
      ? "Non-ganache category — skipped"
      : hasComponentFilling
      ? "Uses sub-fillings — composite recipe, skipped"
      : totalG === 0
      ? "No ingredient weights — skipped"
      : "";

  return (
    <li className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] overflow-hidden">
      <button onClick={onToggle} className="w-full text-left px-4 py-3 hover:bg-muted transition-colors flex items-start gap-3">
        <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${iconTone}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{filling.name}</span>
            <span className="text-[11px] text-muted-foreground">{filling.category}</span>
            {filling.waterActivity != null && (
              <span className="text-[11px] tabular-nums text-muted-foreground">
                · AW {filling.waterActivity.toFixed(2)}
              </span>
            )}
          </div>
          {overall !== "skip" && totalG > 0 && (
            <div className="text-xs text-muted-foreground mt-0.5 tabular-nums">
              {COMPONENT_ORDER.map((c) => `${COMPONENT_LABEL[c]} ${breakdown.percent[c].toFixed(1)}%`).join(" · ")}
            </div>
          )}
          {skipReason && <div className="text-xs text-muted-foreground mt-0.5">{skipReason}</div>}
          <div className="text-xs text-muted-foreground mt-0.5">
            {issues.length > 0 && `${issues.length} issue${issues.length === 1 ? "" : "s"}`}
            {issues.length > 0 && suggestions.length > 0 && " · "}
            {suggestions.length > 0 && `${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"}`}
            {issues.length === 0 && suggestions.length === 0 && overall !== "skip" && "all bands within ideal range"}
          </div>
        </div>
        <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform mt-0.5 ${expanded ? "rotate-90" : ""}`} />
      </button>

      {expanded && (
        <div className="border-t border-[color:var(--ds-border-warm)] bg-muted/20 px-4 py-3 space-y-3 text-sm">
          {missingCompositionNames.length > 0 && (
            <div className="rounded-sm border border-status-alert-edge bg-status-alert-bg/20 px-3 py-2 text-xs">
              <strong className="text-status-alert">Missing composition:</strong>{" "}
              {missingCompositionNames.join(", ")}. Composition % aren&apos;t set on these ingredients — calculator can&apos;t see them.
            </div>
          )}

          {overall !== "skip" && (
            <>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Composition</div>
                <CompositionBars breakdown={breakdown} />
              </div>

              {issues.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Issues</div>
                  <ul className="space-y-1">
                    {issues.map((iss, i) => (
                      <li key={i} className="text-xs">
                        <span className={iss.severity === "bad" ? "text-status-alert" : "text-status-warn"}>•</span>{" "}
                        <span>{iss.message}</span>
                        {iss.fix && <div className="text-muted-foreground ml-3">{iss.fix}</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {suggestions.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Suggested fixes</div>
                  <ul className="space-y-1">
                    {suggestions.map((s, i) => {
                      const adding = s.deltaG > 0;
                      return (
                        <li key={i} className="text-xs">
                          <span className={`tabular-nums ${adding ? "text-status-ok" : "text-status-warn"}`}>
                            {adding ? "+" : "−"}{Math.abs(s.deltaG)} g
                          </span>{" "}
                          <span>{s.ingredientName}</span>{" "}
                          <span className="text-muted-foreground">{s.reason}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          )}

          <div className="flex gap-3 pt-1">
            {filling.id && (
              <Link
                href={`/fillings/${encodeURIComponent(filling.id)}`}
                className="text-xs text-primary hover:underline"
              >
                Open filling →
              </Link>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function CompositionBars({ breakdown }: { breakdown: ReturnType<typeof computeGanacheBreakdown> }) {
  return (
    <div className="grid sm:grid-cols-2 gap-1.5">
      {COMPONENT_ORDER.map((c) => {
        const v = breakdown.percent[c];
        const band = GANACHE_BANDS[c];
        const sev = severityFor(v, band);
        return (
          <div key={c} className="flex items-center gap-2 text-[11px]">
            <span className="text-muted-foreground w-20">{COMPONENT_LABEL[c]}</span>
            <div className="relative h-1.5 flex-1 bg-muted rounded-full">
              <div className="absolute top-0 bottom-0 bg-muted-foreground/15 rounded-full"
                   style={barBandStyle(band)} />
              <div className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full ${barColor(sev)} ring-2 ring-background`}
                   style={{ left: `${Math.min(100, Math.max(0, (v / Math.max(band.max * 1.5, v * 1.2, 50)) * 100))}%` }} />
            </div>
            <span className="text-foreground tabular-nums w-11 text-right">{v.toFixed(1)}%</span>
          </div>
        );
      })}
    </div>
  );
}

function severityFor(v: number, band: { min: number; max: number; softMax?: number }): Severity {
  if (v < band.min) return "warn";
  if (v > (band.softMax ?? band.max)) return "bad";
  if (v > band.max) return "warn";
  return "ok";
}
function barColor(s: Severity): string {
  if (s === "bad") return "bg-status-alert";
  if (s === "warn") return "bg-status-warn";
  return "bg-status-ok";
}
function barBandStyle(band: { min: number; max: number }): React.CSSProperties {
  const scaleMax = band.max * 1.5;
  return {
    left: `${(band.min / scaleMax) * 100}%`,
    right: `${100 - (band.max / scaleMax) * 100}%`,
  };
}

// ── Markdown export ───────────────────────────────────────────────────────
function renderMarkdown(rows: AuditRow[]): string {
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const lines: string[] = [];
  lines.push(`# Recipe audit — ${date}`);
  lines.push("");
  lines.push("Audit of saved fillings against Chef Jungstedt's ganache balance bands. Composition is derived from the ingredient `cacaoFat / sugar / milkFat / water / solids / otherFats` percentages stored on each ingredient.");
  lines.push("");
  lines.push("**Bands used:** Water 19–22% · Sugar 29–35% · Cacao fat 15–23% · Milk fat 15–23% · Dry mass 3–14% · Total fat ≤ 40%.");
  lines.push("");

  const counts = {
    bad: rows.filter((r) => r.overall === "bad").length,
    warn: rows.filter((r) => r.overall === "warn").length,
    ok: rows.filter((r) => r.overall === "ok").length,
    skip: rows.filter((r) => r.overall === "skip").length,
  };
  lines.push("## Summary");
  lines.push("");
  lines.push(`- **Out of band:** ${counts.bad}`);
  lines.push(`- **Tweak suggested:** ${counts.warn}`);
  lines.push(`- **Well balanced:** ${counts.ok}`);
  lines.push(`- **Skipped (non-ganache, composite, or no weights):** ${counts.skip}`);
  lines.push("");

  for (const verdict of ["bad", "warn", "ok", "skip"] as const) {
    const subset = rows.filter((r) => r.overall === verdict);
    if (subset.length === 0) continue;
    const heading =
      verdict === "bad"
        ? "## Out of band"
        : verdict === "warn"
        ? "## Tweak suggested"
        : verdict === "ok"
        ? "## Well balanced"
        : "## Skipped";
    lines.push(heading);
    lines.push("");
    for (const row of subset) {
      lines.push(`### ${row.filling.name}`);
      lines.push("");
      lines.push(`*Category:* ${row.filling.category}`);
      if (row.awRecorded != null) lines.push(`*Recorded AW:* ${row.awRecorded.toFixed(2)}`);
      if (row.overall !== "skip") {
        lines.push(`*Estimated AW (composition):* ${row.awEstimated} — *shelf:* ${row.shelfText}`);
        lines.push("");
        lines.push("| Component | Value | Target |");
        lines.push("|---|---:|---:|");
        for (const c of COMPONENT_ORDER) {
          const band = GANACHE_BANDS[c];
          const v = row.breakdown.percent[c];
          const sev = severityFor(v, band);
          const flag = sev === "bad" ? " ⛔" : sev === "warn" ? " ⚠️" : "";
          lines.push(`| ${COMPONENT_LABEL[c as Component]} | ${v.toFixed(1)}%${flag} | ${band.min}–${band.max}% |`);
        }
        lines.push(`| **Total fat** | ${row.breakdown.totalFatPercent.toFixed(1)}% | ≤ ${GANACHE_BANDS.totalFat.max}% |`);
        lines.push("");
        if (row.issues.length > 0) {
          lines.push("**Issues**");
          for (const iss of row.issues) {
            lines.push(`- ${iss.message}${iss.fix ? ` — ${iss.fix}` : ""}`);
          }
          lines.push("");
        }
        if (row.suggestions.length > 0) {
          lines.push("**Suggested fixes**");
          for (const s of row.suggestions) {
            const sign = s.deltaG > 0 ? "+" : "−";
            lines.push(`- ${sign}${Math.abs(s.deltaG)} g ${s.ingredientName} ${s.reason}`);
          }
          lines.push("");
        }
      } else {
        lines.push("");
        if (row.hasComponentFilling) lines.push("Skipped — composite recipe (uses other fillings as components).");
        else if (row.totalG === 0) lines.push("Skipped — no ingredient weights recorded.");
        else lines.push("Skipped — non-ganache category.");
        lines.push("");
      }
      if (row.missingCompositionNames.length > 0) {
        lines.push(`> Missing composition data: ${row.missingCompositionNames.join(", ")}.`);
        lines.push("");
      }
    }
  }
  return lines.join("\n");
}
