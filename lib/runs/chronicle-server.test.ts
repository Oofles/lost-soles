import type { QueryCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it } from "vitest"

import { chronicleFor, historyUpTo } from "./chronicle-server"
import { EMPTY_COLLECTION, type RunSummary } from "./wire"

/** Ticket `0083` — beat 4's server half: the history read and the line it feeds. */

const SUMMARY: RunSummary = {
  activityId: "a-9",
  startedAt: "2026-08-28T11:00:00.000Z",
  startedAtLocal: "2026-08-28T07:00:00",
  name: null,
  kind: "run",
  distanceM: 5000,
  elapsedS: 1800,
  movingS: 1800,
  source: "manual",
  newCellCount: 0,
  rearmedCellCount: 0,
  cellCount: 140,
  route: EMPTY_COLLECTION,
  reveal: { new: [], rearmed: [] },
}

describe("historyUpTo", () => {
  it("pages to the end, bounded at the run's own start, and reads three attributes", async () => {
    const sent: QueryCommand[] = []
    const pages = [
      { Items: [{ id: "a-1", startedAt: "2026-08-01T00:00:00Z", distanceM: 4000, newCellCount: 12 }], LastEvaluatedKey: { k: 1 } },
      { Items: [{ id: "a-2", startedAt: "2026-08-02T00:00:00Z" }, { junk: true }] },
    ]
    const ddb = { send: async (c: QueryCommand) => (sent.push(c), pages[sent.length - 1]) }
    const out = await historyUpTo("u", SUMMARY.startedAt, { ddb, activityTable: "T3" })
    expect(out).toEqual([
      { activityId: "a-1", startedAt: "2026-08-01T00:00:00Z", distanceM: 4000, newCellCount: 12 },
      { activityId: "a-2", startedAt: "2026-08-02T00:00:00Z", distanceM: null, newCellCount: 0 },
    ])
    expect(sent).toHaveLength(2)
    expect(sent[0].input).toMatchObject({ IndexName: "byUserAndStart", ExpressionAttributeValues: { ":u": "u", ":s": SUMMARY.startedAt } })
    expect(sent[1].input.ExclusiveStartKey).toEqual({ k: 1 })
  })
})

describe("chronicleFor", () => {
  it("always returns a line from the shipped table, history or not", () => {
    expect(chronicleFor(SUMMARY, null).text.length).toBeGreaterThan(10)
    expect(chronicleFor(SUMMARY, []).set).toBe("no-new-ground")
  })

  it("is the same line on every read of the same run — a Relive does not rewrite it", () => {
    expect(chronicleFor(SUMMARY, [])).toEqual(chronicleFor(SUMMARY, []))
  })
})
