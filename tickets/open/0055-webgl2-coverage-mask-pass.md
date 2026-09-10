---
id: 55
slug: webgl2-coverage-mask-pass
title: Custom WebGL2 layer, pass 1 — instanced soft-disc coverage mask in prerender
type: feature
priority: high
status: open
size: m
capability: 08-map-and-fog-renderer
depends_on: [53, 118]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-10T03:38:14Z
---

## Description

**The go/no-go spike is now 0118 and must be GO before this ticket starts.** It was split out during
backlog validation: as the eleventh criterion of this ticket it was a decisive finding buried behind
ten items of routine plumbing, which is how such findings surface late and ambiguously. This ticket
is the real implementation, built on a technique already proven on the target device.

MapLibre calls `prerender` during its offscreen pass. We bind our own **half-resolution, single-
channel `R8` framebuffer**, clear it to 0, and draw every visible explored cell as **one instanced
draw call** (`drawArraysInstanced`). One draw call per cell is draw-call bound around ~2k cells and
is explicitly ruled out.

**Discs, not hexagons. This is the most important visual decision in the product.** If you
rasterise hexagon geometry into the mask you get hexagons: six flat edges meeting at 120° corners,
and those facets survive every amount of blur you can afford — blur softens the transition but
preserves the silhouette's angular frequency content, so the boundary still reads as a honeycomb.
It looks like a strategy-game grid, and it looks *worse* the further you zoom in, which is exactly
where the user spends their time. Splatting a Gaussian-falloff disc at each cell centre instead
gives three things at once: adjacent discs merge (at 1.35 × 75.9 ≈ 102 m radius against 131.4 m
centre spacing, every neighbour overlaps past its half-power point, so a contiguous run becomes one
region with no seams); the soft edge is structural rather than a bolted-on blur pass; and the
boundary is isotropic, so 0056's noise produces an organic wisp instead of a wobbly hex outline.

`revealScale` = **1.35 × circumradius**. Below ~1.15 you see scalloping between neighbours; above
~1.6 the territory looks inflated and imprecise. These numbers are R4's and they are a schedule
asset — do not re-derive them by eye.

**`gl.blendEquation(gl.MAX)`, not additive.** MAX makes it a union: two overlapping discs give
`max(a, b)`, so twice-covered ground is not twice as revealed. Additive blending would make dense
territory saturate and the mask would stop meaning "covered".

Projection comes from MapLibre's `shaderData.vertexShaderPrelude` (`projectTile(vec2)`, web-mercator
0..1 straight to clip space) plus `shaderData.define` — which gives globe projection and terrain
support for free. Never call `map.project()` or `cellToBoundary` per frame; the vertex shader does
all projection, and each cell's mercator centre, radius and bbox are precomputed once per bucket.

Coarse buckets multiply the fragment's coverage by a per-instance `a_fraction` (from
`explored-agg.json`), so a parent cell you have run 20% of is a dim glow, not a solid block.
Without this, zooming out turns a sparse city into a solid slab.

Instrument `visibleInstanceCount` per mask rebuild from day one (`05-fog-of-war.md` §6.4 item 1) —
it is the canary for the entire performance claim.

## Acceptance criteria

- [x] A MapLibre `CustomLayerInterface` with `onAdd` / `prerender` / `render` / `onRemove`; `render`
      may be a passthrough until 0056.
      — `lib/fog/mask-layer.ts`. `render` does nothing at all unless `?fog=mask` is set.
- [x] Half-resolution `R8` FBO, created and resized with the drawing buffer, cleared to 0 each
      prerender.
      — `LINEAR`/`CLAMP_TO_EDGE` per §4.2. 640x400 of a 1280x800 buffer, asserted on a real GPU.
- [x] One `drawArraysInstanced` call per mask rebuild, regardless of cell count.
      — asserted at 0, 1, 2,000 and 150,000 instances; 5,000 drawn in one call in the harness.
- [x] `gl.blendEquation(gl.MAX)` is set for the mask pass and restored afterwards; a test asserts
      GL state (blend equation, blend func, bound FBO, viewport) is restored so MapLibre's own
      drawing is unaffected.
      — `mask.test.ts` on the call sequence, and read back from a real driver in both harnesses,
      including across a remove-and-re-add of the layer.
- [x] The instance attribute layout is `{centerMercX, centerMercY, radiusMerc, fraction}`, packed
      once per bucket, never per frame.
      — `lib/fog/instances.ts`; the byte offsets and the `vertexAttribDivisor` calls are asserted,
      and five frames after one `setBucket` produce five draws and zero uploads.
