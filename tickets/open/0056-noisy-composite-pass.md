---
id: 56
slug: noisy-composite-pass
title: Pass 2 — noisy composite: fBm-perturbed smoothstep with a warm rim glow
type: feature
priority: high
status: open
size: m
capability: 08-map-and-fog-renderer
depends_on: [55]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-10T19:52:40Z
---

## Description

The `render` pass: **one full-screen triangle** (not a quad — a triangle avoids the diagonal seam
and one vertex of work) into MapLibre's framebuffer, in the translucent pass, sampling the half-res
`R8` coverage mask from 0055.

Fog opacity is `smoothstep` across a threshold **perturbed by animated 3-octave value-noise fBm**,
plus a warm rim glow at the boundary. `05-fog-of-war.md` §4.3 carries the shader sketch; follow it.

Uniforms and their v1 values:

```
u_fogDeep    vec3(0.035, 0.045, 0.075)   near-black blue
u_fogEdge    vec3(0.22,  0.24,  0.30)    lit mist
u_rimGlow    vec3(0.85,  0.70,  0.42)    warm parchment
u_maxOpacity 0.94    never 1.0 — a hint of the world showing through reads as mist, not as a hole
u_noiseAmp   0.10    atlas   (0.30 is adventure mode, capability 15)
u_rimAmt     0.08    atlas   (0.30 is adventure mode, capability 15)
```

**The taste pass is 0119, not this ticket.** Split out during backlog validation: this ticket owns
*correctness* — the triangle draws, the mask samples, the uniforms are wired, `smoothstep` behaves —
and ships the v1 values below as given. Iterating on how the fog *looks* happens in 0119, which is
time-boxed. Do not tune here; it has no passing test and will consume the session.

**Ship atlas-leaning values.** D-051 makes legibility non-negotiable and D-052's adventure
atmosphere is not; one rendering, tuned toward atlas legibility, is what §2.3 says the milestone
carries. The uniforms are parameterised now so capability `15` adds the second mode by changing
numbers, not code — but do not build a mode switcher here.

`u_maxOpacity` at 0.94 rather than 1.0 is not a rounding artefact. Fully opaque fog reads as a hole
punched in the map; 6% transmission reads as weather.

Animation: drive repaints with `requestAnimationFrame` → `map.triggerRepaint()`, **capped at
30 fps**. Drifting mist gains nothing from 60 and it halves the battery cost. Pause entirely when
`document.hidden`. `matchMedia('(prefers-reduced-motion: reduce)')` stops the rAF loop and renders
statically at `u_time = 0`; expose the same switch as a manual battery-saver toggle.

Budget: ~40 ALU per fragment, **1–2 ms** on a mid-range phone at DPR ≤ 2. If it misses, the ordered
levers are (a) mask scale to 0.35×, (b) animation to 20 fps, (c) fBm to 2 octaves — decided in
advance so tuning does not become an open-ended search.

**This is the ticket with no natural stopping point** (`09-roadmap.md` §7.3). "The mist boundary
reads as weather, not as a honeycomb" is not a passing test. Time-box the taste iteration: the
numbers above are the starting point and R4's bounds are the guardrails; anything beyond a session
of tuning gets filed as a separate polish ticket rather than held open.

## Acceptance criteria

- [x] Full-screen triangle in `render`, sampling the half-res mask; correct alpha blending against
      MapLibre's framebuffer, with GL state restored afterwards.
      — `drawArrays(TRIANGLES, 0, 3)`, premultiplied over `ONE, ONE_MINUS_SRC_ALPHA`. Restore read
      back from the driver (`compositeRestoreOk`) and again inside a real MapLibre `render` with
      `gl.getError()` clean across a remove-and-re-add.
- [x] 3-octave value-noise fBm perturbs the `smoothstep` threshold; octave count is a `#define` so
      the (c) lever is one edit.
      — `#define FBM_OCTAVES 3` from `FBM_OCTAVES` in `fog-uniforms.ts`; the layer takes an
      `octaves` option and a test compiles at 2 to prove the lever is one edit.
