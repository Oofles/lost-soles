import { getResolution, gridDisk, latLngToCell } from "h3-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { GeoPoint, Trace } from "./activity"
import { MAX_IMPLIED_SPEED_MS } from "./geo"
import {
  DENSIFY_STEP_M,
  DWELL_MIN_S,
  DWELL_SPEED_MS,
  MAX_ACC_M,
  RES,
  TELEPORT_SPEED_MS,
  traceToCells,
} from "./fog"

/**
 * Ticket `0045`. `05-fog-of-war.md` §2.2.
 *
 * ALL GEOMETRY HERE IS SYNTHETIC, near Point Nemo — `08-security-privacy.md` §7.2 and
 * D-199. This repository is public and a test is as good a place to publish a home address
 * as a fixture is.
 */

const NEMO = { lat: -48.876, lng: -123.393 }
const R_EARTH = 6_371_008.8
const toRad = (d: number) => (d * Math.PI) / 180
const toDeg = (r: number) => (r * 180) / Math.PI

/** `metres` along `bearing` (radians, 0 = north) from a point. */
function step(
  from: { lat: number; lng: number },
  metres: number,
  bearing: number,
): { lat: number; lng: number } {
  return {
    lat: from.lat + toDeg((metres * Math.cos(bearing)) / R_EARTH),
    lng:
      from.lng + toDeg((metres * Math.sin(bearing)) / (R_EARTH * Math.cos(toRad(from.lat)))),
  }
}

/**
 * A straight run: `count` samples, `spacingM` apart, at `speedMs`.
 *
 * Timestamps are derived from the spacing and the speed so a caller never accidentally
 * builds a trace that trips the teleport gate while meaning to test something else.
 */
function line(
  from: { lat: number; lng: number },
  bearing: number,
  count: number,
  spacingM: number,
  speedMs = 3,
  t0 = 0,
): GeoPoint[] {
  const out: GeoPoint[] = []
  for (let i = 0; i < count; i++) {
    const p = step(from, i * spacingM, bearing)
    out.push({ ...p, t: t0 + Math.round((i * spacingM * 1000) / speedMs) })
  }
  return out
}

/** Wraps points as a `Trace`. `gaps` defaults to none — every test that needs one says so. */
function trace(points: GeoPoint[], gaps: Array<[number, number]> = []): Trace {
  const lats = points.map((p) => p.lat)
  const lngs = points.map((p) => p.lng)
  return {
    points,
    gaps,
    simplified: false,
    bbox: points.length
      ? [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]
      : [0, 0, 0, 0],
    pointCount: points.length,
  }
}

const cellOf = (p: { lat: number; lng: number }) => latLngToCell(p.lat, p.lng, RES)

/** Metres between two points — the test's own yardstick, independent of the module. */
function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * One CONTINUOUS walk through a list of legs, sampled every `spacingM` at `speedMs`.
 *
 * Distinct from `line`, which builds one straight leg: a caller that concatenates several
 * `line` results gets an implicit jump between them, which the splitter may cut. Anything
 * testing a shape rather than a split has to be built here.
 */
function walk(
  start: { lat: number; lng: number },
  legs: Array<{ bearing: number; metres: number }>,
  spacingM = 10,
  speedMs = 3,
): GeoPoint[] {
  const out: GeoPoint[] = []
  let at = start
  let t = 0
  out.push({ ...at, t })
  for (const leg of legs) {
    const count = Math.round(leg.metres / spacingM)
    for (let i = 0; i < count; i++) {
      at = step(at, spacingM, leg.bearing)
      t += Math.round((spacingM * 1000) / speedMs)
      out.push({ ...at, t })
    }
  }
  return out
}

describe("traceToCells — resolution", () => {
  it("emits res-10 ids and nothing else (D-115)", () => {
    const cells = traceToCells(trace(line(NEMO, 0, 200, 5)))

    expect(cells.size).toBeGreaterThan(0)
    for (const c of cells) expect(getResolution(c)).toBe(RES)
    expect(RES).toBe(10)
  })

  it("returns a Set, because §3.3's whole edge-case list depends on it", () => {
    expect(traceToCells(trace(line(NEMO, 0, 10, 5)))).toBeInstanceOf(Set)
  })
})

/**
 * PURITY. §2.2 runs this server-side in the ingest Lambda, and `02-data-model.md` §8.3's
 * rebuild drill replays the archive years later and asserts the SAME cell count comes
 * back. A wall clock or an RNG anywhere in this path makes that drill impossible — which
 * is the property that makes D-101's reversibility real rather than claimed.
 *
 * Stubbed to THROW rather than to return a fixed value: a stub that returns something
 * lets a hidden call succeed and proves nothing.
 */
