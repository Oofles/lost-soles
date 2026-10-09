---
id: 79
slug: fog-reveal-animation-api
title: Drive the 08 coverage mask from an animation clock, not from the cell set
type: feature
priority: high
status: open
size: m
capability: 12-post-run-moment
depends_on: [55, 56]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-08T19:20:14Z
---

## Description

**This is the ticket that couples `12` to `08`, and it is why the roadmap (§7.3) ranks this
capability the second most likely to overrun.** Do it first, alone, before any choreography.

As shipped by 0055, the coverage mask is a pure function of the explored cell set: hand it cells,
it splats discs, `gl.blendEquation(gl.MAX)` unions them, done. Beat 1 needs something else — the
mist must retreat **behind a travelling light**, which means the mask must be a function of an
animation parameter as well as of the cell set.

Add exactly one seam to the `08` renderer:

- The mask layer accepts an optional **reveal set** — cells not yet in the persisted explored set —
  plus a scalar `revealProgress` in `[0,1]`.
- Each reveal cell carries its **arc-length position** along the run's `latlng` stream, normalized
  to `[0,1]`. A cell is splatted when `revealProgress >= itsArcPosition`, with a short ramp so the
  edge softens in rather than popping.
- `revealProgress = 0` renders identically to the pre-run mask. `revealProgress = 1` renders
  identically to the post-run mask, **bit-for-bit the same as feeding the persisted set**. That
  equivalence is the whole safety property: the animation can never leave the map in a state the
  steady-state renderer would not have produced.

Two constraints from `06-ui-ux.md` §3.2 that shape the API:

1. **The reveal is client-side and never waits on the server.** The client already draws the run's
   polyline into the mask as a thick soft line (`05-fog-of-war.md` §4.4, the "optimisation worth
   taking"), so beat 1 does not block on the server's `ExploredCell` write. Latency can never delay
   it. The reveal set is computed locally from the trace; the server write reconciles afterwards.
2. **Progress is arc-length parameterised, not time parameterised.** A 3 km run and a 20 km run both
   take 2.2 s. Pace is not the subject. This ticket owns the parameterisation; 0080 owns the clock
   that drives it.

Ship it with a **debug scrub control** (dev build only) that drags `revealProgress` from 0 to 1 by
hand. That control is how this ticket gets validated without any of beat 1 existing, and it is how
a renderer regression gets bisected later.

## Acceptance criteria

- [x] The mask layer exposes `setReveal(cells, progress)` where each cell has a normalized arc
      position; calling it does not reallocate the FBO or rebuild the instance buffer per frame.
      — `FogMaskLayer.setReveal` / `setRevealProgress`. `reveal.test.ts` scrubs 60 steps on a fake
      GL: zero `bufferData`/`bufferSubData`/`texImage2D`/`createFramebuffer`, one draw per step,
      `u_reveal` the only thing that changes.
- [x] `progress = 1` produces a mask identical to passing the same cells through the steady-state
      path — verified by a pixel-diff of two `readPixels` captures at zero tolerance.
      — `tools/fog-harness` R1, SwiftShader: **0 of 256,000 pixels differ** at res 11 (z15) and at a
      coarse bucket (z11.5), streams from the shipped derivation. CPU twin: same instances, same order.
- [x] `progress = 0` produces a mask identical to the pre-run mask.
      — harness R2: **0 of 256,000 pixels differ**, both zooms. R4 proves the diff can see a
      difference in these streams (pre vs post: 49,965 and 256,000 pixels).
- [x] `progress` is monotonic in coverage: no cell that is revealed at `p` is unrevealed at `p'>p`.
      — per cell: `revealWeight` non-decreasing for every arc. Per PIXEL (stronger): harness R3, 65
      steps, 0 pixel-steps below `min(previous, settled)`. The `settled` allowance is D-238's, not
      the reveal's — see D-293 and `0252`. A sabotaged tagger fails the test at both zooms.
- [x] The reveal set is computed from the local trace with no network call; the animation runs
      correctly with the network disabled entirely.
      — `revealCellsForRoute` runs the domain's own `segmentsToCells` on the route the page holds.
      `reveal.test.ts` stubs `fetch` to throw and removes `XMLHttpRequest`, then computes, culls,
      tags and draws a full 0→1 sweep: `fetch` never called.
- [ ] Frame time with a reveal set of 130 cells stays inside the `05-fog-of-war.md` §6.4 budget in
      the desktop browser, measured with the 0059 harness — not assumed.
- [ ] The dev-only scrub control exists and moves the fog edge smoothly end to end.
- [x] Zoom bucketing and viewport culling (0058) still apply to the reveal set; a run partly
      offscreen does not splat offscreen cells.
      — both streams go through `ZoomBucketStore` + `cullBucket` with one padded box.
      `reveal.test.ts`: at z17 on the route's start, no instance lies beyond the padded east edge,
      and none of the >10 reveal cells past it is in the stream.

## Notes

**Explicit schedule risk.** §7.3: *"a renderer change late in `12` is a `08` regression."* This
ticket is that change, isolated deliberately so the regression risk is paid once, early, with the
`08` perf harness still fresh — instead of surfacing halfway through choreography work when it is
expensive to distinguish "the animation is wrong" from "the renderer is wrong".

If the equivalence criterion cannot be met — if the animated path and the steady-state path diverge
by more than rounding — **stop and fix the renderer**, do not paper over it in the animation. A
divergence here means the map lies about what you explored, and that is the trust failure the whole
project is organised around (D-051, and S4's "a corner-cut route drawn in a celebratory animation is
exactly how trust dies").

Nothing in this ticket is user-visible. That is intentional.

**2026-10-09 — state at end of the build session (handoff for the close).** Built and deployed
(`8ee39bc`, `f54f816`); criteria 1–5 and 8 ticked with evidence. **Open: 6 and 7, both the
operator's** — 6 is a frame-time reading only a real desktop GPU can give (headless SwiftShader
read p50 16.70 ms with 45% dropped, which is the software rasteriser, not a verdict); 7 is the
perceptual check below. Agent smoke against the deployed site (`tmp/0079/smoke.mjs`, throwaway
Cognito user + synthetic 2.5 km loop at Point Nemo, all deleted after): 10/10 — no control without
the flag; `?fog=scrub` and `?fog=scrub,mask` mount it; the slider drives progress; the layer logs
`reveal=195 cells (0 always, 601 in, 0 out)`; ▶ 2.2 s reports through `0059`'s collector; no console
errors. Screenshots at p = 0 / 0.25 / 0.5 / 1 show the corridor clearing from the start, in route
order. The smoke also found a real bug — an account with no explored blob installed no reveal —
fixed in `f54f816`. Decisions: D-293. Filed: `0251` (0080 now depends on it), `0252`.
To close: record the operator's two readings on criteria 6 and 7, write `## Resolution` from this
note and the commits, then `tickets.mjs close 79`.

## Operator validation

In the desktop browser, dev build, on `/run/:id` for a real recent run: drag the scrub control slowly
from 0 to 1 and watch the fog edge. It should read as **mist retreating**, not as hexagons switching
on — no visible honeycomb, no popping, no stair-stepping along the route. Drag it back to 0 and
forward again several times; the boundary must retrace the same path. Then leave it at 1, reload the
page, and compare the settled map to the screenshot you took at scrub=1: they must be
indistinguishable. ~~Do this outdoors in daylight, not just at a desk — the mist edge is a contrast
judgement and screen brightness changes the answer.~~ *(D-251, 0215)*
