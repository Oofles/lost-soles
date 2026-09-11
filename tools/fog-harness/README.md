# `tools/fog-harness` — the mask pass, on a real GPU

Tickets `0055` and `0058`. `05-fog-of-war.md` §4.1, §4.2, §6.2.

```
node tools/fog-harness/run.mjs            # the mask shader on a real GPU
node tools/fog-harness/run-maplibre.mjs   # the same layer inside a real MapLibre Map
node tools/fog-harness/run-cull.mjs       # the zoom buckets and the cull, driven by a real camera
```

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
