import { BatchWriteCommand, DeleteCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it } from "vitest"

import type { FoldedCell } from "@/src/domain/fold"
import { reconcile, type XpLedgerEntry } from "@/src/scoring"
import { mergeFolded } from "@/src/pipeline/explored-merge"
import {
  activityScoreItem,
  dynamoReplayStore,
  replayRunItem,
  skillStateThawItem,
  type ReplayStoreDeps,
} from "@/src/pipeline/xp-replay-store"
import { REPLAY_ACTIVITY_ID, REPLAY_SEQ_PREFIX, type ReplayRunRecord } from "@/src/pipeline/xp-replay"

/**
 * Ticket 0066. The DynamoDB shapes of the replay store, asserted on the COMMANDS SENT. What each
 * condition does against the real service is the ticket's smoke test.
 */

const TABLES = { ledger: "L", skillState: "S", profile: "P", activity: "A", cells: "C" }

function recorder(reply: (c: unknown) => unknown = () => ({})) {
  const sent: unknown[] = []
  const deps = {
    ddb: {
      send: async (c: unknown) => {
        sent.push(c)
        return reply(c)
      },
    },
    tables: TABLES,
    blobs: {} as ReplayStoreDeps["blobs"],
    snapshots: {} as ReplayStoreDeps["snapshots"],
    loadTrace: async () => undefined,
  } satisfies ReplayStoreDeps
  return { sent, store: dynamoReplayStore(deps) }
}

const RUN: ReplayRunRecord = {
  id: "REPLAY#u-1#0ABC",
  userId: "u-1",
  fromRulesVersion: 1,
  toRulesVersion: 2,
  startedAt: "2026-09-29T12:00:00.000Z",
  status: "RUNNING",
  waterline: { wayfaring: { xp: 500, level: 6 } },
}

describe("the ReplayRun item (§4.5)", () => {
  it("is a complete T4 row that no SUM can see: xpAwarded 0, isFloor false, a reserved activityId", () => {
    const item = replayRunItem(RUN)
    expect(item).toMatchObject({
      id: RUN.id,
      userId: "u-1",
      activityId: REPLAY_ACTIVITY_ID,
      reason: "replay_run",
      xpAwarded: 0,
      isFloor: false,
      seq: `${REPLAY_SEQ_PREFIX}0ABC`,
      status: "RUNNING",
      fromRulesVersion: 1,
      toRulesVersion: 2,
      waterline: RUN.waterline,
      __typename: "XpLedgerEntry",
      owner: "u-1::u-1",
    })
    // Every attribute T4 declares required, so AppSync can list the partition without a
    // non-null error on the audit row.
    for (const k of ["skillIdReason", "userIdSkillId", "units", "unitsEffective", "xpRulesVersion", "awardedAt"]) {
      expect(item[k], k).toBeDefined()
    }
  })

  it("sorts before every activity row in GSI2", () => {
    expect(String(replayRunItem(RUN).seq) < "2000-01-01T00:00:00Z").toBe(true)
  })

  it("putRun is create-only; updateRun only overwrites an existing run", async () => {
    const { sent, store } = recorder()
    await store.putRun(RUN)
    await store.updateRun({ ...RUN, status: "DONE", finishedAt: "2026-09-29T12:01:00.000Z" })
    const [put, update] = sent as PutCommand[]
    expect(put!.input.ConditionExpression).toBe("attribute_not_exists(id)")
    expect(update!.input.ConditionExpression).toBe("attribute_exists(id)")
    expect(update!.input.Item).toMatchObject({ status: "DONE", finishedAt: "2026-09-29T12:01:00.000Z" })
  })

  it("findUnfinishedRun reads only the reserved seq prefix and skips DONE runs", async () => {
    const { sent, store } = recorder(() => ({
      Items: [
        replayRunItem({ ...RUN, id: "REPLAY#u-1#0001", status: "DONE" }),
        replayRunItem({ ...RUN, id: "REPLAY#u-1#0002", status: "FAILED" }),
      ],
    }))
    const found = await store.findUnfinishedRun("u-1")
    expect(found).toMatchObject({ id: "REPLAY#u-1#0002", status: "FAILED", waterline: RUN.waterline })
    expect((sent[0] as QueryCommand).input).toMatchObject({
      IndexName: "byUserAndSeq",
      KeyConditionExpression: "userId = :u AND begins_with(seq, :p)",
    })
  })
})

