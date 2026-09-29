import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import type { WorkoutSet } from "@/src/domain/activity"
import { runWithPurityTraps } from "@/src/purity/traps"
import { loadRuleSet } from "@/src/rules/load"
import { ACTIVITY_KINDS, type RuleSkill } from "@/src/rules/schema"
import { candidatesByMeasure } from "@/src/rules/select-activity-skills"

import { measureUnits, scoreUnits, selectActivitySkills, type ScorableActivity } from "./index"

/**
 * Ticket 0060. Against the REAL v1 registry, as `0029`'s tests are: a hand-built registry
 * proves the scorer agrees with itself, not that it scores the shipped ruleset. Skill ids
 * appear in test files only — `no-skill-names.test.ts` exempts these by design.
 */

const rules = loadRuleSet(1)

const activity = (over: Partial<ScorableActivity> = {}): ScorableActivity => ({
  kind: "run",
  hasTrace: true,
  source: { source: "gpslogger", externalId: "x", sourceTypeRaw: "Run", fetchedAt: "" },
  sets: [],
  ...over,
})

const strength = (sets: WorkoutSet[]) =>
  activity({ kind: "strength", hasTrace: false, distanceM: undefined, sets })

const skillIds = (xs: { skillId: string }[]) => xs.map((x) => x.skillId).sort()

describe("measure grouping — the load-bearing part", () => {
  it("one strength session with pushups AND situps trains two skills, each with its own count", () => {
    const got = scoreUnits(
      strength([
        { exercise: "pushup", reps: 25 },
        { exercise: "situp", reps: 30 },
        { exercise: "pushup", reps: 20 },
      ]),
      rules,
    )
    expect(got).toEqual([
      { skillId: "might", measure: "reps:pushup", units: 45 },
      { skillId: "fortitude", measure: "reps:situp", units: 30 },
    ])
  })

  it("plank seconds are counted from durationS, not reps", () => {
    expect(scoreUnits(strength([{ exercise: "plank", durationS: 90 }]), rules)).toEqual([
      { skillId: "endurance", measure: "seconds:plank", units: 90 },
    ])
  })

  it("a traced run trains exactly one distance skill; the same run untraced trains a different one", () => {
    const traced = scoreUnits(activity({ hasTrace: true, distanceM: 8000 }), rules)
    const untraced = scoreUnits(activity({ hasTrace: false, distanceM: 8000 }), rules)

    expect(traced).toHaveLength(1)
    expect(untraced).toHaveLength(1)
    expect(traced[0]).toMatchObject({ measure: "distanceKm", units: 8 })
    expect(untraced[0]).toMatchObject({ measure: "distanceKm", units: 8 })
    expect(traced[0]!.skillId).not.toBe(untraced[0]!.skillId)
    expect([traced[0]!.skillId, untraced[0]!.skillId]).toEqual(["wayfaring", "vigil"])
  })

  it("never returns a meta skill", () => {
    const meta = new Set(rules.skills.filter((s) => s.kind === "meta").map((s) => s.id))
    expect(meta.size).toBeGreaterThan(0)
    for (const kind of ACTIVITY_KINDS) {
      for (const hasTrace of [true, false]) {
        const a = activity({ kind, hasTrace, distanceM: 5000, sets: allExercises() })
        for (const s of selectActivitySkills(a, rules)) expect(meta.has(s.id)).toBe(false)
        for (const u of scoreUnits(a, rules)) expect(meta.has(u.skillId)).toBe(false)
      }
    }
  })
})

describe("zero-unit tuples are dropped (operator decision, 2026-09-28)", () => {
  it("a pushups-only session returns Might alone, though the situp and plank skills were selected", () => {
    const a = strength([{ exercise: "pushup", reps: 10 }])
    expect(selectActivitySkills(a, rules)).toHaveLength(3)
    expect(skillIds(scoreUnits(a, rules))).toEqual(["might"])
  })

  it("a treadmill run with no distance scores nothing rather than a zero row", () => {
    const a = activity({ hasTrace: false, distanceM: undefined })
    expect(selectActivitySkills(a, rules)).toHaveLength(1)
    expect(scoreUnits(a, rules)).toEqual([])
  })

  it("sets for an exercise no skill measures are ignored, not errors", () => {
    expect(scoreUnits(strength([{ exercise: "burpee", reps: 50 }]), rules)).toEqual([])
  })
})

describe("measureUnits — the closed kernel set (02 §3.7)", () => {
  it("distanceKm is metres / 1000", () => {
    expect(measureUnits(activity({ distanceM: 5234 }), "distanceKm")).toBe(5.234)
  })

  it("a set missing the field counts as zero, not NaN", () => {
    const a = strength([{ exercise: "pushup" }, { exercise: "pushup", reps: 5 }])
    expect(measureUnits(a, "reps:pushup")).toBe(5)
  })

  it("throws on a derived measure, which no Activity carries", () => {
    expect(() => measureUnits(activity(), "cells")).toThrow(/derived by another subsystem/)
    expect(() => measureUnits(activity(), "share")).toThrow(/derived by another subsystem/)
  })

  it("throws on corrupt work rather than scoring it into a ledger that can only add (D-135)", () => {
    expect(() => measureUnits(activity({ distanceM: -1 }), "distanceKm")).toThrow(/finite/)
    expect(() => measureUnits(activity({ distanceM: Infinity }), "distanceKm")).toThrow(/finite/)
    expect(() => measureUnits(strength([{ exercise: "pushup", reps: NaN }]), "reps:pushup")).toThrow(
      /finite/,
    )
  })
})

