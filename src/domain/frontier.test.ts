import { cellToLatLng, gridDisk, latLngToCell } from "h3-js"
import { describe, expect, it } from "vitest"

import { SIX_MONTHS_MS } from "./discovery"
import { RES } from "./fog"
import { bearingDeg, cellClass, frontier } from "./frontier"

/**
 * Ticket `0083`. `05-fog-of-war.md` §8.4. Synthetic geometry near Point Nemo (`08` §7.2, D-199).
 */

const ORIGIN = { lat: -48.8767, lng: -123.3933 }
const W = { new: 1, rearmed: 0.5, recent: 0 }

/** Everything within ~1 km of the origin explored; the world beyond it fogged. */
const home = new Set(gridDisk(latLngToCell(ORIGIN.lat, ORIGIN.lng, RES), 22))

describe("frontier", () => {
  it("returns res-8 clusters with noveltyFraction, distanceM, bearing and score, best first", () => {
    const out = frontier({ origin: ORIGIN, radiusM: 3000, explored: home, weights: W })
    expect(out.length).toBeGreaterThan(5)
    for (const c of out) {
      expect(c).toEqual(
        expect.objectContaining({
          noveltyFraction: expect.any(Number),
          distanceM: expect.any(Number),
          bearing: expect.any(Number),
          score: expect.any(Number),
        }),
      )
      expect(c.noveltyFraction).toBeGreaterThanOrEqual(0)
      expect(c.noveltyFraction).toBeLessThanOrEqual(1)
    }
    for (let i = 1; i < out.length; i++) expect(out[i - 1].score).toBeGreaterThanOrEqual(out[i].score)
  })

  it("ranks fogged ground above the explored ground around the origin", () => {
    const [best] = frontier({ origin: ORIGIN, radiusM: 3000, explored: home, weights: W })
    expect(best.noveltyFraction).toBeGreaterThan(0.5)
    expect(best.distanceM).toBeGreaterThan(500)
  })

  it("a fully explored disk has no novelty anywhere", () => {
    const all = { has: () => true }
    expect(frontier({ origin: ORIGIN, radiusM: 1500, explored: all, weights: W }).every((c) => c.noveltyFraction === 0)).toBe(true)
  })

  it("weighs with the weights it is handed — the scorer's row, not a copy", () => {
    const none = { has: () => false }
    const [c] = frontier({ origin: ORIGIN, radiusM: 500, explored: none, weights: { new: 0.25, rearmed: 0, recent: 0 } })
    expect(c.noveltyFraction).toBeCloseTo(0.25)
  })
})

describe("cellClass", () => {
  const cell = latLngToCell(ORIGIN.lat, ORIGIN.lng, RES)
  const now = Date.parse("2026-10-01T00:00:00Z")

  it("mirrors D-120: never-run, re-armed at exactly six months, recent inside it", () => {
    const set = new Set([cell])
    expect(cellClass(cell, new Set(), null, now)).toBe("new")
    expect(cellClass(cell, set, new Map([[cell, now - SIX_MONTHS_MS]]), now)).toBe("rearmed")
    expect(cellClass(cell, set, new Map([[cell, now - SIX_MONTHS_MS + 1]]), now)).toBe("recent")
  })

  it("degrades to binary without lastRunAt: explored reads as recent", () => {
    expect(cellClass(cell, new Set([cell]), null, now)).toBe("recent")
  })
})

describe("bearingDeg", () => {
  it("points the compass", () => {
    const [lat, lng] = cellToLatLng(latLngToCell(ORIGIN.lat, ORIGIN.lng, RES))
    expect(bearingDeg({ lat, lng }, { lat: lat + 0.01, lng })).toBeCloseTo(0, 0)
    expect(bearingDeg({ lat, lng }, { lat, lng: lng + 0.01 })).toBeCloseTo(90, 0)
    expect(bearingDeg({ lat, lng }, { lat: lat - 0.01, lng })).toBeCloseTo(180, 0)
    expect(bearingDeg({ lat, lng }, { lat, lng: lng - 0.01 })).toBeCloseTo(270, 0)
  })
})
