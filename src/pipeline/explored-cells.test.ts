import { BatchGetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { cellToParent, gridDisk, latLngToCell } from "h3-js"
import { describe, expect, it } from "vitest"

import type { ClassifiedCell, Discovery } from "@/src/domain/discovery"
import { RES, RES_PARENT } from "@/src/domain/fog"

import {
  EXPLORED_CELL_TABLE,
  cellKey,
  readCells,
  cellUpdate,
  firstRunBackfill,
  lastRunDay,
  writeAggregates,
  writeCells,
  type CellWriteActivity,
} from "./explored-cells"
import { assertNoCellWrites } from "./persist"

/**
 * Ticket `0047`. `02-data-model.md` T6; I-7, I-8, I-9, I-10; D-120, D-020.
 *
 * ─── THE FAKE TABLE, AND WHY IT IS NOT A MOCK ───────────────────────────────
 *
 * The invariant this module carries is not "it calls `UpdateItem`" — it is that a 2024
 * backfill cannot stomp a 2026 `lastRunAt`. That property lives entirely in two
 * `ConditionExpression`s, so a mock that records commands and returns `{}` would assert
 * the shape of the thing and none of its meaning: it would pass just as happily on an
 * unconditional `SET`, which is the exact bug I-8 exists to forbid.
 *
 * So `fakeTable` below EVALUATES the conditions and applies the updates. It is a
 * transcription of DynamoDB's semantics for two specific expressions, and a transcription
 * can drift from the real service — which is why it refuses any expression it does not
 * recognise verbatim, rather than falling back to something permissive. Change the
 * expression in `explored-cells.ts` and every test here fails immediately, by design.
 *
 * The fidelity gap that remains — does the REAL service behave this way — is closed by a
 * live smoke test against the deployed table, recorded in the ticket's Operator
 * validation (D-181). A fake alone would not have been enough.
 *
 * GEOMETRY IS SYNTHETIC, near Point Nemo (`08-security-privacy.md` §7.2, D-199).
 */

const NEMO_CELL = latLngToCell(-48.876, -123.393, RES)
const NEMO_CELL_2 = latLngToCell(-48.8735, -123.393, RES)

const RUN_2026: CellWriteActivity = {
  userId: "u-1",
  activityId: "a-2026",
  startedAt: "2026-09-06T03:00:00.000Z",
}
const RUN_2024: CellWriteActivity = {
  userId: "u-1",
  activityId: "a-2024",
  startedAt: "2024-03-25T01:28:48.000Z",
}
const RUN_2025: CellWriteActivity = {
  userId: "u-1",
  activityId: "a-2025",
  startedAt: "2025-06-01T12:00:00.000Z",
}

const PRIMARY_EXPRESSION =
  "SET firstRunAt = if_not_exists(firstRunAt, :at), " +
  "firstRunId = if_not_exists(firstRunId, :rid), " +
  "lastRunAt = :at, lastRunId = :rid, lastRunDay = :day " +
  "ADD visitCount :one, discoveryCount :credit"

const BACKFILL_EXPRESSION =
  "SET firstRunAt = :at, firstRunId = :rid ADD visitCount :one, discoveryCount :credit"

/** `0049`, T6 item type B. */
const AGG_TOTAL_EXPRESSION = "SET totalChildren = :total ADD exploredChildren :added"
const AGG_DAY_EXPRESSION = "SET lastRunDay = :day"

type Item = Record<string, unknown>

function conditionalFailure(): Error {
  return Object.assign(new Error("The conditional request failed"), {
    name: "ConditionalCheckFailedException",
  })
}

/**
 * An in-memory T6 that applies exactly the two writes this module emits, and refuses
 * anything else. Returns the store so a test can read attributes back.
 */
function fakeTable(seed: Record<string, Item> = {}) {
  const store: Record<string, Item> = { ...seed }
  const sent: UpdateCommand["input"][] = []

  const ddb = {
    async send(command: UpdateCommand) {
      const input = command.input
      sent.push(input)

      const id = `${input.Key!.pk}|${input.Key!.sk}`
      const item = store[id]
      const v = input.ExpressionAttributeValues as Record<string, string | number>

      if (input.UpdateExpression === PRIMARY_EXPRESSION) {
        if (item && !(String(item.lastRunAt) < String(v[":at"]))) throw conditionalFailure()
        store[id] = {
          ...item,
          firstRunAt: item?.firstRunAt ?? v[":at"],
          firstRunId: item?.firstRunId ?? v[":rid"],
          lastRunAt: v[":at"],
          lastRunId: v[":rid"],
          lastRunDay: v[":day"],
          visitCount: (Number(item?.visitCount) || 0) + Number(v[":one"]),
          discoveryCount: (Number(item?.discoveryCount) || 0) + Number(v[":credit"]),
        }
        return {}
      }

      if (input.UpdateExpression === BACKFILL_EXPRESSION) {
        // `firstRunAt > :at` on a MISSING item is false in DynamoDB: an absent attribute
        // satisfies no comparison. Modelling that is the whole reason this branch exists.
        if (!item || !(String(item.firstRunAt) > String(v[":at"]))) throw conditionalFailure()
        store[id] = {
          ...item,
          firstRunAt: v[":at"],
          firstRunId: v[":rid"],
          visitCount: (Number(item.visitCount) || 0) + Number(v[":one"]),
          discoveryCount: (Number(item.discoveryCount) || 0) + Number(v[":credit"]),
        }
        return {}
      }

      // `0049`, T6 item type B. Two writes: an unconditional running total and a `max`.
      if (input.UpdateExpression === AGG_TOTAL_EXPRESSION) {
        store[id] = {
          ...item,
          totalChildren: v[":total"],
          exploredChildren: (Number(item?.exploredChildren) || 0) + Number(v[":added"]),
        }
        return {}
      }

      if (input.UpdateExpression === AGG_DAY_EXPRESSION) {
        if (item?.lastRunDay !== undefined && !(Number(item.lastRunDay) < Number(v[":day"]))) {
          throw conditionalFailure()
        }
        store[id] = { ...item, lastRunDay: v[":day"] }
        return {}
      }

      throw new Error(
        `the fake table does not recognise this expression, which means it changed:\n` +
          `  ${input.UpdateExpression}`,
      )
    },
  }

  return { ddb, store, sent, at: (cell: string) => store[`U#u-1#C#${cellToParent(cell, RES_PARENT)}|${cell}`] }
}

/**
 * `0048` made `writeCells` take CLASSIFIED cells, because `discoveryCount` is now the
 * classifier's answer rather than a hard zero. The default here is `"new"`: a cell being
 * written for the first time is new by definition, and a helper that defaulted to
 * `"cooled"` to keep `0047`'s assertions green would be asserting a placeholder.
 */
const write = (
  cells: string[],
  activity: CellWriteActivity,
  t: ReturnType<typeof fakeTable>,
  discovery: Discovery = "new",
) =>
  writeCells(
    cells.map((cell) => ({ cell, discovery })),
    activity,
    { ddb: t.ddb, sleep: async () => {} },
  )

describe("the key shape (T6)", () => {
  it("is `U#<uid>#C#<res6parent>` / `<res10cell>`", () => {
    const key = cellKey("u-1", NEMO_CELL)
    expect(key.pk).toBe(`U#u-1#C#${cellToParent(NEMO_CELL, 6)}`)
    expect(key.sk).toBe(NEMO_CELL)
  })

  it("groups by res 6, so one run's cells land in one or two partitions", () => {
    expect(cellKey("u-1", NEMO_CELL).pk).toBe(cellKey("u-1", NEMO_CELL_2).pk)
  })

  it("carries no source anywhere in the key (§7.4 — why the map cannot re-fog)", () => {
    const key = cellKey("u-1", NEMO_CELL)
    expect(`${key.pk}${key.sk}`).not.toMatch(/source|gpslogger|import/i)
  })

  /**
   * THE COUPLING THAT WOULD OTHERWISE ROT. `persist.ts`'s I-10 guard recognises a cell
   * write by this exact prefix, and it was written in 0041 against a key shape that did
   * not exist yet. Nothing but this test connects the two.
   */
  it("is recognised by persist.ts's assertNoCellWrites, so I-10 stays armed", () => {
    const item = {
      Update: {
        Key: cellKey("u-1", NEMO_CELL),
        TableName: "t",
        UpdateExpression: "SET lastRunAt = :at",
      },
    }
    expect(() => assertNoCellWrites([item])).toThrow(/I-10/)

    // ...and does NOT fire on the transaction's legitimate members, so the guard is a
    // discriminator rather than a blanket refusal.
    expect(() =>
      assertNoCellWrites([{ Put: { TableName: "t", Item: { id: "a-1", userId: "u-1" } } }]),
    ).not.toThrow()
  })
})

describe("lastRunDay", () => {
  it("counts days from 2020-01-01 in UTC", () => {
    expect(lastRunDay("2020-01-01T00:00:00.000Z")).toBe(0)
    expect(lastRunDay("2020-01-02T23:59:59.000Z")).toBe(1)
  })

  it("stays inside a u16 for the life of the format", () => {
    expect(lastRunDay("2026-09-06T03:00:00.000Z")).toBeLessThan(65_536)
    expect(lastRunDay("2100-01-01T00:00:00.000Z")).toBeLessThan(65_536)
  })

  it("is the day of the RUN, never of the import", () => {
    // Same instant, two ingest times: the encoding must not be able to tell them apart.
    expect(lastRunDay(RUN_2024.startedAt)).toBe(lastRunDay("2024-03-25T23:00:00.000Z"))
  })
})

describe("the write expressions (I-8, I-9)", () => {
  it("never issues a plain SET on lastRunAt — the condition is the min/max", () => {
    const input = cellUpdate(NEMO_CELL, RUN_2026, 1)
    expect(input.ConditionExpression).toBe("attribute_not_exists(lastRunAt) OR lastRunAt < :at")
    expect(input.UpdateExpression).toContain("if_not_exists(firstRunAt, :at)")
  })

  it("writes lastRunAt as an ISO-8601 string, never a flag (I-9)", () => {
    const v = cellUpdate(NEMO_CELL, RUN_2026, 1).ExpressionAttributeValues!
    expect(typeof v[":at"]).toBe("string")
    expect(v[":at"]).toBe("2026-09-06T03:00:00.000Z")
    expect(Number.isNaN(Date.parse(String(v[":at"])))).toBe(false)
  })

  it("times the cell from activity.startedAt, never from a clock", () => {
    // Two writes of the same activity, minutes apart in wall time, are identical bytes.
    expect(cellUpdate(NEMO_CELL, RUN_2024, 1)).toEqual(cellUpdate(NEMO_CELL, RUN_2024, 1))
    expect(cellUpdate(NEMO_CELL, RUN_2024, 1).ExpressionAttributeValues![":at"]).toBe(
      RUN_2024.startedAt,
    )
  })

  it("carries the classifier's credit, and only ever 0 or 1 (0048)", () => {
    expect(cellUpdate(NEMO_CELL, RUN_2026, 1).ExpressionAttributeValues![":credit"]).toBe(1)
    expect(cellUpdate(NEMO_CELL, RUN_2026, 0).ExpressionAttributeValues![":credit"]).toBe(0)
    expect(cellUpdate(NEMO_CELL, RUN_2026, 1).UpdateExpression).toContain(
      "discoveryCount :credit",
    )
    // The backfill path carries it too: a re-armed cell discovered by a backfill still
    // earned its credit, and the fallback is the only write that will apply.
    expect(firstRunBackfill(NEMO_CELL, RUN_2024, 1).ExpressionAttributeValues![":credit"]).toBe(1)
  })

  it("the fallback lowers firstRunAt and leaves the clock alone", () => {
    const input = firstRunBackfill(NEMO_CELL, RUN_2024, 1)
    expect(input.ConditionExpression).toBe("firstRunAt > :at")
    expect(input.UpdateExpression).not.toContain("lastRunAt")
    expect(input.UpdateExpression).not.toContain("lastRunDay")
  })

  it("defaults to the real table and lets a test override it", () => {
    expect(cellUpdate(NEMO_CELL, RUN_2026, 1).TableName).toBe(EXPLORED_CELL_TABLE)
    expect(cellUpdate(NEMO_CELL, RUN_2026, 1, "other").TableName).toBe("other")
  })
})

describe("writeCells — a first run", () => {
  it("writes both timestamps, both ids, the day and one visit", async () => {
    const t = fakeTable()
    const result = await write([NEMO_CELL], RUN_2026, t)

    expect(result).toEqual({ advanced: 1, backfilled: 0, unchanged: 0 })
    expect(t.at(NEMO_CELL)).toEqual({
      firstRunAt: RUN_2026.startedAt,
      firstRunId: "a-2026",
      lastRunAt: RUN_2026.startedAt,
      lastRunId: "a-2026",
      lastRunDay: lastRunDay(RUN_2026.startedAt),
      visitCount: 1,
      // 1, not 0: a first-ever write is a `new` cell and `discoveryCount` counts credit
      // awarded (§2.4). It was 0 under `0047`, which had no classifier to ask.
      discoveryCount: 1,
    })
  })

  it("issues one UpdateItem per cell and no second write", async () => {
    const t = fakeTable()
    await write([NEMO_CELL, NEMO_CELL_2], RUN_2026, t)
    expect(t.sent).toHaveLength(2)
  })
})

describe("writeCells — out-of-order arrival (I-8, criterion 4)", () => {
  it("a 2024 backfill after a 2026 run leaves firstRunAt 2024 and lastRunAt 2026", async () => {
    const t = fakeTable()
    await write([NEMO_CELL], RUN_2026, t)
    const result = await write([NEMO_CELL], RUN_2024, t)

    expect(result).toEqual({ advanced: 0, backfilled: 1, unchanged: 0 })
    const item = t.at(NEMO_CELL)
    expect(item.firstRunAt).toBe(RUN_2024.startedAt)
    expect(item.lastRunAt).toBe(RUN_2026.startedAt)
  })

  it("lastRunId follows lastRunAt and does not follow the backfill", async () => {
    const t = fakeTable()
    await write([NEMO_CELL], RUN_2026, t)
    await write([NEMO_CELL], RUN_2024, t)

    expect(t.at(NEMO_CELL).lastRunId).toBe("a-2026")
    expect(t.at(NEMO_CELL).firstRunId).toBe("a-2024")
  })

  it("lastRunDay does not move backwards either", async () => {
    const t = fakeTable()
    await write([NEMO_CELL], RUN_2026, t)
    await write([NEMO_CELL], RUN_2024, t)
    expect(t.at(NEMO_CELL).lastRunDay).toBe(lastRunDay(RUN_2026.startedAt))
  })

  it("in the ordinary order, the second run advances the clock and keeps firstRunAt", async () => {
    const t = fakeTable()
    await write([NEMO_CELL], RUN_2024, t)
    await write([NEMO_CELL], RUN_2026, t)

    expect(t.at(NEMO_CELL).firstRunAt).toBe(RUN_2024.startedAt)
    expect(t.at(NEMO_CELL).firstRunId).toBe("a-2024")
    expect(t.at(NEMO_CELL).lastRunAt).toBe(RUN_2026.startedAt)
    expect(t.at(NEMO_CELL).visitCount).toBe(2)
  })

  /**
   * T6's design, stated as a test so it cannot be discovered as a surprise. An activity
   * landing strictly between the two timestamps satisfies neither condition. `visitCount`
   * is documented as "most-run ground; a future heat view", both timestamps are already
   * correct, and 05 §3.4 enqueues out-of-order activities for a replay that recomputes
   * every attribute from the fold. See `firstRunBackfill`'s comment.
   */
  it("a middle arrival writes nothing, which is T6's design and not a defect here", async () => {
    const t = fakeTable()
    await write([NEMO_CELL], RUN_2024, t)
    await write([NEMO_CELL], RUN_2026, t)
    const result = await write([NEMO_CELL], RUN_2025, t)

    expect(result).toEqual({ advanced: 0, backfilled: 0, unchanged: 1 })
    expect(t.at(NEMO_CELL).firstRunAt).toBe(RUN_2024.startedAt)
    expect(t.at(NEMO_CELL).lastRunAt).toBe(RUN_2026.startedAt)
    expect(t.at(NEMO_CELL).visitCount).toBe(2)
  })
})

describe("writeCells — visitCount is per ACTIVITY (criterion 6)", () => {
  it("an out-and-back over one cell gives +1, because the input is a Set", async () => {
    const t = fakeTable()
    // What `traceToCells` returns for a there-and-back: the cell appears once.
    await write([...new Set([NEMO_CELL, NEMO_CELL, NEMO_CELL])], RUN_2026, t)
    expect(t.at(NEMO_CELL).visitCount).toBe(1)
  })

  it("two different activities over the same cell give +2", async () => {
    const t = fakeTable()
    await write([NEMO_CELL], RUN_2024, t)
    await write([NEMO_CELL], RUN_2026, t)
    expect(t.at(NEMO_CELL).visitCount).toBe(2)
  })
})

describe("writeCells — idempotency (criterion 9)", () => {
  it("re-running the same activity changes zero attributes", async () => {
    const t = fakeTable()
    await write([NEMO_CELL, NEMO_CELL_2], RUN_2026, t)
    const before = structuredClone(t.store)

    const result = await write([NEMO_CELL, NEMO_CELL_2], RUN_2026, t)

    expect(result).toEqual({ advanced: 0, backfilled: 0, unchanged: 2 })
    expect(t.store).toEqual(before)
  })

  it("re-running a BACKFILL changes zero attributes either", async () => {
    const t = fakeTable()
    await write([NEMO_CELL], RUN_2026, t)
    await write([NEMO_CELL], RUN_2024, t)
    const before = structuredClone(t.store)

    await write([NEMO_CELL], RUN_2024, t)
    expect(t.store).toEqual(before)
  })

  it("a redelivery of a run touching new AND known cells writes only the new ones", async () => {
    const t = fakeTable()
    await write([NEMO_CELL], RUN_2026, t)
    const result = await write([NEMO_CELL, NEMO_CELL_2], RUN_2026, t)
    expect(result).toEqual({ advanced: 1, backfilled: 0, unchanged: 1 })
  })
})

describe("writeCells — throughput and failure", () => {
  it("130 cells complete in one call (criterion 8, amended)", async () => {
    const t = fakeTable()
    // 130 distinct res-10 cells along a line, which is the top of the roadmap's band.
    const cells = Array.from({ length: 130 }, (_, i) =>
      latLngToCell(-48.876 + i * 0.0012, -123.393, RES),
    )
    const result = await write([...new Set(cells)], RUN_2026, t)

    expect(result.advanced).toBe(new Set(cells).size)
    expect(t.sent).toHaveLength(new Set(cells).size)
  })

  it("bounds concurrency, so a long run cannot open 130 sockets at once", async () => {
    let live = 0
    let peak = 0
    const ddb = {
      async send() {
        live++
        peak = Math.max(peak, live)
        await new Promise((r) => setTimeout(r, 0))
        live--
        return {}
      },
    }
    const cells = Array.from({ length: 40 }, (_, i) =>
      latLngToCell(-48.876 + i * 0.0012, -123.393, RES),
    )
    await writeCells(
      cells.map((cell) => ({ cell, discovery: "new" as const })),
      RUN_2026,
      { ddb, concurrency: 4, sleep: async () => {} },
    )
    expect(peak).toBeLessThanOrEqual(4)
  })

  it("retries a throttle and gives up after the budget", async () => {
    let calls = 0
    const throttle = Object.assign(new Error("slow down"), { name: "ThrottlingException" })
    const ddb = {
      async send() {
        calls++
        if (calls <= 2) throw throttle
        return {}
      },
    }
    await writeCells([{ cell: NEMO_CELL, discovery: "new" }], RUN_2026, {
      ddb,
      sleep: async () => {},
    })
    expect(calls).toBe(3)

    const always = { async send(): Promise<never> { throw throttle } }
    await expect(
      writeCells([{ cell: NEMO_CELL, discovery: "new" }], RUN_2026, {
        ddb: always,
        maxRetries: 1,
        sleep: async () => {},
      }),
    ).rejects.toThrow("slow down")
  })

  it("a non-throttle error propagates rather than being swallowed", async () => {
    const ddb = { async send(): Promise<never> { throw new Error("table is gone") } }
    await expect(
      writeCells([{ cell: NEMO_CELL, discovery: "new" }], RUN_2026, { ddb, sleep: async () => {} }),
    ).rejects.toThrow("table is gone")
  })

  it("an empty cell set is a no-op, not an error — 05 §3.6's traceless case", async () => {
    const t = fakeTable()
    expect(await write([], RUN_2026, t)).toEqual({ advanced: 0, backfilled: 0, unchanged: 0 })
    expect(t.sent).toHaveLength(0)
  })
})

describe("no delete exists in this module (I-7)", () => {
  it("every command it can emit is an UpdateCommand", async () => {
    const t = fakeTable()
    await write([NEMO_CELL], RUN_2026, t)
    await write([NEMO_CELL], RUN_2024, t)
    // The fake refuses any expression it does not know, so reaching here at all means
    // only the two documented updates were sent. This asserts the absence explicitly.
    for (const input of t.sent) {
      expect(input.UpdateExpression).toBeDefined()
      expect(JSON.stringify(input)).not.toMatch(/DeleteItem|REMOVE /)
    }
  })
})

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * TICKET `0048` — the read (AP-15) and the discovery credit it decides.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** A BatchGetItem fake that serves `known` and can withhold keys as `UnprocessedKeys`. */
function fakeBatchGet(known: Record<string, string>, withhold: string[][] = []) {
  const calls: Array<{ keys: string[]; consistent: boolean }> = []
  const rounds = [...withhold]
  const ddb = {
    async send(command: BatchGetCommand) {
      const request = command.input.RequestItems![EXPLORED_CELL_TABLE]!
      const keys = (request.Keys ?? []) as Array<{ pk: string; sk: string }>
      calls.push({ keys: keys.map((k) => k.sk), consistent: request.ConsistentRead === true })

      const hold = new Set(rounds.shift() ?? [])
      const served = keys.filter((k) => !hold.has(k.sk))
      const held = keys.filter((k) => hold.has(k.sk))

      return {
        Responses: {
          [EXPLORED_CELL_TABLE]: served
            .filter((k) => known[k.sk])
            .map((k) => ({ pk: k.pk, sk: k.sk, lastRunAt: known[k.sk], visitCount: 1 })),
        },
        ...(held.length
          ? { UnprocessedKeys: { [EXPLORED_CELL_TABLE]: { Keys: held } } }
          : {}),
      }
    },
  }
  return { ddb, calls }
}

const read = (cells: string[], f: ReturnType<typeof fakeBatchGet>) =>
  readCells(cells, "u-1", { ddb: f.ddb, sleep: async () => {} })

describe("readCells — AP-15, the pre-run state", () => {
  it("returns a record for a known cell and nothing for an unknown one", async () => {
    const f = fakeBatchGet({ [NEMO_CELL]: RUN_2024.startedAt })
    const found = await read([NEMO_CELL, NEMO_CELL_2], f)

    expect(found.get(NEMO_CELL)).toEqual({ lastRunAt: RUN_2024.startedAt })
    expect(found.has(NEMO_CELL_2)).toBe(false)
  })

  it("asks by the T6 key, so it reads the run's cells and not the whole partition", async () => {
    const f = fakeBatchGet({})
    await read([NEMO_CELL, NEMO_CELL_2], f)
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0].keys.sort()).toEqual([NEMO_CELL, NEMO_CELL_2].sort())
  })

  /**
   * The one read in this system that needs it. Two runs the same morning: the second must
   * see the cells the first wrote, or it classifies them `new` and awards full credit for
   * ground already revealed — permanently (D-020).
   */
  it("reads CONSISTENTLY", async () => {
    const f = fakeBatchGet({})
    await read([NEMO_CELL], f)
    expect(f.calls[0].consistent).toBe(true)
  })

  it("chunks at DynamoDB's 100-key limit", async () => {
    // Spaced widely enough to be 230 DISTINCT cells. The first draft stepped by 0.0012°
    // and produced 223 — two adjacent steps can land in one res-10 cell — which the
    // dedupe test below then contradicted. Asserted rather than assumed.
    const cells = Array.from({ length: 230 }, (_, i) =>
      latLngToCell(-48.876 + i * 0.01, -123.393, RES),
    )
    expect(new Set(cells).size).toBe(230)

    const f = fakeBatchGet({})
    await read(cells, f)
    expect(f.calls.map((c) => c.keys.length)).toEqual([100, 100, 30])
  })

  it("an empty cell set issues no call at all", async () => {
    const f = fakeBatchGet({})
    expect((await read([], f)).size).toBe(0)
    expect(f.calls).toHaveLength(0)
  })

  /**
   * `BatchGetItem` returns a 200 with `UnprocessedKeys` when it declines part of the
   * request. Treating a short read as complete is the dangerous failure, not a slow one: a
   * missing record classifies its cell `new` and awards credit for known ground, forever.
   */
  it("retries UnprocessedKeys rather than treating a short read as complete", async () => {
    const f = fakeBatchGet({ [NEMO_CELL_2]: RUN_2024.startedAt }, [[NEMO_CELL_2]])
    const found = await read([NEMO_CELL, NEMO_CELL_2], f)

    expect(f.calls).toHaveLength(2)
    expect(f.calls[1].keys).toEqual([NEMO_CELL_2])
    expect(found.get(NEMO_CELL_2)).toEqual({ lastRunAt: RUN_2024.startedAt })
  })

  it("throws once the retries are exhausted, rather than under-reporting", async () => {
    const f = fakeBatchGet({ [NEMO_CELL]: RUN_2024.startedAt }, Array(6).fill([NEMO_CELL]))
    await expect(
      readCells([NEMO_CELL], "u-1", { ddb: f.ddb, maxRetries: 2, sleep: async () => {} }),
    ).rejects.toThrow(/still unread/)
  })

  it("refuses an item with no lastRunAt rather than reading it as never-seen (I-9)", async () => {
    const ddb = {
      async send() {
        return { Responses: { [EXPLORED_CELL_TABLE]: [{ sk: NEMO_CELL, visitCount: 1 }] } }
      },
    }
    await expect(
      readCells([NEMO_CELL], "u-1", { ddb, sleep: async () => {} }),
    ).rejects.toThrow(/lastRunAt/)
  })
})

