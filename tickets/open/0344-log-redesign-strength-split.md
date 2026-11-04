---
id: 344
slug: log-redesign-strength-split
title: Redesign /log around the Strength workout split entry
type: feature
priority: high
status: open
size: m
capability: 10-add-workout
depends_on: [343]
blocked_by: []
source: agent
created: 2026-11-04T05:04:40Z
started: 2026-11-04T16:51:46Z
---

## Description

The operator invited a /log redesign (D-483). The Strength workout entry is the first entry that is more than one number: a length in minutes plus three region shares. `06` §6.3–§6.5 (one row per type, registry order, no sections) did not anticipate it.

The page should make the common case — a ~45-minute Dig Deeper session with a split — quick to log at a desk (D-288), while pushups, situps, plank, yoga and treadmill stay one-click rows.

## Acceptance criteria

- [x] (operator) Before any build, a layout mock (the real page with fixtures, or a static mock) is approved by the operator on the desktop browser. It covers the split entry's controls (minutes stepper, three share controls stepping 10%, a live per-region minutes/XP readout, a sum-to-100 indicator) and where the single-number rows sit. — verified 2026-11-04: mock v2 (https://claude.ai/artifact/HqN8PU5gu4oPRL6cMWDLAd) approved on the desktop browser. It has two columns, Full workouts (Strength, Poise, Vigil) and Quick workouts (pushups, situps, plank), the ten-block share bar with every share starting at 0%, and the single region rows hidden. Two edits on approval: drop the "click a block to add" hint, and tighten the card's side padding so "Core & total body" fits on one line.
- [x] The split entry is rendered from the ruleset's split declaration, with no `.tsx` branch on its id or on any region (D-031). A second split in the YAML would render with zero code.
- [x] LOG is disabled until the shares sum to 100%. One click commits one split log through `0342`'s path, renders optimistically, and offers the in-row 8-second undo (`06` §6.4).
- [x] The minutes and shares pre-fill from the last split log (`06` §6.4's "your last logged value"). *Amended 2026-11-04 (operator, at mock approval, D-485): the minutes pre-fill; every share starts at 0%, "to make it easier to log".*
- [x] Narrow-width layout does not break (D-251); keyboard operable; accessible names on every control.
- [x] `06` §6.3–§6.5 are amended to the approved layout. The "no sections" rule is restated for what it still protects (no reordering by frequency or recency).

## Notes

Decision: D-483. Depends on `0343` (the v5 data it renders). Cited design: `06-ui-ux.md` §6 entire, D-061, D-062, D-251, D-288.
Out of scope: the deferred sets editor and rest timer (`06` §6.6).

## Resolution

**The approved layout (D-485).** Mock v1 offered the split at the top, the single region rows
hidden, and − 40% + steppers. The operator redirected to two columns and a ten-block bar, with every
share starting at 0%. Mock v2 (https://claude.ai/artifact/HqN8PU5gu4oPRL6cMWDLAd) was approved with
two edits: drop the "click a block to add" hint, and tighten the card's sides so "Core & total body"
fits on one line. Both are built.

**Files.**
- **`rules/log-layout.json`** (new, unversioned like `sigils.json`):
  - two columns, each an ordered list of entry ids;
  - `fallbackByEntry` (minutes and distance → Full, count and seconds → Quick) for entries it does
    not list.
  - The operator chose this over ruleset fields, so a reorder is never a rescore.
- **`lib/log/layout.ts`** (new), all pure and with no ids:
  - `logSplits` and `logColumns`. A split's members are dropped as rows, and a split stands where
    its first member's row stood for the fallback order.
  - `splitPreview`: per-region whole seconds, exact through `apportionSplit` at 100%, and XP
    through the same `awardFor`, so soft caps apply.
  - `splitLogLines`: the confirmation's lines. The members' skills come first, then what they
    feed, in registry order.
- **`app/log/split-entry.tsx`** (new): the length stepper (hold-to-repeat, typed minutes), a
  ten-block bar per member, the live readout, the sum line, LOG gated on 100%, the confirmed state
  and the 8-second undo. Undo restores the logged length and shares, so a wrong share is fixed,
  not re-entered. Each bar is a `role="slider"` with arrows, Home and End; the blocks are
  mouse-only (`a11y-keyboard.test.ts` lists the `<span onClick>` with that keyboard twin).
- **`app/log/log-page.tsx`**:
  - renders `logColumns` in a two-column grid that stacks below 760px;
  - `onLogSplit` takes the same path as a row (IndexedDB first, cards, pending award), and its
    last value is the length, under the split id;
  - `onUndo` now takes an entry id;
  - the page is up to 64rem wide, with tighter sides.
- **`app/log/log-row.tsx`**: exports its three style objects for the split card.
- **`rules/sigils.json`**: a `strength` entry (the anvil), keyed by the split id.

**Docs.**
- `06` §6.3: a new wireframe, with the old one kept as the record.
- `06` §6.4: a split-entry anatomy row.
- `06` §6.5: the "no sections" rule struck and restated as "nothing reorders by frequency,
  recency or level". Column and order are the layout file's, and an unlisted entry falls to its
  entry kind's column.
- D-485.

**Tests.**
- `lib/log/layout.test.ts` (14), covering:
  - the file's own integrity;
  - v5's columns, exactly as the mock;
  - members never shown as rows;
  - unlisted entries falling back in registry order;
  - a second split rendering with no code;
  - v4 keeping its rows;
  - the preview's 540 / 405 / 405, the remainder rule, 0% and the soft cap;
  - the confirmation lines against the live standing.
- `log-page.test.tsx`: the entries in column order, the headings, and the split card's static
  render (fallback length, a slider per member at 0, LOG disabled, sigil).
- `new-workout-type.test.tsx`: the `items` helper now cuts each item at its own `</li>`. The
  column sections' closing tags had joined the last row.
- Full suite: 4,807 passed, 1 skipped. Typecheck and lint are clean, and every `amplify.yml`
  guard passes (clean copy, plus Trigger B in the repo).

**Seen before handing over.** I bundled the real components with esbuild into a harness page
(scratch in `tmp/0344-shots/`, deleted afterwards). I drove it in headless Chromium through
`tools/a11y/cdp.mjs`, light and dark, at 1280px and 400px, in four states: 0%, partial, 100%, and
logged.
- That caught one bug: region labels rendered lowercased ("upper body"), because `logRows`
  lowercases a row's unit label. `logSplits` now uses the exercise's own label.
- At 400px the page did not scroll sideways (`scrollWidth` 400).

**What went wrong.** Extracting `splitLogLines`, a scripted edit matched an empty string and
inserted two lines between every character of `log-page.tsx`. That happened because the end
anchor was searched from the top of the file and matched the row path's identical line first. I
undid it mechanically by removing exactly the inserted string, then reapplied the edit with a
bounded search. Typecheck and the tests confirm the file.

## Operator validation

### For the operator: perceptual

The mock approval above. Then, after deploy, log one real Dig Deeper session on the desktop browser: does the split read right, and is it quick?

### Agent smoke test

A split log through the deployed page against the live API in a test path that is refused before write, plus the suite.

### Agent smoke test, 2026-11-04, live

- Amplify job 454 (`cd9cf85`) SUCCEEDED.
- `GET https://soles.devaultsecurity.com/log` with no session → 307 to the sign-in page.
- `POST /api/log` with a 45-minute 40/30/30 split and no session → 404. That is the route's
  answer when there is no uid, so nothing is invoked.
- The route forwards `split` (`LOG_FIELDS`).
- The Lambda's live `BAD_SPLIT` refusals of a split were proven in `0343`.
- The first accepted split log is the operator's real session, below.

### Operator, 2026-11-04, desktop browser

After deploy, logged a real Dig Deeper session through the Strength workout split entry on /log.
The operator's words: "Looks great and logging worked perfectly." This was the first accepted
split log through the live path (page → `/api/log` → log-workout Lambda).
