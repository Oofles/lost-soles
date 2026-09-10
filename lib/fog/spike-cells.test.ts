import { describe, expect, it } from "vitest"

import { DISC_COVERAGE, EARTH_CIRCUMFERENCE_M, INSTANCE_FLOATS, PROBE_HIGH, PROBE_LOW } from "./spike-mask"
import {
  DISC_RADIUS_M,
  mercatorX,
  mercatorY,
  metresToMercator,
  spikeField,
  spikeProbe,
  SPIKE_CENTRE,
  SPIKE_RING_K,
} from "./spike-cells"

/** THROWAWAY, with ticket `0118`. */

/** The Florida extract's bbox (`docs/capabilities/08-map-and-fog-renderer.md`). */
const EXTRACT = { west: -87.7, south: 24.4, east: -79.9, north: 31.1 }

type Disc = { x: number; y: number; radius: number; value: number }

function unpack(packed: Float32Array): Disc[] {
  const discs: Disc[] = []
  for (let i = 0; i < packed.length; i += INSTANCE_FLOATS) {
    discs.push({ x: packed[i], y: packed[i + 1], radius: packed[i + 2], value: packed[i + 3] })
  }
  return discs
}

describe("web mercator", () => {
  it("puts the prime meridian and the equator at the centre of the unit square", () => {
    expect(mercatorX(0)).toBeCloseTo(0.5, 12)
    expect(mercatorY(0)).toBeCloseTo(0.5, 12)
  })

  it("puts the antimeridian at the edges", () => {
    expect(mercatorX(-180)).toBeCloseTo(0, 12)
    expect(mercatorX(180)).toBeCloseTo(1, 12)
  })

  /** y increases SOUTHWARD, which is why the blit's clip-space matrix flips it. */
  it("increases y toward the south", () => {
    expect(mercatorY(40)).toBeLessThan(mercatorY(-40))
    expect(mercatorY(40)).toBeLessThan(0.5)
  })

  /**
   * THE MEAN RADIUS, NOT THE EQUATORIAL ONE — and writing the wrong literal here is how
   * this test first failed, by 0.11%.
   *
   * WGS84's equatorial circumference is 40,075,016.686 m and is the number most
   * references hand you for web mercator. This project is spherical throughout and uses
   * R = 6,371,008.8 m: `src/domain/geo.ts`'s haversine, `h3-js`'s own cell geometry, and
   * MapLibre's `circumferenceAtLatitude`. A disc sized against the equatorial figure
   * would be 0.11% larger than the cell `REVEAL_R_M` actually scored — immaterial to the
   * eye, and exactly the kind of quiet inconsistency between the scoring radius and the
   * render radius that §2.3 spends a page insisting must not creep in.
   */
  it("uses the same spherical earth as the rest of the project", () => {
    expect(EARTH_CIRCUMFERENCE_M).toBeCloseTo(2 * Math.PI * 6_371_008.8, 6)
  })

  it("round-trips a ground radius back to metres at the latitude it was computed for", () => {
    const mercator = metresToMercator(102, 27.9478)
    expect(mercator * EARTH_CIRCUMFERENCE_M * Math.cos((27.9478 * Math.PI) / 180)).toBeCloseTo(102, 6)
  })

  /**
   * The same radius in metres is MORE mercator units the further from the equator, which
   * is the whole reason `a_radius` is per-instance rather than a uniform.
   */
  it("needs more mercator units for the same metres further from the equator", () => {
    expect(metresToMercator(102, 60)).toBeGreaterThan(metresToMercator(102, 0))
  })
})

describe("the spike's coordinate", () => {
  it("is inside the Florida extract, so there is a real basemap to compare against", () => {
    expect(SPIKE_CENTRE.lng).toBeGreaterThan(EXTRACT.west)
    expect(SPIKE_CENTRE.lng).toBeLessThan(EXTRACT.east)
    expect(SPIKE_CENTRE.lat).toBeGreaterThan(EXTRACT.south)
    expect(SPIKE_CENTRE.lat).toBeLessThan(EXTRACT.north)
  })

  /**
   * §7.2 / D-199. The repo is public and this literal is not in a `__fixtures__`
   * directory, so `check-fixture-geography.mjs` never sees it. Pinning it here means a
   * change to it shows up as a failing test with this comment attached, rather than as a
   * one-line diff nobody reads.
   */
  it("is the public downtown it is documented to be, not somewhere the operator runs", () => {
    expect(SPIKE_CENTRE).toEqual({ lat: 27.9478, lng: -82.4584 })
  })
})

