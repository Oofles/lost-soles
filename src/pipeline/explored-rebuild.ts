import { QueryCommand, type QueryCommandInput } from "@aws-sdk/lib-dynamodb"
import type { H3Index } from "h3-js"

import { AGG_RESOLUTIONS } from "@/src/domain/explored-agg"
import { cellToBig } from "@/src/domain/explored-blob"

import { EXPLORED_CELL_TABLE } from "./explored-cells"

/**
 * AP-17 — THE REPAIR PATH, AND ONLY THE REPAIR PATH. Ticket `0049`.
 * `02-data-model.md` §2.10, §5.1 (AP-16/AP-17), §8.3 step 7; `05-fog-of-war.md` §7.
 *
 * ─── READ §5.6 BEFORE CALLING ANYTHING IN THIS FILE ─────────────────────────
 *
 * *"The one thing that could break this is a full-table `Query` (AP-16) on the ingest hot
 * path. AP-16 is the repair path. **Calling it from `process-activity` is a review-blocking
 * bug.**"*
 *
 * ~1,000–3,000 RRU per invocation against the ~3–10 of AP-15's `BatchGetItem`. It works
 * and it costs $0.15/year if it ran on every run — the objection is not the money, it is
 * that a hot path built on a whole-partition scan stops being cheap the moment the map is
 * large, and the map only ever grows (D-020). §2.10's incremental path
 * (`explored-blob-store.ts`) is what ingest uses; this exists so that when the two ever
 * disagree, there is something to be right.
 *
 * Three callers, none of them ingest:
 *
 *   1. The rebuild drill (`02` §8.3 step 7, ticket `0105`) — regenerate the delivery layer
 *      from tables that were themselves rebuilt from `raw/`.
 *   2. A consistency check — does the published `cellCount` still match T6?
 *   3. Recovery from the one failure `regenerateExplored` refuses to paper over: a manifest
 *      naming a generation whose blob is gone.
 *
 * **This module is not imported by `process-activity.ts`, and `check-fog-hot-path.mjs`
 * fails the build if it ever is.** The worker's IAM role is the second half of that: it
 * holds no `dynamodb:Query` on T6, so even a mistaken import cannot execute.
 *
 * ─── WHY THIS NEEDS NO SCAN ─────────────────────────────────────────────────
 *
 * `02` T6: *"The `AGG#6` partition doubles as the index of which parents a user has
 * touched, which is what makes a full blob rebuild possible without a table scan."* That
 * is the entire job of item type B here — enumerate the res-6 parents, then `Query` each
 * one's cell partition. ~20–60 parents in a home metro after five years, ~100–200 including
 * travel, so it is a hundred-ish queries, not a scan of an eight-table account.
 */

export interface RebuildDeps {
  ddb: { send(command: QueryCommand): Promise<QueryOutput> }
  table?: string
}

interface QueryOutput {
  Items?: Record<string, unknown>[]
  LastEvaluatedKey?: Record<string, unknown>
}

/** One cell as T6 holds it, reduced to what the delivery layer ships. */
export interface RebuiltCell {
  cell: H3Index
  lastRunDay: number
}

/** Every page of one `Query`, concatenated. A res-6 partition caps at 2,401 items. */
async function queryAll(input: QueryCommandInput, deps: RebuildDeps): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = []
  let startKey: Record<string, unknown> | undefined
  do {
    const out = await deps.ddb.send(new QueryCommand({ ...input, ExclusiveStartKey: startKey }))
    items.push(...(out.Items ?? []))
    startKey = out.LastEvaluatedKey
  } while (startKey !== undefined)
  return items
}

/**
 * The res-6 parents this user has ever touched, from the `AGG#6` partition.
 *
 * `ProjectionExpression: "sk"` because the parent id is the sort key and nothing else on
 * the aggregate item is needed to enumerate — the counts on it are a cache this rebuild is
 * about to recompute from the cells themselves, and trusting them here would make the
 * rebuild unable to detect the one thing it is for.
 */
export async function listTouchedParents(userId: string, deps: RebuildDeps): Promise<H3Index[]> {
  const items = await queryAll(
    {
      TableName: deps.table ?? EXPLORED_CELL_TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": `U#${userId}#AGG#${AGG_RESOLUTIONS[0]}` },
      ProjectionExpression: "sk",
    },
    deps,
  )
  return items.map((i) => i.sk as H3Index)
}

/**
 * THE FULL REBUILD. Every cell this user has, sorted, with its `lastRunDay` alongside.
 *
 * Returns the two arrays the delivery layer needs, **index-parallel by construction** —
 * they are built from one sort of one list, so there is no step at which they could drift.
 * The caller encodes them (`encodeExploredBlob` / `encodeLastRunBlob`) at whatever
 * generation the situation calls for: the drill uses `raiseGenerationTo(step0 + 1)`, a
 * consistency check does not publish at all.
 *
 * **`ConsistentRead` is deliberately off.** A repair runs against a table nothing is
 * writing to (the drill's is brand new; a consistency check is run by hand), and a strongly
 * consistent read of 150,000 items doubles the RRU of the one operation whose cost is
 * already the reason it is not on the hot path.
 */
export async function rebuildFromTable(
  userId: string,
  deps: RebuildDeps,
): Promise<{ cells: bigint[]; days: Uint16Array }> {
  const table = deps.table ?? EXPLORED_CELL_TABLE
  const parents = await listTouchedParents(userId, deps)

  const rows: RebuiltCell[] = []
  for (const parent of parents) {
    const items = await queryAll(
      {
        TableName: table,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": `U#${userId}#C#${parent}` },
        ProjectionExpression: "sk, lastRunDay",
      },
      deps,
    )
    for (const item of items) {
      const cell = item.sk
      const day = item.lastRunDay
      if (typeof cell !== "string" || typeof day !== "number") {
        throw new Error(
          `rebuildFromTable: T6 item ${JSON.stringify(cell)} in partition ${parent} has no ` +
            "numeric lastRunDay. A repair that guessed here would publish a sidecar that " +
            "is wrong rather than one that is missing.",
        )
      }
      rows.push({ cell, lastRunDay: day })
    }
  }

  /**
   * Sorted on the INTEGER, not the string. Hex strings of equal length happen to sort the
   * same way, which is exactly why this is worth stating: the equality is a coincidence of
   * res 10 and res 6 both being 15 characters, and the blob's delta encoding is defined
   * over the numbers.
   */
  const sorted = rows
    .map((r) => ({ big: cellToBig(r.cell), day: r.lastRunDay }))
    .sort((a, b) => (a.big < b.big ? -1 : a.big > b.big ? 1 : 0))

  const cells: bigint[] = new Array<bigint>(sorted.length)
  const days = new Uint16Array(sorted.length)
  for (let i = 0; i < sorted.length; i++) {
    cells[i] = sorted[i]!.big
    days[i] = sorted[i]!.day
    if (i > 0 && cells[i] === cells[i - 1]) {
      throw new Error(
        `rebuildFromTable: cell ${sorted[i]!.big.toString(16)} appeared in two partitions. ` +
          "A res-10 cell has exactly one res-6 ancestor; two means the key convention was " +
          "written differently by two code paths.",
      )
    }
  }
  return { cells, days }
}
