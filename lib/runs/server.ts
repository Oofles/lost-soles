import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb"

import outputs from "@/amplify_outputs.json"
import { getObject, defaultFogReadDeps, type FogReadDeps } from "@/lib/fog/server"
import { routeTraceKey } from "@/src/pipeline/route-trace-store"

import {
  EMPTY_COLLECTION,
  type RouteTraceGeometry,
  type RunFeatureCollection,
  type RunListItem,
  type RunSummary,
} from "./wire"

/**
 * WHERE `/api/runs/latest` GETS ITS ANSWER. Ticket `0195`. `02-data-model.md` §5.1 (S-7),
 * AP-3's index; `08-security-privacy.md` §5.3.
 *
 * Two reads and no computation: one `Query` against T3's `byUserAndStart` index for the
 * caller's most recent traced activity, then one `GetObject` for the geometry the ingest
 * worker stored under its `traceRef`.
 *
 * ─── THE `userId` CONTRACT, RESTATED HERE BECAUSE THIS MODULE CANNOT ENFORCE IT ─
 *
 * `lib/fog/server.ts` states it and it applies identically: `userId` is the partition key of
 * every read below, so a caller who could choose it could read another account's map. It comes
 * from `currentUserId()` — the `sub` re-derived from the verified session — and from nowhere
 * else. Never from the query string, the body or a header. The route enforces it; this module
 * is where a second caller finds out that it must.
 */

/**
 * T3's table name, from `amplify_outputs.json`, read structurally.
 *
 * The SSR compute has no CloudFormation output of its own and no environment variable a CDK
 * stack can set — the gap `lib/fog/server.ts` and `app/sync-action.ts` both document. A table
 * NAME is not a secret: possessing it grants nothing without the `dynamodb:Query` statement
 * `amplify/backend.ts` scopes to this one table.
 */
function activityTableName(): string {
  const custom = (outputs as { custom?: { activityTableName?: string } }).custom
  const name = custom?.activityTableName
  if (!name) {
    throw new Error(
      "amplify_outputs.json has no custom.activityTableName. It is written by " +
        "backend.addOutput in amplify/backend.ts (ticket 0195); a missing value means " +
        "this build predates that deploy.",
    )
  }
  return name
}

/** Module scope, so a warm SSR container reuses the connection rather than opening TLS per load. */
let cachedDdb: DynamoDBDocumentClient | undefined
const ddb = (): DynamoDBDocumentClient =>
  (cachedDdb ??= DynamoDBDocumentClient.from(new DynamoDBClient({})))

/**
 * The document-client surface this module uses, and nothing more — structural rather than
 * `DynamoDBDocumentClient` so a test passes a one-method stub. The same convention
 * `src/pipeline/ingest-receipt.ts` sets out and for the same reason.
 */
export interface RunQueryDdb {
  send(command: QueryCommand): Promise<{ Items?: Record<string, unknown>[] }>
}

export interface RunReadDeps extends FogReadDeps {
  ddb: RunQueryDdb
  activityTable: string
}

export const defaultRunReadDeps = (): RunReadDeps => ({
  ...defaultFogReadDeps(),
  ddb: ddb(),
  activityTable: activityTableName(),
})

/**
 * THE SERVED SHAPE LIVES IN `wire.ts` AS OF `0057`, not here.
 *
 * It gained a browser-side caller — `lib/runs/client.ts` — and this module imports the AWS SDK at
 * module scope, so a client component that reached for the type would drag DynamoDB and S3 signing
 * code into the page bundle. Re-exported so `0195`'s two importers (the route and this file's test)
 * keep working unchanged.
 */
export { EMPTY_COLLECTION } from "./wire"
export type { RunFeature, RunFeatureCollection, RunListItem, RunSummary } from "./wire"

