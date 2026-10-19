---
id: 210
slug: make-the-frontier-rim-visible
title: Make the frontier rim visible — it cannot read at any rimAmt in range
type: feature
priority: low
status: closed
size: m
capability: 15-two-map-modes-and-cold-territory
depends_on: [119, 97]
blocked_by: []
source: agent
created: 2026-09-28T12:27:56Z
started: 2026-10-19T15:55:38Z
closed: 2026-10-19T20:37:40Z
---

## Description

Filed from `0119`. §4.3 calls the warm rim *"the single detail that sells the effect"* and §5.2
gives it `u_rimAmt` 0.08 (atlas) to 0.30 (adventure). **At no value in that range can it be seen.**
`0119` rendered it over the real basemap at z16 (`tools/fog-harness/tune.mjs`): 0.08 adds
~+10/255 (as `0056` measured) and 0.30 only ~+30/255. The operator approved shipping 0.30 as the
most the range allows.

The cause is structural, not a tuning miss. The shader adds `u_rimGlow * rim * u_rimAmt` to the fog
colour and *then* premultiplies by alpha, so the rim is scaled by the boundary's own alpha, about
`0.5 * u_maxOpacity` ≈ 0.45 at the rim's peak. Its only escape into cleared ground is
`alpha = max(alpha, rim * 0.10)`, which is tiny. At `u_rimAmt = 0.60` (outside the range, rendered
for comparison) a hairline appears, but on the stock grey/blue basemap it reads as a **grey outline,
not lantern light**. The parchment hue `u_rimGlow` was chosen to pick up (§5.1) does not exist until
this capability's parchment fork.

This is a design question first: what should the rim be (additive glow independent of alpha, a
wider band, a different colour), and does it wait for the parchment basemap?

## Acceptance criteria

- [x] A rim design is chosen and recorded as a `D-xxx`: how its contribution relates to fog alpha, and
      its band width and colour. *(Chosen by the operator on 2026-10-19: option B, lit mist.
      Recorded as **D-379** by the orchestrator; timing-harness finding as D-380.)*
- [x] §4.3 and §5.2 of `05-fog-of-war.md` are amended to match, including the `u_rimAmt` range if it
      changes.
- [x] Rendered over the parchment basemap (or the stock one, if the decision is not to wait) with
      `tools/fog-harness/tune.mjs`, and the rim reads as warm light at the frontier at z16.
      *(Rendered over the stock basemap, since D-373 withdrew the parchment. The operator picked B
      from `assets/0210/z16-options-sheet.png`. The deployed look is the operator check below.)*
- [x] Labels inside revealed ground at the frontier are no less readable than with the fog off (D-051).
      A rim that bleeds light into cleared ground is exactly where this can break.
      *(By construction, `lit` carries `(1 − reveal)`. `run.mjs` C1 measures 0/255 difference on
      revealed ground. Atlas labels sit above the fog layer.)*

## Notes

- `0119`'s screenshots: `docs/capabilities/assets/0119/`. The comparison sheet showing 0.08, 0.30
  and 0.60 at 2x was not committed; regenerate it with `tune.mjs` plus a variants file.
- Probably depends on the parchment fork landing first; if so, add that dependency when the fork has
  a ticket.

## Resolution

**The rim is lit mist.** Fog within about 0.55 disc radii of revealed ground (~21 m at res 11,
~20 CSS px at z16) is mixed toward warm lamplight (1.00, 0.78, 0.40) and thinned. It is zero on
revealed ground. The operator chose it from three rendered options:
- A: an additive glow outside the premultiply.
- B: lit mist.
- C: a crisp amber line.

All three were rendered at z16 in both modes against fog-off and the old rim
(`docs/capabilities/assets/0210/z16-options-sheet.png`).

**What it is, exactly** (`lib/fog/composite.ts`):
- `near` is a ring blur of the reveal ramp over the mask: 2 rings × 8 taps, inner ring weighted 2,
  outer 1.
- The taps are placed on the ground through the inverse of `q`'s screen Jacobian. That is the same
  ground→pixel matrix the D-372 warp uses, now computed once and shared. They are unrolled as
  constants (`rimTaps()`), so there is no trig per fragment.
- `lit = clamp(near × 1.5) × (1 − reveal) × u_rimAmt`, then `col = mix(col, u_rimGlow, lit)` and
  `alpha ×= 1 − lit × 2/3`.
- The old rim is gone, including its alpha floor `rim × 0.10`, which was a veil over cleared ground.