- [x] Disc falloff is a smooth Gaussian-like radial ramp at `revealScale = 1.35`; the constant is
      named and commented with the 1.15/1.6 bounds.
      — `REVEAL_SCALE`, with `REVEAL_SCALE_MIN`/`MAX` exported so the bounds are testable rather
      than a comment. The harness measures the seam at 190/255 and at 115/255 under 1.15.
- [x] Projection uses `shaderData.vertexShaderPrelude`; no `map.project()` in any per-frame path
      (grep test).
      — `lib/fog/no-per-frame-projection.test.ts`, non-vacuous. The real 664-byte mercator prelude
      compiles against the mask shader in `run-maplibre.mjs`.
- [x] `a_fraction` multiplies coverage; a coarse-bucket fixture renders as partial, not solid.
      — measured, not asserted in a mock: a 0.25 disc reads back **64** against a solid **255** on
      a real GPU. The packing half is a res-6 fixture in `instances.test.ts`.
- [x] `visibleInstanceCount` is exposed and logged per rebuild.
      — `FogMaskLayer.stats()` for per-frame sampling, plus one log line per instance-buffer
      rebuild. See `## Resolution` for why "per rebuild" is not "per frame".
- [x] A debug flag renders the raw mask to screen as greyscale, for eyeballing coverage.
      — `?fog=mask`. Verified present in the deployed page chunk.
- [x] 0118 has been completed with a recorded **GO** before this ticket starts. (The spike was
      split out during backlog validation — see 0118. Do not re-do it here.)
      — closed 2026-09-10, verdict **GO**, in `docs/capabilities/08-map-and-fog-renderer.md`. Its
      five findings for this ticket were followed; none were rediscovered.

## Notes

Deliberately **not** retried, recorded so a future session does not rediscover them expensively
(`05-fog-of-war.md` §4.6):

- **MapLibre `fill` layer with explored areas as interior rings** — fatally broken, silently.
  `EARCUT_MAX_RINGS = 500` in `src/data/bucket/fill_bucket.ts`; `classify_rings.ts` quickselects the
  500 largest holes by area per tile and **discards the rest with no warning**, so small explored
  patches vanish and reappear as you pan. Not workaroundable from userland. It also needs tens of
  thousands of hexes dissolved first (`turf.union` locks the main thread for seconds to minutes at
  5–10k polygons), and even then the edges are hard triangulated facets with no feather.
- **Canvas2D `destination-out`** (the Dawarich approach) — a fine 2-hour prototype and nothing more.
  It **cannot feather**: the obvious fix, `ctx.filter = 'blur(24px)'`, is **silently ignored on iOS
  Safari** — no error, just hard edges. The documented `shadowBlur` workaround is per-draw-call. It
  also re-projects every vertex with `map.project()` in JS every frame and lives in a DOM layer
  above everything, so labels cannot go under it.
- **deck.gl `MaskExtension` with `maskInverted`** — right architecture, wrong ergonomics. The mask
  is tested as a **boolean** in the masked layer's fragment shader: hard binary edge, no feather
  parameter, no alpha ramp, no noise hook, plus resampling shimmer while panning.
- **Precomputed raster fog tiles** — not wrong, premature. Correct at 10M+ cells; here it lags the
  fog behind the run by the bake time and a `raster` layer can only be tinted, not shaded.
  Documented escape hatch, not the plan.

## Resolution

Pass 1 is built and deployed. `05-fog-of-war.md` §4.2's mask exists: a half-resolution `R8`
framebuffer bound inside MapLibre's `prerender`, cleared each frame, with every explored cell splatted
as a soft radial disc in **one** `drawArraysInstanced` unioned by `gl.blendEquation(gl.MAX)`.

### Four modules, and the split is load-bearing rather than tidy

| | |
|---|---|
| `lib/fog/mask.ts` | GL only, **zero imports**. Shaders, the FBO, the pass, the state restore. |
| `lib/fog/instances.ts` | h3-js + mercator. Criterion 5's layout, packed once per bucket. |
| `lib/fog/mask-layer.ts` | The `CustomLayerInterface`. |
| `components/map/use-fog-mask.ts` | `0054`'s `ExploredSet` → one res-10 bucket → the layer. |
| `components/map/map-shell.tsx` | Holds the loaded map in state so the hook can install into it. |

**`mask.ts` has no imports on purpose**, carried over from `0118`: `tools/fog-harness/run.mjs`
compiles that one file alone with `tsc` and drives it against a real WebGL2 context. That is what
makes the three claims which are actually about rasterisation measurable rather than asserted.

### The verification is in two halves because neither half can do the other's job

A recording fake GL context (`lib/fog/__fixtures__/fake-gl.ts`) proves the **call sequence** — `MAX`
is set, state is put back, one instanced draw whatever the count, the `R8`/`LINEAR`/`CLAMP_TO_EDGE`
allocation, the attribute divisors. It cannot prove a pixel. A GPU proves the pixels and can say
nothing about a call sequence. So:

