import { readFileSync } from "node:fs"

import { cellToLatLng, type H3Index } from "h3-js"
import { describe, expect, it } from "vitest"

import type { GeoPoint, Trace } from "@/src/domain/activity"
import { classifyCells, SIX_MONTHS_MS, type CellRecord } from "@/src/domain/discovery"
import { traceToCells, traceToSegments } from "@/src/domain/fog"
import { runWithPurityTraps } from "@/src/purity/traps"
import { loadRuleSet } from "@/src/rules/load"

import {
  groundSplit,
  lookupFromClassified,
  rateGround,
  scoreGround,
  scoreUnits,
  type GroundSplit,
  type ScorableActivity,
} from "./index"

/**
 * Ticket 0061 — D-120 ground multipliers. Against the REAL v1 registry, as `0060`'s tests are.
 *
 * GEOMETRY IS SYNTHETIC, near Point Nemo — `08-security-privacy.md` §7.2, D-199. This
 * repository is public.
 */

const rules = loadRuleSet(1)
const wayfaring = rules.skills.find((s) => s.id === "wayfaring")!
const vigil = rules.skills.find((s) => s.id === "vigil")!

const NEMO = { lat: -48.876, lng: -123.393 }
const R_EARTH = 6_371_008.8
const toRad = (d: number) => (d * Math.PI) / 180
const toDeg = (r: number) => (r * 180) / Math.PI

/** A straight line due east: `count` points `spacingM` apart, at a running pace. */
function line(count: number, spacingM: number): GeoPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    lat: NEMO.lat,
    lng: NEMO.lng + toDeg((i * spacingM) / (R_EARTH * Math.cos(toRad(NEMO.lat)))),
    t: Math.round((i * spacingM * 1000) / 3),
  }))
}

function trace(points: GeoPoint[]): Trace {
  const lats = points.map((p) => p.lat)
  const lngs = points.map((p) => p.lng)
  return {
    points,
    gaps: [],
    simplified: false,
    bbox: [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)],
    pointCount: points.length,
  }
}

const START = "2026-09-01T07:00:00Z"
const startMs = Date.parse(START)
const iso = (ms: number) => new Date(ms).toISOString()
const DAY = 86_400_000

/**
 * THE REAL INGEST PATH, minus the store: `traceToCells` → `classifyCells` against pre-run
 * records → `lookupFromClassified` → `groundSplit`. `lastRunAt(cell)` decides each cell's
 * history from where its centre sits along the line.
 */
function splitFor(points: GeoPoint[], lastRunAt: (east: number) => string | undefined): GroundSplit {
  const t = trace(points)
  const cells = traceToCells(t)
  const records = new Map<H3Index, CellRecord>()
  const x0 = points[0]!.lng
  const x1 = points[points.length - 1]!.lng
  for (const c of cells) {
    const east = (cellToLatLng(c)[1] - x0) / (x1 - x0)
    const at = lastRunAt(east)
    if (at !== undefined) records.set(c, { lastRunAt: at })
  }
  const lookup = lookupFromClassified(classifyCells(cells, records, START))
  return groundSplit(traceToSegments(t).segments, lookup)
}

const pathLength = (split: GroundSplit) => split.new + split.rearmed + split.recent

const run = (distanceM: number): ScorableActivity => ({
  kind: "run",
  hasTrace: true,
  source: { source: "gpslogger", externalId: "x", sourceTypeRaw: "Run", fetchedAt: "" },
  distanceM,
  sets: [],
})

