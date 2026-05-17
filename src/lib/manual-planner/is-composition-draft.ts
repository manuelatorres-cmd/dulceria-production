/**
 * Heuristic for distinguishing manual-planner composition drafts from
 * regenerate-seeded drafts. Per MANUAL_PLANNER_POOL_HOTFIX_BATCH.md §2.
 *
 * The production-plans audit (2026-05-17) found 13 distinct writer
 * paths inserting into productionPlans. Five of them produce drafts
 * that look like composition drafts to a naive query but actually
 * represent system-seeded targets we should never expose in the
 * manual planner's pool or tray:
 *
 *   - seedCampaignDrivenPlans       "Campaign: <name> — <product>"
 *   - seedProductionOrderDrivenPlans "PO: <po-or-due> — <product>"
 *   - regeneratePlansForOpenOrders   "<product> — consolidated[…]"
 *   - regeneratePlansForOpenOrders   "<product> — packing[…]"
 *   - scheduleProposalOnDay          "<product> × N"
 *
 * Manual composition drafts come from `saveDraftToPlan` (with order /
 * po allocations) or `buildDraftsFromCampaign` (uses middle-dot, not
 * em-dash). They are the only ones that write orderPlanLinks, which
 * gives us a positive signal independent of name shape.
 *
 * Decision tree:
 *   - hasOrderPlanLinks?           → composition
 *   - else, name matches any of the 5 regenerate patterns? → NOT composition
 *   - else                          → composition (clean name, no links)
 *
 * The proper fix (a `planType` enum column written by each producer)
 * is the next batch. This heuristic is the unblock today.
 *
 * Notes on patterns:
 *   - Regenerate writers use em-dash ` — ` (U+2014) as a separator.
 *     Composition writers use middle-dot ` · ` (U+00B7). We anchor on
 *     em-dash specifically so any future composition name containing
 *     the words "consolidated" or "packing" via the middle-dot
 *     separator still classifies correctly.
 *   - `× N` (proposal) uses the multiplication sign U+00D7. The regex
 *     accepts the literal character.
 */

export const REGENERATE_NAME_PATTERNS: ReadonlyArray<RegExp> = [
  /^Campaign: /,
  /^PO: /,
  / — consolidated(?:$| · )/,
  / — packing(?:$| · )/,
  / × \d+/,
];

export interface CompositionDraftInput {
  name: string;
  /** True when at least one orderPlanLinks row references this plan. */
  hasOrderPlanLinks: boolean;
}

export function isCompositionDraft(plan: CompositionDraftInput): boolean {
  // Positive signal — only saveDraftToPlan writes orderPlanLinks.
  if (plan.hasOrderPlanLinks) return true;
  // Negative signal — name matches a known regenerate-writer pattern.
  if (REGENERATE_NAME_PATTERNS.some((re) => re.test(plan.name))) return false;
  // Clean name with no order links — assume composition (manual planner
  // user-typed name, or a buildDraftsFromCampaign "{campaign} · {product}"
  // draft that just hasn't accumulated order links).
  return true;
}

// ─── Inline test cases (per AC-3) ─────────────────────────────────
//
// Documented for human review + import-on-demand from a future unit
// test file. Each line is `[input] → expected`.
//
//   1. Composition with order link:
//      { name: "Pistachio Bar batch", hasOrderPlanLinks: true } → true
//
//   2. Composition without links + clean name:
//      { name: "Strawberry Nougat × order pick", hasOrderPlanLinks: false } → true
//      (no link, but name doesn't match × \d+ because "order pick" follows)
//
//   3. Regenerate Campaign-seeded:
//      { name: "Campaign: Veganmania — Crunchy Nougat", hasOrderPlanLinks: false } → false
//
//   4. Regenerate PO-seeded:
//      { name: "PO: Replen · 2026-05-13 — Lime Passionfruit", hasOrderPlanLinks: false } → false
//
//   5. Regenerate proposal (`× N` literal):
//      { name: "Crunchy Nougat × 40", hasOrderPlanLinks: false } → false
//
//   6. Edge — buildDraftsFromCampaign middle-dot name:
//      { name: "Veganmania · Crunchy Nougat", hasOrderPlanLinks: false } → true
//      (no em-dash; matches no regenerate pattern → keep)
//
//   7. Edge — splitPlan-derived sibling:
//      { name: "PO: Veganmania — Crunchy Nougat · split", hasOrderPlanLinks: false } → false
//      (^PO: still wins; the · split suffix doesn't override. The
//      sibling inherits the regenerate parent's identity. If the user
//      wants split siblings to surface in the pool, fix at the
//      planType level — a name-only heuristic can't separate them
//      cleanly.)
