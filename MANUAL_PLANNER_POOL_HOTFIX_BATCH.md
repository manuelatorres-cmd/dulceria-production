# MANUAL_PLANNER_POOL_HOTFIX_BATCH.md

**App:** Production · Workshop
**Page:** `/production-brain/manual`
**Spec date:** 2026-05-17
**Status:** approved by Manuela · ship BEFORE the workspace can be used at all
**Sequence:** hotfix → `planType` column proper fix (next batch) → resume workspace iteration

**Standing rules.** Evidence-per-item commits. No silent partial shipments. No DELETEs in this spec — if you find yourself writing one, stop. Do not interpret unilaterally.

---

## 0 · Why

The Manual Planner page is currently unusable. Screenshot evidence:

- Drafts tray shows ~80 cards
- Schedule pool shows ~80 cards
- "Combine?" column repeats one hint card per product instead of rendering once in the active draft panel

The 80 drafts are nearly all from `seedCampaignDrivenPlans` (audit §2c) and `seedProductionOrderDrivenPlans` (audit §2d). Those writers materialize every open campaign / PO target as a `productionPlans` row with `status='draft'`. The manual planner's pool + tray queries treat them as composition drafts. They aren't.

Filter them out via heuristic. The proper fix (`planType` enum column, set by each writer) is the next batch. This hotfix unblocks the page today.

---

## 1 · Scope

### In
- New shared helper: `src/lib/manual-planner/is-composition-draft.ts`
- `useDraftPlans` — apply filter
- `useSchedulePool` — apply filter
- `CombineHintCard` placement + logic fix
- Verify schedule-section default collapse (AC-18 from BATCH1 may have regressed)

### Out (next batch)
- `planType` column migration — separate
- Pause-production hack fix — separate
- Touching the regenerate writers themselves — separate
- Plan(week) page — never touched in any manual-planner batch
- Editing other features' surfaces (campaign / replen / production wizard) — never

---

## 2 · The heuristic

A draft is a manual-planner **composition draft** if any of these are true:

- It has at least one `orderPlanLinks` row (regenerate writers never write these — only `saveDraftToPlan` does)

OR — if no orderPlanLinks rows exist — its name does NOT match any of these regenerate patterns:
- `^Campaign: ` (from `seedCampaignDrivenPlans`)
- `^PO: ` (from `seedProductionOrderDrivenPlans`)
- ` — consolidated` (from `regeneratePlansForOpenOrders`)
- ` — packing` (also from regenerate)
- ` × \d+` (from `scheduleProposalOnDay` — `{product} × N`)

Note the regenerate writers use **em-dash** (`—`), not the middle-dot (`·`) used by composition writers. The patterns above are intentionally em-dash.

### Implementation

```ts
// src/lib/manual-planner/is-composition-draft.ts

const REGENERATE_NAME_PATTERNS = [
  /^Campaign: /,
  /^PO: /,
  / — consolidated(?:$| · )/,
  / — packing(?:$| · )/,
  / × \d+/,
]

export function isCompositionDraft(plan: {
  name: string
  hasOrderPlanLinks: boolean
}): boolean {
  // Positive signal: any orderPlanLinks row means manual composition
  if (plan.hasOrderPlanLinks) return true
  
  // Negative signal: name matches a regenerate writer's pattern
  return !REGENERATE_NAME_PATTERNS.some(re => re.test(plan.name))
}
```

Both hooks below call this helper.

---

## 3 · Hook updates

### 3.1 `useDraftPlans`

Currently filters `allocationCount > 0` (cleanup-batch fix — keep).

Add: also filter by `isCompositionDraft`.

Implementation: in the query result mapping, compute `hasOrderPlanLinks` per plan (already needs the link row data — join exists). Then filter:

```ts
return rows
  .filter(r => r.allocationCount > 0)
  .filter(r => isCompositionDraft({ name: r.name, hasOrderPlanLinks: r.orderLinkCount > 0 }))
```

### 3.2 `useSchedulePool`

Same change: `status='draft' AND pinnedDate IS NULL AND allocationCount > 0 AND isCompositionDraft(...)`.

Either filter client-side after the query (simpler) or push the patterns into SQL (faster for large rowsets). For ~100 rows, client-side is fine.

---

## 4 · CombineHintCard fix

Per BATCH1 spec §3.5, this card should render **at most once** — inside the `ActiveDraftPanel` — only when the user's active draft is being edited AND another **composition draft** uses the same mould.

Current behavior (per screenshot): renders multiple cards, one per product in the demand list. Wrong placement, wrong count, wrong trigger.

### Fix

1. Move `<CombineHintCard />` mount: only inside `ActiveDraftPanel.tsx`, NOT in the demand list or anywhere else
2. Trigger condition:
   - `activeDraft` exists in localStorage
   - At least one other plan exists where: `status='draft'`, `pinnedDate IS NULL`, `mouldId === activeDraft.mouldId`, `id !== activeDraft.id`, AND `isCompositionDraft(...) === true`
3. If multiple matches, show ONE card pointing to the most recently updated match (sort by `updatedAt` desc, take first)
4. If no match, render nothing (component returns null)

This was specced correctly in BATCH1 §3.5. The shipped implementation deviated. Bring it back to spec.

---

## 5 · Schedule section collapse default

BATCH1 AC-18: "Schedule section collapsed by default."