**Band width is sized from the disc** (`rimBand()`, the new `u_rimBand` uniform), as D-372 sizes
the warp. The band is the same fraction of a corridor at every zoom, and the tap spacing stays the
same fraction of a disc, so sampling quality does not change with zoom. z14 checked:
`assets/0210/z14-shipped-adventure-atlas.png`.

**Both modes share the rim.** In `FOG_MODES`, `rimGlow` and `rimAmt` (0.90) are now the same for
atlas and adventure: the operator judged the design on one set of values shown in both. The
`u_rimAmt` range is now 0..1. `RIM_GLOW`, `RIM_AMT`, `RIM_BAND_R`, `RIM_GAIN`, `RIM_THIN`,
`RIM_RINGS` and `RIM_TAPS_PER_RING` are in `fog-uniforms.ts`. Only the rim fields of the palettes
changed.

**Cost, and a broken instrument.** `run.mjs` C4 was not measuring frame time. `gl.finish()` returns
before Chromium's GPU process runs the draws, so C4 read ~0.70 ms whether the rim had 0 taps or 192.
That also invalidates `0211`'s recorded "0.70 → 0.71 ms" for the warp. C4 now ends each batch with
a one-pixel `readPixels`. Measured properly on SwiftShader at 1280×800, worst case (empty mask, so
every fragment pays):

| | ms/frame |
|---|---|
| Base composite | 15.0 |
| + edge warp | 20.5 |
| + rim | 27.0 |

The rim's cost at different tap layouts, on the same setup:

| Layout | Rim cost (ms/frame) | Note |
|---|---|---|
| 3 × 8 in a loop with sin/cos | +18 | Before any optimisation |
| 3 × 8 unrolled | +9 | Same look as 2 × 8 at z16 |
| 2 × 8 unrolled | +6.5 | Shipped |

SwiftShader is not a phone. `0059`'s `?fog=perf` on real hardware is the gate.

**Files touched:**
- `lib/fog/composite.ts`: the rim, `u_rimBand`, `rimBand()`, `rimTaps()`, the shared ground→px matrix.
- `lib/fog/fog-uniforms.ts`: the rim constants. `ATLAS` and `ADVENTURE` changed in `rimGlow` and
  `rimAmt` only.
- `lib/fog/mask-layer.ts`: passes `rimBand` from the bucket's disc radius.
- `lib/fog/__fixtures__/fake-gl.ts`: `u_rimBand`.
- `lib/fog/composite.test.ts`: new "lit-mist rim" block — size on the ground, degenerate frame
  off, tap pattern, zero on revealed ground by construction, no trig, uniform plumbing.
- `lib/fog/fog-uniforms.test.ts`: values and the shared-rim test.
- `tools/fog-harness/harness.js`: C1 rewritten for the new rim (revealed ground exactly 0, peak on
  the fog side, zero beyond the band). C4 gets a real sync point and a rim measurement.
- `tools/fog-harness/tune.mjs`, `tune-harness.js`, `README.md`:
  - `--dpr`.
  - Variant keys `_basemap`, `_base` and `_off`.
  - Fixes a real bug: `basemapStyle()` was called with no variant after `0097`.
- `docs/05-fog-of-war.md`: the overview table, §4.3 code and the new "The rim is lit mist"
  section, §5.1's note, and §5.2's `u_rimAmt` row.
- `docs/06-ui-ux.md`: the frontier-edge row of the mode table.
- `docs/capabilities/assets/0210/`: the options sheet, the shipped z16 comparison (fog off /
  shipped / `rimAmt` 0, both modes), and z14.

**Not changed:**
- `docs/09-roadmap.md` §-table row "u_rimAmt 0.08/0.30" and capability `08`'s tuning record are
  history, left as written.
- `docs/INDEX.md` is not regenerated (the orchestrator's).

## Operator validation

Desktop browser (D-240). Look at the frontier at z16 over the parchment basemap: does the rim
read as warm lantern light at a glance, without zooming the screenshot, and are the street names
at the edge as readable as with `?fog=off`? A perceptual call (D-229).

**Result.** Operator, desktop browser, 2026-10-19 — **passed**: at a z16 frontier in both modes the rim reads as warm lantern light on the mist at a glance; street names at the edge are as readable as with `?fog=off`; z14 also reads well. Local: fog harness C1 on the merged tree — peak 75/255 on the fog side, revealed ground 0/255 over 76 samples; C4 26.3 ms/frame worst case on SwiftShader (real-GPU gate is `0059`).

Smoke test (orchestrator, after Amplify job 418, commit e5bdae0): `/` 200; `/api/runs/web` signed-out 404; the deployed chunks contain `u_rimBand` and `tapToUv`, and no `max(alpha, rim`.