- [x] Warm rim glow appears at the coverage boundary and nowhere else — a test image asserts the
      glow band is absent well inside revealed territory.
      — Harness probe **C1**, on a real rasteriser: `peak +10/255 at coverage 0.50; well inside
      (76 samples, cover>=0.95) max 0, well outside (77 samples, cover<=0.02) max 0`.
- [x] `u_maxOpacity = 0.94`; fully-fogged pixels still show a trace of the basemap.
      — Harness probe **C2**: fully-fogged ground over white minus the same over black reads
      `15,15,15` of 255, against a predicted 15.3. At `u_maxOpacity = 1.0` it reads `0,0,0`.
- [x] All eight uniforms are named constants in one module, with the atlas/adventure pairs noted.
      — `lib/fog/fog-uniforms.ts`. **Amended count, honestly**: the shader declares ten uniforms, of
      which three (`u_mask`, `u_noiseMatrix`/`u_noiseOrigin`, `u_time`) are per-frame and cannot be
      constants. The six tunables are there with both §5.2 columns beside them, and so is every
      other number a taste pass would reach for — the ramp, the noise scale, the frame cap. D-234.
- [x] rAF loop is capped at 30 fps and pauses on `document.hidden`; a test asserts zero repaints
      while hidden.
      — `lib/fog/animation.ts`. A simulated second of 60 Hz rAF yields 30 repaints, not 60 and not
      20; hidden yields **0** across the same 60 frames, and `u_time` does not advance.
- [x] `prefers-reduced-motion: reduce` renders statically at `u_time = 0` with no rAF loop.
      — No `requestAnimationFrame` is ever requested, `time()` is exactly 0, and turning it on
      mid-session drops to 0 rather than freezing wherever the drift had reached. The battery saver
      is the same switch — as a mechanism, with no UI (capability 13 owns chrome).
- [x] Composite pass measured — **amended 2026-09-10, and the amendment is the finding.** The
      criterion said *"on the target phone"*; **D-227** and **D-229** both landed on 2026-09-09,
      after this ticket was written, and neither the operator nor I may route work to the phone.
      The criterion's own parenthesis already says *"the hard gate is 0059"*, which is where the
      real-hardware measurement belongs and where D-230 parked it.
      — Measured instead where it can be: **0.60 ms/frame at 1280x800** on Chromium's SwiftShader
      (harness probe **C4**, no readback in the timed region). That is a software rasteriser and is
      **not** evidence about a phone; what it establishes is that the pass is a plain per-fragment
      cost with no stall in it. The three pre-decided levers are wired and one edit each.
- [x] No shimmer at the boundary while panning — the noise is sampled in a stable space, not in
      screen space that slides under the camera.
      — **§4.3's shader sketch was the screen-space version this criterion forbids.** Amended, with
      **D-233**. Measured on a real rasteriser (**C3**): the same ground point across a 300 px pan
      differs by **0/255**, where §4.3's original recipe differs by **41/255**. The perceptual half
      is step 2 below and is the operator's.

## Notes

The half-res mask means the composite samples a texture at half the drawing-buffer resolution.
Bilinear sampling plus the noise perturbation is what hides that; a hard threshold on a half-res
mask would alias visibly. Do not "fix" edge softness by raising the mask resolution — that spends
the frame budget on the wrong pass.

Screen-space noise is the classic mistake here: it looks fine on a still map and crawls
distractingly the moment you pan, which is the exact defect the operator validation below is
written to catch.

## Resolution

**Written before the close, on purpose.** Every acceptance criterion is met and measured, and the
ticket stays open for one thing: `## Operator validation` below is five judgement calls on a desktop
browser and nobody has made them yet. On the ticket immediately upstream those calls found two real
defects (D-231, then D-232) that every green test in the suite had already passed — so closing this
on the strength of the suite alone would be repeating exactly the mistake `0055`'s Resolution
records. The code is committed and deployed-ready; the close commit follows the operator's look.