describe("writeCells — the discovery credit (0048, §2.4)", () => {
  it("a new cell increments discoveryCount", async () => {
    const t = fakeTable()
    await write([NEMO_CELL], RUN_2026, t, "new")
    expect(t.at(NEMO_CELL).discoveryCount).toBe(1)
  })

  it("a re-armed cell increments it again — that is what re-arming means", async () => {
    const t = fakeTable()
    await write([NEMO_CELL], RUN_2024, t, "new")
    await write([NEMO_CELL], RUN_2026, t, "rearmed")

    expect(t.at(NEMO_CELL).discoveryCount).toBe(2)
    expect(t.at(NEMO_CELL).visitCount).toBe(2)
  })

  it("a COOLED cell increments visitCount and nothing else", async () => {
    const t = fakeTable()
    await write([NEMO_CELL], RUN_2024, t, "new")
    await write([NEMO_CELL], RUN_2026, t, "cooled")

    expect(t.at(NEMO_CELL).visitCount).toBe(2)
    expect(t.at(NEMO_CELL).discoveryCount).toBe(1)
  })

  it("separates 'ran here 40 times' from 're-armed twice'", async () => {
    const t = fakeTable()
    // One discovery, then four cooled re-runs, then one re-arm.
    await write([NEMO_CELL], { ...RUN_2024, activityId: "a-0" }, t, "new")
    for (let i = 1; i <= 4; i++) {
      const at = new Date(Date.parse(RUN_2024.startedAt) + i * 86_400_000).toISOString()
      await write([NEMO_CELL], { ...RUN_2024, activityId: `a-${i}`, startedAt: at }, t, "cooled")
    }
    await write([NEMO_CELL], RUN_2026, t, "rearmed")

    expect(t.at(NEMO_CELL).visitCount).toBe(6)
    expect(t.at(NEMO_CELL).discoveryCount).toBe(2)
  })
})

