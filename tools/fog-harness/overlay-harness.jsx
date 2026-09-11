// Ticket 0059 — THE REACT GLUE, IN A REAL BROWSER.
//
// `run-perf.mjs` proves the instruments against a real MapLibre Map. It does not touch a line of
// React, and roughly 180 lines of this ticket are React: the `?fog=perf` branch in
// `ExploredProvider`, `PerfOverlay`'s flag read, its ready gate, its run sequence and its table.
// Those were typechecked and built and never RUN — and the operator is going to open this page on a
// phone, outdoors, in one trip. "It compiled" is not what should be standing behind that.
//
// This project has no jsdom and no testing-library, deliberately — `use-latest-run.test.ts` asserts
// hook ORDER with a source grep rather than by rendering. So the browser is where React runs, and
// this is the smallest page that runs the real components.
//
// WHAT IS REAL HERE: `ExploredProvider` (its perf branch, `loadPerfDataset`, `ExploredSet`),
// `PerfOverlay` (all of it), `FogPerf`, `GpuTimer`, `driveScriptedPath`, `formatReport`, and a real
// `FogMaskLayer` whose `stats()` is read per frame.
//
// WHAT IS FAKED, AND WHY THAT IS THE RIGHT SEAM: the MapLibre `Map`. A real one needs a basemap
// archive over the network and a GL context, and `run-perf.mjs` already drives the real thing. What
// is untested is the glue between React and the driver, and a fake map with the six methods
// `PathMap` declares exercises every line of it — including that the overlay asks the map for its
// canvas size and unprojects from the canvas centre, which is where a screen-space path can go wrong.
//
// Bundled by run-overlay.mjs.
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { ExploredProvider } from "../../components/map/explored-provider.tsx"
import { PerfOverlay } from "../../components/map/perf-overlay.tsx"
import { FogMaskLayer } from "../../lib/fog/mask-layer.ts"
import { createFogHarness } from "../../lib/fog/perf/harness.ts"

const fail = []
const notes = []

/**
 * `requestAnimationFrame` IS SHIMMED TO A TIMER, and this is the one substitution that needs
 * defending rather than merely noting.
 *
 * Headless Chromium under `--virtual-time-budget` drives no compositor, so rAF callbacks do not
 * arrive — the clock jumps forward when the TIMER queue drains and an rAF-driven loop simply never
 * runs. `run-cull.mjs` hit the same wall from the other side and drives `map.redraw()` for it. The
 * symptom here is silent and expensive: `--dump-dom` reports a `<pre>` still saying "pending", with
 * nothing in the console, because the page is not broken — it is waiting.
 *
 * **What this costs is nothing this harness was measuring.** The page under test is React glue: does
 * the flag get read, does the provider load a synthetic set, does the button start the path, does the
 * table come back with every instrument in it. Frame CADENCE is item 3's business and item 3 is
 * explicitly not a result on any headless surface — `perf-harness.js` says so at length and the
 * report forces items 2, 3 and 6 to no verdict here. Substituting the scheduler cannot flatter a
 * number this surface is allowed to report.
 *
 * It is installed before `createRoot` so the driver closes over it.
 */
const realRaf = window.requestAnimationFrame.bind(window)
window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(performance.now()), 0)
void realRaf

/** The six methods `PathMap` declares, and a jump log so the path can be checked afterwards. */
const jumps = []
let repaints = 0
const state = { lng: -81.4, lat: 30.1, zoom: 14 }
const CANVAS_W = 400
const CANVAS_H = 800

const canvas = document.createElement("canvas")
canvas.width = CANVAS_W
canvas.height = CANVAS_H