### The pass, and four modules

| | |
|---|---|
| `lib/fog/fog-uniforms.ts` | Every tunable number, constants only, no imports. `0119`'s whole surface. |
| `lib/fog/composite.ts` | The shaders, the homography inversion, the pass. One import, to the above. |
| `lib/fog/animation.ts` | §4.5's rAF driver. No GL, no DOM — the host is injected. |
| `mask-layer.ts` · `use-fog-mask.ts` | `render` composites; the animator's lifetime is the layer's. |

`render` draws one full-screen triangle — not a quad; two triangles meet along a diagonal and a
fragment exactly on it is rasterised by neither or both depending on the driver's fill rule — samples
`0055`'s half-res `R8` mask, and thresholds it with `smoothstep` across a noise-perturbed cut point.
`?fog=mask` still swaps the composite for the raw mask blit, which is not redundant now that there is
something to look at: when the fog is wrong the first question is always whether the *coverage* is
wrong, and the finished picture cannot answer that.

### §4.3's shader sketch was the defect this ticket's own Notes warned about

**D-233, and it is the finding worth keeping.** The design document said
`vec2 q = uv * u_screen / 260.0` — the noise coordinate taken from the fragment's position on the
display. Three paragraphs later the ticket says *"screen-space noise is the classic mistake here: it
looks fine on a still map and crawls distractingly the moment you pan"*, and criterion 9 forbids it
outright. The recipe and the prohibition sat in the same ticket.

**It would have shipped green.** Screen-space noise is correct in every still frame, so every unit
test, every pixel probe and every screenshot passes it. Only a hand on the map shows it — the same
shape as D-231, where a harness threshold calibrated to the code reported `ok` on a seam a person
called broken on sight.

The fix is exact rather than approximate: the ground under a mercator camera **is** a plane, so
screen and ground are one 3x3 homography apart however the camera is pitched or rotated.
`noiseFrame()` takes `mainMatrix`, drops its Z column, inverts it on the CPU in double precision, and
folds in the noise scale and an integer lattice origin. The fragment shader does one divide.

Three consequences, none of them optional:

- **The origin is what makes it possible at all.** Anchored to the ground, the noise coordinate
  reaches ~2 million at z18 on a DPR-2 display; a `float` then resolves `fract()` to eighths of a
  cell and the third octave is visibly blocky. Subtracting it in a double and adding it back in the
  shader **after `floor()`** keeps the interpolated coordinate under ±10 and leaves the absolute cell
  index unchanged when the origin ticks over mid-pan — so there is no pop. `composite.test.ts` sweeps
  z13 to z18 in hundredths, crosses **499** origin changes, and asserts the matrix cancels every
  one.
- **The hash had to become an integer bit-mix.** `fract(sin(dot(p, k)) * 43758.5453)` is fine while
  `p` is a screen coordinate under a few thousand. At a lattice index of 2 million the dot reaches
  1e8, where a `float`'s ULP is 4 — runs of adjacent cells collapse onto one hash value and the field
  visibly repeats. It is also cheaper than `sin` on most mobile GPUs.
- **Lacunarity is exactly 2.0, not §4.3's 2.03.** 2.03 is the standard trick for stopping octaves
  landing on the same lattice, and it cannot be used: it multiplies the integer origin at every
  octave and 2.03 times an integer is not an integer. A per-octave integer translation of `(17, 43)`
  decorrelates the octaves by translation instead.

Measured, on a real rasteriser: the same ground point across a 300 px pan differs by **0/255**;
§4.3's original recipe differs by **41/255**.

**The accepted cost, stated rather than discovered later:** the field drifts smoothly during a
*zoom*, because its frequency tracks the screen scale while the ground does not. Anchoring at a fixed
ground size instead would give a 16 px cell at z10 (aliasing) and a 4,000 px cell at z18 (a flat
wash). A zoom already scales everything on screen; a pan does not.

