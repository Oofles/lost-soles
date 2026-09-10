# `tools/fog-harness` — the mask pass, on a real GPU

Ticket `0055`. `05-fog-of-war.md` §4.1, §4.2.

```
node tools/fog-harness/run.mjs            # the mask shader on a real GPU
node tools/fog-harness/run-maplibre.mjs   # the same layer inside a real MapLibre Map
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
