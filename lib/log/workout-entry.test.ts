import { readFileSync } from "node:fs"
import { join } from "node:path"

import { marshall, unmarshall } from "@aws-sdk/util-dynamodb"
import { describe, expect, expectTypeOf, it } from "vitest"

import type { Activity, WorkoutSet } from "@/src/domain/activity"
import { loadRuleSet } from "@/src/rules/load"
import type { RuleSkill } from "@/src/rules/schema"
import { scoreActivity, scoreUnits, type ScorableActivity } from "@/src/scoring"

import {
  entryActivityFields,
  entryFieldFor,
  parseWorkoutEntry,
  WorkoutEntryError,
  type WorkoutEntry,
  type WorkoutEntryErrorCode,
} from "./workout-entry"

/**
 * Ticket 0070 — the sets-shaped `/log` entry, against the REAL current registry. Exercise
 * ids appear in this test file only; `no-skill-names.test.ts` exempts tests by design.
 */

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const rules = loadRuleSet(2)

const body = (over: Record<string, unknown> = {}) => ({
  exerciseId: "pushup",
  sets: [{ reps: 30 }],
  occurredAt: "2026-10-02T07:15:00Z",
  idempotencyKey: "k-1",
  ...over,
})

/** An entry as the manual adapter will persist it: the canonical Activity, minimally. */
function persisted(entry: WorkoutEntry): ScorableActivity & {
  activityId: string
  userId: string
  startedAt: string
} {
  return {
    activityId: `a-${entry.idempotencyKey}`,
    userId: "u-1",
    kind: "strength",
    hasTrace: false,
    source: { source: "manual", externalId: entry.idempotencyKey, sourceTypeRaw: "log", fetchedAt: "" },
    ...entryActivityFields(entry),
  }
}

const xpOf = (a: ReturnType<typeof persisted>) =>
  scoreActivity(a, rules, null, { newCellCount: 0, rearmedCellCount: 0 }, "2026-10-02T08:00:00Z").map(
    (e) => [e.skillId, e.units, e.xpAwarded],
  )

function codeOf(fn: () => unknown): WorkoutEntryErrorCode | undefined {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(WorkoutEntryError)
    expect((e as Error).name).toBe("WorkoutEntryError")
    return (e as WorkoutEntryError).code
  }
  return undefined
}

describe("criterion 1 — sets is a list everywhere, with no scalar beside it", () => {
  it("in the type: WorkoutEntry carries sets[] and no reps/seconds/km field", () => {
    expectTypeOf<WorkoutEntry["sets"]>().toBeArray()
    expectTypeOf<keyof WorkoutEntry>().toEqualTypeOf<
      "exerciseId" | "sets" | "occurredAt" | "idempotencyKey"
    >()
    expectTypeOf<Activity["sets"]>().toEqualTypeOf<WorkoutSet[]>()
  })

  it("in the API schema: a scalar reps is refused, not accepted alongside or instead", () => {
    expect(codeOf(() => parseWorkoutEntry(body({ sets: undefined, reps: 30 }), rules))).toBe("NO_SETS")
    expect(codeOf(() => parseWorkoutEntry(body({ sets: { reps: 30 } }), rules))).toBe("NO_SETS")
    // A stray top-level scalar never survives parsing.
    expect(parseWorkoutEntry(body({ reps: 30 }), rules)).not.toHaveProperty("reps")
  })

  it("in the persisted item: the Amplify Activity model holds sets as a WorkoutSet array and no scalar", () => {
    const src = readFileSync(join(ROOT, "amplify/data/resource.ts"), "utf8")
    const start = src.indexOf("Activity: a")
    expect(start).toBeGreaterThan(-1)
    const end = src.indexOf("\n    })", start)
    const model = src.slice(start, end)
    expect(model).toMatch(/^\s*sets: a\.ref\("WorkoutSet"\)\.array\(\),$/m)
    expect(model).not.toMatch(/^\s*(reps|seconds|durationS|km):/m)
  })
})

describe("criterion 2 — one click of 30 pushups persists sets: [{ reps: 30 }]", () => {
  it("parses to a list of one, and persists the exercise on the set", () => {
    const entry = parseWorkoutEntry(body(), rules)
    expect(entry.sets).toEqual([{ reps: 30 }])
    const item = entryActivityFields(entry)
    expect(item.sets).toEqual([{ exercise: "pushup", reps: 30 }])
    expect(item).not.toHaveProperty("reps")
  })
})

describe("criterion 3 — the scorer sums every set", () => {
  it("[{10},{10},{10}] scores identically to [{30}], units and XP", () => {
    const one = persisted(parseWorkoutEntry(body(), rules))
    const three = persisted(
      parseWorkoutEntry(body({ sets: [{ reps: 10 }, { reps: 10 }, { reps: 10 }] }), rules),
    )
    expect(scoreUnits(three, rules)).toEqual(scoreUnits(one, rules))
    expect(xpOf(three)).toEqual(xpOf(one))
    expect(xpOf(one).length).toBeGreaterThan(0)
  })

  it("a duration exercise sums seconds across sets the same way", () => {
    const one = persisted(parseWorkoutEntry(body({ exerciseId: "plank", sets: [{ durationS: 90 }] }), rules))
    const two = persisted(
      parseWorkoutEntry(body({ exerciseId: "plank", sets: [{ durationS: 45 }, { durationS: 45 }] }), rules),
    )
    expect(scoreUnits(two, rules)).toEqual(scoreUnits(one, rules))
  })
})

