import { describe, expect, it } from "vitest"

import type { ActivityKind, GeoPoint } from "@/src/domain/activity"

import { MAX_IMPLIED_SPEED_MS, metresBetween, sanitizeTracePoints } from "./sanitize"

/**
 * TICKET 0037 — the outlier gate, at unit level.
 *
 * `normalize.test.ts` drives the same code through checked-in fixtures; this file builds
 * traces at exact speeds, because the interesting cases are the ones either side of a
 * threshold and a fixture cannot say "8.001 m/s" legibly.
 *
 * Coordinates are still Point Nemo — see `__fixtures__/README.md`.
 */

const NEMO = { lat: -48.876, lng: -123.393 }
const START = Date.parse("2026-06-01T02:53:48Z")

/** `n` fixes heading due north at a constant speed, one every `stepS` seconds. */
function track(n: number, metresPerStep: number, stepS = 1): GeoPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    lat: NEMO.lat + (i * metresPerStep) / 111_320,
    lng: NEMO.lng,
    t: START + i * stepS * 1000,
  }))
}

describe("metresBetween", () => {
  it("measures a degree of latitude to within half a percent", () => {
    const d = metresBetween({ lat: 0, lng: 0, t: 0 }, { lat: 1, lng: 0, t: 0 })
    expect(d).toBeGreaterThan(110_000)
    expect(d).toBeLessThan(112_000)
  })

  it("is zero for a point and itself, and symmetric", () => {
    const a: GeoPoint = { lat: -48.876, lng: -123.393, t: 0 }
    const b: GeoPoint = { lat: -48.877, lng: -123.392, t: 0 }
    expect(metresBetween(a, a)).toBe(0)
    expect(metresBetween(a, b)).toBeCloseTo(metresBetween(b, a), 9)
  })
})

describe("the gate is a data table, not a switch", () => {
  it("gives every ActivityKind a row", () => {
    // A missing row would be an `undefined` comparison, and `x > undefined` is false —
    // so the gate would silently accept everything for that kind. D-031: adding a kind
    // is a row, and this asserts the row exists.
    const kinds: ActivityKind[] = ["run", "walk", "hike", "ride", "strength", "other"]
    for (const kind of kinds) {
      expect(typeof MAX_IMPLIED_SPEED_MS[kind], `no gate for kind "${kind}"`).toBe("number")
      expect(MAX_IMPLIED_SPEED_MS[kind]).toBeGreaterThan(0)
    }
  })

  it("puts the foot gate above the human sprint record, not at running pace", () => {
    // §2.2 said 8 m/s. Measured against eight real traces it rejected six fixes at
    // 8, 8, 9, 9, 9 and 13 m/s and caught zero actual GPS jumps — see the constant's
    // comment and D-197. 12.5 is just above the ~12.4 m/s 100 m world-record peak.
    for (const kind of ["run", "walk", "hike"] as const) {
      expect(MAX_IMPLIED_SPEED_MS[kind]).toBeGreaterThan(12.4)
      // And still far below a real jump, which is ~200 m/s at a 2-second cadence.
      expect(MAX_IMPLIED_SPEED_MS[kind]).toBeLessThan(50)
    }
  })

  it("accepts a hard sprint and rejects a speed nobody has ever run", () => {
    // The five fixes at 8-9 m/s that the old gate threw away.
    const sprint = track(6, 9)
    expect(sanitizeTracePoints(sprint, "run").rejected).toBe(0)

    // The one at 13 m/s, which is past the world record and therefore not a human.
    const impossible = track(6, 13)
    expect(sanitizeTracePoints(impossible, "run").rejected).toBe(5)
  })

  it("gives a ride room the run gate would not (D-197)", () => {
    // The rules file has two enabled rows matching `kinds: [ride]`, so rides reach the
    // sanitizer and earn XP — and a descent exceeds any gate set for a person on foot.
    expect(MAX_IMPLIED_SPEED_MS.ride).toBeGreaterThan(MAX_IMPLIED_SPEED_MS.run)
  })
})

