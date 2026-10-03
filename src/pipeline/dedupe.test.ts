import { readFileSync } from "node:fs"

import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it } from "vitest"

import { DEDUPE_ANCHOR_MS, computeDedupeKey } from "@/src/domain/dedupe-key"
import { DEDUPE_INDEX, duplicatePointerKey, findDuplicate, recordDuplicatePointer } from "@/src/pipeline/dedupe"
import { archivePrefix } from "@/src/pipeline/replay"

/**
 * Step 3's lookup in isolation. Ticket `0179`. The end-to-end proof — two adapters, one activity,
 * one award — is `src/adapters/strava/cross-source-dedupe.test.ts`; this file pins the parts of
 * `dedupe.ts` that test cannot see.
 */

const USER = "u-1"
type Row = { id: string; startedAt: string; elapsedS: number; distanceM?: number }

/** A T3 that answers GSI2 by the REAL key, so a probe on the wrong bucket is a miss. */
function t3(rows: Row[]) {
  const queried: string[] = []
  const ddb = {
    async send(command: QueryCommand | GetCommand) {
      if (command instanceof QueryCommand) {
        const key = String(command.input.ExpressionAttributeValues![":key"])
        queried.push(key)
        return {
          Items: rows
            .filter((r) => computeDedupeKey(USER, Date.parse(r.startedAt)) === key)
            .map((r) => ({ id: r.id })),
        }
      }
      return { Item: rows.find((r) => r.id === command.input.Key?.id) }
    },
  }
  return { deps: { ddb, activityTable: "T3" }, queried }
}

const incoming = (startedAt: string, over: Partial<Row> = {}) => ({
  activityId: "incoming",
  userId: USER,
  startedAt,
  elapsedS: 1800,
  distanceM: 5000,
  ...over,
})

describe("findDuplicate", () => {
  it("finds a duplicate stored in the NEIGHBOURING anchor bucket", async () => {
    // One minute before an anchor edge, and the other recording one minute after it.
    const edge = Math.ceil(Date.parse("2026-09-06T03:00:00Z") / DEDUPE_ANCHOR_MS) * DEDUPE_ANCHOR_MS
    const before = new Date(edge - 60_000).toISOString()
    const after = new Date(edge + 60_000).toISOString()
    const { deps, queried } = t3([{ id: "other", startedAt: after, elapsedS: 1810, distanceM: 5040 }])

    expect(await findDuplicate(incoming(before), deps)).toEqual({ activityId: "other" })
    expect(queried).toHaveLength(2)
  })

  it("lets an absent distance abstain rather than veto (D-211)", async () => {
    const { deps } = t3([{ id: "treadmill", startedAt: "2026-09-06T03:10:30Z", elapsedS: 1790 }])
    expect(await findDuplicate(incoming("2026-09-06T03:10:00Z"), deps)).toEqual({ activityId: "treadmill" })
  })

  it("does not match a run whose distance differs beyond max(100 m, 3%)", async () => {
    const { deps } = t3([{ id: "longer", startedAt: "2026-09-06T03:10:30Z", elapsedS: 1800, distanceM: 5200 }])
    expect(await findDuplicate(incoming("2026-09-06T03:10:00Z"), deps)).toBeNull()
  })

  it("never matches its own row", async () => {
    const { deps } = t3([{ id: "incoming", startedAt: "2026-09-06T03:10:00Z", elapsedS: 1800, distanceM: 5000 }])
    expect(await findDuplicate(incoming("2026-09-06T03:10:00Z"), deps)).toBeNull()
  })

  it("never treats an activity carrying sets as a cross-source duplicate (D-281)", async () => {
    // Pushups at 07:00, a plank logged three minutes later: no distance, elapsed within 5 min.
    // Without the rule these match each other and the plank scores nothing.
    const pushups = { id: "pushups", startedAt: "2026-09-06T07:00:00Z", elapsedS: 0 }
    const { deps, queried } = t3([pushups])
    const plank = incoming("2026-09-06T07:03:00Z", {
      elapsedS: 120,
      distanceM: undefined,
    })

    expect(await findDuplicate({ ...plank, sets: [] }, deps)).toEqual({ activityId: "pushups" })
    queried.length = 0
    expect(
      await findDuplicate({ ...plank, sets: [{ exercise: "plank", durationS: 120 }] }, deps),
    ).toBeNull()
    expect(queried, "short-circuits before any GSI read").toEqual([])
  })
})

describe("the duplicateOf pointer", () => {
  const loser = { userId: USER, source: "gpslogger", externalId: "9001", activityId: "incoming" }

  it("sits beside the archive prefix replay lists, never under it", () => {
    const prefix = archivePrefix(loser)
    expect(duplicatePointerKey(loser).startsWith(prefix)).toBe(false)
    expect(duplicatePointerKey(loser).startsWith("raw/")).toBe(true)
  })

  it("treats an existing pointer as written — a redelivery puts identical facts", async () => {
    const s3 = {
      async send() {
        throw Object.assign(new Error("exists"), { name: "PreconditionFailed" })
      },
    }
    await expect(
      recordDuplicatePointer(loser, { activityId: "w" }, { s3, bucket: "b" }, new Date(0)),
    ).resolves.toBe(duplicatePointerKey(loser))
  })

  it("propagates any other failure, so the receipt is never marked without it", async () => {
    const s3 = {
      async send() {
        throw new Error("s3 is down")
      },
    }
    await expect(
      recordDuplicatePointer(loser, { activityId: "w" }, { s3, bucket: "b" }, new Date(0)),
    ).rejects.toThrow("s3 is down")
  })
})

it("names the same GSI2 that amplify/data/resource.ts declares", () => {
  const resource = readFileSync(new URL("../../amplify/data/resource.ts", import.meta.url), "utf8")
  expect(resource).toContain(`.name("${DEDUPE_INDEX}")`)
})