describe("classification by ground state (D-120)", () => {
  const points = line(151, 20) // 3,000 m
  const yearAgo = iso(startMs - 365 * DAY)
  const monthAgo = iso(startMs - 30 * DAY)

  it("all-new: every metre is over never-seen cells, rated at groundMultipliers.new", () => {
    const split = splitFor(points, () => undefined)
    expect(split.rearmed).toBe(0)
    expect(split.recent).toBe(0)
    expect(split.new).toBeCloseTo(3000, 0)

    const rows = rateGround({ skillId: "wayfaring", measure: "distanceKm", units: 3 }, wayfaring.groundMultipliers, split)
    expect(rows).toEqual([
      { skillId: "wayfaring", reason: "new_ground", units: 3, unitsEffective: 3 * wayfaring.groundMultipliers!.new },
    ])
  })

  it("all-re-armed: lastRunAt more than 6 months before startedAt → groundMultipliers.rearmed", () => {
    const split = splitFor(points, () => yearAgo)
    expect(split).toMatchObject({ new: 0, recent: 0 })
    const rows = rateGround({ skillId: "wayfaring", measure: "distanceKm", units: 3 }, wayfaring.groundMultipliers, split)
    expect(rows).toEqual([
      { skillId: "wayfaring", reason: "rearmed_ground", units: 3, unitsEffective: 3 * wayfaring.groundMultipliers!.rearmed },
    ])
  })

  it("all-recent: lastRunAt 6 months or less before startedAt → groundMultipliers.recent", () => {
    const split = splitFor(points, () => monthAgo)
    expect(split).toMatchObject({ new: 0, rearmed: 0 })
    const rows = rateGround({ skillId: "wayfaring", measure: "distanceKm", units: 3 }, wayfaring.groundMultipliers, split)
    expect(rows).toEqual([
      { skillId: "wayfaring", reason: "recent_ground", units: 3, unitsEffective: 3 * wayfaring.groundMultipliers!.recent },
    ])
  })

  it("the boundary is classifyCells' own: exactly 183 days re-arms, one ms less is recent", () => {
    const at = splitFor(points, () => iso(startMs - SIX_MONTHS_MS))
    const inside = splitFor(points, () => iso(startMs - SIX_MONTHS_MS + 1))
    expect(at.rearmed).toBeCloseTo(3000, 0)
    expect(inside.recent).toBeCloseTo(3000, 0)
  })

  it("all three in one trace: each third of the line lands in its own bucket", () => {
    const split = splitFor(points, (east) => (east < 1 / 3 ? undefined : east < 2 / 3 ? yearAgo : monthAgo))
    expect(pathLength(split)).toBeCloseTo(3000, 0)
    // A metre is classified by its segment's midpoint cell, so each boundary can move by at
    // most one cell diameter (~50 m at res 11).
    for (const g of ["new", "rearmed", "recent"] as const) expect(Math.abs(split[g] - 1000)).toBeLessThan(60)
  })

  it("the six-month clock is the activity's startedAt, never now(): classification is identical under purity traps", () => {
    const history = (east: number) => (east < 0.5 ? yearAgo : monthAgo)
    const plain = splitFor(points, history)
    const trapped = runWithPurityTraps("groundSplit", "04 §7.4: replay must classify identically", () => splitFor(points, history))
    expect(trapped).toEqual(plain)
  })
})

describe("blending and unit consistency", () => {
  it("04 §8.2 Example A: 8.368 km (the doc rounds to 8.369) over 3.180 / 1.255 / 3.933 km → 318 + 62 + 196 = 576 XP", () => {
    const split = { new: 3180, rearmed: 1255, recent: 3933 }
    const rows = rateGround({ skillId: "wayfaring", measure: "distanceKm", units: 8.368 }, wayfaring.groundMultipliers, split)
    expect(rows.map((r) => r.reason)).toEqual(["new_ground", "rearmed_ground", "recent_ground"])
    expect(rows.map((r) => r.units)).toEqual([expect.closeTo(3.18, 6), expect.closeTo(1.255, 6), expect.closeTo(3.933, 6)])
    // Floor once, per ledger row — the ledger's job (I-19), done here only to check the numbers.
    const xp = rows.map((r) => Math.floor(r.unitsEffective * wayfaring.xpPerUnit))
    expect(xp).toEqual([318, 62, 196])
    expect(xp.reduce((a, b) => a + b)).toBe(576)
  })

  it("Σ units over the buckets is the raw units EXACTLY, even when the path length disagrees with distanceM", () => {
    const units = 5.4321
    const rows = rateGround({ skillId: "wayfaring", measure: "distanceKm", units }, wayfaring.groundMultipliers, {
      new: 1234.567,
      rearmed: 890.123,
      recent: 3001.1,
    })
    expect(rows.reduce((s, r) => s + r.units, 0)).toBe(units)
  })

  it("nothing is rounded: unitsEffective is carried as a float for the ledger to floor once (I-19)", () => {
    const rows = rateGround({ skillId: "wayfaring", measure: "distanceKm", units: 1 }, wayfaring.groundMultipliers, {
      new: 1,
      rearmed: 1,
      recent: 1,
    })
    expect(rows.some((r) => !Number.isInteger(r.unitsEffective * 1000))).toBe(true)
  })

  it("empty buckets are dropped: a trace with no re-armed ground writes two rows, not three", () => {
    const rows = rateGround({ skillId: "wayfaring", measure: "distanceKm", units: 2 }, wayfaring.groundMultipliers, {
      new: 500,
      rearmed: 0,
      recent: 1500,
    })
    expect(rows.map((r) => r.reason)).toEqual(["new_ground", "recent_ground"])
  })

  it("the multipliers are the ROW's: a registry with different rates rates differently", () => {
    const rows = rateGround({ skillId: "x", measure: "distanceKm", units: 3 }, { new: 2, rearmed: 0.25, recent: 0.1 }, {
      new: 1000,
      rearmed: 1000,
      recent: 1000,
    })
    expect(rows.map((r) => r.unitsEffective)).toEqual([2, 0.25, expect.closeTo(0.1, 12)])
  })
})

