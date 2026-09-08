import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { gridDisk, latLngToCell } from "h3-js"
import { describe, expect, it } from "vitest"

import { classifyCells } from "@/src/domain/discovery"
import { computeAgg } from "@/src/domain/explored-agg"
import { cellToBig, encodeExploredBlob, encodeLastRunBlob } from "@/src/domain/explored-blob"
import { RES } from "@/src/domain/fog"

import { lastRunDay, writeAggregates, writeCells } from "./explored-cells"
import { listTouchedParents, rebuildFromTable } from "./explored-rebuild"

/**
 * CRITERION 6 — AP-17 exists, produces an IDENTICAL blob to the incremental path for the
 * same data, and is not called by `process-activity`. `02-data-model.md` §2.10, §5.1, §5.6,
 * §8.3 step 7; ticket `0049`.
 *
 * ─── THE THIRD CLAIM IS NOT TESTED HERE, DELIBERATELY ───────────────────────
 *
 * *"is not called by `process-activity`"* is a statement about the import graph and the
 * IAM role, not about a function's behaviour, so it is enforced where those live:
 * `scripts/check-fog-hot-path.mjs` walks the worker's transitive imports and fails the
 * build on a path to this module, and `amplify/explored-cells-table.test.ts` asserts the
 * worker's role holds no `dynamodb:Query` on T6. A unit test asserting "I did not call
 * this" would pass forever and prove nothing.
 *
 * ─── THE FAKE IS DRIVEN BY THE SHIPPED WRITERS ──────────────────────────────
 *
 * Nothing here hand-builds a T6 item. The table is populated by calling `writeCells` and
 * `writeAggregates` — the same functions the ingest path calls — so a change to the key
 * convention, the aggregate shape or the conditional writes breaks this test rather than
 * quietly desynchronising the repair path from the thing it repairs.
 */
const ORIGIN = latLngToCell(-48.876, -123.393, RES)
const USER = "u-rebuild"

interface Item extends Record<string, unknown> {
  pk: string
  sk: string
}

/**
 * A T6 that EVALUATES the expressions it is given and refuses any it does not recognise.
 * The same shape as `explored-cells.test.ts`'s fake: an unrecognised expression is a
 * failure, so a new write path cannot slip past this suite by being untested.
 */
class FakeT6 {
  readonly items = new Map<string, Item>()
  readonly queries: QueryCommand[] = []

  send = async (command: UpdateCommand | QueryCommand): Promise<Record<string, unknown>> => {
    if (command instanceof QueryCommand) return this.query(command)
    return this.update(command)
  }

  private query(command: QueryCommand): Record<string, unknown> {
    this.queries.push(command)
    const pk = command.input.ExpressionAttributeValues?.[":pk"] as string
    expect(command.input.KeyConditionExpression).toBe("pk = :pk")
    const all = [...this.items.values()].filter((i) => i.pk === pk).sort((a, b) => (a.sk < b.sk ? -1 : 1))

    // Paginate at 100, so the rebuild's LastEvaluatedKey loop is actually exercised.
    const after = command.input.ExclusiveStartKey?.sk as string | undefined
    const start = after === undefined ? 0 : all.findIndex((i) => i.sk === after) + 1
    const page = all.slice(start, start + 100)
    const last = page[page.length - 1]
    return {
      Items: page,
      LastEvaluatedKey: start + page.length < all.length ? { pk, sk: last!.sk } : undefined,
    }
  }

