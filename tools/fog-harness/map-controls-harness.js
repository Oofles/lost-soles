// Ticket 0101 — the map's input model on a REAL MapLibre Map. Bundled by run-map-controls.mjs.
//
// What `lib/map-controls.test.ts` cannot prove, because it has no WebGL and no event loop:
//
//   - with the shipped `MAP_INPUT_OPTIONS`, a right-drag and a Ctrl-drag — MapLibre's own dragRotate
//     and pitch gestures, as real DOM events — leave `getBearing()` and `getPitch()` at 0, while the
//     SAME events on a control Map built with MapLibre's defaults do rotate it (so the events are
//     real input, not a no-op);
//   - an over-zoom past z18 and past z10 by the wheel settles back inside [10, 18] through the
//     shipped `settleZoom` on `moveend`;
//   - in both variants the route is above the fog, the glow is 0.35 in adventure and 0 in atlas
//     (`MODE_FRAMES`), the core is the one cream colour, and the trace web takes the run page's
//     settled k (0.18 for a path run once).
//
// No tiles are fetched: the STYLE is the shipped one, tiles are not needed for any of this.
import * as maplibre from "maplibre-gl"

import { basemapStyle, swapBasemap } from "../../lib/basemap.ts"
import { FogMaskLayer } from "../../lib/fog/mask-layer.ts"
import { lockOrientation, MAP_INPUT_OPTIONS, settleZoom, ZOOM_MAX, ZOOM_MIN } from "../../lib/map-controls.ts"
import { RUN_CORE_ID, RUN_GLOW_ID, fogBeforeId, routeIsAboveFog, setRunGeometry } from "../../lib/map-layers.ts"
import { MODE_FRAMES } from "../../lib/map-mode.ts"
import { RUN_PAGE_TRACE_K, TRACE_LAYER_ID, setTraceK, setTraceWeb, traceOpacity } from "../../lib/trace-web/layer.ts"

/** POINT NEMO — D-199: no committed coordinate near where anyone runs. */
const NEMO = { lat: -48.876123456789, lng: -123.393987654321 }
const CORE = "rgb(255, 238, 204)"
const GLOW = "rgb(170, 136, 68)"

const fail = []
const notes = []

/** Where the run is, in the page, so a hang says where it hung. */
const step = (label) => {
  document.getElementById("out").textContent = `pending: ${label}`
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
/**
 * N FRAMES, PUMPED. MapLibre applies accumulated input (and camera animations) on its render frame,
 * and headless Chromium under a virtual-time budget hands out requestAnimationFrame unreliably — the
 * first draft waited on rAF and timers and passed one run in three. `redraw()` runs a frame
 * synchronously, render task queue included, so each step here is one timer tick (virtual time
 * advances, so `browser.now()` does) and one real frame.
 */
const pump = async (map, n = 1) => {
  for (let i = 0; i < n; i++) {
    await wait(16)
    map.redraw()
  }
}

function build(id, options) {
  const el = document.createElement("div")
  el.id = id
  // Every Map in the same place, inside the viewport, so a synthetic event's client point is on it.
  el.style.cssText = "position:absolute;left:0;top:0;width:1000px;height:700px"
  document.body.appendChild(el)
  return new maplibre.Map({
    container: el,
    style: basemapStyle("adventure"),
    center: [NEMO.lng, NEMO.lat],
    zoom: 14,
    attributionControl: false,
    ...options,
  })
}

function loaded(map) {
  // `style.load` can fire inside the constructor for an inline style object, before a listener is
  // attached; a poll on `isStyleLoaded` covers both orders.
  return new Promise((resolve) => {
    const poll = () => (map.isStyleLoaded() ? resolve() : setTimeout(poll, 20))
    poll()
  })
}

/** A real drag, as the browser would deliver it: down on the canvas container, moves and up on the window. */
async function drag(map, { button, ctrlKey = false }) {
  const target = map.getCanvasContainer()
  const box = target.getBoundingClientRect()
  const x0 = box.left + 500
  const y0 = box.top + 350
  const buttons = button === 2 ? 2 : 1
  const common = { bubbles: true, cancelable: true, view: window, ctrlKey }
  target.dispatchEvent(new MouseEvent("mousedown", { ...common, button, buttons, clientX: x0, clientY: y0 }))
  await pump(map)
  for (let i = 1; i <= 12; i++) {
    await pump(map)
    window.document.dispatchEvent(
      new MouseEvent("mousemove", { ...common, button, buttons, clientX: x0 + i * 20, clientY: y0 - i * 12 }),
    )
  }
  await pump(map)
  window.document.dispatchEvent(new MouseEvent("mouseup", { ...common, button, buttons: 0, clientX: x0 + 240, clientY: y0 - 144 }))
  await pump(map, 40)
}

async function wheel(map, deltaY, times) {
  const target = map.getCanvasContainer()
  const box = target.getBoundingClientRect()
  for (let i = 0; i < times; i++) {
    target.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY, deltaMode: 0, clientX: box.left + 300, clientY: box.top + 200 }),
    )
    await pump(map, 3)
  }
}