/**
 * HOW FAR BACK THE QUERY WILL LOOK FOR A TRACED ACTIVITY.
 *
 * The index is ordered by `startedAt`, not by "has a trace", so the most recent traced activity
 * is not necessarily the most recent activity: a week of gym sessions logged after a Sunday run
 * sits in front of it. Paging until one is found would be unbounded — an account that has never
 * recorded a trace would walk its entire history on every map load to answer "nothing".
 *
 * Twenty rows is one `Query` of a few KB and covers a fortnight of daily logging. Beyond it the
 * answer is the empty collection, which is the same answer the map already draws for a new
 * account, and `0085`'s permanent trace layer is what replaces this heuristic with a real one.
 */
export const LATEST_SCAN_LIMIT = 20

/**
 * ONE ROW OF T3, AS DYNAMODB ACTUALLY HOLDS IT.
 *
 * **`id`, NOT `activityId`.** `persist.ts:148` writes `id: activity.activityId` — I-5's
 * deterministic id under the Amplify model's own primary key — so there is no `activityId`
 * attribute on the item at all. The first draft of this module read `activityId`, every unit
 * test passed against fixtures that invented it, and the live smoke test returned an empty
 * collection over a row that plainly had geometry. `server.test.ts` now builds its rows with the
 * shipped `activityItem`, so a fixture cannot describe a store that does not exist.
 */
type ActivityRow = {
  id?: string
  startedAt?: string
  traceRef?: string | null
  name?: string | null
}

/**
 * The caller's most recent activity that has geometry, as GeoJSON.
 *
 * ─── AN EMPTY COLLECTION IS A RESULT, NOT AN ERROR ──────────────────────────
 *
 * Three different situations produce one: a brand-new account, an account whose recent
 * activities are all untraced, and — the one that matters today — an account whose rows all
 * predate `0195` and therefore carry `traceRef: null`. None is a fault, all three are "there is
 * no line to draw", and the map's first-load state is exactly that. A 404 here would make the
 * renderer treat a new user as a broken backend.
 *
 * A row whose `traceRef` names an object that is not there is treated the same way and is the
 * one case that IS a fault: it means a `traces` phase failure landed a row anyway, which the
 * phase ordering is built to prevent. It reads as "no line" rather than throwing, because a map
 * that will not load is a worse answer than a map missing one line.
 */
export async function latestRun(
  userId: string,
  deps: RunReadDeps,
): Promise<RunFeatureCollection> {
  const out = await deps.ddb.send(
    new QueryCommand({
      TableName: deps.activityTable,
      IndexName: "byUserAndStart",
      KeyConditionExpression: "#u = :u",
      ExpressionAttributeNames: { "#u": "userId" },
      ExpressionAttributeValues: { ":u": userId },
      // Newest first. The whole query is this flag plus the limit.
      ScanIndexForward: false,
      Limit: LATEST_SCAN_LIMIT,
    }),
  )

  const rows = (out.Items ?? []) as ActivityRow[]
  const row = rows.find((r) => typeof r.traceRef === "string" && r.traceRef.length > 0)
  if (!row?.id || !row.startedAt) return EMPTY_COLLECTION

  /**
   * THE KEY IS REBUILT, NOT READ OFF THE ROW. `row.traceRef` holds the same string, and using
   * it would let a value written by some future code path — or a hand-edited row — choose which
   * object this account's session reads. `routeTraceKey(userId, row.id)` can only ever address
   * the caller's own prefix, which is the property `08` §5.3 is actually asking for.
   */
  const bytes = await getObject(routeTraceKey(userId, row.id), deps)
  if (bytes === undefined) return EMPTY_COLLECTION

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: JSON.parse(new TextDecoder().decode(bytes)) as RouteTraceGeometry,
        properties: {
          activityId: row.id,
          startedAt: row.startedAt,
          name: row.name ?? null,
        },
      },
    ],
  }
}

