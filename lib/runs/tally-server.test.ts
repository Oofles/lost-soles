import type { QueryCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it } from "vitest"

import { ledgerSeq } from "@/src/scoring/ledger"
import { FLOOR_SEQ_PREFIX } from "@/src/scoring/reconcile"

import { xpBeforeRun } from "./tally-server"

/**
 * Ticket `0081`, D-296 — "before" is as of the run. DynamoDB is stubbed with a tiny in-memory
 * `byUserAndSeq`: it honours `<` and `begins_with` on `seq` and pages, which is all the read uses.
 */

type Item = { userId: string; seq: string; skillId: string; xpAwarded: number }

function rig(items: Item[], page = 2) {
  const inputs: QueryCommand["input"][] = []
  return {
    inputs,
    deps: {
      ledgerTable: "T4",
      ddb: {
        async send(command: QueryCommand) {
          const q = command.input
          inputs.push(q)
          const v = q.ExpressionAttributeValues as Record<string, string>
          const match = items
            .filter((i) => i.userId === v[":u"])
            .filter((i) => (v[":cut"] !== undefined ? i.seq < v[":cut"] : i.seq.startsWith(v[":floor"]!)))
            .sort((a, b) => (a.seq < b.seq ? -1 : 1))
          const from = (q.ExclusiveStartKey?.n as number | undefined) ?? 0
          const out = match.slice(from, from + page)
          return { Items: out, LastEvaluatedKey: from + page < match.length ? { n: from + page } : undefined }
        },
      },
    },
  }
}

const RUN = { activityId: "act-b", startedAt: "2026-09-27T10:00:00.000Z" }
const at = (startedAt: string, id: string, nn = 0) => ledgerSeq(startedAt, id, nn)

describe("xpBeforeRun", () => {
  const items: Item[] = [
    { userId: "u", seq: at("2026-08-01T10:00:00.000Z", "act-a"), skillId: "s1", xpAwarded: 100 },
    { userId: "u", seq: at("2026-08-01T10:00:00.000Z", "act-a", 1), skillId: "s2", xpAwarded: 40 },
    { userId: "u", seq: at("2026-09-01T10:00:00.000Z", "act-z"), skillId: "s1", xpAwarded: 60 },
    // This run's own rows are not "before".
    { userId: "u", seq: at(RUN.startedAt, RUN.activityId), skillId: "s1", xpAwarded: 500 },
    { userId: "u", seq: at(RUN.startedAt, RUN.activityId, 1), skillId: "s2", xpAwarded: 300 },
    // Nor are later runs'.
    { userId: "u", seq: at("2026-10-01T10:00:00.000Z", "act-c"), skillId: "s1", xpAwarded: 9000 },
    // A floor row always is, though it sorts last.
    { userId: "u", seq: `${FLOOR_SEQ_PREFIX}01`, skillId: "s2", xpAwarded: 7 },
    // Another user's rows never are.
    { userId: "other", seq: at("2026-08-01T10:00:00.000Z", "x"), skillId: "s1", xpAwarded: 1_000_000 },
    // A zero-XP audit row (ReplayRun) adds nothing and names no skill worth keeping.
    { userId: "u", seq: at("2026-08-02T10:00:00.000Z", "__replay__"), skillId: "__replay__", xpAwarded: 0 },
  ]

  it("sums every earlier row plus every floor row, per skill, across pages", async () => {
    const { deps, inputs } = rig(items)
    expect(await xpBeforeRun("u", RUN, deps)).toEqual({ s1: 160, s2: 47 })
    expect(inputs.length).toBeGreaterThan(2) // it paged
  })

  it("queries byUserAndSeq on the session's user only, projecting two attributes", async () => {
    const { deps, inputs } = rig(items)
    await xpBeforeRun("u", RUN, deps)
    for (const q of inputs) {
      expect(q.IndexName).toBe("byUserAndSeq")
      expect((q.ExpressionAttributeValues as Record<string, string>)[":u"]).toBe("u")
      expect(q.ProjectionExpression).toBe("skillId, xpAwarded")
    }
  })

  it("the first run ever has an empty before", async () => {
    const { deps } = rig(items.filter((i) => !i.seq.startsWith(FLOOR_SEQ_PREFIX)))
    expect(await xpBeforeRun("u", { activityId: "first", startedAt: "2020-01-01T00:00:00.000Z" }, deps)).toEqual({})
  })
})
