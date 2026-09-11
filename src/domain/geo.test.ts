import { describe, expect, it } from "vitest"

import type { ActivityKind, GeoPoint } from "./activity"
import { MAX_IMPLIED_SPEED_MS, impliedSpeedMs, metresBetween } from "./geo"

/**
 * Ticket `0045`. These assertions were written for ticket `0037` and lived in the
 * adapter's `sanitize.test.ts` while the adapter owned the code. They moved with it.
 *
 * The move matters more than it looks: `scripts/check-adapter-deletion.mjs` measures what
 * breaks when the adapter directory is deleted (`0156` — 19 modules stubbed, one file
 * broken). Leaving the domain's only copy of these values covered exclusively by an
 * adapter's test would have made the gate silently untested the day the adapter is
 * replaced, which is the migration D-100 exists to make cheap.
 *
 * Coordinates are Point Nemo — `08-security-privacy.md` §7.2, D-199.
 */

const NEMO = { lat: -48.876, lng: -123.393 }

describe("metresBetween", () => {
  it("measures a degree of latitude to within half a percent", () => {
    // No `t` — `0057` widened the parameter to `Located`, and this is the assertion that the
    // clock-free shape is genuinely accepted. The `GeoPoint` case is the test below.
    const d = metresBetween({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })
    expect(d).toBeGreaterThan(110_000)
    expect(d).toBeLessThan(112_000)
  })

  it("is zero for a point and itself, and symmetric", () => {
    const a: GeoPoint = { lat: NEMO.lat, lng: NEMO.lng, t: 0 }
    const b: GeoPoint = { lat: NEMO.lat - 0.001, lng: NEMO.lng + 0.001, t: 0 }
    expect(metresBetween(a, a)).toBe(0)
    expect(metresBetween(a, b)).toBeCloseTo(metresBetween(b, a), 9)
  })
})

describe("impliedSpeedMs", () => {
  it("is metres over seconds", () => {
    const a: GeoPoint = { lat: NEMO.lat, lng: NEMO.lng, t: 0 }
    const b: GeoPoint = { lat: NEMO.lat + 30 / 111_320, lng: NEMO.lng, t: 10_000 }
    expect(impliedSpeedMs(a, b)).toBeCloseTo(3, 1)
  })

  it("separates a duplicate from a teleport when two fixes share a timestamp", () => {
    // Neither is a speed, and dividing by zero would make both Infinity — which would
    // silently reject a harmless duplicate as though it were a jump.
    const a: GeoPoint = { lat: NEMO.lat, lng: NEMO.lng, t: 1_000 }
    expect(impliedSpeedMs(a, { ...a })).toBe(0)
    expect(impliedSpeedMs(a, { ...a, lat: NEMO.lat + 0.01 })).toBe(Number.POSITIVE_INFINITY)
  })

  it("treats time running backwards as no interval at all", () => {
    const a: GeoPoint = { lat: NEMO.lat, lng: NEMO.lng, t: 10_000 }
    const b: GeoPoint = { lat: NEMO.lat + 0.01, lng: NEMO.lng, t: 0 }
    expect(impliedSpeedMs(a, b)).toBe(Number.POSITIVE_INFINITY)
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
    // §2.6 said 8 m/s. Measured against eight real traces it rejected six fixes at
    // 8, 8, 9, 9, 9 and 13 m/s and caught zero actual GPS jumps — see the constant's
    // comment and D-197. 12.5 is just above the ~12.4 m/s 100 m world-record peak.
    for (const kind of ["run", "walk", "hike"] as const) {
      expect(MAX_IMPLIED_SPEED_MS[kind]).toBeGreaterThan(12.4)
      // And still far below a real jump, which is ~200 m/s at a 2-second cadence.
      expect(MAX_IMPLIED_SPEED_MS[kind]).toBeLessThan(50)
    }
  })

  it("gives a ride room the foot gate would not (D-197)", () => {
    // The rules file has two enabled rows matching `kinds: [ride]`, so rides reach the
    // sanitizer and earn XP — and a descent exceeds any gate set for a person on foot.
    expect(MAX_IMPLIED_SPEED_MS.ride).toBeGreaterThan(MAX_IMPLIED_SPEED_MS.run)
  })

  it("has one gate for every kind that can reveal ground", () => {
    // Exactly one skill row carries `revealsGround: true` (D-189) and its `match` names
    // the three on-foot kinds. `src/domain/fog.ts` relies on their agreeing so that
    // `traceToCells` needs no `ActivityKind` parameter; if this fails, it does.
    expect(new Set(["run", "walk", "hike"].map((k) => MAX_IMPLIED_SPEED_MS[k as ActivityKind])).size).toBe(1)
  })
})
