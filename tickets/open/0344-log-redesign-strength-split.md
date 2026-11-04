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

## Operator validation

### For the operator: perceptual

The mock approval above. Then, after deploy, log one real Dig Deeper session on the desktop browser: does the split read right, and is it quick?

### Agent smoke test

A split log through the deployed page against the live API in a test path that is refused before write, plus the suite.