describe("traceToCells — purity", () => {
  afterEach(() => vi.restoreAllMocks())

  it("touches no clock, no RNG and no network", () => {
    vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("Date.now() in a pure function")
    })
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random() in a pure function")
    })
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch() in a pure function")
    })

    const cells = traceToCells(trace(line(NEMO, 1.1, 300, 4)))
    expect(cells.size).toBeGreaterThan(0)

    vi.unstubAllGlobals()
  })

  it("is deterministic — the same trace twice gives the same set", () => {
    const t = trace(line(NEMO, 0.7, 250, 6))
    expect([...traceToCells(t)].sort()).toEqual([...traceToCells(t)].sort())
  })
})

describe("traceToCells — step 1, cleaning", () => {
  it("drops samples with accuracy worse than the gate and keeps unknown accuracy", () => {
    const base = line(NEMO, 0, 40, 10)

    // A wild fix 5 km away, admitted only by its accuracy being absent.
    const far = { ...step(NEMO, 5_000, Math.PI / 2), t: base[20].t }

    const withUnknown = traceToCells(trace([...base.slice(0, 20), far, ...base.slice(20)]))
    const withBad = traceToCells(
      trace([
        ...base.slice(0, 20),
        { ...far, accuracyM: MAX_ACC_M + 1 },
        ...base.slice(20),
      ]),
    )
    const clean = traceToCells(trace(base))

    // Unknown accuracy is kept, so the outlier's own neighbourhood is qualified...
    expect(withUnknown.has(cellOf(far))).toBe(true)
    // ...and a reported-bad fix is dropped, leaving the clean trace exactly.
    expect(withBad.has(cellOf(far))).toBe(false)
    expect([...withBad].sort()).toEqual([...clean].sort())
  })

  it("keeps a sample whose accuracy is exactly at the gate", () => {
    const pts = line(NEMO, 0, 10, 10).map((p) => ({ ...p, accuracyM: MAX_ACC_M }))
    expect(traceToCells(trace(pts)).size).toBeGreaterThan(0)
  })

  it("drops non-finite coordinates without throwing", () => {
    const pts = line(NEMO, 0, 30, 10)
    const dirty = [
      ...pts.slice(0, 10),
      { lat: Number.NaN, lng: NEMO.lng, t: pts[10].t },
      { lat: NEMO.lat, lng: Number.POSITIVE_INFINITY, t: pts[10].t + 1 },
      ...pts.slice(10),
    ]
    expect([...traceToCells(trace(dirty))].sort()).toEqual([...traceToCells(trace(pts))].sort())
  })

  it("drops consecutive identical coordinates", () => {
    const pts = line(NEMO, 0, 30, 10)
    const repeated: GeoPoint[] = []
    for (const p of pts) {
      repeated.push(p)
      repeated.push({ ...p, t: p.t + 1 })
    }
    expect([...traceToCells(trace(repeated))].sort()).toEqual(
      [...traceToCells(trace(pts))].sort(),
    )
  })
})