describe("readCells — duplicate keys (found by the live smoke test)", () => {
  /**
   * `BatchGetItem` answers a repeated key with a 400, *"Provided list of item keys contains
   * duplicates"* — not a partial result. The production caller hands it a `Set` and cannot
   * trip it; a caller with an array is one `concat` away from failing an ingest with a
   * validation error that never mentions cells.
   *
   * This escaped the unit tests because the fake is `Map`-backed and a `Map` absorbs
   * duplicates without complaint. Only the real service objected.
   */
  it("deduplicates before asking, because DynamoDB 400s on a repeated key", async () => {
    const f = fakeBatchGet({ [NEMO_CELL]: RUN_2024.startedAt })
    const found = await read([NEMO_CELL, NEMO_CELL_2, NEMO_CELL], f)

    expect(f.calls[0].keys).toEqual([NEMO_CELL, NEMO_CELL_2])
    expect(found.get(NEMO_CELL)).toEqual({ lastRunAt: RUN_2024.startedAt })
  })

  it("still chunks by DISTINCT keys, so a duplicate cannot push a batch over 100", async () => {
    const cells = Array.from({ length: 60 }, (_, i) =>
      latLngToCell(-48.876 + i * 0.0012, -123.393, RES),
    )
    const f = fakeBatchGet({})
    await read([...cells, ...cells], f)
    expect(f.calls.map((c) => c.keys.length)).toEqual([new Set(cells).size])
  })
})

