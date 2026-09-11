// Ticket 0059 — §6.4's instruments, driven end to end against a real MapLibre Map.
//
// WHAT THIS CAN PROVE AND WHAT IT CANNOT, STATED FIRST BECAUSE THE DISTINCTION IS THE WHOLE POINT.
//
// The page runs under `--virtual-time-budget`, which advances the clock instantly whenever the
// renderer would otherwise wait — so a rAF-paced camera path here measures a clock that is not
// measuring anything. run-cull.mjs already paid to learn this and drives `map.redraw()` instead.
//
// So this harness owns the half of §6.4 that is COUNTS AND ALLOCATIONS, which are device-independent
// and would be identical on the phone:
//
//   item 1  visibleInstanceCount per zoom, at all three dataset sizes, against §6.4's ceiling
//   item 4  zero culls inside the padded region; cull wall-clock, which is synchronous and real
//   item 5  bucket-derivation cost and the cache hit rate
//   item 7  peak JS heap over baseline, from performance.memory
//
// and it deliberately does NOT report items 2, 3 and 6 as results. Those are frame-time questions and
// this clock cannot answer them; the browser answers them on the desktop and the phone answers the
// one that matters. A harness that printed a p95 here would be printing a number about virtual time
// and calling it a frame budget.
//
// It also proves the plumbing: that the collector, the path driver and the report run against the
// real layer, the real store and the real controller without throwing — which is the thing most
// likely to be wrong the first time the operator opens the page outdoors.
//
// Bundled by run-perf.mjs.
import * as maplibre from "maplibre-gl"

import { ExploredSet } from "../../lib/fog/explored-set.ts"
import { FogMaskLayer } from "../../lib/fog/mask-layer.ts"
import { driveScriptedPath } from "../../lib/fog/perf/camera-path.ts"
import { FogPerf } from "../../lib/fog/perf/collector.ts"
import { GpuTimer } from "../../lib/fog/perf/gpu-timer.ts"
import { formatReport, scaledCeiling, verdicts } from "../../lib/fog/perf/report.ts"
import { DATASETS, PERF_ORIGIN, syntheticBlob } from "../../lib/fog/perf/synthetic.ts"
import { FogViewportController } from "../../lib/fog/viewport-controller.ts"
import { ZoomBucketStore } from "../../lib/fog/zoom-buckets.ts"

/**
 * THE REFERENCE VIEWPORT, 400x800 — D-238's, and the one §6.4's 6,000 is stated for. The cull harness
 * uses 1280x800 and has to scale its ceiling; here the literal number in the design document is the
 * number being checked, which is worth the smaller canvas.
 */
const WIDTH = 400
const HEIGHT = 800

/**
 * THE SAME PATH, IN FEWER AND LARGER STEPS. Every segment covers the identical ground and holds the
 * identical property — `pan-inside` still travels 60 px, `pan-across` still 960 px, the zoom sweep
 * still runs z17 to z5 and back — but in ~96 redraws rather than 690. SwiftShader draws a 400x800
 * composite in tens of milliseconds and three datasets x 690 redraws is a twenty-minute harness,
 * which is a harness nobody runs.
 *
 * The shipped `PATH` is what the phone runs and what criterion 3 records; this is its coarse twin,
 * and the two are kept in step by `camera-path.test.ts` asserting the shipped one's displacements.
 */
const HEADLESS_PATH = [
  { phase: "settle", steps: 6, dxFrac: 0, dyFrac: 0, zoom: 14 },
  { phase: "pan-inside", steps: 6, dxFrac: 0, dyFrac: -0.0125, zoom: 14 },
  { phase: "pan-across", steps: 12, dxFrac: 0.1, dyFrac: 0, zoom: 14 },
  { phase: "pan-across", steps: 12, dxFrac: -0.1, dyFrac: 0, zoom: 14 },
  { phase: "zoom-out", steps: 24, dxFrac: 0, dyFrac: 0, zoom: 17, dZoom: -0.5 },
  { phase: "zoom-in", steps: 24, dxFrac: 0, dyFrac: 0, zoom: 5, dZoom: 0.5 },
  { phase: "pan-z17", steps: 12, dxFrac: 0.2, dyFrac: 0, zoom: 17 },
]

const fail = []
const blocks = []