const fakeMap = {
  getZoom: () => state.zoom,
  getCenter: () => ({ lng: state.lng, lat: state.lat }),
  getCanvas: () => {
    // A REAL canvas element, so `clientWidth` and `rendererString`'s `getContext("webgl2")` are the
    // real ones. It is off-DOM, so `clientWidth` is 0 — patched below, because the overlay reads it
    // for the report context and for the path's screen-space offsets.
    Object.defineProperty(canvas, "clientWidth", { value: CANVAS_W, configurable: true })
    Object.defineProperty(canvas, "clientHeight", { value: CANVAS_H, configurable: true })
    return canvas
  },
  unproject: ([x, y]) => ({
    lng: state.lng + (x - CANVAS_W / 2) * 0.00001,
    lat: state.lat - (y - CANVAS_H / 2) * 0.00001,
  }),
  jumpTo: ({ center, zoom }) => {
    state.lng = center.lng
    state.lat = center.lat
    state.zoom = zoom
    jumps.push({ lng: state.lng, lat: state.lat, zoom })
  },
  triggerRepaint: () => {
    repaints++
  },
}

const harness = createFogHarness()
/**
 * A real layer, never added to a map. `stats()` reads its own fields and touches no GL, which is
 * exactly what the overlay's per-frame sampler calls — so the sampler is exercised for real.
 */
const layer = new FogMaskLayer({ timeSource: () => 0 })
layer.setInstances(new Float32Array(4 * 1234), 11, { supersedesRoute: true })

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ExploredProvider uid={null}>
      <PerfOverlay map={fakeMap} layer={layer} harness={harness} />
    </ExploredProvider>
  </StrictMode>,
)

const out = document.getElementById("out")
const started = Date.now()

/** Poll the DOM rather than reaching into React. What the operator sees is what is asserted. */
function waitFor(what, predicate, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const tick = () => {
      let value
      try {
        value = predicate()
      } catch (error) {
        reject(error)
        return
      }
      if (value) {
        resolve(value)
        return
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`timed out waiting for ${what}`))
        return
      }
      // `setTimeout`, for the reason the rAF shim above gives — and directly, so this poll does not
      // depend on the shim being in place.
      window.setTimeout(tick, 4)
    }
    tick()
  })
}

const panel = () => document.querySelector('[data-testid="fog-perf-overlay"]')
const button = () => [...document.querySelectorAll("button")].find((b) => /Run scripted/.test(b.textContent))