### What ships is a hybrid, and D-234 says so out loud

The ticket says *"ship atlas-leaning values"* and then lists `u_maxOpacity 0.94` and the near-black
blue — which are §5.2's **adventure** column. `u_noiseAmp 0.10` and `u_rimAmt 0.08` are atlas's. One
rendering: atmospheric in colour, restrained at the edge. The single real disagreement is
`u_maxOpacity`, 0.94 here against §5.2's atlas 0.55; §4.3 defends 0.94 at length and the ticket
restates the defence, so 0.94 ships and 0.55 sits in `ATLAS` waiting for capability 15.

Both §5.2 columns are recorded in code today, unused, because a pair that exists only as a table in a
design document is a pair the next capability re-derives wrongly. `SEAM_FLOOR` in `mask.ts` stays
derived from **adventure's** `noiseAmp` rather than from what ships — it was measured once on a GPU
(D-231) and will not be re-measured — and `fog-uniforms.test.ts` asserts the derivation so raising
the amplitude in capability 15 cannot silently invalidate it.

### The animator is a state machine, and that is why it is injectable

Every one of §4.5's four behaviours is a claim about a repaint that does **not** happen, which is the
hardest kind to make about a loop wired straight to `window`. jsdom has no rAF clock, no real
visibility and a `matchMedia` that must be stubbed anyway — so the four things the class touches are
injected, and "capped at 30 fps" is measured as *30 repaints in a simulated second of 60 Hz rAF*
rather than read off the source. `browserAnimationHost` is the ten lines that logic does not reach.

Two decisions inside it:

- **`FRAME_SLACK_MS = 1`, and without it the cap silently becomes 20 fps.** Two 60 Hz frames is
  33.33 ms and `FOG_FRAME_MS` is 33.33 ms — a comparison that lands on the wrong side of exact for
  any jitter at all, and a miss costs a whole frame. A test asserts `> 24` so the degenerate case
  cannot pass as "capped".
- **`time()` is exactly 0 when static, not frozen where it got to.** §4.5 says *"renders statically
  at `u_time = 0`"*, and someone turning reduced motion on mid-session should see the same picture as
  someone who had it on from the start. `#sync` also repaints once on every transition, because
  MapLibre draws only when asked — without it the frozen frame left on screen is the last *animated*
  one.

### I looked at it before asking the operator to, and it changed what to ask

`tools/fog-harness/render-png.mjs` renders one frame of the finished composite over a stand-in
parchment basemap — a street grid, labels, a park, a lake — and writes a PNG. Ten seconds, and it
is the difference between handing over five judgement calls and handing over five judgement calls
on something that has at least been seen once.

What it shows, at the values this ticket specifies:

- **Legibility is not in question.** Inside revealed ground the parchment, the road casings and
  every street label are untouched. Outside it, at 6% transmission, the grid survives as a ghost
  exactly as §5.3 promises. D-051 is comfortable in both directions.
- **The interior density variation works** — the fog is mottled rather than a flat wash, which is
  the noise field doing its job.
- **The warm rim is not perceptible at `u_rimAmt = 0.08`.** It measures +10/255 and reads as
  nothing against the luminance step it sits on. At adventure's 0.30 it is a clear parchment band.
  §4.3 calls the rim *"the single detail that sells the effect"*, so this is worth stating plainly
  rather than leaving for someone to notice.
