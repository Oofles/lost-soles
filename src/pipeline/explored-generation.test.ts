import { UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it } from "vitest"

import { EXPLORED_CELL_TABLE } from "./explored-cells"
import {
  bumpGeneration,
  generationKey,
  markReplayPending,
  raiseGenerationTo,
} from "./explored-generation"

/**
 * `0049`, **I-11**: *"`manifest.generation` is monotonic per user — it never decreases and
 * never restarts at 1, including after a full rebuild."*
 *
 * ─── THE FAKE EVALUATES THE CONDITION, IT DOES NOT RECORD IT ────────────────
 *
 * The same discipline `explored-cells.test.ts` uses. A fake that stored the
 * `ConditionExpression` and let the test assert on the string would pass whether or not
 * DynamoDB would have refused the write, which is exactly the property under test. This
 * one keeps a number, applies `ADD` and the `<` condition itself, and throws the real
 * exception name on a refusal.
 */
class FakeCounterTable {
  readonly items = new Map<string, number>()
  readonly commands: UpdateCommand[] = []

  send = async (command: UpdateCommand): Promise<{ Attributes?: Record<string, unknown> }> => {
    this.commands.push(command)
    const input = command.input
    const key = `${String(input.Key?.pk)}|${String(input.Key?.sk)}`
    const values = input.ExpressionAttributeValues ?? {}
    const current = this.items.get(key)

    if (input.UpdateExpression === "ADD generation :one") {
      const next = (current ?? 0) + (values[":one"] as number)
      this.items.set(key, next)
      return { Attributes: { generation: next } }
    }

    if (input.UpdateExpression === "SET generation = :n") {
      const n = values[":n"] as number
      const passes = current === undefined || current < n
      if (!passes) {
        const e = new Error("The conditional request failed")
        e.name = "ConditionalCheckFailedException"
        throw e
      }
      this.items.set(key, n)
      return {}
    }

    throw new Error(`FakeCounterTable: unrecognised UpdateExpression ${input.UpdateExpression}`)
  }
}

const deps = (table: FakeCounterTable) => ({ ddb: table, table: "T" })

describe("generationKey", () => {
  it("is U#<uid>#GEN / GEN — a third item type in T6 (D-218)", () => {
    expect(generationKey("u1")).toEqual({ pk: "U#u1#GEN", sk: "GEN" })
  })

  /**
   * The key spaces must not overlap. A `Query` for cells (`U#<uid>#C#<parent>`) or for
   * aggregates (`U#<uid>#AGG#<res>`) must not be able to return this item, and
   * `persist.ts`'s `assertNoCellWrites` — which recognises a cell by the `#C#` infix —
   * must not mistake it for one.
   */
  it("shares no partition with a cell or an aggregate", () => {
    const { pk } = generationKey("u1")
    expect(pk).not.toContain("#C#")
    expect(pk).not.toContain("#AGG#")
  })

  it("is per user, so one user's counter cannot move another's", () => {
    expect(generationKey("a").pk).not.toBe(generationKey("b").pk)
  })
})