describe("I-18 at the table", () => {
  it("every delete is conditional on isFloor = false", async () => {
    const { sent, store } = recorder()
    await store.deleteLedger(["a#s#distance#v1", "b#s#distance#v1"])
    for (const d of sent as DeleteCommand[]) {
      expect(d.input.ConditionExpression).toBe("attribute_not_exists(id) OR isFloor = :f")
      expect(d.input.ExpressionAttributeValues).toEqual({ ":f": false })
    }
    expect(sent).toHaveLength(2)
  })

  it("floor rows are create-only; rule rows go in batches of 25", async () => {
    const { sent, store } = recorder()
    const rows = Array.from(
      { length: 30 },
      (_, i) =>
        ({
          id: `a${i}#s#distance#v2`,
          userId: "u-1",
          activityId: `a${i}`,
          skillId: "s",
          reason: "distance",
          units: 1,
          unitsEffective: 1,
          xpAwarded: 10,
          xpRulesVersion: 2,
          isFloor: false,
          seq: `2026#a${i}#00`,
          awardedAt: "2026-01-01T00:00:00.000Z",
        }) satisfies XpLedgerEntry,
    )
    const floors = reconcile({
      userId: "u-1",
      waterline: { s: { xp: 999, level: 5 } },
      recomputed: new Map([["s", 300]]),
      existingFloors: new Map(),
      fromVersion: 1,
      toVersion: 2,
      awardedAt: "2026-09-29T12:00:00.000Z",
    })
    await store.putLedger([...rows, ...floors])

    const batches = sent.filter((c) => c instanceof BatchWriteCommand) as BatchWriteCommand[]
    expect(batches.map((b) => b.input.RequestItems!.L!.length)).toEqual([25, 5])
    const puts = sent.filter((c) => c instanceof PutCommand) as PutCommand[]
    expect(puts).toHaveLength(1)
    expect(puts[0]!.input.ConditionExpression).toBe("attribute_not_exists(id)")
    expect(puts[0]!.input.Item).toMatchObject({
      id: "__floor__#s#v1-2",
      isFloor: true,
      xpAwarded: 699,
      supersedesRulesVersion: 1,
      skillIdReason: "s#retained_floor",
    })
  })
})

describe("the THAW write (§4.4 step 6)", () => {
  const w = {
    skillId: "wayfaring",
    xp: 500,
    level: 5,
    levelHighWater: 6,
    rulesVersion: 2,
    introducedIn: 1,
    firstXpAt: "2026-01-01T00:00:00.000Z",
  }

  it("sets xpLedgerSum and displayedXp together, and refuses to lower either ratchet", () => {
    const u = skillStateThawItem("u-1", w, "2026-09-29T12:00:00.000Z", "S")
    expect(u.UpdateExpression).toMatch(/xpLedgerSum = :xp, displayedXp = :xp/)
    expect(u.ConditionExpression).toBe(
      "(attribute_not_exists(displayedXp) OR displayedXp <= :xp) AND " +
        "(attribute_not_exists(levelHighWater) OR levelHighWater <= :hw)",
    )
    expect(u.ExpressionAttributeValues).toMatchObject({ ":xp": 500, ":hw": 6, ":level": 5, ":ver": 2 })
    expect(u.UpdateExpression).toMatch(/firstSeenRulesVersion = if_not_exists/)
    expect(u.UpdateExpression).not.toMatch(/lastXpAt/)
  })

  it("never contains a max() of old and new XP — D-135 is a condition and a row, not a clamp", () => {
    const u = skillStateThawItem("u-1", w, "2026-09-29T12:00:00.000Z", "S")
    expect(JSON.stringify(u)).not.toMatch(/max|greatest/i)
  })

  it("freeze creates the Profile row if needed; thaw clears the flag with the totals", async () => {
    const { sent, store } = recorder()
    await store.freeze("u-1", "2026-09-29T12:00:00.000Z")
    await store.thaw("u-1", { totalXp: 1234, totalLevel: 17 }, "2026-09-29T12:05:00.000Z")
    const [freeze, thaw] = sent as UpdateCommand[]
    expect(freeze!.input).toMatchObject({ TableName: "P", Key: { id: "u-1" } })
    expect(freeze!.input.ExpressionAttributeValues).toMatchObject({ ":t": true, ":tn": "Profile", ":owner": "u-1::u-1" })
    expect(thaw!.input.ExpressionAttributeValues).toMatchObject({ ":f": false, ":xp": 1234, ":lvl": 17 })
  })
})

