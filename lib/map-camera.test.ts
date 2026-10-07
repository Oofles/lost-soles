import { describe, expect, it } from "vitest"

import { EMPTY_COLLECTION, type RunFeatureCollection } from "@/lib/runs/wire"

import {
  EXTRACT_FALLBACK,
  HOME_ZOOM,
  atHref,
  firstLoadRunCamera,
  parseAt,
  parseCamera,
  runCamera,
} from "./map-camera"

/**
 * `localStorage` is user-writable and survives upgrades, so every field is validated on
 * the way back in. The failure this guards against is specific: MapLibre throws during
 * construction on a NaN zoom or an out-of-range centre, and on this route a throw in
 * construction means the map never appears at all — visually identical to a broken
 * basemap, and much harder to tell apart. A camera that will not parse is not an error
 * worth surfacing; it is a camera we do not have.
 */
describe("camera restore (0053)", () => {
  it("round-trips a valid camera", () => {
    const camera = { lng: -81.4, lat: 30.08, zoom: 15.5, bearing: 27 }
    expect(parseCamera(JSON.stringify(camera))).toStrictEqual(camera)
  })

  it("returns null rather than throwing for absent or unparseable storage", () => {
    expect(parseCamera(null)).toBeNull()
    expect(parseCamera("")).toBeNull()
    expect(parseCamera("{not json")).toBeNull()
    expect(parseCamera("null")).toBeNull()
    expect(parseCamera('"a string"')).toBeNull()
    expect(parseCamera("[]")).toBeNull()
  })

  it.each([
    ["a missing field", { lng: -81.4, lat: 30.08, zoom: 15 }],
    ["a NaN zoom", { lng: -81.4, lat: 30.08, zoom: Number.NaN, bearing: 0 }],
    ["an infinite centre", { lng: Number.POSITIVE_INFINITY, lat: 30, zoom: 15, bearing: 0 }],
    ["a latitude past the pole", { lng: -81.4, lat: 91, zoom: 15, bearing: 0 }],
    ["a longitude past the antimeridian", { lng: 181, lat: 30, zoom: 15, bearing: 0 }],
    ["a zoom past MapLibre's maximum", { lng: -81.4, lat: 30, zoom: 25, bearing: 0 }],
    ["a string zoom", { lng: -81.4, lat: 30, zoom: "15", bearing: 0 }],
  ])("rejects %s", (_label, stored) => {
    expect(parseCamera(JSON.stringify(stored))).toBeNull()
  })

  /**
   * D-199 / 08 §7.2: this repository is public, so no committed coordinate may be the
   * operator's. The fallback is the centre of the Florida extract — already public in the
   * capability doc, identifying nobody, and guaranteed to have tiles under it.
   */
  it("falls back to the extract, at a zoom that shows the extract", () => {
    expect(EXTRACT_FALLBACK.zoom).toBeLessThan(HOME_ZOOM)
    expect(parseCamera(JSON.stringify(EXTRACT_FALLBACK))).toStrictEqual(EXTRACT_FALLBACK)
  })
})

/** Synthetic, and nowhere near anyone: the extract's own fallback centre (D-199). */
const run = (coordinates: [number, number][][]): RunFeatureCollection => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "MultiLineString", coordinates },
      properties: { activityId: "a", startedAt: "2026-09-01T10:00:00Z", name: null },
    },
  ],
})

describe("the most recent run as a camera (0186)", () => {
  it("centres on the run's bounding box, at neighbourhood zoom", () => {
    const camera = runCamera(
      run([
        [
          [-83.9, 27.7],
          [-83.7, 27.7],
        ],
        [
          [-83.7, 27.8],
          [-83.8, 27.75],
        ],
      ]),
    )
    expect(camera?.lng).toBeCloseTo(-83.8, 9)
    expect(camera?.lat).toBeCloseTo(27.75, 9)
    expect(camera?.zoom).toBe(HOME_ZOOM)
    expect(camera?.bearing).toBe(0)
  })

  it("is not pulled toward where the runner stood still, as a vertex mean would be", () => {
    // Twenty samples at the start line, one at the far end of an out-and-back.
    const dwell = Array.from({ length: 20 }, (): [number, number] => [-83.9, 27.75])
    const camera = runCamera(run([[...dwell, [-83.7, 27.75]]]))
    expect(camera?.lng).toBeCloseTo(-83.8, 9)
  })

  it("has no camera for no run, and none for a geometry with no usable position", () => {
    expect(runCamera(EMPTY_COLLECTION)).toBeNull()
    expect(runCamera(run([]))).toBeNull()
    expect(runCamera(run([[[Number.NaN, 27.75], [-83.8, 91]]]))).toBeNull()
  })
})

describe("whether the run may move the map (0186)", () => {
  const free = { storedAtMount: false, userMoved: false, alreadyCentred: false }
  const latest = run([[[-83.8, 27.75], [-83.8, 27.75]]])

  it("moves a first-ever load to the run", () => {
    expect(firstLoadRunCamera({ ...free, runs: latest })).not.toBeNull()
  })

  it("never beats a stored camera", () => {
    expect(firstLoadRunCamera({ ...free, storedAtMount: true, runs: latest })).toBeNull()
  })

  it("never yanks the map out from under a pan the operator already made", () => {
    expect(firstLoadRunCamera({ ...free, userMoved: true, runs: latest })).toBeNull()
  })

  it("happens once per mount, so a sync's refetch does not snap the camera back", () => {
    expect(firstLoadRunCamera({ ...free, alreadyCentred: true, runs: latest })).toBeNull()
  })

  it("leaves the configured home in place when there is no run", () => {
    expect(firstLoadRunCamera({ ...free, runs: EMPTY_COLLECTION })).toBeNull()
  })
})

describe("?at= — the skill sheet's fly to (0074)", () => {
  it("round-trips atHref through parseAt at neighbourhood zoom", () => {
    const href = atHref({ lng: -83.12345, lat: 27.5 })
    expect(href).toBe("/?at=-83.12345,27.50000")
    expect(parseAt(href.slice(1))).toStrictEqual({ lng: -83.12345, lat: 27.5, zoom: HOME_ZOOM, bearing: 0 })
  })

  it("ignores a missing, malformed or out-of-range coordinate rather than throwing", () => {
    for (const search of ["", "?fog=perf", "?at=", "?at=1", "?at=1,2,3", "?at=abc,2", "?at=200,0", "?at=0,95", "?at=,2"]) {
      expect(parseAt(search), search).toBeNull()
    }
  })
})
