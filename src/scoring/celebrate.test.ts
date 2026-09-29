import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

import type { WorkoutSet } from "@/src/domain/activity"
import { loadRuleSet } from "@/src/rules/load"
import type { RuleSet, RuleSkill } from "@/src/rules/schema"
import { validateRuleSet } from "@/src/rules/validate"
import {
  celebrableLevelUps,
  celebrableMilestones,
  levelForXp,
  scoreGround,
  scoreUnits,
  scoreWithPropagation,
  totalLevel,
  totalLevelDelta,
  xpBySkill,
  type GroundSplit,
  type LevelSnapshot,
  type ScorableActivity,
  type XpLedgerEntry,
} from "@/src/scoring"

/**
 * Ticket 0065. D-146; `06-ui-ux.md` §5.4, §10.5; roadmap §5.2.
 *
 * "Seed, replay, add a row, re-seed, replay" is done in memory: the replay JOB is `0066`, and
 * what matters here is that the same activities scored under two rulesets differ by exactly the
 * minted rows. A re-seed is `validateRuleSet` passing — the seeder's gate (`02` §3.8).
 *
 * No skill is named: rows are found by their DATA, and added rows are fixtures.
 */

const V1 = loadRuleSet(1)
const SRC = new URL("..", import.meta.url).pathname

/** The first reps row, and the exercise it counts — whatever the YAML calls them. */
const REPS_ROW = V1.skills.find((s) => s.logMode === "reps" && (s.exercises ?? []).length > 0)!
const REPS_EXERCISE = REPS_ROW.exercises![0]!.id

/** A new workout type, exactly as one would be added: a data row, nothing else (D-031). */
function newWorkoutRow(n: number, introducedIn: number): RuleSkill {
  const exercise = `fixture-move-${n}`
  return {
    ...structuredClone(REPS_ROW),
    id: `fixture-skill-${n}`,
    name: `Fixture ${n}`,
    introducedIn,
    displayOrder: 500 + n,
    match: { ...REPS_ROW.match!, measure: `reps:${exercise}` },
    exercises: [{ id: exercise, label: `Fixture ${n}`, entry: "count", quickValues: [10] }],
  }
}

/** Ship `rows` as the next version. Every existing row carries forward unchanged. */
function nextVersion(base: RuleSet, rows: RuleSkill[]): RuleSet {
  const next: RuleSet = { ...structuredClone(base), version: base.version + 1, skills: [...structuredClone(base.skills), ...rows] }
  expect(validateRuleSet(next), "the re-seed must pass the seeder's validator").toEqual([])
  return next
}

interface Session {
  activity: ScorableActivity
  split: GroundSplit | null
}

const run = (distanceM: number): Session => ({
  activity: {
    kind: "run",
    hasTrace: true,
    source: { source: "gpslogger", externalId: "x", sourceTypeRaw: "Run", fetchedAt: "" },
    distanceM,
    sets: [],
  },
  split: { new: distanceM, rearmed: 0, recent: 0 },
})
const strength = (sets: WorkoutSet[]): Session => ({
  activity: {
    kind: "strength",
    hasTrace: false,
    source: { source: "manual", externalId: "y", sourceTypeRaw: "strength", fetchedAt: "" },
    distanceM: undefined,
    sets,
  },
  split: null,
})

/** A modest history: enough to lift several skills off level 1. */
const HISTORY: Session[] = [run(5000), run(8000), strength([{ exercise: REPS_EXERCISE, reps: 40 }]), run(3000)]

/** The ingest path (0060 → 0061 → 0064) over every session, in order. */
function replay(rules: RuleSet, sessions: readonly Session[]): XpLedgerEntry[] {
  return sessions.flatMap((s, i) => {
    const activity = { activityId: `a-${i}`, userId: "u-1", startedAt: `2026-09-${String(i + 1).padStart(2, "0")}T06:00:00.000Z` }
    return scoreWithPropagation(scoreGround(scoreUnits(s.activity, rules), rules, s.split), { newCellCount: 0, rearmedCellCount: 0 }, {
      activity,
      rules,
      awardedAt: activity.startedAt,
    })
  })
}