Screenshot shows it expanded. Either:
- localStorage key has been set by previous use (acceptable — user explicitly opened it before, state persists)
- OR the default is wrong on first load

Verify: clear localStorage `dulceria.manual-planner.sched-open.v1`, reload the page in incognito or after `localStorage.clear()`. Schedule section should appear collapsed.

If it does appear collapsed on a clean load: no action needed; the screenshot just reflects persisted state. Document this in the commit.

If it doesn't: fix the default to `false` and document the line change.

---

## 6 · Acceptance criteria

Each gets `✓ {item} — {file:line range}` or `✗ {item} deferred — {specific reason}`.

1. `isCompositionDraft` helper exists at `src/lib/manual-planner/is-composition-draft.ts`
2. Helper exports the function described in §2 with unit-testable signature
3. Helper has at least 5 inline test cases (composition with order links, composition without links + clean name, regenerate Campaign:, regenerate PO:, regenerate × N) — comment block or actual test file, your call
4. `useDraftPlans` applies the filter; query result excludes regenerate-driven rows
5. `useSchedulePool` applies the filter; query result excludes regenerate-driven rows
6. After deploy: drafts tray shows only manual-composition drafts. Count matches the SQL count from AC-9.
7. After deploy: schedule pool shows only manual-composition drafts. Same count.
8. `CombineHintCard` is mounted ONLY inside `ActiveDraftPanel.tsx`. Grep the codebase — confirm no other mount sites exist.
9. SQL count to paste in commit:
   ```sql
   SELECT
     CASE
       WHEN name ILIKE 'Campaign: %' THEN 'regen-Campaign'
       WHEN name ILIKE 'PO: %' THEN 'regen-PO'
       WHEN name ILIKE '% — consolidated%' THEN 'regen-consolidated'
       WHEN name ILIKE '% — packing%' THEN 'regen-packing'
       WHEN name ~ ' × \d+' THEN 'regen-proposal'
       WHEN EXISTS (SELECT 1 FROM "orderPlanLinks" WHERE "planId" = productionPlans.id) THEN 'composition (order-linked)'
       ELSE 'composition (clean name)'
     END AS bucket,
     COUNT(*) AS rows
   FROM "productionPlans"
   WHERE status='draft' AND "pinnedDate" IS NULL
   GROUP BY 1
   ORDER BY rows DESC;
   ```
10. CombineHintCard renders zero cards when no same-mould composition draft exists for the active draft
11. CombineHintCard renders exactly one card when at least one same-mould composition draft exists
12. CombineHintCard never renders outside the ActiveDraftPanel column
13. Schedule section default collapse verified — clear localStorage, reload, screenshot showing it collapsed
14. After deploy: screenshot of `/production-brain/manual` showing the cleaned-up state (manageable tray + pool, no Combine card stack on the right)

---

## 7 · Verification flow

Cursor should follow this order:
1. Implement the helper + apply it in both hooks
2. Fix CombineHintCard mount + condition
3. Run AC-9 SQL — paste output
4. Deploy
5. Clear localStorage, reload page
6. Screenshot
7. Compare visible count of tray + pool to the AC-9 "composition" bucket totals — should match

If counts don't match → investigate. Don't paper over.

---

## 8 · Out of scope (do NOT do in this batch)

- `planType` enum column (NEXT batch)
- Touching `seedCampaignDrivenPlans` or `seedProductionOrderDrivenPlans` (they'll get `planType` writes in the next batch)
- Removing the `· consolidated` name suffix in favor of `siblingGroupId` (audit §2b note — separate batch)
- Pause-production hack at `workshop-actions.tsx:116`
- splitPlan's missing `batchNumber` (audit §2g)
- Backfilling poPlanLinks for regenerate-driven plans (that's PO_PLAN_LINKS_BACKFILL_BATCH — separate spec, ships in parallel or before; not blocked by this hotfix)

---

## 9 · Commit rules

- All 14 ACs get `✓ {item} — {file:line range}` or `✗ {item} deferred — {specific reason}`
- AC-9 SQL output pasted into commit body
- AC-14 screenshot attached
- AC-13 clear-localStorage screenshot attached
- No vague `✓ done`. File and line refs required.

Commit message template:

```
Manual Planner hotfix — filter regenerate-driven drafts out of pool + tray, fix CombineHintCard placement

Helper:
✓ AC-1 isCompositionDraft helper — src/lib/manual-planner/is-composition-draft.ts
✓ AC-2 exports + signature — same file
✓ AC-3 inline test cases — same file (or test file)

Hooks:
✓ AC-4 useDraftPlans filter — hooks.ts:LINES
✓ AC-5 useSchedulePool filter — hooks.ts:LINES

UI:
✓ AC-8 CombineHintCard mount audit — grep results pasted
✓ AC-10/11/12 CombineHintCard render logic — ActiveDraftPanel.tsx:LINES + CombineHintCard.tsx:LINES

Defaults:
✓ AC-13 schedule section default-collapse verified — localStorage cleared, screenshot attached

Verification:
✓ AC-6 drafts tray count: {N composition rows visible, matching AC-9 bucket}
✓ AC-7 schedule pool count: {M composition rows visible, matching AC-9 bucket}
✓ AC-9 SQL bucket count:
  {pasted output}
✓ AC-14 cleaned-up screenshot: {url}

Out of scope (correctly deferred):
✗ planType column — next batch
✗ Pause-production hack — separate
✗ splitPlan batchNumber — separate
```

---

**End of spec.**
