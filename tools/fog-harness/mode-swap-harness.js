// Ticket 0098 — the atlas/adventure toggle on a REAL MapLibre Map. Bundled by run-mode-swap.mjs.
//
// What `lib/basemap-swap.test.ts` cannot prove, because it replays MapLibre's style diff over a list:
//
//   - the camera — centre, zoom, bearing, pitch — is BYTE-IDENTICAL across a swap, at three zooms
//     (criterion 2), read from `Map` itself after a synchronous redraw;
//   - the real `Style.setState` takes the diff without throwing (a throw makes MapLibre rebuild the
//     whole style, which drops every app layer — the failure this harness exists to catch);
//   - the shipped `FogMaskLayer` (a custom layer no serialisation contains) is still in the real
//     layer order, where `fogBeforeId` says, and still compositing, after ten swaps.
//
// Ticket 0099 adds the half that IS that ticket: the COVERAGE MASK — the offscreen buffer that decides
// what is revealed — read back byte for byte in each mode at three zooms, through the real swap
// (`swapBasemap` + `setPalette`, as `map-shell.tsx` does it), and required to be bit-identical. A mode
// value reaching mask generation would show up here as a differing byte. Every comparison has a
// sabotage: a sub-pixel camera move must produce a differing mask, so "identical" is a measurement
// and not a comparator that cannot see.
//
// The basemap's tiles are never fetched (no pmtiles protocol is registered, and a headless run has
// no business pulling the archive). The STYLE is the shipped one, `basemapStyle(variant)`, which is
// what the swap diffs; tiles are not part of a diff.
import { gridDisk, latLngToCell } from "h3-js"
import * as maplibre from "maplibre-gl"

import { BASEMAP_SOURCE, basemapStyle, swapBasemap } from "../../lib/basemap.ts"
import { ExploredSet } from "../../lib/fog/explored-set.ts"
import { FOG_MODES, lerpPalette } from "../../lib/fog/fog-uniforms.ts"
import { FogViewportController } from "../../lib/fog/viewport-controller.ts"
import { resForZoom, ZoomBucketStore } from "../../lib/fog/zoom-buckets.ts"
import { cellToBig } from "../../src/domain/explored-blob.ts"
import { RES } from "../../src/domain/fog.ts"
import { FogMaskLayer } from "../../lib/fog/mask-layer.ts"
import { LastRunDays, todayDay } from "../../lib/fog/last-run.ts"
import { landmarkLayerSpec } from "../../lib/landmarks/markers.ts"
import {
  FOG_LAYER_ID,
  LANDMARK_LAYER_ID,
  RUN_CORE_ID,
  RUN_GLOW_ID,
  fogBeforeId,
  fogSplitsBasemap,
  landmarkBeforeId,
  landmarksBetweenFogAndRoute,
  routeIsAboveFog,
  setRunGeometry,
} from "../../lib/map-layers.ts"
import { TRACE_LAYER_ID, setTraceWeb, traceIsBetweenBasemapAndRoute } from "../../lib/trace-web/layer.ts"

/** POINT NEMO, as `maplibre-harness.js` — D-199: no committed coordinate near where anyone runs. */
const NEMO = { lat: -48.876123456789, lng: -123.393987654321 }
const ZOOMS = [12, 15.25, 17.75]

const fail = []
const notes = []
const swapWarnings = []
const origWarn = console.warn
console.warn = (...args) => {
  if (String(args[0]).includes("style diff")) swapWarnings.push(String(args[0]))
  origWarn(...args)
}

const map = new maplibre.Map({
  container: "map",
  style: basemapStyle("adventure"),
  center: [NEMO.lng, NEMO.lat],
  zoom: 15,
  attributionControl: false,
})
const fog = new FogMaskLayer({ timeSource: () => 3.25 })
const EMPTY = { type: "FeatureCollection", features: [] }
const line = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [[NEMO.lng, NEMO.lat], [NEMO.lng + 0.01, NEMO.lat + 0.005]] },
    },
  ],
}