describe("implausible fixes are dropped, and the trace is broken where they were", () => {
  it("drops exactly the offending point and keeps BOTH neighbours", () => {
    const points = track(5, 3)
    // One fix 400 m off the track, between two good ones.
    points[2] = { ...points[2], lat: points[2].lat + 400 / 111_320 }

    const out = sanitizeTracePoints(points, "run")

    expect(out.rejected).toBe(1)
    expect(out.points).toHaveLength(4)
    // Both neighbours survive: the trace is not truncated at the jump.
    expect(out.points[1]).toEqual(points[1])
    expect(out.points[2]).toEqual(points[3])
  })

  it("marks the break so the renderer cannot draw a corridor across it", () => {
    const points = track(5, 3)
    points[2] = { ...points[2], lat: points[2].lat + 400 / 111_320 }

    // Index 1 is the last fix before the drop, index 2 the first after it, IN THE
    // SANITIZED ARRAY. Indices into the original would point at fixes nothing keeps.
    expect(sanitizeTracePoints(points, "run").breaks).toEqual([[1, 2]])
  })

  it("NEVER interpolates across the break", () => {
    const points = track(5, 3)
    points[2] = { ...points[2], lat: points[2].lat + 400 / 111_320 }

    const out = sanitizeTracePoints(points, "run")
    // A straight line through a dropout reveals ground that may not have been run, and
    // D-020 makes that permanent. Every surviving fix must be one the source actually sent.
    for (const p of out.points) expect(points).toContainEqual(p)
  })

  it("collapses a run of consecutive bad fixes into ONE break", () => {
    const points = track(6, 3)
    for (const i of [2, 3]) points[i] = { ...points[i], lat: points[i].lat + 400 / 111_320 }

    const out = sanitizeTracePoints(points, "run")
    expect(out.rejected).toBe(2)
    expect(out.breaks).toEqual([[1, 2]])
  })

  it("records no break when the bad fixes are at the very end", () => {
    const points = track(4, 3)
    points[3] = { ...points[3], lat: points[3].lat + 400 / 111_320 }

    const out = sanitizeTracePoints(points, "run")
    expect(out.rejected).toBe(1)
    // Nothing beyond it to draw a corridor TO, so there is nothing to warn about.
    expect(out.breaks).toEqual([])
  })

  it("leaves a clean trace completely untouched", () => {
    const points = track(20, 3)
    const out = sanitizeTracePoints(points, "run")

    expect(out.points).toEqual(points)
    expect(out.breaks).toEqual([])
    expect(out.rejected).toBe(0)
  })
})

describe("the gate is per-kind, and that decides real traces", () => {
  // 30 m per 2 s = 15 m/s: a 54 km/h descent. Over the foot gate, under the ride gate.
  const descent = track(6, 30, 2)

  it("keeps a fast descent when the kind is a ride", () => {
    const out = sanitizeTracePoints(descent, "ride")
    expect(out.rejected).toBe(0)
    expect(out.points).toHaveLength(6)
  })

  it("would have destroyed that same trace under the run gate", () => {
    // Not a hypothetical: this is what ANY single gate set for a person on foot does to
    // every ride. The first fix is always kept as the anchor, so five of six are lost.
    const out = sanitizeTracePoints(descent, "run")
    expect(out.rejected).toBe(5)
    expect(out.points).toHaveLength(1)
  })

  it("still rejects a real GPS jump on a ride", () => {
    const points = track(5, 30, 2)
    points[2] = { ...points[2], lat: points[2].lat + 400 / 111_320 }
    // 400 m in 2 s is 200 m/s — three orders of magnitude above any bicycle, which is
    // why the exact gate value matters far less than its existence.
    expect(sanitizeTracePoints(points, "ride").rejected).toBe(1)
  })

  it("falls back to the `other` gate for an unknown kind", () => {
    const out = sanitizeTracePoints(descent, "spelunking" as ActivityKind)
    expect(out.rejected).toBe(0)
  })
})

describe("degenerate input", () => {
  it("returns nothing for nothing", () => {
    expect(sanitizeTracePoints([], "run")).toEqual({ points: [], breaks: [], rejected: 0 })
  })

  it("always keeps the first fix — there is nothing to compare it against", () => {
    const one = track(1, 3)
    expect(sanitizeTracePoints(one, "run").points).toEqual(one)
  })

  it("treats two fixes sharing a timestamp as a duplicate, not a teleport", () => {
    const a: GeoPoint = { lat: NEMO.lat, lng: NEMO.lng, t: START }
    const same: GeoPoint = { ...a }
    // Zero distance in zero time is 0 m/s, not NaN and not Infinity.
    expect(sanitizeTracePoints([a, same], "run").rejected).toBe(0)
  })

  it("rejects a same-timestamp fix that is somewhere else entirely", () => {
    const a: GeoPoint = { lat: NEMO.lat, lng: NEMO.lng, t: START }
    const elsewhere: GeoPoint = { lat: NEMO.lat + 0.01, lng: NEMO.lng, t: START }
    expect(sanitizeTracePoints([a, elsewhere], "run").rejected).toBe(1)
  })

  /**
   * THE KNOWN WEAKNESS, ASSERTED RATHER THAN HIDDEN — filed as `0172`.
   *
   * §2.2 anchors on "the previous ACCEPTED point", and the first fix is always accepted
   * because there is nothing to compare it against. A cold-start fix 400 m off therefore
   * becomes the anchor and rejects the entire real trace behind it.
   *
   * This test exists so the behaviour is a recorded, testable fact rather than a surprise
   * on a run that quietly loses its map. The mitigation that ships today is `rejected`
   * being carried on the activity, which makes it loud.
   */
  it("loses the whole trace to a bad FIRST fix, which is why rejected is reported", () => {
    const points = track(10, 3)
    points[0] = { ...points[0], lat: points[0].lat + 400 / 111_320 }

    const out = sanitizeTracePoints(points, "run")
    expect(out.points).toHaveLength(1)
    expect(out.rejected).toBe(9)
  })
})