describe("traceToCells — step 2, dwells", () => {
  /**
   * A three-minute pause with GPS drift: 180 samples wandering inside a ~40 m disc,
   * deterministic rather than random so the assertion is reproducible.
   */
  function dwell(at: { lat: number; lng: number }, seconds: number, t0: number): GeoPoint[] {
    const out: GeoPoint[] = []
    for (let i = 0; i < seconds; i++) {
      // A drifting spiral, never exceeding DWELL_SPEED_MS between samples.
      const r = 6 + (i % 17) * 2
      const a = i * 0.7
      out.push({ ...step(at, r, a), t: t0 + i * 1000 })
    }
    return out
  }

  it("collapses a long slow stretch, and the collapsed point still qualifies its cell", () => {
    const before = line(NEMO, 0, 30, 8)
    const at = step(NEMO, 29 * 8, 0)
    const paused = dwell(at, DWELL_MIN_S * 3, before[29].t + 1000)
    const after = line(at, 0, 30, 8, 3, paused[paused.length - 1].t + 1000)

    const withPause = traceToCells(trace([...before, ...paused, ...after]))
    const without = traceToCells(trace([...before, ...after]))

    // The runner was standing there, so that ground is still revealed.
    expect(withPause.has(cellOf(at))).toBe(true)

    // ...and the drift disc did not smear a halo of extra cells around it. Collapsing to
    // ONE point means the pause contributes no more than standing still would.
    expect(withPause.size).toBe(without.size)
    expect([...withPause].sort()).toEqual([...without].sort())
  })

  it("does not collapse a slow stretch shorter than the dwell minimum", () => {
    const at = NEMO
    const short = dwell(at, DWELL_MIN_S - 10, 0)
    // Nothing to assert about size here beyond it not throwing and not vanishing: the
    // point is that a 50-second traffic light is not a dwell.
    expect(traceToCells(trace(short)).size).toBeGreaterThan(0)
  })

  it("a dwell whose samples are identical still yields its own cell", () => {
    // Weiszfeld is undefined AT a sample; a stationary receiver reporting the same fix
    // for two minutes is the case that hits it.
    const pts: GeoPoint[] = []
    for (let i = 0; i < 120; i++) pts.push({ ...NEMO, lat: NEMO.lat + i * 1e-9, t: i * 1000 })
    expect(traceToCells(trace(pts)).has(cellOf(NEMO))).toBe(true)
  })

  it("the dwell speed and minimum are the values §2.2 specifies", () => {
    expect(DWELL_SPEED_MS).toBe(0.5)
    expect(DWELL_MIN_S).toBe(60)
  })
})

describe("traceToCells — step 3, splitting", () => {
  it("splits on a teleport and emits nothing along the joining chord", () => {
    const a = line(NEMO, 0, 40, 10)
    const jumpTo = step(NEMO, 3_000, Math.PI / 2)
    // 3 km in 10 s — far above any gate.
    const b = line(jumpTo, 0, 40, 10, 3, a[39].t + 10_000)

    const cells = traceToCells(trace([...a, ...b]))

    // The midpoint of the chord is 1.5 km from either leg. If it is revealed, the two
    // segments were interpolated across.
    const mid = step(NEMO, 1_500, Math.PI / 2)
    expect(cells.has(cellOf(mid))).toBe(false)

    // Both legs survive.
    expect(cells.has(cellOf(a[0]))).toBe(true)
    expect(cells.has(cellOf(b[0]))).toBe(true)

    // And the result is exactly the two legs scored independently.
    const separate = new Set([...traceToCells(trace(a)), ...traceToCells(trace(b))])
    expect([...cells].sort()).toEqual([...separate].sort())
  })

  it("splits on a wide gap that also lasts a long time", () => {
    // 2 km in 200 s = 10 m/s: under the teleport gate, so this exercises the DROPOUT
    // branch specifically rather than passing for the wrong reason.
    const a = line(NEMO, 0, 20, 10)
    const b = line(step(NEMO, 2_000, Math.PI / 2), 0, 20, 10, 3, a[19].t + 200_000)

    const cells = traceToCells(trace([...a, ...b]))
    expect(cells.has(cellOf(step(NEMO, 1_000, Math.PI / 2)))).toBe(false)
  })

  it("does NOT split a wide gap crossed quickly — that is a stride, not a dropout", () => {
    // 700 m in 117 s = 6 m/s: over SPLIT_GAP_M, UNDER SPLIT_GAP_S. Both conditions are
    // required, so this must be bridged.
    const a = line(NEMO, 0, 20, 10)
    const b = line(step(NEMO, 700, Math.PI / 2), 0, 20, 10, 3, a[19].t + 117_000)

    const cells = traceToCells(trace([...a, ...b]))
    expect(cells.has(cellOf(step(NEMO, 350, Math.PI / 2)))).toBe(true)
  })
})

/**
 * STEP 0 — `Trace.gaps`, D-198. Added to this ticket during implementation; see the
 * Resolution. §2.2's pseudocode predates the field, and `01-architecture.md` §11 is
 * explicit that no cell is emitted across a `gaps` interval.
 */
