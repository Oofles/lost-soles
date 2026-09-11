import {
  UNITS,
  cellToLatLng,
  getHexagonAreaAvg,
  getHexagonEdgeLengthAvg,
  getResolution,
  gridDisk,
  latLngToCell,
} from "h3-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { GeoPoint, Trace } from "./activity"
import { MAX_IMPLIED_SPEED_MS } from "./geo"
import {
  MAX_ACC_M,
  DENSIFY_STEP_M,
  DWELL_MIN_S,
  DWELL_SPEED_MS,
  RES,
  REVEAL_R_M,
  TELEPORT_SPEED_MS,
  distancePointToSegments,
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

/**
 * The midpoint of the straight line between two points — where a BRIDGED corridor actually
 * runs, as opposed to where the two legs happen to point.
 *
 * Added by `0194` (res 10 → 11), and it fixed two tests that had been passing for the wrong
 * reason. Both probed `step(NEMO, 350, π/2)` for "the corridor was bridged", and that point
 * is **91.7 m from the bridging segment** — outside `REVEAL_R_M` entirely. They passed at
 * res 10 because that one cell's centre happened to sit 61.3 m from the line, 30 m nearer
 * than the probe itself; at res 11 the smaller cell's centre lands at 75.1 m and the same
 * assertion fails. The corridor was never the thing being measured — grid slop was.
 *
 * Probing the real midpoint measures the bridge at any resolution.
 */
function midOf(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }
}

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
  it("emits res-11 ids and nothing else (D-237, superseding D-115)", () => {
    const cells = traceToCells(trace(line(NEMO, 0, 200, 5)))

    expect(cells.size).toBeGreaterThan(0)
    for (const c of cells) expect(getResolution(c)).toBe(RES)
    expect(RES).toBe(11)
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

    // ...and the drift disc did not smear a halo of extra cells around it. Collapsing to ONE
    // point means the pause reaches no further than a single point can.
    //
    // **Was `expect(withPause.size).toBe(without.size)` until 0194.** Exact equality held at
    // res 10 by coarseness: the collapsed median sits a few metres off `at`, and at a 65.7 m
    // inradius a few metres never crossed a cell boundary. At res 11 it crosses two, and the
    // ground those two cells cover is ground the runner genuinely stood on — so the equality
    // was measuring the grid, not the collapse. The property that actually matters is that the
    // pause cannot reach beyond ONE point's reveal radius; an UNcollapsed spiral would reach
    // 38 m further, which is the smear this guards against.
    // The bound is ONE point's worth of cells — a disc, derived from the grid — because the
    // collapsed median lands a few metres off `at` (measured: ~8 m, so its reveal reaches 73 m
    // from `at`, which is right and is why a 65 m reach assertion is the wrong shape). An
    // UNcollapsed spiral would paint a 103 m halo and dozens of cells; that is the smear.
    const onepoint = Math.ceil((Math.PI * REVEAL_R_M ** 2) / getHexagonAreaAvg(RES, UNITS.m2)) + 1
    const extra = [...withPause].filter((c) => !without.has(c))
    expect(extra.length).toBeLessThanOrEqual(onepoint)
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
    // ON the bridging segment — a[19] to b[0] — not 350 m east of the start, which is 91.7 m
    // off that line and outside REVEAL_R_M. See `midOf`.
    expect(cells.has(cellOf(midOf(a[19]!, b[0]!)))).toBe(true)
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

    // The midpoint OF THE BRIDGE, ~362 m from either leg's nearest end — comfortably outside
    // the reach of a k=1 candidate disc around any real sample, so `cut` answers the question
    // being asked and not a rounding one, while `bridged` sits exactly on the corridor. See
    // `midOf` for why the previous probe (350 m east) measured grid slop instead.
    const mid = midOf(a[19]!, b[0]!)
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

  it("densifies at a spacing under the grid's inradius, whatever the grid is", () => {
    // Anything at or above the inradius can skip a cell. Derived rather than quoted, because
    // 0194 moved RES and the old assertion (`< 65.7`) would have stayed green at 30 m while
    // res 11's inradius fell to 24.8 m — passing, and wrong, which is the worst outcome.
    const inradius = getHexagonEdgeLengthAvg(RES, UNITS.m) * Math.cos(Math.PI / 6)
    expect(DENSIFY_STEP_M).toBeLessThan(inradius)
    expect(DENSIFY_STEP_M).toBe(12)
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

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * TICKET `0046` — step 5, the exact radius filter. `05-fog-of-war.md` §2.2/§2.3.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** A straight road through a known cell, offset `offsetM` metres to its north. */
function roadPast(
  centre: { lat: number; lng: number },
  offsetM: number,
  lengthM = 800,
  speedMs = 3,
): GeoPoint[] {
  const from = step(step(centre, offsetM, 0), -lengthM / 2, Math.PI / 2)
  return line(from, Math.PI / 2, lengthM / 10 + 1, 10, speedMs)
}

describe("distancePointToSegments — to the SEGMENTS, not the vertices", () => {
  it("measures perpendicular to a long edge, not to its far-apart endpoints", () => {
    // One 1 km edge, two vertices. The query point sits 40 m off its midpoint, so the
    // nearest VERTEX is ~501 m away and the nearest point ON THE SEGMENT is 40 m. A
    // vertex-only implementation returns 501 and is wrong by an order of magnitude.
    const a = NEMO
    const b = step(NEMO, 1000, Math.PI / 2)
    const mid = step(step(NEMO, 500, Math.PI / 2), 40, 0)

    const toVertex = Math.min(metres(mid, a), metres(mid, b))
    expect(toVertex).toBeGreaterThan(500)

    expect(distancePointToSegments(mid, [[a, b]])).toBeCloseTo(40, 0)
  })

  it("clamps to the endpoint when the perpendicular foot is off the end", () => {
    // Beyond the segment there is no foot, and the honest answer is the endpoint
    // distance. An unclamped projection would report a negative-side foot and reveal
    // ground past the end of the run.
    const a = NEMO
    const b = step(NEMO, 200, Math.PI / 2)
    const past = step(b, 150, Math.PI / 2)
    expect(distancePointToSegments(past, [[a, b]])).toBeCloseTo(150, 0)
  })

  it("a one-vertex segment measures as a point", () => {
    const solo = step(NEMO, 90, 0)
    expect(distancePointToSegments(NEMO, [[solo]])).toBeCloseTo(90, 0)
  })

  it("takes the minimum across segments, and an empty list is Infinity", () => {
    const near = step(NEMO, 30, 0)
    const far = step(NEMO, 900, 0)
    expect(distancePointToSegments(NEMO, [[far, far], [near, near]])).toBeCloseTo(30, 0)
    expect(distancePointToSegments(NEMO, [])).toBe(Infinity)
  })

  it("THE JOINING CHORD IS NOT A SEGMENT, so it contributes no distance", () => {
    // Two segments 600 m apart — the shape a teleport or a `gaps` entry leaves behind.
    // A point halfway between them is 300 m from both. If the chord were an edge of this
    // geometry the answer would be 0, and the buildings under it would be revealed.
    const endA = step(NEMO, 100, Math.PI / 2)
    const startB = step(NEMO, 700, Math.PI / 2)
    const between = step(NEMO, 400, Math.PI / 2)

    const split = distancePointToSegments(between, [[NEMO, endA], [startB, step(startB, 100, Math.PI / 2)]])
    expect(split).toBeCloseTo(300, 0)

    // The same vertices as ONE polyline — i.e. if the split had not happened — is 0.
    const joined = distancePointToSegments(between, [[NEMO, endA, startB, step(startB, 100, Math.PI / 2)]])
    expect(joined).toBeLessThan(1)
  })

  it("measures across the antimeridian rather than the long way round", () => {
    const east = { lat: 0, lng: 179.9995 }
    const west = { lat: 0, lng: -179.9995 }
    // ~111 m apart across the seam; a naive lng difference makes it ~40,000 km.
    expect(distancePointToSegments(east, [[west, west]])).toBeLessThan(200)
  })
})

describe("traceToCells — step 5, the reveal radius", () => {
  it("REVEAL_R_M is 65, the number §2.3 justifies against res 10's inradius", () => {
    expect(REVEAL_R_M).toBe(65)
  })

  it("includes a cell whose centre is 64 m from the path", () => {
    const cell = cellOf(NEMO)
    const [lat, lng] = cellToLatLng(cell)
    const cells = traceToCells(trace(roadPast({ lat, lng }, 64)))
    expect(cells.has(cell)).toBe(true)
  })

  it("excludes a cell whose centre is 66 m from the path", () => {
    // One metre the other side of the constant, and the answer flips. This is the
    // boundary the whole ticket is about: 65 m is not a soft edge.
    const cell = cellOf(NEMO)
    const [lat, lng] = cellToLatLng(cell)
    const cells = traceToCells(trace(roadPast({ lat, lng }, 66)))
    expect(cells.has(cell)).toBe(false)
  })

  it("every revealed cell is within REVEAL_R_M of the path, and nothing else is", () => {
    // The k=1 candidate disc is ~394 m across; if step 5 were skipped this fails loudly.
    const points = walk(NEMO, [{ bearing: 0, metres: 500 }, { bearing: Math.PI / 2, metres: 500 }])
    const cells = traceToCells(trace(points))
    expect(cells.size).toBeGreaterThan(0)
    for (const c of cells) {
      const [lat, lng] = cellToLatLng(c)
      expect(distancePointToSegments({ lat, lng }, [points])).toBeLessThanOrEqual(REVEAL_R_M)
    }
  })

  it("reveals only ground within REVEAL_R_M of a point actually covered", () => {
    // **This test asserted `revealed ⊆ entered` until 0194, and D-216 was why.** At res 10,
    // 65 m sat just under the 65.7 m inradius, so a centre within 65 m of the path had the
    // nearest path point inside its own inscribed circle — hence inside the cell, hence
    // entered. D-237 moved the grid to res 11, where 65 m is 2.6 inradii, and the implication
    // is simply false: a revealed cell two rings off the path was never entered.
    //
    // What did NOT change is the ground. The reveal is, and always was, "within 65 m of where
    // you ran" — res 10 merely expressed it coarsely enough to look like cell containment.
    // So this now asserts the invariant itself, measured with the test's own yardstick against
    // the RAW samples rather than through the module's segment maths.
    //
    // The tolerance is the sample spacing: `walk` samples every 10 m, and membership is
    // measured to the SEGMENTS, so a centre can be up to half a step further from the nearest
    // sampled point than from the path. Anything beyond that is a real over-reveal.
    const SPACING_M = 10
    const points = walk(NEMO, [
      { bearing: 0, metres: 900 },
      { bearing: Math.PI / 3, metres: 900 },
      { bearing: Math.PI, metres: 600 },
    ])
    const cells = traceToCells(trace(points))
    for (const c of cells) {
      const [lat, lng] = cellToLatLng(c)
      const nearest = Math.min(...points.map((p) => metres({ lat, lng }, p)))
      expect(nearest, `${c} is ${nearest.toFixed(1)} m from any sample`).toBeLessThanOrEqual(
        REVEAL_R_M + SPACING_M / 2,
      )
    }
    expect(cells.size).toBeGreaterThan(10)
  })
})

describe("traceToCells — a wild outlier draws no spike (§2.2 note on noise)", () => {
  /** A clean east–west run, with an optional single fix flung `offM` metres north of it. */
  function withOutlier(offM: number | null): GeoPoint[] {
    const clean = line(NEMO, Math.PI / 2, 61, 10) // 600 m at 3 m/s, 10 m spacing
    if (offM == null) return clean
    const at = clean[30]
    const rogue = { ...step(at, offM, 0), t: at.t + 1000 }
    // One second later and 300 m away: 300 m/s. Step 3 cuts on both sides, which is what
    // isolates it — exactly the failure the sanitizer's gate also catches.
    return [...clean.slice(0, 31), rogue, ...clean.slice(31).map((p) => ({ ...p, t: p.t + 2000 }))]
  }

  it("qualifies only cells within 65 m of the outlier itself", () => {
    const withRogue = traceToCells(trace(withOutlier(300)))
    const withoutRogue = traceToCells(trace(withOutlier(null)))
    const extra = [...withRogue].filter((c) => !withoutRogue.has(c))

    const at = line(NEMO, Math.PI / 2, 61, 10)[30]
    const rogue = step(at, 300, 0)
    for (const c of extra) {
      const [lat, lng] = cellToLatLng(c)
      expect(metres({ lat, lng }, rogue)).toBeLessThanOrEqual(REVEAL_R_M)
    }
  })

  it("draws no chain of cells stretching from the path toward it", () => {
    // A 300 m spike densified along its length would be a line of extra cells. The outlier is
    // its own segment, so the corridor between is never drawn and the cost is bounded to the
    // outlier's own neighbourhood — a DISC, not a line.
    //
    // The bound is that disc's cell count, derived rather than quoted: 0194 moved RES and a
    // hard-coded 2 would have failed at res 11 for no reason but cell size. It comes out at 2
    // for res 10 — exactly the number this test carried before — and 8 for res 11, against a
    // 300 m chain that would be ~12.
    const discCells =
      Math.ceil((Math.PI * REVEAL_R_M ** 2) / (getHexagonAreaAvg(RES, UNITS.m2))) + 1
    const withRogue = traceToCells(trace(withOutlier(300)))
    const withoutRogue = traceToCells(trace(withOutlier(null)))
    const extra = [...withRogue].filter((c) => !withoutRogue.has(c))
    expect(extra.length).toBeLessThanOrEqual(discCells)
  })
})

describe("traceRejectCounts — why the projection dropped what it dropped (0180)", () => {
  /**
   * `05` §3.6's last bullet: *"a trace with points but ALL of them filtered out by §2.2 is
   * treated as no-GPS, and the ingest logs a warning with the reject counts so it is VISIBLE
   * rather than silently scoring nothing."*
   *
   * Without these, a watch emitting 2,000 fixes at 60 m accuracy produces an activity
   * indistinguishable from a treadmill run — and that is the failure this whole file's
   * counting exists to surface.
   */
  it("a clean run reports zeros and one segment", () => {
    const cells = traceToCells(trace(line(NEMO, 0, 40, 30)))
    expect(cells.size).toBeGreaterThan(0)
    expect(cells.rejects).toEqual({ accuracy: 0, duplicate: 0, nonFinite: 0, segments: 1 })
  })

  /** CRITERION 4. Every sample over `MAX_ACC_M`: zero cells, and the count says why. */
  it("EVERY sample failing the accuracy gate gives zero cells and accuracy == pointCount", () => {
    const points = line(NEMO, 0, 200, 30).map((p) => ({ ...p, accuracyM: MAX_ACC_M + 10 }))
    const cells = traceToCells(trace(points))

    expect(cells.size).toBe(0)
    expect(cells.rejects.accuracy).toBe(points.length)
    expect(cells.rejects.segments).toBe(0)
  })

  it("counts only the samples that failed, not the ones that passed", () => {
    const points = line(NEMO, 0, 40, 30).map((p, i) =>
      i % 2 === 0 ? { ...p, accuracyM: MAX_ACC_M + 1 } : { ...p, accuracyM: 5 },
    )
    const cells = traceToCells(trace(points))
    expect(cells.rejects.accuracy).toBe(20)
    expect(cells.size).toBeGreaterThan(0)
  })

  /** An absent `accuracyM` is UNKNOWN, not zero — the only source that ships sends none. */
  it("never counts a missing accuracyM as a rejection", () => {
    expect(traceToCells(trace(line(NEMO, 0, 20, 30))).rejects.accuracy).toBe(0)
  })

  it("counts consecutive identical coordinates as duplicates", () => {
    const base = line(NEMO, 0, 10, 30)
    const withRepeats = base.flatMap((p) => [p, { ...p, t: p.t + 1000 }])
    const cells = traceToCells(trace(withRepeats))
    expect(cells.rejects.duplicate).toBe(10)
    expect(cells.rejects.accuracy).toBe(0)
  })

  it("counts a non-finite coordinate — a value that should always be zero", () => {
    const points = line(NEMO, 0, 10, 30)
    points[3] = { ...points[3]!, lat: Number.NaN }
    points[5] = { ...points[5]!, lng: Number.POSITIVE_INFINITY }
    expect(traceToCells(trace(points)).rejects.nonFinite).toBe(2)
  })

  /**
   * `segments` is NOT a drop count and is reported anyway (D-222): the teleport gate splits
   * rather than drops (D-212), so "samples rejected by the speed gate" does not exist in this
   * layer. A recording that arrives as one trace and leaves as several is the diagnostic.
   */
  it("reports the segment count, which is what the teleport gate actually produces", () => {
    const first = line(NEMO, 0, 10, 30)
    const far = step(NEMO, 5000, 30)
    const second = line(far, 0, 10, 30, 3, first[first.length - 1]!.t + 20_000)
    const cells = traceToCells(trace([...first, ...second]))

    expect(cells.rejects.segments).toBe(2)
    // Nothing was DROPPED — every sample survives, in one of the two pieces.
    expect(cells.rejects.accuracy + cells.rejects.duplicate + cells.rejects.nonFinite).toBe(0)
    expect(cells.size).toBeGreaterThan(0)
  })

  it("a declared gap splits too, and is likewise not a drop", () => {
    const points = line(NEMO, 0, 20, 30)
    const cells = traceToCells(trace(points, [[9, 10]]))
    expect(cells.rejects.segments).toBe(2)
    expect(cells.rejects.duplicate).toBe(0)
  })

  it("an empty trace reports zeros and no segments", () => {
    expect(traceToCells(trace([])).rejects).toEqual({
      accuracy: 0,
      duplicate: 0,
      nonFinite: 0,
      segments: 0,
    })
  })

  /**
   * CRITERION 1's ergonomics clause: the `Set` stays the primary result and no existing caller
   * had to destructure. Asserted rather than assumed, because a `Set` subclass or a
   * `{cells, rejects}` tuple would both have broken every call site in `0045` and `0046`.
   */
  it("is still an ordinary Set — size, has, iteration and spread all unchanged", () => {
    const cells = traceToCells(trace(line(NEMO, 0, 20, 30)))
    expect(cells).toBeInstanceOf(Set)
    expect(typeof cells.size).toBe("number")
    const spread = [...cells]
    expect(spread).toHaveLength(cells.size)
    expect(cells.has(spread[0]!)).toBe(true)
    for (const c of cells) expect(getResolution(c)).toBe(RES)
  })
})
