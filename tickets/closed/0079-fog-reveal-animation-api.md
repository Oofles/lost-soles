---
id: 79
slug: fog-reveal-animation-api
title: Drive the 08 coverage mask from an animation clock, not from the cell set
type: feature
priority: high
status: closed
size: m
capability: 12-post-run-moment
depends_on: [55, 56]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-08T19:20:14Z
closed: 2026-10-13T12:01:33Z
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
- [x] Frame time with a reveal set of 130 cells stays inside the `05-fog-of-war.md` §6.4 budget in
      the desktop browser, measured with the 0059 harness — not assumed.
      — verified 2026-10-13: operator, desktop browser, `/run/:id?fog=scrub`, ▶ 2.2 s through
      `0059`'s collector: "p50 16.70 ms · 0/132 dropped (0.0%) · ~59.88 Hz" — inside D-241's
      p50 ≤ 17 ms with ~0 dropped.
- [x] The dev-only scrub control exists and moves the fog edge smoothly end to end.
      — verified 2026-10-13: operator dragged 0→1 and back repeatedly on a real recent run; reads
      as mist, retraces the same path, and the reloaded settled map matches scrub = 1 ("checks are
      good").
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

**Result, 2026-10-13 — desktop browser, `soles.devaultsecurity.com/run/<id>?fog=scrub`, a real
recent run (no run made for this).** Operator: slow drag 0→1→0 several times reads as mist
retreating, no honeycomb, popping or stair-stepping; the boundary retraces; the reloaded settled map
matches scrub = 1. Frame time from ▶ 2.2 s: p50 16.70 ms, 0/132 dropped, ~60 Hz.
**Agent smoke, 2026-10-09** (`tmp/0079/smoke.mjs`, throwaway Cognito user + synthetic 2.5 km loop
at Point Nemo, deleted after): 10/10 — no control without the flag; `?fog=scrub` and
`?fog=scrub,mask` mount it; the slider drives progress; the layer logs `reveal=195 cells`; ▶
reports through the collector; no console errors. It found the empty-blob bug fixed in `f54f816`.

## Resolution

The 08 coverage mask is now a function of `revealProgress` as well as the cell set (06 §3.2 beat 1).

**What was built (`8ee39bc`).** `FogMaskLayer.setReveal(cells, progress)`: each instance carries a
fifth float, its normalized arc along the route, and the pass takes a `u_reveal` uniform — a scrub
is one uniform write, no re-upload. A reveal culls the explored set twice through the *unchanged*
steady-state derivation — once without the run's cells, once with — in one zoom bucket and one
padded box, and `lib/fog/reveal-tag.ts` diffs the two streams to tag which instances are new. So
p = 0 and p = 1 equal the two steady states by construction, not by a parallel code path: 0 of
256,000 pixels differ on SwiftShader at res 11 and at a coarse bucket (`tools/fog-harness` R1–R4).
D-248's origin is snapped to a 2^-10 grid so both streams share it exactly. The reveal set is
computed from the local trace (`lib/fog/reveal.ts`); `reveal.test.ts` runs a full sweep with
`fetch` throwing and `XMLHttpRequest` removed. Dev-only `?fog=scrub` mounts
`components/map/reveal-scrub.tsx`: a slider plus ▶ 2.2 s, an arc-length-parameterised traversal
that reports through `0059`'s collector so criterion 6 is measured, not assumed.

Files: `lib/fog/{mask,mask-layer,reveal,reveal-tag,route-corridor,cull,instances,zoom-buckets,
viewport-controller,debug-flags}.ts`, `src/domain/fog.ts`, `components/map/{map-shell.tsx,
reveal-scrub.tsx,use-fog-mask.ts}`, harness `tools/fog-harness/{harness,run,reveal-fixture,…}`,
`docs/05-fog-of-war.md`. Tests: `reveal.test.ts` (new, ~500 lines), extended `mask`, `cull`,
`viewport-controller` tests.

**Decision — D-293.** The ticket said the reveal set was "cells not yet persisted". `/run/:id` is
reached *after* ingest, so that reading is always empty. The reveal set is "this run's cells"
instead. Getting those ids to the client is not this ticket: filed `0251`, and `0080` now depends
on it. Also filed `0252` (D-238 lowers interior vertices).

**What went wrong.** The live smoke found that an account with no explored blob yet — exactly a
first run — installed no store or controller, so `?fog=scrub` drew the corridor whole and animated
nothing. Fixed in `f54f816` by standing an empty set in when a reveal is requested. Headless
SwiftShader could not answer criterion 6 (p50 16.70 ms, 45% dropped — the software rasteriser), so
the ticket waited a session for the operator's desktop reading. That reading's reveal set was
whatever the operator's run produced, not exactly 130 cells; the smoke run's was 195, so the
budget holds above the criterion's size too.

Minor, not filed: the scrub readout prints `~Hz` unrounded (`59.88023952095548`). Dev-only cosmetic.

