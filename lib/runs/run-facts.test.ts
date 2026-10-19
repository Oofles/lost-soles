import { QueryCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it, vi } from "vitest"

import { activityItem } from "@/src/pipeline/persist"

import { runFacts, type RunReadDeps } from "./server"
import { parseSummaryIds, RUNS_SUMMARY_MAX_IDS } from "./wire"

/**
 * Ticket `0101`. The facts a click on a route line shows (`06` §4.5), read per id from T3's base
 * table with `runById`'s ownership rule. Rows come from the shipped writer (`activityItem`), as
 * `server.test.ts` explains. Nothing geographic here.
 */

vi.mock("@/lib/fog/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fog/server")>()),
  defaultFogReadDeps: () => ({ s3: {}, bucket: "bkt" }),
}))

const row = (id: string, userId: string, over: Record<string, unknown> = {}) => ({
  ...activityItem({
    activityId: id,
    userId,
    kind: "run",
    hasTrace: true,
    traceRef: `users/${userId}/traces/${id}.segments.json.gz`,
    source: { source: "manual" },
    startedAt: "2026-09-09T11:00:00.000Z",
    startedAtLocal: "2026-09-09T07:00:00",
    timezone: "America/New_York",
    ingestedAt: "2026-09-09T11:30:00.000Z",
    name: null,
    sets: [],
  } as unknown as Parameters<typeof activityItem>[0]),
  ...over,
})

function rig(byId: Record<string, Record<string, unknown>>) {
  const queries: QueryCommand["input"][] = []
  const deps: RunReadDeps = {
    bucket: "bkt",
    activityTable: "TestActivity",
    ddb: {
      async send(command: QueryCommand) {
        queries.push(command.input)
        const id = (command.input.ExpressionAttributeValues as Record<string, string>)[":id"]!
        return { Items: byId[id] ? [byId[id]] : [] }
      },
    },
    s3: {} as RunReadDeps["s3"],
  }
  return { deps, queries }
}

describe("runFacts", () => {
  it("answers the caller's runs with date, distance and new cells, one base-table Query each", async () => {
    const { deps, queries } = rig({
      a: row("a", "u-1", { distanceM: 8400, newCellCount: 21 }),
      b: row("b", "u-1", { distanceM: null, newCellCount: null }),
    })
    const facts = await runFacts("u-1", ["a", "b"], deps)
    expect(facts).toEqual([
      { activityId: "a", startedAt: "2026-09-09T11:00:00.000Z", startedAtLocal: "2026-09-09T07:00:00", distanceM: 8400, newCellCount: 21 },
      { activityId: "b", startedAt: "2026-09-09T11:00:00.000Z", startedAtLocal: "2026-09-09T07:00:00", distanceM: null, newCellCount: 0 },
    ])
    expect(queries).toHaveLength(2)
    for (const q of queries) {
      expect(q.TableName).toBe("TestActivity")
      expect(q.IndexName).toBeUndefined()
      expect(q.KeyConditionExpression).toBe("#id = :id")
    }
  })

  /** The same answer for someone else's run and for no run: the route is no oracle. */
  it("leaves out a run that is not the caller's, exactly as one that does not exist", async () => {
    const { deps } = rig({ mine: row("mine", "u-1"), theirs: row("theirs", "u-2") })
    const facts = await runFacts("u-1", ["mine", "theirs", "nothing"], deps)
    expect(facts.map((f) => f.activityId)).toEqual(["mine"])
  })

  it("answers a tombstoned run: its line stays in the web", async () => {
    const { deps } = rig({ gone: row("gone", "u-1", { status: "TOMBSTONED" }) })
    expect((await runFacts("u-1", ["gone"], deps)).map((f) => f.activityId)).toEqual(["gone"])
  })
})

describe("parseSummaryIds", () => {
  it("dedupes and accepts up to the cap", () => {
    expect(parseSummaryIds("a,b,a")).toEqual(["a", "b"])
    const full = Array.from({ length: RUNS_SUMMARY_MAX_IDS }, (_, i) => `id${i}`)
    expect(parseSummaryIds(full.join(","))).toEqual(full)
  })

  it("refuses an absent, empty, over-long or malformed list", () => {
    expect(parseSummaryIds(null)).toBeNull()
    expect(parseSummaryIds("")).toBeNull()
    expect(parseSummaryIds(",,")).toBeNull()
    expect(parseSummaryIds(Array.from({ length: RUNS_SUMMARY_MAX_IDS + 1 }, (_, i) => `id${i}`).join(","))).toBeNull()
    expect(parseSummaryIds("a,../b")).toBeNull()
    expect(parseSummaryIds("a,b c")).toBeNull()
    expect(parseSummaryIds("x".repeat(129))).toBeNull()
  })
})