/**
 * ONE DATASET PER PAGE LOAD, named in the URL hash by run-perf.mjs.
 *
 * The first version ran all three in one page and the heap numbers were unusable: the baseline
 * climbed 39 -> 67 -> 83 MB across the three because the previous set's `Set` of half a million
 * strings had not been collected, so item 7's delta was measuring this dataset PLUS whatever the
 * last one still held. There is no way to force a collection from script, and `--expose-gc` would
 * measure a collection nobody in the real browser ever gets. A fresh process is the only honest
 * baseline.
 */
const only = decodeURIComponent(location.hash.slice(1)) || "150k"
const chosen = DATASETS.filter((dataset) => dataset.label === only)

const map = new maplibre.Map({
  container: "map",
  style: { version: 8, sources: {}, layers: [] },
  center: [PERF_ORIGIN.lng, PERF_ORIGIN.lat],
  zoom: 14,
  attributionControl: false,
})

/** Synchronous rAF: redraw, then run the callback. See the header on why the real clock is not used. */
const host = {
  now: () => performance.now(),
  requestAnimationFrame: (callback) => {
    map.redraw()
    callback()
    return 0
  },
}

async function runDataset(dataset) {
  /**
   * THROUGH THE SHIPPED WRITER AND THE SHIPPED READER, in-page. `fetch` cannot reach a `file://`
   * fixture from a null origin, and generating cells directly with `syntheticSet` would skip the
   * varint decode and the `Set` build — which is most of what item 7 is measuring. Encoding and
   * immediately decoding costs a second and exercises the exact path a cold boot takes.
   *
   * `fixtures.test.ts` asserts these bytes are byte-identical to the checked-in `public/` fixture,
   * so this is the same dataset the phone loads, not a lookalike.
   */
  const perf = new FogPerf()
  const timer = new GpuTimer()
  perf.start()
  perf.beginPhase("load")

  const bytes = syntheticBlob(dataset)
  const set = ExploredSet.fromBlob(bytes)
  if (set.size !== dataset.cells) {
    fail.push(`${dataset.label}: decoded ${set.size} cells, expected ${dataset.cells}`)
  }

  const store = new ZoomBucketStore(set, {
    onDerive: (event) => perf.derive(event),
    onRequest: (hit) => perf.bucketRequest(hit),
  })
  const layer = new FogMaskLayer({ timeSource: () => 3.25, timer })
  map.addLayer(layer)

  /**
   * `0202`'s prefetch needs an idle queue, and this page has no real one worth using: under
   * `--virtual-time-budget` `requestIdleCallback` is as unreliable as rAF. The path is driven
   * synchronously by `map.redraw()`, so the honest substitute is to run one slice immediately after
   * each schedule — which is the WORST case for the measurement, since it puts the prefetch back on
   * the same task as the cull. If `derive inside` falls for the pan phases even under that, it falls.
   */
  const controller = new FogViewportController({
    map,
    store,
    host: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h),
      now: () => performance.now(),
      requestIdle: (task) => {
        /**
         * SYNCHRONOUS, and it has to be. A `setTimeout` here never runs: `driveScriptedPath` awaits a
         * promise that `requestAnimationFrame` resolves synchronously, so the continuation is a
         * MICROtask and the event loop never reaches the macrotask queue for the whole path. The
         * slices simply piled up and the prefetch was measured as doing nothing.
         *
         * Running inline is the worst case for the numbers — it puts the derivation on the same task
         * as the cull that preceded it — and that is the right bias for a harness. What it still
         * proves is the thing `0202` claims: the derivation leaves the window `cullStart`/`cullEnd`
         * brackets, so `derive inside` falls even when the work has nowhere better to go.
         */
        task()
        return () => {}
      },
    },
    /**
     * The debounce is `viewport-controller.test.ts`'s subject and driven by an injected clock there.
     * Here it would only mean a rebuild landing after the report — and a zoom sweep that never
     * switched bucket would report item 1's ceiling against one resolution instead of seven.
     *
     * **IT ALSO MEANS `zoom-out`'s `derive inside` IS NOT A RESULT ON THIS SURFACE.** `0202` warms an
     * incoming bucket during the debounce window; with the window set to zero there is no window, so
     * every band crossing derives on the frame path exactly as it did before. The pan phases are
     * where this harness can show the fix, and they show it at 0.00 ms. The debounce path is covered
     * by `viewport-controller.test.ts`, which can drive a clock.
     */
    debounceMs: 0,
    observer: perf,
    onInstances: (instances, _result, res, fromData) =>
      layer.setInstances(instances, res, { supersedesRoute: fromData }),
  })
  controller.start()
  map.redraw()

  await driveScriptedPath(map, perf, {
    host,
    gpuTimer: timer,
    path: HEADLESS_PATH,
    onSample: () => {
      const stats = layer.stats()
      perf.instances(map.getZoom(), stats.visibleInstanceCount, stats.res)
    },
  })

  const snapshot = perf.snapshot()
  const context = {
    dataset: dataset.label,
    cells: set.size,
    viewportW: WIDTH,
    viewportH: HEIGHT,
    devicePixelRatio: window.devicePixelRatio,
    userAgent: navigator.userAgent,
    renderer: rendererString(),
    /** Items 2, 3 and 6 are frame-time questions and this clock is virtual. See the header. */
    unjudged: [2, 3, 6],
  }

  /* ─── The assertions this clock can actually make ─────────────────────────── */

  const rows = verdicts(snapshot, timer.stats(), context)
  for (const name of [
    "visibleInstanceCount",
    "culls inside the padded region",
    "peak JS heap over baseline",
  ]) {
    const row = rows.find((r) => r.name === name)
    if (row && row.pass === false) fail.push(`${dataset.label}: ${name} — ${row.value} (${row.budget})`)
  }

  /**
   * ITEM 1'S REAL CANARY, and it is not the ceiling. D-238: *"an absolute ceiling can pass by luck,
   * while a count that is the same at 50k and 500k cannot."* The comparison across datasets is made
   * by run-perf.mjs once all three have run; what is recorded here is the per-zoom peak.
   */
  const stats = layer.stats()
  if (stats.shaderError) fail.push(`${dataset.label}: mask shader — ${stats.shaderError}`)
  if (stats.compositeError) fail.push(`${dataset.label}: composite — ${stats.compositeError}`)
  if (stats.passes === 0) fail.push(`${dataset.label}: prerender never ran`)

  const blank = snapshot.instances.filter((bucket) => bucket.max === 0)
  if (blank.length > 0) {
    fail.push(`${dataset.label}: the fog vanished at ${blank.map((b) => `z${b.zoom}`).join(", ")}`)
  }

  blocks.push(formatReport(snapshot, timer.stats(), context))

  controller.stop()
  perf.stop()
  map.removeLayer(layer.id)
  return snapshot
}

