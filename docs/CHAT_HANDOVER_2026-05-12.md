# CHAT HANDOVER — 2026-05-12

For new chat picking up Dulceria work. Read this FIRST before any other doc. Specific docs to load after this are listed at the end.

---

## WHO

**Manuela Torres** · Founder of Dulceria GmbH · Vienna 1020 · single founder · partner Elias handles filming/editing/shop ops support.

Premium vegan chocolate brand. PETA Vegan Food Award 2024. Gold German Chocolate Awards. Falstaff Guide 2025.

Cash crisis active. Mother's Day 2026 launch shipped May 10. New production space opens 1060 Wien June 2026.

UID ATU77645817 · FN 569595 s · GISA 34374665 · GLN 9110031417911.

---

## THREE APPS (don't conflate)

### 1. Dulceria Business Hub
- Main work management tool
- `dulceria-business-hub.vercel.app`
- Next.js / Vercel / Supabase
- Repo: `manuelatorres-cmd/dulceria-business-hub`
- Built via Cursor + Claude workflow
- Current state: ~86 commits in (11.42 → 11.86+), substantial functionality

### 2. Production app (separate, workshop)
- Batch planning, mould tracking, capacity management
- Separate repo from Business Hub
- Same Cursor + Claude workflow
- Pages: Dashboard / Daily / Planner / Needed / Manual / Equipment / HACCP / Weekly / Pivot
- Manual Planner v2 spec ready to ship (see `MANUAL_PLANNER_V2_SPEC.md`)
- Weekly Plan redesign spec ready (see `WEEKLY_PLAN_REDESIGN_SPEC.md`)
- Step grouping when ≥5 same step type same day = phase 6 (deferred)

