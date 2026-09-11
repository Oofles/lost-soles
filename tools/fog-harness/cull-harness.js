// Ticket 0058 — the half the unit tests cannot prove: a real `maplibre-gl` Map, a real
// `ZoomBucketStore`, a real `FogViewportController` attached to real `move`/`zoom` events, and the
// pixels that come out the other end.
//
// `viewport-controller.test.ts` drives a FAKE map whose `getBounds()` this file wrote. That proves the
// controller's logic and nothing about whether MapLibre's own bounds, in MapLibre's own zoom units,
// land the fog on the ground the cells describe. A flipped mercator y or a west/east swap would pass
// every unit test in the suite and reach the operator as "the fog is in the wrong place", or as an
// empty screen, with no error anywhere.
//
// Bundled by run-cull.mjs, which is why this one CAN import.
import { gridDisk, latLngToCell } from "h3-js"
import * as maplibre from "maplibre-gl"

import { RES } from "../../src/domain/fog.ts"
import { cellToBig } from "../../src/domain/explored-blob.ts"
import { boxContains, boxFromLngLat, padBox } from "../../lib/fog/cull.ts"
import { ExploredSet } from "../../lib/fog/explored-set.ts"
import { mercatorX, mercatorY } from "../../lib/fog/instances.ts"
import { FogMaskLayer } from "../../lib/fog/mask-layer.ts"
import { INSTANCE_FLOATS, restoreOk } from "../../lib/fog/mask.ts"
import { FogViewportController } from "../../lib/fog/viewport-controller.ts"
import { resForZoom, ZoomBucketStore } from "../../lib/fog/zoom-buckets.ts"

/**
 * POINT NEMO. D-199 — this repository is public and a committed coordinate near where the operator
 * runs is the leak `check-fixture-geography.mjs` exists to prevent. Nothing here needs a basemap, so
 * an ocean is as good a place to stand as any.
 */
const NEMO = { lat: -48.876, lng: -123.393 }
const WIDTH = 1280
const HEIGHT = 800

const fail = []
const notes = []
const uploads = []
const samples = []

/** 4,921 real res-11 cells — a 2 km disc, so the screen centre is solidly explored at z15. */
const cells = gridDisk(latLngToCell(NEMO.lat, NEMO.lng, RES), 40)
  .map(cellToBig)
  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
const set = ExploredSet.fromCells(BigUint64Array.from(cells), 1)
const store = new ZoomBucketStore(set)

const map = new maplibre.Map({
  container: "map",
  style: { version: 8, sources: {}, layers: [] },
  center: [NEMO.lng, NEMO.lat],
  zoom: 15,
  attributionControl: false,
})

const layer = new FogMaskLayer({ timeSource: () => 3.25 })
/** A copy of the first upload's survivors, for the position check below. */
let firstSurvivors = null
const controller = new FogViewportController({
  map,
  store,
  // `debounceMs: 0` — the debounce is `viewport-controller.test.ts`'s subject, driven by an injected
  // clock. Here it would only mean a scripted camera move whose rebuild lands after the report.
  debounceMs: 0,
  onInstances: (instances, result, res) => {
    uploads.push({ count: result.count, res, groups: `${result.groupsKept}/${result.groupsTested}` })
    if (!firstSurvivors) firstSurvivors = Float32Array.from(instances)
    layer.setInstances(instances, res)
  },
})

/** MapLibre's own bounds, through the same conversion `viewport-controller.ts` uses. */
function liveBox() {
  const bounds = map.getBounds()
  return boxFromLngLat(
    bounds.getWest(),
    bounds.getSouth(),
    bounds.getEast(),
    bounds.getNorth(),
    (lng, lat) => ({ x: mercatorX(lng), y: mercatorY(lat) }),
  )
}

map.on("load", () => {
  map.addLayer(layer)
  controller.start()
  map.redraw()
  report()
})

