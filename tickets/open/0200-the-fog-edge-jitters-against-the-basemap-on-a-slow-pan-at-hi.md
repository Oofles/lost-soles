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
started: 2026-09-28T14:59:00Z
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

- [x] Which of the two causes it is, established by a cheap experiment rather than by argument —
      `MASK_SCALE = 1` for candidate 1, a `float64` matrix path for candidate 2. Recording the answer
      is worth more than the fix.
      — **Candidate 2, the `float32` matrix.** Measured on SwiftShader through the shipped shader:
      `MASK_SCALE` 0.5 and 1 gave identical steps. See `## Resolution`.
- [x] If the cause is the half-resolution mask, the cost of fixing it is **priced against §6.3's
      budget** before anything is changed. 4× the mask fragments on D-124's phone is not obviously
      affordable, and "acceptable" is the operator's own word for the current state.
      — **Did not apply.** The mask was ruled out, so it was never priced, and `MASK_SCALE` is
      unchanged at 0.5.
- [x] **(operator)** If a fix ships: a slow drag at z17 tracks the basemap without stepping.
      — verified 2026-09-28: operator, desktop browser — "the slow drag looks great and fog slides with the map appropriately."

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

## Resolution

**The cause was candidate 2: `float32` rounding of the projection matrix. The half-resolution mask
played no part.** A fix shipped (D-248). It costs nothing on the frame path.

**The experiment.** I used a throwaway probe built on the `tools/fog-harness` pattern (it lived in
the session scratchpad and is not committed). It compiled the shipped `mask.ts` into headless
Chromium on SwiftShader and built a MapLibre-shaped z17 matrix at DPR 2 over Philadelphia. It then
panned 0.2 device px per frame for 50 frames, reading the mask's 0.5 crossing on the disc-centre
row each frame:

| variant | worst edge error | frames that did not move | largest jump |
|---|---|---|---|
| shipped, `MASK_SCALE = 0.5` | 2.18 px | 48/50 | **4.5 px** |
| shipped, `MASK_SCALE = 1` | 2.18 px | 48/50 | 4.5 px |
| relative to an origin, 0.5 | 0.20 px | 20/50 | 0.5 px |
| relative to an origin, 1 | 0.16 px | 20/50 | 0.5 px |
| **after the fix (shipped code)** | **0.20 px** | 20/50 | **0.5 px** |

The mask's resolution made no difference. The Notes' argument for candidate 1 ("boundary quantised
to two device pixels") assumed a hard edge. The ramp is soft (40% of a ~100 m radius, ~180 device
px at z17), and a smooth function sampled on a grid moves continuously when the grid shifts by a
fraction of a pixel. What remains after the fix is the `R8` byte quantising that ramp, which is
sub-pixel.

Notes' distinguishing test: "whether the whole field jumps or only the boundary shimmers". Candidate
2 moves every disc together. The only visible thing the discs produce is the boundary, and the noise
is anchored separately in double (D-233), so from outside the two look alike. That is why a
measurement settled it where looking could not have.

**The fix.** It is `lib/fog/mask.ts` only.
- `uploadInstances` subtracts the first instance's centre from every centre (a copy, once per
  upload) and records it as `MaskResources.origin`.
- `translated(m, origin)` composes `M × T(origin)` in double and only then rounds to `float32`.
  `setProjectionUniforms` uploads that. The ~1e7 translation terms cancel in 53 bits on the CPU
  instead of in 24 on the GPU.
- The vertex shader gained `uniform vec2 u_origin` and projects `u_origin + a_center + …`. Under the
  mercator prelude it is `(0,0)`. Under `#define GLOBE` the prelude is not a plain `M × (p,0,1)`, so
  the matrix is left alone and `u_origin` carries the origin at the old precision
  (`MaskResources.foldOrigin`). The app does not use globe today. I kept this path because the
  file's header claims globe support, and breaking it silently would be a worse bug than this one.

**Tests.** `lib/fog/mask.test.ts` gains `ground-relative instances — 0200` with six tests. They
emulate the shader's `float32` arithmetic with `Math.fround` so they run in CI. A sabotage case
asserts the old path is off by more than 1 px at z17. The fixed path is held under 0.01 px. The
remaining tests cover `translated()` against hand arithmetic, the relative upload, the mercator fold
and the globe non-fold. `fake-gl.ts` now resolves `u_origin`, since a real compiler keeps a uniform
the shader uses. Two string assertions on the old shader line, in `mask.test.ts` and
`no-per-frame-projection.test.ts`, were updated to the new line. Full suite: 2144 passed. `tsc` and
eslint are clean.

**Docs.** `05` §4.2's shader sketch had the absolute `projectTile(a_center + …)` line, so it was
amended with a paragraph under the block (drift rule), and D-248 was recorded.

**What went wrong along the way.** `node` was not on the shell's PATH, so I ran it through `fnm`.
The harness's default `/usr/bin/chromium-browser` does not exist here, so I ran it with
`CHROMIUM=/snap/bin/chromium`. My first relative-upload test compared against rounded decimal
literals, which was wrong because the inputs are themselves `float32`. I fixed it to compare
`fround` values exactly.

## Operator validation

**Smoke tests run by the agent (2026-09-28, WSL, headless Chromium, SwiftShader):**
- `CHROMIUM=/snap/bin/chromium node tools/fog-harness/run.mjs`: **HARNESS PASS**. T1–T6, the S1
  sabotage cases and C0–C4 are all green, so the relative upload did not move a single asserted pixel
  (the fraction, the union, the seam at 0.980, the bridges and the ground-anchored noise).
- `node tools/fog-harness/run-maplibre.mjs`: **MAPLIBRE HARNESS PASS**. The new shader compiles and
  draws against MapLibre 6.6.0's real mercator prelude (`define="#define PROJECTION_MERCATOR"`),
  2395 instances, state restored, `gl.getError 0x0`.
- The pan probe against the shipped code: worst edge error went from 2.18 to 0.20 px and the largest
  frame-to-frame jump from 4.5 to 0.5 device px (table above).

**Operator, 2026-09-28, desktop browser:** at z17 over explored ground, a slow drag. *"The slow
drag looks great and fog slides with the map appropriately."* No stepping.
