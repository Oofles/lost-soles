---
id: 118
slug: spike-glmax-r8-fbo-on-target-device
title: Spike — prove gl.MAX on a half-res R8 FBO inside MapLibre's prerender works on the target Android phone
type: chore
priority: high
status: closed
size: s
capability: 08-map-and-fog-renderer
depends_on: [53]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-10T02:00:41Z
closed: 2026-09-10T02:15:15Z
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

- [x] A throwaway branch renders ~500 hard-coded discs into a half-res `R8` FBO via one
      `drawArraysInstanced`, inside MapLibre's `prerender`.
- [x] `gl.blendEquation(gl.MAX)` is used; two deliberately overlapping discs are asserted to
      produce `max(a, b)` and **not** a summed brighter spot.
- [x] The mask is blitted to screen as greyscale so the result is visible without pass 2 existing.
- [x] GL state (blend equation, blend func, bound FBO, viewport) is restored; MapLibre's own
      basemap renders unchanged with the layer installed.
      — machine half: `blendEquation` `FUNC_ADD`/`FUNC_ADD`, framebuffer `null`, viewport restored,
      read back with `getParameter` inside the real `prerender`.
      — verified 2026-09-09: the basemap is unchanged across a remove/reinstall A/B, on the desktop
      browser.
- [x] **(operator)** Run in the **desktop browser** — amended 2026-09-09, see `## Notes`. The phone
      is welcome confirmation and is not a precondition (D-230).
      — verified 2026-09-09: **GO.** Operator, verbatim — *"Observation and validation is great on
      both checks!"* The two overlapping discs read as one region of uniform brightness, and the
      basemap A/B is clean. The phone was not used and is not required; the residual ANGLE risk is
      accepted under D-230 and deferred to `0059`.
- [x] `EXT_color_buffer_half_float` / `R8` renderability is feature-detected and the result recorded,
      rather than assumed.
- [x] The outcome is written into `docs/capabilities/08-map-and-fog-renderer.md` as GO or NO-GO with
      the device, browser version, and what was observed — **one paragraph minimum, either way.**
      — *The `gl.MAX` spike — GO, with one risk knowingly deferred*: the verdict, the observation
      table, the probe's actual numbers, the three things the ticket had wrong, what the spike does
      NOT prove, and five findings written for `0055`.
- [x] On NO-GO: 0055, 0056, 0058 and 0059 are marked `blocked_by: [118]` and a `design` ticket is
      filed to choose the replacement approach. Do not proceed to 0055.
      — **not applicable: the verdict is GO.** Nothing was blocked and no `design` ticket was filed.
      Ticked as *evaluated and discharged*, not as *done* — the condition this criterion guards
      against did not occur. `0055` may proceed.

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

## Resolution

**GO.** `05-fog-of-war.md` §4's technique works, and the largest technical risk in `09-roadmap.md`
§8.2 is retired before `0055` starts — which was the entire reason this was split out of that ticket.

### What was built, and then deleted

`app/dev/fog-spike/page.tsx`, `components/map/fog-spike.tsx`, `lib/fog/spike-mask.ts`,
`lib/fog/spike-cells.ts`, their two test files, and `tools/spike-harness/` (two runners). All deleted
in commit `1f69513`, as the Notes instructed. In git at **`9dfcd89`** if a line is ever wanted.

The findings live in `docs/capabilities/08-map-and-fog-renderer.md` under *The `gl.MAX` spike — GO,
with one risk knowingly deferred*, because they are what the code was for.

### The measurement, and why the obvious version of it would have been worthless

The probe drew two discs of **unequal** coverage (0.55 and 0.35) into the real half-res `R8` mask
inside MapLibre's `prerender`, then read the mask back with `gl.readPixels`:

```
low(89)=88687  high(140)=160989  summed(230)=0  maxByte=140
```

**The verdict is decided on pixel counts, not pixel values, and that is the one design decision in
this ticket that mattered.** Three driver behaviours are possible and only two are separable by
value:

| behaviour | overlap | max byte | distinct values |
|---|---|---|---|
| `MAX` honoured | 0.55 | 140 | {89, 140} |
| additive blend | 0.90 | 229 | {89, 140, 229} |
| **blend equation ignored, last write wins** | **0.35** | **140** | **{89, 140}** |

A sum is loud. **An ignored blend equation is silent** — identical maximum, identical value set — and
it is the failure that would have quietly destroyed the union semantics D-020 rests on, with
twice-covered ground rendering as whatever was drawn last. Both discs share a radius, so under `MAX`
the high disc keeps all its pixels and the low one loses the overlap; under last-write-wins it is
reversed. `count(high) > count(low)` *is* "`MAX` was honoured", and it needs no knowledge of where on
screen the discs landed — which is what made it safe to run inside MapLibre's own projection.

### Three things the ticket specified wrongly

1. **"Flat white discs" would have made the spike incapable of failing.** `R8` is normalised
   unsigned, so under an additive blend `1.0 + 1.0` clamps to `1.0` — byte-identical to
   `max(1.0, 1.0)`. Two overlapping white discs look the same whether `MAX` works or not, and both
   the readback *and* the operator's eye would have reported a pass against a broken driver. The
   discs were mid-grey (0.45) and a test asserted the summed overlap stays representable, so a later
   session "correcting" them to match the ticket's wording fails loudly.
2. **Criterion 1's "throwaway branch" cannot coexist with D-150.** `main` is the only branch, and the
   spike had to reach a browser, which only an Amplify deploy from `main` does. It was a throwaway
   *route* under `/dev/*`, auth-gated by existing middleware, deleted at close.
3. **Criterion 6 named `EXT_color_buffer_half_float` as though `R8` needed it.** It does not — `R8` is
   core colour-renderable in WebGL2; the extension would matter only for an `R16F` mask. Both were
   detected and recorded, but `checkFramebufferStatus` is what the verdict gated on.

### What went wrong while doing it

- **Three dead ends getting a page to run headlessly**, each failing *silently* with nothing but the
  placeholder in the dumped DOM: ES modules over `file://` are blocked by CORS from a `null` origin;
  served over `127.0.0.1`, this snap-confined Chromium makes `--dump-dom` hang until killed; and a
  snap cannot read a `file://` path outside `$HOME`. The working arrangement is everything inlined as
  classic scripts in one page under `$HOME`. Recorded in agent memory, since the file documenting it
  was deleted with the rest.
- **A raw hex literal failed Amplify job 164.** `maplibre-harness.js` gave a throwaway background
  layer a literal `#f5edd9` and `check-design-tokens.mjs` rejected it, correctly. The near-miss is
  the instructive part and it is filed as `0190`: I *had* run that guard locally, but filtered its
  output down to the one known `public/maplibre` hit, so a real hit in a new file printed the same
  familiar line and went unseen. Every subsequent push was verified by moving the generated directory
  aside and running the whole CI set unfiltered.
- **Float32 precision broke three tests on first run**, one of them interestingly: comparing two
  mercator centres near 0.271 whose difference is ~5.8e-5 cancels away most of the significand, so the
  absolute error is ~3e-8 — sixty times the tolerance an absolute comparison allows. The assertion
  became a ratio. A second test had the wrong earth circumference hard-coded (the WGS84 *equatorial*
  figure, where this project is spherical on R = 6,371,008.8 m throughout, as `src/domain/geo.ts`,
  `h3-js` and MapLibre all are) — a 0.11% error that would have made the render radius disagree with
  the scored one, which is the creep §2.3 spends a page warning about.

### Decisions

- **D-230** — the desktop browser settles this; the residual "does ANGLE on a real Android GPU honour
  `MAX` into a single-channel normalised target" question is knowingly accepted and deferred to
  `0059`, which already carries a real mid-range phone. This was put to the operator rather than
  decided here, because `0118` (2026-08-30) requires the device while D-227 and D-229 (both
  2026-09-09) move validation off the phone, and a ticket about phone *rendering* sits in neither the
  rule nor its exception.

