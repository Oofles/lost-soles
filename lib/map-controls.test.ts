import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  fitTerritory,
  lastRunEnd,
  lockOrientation,
  MAP_INPUT_OPTIONS,
  RECENTRE_ZOOM,
  recentre,
  settleZoom,
  territoryBounds,
  territoryTarget,
  ZOOM_MAX,
  ZOOM_MIN,
  type CameraHost,
} from "./map-controls"
import type { RunFeatureCollection } from "./runs/wire"
import type { WebRunInput } from "./trace-web/web"

/**
 * Ticket `0101`. `06-ui-ux.md` §4.4's table, row by row, as far as a Map with no WebGL can take it.
 * The real-Map half — right-drag and Ctrl-drag leave bearing and pitch at 0, an over-zoom settles
 * back inside [10, 18] — is `tools/fog-harness/run-map-controls.mjs`. Point Nemo throughout (D-199).
 */

const NEMO: [number, number] = [-123.393, -48.876]

const latest = (coordinates: number[][][]): RunFeatureCollection => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "MultiLineString", coordinates } as RunFeatureCollection["features"][number]["geometry"],
      properties: { activityId: "a", startedAt: "2026-09-09T11:00:00.000Z", name: null },
    },
  ],
})

const run = (id: string, lines: number[][][], startedAt = "2026-09-09T11:00:00.000Z"): WebRunInput => ({
  activityId: id,
  startedAt,
  lines: lines as WebRunInput["lines"],
})

function fakeCamera(zoomFor: (bounds: [[number, number], [number, number]]) => number = () => 14) {
  const calls: Array<[string, unknown, unknown?]> = []
  const host: CameraHost = {
    easeTo: (o) => void calls.push(["easeTo", o]),
    fitBounds: (b, o) => void calls.push(["fitBounds", b, o]),
    cameraForBounds: (b) => ({ zoom: zoomFor(b) }),
    getCenter: () => ({ lng: NEMO[0], lat: NEMO[1] }),
    getContainer: () => ({ getBoundingClientRect: () => ({ width: 1000, height: 800 }) }) as HTMLElement,
  }
  return { host, calls }
}

