import { gridDisk, latLngToCell } from "h3-js"
import { describe, expect, it } from "vitest"

import { cellToBig } from "@/src/domain/explored-blob"
import { RES } from "@/src/domain/fog"

import { ExploredSet } from "./explored-set"
import {
  BUCKET_DEBOUNCE_MS,
  FogViewportController,
  type ControllerHost,
  type ControllerMap,
} from "./viewport-controller"
import { resForZoom, ZoomBucketStore } from "./zoom-buckets"

/**
 * Ticket `0058`, criteria 2, 6, 7 and 8. `05-fog-of-war.md` §6.1, §6.2.
 *
 * Every assertion in this file is about work **not** happening — zero uploads for a small pan, two
 * bucket switches across a gesture that crosses seven bands, zero anything while hidden. That is why
 * the clock and the map are injected: "the handler was not called" is not a claim you can make about a
 * real MapLibre map and a real `setTimeout` without waiting, and a test that waits is a test that is
 * eventually flaky. `animation.ts` made the same choice for the same reason.
 *
 * Point Nemo (`08` §7.2, D-199).
 */
const NEMO = { lat: -48.876, lng: -123.393 }

function solidDisc(k: number): ExploredSet {
  const cells = gridDisk(latLngToCell(NEMO.lat, NEMO.lng, RES), k)
    .map(cellToBig)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return ExploredSet.fromCells(BigUint64Array.from(cells), 1)
}

/** Inverse web mercator, so the fake map can answer `getBounds()` in lng/lat like the real one. */
const lngOf = (x: number) => (x - 0.5) * 360
const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI
const xOf = (lng: number) => lng / 360 + 0.5
const yOf = (lat: number) =>
  0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI)

interface FakeMap extends ControllerMap {
  /** Move the camera and fire the events MapLibre would. */
  move(change: { zoom?: number; lng?: number; lat?: number }): void
  listeners: number
  repaints: number
}

/** A 400×800 CSS px viewport, MapLibre's 512-px-at-z0 scale. */
function fakeMap(zoom = 15, centre = NEMO): FakeMap {
  const handlers = new Set<() => void>()
  let camera = { zoom, lng: centre.lng, lat: centre.lat }
  let repaints = 0
  const map: FakeMap = {
    getZoom: () => camera.zoom,
    getBounds() {
      const perPx = 1 / (512 * 2 ** camera.zoom)
      const x = xOf(camera.lng)
      const y = yOf(camera.lat)
      return {
        getWest: () => lngOf(x - (400 * perPx) / 2),
        getEast: () => lngOf(x + (400 * perPx) / 2),
        getNorth: () => latOf(y - (800 * perPx) / 2),
        getSouth: () => latOf(y + (800 * perPx) / 2),
      }
    },
    on: (_event, handler) => handlers.add(handler),
    off: (_event, handler) => handlers.delete(handler),
    triggerRepaint: () => {
      repaints++
    },
    move(change) {
      camera = { ...camera, ...change }
      // MapLibre fires `move` on every camera change and `zoom` as well when the zoom changed; the
      // controller subscribes to both, so a pinch reaches it twice per frame. That is the duplication
      // `resForZoom` and the debounce exist to absorb, so the fake reproduces it.
      for (const handler of [...handlers]) handler()
      if (change.zoom !== undefined) for (const handler of [...handlers]) handler()
    },
    get listeners() {
      return handlers.size
    },
    get repaints() {
      return repaints
    },
  }
  return map
}

/** A clock that only moves when a test says so, and timers that only fire when a test runs them. */
function fakeHost(): ControllerHost & { advance(ms: number): void; run(): number; pending: number } {
  let clock = 1_000
  let next = 1
  const timers = new Map<number, { at: number; fire: () => void }>()
  return {
    now: () => clock,
    setTimeout(fire, ms) {
      const handle = next++
      timers.set(handle, { at: clock + ms, fire })
      return handle
    },
    clearTimeout(handle) {
      timers.delete(handle)
    },
    advance(ms) {
      clock += ms
    },
    /** Fire every timer that is due, and report how many fired. */
    run() {
      let fired = 0
      for (const [handle, timer] of [...timers]) {
        if (timer.at > clock) continue
        timers.delete(handle)
        timer.fire()
        fired++
      }
      return fired
    },
    get pending() {
      return timers.size
    },
  }
}

function controllerOn(options: { zoom?: number; k?: number } = {}) {
  const map = fakeMap(options.zoom ?? 15)
  const host = fakeHost()
  const store = new ZoomBucketStore(solidDisc(options.k ?? 30))
  const uploads: Array<{ count: number; res: number; fromData: boolean }> = []
  const controller = new FogViewportController({
    map,
    store,
    host,
    onInstances: (instances, _result, res, fromData) =>
      uploads.push({ count: instances.length / 4, res, fromData }),
  })
  return { map, host, store, controller, uploads }
}

