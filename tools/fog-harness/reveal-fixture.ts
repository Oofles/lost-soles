/**
 * Ticket `0079` — the reveal's two streams, produced by the SHIPPED derivation, for `harness.js`.
 *
 * `harness.js` runs in a page with `mask.ts` and `reveal-tag.ts` and nothing else — no h3, no
 * buckets, no cull — which is what keeps it a measurement of the GPU rather than of the data path.
 * The pixel claims in `0079` (criteria 2 and 3: zero-tolerance `readPixels` diffs) are about streams
 * that only the data path can produce, so this script produces them in Node through the real
 * `revealCellsForRoute`, `ZoomBucketStore` and `FogViewportController`, and `run.mjs` inlines the
 * result as JSON. Float32 values survive JSON exactly: each is a double whose shortest repr
 * round-trips.
 *
 * The camera is the harness's own: centred on Point Nemo (D-199), `HALF_W = 2e-5` mercator each side.
 */
import { writeFileSync } from "node:fs"

import { gridDisk, latLngToCell } from "h3-js"

import { cellToBig } from "../../src/domain/explored-blob"
import { RES } from "../../src/domain/fog"
import { ExploredSet } from "../../lib/fog/explored-set"
import { postRunCells, preRunCells, revealCellsForRoute } from "../../lib/fog/reveal"
import { FogViewportController, type ControllerMap } from "../../lib/fog/viewport-controller"
import { ZoomBucketStore } from "../../lib/fog/zoom-buckets"

const NEMO = { lat: -48.876, lng: -123.393 }
const HALF_W = 2e-5
const HALF_H = (HALF_W * 400) / 640
const KM_LNG = 1 / (111.32 * Math.cos((NEMO.lat * Math.PI) / 180))

const xOf = (lng: number) => lng / 360 + 0.5
const yOf = (lat: number) =>
  0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI)
const lngOf = (x: number) => (x - 0.5) * 360
const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI
const CX = xOf(NEMO.lng)
const CY = yOf(NEMO.lat)

function camera(zoom: number): ControllerMap {
  return {
    getZoom: () => zoom,
    getBounds: () => ({
      getWest: () => lngOf(CX - HALF_W),
      getEast: () => lngOf(CX + HALF_W),
      getNorth: () => latOf(CY - HALF_H),
      getSouth: () => latOf(CY + HALF_H),
    }),
    on: () => {},
    off: () => {},
    triggerRepaint: () => {},
  }
}

const host = {
  now: () => 0,
  setTimeout: () => 0,
  clearTimeout: () => {},
  requestIdle: () => () => {},
}

const sorted = (cells: Iterable<string>) =>
  BigUint64Array.from([...new Set(cells)].map(cellToBig).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))

function cull(zoom: number, store: ZoomBucketStore, reveal?: { pre: ZoomBucketStore; post: ZoomBucketStore }) {
  let post: number[] = []
  let pre: number[] | null = null
  const controller = new FogViewportController({
    map: camera(zoom),
    store,
    host,
    onInstances: (instances, _r, _res, _d, preStream) => {
      post = Array.from(instances)
      pre = preStream ? Array.from(preStream) : null
    },
  })
  controller.start()
  if (reveal) controller.setReveal(reveal)
  controller.stop()
  return { post, pre }
}

/** A run from 380 m west of centre to 380 m east, with older ground overlapping its start. */
const coords: [number, number][] = []
for (let i = 0; i <= 38; i++) {
  const km = -0.38 + (0.76 * i) / 38
  // A gentle S-bend, so the corridor is not axis-aligned and the arc order is not just x.
  coords.push([NEMO.lng + km * KM_LNG, NEMO.lat + (Math.sin(km * 8) * 40) / 110_540])
}
const reveal = revealCellsForRoute({ type: "MultiLineString", coordinates: [coords] })
const earlier = gridDisk(latLngToCell(NEMO.lat, NEMO.lng - 0.35 * KM_LNG, RES), 4)
const persisted = sorted([...earlier, ...reveal.map((r) => r.cell)])

const cases = [
  { label: "res 11 (z15)", zoom: 15 },
  { label: "coarse (z11.5)", zoom: 11.5 },
].map(({ label, zoom }) => {
  const store = new ZoomBucketStore(ExploredSet.fromCells(persisted, 1))
  const pre = new ZoomBucketStore(ExploredSet.fromCells(preRunCells(persisted, reveal), 1))
  const postCells = postRunCells(persisted, reveal)
  const stores = {
    pre,
    post: postCells === persisted ? store : new ZoomBucketStore(ExploredSet.fromCells(postCells, 1)),
  }
  const both = cull(zoom, store, stores)
  return {
    label,
    post: both.post,
    pre: both.pre,
    // The steady-state streams, culled on their own by fresh stores — what the map draws with no
    // reveal running, before and after the run.
    steadyPost: cull(zoom, new ZoomBucketStore(ExploredSet.fromCells(postCells, 1))).post,
    steadyPre: cull(zoom, new ZoomBucketStore(ExploredSet.fromCells(preRunCells(persisted, reveal), 1))).post,
  }
})

// To a FILE, not stdout: the controller logs each cull through `log.info`, which is stdout too.
writeFileSync(
  process.argv[2]!,
  JSON.stringify({ points: reveal.map(({ x, y, arc }) => ({ x, y, arc })), cases }),
)