  private update(command: UpdateCommand): Record<string, unknown> {
    const input = command.input
    const key = `${String(input.Key!.pk)}|${String(input.Key!.sk)}`
    const v = input.ExpressionAttributeValues ?? {}
    const item = this.items.get(key)

    const refuse = (): never => {
      const e = new Error("The conditional request failed")
      e.name = "ConditionalCheckFailedException"
      throw e
    }

    switch (input.UpdateExpression) {
      case "SET firstRunAt = if_not_exists(firstRunAt, :at), firstRunId = if_not_exists(firstRunId, :rid), lastRunAt = :at, lastRunId = :rid, lastRunDay = :day ADD visitCount :one, discoveryCount :credit": {
        if (!(item === undefined || (item.lastRunAt as string) < (v[":at"] as string))) refuse()
        const next: Item = {
          ...(item ?? { pk: String(input.Key!.pk), sk: String(input.Key!.sk) }),
          firstRunAt: item?.firstRunAt ?? v[":at"],
          firstRunId: item?.firstRunId ?? v[":rid"],
          lastRunAt: v[":at"],
          lastRunId: v[":rid"],
          lastRunDay: v[":day"],
          visitCount: ((item?.visitCount as number) ?? 0) + (v[":one"] as number),
          discoveryCount: ((item?.discoveryCount as number) ?? 0) + (v[":credit"] as number),
        }
        this.items.set(key, next)
        return {}
      }
      case "SET firstRunAt = :at, firstRunId = :rid ADD visitCount :one, discoveryCount :credit": {
        if (item === undefined || !((item.firstRunAt as string) > (v[":at"] as string))) refuse()
        this.items.set(key, {
          ...item!,
          firstRunAt: v[":at"],
          firstRunId: v[":rid"],
          visitCount: ((item!.visitCount as number) ?? 0) + (v[":one"] as number),
          discoveryCount: ((item!.discoveryCount as number) ?? 0) + (v[":credit"] as number),
        })
        return {}
      }
      case "SET totalChildren = :total ADD exploredChildren :added": {
        this.items.set(key, {
          ...(item ?? { pk: String(input.Key!.pk), sk: String(input.Key!.sk) }),
          totalChildren: v[":total"],
          exploredChildren: ((item?.exploredChildren as number) ?? 0) + (v[":added"] as number),
        })
        return {}
      }
      case "SET lastRunDay = :day": {
        if (!(item === undefined || (item.lastRunDay as number) < (v[":day"] as number))) refuse()
        this.items.set(key, {
          ...(item ?? { pk: String(input.Key!.pk), sk: String(input.Key!.sk) }),
          lastRunDay: v[":day"],
        })
        return {}
      }
      default:
        throw new Error(`FakeT6: unrecognised UpdateExpression ${input.UpdateExpression}`)
    }
  }
}

/** One activity's worth of the ingest path's T6 writes, cells then aggregates. */
async function ingest(table: FakeT6, cells: string[], startedAt: string): Promise<void> {
  const activity = { userId: USER, activityId: `a-${startedAt}`, startedAt }
  const classified = classifyCells(
    cells,
    new Map(
      [...table.items.values()]
        .filter((i) => i.pk.includes("#C#"))
        .map((i) => [i.sk, { lastRunAt: i.lastRunAt as string }]),
    ),
    startedAt,
  )
  await writeCells(classified, activity, { ddb: table as never, table: "T" })
  await writeAggregates(classified, activity, { ddb: table as never, table: "T" })
}

const sortBig = (cells: readonly string[]): bigint[] =>
  cells.map(cellToBig).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

describe("listTouchedParents — AP-16's index", () => {
  it("enumerates the res-6 parents from the AGG#6 partition, with no Scan", async () => {
    const table = new FakeT6()
    await ingest(table, gridDisk(ORIGIN, 4), "2026-01-01T08:00:00.000Z")

    const parents = await listTouchedParents(USER, { ddb: table as never, table: "T" })
    expect(parents.length).toBeGreaterThan(0)
    expect(parents.length).toBeLessThanOrEqual(2)
    for (const q of table.queries) {
      expect(q.input.KeyConditionExpression).toBe("pk = :pk")
      expect(q.input.ExpressionAttributeValues![":pk"]).toBe(`U#${USER}#AGG#6`)
    }
  })

  it("returns nothing for a user who has never run", async () => {
    const table = new FakeT6()
    expect(await listTouchedParents("nobody", { ddb: table as never, table: "T" })).toEqual([])
  })
})