async function main() {
  /* ─── 1. The panel renders at all, under the flag ─────────────────────────── */
  await waitFor("the overlay panel", panel, 10_000)
  notes.push("panel         rendered under ?fog=perf")

  /* ─── 2. The provider's perf branch loads a synthetic set ──────────────────── */
  // `?fog=perf:here:50k` regenerates around `readCamera() ?? EXTRACT_FALLBACK` — no fetch, which is
  // what makes this runnable over file:// at all.
  await waitFor("the explored set to be ready", () => {
    const run = button()
    return run && !run.disabled
  })
  const loaded = panel().textContent

  /**
   * The dataset line must be on screen AFTER the set is ready, not only while it loads. This
   * assertion is the reason `perf-overlay.tsx` no longer renders it under `!ready`: `here` mode puts
   * synthetic ground over the operator's own neighbourhood and nothing else on this page says so.
   */
  if (!/49,537 cells/.test(loaded)) {
    fail.push(`the panel does not name the loaded dataset once ready — panel said: ${loaded.slice(0, 200)}`)
  }
  if (!/NOT this account's territory/.test(loaded)) {
    fail.push("the synthetic set is not labelled as synthetic on screen once it is ready")
  }
  notes.push(`provider      ${/[^·]*NOT this account's territory\./.exec(loaded)?.[0]?.trim() ?? "(no message)"}`)

  /* ─── 3. The button runs the path ─────────────────────────────────────────── */
  button().click()
  await waitFor("the report", () => panel().textContent.includes("LOST SOLES — fog perf harness"), 120_000)

  const report = panel().querySelector("pre")?.textContent ?? ""

  for (const needle of [
    "visibleInstanceCount",
    "GPU mask",
    "frame — ",
    "cull time — pan",
    "bucket cache hit rate",
    "long tasks during pan",
    "peak JS heap",
    "frame time, per phase",
    "visibleInstanceCount, per zoom",
    "VERDICT:",
  ]) {
    if (!report.includes(needle)) fail.push(`the summary table is missing "${needle}"`)
  }

  /* ─── 4. The path actually drove the map ──────────────────────────────────── */
  if (jumps.length === 0) fail.push("the scripted path never moved the camera")
  const zooms = jumps.map((j) => j.zoom)
  if (Math.min(...zooms) > 6) fail.push(`the zoom sweep never reached z5 — lowest was ${Math.min(...zooms)}`)
  if (Math.max(...zooms) < 16.5) fail.push(`the zoom sweep never reached z17 — highest was ${Math.max(...zooms)}`)
  if (repaints === 0) fail.push("triggerRepaint was never called, so `settle` measured nothing")

  /**
   * THE TWO `pan-across` SEGMENTS MUST CANCEL — checked against the REAL jump log rather than the
   * table, because it is the property that keeps every later phase over the dataset's centre.
   *
   * Measured at the END of `pan-across`, not at the end of the path: `pan-z17` pans 360 px east
   * afterwards and is supposed to. The first version of this check compared the last jump to the
   * first and reported a correct path as broken.
   */
  const PATH_TOTAL = 60 + 30 + 240 + 120 + 120 + 120
  /**
   * `PerfOverlay.run` jumps ONCE before the path starts — to the fixture's centre, or to the current
   * one at z14 in `here` mode — so the jump log is one longer than the path and every fixed index is
   * off by one. That cost a red assertion reporting a residual of exactly 4 px, which is one step of
   * `pan-across`, which is what an off-by-one in a cancelling pair looks like.
   */
  const base = jumps.length - PATH_TOTAL
  if (base !== 1) fail.push(`expected exactly 1 pre-path jump, saw ${base}`)
  const beforePanAcross = jumps[base + 60 + 30 - 1]
  const afterPanAcross = jumps[base + 60 + 30 + 240 - 1]
  const returned = Math.abs(afterPanAcross.lng - beforePanAcross.lng) < 1e-9
  if (!returned) {
    fail.push(
      `pan-across did not return to where it started: ${beforePanAcross.lng} -> ${afterPanAcross.lng}`,
    )
  }
  notes.push(`path          ${jumps.length} camera states, z${Math.min(...zooms)}..z${Math.max(...zooms)}, ` +
    `${repaints} repaints, pan-across returns: ${returned}`)

  /* ─── 5. The phases the report asserts on all ran ──────────────────────────── */
  for (const phase of ["settle", "pan-inside", "pan-across", "zoom-out", "zoom-in", "pan-z17"]) {
    if (!report.includes(phase)) fail.push(`phase "${phase}" is missing from the per-phase table`)
  }

  /**
   * The instrument that is easiest to break silently: the per-frame sampler reads `layer.stats()`,
   * and this layer was handed exactly 1,234 instances. A histogram that came back empty, or full of
   * zeroes, would mean the sampler never ran or read the wrong thing.
   */
  if (!/1,234/.test(report)) {
    fail.push("the instance histogram does not contain the 1,234 instances the layer was given")
  }

  /* ─── 6. Copy is offered once there is something to copy ───────────────────── */
  const copy = [...document.querySelectorAll("button")].find((b) => b.textContent === "Copy")
  if (!copy) fail.push("no Copy button after the run — the operator has to transcribe from a photo")

  const head = fail.length === 0 ? "OVERLAY HARNESS PASS" : `OVERLAY HARNESS FAIL (${fail.length})`
  document.title = head
  out.textContent = [head, ...fail.map((f) => `  x ${f}`), "", ...notes, "", report].join("\n")
}

main().catch((error) => {
  document.title = "OVERLAY HARNESS FAIL (1)"
  out.textContent = `OVERLAY HARNESS FAIL (1)\n  x ${error && error.stack ? error.stack : error}`
})