describe("the T3 score write-back (0224)", () => {
  it("sets only the score columns, on an existing ACTIVE row", async () => {
    const { sent, store } = recorder()
    await store.writeActivityScores(
      "u-1",
      [
        { activityId: "a-1", xpAwarded: 120, xpRulesVersion: 2 },
        { activityId: "a-2", xpAwarded: 0, xpRulesVersion: null },
      ],
      "2026-09-29T12:00:00.000Z",
    )
    const [a1, a2] = (sent as UpdateCommand[]).map((c) => c.input)
    expect(a1).toEqual(activityScoreItem({ activityId: "a-1", xpAwarded: 120, xpRulesVersion: 2 }, "2026-09-29T12:00:00.000Z", "A"))
    expect(a1).toMatchObject({
      TableName: "A",
      Key: { id: "a-1" },
      UpdateExpression: "SET xpAwarded = :xp, xpRulesVersion = :ver, updatedAt = :now",
      ConditionExpression: "attribute_exists(id) AND #status = :active",
      ExpressionAttributeValues: { ":xp": 120, ":ver": 2, ":active": "ACTIVE" },
    })
    expect(a2!.ExpressionAttributeValues).toMatchObject({ ":xp": 0, ":ver": null })
  })

  it("with an award (0226), sets the six award columns too — the names activityItem writes", () => {
    const award = {
      cellCount: 121,
      newCellCount: 32,
      rearmedCellCount: 0,
      cooledCellCount: 89,
      deferredCellCount: 0,
      discoveryCredits: 32,
      res: 10,
      algoVersion: 1,
    }
    const u = activityScoreItem({ activityId: "a-1", xpAwarded: 711, xpRulesVersion: 1, award }, "2026-09-30T00:00:00.000Z", "A")
    expect(u.UpdateExpression).toBe(
      "SET xpAwarded = :xp, xpRulesVersion = :ver, updatedAt = :now, cellCount = :cellCount, " +
        "newCellCount = :newCellCount, rearmedCellCount = :rearmedCellCount, cooledCellCount = :cooledCellCount, " +
        "deferredCellCount = :deferredCellCount, fogAlgoVersion = :fogAlgoVersion",
    )
    expect(u.ExpressionAttributeValues).toMatchObject({ ":newCellCount": 32, ":cooledCellCount": 89, ":fogAlgoVersion": 1 })
    // discoveryCredits is not a column (D-193).
    expect(JSON.stringify(u)).not.toMatch(/discoveryCredits/)
  })
})

describe("the T6 merge (§4.4 step 4) never lowers a cell", () => {
  const f: FoldedCell = {
    firstRunAt: "2026-01-01T00:00:00.000Z",
    firstRunId: "a",
    lastRunAt: "2026-03-01T00:00:00.000Z",
    lastRunId: "c",
    visitCount: 3,
    discoveryCount: 2,
  }

  it("is a no-op over a row that already says the same", () => {
    expect(mergeFolded({ ...f }, f)).toBeUndefined()
  })

  it("takes min(firstRunAt), max(lastRunAt) and max of both counts", () => {
    const stored = {
      firstRunAt: "2026-02-01T00:00:00.000Z",
      firstRunId: "b",
      lastRunAt: "2026-04-01T00:00:00.000Z",
      lastRunId: "d",
      visitCount: 2,
      discoveryCount: 5,
    }
    expect(mergeFolded(stored, f)).toEqual({
      firstRunAt: f.firstRunAt,
      firstRunId: "a",
      lastRunAt: stored.lastRunAt,
      lastRunId: "d",
      visitCount: 3,
      discoveryCount: 5,
    })
  })

  it("creates a cell T6 lost entirely", () => {
    expect(mergeFolded(undefined, f)).toEqual(f)
  })
})