function camera() {
  const c = map.getCenter()
  return { lng: c.lng, lat: c.lat, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }
}

function order() {
  return map.getLayersOrder().map((id) => {
    const l = map.getLayer(id)
    return { id, type: l.type, source: l.source, metadata: l.metadata }
  })
}

function check(label, variant) {
  const layers = order()
  const ids = layers.map((l) => l.id)
  for (const id of [FOG_LAYER_ID, TRACE_LAYER_ID, LANDMARK_LAYER_ID, RUN_GLOW_ID, RUN_CORE_ID]) {
    if (ids.filter((x) => x === id).length !== 1) fail.push(`${label}: ${id} is not in the layer order exactly once`)
  }
  if (!fogSplitsBasemap(layers, BASEMAP_SOURCE)) fail.push(`${label}: the fog does not split the ${variant} basemap as D-368 says`)
  if (!routeIsAboveFog(layers)) fail.push(`${label}: the route is not above the fog`)
  if (!landmarksBetweenFogAndRoute(layers)) fail.push(`${label}: the landmarks are not between the fog and the route`)
  if (!traceIsBetweenBasemapAndRoute(layers)) fail.push(`${label}: the trace web left its slot`)
  const traceAbove = ids.indexOf(TRACE_LAYER_ID) > ids.indexOf(FOG_LAYER_ID)
  if (traceAbove !== (variant === "atlas")) fail.push(`${label}: trace web ${traceAbove ? "above" : "below"} the fog in ${variant}`)
}

map.once("style.load", () => {
  try {
    setTraceWeb(map, line, "rgb(85, 102, 119)")
    map.addSource("landmarks", { type: "geojson", data: EMPTY })
    map.addLayer(landmarkLayerSpec(), landmarkBeforeId(map))
    map.addLayer(fog, fogBeforeId(map))
    setRunGeometry(map, line, { glow: "rgb(170, 136, 68)", core: "rgb(255, 238, 204)" })
    map.redraw()
    check("built (adventure)", "adventure")

    const before = fog.stats().composites
    let variant = "adventure"
    let swaps = 0
    for (const zoom of ZOOMS) {
      map.jumpTo({ center: [NEMO.lng, NEMO.lat], zoom })
      map.redraw()
      for (let i = 0; i < 4; i++) {
        const cam = camera()
        variant = variant === "atlas" ? "adventure" : "atlas"
        swapBasemap(map, variant)
        swaps++
        map.redraw()
        map.redraw()
        const after = camera()
        for (const k of Object.keys(cam)) {
          if (!Object.is(cam[k], after[k])) fail.push(`z${zoom} swap ${i + 1}: ${k} moved ${cam[k]} → ${after[k]}`)
        }
        check(`z${zoom} swap ${i + 1} (→ ${variant})`, variant)
      }
      notes.push(`z${zoom}: 4 swaps, camera ${JSON.stringify(camera())}`)
    }
    if (swapWarnings.length) fail.push(`MapLibre fell back to a full style rebuild: ${swapWarnings.join(" | ")}`)
    const s = fog.stats()
    if (s.composites <= before) fail.push(`the fog stopped compositing after the swaps (${before} → ${s.composites})`)
    if (s.compositeError) fail.push(`composite error after the swaps: ${s.compositeError}`)
    const glError = map.getCanvas().getContext("webgl2").getError()
    if (glError !== 0) fail.push(`gl.getError() = 0x${glError.toString(16)} after the swaps`)
    notes.push(`swaps          ${swaps}, fog composites ${before} → ${s.composites}`)
    notes.push(`layers         ${map.getLayersOrder().length} in the final (${variant}) order`)
    parity()
  } catch (error) {
    fail.push(`threw: ${error.stack ?? error.message}`)
  }
  report()
})

/* ─── 0099 — the mask is bit-identical in both modes ─────────────────────────────────────── */