const snapshot = (rules: RuleSet, entries: readonly XpLedgerEntry[]): LevelSnapshot => ({
  rulesVersion: rules.version,
  xpBySkill: xpBySkill(entries),
})

const total = (rules: RuleSet, snap: LevelSnapshot) => totalLevel(snap.xpBySkill, rules.skills, rules.curve)

describe("the headline — adding rows raises Total Level by exactly their count, and celebrates nothing", () => {
  it.each([1, 3])("%i row(s) added: Total Level +N, zero level-ups, celebrable delta 0", (n) => {
    const before = snapshot(V1, replay(V1, HISTORY))
    const V2 = nextVersion(
      V1,
      Array.from({ length: n }, (_, i) => newWorkoutRow(i, 2)),
    )
    const entries = replay(V2, HISTORY)
    const after = snapshot(V2, entries)

    expect(total(V1, before)).toBeGreaterThan(V1.skills.filter((s) => s.enabled).length) // real levels, not all 1s
    expect(total(V2, after) - total(V1, before)).toBe(n)
    expect(celebrableLevelUps(before, after, V2)).toEqual([])
    expect(totalLevelDelta(before, after, V2)).toBe(0)
  })

  it("writes no ledger row for a minted point: SUM(ledger) for the new skill is 0 (I-15)", () => {
    const V2 = nextVersion(V1, [newWorkoutRow(0, 2)])
    const entries = replay(V2, HISTORY)
    expect(entries.filter((e) => e.skillId === "fixture-skill-0")).toEqual([])
    // Nothing else moved either: the scorer is untouched by the new row.
    expect(xpBySkill(entries)).toEqual(xpBySkill(replay(V1, HISTORY)))
  })
})

describe("celebrableLevelUps / totalLevelDelta", () => {
  const V2 = nextVersion(V1, [newWorkoutRow(0, 2)])
  const before = snapshot(V1, replay(V1, HISTORY))

  it("the mixed case: a skill added AND an existing skill genuinely levelled — events for the latter only", () => {
    const entries = replay(V2, [...HISTORY, run(20000)])
    const after = snapshot(V2, entries)
    const ups = celebrableLevelUps(before, after, V2)

    const trained = entries.at(-1)!.skillId
    expect(ups.length).toBeGreaterThan(0)
    expect(ups.map((u) => u.skillId)).not.toContain("fixture-skill-0")
    for (const u of ups) {
      expect(u.from).toBe(levelForXp(before.xpBySkill.get(u.skillId) ?? 0, V2.curve))
      expect(u.to).toBe(levelForXp(after.xpBySkill.get(u.skillId) ?? 0, V2.curve))
    }
    expect(ups.map((u) => u.skillId)).toContain(trained)
    // The delta is the earned levels, and the real rise is that plus the one minted point.
    const earned = ups.reduce((s, u) => s + u.to - u.from, 0)
    expect(totalLevelDelta(before, after, V2)).toBe(earned)
    expect(total(V2, after) - total(V1, before)).toBe(earned + 1)
  })

  it("a minted skill trained in the same diff still yields no event, at any level", () => {
    const after = snapshot(V2, replay(V2, [...HISTORY, strength([{ exercise: "fixture-move-0", reps: 200 }])]))
    expect(levelForXp(after.xpBySkill.get("fixture-skill-0") ?? 0, V2.curve)).toBeGreaterThan(1)
    expect(celebrableLevelUps(before, after, V2).map((u) => u.skillId)).not.toContain("fixture-skill-0")
  })

  it("once the snapshot is under the new ruleset, the new skill's first real level-up DOES celebrate", () => {
    const settled = snapshot(V2, replay(V2, HISTORY))
    const after = snapshot(V2, replay(V2, [...HISTORY, strength([{ exercise: "fixture-move-0", reps: 200 }])]))
    expect(celebrableLevelUps(settled, after, V2).map((u) => u.skillId)).toContain("fixture-skill-0")
  })

  it("keys on the RULESET, not XP == 0: an untrained old skill's first level-up celebrates", () => {
    // Every row in v1 is introduced in v1, so one untouched by HISTORY is old and untrained.
    const untrained = V1.skills.find((s) => s.enabled && s.logMode === "reps" && !before.xpBySkill.has(s.id))!
    const exercise = untrained.exercises![0]!.id
    const after = snapshot(V1, replay(V1, [...HISTORY, strength([{ exercise, reps: 200 }])]))
    expect(before.xpBySkill.get(untrained.id) ?? 0).toBe(0)
    expect(celebrableLevelUps(before, after, V1).map((u) => u.skillId)).toContain(untrained.id)
  })

  it("two versions shipped between runs: a row from the EARLIER one is still minted", () => {
    const V3 = nextVersion(V2, [newWorkoutRow(1, 3)])
    const after = snapshot(V3, replay(V3, HISTORY))
    expect(total(V3, after) - total(V1, before)).toBe(2)
    expect(celebrableLevelUps(before, after, V3)).toEqual([])
    expect(totalLevelDelta(before, after, V3)).toBe(0)
  })
})

