# `tools/fog-harness` — the mask pass, on a real GPU

Tickets `0055` and `0058`. `05-fog-of-war.md` §4.1, §4.2, §6.2.

```
node tools/fog-harness/run.mjs            # the mask shader on a real GPU
node tools/fog-harness/run-maplibre.mjs   # the same layer inside a real MapLibre Map
node tools/fog-harness/run-cull.mjs       # the zoom buckets and the cull, driven by a real camera
node tools/fog-harness/run-mode-swap.mjs  # 0098: atlas/adventure swaps keep the camera and every layer
                                          # 0099: ... and the coverage mask, bit for bit
node tools/fog-harness/mode-parity-shots.mjs # 0099: ghost grid + street-name contrast, real tiles
node tools/fog-harness/run-map-controls.mjs # 0101: no rotate or tilt, the zoom rubber band, route opacities
node tools/fog-harness/run-cold-cost.mjs  # 0298: atlas's cold pass vs cold weight 0, HEADED on the real GPU
```

**`run-cold-cost.mjs`** (ticket `0298`) is the one runner here that is **headed and on a real
clock**. It answers a frame-time question, and neither `--virtual-time-budget` nor SwiftShader can.
It opens `cold-cost-harness.js` in a real window. On WSL2 that is WSLg with `GALLIUM_DRIVER=d3d12`,
which the runner sets. It drives the shipped `PATH` with the cold pass on, then off, then a copy-only
arm. The figures come back over DevTools. If the renderer string is software, it exits 2 and prints
no figure. `MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA` picks a discrete card over an iGPU. The results
are in `docs/capabilities/18-mvp-hardening.md`.

**`run-map-controls.mjs`** (ticket `0101`) builds a real Map with the shipped `MAP_INPUT_OPTIONS`
and drives it with real DOM events. A right-drag and a Ctrl-drag must leave `getBearing()` and
`getPitch()` at 0, and the same events must rotate a control Map built on MapLibre's defaults, which
proves the events count as real input. A wheel over-zoom past z18 and past z10 must overshoot and
then settle back inside [10, 18] through the shipped `settleZoom`. In both variants the route must
be topmost above the fog, with the glow at 0.35 in adventure and 0 in atlas, and the trace web must
sit at the run page's settled k. Frames are pumped with `redraw()` rather than awaited on
`requestAnimationFrame`: under a virtual-time budget headless Chromium hands out rAF unreliably. On
WSL, pass `CHROMIUM=/snap/bin/chromium`.

**`run-mode-swap.mjs`** (ticket `0098`) builds a real Map on the shipped `basemapStyle`, adds the trace
web, landmarks, the shipped `FogMaskLayer` and the route through the app's own helpers, then swaps the
variant twelve times at three zooms with `swapBasemap`. It fails if any of centre, zoom, bearing or
pitch differs by a single bit across a swap, if MapLibre falls back to rebuilding the style from
scratch (which drops every app layer), or if any layer leaves its D-368 slot. No tiles are fetched;
a diff is about the style, not the tiles.

Since `0099` it also proves **mask parity** (05 §5.4). A real `ExploredSet` → `ZoomBucketStore` →
`FogViewportController` feeds the fog. At each of the three zooms the harness shows adventure,
atlas, an atlas/adventure mid-fade palette, and adventure again, each through `swapBasemap` +
`setPalette`. It redraws the mask fresh in each mode, which the pass count confirms. It then reads
the mask FBO's texture back and requires every byte to match. The sabotage: a ⅛-mask-pixel camera
move must change the mask. A mask that is all revealed or all fogged fails as trivial.

**`run.mjs`** compiles `lib/fog/mask.ts` **alone** — which is why that module has zero imports —
inlines it into one `file://` page with `harness.js`, and runs it in headless Chromium. Exit 0 on
`HARNESS PASS`.

**`run-maplibre.mjs`** bundles a real `maplibre-gl` Map plus the shipped `FogMaskLayer` and proves
the one thing the first cannot: that the mask shader compiles against MapLibre's **own**
`shaderData.vertexShaderPrelude` inside the real `prerender`, that `visibleInstanceCount` matches the
bucket, and that GL state survives a remove-and-re-add of the layer. `run.mjs` substitutes
`STUB_PRELUDE`, so a prelude mismatch — a redeclared uniform, a dropped attribute — would sail past it
and reach the operator as "the fog just isn't there", with no error anywhere.

It uses `map.redraw()` rather than `triggerRepaint()` plus a timer, and that is not a style choice:
under Chromium's `--virtual-time-budget` a `setTimeout` advances the virtual clock immediately, so a
deferred repaint gets reported on before any frame has been drawn. That reads as "prerender never
ran" and is a property of the harness, not of the layer. It cost a debugging round here; it is
written down so it does not cost another.

**`run-cull.mjs`** (ticket `0058`) bundles a real Map plus the shipped `ZoomBucketStore`,
`FogViewportController` and `FogMaskLayer`, attaches the controller to real `move`/`zoom` events, and
drives a scripted path: a small pan inside the padded region, one that leaves it, then z17 down to z5.
It proves what `viewport-controller.test.ts` cannot — that test drives a **fake** map whose
`getBounds()` this repository wrote, so a flipped mercator y or a west/east swap would pass it and put
the fog somewhere else. So the harness checks the geometry directly: that a survivor disc actually
covers the camera position at the centre of a 2 km explored disc, that survivors lie within the padded
box MapLibre's own bounds produced, that the resolution at each zoom matches `ZOOM_TO_RES`, that the
instance count stays bounded by the screen, and that no bucket ever derives to zero instances.