/**
 * The explored set: a 2 km disc with a ragged spur and a line of lone cells, so the mask has edges in
 * several directions at every zoom. The camera stands on the line of lone cells, just off the disc, so
 * every frame is part revealed and part fogged (an all-one-or-the-other frame proves nothing).
 */
const PARITY_CAMERA = { lng: NEMO.lng + 0.0266, lat: NEMO.lat - 0.0062 }
function parityCells() {
  const ids = new Set(gridDisk(latLngToCell(NEMO.lat, NEMO.lng, RES), 40))
  for (let i = 0; i < 60; i++) {
    const at = latLngToCell(NEMO.lat + 0.0002 * i * Math.sin(i / 4), NEMO.lng + 0.026 + 0.0004 * i, RES)
    for (const c of gridDisk(at, 2)) ids.add(c)
  }
  for (let i = 0; i < 12; i++) ids.add(latLngToCell(NEMO.lat - 0.002 - 0.0007 * i, NEMO.lng + 0.02 + 0.0011 * i, RES))
  return [...ids].map(cellToBig).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** The mask FBO's texture, read through a framebuffer of our own; MapLibre's binding is restored. */
function readMask(gl) {
  const [w, h] = fog.stats().maskSize.split("x").map(Number)
  const fb = gl.createFramebuffer()
  const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fog.maskTexture(), 0)
  const px = new Uint8Array(w * h * 4)
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
  const err = gl.getError()
  gl.bindFramebuffer(gl.FRAMEBUFFER, prev)
  gl.deleteFramebuffer(fb)
  if (err !== 0) throw new Error(`readPixels on the mask: gl error 0x${err.toString(16)}`)
  return { w, h, px }
}

function diffBytes(a, b) {
  if (a.w !== b.w || a.h !== b.h) return Infinity
  let n = 0
  for (let i = 0; i < a.px.length; i++) if (a.px[i] !== b.px[i]) n++
  return n
}

function fnv(px) {
  let h = 0x811c9dc5
  for (let i = 0; i < px.length; i++) h = Math.imul(h ^ px[i], 0x01000193)
  return (h >>> 0).toString(16).padStart(8, "0")
}

/**
 * Show `variant` the way the toggle does — swap the style, install the palette — then make the mask
 * pass run FRESH at `zoom`: away and back, so the buffer read is one drawn in this mode, and the pass
 * count proves it was. Reading a buffer the swap never redrew would compare a mask with itself.
 */
function renderIn(variant, palette, zoom, nudge = 0) {
  swapBasemap(map, variant)
  fog.setPalette(palette)
  map.jumpTo({ center: [PARITY_CAMERA.lng + 0.05, PARITY_CAMERA.lat], zoom: zoom - 1.5 })
  map.redraw()
  const passes = fog.stats().passes
  map.jumpTo({ center: [PARITY_CAMERA.lng + nudge, PARITY_CAMERA.lat], zoom })
  const cold = fog.stats().coldPasses
  map.redraw()
  // `0100`. Every cell is a year old, so atlas — and only atlas — runs the cold pass, inside
  // MapLibre's real frame (the copy of the frame under the fog is the part a fake cannot prove).
  const ran = fog.stats().coldPasses > cold
  if (palette.coldWash > 0 && !ran) fail.push(`cold z${zoom} ${variant}: coldWash ${palette.coldWash} but the cold pass did not run`)
  if (palette.coldWash === 0 && ran) fail.push(`cold z${zoom} ${variant}: the cold pass ran at coldWash 0`)
  if (fog.stats().coldError) fail.push(`cold: ${fog.stats().coldError}`)
  const glError = map.getCanvas().getContext("webgl2").getError()
  if (glError !== 0) fail.push(`cold z${zoom} ${variant}: gl error 0x${glError.toString(16)} after the frame`)
  if (fog.stats().passes <= passes) fail.push(`parity z${zoom} ${variant}: the mask pass did not re-run, the read would be stale`)
  if (fog.stats().res !== resForZoom(zoom)) fail.push(`parity z${zoom} ${variant}: bucket res ${fog.stats().res}, expected ${resForZoom(zoom)}`)
  return readMask(map.getCanvas().getContext("webgl2"))
}