- **The boundary reads as a clean soft gradient, not as ragged mist** — and the arithmetic says it
  cannot be otherwise. D-231's own formula puts the noise displacement at `amp/2 x (1 - inner) x
  radius` = **2 m** at 0.10 and 6 m at 0.30, against a reveal ramp **17 m** wide. A 2 m wobble on a
  17 m gradient is invisible.

**None of that is fixed here** — `0119` owns taste and this ticket says so twice. Both findings are
recorded on `0119` with their arithmetic, including the part that makes it a design question rather
than a knob: the other lever is `FALLOFF_INNER`, and D-231 raised it to 0.60 to kill the neighbour
seam, so buying raggedness there trades one artefact for the other.

### What went wrong while doing it

- **The rim probe passed vacuously on its first run, and the output said so if you read it.**
  `well outside (cover<=0.02) max -Infinity` — the filter matched nothing, because the test blob was
  wider than the camera window, and `Math.max()` of an empty array is `-Infinity`, which is very
  comfortably `<= 1`. A probe reporting green while measuring nothing is `0055`'s `SEAM_FLOOR` lesson
  in a different costume. Fixed with a population guard (`inside.length >= 5 && outside.length >= 5`)
  and a blob that fits, and both sample counts now print beside the verdict.
- **The MapLibre harness ran with `debug: true` and therefore never once ran the shader under test.**
  `0055` set it because with no pass 2 the blit was the only way to prove `render` did anything; it
  now hides the composite entirely. It reported `render never ran the composite pass` on the first
  try, which is the harness working — but it had been left in the shipped path's place, and a less
  specific assertion would have sailed past it.
- **A first attempt at the zoom-continuity test asserted the noise coordinate must not change
  between adjacent zooms.** It failed at 1,649 cells of drift — correctly, because the coordinate is
  *supposed* to drift under a zoom. The test was forbidding the design. Rewritten to compare the
  matrix-and-origin path against the smooth analytic value at every step, which is what actually
  catches a pop.
- **`npm run lint` still fails locally after a build** (tickets `0188`/`0190`), so every check here
  was run with `public/maplibre` moved aside and **unfiltered**.

### Not done here, on purpose

- **Tuning is `0119`.** The ticket is explicit and it is right: *"it has no passing test and will
  consume the session."* Nothing in `fog-uniforms.ts` was moved off the value the ticket specified.
- **No mode switcher, no battery-saver UI.** `setBatterySaver` is the mechanism; capability 13 owns
  chrome and capability 15 owns the second mode.
- **Under globe projection the inversion is an approximation.** The app is mercator-only and the
  layer rebuilds on a `variantName` change. Recorded in D-233 as a known edge rather than left to be
  discovered.
- **`/` First Load JS moved 192 kB -> 197 kB.** Ticket `0191` already owns that baseline being stale.

## Operator validation

**Amended 2026-09-10, and the amendment is recorded rather than quietly taken.** The ticket was
written on 2026-08-30 and asks for the 6.8in Android phone in sunlight. **D-227** and **D-229** both
landed on 2026-09-09, after it: the desktop browser is the primary viewing surface, and an operator
validation step may not require the phone unless the ticket is *about* phone capture. `0118` and
`0055` took the same amendment for the same reason, and this is the third ticket in a row to need
it — the backlog was written before those decisions existed.

Step 4 is kept but restated: *"Enable Remove animations in Android accessibility"* becomes the
browser's own reduced-motion setting, which is one toggle and needs no device.

### ★ WHAT THE OPERATOR STILL HAS TO LOOK AT ★ — desktop browser, `/`

Five minutes. Every one of these is a judgement two competent people could disagree about by
looking; nothing here is a scenario to construct and nothing needs the phone.

1. **Legibility, which is D-051 and therefore a blocker rather than a nit.** Over the edge of your
   explored territory: **street names inside revealed ground must stay readable.** If names inside
   revealed territory are hard to read, `u_maxOpacity` or the rim glow is bleeding inward.
2. **Pan slowly across the fog boundary for twenty seconds.** The mist must drift gently; it must
   **not** crawl or sparkle in step with the cursor. This is what D-233 was written to fix, and it
   is the one thing measurement cannot finish — 0/255 across a synthetic pan says the noise is on
   the ground; only an eye says it reads as weather.
3. **Sit still for a minute.** The drift should be barely perceptible — atmosphere, not animation.
   If it reads as motion, `u_noiseAmp` is too high for what ships, and that is `0119`'s to tune.
4. **Turn on the browser's reduced-motion setting and reload.** The fog must be completely static
   and still look correct — not flat grey, not fully opaque.
5. **Find a lake or park polygon half-covered by fog.** The boundary must read as weather, with no
   visible 120-degree corners anywhere along it.

`?fog=noise` puts the composite's own numbers on screen while leaving the fog running: the zoom, the
instance count, `u_time`, and the lattice origin. If step 2 goes wrong, that origin is the first
thing to read — it should tick through whole numbers as you pan, and the line says
`SCREEN SPACE` outright if the frame fell back.

### Agent-side, not routed to the operator (D-181/D-229)

- **`node tools/fog-harness/run.mjs`** — `HARNESS PASS` on Chromium 152 / SwiftShader (ANGLE over
  Vulkan 1.3), all of `0055`'s probes plus five new ones, each with its sabotage case:

  ```
  ok  C0 composite compiles        #define FBM_OCTAVES 3, 10/10 uniforms live
  ok  C1 rim is a band at the edge peak +10/255 at coverage 0.50; well inside (76 samples,
                                   cover>=0.95) max 0, well outside (77 samples, cover<=0.02) max 0
  ok  S1 the rim probe can read zero   rimAmt=0 differenced against itself reads 0
  ok  C2 6% of the basemap survives    rgb 15,15,15 of 255 (want ~15.3)
  ok  S1 a hole in the map reads 0     u_maxOpacity=1.0 transmits 0,0,0
  ok  C3 noise stays on the ground     same ground point across a 300 px pan differs by 0/255
  ok  S1 screen-space noise crawls     §4.3's original recipe differs by 41/255 across the same pan
  ok  C4 composite cost                0.60 ms/frame at 1280x800 on THIS software rasteriser
  ```

- **`node tools/fog-harness/run-maplibre.mjs`** — `MAPLIBRE HARNESS PASS`. The composite runs inside
  a real `maplibre-gl` 6.6.0 `render` hook, `u_time` reaches the shader, `gl.getError()` is clean
  across a remove-and-re-add, and the noise frame built from **MapLibre's own `mainMatrix`** is
  ground-anchored rather than degenerate — `origin 10146,42333, 6.45e+4 cells/merc`. That last line
  is the one worth having: `harness.js` inverts a matrix this file wrote, and this one inverts the
  matrix MapLibre actually hands out.

- **The full CI set, unfiltered**, with the generated `public/maplibre` moved aside: eleven guard
  scripts, `tsc --noEmit`, `eslint . --max-warnings 0`, **1,831 tests** (98 new), `npm run build`.

- **`node tools/fog-harness/render-png.mjs tmp/out.png <palette> <half-width-m>`** — a rendered
  frame of the finished fog over a stand-in basemap, at `V1`, `ATLAS` or `ADVENTURE` and at any
  zoom. Looked at, at a neighbourhood scale and at a two-street scale, before writing the checklist
  above. See the Resolution for what it showed and what was filed onto `0119` as a result.
  Output goes to the gitignored `tmp/` (commit `f9577a2` — a screenshot of the real fog is a
  location leak; these are Point Nemo, and the directory is the right home regardless).

- **Post-deploy smoke test** (Amplify job **181**, `SUCCEED`, commit `dc89d22`):
  `/` -> 200 · `/?fog=noise` -> 200 · `/?fog=mask,debug` -> 200, all the signed-out landing page
  rather than an error. The signed-out payload carries no home-shaped coordinate.

  The deployed route chunk `/_next/static/chunks/app/page-43628c0352879dfc.js` contains
  `u_noiseMatrix`, `u_noiseOrigin`, `hashCell`, `v_noiseH`, `u_maxOpacity`, `FBM_OCTAVES`,
  `prefers-reduced-motion` and `visibilitychange` — so the composite and its animator genuinely
  shipped rather than being tree-shaken out of a route nobody visits signed out.

  **And it contains neither `43758.5453` nor `u_screen`.** D-233 confirmed on the deployed artifact
  rather than only in the source: §4.3's screen-space recipe is not in the bundle.