```
node tools/fog-harness/run.mjs
HARNESS PASS — 0055 mask pass
  ok   renderer          ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)
  ok   fbo               R8 mask 640x400 at 0.5x of 1280x800
  ok   T1 a_fraction     solid=255 (want 255) partial=64 (want 64)
  ok   T2 MAX union      overlap reads 153 — max=153, summed=228, overwritten=75
  ok   T3 no scalloping  seam=190 of peak=255 at revealScale 1.35 (want seam >= 179)
  ok   S1 scalloping is detectable   seam=115 at revealScale 1.15
  ok   T4 state restored FUNC_ADD/FUNC_ADD fbo=null viewport=ok
  ok   S1 probe reports a sum        forced FUNC_ADD reads 228 (want 228, not 153)
  ok   S1 probe reports an overwrite blending disabled reads 75 (want 75, not 153)
  ok   T5 5000 instances in one call 256000 lit mask pixels, 41.0 ms
```

**Every probe has a sabotage case, and that is `0118`'s lesson rather than thoroughness for its own
sake.** T2 measures one pixel whose value differs under all three blend behaviours, and the harness
produces the other two deliberately. T3's seam is re-measured at `revealScale = 1.15`, R4's stated
lower bound, where it must collapse — which is what turns "1.35 is the right number" from a quotation
into something a later session can argue with.

`0118` needed a pixel-**count** argument to separate `MAX` from an ignored blend equation, because its
discs were flat and two of the three outcomes produced identical bytes. With this ticket's soft
falloff and unequal coverage they separate **by value at a pixel whose location is known in advance**,
which is cheaper and reads plainly. The count argument is still the right one for a flat-disc probe,
so `0059`'s device check should keep it (that finding stands).

### `run-maplibre.mjs` — the half a stub prelude cannot reach

`run.mjs` substitutes `STUB_PRELUDE`, so it proves the rasterisation and nothing about MapLibre's
shader plumbing. A prelude mismatch would sail past it and reach the operator as *"the fog just isn't
there"*, with no error anywhere. So the shipped `FogMaskLayer` is also run inside a real
`maplibre-gl` 6.6.0 `Map`:

```
MAPLIBRE HARNESS PASS
prelude     variant=mercator 664 bytes, define="#define PROJECTION_MERCATOR", projectTile=true
instances   1951 at res 10, one drawArraysInstanced each frame
mask        640x400 (half the drawing buffer)
rebuilds    2 instance-buffer uploads (one per install)
restored    {"blendEquationRGB":"FUNC_ADD","framebufferUnbound":true,"viewportRestored":true}
gl.getError 0x0
```

### Decisions taken inside the ticket, written down rather than assumed

- **"Logged per rebuild" means per instance-buffer rebuild, not per frame.** The mask pass is
  screen-space, so it runs every frame even when nothing about the data changed — §6.2 separates
  `maskDirty` from `bufferDirty` for exactly this. Sixty identical log lines a second is a flood, not
  evidence, and it would push everything else out of the console. What §6.4 wants a histogram of is
  the count the pass draws, and that changes only when the buffer is rebuilt. `stats()` is the
  per-frame half, for `0059`'s scripted camera path.
- **The debug flag is a query parameter, `?fog=mask`.** The check this ticket asks for is a ten-second
  look; a flag needing a rebuild or a settings trip makes it a task. It is also self-clearing, so a
  debug view cannot quietly become the default.
- **The disc falloff is `1.0 - smoothstep(0.45, 1.0, d)`, Gaussian-*like* and not Gaussian.** A true
  `exp(-d²)` never reaches zero, so it would either clip visibly at the quad edge or need a larger
  quad for the same visual radius — more overdraw for a difference invisible under `0056`'s noise.
- **The circumradius comes from `getHexagonEdgeLengthAvg`, not a literal.** h3-js says 75.864 where
  §2.1's table says 75.9; a test asserts they agree to 0.1 m, so an h3 upgrade that moves the table
  fails loudly instead of shifting the render radius.
- **`fraction` is clamped at the packer.** Above 1 a coarse cell would out-write a fully-explored one
  under `MAX`; below 0 it vanishes. `explored-agg.json` is generated and ought to be in range — this
  is the boundary where an out-of-range number stops being data and becomes a rendering bug.

### What went wrong while doing it

- **The "stop trying every frame" comment on the shader-failure path was a lie when written**, and the
  test caught it: `#resources` stayed null, so `prerender` rebuilt and re-failed on every frame — the
  spy saw three `console.error` calls where the comment promised one. Fixed with an explicit
  one-attempt-per-variant guard; a variant change still earns a retry, because that is a different
  prelude.
