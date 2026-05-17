# PO_PLAN_LINKS_BACKFILL_BATCH.md

**App:** Production · Workshop
**Files touched:** `src/lib/hooks.ts` (two writer functions) + one migration
**Spec date:** 2026-05-17
**Status:** approved by Manuela · ready to build · ships BEFORE the workspace batch

**Standing rules.** Evidence-per-item commits. No silent partial shipments. Do NOT write a "v2 spec" to supersede this one. If something can't be built as described, log `✗ {item} deferred — {specific reason}`. Do not interpret unilaterally. Do NOT run the backfill DELETE — there are none in this spec; if you find yourself writing DELETE, stop and ask.

---

## 0 · Why

`seedCampaignDrivenPlans` and `seedProductionOrderDrivenPlans` (both at the top of `regeneratePlansForOpenOrders`) materialize every open campaign target + PO target as a `productionPlans` row with `status='draft'`. They do NOT write `poPlanLinks` — the link to the originating `productionOrderItems` row exists only as text in the plan name (`PO: Replen · 2026-05-13 — Crunchy Nougat`).

Consequence: `aggregateDemandByProduct` reads `poPlanLinks` to subtract already-allocated demand. When link rows don't exist, it sees zero allocation. Open PO demand shows in the workspace AND the same PO appears as a separate draft plan. **Same demand counted twice.**

Fix: make these two seeders write `poPlanLinks` at the same time they insert the plan, and backfill the missing rows for already-created plans.

This is small, isolated, and solves the actual visible bug Manuela has been seeing.

---

## 1 · Scope

### In
- `src/lib/hooks.ts:8551-8559` — `seedCampaignDrivenPlans`: add `poPlanLinks` insert
- `src/lib/hooks.ts:8685-8693` — `seedProductionOrderDrivenPlans`: add `poPlanLinks` insert
- `supabase/migrations/0096_backfill_po_plan_links.sql` — backfill existing rows

### Out — do not touch
- `applyReconcileDecision` (2a, hooks.ts:8068-8107) — handles `orderPlanLinks` only, no PO involvement
- `regeneratePlansForOpenOrders` outer loop — only its two child seeders change
- `seedProductionOrderDrivenPlans` consolidation logic (the mould-cap-split into `· 1/2 · 2/2` chunks) — keep as-is
- All other 12 writers from the audit
- The `planType` column idea (separate batch)
- The pause-production hack fix (separate batch)
- `splitPlan`'s missing batchNumber (separate batch)
- Manual planner UI — do not regenerate any component

No new column. No `planType`. No structural overhaul. Just write the link rows that should already exist.

---

## 2 · Going-forward writes

### 2.1 Update `seedCampaignDrivenPlans`

Currently inserts `productionPlans` (lines 8551-8559) then `planProducts` for each chunk. After the `planProducts` insert, ALSO insert a `poPlanLinks` row.

