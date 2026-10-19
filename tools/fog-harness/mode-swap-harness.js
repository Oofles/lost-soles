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
// The basemap's tiles are never fetched (no pmtiles protocol is registered, and a headless run has
// no business pulling the archive). The STYLE is the shipped one, `basemapStyle(variant)`, which is
// what the swap diffs; tiles are not part of a diff.
import * as maplibre from "maplibre-gl"

import { BASEMAP_SOURCE, basemapStyle, swapBasemap } from "../../lib/basemap.ts"
import { FogMaskLayer } from "../../lib/fog/mask-layer.ts"
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
  } catch (error) {
    fail.push(`threw: ${error.stack ?? error.message}`)
  }
  report()
})

function report() {
  const head = fail.length === 0 ? "MODE SWAP HARNESS PASS" : `MODE SWAP HARNESS FAIL (${fail.length})`
  document.title = head
  document.getElementById("out").textContent = [head, ...fail.map((f) => `  x ${f}`), "", `maplibre       ${maplibre.getVersion()}`, ...notes].join("\n")
}