function report() {
  /* ─── 1. The fog is where the cells are ─────────────────────────────────── */

  /**
   * NOT A PIXEL CHECK, AND THAT IS WORTH RECORDING SO NOBODY SPENDS THE HOUR AGAIN. `readPixels` on
   * the default framebuffer after `map.redraw()` returns all zeroes under headless SwiftShader, with
   * or without `preserveDrawingBuffer` — MapLibre does not leave its own result readable there.
   * `harness.js` proves the mask's PIXELS against its own FBO and `run-maplibre.mjs` proves the
   * composite runs inside MapLibre's frame, so what is missing, and what this ticket actually changed,
   * is the geometry: MapLibre's bounds, in MapLibre's zoom units, through the cull, to a set of
   * mercator positions. That is checked directly below and it is a stronger check than a luminance
   * comparison, because it names the number that would be wrong.
   */
  const box = liveBox()
  const padded = padBox(box)
  const centre = { x: mercatorX(map.getCenter().lng), y: mercatorY(map.getCenter().lat) }

  let coveringCentre = 0
  let outsidePadded = 0
  for (let i = 0; i < firstSurvivors.length; i += INSTANCE_FLOATS) {
    const x = firstSurvivors[i]
    const y = firstSurvivors[i + 1]
    const r = firstSurvivors[i + 2]
    const dx = x - centre.x
    const dy = y - centre.y
    if (dx * dx + dy * dy <= r * r) coveringCentre++
    if (!boxContains(padded, { minX: x - r, minY: y - r, maxX: x + r, maxY: y + r })) outsidePadded++
  }

  /**
   * The camera sits in the middle of a 2 km explored disc, so discs must cover the screen centre. A
   * flipped mercator y or a west/east swap gives instances — the count would look right — and puts
   * them somewhere else entirely, which is the failure that would otherwise reach the operator as
   * "the fog is in the wrong place".
   */
  if (coveringCentre === 0) {
    fail.push(
      `no survivor covers the camera position: the cull returned ` +
        `${firstSurvivors.length / INSTANCE_FLOATS} discs and none of them is on the ground under ` +
        `the centre of the screen`,
    )
  }
  /** And step 2 kept nothing it should have rejected, measured against MapLibre's own bounds. */
  const kept = firstSurvivors.length / INSTANCE_FLOATS
  if (outsidePadded > kept * 0.35) {
    fail.push(`${outsidePadded} of ${kept} survivors are wholly outside the padded viewport`)
  }
  notes.push(
    `geometry       ${coveringCentre} discs cover the camera, ` +
      `${outsidePadded}/${kept} wholly outside the padded box (whole-group copies)`,
  )
  notes.push(
    `bounds         maplibre gave x ${box.minX.toFixed(6)}..${box.maxX.toFixed(6)} ` +
      `y ${box.minY.toFixed(6)}..${box.maxY.toFixed(6)}`,
  )

  /* ─── 2. The scripted camera path ───────────────────────────────────────── */

  const startUploads = uploads.length
  // A small pan, well inside the 20% padded region: §6.2's "small pans cost zero CPU".
  const degreesPerViewport = (WIDTH / (512 * 2 ** 15)) * 360
  map.jumpTo({ center: [NEMO.lng + degreesPerViewport * 0.02, NEMO.lat], zoom: 15 })
  map.redraw()
  if (uploads.length !== startUploads) {
    fail.push(`a pan inside the padded region rebuilt the buffer ${uploads.length - startUploads} times`)
  }

  // And one that leaves it.
  map.jumpTo({ center: [NEMO.lng + degreesPerViewport * 0.6, NEMO.lat], zoom: 15 })
  map.redraw()
  if (uploads.length !== startUploads + 1) {
    fail.push(
      `leaving the padded region rebuilt the buffer ${uploads.length - startUploads} times, expected 1`,
    )
  }

  // z17 down to z5, sampling the instance count and the resolution at every integer zoom.
  for (let zoom = 17; zoom >= 5; zoom--) {
    map.jumpTo({ center: [NEMO.lng, NEMO.lat], zoom })
    map.redraw()
    const stats = layer.stats()
    samples.push({ zoom, res: stats.res, instances: stats.visibleInstanceCount })
    if (stats.res !== resForZoom(zoom)) {
      fail.push(`at z${zoom} the layer drew res ${stats.res}, the table says ${resForZoom(zoom)}`)
    }
    /**
     * §6.4 item 1's ceiling is stated for a 400×800 phone viewport and this canvas is 1280×800, which
     * is 3.2× the area — so the bound checked here is the area-scaled one. The point is that it is
     * bounded by the SCREEN at all: an uncalled cull would put 4,921 cells and their bridges on every
     * sample, including the ones where a cell is a tenth of a pixel.
     */
    if (stats.visibleInstanceCount > 19_200) {
      fail.push(`z${zoom}: ${stats.visibleInstanceCount} instances, over the area-scaled ceiling`)
    }
  }

  /* ─── 3. Nothing broke on the way ───────────────────────────────────────── */

  const stats = layer.stats()
  if (stats.shaderError) fail.push(`mask shader: ${stats.shaderError}`)
  if (stats.compositeError) fail.push(`composite shader: ${stats.compositeError}`)
  if (stats.passes === 0) fail.push("prerender never ran the mask pass")
  if (stats.composites === 0) fail.push("render never ran the composite pass")
  if (!stats.restore || !restoreOk(stats.restore)) {
    fail.push(`state not restored: ${JSON.stringify(stats.restore)}`)
  }
  if (uploads.length < 3) fail.push(`only ${uploads.length} rebuilds across the whole path`)

  /**
   * THE ZOOM-OUT MUST NEVER DRAW NOTHING. §6.1's coarse buckets exist so a zoomed-out map still shows
   * the territory; a bucket that derived to zero instances is a map that goes blank at a boundary,
   * which is the first thing the operator is asked to look for.
   */
  const empty = samples.filter((sample) => sample.instances === 0)
  if (empty.length > 0) {
    fail.push(`the fog vanished at ${empty.map((s) => `z${s.zoom}`).join(", ")}`)
  }

  const glError = map.getCanvas().getContext("webgl2").getError()
  if (glError !== 0) fail.push(`gl.getError() = 0x${glError.toString(16)}`)

  const head = fail.length === 0 ? "CULL HARNESS PASS" : `CULL HARNESS FAIL (${fail.length})`
  document.title = head
  document.getElementById("out").textContent = [
    head,
    ...fail.map((f) => `  x ${f}`),
    "",
    `maplibre       ${maplibre.getVersion()}`,
    `set            ${set.size.toLocaleString()} res-${RES} cells, ${store.cachedResolutions.length} buckets cached`,
    `canvas         ${WIDTH}x${HEIGHT} CSS px, mask ${stats.maskSize}`,
    ...notes,
    `rebuilds       ${uploads.length}`,
    ...uploads.map((u, i) => `  ${String(i).padStart(2)}          res ${u.res}, ${u.count} instances, groups ${u.groups}`),
    "scripted path  zoom  res  instances",
    ...samples.map((s) => `                ${String(s.zoom).padStart(4)}  ${String(s.res).padStart(3)}  ${String(s.instances).padStart(9)}`),
    `derivations    ${store.indexDerivations} bucket indexes, ${store.groupDerivations} group geometries`,
    `passes         ${stats.passes} mask passes, ${stats.composites} composites`,
    `restored       ${JSON.stringify(stats.restore)}`,
    `gl.getError    0x${glError.toString(16)}`,
  ].join("\n")
}
