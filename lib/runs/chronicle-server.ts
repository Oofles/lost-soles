import { QueryCommand } from "@aws-sdk/lib-dynamodb"

import table from "@/rules/chronicle.json"
import { assertChronicleTable, chronicleFacts, chronicleLine, type ChronicleChoice, type PriorRun } from "@/src/domain/chronicle"

import type { RunQueryDdb } from "./server"
import type { RunSummary } from "./wire"

/**
 * BEAT 4'S LINE, CHOSEN ON THE SERVER. Ticket `0083`.
 *
 * Here rather than in the browser for two reasons: the facts need the account's history (distances
 * and new-cell counts of every earlier activity), which is a `Query` the SSR role already holds on
 * `byUserAndStart`; and the table never has to ship to the page — the page receives one sentence.
 *
 * Validated once per container, at first use: a broken table is a thrown error on the first render,
 * never a silently blank line.
 */

let validated: ReturnType<typeof assertChronicleTable> | undefined
const TABLE = () => (validated ??= assertChronicleTable(table))

export interface HistoryDeps {
  ddb: RunQueryDdb
  activityTable: string
}

type Row = { id?: unknown; startedAt?: unknown; distanceM?: unknown; newCellCount?: unknown }

/**
 * Every activity at or before `startedAt`, three attributes each. Paged to the end: a lifetime total
 * that stopped at page one would cross the same threshold twice. At ~50 bytes a row, years of daily
 * activity is a handful of pages.
 */
export async function historyUpTo(userId: string, startedAt: string, deps: HistoryDeps): Promise<PriorRun[]> {
  const out: PriorRun[] = []
  let start: Record<string, unknown> | undefined
  do {
    const page = (await deps.ddb.send(
      new QueryCommand({
        TableName: deps.activityTable,
        IndexName: "byUserAndStart",
        KeyConditionExpression: "#u = :u AND #s <= :s",
        ExpressionAttributeNames: { "#u": "userId", "#s": "startedAt", "#id": "id", "#d": "distanceM", "#n": "newCellCount" },
        ExpressionAttributeValues: { ":u": userId, ":s": startedAt },
        ProjectionExpression: "#id, #s, #d, #n",
        ExclusiveStartKey: start,
      }),
    )) as { Items?: Row[]; LastEvaluatedKey?: Record<string, unknown> }
    for (const r of page.Items ?? []) {
      if (typeof r.id !== "string" || typeof r.startedAt !== "string") continue
      out.push({
        activityId: r.id,
        startedAt: r.startedAt,
        distanceM: typeof r.distanceM === "number" ? r.distanceM : null,
        newCellCount: typeof r.newCellCount === "number" ? r.newCellCount : 0,
      })
    }
    start = page.LastEvaluatedKey
  } while (start)
  return out
}

/** The run's line. `history` is `null` when the read failed: the line then rests on the run alone. */
export function chronicleFor(summary: RunSummary, history: readonly PriorRun[] | null): ChronicleChoice {
  const facts = chronicleFacts(
    {
      activityId: summary.activityId,
      startedAt: summary.startedAt,
      distanceM: summary.distanceM,
      newCellCount: summary.newCellCount,
      rearmedCellCount: summary.rearmedCellCount,
      cellCount: summary.cellCount,
      traced: summary.route.features.length > 0,
    },
    history,
  )
  return chronicleLine(facts, TABLE(), summary.activityId)
}