describe("criterion 5 — the set field comes from the registry, not a union in source", () => {
  it("resolves pushup → reps and plank → durationS through each row's measure", () => {
    expect(entryFieldFor("pushup", rules)).toBe("reps")
    expect(entryFieldFor("situp", rules)).toBe("reps")
    expect(entryFieldFor("plank", rules)).toBe("durationS")
  })

  it("a NEW exercise in a registry row is loggable with no code change", () => {
    const might = rules.skills.find((s) => s.match?.measure === "reps:pushup")!
    const burpees: RuleSkill = {
      ...might,
      id: "zz-burpees",
      match: { ...might.match!, measure: "reps:burpee" },
      exercises: [{ id: "burpee", label: "Burpees", entry: "count", quickValues: [10] }],
    }
    const registry = { ...rules, skills: [...rules.skills, burpees] }
    expect(entryFieldFor("burpee", rules)).toBeNull()
    expect(entryFieldFor("burpee", registry)).toBe("reps")
    const entry = parseWorkoutEntry(body({ exerciseId: "burpee", sets: [{ reps: 12 }] }), registry)
    expect(entryActivityFields(entry).sets).toEqual([{ exercise: "burpee", reps: 12 }])
  })

  it("refuses an exercise no enabled row logs, and the wrong kernel's field", () => {
    expect(codeOf(() => parseWorkoutEntry(body({ exerciseId: "deadlift" }), rules))).toBe("UNKNOWN_EXERCISE")
    expect(codeOf(() => parseWorkoutEntry(body({ sets: [{ durationS: 30 }] }), rules))).toBe("BAD_SET")
    expect(codeOf(() => parseWorkoutEntry(body({ sets: [{ reps: 30, durationS: 30 }] }), rules))).toBe("BAD_SET")
    expect(
      codeOf(() => parseWorkoutEntry(body({ exerciseId: "plank", sets: [{ reps: 30 }] }), rules)),
    ).toBe("BAD_SET")
  })

  it("refuses non-positive and non-integer counts", () => {
    for (const reps of [0, -5, 2.5, "30", null]) {
      expect(codeOf(() => parseWorkoutEntry(body({ sets: [{ reps }] }), rules)), String(reps)).toBe("BAD_SET")
    }
  })
})

describe("criterion 6 — occurredAt is explicit, may be back-dated, and is what scoring uses", () => {
  it("a back-dated entry keeps its instant as the Activity's startedAt", () => {
    const entry = parseWorkoutEntry(body({ occurredAt: "2026-09-14T18:30:00Z" }), rules)
    expect(entryActivityFields(entry).startedAt).toBe("2026-09-14T18:30:00Z")
  })

  it("refuses a missing, offset-bearing or unparseable instant", () => {
    for (const occurredAt of [undefined, "2026-09-14T18:30:00", "2026-09-14T18:30:00+02:00", "2026-13-40T99:00:00Z"]) {
      expect(codeOf(() => parseWorkoutEntry(body({ occurredAt }), rules)), String(occurredAt)).toBe(
        "BAD_OCCURRED_AT",
      )
    }
  })

  it("refuses a missing idempotency key", () => {
    expect(codeOf(() => parseWorkoutEntry(body({ idempotencyKey: "" }), rules))).toBe("BAD_IDEMPOTENCY_KEY")
  })
})

describe("criterion 7 — round trip with 1, 3 and 0 sets", () => {
  it.each([
    [1, [{ reps: 30 }]],
    [3, [{ reps: 12 }, { reps: 10 }, { reps: 8 }]],
  ])("%i set(s): write → DynamoDB item → read → re-score is unchanged", (_n, sets) => {
    const written = persisted(parseWorkoutEntry(body({ sets }), rules))
    const item = marshall(written, { removeUndefinedValues: true })
    expect(item.sets?.L).toHaveLength(sets.length)
    const read = unmarshall(item) as typeof written
    expect(read.sets).toEqual(written.sets)
    expect(xpOf(read)).toEqual(xpOf(written))
    expect(scoreUnits(read, rules)[0]?.units).toBe(sets.reduce((t, s) => t + s.reps, 0))
  })

  it("0 sets is rejected at the API boundary with a named error", () => {
    expect(codeOf(() => parseWorkoutEntry(body({ sets: [] }), rules))).toBe("NO_SETS")
  })
})

describe("criterion 8 — a restSeconds key on a set is ignored by existing readers", () => {
  it("the boundary accepts it and drops it", () => {
    const entry = parseWorkoutEntry(body({ sets: [{ reps: 15, restSeconds: 60 }, { reps: 15 }] }), rules)
    expect(entry.sets).toEqual([{ reps: 15 }, { reps: 15 }])
  })

  it("the scorer, reading a stored set that carries it, scores as though it were absent", () => {
    const plain = persisted(parseWorkoutEntry(body(), rules))
    const withRest = { ...plain, sets: [{ exercise: "pushup", reps: 30, restSeconds: 60 } as WorkoutSet] }
    expect(scoreUnits(withRest, rules)).toEqual(scoreUnits(plain, rules))
    expect(xpOf(withRest)).toEqual(xpOf(plain))
  })
})
