import type { QueryCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it } from "vitest"

import { activityKind } from "@/lib/run-kind/server"
import { activityLedger } from "@/lib/runs/ledger-server"

import { landmarks, recentLedger, replayInProgress, skillLedger, skillStates, type SkillReadDeps } from "./server"
import { LEDGER_ROWS } from "./wire"

/**
 * THE MODEL READS ON THE SSR COMPUTE, ticket `0331`. What each query sends, against a stub client.
 *
 * AppSync's owner rule did the scoping before; now the key condition or an explicit filter does, so
 * these assert that the uid handed in is in every query's key or filter, and that the bounded read
 * pages as the AppSync one did.
 */

type Input = QueryCommand["input"]

function stub(pages: Record<string, unknown>[][] = [[]]) {
  const sent: Input[] = []
  let i = 0
  const ddb = {
    send: async (command: QueryCommand) => {
      sent.push(command.input)
      const items = pages[i] ?? []
      i++
      return { Items: items, ...(i < pages.length ? { LastEvaluatedKey: { k: i } } : {}) }
    },
  }
  return { ddb, sent }
}

const deps = (ddb: SkillReadDeps["ddb"]): SkillReadDeps => ({
  ddb,
  ledgerTable: "T4",
  skillStateTable: "T2",
  profileTable: "T1",
  landmarkTable: "L",
})

describe("skills reads key every query by the uid", () => {
  it("skillStates: T2's partition, mapped to CachedSkill", async () => {
    const { ddb, sent } = stub([[{ skillId: "athletics", displayedXp: 120, levelHighWater: 4 }]])
    expect(await skillStates("u-1", deps(ddb))).toEqual([{ skillId: "athletics", xp: 120, levelHighWater: 4 }])
    expect(sent[0]).toMatchObject({ TableName: "T2", KeyConditionExpression: "#u = :u", ExpressionAttributeValues: { ":u": "u-1" } })
  })

  it("recentLedger: byUserAndSeq, newest first, in pages, stopping at LEDGER_ROWS", async () => {
    const row = { skillId: "a", activityId: "x", xpAwarded: 1, xpRulesVersion: 4, isFloor: false, seq: "s" }
    const { ddb, sent } = stub([Array(250).fill(row), Array(250).fill(row), Array(250).fill(row)])
    const out = await recentLedger("u-1", deps(ddb))
    expect(out).toHaveLength(LEDGER_ROWS)
    expect(sent).toHaveLength(2)
    expect(sent[0]).toMatchObject({ IndexName: "byUserAndSeq", ScanIndexForward: false, Limit: 250, ExpressionAttributeValues: { ":u": "u-1" } })
    expect(sent[1]).toMatchObject({ ExclusiveStartKey: { k: 1 } })
  })

  it("skillLedger: bySkill on `${uid}#${skillId}`, every page", async () => {
    const { ddb, sent } = stub([[{ skillId: "a", reason: "distance", units: 5 }], [{ skillId: "a", reason: "floor", units: 0 }]])
    expect(await skillLedger("u-1", "athletics", deps(ddb))).toHaveLength(2)
    expect(sent[0]).toMatchObject({ IndexName: "bySkill", ExpressionAttributeValues: { ":us": "u-1#athletics" } })
    expect(sent[0]!.Limit).toBeUndefined()
  })

  it("replayInProgress: Profile's id is the uid; no row is false", async () => {
    const { ddb, sent } = stub([[]])
    expect(await replayInProgress("u-1", deps(ddb))).toBe(false)
    expect(sent[0]).toMatchObject({ TableName: "T1", KeyConditionExpression: "#id = :u", ExpressionAttributeValues: { ":u": "u-1" } })
    expect(await replayInProgress("u-1", deps(stub([[{ replayInProgress: true }]]).ddb))).toBe(true)
  })

  it("landmarks: the uid's partition, with a skill prefix only when asked", async () => {
    const all = stub([[{ level: 50, place: "landmark", lng: 1, lat: 2 }, { level: 99, place: "shrine" }]])
    expect(await landmarks("u-1", undefined, deps(all.ddb))).toEqual([
      { level: 50, place: "landmark", lng: 1, lat: 2 },
      { level: 99, place: "shrine", lng: null, lat: null },
    ])
    expect(all.sent[0]).toMatchObject({ KeyConditionExpression: "#u = :u", ExpressionAttributeValues: { ":u": "u-1" } })
    const one = stub()
    await landmarks("u-1", "athletics", deps(one.ddb))
    expect(one.sent[0]).toMatchObject({ ExpressionAttributeValues: { ":u": "u-1", ":p": "athletics#" } })
  })
})

describe("activity reads filter on the uid, because their key is the activity", () => {
  it("activityLedger: byActivity, filtered by userId, never Limit-ed (Limit applies before the filter)", async () => {
    const { ddb, sent } = stub([[{ skillId: "athletics", reason: "distance", xpAwarded: 40, xpRulesVersion: 4, isFloor: false, units: 5.1 }]])
    expect(await activityLedger("u-1", "a-1", { ddb, ledgerTable: "T4" })).toEqual([
      { skillId: "athletics", reason: "distance", xpAwarded: 40, xpRulesVersion: 4, isFloor: false, units: 5.1 },
    ])
    expect(sent[0]).toMatchObject({ IndexName: "byActivity", FilterExpression: "#u = :u", ExpressionAttributeValues: { ":a": "a-1", ":u": "u-1" } })
    expect(sent[0]!.Limit).toBeUndefined()
  })

  it("activityKind: T3's base table by id, filtered by userId; another user's activity is null", async () => {
    const hit = stub([[{ kind: "run", derivedKind: "walk", kindOverride: { kind: "run", setBy: "x" } }]])
    expect(await activityKind("u-1", "a-1", { ddb: hit.ddb, activityTable: "T3" })).toEqual({ kind: "run", derivedKind: "walk", kindOverride: { kind: "run" } })
    expect(hit.sent[0]).toMatchObject({ TableName: "T3", KeyConditionExpression: "#id = :id", FilterExpression: "#u = :u", ExpressionAttributeValues: { ":id": "a-1", ":u": "u-1" } })
    expect(hit.sent[0]!.IndexName).toBeUndefined()
    expect(await activityKind("u-1", "a-1", { ddb: stub([[]]).ddb, activityTable: "T3" })).toBeNull()
  })
})
