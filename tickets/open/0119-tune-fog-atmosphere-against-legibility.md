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

## Operator validation

Go outside in direct sunlight with the phone. At z16 over a street you have run:

1. Street names inside revealed territory must be readable **without shading the screen**.
2. The fog edge must read as drifting mist, not as a hard cutout or a wobbly outline.
3. Unexplored ground must feel genuinely dark and unknown — if it reads as merely "greyed out",
   `u_fogDeep` is too light and the core emotional beat of the product is being lost.
4. Pan for 20 seconds. The noise must animate gently; if it shimmers or crawls, `u_noiseAmp` is too
   high or the noise is sampling in screen space rather than world space.
