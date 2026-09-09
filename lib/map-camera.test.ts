import { describe, expect, it } from "vitest"

import { EXTRACT_FALLBACK, HOME_ZOOM, parseCamera } from "./map-camera"

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
