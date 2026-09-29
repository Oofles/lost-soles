import { BatchGetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import type { H3Index } from "h3-js"

import type { FoldedCell } from "@/src/domain/fold"

import { cellKey, EXPLORED_CELL_TABLE, lastRunDay, writeAggregates } from "./explored-cells"

/**
 * THE XP REPLAY'S T6 REBUILD. Ticket `0066`. `02-data-model.md` §4.4 step 4, §2.9; D-020, I-7.
 *
 * Writes a fold's reconstruction of `ExploredCell` back over the table **without lowering
 * anything**: `firstRunAt` by `min`, `lastRunAt` by `max`, `visitCount` and
 * `discoveryCount` by `max`. A cell the table does not hold at all is created, with its
 * aggregate items. Nothing here can remove or un-reveal a cell — this file imports no delete, and
 * `check-fog-hot-path.mjs` fails the build if a file that knows T6 ever does.
 *
 * Separate from `xp-replay-store.ts` for exactly that reason: the ledger half of the replay
 * DELETES (step 2), and the I-7 gate is per file.
 *
 * Not the ingest path: this reads every cell of the user's history, which is AP-16's cost, and
 * belongs with the repair and replay tools that are allowed to pay it (`explored-rebuild.ts`).
 */

type Item = Record<string, unknown>

const BATCH_GET = 100

export interface MergeDeps {
  ddb: { send(command: unknown): Promise<unknown> }
  table?: string
  concurrency?: number
}

async function pool<T>(items: readonly T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(n, queue.length) }, async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) await fn(next)
    }),
  )
}

/** The merged T6 attributes, or `undefined` when the stored row already says the same. */
export function mergeFolded(prev: Item | undefined, f: FoldedCell): FoldedCell | undefined {
  if (prev === undefined) return f
  const p = {
    firstRunAt: String(prev.firstRunAt ?? f.firstRunAt),
    firstRunId: String(prev.firstRunId ?? f.firstRunId),
    lastRunAt: String(prev.lastRunAt),
    lastRunId: String(prev.lastRunId ?? f.lastRunId),
    visitCount: Number(prev.visitCount ?? 0),
    discoveryCount: Number(prev.discoveryCount ?? 0),
  }
  const earlier = f.firstRunAt < p.firstRunAt
  const later = f.lastRunAt > p.lastRunAt
  const next: FoldedCell = {
    firstRunAt: earlier ? f.firstRunAt : p.firstRunAt,
    firstRunId: earlier ? f.firstRunId : p.firstRunId,
    lastRunAt: later ? f.lastRunAt : p.lastRunAt,
    lastRunId: later ? f.lastRunId : p.lastRunId,
    visitCount: Math.max(f.visitCount, p.visitCount),
    discoveryCount: Math.max(f.discoveryCount, p.discoveryCount),
  }
  const same =
    prev.firstRunAt !== undefined &&
    next.firstRunAt === p.firstRunAt &&
    next.lastRunAt === p.lastRunAt &&
    next.visitCount === p.visitCount &&
    next.discoveryCount === p.discoveryCount
  return same ? undefined : next
}

/**
 * Merge the folded cells into T6. Returns the cells T6 did not hold, and how many existing rows
 * the merge raised. A write that loses to a concurrent ingest is skipped, not retried: the ingest
 * already holds the newer truth, and D-020 is intact either way.
 */
export async function mergeFoldedCells(
  userId: string,
  cells: ReadonlyMap<H3Index, FoldedCell>,
  deps: MergeDeps,
): Promise<{ created: H3Index[]; updated: number }> {
  const cellTable = deps.table ?? EXPLORED_CELL_TABLE
  const concurrency = deps.concurrency ?? 8
  const send = (c: unknown) => deps.ddb.send(c)
  const all = [...cells.keys()]
  const stored = new Map<string, Item>()
  for (let i = 0; i < all.length; i += BATCH_GET) {
    let keys: Item[] = all.slice(i, i + BATCH_GET).map((c) => cellKey(userId, c))
    for (let attempt = 0; keys.length > 0; attempt++) {
      if (attempt > 6) throw new Error(`mergeCells: ${keys.length} cells still unread`)
      const out = (await send(
        new BatchGetCommand({
          RequestItems: {
            [cellTable]: { Keys: keys, ConsistentRead: true },
          },
        }),
      )) as {
        Responses?: Record<string, Item[]>
        UnprocessedKeys?: Record<string, { Keys?: Item[] }>
      }
      for (const it of out.Responses?.[cellTable] ?? []) stored.set(String(it.sk), it)
      keys = out.UnprocessedKeys?.[cellTable]?.Keys ?? []
    }
  }

  const created: H3Index[] = []
  let updated = 0
  await pool(all, concurrency, async (cell) => {
    const prev = stored.get(cellKey(userId, cell).sk)
    const next = mergeFolded(prev, cells.get(cell)!)
    if (next === undefined) return
    try {
      await send(
        new UpdateCommand({
          TableName: cellTable,
          Key: cellKey(userId, cell),
          UpdateExpression:
            "SET firstRunAt = :fa, firstRunId = :fi, lastRunAt = :la, lastRunId = :li, " +
            "lastRunDay = :day, visitCount = :v, discoveryCount = :d",
          // Optimistic: applies only over exactly what was read, so a run ingested mid-replay
          // is never overwritten. The loser is reported, not retried — the next replay or the
          // ingest itself already holds the newer truth, and D-020 is intact either way.
          ConditionExpression: prev === undefined ? "attribute_not_exists(lastRunAt)" : "lastRunAt = :seen",
          ExpressionAttributeValues: {
            ":fa": next.firstRunAt,
            ":fi": next.firstRunId,
            ":la": next.lastRunAt,
            ":li": next.lastRunId,
            ":day": lastRunDay(next.lastRunAt),
            ":v": next.visitCount,
            ":d": next.discoveryCount,
            ...(prev === undefined ? {} : { ":seen": prev.lastRunAt }),
          },
        }),
      )
    } catch (e) {
      if ((e as { name?: string })?.name === "ConditionalCheckFailedException") return
      throw e
    }
    if (prev === undefined) created.push(cell)
    else updated++
  })

  // T6 item type B for any cell the table did not hold (the AP-17 index of touched parents),
  // grouped by the run that last crossed it, which is what `writeAggregates` stamps.
  const byRun = new Map<string, H3Index[]>()
  for (const c of created) {
    const f = cells.get(c)!
    byRun.set(`${f.lastRunId}|${f.lastRunAt}`, [...(byRun.get(`${f.lastRunId}|${f.lastRunAt}`) ?? []), c])
  }
  for (const [key, group] of byRun) {
    const [activityId, startedAt] = key.split("|") as [string, string]
    await writeAggregates(
      group.map((cell) => ({ cell, discovery: "new" as const })),
      { userId, activityId, startedAt },
      { ddb: deps.ddb as never, table: cellTable },
    )
  }
  return { created, updated }
}
