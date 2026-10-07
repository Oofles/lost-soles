import { PutCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it } from "vitest"

import { rig, LEDGER_TABLE, type Options } from "@/src/pipeline/__fixtures__/process-rig"
import { loadRuleSet } from "@/src/rules/load"

import { logWorkout, LogWorkoutRefused } from "./log-workout"

/**
 * Ticket 0069, end to end: a `logWorkout` call through the real manual adapter and the real
 * `processActivity`, against the pipeline's recording rig. What is faked is AWS, nothing else.
 */

const USER = "u-1"
const RULES = loadRuleSet(2)

/**
 * The rig's receipt models the WORKER's view, where a receipt already exists. `logWorkout`
 * also runs the accept gate, so its `PutItem` is intercepted here: recorded, and refused as a
 * conditional failure when the key was already accepted (`resubmit`).
 */
function harness(options: Options = {}, resubmit = false, rules = RULES) {
  const r = rig(options)
  const accepts: PutCommand["input"][] = []
  const workerReceipt = r.deps.receipt.ddb
  const receipt = {
    ...r.deps.receipt,
    ddb: {
      async send(command: unknown) {
        if (command instanceof PutCommand) {
          accepts.push(command.input)
          if (resubmit) throw Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" })
          return {}
        }
        return workerReceipt.send(command as never)
      },
    },
  }
  const deps = { ...r.deps, receipt, registry: async () => rules, now: () => new Date("2026-10-02T13:15:00.000Z") }
  return { ...r, deps, accepts }
}

const pushups = { exerciseId: "pushup", sets: [{ reps: 30 }], idempotencyKey: "k-pushups", timezone: "America/Denver" }
const situps = { exerciseId: "situp", sets: [{ reps: 40 }], idempotencyKey: "k-situps", timezone: "America/Denver" }

/** Skill ids of the ledger rows the transaction wrote. */
function ledgerSkills(transacts: ReturnType<typeof rig>["transacts"]): string[] {
  return transacts.flatMap((t) =>
    (t.TransactItems ?? [])
      .filter((i) => i.Put?.TableName === LEDGER_TABLE)
      .map((i) => String(i.Put!.Item!.skillId)),
  )
}

describe("one session, through the mutation, moves Might, Fortitude and Constitution (criterion 10)", () => {
  it("pushups then situps award all three, in one transaction each", async () => {
    const h = harness()
    const first = await logWorkout(pushups, USER, h.deps)
    const second = await logWorkout(situps, USER, h.deps)

    expect(first).toMatchObject({ logged: true })
    expect(second).toMatchObject({ logged: true })
    expect(first.xpAwarded).toBeGreaterThan(0)
    expect(second.xpAwarded).toBeGreaterThan(0)
    expect(h.transacts).toHaveLength(2)
    expect(new Set(ledgerSkills(h.transacts))).toEqual(new Set(["might", "fortitude", "constitution"]))
  })

  it("the second log is not swallowed as a duplicate of the first (D-281)", async () => {
    const h = harness({ dedupeRows: [{ id: "earlier-pushups", startedAt: "2026-10-02T13:13:00.000Z", elapsedS: 0 }] })
    expect(await logWorkout(situps, USER, h.deps)).toMatchObject({ logged: true })
    expect(h.pointerPuts).toEqual([])
    expect(h.dedupeReads, "an activity with sets never queries for duplicates").toEqual([])
  })
})

describe("the map is untouched (criterion 6, I-27)", () => {
  it("writes no ExploredCell, publishes no blob, and never touches the generation", async () => {
    const h = harness()
    await logWorkout(pushups, USER, h.deps)
    expect(h.cellWrites).toEqual([])
    expect(h.aggWrites).toEqual([])
    expect(h.blobPuts).toEqual([])
    expect(h.calls).not.toContain("generation")
    expect(h.calls).not.toContain("mirror")
    expect(ledgerSkills(h.transacts)).not.toContain("cartography")
  })
})

describe("the accept gate runs first (01 §4 step 3)", () => {
  it("writes a QUEUED receipt, conditional on none existing, before the pipeline counts a delivery", async () => {
    const h = harness()
    await logWorkout(pushups, USER, h.deps)
    expect(h.accepts).toHaveLength(1)
    expect(h.accepts[0]).toMatchObject({
      Item: { status: "QUEUED", userId: USER, source: "manual", attempts: 0 },
      ConditionExpression: "attribute_not_exists(ingestKey)",
    })
    expect(h.calls[0]).toBe("recordDelivery")
  })
})

describe("idempotency (criterion 7)", () => {
  it("a re-submitted key writes nothing and returns the original award", async () => {
    const h = harness({
      claim: { kind: "duplicate", attributes: { status: "DONE", xpAwarded: 160, newCellCount: 0 } },
    }, true)
    const again = await logWorkout(pushups, USER, h.deps)
    expect(again).toMatchObject({ logged: false, xpAwarded: 160 })
    expect(h.transacts).toEqual([])
  })

  it("the activity id is the same on both deliveries", async () => {
    const a = await logWorkout(pushups, USER, harness().deps)
    const b = await logWorkout(pushups, USER, harness({
      claim: { kind: "duplicate", attributes: { status: "DONE", xpAwarded: a.xpAwarded } },
    }, true).deps)
    expect(b.activityId).toBe(a.activityId)
  })
})