It does **not** read pixels, and that is a finding rather than an omission: `readPixels` on the default
framebuffer after `map.redraw()` returns all zeroes under headless SwiftShader, with or without
`preserveDrawingBuffer`. `run.mjs` proves the mask's pixels against its own FBO and `run-maplibre.mjs`
proves the composite runs inside MapLibre's frame; the geometry is what `0058` changed.

## Why this exists alongside `lib/fog/mask.test.ts`

The vitest suite drives a recording fake context. It proves the **calls**: `gl.MAX` is set, GL state
is restored, there is exactly one `drawArraysInstanced` whatever the cell count. It cannot prove a
single pixel, and three of this ticket's claims are entirely about pixels:

| | claim | criterion |
|---|---|---|
| **T1** | `a_fraction` multiplies coverage — a 25% parent reads 64, not 255 | 8 |
| **T2** | overlapping discs union rather than sum or overwrite | §4.1 |
| **T3** | neighbours at `revealScale = 1.35` merge with no scalloping notch | 6 |

**Every probe has a sabotage case**, and that is not decoration — it is `0118`'s finding. T2 measures
one pixel whose value differs under all three blend behaviours (`153` unioned, `228` summed, `75`
overwritten), and the harness produces the other two on purpose by forcing `FUNC_ADD` and by
disabling blending. T3 is re-measured at `revealScale = 1.15`, R4's stated lower bound, where the
seam must visibly collapse. A probe that can only report success is a decoration.

## What it does not prove

SwiftShader is a real rasteriser, not a real phone GPU. **Qualcomm/Mali ANGLE honouring `MIN`/`MAX`
into a single-channel normalised target remains unverified** — D-230 records the operator's decision
to accept that, and `0059` owns the device.

## Not part of `npm test`

It needs a browser and a GPU; the GitHub gate and the Amplify container have neither, and a suite
that fails on a missing binary is a suite people learn to ignore. Run it by hand whenever the mask
shader or the blend state changes, and paste its output into the ticket.

Set `CHROMIUM` to override the browser path (default `/usr/bin/chromium-browser`).

## `tune.mjs` — the fog over the real basemap, as screenshots (ticket `0119`)

```
node tools/fog-harness/tune.mjs [variants.json] [--zoom 16] [--dpr 1] [--out tmp/0119]
```

Unlike the harnesses above, this one has no probes and no pass/fail. It renders the stock Protomaps
style from the real CloudFront archive, labels included, then the shipped `FogMaskLayer` with a
palette under test, then the route, all over a synthetic loop through downtown Orlando. It writes
one PNG per variant. `variants.json` maps names to overrides on `V1`, and `null` means no fog layer:
the legibility baseline. It exists for taste work (`0119`, capability 15), where the question is
whether it looks right and not whether a number matches.

Since `0210` a variant may also carry `"_basemap"` (`atlas` or `adventure`, the style variant;
default adventure), `"_base"` (the `FOG_MODES` palette its overrides apply to; default `V1`) and
`"_off": true` (no fog, on the chosen basemap). `--dpr 2` captures at device scale 2.

Three things differ from the other harnesses, and each cost a round to find:

- **It is driven over the DevTools protocol, in real time.** `--screenshot` with
  `--virtual-time-budget` never finishes loading this style, because sprite and glyph decoding
  stalls under virtual time. `load` never fires, and every capture is the flat `#cccccc` background.
- **It is served from a throwaway `127.0.0.1` server**, because a `file://` page gets no tiles from
  MapLibre's module worker. The worker is bundled into one file and handed over as a `blob:` URL.
- **The bundle and config are separate `<script src>` files**, not inline. A 2 MB bundle inlined
  into HTML contains `<!--` and `<script` sequences that knock the tokenizer into script-escaped
  states, and nothing runs.

Only commit screenshots of the synthetic loop, never of the operator's own cells (D-199).

## `mode-parity-shots.mjs` — the ghost grid and street-name contrast, measured (ticket `0099`)

```
node tools/fog-harness/mode-parity-shots.mjs [--out tmp/0099] [--reuse]
```

This drives `tune.mjs` at z15 and z16, using the five `0099` variant keys (`_swapFrom`, `_cells`,
`_muteLabels`, `_bareLabels`, `_noSymbols`, documented in `tune.mjs`'s header). It decodes the PNGs
with `pngjs` and measures them:

- **The ghost grid.** Nothing is explored and no labels are drawn. The measure is road-minus-ground
  luminance (high-passed) at atlas, adventure, the 0.94 ceiling and a 1.0 sabotage. It fails if the
  shipped or ceiling Δ is under 1 grey level, or if the sabotage is not ≈ 0.
- **Street-name contrast.** Each mode is measured over no fog, all-revealed and all-unexplored
  ground. It fails if revealed ground reads differently from the stock map in either mode, or if
  atlas loses its street names over unexplored ground.
- **The two screenshots** for the capability doc: one per mode at z16, each reached through the swap.

`--reuse` re-measures the PNGs already in `--out` without the network. The numbers are recorded in
`docs/capabilities/15-two-map-modes-and-cold-territory.md`.