describe("degenerate activities", () => {
  it("zero-distance trace: scoreUnits drops the skill, so no ground row is written at all", () => {
    const scored = scoreUnits(run(0), rules)
    expect(scored).toEqual([])
    expect(scoreGround(scored, rules, { new: 0, rearmed: 0, recent: 0 })).toEqual([])
  })

  it("zero-distance trace: a single repeated point has no segment length and splits to nothing", () => {
    const p = line(1, 0)[0]!
    expect(groundSplit([[p, { ...p, t: p.t + 1000 }]], () => "new")).toEqual({ new: 0, rearmed: 0, recent: 0 })
  })

  it("traceless activity: selects the null-ground skill and emits ONE `distance` row at full rate", () => {
    const scored = scoreUnits({ ...run(5000), hasTrace: false }, rules)
    expect(vigil.groundMultipliers).toBeNull()
    expect(scoreGround(scored, rules, null)).toEqual([
      { skillId: "vigil", reason: "distance", units: 5, unitsEffective: 5 },
    ])
  })

  it("groundMultipliers: null is never ground-classified, even when a split is supplied", () => {
    const rows = rateGround({ skillId: "vigil", measure: "distanceKm", units: 5 }, null, {
      new: 5000,
      rearmed: 0,
      recent: 0,
    })
    expect(rows).toEqual([{ skillId: "vigil", reason: "distance", units: 5, unitsEffective: 5 }])
  })

  it("a ground-scored skill whose path was entirely filtered out is known ground (05 §3.6): one recent row", () => {
    const rows = rateGround({ skillId: "wayfaring", measure: "distanceKm", units: 4 }, wayfaring.groundMultipliers, {
      new: 0,
      rearmed: 0,
      recent: 0,
    })
    expect(rows).toEqual([
      { skillId: "wayfaring", reason: "recent_ground", units: 4, unitsEffective: 4 * wayfaring.groundMultipliers!.recent },
    ])
  })

  it("a deferred cell is rated as recent — the lowest rate, so the replay can only add (D-135)", () => {
    const p = line(3, 20)
    expect(groundSplit([p], () => "deferred").recent).toBeCloseTo(40, 0)
  })

  it("a midpoint cell missing from the lookup throws rather than guessing a rate", () => {
    expect(() => groundSplit([line(3, 20)], () => undefined)).toThrow(/no ground verdict/)
  })
})

describe("end to end through the scorer", () => {
  it("scoreUnits → scoreGround: a traced run over mixed ground blends to the row's rates", () => {
    const points = line(151, 20)
    const split = splitFor(points, (east) => (east < 0.5 ? undefined : iso(startMs - 30 * DAY)))
    const rows = scoreGround(scoreUnits(run(3000), rules), rules, split)
    expect(rows.map((r) => r.reason)).toEqual(["new_ground", "recent_ground"])
    expect(rows.reduce((s, r) => s + r.units, 0)).toBe(3)
    const { new: n, recent: r } = wayfaring.groundMultipliers!
    const effective = rows.reduce((s, x) => s + x.unitsEffective, 0)
    expect(effective).toBeCloseTo(1.5 * n + 1.5 * r, 1)
  })
})

describe("no ground multiplier literal in the scorer", () => {
  it("ground.ts names no 0.5 / 1.0 rate; every one is read from the registry row", () => {
    const src = readFileSync(new URL("./ground.ts", import.meta.url), "utf8")
    const code = src.split("\n").filter((l) => !/^\s*(\/?\*|\/\/)/.test(l))
    expect(code.filter((l) => /\b(0?\.5|1\.0)\b/.test(l))).toEqual([])
  })
})
