# R4 — Map Rendering Stack

**Project:** Lost Soles (fitness gamification, fantasy/RPG theme)
**Scope:** The fog-of-war world map — rendering library, fog technique, basemap tiles, visual style.
**Date:** 2026-08-30
**Status:** Research / planning. No code exists yet.
**Constraints:** 1–5 users. AWS (Amplify/S3/CloudFront). Mobile browser first. Target cost ≤ a few $/month.

---

## 1. RECOMMENDATION (read this bit)

| Decision | Choice |
|---|---|
| **Rendering library** | **MapLibre GL JS v6.6.0** (BSD-3-Clause). Plain, no deck.gl. |
| **Fog technique** | **Custom WebGL2 layer: two-pass "coverage mask FBO → noisy composite shader"**, with the explored set drawn as *soft radial sprites* (not hard hexes), unioned with `blendEquation(gl.MAX)`. |
| **Explored-cell handling** | H3 cells, **zoom-bucketed resolution** + viewport cull, so on-screen instance count is bounded (~2–6k) regardless of total stored cells. |
| **Basemap tiles** | **Protomaps PMTiles** — a regional `.pmtiles` extract on **S3 + CloudFront**, served statically via HTTP Range requests. No Lambda, no tile server. |
| **Basemap style** | Fork `@protomaps/basemaps` (`light` flavor) into a warm parchment palette; dark blue-black fog on top. |
| **Fallback tile source** | Stadia Maps or MapTiler free tier, if you want zero build effort at the start. |
| **Estimated cost** | **$0.05 – $0.60 / month** (essentially S3 storage for the pmtiles file; CloudFront egress falls inside the perpetual free tier at this scale). Realistically: **rounding error on your AWS bill.** |

### Why this shape

1. **MapLibre, not Mapbox.** Mapbox GL JS has been proprietary since v2.0 (Dec 2020) and remains so at v3.29.0 — the license is contingent on holding an active Mapbox account and bills per `Map` instantiation. MapLibre is the BSD-3 fork of the last open version and has since overtaken it on features you actually want here (globe projection, WebGL2-only pipeline, `shaderData` projection prelude for custom layers).
2. **No deck.gl.** deck.gl is excellent and its `MaskExtension` looks tempting, but (a) it adds ~500 KB+ to the bundle for one effect, (b) `MaskExtension` produces a **binary, hard-edged** mask — exactly the "hard hex edge looks bad" failure mode you flagged — and (c) you cannot inject noise/feather into its masking test without forking its shaders anyway. If you're writing a shader regardless, write it against MapLibre's custom-layer API directly and skip the dependency.
3. **Soft radial sprites, not hexagons, in the mask.** This is the single most important visual decision in this document. If you rasterize hexagon *geometry* into the mask you get a hex-tiled blob with visible flat edges and 120° corners, no matter how much you blur it. If you instead splat a **Gaussian falloff disc at each cell centre** at ~1.3× the cell circumradius and union them with `MAX` blending, adjacent cells merge into a continuous organic region with an inherently soft boundary — and you get the mist edge *for free*, with no blur pass. Draw the hex grid as a separate faint decorative line layer *if* you want the game-y grid read.
4. **The scaling answer is bucketing, not brute force.** 500,000 cells never hit the GPU at once. Map zoom → H3 resolution, cull to viewport, and the number of on-screen cells is bounded by (screen area / on-screen cell area) — a few thousand at any zoom. Total stored cells only affects *transport and storage*, which is a few MB, once, cached in IndexedDB.
5. **Protomaps on S3.** You are already on AWS; S3 natively supports HTTP Range requests and CloudFront forwards them, which is exactly and only what the PMTiles protocol needs. One static file, no tile server, no per-request vendor billing, no rate limits, no "must be publicly accessible" clause. It is the cheapest and the least operationally fragile option available to you.

---

## 2. Rendering library

### Verified versions (npm registry, 2026-08-30)

| Package | Latest | License | Published |
|---|---|---|---|
| `maplibre-gl` | **6.6.0** | BSD-3-Clause | 2026-08-24 |
| `mapbox-gl` | 3.29.0 | `SEE LICENSE IN LICENSE.txt` (proprietary) | 2026-08-20 |
| `leaflet` | 1.9.4 | BSD-2-Clause | 2023-05-18 (stale) |
| `deck.gl` | 9.3.11 | MIT | 2026-08-28 |
| `@deck.gl/geo-layers` | 9.3.11 | MIT | 2026-08-28 |
| `pmtiles` | 4.5.0 | BSD-3-Clause | 2026-08-10 |
| `h3-js` | 4.5.0 | Apache-2.0 | 2026-07-01 |
| `@protomaps/basemaps` | 5.7.2 | BSD-3-Clause | 2026-03-10 |

(Queried directly from `registry.npmjs.org`.)

### Licensing state of play

- **Mapbox GL JS** went proprietary at **v2.0.0 (Dec 2020)** and has stayed there. The current `LICENSE.txt` is the Mapbox TOS: you may use and modify the Web SDK only while you hold an active Mapbox account, you may not alter the billing/telemetry code paths, and **the licence terminates automatically if the account lapses**. Since v2.0.0 a *map load* is billed whenever a `Map` object is initialised. For a hobby project this is a licence you can technically satisfy on the free tier, but it makes your map a hostage to a vendor relationship. Skip it.
  - <https://github.com/mapbox/mapbox-gl-js/blob/main/LICENSE.txt>
  - <https://github.com/mapbox/mapbox-gl-js/releases/tag/v2.0.0>
  - <https://carto.com/blog/our-thoughts-as-mapboxgl-js-2-goes-proprietary/>
- **MapLibre GL JS** is the community fork of mapbox-gl-js v1.13 (the last BSD-3 release) and is BSD-3-Clause with no account, key, or attribution-to-vendor requirement. <https://github.com/maplibre/maplibre-gl-js>
- **Leaflet** is BSD-2-Clause and fine, but v1.9.4 is from May 2023 and Leaflet is a **DOM/Canvas2D** library — there is no WebGL context to write a fog shader into. You'd be doing the effect in Canvas2D, which is the approach that falls over (see §3.4). Not suitable here.
- **deck.gl** is MIT, no strings.

### MapLibre v6 — what changed, and why it helps you

v6.0.0 shipped **2026-07-22**, ~8 months after v5 (Dec 2025). Two breaking changes matter:

1. **WebGL2 is now mandatory** — WebGL1 support was removed. Good news: you can write `#version 300 es` shaders, use `gl.MAX` blend equations, integer textures, and MRT without capability checks.
2. **ESM-only distribution.** `maplibre-gl.js` / `maplibre-gl-csp.js` UMD bundles are gone; only `maplibre-gl.mjs` is published. `import maplibregl from 'maplibre-gl'` must become `import * as maplibregl from 'maplibre-gl'` or named imports. If you're on Vite/esbuild this is a non-event; if you were planning a `<script src>` tag, you need `<script type="module">`.

Also added in v6: `fill-layer-opacity` and `line-layer-opacity` (unified per-layer opacity that avoids the double-darkening artefact where translucent lines overlap themselves) — directly useful for the route glow in §6.

- <https://github.com/maplibre/maplibre-gl-js/releases>
- <https://github.com/maplibre/maplibre-gl-js/issues/6427> (v6 breaking-changes tracker)
- <https://geo.malagis.com/maplibre-gl-js-v6-mandatory-webgl-and-esm-only.html>

### Where deck.gl would still make sense

