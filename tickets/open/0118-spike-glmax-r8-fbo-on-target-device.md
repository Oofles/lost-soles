---
id: 118
slug: spike-glmax-r8-fbo-on-target-device
title: Spike — prove gl.MAX on a half-res R8 FBO inside MapLibre's prerender works on the target Android phone
type: chore
priority: high
status: open
size: s
capability: 08-map-and-fog-renderer
depends_on: [53]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

**Split out of 0055 during backlog validation (2026-08-30).** 0055 already said "spike this first"
— but as its eleventh acceptance criterion, behind ten items of FBO plumbing, instance packing and
shader authoring. A go/no-go finding buried inside a ticket that also contains routine work is a
finding that surfaces late and ambiguously: when the ticket runs long you cannot tell whether the
technique failed or the plumbing did.

This ticket is **only** the go/no-go. It exists to fail loudly and cheaply, in the first session of
capability `08`, while there is still room to change the plan.

`09-roadmap.md` §8.2 names this the mitigation for the project's largest technical risk, and
`05-fog-of-war.md` §4 has **no plan B**. The entire fog design rests on one assumption: that
`gl.blendEquation(gl.MAX)` into a half-resolution single-channel `R8` framebuffer, bound inside
MapLibre's `prerender` hook, behaves correctly on the actual device this app is for.

Scope is deliberately tiny. Hard-code ~500 cell centres as a literal array. No decoder (0054), no
aggregation, no `a_fraction`, no zoom bucketing, no atmosphere. One instanced draw of flat white
discs into the mask, then blit the mask to screen as greyscale.

**If it fails, stop and reopen the design rather than working around it.** The escape hatch on
record is precomputed raster fog tiles (`05-fog-of-war.md` §4.6) — correct at 10M+ cells, premature
here, and it lags the fog behind the run by the bake time. Choosing it is a design decision with
consequences for capabilities `12` and `15`, not a local workaround.

## Acceptance criteria

- [ ] A throwaway branch renders ~500 hard-coded discs into a half-res `R8` FBO via one
      `drawArraysInstanced`, inside MapLibre's `prerender`.
- [ ] `gl.blendEquation(gl.MAX)` is used; two deliberately overlapping discs are asserted to
      produce `max(a, b)` and **not** a summed brighter spot.
- [ ] The mask is blitted to screen as greyscale so the result is visible without pass 2 existing.
- [ ] GL state (blend equation, blend func, bound FBO, viewport) is restored; MapLibre's own
      basemap renders unchanged with the layer installed.
- [ ] **Run on the real target device**, not only desktop Chrome and not only an emulator.
- [ ] `EXT_color_buffer_half_float` / `R8` renderability is feature-detected and the result recorded,
      rather than assumed.
- [ ] The outcome is written into `docs/capabilities/08-map-and-fog-renderer.md` as GO or NO-GO with
      the device, browser version, and what was observed — **one paragraph minimum, either way.**
- [ ] On NO-GO: 0055, 0056, 0058 and 0059 are marked `blocked_by: [118]` and a `design` ticket is
      filed to choose the replacement approach. Do not proceed to 0055.

## Notes

Time-box: **one session.** If it is neither clearly working nor clearly broken after that, that
ambiguity is itself the finding — record it as NO-GO and file the design ticket. An undecided
foundation is worse than a rejected one.

Discard the branch afterwards. Nothing here is meant to survive; 0055 rebuilds it properly.

## Operator validation

On the 6.8in Android phone, in the browser that will actually be used: two overlapping discs must
render as **one region of uniform brightness**, not a brighter lens where they intersect. That
single observation is the whole spike — if the overlap is brighter, `MAX` is not being honoured and
the union semantics the fog depends on do not hold.

Then pan the basemap for 20 seconds. Labels and roads must look exactly as they did before the
layer was added.
