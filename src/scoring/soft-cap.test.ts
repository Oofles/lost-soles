import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import type { WorkoutSet } from "@/src/domain/activity"
import { loadRuleSet } from "@/src/rules/load"
import type { RuleSkill } from "@/src/rules/schema"

import { rateGround, scoreActivity, scoreGround, scoreUnits, softCap, type ScorableActivity } from "./index"

/**
 * Ticket 0218 — `04` §3.5's soft cap. Against the REAL v1 registry: every capped row is
 * exercised by iterating the rows, so a capped skill added later is covered without a test
 * edit. Skill ids appear in test files only (D-031).
 */

const rules = loadRuleSet(1)
const capped = rules.skills.filter((s) => s.kind === "activity" && s.softCapUnits !== null)

/** A strength session carrying `n` units of `row`'s measure, built from the measure itself. */
function sessionFor(row: RuleSkill, n: number): ScorableActivity {
  const [kernel, exercise] = row.match!.measure.split(":") as [string, string]
  const set: WorkoutSet = kernel === "reps" ? { exercise, reps: n } : { exercise, durationS: n }
  return {
    kind: "strength",
    hasTrace: false,
    source: { source: "manual", externalId: "x", sourceTypeRaw: "", fetchedAt: "" },
    sets: [set],
  }
}

function effectiveFor(row: RuleSkill, n: number) {
  const rows = scoreGround(scoreUnits(sessionFor(row, n), rules), rules, null)
  const mine = rows.filter((r) => r.skillId === row.id)
  expect(mine).toHaveLength(1)
  return mine[0]!
}

describe("the formula, as 04 §3.5 writes it", () => {
  it("reproduces §3.5's worked table for S = 100", () => {
    const entered = [50, 100, 150, 200, 300, 500, 1000, 5000]
    expect(entered.map((n) => softCap(n, 100))).toEqual([50, 100, 125, 150, 175, 225, 250, 250])
  })

  it("plateaus at 2.5 × S, reached at exactly 6S and never exceeded", () => {
    expect(softCap(600, 100)).toBe(250)
    expect(softCap(599, 100)).toBeLessThan(250)
    expect(softCap(1e9, 100)).toBe(250)
  })

  it("is monotone non-decreasing: logging more never earns less (D-135's spirit)", () => {
    let prev = -1
    for (let n = 0; n <= 800; n += 0.5) {
      const e = softCap(n, 100)
      expect(e).toBeGreaterThanOrEqual(prev)
      prev = e
    }
  })

  it("softCapUnits: null is the identity — an ultramarathon is paid in full", () => {
    expect(softCap(160.9, null)).toBe(160.9)
  })

  it("refuses a non-positive or non-finite cap rather than guessing", () => {
    expect(() => softCap(10, 0)).toThrow(/softCapUnits/)
    expect(() => softCap(10, -5)).toThrow(/softCapUnits/)
    expect(() => softCap(10, Number.NaN)).toThrow(/softCapUnits/)
  })
})

describe("every capped v1 row, through the scorer", () => {
  it("v1 has capped rows to test (a vacuous loop would prove nothing)", () => {
    expect(capped.length).toBeGreaterThanOrEqual(3)
  })

  for (const row of capped) {
    const S = row.softCapUnits!

    it(`${row.id}: under the cap (S/2) is paid in full`, () => {
      expect(effectiveFor(row, S / 2)).toMatchObject({ units: S / 2, unitsEffective: S / 2 })
    })

    it(`${row.id}: at the cap (S = ${S}) is paid in full`, () => {
      expect(effectiveFor(row, S)).toMatchObject({ units: S, unitsEffective: S })
    })

    it(`${row.id}: over the cap (2S) — units stays raw, unitsEffective is 1.5S`, () => {
      expect(effectiveFor(row, 2 * S)).toMatchObject({ units: 2 * S, unitsEffective: 1.5 * S })
    })

    it(`${row.id}: a typo (50S) is bounded at 2.5S`, () => {
      expect(effectiveFor(row, 50 * S)).toMatchObject({ units: 50 * S, unitsEffective: 2.5 * S })
    })
  }

  it("uncapped distance rows are untouched: a 300 km traceless run is paid for 300 km", () => {
    const run: ScorableActivity = {
      kind: "run",
      hasTrace: false,
      distanceM: 300_000,
      source: { source: "manual", externalId: "x", sourceTypeRaw: "", fetchedAt: "" },
      sets: [],
    }
    const rows = scoreGround(scoreUnits(run, rules), rules, null)
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(r.unitsEffective).toBe(r.units)
  })
})

describe("the ledger row", () => {
  it("units is the raw count, unitsEffective the capped one, xpAwarded rated on the capped one", () => {
    const row = capped[0]!
    const S = row.softCapUnits!
    const entries = scoreActivity(
      { ...sessionFor(row, 3 * S), activityId: "a1", userId: "u1", startedAt: "2026-09-01T07:00:00Z" },
      rules,
      null,
      { newCellCount: 0, rearmedCellCount: 0 },
      "2026-09-01T08:00:00Z",
    )
    const mine = entries.find((e) => e.skillId === row.id)!
    expect(mine.units).toBe(3 * S)
    expect(mine.unitsEffective).toBe(1.75 * S)
    expect(mine.xpAwarded).toBe(Math.round(1.75 * S * row.xpPerUnit))
  })

  it("the cap is per ACTIVITY: two sessions at S each are both paid in full", () => {
    const row = capped[0]!
    const S = row.softCapUnits!
    const a = effectiveFor(row, S)
    const b = effectiveFor(row, S)
    expect(a.unitsEffective + b.unitsEffective).toBe(2 * S)
  })
})

describe("a capped ground-scored row (not in v1, but the schema allows it)", () => {
  it("the cap is taken on the whole activity, then apportioned: Σ unitsEffective/multiplier is softCap(units)", () => {
    const units = 30
    const rows = rateGround(
      { skillId: "x", measure: "distanceKm", units },
      { new: 1, rearmed: 1, recent: 0.5 },
      { new: 1000, rearmed: 1000, recent: 1000 },
      softCap(units, 10),
    )
    expect(rows.reduce((t, r) => t + r.units, 0)).toBe(units)
    // Uniform `paid` fraction, so undoing each multiplier sums back to the capped units.
    const mult = { new_ground: 1, rearmed_ground: 1, recent_ground: 0.5 } as Record<string, number>
    const capTotal = rows.reduce((t, r) => t + r.unitsEffective / mult[r.reason]!, 0)
    expect(capTotal).toBeCloseTo(softCap(units, 10), 12)
  })
})

describe("no cap literal in the scorer (D-031)", () => {
  it("soft-cap.ts and ground.ts name no v1 cap value; every S is read from the row", () => {
    const values = new Set(capped.map((s) => String(s.softCapUnits)))
    for (const file of ["soft-cap.ts", "ground.ts"]) {
      const code = readFileSync(new URL(`./${file}`, import.meta.url), "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\/?\*|\/\/)/.test(l))
        .join("\n")
      for (const v of values) expect(code).not.toMatch(new RegExp(`\\b${v}\\b`))
    }
  })
})
