import type { RouteTraceGeometry } from "@/lib/runs/wire"
import { describe, expect, it } from "vitest"

import { compassWord, frontierOrigin, frontierText, FRONTIER_MIN_DISTANCE_M, pickFrontier } from "./frontier-line"

/** Ticket `0083` — beat 5's wording and choice. The ranking itself is `src/domain/frontier.test.ts`. */

const cluster = (over: { noveltyFraction: number; distanceM: number; bearing?: number }) => ({
  parent: "88000000000000ff",
  centre: { lat: 0, lng: 0 },
  bearing: 0,
  score: 0,
  ...over,
})

describe("the frontier line", () => {
  it("names a distance and a bearing", () => {
    expect(frontierText({ distanceM: 1234, bearing: 2 })).toBe("Unclaimed ground 1.2 km north")
    expect(frontierText({ distanceM: 2060, bearing: 130 })).toBe("Unclaimed ground 2.1 km south-east")
  })

  it.each([
    [0, "north"], [22, "north"], [23, "north-east"], [90, "east"], [180, "south"], [270, "west"], [337, "north-west"], [338, "north"], [359.9, "north"],
  ])("compass %d° → %s", (deg, word) => expect(compassWord(deg)).toBe(word))

  it("picks the best cluster that is mostly unclaimed and not the doorstep", () => {
    const doorstep = cluster({ noveltyFraction: 0.9, distanceM: FRONTIER_MIN_DISTANCE_M - 1 })
    const thin = cluster({ noveltyFraction: 0.2, distanceM: 900 })
    const real = cluster({ noveltyFraction: 0.8, distanceM: 1200 })
    expect(pickFrontier([doorstep, thin, real])).toBe(real)
    expect(pickFrontier([doorstep, thin])).toBeNull()
  })

  it("measures from the run's first fix, or from home when the run has no line", () => {
    const route: RouteTraceGeometry = { type: "MultiLineString", coordinates: [[[-1.5, 53.2], [-1.6, 53.3]]] }
    expect(frontierOrigin(route, { lat: 9, lng: 9 })).toEqual({ lat: 53.2, lng: -1.5 })
    expect(frontierOrigin(undefined, { lat: 9, lng: 9 })).toEqual({ lat: 9, lng: 9 })
    expect(frontierOrigin(undefined, null)).toBeNull()
  })
})
