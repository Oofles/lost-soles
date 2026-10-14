import { describe, expect, it } from "vitest"

import type { Position } from "@/src/domain/simplify-line"

import { buildWeb, EMPTY_WEB, WEAR, WEAR_MAX, wearStep, type WebRunInput } from "./web"

/**
 * Ticket `0085`. GEOMETRY IS SYNTHETIC, near Point Nemo — `08-security-privacy.md` §7.2, D-199.
 */

const NEMO = { lat: -48.876, lng: -123.393 }
const R_EARTH = 6_371_008.8
const RAD = Math.PI / 180

/** A straight line east from `from`, `km` long, offset `northM` metres north, one vertex per 3 m. */
function east(km: number, northM = 0, from = NEMO): Position[] {
  const out: Position[] = []
  const lat = from.lat + northM / (R_EARTH * RAD)
  for (let m = 0; m <= km * 1000; m += 3) {
    out.push([from.lng + m / (R_EARTH * RAD * Math.cos(lat * RAD)), lat])
  }
  return out
}

const run = (id: string, day: number, lines: Position[][]): WebRunInput => ({
  activityId: id,
  startedAt: `2026-09-${String(day).padStart(2, "0")}T07:00:00Z`,
  lines,
})

function lengthM(c: Position[]): number {
  let d = 0
  for (let i = 1; i < c.length; i++) {
    const [a, b] = [c[i - 1]!, c[i]!]
    const x = (b[0] - a[0]) * Math.cos(a[1] * RAD)
    d += Math.hypot(x, b[1] - a[1]) * RAD * R_EARTH
  }
  return d
}

const drawnM = (web: ReturnType<typeof buildWeb>) =>
  web.features.reduce((sum, f) => sum + lengthM(f.geometry.coordinates), 0)

describe("buildWeb", () => {
  it("draws nothing for nothing", () => {
    expect(buildWeb([])).toEqual(EMPTY_WEB)
  })

  it("draws a route run once at --ink-300's 0.28", () => {
    const web = buildWeb([run("a", 1, [east(1)])])
    expect(web.features.length).toBeGreaterThan(0)
    expect(new Set(web.features.map((f) => f.properties.wear))).toEqual(new Set([0.28]))
    expect(drawnM(web)).toBeGreaterThan(990)
  })

  it("draws the same street once however many times it was run, and darker (criterion 2)", () => {
    const once = buildWeb([run("a", 1, [east(1)])])
    // Five runs a few metres apart: GPS on the same pavement.
    const five = buildWeb([0, 3, -2, 4, 1].map((off, i) => run(`r${i}`, i + 1, [east(1, off)])))
    // Drawn once: not five times the ink, so overlap cannot compound towards black.
    expect(drawnM(five)).toBeLessThan(drawnM(once) * 1.15)
    const wear = Math.max(...five.features.map((f) => f.properties.wear))
    expect(wear).toBe(WEAR[wearStep(5)])
    expect(wear).toBeGreaterThan(0.28)
  })

  it("never draws darker than WEAR_MAX, even a daily commute for a year", () => {
    const year = Array.from({ length: 365 }, (_, i) => run(`d${i}`, (i % 28) + 1, [east(0.5, (i % 7) - 3)]))
    const web = buildWeb(year)
    expect(Math.max(...web.features.map((f) => f.properties.wear))).toBe(WEAR_MAX)
    expect(WEAR_MAX).toBeLessThanOrEqual(0.6)
    expect(drawnM(web)).toBeLessThan(600)
  })

  it("keeps a parallel street 60 m away as its own path, at its own weight", () => {
    const web = buildWeb([run("a", 1, [east(1)]), run("b", 2, [east(1, 60)])])
    expect(drawnM(web)).toBeGreaterThan(1900)
    expect(new Set(web.features.map((f) => f.properties.wear))).toEqual(new Set([0.28]))
  })

  it("draws an out-and-back once, at a single run's weight", () => {
    const out = east(1)
    const web = buildWeb([run("a", 1, [[...out, ...out.slice().reverse()]])])
    expect(drawnM(web)).toBeLessThan(1150)
    expect(new Set(web.features.map((f) => f.properties.wear))).toEqual(new Set([0.28]))
  })

  it("draws a repeat run's new branch, joined to the web", () => {
    const base = run("a", 1, [east(1)])
    // Half the old street, then 500 m due south on ground nobody has run.
    const along = east(0.5)
    const turn = along[along.length - 1]!
    const south: Position[] = Array.from({ length: 168 }, (_, i) => [turn[0], turn[1] - ((i + 1) * 3) / (R_EARTH * RAD)])
    const branch = [...along, ...south]
    const web = buildWeb([base, run("b", 2, [branch])])
    expect(drawnM(web)).toBeGreaterThan(1400)
  })

  it("does not depend on the order the runs arrive in", () => {
    const runs = [run("a", 3, [east(1)]), run("b", 1, [east(1, 2)]), run("c", 2, [east(1, 60)])]
    expect(buildWeb(runs)).toEqual(buildWeb(runs.slice().reverse()))
  })

  it("can leave one run out — beat 1's web before this run", () => {
    const runs = [run("a", 1, [east(1)]), run("b", 2, [east(1, 2)])]
    expect(buildWeb(runs, { exclude: "b" })).toEqual(buildWeb([runs[0]!]))
  })

  it("carries a paint value and no count (criterion 3)", () => {
    const web = buildWeb([0, 1, 2].map((off, i) => run(`r${i}`, i + 1, [east(0.3, off)])))
    for (const f of web.features) expect(Object.keys(f.properties)).toEqual(["wear"])
  })

  it("draws no chord across a gap between two lines of one run", () => {
    const web = buildWeb([run("a", 1, [east(0.3), east(0.3, 0, { lat: NEMO.lat, lng: NEMO.lng + 0.02 })])])
    for (const f of web.features) expect(lengthM(f.geometry.coordinates)).toBeLessThan(320)
  })
})
