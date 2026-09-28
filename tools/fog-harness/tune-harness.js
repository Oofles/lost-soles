// Ticket 0119 — the taste pass, rendered the way the operator sees it: the REAL basemap style (stock
// Protomaps `light`, labels and all, from the real CloudFront archive), the SHIPPED `FogMaskLayer`
// with a palette under test, and the route drawn above the fog exactly as `map-shell.tsx` orders it.
//
// Bundled by tune.mjs. Nothing here is a probe with a pass/fail — the legibility question is a
// perceptual one (D-229) and the output is a screenshot for an eye, not a number.
import * as maplibre from "maplibre-gl"

import { basemapStyle, registerPmtilesProtocol } from "../../lib/basemap.ts"
import { packBucket } from "../../lib/fog/instances.ts"
import { FogMaskLayer } from "../../lib/fog/mask-layer.ts"
import { V1 } from "../../lib/fog/fog-uniforms.ts"
import { RUN_SOURCE_ID, fogBeforeId, runCoreSpec, runGlowSpec, runSourceSpec } from "../../lib/map-layers.ts"
import { traceToCells } from "../../src/domain/fog.ts"

// Injected by tune.mjs: { variant: overrides-on-V1 | null (fog off), centre, zoom, route: {glow, core}, trace: [[lat,lng],...] }
const CFG = window.__TUNE

registerPmtilesProtocol(maplibre)
// The worker has to be supplied explicitly — see scripts/copy-maplibre-worker.mjs and tune.mjs. Without
// it the map draws its background layer and parses no tile: a flat grey frame.
maplibre.setWorkerUrl(
  URL.createObjectURL(new Blob([CFG.workerSrc], { type: "text/javascript" })),
)

const map = new maplibre.Map({
  container: "map",
  style: basemapStyle(),
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
const cells = [...traceToCells({ points, gaps: [] })]
const bucket = packBucket(cells)

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
  if (CFG.variant) {
    // u_time pinned: every variant is rendered against the same noise field, so a difference between
    // two screenshots is the palette and nothing else.
    const layer = new FogMaskLayer({ palette: { ...V1, ...CFG.variant }, timeSource: () => 0 })
    map.addLayer(layer, fogBeforeId(map))
    layer.setBucket(bucket)
  }
  map.once("idle", () => {
    map.redraw()
    document.title = `TUNE READY cells=${cells.length}`
  })
})