function parity() {
  const set = ExploredSet.fromCells(BigUint64Array.from(parityCells()), 1)
  // Synchronous: the debounce is `viewport-controller.test.ts`'s subject; here it would only mean a
  // bucket switch that lands after the read.
  const syncHost = {
    setTimeout: (handler) => {
      handler()
      return 0
    },
    clearTimeout: () => {},
    now: () => performance.now(),
    requestIdle: () => () => {},
  }
  /**
   * `0100`. Every cell last run a year ago, so the mask's ALPHA is cold in every disc. Parity below
   * now covers it: the mask — warmth included — must be the same bytes in both modes.
   */
  const store = new ZoomBucketStore(set)
  store.setLastRun(new LastRunDays(set.cells, new Uint16Array(set.cells.length).fill(todayDay(Date.now()) - 365), 1))
  const controller = new FogViewportController({
    map,
    store,
    host: syncHost,
    debounceMs: 0,
    onInstances: (instances, _result, res, fromData) => fog.setInstances(instances, res, { supersedesRoute: fromData }),
  })
  controller.start()

  const mid = lerpPalette(FOG_MODES.atlas, FOG_MODES.adventure, 0.5)
  for (const zoom of ZOOMS) {
    const adventure = renderIn("adventure", FOG_MODES.adventure, zoom)
    const atlas = renderIn("atlas", FOG_MODES.atlas, zoom)
    const midFade = renderIn("atlas", mid, zoom)
    const back = renderIn("adventure", FOG_MODES.adventure, zoom)

    let full = 0
    let empty = 0
    let partial = 0
    for (let i = 0; i < adventure.px.length; i += 4) {
      const r = adventure.px[i]
      if (r === 255) full++
      else if (r === 0) empty++
      else partial++
    }
    const pixels = adventure.w * adventure.h
    if (full < pixels * 0.01 || empty < pixels * 0.01 || partial === 0) {
      fail.push(`parity z${zoom}: the mask is not a mix of revealed, fogged and edge (${full}/${empty}/${partial}), so agreeing proves nothing`)
    }
    for (const [name, other] of [["atlas", atlas], ["mid-fade", midFade], ["adventure again", back]]) {
      const d = diffBytes(adventure, other)
      if (d !== 0) fail.push(`parity z${zoom}: adventure vs ${name} differ in ${d} of ${adventure.px.length} mask bytes`)
    }
    // The sabotage: an eighth of a mask pixel east is a different mask, and the comparator sees it.
    const cosLat = Math.cos((PARITY_CAMERA.lat * Math.PI) / 180)
    const metresPerMaskPx = (2 * 40_075_016 * cosLat) / (512 * 2 ** zoom)
    const nudged = renderIn("atlas", FOG_MODES.atlas, zoom, metresPerMaskPx / 8 / (111_320 * cosLat))
    const sabotage = diffBytes(atlas, nudged)
    if (!(sabotage > 0)) fail.push(`parity z${zoom}: the sabotage (1/8 mask px camera move) did not change the mask, so the comparator cannot see`)
    notes.push(
      `parity z${zoom}: mask ${adventure.w}x${adventure.h} fnv ${fnv(adventure.px)} = atlas ${fnv(atlas.px)} = mid-fade ${fnv(midFade.px)} = back ${fnv(back.px)}; ` +
        `${full} revealed / ${empty} fogged / ${partial} edge px; sabotage differs in ${sabotage} bytes`,
    )
  }
  controller.stop()
}

function report() {
  const head = fail.length === 0 ? "MODE SWAP HARNESS PASS" : `MODE SWAP HARNESS FAIL (${fail.length})`
  document.title = head
  document.getElementById("out").textContent = [head, ...fail.map((f) => `  x ${f}`), "", `maplibre       ${maplibre.getVersion()}`, ...notes].join("\n")
}
