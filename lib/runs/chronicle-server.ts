import { QueryCommand } from "@aws-sdk/lib-dynamodb"
import { cellToLatLng } from "h3-js"

import type { PlaceNames } from "@/lib/place-names"
import { frontierOrigin } from "@/lib/run-moment/frontier-line"
import table from "@/rules/chronicle.json"
import {
  assertChronicleTable,
  chronicleFacts,
  chronicleLine,
  daysBetween,
  returnedTo,
  type ChronicleChoice,
  type PriorRun,
  type ReturnedTo,
} from "@/src/domain/chronicle"
import { rearmsAt } from "@/src/domain/discovery"

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

/** The facts that need the map's names (`0256`, D-302). */
export interface RunNames {
  /** The town or neighbourhood at the run's first fix. */
  place: string | null
  returned: ReturnedTo | null
  /** Every re-armed cell's gap, named or not. */
  rearmGapsDays: number[]
  /** The nearby ground coming back into season soonest (`0262`): days from the run, and its street. */
  rearmSoon: { inDays: number; street: string | null } | null
}

/**
 * THE RUN'S NAMES, from its own stored facts and the basemap's labels. The re-armed cells and their
 * previous `lastRunAt` come off the classes object ingest wrote (`rearmedSince`); the names come
 * from `names`, which reads a pinned, immutable archive — so a Relive names the same street.
 * An object written before `0256` has no `rearmedSince`, and names no street rather than guess.
 */
export async function namesFor(summary: RunSummary, names: Pick<PlaceNames, "place" | "street">): Promise<RunNames> {
  const since = summary.reveal.rearmedSince ?? {}
  const rearmed = summary.reveal.rearmed.filter((c) => since[c] !== undefined)
  const origin = frontierOrigin(summary.route.features[0]?.geometry, null)
  const soon = summary.reveal.rearmSoon
  const streetOf = (c: string) => {
    const [lat, lng] = cellToLatLng(c)
    return names.street({ lat, lng })
  }
  const [place, streets, soonStreet] = await Promise.all([
    origin ? names.place(origin) : Promise.resolve(null),
    Promise.all(rearmed.map(streetOf)),
    soon ? streetOf(soon.cell) : Promise.resolve(null),
  ])
  const cells = rearmed.map((c, i) => ({ since: since[c], street: streets[i] }))
  return {
    place,
    returned: returnedTo(cells, summary.startedAt),
    rearmGapsDays: cells.map((c) => daysBetween(c.since, summary.startedAt)),
    // From the run's start to the day that ground re-arms — both stored, so a Relive reads the same.
    rearmSoon: soon ? { inDays: daysBetween(summary.startedAt, rearmsAt(soon.lastRunAt)), street: soonStreet } : null,
  }
}

/**
 * The run's line. `history` is `null` when the read failed: the line then rests on the run alone.
 * `names` is `null` when the lookup failed or timed out: rows that name a place wait, as before `0256`.
 */
export function chronicleFor(
  summary: RunSummary,
  history: readonly PriorRun[] | null,
  names: RunNames | null = null,
): ChronicleChoice {
  const facts = chronicleFacts(
    {
      activityId: summary.activityId,
      startedAt: summary.startedAt,
      distanceM: summary.distanceM,
      newCellCount: summary.newCellCount,
      rearmedCellCount: summary.rearmedCellCount,
      cellCount: summary.cellCount,
      traced: summary.route.features.length > 0,
      place: names?.place,
      returned: names?.returned,
      rearmGapsDays: names?.rearmGapsDays,
      rearmSoon: names?.rearmSoon,
    },
    history,
  )
  return chronicleLine(facts, TABLE(), summary.activityId)
}
