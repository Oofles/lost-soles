---
id: 280
slug: plinth-and-run-page-chrome-off-the-06-8-scales-radii-pulse-a
title: Plinth and run-page chrome off the 06 §8 scales: radii, pulse and fly timing, line-height, frontier glyph
type: bug
priority: low
status: open
size: s
capability: 13-home-plinth-and-chronicle
depends_on: []
blocked_by: []
source: agent
created: 2026-10-16T04:17:55Z
---

## Description

The capability `13` audit found chrome on `/` and the run page off `06` §8's scales. Each is small;
together they are the drift §8 exists to stop.

| Where | Is | §8 says |
|---|---|---|
| `components/plinth/plinth.tsx:47,56,74` — destinations, floating ⚙, quick-view rows | `border-radius: 4px` | §8.5: controls and floating controls 8 |
| `app/run/[activityId]/run-moment.tsx:83` — ⟲ Relive | `.375rem` (6px) | §8.5: controls 8 |
| `components/plinth/plinth.tsx:62` — the one-shot pulse | `1200ms ease-out` | §8.7: one of 120/200/320/400/1400 ms on `cubic-bezier(0.2,0,0,1)` |
| `app/run/[activityId]/run-moment.tsx:354` — frontier click `flyTo` | `duration: 800` | §8.7's set (D-338 exempts only the §3.2 sequence, not this) |
| `app/run/[activityId]/run-lines.tsx:20` — chronicle line | `lineHeight: 1.45` | §8.4: 1.50 |
| `app/run/[activityId]/run-lines.tsx:78` — frontier diamond | Unicode `◇` | §8.6: drawn monoline sigil, 1.5 stroke, 24 box |

## Acceptance criteria

- [ ] Every row of the table uses the §8 value, and each value comes from a token or shared constant
      rather than a new literal where one exists (`--motion-*` / radius tokens in `app/tokens.css`,
      if defined; otherwise the literal §8 value with a comment citing the section).
- [ ] The frontier diamond is an inline SVG sigil per §8.6, `aria-hidden`, coloured by
      `currentColor`.
- [ ] Existing tests stay green; tests asserting the old literals are updated, not deleted.
- [ ] (operator) On the desktop browser, `/` and a run page's end state look the same or better: the
      8px corners do not make the rail look soft, and the pulse is still noticeable without demanding.

## Steps to reproduce

1. Open `/` and a run page's end state.
2. Inspect the elements in the table.

## Expected vs actual

**Expected:** `06` §8.4–§8.7 values.

**Actual:** as tabled.

## Notes

Filed by the capability `13` drift audit (`AUDIT.md` §2, code-was-wrong). Out of scope, noted by the
audit: `components/level-up-card.tsx:196,236` uses primitive `--gold-500`/`--ink-900` directly;
the card belongs to capability `12`.

## Operator validation

Perceptual: the rail at 8px radii, and the pulse at the §8.7 duration. Desktop browser.