function rendererString() {
  try {
    const gl = map.getCanvas().getContext("webgl2")
    const info = gl.getExtension("WEBGL_debug_renderer_info")
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
  } catch {
    return null
  }
}

map.on("load", async () => {
  if (chosen.length === 0) {
    document.getElementById("out").textContent = `PERF HARNESS FAIL (1)\n  x unknown dataset "${only}"`
    return
  }

  const histograms = []
  for (const dataset of chosen) {
    const snapshot = await runDataset(dataset)
    /**
     * THE CROSS-DATASET CANARY'S RAW MATERIAL, emitted for run-perf.mjs to compare across processes.
     * §6.4: *"an absolute ceiling can pass by luck, while a count that is the same at 50k and 500k
     * cannot."* One process can no longer make that comparison itself — see the note on `only`.
     */
    histograms.push(
      `HISTOGRAM ${dataset.label} ` +
        snapshot.instances.map((b) => `${b.zoom}:${b.max}@${b.zoomAtMax.toFixed(2)}/r${b.resAtMax}`).join(" "),
    )
  }

  const ceiling = scaledCeiling({ viewportW: WIDTH, viewportH: HEIGHT })
  const head = fail.length === 0 ? "PERF HARNESS PASS" : `PERF HARNESS FAIL (${fail.length})`
  document.title = head
  document.getElementById("out").textContent = [
    head,
    ...fail.map((f) => `  x ${f}`),
    "",
    `maplibre       ${maplibre.getVersion()}`,
    `canvas         ${WIDTH}x${HEIGHT} CSS px — D-238's reference viewport, ceiling ${ceiling}`,
    `clock          VIRTUAL. Items 2, 3 and 6 carry no verdict here — see the header.`,
    `debounce       0 ms, so zoom-out's 'derive inside' is NOT a result — 0202's band-crossing`,
    `               prefetch needs a debounce window and there is none. The pan phases are the test.`,
    "",
    ...blocks,
    "",
    ...histograms,
  ].join("\n")
})