### Tickets filed, none of them fixed here

- **`0189`** — the D-121 polyline guard flags prose: any shipped file whose *text* contains a
  privacy-script filename fails, with no comment carve-out, where `check-design-tokens.mjs` has
  exactly the one it needs. Annotated at close, because deleting `spike-cells.ts` removed the only
  file reproducing it.
- **`0190`** — `npm run lint` **and** `check-design-tokens.mjs` both fail locally after a build, on
  the copied MapLibre worker. CI survives only because those commands happen to run before
  `npm run build`. Carries the job-164 near-miss as evidence.
- **`0191`** — `/` First Load JS is 188 kB against a baseline table asserting 121 kB. Measured both
  with and without the spike present — 188 kB either way, so it predates this session and almost
  certainly arrived with `0054`. Requires the +67 kB be attributed from the chunk listing rather than
  guessed.

### What this does NOT prove

§9.6's words are *"unvalidated: `MAX` blending against `R8` on older Android GPUs via ANGLE"*. The
evidence is desktop and SwiftShader. Qualcomm/Mali ANGLE remains unverified, by decision (D-230), and
`0059` owns it. What §9.6 cared about in ordering terms is preserved: the *technique* is verified
before `0055` builds on it.

## Operator validation

**Desktop browser, `/dev/fog-spike` on `soles.devaultsecurity.com`, 2026-09-09.**
Operator's report, verbatim: *"Observation and validation is great on both checks!"*

1. **The two isolated overlapping discs read as one region of uniform brightness** — no darker lens at
   the intersection. This is the whole spike: a brighter/darker overlap would mean `MAX` is not being
   honoured and the union semantics the fog depends on do not hold.
2. **The basemap is unchanged across the remove/reinstall A/B** — labels and roads identical with the
   layer out and back in, so no GL state leaks out of `prerender`.

**Agent-side, not routed to the operator** (D-181/D-229 — everything a machine can decide):

- `tools/spike-harness/run.mjs` — `lib/fog/spike-mask.ts` compiled alone against a bare WebGL2 canvas
  on Chromium 152 / SwiftShader (ANGLE over Vulkan 1.3). Probe read `max`; **and read `sum` under a
  forced `FUNC_ADD` and `overwrite` with blending disabled.** A probe that can only report success is
  a decoration, so the sabotage cases were asserted too.
- `tools/spike-harness/run-maplibre.mjs` — a real `maplibre-gl` 6.6.0 `Map` with a real custom layer,
  the mask shader compiled against **MapLibre's own** `vertexShaderPrelude` (`variant=mercator`, 664
  bytes, `#define PROJECTION_MERCATOR`) inside the real `prerender`. `R8` FBO `FRAMEBUFFER_COMPLETE`,
  471 instances in one `drawArraysInstanced`, probe `max`, state restored, `NO_ERROR` across 302
  blitted frames, and survived a remove-and-reinstall of the layer.
- 43 unit tests over the judgement itself (`judgeProbe`, `verdictFailures`, the cell geometry,
  the draw-order dependency), including one asserting the summed overlap stays representable.
- **Post-deploy smoke test** (Amplify jobs 163 and 165, both `SUCCEED`): `/` returns 200;
  `/dev/fog-spike` returns `307 → /?next=%2Fdev%2Ffog-spike` signed out, matching `/dev/tickets`, so
  the route was never public; and the signed-out payload of `/` carries neither the spike's coordinate
  nor the operator's home.
- **Deletion verified**: `npm run build` no longer lists `/dev/fog-spike` and still lists
  `/dev/tickets`; the full CI set (nine guard scripts, typecheck, lint, 1669 tests) is green with the
  generated `public/maplibre` moved aside so nothing was filtered.