describe("spikeField", () => {
  const discs = unpack(spikeField())

  it("is the ticket's ~500 discs: a 469-cell res-10 disk plus the two for the eye", () => {
    // 3k² + 3k + 1 at k = 12.
    expect(3 * SPIKE_RING_K ** 2 + 3 * SPIKE_RING_K + 1).toBe(469)
    expect(discs).toHaveLength(471)
  })

  /**
   * `toBeCloseTo` rather than equality throughout this file: `pack` writes into a
   * `Float32Array`, which is what the GPU wants and what loses the last bits of a
   * double. 0.45 comes back as 0.44999998807907104.
   */
  it("gives every disc the same coverage, so the revealed region must read as uniform", () => {
    for (const disc of discs) expect(disc.value).toBeCloseTo(DISC_COVERAGE, 6)
  })

  it("sizes the cell discs at revealScale × circumradius ≈ 102 m", () => {
    expect(DISC_RADIUS_M).toBeCloseTo(102.465, 3)
    /**
     * Within 0.01%, not exactly: each disc's radius is converted at ITS OWN cell's
     * latitude, and `gridDisk`'s first element is the origin cell's centre rather than
     * `SPIKE_CENTRE` itself. The k=12 disk spans ~3 km of latitude, so `cos(lat)` — and
     * therefore the mercator radius — varies by a few parts per million across it. That
     * variation is the per-instance `a_radius` doing its job.
     */
    const cellRadius = metresToMercator(DISC_RADIUS_M, SPIKE_CENTRE.lat)
    expect(discs[0].radius / cellRadius).toBeCloseTo(1, 4)
  })

  /**
   * §4.1's merge condition. Neighbouring res-10 centres are ~131.4 m apart and the discs
   * are ~102 m, so every neighbour overlaps well past its half-power point — which is
   * what makes a contiguous run of cells one region instead of a row of scallops.
   */
  it("overlaps its neighbours, which is what makes the field one region", () => {
    const spacing = 131.4
    expect(DISC_RADIUS_M * 2).toBeGreaterThan(spacing)
  })

  it("places the eye pair overlapping each other and clear of the field", () => {
    const [left, right] = discs.slice(-2)
    const separation = Math.abs(right.x - left.x)
    expect(separation).toBeLessThan(left.radius + right.radius) // they overlap
    expect(separation).toBeGreaterThan(0) // ...and are not the same disc
    const fieldSpan = metresToMercator(SPIKE_RING_K * 131.4 + DISC_RADIUS_M, SPIKE_CENTRE.lat)
    expect(left.x - right.radius).toBeGreaterThan(mercatorX(SPIKE_CENTRE.lng) + fieldSpan)
  })
})

describe("spikeProbe", () => {
  const discs = unpack(spikeProbe())

  /**
   * THE ORDER IS LOAD-BEARING AND THIS IS THE TEST THAT SAYS SO. `judgeProbe` separates
   * an honoured `MAX` from an ignored blend equation by comparing pixel areas, and that
   * comparison only has a sign because the HIGH disc is drawn first and the LOW disc
   * second. Swap these two and a driver that ignores blending reports GO.
   */
  it("puts PROBE_HIGH first, because judgeProbe depends on the draw order", () => {
    expect(discs).toHaveLength(2)
    expect(discs[0].value).toBeCloseTo(PROBE_HIGH, 6)
    expect(discs[1].value).toBeCloseTo(PROBE_LOW, 6)
  })

  it("separates the two discs by one radius, leaving each a clear majority of its own area", () => {
    /**
     * A RATIO, NOT AN ABSOLUTE DIFFERENCE. Both centres are float32 values near 0.271
     * and their difference is ~5.8e-5, so the subtraction cancels away most of the
     * significand: the absolute error in `separation` is ~3e-8, which is sixty times the
     * tolerance an absolute `toBeCloseTo(…, 9)` would allow. The quantity the spike
     * actually depends on is the ratio, and it survives the cancellation intact.
     */
    const separation = Math.abs(discs[1].x - discs[0].x)
    expect(separation / discs[0].radius).toBeCloseTo(1, 3)
    // Lens area at separation = R is 1.228 R² against a disc's 3.1416 R², so the low
    // disc keeps 61% of its pixels exclusively. No rounding can blur that ratio.
    expect(separation).toBeLessThan(discs[0].radius + discs[1].radius)
  })

  it("is large enough to measure: ~2 km, not the ~102 m of a cell", () => {
    const cellRadius = metresToMercator(DISC_RADIUS_M, SPIKE_CENTRE.lat)
    expect(discs[0].radius / (cellRadius * 20)).toBeCloseTo(1, 6)
  })

  it("sits on the same latitude, so the two discs are the same size on screen", () => {
    expect(discs[0].y).toBe(discs[1].y)
    expect(discs[0].radius).toBe(discs[1].radius)
  })
})
