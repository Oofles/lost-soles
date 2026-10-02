import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it } from "vitest"

import {
  ledgerRulesVersion,
  pickBundledRules,
  rulesForUser,
  RulesVersionNotBundledError,
  type Registry,
} from "@/src/pipeline/worker-rules"
import { loadRuleSet } from "@/src/rules/load"

/**
 * Ticket `0234`, D-274 — the worker scores each user under the version their ledger is on.
 * The end-to-end proof (an ingest after a replay to v2 writes v2 rows) is in
 * `process-activity.test.ts` and `xp-replay.test.ts`; this file is the resolver's own rules.
 */

const V1 = loadRuleSet(1)
const V2: Registry = { ...V1, version: 2 }
const BUNDLED = new Map<number, Registry>([
  [1, V1],
  [2, V2],
])

describe("ledgerRulesVersion", () => {
  it("is the highest version any T2 row records", () => {
    expect(ledgerRulesVersion([{ rulesVersionLastComputed: 1 }, { rulesVersionLastComputed: 2 }])).toBe(2)
  })

  it("is undefined for a user with no rows, or rows that record none", () => {
    expect(ledgerRulesVersion([])).toBeUndefined()
    expect(ledgerRulesVersion([{}, { rulesVersionLastComputed: undefined }])).toBeUndefined()
  })
})

describe("pickBundledRules", () => {
  it("picks the ledger's version, even when a newer one is bundled", () => {
    // A deploy that ships v2 must not move a user still on v1 — only the replay does.
    expect(pickBundledRules("u-1", 1, BUNDLED)).toBe(V1)
    expect(pickBundledRules("u-1", 2, BUNDLED)).toBe(V2)
  })

  it("scores a user with no ledger under the newest bundled version", () => {
    expect(pickBundledRules("u-1", undefined, BUNDLED)).toBe(V2)
  })

  it("refuses a version this deployment does not carry, rather than falling back", () => {
    expect(() => pickBundledRules("u-1", 3, BUNDLED)).toThrow(RulesVersionNotBundledError)
    expect(() => pickBundledRules("u-1", 3, BUNDLED)).toThrow(/v3.*bundles only v1, v2/)
  })
})

describe("rulesForUser", () => {
  it("reads the whole T2 partition, consistently, and resolves from it", async () => {
    const queries: QueryCommand["input"][] = []
    const pages = [
      { Items: [{ skillId: "wayfaring", rulesVersionLastComputed: 2 }], LastEvaluatedKey: { k: 1 } },
      { Items: [{ skillId: "cartography", rulesVersionLastComputed: 1 }] },
    ]
    const ddb = {
      async send(command: QueryCommand) {
        queries.push(command.input)
        return pages[queries.length - 1]
      },
    }
    const rules = await rulesForUser("u-1", { ddb, table: "SkillState-x", profileTable: "Profile-x", bundled: BUNDLED })
    expect(rules).toBe(V2)
    // T2 answered, so T1 is never read.
    expect(queries).toHaveLength(2)
    expect(queries[0]).toMatchObject({ TableName: "SkillState-x", ConsistentRead: true })
  })

  /** `0235`, D-275. No T2 rows: `Profile.ledgerRulesVersion`, then the newest bundled. */
  describe("the Profile fallback", () => {
    const world = (profile: Record<string, unknown> | undefined) => {
      const gets: GetCommand["input"][] = []
      const ddb = {
        async send(command: QueryCommand | GetCommand) {
          if (command instanceof GetCommand) {
            gets.push(command.input)
            return profile ? { Item: profile } : {}
          }
          return { Items: [] }
        },
      }
      return { gets, deps: { ddb, table: "SkillState-x", profileTable: "Profile-x", bundled: BUNDLED } }
    }

    it("a replay that left no T2 rows still pins the user to the version it stamped", async () => {
      const { gets, deps } = world({ ledgerRulesVersion: 1 })
      expect(await rulesForUser("u-1", deps)).toBe(V1)
      expect(gets).toEqual([
        { TableName: "Profile-x", Key: { id: "u-1" }, ProjectionExpression: "ledgerRulesVersion", ConsistentRead: true },
      ])
    })

    it("no stamp, or no Profile row at all: the newest bundled version", async () => {
      expect(await rulesForUser("u-1", world({ id: "u-1" }).deps)).toBe(V2)
      expect(await rulesForUser("u-1", world(undefined).deps)).toBe(V2)
    })

    it("a stamp this deployment does not bundle is refused, as a T2 version is", async () => {
      await expect(rulesForUser("u-1", world({ ledgerRulesVersion: 3 }).deps)).rejects.toBeInstanceOf(
        RulesVersionNotBundledError,
      )
    })
  })
})
