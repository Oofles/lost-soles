---
id: 200
slug: the-fog-edge-jitters-against-the-basemap-on-a-slow-pan-at-hi
title: The fog edge jitters against the basemap on a slow pan at high zoom
type: bug
priority: low
status: open
size: s
capability: 08-map-and-fog-renderer
depends_on: []
blocked_by: []
source: operator
created: 2026-09-11T13:12:36Z
---

## Description

**Reported by the operator against `0058`'s third validation check**, with an explicit instruction about
how much it is worth: *"On a slow pan while zoomed in close, the fog definitely jitters a bit. It's only
noticable if you are zoomed in close and moving slow, so this is a low-threat bug — just don't spend too
much effort fixing this one since the current state is acceptable."*

Filed at `low` for that reason. It is recorded rather than fixed so that it is not rediscovered from
scratch, and so that whoever is next in `composite.ts` can check it off cheaply while they are there.

## Steps to reproduce

1. Open the map on the desktop browser over explored ground, zoom in close (z16+).
2. Drag slowly.
3. The fog's edge does not track the basemap perfectly smoothly — it moves in small steps.

## Expected vs actual

**Expected:** the fog is painted on the ground, so it moves with the basemap exactly.

**Actual:** at high zoom and low pan speed, the boundary steps rather than slides.

## Acceptance criteria

- [ ] Which of the two causes it is, established by a cheap experiment rather than by argument —
      `MASK_SCALE = 1` for candidate 1, a `float64` matrix path for candidate 2. Recording the answer
      is worth more than the fix.
- [ ] If the cause is the half-resolution mask, the cost of fixing it is **priced against §6.3's
      budget** before anything is changed. 4× the mask fragments on D-124's phone is not obviously
      affordable, and "acceptable" is the operator's own word for the current state.
- [ ] **(operator)** If a fix ships: a slow drag at z17 tracks the basemap without stepping.

## Notes

**Two candidates, neither confirmed.**

**Not the noise field.** A pan holds `mercPerPixel` and therefore `scale` fixed, and the absolute
lattice index is `floor(scale × mercatorPos)` with `u_noiseOrigin` cancelling exactly — so the field is
stable under translation by construction, which is D-233's whole point and what
`composite.test.ts` asserts. `0199` is a different bug with a different cause; they were reported in the
same breath and should not be merged.

1. **The half-resolution mask (`MASK_SCALE = 0.5`), and this is the likely one.** §4.2 renders coverage
   into an FBO at half the drawing buffer, and the composite samples it. The fog boundary is therefore
   quantised to two device pixels, so a slow pan moves it in two-pixel steps while the basemap moves
   continuously. It would be invisible at speed and at low zoom — which is exactly the reported
   envelope. Cheap test: `?fog=mask` and watch the blit's edge, or temporarily set `MASK_SCALE = 1`.
   The fix, if it is this, is not free: §6.3 budgets the mask pass at half resolution, and full
   resolution is 4× the fragments.

2. **`float32` in the projection matrix at high zoom.** `setProjectionUniforms` does
   `new Float32Array(Array.from(p.mainMatrix))`, and MapLibre hands over a `Float64Array` whose
   translation terms are ~`mercator × 512 × 2^z` — around 7e7 at z17, where a `float32` step is ~8. If
   that quantisation is what moves, every disc jumps together by a pixel or so while the basemap (which
   MapLibre draws in tile-local coordinates, precisely to avoid this) does not. Distinguishable from 1
   by whether the whole field jumps or only the boundary shimmers.

**`0199` should be read first.** If it changes how the noise coordinate is derived, one of these may
already be answered or may have become easier to see.

## Operator validation

The report above is the validation of the bug. A fix needs a slow drag at z17 on the desktop browser and
nothing else; there is nothing here to smoke-test.
