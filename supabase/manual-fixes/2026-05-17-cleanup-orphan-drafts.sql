-- 2026-05-17-cleanup-orphan-drafts.sql
--
-- ONE-SHOT cleanup. Run once in Supabase SQL editor after deploying the
-- empty-draft guard in src/lib/manual-planner/save-draft-to-plan.ts.
--
-- Background: pre-2026-05-17 the save path allowed parking a draft when
-- surplusDestination was set but allocations was empty (and the auto-park
-- helper also treated surplusDestination-only drafts as "dirty"). That
-- spawned "0 lines · +N surplus" rows visible in the DraftsTray. The
-- guard is now strict, so no new orphans can be created — this script
-- removes the existing ones.
--
-- Step 1 (audit): list orphans before deleting.

SELECT
  id,
  name,
  "createdAt",
  "pinnedDate"
FROM "productionPlans"
WHERE status = 'draft'
  AND id NOT IN (SELECT DISTINCT "planId" FROM "orderPlanLinks")
  AND id NOT IN (SELECT DISTINCT "planId" FROM "poPlanLinks")
ORDER BY "createdAt" DESC;

-- Step 2 (delete): uncomment the block below and re-run. CASCADE on the
-- planProducts FK takes care of the (single) planProducts row per draft.

-- DELETE FROM "productionPlans"
-- WHERE status = 'draft'
--   AND id NOT IN (SELECT DISTINCT "planId" FROM "orderPlanLinks")
--   AND id NOT IN (SELECT DISTINCT "planId" FROM "poPlanLinks");
