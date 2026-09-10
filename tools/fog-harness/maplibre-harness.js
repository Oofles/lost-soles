// Ticket 0055 — the half `harness.js` cannot prove: a real `maplibre-gl` Map, the real
// `FogMaskLayer`, and MapLibre's OWN `shaderData.vertexShaderPrelude` compiling against this
// ticket's attribute names inside the real `prerender` hook.
//
// `harness.js` substitutes `STUB_PRELUDE`, so it proves the rasterisation and nothing about
// MapLibre's shader plumbing. A prelude mismatch — a redeclared uniform, an attribute name the
// linker drops, a `#define` that changes what compiles — would sail past it and reach the operator
// as "the fog just isn't there", with no error anywhere.
//
// Bundled by run-maplibre.mjs, which is why this one CAN import.
import { gridDisk, latLngToCell } from "h3-js"
import * as maplibre from "maplibre-gl"

import { packBucket } from "../../lib/fog/instances.ts"
import { FogMaskLayer } from "../../lib/fog/mask-layer.ts"
import { restoreOk } from "../../lib/fog/mask.ts"

/**
 * POINT NEMO. D-199 — this repository is public and a committed coordinate near where the operator
 * runs is the leak `check-fixture-geography.mjs` exists to prevent. Nothing here needs a basemap, so
 * an ocean is as good a place to stand as any.
 */
const NEMO = { lat: -48.876, lng: -123.393 }

const fail = []
const notes = []
let preludeSeen = null
const rebuilds = []
let prerenderCalls = 0
let renderCalls = 0

/**
 * The shipped layer, subclassed only to record what MapLibre actually handed it. Subclassing rather
 * than reimplementing is the point: if this file built its own layer it would prove that A layer
 * works, not that the one `map-shell.tsx` installs does.
 */
class ObservedLayer extends FogMaskLayer {
  render(gl) {
    renderCalls++
    super.render(gl)
  }

  prerender(gl, options) {
    if (!preludeSeen) {
      const { variantName, vertexShaderPrelude, define } = options.shaderData
      preludeSeen = {
        variantName,
        bytes: vertexShaderPrelude.length,
        define,
        declaresProjectTile: /vec4\s+projectTile\s*\(/.test(vertexShaderPrelude),
      }
    }
    prerenderCalls++
    super.prerender(gl, options)
  }
}

// A style with no sources AND NO LAYERS. The basemap is irrelevant to whether `prerender` fires, and
// a headless run has no business fetching a 1.1 GB pmtiles archive over CloudFront. No background
// layer either — it would need a colour, and a raw hex here fails check-design-tokens.mjs,
// correctly. (It did, in 0118. See ticket 0190.)
const map = new maplibre.Map({
  container: "map",
  style: { version: 8, sources: {}, layers: [] },
  center: [NEMO.lng, NEMO.lat],
  zoom: 15,
  attributionControl: false,
})

// 1,951 real res-10 cells around the centre — the order of magnitude §6.2 expects on screen at a
// running zoom, packed by the SHIPPED packer rather than by invented points, and enough that a
// broken `vertexAttribDivisor` would render one disc instead of a field.
const bucket = packBucket(gridDisk(latLngToCell(NEMO.lat, NEMO.lng, 10), 25))

let layer = new ObservedLayer({ debug: true, onRebuild: (s) => rebuilds.push(s) })

map.on("load", () => {
  map.addLayer(layer)
  layer.setBucket(bucket)
  map.triggerRepaint()
})

/**
 * INSTALLED, REMOVED, RE-INSTALLED. Criterion 4 is about the state the SECOND install inherits, and
 * `onRemove` freeing GPU resources while the context lives on is where a custom layer is most likely
 * to take the whole context down with it. `0118` ran the same A/B for the same reason.
 */
map.once("idle", () => {
  try {
    map.removeLayer(layer.id)
    map.redraw()
    layer = new ObservedLayer({ debug: true, onRebuild: (s) => rebuilds.push(s) })
    map.addLayer(layer)
    layer.setBucket(bucket)
    // `redraw()`, NOT `triggerRepaint()` plus a timer. Under Chromium's
    // `--virtual-time-budget` a setTimeout advances the virtual clock immediately, so a
    // deferred repaint is reported on before any frame has actually been drawn — which reads
    // as "prerender never ran" and is a property of the harness, not of the layer. `redraw()`
    // renders synchronously and takes the ambiguity out.
    map.redraw()
    map.redraw()
  } catch (error) {
    fail.push(`remove + re-add threw: ${error.message}`)
  }
  report()
})

function report() {
  const stats = layer.stats()

  if (!preludeSeen) fail.push("MapLibre's shaderData never reached prerender")
  else if (!preludeSeen.declaresProjectTile) {
    fail.push(`the prelude MapLibre supplied does not define projectTile: ${JSON.stringify(preludeSeen)}`)
  }
  if (stats.shaderError) {
    fail.push(`the mask shader did not compile against MapLibre's real prelude: ${stats.shaderError}`)
  }
  if (stats.passes === 0) fail.push("prerender never ran the mask pass")
  if (stats.visibleInstanceCount !== bucket.count) {
    fail.push(`visibleInstanceCount=${stats.visibleInstanceCount}, expected ${bucket.count}`)
  }
  if (!stats.restore || !restoreOk(stats.restore)) {
    fail.push(`state not restored: ${JSON.stringify(stats.restore)}`)
  }
  if (rebuilds.length !== 2) {
    fail.push(`expected one instance-buffer rebuild per install, got ${rebuilds.length}`)
  }
  // The map's own context, reached the public way: getContext returns the existing one.
  const glError = map.getCanvas().getContext("webgl2").getError()
  if (glError !== 0) fail.push(`gl.getError() = 0x${glError.toString(16)} after the A/B`)

  const head = fail.length === 0 ? "MAPLIBRE HARNESS PASS" : `MAPLIBRE HARNESS FAIL (${fail.length})`
  document.title = head
  document.getElementById("out").textContent = [
    head,
    ...fail.map((f) => `  x ${f}`),
    "",
    `maplibre       ${maplibre.getVersion()}`,
    `prelude        variant=${preludeSeen?.variantName} ${preludeSeen?.bytes} bytes, ` +
      `define=${JSON.stringify(preludeSeen?.define)}, projectTile=${preludeSeen?.declaresProjectTile}`,
    `instances      ${stats.visibleInstanceCount} at res ${stats.res}, one drawArraysInstanced each frame`,
    `mask           ${stats.maskSize} (half the drawing buffer)`,
    `passes         ${stats.passes} prerender frames across the remove/re-add`,
    `rebuilds       ${rebuilds.length} instance-buffer uploads (one per install)`,
    `restored       ${JSON.stringify(stats.restore)}`,
    `gl.getError    0x${glError.toString(16)}`,
    `hook calls    prerender=${prerenderCalls} render=${renderCalls}`,
    ...notes,
  ].join("\n")
}
