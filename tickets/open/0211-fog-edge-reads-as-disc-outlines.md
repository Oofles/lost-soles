---
id: 211
slug: fog-edge-reads-as-disc-outlines
title: The fog edge reads as disc outlines, not ragged mist — noiseAmp cannot fix it
type: feature
priority: low
status: open
size: m
capability: 15-two-map-modes-and-cold-territory
depends_on: [119]
blocked_by: []
source: agent
created: 2026-09-28T12:27:56Z
started: 2026-10-19T13:08:43Z
---

## Description

Filed from `0119`. §4.3 promises *"a ragged, organic mist edge instead of a smooth blurred blob"*.
Over the real basemap at z16 the edge still reads as **scalloped disc outlines**, a chain of
circles following the corridor, at every `u_noiseAmp` in §5.2's range, including the 0.25 that
`0119` shipped.

`0056` recorded why, and `0119` confirmed it by eye. The noise displaces the boundary by
`amp/2 × (1 − FALLOFF_INNER) × radius`, about 5 m at 0.25, against a reveal ramp roughly 17 m wide.
That ratio, not the amplitude, is what decides raggedness. The other lever is `FALLOFF_INNER`, and
D-231 raised it to 0.60 specifically to kill the neighbour seam, so lowering it trades one artefact
for the other. That is a design decision, which is why `0119` did not touch it.

Candidate directions (to evaluate, not to pick here): perturb in the mask pass rather than on the
threshold; domain-warp the coverage lookup (sample `u_mask` at a noise-offset UV) so the edge
itself moves; or accept disc outlines as the look. Any change must keep D-243's per-level coarseness
step, which the operator likes, and must re-check `SEAM_FLOOR`.

## Acceptance criteria

- [x] A decision on the edge treatment is recorded as a `D-xxx`, including whether it supersedes any
      part of D-231. *(Recorded as **D-372** by the orchestrator at merge. It does not supersede
      D-231.)*
- [x] If the shader changes: the neighbour seam stays invisible (the `run.mjs` T3 probe stays green),
      the noise stays ground-anchored under a pan (D-233), and the per-level step survives (D-243).
- [x] Rendered at z16 with `tools/fog-harness/tune.mjs` next to `0119`'s `z16-after-0119.png`.
- [ ] Labels inside revealed ground at the frontier are no less readable than with the fog off (D-051).
      *(Left for the operator. It is a perceptual call. The warp moves the edge both ways, so some
      frontier labels gain room and others lose it; see Resolution.)*

## Notes

- `0119`'s baseline: `docs/capabilities/assets/0119/z16-after-0119.png`.
- The edge is scale dependent (ground metres): judge it at the zoom the map is actually used at, and
  also at z14–z15, where the wobble is only a couple of pixels.

## Operator validation

Desktop browser (D-240). Look at a frontier at z16 and at z14: does the edge read as drifting mist
or as a chain of circles? Pan for 20 s: no crawl, no boiling. A perceptual call (D-229).

## Resolution

**What was chosen.** The operator picked variant F/H on 2026-10-19 (D-152 stop), from seven
candidates rendered at z16 and z14 with `tune.mjs`. The edge is now a **domain warp of the
coverage lookup in the composite pass**:

- The mask is read at `v_uv` plus a ground-anchored noise offset, so the boundary itself moves.
- The warp is **sized from the disc**: about ±0.45 disc radius, base wavelength about 1.75 radii.
- It is **frozen in time**, so only the `noiseAmp` wisps animate.
- The bloom follows the warped edge, because all of RGB is read at the moved point.

**Rejected, by render:**

- Pushing the threshold lever (`noiseAmp` 0.60) barely changes the edge and breaks `SEAM_FLOOR`.
- `FALLOFF_INNER` 0.35 is still scalloped, only blurrier, and brings back D-231's seam.
- Mask-pass radius noise makes the edge crinkly but the discs still read as discs. It would also
  change mask pixels (T3, R1/R2) and cost noise on every overlapping disc fragment.
- A warp held constant in screen pixels was right at z16 but bent a z14 corridor about 75 m off true.

**Files.**

- `lib/fog/fog-uniforms.ts`: `WARP_GAIN_R` (1.25), `WARP_WAVELENGTH_R` (1.75), `WARP_FREQ_MAX`
  (64), and the two integer jitters `WARP_JITTER_X` and `WARP_JITTER_Y`. The `V1_NOISE_AMP`
  comment is updated.