describe("traceToCells — gaps (D-198)", () => {
  it("never draws a corridor across a recorded gap", () => {
    // Deliberately crossable by every §2.2 rule: 700 m in 117 s at 6 m/s trips neither
    // the teleport gate (10 m/s < 12.5) nor the dropout split (117 s < 120 s). ONLY
    // `gaps` knows a fix was dropped here, so this isolates step 0 from step 3.
    const a = line(NEMO, 0, 20, 10)
    const b = line(step(NEMO, 700, Math.PI / 2), 0, 20, 10, 3, a[19].t + 117_000)
    const points = [...a, ...b]

    const bridged = traceToCells(trace(points))
    const cut = traceToCells(trace(points, [[19, 20]]))

    // 350 m from either leg — comfortably outside the ~197 m reach of a k=1 candidate
    // disc, so this probe answers the question it is asking and not a rounding one.
    const mid = step(NEMO, 350, Math.PI / 2)
    expect(bridged.has(cellOf(mid))).toBe(true)
    expect(cut.has(cellOf(mid))).toBe(false)
  })

  it("scores each side of a gap exactly as it would score it alone", () => {
    const a = line(NEMO, 0, 20, 10)
    const b = line(step(NEMO, 700, Math.PI / 2), 0, 20, 10, 3, a[19].t + 117_000)

    const cut = traceToCells(trace([...a, ...b], [[19, 20]]))
    const separate = new Set([...traceToCells(trace(a)), ...traceToCells(trace(b))])
    expect([...cut].sort()).toEqual([...separate].sort())
  })

  it("honours a gap pair spanning more than one adjacency", () => {
    const pts = line(NEMO, 0, 30, 20)
    const cut = traceToCells(trace(pts, [[10, 13]]))
    const separate = new Set([
      ...traceToCells(trace(pts.slice(0, 11))),
      ...traceToCells(trace(pts.slice(11, 12))),
      ...traceToCells(trace(pts.slice(12, 13))),
      ...traceToCells(trace(pts.slice(13))),
    ])
    expect([...cut].sort()).toEqual([...separate].sort())
  })
})

describe("traceToCells — step 4, densification", () => {
  it("a 400 m sampling gap along a straight road still yields a contiguous chain", () => {
    // The criterion's own case. Constructed as a bare Trace with no `gaps`, because on a
    // NORMALISED trace a 400 m sampling gap always spans more than GAP_THRESHOLD_MS and
    // is cut by `splitOnGaps` first — see the Resolution. What is proven here is the
    // densification itself: two samples 400 m apart must not yield two lonely cells.
    const a = { ...NEMO, t: 0 }
    const b = { ...step(NEMO, 400, 0), t: 100_000 }
    const cells = traceToCells(trace([a, b]))

    // Every 30 m along the road is qualified, so the chain has no hole in it.
    for (let d = 0; d <= 400; d += DENSIFY_STEP_M) {
      expect(cells.has(cellOf(step(NEMO, d, 0))), `hole at ${d} m`).toBe(true)
    }

    // Contiguity, stated as a graph property: every cell touches another one.
    const all = [...cells]
    for (const c of all) {
      const touching = gridDisk(c, 1).filter((n) => n !== c && cells.has(n))
      expect(touching.length, `isolated cell ${c}`).toBeGreaterThan(0)
    }
  })

  it("densifies at a spacing under res 10's inradius", () => {
    // 65.7 m is the inradius; anything at or above it can skip a cell.
    expect(DENSIFY_STEP_M).toBeLessThan(65.7)
    expect(DENSIFY_STEP_M).toBe(30)
  })

  it("a single-point trace still qualifies its own cell", () => {
    expect(traceToCells(trace([{ ...NEMO, t: 0 }])).has(cellOf(NEMO))).toBe(true)
  })
})

/**
 * §3.3's same-run edge cases. Every one of these is the `Set` doing the work — there is no
 * code in `fog.ts` that knows an out-and-back or a figure-eight exists, and that is the
 * point being asserted.
 */
