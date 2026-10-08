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

- [ ] Decide the fix: e.g. size the disc from the cell's ACTUAL circumradius rather than the average,
      or elide only when the interior vertex coverage stays above `REVEAL_HI` (0.72), or keep bridges
      whose removal would drop any vertex below it.
- [ ] A test asserts the steady-state mask never decreases at any sample point when cells are ADDED
      next to explored ground, at Nemo-sized cells.
- [ ] §6.4 item 1's ceiling still holds at 400×800 (the elision exists for it).
- [ ] `reveal.test.ts`'s monotonicity test can then drop its `min(previous, settled)` allowance and
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

## Operator validation

Desktop browser, `?fog=mask`, on solid explored ground beside a recent run: the raw mask inside the
solid area should be uniformly white, with no honeycomb at the cell vertices.
