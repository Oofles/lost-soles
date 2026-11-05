// Ticket 0313 — the fog does not wait on tiles (`06` §4.8). Bundled by run-tile-wait.mjs.
//
// `map-shell.tsx` used to hand the map to `useFogMask` on MapLibre's `load`, and `load` fires only
// once `map.loaded()` holds, which needs every tile manager loaded (`Style.loaded()` in MapLibre 6).
// On a slow link the fog could not draw until the basemap had finished. It now waits on
// `style.load` instead. This harness proves, on a REAL Map with the SHIPPED style and the SHIPPED
// `FogMaskLayer`, the two facts that change rests on:
//
//   HANG     every basemap tile request is held open for good. `style.load` still fires, the fog
//            layer added on it composites frame after frame, and `load` has NOT fired: so a fog
//            gated on `load` would never have drawn, and one gated on `style.load` does.
//   CONTROL  the same map with tiles that answer (empty) DOES reach `load`. Without this, "load
//            never fired" could just be a harness that cannot see `load`.
//
// Tiles are answered through a stand-in `pmtiles` protocol: its TileJSON request is answered, its
// `z/x/y` requests are what hang. No archive is fetched.
import * as maplibre from "maplibre-gl"

import { basemapStyle } from "../../lib/basemap.ts"
import { FogMaskLayer } from "../../lib/fog/mask-layer.ts"
import { FOG_LAYER_ID, fogBeforeId } from "../../lib/map-layers.ts"

/** POINT NEMO, as `maplibre-harness.js` — D-199: no committed coordinate near where anyone runs. */
const NEMO = { lat: -48.876123456789, lng: -123.393987654321 }
/** Virtual time the HANG case waits with tiles outstanding: far past any real style parse. */
const HANG_MS = 5000
const CONTROL_MS = 10000

const fail = []
const notes = []

// The worker, bundled to one file by run-tile-wait.mjs and handed over as a blob (`tune.mjs` explains
// why: MapLibre 6's module worker cannot start from file://, and without it no tile is ever asked for).
maplibre.setWorkerUrl(URL.createObjectURL(new Blob([window.__WORKER], { type: "text/javascript" })))

let hang = true
let pending = 0
let answered = 0
maplibre.addProtocol("pmtiles", async (params, abort) => {
  if (!/\/\d+\/\d+\/\d+$/.test(params.url)) {
    return {
      data: { tilejson: "3.0.0", tiles: [`${params.url}/{z}/{x}/{y}`], minzoom: 0, maxzoom: 15 },
    }
  }
  if (!hang) {
    answered++
    return { data: new ArrayBuffer(0) }
  }
  pending++
  // Never resolves. Only an abort (the map's removal) ends it.
  return new Promise((_resolve, reject) => {
    abort.signal.addEventListener("abort", () => {
      pending--
      reject(new DOMException("aborted", "AbortError"))
    })
  })
})

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function build() {
  const map = new maplibre.Map({
    container: "map",
    // An absolute origin: MapLibre refuses a relative sprite URL. The assets 404 on the throwaway server,
    // which settles them (a failed sprite is not an outstanding one), so only the tiles are left waiting.
    style: basemapStyle("adventure", location.origin),
    center: [NEMO.lng, NEMO.lat],
    zoom: 15,
    attributionControl: false,
  })
  const seen = { styleLoad: null, load: null }
  const t0 = performance.now()
  map.once("style.load", () => (seen.styleLoad = performance.now() - t0))
  map.once("load", () => (seen.load = performance.now() - t0))
  return { map, seen }
}

/** Resolves on `style.load`, adding the fog layer there exactly as `useFogMask` does once handed the map. */
function fogOnStyleLoad(map) {
  return new Promise((resolve) => {
    map.once("style.load", () => {
      const fog = new FogMaskLayer({ timeSource: () => 3.25 })
      try {
        map.addLayer(fog, fogBeforeId(map))
      } catch (error) {
        fail.push(`hang: addLayer on style.load threw: ${error.message}`)
      }
      resolve(fog)
    })
  })
}

async function hangCase() {
  hang = true
  const { map, seen } = build()
  const fog = await fogOnStyleLoad(map)
  // Let MapLibre run its own frames (it repaints while tiles are outstanding), then force two more.
  await wait(HANG_MS)
  map.redraw()
  map.redraw()
  const s = fog.stats()
  if (seen.styleLoad === null) fail.push("hang: style.load never fired")
  if (seen.load !== null) fail.push(`hang: load fired at ${seen.load.toFixed(0)} ms with tiles still outstanding, so this case proves nothing`)
  if (pending === 0) fail.push("hang: no tile request was ever held open, so the basemap was not waiting on tiles")
  if (map.loaded()) fail.push("hang: map.loaded() is true with tiles outstanding")
  if (!map.getLayer(FOG_LAYER_ID)) fail.push("hang: the fog layer is not in the style")
  if (!(s.composites > 0)) fail.push(`hang: the fog never composited (${s.composites})`)
  if (s.compositeError) fail.push(`hang: composite error: ${s.compositeError}`)
  notes.push(
    `hang:    style.load ${seen.styleLoad?.toFixed(0)} ms · load ${seen.load === null ? "never" : `${seen.load.toFixed(0)} ms`} · ` +
      `${pending} tile requests held · fog composites ${s.composites} after ${HANG_MS} ms`,
  )
  map.remove()
}

async function controlCase() {
  hang = false
  const { map, seen } = build()
  const deadline = performance.now() + CONTROL_MS
  while (seen.load === null && performance.now() < deadline) await wait(100)
  if (seen.load === null) fail.push(`control: load never fired with tiles answering, so the hang case cannot tell load apart`)
  notes.push(`control: style.load ${seen.styleLoad?.toFixed(0)} ms · load ${seen.load === null ? "never" : `${seen.load.toFixed(0)} ms`} · ${answered} tiles answered`)
  map.remove()
}

function report() {
  const head = fail.length === 0 ? "TILE WAIT HARNESS PASS" : `TILE WAIT HARNESS FAIL (${fail.length})`
  document.title = head
  document.getElementById("out").textContent = [head, ...fail.map((f) => `  x ${f}`), "", `maplibre       ${maplibre.getVersion()}`, ...notes].join("\n")
}

hangCase()
  .then(controlCase)
  .catch((error) => fail.push(`threw: ${error.stack ?? error.message}`))
  .finally(report)
