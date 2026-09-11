import { describe, expect, it } from "vitest"

import { FogPerf, type PerfHost } from "./collector"
import { VIEWPORT_PAD } from "../cull"
import {
  driveScriptedPath,
  PATH,
  PATH_STEPS,
  stepsPerPhase,
  type PathHost,
  type PathMap,
  type PathSegment,
} from "./camera-path"

/**
 * Ticket `0059` criterion 3 — *"the scripted camera path is deterministic and replayable"*.
 *
 * Determinism is the whole claim and it is testable without a browser: drive the same path against
 * the same fake map twice and the two lists of camera states must be identical. That is the assertion
 * an `easeTo`-based path could not pass, and the reason this module exists in the shape it does.
 */

const silentHost: PerfHost = {
  now: () => 0,
  mark: () => {},
  measure: () => {},
  heapBytes: () => null,
  observeLongTasks: () => () => {},
}

/** rAF that resolves immediately, so a 690-step path runs in a test rather than in 11 seconds. */
function syncHost(): PathHost {
  let t = 0
  return {
    now: () => (t += 16),
    requestAnimationFrame: (callback) => {
      callback()
      return 0
    },
  }
}

/**
 * A map whose `unproject` is a straight linear pixel-to-degree mapping. Not MapLibre's projection —
 * it does not need to be. What is under test is that the DRIVER asks the map to convert, that it
 * asks from the canvas centre, and that the resulting sequence repeats; a real projection would make
 * the expected values unreadable without proving anything extra.
 */
function fakeMap(options: { width?: number; height?: number } = {}) {
  const width = options.width ?? 400
  const height = options.height ?? 800
  const state = { lng: 100, lat: 30, zoom: 14 }
  const states: { lng: number; lat: number; zoom: number }[] = []
  const repaints = { count: 0 }

  const map: PathMap = {
    getZoom: () => state.zoom,
    getCenter: () => ({ lng: state.lng, lat: state.lat }),
    getCanvas: () => ({ clientWidth: width, clientHeight: height }),
    unproject: ([x, y]) => ({
      lng: state.lng + (x - width / 2) * 0.001,
      lat: state.lat - (y - height / 2) * 0.001,
    }),
    jumpTo: ({ center, zoom }) => {
      state.lng = center.lng
      state.lat = center.lat
      state.zoom = zoom
      states.push({ ...state })
    },
    triggerRepaint: () => {
      repaints.count++
    },
  }
  return { map, states, repaints }
}

describe("the path itself", () => {
  it("names every phase the report asserts on, in the order the ticket describes", () => {
    expect([...stepsPerPhase().keys()]).toEqual([
      "settle",
      "pan-inside",
      "pan-across",
      "zoom-out",
      "zoom-in",
      "pan-z17",
    ])
  })

  /**
   * The two `pan-across` segments must cancel, or every phase after them happens over ground offset
   * from the dataset's centre — which at the 50k size is far enough for the disc's edge to enter the
   * viewport and make the cross-dataset canary report geometry as drift.
   */
  it("returns pan-across to where it started", () => {
    const travel = PATH.filter((s) => s.phase === "pan-across").reduce(
      (sum, s) => sum + s.dxFrac * s.steps,
      0,
    )
    expect(travel).toBe(0)
  })

  /**
   * `pan-inside`'s entire assertion is ZERO CULLS, and it only holds if the total displacement stays
   * inside the padded region — 20% of the viewport's height on either side (`cull.ts`'s
   * `VIEWPORT_PAD`). On the 400x800 reference viewport that is 160 px. If someone raises the step
   * count or the step size without checking, the phase quietly starts culling and the failure reads
   * as a regression in the controller.
   */
  it("keeps pan-inside inside the padded region on ANY viewport", () => {
    const segment = PATH.find((s) => s.phase === "pan-inside")!
    // A fraction of the viewport, so this holds on a 400x800 phone and a 1902x901 desktop alike —
    // which is the point of the unit and the thing absolute pixels got wrong.
    expect(Math.abs(segment.dyFrac) * segment.steps).toBeLessThan(VIEWPORT_PAD)
  })

  it("leaves the padded region many times over during pan-across", () => {
    const distance = PATH.filter((s) => s.phase === "pan-across").reduce(
      (sum, s) => sum + Math.abs(s.dxFrac) * s.steps,
      0,
    )
    // 2.4 viewport widths, on every screen. In absolute pixels this was 2.4 viewports on a phone and
    // half a viewport on a desktop, so the phase barely rebuilt the buffer there.
    expect(distance).toBeGreaterThan(2)
  })

  it("sweeps z17 down to z5 and back, which is every band in ZOOM_TO_RES", () => {
    const out = PATH.find((s) => s.phase === "zoom-out")!
    expect(out.zoom! + out.dZoom! * (out.steps - 1)).toBeCloseTo(5.1, 5)
    const back = PATH.find((s) => s.phase === "zoom-in")!
    expect(back.zoom! + back.dZoom! * (back.steps - 1)).toBeCloseTo(16.9, 5)
  })
})

