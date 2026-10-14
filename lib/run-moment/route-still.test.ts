import { describe, expect, it } from "vitest"

import { routeStill } from "./route-still"

/** Ticket `0084`. The still that stands in for a lost GL context: drawn from geometry, no GPU. */

describe("routeStill", () => {
  it("draws every part of the route as one path, inside its padded viewBox", () => {
    const s = routeStill({
      type: "MultiLineString",
      coordinates: [
        [[-0.1, 51.5], [-0.09, 51.505], [-0.08, 51.5]],
        [[-0.07, 51.49], [-0.06, 51.49]],
      ],
    } as never)!
    expect(s.d.match(/M/g)).toHaveLength(2)
    expect(s.d.match(/L/g)).toHaveLength(3)
    const [, , w, h] = s.viewBox.split(" ").map(Number)
    const nums = s.d.replace(/[ML]/g, " ").trim().split(/\s+/).map(Number)
    for (let i = 0; i < nums.length; i += 2) {
      expect(nums[i]).toBeGreaterThanOrEqual(0)
      expect(nums[i]).toBeLessThanOrEqual(w!)
      expect(nums[i + 1]).toBeGreaterThanOrEqual(0)
      expect(nums[i + 1]).toBeLessThanOrEqual(h!)
    }
  })

  it("north is up: a point further north has a smaller y", () => {
    const s = routeStill({ type: "MultiLineString", coordinates: [[[0, 51.5], [0, 51.6]]] } as never)!
    const ys = [...s.d.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]))
    expect(ys[1]).toBeLessThan(ys[0]!)
  })

  it("no route (an untraced activity) is no still, not a throw", () => {
    expect(routeStill(null)).toBeNull()
    expect(routeStill({ type: "MultiLineString", coordinates: [[[0, 0]]] } as never)).toBeNull()
  })
})
