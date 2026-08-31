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

- [ ] A MapLibre `CustomLayerInterface` with `onAdd` / `prerender` / `render` / `onRemove`; `render`
      may be a passthrough until 0056.
- [ ] Half-resolution `R8` FBO, created and resized with the drawing buffer, cleared to 0 each
      prerender.
- [ ] One `drawArraysInstanced` call per mask rebuild, regardless of cell count.
- [ ] `gl.blendEquation(gl.MAX)` is set for the mask pass and restored afterwards; a test asserts
      GL state (blend equation, blend func, bound FBO, viewport) is restored so MapLibre's own
      drawing is unaffected.
- [ ] The instance attribute layout is `{centerMercX, centerMercY, radiusMerc, fraction}`, packed
      once per bucket, never per frame.
- [ ] Disc falloff is a smooth Gaussian-like radial ramp at `revealScale = 1.35`; the constant is
      named and commented with the 1.15/1.6 bounds.
- [ ] Projection uses `shaderData.vertexShaderPrelude`; no `map.project()` in any per-frame path
      (grep test).
- [ ] `a_fraction` multiplies coverage; a coarse-bucket fixture renders as partial, not solid.
- [ ] `visibleInstanceCount` is exposed and logged per rebuild.
- [ ] A debug flag renders the raw mask to screen as greyscale, for eyeballing coverage.
- [ ] 0118 has been completed with a recorded **GO** before this ticket starts. (The spike was
      split out during backlog validation — see 0118. Do not re-do it here.)

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

## Operator validation

1. With the debug greyscale flag on, open the map on the 6.8in Android phone at zoom 16 over a
   street you have run. The mask must be a continuous white corridor — look specifically for
   **scalloping**, the repeating semicircular notch pattern between adjacent cells. There must be
   none.
2. Zoom to 18 and look at the corridor edge. It must stay a smooth curve; if you can see straight
   segments meeting at blunt corners, hexagons are reaching the mask and the disc radius or the
   primitive is wrong.
3. Zoom out to z10. Sparsely-run parent cells must read as a dim wash, not as solid blocks.
4. Pan hard for 20 seconds while watching the basemap underneath: MapLibre's own labels and roads
   must render exactly as they did before the layer was added. Any tint, flicker or missing label
   means GL state is not being restored.