deck.gl 9.3 integrates with MapLibre via `MapboxOverlay` from `@deck.gl/mapbox`, in either *overlaid* (own transparent canvas above the map) or *interleaved* (renders into MapLibre's own WebGL2 context, so layers can sit below labels) mode. It requires WebGL2 and `maplibre-gl@>3`, so v6 is in range.
- <https://deck.gl/docs/developer-guide/base-maps/using-with-maplibre>
- <https://deck.gl/docs/api-reference/mapbox/overview>

Reach for it if you later want: `H3HexagonLayer` (instanced hexes with a solid API), `TripsLayer` (animated route replay — genuinely lovely for a run playback feature), `ScatterplotLayer` for POI/loot markers, or GPU aggregation. **`MaskExtension` is not the reason to adopt it.** Its documented limits: max 4 simultaneous masks, incompatible with CPU aggregation layers, unsupported in `GlobeView`, and the mask test is a hard in/out boolean with no feathering hook.
- <https://deck.gl/docs/api-reference/extensions/mask-extension>

**Verdict: MapLibre GL JS v6.6.0, standalone.** Add deck.gl later if and only if you want `TripsLayer`-style run replay.

---

## 3. Fog of war — the techniques, compared

This is a known genre. Prior art worth looking at: **Fog of World** (iOS, 2012, the original), **FOG: Fog of War Walking Map** (Android), **Kraina** (web, Strava-integrated, launched ~Mar 2026 — "rolling fog", clears a corridor along the recorded track), and — most usefully, because it is **open source and already on MapLibre** — **Dawarich**.
- <https://the5krunner.com/2026/03/25/kraina-strava-fog-of-war/>
- <https://dawarich.app/docs/features/map/>
- <https://github.com/Freika/dawarich>

I read Dawarich's implementation in full. It is the honest baseline, and it is *approach 3.4 below* — the Canvas2D overlay. Read §3.4 for what they got right and what it costs them.

### 3.1 Approach A — inverted `fill` layer (world polygon with holes). **Do not do this.**

The obvious idea: one GeoJSON `Polygon` whose **outer ring** is the world bbox (clockwise) and whose **interior rings** are the explored regions (counter-clockwise), painted with a `fill` layer. MapLibre's winding-order convention is the standard one — positive signed area = exterior/clockwise, negative = interior — so a correctly wound multi-hole polygon does render as a fog sheet with holes punched in it.

It fails for three independent reasons, in increasing order of fatality:

1. **Hard edges, always.** A `fill` is a flat triangulated polygon. There is no feathering, no blur, no soft boundary. You get faceted hexagon silhouettes.
2. **You must dissolve the hexes first.** Adjacent hexes must be unioned into a small number of rings, or every hex becomes its own hole and the ring count explodes. `turf.union` / `polygon-clipping` over tens of thousands of hexes is an O(n log n)-at-best sweep that in practice takes seconds to minutes in JS and blocks the main thread. Doing it server-side is possible but then it must be re-run on every new run.
3. **MapLibre silently deletes your holes above 500 rings.** This is the killer, and it is hard-coded. In `src/data/bucket/fill_bucket.ts`:

   ```ts
   const EARCUT_MAX_RINGS = 500;
   ...
   for (const polygon of classifyRings(geometry, EARCUT_MAX_RINGS)) { ... }
   ```

   and in `classify_rings.ts` (maplibre-style-spec):

   ```ts
   // Earcut performance degrades with the # of rings in a polygon. For this
   // reason, we limit strip out all but the `maxRings` largest rings.
   if (maxRings > 1) {
       for (let j = 0; j < polygons.length; j++) {
           if (polygons[j].length <= maxRings) continue;
           quickselect(polygons[j], maxRings, 1, polygons[j].length - 1, compareAreas);
           polygons[j] = polygons[j].slice(0, maxRings);
       }
   }
   ```

   Above 500 rings **per tile**, MapLibre keeps the 500 largest by area and throws the rest away, with no warning. Your small explored patches vanish and reappear as you pan. This is not a bug you can work around from userland.

   - <https://github.com/maplibre/maplibre-gl-js/blob/main/src/data/bucket/fill_bucket.ts>
   - <https://github.com/maplibre/maplibre-style-spec/blob/main/src/util/classify_rings.ts>

**Verdict: viable up to a few hundred distinct holes. Falls over — visibly and silently — beyond that.** Fine for a throwaway demo, wrong for the product.

### 3.2 Approach B — deck.gl `MaskExtension` with `maskInverted: true`

Genuinely elegant on paper: define an `H3HexagonLayer` (or `PolygonLayer`) with `operation: 'mask'`, then a full-viewport `SolidPolygonLayer` of dark fog carrying `extensions: [new MaskExtension()]`, `maskId: 'explored'`, `maskInverted: true`. The fog renders everywhere the explored layer *isn't*. Roughly:

```js
new SolidPolygonLayer({
  id: 'fog',
  data: [viewportBboxPolygon],
  getPolygon: d => d,
  getFillColor: [8, 11, 20, 235],
  extensions: [new MaskExtension()],
  maskId: 'explored',
  maskInverted: true
})
```

Limits, from the docs: **max 4 simultaneous masks; incompatible with CPU-aggregation layers (`CPUGridLayer`, `HexagonLayer`); unsupported in `GlobeView`; not all layers are compatible.**

The disqualifier for us is unstated in the docs but structural: the mask is rendered to a texture and tested as a **boolean** in the masked layer's fragment shader. There is no feather parameter, no alpha ramp, no noise hook. You get a hard binary edge — the exact problem you asked to avoid — plus resampling shimmer on the mask texture as you pan. To fix it you'd fork deck.gl's mask shader module, at which point you have all the cost of deck.gl and all the work of writing your own shader.

- <https://deck.gl/docs/api-reference/extensions/mask-extension>

**Verdict: correct architecture, wrong ergonomics. Reject — but note that this is the fastest path to a *working* (ugly) prototype if you want one in an afternoon.**

### 3.3 Approach C — precomputed raster fog tiles

Rasterize the explored set server-side into a single-channel coverage tile pyramid (PNG/WebP), host on S3, load as a MapLibre `raster` source, and blend a dark colour by `1 - coverage`.

- **Pros:** render cost is O(screen), totally independent of cell count. Scales to millions of cells. The tiles can be pre-blurred at bake time, so soft edges are free.
- **Cons:** (a) you need a tile-baking job on every new run, which is a whole server-side pipeline you don't have; (b) a plain `raster` layer can only be tinted, not shaded — to get noise/animated mist you'd need to sample those tiles from your *own* shader, and MapLibre gives you no public API to read another layer's tile textures, so you'd be re-fetching and managing the tile cache yourself; (c) fog updates lag behind the run by however long the bake takes.

**Verdict: this is the right answer at 10M+ cells or 10k+ users. It is over-engineering for 1–5 users. Keep it in your back pocket as the documented escape hatch.**

### 3.4 Approach D — Canvas2D overlay with `destination-out` (the Dawarich approach)

A `<canvas>` absolutely positioned over the map container, `pointer-events: none`, redrawn on every `move`/`zoom`. Fill it with dark, switch to `globalCompositeOperation = 'destination-out'`, and draw the explored shapes to erase holes. Dawarich's actual code:

```js
render() {
  const { width, height } = this.canvas
  this.ctx.clearRect(0, 0, width, height)
  this.ctx.fillStyle = "rgba(0, 0, 0, 0.6)"
  this.ctx.fillRect(0, 0, width, height)
  this.ctx.globalCompositeOperation = "destination-out"
  this.ctx.fillStyle = "rgba(0, 0, 0, 1)"
  if (this.mode === "hexagons") this.renderHexagonHoles()
  else this.renderPointHoles()
  this.ctx.globalCompositeOperation = "source-over"
}
```
<https://github.com/Freika/dawarich/blob/master/app/javascript/maps_maplibre/layers/fog_layer.js>

**What Dawarich gets right, and you should copy regardless of which approach you pick:**
- **Zoom-bucketed H3 resolution.** They map zoom → resolution and re-derive the display set with `h3.cellToParent(id, res)` only when the bucket changes, debounced 250 ms:
  ```js
  export const ZOOM_TO_RES = [
    { maxZoom: 3,  res: 3 }, { maxZoom: 5,  res: 4 }, { maxZoom: 7,  res: 5 },
    { maxZoom: 9,  res: 6 }, { maxZoom: 11, res: 7 }, { maxZoom: 13, res: 8 },
    { maxZoom: Infinity, res: 9 },
  ];
  ```
  (You'll want to extend this to res 10/11 for running — res 9 is a 174 m edge, far too coarse to show a street-level corridor. See §3.6.)
- **Per-cell bbox precomputed once**, so the per-frame viewport cull is four float compares, not a geometry test.
- **Boundary coords memoised** per cell id (`_coordsById`), because `h3.cellToBoundary` is not free.
- **Handlers detached when the layer is hidden** — "hidden fog must not pay the tile walks".
- They also learned the hard way that `querySourceFeatures` is far too heavy for the per-frame path and must run only on settle.

**Why it still isn't good enough for Lost Soles:**
1. **No feathering, and you can't cheaply add it.** `ctx.filter = 'blur(24px)'` is the obvious fix and it is **silently ignored on iOS Safari** — no error thrown, you just get hard edges on exactly the device you care most about. The documented workaround is `shadowBlur`, which is per-draw-call and would multiply your cost by the number of shapes. Dawarich ships hard edges; look at their screenshots and you can see it.
   - <https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/filter>
   - <https://caniuse.com/mdn-api_canvasrenderingcontext2d_filter>
2. **`map.project()` per vertex, per shape, per frame, on the main thread.** Dawarich re-projects every visible hexagon's six corners in JS on every `move` event. At a few hundred shapes this is fine; at a few thousand it drops frames on a phone; at tens of thousands it is unusable.
3. **It's a separate DOM layer**, so it composites *above everything* including labels and your route — you can't interleave it, and it can't participate in WebGL blending.

**Verdict: the correct 2-hour prototype, and a reasonable Phase 1 if you want something on screen this week. Not the shipping implementation.**

### 3.5 Approach E — **RECOMMENDED**: MapLibre custom WebGL2 layer, mask FBO → noisy composite

Two passes inside one `CustomLayerInterface`:

- **`prerender`** (MapLibre calls this during its `offscreen` pass): bind your own half-resolution single-channel FBO, clear to 0, and draw the visible explored cells as **instanced soft radial sprites**, unioned with `gl.blendEquation(gl.MAX)`. Result: a screen-space *coverage* texture, 0 = unexplored, 1 = fully revealed, with soft ramps at the boundary because the sprites themselves have soft falloff.
- **`render`** (MapLibre's `translucent` pass): draw one full-screen triangle into MapLibre's framebuffer, sample the coverage texture at `gl_FragCoord.xy / u_screenSize`, perturb the threshold with animated fBm noise, and output premultiplied fog colour + a warm rim glow at the boundary.

**Why this is the right one:**

- **The soft edge is structural, not bolted on.** The mist boundary comes from the sprite falloff plus a noise-perturbed `smoothstep`. There is no blur pass to pay for and no hex facets to hide.
- **Noise is what makes it read as *mist* rather than *a blurry blob*.** This is the difference between "fog of war" and "someone put a translucent shape over my map". Two or three octaves of scrolling value noise, offset into the smoothstep threshold, gives you wispy, irregular, slowly drifting edges. It is ~30 lines of GLSL and costs nothing.
- **MapLibre hands you the projection.** `render`/`prerender` receive a `shaderData.vertexShaderPrelude` exposing `projectTile(vec2)` which takes web-mercator 0..1 coordinates straight to clip space, plus `shaderData.define` (`#ifdef GLOBE`) and `shaderData.variantName` to key your shader cache. You get globe projection and terrain compatibility for free instead of hand-rolling matrices.
- **MapLibre correctly saves and restores GL state around both calls** — `setCustomLayerDefaults()` before, `setDirty()` + `setBaseState()` after, and `bindFramebuffer.set(null)` after `render`. So binding your own FBO in `prerender` is explicitly supported and safe. (Verified in `src/webgl/draw/draw_custom.ts`.)
- **It sits in the layer stack**, so you can order it above the basemap and place labels *under* the fog (unexplored place names stay hidden — a nice touch for the exploration fantasy) and the route polyline *above* it.

**API facts, verified from source** (`src/style/style_layer/custom_style_layer.ts`, `src/webgl/draw/draw_custom.ts`):

```ts
type CustomRenderMethod =
  (gl: WebGL2RenderingContext, options: CustomRenderMethodInput) => void;

type CustomRenderMethodInput = {
  farZ: number; nearZ: number; fov: number;
  modelViewProjectionMatrix: mat4;   // world -> clip
  projectionMatrix: mat4;            // view  -> clip
  shaderData: {
    variantName: string;             // cache key; changes with projection
    vertexShaderPrelude: string;     // provides projectTile()
    define: string;                  // e.g. #define GLOBE
  };
  defaultProjectionData: CustomLayerProjectionData;  // uniforms for projectTile
  getProjectionData: (p) => ProjectionData;          // per-tile variant
};
```
- <https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/>
- <https://maplibre.org/maplibre-gl-js/docs/examples/add-a-simple-custom-layer-on-a-globe/>

### 3.6 Performance: does it survive 50k–500k cells on a mid-range phone?

**Yes — but the reason is bucketing, not GPU muscle. The total cell count never reaches the GPU.**

The key insight is that **on-screen cell count is bounded by screen area, not by database size.** If you pick the H3 resolution so that a cell is ~8–30 screen pixels across at the current zoom, then a 400×800 CSS-px viewport can only ever contain roughly (400×800)/(15²) ≈ **1,400 cells**, and never more than a few thousand across the whole zoom range. Whether your account holds 50,000 or 500,000 cells is irrelevant to the frame.

H3 resolution reference (from <https://h3geo.org/docs/core-library/restable/>):

| Res | Avg edge | Avg area | Suggested map zoom |
|---|---|---|---|
| 7 | 1.41 km | 5.16 km² | 9–11 |
| 8 | 531 m | 0.737 km² | 11–13 |
| 9 | 201 m | 0.105 km² | 13–14 |
| 10 | 76 m | 0.0150 km² | 14–16 |
| 11 | 29 m | 0.00215 km² | 16+ |
| 12 | 11 m | 0.000307 km² | (too fine; GPS noise dominates) |

**Store at res 11** (~29 m edge, ~58 m across — well matched to GPS accuracy and to a runner's sense of "I was on that street"). Bucket up to res 10/9/8/7/... as you zoom out.

Budget at the recommended approach:

| Pass | Work per frame | Mid-range phone cost |
|---|---|---|
| Mask FBO | 1 instanced draw call, ~1,500–6,000 quads, at 0.5× resolution, tiny fragment footprint, ~2–4× overdraw | **< 1 ms** |
| Composite | 1 full-screen triangle, 3-octave fBm, ~40 ALU/fragment, DPR capped at 2 ≈ 1.5–2 M fragments | **1–2 ms** |
| CPU per frame | zero (nothing re-projected in JS; the vertex shader does it) | **~0 ms** |
| CPU per settle | viewport cull (4 compares/cell) + VBO upload on zoom-bucket change | 5–20 ms, off the frame path |

That leaves the great majority of a 16.7 ms budget for MapLibre's own basemap drawing. **60fps is comfortable.**

**Only rebuild the mask when it's dirty.** Set `maskDirty` on camera move, zoom-bucket change, or new data. The composite pass runs every frame (it's animating), the mask pass does not. During a pan you *do* need to rebuild the mask each frame because it's in screen space — that's fine, it's one cheap draw call — but during idle-with-drifting-mist it costs nothing.

**Transport and storage** — the part that *does* scale with total count:
- 500,000 res-11 ids as JSON hex strings ≈ **8.5 MB**. As raw `BigUint64Array` ≈ **4 MB**. Gzipped binary ≈ 2–3 MB.
- `h3.compactCells()` replaces any complete set of 7 children with their parent, recursively. Contiguous territory (which running routes produce — corridors, not confetti) compacts well; expect **3–10×** on dense areas.
- **Sanity check on the scale:** 500,000 res-11 cells is ~1,075 km² of revealed ground. A runner covering 5,000 km with a 50 m corridor reveals ~250 km². So 50k–500k is the pessimistic end of *years* of running. Even there: fetch once, compact, cache the `BigUint64Array` in IndexedDB, ship deltas thereafter. No tiling needed.

**Approaches known to fall over, summarised:**

| Approach | Fails at | Failure mode |
|---|---|---|
| `turf.union` / `polygon-clipping` dissolve in the browser | ~5–10k polygons | Main thread locks for seconds to minutes |
| GeoJSON `fill` with holes | **>500 rings/tile** | Holes silently discarded (`EARCUT_MAX_RINGS`) |
| Canvas2D + `map.project()` per vertex per frame | ~3–5k shapes | Frame drops during pan on mobile |
| `ctx.filter = 'blur()'` for soft edges | **iOS Safari, always** | Silently ignored; hard edges |
| One draw call per cell (non-instanced) | ~2k cells | Draw-call bound; CPU-side GL overhead |
| Sending all cells to the GPU without zoom bucketing | ~100k+ | Massive overdraw at low zoom; VRAM churn |
| deck.gl `MaskExtension` | works, but | hard binary edge; no feather hook |

---

## 4. Code sketch — the recommended fog layer

Illustrative, not copy-paste-ready. Targets MapLibre GL JS v6 (WebGL2, ESM).

### 4.1 Shaders

```glsl
// ---------- MASK PASS: vertex ----------
// Injected at runtime: `${shaderData.vertexShaderPrelude}` provides projectTile(vec2)
// and `${shaderData.define}` provides #define GLOBE when relevant.
#version 300 es
${shaderData.vertexShaderPrelude}
${shaderData.define}

in vec2  a_quad;      // unit quad corner, -1..1   (per-vertex, 4 verts)
in vec2  a_center;    // cell centre, web-mercator 0..1  (per-instance)
in float a_radius;    // reveal radius, mercator units    (per-instance)

out vec2 v_uv;

void main() {
    v_uv = a_quad;
    // Offset in mercator space, then let MapLibre project. A mercator-space
    // disc is still a disc on screen, so no latitude correction is needed
    // for the *shape*; a_radius carries the ground-size variation.
    gl_Position = projectTile(a_center + a_quad * a_radius);
}
```

```glsl
// ---------- MASK PASS: fragment ----------
#version 300 es
precision mediump float;

in  vec2 v_uv;
out vec4 fragColor;

void main() {
    // Soft radial falloff. THIS is where the mist edge comes from —
    // it costs nothing and it is why we do not need a blur pass.
    float d = length(v_uv);
    float c = 1.0 - smoothstep(0.45, 1.0, d);
    fragColor = vec4(c, 0.0, 0.0, 1.0);
}
```

```glsl
// ---------- COMPOSITE PASS: fragment ----------
#version 300 es
precision highp float;

uniform sampler2D u_mask;
uniform vec2  u_screen;      // drawing-buffer size, px
uniform float u_time;        // seconds
uniform vec3  u_fogDeep;     // e.g. vec3(0.035, 0.045, 0.075)  near-black blue
uniform vec3  u_fogEdge;     // e.g. vec3(0.22,  0.24,  0.30)   lit mist
uniform vec3  u_rimGlow;     // e.g. vec3(0.85,  0.70,  0.42)   warm parchment
uniform float u_maxOpacity;  // 0.94 — never fully 1.0; a hint of the world
                             // showing through reads as mist, not as a hole.

// --- cheap value-noise fBm ---
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i + vec2(0,0)), hash(i + vec2(1,0)), u.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}

float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return v;
}

out vec4 fragColor;

void main() {
    vec2 uv = gl_FragCoord.xy / u_screen;

    float coverage = texture(u_mask, uv).r;

    // Two noise fields drifting at different speeds/scales. The slow one
    // shapes the boundary; the fast one animates wisps.
    vec2  q  = uv * u_screen / 260.0;
    float n1 = fbm(q * 1.0 + vec2( 0.013, 0.008) * u_time);
    float n2 = fbm(q * 2.7 + vec2(-0.021, 0.017) * u_time);
    float n  = mix(n1, n2, 0.35);

    // Perturb the reveal threshold with noise => a ragged, organic mist edge
    // instead of a smooth blurred blob. Amplitude 0.30 is a good starting point.
    float reveal = smoothstep(0.30, 0.72, coverage + (n - 0.5) * 0.30);

    float alpha = (1.0 - reveal) * u_maxOpacity;

    // Density variation *inside* the fog so it isn't a flat wash.
    vec3 col = mix(u_fogDeep, u_fogEdge, smoothstep(0.25, 0.85, n));

    // Rim: peaks at the boundary (reveal ~ 0.5) and vanishes on both sides.
    // This is the "torchlight at the edge of the known world" beat, and it is
    // the single detail that sells the effect. Keep it subtle.
    float rim = reveal * (1.0 - reveal) * 4.0;
    col += u_rimGlow * rim * 0.30;
    alpha = max(alpha, rim * 0.10);   // faint glow bleeding into cleared ground

    fragColor = vec4(col * alpha, alpha);   // premultiplied — MapLibre's default
}
```

### 4.2 The custom layer

```js
import * as maplibregl from 'maplibre-gl';   // v6 is ESM-only
import { cellToLatLng, cellToParent, getResolution,
         getHexagonEdgeLengthAvg, UNITS } from 'h3-js';

const ZOOM_TO_RES = [
  { maxZoom: 4,  res: 4 },  { maxZoom: 6,  res: 5 },  { maxZoom: 8,  res: 6 },
  { maxZoom: 10, res: 7 },  { maxZoom: 12, res: 8 },  { maxZoom: 14, res: 9 },
  { maxZoom: 15, res: 10 }, { maxZoom: Infinity, res: 11 },
];
const resForZoom = z => (ZOOM_TO_RES.find(e => z <= e.maxZoom) ?? { res: 11 }).res;

const lngLatToMercator = (lng, lat) => {
  const s = Math.sin(lat * Math.PI / 180);
  return [ lng / 360 + 0.5,
           0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) ];
};

export class FogOfWarLayer {
  id = 'fog-of-war';
  type = 'custom';
  renderingMode = '2d';

  constructor({ cells, revealScale = 1.35, maxOpacity = 0.94 }) {
    this.allCells   = cells;        // array of H3 ids, stored at res 11
    this.revealScale = revealScale; // >1 so neighbouring discs overlap and merge
    this.maxOpacity  = maxOpacity;
    this.maskDirty   = true;
    this._res        = null;
    this._byRes      = new Map();   // res -> Float32Array instance data
    this._boundsCache = new Map();  // res -> Float64Array of cell bboxes
  }

  // ---- lifecycle -------------------------------------------------------
  onAdd(map, gl) {
    this.map = map;
    this.maskProgram      = buildProgram(gl, MASK_VS, MASK_FS);       // see 4.1
    this.compositeProgram = buildProgram(gl, FULLSCREEN_VS, COMPOSITE_FS);

    this.quadVBO     = makeQuadVBO(gl);       // 4 verts, -1..1, triangle strip
    this.instanceVBO = gl.createBuffer();
    this.maskVAO     = makeInstancedVAO(gl, this.quadVBO, this.instanceVBO);
    this._allocMaskFBO(gl);

    this._onMove = () => { this.maskDirty = true; };
    map.on('move', this._onMove);
    map.on('zoom', this._onMove);
    map.on('resize', () => { this._reallocOnResize = true; this.maskDirty = true; });

    // Animation. 30fps is plenty for drifting mist and halves the battery cost
    // vs. 60. Pause when the tab is hidden.
    this._t0 = performance.now();
    const tick = () => {
      this._raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      map.triggerRepaint();
    };
    this._raf = requestAnimationFrame(tick);
  }

  onRemove(map, gl) {
    cancelAnimationFrame(this._raf);
    map.off('move', this._onMove);
    map.off('zoom', this._onMove);
    gl.deleteFramebuffer(this.maskFBO);
    gl.deleteTexture(this.maskTex);
    gl.deleteBuffer(this.instanceVBO);
    gl.deleteBuffer(this.quadVBO);
    gl.deleteVertexArray(this.maskVAO);
    gl.deleteProgram(this.maskProgram);
    gl.deleteProgram(this.compositeProgram);
  }

  // ---- data ------------------------------------------------------------
  setCells(cells) {
    this.allCells = cells;
    this._byRes.clear();
    this._boundsCache.clear();
    this.maskDirty = true;
    this.map?.triggerRepaint();
  }

  /**
   * Build (once per resolution bucket) the per-instance array for that res:
   * [centerMercX, centerMercY, radiusMerc] * N, plus a parallel bbox array
   * used for the per-frame viewport cull.
   */
  _instancesForRes(res) {
    let packed = this._byRes.get(res);
    if (packed) return packed;

    // Roll every stored cell up to the display resolution and dedupe.
    const ids = new Set();
    for (const id of this.allCells) {
      ids.add(getResolution(id) > res ? cellToParent(id, res) : id);
    }

    // Ground radius -> mercator units. Mercator scales by 1/cos(lat), and the
    // world is 1.0 mercator unit wide == 2*pi*R metres at the equator.
    const edgeM   = getHexagonEdgeLengthAvg(res, UNITS.m);
    const EARTH_C = 40075016.686;

    const out    = new Float32Array(ids.size * 3);
    const bounds = new Float64Array(ids.size * 4);
    let i = 0;
    for (const id of ids) {
      const [lat, lng] = cellToLatLng(id);
      const [mx, my]   = lngLatToMercator(lng, lat);
      // mercator units per metre at this latitude
      const mPerUnit = (EARTH_C * Math.cos(lat * Math.PI / 180));
      const r = (edgeM * this.revealScale) / mPerUnit;

      out[i * 3] = mx; out[i * 3 + 1] = my; out[i * 3 + 2] = r;
      bounds[i * 4] = mx - r; bounds[i * 4 + 1] = my - r;
      bounds[i * 4 + 2] = mx + r; bounds[i * 4 + 3] = my + r;
      i++;
    }
    packed = { out, bounds, count: ids.size };
    this._byRes.set(res, packed);
    return packed;
  }

  // ---- pass 1: build the coverage mask ---------------------------------
  prerender(gl, opts) {
    if (this._reallocOnResize) { this._allocMaskFBO(gl); this._reallocOnResize = false; }
    if (!this.maskDirty) return;

    const res = resForZoom(this.map.getZoom());
    if (res !== this._res) { this._res = res; this._uploadedCount = -1; }
    const { out, bounds, count } = this._instancesForRes(res);

    // Viewport cull in mercator space (4 float compares per cell).
    const b  = this.map.getBounds();
    const [w, n] = lngLatToMercator(b.getWest(),  b.getNorth());
    const [e, s] = lngLatToMercator(b.getEast(),  b.getSouth());
    const pad = 0.02 * (e - w);
    const visible = new Float32Array(count * 3);
    let v = 0;
    for (let i = 0; i < count; i++) {
      if (bounds[i*4+2] < w - pad || bounds[i*4]   > e + pad ||
          bounds[i*4+3] < n - pad || bounds[i*4+1] > s + pad) continue;
      visible[v++] = out[i*3]; visible[v++] = out[i*3+1]; visible[v++] = out[i*3+2];
    }
    this.visibleCount = v / 3;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVBO);
    gl.bufferData(gl.ARRAY_BUFFER, visible.subarray(0, v), gl.DYNAMIC_DRAW);

    // Render the union of soft discs into the half-res single-channel FBO.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskFBO);
    gl.viewport(0, 0, this.maskW, this.maskH);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);            // union, not sum — WebGL2 only
    gl.blendFunc(gl.ONE, gl.ONE);

    gl.useProgram(this.maskProgram);
    setProjectionUniforms(gl, this.maskProgram, opts.defaultProjectionData);
    gl.bindVertexArray(this.maskVAO);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.visibleCount);
    gl.bindVertexArray(null);

    gl.blendEquation(gl.FUNC_ADD);       // restore
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.maskDirty = false;
  }

  // ---- pass 2: composite the fog --------------------------------------
  render(gl, opts) {
    gl.useProgram(this.compositeProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);

    const P = this.compositeProgram;
    gl.uniform1i(gl.getUniformLocation(P, 'u_mask'), 0);
    gl.uniform2f(gl.getUniformLocation(P, 'u_screen'),
                 gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1f(gl.getUniformLocation(P, 'u_time'),
                 (performance.now() - this._t0) / 1000);
    gl.uniform3f(gl.getUniformLocation(P, 'u_fogDeep'), 0.035, 0.045, 0.075);
    gl.uniform3f(gl.getUniformLocation(P, 'u_fogEdge'), 0.22,  0.24,  0.30);
    gl.uniform3f(gl.getUniformLocation(P, 'u_rimGlow'), 0.85,  0.70,  0.42);
    gl.uniform1f(gl.getUniformLocation(P, 'u_maxOpacity'), this.maxOpacity);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);  // premultiplied
    gl.drawArrays(gl.TRIANGLES, 0, 3);             // full-screen triangle
  }

  // ---- mask FBO --------------------------------------------------------
  _allocMaskFBO(gl) {
    if (this.maskFBO) { gl.deleteFramebuffer(this.maskFBO); gl.deleteTexture(this.maskTex); }
    const scale = 0.5;   // half resolution: cheaper AND adds a free bilinear feather
    this.maskW = Math.max(1, Math.floor(gl.drawingBufferWidth  * scale));
    this.maskH = Math.max(1, Math.floor(gl.drawingBufferHeight * scale));

    this.maskTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, this.maskW, this.maskH, 0,
                  gl.RED, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.maskFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
                            gl.TEXTURE_2D, this.maskTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}
```

### 4.3 Wiring it up, and layer order

Layer order is a design decision, not just plumbing:

```js
const fog = new FogOfWarLayer({ cells: exploredH3Cells });

map.on('style.load', () => {
  // Fog ABOVE the basemap and its labels: unexplored place names stay hidden,
  // which is most of the "uncovering the world" feeling.
  map.addLayer(fog);

  // Route ABOVE the fog: your own trace is always visible, even where the
  // fog hasn't been cleared yet (e.g. a run still syncing).
  map.addSource('runs', { type: 'geojson', data: runsFC, lineMetrics: true });
  map.addLayer({ id: 'run-glow', type: 'line', source: 'runs',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffb347', 'line-width': 12,
             'line-blur': 10, 'line-opacity': 0.35 } });
  map.addLayer({ id: 'run-core', type: 'line', source: 'runs',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#fff2d0', 'line-width': 2.5 } });
});
```

### 4.4 Tuning notes

- **`revealScale`** (default 1.35) controls how much a cell's disc overspills its hexagon. Below ~1.15 you get visible scalloping between adjacent cells; above ~1.6 the territory looks inflated and imprecise. 1.3–1.4 is the sweet spot.
- **`u_maxOpacity` should never be 1.0.** Leaving 5–8% of the basemap bleeding through makes it read as *mist over a map* rather than *a hole cut in a black sheet*. This is a bigger perceptual win than it sounds.
- **Draw the run polyline into the mask too**, as a thick soft line, if you want the corridor cleared instantly on upload before the H3 aggregation job runs.
- **Optional decorative hex grid.** If you want the strategy-game grid read, add a *separate* thin `line` layer of hex boundaries clipped to the revealed area at high zoom only. Keep it out of the mask.
- **Cap DPR at 2** (`new maplibregl.Map({ pixelRatio: Math.min(devicePixelRatio, 2) })`). A 3× DPR phone gains almost nothing visually for a soft mist effect and costs 2.25× the fragments.
- **Add a reduced-motion path.** `matchMedia('(prefers-reduced-motion: reduce)')` → stop the `requestAnimationFrame` loop and render the fog statically. Also a sensible battery-saver toggle.

---

## 5. Basemap tiles — pricing and terms, 2026

### 5.1 Protomaps / PMTiles on S3 + CloudFront — **recommended**

PMTiles is a single-file tile archive read over HTTP **Range requests**. No tile server, no database, no per-request billing. Spec is at **v3 (rev 3.6)**; client `pmtiles@4.5.0` (BSD-3); CLI `go-pmtiles v1.31.2`.
- <https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md>
- <https://github.com/protomaps/go-pmtiles/releases>

**Planet size:** the daily build `20260830.pmtiles` is **137.6 GB** (verified by HTTP HEAD against `build.protomaps.com`; note the docs still say ~120 GB and are stale — it grows ~15 MB/day, z0–15).

**Regional extract sizes — measured**, by running `pmtiles extract --dry-run` against the live 2026-08-30 planet build:

| Region | Zooms | Archive size |
|---|---|---|
| Seattle metro (0.6° × 0.5°) | 0–15 | **72 MB** |
| Seattle metro | 0–14 | 28 MB |
| Seattle metro | 0–13 | 12 MB |
| NYC metro | 0–15 | 103 MB |
| SF Bay Area | 0–15 | 148 MB |
| Colorado (whole state) | 0–15 | **512 MB** |
| Colorado | 0–13 | 119 MB |
| Washington State | 0–15 | 636 MB |
| Planet | 0–8 | 552 MB |
| Planet | 0–10 | 3.7 GB |

The Seattle z0–15 extract took **2.7 seconds and 46 HTTP requests** — extraction reads only the ranges it needs from the remote planet file, so you never download 137 GB.

```bash
# Metro-scale extract straight from the remote planet build
pmtiles extract https://build.protomaps.com/20260830.pmtiles lost-soles.pmtiles \
  --bbox=-122.6,47.3,-122.0,47.8

# Or with an arbitrary region (Polygon/MultiPolygon/Feature/FeatureCollection)
pmtiles extract https://build.protomaps.com/20260830.pmtiles lost-soles.pmtiles \
  --region=my-area.geojson

aws s3 cp lost-soles.pmtiles s3://lost-soles-tiles/ \
  --content-type application/vnd.pmtiles --cache-control "public,max-age=604800"
```

Docs explicitly say **do not hotlink `build.protomaps.com`** — copy to your own bucket. Rebuild monthly-ish; older builds are retained only ~1 week.
- <https://docs.protomaps.com/pmtiles/cli>
- <https://docs.protomaps.com/basemaps/downloads>

**Does S3 serve Range requests natively? Yes — and CloudFront forwards them, with no Lambda.**
- AWS: *"Amazon S3 supports `Range GET` requests, as do many HTTP servers."*
- AWS: *"When CloudFront receives a `Range GET` request, it checks the cache… If the origin supports `Range GET` requests it returns the requested range. CloudFront serves the requested range and also caches it for future requests."* (CloudFront may fetch a larger range than asked, which actually helps you.)
- <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RangeGETs.html>

Protomaps' own deployment matrix lists **"static pmtiles"** as a supported deployment with SSL and scale-to-zero. The **Lambda is only needed if you want `{z}/{x}/{y}.mvt` URL compatibility** (there's a CloudFormation template at `pmtiles.io/cloudformation-stack.yaml`, ~125 ms p50 / 800 ms p99, 6 MB response cap). **For 1–5 users, skip the Lambda entirely.** Also note: there is no CloudFront free tier for Lambda@Edge.
- <https://docs.protomaps.com/deploy/> · <https://docs.protomaps.com/deploy/aws>

**CORS:** only required if the app and the `.pmtiles` are on different origins. Simplest answer: **put both behind the same CloudFront distribution and CORS disappears.** If you do split them, the official S3 CORS config is:

```json
[{"AllowedOrigins":["https://lostsoles.example"],
  "AllowedMethods":["GET","HEAD"],
  "AllowedHeaders":["range","if-match"],
  "ExposeHeaders":["etag"],
  "MaxAgeSeconds":3000}]
```
and attach the AWS managed `CORS-S3Origin` origin-request policy so the `Origin` header is forwarded.
- <https://docs.protomaps.com/pmtiles/cloud-storage#amazon-s3>

**Client wiring:**

```js
import * as maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { layers, namedFlavor } from '@protomaps/basemaps';

maplibregl.addProtocol('pmtiles', new Protocol().tile);

const map = new maplibregl.Map({
  container: 'map',
  pixelRatio: Math.min(devicePixelRatio, 2),
  style: {
    version: 8,
    glyphs:  'https://cdn.lostsoles.example/fonts/{fontstack}/{range}.pbf',
    sprite:  'https://cdn.lostsoles.example/sprites/parchment',
    sources: {
      protomaps: {
        type: 'vector',
        url: 'pmtiles://https://cdn.lostsoles.example/lost-soles.pmtiles',
        attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>'
      }
    },
    layers: layers('protomaps', PARCHMENT_FLAVOR, { lang: 'en' })
  }
});
```

**Licence:** the Protomaps planet build is an **ODbL Produced Work — OpenStreetMap attribution is required and non-negotiable**. `@protomaps/basemaps` code is BSD-3-Clause; the visual design is **CC0**; fonts are SIL OFL; sprites derive from MIT Tangram icons. All free for commercial use.

### 5.2 Commercial providers — 2026 free tiers and terms

| Provider | Free tier | Restrictions that matter | First paid tier |
|---|---|---|---|
| **Stadia Maps** | **200,000 credits/mo**, no card (1 credit = 1 vector tile) | **"Commercial use not allowed"** on free. No key needed on localhost; production uses domain allowlisting or an API key. No overage — it just stops. | Starter **$20/mo**, 1M credits, +$0.03/1k |
| **Mapbox** | 50k map loads/mo *(GL JS)*; **200k Vector Tiles API requests/mo** | Private/login-gated apps **are** permitted. Mapbox logo **plus** text attribution mandatory and non-removable. **Gotcha: using MapLibre instead of Mapbox GL JS means you're billed per tile request (200k free), not per map load.** | Map loads $5.00/1k; Vector Tiles API $0.25/1k |
| **MapTiler** | 5,000 map sessions/mo, 100k API requests/mo | "Testing, **personal or non-commercial** use." **MapTiler logo required** on the map (removable only on paid). Service pauses at quota. | Flex **$30/mo** — 25k sessions |
| **Thunderforest** | Hobby: 150,000 tile requests/mo | ToS: "**Commercial use is permitted and encouraged**." Must credit both Thunderforest *and* OSM. **"Absolutely no bulk-downloading, scraping, pre-downloading, pre-caching."** Free plan offered "at our discretion". Raster-oriented in practice. | Solo Developer **$125/mo** — a brutal cliff |
| **Jawg** | Basic: 25,000 map views/mo (~375k tiles) | ❌ **Disqualifying:** non-commercial use authorised only for **"publicly available websites (no login)"**. A login-gated fitness app fails this outright. | Professional **€250/mo** |

Practical read: **Stadia (200k vector tiles/mo, free, no card)** and **Mapbox (200k tile requests/mo)** are the two that comfortably fit 1–5 private users if you want a zero-build-effort start. Stadia's non-commercial clause is satisfiable for a genuinely personal project; re-check it the moment money enters the picture. Jawg is out. MapTiler works but brands your map.

### 5.3 Raw OSM raster tiles (`tile.openstreetmap.org`) — **verdict: NO**

You suspected this wasn't permitted. Confirmed, on two independent grounds.

1. **Wrong service entirely.** The policy §9: *"This policy applies to the **Standard ('OpenStreetMap Carto') raster tiles** served by tile.openstreetmap.org."* You want vector tiles for a shader-driven fantasy style. (There is a separate `vector.openstreetmap.org` with its own policy.)
2. **Prefetch and offline are flatly prohibited**, and a fog-of-war exploration map invites exactly that. §4: *"**Bulk downloading** is any pre-emptive fetching of tiles other than those a user is actively viewing… 'Pre-seeding' large areas or multiple zoom levels in advance… Building tile archives (e.g. `.zip`, `.mbtiles`)… Automated scans across wide bounding boxes, especially at high zoom (z≥14)."* And: *"**Offline use is not permitted on tile.openstreetmap.org.**"*

Other hard requirements, for completeness: a *"clear, unique **User-Agent** string that names your app"* — traffic using defaults (okhttp, python-requests, curl, Go-http-client) *"**will be blocked**"*; a valid `Referer` from web pages; visible attribution that is not hidden behind toggles; cache ≥7 days; never `Cache-Control: no-cache`. Enforcement is *"we may block access, **without notice**"*, and there is *"**no SLA or guarantee**."*

The policy itself points where you're already going: *"If you require offline maps, use **self-hosted** tiles… **Vector tiles** are often more suitable for this use-case."*
- <https://operations.osmfoundation.org/policies/tiles/>

### 5.4 Cost-ranked recommendation

| Rank | Option | Monthly cost | Notes |
|---|---|---|---|
| **1** | **Protomaps PMTiles on S3 + CloudFront** | **~$0.01–0.05** | Metro extract 72 MB → $0.0017/mo storage. Egress inside the free tier. No vendor, no key, no rate limit, no branding. **Recommended.** |
| 2 | Stadia Maps free tier | $0.00 | Zero setup. Non-commercial only; 200k tiles/mo. Good Phase-0 while you build. |
| 3 | Mapbox Vector Tiles API free tier | $0.00 | 200k req/mo. Mandatory Mapbox logo + text attribution. |
| 4 | MapTiler free tier | $0.00 | MapTiler logo forced onto your fantasy map. Aesthetically disqualifying here. |
| 5 | Thunderforest Hobby | $0.00 | Raster-oriented; explicit no-caching clause; $125 cliff. |
| — | Jawg | — | ToS violation (login-gated app). |
| — | `tile.openstreetmap.org` | — | Not permitted. |

**AWS unit rates** (us-east-1, verified 2026-08-30):
- S3 Standard: **$0.023/GB-month**; GET **$0.0004/1,000**; PUT **$0.005/1,000**. S3 → CloudFront origin transfer is **free**.
- CloudFront pay-as-you-go **always-free tier: 1 TB egress/month + 10,000,000 requests/month**, then $0.085/GB in North America.
- ⚠️ **Note the November 2025 flat-rate plans.** The new flat-rate **"Free" plan gives only 1M requests / 100 GB — *less* than the pay-as-you-go always-free tier.** Plans are per-distribution. **Stay on pay-as-you-go.**
- <https://aws.amazon.com/s3/pricing/> · <https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/> · <https://aws.amazon.com/about-aws/whats-new/2025/11/aws-flat-rate-pricing-plans/>

**Estimate:** metro extract (72 MB) + glyphs + sprites ≈ 100 MB → **$0.0023/mo storage**; a few thousand range GETs → **<$0.01/mo**; CloudFront **$0.00**. Add **$0.50/mo** for a Route 53 hosted zone if you want a custom domain. **Call it $0.50/month all-in, and $0.01 without the custom domain.** For reference, hosting the *entire 137.6 GB planet* would be **$3.17/mo** — so even the maximalist option is affordable, and a regional extract makes it free in practice.

---

## 6. Visual style — dark fantasy / parchment

### 6.1 The key art-direction call: **parchment basemap, dark fog**

Take this decision first, because it constrains everything else.

The instinct with a "dark fantasy" brief is a dark basemap. **Don't.** With a dark basemap, dark fog has almost no contrast against unexplored ground, and the reveal doesn't read. You'd have to *brighten* the explored area instead, which means reading back the framebuffer — expensive and awkward.

**Warm parchment basemap + near-black-blue fog** gives you:
- maximum contrast between known and unknown, so the reveal is legible at a glance on a phone;
- the correct emotional metaphor (an old map being uncovered, not a screen being lit);
- a cheap, purely additive fog shader (§4.1) with no readback;
- warm/cool complementary colour tension, which is why this combination looks good in strategy games.

Your `u_rimGlow` picks up the parchment hue at the boundary, which visually stitches the two together.

### 6.2 Starting point: fork `@protomaps/basemaps` flavors

`@protomaps/basemaps` **5.7.2** (BSD-3 code, **CC0 visual design** by Geraldine Sarmiento — free commercially, no attribution required for the style itself; OSM ODbL attribution is separate and still required).

Five flavors ship: `light`, `dark`, `white`, `grayscale`, `black`. Customisation is **a plain object spread** — no style-JSON surgery:

```js
import { layers, namedFlavor } from '@protomaps/basemaps';

const PARCHMENT = {
  ...namedFlavor('light'),
  background: '#e6d5ae',
  earth:      '#e8dab5',
  water:      '#b6a483',   // NOTE: water DARKER than land — reads as ink wash
  park_a:     '#d6cb9c',  park_b: '#cfc292',
  wood_a:     '#c9bd8c',  wood_b: '#c2b684',
  sand:       '#efe3c2',  beach:  '#eee0bb',
  buildings:  '#c9a765',
  minor_a:    '#d8c69b',  minor_b: '#d3c096',
  major:      '#c4a874',  highway: '#b8995f',
  boundaries: '#7a6440',
  city_label: '#4a3b22',  city_label_halo:    '#f2e7cb',
  state_label:'#5a4a2c',  country_label:      '#3b2f18',
  // three strings swap the entire map's typography:
  regular: 'Cinzel Regular', bold: 'Cinzel Bold', italic: 'Cinzel Italic',
};

const style = {
  version: 8,
  glyphs: 'https://cdn.lostsoles.example/fonts/{fontstack}/{range}.pbf',
  sprite: 'https://cdn.lostsoles.example/sprites/parchment',
  sources: { protomaps: { type: 'vector', url: 'pmtiles://…/lost-soles.pmtiles' } },
  layers: layers('protomaps', PARCHMENT, { lang: 'en' })
};
```

The `Flavor` interface is ~75 flat colour keys (`background, earth, park_a/b, wood_a/b, scrub_a/b, glacier, sand, beach, water, buildings, minor_a/b, major, highway, *_casing_*, tunnel_*, bridges_*, railway, boundaries, pier, runway, aerodrome, military, zoo, hospital, school, industrial, pedestrian` + label colours), plus optional `regular` / `bold` / `italic` **font-name strings** and optional `landcover` / `pois` sub-objects.

**The font finding is the important one.** Every symbol layer in `base_layers.ts` emits `"text-font": [t.regular || "Noto Sans Regular"]` (and the bold/italic equivalents). So **three strings restyle every label on the map to a fantasy serif.** That is the cleanest, highest-leverage change available.

- <https://docs.protomaps.com/basemaps/flavors> · <https://docs.protomaps.com/basemaps/maplibre>

### 6.3 Existing open styles worth stealing from

There is **no maintained, open-licensed real-world "fantasy/RPG" MapLibre style.** This is unoccupied territory — good for differentiation, bad for shortcuts. Ranked by usefulness:

| Style | Licence | Why it matters |
|---|---|---|
| **OpenHistoricalMap `woodblock` / `japanese_scroll`** | **CC0 (style + code)** | **The closest thing to a parchment style in the wild, and it's public domain.** Steal the cartography wholesale. |
| VersaTiles colorful/graybeard/eclipse | Public Domain | Clean, unencumbered Shortbread-schema bases. |
| OSM Americana / AAMaps | CC0 | Free of strings. |
| Geolonia **Notebook** | MIT code (style licence unclear) | Hand-drawn notebook look; authored in Charites YAML. |
| MapsMania **Pencil** style | **No licence stated** | Reference only — reimplement, don't copy the file. |
| CARTO Positron / Dark Matter, OSM Liberty, Fiord Color | CC BY (Positron/Dark Matter licences are **disputed**, open issues) | Avoid when CC0 alternatives exist. |
| Andy Townsend svwd03, MapComplete Sunny | **GPL-3 / GPLv3** | Copyleft — don't derive. |
| **Stamen Watercolor** (now Stadia-hosted) | ❌ **Commercial use requires contacting sales + usage fees.** Raster-only, not restylable. | Avoid. |
| John Nelson "Middle Earth Map Style" | Informal permission, **ArcGIS Pro only** | The definitive *visual* reference; not usable as an asset. |

Best single overview, with *style licence* and *code licence* as separate columns: **<https://github.com/pnorman/maplibre-styles>** (page itself CC0).

**The Woodblock technique, verified from its style JSON:**

```json
{ "id": "background-pattern", "type": "background",
  "paint": { "background-color": "rgba(207,179,125,1)",
             "background-pattern": "woodblock-paper" } },
{ "id": "land-pattern", "type": "fill",
  "paint": { "fill-color": "rgba(236,225,203,1)",
             "fill-pattern": "woodblock-paper" } }
```

That is: **the paper texture is a sprite applied via `background-pattern` + `fill-pattern`, not a DOM overlay.** It ships *both* layers, apparently compositing viewport-anchored and world-anchored grain deliberately. It targets the OHM schema, so you take the cartography and the technique, not the layer definitions.
- <https://github.com/OpenHistoricalMap/map-styles> (CC0) · gallery <https://openhistoricalmap.github.io/map-styles/>

The Pencil style's "hand-drawn wobble" trick, also worth lifting:
```json
"building-outline": { "line-dasharray":[2,4], "line-offset":5,
                      "line-color":"rgba(170,162,162,1)" }
```
An offset dashed outline reads as a sketchy second pass of the pen.

### 6.4 Techniques

**Paper texture — do it in-engine, not in the DOM.** Sprite patterns (`background-pattern`, `fill-pattern`) put the grain *under* your fog and route layers and never touch the controls. Per the sprite spec, **seamless pattern images must be power-of-two, 2–512 px**, and **zoom expressions on pattern properties evaluate only at integer zooms**. Ship `sprite@2x.png` / `sprite@2x.json`.
- <https://maplibre.org/maplibre-style-spec/sprite/>

⚠️ **MapLibre has no native per-layer blend modes.** It's a funded roadmap item only (<https://maplibre.org/roadmap/maplibre-gl-js/blending-modes/>). The known workaround — multiple synced MapLibre instances with `mix-blend-mode: multiply` on each canvas — is documented by Oliver Wipfli, who explicitly warns it is *"tedious… and the syncing lags a bit which gives a bad interactivity experience."* **Do not go multi-canvas.** Sprite patterns plus at most one DOM texture overlay.
- <https://oliverwipfli.ch/canvas-multiply-blending-2025-11-24/>

**Open question to test in the first hour:** is `background-pattern` viewport-anchored (static grain, like paper behind glass) or world-anchored (grain pans with the map)? It determines your whole texture architecture. Woodblock ships both layers, which suggests both behaviours are in play.

**Terrain — free, and a big win for the fantasy look.** AWS Open Data terrain tiles:
```js
map.addSource('dem', {
  type: 'raster-dem',
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium', tileSize: 256
});
map.addLayer({ id:'hills', type:'hillshade', source:'dem',
  paint: { 'hillshade-method': 'igor', 'hillshade-exaggeration': 0.4 } });
```
**Use `hillshade-method: 'igor'`** — it is specifically designed to minimise impact on features beneath, which is exactly right under sepia line-work. MapLibre also now has a separate **`color-relief`** layer type; a sepia elevation ramp gives hypsometric parchment tinting for free. **Attribution is required** for the terrain tiles (tilezen/joerd).
- <https://registry.opendata.aws/terrain-tiles/> · <https://github.com/tilezen/joerd/blob/master/docs/attribution.md>
- <https://maplibre.org/maplibre-gl-js/docs/examples/add-a-hillshade-layer/> · <https://maplibre.org/maplibre-gl-js/docs/examples/add-a-color-relief-layer/>

For *pictorial* drawn mountains (Nelson-style peaks), MapLibre offers no direct path — you'd need a `symbol` layer over `natural=peak` points, which won't tile into ranges. Hillshade + `color-relief` + texture is the achievable 90%.

**Fantasy typography — the glyph pipeline.** MapLibre needs pre-baked **SDF glyphs as `.pbf`, 256 codepoints per range**.
1. Pick an OFL face (Cinzel, IM Fell English, Uncial Antiqua, EB Garamond, Grenze Gotisch — all Google Fonts / OFL, **free commercially**).
2. Convert with **<https://maplibre.org/font-maker/>** — browser app, drop in a TTF, get a ZIP of ranges. Maintained successor to fontnik.
3. Upload alongside the `.pmtiles`, point `glyphs` at your CDN, set `regular`/`bold`/`italic` on the flavor.

⚠️ Bake only the ranges you need (Latin 0–255 and 256–511 cover essentially everything for this app); a full CJK stack is hundreds of files. Also note the Protomaps `basemaps-assets` glyph CDN currently ships **only Noto Sans faces and has no licence file set on GitHub** — self-host, don't hotlink.

⚠️ **Decorative serifs often render poorly as SDF below ~12 px.** Budget time to test; consider keeping road labels in a plain serif and giving only city/region labels the fantasy face.

**CSS filters — a final grade, never the mechanism.** `filter: sepia(.35) contrast(1.08) saturate(.75)` on `.maplibregl-canvas` works and is GPU-composited. But: it filters **everything on that canvas, including your fog and route lines**; applied to a parent it also hits controls and attribution; and a full-viewport filter forces a whole-layer repaint every frame during pan, which on mobile is the difference between 60 and 40 fps. **Scope it to `.maplibregl-canvas` only, keep overlays as sibling DOM, and use it for the last 5% — get the colours right in the flavor object instead.**

### 6.5 Authoring tools

**Maputnik** is alive and moved under the MapLibre org: MIT, ~2.6k stars, last push 2026-08-28, **latest release v3.1.0 (2026-07-06)** — which added a full style code editor, hillshade colour arrays / `relief-color` elevation expressions, sprite-object support, and a globe/mercator toggle. Hosted at **<https://maplibre.org/maputnik/>** (and `maputnik.github.io` still resolves).

⚠️ **Maputnik does not support PMTiles.** Issue <https://github.com/maplibre/maputnik/issues/807> is still open (updated 2026-08-27). Workarounds: the community fork <https://github.com/syntaxtic/maputnik-with-pmtiles>, or — simpler — run `pmtiles serve` locally to front your archive as XYZ/TileJSON, point Maputnik at that, and ship the `pmtiles://` URL only in production.

Alternatives: **Charites** (<https://github.com/unvt/charites>) authors styles in YAML with a linter and live preview, and can reverse-convert existing `style.json` — much better than Maputnik for bulk find-replace of colour tokens and font names. **Expressive** (<https://github.com/falseinput/expressive>) is a DSL with variables and colour functions. MapTiler replaced their old Maputnik fork with an in-house **Customize** tool (proprietary, tied to their tiles). Mapbox Studio output needs `maplibregl-mapbox-request-transformer` — not worth the coupling.

**Honestly, your best tool is probably none of these.** Because Protomaps flavors are TypeScript objects, you author the palette in code and preview with hot reload. Reach for Maputnik only when you need to discover which layer is drawing something.

### 6.6 How style choice interacts with fog legibility

- **Keep basemap value (lightness) high and saturation moderate.** The fog is doing the darkening; if the basemap is already mid-dark, the fog has nowhere to go.
- **Labels should live *under* the fog layer** so unexplored place names stay hidden. That is most of the discovery feeling. (It also means your label colours only need to work against parchment, never against fog.)
- **Don't texture the fog and the parchment at the same spatial frequency** — the grain will beat against the mist noise and look like video compression. Parchment grain should be fine (~2–4 px); mist noise coarse (~150–300 px). The `q = uv * u_screen / 260.0` in §4.1 sets that.
- **Route colour must survive both backgrounds.** A warm cream core (`#fff2d0`) with an amber glow reads on parchment *and* against dark fog. Pure white blows out on parchment; pure red vanishes into it.

---

## 7. Extras

### 7.1 Offline and caching

The PMTiles-on-CloudFront design is unusually friendly here, because the tiles are **one immutable file**.

- **Set a long `Cache-Control` and version the filename.** `lost-soles-20260830.pmtiles` with `public, max-age=31536000, immutable`. Range responses are cached by CloudFront per range, so a returning user re-fetches almost nothing.
- **CloudFront caches ranges independently**, and may fetch a *larger* range than requested — which pre-warms neighbouring tiles for free.
- **A service worker can cache range responses** for genuinely offline use. This is where PMTiles beats every hosted provider: Thunderforest's ToS forbids pre-caching outright, and OSMF's policy forbids offline use entirely. With your own S3 file, caching is just caching.
- **Explored-cell data belongs in IndexedDB.** Store the compacted set as a `BigUint64Array` (8 bytes/cell — 500k cells = 4 MB), fetch deltas by `updated_since`, and rebuild the mask locally. Do **not** ship JSON hex strings (~2× the bytes and slow to parse).
- **Warn about the first load.** A 72 MB metro archive isn't downloaded up front — PMTiles only fetches the ranges for tiles in view — but the root directory read is a couple of round trips. Show the fog *before* the basemap resolves; a dark screen that gradually reveals a map is on-theme rather than a loading state.

### 7.2 Retina / hi-DPI

- **Cap `pixelRatio` at 2.** `new maplibregl.Map({ pixelRatio: Math.min(devicePixelRatio, 2) })`. A 3× phone gains essentially nothing on a soft mist effect and costs 2.25× the fragment work in your composite pass. This is the single cheapest mobile performance win available.
- **The mask FBO stays at 0.5× the drawing buffer** regardless. Its bilinear upsample contributes a free extra feather, which you want.
- **Ship `@2x` sprites** (`sprite.png` + `sprite@2x.png` and both JSONs) — MapLibre picks by device pixel ratio. Parchment grain especially needs this; a 1× grain upscaled looks like mud.
- **Glyph SDFs are resolution-independent**, so no `@2x` needed there.

### 7.3 Rendering a run's route attractively

Three stacked `line` layers on one source, drawn **above** the fog:

```js
map.addSource('runs', { type: 'geojson', data: runsFC, lineMetrics: true });

// 1. Outer glow — wide, heavily blurred, low opacity
map.addLayer({ id: 'run-glow-outer', type: 'line', source: 'runs',
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: { 'line-color': '#ff9d2e', 'line-width': 16,
           'line-blur': 14, 'line-opacity': 0.22 } });

// 2. Inner glow
map.addLayer({ id: 'run-glow-inner', type: 'line', source: 'runs',
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: { 'line-color': '#ffc46b', 'line-width': 7,
           'line-blur': 4, 'line-opacity': 0.55 } });

// 3. Core — thin, bright, crisp
map.addLayer({ id: 'run-core', type: 'line', source: 'runs',
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: {
    'line-color': '#fff2d0',
    'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 16, 3, 20, 5]
  }});
```

Notes and gotchas:

- **`line-blur` is the whole trick.** Stacked blurred lines are how you get a torch-lit trail without a shader.
- **`lineMetrics: true` is mandatory** if you want `line-gradient` (e.g. colour the trace by pace, elevation, or time-into-run). Set it on the *source*, not the layer.
- **`line-gradient` and `line-dasharray` cannot be combined** — <https://github.com/maplibre/maplibre-gl-js/issues/5082>. Pick one.
- **Use v6's new `line-layer-opacity`, not `line-opacity`,** where you want a whole translucent layer. `line-opacity` is per-feature and double-darkens wherever a route crosses itself — which for a runner's home loop is *constantly*. `line-layer-opacity` composites the layer once. This is exactly the artefact v6 added it to fix.
- **Animated "ant trail"** for a currently-recording run: set `line-dasharray` on a timer (MapLibre's "Animate a line" example). `line-dasharray` is not smoothly interpolatable, so you step it. <https://maplibre.org/maplibre-gl-js/docs/examples/animate-a-line/>
- **Simplify before uploading.** A 10 km run at 1 Hz is ~3,600 points; at map zoom 12 that's far more detail than pixels. Douglas-Peucker to ~2 m tolerance server-side, or store per-zoom simplifications. Keeps the GeoJSON small and the line crisp.
- **Consider `TripsLayer`** (deck.gl) if you later want animated route replay — a glowing head travelling the path with a fading tail. It is the one deck.gl feature genuinely worth taking the dependency for.
- **Optionally draw the route into the mask FBO** as a thick soft line so a freshly-uploaded run clears its own corridor instantly, before the H3 aggregation job has run.

---

## 8. Suggested build order

| Phase | Do | Why |
|---|---|---|
| **0** | MapLibre v6 + Stadia free tier + Dawarich-style Canvas2D `destination-out` fog (§3.4) | On screen in an afternoon. Validates the H3 pipeline and the interaction design before you write a shader. |
| **1** | Build the PMTiles extract, move to S3 + CloudFront, fork the Protomaps `light` flavor into parchment | Removes the vendor and the branding. Cost goes to ~zero. |
| **2** | Replace the Canvas2D fog with the custom WebGL2 layer (§4) | This is where it stops looking like a utility and starts looking like a game. |
| **3** | Bake the fantasy fontstack, add parchment sprite patterns, add terrarium hillshade with `igor` | The last 30% of the aesthetic. |
| **4** | Route glow layers, run replay, IndexedDB delta sync | Polish. |

## 9. Open questions to resolve during Phase 1

1. **Is `background-pattern` viewport- or world-anchored?** Determines the whole texture architecture. 5-minute test.
2. **Does a decorative serif hold up as SDF at 11–12 px on a phone?** If not, split the type system (fantasy face for cities/regions only).
3. **What H3 resolution actually feels right?** Res 11 (29 m edge) is the reasoned starting point, but this is a *feel* question — too fine and the map looks like static, too coarse and short runs reveal implausibly large territory. Make it a tunable constant.
4. **Does `blendEquation(gl.MAX)` behave on your target phones?** It's core WebGL2 so it should, but verify on an actual mid-range Android before committing.
5. **Battery cost of the animated mist.** Measure. If it's bad, animate only when the map is idle, or gate it behind a toggle alongside `prefers-reduced-motion`.

---

## 10. Sources

**Libraries and versions**
- npm registry (`registry.npmjs.org`) queried directly, 2026-08-30, for all version/licence/date figures
- <https://github.com/maplibre/maplibre-gl-js> · <https://github.com/maplibre/maplibre-gl-js/releases> · <https://github.com/maplibre/maplibre-gl-js/issues/6427>
- <https://geo.malagis.com/maplibre-gl-js-v6-mandatory-webgl-and-esm-only.html>
- <https://github.com/mapbox/mapbox-gl-js/blob/main/LICENSE.txt> · <https://github.com/mapbox/mapbox-gl-js/releases/tag/v2.0.0>
- <https://carto.com/blog/our-thoughts-as-mapboxgl-js-2-goes-proprietary/> · <https://wptavern.com/mapbox-gl-js-is-no-longer-open-source>
- <https://deck.gl/docs/developer-guide/base-maps/using-with-maplibre> · <https://deck.gl/docs/api-reference/mapbox/overview> · <https://deck.gl/docs/api-reference/extensions/mask-extension>

**Fog of war**
- <https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/>
- MapLibre source, read directly: `src/style/style_layer/custom_style_layer.ts`, `src/webgl/draw/draw_custom.ts`, `src/data/bucket/fill_bucket.ts`
- maplibre-style-spec source: `src/util/classify_rings.ts`
- <https://github.com/Freika/dawarich> — `app/javascript/maps_maplibre/layers/fog_layer.js`, `fog_hexagon_source.js`, `app/javascript/controllers/maps/maplibre/utils/h3_resolution.js`, `app/services/maps/fog_hexagons.rb`
- <https://dawarich.app/docs/features/map/> · <https://the5krunner.com/2026/03/25/kraina-strava-fog-of-war/>
- <https://h3geo.org/docs/core-library/restable/>
- <https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/filter> · <https://caniuse.com/mdn-api_canvasrenderingcontext2d_filter>

**Tiles and hosting**
- <https://maps.protomaps.com/builds/> · <https://build-metadata.protomaps.dev/builds.json>
- <https://docs.protomaps.com/basemaps/downloads> · <https://docs.protomaps.com/pmtiles/cli> · <https://docs.protomaps.com/pmtiles/cloud-storage> · <https://docs.protomaps.com/deploy/> · <https://docs.protomaps.com/deploy/aws>
- <https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md> · <https://github.com/protomaps/go-pmtiles/releases>
- <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RangeGETs.html>
- <https://aws.amazon.com/s3/pricing/> · <https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/> · <https://aws.amazon.com/about-aws/whats-new/2025/11/aws-flat-rate-pricing-plans/>
- <https://stadiamaps.com/pricing/> · <https://www.maptiler.com/cloud/pricing/> · <https://www.thunderforest.com/pricing/> · <https://www.thunderforest.com/terms/> · <https://www.jawg.io/en/pricing/> · <https://www.mapbox.com/pricing> · <https://docs.mapbox.com/help/dive-deeper/mapbox-in-maplibre/>
- <https://operations.osmfoundation.org/policies/tiles/>

**Style**
- <https://docs.protomaps.com/basemaps/flavors> · <https://docs.protomaps.com/basemaps/maplibre> · <https://github.com/protomaps/basemaps> · <https://github.com/protomaps/basemaps-assets>
- <https://github.com/pnorman/maplibre-styles> (style/code licence matrix)
- <https://github.com/OpenHistoricalMap/map-styles> (CC0) · <https://openhistoricalmap.github.io/map-styles/>
- <https://maplibre.org/maputnik/> · <https://github.com/maplibre/maputnik> · <https://github.com/maplibre/maputnik/issues/807>
- <https://github.com/unvt/charites> · <https://maplibre.org/font-maker/>
- <https://maplibre.org/maplibre-style-spec/sprite/> · <https://maplibre.org/maplibre-style-spec/glyphs/>
- <https://maplibre.org/roadmap/maplibre-gl-js/blending-modes/> · <https://oliverwipfli.ch/canvas-multiply-blending-2025-11-24/>
- <https://registry.opendata.aws/terrain-tiles/> · <https://github.com/tilezen/joerd/blob/master/docs/attribution.md>
- <https://www.viking2917.com/historical-maps-with-maplibre-and-open-historical-maps/> · <https://adventuresinmapping.com/2018/09/10/middle-earth-map-style/>
- <https://docs.stadiamaps.com/map-styles/stamen-watercolor/> (⚠ commercial use restricted)

**Route rendering**
- <https://maplibre.org/maplibre-gl-js/docs/examples/create-a-gradient-line-using-an-expression/> · <https://maplibre.org/maplibre-gl-js/docs/examples/animate-a-line/> · <https://github.com/maplibre/maplibre-gl-js/issues/5082>
