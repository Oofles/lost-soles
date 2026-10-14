---
id: 252
slug: d238-elision-lowers-interior-vertices
title: D-238's bridge elision lowers the steady mask at interior vertices where H3 cells run large
type: bug
priority: low
status: open
size: m
capability: 08-map-and-fog-renderer
depends_on: []
blocked_by: []
source: agent
created: 2026-10-08T19:51:17Z
started: 2026-10-14T19:29:18Z
---

## Description

Found by `0079`'s monotonicity test (D-293). **D-238's bridge elision can lower the steady-state mask
on ground that was already clear, when a run lands beside it.**

D-238 elides a bridge once both its endpoints have six revealed neighbours, on the claim that *"the
worst-covered interior point is a three-cell centroid, 28.6 m from the nearest centre against a
38.7 m disc"* — i.e. interior ground is saturated without bridges. That figure is the **average**
res-11 circumradius. H3 cells vary by roughly ±8%:

| place | res-11 circumradius | vertex d/r | interior vertex mask, bridges elided |
|---|---|---|---|
| Orlando 28.54°N | 26.5–28.7 m | 0.74 | ~0.72 |
| 30°N 100°E (perf fixture) | 28.1–29.6 m | 0.76 | ~0.68 |
| Point Nemo 48.9°S | 30.6–31.1 m | 0.80 | ~0.58 |

A cell on the edge of explored ground keeps its bridges (it has < 6 revealed neighbours). When a run
lands beside it, it becomes interior, its bridges are elided, and the mask at its vertices **drops**
— from 1.0 to ~0.58 at Nemo, measured on the CPU twin and on SwiftShader. Through the composite
(`smoothstep(0.30, 0.72, coverage + noise)`) 0.58 is ~74% revealed: ground that was clear takes on
a faint honeycomb of mist. D-020 is about the set, not the mask, but *"a user cannot tell those
apart by looking"* (`route-corridor.ts`).

At the operator's own latitude the drop is to ~0.72, which the composite renders clear — so this is
likely invisible at home today, and real elsewhere.

## Acceptance criteria

- [x] Decide the fix: e.g. size the disc from the cell's ACTUAL circumradius rather than the average,
      or elide only when the interior vertex coverage stays above `REVEAL_HI` (0.72), or keep bridges
      whose removal would drop any vertex below it.
- [x] A test asserts the steady-state mask never decreases at any sample point when cells are ADDED
      next to explored ground, at Nemo-sized cells.
- [x] §6.4 item 1's ceiling still holds at 400×800 (the elision exists for it).
- [x] `reveal.test.ts`'s monotonicity test can then drop its `min(previous, settled)` allowance and
      assert plain monotonicity.

## Steps to reproduce

1. In `lib/fog/reveal.test.ts`, change the res-11 monotonicity assertion's floor from
   `Math.min(previous, settled)` to `previous`.
2. `npx vitest run lib/fog/reveal.test.ts` — it fails at a three-cell vertex ~85 m west of the
   route's start, inside the earlier ground, reading 0.58 where the pre-run mask read 1.0.

## Expected vs actual

**Expected:** adding explored cells never lowers the mask anywhere (the map visibly never re-fogs).

**Actual:** at Point Nemo the steady post-run mask is 0.58 at an interior vertex the pre-run mask
covered at 1.0, because D-238 elides the bridge that covered it once the run makes both endpoints
interior.

## Notes

Filed by `0079` (`source: agent`). Not fixed there: the reveal must equal the steady state at
`p = 1`, so this is the renderer's to fix, not the animation's (`0079`'s own Notes say exactly
that). Repro: `lib/fog/reveal.test.ts` at res 11, or `tools/fog-harness` R3 with the allowance
removed.

## Resolution

**Fix (D-304): an interior cell takes a saturating disc in place of the bridges D-238 elides.**
None of the three fixes the ticket suggested reaches plain monotonicity. Sizing discs from the actual
circumradius still leaves every vertex at d = 0.74 of the radius, reading 0.72 — a drop from the 1.0
a bridge gave it. Eliding only above `REVEAL_HI` keeps nearly every bridge and breaks the ceiling.
So instead a cell with six revealed neighbours, **none with a lower fraction** (operator's option
(a), so a coarse cell never paints a dimmer neighbour up to its weight), draws its disc at
`farthest boundary vertex ÷ FALLOFF_INNER × 1.02`, measured in mercator on its own boundary. The
whole cell then reads 1.0, so its bridges have nothing left to add. Bridges are elided only between
two saturating cells; an interior cell that fails the fraction gate keeps its nominal disc and its
bridges. The disc reaches ~1.7 circumradii and the revealed neighbours' outer edge is ≥ 2, so
nothing leaks past explored ground.

Files:
- `lib/fog/instances.ts` — `saturatingRadius`, the `saturates` memo, growth of saturating cells'
  discs (a copy, so bridges still average the nominal radii), elision gated on `saturates`. Header
  comment extended.
- `lib/fog/instances.test.ts` — new block: Nemo cells really are large (> 1.05× average); adding a
  ring or a one-sided strip never lowers any 2 m sample over the earlier ground; a cell with a
  dimmer neighbour keeps its nominal radius and its bridges. Against the old code, 7,933 / 2,271
  samples dropped and the gate test failed.
- `lib/fog/reveal.test.ts` — monotonicity now plain `previous`; the old allowance comment replaced.
  Confirmed it fails both res-11 cases against the old `instances.ts`.
- `tools/fog-harness/harness.js` — R3 floor is now `previous`.
- `docs/05-fog-of-war.md` §4.1 and §6.4, `docs/decisions/DECISIONS.md` D-304, `docs/INDEX.md`
  regenerated.

**Cost:** the fraction gate keeps a few more bridges at coarse buckets and at group borders. The
400×800 peak went 5,271 → 5,350 at z14 (vitest) / 5,351 (SwiftShader perf harness), still under
6,000 and still identical at 50k/150k/500k. z8 at 500k went 390 → 539.

**The reveal animation (`0079`) needed no change**, as expected: the grown disc differs bit-wise
from the nominal one, so `tagReveal` treats it as post-only (fades in) and the nominal one as
pre-only (switches off late). Its own tests prove `p = 1 ≡ steady` still holds.

Pre-existing, unrelated: in the working tree, `npm run typecheck` and one `strava/adapter.test.ts`
case fail on the gitignored `tmp/` leftovers. On a clean copy of the tracked tree, typecheck, lint,
every `amplify.yml` guard and the suite pass. The only failures there were amplify CDK suites that
refuse a symlinked `node_modules`, and those pass in the real tree.

## Operator validation

**Smoke tests (done):** `node tools/fog-harness/run.mjs` on SwiftShader: R1–R4 pass at res 11 (z15)
and coarse (z11.5), R3 with plain monotonicity: *"0 pixel-steps fell below the previous step"*.
`run-cull.mjs` PASS. `run-perf.mjs` PASS, visibleInstanceCount 5,351 peak at z14, ≤ 6,000.

**Perceptual (operator, desktop browser, not yet done):** `?fog=mask`, on solid explored ground beside a recent run: the raw mask inside the
solid area should be uniformly white, with no honeycomb at the cell vertices.