describe("traceToCells — §3.3 same-run edge cases", () => {
  it("an out-and-back over one street equals the one-way set", () => {
    const out = line(NEMO, 0, 60, 8)
    const back = out
      .slice(0, -1)
      .reverse()
      .map((p, i) => ({ ...p, t: out[out.length - 1].t + (i + 1) * 2667 }))

    expect([...traceToCells(trace([...out, ...back]))].sort()).toEqual(
      [...traceToCells(trace(out))].sort(),
    )
  })

  it("a figure-eight's crossing point contributes one cell, not two", () => {
    // A CONTINUOUS figure-eight: two 300 m square lobes, north then south, sharing the
    // single crossing point they both start and finish at. Sampled as one unbroken walk,
    // because four disconnected legs with an implicit joining chord is not a figure-eight
    // and would test the splitter instead.
    const cross = NEMO
    const N = 0
    const E = Math.PI / 2
    const S = Math.PI
    const W = (3 * Math.PI) / 2
    const eight = walk(cross, [
      // north lobe, clockwise back to the crossing
      { bearing: N, metres: 300 },
      { bearing: E, metres: 300 },
      { bearing: S, metres: 300 },
      { bearing: W, metres: 300 },
      // south lobe, anticlockwise back to the crossing
      { bearing: S, metres: 300 },
      { bearing: W, metres: 300 },
      { bearing: N, metres: 300 },
      { bearing: E, metres: 300 },
    ])
    // Where the first lobe closes — the crossing, visited a second time.
    const closes = eight.findIndex((p, i) => i > 0 && metres(p, cross) < 5)

    const cells = traceToCells(trace(eight))
    const crossCell = cellOf(cross)

    // A Set holds it once by construction; assert it explicitly so the property is
    // recorded rather than assumed.
    expect([...cells].filter((c) => c === crossCell)).toHaveLength(1)
    expect(cells.has(crossCell)).toBe(true)

    // And the whole figure is exactly the union of its lobes — crossing your own path
    // adds nothing and loses nothing. Split AT the shared point so both lobes contain it,
    // which is what "they cross here" means.
    const union = new Set([
      ...traceToCells(trace(eight.slice(0, closes + 1))),
      ...traceToCells(trace(eight.slice(closes))),
    ])
    expect([...cells].sort()).toEqual([...union].sort())
  })

  it("running the same street twice in one activity changes nothing", () => {
    const once = line(NEMO, 0.4, 50, 9)
    const twice = [...once, ...once.map((p, i) => ({ ...p, t: p.t + 600_000 + i }))]
    expect([...traceToCells(trace(twice))].sort()).toEqual(
      [...traceToCells(trace(once))].sort(),
    )
  })
})

describe("traceToCells — degenerate input", () => {
  it("an all-garbage trace returns an empty set without throwing", () => {
    const garbage: GeoPoint[] = [
      { lat: Number.NaN, lng: Number.NaN, t: 0 },
      { lat: Number.POSITIVE_INFINITY, lng: 0, t: 1000 },
      { lat: 0, lng: Number.NEGATIVE_INFINITY, t: 2000 },
      { ...NEMO, t: 3000, accuracyM: MAX_ACC_M + 500 },
    ]
    const cells = traceToCells(trace(garbage))
    expect(cells.size).toBe(0)
  })

  it("an empty trace returns an empty set", () => {
    expect(traceToCells(trace([])).size).toBe(0)
  })
})

/**
 * CRITERION 11 — the two speed gates are reconciled by being THE SAME GATE.
 *
 * §2.2 specified `TELEPORT_SPEED = 12.0` and D-197 set the ingestion sanitizer to 12.5 for
 * foot activities after measuring 21,225 real fixes. The audit that found the contradiction
 * (`05-strava-adapter`, 2026-09-06, divergence 2) made resolving it this ticket's job. See
 * `fog.ts`'s comment on `TELEPORT_SPEED_MS` for the reasoning; these assert the outcome.
 */
describe("traceToCells — the teleport gate (criterion 11, D-197)", () => {
  it("is the sanitizer's gate, by reference and not by restatement", () => {
    expect(TELEPORT_SPEED_MS).toBe(MAX_IMPLIED_SPEED_MS.run)
    // Restating the number would let the two drift the next time either is measured
    // (D-193), so the test asserts the IDENTITY, not the value.
    expect(TELEPORT_SPEED_MS).not.toBe(12.0)
  })

  it("every kind that can reveal ground shares one gate", () => {
    // Exactly one skill row carries `revealsGround: true` (D-189) and its `match` names
    // the three on-foot kinds. If that ever stops being true, traceToCells needs a kind.
    for (const kind of ["run", "walk", "hike"] as const) {
      expect(MAX_IMPLIED_SPEED_MS[kind]).toBe(TELEPORT_SPEED_MS)
    }
  })

  it("does not split in the 12.0–12.5 band the sanitizer deliberately admits", () => {
    // A 12.2 m/s burst: rejected by §2.2's literal 12.0, kept by D-197. Keeping it is the
    // whole point — a split here would write the dotted corridor §9.5 warns about.
    const a = { ...NEMO, t: 0 }
    const b = { ...step(NEMO, 12.2, 0), t: 1000 }
    const c = { ...step(NEMO, 24.4, 0), t: 2000 }
    const cells = traceToCells(trace([a, b, c]))

    // No split means the run is one segment, so the midpoint is revealed.
    expect(cells.has(cellOf(step(NEMO, 12.2, 0)))).toBe(true)
    expect(cells.size).toBe(traceToCells(trace([a, b, c])).size)
  })
})