/** T3's columns `runById` and `recentRuns` read. Optional throughout: rows predate columns. */
type FullActivityRow = ActivityRow & {
  userId?: string
  startedAtLocal?: string
  kind?: string
  distanceM?: number | null
  elapsedS?: number
  movingS?: number | null
  source?: { source?: string } | null
  newCellCount?: number | null
  rearmedCellCount?: number | null
}

/**
 * ONE RUN, IF AND ONLY IF IT IS THE CALLER'S. Ticket `0078`, criterion 1.
 *
 * `null` means "render a 404", and it is the same `null` for an id that does not exist and an id
 * that belongs to someone else — the page must not tell the two apart, or it is an oracle for
 * which activity ids exist.
 *
 * A `Query` on the BASE table by `id`, not a `GetItem`: the SSR compute role holds `dynamodb:Query`
 * on T3 and nothing else (`amplify/backend.ts`, `QueryActivityForLatestRun`), and this needs no
 * new grant. The ownership check is in code because the key is the activity id, not the user —
 * `userId` on the row is compared with the session's `sub`, which is the only identity this module
 * is ever handed (`08` §5.3).
 *
 * The geometry is read through the same rebuilt key as `latestRun`, never off `traceRef`.
 */
export async function runById(
  userId: string,
  activityId: string,
  deps: RunReadDeps,
): Promise<RunSummary | null> {
  const out = await deps.ddb.send(
    new QueryCommand({
      TableName: deps.activityTable,
      KeyConditionExpression: "#id = :id",
      ExpressionAttributeNames: { "#id": "id" },
      ExpressionAttributeValues: { ":id": activityId },
      Limit: 1,
    }),
  )
  const row = (out.Items ?? [])[0] as FullActivityRow | undefined
  if (!row?.id || row.userId !== userId || !row.startedAt) return null

  let route: RunFeatureCollection = EMPTY_COLLECTION
  if (typeof row.traceRef === "string" && row.traceRef.length > 0) {
    const bytes = await getObject(routeTraceKey(userId, row.id), deps)
    if (bytes !== undefined) {
      route = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: JSON.parse(new TextDecoder().decode(bytes)) as RouteTraceGeometry,
            properties: { activityId: row.id, startedAt: row.startedAt, name: row.name ?? null },
          },
        ],
      }
    }
  }

  return {
    activityId: row.id,
    startedAt: row.startedAt,
    startedAtLocal: row.startedAtLocal ?? row.startedAt,
    name: row.name ?? null,
    kind: row.kind ?? "other",
    distanceM: row.distanceM ?? null,
    elapsedS: row.elapsedS ?? 0,
    movingS: row.movingS ?? null,
    source: row.source?.source ?? "unknown",
    newCellCount: row.newCellCount ?? 0,
    rearmedCellCount: row.rearmedCellCount ?? 0,
    route,
  }
}

/** How many runs the Chronicle link list shows. `0088` owns paging and the real sheet. */
export const RECENT_RUNS_LIMIT = 50

/** The caller's newest activities, newest first — the Chronicle's links to `/run/:id`. */
export async function recentRuns(userId: string, deps: RunReadDeps): Promise<RunListItem[]> {
  const out = await deps.ddb.send(
    new QueryCommand({
      TableName: deps.activityTable,
      IndexName: "byUserAndStart",
      KeyConditionExpression: "#u = :u",
      ExpressionAttributeNames: { "#u": "userId" },
      ExpressionAttributeValues: { ":u": userId },
      ScanIndexForward: false,
      Limit: RECENT_RUNS_LIMIT,
    }),
  )
  return ((out.Items ?? []) as FullActivityRow[])
    .filter((r): r is FullActivityRow & { id: string } => typeof r.id === "string")
    .map((r) => ({
      activityId: r.id,
      startedAtLocal: r.startedAtLocal ?? r.startedAt ?? "",
      name: r.name ?? null,
      kind: r.kind ?? "other",
      distanceM: r.distanceM ?? null,
    }))
}