describe("driving it", () => {
  it("visits exactly the same camera states on a replay", async () => {
    const first = fakeMap()
    await driveScriptedPath(first.map, new FogPerf(silentHost), { host: syncHost() })

    const second = fakeMap()
    await driveScriptedPath(second.map, new FogPerf(silentHost), { host: syncHost() })

    expect(first.states).toHaveLength(PATH_STEPS)
    expect(second.states).toEqual(first.states)
  })

  /**
   * A path defined in DEGREES would drift out of screen space the moment it moved north. A path in
   * absolute PIXELS is screen-space but not viewport-relative, and the padded region is a fraction of
   * the viewport — so 960 px is 2.4 viewport widths on a phone and half a viewport on a desktop, and
   * `pan-across` stopped rebuilding the buffer on the wider screen. The unit that works is a fraction
   * of the viewport, and this asserts the consequence: a wider screen covers proportionally more
   * ground for the same step.
   */
  it("pans by a fraction of the viewport, so each screen moves by the same share of itself", async () => {
    const phone = fakeMap({ width: 400, height: 800 })
    const desktop = fakeMap({ width: 1600, height: 800 })
    const segment: PathSegment[] = [{ phase: "pan", steps: 4, dxFrac: 0.025, dyFrac: 0, zoom: 14 }]
    await driveScriptedPath(phone.map, new FogPerf(silentHost), { host: syncHost(), path: segment })
    await driveScriptedPath(desktop.map, new FogPerf(silentHost), { host: syncHost(), path: segment })

    // The fake projects a pixel to a fixed number of degrees, so a 4x wider viewport moves 4x as far
    // for the same fraction — which is exactly what absolute pixels failed to do.
    const phoneTravel = phone.states.at(-1)!.lng - 100
    const desktopTravel = desktop.states.at(-1)!.lng - 100
    expect(desktopTravel / phoneTravel).toBeCloseTo(4, 1)

    // And a zero-offset segment still asks the map for nothing and moves not at all.
    const still = fakeMap()
    await driveScriptedPath(still.map, new FogPerf(silentHost), {
      host: syncHost(),
      path: [{ phase: "settle", steps: 3, dxFrac: 0, dyFrac: 0, zoom: 14 }],
    })
    expect(new Set(still.states.map((s) => s.lng)).size).toBe(1)
  })

  it("repaints on a still camera, so settle measures drawn frames rather than idle ones", async () => {
    const fake = fakeMap()
    await driveScriptedPath(fake.map, new FogPerf(silentHost), {
      host: syncHost(),
      path: [{ phase: "settle", steps: 5, dxFrac: 0, dyFrac: 0, zoom: 14 }],
    })
    expect(fake.repaints.count).toBe(5)
  })

  /**
   * SAMPLED BEFORE THE JUMP. At a zoom-band boundary the instance count belongs to the state that was
   * drawn, not to the one about to be set — pairing it with the new zoom is exactly the mis-attribution
   * item 1's histogram exists to rule out.
   */
  it("samples the state that was drawn, not the one about to be set", async () => {
    const fake = fakeMap()
    const seen: number[] = []
    await driveScriptedPath(fake.map, new FogPerf(silentHost), {
      host: syncHost(),
      path: [{ phase: "zoom-out", steps: 3, dxFrac: 0, dyFrac: 0, zoom: 17, dZoom: -1 }],
      onSample: () => seen.push(fake.map.getZoom()),
    })
    // Frame 1 is sampled before anything has been jumped to, so it sees the map's starting zoom;
    // frame 2 sees 17 (set by step 1), frame 3 sees 16.
    expect(seen).toEqual([14, 17, 16])
    expect(fake.states.map((s) => s.zoom)).toEqual([17, 16, 15])
  })

  it("reports progress against the total, so the phone shows something during 11 seconds", async () => {
    const fake = fakeMap()
    const progress: number[] = []
    await driveScriptedPath(fake.map, new FogPerf(silentHost), {
      host: syncHost(),
      onProgress: ({ step, total }) => {
        expect(total).toBe(PATH_STEPS)
        progress.push(step)
      },
    })
    expect(progress[0]).toBe(1)
    expect(progress.at(-1)).toBe(PATH_STEPS)
  })

  it("attributes frames to the phase that was running", async () => {
    const fake = fakeMap()
    const perf = new FogPerf(silentHost)
    await driveScriptedPath(fake.map, perf, { host: syncHost() })
    const frames = perf.snapshot().frames
    const steps = stepsPerPhase()
    expect(frames.map((f) => f.phase)).toEqual([...steps.keys()])
    const segmentsPerPhase = new Map<string, number>()
    for (const segment of PATH) {
      segmentsPerPhase.set(segment.phase, (segmentsPerPhase.get(segment.phase) ?? 0) + 1)
    }
    for (const [phase, total] of steps) {
      const measured = frames.find((f) => f.phase === phase)!
      // One delta fewer per SEGMENT: `beginPhase` resets the frame clock, so a phase built from two
      // segments loses the first frame of each rather than only the first of the phase.
      expect(measured.samples).toBe(total - segmentsPerPhase.get(phase)!)
    }
  })
})

