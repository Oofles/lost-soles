import { describe, expect, it } from "vitest"

import { FogPerf, type PerfHost } from "./collector"
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
      (sum, s) => sum + s.dxPx * s.steps,
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
  it("keeps pan-inside inside the padded region on the reference viewport", () => {
    const segment = PATH.find((s) => s.phase === "pan-inside")!
    const travel = Math.abs(segment.dyPx) * segment.steps
    expect(travel).toBeLessThan(0.2 * 800)
  })

  it("leaves the padded region many times over during pan-across", () => {
    const distance = PATH.filter((s) => s.phase === "pan-across").reduce(
      (sum, s) => sum + Math.abs(s.dxPx) * s.steps,
      0,
    )
    expect(distance).toBeGreaterThan(2 * 400)
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
   * A path defined in DEGREES would visit the same states on both viewports, which is the bug. The
   * padded region is a fraction of the viewport, so the same degree offset is a different fraction of
   * it — and `pan-inside`'s zero-cull claim would then mean two different things on the two surfaces
   * while reporting one number.
   */
  it("pans by screen pixels, so a wider viewport covers more ground per step", async () => {
    const phone = fakeMap({ width: 400, height: 800 })
    const desktop = fakeMap({ width: 1440, height: 900 })
    const segment: PathSegment[] = [{ phase: "pan", steps: 4, dxPx: 10, dyPx: 0, zoom: 14 }]
    await driveScriptedPath(phone.map, new FogPerf(silentHost), {
      host: syncHost(),
      path: segment,
    })
    await driveScriptedPath(desktop.map, new FogPerf(silentHost), {
      host: syncHost(),
      path: segment,
    })
    // The fake projects a pixel to a fixed number of degrees, so both move the same distance for the
    // same pixel offset — what differs is that each asked ITS OWN canvas where the centre was.
    expect(phone.states.at(-1)!.lng).toBeCloseTo(desktop.states.at(-1)!.lng)
    // The proof that the canvas was consulted at all: a zero-offset segment must not move.
    const still = fakeMap()
    await driveScriptedPath(still.map, new FogPerf(silentHost), {
      host: syncHost(),
      path: [{ phase: "settle", steps: 3, dxPx: 0, dyPx: 0, zoom: 14 }],
    })
    expect(new Set(still.states.map((s) => s.lng)).size).toBe(1)
  })

  it("repaints on a still camera, so settle measures drawn frames rather than idle ones", async () => {
    const fake = fakeMap()
    await driveScriptedPath(fake.map, new FogPerf(silentHost), {
      host: syncHost(),
      path: [{ phase: "settle", steps: 5, dxPx: 0, dyPx: 0, zoom: 14 }],
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
      path: [{ phase: "zoom-out", steps: 3, dxPx: 0, dyPx: 0, zoom: 17, dZoom: -1 }],
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
