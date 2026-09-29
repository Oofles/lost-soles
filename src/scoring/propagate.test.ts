import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import type { WorkoutSet } from "@/src/domain/activity"
import { NO_CELLS } from "@/src/domain/discovery"
import { loadRuleSet } from "@/src/rules/load"
import type { RuleSet } from "@/src/rules/schema"
import {
  discoveryRows,
  feedRows,
  scoreGround,
  scoreUnits,
  scoreWithPropagation,
  sumXp,
  xpBySkill,
  type GroundSplit,
  type ScorableActivity,
  type XpLedgerEntry,
} from "@/src/scoring"

/**
 * Ticket 0064. `02` §3.1 (J4), §3.4; `04` §8.2 / §8.3; D-120, D-255.
 *
 * Every expected number below is derived from the ruleset in the test body where it can be, so
 * a rebalance of the YAML moves the expectation with it. The worked examples pin literals on
 * purpose: they are the documents' numbers, and a drift between code and doc should fail here.
 */

const RULES = loadRuleSet(1)
const ACTIVITY = { activityId: "a-1", userId: "u-1", startedAt: "2026-09-06T03:00:00.000Z" }
const ctx = (rules: RuleSet = RULES) => ({ activity: ACTIVITY, rules, awardedAt: "2026-09-06T09:00:00.000Z" })

const run = (distanceM: number): ScorableActivity => ({
  kind: "run",
  hasTrace: true,
  source: { source: "gpslogger", externalId: "x", sourceTypeRaw: "Run", fetchedAt: "" },
  distanceM,
  sets: [],
})
const strength = (sets: WorkoutSet[]): ScorableActivity => ({
  kind: "strength",
  hasTrace: false,
  source: { source: "manual", externalId: "y", sourceTypeRaw: "strength", fetchedAt: "" },
  distanceM: undefined,
  sets,
})

const cells = (newCellCount: number, rearmedCellCount = 0) => ({ newCellCount, rearmedCellCount })

/** The whole path the ingest takes: 0060 → 0061 → 0064 (→ 0062 inside). */
function score(activity: ScorableActivity, split: GroundSplit | null, award = cells(0), rules = RULES) {
  return scoreWithPropagation(scoreGround(scoreUnits(activity, rules), rules, split), award, ctx(rules))
}

const rows = (es: XpLedgerEntry[]) => es.map((e) => [e.skillId, e.reason, e.xpAwarded] as const)
const byReason = (es: XpLedgerEntry[], reason: string) => es.filter((e) => e.reason === reason)

/** Looked up by DATA, so the test names no skill either: the feeders and their target. */
const feedTarget = RULES.skills.find((s) => s.kind === "activity" && s.feeds.length > 0)!.feeds[0]!.skill
const discoverySkill = RULES.skills.find((s) => s.unitMultipliers)!

describe("Constitution — feeds (J4)", () => {
  it("emits a share valued at round(activityXp × feeds[].rate), with the rate read off the row", () => {
    const es = score(run(5000), { new: 5000, rearmed: 0, recent: 0 })
    const activityXp = sumXp(es.filter((e) => RULES.skills.find((s) => s.id === e.skillId)!.kind === "activity"))
    const feeder = RULES.skills.find((s) => s.id === es[0]!.skillId)!
    const share = byReason(es, "constitution_share")
    expect(share).toHaveLength(1)
    expect(share[0]!.skillId).toBe(feeder.feeds[0]!.skill)
    expect(share[0]!.xpAwarded).toBe(Math.round(activityXp * feeder.feeds[0]!.rate))
  })

  it("follows the DATA: a different rate in the ruleset gives a different share, with no code change", () => {
    const rules = structuredClone(RULES)
    for (const s of rules.skills) for (const f of s.feeds) f.rate = 0.5
    const es = score(run(5000), { new: 5000, rearmed: 0, recent: 0 }, cells(0), rules)
    expect(byReason(es, "constitution_share")[0]!.xpAwarded).toBe(250)
  })

  it("is computed from POST-multiplier XP: a re-run over recent ground feeds half", () => {
    const fresh = score(run(5000), { new: 5000, rearmed: 0, recent: 0 })
    const rerun = score(run(5000), { new: 0, rearmed: 0, recent: 5000 })
    const share = (es: XpLedgerEntry[]) => byReason(es, "constitution_share")[0]!.xpAwarded
    expect(sumXp(rerun.filter((e) => e.reason === "recent_ground"))).toBe(250)
    // Half the activity XP in, half the share out — rounded once, from the rated rows.
    const rate = RULES.skills.find((s) => s.id === rerun[0]!.skillId)!.feeds[0]!.rate
    expect(share(fresh)).toBe(Math.round(500 * rate))
    expect(share(rerun)).toBe(Math.round(250 * rate))
  })

  it("a strength session training two skills: two activity rows, their shares in ONE row (D-255)", () => {
    // D-255 amends the ticket's "two share rows": the ledger id is activity#skill#reason#v, so
    // two share rows for one activity would collide. The share is the sum of both feeders'.
    const es = score(strength([{ exercise: "pushup", reps: 30 }, { exercise: "situp", reps: 40 }]), null)
    const activity = es.filter((e) => e.reason !== "constitution_share")
    expect(activity).toHaveLength(2)
    expect(new Set(activity.map((e) => e.skillId)).size).toBe(2)
    const share = byReason(es, "constitution_share")
    expect(share).toHaveLength(1)
    expect(share[0]!.units).toBe(sumXp(activity))
  })

  it("feeds nothing from a meta award — Cartography's XP never reaches Constitution", () => {
    const withCells = score(run(5000), { new: 5000, rearmed: 0, recent: 0 }, cells(40))
    const without = score(run(5000), { new: 5000, rearmed: 0, recent: 0 }, cells(0))
    expect(byReason(withCells, "constitution_share")[0]!.xpAwarded).toBe(
      byReason(without, "constitution_share")[0]!.xpAwarded,
    )
  })

  it("never follows a target's own feeds: a meta row's feeds are not read, even if present", () => {
    // Seed-time validation refuses this ruleset (META_FEEDS). Here it is forced past the
    // validator to prove the scorer has no loop that would follow the chain anyway.
    const rules = structuredClone(RULES)
    rules.skills.find((s) => s.id === feedTarget)!.feeds = [{ skill: discoverySkill.id, rate: 1 }]
    const es = score(run(5000), { new: 5000, rearmed: 0, recent: 0 }, cells(0), rules)
    expect(es.some((e) => e.skillId === discoverySkill.id)).toBe(false)
  })

  it("an activity that rates to 0 XP emits no share", () => {
    expect(score(run(0), null)).toEqual([])
    expect(feedRows([], RULES.skills)).toEqual([])
  })
})