describe("start and stop", () => {
  it("builds once on start, at the bucket the zoom asks for", () => {
    const { controller, uploads, map } = controllerOn({ zoom: 15 })
    controller.start()

    expect(uploads).toHaveLength(1)
    expect(uploads[0]!.res).toBe(RES)
    expect(uploads[0]!.count).toBeGreaterThan(0)
    expect(controller.stats().culls).toBe(1)
    expect(map.listeners).toBeGreaterThan(0)
    // The buffer is uploaded in the next `prerender`, and MapLibre only renders when something asks.
    expect(map.repaints).toBe(1)
  })

  it("is idempotent, and detaches on stop", () => {
    const { controller, map } = controllerOn()
    controller.start()
    controller.start()
    expect(controller.stats().culls).toBe(1)

    controller.stop()
    expect(map.listeners).toBe(0)
    map.move({ lng: NEMO.lng + 1 })
    expect(controller.stats().culls).toBe(1)
  })
})

/**
 * CRITERION 6. §6.2: *"pad the viewport by ~20% and cache the instance buffer. Only rebuild the VBO
 * when the camera leaves the padded region or the bucket changes. Small pans then cost **zero** CPU."*
 */
describe("the padded region — criterion 6", () => {
  it("does nothing at all for a pan that stays inside it", () => {
    const { controller, uploads, map } = controllerOn({ zoom: 15 })
    controller.start()
    const width = 400 / (512 * 2 ** 15) // one viewport width, in mercator
    const degreesPerViewport = width * 360

    // Eight small steps, together well inside the 20% pad.
    for (let i = 0; i < 8; i++) {
      map.move({ lng: NEMO.lng + ((i + 1) * degreesPerViewport) / 100 })
    }

    expect(controller.stats().cameraEvents).toBe(8)
    // ZERO VBO UPLOADS, which is the criterion stated as the one number that proves it.
    expect(uploads).toHaveLength(1)
    expect(controller.stats().culls).toBe(1)
  })

  it("rebuilds once when the camera leaves it", () => {
    const { controller, uploads, map } = controllerOn({ zoom: 15 })
    controller.start()
    const degreesPerViewport = (400 / (512 * 2 ** 15)) * 360

    map.move({ lng: NEMO.lng + degreesPerViewport * 0.5 })
    expect(uploads).toHaveLength(2)
    expect(controller.stats().res).toBe(RES)

    // And the new padded region is around the new position, so the next small pan is free again.
    map.move({ lng: NEMO.lng + degreesPerViewport * 0.51 })
    expect(uploads).toHaveLength(2)
  })
})

/**
 * CRITERION 2. §6.1: *"re-derive only when the bucket index changes, debounced ~250 ms — not on every
 * zoom event. That debounce is the single lesson worth copying wholesale from Dawarich."*
 */
describe("the bucket debounce — criterion 2", () => {
  it("collapses a continuous pinch across seven bands into two switches", () => {
    const { controller, store, map, host } = controllerOn({ zoom: 17 })
    controller.start()
    const startSwitches = controller.stats().bucketSwitches

    /** A pinch out, 0.2 zoom levels at a time: 60 camera events crossing every band in the table. */
    const bands = new Set<number>()
    for (let z = 17; z >= 5; z -= 0.2) {
      // Rounded once and used for both, because `z -= 0.2` accumulates enough float error to land
      // 6.000000000000004 in the wrong band and make this test lie about what the gesture crossed.
      const zoom = Number(z.toFixed(1))
      map.move({ zoom })
      bands.add(resForZoom(zoom))
    }
    // The gesture really did cross the whole table.
    expect(bands.size).toBe(8)
    expect(controller.stats().cameraEvents).toBeGreaterThan(100)

    // Nothing has switched yet beyond the leading edge: the clock has not moved, so every band change
    // inside the window coalesced into one pending timer.
    expect(host.pending).toBe(1)
    expect(controller.stats().bucketSwitches).toBe(startSwitches)

    host.advance(BUCKET_DEBOUNCE_MS)
    expect(host.run()).toBe(1)
    expect(controller.stats().bucketSwitches).toBe(startSwitches + 1)
    // One index per resolution actually rendered — not one per band crossed.
    expect(store.indexDerivations).toBe(2)
    expect(controller.stats().res).toBe(resForZoom(5))
  })

  it("switches immediately when the last switch is older than the window", () => {
    const { controller, map, host } = controllerOn({ zoom: 15 })
    controller.start()
    host.advance(BUCKET_DEBOUNCE_MS)

    map.move({ zoom: 12 })
    // Leading edge: a deliberate zoom after a pause has no reason to wait a quarter of a second.
    expect(host.pending).toBe(0)
    expect(controller.stats().res).toBe(9)
  })

  it("does not re-cull the old bucket while a switch is pending", () => {
    const { controller, uploads, map, host } = controllerOn({ zoom: 16 })
    controller.start()
    const before = uploads.length

    // Zoom out one band, then pan a long way while the switch is still pending.
    map.move({ zoom: 12 })
    expect(host.pending).toBe(1)
    map.move({ lng: NEMO.lng + 5 })
    /**
     * Still nothing. Re-culling the res-11 bucket for a z12 viewport would be ~50× the instances for
     * a quarter of a second — exactly the spike §6.4's ceiling exists to prevent — and the fog already
     * on screen is real fog on real ground, because the instances are mercator positions.
     */
    expect(uploads).toHaveLength(before)

    host.advance(BUCKET_DEBOUNCE_MS)
    host.run()
    expect(uploads).toHaveLength(before + 1)
    expect(uploads.at(-1)!.res).toBe(9)
  })
})