### 3. Shopify website
- `dulceria-chocolates.com`
- Shopify Basic plan
- Current theme: REMAKE_01 (gid://shopify/OnlineStoreTheme/196252893531) — live theme is hands-off
- Full redesign + backend cleanup needed
- Separate Claude chat for this work
- Shopify MCP connected; additional Custom App access likely needed for theme/settings/tax/payment scope

---

## BRAND IDENTITY (LOCKED — don't re-litigate)

### Color palette
- Deep Teal #264443
- Cream #fef7f4
- Blush #f5d0c0 (also #fbccb9)
- Mint/Ice #b9e0d2 (co-primary — previously omitted)
- Caramel Gold #DAB73F / #e7e978
- Dark Chocolate #1F1410 (text only)

### Pillar colors (in app contexts)
Craft #2c2515 charcoal · Founder #fbccb9 blush · Product #993556 warm rose · Occasion #dab73f caramel · Proof #5dcaa5 mint · Newsletter #264443 deep teal · Blog #888780 gray.

### Visual system (in apps)
- Page bg #fbf6f1, card bg #ffffff, border-warm #e8e3d6
- Text primary #2c2515, muted #8a7e64
- Outline-only Tabler icons
- 0.5px borders, no drop shadows, no gradients
- Sentence case throughout
- Playfair Display serif for headers, system sans for body
- Tabular figures for numbers

### Brand voice
- Locked in `brand-voice.md` + `STYLE_BIBLE.md`
- DE primary (Vienna market), EN secondary
- Per-format rules (IG Reel, Stories, TikTok, Pinterest, Newsletter)
- Per-audience rules (6 personas)
- Banned word list locked
- "Treat Yourself" grandfathered (don't write new content with this phrasing, but existing uses stay)

---

## CUSTOMER PERSONAS (LOCKED in DULCERIA_STRATEGY_2026.md v2)

6 personas defined. Treatment rules per persona for content + channel mapping. Don't make up new personas without explicit ask.

---

## CONTENT STRATEGY (LOCKED in 03_CONTENT_STRATEGY_2026.md)

5 pillars with percentages:
- Craft (process / making / techniques)
- Founder (Manuela's POV / behind-the-scenes / philosophy)
- Product (specific products / pairings / use cases)
- Occasion (seasonal / gift moments / holidays)
- Proof (reviews / awards / press / partnerships)

Per-platform rules locked:
- IG Reels: 8-15 sec, no text overlay, trending audio
- IG Stories: link sticker for conversion (Engine 3)
- TikTok: founder voice, hook first 2 sec, 7-60 sec
- Newsletter: Path B (lumpy cadence, not forced weekly)
- Pinterest: deferred to Q4 2026
- LinkedIn: founder profile only

Hashtag strategy: 10 total, mix locked.

Three proven engines:
1. **Reach** — Craft pillar Reels 8-15 sec
2. **Acquisition** — giveaways, max 1 per quarter
3. **Conversion** — Stories with link sticker

---

## 2026 STRATEGIC FRAMEWORK

### Strategic pillars (LOCKED in DULCERIA_STRATEGY_2026.md)
1. **Fast Cash** — Q1-Q2 priorities
2. **Scalable Growth** — Q2-Q3
3. **High-Margin** — Q3-Q4

### Annual rhythm (LOCKED in 01_ANNUAL_RHYTHM_2026.md)
- Monthly revenue targets
- Monthly themes
- Recurring task rhythm
- Critical dates
- Crisis mode triggers

### Launches (LOCKED in LAUNCHES_SEED_2026.md)
17 launches across 2026. Key ones:
- Mother's Day 2026 — shipped May 10 ✓
- Veganmania booth + Bar Line online drop — June 4-7
- 1060 Wien production space opening — June 2026
- Subscription Box launch — September 15
- Bar Line as collection launch (booth-exclusive then online)

### Locked decisions
- Meta-only paid media, mid-July 2026, ~€150/mo
- No Google Ads 2026
- No wholesale 2026
- Pricing increase deferred to Q3 2027
- Baklava bar permanently deleted
- 14h workshop capacity per day default

### Anti-strategy (15 explicit don'ts in DULCERIA_STRATEGY_2026.md)
Read those before suggesting anything new.

---

## BUSINESS HUB APP STATE

### Architecture
- Next.js / Vercel
- Supabase backend with RLS
- Migrations through 0103+
- Tabler icons, outline-only
- shared `RichTaskRow` component for all task lists

### Features shipped (selected)
- Today / This Week / Month / Year / Dashboard / Tasks / Triage / Approval Queue
- Projects with launches, files, recent activity
- Tasks with: tier, category, project, launch, blocker, subtasks
- Dependency display + manual create UI + same-day pairing + soft enforcement on mark-done
- Brand asset library (/assets) with tags + project links
- Content calendar (V2 redesign with pillar coding)
- Content piece editor (two-column with channel preview)
- Approval send-back flow
- Strategy audit (V2 — keyword + #### parser approach)
- Calendar block grouping (real fix — sequential start times shipped 11.86+)
- Outside-hours badge
- Working hours config (07:00-23:00 / 11h default for crisis mode)
- Business crisis mode toggle (separate from working hours — filters scheduler to north-star + quarter-focus + critical only)
- Finance PIN: set-once-stays-set with lock-now and clear-PIN options
- Subtasks/checklist support (parent_task_id usage)
- Mobile audit fixes

### Tasks data
- 970 open tasks across 14 active projects
- 236 tasks (24%) have `blocked_by_task_id` dependencies set
- Tasks seeded from `08_PROJECTS_SEED.md` templates
- NO new tasks created in-app — all from MD imports

### Currently known but unshipped
- /this-week same-day pairing (different render path than /today)
- /month sidebar pillar mix tracker + upcoming preview (shipped Phase 1 incomplete on this)
- Magazine grid sizing 220x180 on /month desktop
- Pillar filter row with URL param wiring
- Strategy audit V3 (only if Manuela reports current numbers still bad)
- Server-side scheduler dependency awareness (deferred — client-side warning only)
- Wellbeing nudges component (doesn't exist yet)
- Mark-parent-done auto-cascade UI (backend cascade works)
- Row progress % on RichTaskRow

---

## PRODUCTION APP STATE

### Architecture
- Separate Next.js app
- Has its own data model documented in `manual-planner-investigation-2026-05-09.md`

### Key data model facts (verified by Cursor)
- `productionPlans` with `status` (draft/active) + `pinnedDate` for locking
- `planProducts` with `productId` + `mouldId` + `quantity` (one product per batch — by design)
- `productionDayLineItems` with `stepIds[]` + `plannedMinutes` per day per plan
- `productionSteps` with `activeMinutes` + `waitingMinutes` (active vs passive distinction)
- `productionSteps` have `sortOrder` (NO FK enforcement, just visual order)
- `moulds` with `numberOfCavities` + `quantityOwned` — auto-splits batch when demand > capacity
- `orderPlanLinks` for order → plan allocation
- POs go through `seedProductionOrderDrivenPlans` (SEPARATE from orders reconciliation)
- `capacityConfig` singleton: `peopleCount × hoursPerPersonPerDay × workingDays[]`
- Default: 14h workshop capacity per day
- Equipment table exists but scheduler IGNORES it
- Step dependencies NOT enforced (sortOrder only)
- No step cascade on move
- Mould partial fill NOT supported (always full mould, surplus → store/freezer/waste)
- Stock per-batch on `PlanProduct.currentStock`, also per-location

### Specs delivered, ready for Cursor (production app)
1. **MANUAL_PLANNER_V2_SPEC.md** — 5 phases, accumulating draft batch + 7-day grid + drag-drop save flow
2. **WEEKLY_PLAN_REDESIGN_SPEC.md** — 5 phases, compressed header + collapsible filter + 7 equal columns + step block redesign + day-detail drawer + bottom summary
3. **Mockups:** `manual-planner-v2.html` + `weekly-plan-redesign.html`

### Current production app live state
- Weekly Plan partially redesigned (11.85 commits or similar — naming convention varies)
- Phase 1 of weekly redesign mostly shipped:
  - ✓ Compressed header
  - ✓ Consolidated open-day banners (Close 05-11 / Close 05-09 buttons)
  - ✓ "Must do — by urgency" collapsed
  - ✓ Filter strip "2 sources visible · 1 cmp + 1 PO"
  - ✓ Lock icons rendering
  - ✓ Capacity accurate
- Phase 3 (step blocks redesign) needs work:
  - ✗ Still single-line, not two-line format
  - ✗ No visual hierarchy (locked / draft / passive / conflict all look the same)
  - ✗ Density variant not triggering — Tue 12.05 has 100+ blocks because Bar Launch has 17 products × multiple steps each
  - ✗ Need step grouping: when ≥5 same step type same day, collapse to one group block ("🔒 Polishing · 17 batches · 8.5m total ▶")

### Specs deferred from production app (out of v1)
See "Honest deferred items" sections in both specs:
- Cross-product batches
- Shared steps consolidation (e.g., temper dark chocolate once for AP + HC)
- Active plan mould conflict detection
- Step cascade on move
- Equipment scheduling
- Per-day capacity override
- Auto-trigger reconciler after manual save
- Multi-draft simultaneous composition

---

## SHOPIFY WEBSITE STATE

### What's planned, not done
Full redesign in a separate Claude chat. Scope:
1. Visual redesign (homepage, product pages, collections, About, Contact, footer, nav)
2. Information architecture restructure
3. Backend cleanup (Shopify settings, taxonomy, collections, tags, metafields)
4. Product data (descriptions, variants, pricing, badges, cross-sells, all in brand voice)
5. Copy (every piece of text, DE primary EN secondary)
6. Settings (checkout, payment, shipping, tax for Austria — 10% VAT for food, etc.)

### Tools available for that chat
- Shopify MCP connected (products, collections, orders, customers, analytics, basic shop info)
- Klaviyo MCP connected
- Likely needs Custom App for theme code + settings beyond MCP scope
- New chat's first task is to TELL Manuela what additional access it needs

### Constraint
- REMAKE_01 theme as baseline, don't rebuild from scratch
- Mother's Day launch already shipped, no breaking checkout
- Single founder maintenance — every decision reduces ongoing maintenance, not adds

---

## HOW WE WORK

### Cadence
- **Blitz mode**: Manuela answers fast, one question at a time, no unnecessary detail unless requested
- Claude acts as the agency and proposes specifics
- One question per response when clarifying
- Don't ask 3 questions in parallel — slows her down

### Decisions
- Manuela makes final call on tradeoffs
- Claude proposes 2-3 options with tradeoffs, not single directives
- When something is "100% your choice" Claude flags it explicitly
- Manuela catches her own contradictions and Claude's — don't be defensive when corrected

### Tone
- No filler. No "great question." No "I'd be happy to."
- Direct. Push back when wrong. Constructive disagreement OK.
- Sentence case throughout
- No emoji unless she uses them first

### When specing
- Always reference the data model where applicable
- Flag explicit deferred items, don't hide partial work
- File map at end of spec
- Phase shipping order so each phase is independently deployable
- Evidence-per-item rule on every commit

### Time estimates
- NEVER use conventional dev estimates (days/weeks)
- Default to sequencing and complexity
- Manuela's Cursor workflow ships 10-50x faster than typical dev
- What looks like "1-2 weeks" usually completes in 20-60 min
- Only give time estimates if explicitly asked

### Session pacing
- Don't tell Manuela to stop, sleep, or rest
- As long as she's there, keep going
- Only offer opinions on session length if she asks

### Visual deliverables
- Mockups when they help — interactive HTML, save to /home/claude/ and present_files
- Always check the mockup demonstrates the actual workflow, not just visuals
- Mockups skip implementation details (drag handlers wired, etc.) by design — those go in spec
- Real product data in mockups when possible (Almond Praline, Hazelnut Caramel, etc.)

### Code workflow
- Specs go in /docs/ in each app's repo
- Cursor reads specs and implements
- Evidence-per-item rule applies to every commit
- No verification gates between commits when shipping a chain (Manuela explicitly disabled these)
- Cursor sends back commit table at end of chain

---

## CRITICAL FINDINGS THIS RECENT SESSION

### 1. Ghost-shipping detected
Strategy Audit V2.1 and V2.2 were reported as shipped but NEVER deployed. Discovered via formal commit-by-commit audit. Evidence-per-item rule was implemented as the permanent fix.

### 2. Dependency invisibility
236 tasks had `blocked_by_task_id` set, but UI didn't render dependencies anywhere (lost in 11.48 migration to shared RichTaskRow). Restored in 11.70+11.75.

### 3. Calendar block sequential starts
11.66 fixed contiguous-time → category+project grouping, but block start times stayed independent (blocks overlapped). Fixed in 11.86+ with ephemeral sequential computation.

### 4. Crisis mode = TWO concepts
- **Crisis mode (business state)** — filter scheduler to north-star + critical only
- **Working hours** — when you're available (07:00-23:00 currently)
- These are SEPARATE. Don't merge them.

### 5. Path A for Claude bucket tasks
Instructions stay in task output, no auto-task creation. Path B (auto-create follow-up tasks) deferred until Path A pain hits.

### 6. Strategy audit limitations
86% of tasks are "not resolvable" by audit. This is probably CORRECT for Manuela's task structure (most tasks describe operational work, not strategic decisions). Audit may not need V3 — accept as realistic.

### 7. Production app data model gaps
Step dependencies, equipment, shared steps, cascade on move, partial-fill — all NOT modeled. Manual Planner v2 spec respects this and flags the gaps explicitly.

---

## TASKS RESOLVED BY STRATEGIC WORK (NOT operational)

These task TOPICS are resolved in docs. They map to ~60-100 actual task records in DB:
- Brand voice / tone definition
- Customer / persona definitions
- Content pillar definitions
- Launch calendar 2026
- Strategic pillars
- Annual rhythm + monthly themes
- SEO keyword strategy
- Vanity vs real KPIs
- B2B strategy + targets
- Awards strategy + press list
- Crisis mode definition
- Anti-strategy list
- Paid media decision (Meta only)

For matching to specific task records: Manuela was doing manual triage with Claude reviewing screenshot-based task groups. Slow but accurate. The strategy audit (V2) covers a subset automatically.

---

## OPEN THREADS / NEXT MOVES

### Business Hub
- Step grouping for /month sidebar pillar tracker
- Magazine grid sizing
- Pillar filter URL params
- Manual triage of remaining ~900 tasks (Manuela working through with Claude)
- Brand asset library content (upload assets)
- Strategy audit V3 only if numbers still bad

### Production app  
- Send MANUAL_PLANNER_V2_SPEC to Cursor
- Phase 3 (step block redesign) needs completion — two-line format, visual hierarchy, density+grouping
- Then phases 4-5 of weekly plan redesign

### Website
- Open new chat for website redesign
- Use prompt in `WEBSITE_REDESIGN_STARTER_PROMPT.md` (or similar)
- First task: tell Manuela what Shopify access it needs
- Then deep backend audit phase

### Strategy PDFs
- Both Executive Summary + Comprehensive need redo
- Current versions (May 6) were "not really what I imagined"
- More visual/graphic, agency-quality
- Redo when she brings it up

---

## OUT OF SCOPE (don't propose these unprompted)

- Rebuilding any app from scratch
- Adding new social platforms (Pinterest deferred to Q4 2026)
- Google Ads (no)
- Wholesale (no)
- Pricing changes (deferred to Q3 2027)
- Bringing back baklava bar (deleted permanently)
- Anything in "Anti-strategy" list in DULCERIA_STRATEGY_2026.md
- LinkedIn beyond founder profile

---

## REQUIRED FIRST READS FOR NEW CHAT

Search project knowledge for these files. Read before doing anything else.

**Brand + strategy (settled):**
1. `brand-voice.md`
2. `STYLE_BIBLE.md`
3. `DULCERIA_STRATEGY_2026.md` + `STRATEGY_ADDENDUM_2026-05-06.md`
4. `03_CONTENT_STRATEGY_2026.md`
5. `01_ANNUAL_RHYTHM_2026.md`
6. `LAUNCHES_SEED_2026.md`
7. `15_SEO_PROJECT.md`

**Business Hub:**
8. `APP_OVERVIEW.md`
9. `08_PROJECTS_SEED.md`
10. `04_AI_HANDOFF_RULES.md`

**Recent context:**
11. `STRATEGY_ADDENDUM_2026-05-06.md`

**For production app work:**
12. `manual-planner-investigation-2026-05-09.md`
13. `MANUAL_PLANNER_V2_SPEC.md`
14. `WEEKLY_PLAN_REDESIGN_SPEC.md`

**For website work:**
15. `05_WEBSITE_PROJECT.md`
16. `WEBSITE_AUDIT_2026-05.md`
17. `14_SHOP_TRANSFORMATION_PROJECT.md`

**For task work:**
18. `08_PROJECTS_SEED.md` (all task templates)

---

**End of handover. New chat ready to continue.**
