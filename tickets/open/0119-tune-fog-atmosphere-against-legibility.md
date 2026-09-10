---
id: 119
slug: tune-fog-atmosphere-against-legibility
title: Tune the fog atmosphere against atlas legibility — time-boxed
type: feature
priority: med
status: open
size: m
capability: 08-map-and-fog-renderer
depends_on: [56]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

**Split out of 0056 during backlog validation (2026-08-30).** 0056 bundled two different kinds of
work: *does the composite pass render correctly* (objectively testable — a triangle is drawn, the
mask is sampled, uniforms are wired, `smoothstep` behaves) and *does the fog look right* (taste,
iterative, no passing test). Mixing them means the aesthetic half expands to fill whatever time the
correctness half leaves, and the ticket can never be honestly called done.

0056 now owns correctness and ships the v1 uniform values as specified. **This ticket owns the
taste pass, and it is time-boxed.**

The constraint that decides every argument here is **D-051: legibility is non-negotiable, and
atmosphere may never cost it.** When a value makes the fog more beautiful and street names harder
to read inside revealed territory, the value is wrong. That is not a trade-off to balance; it is a
rule with a direction.

Tune within the ranges 0056 establishes: `u_noiseAmp`, `u_rimAmt`, `u_fogDeep`, `u_fogEdge`,
`u_rimGlow`, `u_maxOpacity`. Ship **atlas-leaning** values (`09-roadmap.md` §2.3) — capability `15`
adds the adventure mode later by changing numbers, not code.

`u_maxOpacity` stays below 1.0. Fully opaque fog reads as a hole punched in the map; a hint of the
world showing through reads as mist. Do not "fix" this by raising it to 1.

## Acceptance criteria

- [ ] Final uniform values are committed as named constants with a one-line rationale each.
- [ ] Values are recorded in `docs/capabilities/08-map-and-fog-renderer.md` so capability `15` starts
      from them rather than re-deriving.
- [ ] `u_maxOpacity < 1.0`, with the reason in a comment.
- [ ] A before/after screenshot pair at z16 over revealed ground is attached to the ticket.
- [ ] **Legibility regression check**: street names inside revealed territory are no less readable
      than with the fog layer disabled entirely. If they are, the tuning is wrong regardless of how
      it looks.
- [ ] The time-box was respected, or the overrun is recorded with what remained unresolved.

## Notes

**Time-box: 2 hours.** When it expires, ship the best values reached and file a follow-up if they
are not right yet. This is the ticket most likely to silently consume a day — `09-roadmap.md` §8.1
flags capability `08` as the most likely to overrun, and unbounded aesthetic iteration is the
mechanism by which that happens.

Tune on the **target phone in daylight**, not on a desktop monitor indoors. Values chosen on a
bright calibrated display at night are consistently too subtle outdoors — which is where this app
is actually used.

### 2026-09-10, from `0056` — two measurements to start from rather than rediscover

`0056` shipped the composite and rendered it to a PNG against a stand-in parchment basemap
(`node tools/fog-harness/render-png.mjs tmp/out.png <V1|ATLAS|ADVENTURE> <half-width-m>`). Two
things it found, both arithmetic rather than taste, so this ticket does not have to find them by
eye:

1. **The warm rim is invisible at the value that ships.** §4.3 calls it *"the single detail that
   sells the effect"*. At `u_rimAmt = 0.08` it contributes **+10/255** at its peak — measurable
   (harness probe C1) and not perceptible against the luminance step it sits on. At adventure's
   0.30 it reads clearly as a parchment-coloured band. The renders are the comparison; the honest
   summary is that 0.08 buys a hairline that is not there.

2. **`u_noiseAmp` cannot produce a ragged edge on its own, at any value in §5.2's range.** The
   noise displaces the boundary by `amp/2 x (1 - FALLOFF_INNER) x radius` — D-231's own formula —
   which is **2 m** at 0.10 and **6 m** at 0.30. The reveal ramp it has to roughen is
   `(REVEAL_HI - REVEAL_LO) x (1 - FALLOFF_INNER) x radius` = **17 m** wide. A 2 m wobble on a 17 m
   gradient is invisible; 6 m is subtle. So §4.3's *"ragged, organic mist edge instead of a smooth
   blurred blob"* is a promise about the RATIO of those two numbers, and raising `u_noiseAmp` alone
   moves it slowly. The other lever is `FALLOFF_INNER`, and **D-231 raised it to 0.60 to kill the
   neighbour seam** — so lowering it to buy raggedness trades one artefact for the other and is a
   design decision, not a tuning knob. Check `SEAM_FLOOR` before touching it.

Also worth knowing: the edge treatment is **scale dependent**. Both numbers above are ground
metres, so the wobble is a couple of pixels at a neighbourhood zoom and tens of pixels zoomed in.
Tune at the zoom the map is actually used at.

## Operator validation

Go outside in direct sunlight with the phone. At z16 over a street you have run:

1. Street names inside revealed territory must be readable **without shading the screen**.
2. The fog edge must read as drifting mist, not as a hard cutout or a wobbly outline.
3. Unexplored ground must feel genuinely dark and unknown — if it reads as merely "greyed out",
   `u_fogDeep` is too light and the core emotional beat of the product is being lost.
4. Pan for 20 seconds. The noise must animate gently; if it shimmers or crawls, `u_noiseAmp` is too
   high or the noise is sampling in screen space rather than world space.