/**
 * `0059`, after the first real-device run sat on `running…` with no way out. A path that cannot be
 * stopped is a page that has to be reloaded, and a reload throws away every sample taken so far.
 */
describe("stopping early", () => {
  it("stops where it is and resolves, so the caller still gets a report", async () => {
    const fake = fakeMap()
    const perf = new FogPerf(silentHost)
    let steps = 0
    await driveScriptedPath(fake.map, perf, {
      host: syncHost(),
      shouldStop: () => steps++ >= 100,
    })
    // Resolved rather than rejected, and well short of the full path.
    expect(fake.states.length).toBeGreaterThan(0)
    expect(fake.states.length).toBeLessThan(PATH_STEPS)
  })

  it("keeps the samples taken before the stop", async () => {
    const fake = fakeMap()
    const perf = new FogPerf(silentHost)
    let steps = 0
    await driveScriptedPath(fake.map, perf, {
      host: syncHost(),
      shouldStop: () => steps++ >= 80,
    })
    const frames = perf.snapshot().frames
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.reduce((sum, f) => sum + f.samples, 0)).toBeGreaterThan(0)
  })

  it("checks before the first frame, so an immediate stop does nothing at all", async () => {
    const fake = fakeMap()
    await driveScriptedPath(fake.map, new FogPerf(silentHost), {
      host: syncHost(),
      shouldStop: () => true,
    })
    expect(fake.states).toHaveLength(0)
  })

  it("runs the whole path when nothing asks it to stop", async () => {
    const fake = fakeMap()
    await driveScriptedPath(fake.map, new FogPerf(silentHost), {
      host: syncHost(),
      shouldStop: () => false,
    })
    expect(fake.states).toHaveLength(PATH_STEPS)
  })
})

/**
 * `0059`, after the first desktop run. Both `pan-across` and `pan-z17` exist to rebuild the instance
 * buffer repeatedly; a phase that leaves the padded region zero times measures a static buffer and
 * reports it as a pan.
 */
describe("the pan phases actually leave the padded region", () => {
  it.each(["pan-across", "pan-z17"])("%s travels well over the 20%% padding", (phase) => {
    const travelled = PATH.filter((s) => s.phase === phase).reduce(
      (sum, s) => sum + Math.abs(s.dxFrac) * s.steps,
      0,
    )
    // 2+ viewports, not merely more than VIEWPORT_PAD. `pan-z17` additionally inherits a padded box
    // built at z13 that is ~22 of its own viewports wide, so it rebuilds nothing today whatever this
    // number is — see `0207`. The distance is asserted anyway so it is already right when that lands.
    expect(travelled).toBeGreaterThan(2)
  })
})