/** One set of every exercise any v1 row measures, read from the rules — never hardcoded. */
function allExercises(): WorkoutSet[] {
  return rules.skills
    .flatMap((s) => s.exercises ?? [])
    .map((e) => (e.entry === "seconds" ? { exercise: e.id, durationS: 60 } : { exercise: e.id, reps: 10 }))
}

describe("I-26 — the scorer is total over the ActivityKind × hasTrace grid", () => {
  const grid = ACTIVITY_KINDS.flatMap((kind) => [true, false].map((hasTrace) => ({ kind, hasTrace })))

  it("covers every cell of the grid (12)", () => {
    expect(grid).toHaveLength(ACTIVITY_KINDS.length * 2)
  })

  it.each(grid)("never zero skills for measurable work: $kind, hasTrace=$hasTrace (I-26)", ({ kind, hasTrace }) => {
    const a = activity({ kind, hasTrace, distanceM: 5000, sets: allExercises() })
    expect(scoreUnits(a, rules).length).toBeGreaterThan(0)
  })

  it.each(grid.filter((g) => g.kind !== "strength" && g.kind !== "other"))(
    "a distance kind always yields exactly one distance skill: $kind, hasTrace=$hasTrace (I-26, D-190)",
    ({ kind, hasTrace }) => {
      const got = scoreUnits(activity({ kind, hasTrace, distanceM: 5000 }), rules)
      expect(got.filter((u) => u.measure === "distanceKm")).toHaveLength(1)
    },
  )

  it.each(grid)(
    "never two candidates at equal matchPriority within one measure: $kind, hasTrace=$hasTrace (I-26)",
    ({ kind, hasTrace }) => {
      const a = activity({ kind, hasTrace })
      for (const [, group] of candidatesByMeasure(a, rules)) {
        const top = Math.max(...group.map((s: RuleSkill) => s.matchPriority ?? 0))
        expect(group.filter((s) => (s.matchPriority ?? 0) === top)).toHaveLength(1)
      }
    },
  )
})

describe("determinism (04 §7.4)", () => {
  it("scores with Date.now and Math.random stubbed to throw", () => {
    const a = strength([
      { exercise: "pushup", reps: 25 },
      { exercise: "situp", reps: 30 },
      { exercise: "plank", durationS: 60 },
    ])
    const got = runWithPurityTraps("scoreUnits()", "replay must count the same units (04 §7.4)", () =>
      scoreUnits(a, rules),
    )
    expect(skillIds(got)).toEqual(["endurance", "fortitude", "might"])
  })

  it("returns the same answer twice, in the same order", () => {
    const a = activity({ distanceM: 4200 })
    expect(scoreUnits(a, rules)).toEqual(scoreUnits(a, rules))
  })
})

describe("no branch on a skill id in src/scoring (I-25, D-031, D-141)", () => {
  const dir = new URL(".", import.meta.url).pathname
  const sources = readdirSync(dir)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => ({ f, text: readFileSync(join(dir, f), "utf8") }))

  it("scans the module's source files", () => {
    expect(sources.map((s) => s.f)).toEqual(expect.arrayContaining(["index.ts", "units.ts"]))
  })

  it("has no switch statement, and no comparison against a skill's id (I-25)", () => {
    const violations: string[] = []
    for (const { f, text } of sources) {
      text.split("\n").forEach((line, i) => {
        if (/^\s*\/?\*|^\s*\/\//.test(line)) return // prose may name the rule it keeps
        if (/\bswitch\s*\(/.test(line) || /(\.id|skillId)\s*[!=]==?|[!=]==?\s*\w+\.(id|skillId)\b/.test(line))
          violations.push(`${f}:${i + 1}  ${line.trim()}`)
      })
    }
    expect(violations).toEqual([])
  })

  it("has no enum or union type over skill ids", () => {
    const ids = rules.skills.map((s) => s.id)
    for (const { text } of sources) {
      expect(text).not.toMatch(/\benum\s+\w+/)
      for (const id of ids) expect(text).not.toMatch(new RegExp(`["'\`]${id}["'\`]`))
    }
  })

  it("the detector fires on the failure it exists to catch", () => {
    const re = /\bswitch\s*\(|(\.id|skillId)\s*[!=]==?/
    expect(re.test("switch (skill.id) {")).toBe(true)
    expect(re.test('if (skill.id === "x")')).toBe(true)
    expect(re.test("const units = measureUnits(a, m)")).toBe(false)
  })
})