describe("Cartography — discovery credit (D-120)", () => {
  const rate = discoverySkill.xpPerUnit
  const mult = discoverySkill.unitMultipliers!

  it("pays xpPerUnit per new cell and the rearmed multiplier per re-armed cell, from the row", () => {
    const es = scoreWithPropagation([], cells(10, 4), ctx())
    expect(rows(es)).toEqual([
      [discoverySkill.id, "cells_new", Math.round(10 * mult.new * rate)],
      [discoverySkill.id, "cells_rearmed", Math.round(4 * mult.rearmed * rate)],
    ])
    expect(es[0]!.units).toBe(10)
    expect(es[1]!.unitsEffective).toBe(4 * mult.rearmed)
  })

  it("recent ground emits NO ROW — the row COUNT is asserted, not a zero value", () => {
    // Every cell cooled: the award counts are zero, and there is no `cells_recent` reason.
    const recentOnly = { ...NO_CELLS, cellCount: 30, cooledCellCount: 30 }
    expect(discoveryRows(recentOnly, RULES.skills)).toHaveLength(0)
    const es = score(run(4000), { new: 0, rearmed: 0, recent: 4000 }, recentOnly)
    expect(es.filter((e) => e.skillId === discoverySkill.id)).toHaveLength(0)
  })

  it("a zero multiplier emits no row either, even with cells in the bucket", () => {
    const rules = structuredClone(RULES)
    rules.skills.find((s) => s.unitMultipliers)!.unitMultipliers!.rearmed = 0
    expect(discoveryRows(cells(0, 9), rules.skills)).toHaveLength(0)
  })

  it("a disabled discovery skill earns nothing", () => {
    const rules = structuredClone(RULES)
    rules.skills.find((s) => s.unitMultipliers)!.enabled = false
    expect(discoveryRows(cells(10, 4), rules.skills)).toEqual([])
  })
})

describe("no literal the data owns (I-25, D-031)", () => {
  const src = readFileSync(new URL("./propagate.ts", import.meta.url), "utf8")
  // Comments may explain the 1/3; code may not contain it.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")

  it("holds no share constant", () => {
    expect(code).not.toMatch(/0\.333|1\s*\/\s*3|\/\s*3\b/)
  })

  it("names no skill id", () => {
    for (const s of RULES.skills) expect(code).not.toContain(`"${s.id}"`)
  })
})

describe("worked examples", () => {
  it("04 §8.2 — 8.368 km, 38% new, 25 new / 9 re-armed / 30 recent cells", () => {
    // Rounded per row with Math.round (I-19, D-256), not floored: 62.75 → 63, 196.65 → 197,
    // 58.5 → 59. §8.2 was amended to these numbers.
    const es = score(run(8368), { new: 3180, rearmed: 1255, recent: 3933 }, cells(25, 9))
    expect(rows(es)).toEqual([
      ["wayfaring", "new_ground", 318],
      ["wayfaring", "rearmed_ground", 63],
      ["wayfaring", "recent_ground", 197],
      ["cartography", "cells_new", 325],
      ["cartography", "cells_rearmed", 59],
      ["constitution", "constitution_share", 193],
    ])
    expect(Object.fromEntries(xpBySkill(es))).toEqual({ wayfaring: 578, cartography: 384, constitution: 193 })
  })

  it("04 §8.3 — 75 pushups, 90 situps, 180 s plank", () => {
    const es = score(
      strength([
        { exercise: "pushup", reps: 25 },
        { exercise: "pushup", reps: 25 },
        { exercise: "pushup", reps: 25 },
        { exercise: "situp", reps: 30 },
        { exercise: "situp", reps: 30 },
        { exercise: "situp", reps: 30 },
        { exercise: "plank", durationS: 90 },
        { exercise: "plank", durationS: 90 },
      ]),
      null,
    )
    expect(Object.fromEntries(xpBySkill(es))).toEqual({ might: 300, fortitude: 270, endurance: 270, constitution: 280 })
    expect(byReason(es, "constitution_share")).toHaveLength(1)
  })

  it("the ticket's example — 8.85 km all-new (68 cells), then 30 pushups + 40 situps", () => {
    const r = score(run(8850), { new: 8850, rearmed: 0, recent: 0 }, cells(68))
    expect(Object.fromEntries(xpBySkill(r))).toEqual({ wayfaring: 885, cartography: 884, constitution: 295 })

    const s = score(strength([{ exercise: "pushup", reps: 30 }, { exercise: "situp", reps: 40 }]), null)
    expect(Object.fromEntries(xpBySkill(s))).toEqual({ might: 120, fortitude: 120, constitution: 80 })
  })
})