/**
 * CRITERION 8. §6.2: *"skip everything when the layer is hidden. Detach the move handlers and cancel
 * the rAF loop."* The rAF half is `FogAnimator`'s and the GL half is `FogMaskLayer.setHidden`; this is
 * the cull's.
 */
describe("hidden — criterion 8", () => {
  it("detaches the camera handlers, so a move cannot reach it at all", () => {
    const { controller, uploads, map } = controllerOn()
    controller.start()
    const before = uploads.length

    controller.setHidden(true)
    expect(map.listeners).toBe(0)

    for (let i = 0; i < 20; i++) map.move({ zoom: 10 + i / 4, lng: NEMO.lng + i })
    expect(uploads).toHaveLength(before)
    expect(controller.stats().culls).toBe(1)
    /**
     * ZERO, and this is the assertion that makes the others mean something. An implementation that
     * returned early inside the handler would leave this at 20 — still "no work" by the criterion's
     * letter, but still paying MapLibre's dispatch and still reachable from its listener list.
     */
    expect(controller.stats().eventsWhileHidden).toBe(0)
    expect(controller.stats().cameraEvents).toBe(0)
  })

  it("cancels a pending switch rather than firing it into a hidden map", () => {
    const { controller, uploads, map, host } = controllerOn({ zoom: 16 })
    controller.start()
    map.move({ zoom: 11 })
    expect(host.pending).toBe(1)

    controller.setHidden(true)
    expect(host.pending).toBe(0)
    host.advance(BUCKET_DEBOUNCE_MS)
    host.run()
    expect(uploads).toHaveLength(1)
  })

  it("rebuilds once on the way back, because the camera moved while nobody was listening", () => {
    const { controller, uploads, map } = controllerOn({ zoom: 15 })
    controller.start()
    controller.setHidden(true)
    map.move({ zoom: 11, lng: NEMO.lng + 3 })

    controller.setHidden(false)
    expect(map.listeners).toBeGreaterThan(0)
    expect(uploads).toHaveLength(2)
    expect(uploads.at(-1)!.res).toBe(8)
  })

  it("ignores a data change while hidden — the rebuild on un-hide covers it", () => {
    const { controller, uploads } = controllerOn()
    controller.start()
    controller.setHidden(true)
    controller.refresh("a run landed")
    expect(uploads).toHaveLength(1)
    controller.setHidden(false)
    expect(uploads).toHaveLength(2)
  })
})

describe("a data change", () => {
  it("rebuilds now rather than waiting for a camera event", () => {
    const { controller, uploads } = controllerOn()
    controller.start()
    controller.refresh("generation 57")
    expect(uploads).toHaveLength(2)
    // No bucket switch: the resolution did not change, only the data under it.
    expect(controller.stats().bucketSwitches).toBe(1)
  })

  /**
   * The flag `0057`'s optimistic corridor turns on. A camera rebuild must not report itself as new
   * data, or the corridor is cleared by a pan — see `FogMaskLayer.setInstances`.
   */
  it("distinguishes itself from a camera rebuild", () => {
    const { controller, uploads, map, host } = controllerOn({ zoom: 15 })
    controller.start()
    expect(uploads.at(-1)!.fromData).toBe(false)

    controller.refresh("generation 57")
    expect(uploads.at(-1)!.fromData).toBe(true)

    map.move({ lng: NEMO.lng + (400 / (512 * 2 ** 15)) * 360 * 0.6 })
    expect(uploads.at(-1)!.fromData).toBe(false)

    host.advance(BUCKET_DEBOUNCE_MS)
    map.move({ zoom: 11 })
    expect(uploads.at(-1)!.fromData).toBe(false)

    controller.setHidden(true)
    controller.setHidden(false)
    expect(uploads.at(-1)!.fromData).toBe(false)
  })

  it("does nothing before start, so a delta that lands early is not lost but is not drawn twice", () => {
    const { controller, uploads } = controllerOn()
    controller.refresh("early")
    expect(uploads).toHaveLength(0)
    controller.start()
    expect(uploads).toHaveLength(1)
  })
})
