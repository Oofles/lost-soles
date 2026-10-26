// Ticket 0112 — "prefers-reduced-motion renders the fog static and schedules ZERO requestAnimationFrame
// callbacks after first paint", in a real browser, with a real MapLibre Map and the shipped fog.
// Bundled by run-reduced-motion.mjs, which runs it twice: once under emulated `reduce` and once
// without, the control that proves the counter can see a running loop at all.
//
// WHAT IS REAL: `maplibre-gl`, the shipped `FogMaskLayer` with a real bucket, and the shipped
// `FogAnimator` on the shipped `browserAnimationHost` — wired the way `use-fog-mask.ts` wires them,
// in ADVENTURE (not frozen), the mode whose mist moves and so the one that must stop. `matchMedia`
// is the browser's own, answering whatever the CDP emulation set.
//
// THE SPY is `window.requestAnimationFrame` itself, wrapped before any script runs (the runner
// installs it with `addScriptToEvaluateOnNewDocument`). Every caller is counted: the animator,
// MapLibre's own render scheduling, anything else on the page. "After first paint" is MapLibre's
// first `idle`, plus two frames, which is the moment `map-shell.tsx` marks the map painted (D-439).
import { gridDisk, latLngToCell } from "h3-js"
import * as maplibre from "maplibre-gl"

import { browserAnimationHost, FogAnimator } from "../../lib/fog/animation.ts"
import { packBucket } from "../../lib/fog/instances.ts"
import { FogMaskLayer } from "../../lib/fog/mask-layer.ts"

/** Point Nemo (D-199): no basemap is needed to ask whether anything keeps drawing. */
const NEMO = { lat: -48.876, lng: -123.393 }
const WINDOW_MS = 3000

const map = new maplibre.Map({
  container: "map",
  style: { version: 8, sources: {}, layers: [] },
  center: [NEMO.lng, NEMO.lat],
  zoom: 15,
  attributionControl: false,
})

let renders = 0
map.on("render", () => renders++)

map.on("load", () => {
  const animator = new FogAnimator(browserAnimationHost(() => map.triggerRepaint()))
  const layer = new FogMaskLayer({ timeSource: () => animator.time() })
  animator.setFrozen(false) // adventure: the animated mode
  map.addLayer(layer)
  layer.setBucket(packBucket(gridDisk(latLngToCell(NEMO.lat, NEMO.lng, 10), 25)))
  animator.start()

  map.once("idle", () => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        // First paint, as map-shell marks it. Everything after this is what the criterion counts.
        const spy = window.__raf
        const callsAt = spy.calls
        const rendersAt = renders
        const timeAt = animator.time()
        setTimeout(() => {
          window.__result = {
            reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
            rafAfterFirstPaint: spy.calls - callsAt,
            rendersAfterFirstPaint: renders - rendersAt,
            uTime: animator.time(),
            uTimeAtFirstPaint: timeAt,
            isStatic: animator.isStatic(),
            composites: layer.stats().composites,
            animatorRepaints: animator.repaints,
            windowMs: WINDOW_MS,
          }
        }, WINDOW_MS)
      }),
    )
  })
})
