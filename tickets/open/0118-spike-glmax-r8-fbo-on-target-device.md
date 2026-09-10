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
- [ ] **(operator)** Run in the **desktop browser** — amended 2026-09-09, see `## Notes`. The phone
      is welcome confirmation and is not a precondition (D-230).
- [ ] `EXT_color_buffer_half_float` / `R8` renderability is feature-detected and the result recorded,
      rather than assumed.
- [ ] The outcome is written into `docs/capabilities/08-map-and-fog-renderer.md` as GO or NO-GO with
      the device, browser version, and what was observed — **one paragraph minimum, either way.**
- [ ] On NO-GO: 0055, 0056, 0058 and 0059 are marked `blocked_by: [118]` and a `design` ticket is
      filed to choose the replacement approach. Do not proceed to 0055.

## Notes

### Criterion 5 was amended on 2026-09-09 — the phone is no longer a precondition (D-230)

The ticket was written on 2026-08-30 and required the real Android device. **D-227** and **D-229**
both landed on 2026-09-09, after it: the desktop browser is the primary viewing surface, and an
operator validation step may never require the phone unless the ticket is about phone capture.

This ticket is about phone *rendering*, which is neither clearly inside that exception nor clearly
outside it, so it was put to the operator rather than decided here. Their answer: *"if it can be
validated on the web browser I don't need extra validation on the phone — I'm ok to keep that
low-risk. If it's only a phone thing, then that's fine."*

It can be validated in a browser, so: **the desktop browser decides, and the residual
`MAX`-on-Android-ANGLE risk is knowingly accepted.** D-230 records the acceptance and where the risk
now sits. `0059` still carries a real mid-range Android phone (D-227 kept that standing explicitly),
so the device is not unexamined — it is examined later, by the ticket that already owns the device.

What was built to make the cost of the phone check almost nothing anyway, should the operator ever
want it: the page **self-asserts numerically** and prints one `GO`/`NO-GO` line plus the unmasked GPU
string, so opening one URL and reading one line is the entire task. No scenario to construct.

### Two more amendments, both recorded rather than quietly taken

- **Criterion 1 says "a throwaway branch"; D-150 says `main` is the only branch.** It is a throwaway
  *route*, `/dev/fog-spike`, removed at close. `app/dev/fog-spike/page.tsx` carries the reasoning.
- **Criterion 6 names `EXT_color_buffer_half_float` as though `R8` needed it.** It does not — `R8` is
  core colour-renderable in WebGL2, and the extension would only matter for an `R16F` mask. Both are
  detected and reported; `checkFramebufferStatus` on a real `R8` attachment is what actually decides,
  and that is what the verdict gates on.

### The original time-box

Time-box: **one session.** If it is neither clearly working nor clearly broken after that, that
ambiguity is itself the finding — record it as NO-GO and file the design ticket. An undecided
foundation is worse than a rejected one.

Discard the branch afterwards. Nothing here is meant to survive; 0055 rebuilds it properly.

## Operator validation

**On the desktop browser** (D-227, D-230 — the phone requirement was amended away, see `## Notes`),
at **`/dev/fog-spike`**. Two things, and nothing else:

1. **The two isolated overlapping discs, to the right of the main blob, must read as one region of
   uniform brightness** — not a darker lens where they intersect. That single observation is the whole
   spike: if the intersection is darker, `MAX` is not being honoured and the union semantics the fog
   depends on do not hold. (The veil is dark-on-pale rather than white, because the stock Protomaps
   `light` flavour is pale and a white veil on it would be the one ambiguity this must not have.)
2. **Click "remove the fog layer", then pan for twenty seconds, then "install the fog layer" and pan
   again.** Labels and roads must look the same both times. That is criterion 4 — no leaked GL state —
   as an A/B rather than as a memory test.

Everything else on that page is already decided before you look at it: the panel's top line reads
`GO` or `NO-GO`, the `MAX` probe's verdict comes from `gl.readPixels` on the real mask, and the tab
title carries the same verdict. Expected discs are hard-edged and uniformly grey — the soft falloff is
deliberately absent and belongs to `0055`.