describe("bumpGeneration", () => {
  it("returns 1 on a user's first ever call, with no bootstrap write", () => {
    // `ADD` treats a missing attribute as 0, which is why this module needs no GetItem
    // grant and no "does the item exist" round trip.
    const table = new FakeCounterTable()
    return expect(bumpGeneration("u1", deps(table))).resolves.toBe(1)
  })

  it("increases by exactly one each time", async () => {
    const table = new FakeCounterTable()
    const seen: number[] = []
    for (let i = 0; i < 5; i++) seen.push(await bumpGeneration("u1", deps(table)))
    expect(seen).toEqual([1, 2, 3, 4, 5])
  })

  /**
   * THE RACE THIS EXISTS FOR. The ingest queue is a standard SQS queue with `batchSize: 1`
   * and no reserved concurrency, so a Sync that pulls five activities runs five workers for
   * one user. `ADD` is atomic inside DynamoDB, so no two of them can be handed the same
   * number — which is what makes `explored-r10.<gen>.bin` safe to serve `immutable`.
   */
  it("never hands the same number to two concurrent callers", async () => {
    const table = new FakeCounterTable()
    const numbers = await Promise.all(
      Array.from({ length: 20 }, () => bumpGeneration("u1", deps(table))),
    )
    expect(new Set(numbers).size).toBe(20)
    expect([...numbers].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
  })

  it("keeps users independent", async () => {
    const table = new FakeCounterTable()
    await bumpGeneration("a", deps(table))
    await bumpGeneration("a", deps(table))
    expect(await bumpGeneration("b", deps(table))).toBe(1)
  })

  it("asks for UPDATED_NEW — the value is the point of the call", () => {
    const table = new FakeCounterTable()
    return bumpGeneration("u1", deps(table)).then(() => {
      expect(table.commands[0]!.input.ReturnValues).toBe("UPDATED_NEW")
    })
  })

  it("defaults to the real T6 table name", async () => {
    const table = new FakeCounterTable()
    await bumpGeneration("u1", { ddb: table })
    expect(table.commands[0]!.input.TableName).toBe(EXPLORED_CELL_TABLE)
  })

  /**
   * A generation names an immutable object. If the store ever answered with something that
   * is not a positive integer, the alternative to throwing is writing `explored-r10.NaN.bin`
   * and a manifest pointing at it.
   */
  it("throws rather than name an object after a non-integer", async () => {
    const bad = { send: async () => ({ Attributes: { generation: "42" } }) }
    await expect(bumpGeneration("u1", { ddb: bad } as never)).rejects.toThrow(/I-11/)
  })
})

describe("raiseGenerationTo — the drill's step 7 (02 §8.3)", () => {
  it("sets the floor on a counter that does not exist yet", async () => {
    const table = new FakeCounterTable()
    expect(await raiseGenerationTo("u1", 413, deps(table))).toBe(true)
    expect(await bumpGeneration("u1", deps(table))).toBe(414)
  })

  /**
   * CRITERION 7, literally: *"proven monotonic by a test that attempts to lower it."*
   */
  it("REFUSES to lower the counter, and says so without throwing", async () => {
    const table = new FakeCounterTable()
    await raiseGenerationTo("u1", 500, deps(table))

    expect(await raiseGenerationTo("u1", 499, deps(table))).toBe(false)
    expect(await raiseGenerationTo("u1", 1, deps(table))).toBe(false)
    // And the counter did not move.
    expect(await bumpGeneration("u1", deps(table))).toBe(501)
  })

  it("refuses to set the same value twice — strictly greater, or nothing", async () => {
    const table = new FakeCounterTable()
    await raiseGenerationTo("u1", 42, deps(table))
    expect(await raiseGenerationTo("u1", 42, deps(table))).toBe(false)
  })

  /**
   * The drill rebuilds into NEW, EMPTY tables (§8.3 step 0). Without this call the next
   * bump returns 1, and every client cached at generation 412 concludes it is ahead of the
   * rebuilt map and never fetches it again — the fog appearing to regress on exactly the
   * devices that were working.
   */
  it("survives the drill: an empty table set forward never restarts at 1", async () => {
    const rebuilt = new FakeCounterTable()
    const preDrillGeneration = 412
    expect(await raiseGenerationTo("u1", preDrillGeneration + 1, deps(rebuilt))).toBe(true)
    expect(await bumpGeneration("u1", deps(rebuilt))).toBeGreaterThan(preDrillGeneration)
  })

  it("rejects a non-positive target before it reaches DynamoDB", async () => {
    const table = new FakeCounterTable()
    await expect(raiseGenerationTo("u1", 0, deps(table))).rejects.toThrow(RangeError)
    await expect(raiseGenerationTo("u1", 1.5, deps(table))).rejects.toThrow(RangeError)
    expect(table.commands).toHaveLength(0)
  })

  it("propagates a non-conditional failure rather than reporting it as a refusal", async () => {
    const boom = {
      send: async () => {
        const e = new Error("throughput")
        e.name = "ProvisionedThroughputExceededException"
        throw e
      },
    }
    await expect(raiseGenerationTo("u1", 5, { ddb: boom } as never)).rejects.toThrow("throughput")
  })
})

describe("markReplayPending — §3.4's marker (0050)", () => {
  const AT = "2026-03-01T08:00:00.000Z"
  const EARLIER = "2024-01-01T08:00:00.000Z"
  const LATER = "2026-09-01T08:00:00.000Z"

  /** The fake's `SET replayFrom` branch, evaluated rather than recorded. */
  class FakeControlItem {
    readonly items = new Map<string, string>()
    readonly commands: UpdateCommand[] = []

    send = async (command: UpdateCommand): Promise<Record<string, unknown>> => {
      this.commands.push(command)
      const input = command.input
      const key = `${String(input.Key?.pk)}|${String(input.Key?.sk)}`
      const v = input.ExpressionAttributeValues ?? {}
      if (input.UpdateExpression !== "SET replayFrom = :at") {
        throw new Error(`unexpected: ${input.UpdateExpression}`)
      }
      const current = this.items.get(key)
      if (current !== undefined && !(current > (v[":at"] as string))) {
        throw Object.assign(new Error("refused"), { name: "ConditionalCheckFailedException" })
      }
      this.items.set(key, v[":at"] as string)
      return {}
    }
  }

  const d = (t: FakeControlItem) => ({ ddb: t, table: "T" })

  it("marks a user who has none", async () => {
    const table = new FakeControlItem()
    expect(await markReplayPending("u1", AT, d(table))).toBe(true)
    expect(table.items.get("U#u1#GEN|GEN")).toBe(AT)
  })

  /**
   * A `min`. The replay must start from the EARLIEST activity that needs one, so two
   * backfilled runs a year apart leave the marker at the older — otherwise the fold would
   * start after the run that made it necessary and reproduce the same wrong answer.
   */
  it("moves EARLIER when an older activity needs a replay", async () => {
    const table = new FakeControlItem()
    await markReplayPending("u1", AT, d(table))
    expect(await markReplayPending("u1", EARLIER, d(table))).toBe(true)
    expect(table.items.get("U#u1#GEN|GEN")).toBe(EARLIER)
  })

  it("REFUSES to move later, and reports it without throwing", async () => {
    const table = new FakeControlItem()
    await markReplayPending("u1", EARLIER, d(table))
    expect(await markReplayPending("u1", LATER, d(table))).toBe(false)
    expect(table.items.get("U#u1#GEN|GEN")).toBe(EARLIER)
  })

  it("refuses an identical mark too — strictly earlier, or nothing", async () => {
    const table = new FakeControlItem()
    await markReplayPending("u1", AT, d(table))
    expect(await markReplayPending("u1", AT, d(table))).toBe(false)
  })

  /** It rides on the fog control item, beside `generation`, rather than a fourth partition. */
  it("writes to the same item the generation counter lives on", async () => {
    const table = new FakeControlItem()
    await markReplayPending("u1", AT, d(table))
    expect(table.commands[0]!.input.Key).toEqual(generationKey("u1"))
  })

  it("keeps users independent", async () => {
    const table = new FakeControlItem()
    await markReplayPending("a", EARLIER, d(table))
    expect(await markReplayPending("b", LATER, d(table))).toBe(true)
    expect(table.items.get("U#a#GEN|GEN")).toBe(EARLIER)
  })

  it("rejects an unparseable timestamp before it reaches DynamoDB", async () => {
    const table = new FakeControlItem()
    await expect(markReplayPending("u1", "not-a-date", d(table))).rejects.toThrow(RangeError)
    expect(table.commands).toHaveLength(0)
  })

  it("propagates a real failure rather than reporting it as a refusal", async () => {
    const boom = {
      send: async () => {
        throw Object.assign(new Error("throughput"), { name: "ThrottlingException" })
      },
    }
    await expect(markReplayPending("u1", AT, { ddb: boom } as never)).rejects.toThrow("throughput")
  })
})