describe("§4.4: rotation and tilt are off, at the options level", () => {
  it("builds the Map with every rotate and pitch handler disabled", () => {
    expect(MAP_INPUT_OPTIONS.dragRotate).toBe(false)
    expect(MAP_INPUT_OPTIONS.pitchWithRotate).toBe(false)
    expect(MAP_INPUT_OPTIONS.touchPitch).toBe(false)
    expect(MAP_INPUT_OPTIONS.rollEnabled).toBe(false)
    expect(MAP_INPUT_OPTIONS.maxPitch).toBe(0)
    expect(MAP_INPUT_OPTIONS.minPitch).toBe(0)
  })

  it("keeps drag-pan, wheel zoom, double-click zoom and the keyboard on", () => {
    expect(MAP_INPUT_OPTIONS.dragPan).toBe(true)
    expect(MAP_INPUT_OPTIONS.scrollZoom).toBe(true)
    expect(MAP_INPUT_OPTIONS.doubleClickZoom).toBe(true)
    expect(MAP_INPUT_OPTIONS.keyboard).toBe(true)
  })

  it("turns off the keyboard's and the touchpad's rotation through their own handlers", () => {
    const off: string[] = []
    lockOrientation({
      keyboard: { disableRotation: () => void off.push("keyboard") },
      touchZoomRotate: { disableRotation: () => void off.push("touchZoomRotate") },
    })
    expect(off.sort()).toEqual(["keyboard", "touchZoomRotate"])
  })

  /** A tripwire on the wiring, as `map-shell-build.test.ts` is: the options reach the constructor. */
  it("MapShell builds with these options, north-up and flat, and is never rotated by a stored camera", () => {
    const shell = readFileSync(new URL("../components/map/map-shell.tsx", import.meta.url), "utf8")
    const ctor = shell.slice(shell.indexOf("new lib.Map("), shell.indexOf("lockOrientation(instance)"))
    expect(ctor).toContain("...MAP_INPUT_OPTIONS")
    expect(ctor).toContain("bearing: 0")
    expect(ctor).toContain("pitch: 0")
    expect(shell).not.toMatch(/bearing: (camera\.current|at|target)\.bearing/)
    expect(shell).not.toMatch(/on\("(rotate|pitch)/)
  })
})

describe("§4.4: zoom z10 → z18, rubber-banding", () => {
  it("lets a gesture overshoot each bound by half a level", () => {
    expect(MAP_INPUT_OPTIONS.minZoom).toBe(ZOOM_MIN - 0.5)
    expect(MAP_INPUT_OPTIONS.maxZoom).toBe(ZOOM_MAX + 0.5)
    expect([ZOOM_MIN, ZOOM_MAX]).toEqual([10, 18])
  })

  it("settles an over-zoom back inside, in both directions, and leaves an in-range zoom alone", () => {
    expect(settleZoom(9.5)).toBe(10)
    expect(settleZoom(9.99)).toBe(10)
    expect(settleZoom(18.5)).toBe(18)
    expect(settleZoom(18.01)).toBe(18)
    for (const z of [10, 12.3, 18]) expect(settleZoom(z)).toBeNull()
  })
})

describe("§4.4: ⌖ recentres on the last run's end point, z14", () => {
  it("takes the last point of the last line", () => {
    expect(lastRunEnd(latest([[[0, 0], [1, 1]], [[2, 2], [3, 3]]]))).toEqual([3, 3])
    expect(lastRunEnd(latest([[[0, 0], [1, 1]], []]))).toEqual([1, 1])
    expect(lastRunEnd({ type: "FeatureCollection", features: [] })).toBeNull()
  })

  it("eases there at z14, north-up and flat; with no run it does nothing", () => {
    const { host, calls } = fakeCamera()
    expect(recentre(host, latest([[NEMO, [NEMO[0] + 0.01, NEMO[1]]]]))).toBe(true)
    expect(calls).toEqual([["easeTo", { center: [NEMO[0] + 0.01, NEMO[1]], zoom: RECENTRE_ZOOM, bearing: 0, pitch: 0 }]])
    expect(recentre(host, { type: "FeatureCollection", features: [] })).toBe(false)
    expect(calls).toHaveLength(1)
  })
})

describe("§4.4: fit-to-territory", () => {
  const runs = [run("a", [[NEMO, [NEMO[0] + 0.02, NEMO[1] + 0.01]]]), run("b", [[[NEMO[0] - 0.01, NEMO[1] - 0.03]]])]

  it("frames the box of every traced point, with 12% padding, never past z18", () => {
    expect(territoryBounds(runs)).toEqual([[NEMO[0] - 0.01, NEMO[1] - 0.03], [NEMO[0] + 0.02, NEMO[1] + 0.01]])
    const { host, calls } = fakeCamera()
    expect(fitTerritory(host, runs)).toBe(true)
    expect(calls).toEqual([["fitBounds", territoryBounds(runs), { padding: 96, maxZoom: ZOOM_MAX, bearing: 0, pitch: 0 }]])
  })

  it("does nothing with no runs", () => {
    const { host, calls } = fakeCamera()
    expect(fitTerritory(host, [])).toBe(false)
    expect(calls).toEqual([])
  })

  /** Territory over several regions cannot fit above the z10 floor; the floor wins, the region in view is framed. */
  it("falls back to the region in view when the whole territory needs a zoom below z10", () => {
    const far: [number, number] = [NEMO[0] + 5, NEMO[1]]
    const spread = [...runs, run("c", [[far, [far[0] + 0.01, far[1]]]], "2026-09-10T11:00:00.000Z")]
    const whole = territoryBounds(spread)!
    const here = territoryTarget(spread, (b) => b !== whole && b[1][0] - b[0][0] < 1, { lng: NEMO[0], lat: NEMO[1] })
    expect(here).toEqual(territoryBounds(runs))
    const there = territoryTarget(spread, (b) => b[1][0] - b[0][0] < 1, { lng: far[0] + 0.5, lat: far[1] })
    expect(there).toEqual([far, [far[0] + 0.01, far[1]]])
    const { host, calls } = fakeCamera((b) => (b[1][0] - b[0][0] > 1 ? 6 : 13))
    fitTerritory(host, spread)
    expect(calls[0]![1]).toEqual(territoryBounds(runs))
  })
})