Linking logic:
- Each plan represents one `(campaign, product)` combination, possibly split across N chunks
- The `productionOrderItems` row to link to: find the `productionOrders` row created by this campaign (search `productionOrders` where `campaignId = campaign.id`), then the `productionOrderItems` row for `productId = product.id`
- `allocatedQuantity` = `chunkMoulds × mould.numberOfCavities` (the chunk's expected output)

Pseudocode insert:
```ts
await supabase.from('poPlanLinks').insert({
  planId: newPlan.id,
  productionOrderItemId: matchingPoiId,
  allocatedQuantity: chunkMoulds * cavities,
})
```

If no matching `productionOrderItems` exists for this campaign+product (shouldn't happen but defend), skip the link insert and log a warning. Don't throw.

### 2.2 Update `seedProductionOrderDrivenPlans`

Currently inserts `productionPlans` (lines 8685-8693) then `planProducts` for each chunk. Add `poPlanLinks` insert after `planProducts`.

Linking logic:
- Each plan represents one `(productionOrder, product)` combination, possibly split across chunks
- The `productionOrderItems` row to link to: find the row where `productionOrderId = po.id AND productId = product.id`
- `allocatedQuantity` = `chunkMoulds × mould.numberOfCavities`

If no matching item exists, skip + warn, don't throw.

### 2.3 Idempotency

Both seeders are called by `regeneratePlansForOpenOrders` which runs many times. The plan insert is already idempotent (matches by name pattern, skips existing). The new `poPlanLinks` insert must also be idempotent:
- Before inserting, check if a `poPlanLinks` row with the same `(planId, productionOrderItemId)` already exists
- If yes, UPDATE its `allocatedQuantity` to the recomputed value (in case chunk math changed)
- If no, INSERT

Unique-key check is the safer pattern — add a constraint if one doesn't exist:
```sql
ALTER TABLE "poPlanLinks"
  ADD CONSTRAINT "uq_po_plan_links_plan_item"
  UNIQUE ("planId", "productionOrderItemId");
```
(This is part of mig 0096 below.)

---

## 3 · Backfill — mig 0096

File: `supabase/migrations/0096_backfill_po_plan_links.sql`

### 3.1 Pre-flight SQL (paste output into the commit BEFORE running the migration)

```sql
-- How many plans are missing poPlanLinks?
SELECT
  CASE
    WHEN name ILIKE 'Campaign:%' THEN 'Campaign-seeded'
    WHEN name ILIKE 'PO:%' THEN 'PO-seeded'
    ELSE 'other'
  END AS source,
  COUNT(*) AS total_plans,
  COUNT(*) FILTER (WHERE id NOT IN (SELECT DISTINCT "planId" FROM "poPlanLinks")) AS missing_links
FROM "productionPlans"
WHERE status IN ('draft','active','done')
GROUP BY 1
ORDER BY total_plans DESC;
```

This tells us how many rows the backfill will touch. Paste the output into the commit. If the numbers look outside expectations (e.g. 10,000 "Campaign-seeded" plans), STOP and ask before proceeding.

### 3.2 Migration content

```sql
-- supabase/migrations/0096_backfill_po_plan_links.sql

-- Step 1: add unique constraint for idempotent upserts going forward
ALTER TABLE "poPlanLinks"
  ADD CONSTRAINT IF NOT EXISTS "uq_po_plan_links_plan_item"
  UNIQUE ("planId", "productionOrderItemId");

-- Step 2: backfill missing links for PO-seeded plans
-- Match by name pattern: "PO: {po.name OR po.dueDate} — {product.name}"
-- Strategy: extract the PO identifier and product name from the plan name,
-- find the matching productionOrders + productionOrderItems,
-- create the link with allocatedQuantity = planProducts.quantity * mould.numberOfCavities.

INSERT INTO "poPlanLinks" ("planId", "productionOrderItemId", "allocatedQuantity")
SELECT
  pp.id AS plan_id,
  poi.id AS production_order_item_id,
  (plp.quantity * m."numberOfCavities") AS allocated_quantity
FROM "productionPlans" pp
JOIN "planProducts" plp ON plp."planId" = pp.id
JOIN products prod ON prod.id = plp."productId"
JOIN moulds m ON m.id = plp."mouldId"
-- Join to the PO referenced in the plan name
JOIN "productionOrders" po ON (
  pp.name ILIKE 'PO:%' AND (
    pp.name ILIKE ('PO: ' || po.name || ' — %')
    OR pp.name ILIKE ('PO: ' || po."dueDate"::text || ' — %')
    OR pp.name ILIKE ('PO: Replen · ' || po."dueDate"::text || ' — %')
  )
)
JOIN "productionOrderItems" poi ON (
  poi."productionOrderId" = po.id
  AND poi."productId" = prod.id
)
WHERE pp.status IN ('draft','active','done')
  AND NOT EXISTS (
    SELECT 1 FROM "poPlanLinks" existing
    WHERE existing."planId" = pp.id
      AND existing."productionOrderItemId" = poi.id
  );

-- Step 3: backfill for Campaign-seeded plans
-- Match by "Campaign: {campaign.name} — {product.name}"

INSERT INTO "poPlanLinks" ("planId", "productionOrderItemId", "allocatedQuantity")
SELECT
  pp.id,
  poi.id,
  (plp.quantity * m."numberOfCavities")
FROM "productionPlans" pp
JOIN "planProducts" plp ON plp."planId" = pp.id
JOIN products prod ON prod.id = plp."productId"
JOIN moulds m ON m.id = plp."mouldId"
JOIN campaigns c ON pp.name ILIKE ('Campaign: ' || c.name || ' — %')
JOIN "productionOrders" po ON po."campaignId" = c.id
JOIN "productionOrderItems" poi ON (
  poi."productionOrderId" = po.id
  AND poi."productId" = prod.id
)
WHERE pp.status IN ('draft','active','done')
  AND NOT EXISTS (
    SELECT 1 FROM "poPlanLinks" existing
    WHERE existing."planId" = pp.id
      AND existing."productionOrderItemId" = poi.id
  );
```

### 3.3 Post-flight verification SQL

After running mig 0096, paste this output into the commit:

```sql
-- Verify backfill — recount the same buckets from §3.1
SELECT
  CASE
    WHEN name ILIKE 'Campaign:%' THEN 'Campaign-seeded'
    WHEN name ILIKE 'PO:%' THEN 'PO-seeded'
    ELSE 'other'
  END AS source,
  COUNT(*) AS total_plans,
  COUNT(*) FILTER (WHERE id NOT IN (SELECT DISTINCT "planId" FROM "poPlanLinks")) AS missing_links
FROM "productionPlans"
WHERE status IN ('draft','active','done')
GROUP BY 1
ORDER BY total_plans DESC;

-- Spot-check one Crunchy Nougat row (Manuela's original bug case):
SELECT pp.id, pp.name, pp.status, pp."pinnedDate",
       (SELECT COUNT(*) FROM "poPlanLinks" WHERE "planId" = pp.id) AS po_links,
       (SELECT SUM("allocatedQuantity") FROM "poPlanLinks" WHERE "planId" = pp.id) AS po_link_qty
FROM "productionPlans" pp
JOIN "planProducts" plp ON plp."planId" = pp.id
JOIN products prod ON prod.id = plp."productId"
WHERE prod.name ILIKE '%crunchy nougat%'
ORDER BY pp."createdAt" DESC;
```

Expected after backfill:
- `missing_links` for Campaign-seeded and PO-seeded → 0
- Crunchy Nougat plans → each shows `po_links > 0` and `po_link_qty` matching the chunk size

If any "missing_links" stays non-zero, surface that in the commit with the row IDs and a hypothesis why (orphaned plan whose PO no longer exists, etc.). Do NOT delete those rows.

---

## 4 · Acceptance criteria

Each gets `✓ {item} — {file:line range or diff hunk}` or `✗ {item} deferred — {specific reason}` in the commit.

1. `seedCampaignDrivenPlans` inserts a `poPlanLinks` row per chunk it creates
2. `seedProductionOrderDrivenPlans` inserts a `poPlanLinks` row per chunk it creates
3. Both seeders' new inserts are idempotent — a second call updates the existing row rather than duplicating
4. If matching `productionOrderItems` doesn't exist (defensive case), the seeder skips the link insert with a console warning, does NOT throw
5. Mig 0096 file exists at `supabase/migrations/0096_backfill_po_plan_links.sql`
6. Mig 0096 adds unique constraint `uq_po_plan_links_plan_item` on `(planId, productionOrderItemId)` (IF NOT EXISTS guarded)
7. Mig 0096 backfills PO-seeded plans (`PO:` prefix)
8. Mig 0096 backfills Campaign-seeded plans (`Campaign:` prefix)
9. Mig 0096 is idempotent — running it twice does not duplicate rows (the NOT EXISTS guards handle this)
10. Pre-flight count SQL output pasted into commit (showing baseline `missing_links` per bucket)
11. Post-flight count SQL output pasted into commit (showing `missing_links` → 0 for Campaign- and PO-seeded buckets)
12. Crunchy Nougat spot-check SQL output pasted into commit (showing po_links > 0 on the relevant rows)
13. After deploy: open `/production-brain/manual`, find Crunchy Nougat in the demand picker. The "X of Y left" pill reflects the PO target as ALREADY allocated, not as fully open. Screenshot attached.
14. After deploy: confirm `aggregateDemandByProduct` returns lower demand totals than before for any product that had Campaign- or PO-seeded plans. (Pick 3 products, paste before/after totals from `useDemandByProduct` debug logging or direct query.)

---

## 5 · Edge cases to handle explicitly

- **PO that no longer exists** (deleted/cancelled): plan still has a `PO:` name but no matching `productionOrders` row. Backfill JOINs will exclude these naturally. The plan stays as-is. Log row IDs in the commit so we can decide whether to clean them up later. Do NOT delete in this batch.
- **PO with whitespace or special chars in name**: `ILIKE` handles spaces but watch for em-dash vs en-dash. The seeder uses ` — ` (em-dash); make sure the backfill JOIN uses the same character. Test on at least one row before running the full migration.
- **Split plans** (`· 1/2`, `· 2/2`): each chunk's `planProducts.quantity` covers its slice. Backfill creates one link per chunk, each with `chunkMoulds × cavities`. Sum across chunks should match the original PO target.
- **Surplus**: if a chunk's `chunkMoulds × cavities` > the PO target's remaining quantity, the `allocatedQuantity` should still be the full chunk output. The extra goes to surplus (`surplusDestination` handles where). Don't try to cap allocation at PO target in this batch — that's a separate concern about surplus accounting.
- **Multiple campaigns producing same product**: the JOIN to `campaigns` matches on `campaign.name` literal. If two campaigns happen to have the same name (shouldn't but possible), backfill might create duplicate links. The unique constraint will prevent it — second insert no-ops via the NOT EXISTS guard.

---

## 6 · Commit rules

Per standing app rule:
- Every AC line (14 total) gets `✓ {item} — {file:line range}` or `✗ {item} deferred — {specific reason}`
- Vague `✓ done` = not done
- Pre-flight + post-flight SQL outputs pasted in commit body
- Spot-check Crunchy Nougat output pasted in commit body
- Screenshot of `/production-brain/manual` demand picker showing Crunchy Nougat with the corrected allocation

Commit message template:

```
PO link backfill — fix double-counting in regenerate-driven plans

Schema:
✓ Mig 0096 backfill_po_plan_links — supabase/migrations/0096_backfill_po_plan_links.sql

Going-forward writes:
✓ AC-1 seedCampaignDrivenPlans writes poPlanLinks — hooks.ts:LINES
✓ AC-2 seedProductionOrderDrivenPlans writes poPlanLinks — hooks.ts:LINES
✓ AC-3 idempotent (unique constraint + upsert pattern) — hooks.ts:LINES
✓ AC-4 missing-item defensive skip — hooks.ts:LINES

Backfill:
✓ AC-5 migration file exists
✓ AC-6 unique constraint added
✓ AC-7 PO-seeded backfill
✓ AC-8 Campaign-seeded backfill
✓ AC-9 idempotent re-run

Verification:
✓ AC-10 pre-flight count:
  {paste output}
✓ AC-11 post-flight count:
  {paste output}
✓ AC-12 Crunchy Nougat spot-check:
  {paste output}
✓ AC-13 demand-picker screenshot: {url}
✓ AC-14 before/after demand totals:
  {paste 3 products}

Out of scope (correctly deferred):
✗ planType column — separate batch
✗ Pause-production hack fix — separate batch
✗ splitPlan batchNumber — separate batch
```

---

**End of spec.**
