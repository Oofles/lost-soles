---
id: 199
slug: the-mist-is-re-randomised-every-frame-during-a-zoom-the-nois
title: The mist is re-randomised every frame during a zoom — the noise lattice is sized in screen pixels
type: bug
priority: high
status: open
size: s
capability: 08-map-and-fog-renderer
depends_on: []
blocked_by: []
source: agent
created: 2026-09-11T13:12:31Z
started: 2026-09-12T16:56:47Z
---

## Description

**Reported by the operator against `0058`'s first validation check**, the first time anyone had pinched
the map continuously: *"On a continuous zoom, the fog definitely flickers. It looks like static on a
screen when zooming."*

It is not `0058`'s culling — the revealed area was measured across a simulated 2-second pinch and moves
smoothly, with no oscillation at any band boundary. It is `0056`'s noise field, and the cause is one
line.

### The lattice is sized in screen pixels, so a zoom rescales it

`composite.ts`'s `noiseFrame`:

```js
const scale = 1 / (mercPerPixel * NOISE_PX)      // NOISE_PX = 260
```

`mercPerPixel` is a function of the zoom, so **`scale` changes on every frame of a zoom.** The absolute
lattice index of a ground point is `floor(scale × mercatorPos)` — the `u_noiseOrigin` term cancels
exactly, which is what makes D-233's panning correct — and `mercatorPos` is ~0.27, so `scale ×
mercatorPos` is ~17,000 at z15. A 1% change in scale moves that by ~170 cells.

Measured for one fixed ground point through a pinch at 0.2 zoom levels per frame:

```
z17.0  cell 70696
z16.8  cell 61544   moved 9152 cells
z16.0  cell 35348   moved 5256 cells
z15.0  cell 17674   moved 2628 cells
z14.0  cell  8837   moved 1314 cells
z13.0  cell  4418   moved  657 cells
```

`hashCell` is an integer bit-mix, deliberately (D-233 replaced a `sin`-based hash precisely so that
adjacent indices do not correlate). So a jump of hundreds of cells is a **completely uncorrelated noise
field**, produced fresh every frame. That is static.

### What D-233 actually fixed, and what it did not

D-233 anchored the noise's **translation** to the ground and proved it: two frames related by a pan
agree on the same ground point, `composite.test.ts` asserts it via `groundNoiseCoord`, and the operator
confirmed *"panning works great"* in `0056`. Nothing was ever said about the **frequency**, which stayed
pinned to the screen at one lattice cell per 260 CSS px — so the mist keeps a constant apparent
coarseness at every zoom, which is a deliberate and good art-direction property, and pays for it with a
field that has no choice but to change as the zoom changes.

`groundNoiseCoord` cannot catch this: it is `mercX × frame.scale`, so it is stable across a pan by
construction and says nothing about two frames at different zooms.

## Options considered

### A. Quantise `scale` to powers of two, so it changes only at whole zoom levels

The lattice then holds still through a pinch and steps once per zoom level. Apparent coarseness varies
by up to 2× within a level (one cell 184–368 px rather than a constant 260), which is a much weaker
artefact than static — and the step at the boundary is a single discontinuity rather than sixty a
second. Cheapest by a distance: one `Math.pow(2, Math.round(Math.log2(...)))` in `noiseFrame`.

The open question is whether a 2× coarseness swing reads as the mist "breathing" during a slow zoom.
It has to be looked at.

### B. Anchor the frequency to the ground as well — a fixed number of metres per lattice cell

The mist then behaves like real terrain: it holds still absolutely, and zooming in magnifies it. Fully
stable, and probably wrong for this map — at z10 the field would be far finer than 260 px and alias,
at z18 one cell would fill the screen and the mist would lose all texture. §4.3's constant is in pixels
because the *look* is a screen-space look.

### C. B, with an octave crossfade — the standard terrain answer

Ground-anchored frequency, with octaves faded in and out as the zoom changes so the apparent coarseness
stays roughly constant. Correct, stable, and the most work: it changes the fBm loop, and `0119`'s
deferred tuning findings are all against the current octave structure.

### D. Interpolate `scale` toward its target rather than tracking it

Hides the symptom during a slow zoom and not during a fast one, and makes the field's state depend on
camera history. Mentioned so it is not rediscovered.

**Recommendation: A**, and look at it before reaching for C. The operator's report is about a pinch,
which is exactly what A removes.

## Steps to reproduce

1. Open the map on the desktop browser, signed in, over explored ground.
2. Pinch or scroll-zoom continuously from about z17 out to z10, over about two seconds.
3. The mist boils. Holding still at any zoom, it is stable.

## Expected vs actual

**Expected:** the mist is a property of the ground being looked at, so a zoom magnifies or shrinks it.
Whatever the frequency rule, the field should not be re-randomised between consecutive frames.

**Actual:** every frame of a zoom draws an uncorrelated noise field, because the lattice index of a
fixed ground point moves by hundreds to thousands of cells per frame.

## Acceptance criteria

- [x] ~~The lattice index of a fixed ground point changes **by at most one cell per frame** during a
      continuous zoom~~ **Amended to: the lattice index of a fixed ground point does not change at
      all within a whole zoom level, and steps exactly once per level crossed** — at a realistic
      pinch rate, asserted in a test that sweeps the zoom rather than comparing two endpoints.
      *(D-243, operator, 2026-09-12.)*
      *Amended because **the original is only satisfiable by a ground-anchored frequency** (options
      B/C), and the ticket recommended A while writing a criterion A cannot meet. Quantisation trades
      ~120 small jumps for 7 large ones: modelled before any code was written, the boundary step is
      **35,625 cells** at z16.4. The operator was shown that number and the conflict, and chose A
      with this wording. Criterion 5 carries the verdict on whether the step is visible.*
      **Met:** `composite.test.ts` sweeps z17→z10 at 0.2 levels/frame and asserts drift is
      **exactly 0** within a level and that there are **exactly 7 steps** across 7 levels. Its
      sabotage half replays the pre-D-243 scale on the same sweep and measures >1,000 cells.
      `composite.test.ts`'s existing pan assertion was the model, and its blind spot — it only ever
      compares two frames at the same scale — is what let this reach the operator's eye.
- [x] Panning is still exactly ground-anchored: D-233's existing assertions pass unchanged.
      **Met**, and the two pan assertions plus the screen-space sabotage case were not touched. One
      test *stimulus* did change: the origin-cancellation sweep drove a ZOOM, which after D-243
      crosses ~5 origin boundaries instead of hundreds and would have asserted almost nothing. It
      now sweeps a PAN at fixed zoom, which still crosses hundreds. Same risk, live stimulus.
- [x] The apparent coarseness stays within the band the chosen option implies, and the number is
      recorded rather than assumed (option A implies 184–368 CSS px per cell).
      **Met, and the prediction was very slightly off in an interesting way.** The band is
      184–368 px as predicted (`NOISE_PX_MIN`/`NOISE_PX_MAX`, swept and asserted to actually reach
      both ends). But at a **whole** zoom level a cell is **256 px, not 260** — both the lattice and
      MapLibre's `512 × 2^zoom × dpr` grid are powers of two, so their ratio is one too and lands on
      `2^round(log2(260))`. Independent of zoom *and* DPR; the algebra cancels both. Named
      `NOISE_PX_QUANTISED` so the next reader finding 256 does not take it for a bug.
- [x] A `D-xxx` records which option was taken and what it costs, because §4.3's *"one lattice cell per
      260 px"* is a stated constant and any of these options changes what it means.
      **Met: D-243**, plus a new §4.3 subsection in `05-fog-of-war.md`. Both record the cost, the
      criterion amendment, and the octave-weighting exit if the per-level step is judged too visible.
- [ ] **(operator)** A continuous z17→z10 pinch on the desktop browser no longer boils. If option A is
      taken, also: does the coarseness change at a zoom-level boundary read as a step?

## Notes

- **`0058` is not implicated and its culling is not a suspect.** The revealed area across a simulated
  2-second pinch was measured at 60 frames and decreases monotonically with no oscillation; the
  instance buffer's staleness during the ~250 ms debounce window changes *which ground is drawn*, not
  the mist's texture, and would read as a boundary moving rather than as static.
- **`0119`'s deferred tuning findings are downstream of this.** They were recorded against a field
  nobody had seen move; whatever fixes this changes what "too smooth to read as ragged" means.
- The operator's other report from the same session is `0200` — a jitter on a slow pan at high zoom.
  It is probably NOT this bug (panning holds `scale` fixed, so the lattice is stable by construction)
  and is filed separately rather than merged, but whoever takes this should read that one first in case
  the two share a cause in the half-resolution mask.

## Operator validation

The report is the validation of the bug: *"On a continuous zoom, the fog definitely flickers. It looks
like static on a screen when zooming"* — desktop browser, 2026-09-11, over the operator's own ground.

A fix needs one continuous z17→z10 pinch on the desktop browser and nothing else. Everything mechanical
here is a unit test over `noiseFrame`, which is pure arithmetic and needs no GPU: sweep the zoom, assert
the lattice index of a fixed ground point moves by at most one cell per frame.
