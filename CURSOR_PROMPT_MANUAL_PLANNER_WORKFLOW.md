# Cursor Prompt — Manual planner: workflow redesign

## Context
Production app · `/workshop/manual-planner` route. The page works functionally (demand → draft → drop on day → save & pin) but the workflow is broken spatially: the active draft is top-right, the week strip is at the bottom, and the week-nav controls (prev / today / next) are at the top. You can never see source + target simultaneously, so drag-and-drop forces scrolling, and switching weeks while editing a draft means scrolling up, clicking, scrolling back down. The Open demand list itself is also too tall per row, with stacked metadata that makes scanning 26+ products painful.

This sprint refactors layout and density. No data model changes, no business logic changes. Visual references attached:
- `manual-planner-sticky-mockup.html` — layout structure (sticky bottom cluster)
- `manual-planner-compact-demand.html` — final target, includes both the layout change and the compact demand list

## Scope

### 1. Page becomes a three-zone flex column

- **Top zone (fixed):** existing top tabs (Dashboard / Daily / Planner / Needed / Manual / Equipment / HACCP). Unchanged.
- **Middle zone (scrollable):** page heading + warn-strip (if any) + Open demand card. This is the *only* zone that scrolls.
- **Bottom zone (sticky to viewport):** the action cluster. Three stacked rows: drafts row, week-nav row, week strip.

The page should not have a single body scroll. The middle zone owns scroll; the bottom zone is always pinned.

### 2. Bottom action cluster — three rows

**Row 1 — Drafts row:**
- Left: **active draft card** (the "editing" batch, currently top-right in the live app). Yellow-tinted, ~360px wide, draggable. Contains: title, meta line (products · pcs · fills · active time), PO chips, action buttons (Cancel / Park as draft). Drag handle hint top-right.
- Right: **other drafts queue** — horizontally scrollable strip of draft cards (unscheduled drafts). Each card is clickable to switch active draft. Ends with a "+ new draft" dashed button.
- If no active draft: row 1 collapses to just the drafts queue full-width.

**Row 2 — Week nav row:**
- Prev week / week label (e.g. "May 18 — May 24, 2026") / today / next week buttons, left-aligned.
- Drop hint text right-aligned: *"drop active draft on a day → save & pin"*.

**Row 3 — Week strip:**
- 7 day cards in a CSS grid, equal width.
- Each card: DOW label, date, content (empty | scheduled batch summary).
- Drop targets — accept drag from active draft card.
- Today highlighted with a tinted background.
- Drop-target hover state: dashed accent border + tinted bg.

All three rows share horizontal padding (36px) for vertical alignment.

### 3. Open demand card — internal sticky header + compact rows

The Open demand card has its own sticky-top region (filters stay visible while the list scrolls inside).

**Sticky inner top contains:**
- Heading row: "Open demand · 26 products · 5 219 pcs needed" on the left, sort selector on the right.
- Filter pill row: compact pills (~3px vertical padding, 11.5px font), each with a small count badge. Active filter uses the dark green sidebar color as background, white text.
- Search input: thin, single-line.

**Group dividers:**
- One slim row per mold type (BAR FILLED, BAR THIN, HEART XXL, PRALINE BOX, etc.).
- Format: colored dot · UPPERCASE group name · "· N pcs/run" muted · product count right-aligned.
- Max height ~26px. Uppercase, 10.5px letterspaced.
- Each mold type gets its own dot color (use existing mold-type color tokens if they exist; otherwise pick stable hashes from the mold name).

**Product rows:**
- One row per product, 36–40px tall.
- CSS grid columns: `14px | 1fr | 60px | 100px | 100px | 90px | 24px` → status-dot · name · qty · spec · due · state · expand.
- **status-dot:** empty ring by default; filled pink for urgent (overdue or due ≤ today); filled yellow for the row currently in the active draft.
- **name:** product name, font-weight 600, 13px.
- **qty:** number + small "pcs" unit. Tabular numerals so columns align across rows.
- **spec:** muted secondary text — "{N} PO · {M}-cav". Tabular numerals. (Drop "{N} pcs/run" from rows since the group divider already shows it.)
- **due:** muted by default; pink + bold for urgent rows; "—" if no due date set.
- **state:** state tag — "editing" (filled yellow, white text, uppercase) for the active draft row, "in draft ×N" (muted soft chip) if already in another draft, empty otherwise.
- **expand:** hidden by default; appears on row hover. Click to expand inline and reveal underlying POs (preserve existing expand behavior).

**Row states:**
- Hover: subtle cream background.
- Urgent: pink status dot + pink due text. No background change.
- Editing (currently in active draft): yellow left border (3px) + pale yellow background + filled yellow dot + "editing" tag.

**Cut on purpose:**
- The stacked second line "{N} pcs · {M} PO · {C}-cav · {R} pcs/run" — broken into column cells + group divider.
- "X of Y left" inline counter on collapsed rows — moves into the expanded row view only.

### 4. Warn-strip (conflict banner)

Stays where it is, just above the Open demand card. Tighten padding (6px vertical, 12px horizontal) and font size (12px) to match the new density.

### 5. What does NOT change

- All existing drag-and-drop logic (which element is draggable, what handles drop, what saves to which day, batch validation rules) — preserved.
- All existing filter logic (which pills filter what subset of demand).
- All existing draft state machine (Editing / Unscheduled / Pinned / Saved).
- Data model for demand, drafts, batches, days.
- The "draft already has X" conflict check and warning text.
- Routes, navigation, sidebar.

## Non-negotiables

- **Evidence-per-item rule.** Every commit message lists `✓ {item} — {file}` for each scope item shipped, or `✗ {item} deferred — reason` for any not shipped. No silent skips.
- TypeScript clean. Build clean. tsc clean.
- All existing drag-and-drop interactions must continue to work — no regressions. Test by dragging the active draft onto multiple days, then onto another week.
- Use existing design system tokens where they exist (colors, spacing, typography). Do not introduce one-off hex values inside components; if a needed token is missing, add it to the DS layer first.
- If any layout primitive doesn't exist in the DS (sticky bottom cluster, internal sticky-top within a card), add it as a reusable component rather than inline styles.
- No new dependencies.

## Acceptance

- [ ] Page has exactly one scroll region (the middle zone). No body scroll.
- [ ] Active draft card visible at all times while the demand list is being scrolled.
- [ ] Week strip and week-nav row visible at all times while the demand list is being scrolled.
- [ ] Filter pills + search visible at the top of the demand card while scrolling through products inside the card.
- [ ] Drag from active draft to any day in the week strip works in a single short downward motion, no scrolling required.
- [ ] Clicking "next week →" while a draft is active does not change scroll position.
- [ ] Each product row is ≤ 40px tall. Group dividers are ≤ 26px tall.
- [ ] Urgent rows (overdue / due ≤ today) render with pink dot + pink due-date text.
- [ ] The "editing" row renders with yellow left border, pale yellow background, and the bright yellow "editing" tag.
- [ ] Hovering a row reveals the expand chevron; clicking it expands the row inline with the underlying POs (existing expand behavior preserved).
- [ ] All drag-and-drop, filter, search, draft state, save & pin, and park as draft flows work exactly as before.
- [ ] Build clean, types clean, commit message lists ✓/✗ for every scope item.