describe("occurredAt (criterion 8)", () => {
  it("defaults to submission time", async () => {
    const h = harness()
    await logWorkout(pushups, USER, h.deps)
    const activity = h.transacts[0]!.TransactItems!.find((i) => String(i.Put?.TableName).startsWith("Activity"))!.Put!.Item!
    expect(activity.startedAt).toBe("2026-10-02T13:15:00.000Z")
    expect(activity.startedAtLocal).toBe("2026-10-02T07:15:00")
  })

  it("may be back-dated, and the ledger row cites the back-dated instant", async () => {
    const h = harness()
    await logWorkout({ ...pushups, occurredAt: "2026-09-20T07:00:00.000Z" }, USER, h.deps)
    const activity = h.transacts[0]!.TransactItems!.find((i) => String(i.Put?.TableName).startsWith("Activity"))!.Put!.Item!
    expect(activity.startedAt).toBe("2026-09-20T07:00:00.000Z")
  })
})

describe("refusals the client caused", () => {
  it("an exercise no enabled skill logs is refused before anything is archived", async () => {
    const h = harness()
    await expect(logWorkout({ ...pushups, exerciseId: "burpee" }, USER, h.deps)).rejects.toBeInstanceOf(LogWorkoutRefused)
    expect(h.calls).toEqual([])
  })

  it("an XP field on the arguments is dropped, never read", async () => {
    const h = harness()
    const result = await logWorkout({ ...pushups, xpAwarded: 999_999, skillId: "slayer", level: 99 }, USER, h.deps)
    expect(result.xpAwarded).toBeLessThan(999_999)
    expect(ledgerSkills(h.transacts)).not.toContain("slayer")
  })
})

/**
 * `0240`, D-286, criterion 4: a hand-logged distance through the UNCHANGED `processActivity`.
 * Under v3, whose Vigil row declares a distance exercise asserting `kind: run`. The scorer is
 * not told anything new: the adapter makes a traceless run with a `distanceM`, and Vigil's
 * `distanceKm` measure scores it exactly as it would a treadmill run synced from a watch.
 */
describe("a hand-logged distance (0240, D-286)", () => {
  const V3 = loadRuleSet(3)
  const exercise = V3.skills.flatMap((s) => s.exercises ?? []).find((e) => e.entry === "distance")!
  const distance = { exerciseId: exercise.id, sets: [{ distanceM: 5000, durationS: 1800 }], idempotencyKey: "k-distance", timezone: "America/Denver" }
  const activityOf = (h: ReturnType<typeof harness>) =>
    h.transacts[0]!.TransactItems!.find((i) => String(i.Put?.TableName).startsWith("Activity"))!.Put!.Item!

  it("persists a traceless run whose distance and time come from the set", async () => {
    const h = harness({}, false, V3)
    expect(await logWorkout(distance, USER, h.deps)).toMatchObject({ logged: true })
    expect(activityOf(h)).toMatchObject({ kind: "run", hasTrace: false, distanceM: 5000, elapsedS: 1800, traceRef: null })
  })

  it("scores the distance skill and its feed, at the distance skill's own rate", async () => {
    const h = harness({}, false, V3)
    const result = await logWorkout(distance, USER, h.deps)
    const skill = V3.skills.find((s) => s.exercises?.some((e) => e.id === exercise.id))!
    expect(new Set(ledgerSkills(h.transacts))).toEqual(new Set([skill.id, ...(skill.feeds ?? []).map((f) => f.skill)]))
    const own = h.transacts[0]!.TransactItems!.find((i) => i.Put?.TableName === LEDGER_TABLE && i.Put.Item!.skillId === skill.id)!
    expect(own.Put!.Item!.xpAwarded).toBe(5 * skill.xpPerUnit)
    expect(result.xpAwarded).toBe(activityOf(h).xpAwarded)
  })

  it("reveals no ground: no cell, no blob, no generation", async () => {
    const h = harness({}, false, V3)
    await logWorkout(distance, USER, h.deps)
    expect(h.cellWrites).toEqual([])
    expect(h.aggWrites).toEqual([])
    expect(h.blobPuts).toEqual([])
    expect(h.calls).not.toContain("generation")
    expect(ledgerSkills(h.transacts)).not.toContain("cartography")
  })

  it("the time is optional", async () => {
    const h = harness({}, false, V3)
    await logWorkout({ ...distance, sets: [{ distanceM: 3000 }] }, USER, h.deps)
    expect(activityOf(h)).toMatchObject({ distanceM: 3000, elapsedS: 0 })
  })

  it("is never a cross-source duplicate, as any log with sets (D-281 unchanged)", async () => {
    const h = harness({ dedupeRows: [{ id: "watch-run", startedAt: "2026-10-02T13:14:00.000Z", elapsedS: 1800, distanceM: 5000 }] }, false, V3)
    expect(await logWorkout(distance, USER, h.deps)).toMatchObject({ logged: true })
    expect(h.dedupeReads).toEqual([])
  })

  it("a time on a count exercise is refused, not half-scored", async () => {
    const h = harness({}, false, V3)
    await expect(logWorkout({ ...pushups, sets: [{ reps: 30, durationS: 60 }] }, USER, h.deps)).rejects.toBeInstanceOf(LogWorkoutRefused)
  })

  it("a client cannot assert the kind: the registry's is stamped over it", async () => {
    const h = harness({}, false, V3)
    await logWorkout({ ...pushups, kind: "run" }, USER, h.deps)
    expect(activityOf(h).kind).toBe("strength")
  })
})