- `lib/fog/composite.ts`:
  - The fragment shader samples `u_mask` at `maskUv`. The offset is two fBm fields on D-233's
    lattice at an integer `freq`, mapped to UV through `inverse(mat2(dFdx(q), dFdy(q)))`, and has
    no `u_time` term.
  - New uniforms `u_warp` (amp, freq) and `u_warpOrigin`.
  - `NoiseFrame.centre`.
  - `edgeWarp`, `NO_EDGE_WARP`, `latOfMercY`, `groundWarpCoord`.
  - `CompositeFrame.warp` is optional, and omitting it means no warp, so every GPU harness probe
    renders as before.
- `lib/fog/mask-layer.ts`: caches `discRadiusM(res)` as equatorial mercator per bucket resolution
  and passes `edgeWarp(noise, r)` each frame.
- `lib/fog/__fixtures__/fake-gl.ts`: the two new uniforms resolve.
- `lib/fog/composite.test.ts`: 10 tests.
  - Ground-anchored under a 120-frame pan through the inverted matrix, plus a screen-space
    sabotage case.
  - A pinch from z17 to z10 at 0.2 levels per frame: **zero** steps from z14 to z18, at most one
    per level below.
  - Amplitude equals `WARP_GAIN_R` × the disc radius at every zoom. The frequency is a power of
    two in [1, 64] and the origin is an integer inside the modulus.
  - The frequency lands on F at z16 (4) and H at z14 (16).
  - Off on a degenerate frame.
  - Source checks that the warp is frozen (no `u_time`) and that the whole RGB is read at the
    warped point.
  - Uniform plumbing on and off.
- `tools/fog-harness/harness.js`: C4 now records the composite cost with and without the warp.
- `docs/05-fog-of-war.md`:
  - §4.3: an annotation in the sketch, and a new subsection "The edge is warped, not only
    thresholded".
  - §6.3: the composite row is annotated (D-276: amended in place).
- `docs/capabilities/assets/0211/z16-after-0211.png` and `z14-after-0211.png`: the real
  implementation over the synthetic Orlando loop, like-for-like with `0119`'s `z16-after-0119.png`.

**Decisions made.**

1. **The warp frequency is chosen from the EQUATORIAL disc radius; the amplitude uses the true
   latitude.** If the frequency followed the camera's latitude, it would sit near a rounding boundary
   around 52°N, and a north-south pan there would flip it and re-randomise the edge in mid-pan. The
   cost is that the wavelength in disc radii scales with `cos(lat)`: about 1.5 at the operator's
   30°N. That is inside the √2 that power-of-two rounding already allows.
2. **The frequency is a power of two**, so `scale × freq` is exact across zoom levels inside one
   bucket resolution. From z14 to z18 the warp is literally the same field: D-243's step happens in
   the wisps and not in the edge. It changes only at a bucket change, which redraws the mask anyway.
3. **The warp origin is `(origin × freq) mod NOISE_ORIGIN_MODULUS`, reduced on the CPU in double
   precision**, so the shader's `fbm` lacunarity keeps it under 2^24.

**D-231 is not superseded.** The mask pass is byte-for-byte unchanged. `FALLOFF_INNER` stays 0.60
and `SEAM_FLOOR` stays 0.87. The warp amplitude (±0.45 r) is under the ~0.7 r where a single-disc
corridor's coverage is still at least `SEAM_FLOOR`, so it cannot open holes in a corridor.

**Verification (worktree, SwiftShader).**

- `run.mjs`: `HARNESS PASS`.
  - T3 seam 0.980 (floor 0.87).
  - R1/R2: 0 of 256,000 pixels differ, at res 11 and at the coarse bucket.
  - C0: 15/15 uniforms live.
  - C4: 0.70 ms/frame without the warp, 0.71 with it, at 1280×800.
- `run-maplibre.mjs`: `MAPLIBRE HARNESS PASS`. The shader compiles inside the real MapLibre 6.6.0
  frame.
- `run-perf.mjs 150k`:
  - "every measured budget met"; items 1, 4 and 7 are unchanged from before the change (5,351
    peak instances, 9.6 MB retained).
  - Item 2 (GPU composite < 2 ms) reads "not measured", both before and after: the headless clock
    is virtual and there is no timer query. A real GPU has to answer it, through `?fog=perf` on the
    desktop browser.
- `tune.mjs` z16 and z14 renders of the shipped code.

**For the operator.** The warp moves the frontier both ways. In `z16-after-0211.png`, "Craft &
Common" and "FedEx" sit half under the edge, as they already did in `0119`'s image. "KRES CHOPHOUSE"
is newly half-fogged, and "Lake Eola" is fully clear. Whether that is "no less readable" is the
D-051 criterion left unticked above.
