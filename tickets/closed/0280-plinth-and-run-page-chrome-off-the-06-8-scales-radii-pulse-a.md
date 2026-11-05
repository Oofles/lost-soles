---
id: 280
slug: plinth-and-run-page-chrome-off-the-06-8-scales-radii-pulse-a
title: Plinth and run-page chrome off the 06 §8 scales: radii, pulse and fly timing, line-height, frontier glyph
type: bug
priority: low
status: closed
size: s
capability: 13-home-plinth-and-chronicle
depends_on: []
blocked_by: []
source: agent
created: 2026-10-16T04:17:55Z
started: 2026-11-05T16:21:32Z
closed: 2026-11-05T16:44:39Z
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

- [x] Every row of the table uses the §8 value, and each value comes from a token or shared constant
      rather than a new literal where one exists (`--motion-*` / radius tokens in `app/tokens.css`,
      if defined; otherwise the literal §8 value with a comment citing the section).
- [x] The frontier diamond is an inline SVG sigil per §8.6, `aria-hidden`, coloured by
      `currentColor`.
- [x] Existing tests stay green; tests asserting the old literals are updated, not deleted.
- [x] (operator) On the desktop browser, `/` and a run page's end state look the same or better: the
      8px corners do not make the rail look soft, and the pulse is still noticeable without demanding. — verified 2026-11-05: operator reports validation good.

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

## Resolution

*(Work committed 2026-11-05 in `b0ec260`; closed the same day after the operator check.)*

**Tokens added**, because `app/tokens.css` had none for shape or motion, and a literal with a comment
would have let the next component invent its own value:
- `app/tokens.css`: `--radius-control: 8px` (§8.5), `--motion-{state,exit,sheet,reveal,long}`
  (120/200/320/400/1400 ms) and `--ease-standard: cubic-bezier(0.2, 0, 0, 1)` (§8.7).
- `lib/motion.ts` (new): `MOTION_MS` and `easeStandard()`, the same scale as numbers for MapLibre
  camera calls, which take milliseconds and a function, not CSS. `easeStandard` reuses
  `easeInOut`'s bisection from `lib/map-mode.ts`, on the standard curve. `lib/motion.test.ts` checks
  that the TS and CSS values agree, and that the curve is monotone and decelerating.

**The table, row by row:**
- `components/plinth/plinth.tsx`: destinations, ⚙ and quick-view rows use `var(--radius-control)`.
  The plinth panel's own `8px` (line 44) was already on the scale and was left alone. The pulse is
  `var(--motion-long) var(--ease-standard)`, so 1200 → **1400 ms**, the nearest slot on the scale.
- `app/run/[activityId]/run-moment.tsx`: ⟲ Relive uses `var(--radius-control)`. The frontier
  `flyTo` uses `duration: MOTION_MS.long, easing: easeStandard`, so 800 → **1400 ms**. §8.7 names "a
  camera fly" without giving it a slot. 400 ms would turn a fly across the map into a jump cut, and
  1400 is the only long slot, so this was a judgement call, agreed with the operator before building.
- `app/run/[activityId]/run-lines.tsx`: chronicle `lineHeight` 1.45 → 1.5. The frontier `◇` glyph is
  now `<Mark paths={FRONTIER} size={16} />`: a monoline diamond on the 24 box at stroke 1.5,
  `currentColor`, `aria-hidden` (from `Mark`). `FRONTIER` is a constant in `components/sigil.tsx`
  next to `CREST`, not in `rules/sigils.json`, because it is not a skill. The button's
  `alignItems` changed from `baseline` to `center`, because an SVG has no text baseline.

**Tests updated, none deleted:**
- `run-moment.test.tsx`: no longer expects `◇` in the text. It now asserts the inline SVG
  (`currentColor`, `aria-hidden`, the diamond path).
- `plinth.test.tsx`: the pulse assertion expects the tokens instead of `\d+ms ease-out`. The
  "only colour is `--accent-text`" check now skips `--motion-*`/`--ease-*` variables before checking
  colours. That check broke first time because it treated every `var()` as a colour.

**Out of scope, seen in passing:** §4.3's atlas ↔ adventure cross-fade uses `ease-in-out`
(`lib/map-mode.ts`), while §8.7 says one easing "for everything". This is a doc-vs-doc tension, not
this ticket's table, so it was left for the capability audit.

Full suite: 4813 passed, 1 skipped. `tsc`, eslint and `check-design-tokens` are clean.

## Operator validation

Perceptual: the rail at 8px radii, and the pulse at the §8.7 duration. Desktop browser.

**Result, 2026-11-05, desktop browser (operator):** good. The 8px rail, the 1400ms pulse, the drawn frontier diamond and the 1400ms fly were all accepted as they are.