describe("rebuildFromTable — AP-17", () => {
  /**
   * CRITERION 6's first half. The two paths never share a line of code: the incremental
   * one merges the previous blob's decoded array, this one re-derives everything from T6.
   * They must agree byte for byte at the same generation.
   */
  it("produces a byte-identical blob to the incremental path for the same data", async () => {
    const table = new FakeT6()
    const runs = [
      { cells: gridDisk(ORIGIN, 4), at: "2026-01-01T08:00:00.000Z" },
      { cells: gridDisk(latLngToCell(-48.9, -123.35, RES), 3), at: "2026-02-01T08:00:00.000Z" },
      { cells: gridDisk(ORIGIN, 2), at: "2026-03-01T08:00:00.000Z" },
    ]
    for (const r of runs) await ingest(table, r.cells, r.at)

    // What the incremental writer would hold after those three runs: the union, with each
    // cell carrying the day of the LAST run that touched it.
    const days = new Map<string, number>()
    for (const r of runs) for (const c of r.cells) days.set(c, lastRunDay(r.at))
    const incrementalCells = sortBig([...days.keys()])
    const incrementalDays = incrementalCells.map((b) => days.get(bigToCellLocal(b))!)

    const rebuilt = await rebuildFromTable(USER, { ddb: table as never, table: "T" })

    expect(rebuilt.cells).toEqual(incrementalCells)
    expect([...rebuilt.days]).toEqual(incrementalDays)
    expect(Buffer.from(encodeExploredBlob(rebuilt.cells, 9))).toEqual(
      Buffer.from(encodeExploredBlob(incrementalCells, 9)),
    )
    expect(Buffer.from(encodeLastRunBlob(rebuilt.days, 9))).toEqual(
      Buffer.from(encodeLastRunBlob(incrementalDays, 9)),
    )
    expect(computeAgg(rebuilt.cells, 9)).toEqual(computeAgg(incrementalCells, 9))
  })

  it("returns the two arrays index-parallel by construction", async () => {
    const table = new FakeT6()
    await ingest(table, gridDisk(ORIGIN, 3), "2026-01-01T08:00:00.000Z")
    await ingest(table, gridDisk(ORIGIN, 1), "2026-06-01T08:00:00.000Z")

    const { cells, days } = await rebuildFromTable(USER, { ddb: table as never, table: "T" })
    expect(days).toHaveLength(cells.length)
    const inner = new Set(gridDisk(ORIGIN, 1).map((c) => String(cellToBig(c))))
    for (let i = 0; i < cells.length; i++) {
      const expected = inner.has(String(cells[i]))
        ? lastRunDay("2026-06-01T08:00:00.000Z")
        : lastRunDay("2026-01-01T08:00:00.000Z")
      expect(days[i]).toBe(expected)
    }
  })

  it("pages through a partition larger than one Query response", async () => {
    const table = new FakeT6()
    // gridDisk(…, 8) is 217 cells — three pages at the fake's 100-item limit.
    await ingest(table, gridDisk(ORIGIN, 8), "2026-01-01T08:00:00.000Z")
    const { cells } = await rebuildFromTable(USER, { ddb: table as never, table: "T" })
    expect(cells).toHaveLength(217)
  })

  it("returns empty for a user with no cells, rather than throwing", async () => {
    const table = new FakeT6()
    expect(await rebuildFromTable("nobody", { ddb: table as never, table: "T" })).toEqual({
      cells: [],
      days: new Uint16Array(0),
    })
  })

  /**
   * The repair path is the one place that must not paper over a bad item: a cell with no
   * `lastRunDay` would publish a sidecar that is WRONG rather than one that is missing, and
   * the sidecar is served `immutable`.
   */
  it("throws on an item with no numeric lastRunDay rather than guessing zero", async () => {
    const table = new FakeT6()
    await ingest(table, gridDisk(ORIGIN, 1), "2026-01-01T08:00:00.000Z")
    for (const item of table.items.values()) {
      if (item.pk.includes("#C#")) delete item.lastRunDay
    }
    await expect(rebuildFromTable(USER, { ddb: table as never, table: "T" })).rejects.toThrow(
      /numeric lastRunDay/,
    )
  })

  it("sorts on the integer, and the result is strictly ascending", async () => {
    const table = new FakeT6()
    await ingest(table, gridDisk(ORIGIN, 5), "2026-01-01T08:00:00.000Z")
    const { cells } = await rebuildFromTable(USER, { ddb: table as never, table: "T" })
    for (let i = 1; i < cells.length; i++) expect(cells[i]! > cells[i - 1]!).toBe(true)
  })
})

/** Local, so this file does not import the encoder's helper purely for a lookup. */
function bigToCellLocal(value: bigint): string {
  return value.toString(16).padStart(15, "0")
}