- **`run-maplibre.mjs` reported "prerender never ran" for two rounds, and the layer was fine.** Under
  Chromium's `--virtual-time-budget` a `setTimeout` advances the virtual clock immediately, so the
  1.5 s wait after the remove/re-add elapsed before a single frame had been drawn. `map.redraw()`
  renders synchronously and takes the ambiguity out. Written into the harness README, because the
  failure looks exactly like a real one.
- **Float32 comparison, again.** Two mercator radii near 3.9e-6 cannot be compared with an absolute
  tolerance; the assertion is a ratio. `0118` recorded the same trap and it still cost a test run.
- **`npm run lint` fails locally after a build** (ticket `0188`/`0190`), so every check here was run
  with `public/maplibre` moved aside and **unfiltered** — the near-miss `0190` records is precisely
  that filtering a guard's output trains you to miss a real hit.

### Not done here, on purpose

- **Zoom bucketing and viewport culling are `0058`.** Every stored cell is packed and drawn today.
  Correct, and not fast: §6.2 is explicit that the 60 fps claim is a property of the CPU-side data
  pipeline, not of the GPU. `0059` measures it.
- **`explored-agg.json` is not fetched.** A stored res-10 cell is fully explored by definition, so its
  fraction is 1.0. `a_fraction` ships and works; the coarse-bucket consumer is `0058`'s.
- **`/` First Load JS moved 188 kB → 192 kB.** Ticket `0191` already owns that baseline being stale.

## Operator validation

**Amended 2026-09-10, and the amendment is recorded rather than quietly taken.** The ticket was
written on 2026-08-30 and asks for the 6.8in Android phone. **D-227** and **D-229** both landed on
2026-09-09, after it: the desktop browser is the primary viewing surface, and an operator validation
step may not require the phone unless the ticket is about phone capture. This is the same amendment
`0118` made under **D-230**, for the same reason, on the ticket immediately upstream of this one.

**Step 3 of the original list is removed, not moved to the desktop.** *"Zoom out to z10, sparsely-run
parent cells must read as a dim wash"* needs zoom bucketing, which is **`0058`**. There is no coarse
bucket to look at yet. `a_fraction` still ships and still multiplies coverage — measured at 64/255
against a solid 255 on a real GPU, which is a stronger answer than the eye could give anyway.

### ★ For the operator — desktop browser, `https://soles.devaultsecurity.com/?fog=mask` ★

Signed in. The mask renders as a **dark greyscale veil** over the parchment basemap: dark where you
have run, untouched basemap where you have not. It is deliberately not the fog — `0056` builds that.

1. **At zoom 16 over a street you have run**, the veil must be a **continuous corridor**. Look
   specifically for **scalloping**: a repeating semicircular notch pattern along the edges, as though
   the corridor were made of overlapping coins. There must be none.
2. **Zoom to 18 and look at the corridor edge.** It must stay a smooth curve. Straight segments
   meeting at blunt corners would mean hexagons are reaching the mask.
3. **Pan hard for 20 seconds** while watching the basemap underneath. MapLibre's own labels and roads
   must render exactly as they do with the flag off. Any tint, flicker or missing label means GL state
   is not being restored. (Compare by opening `/` without the query parameter.)

### Agent-side, not routed to the operator (D-181/D-229)

- **`tools/fog-harness/run.mjs`** — `HARNESS PASS` on Chromium 152 / SwiftShader (ANGLE over Vulkan
  1.3). `a_fraction` reads 64 against a solid 255; the overlap reads 153 where a sum is 228 and an
  ignored blend equation is 75; the neighbour seam holds at 190/255 and collapses to 115 at
  `revealScale` 1.15. All three sabotage cases produce the numbers they must.
- **`tools/fog-harness/run-maplibre.mjs`** — `MAPLIBRE HARNESS PASS`. The mask shader compiles against
  MapLibre 6.6.0's own 664-byte mercator prelude inside the real `prerender`; 1,951 instances in one
  draw; state restored; `gl.getError()` clean across a remove-and-re-add of the layer.
- **The full CI set, unfiltered**, with the generated `public/maplibre` moved aside: nine guard
  scripts, typecheck, lint, **1,733 tests** (55 new), `npm run build`.
- **Post-deploy smoke test** (Amplify job **169**, `SUCCEED`, commit `5993149`):
  `/` → 200 · `/?fog=mask` → 200, the same landing page rather than an error · the signed-out payload
  carries no home-shaped coordinate · the deployed page chunk
  `/_next/static/chunks/app/page-59d7e5de8a4aa6c2.js` contains `smoothstep(0.45, 1.0, d)`, `fog-mask`,
  `a_fraction` and `visibleInstanceCount`, so the layer genuinely shipped rather than being tree-shaken
  out of a route nobody visits signed out.