/** The shipped settle, wired as `MapShell` wires it. */
function wireSettle(map) {
  map.on("moveend", () => {
    const settled = settleZoom(map.getZoom())
    if (settled !== null) map.easeTo({ zoom: settled, duration: 250 })
  })
}

async function run() {
  // ── criterion 2: rotation and tilt are off at the options level ────────────────────────────
  // Every Map built up front and awaited together: a Map built later, mid-run, could wait on its
  // worker in real time while the virtual-time budget drained on the poll (a hang, one run in two).
  const GESTURES = [
    ["right-drag", { button: 2 }],
    ["Ctrl-drag", { button: 0, ctrlKey: true }],
  ]
  const shipped = build("shipped", { ...MAP_INPUT_OPTIONS, bearing: 0, pitch: 0 })
  lockOrientation(shipped)
  wireSettle(shipped)
  // A control Map per gesture, on MapLibre's defaults: a second synthetic drag on one Map is not
  // picked up, so a shared control would make the second gesture's baseline meaningless.
  const controls = GESTURES.map((_, i) => build(`control-${i}`, {}))
  step("loading")
  await Promise.all([shipped, ...controls].map(loaded))

  for (const [i, [label, gesture]] of GESTURES.entries()) {
    const control = controls[i]
    // Only the Map under test on top, so its container is the one the client point lands on.
    for (const c of [shipped, ...controls]) c.getContainer().style.zIndex = c === control ? "1" : "0"
    step(`${label}: drag`)
    await drag(control, gesture)
    const moved = control.getBearing() !== 0 || control.getPitch() !== 0
    if (!moved) fail.push(`${label}: the control Map (MapLibre defaults) did not rotate or tilt — the synthetic events are not real input`)
    shipped.getContainer().style.zIndex = "1"
    control.getContainer().style.zIndex = "0"
    await drag(shipped, gesture)
    notes.push(
      `${label.padEnd(10)} control bearing ${control.getBearing().toFixed(2)} pitch ${control.getPitch().toFixed(2)}; ` +
        `shipped bearing ${shipped.getBearing()} pitch ${shipped.getPitch()}`,
    )
    if (shipped.getBearing() !== 0) fail.push(`${label}: getBearing() = ${shipped.getBearing()}, not 0`)
    if (shipped.getPitch() !== 0) fail.push(`${label}: getPitch() = ${shipped.getPitch()}, not 0`)
    control.remove()
  }
  for (const h of ["dragRotate", "touchPitch"]) {
    if (shipped[h].isEnabled()) fail.push(`${h} is enabled on the shipped Map`)
  }

  step("zoom")
  // ── criterion 3: zoom clamps to [10, 18] with a rubber band that settles back ──────────────
  for (const [label, start, deltaY] of [
    ["over z18", 17.8, -600],
    ["under z10", 10.2, 600],
  ]) {
    shipped.jumpTo({ zoom: start })
    await pump(shipped, 5)
    let peak = start
    const track = () => {
      const z = shipped.getZoom()
      peak = deltaY < 0 ? Math.max(peak, z) : Math.min(peak, z)
    }
    shipped.on("move", track)
    await wheel(shipped, deltaY, 12)
    await pump(shipped, 120)
    shipped.off("move", track)
    const settled = shipped.getZoom()
    notes.push(`${label.padEnd(10)} from z${start}: peak z${peak.toFixed(3)}, settled z${settled.toFixed(3)}`)
    const overshot = deltaY < 0 ? peak > ZOOM_MAX : peak < ZOOM_MIN
    if (!overshot) fail.push(`${label}: the wheel never carried past the bound (peak z${peak}) — no rubber band to test`)
    if (settled < ZOOM_MIN || settled > ZOOM_MAX) fail.push(`${label}: settled at z${settled}, outside [10, 18]`)
  }

  // ── criterion 6: route above the fog in both modes, the tabled glow, the dimmed web ───────
  const line = {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: { wear: 0.28 }, geometry: { type: "LineString", coordinates: [[NEMO.lng, NEMO.lat], [NEMO.lng + 0.01, NEMO.lat]] } }],
  }
  setTraceK(shipped, RUN_PAGE_TRACE_K)
  setTraceWeb(shipped, line, "rgb(85, 102, 119)")
  shipped.addLayer(new FogMaskLayer({ timeSource: () => 0 }), fogBeforeId(shipped))
  setRunGeometry(shipped, line, { glow: GLOW, core: CORE })
  for (const variant of ["adventure", "atlas", "adventure"]) {
    if (variant !== "adventure" || shipped.getLayer("fog-mask") === undefined) swapBasemap(shipped, variant)
    shipped.setPaintProperty(RUN_GLOW_ID, "line-opacity", MODE_FRAMES[variant].routeGlowOpacity)
    shipped.redraw()
    const order = shipped.getLayersOrder().map((id) => ({ id }))
    if (!routeIsAboveFog(order)) fail.push(`${variant}: the route is not above the fog`)
    if (order.at(-1).id !== RUN_CORE_ID) fail.push(`${variant}: the route core is not topmost (${order.at(-1).id})`)
    const glow = shipped.getPaintProperty(RUN_GLOW_ID, "line-opacity")
    const want = variant === "atlas" ? 0 : 0.35
    if (glow !== want) fail.push(`${variant}: glow opacity ${glow}, not ${want}`)
    const core = shipped.getPaintProperty(RUN_CORE_ID, "line-color")
    if (String(core) !== CORE && JSON.stringify(core) !== JSON.stringify(CORE)) fail.push(`${variant}: core colour changed to ${core}`)
    const web = shipped.getPaintProperty(TRACE_LAYER_ID, "line-opacity")
    if (JSON.stringify(web) !== JSON.stringify(traceOpacity(RUN_PAGE_TRACE_K))) fail.push(`${variant}: trace web opacity ${JSON.stringify(web)}`)
    notes.push(`${variant.padEnd(10)} glow ${glow}, web ${JSON.stringify(web)} (once-run ${(RUN_PAGE_TRACE_K * 0.28).toFixed(3)})`)
  }
}

run()
  .catch((error) => fail.push(`threw: ${error.stack ?? error.message}`))
  .finally(() => {
    const head = fail.length === 0 ? "MAP CONTROLS HARNESS PASS" : `MAP CONTROLS HARNESS FAIL (${fail.length})`
    document.title = head
    document.getElementById("out").textContent = [head, ...fail.map((f) => `  x ${f}`), "", `maplibre       ${maplibre.getVersion()}`, ...notes].join("\n")
  })