describe("Total Level milestones", () => {
  const before = snapshot(V1, replay(V1, HISTORY))
  const V2 = nextVersion(V1, [newWorkoutRow(0, 2)])
  const minted = snapshot(V2, replay(V2, HISTORY))
  /** A milestone exactly one point above where the user stood: the minted point lands on it. */
  const M = total(V1, before) + 1
  const LADDER = [M - 50, M, M + 50]
  const LAST = M - 50

  it("a minted point that crosses a milestone suppresses it", () => {
    expect(total(V2, minted)).toBe(M)
    expect(celebrableMilestones(before, minted, V2, LADDER, LAST)).toEqual([])
  })

  it("...and the next genuinely-earned point fires it, though that point no longer crosses it", () => {
    // Train until some existing skill gains a level; the user is now past M.
    let extra = 1000
    let after = snapshot(V2, replay(V2, [...HISTORY, run(extra)]))
    while (totalLevelDelta(minted, after, V2) === 0) after = snapshot(V2, replay(V2, [...HISTORY, run((extra += 1000))]))
    expect(total(V2, after)).toBeGreaterThan(M)
    expect(celebrableMilestones(minted, after, V2, LADDER, LAST)).toEqual([M])
  })

  it("never re-fires one already celebrated", () => {
    const after = snapshot(V2, replay(V2, [...HISTORY, run(20000)]))
    expect(celebrableMilestones(minted, after, V2, LADDER, M)).toEqual([])
  })
})

describe("the guard lives in the notification module and nowhere else (D-146)", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) return sourceFiles(p)
      return /\.tsx?$/.test(name) && !/\.test(-d)?\.tsx?$/.test(name) ? [p] : []
    })
  }

  it("only celebrate.ts compares introducedIn against a version", () => {
    const root = join(SRC, "..")
    const hits = [...sourceFiles(SRC), ...sourceFiles(join(root, "amplify"))].filter((f) => /introducedIn\s*[<>]/.test(readFileSync(f, "utf8")))
    expect(hits.map((f) => relative(root, f))).toEqual(["src/scoring/celebrate.ts"])
  })

  it("the scorer's modules carry no suppression and no special case for new skills", () => {
    for (const f of ["units.ts", "ground.ts", "propagate.ts", "ledger.ts", "levels.ts"]) {
      expect(readFileSync(join(SRC, "scoring", f), "utf8"), f).not.toMatch(/introducedIn|firstSeen|minted|celebrat/i)
    }
  })
})
