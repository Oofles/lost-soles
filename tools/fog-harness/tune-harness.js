// Ticket 0119 — the taste pass, rendered the way the operator sees it: the REAL basemap style (stock
// Protomaps `light`, labels and all, from the real CloudFront archive), the SHIPPED `FogMaskLayer`
// with a palette under test, and the route drawn above the fog exactly as `map-shell.tsx` orders it.
//
// Bundled by tune.mjs. Nothing here is a probe with a pass/fail — the legibility question is a
// perceptual one (D-229) and the output is a screenshot for an eye, not a number.
import * as maplibre from "maplibre-gl"

import { gridDisk, latLngToCell } from "h3-js"

import { basemapStyle, registerPmtilesProtocol, swapBasemap } from "../../lib/basemap.ts"
import { packBucket } from "../../lib/fog/instances.ts"
import { FogMaskLayer } from "../../lib/fog/mask-layer.ts"
import { FOG_MODES, V1 } from "../../lib/fog/fog-uniforms.ts"
import { RUN_SOURCE_ID, fogBeforeId, runCoreSpec, runGlowSpec, runSourceSpec } from "../../lib/map-layers.ts"
import { RES, traceToCells } from "../../src/domain/fog.ts"

// Injected by tune.mjs: { variant: overrides | null (fog off), basemap: "atlas" | "adventure", base: the
// FOG_MODES entry the overrides apply to (V1 if absent), centre, zoom, route: {glow, core}, trace: [[lat,lng],...] }
const CFG = window.__TUNE

registerPmtilesProtocol(maplibre)
// The worker has to be supplied explicitly — see scripts/copy-maplibre-worker.mjs and tune.mjs. Without
// it the map draws its background layer and parses no tile: a flat grey frame.
maplibre.setWorkerUrl(
  URL.createObjectURL(new Blob([CFG.workerSrc], { type: "text/javascript" })),
)

const map = new maplibre.Map({
  container: "map",
  // `0210`: the variant is explicit. Since `0097` `basemapStyle` takes one, and the call without it
  // drew `basemapLayers(source, undefined)`.
  // `0099`: with `swapFrom`, the map is BUILT in the other variant and reaches this one through the
  // toggle's own `swapBasemap`, so the screenshot is of the swap path, not of a fresh build.
  style: basemapStyle(CFG.swapFrom ?? CFG.basemap ?? "adventure"),
  center: [CFG.centre.lng, CFG.centre.lat],
  zoom: CFG.zoom,
  attributionControl: false,
  // The screenshot is taken of the compositor's output, but a preserved buffer takes one source of
  // "captured a cleared frame" off the table for free.
  canvasContextAttributes: { preserveDrawingBuffer: true },
})

// A SYNTHETIC run through the SHIPPED trace -> cells path. 1 s samples at ~3 m/s, no gaps.
const t0 = Date.UTC(2026, 8, 1, 12)
const points = []
for (let i = 0; i < CFG.trace.length - 1; i++) {
  const [aLat, aLng] = CFG.trace[i]
  const [bLat, bLng] = CFG.trace[i + 1]
  const dy = (bLat - aLat) * 111_320
  const dx = (bLng - aLng) * 111_320 * Math.cos((aLat * Math.PI) / 180)
  const steps = Math.max(1, Math.round(Math.hypot(dx, dy) / 3))
  for (let s = 0; s < steps; s++) {
    const f = s / steps
    points.push({ lat: aLat + (bLat - aLat) * f, lng: aLng + (bLng - aLng) * f, t: t0 + points.length * 1000 })
  }
}
const last = CFG.trace[CFG.trace.length - 1]
points.push({ lat: last[0], lng: last[1], t: t0 + points.length * 1000 })
/**
 * `0099`: `cells` picks the explored set. `"loop"` (default) is the synthetic run above; `"all"` is a
 * disc of cells covering the whole frame (every pixel revealed); `"none"` is nothing explored (every
 * pixel at `u_maxOpacity`). The last two are what the legibility and ghost-grid measurements need:
 * ground that is uniformly one thing, so a label's contrast is not an accident of where the edge fell.
 */
const cells =
  CFG.cells === "all"
    ? gridDisk(latLngToCell(CFG.centre.lat, CFG.centre.lng, RES), Math.ceil(35 * 2 ** (16 - CFG.zoom)))
    : CFG.cells === "none"
      ? []
      : [...traceToCells({ points, gaps: [] })]
const bucket = packBucket(cells)

/**
 * `0099`. `muteLabels` (a regex on layer ids) sets those symbol layers' text and icon opacity to 0 —
 * NOT `visibility: none`, which would change symbol collision and let other labels appear where the
 * muted ones stood. With the opacity at 0 every other pixel is identical, so a diff against the
 * unmuted frame is exactly those labels' glyphs and halos. `noSymbols` hides every symbol layer, for
 * a frame that is road geometry and nothing written on it.
 */
function applyLabelOptions() {
  for (const layer of map.getStyle().layers) {
    if (layer.type !== "symbol") continue
    if (CFG.noSymbols) map.setLayoutProperty(layer.id, "visibility", "none")
    else if (CFG.muteLabels && new RegExp(CFG.muteLabels).test(layer.id)) {
      map.setPaintProperty(layer.id, "text-opacity", 0)
      map.setPaintProperty(layer.id, "icon-opacity", 0)
    } else if (CFG.bareLabels && new RegExp(CFG.bareLabels).test(layer.id)) {
      // The glyph fill alone, no halo: diffed against the muted frame it is the letters' own pixels.
      map.setPaintProperty(layer.id, "text-halo-width", 0)
    }
  }
}

const routeFc = {
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: points.map((p) => [p.lng, p.lat]) } }],
}

// A failed tile or glyph fetch surfaces in the title, so tune.mjs times out with a reason.
map.on("error", (e) => { document.title = `TUNE ERROR ${e.error?.message ?? e}` })
map.on("load", () => {
  map.addSource(RUN_SOURCE_ID, runSourceSpec(routeFc))
  map.addLayer(runGlowSpec(CFG.route))
  map.addLayer(runCoreSpec(CFG.route))
  let layer = null
  if (CFG.variant) {
    // u_time pinned: every variant is rendered against the same noise field, so a difference between
    // two screenshots is the palette and nothing else.
    const base = FOG_MODES[CFG.base] ?? V1
    // `0099`: with `swapFrom` the fog starts in the OTHER mode's palette and is moved by `setPalette`,
    // as the toggle moves it.
    const start = CFG.swapFrom ? FOG_MODES[CFG.swapFrom] : { ...base, ...CFG.variant }
    layer = new FogMaskLayer({ palette: start, timeSource: () => 0 })
    map.addLayer(layer, fogBeforeId(map))
    layer.setBucket(bucket)
  }
  const ready = () => {
    applyLabelOptions()
    map.once("idle", () => {
      map.redraw()
      document.title = `TUNE READY cells=${cells.length}`
    })
    map.triggerRepaint()
  }
  if (CFG.swapFrom) {
    map.once("idle", () => {
      swapBasemap(map, CFG.basemap ?? "adventure")
      if (layer) layer.setPalette({ ...(FOG_MODES[CFG.base] ?? V1), ...CFG.variant })
      map.once("idle", ready)
      map.triggerRepaint()
    })
  } else {
    ready()
  }
})
