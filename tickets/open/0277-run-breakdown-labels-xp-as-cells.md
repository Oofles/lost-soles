---
id: 277
slug: run-breakdown-labels-xp-as-cells
title: Run breakdown labels XP amounts as cell counts
type: bug
priority: med
status: open
size: s
capability: 13-home-plinth-and-chronicle
depends_on: []
blocked_by: []
source: agent
created: 2026-10-15T19:20:57Z
started: 2026-10-15T20:13:38Z
---

## Description

The run page's click-expanded breakdown (`app/run/[activityId]/run-ledger.tsx`, wording from
`lib/skills/detail.ts:386-395`) labels each XP part with its reason words, so a run whose tally reads
`58 cells claimed · 2 remembered` expands to `125 new cells · 2 remembered cells`. The numbers are XP
(58 × 2.15 = 125, 2 × 0.5 × 2.15 = 2), and the arithmetic is right, but the label says cells. `0090`'s
operator check is that the tally, the Chronicle row and the breakdown agree; as displayed they appear
not to. Found by the wave 1 smoke test of capability `13` (Amplify job 402).

## Acceptance criteria

- [ ] No breakdown line presents an XP amount with a cell-count noun. Each line either says XP
      (`125 XP · new ground`) or shows the cell count with its XP (`58 new cells → 125 XP`); the
      choice follows `06`'s run-page copy, or is asked (D-152) if `06` does not settle it.
- [ ] The breakdown's cell counts, where shown, come from the same `0090` derived feed as the tally
      and the Chronicle row.
- [ ] A test renders a run with new and remembered cells and asserts the tally, the Chronicle row and
      the breakdown show the same cell counts.

## Steps to reproduce

1. Open a run that claimed new cells and remembered some.
2. Click the tally to expand the breakdown.

## Expected vs actual

**Expected:** the breakdown is legibly XP, or its cell counts match the tally.

**Actual:** `125 new cells` beside `58 cells claimed`.

## Notes

Legibility beats atmosphere (D-051): a figure that reads as a contradiction is the failure.

## Operator validation

Perceptual: on the desktop browser, expand a real run's breakdown and say whether it reads as XP for
the cells the tally names, without having to do arithmetic.
