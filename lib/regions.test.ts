import { describe, expect, it } from "vitest"

import type { WebRunInput } from "@/lib/trace-web/web"

import { coordinateLabel, REGION_LINK_KM, regionsOf } from "./regions"

/** Point Nemo (D-199): synthetic geography only. Offsets in km, east and north. */
const NEMO = { lat: -48.876, lng: -123.393 }
const at = (eastKm: number, northKm: number): [number, number] => [
  NEMO.lng + eastKm / (111.32 * Math.cos((NEMO.lat * Math.PI) / 180)),
  NEMO.lat + northKm / 111.32,
]

let seq = 0
function run(startedAt: string, ...points: [number, number][]): WebRunInput {
  seq += 1
  return { activityId: `a${String(seq).padStart(3, "0")}`, startedAt, lines: [points] }
}

describe("regionsOf — distance clusters of run starts", () => {
  it("is empty with no runs, and one region for one area", () => {
    expect(regionsOf([])).toEqual([])
    const one = regionsOf([run("2026-01-01T00:00:00Z", at(0, 0), at(2, 0)), run("2026-01-02T00:00:00Z", at(5, 3))])
    expect(one).toHaveLength(1)
  })

  it("splits two areas of one 'state' ~200 km apart, as Arkansas's two areas are, into two regions", () => {
    const regions = regionsOf([
      run("2026-01-01T00:00:00Z", at(0, 0)),
      run("2026-01-02T00:00:00Z", at(4, 4)),
      run("2026-01-03T00:00:00Z", at(150, -130)),
    ])
    expect(regions).toHaveLength(2)
  })

  it("keeps a sprawling metro as one region when its starts chain within the link distance", () => {
    const step = REGION_LINK_KM - 5
    const regions = regionsOf([
      run("2026-01-01T00:00:00Z", at(0, 0)),
      run("2026-01-02T00:00:00Z", at(step, 0)),
      run("2026-01-03T00:00:00Z", at(2 * step, 0)),
    ])
    expect(regions).toHaveLength(1)
  })

  it("orders regions by their most recent run, newest first", () => {
    const regions = regionsOf([
      run("2026-05-01T00:00:00Z", at(0, 0)),
      run("2026-09-01T00:00:00Z", at(300, 0)),
      run("2026-01-01T00:00:00Z", at(0, 300)),
      run("2026-10-01T00:00:00Z", at(2, 2)), // the first area, most recently
    ])
    expect(regions.map((r) => r.latestAt)).toEqual(["2026-10-01T00:00:00Z", "2026-09-01T00:00:00Z", "2026-01-01T00:00:00Z"])
  })

  it("frames every traced point of the region's runs, not only their starts", () => {
    const a = at(0, 0), b = at(10, -6), c = at(-3, 8)
    const [region] = regionsOf([run("2026-01-01T00:00:00Z", a, b), run("2026-01-02T00:00:00Z", c)])
    expect(region!.bounds).toEqual([
      [c[0], b[1]],
      [b[0], c[1]],
    ])
  })

  it("skips a run with no points, and is stable whatever order the runs come in", () => {
    const runs = [run("2026-01-01T00:00:00Z", at(0, 0)), run("2026-02-01T00:00:00Z", at(400, 0)), { activityId: "empty", startedAt: "2026-03-01T00:00:00Z", lines: [[]] }]
    const forward = regionsOf(runs)
    expect(forward).toHaveLength(2)
    expect(regionsOf([...runs].reverse())).toEqual(forward)
  })
})

describe("coordinateLabel — the plain fallback", () => {
  it("names the box's centre to a tenth of a degree, with hemispheres", () => {
    expect(coordinateLabel([[-123.5, -48.9], [-123.3, -48.7]])).toBe("48.8°S 123.4°W")
    expect(coordinateLabel([[10, 20], [10.2, 20.2]])).toBe("20.1°N 10.1°E")
  })
})