describe("writeAggregates — T6 item type B (0049)", () => {
  const cells = gridDisk(NEMO_CELL, 3)
  const classified = (discovery: "new" | "cooled" = "new") =>
    cells.map((cell) => ({ cell, discovery }) as ClassifiedCell)

  it("writes one item per parent at each of res 6, 7 and 8", async () => {
    const table = fakeTable()
    const result = await writeAggregates(classified(), RUN_2026, { ddb: table.ddb })

    const partitions = new Set(Object.keys(table.store).map((k) => k.split("|")[0]!))
    for (const res of [6, 7, 8]) {
      expect(partitions.has(`U#${RUN_2026.userId}#AGG#${res}`), `res ${res}`).toBe(true)
    }
    expect(result.parents).toBeGreaterThanOrEqual(3)
  })

  it("stores 7^(10-res) as the denominator, not a count", async () => {
    const table = fakeTable()
    await writeAggregates(classified(), RUN_2026, { ddb: table.ddb })
    for (const [id, item] of Object.entries(table.store)) {
      if (id.includes("#AGG#6")) expect(item.totalChildren).toBe(2401)
      if (id.includes("#AGG#7")) expect(item.totalChildren).toBe(343)
      if (id.includes("#AGG#8")) expect(item.totalChildren).toBe(49)
    }
  })

  it("counts only the cells the classifier called new", async () => {
    const table = fakeTable()
    await writeAggregates(classified("cooled"), RUN_2026, { ddb: table.ddb })
    for (const [id, item] of Object.entries(table.store)) {
      if (id.includes("#AGG#")) expect(item.exploredChildren).toBe(0)
    }
  })

  it("sums to the number of new cells at every level", async () => {
    const table = fakeTable()
    await writeAggregates(classified(), RUN_2026, { ddb: table.ddb })
    for (const res of [6, 7, 8]) {
      const summed = Object.entries(table.store)
        .filter(([id]) => id.includes(`#AGG#${res}`))
        .reduce((n, [, item]) => n + Number(item.exploredChildren), 0)
      expect(summed, `res ${res}`).toBe(cells.length)
    }
  })

  /**
   * THE SUBTLE ONE. `ADD exploredChildren` is unconditional, which is normally how a
   * counter doubles on an SQS redelivery. It is safe because of where the number comes
   * from: `discovery` is the classifier's verdict from THIS delivery's read of T6, and a
   * redelivery re-reads a table that now holds the cells and classifies them cooled.
   *
   * So the redelivery is simulated the way it actually happens — by classifying again —
   * rather than by calling this function twice with the same argument, which would prove
   * the opposite of what the system does.
   */
  it("does not double-count on a redelivery, because the classifier answers differently", async () => {
    const table = fakeTable()
    await writeAggregates(classified("new"), RUN_2026, { ddb: table.ddb })
    const afterFirst = { ...table.store }

    // The redelivery: every cell is now in T6, so the classifier returns cooled.
    await writeAggregates(classified("cooled"), RUN_2026, { ddb: table.ddb })

    for (const [id, item] of Object.entries(table.store)) {
      if (id.includes("#AGG#")) {
        expect(item.exploredChildren, id).toBe(afterFirst[id]!.exploredChildren)
      }
    }
  })

  /** The `max`, for the reason I-8 gives about `lastRunAt`: a backfill must not lower it. */
  it("takes a max on lastRunDay, so a backfill cannot drag a parent backwards", async () => {
    const table = fakeTable()
    await writeAggregates(classified(), RUN_2026, { ddb: table.ddb })
    const fresh = Object.entries(table.store).find(([id]) => id.includes("#AGG#6"))!
    const day = fresh[1].lastRunDay

    const backfill = { ...RUN_2026, startedAt: "2024-01-01T00:00:00.000Z" }
    const result = await writeAggregates(classified("cooled"), backfill, { ddb: table.ddb })

    expect(table.store[fresh[0]]!.lastRunDay).toBe(day)
    expect(result.advanced).toBe(0)
  })

  it("still writes the parent for a run entirely over known ground — AP-17 must find it", async () => {
    // Without this, a res-6 partition the user only ever re-runs would be invisible to
    // `listTouchedParents`, and the repair path would silently rebuild an incomplete map.
    const table = fakeTable()
    await writeAggregates(classified("cooled"), RUN_2026, { ddb: table.ddb })
    expect(Object.keys(table.store).some((k) => k.includes("#AGG#6"))).toBe(true)
  })

  it("is a handful of writes for one run, not one per cell", async () => {
    const table = fakeTable()
    await writeAggregates(classified(), RUN_2026, { ddb: table.ddb })
    // 3 levels x 1-2 parents x 2 writes each. Against 37 cells.
    expect(table.sent.length).toBeLessThan(20)
  })
})
