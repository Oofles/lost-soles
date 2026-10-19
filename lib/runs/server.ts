import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb"

import outputs from "@/amplify_outputs.json"
import { getObject, defaultFogReadDeps, type FogReadDeps } from "@/lib/fog/server"
import type { RunClasses } from "@/src/domain/discovery"
import { objectKeys, parseRunClasses } from "@/src/pipeline/explored-blob-store"
import { TOMBSTONED_STATUS } from "@/src/pipeline/persist"
import type { WebRunInput } from "@/lib/trace-web/web"
import { routeTraceKey } from "@/src/pipeline/route-trace-store"
import { traceWebKey, type TraceWeb } from "@/src/pipeline/trace-web-store"

import {
  CHRONICLE_PAGE_SIZE,
  EMPTY_COLLECTION,
  type ChroniclePage,
  type ChronicleSet,
  type RouteTraceGeometry,
  type RunFeatureCollection,
  type RunFacts,
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
export type { ChroniclePage, RunFeature, RunFeatureCollection, RunListItem, RunSummary } from "./wire"

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
  startedAtLocal?: string
  distanceM?: number | null
  newCellCount?: number | null
  /** `ACTIVE | TOMBSTONED` (`0282`, D-355). Absent on rows that predate the column: ACTIVE. */
  status?: string
}

/**
 * A SOURCE-SIDE DELETE LEAVES THE LISTS, AND ONLY THE LISTS. Ticket `0287`, `02` §4.7, D-355.
 *
 * `latestRun` and `chroniclePage` skip a `TOMBSTONED` row. Nothing else here does, on purpose: its
 * cells stay revealed (D-020) and its XP stays in the total (D-135), so the permanent web keeps its
 * line (`traceWebRuns`), `/run/:id` still answers for it (`runById`: a direct link is not a list),
 * and `historyUpTo` still counts it toward the lifetime facts the Chronicle's lines rest on, which
 * are the same lifetime the XP total is.
 */
export const isTombstoned = (row: { status?: unknown }): boolean => row.status === TOMBSTONED_STATUS

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
  // `0287`: a tombstoned run is not the last run, though its line stays in the permanent web.
  const row = rows.find((r) => !isTombstoned(r) && typeof r.traceRef === "string" && r.traceRef.length > 0)
  if (!row?.id || !row.startedAt) return EMPTY_COLLECTION

  /**
   * THE KEY IS REBUILT, NOT READ OFF THE ROW. `row.traceRef` holds the same string, and using
   * it would let a value written by some future code path — or a hand-edited row — choose which
   * object this account's session reads. `routeTraceKey(userId, row.id)` can only ever address
   * the caller's own prefix, which is the property `08` §5.3 is actually asking for.
   */
  /**
   * `0087`. THE RUN'S NEW CELLS, read beside the trace exactly as `runById` reads them (`0251`,
   * D-294), so home can hold an UNSEEN run's discoveries back: `/` shows territory as of before the
   * run, and the reveal belongs to `/run/:id` (`06` §2.4). One more GET on the same rebuilt key
   * discipline. An absent or unreadable object is "hide nothing" — never a reason to lose the line.
   */
  const classesKey = objectKeys.runClasses(userId, row.id)
  const [bytes, classes] = await Promise.all([
    getObject(routeTraceKey(userId, row.id), deps),
    Promise.resolve()
      .then(() => getObject(classesKey, deps))
      .catch(() => undefined),
  ])
  if (bytes === undefined) return EMPTY_COLLECTION
  let newCells: string[] | null = null
  try {
    if (classes !== undefined) newCells = parseRunClasses(classes, classesKey).new
  } catch {
    newCells = null
  }

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
          // `0086`: the plinth's last-run line. The index projects ALL, so these cost no extra read.
          startedAtLocal: typeof row.startedAtLocal === "string" ? row.startedAtLocal : null,
          distanceM: typeof row.distanceM === "number" ? row.distanceM : null,
          newCellCount: typeof row.newCellCount === "number" ? row.newCellCount : null,
          newCells,
        },
      },
    ],
  }
}

/** T3's columns `runById` and `chroniclePage` read. Optional throughout: rows predate columns. */
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
  cellCount?: number | null
  cooledCellCount?: number | null
  deferredCellCount?: number | null
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
  let reveal: RunClasses = { new: [], rearmed: [] }
  if (typeof row.traceRef === "string" && row.traceRef.length > 0) {
    /**
     * THE REVEAL SET (`0251`, D-294) — read beside the trace, under the same rebuilt-from-the-
     * session key discipline. Only for a traced row: an untraced activity has no cells, so no
     * object, and the GET would be a guaranteed 404. An absent object on a traced row is a run
     * never classified, and reads as "reveal nothing". The SSR role's `s3:GetObject` on
     * `users/*` (`ReadExploredDeliveryLayerForTheBrowser`) already reaches it.
     */
    const classesKey = objectKeys.runClasses(userId, row.id)
    const [bytes, classes] = await Promise.all([
      getObject(routeTraceKey(userId, row.id), deps),
      getObject(classesKey, deps),
    ])
    if (classes !== undefined) reveal = parseRunClasses(classes, classesKey)
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
    cellCount: row.cellCount ?? null,
    cooledCellCount: row.cooledCellCount ?? null,
    deferredCellCount: row.deferredCellCount ?? null,
    route,
    reveal,
  }
}

/**
 * `0101`. THE FACTS FOR A CLICK ON THE MAP — date, distance, new cells — for the runs it hit.
 * `06` §4.5's chip and card.
 *
 * One base-table `Query` per id, as `runById` reads one (the SSR role holds `dynamodb:Query` on T3
 * and nothing else), and the same ownership rule: a row that is not the caller's is LEFT OUT, the
 * same as an id that does not exist, so the answer cannot tell them apart. No S3 read: the facts
 * are columns. A tombstoned run is answered, because its line stays in the web (`isTombstoned`).
 *
 * The caller (`parseSummaryIds`) has already capped the count; this does not re-check it.
 */
export async function runFacts(userId: string, ids: readonly string[], deps: RunReadDeps): Promise<RunFacts[]> {
  const rows = await Promise.all(
    ids.map(async (id) => {
      const out = await deps.ddb.send(
        new QueryCommand({
          TableName: deps.activityTable,
          KeyConditionExpression: "#id = :id",
          ExpressionAttributeNames: { "#id": "id" },
          ExpressionAttributeValues: { ":id": id },
          Limit: 1,
        }),
      )
      return (out.Items ?? [])[0] as FullActivityRow | undefined
    }),
  )
  const facts: RunFacts[] = []
  for (const row of rows) {
    if (!row?.id || row.userId !== userId || !row.startedAt) continue
    facts.push({
      activityId: row.id,
      startedAt: row.startedAt,
      startedAtLocal: row.startedAtLocal ?? row.startedAt,
      distanceM: typeof row.distanceM === "number" ? row.distanceM : null,
      newCellCount: typeof row.newCellCount === "number" ? row.newCellCount : 0,
    })
  }
  return facts
}

/**
 * THE CHRONICLE'S PAGING CURSOR. Ticket `0088`.
 *
 * `LastEvaluatedKey` on `byUserAndStart` is `{ userId, startedAt, id }`. Only the last two travel
 * to the browser; `userId` is put back from the SESSION on the way in, so a cursor can name a
 * position in the caller's own history and nothing else — the `userId` contract above, applied to
 * the one value this module takes from a query string. A cursor that does not decode is `null`,
 * which the route answers with a 400.
 */
export function encodeChronicleCursor(key: { startedAt: string; id: string }): string {
  return Buffer.from(JSON.stringify([key.startedAt, key.id]), "utf8").toString("base64url")
}

export function decodeChronicleCursor(cursor: string): { startedAt: string; id: string } | null {
  if (cursor.length === 0 || cursor.length > 512) return null
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    if (!Array.isArray(v) || v.length !== 2) return null
    const [startedAt, id] = v as unknown[]
    if (typeof startedAt !== "string" || typeof id !== "string" || !startedAt || !id) return null
    return { startedAt, id }
  } catch {
    return null
  }
}

/** The columns a Chronicle row reads, and no others — `raw` alone is most of an item's bytes. */
const CHRONICLE_COLUMNS = ["id", "startedAt", "startedAtLocal", "name", "kind", "distanceM", "elapsedS", "movingS", "newCellCount", "traceRef", "hasTrace", "sets", "status"]

/**
 * `0287`. HOW MANY QUERY PAGES ONE CHRONICLE PAGE MAY READ to find a row that is not tombstoned.
 * Dropping tombstoned rows can empty a page while history goes on, and an empty first page would
 * render "Nothing here yet" over an account with runs. A delete is rare, so the second read almost
 * never happens; the bound only stops a pathological history walking itself on one request. A page
 * still empty after it is returned with its cursor, and the panel asks again on its next scroll.
 */
export const CHRONICLE_MAX_READS = 4

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)

function chronicleSets(v: unknown): ChronicleSet[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((raw): ChronicleSet[] => {
    const s = raw as Record<string, unknown> | null
    if (!s || typeof s.exercise !== "string") return []
    const reps = num(s.reps)
    const durationS = num(s.durationS)
    const distanceM = num(s.distanceM)
    return [{
      exercise: s.exercise,
      ...(reps !== undefined ? { reps } : {}),
      ...(durationS !== undefined ? { durationS } : {}),
      ...(distanceM !== undefined ? { distanceM } : {}),
    }]
  })
}

type ChronicleRow = FullActivityRow & { id: string; startedAt: string; sets?: unknown }

/** The row's trace flag, or a `traceRef` on a row that predates `hasTrace`. */
const isTraced = (r: ChronicleRow): boolean =>
  (r as Record<string, unknown>)["hasTrace"] === true || (typeof r.traceRef === "string" && r.traceRef.length > 0)

/**
 * ONE PAGE OF THE CALLER'S HISTORY, NEWEST FIRST. Ticket `0088`, `06-ui-ux.md` §2.5.
 *
 * Runs and logged workouts in one list, because they are one table: a manual log is an activity
 * like any other (`lib/log/log-workout.ts`). One `Query` on `byUserAndStart`, descending, with a
 * projection, `CHRONICLE_PAGE_SIZE` rows at a time — a backfill of years is paged, never read
 * whole (the ticket's "do not render 2,000 rows" starts here).
 */
export async function chroniclePage(
  userId: string,
  deps: Pick<RunReadDeps, "ddb" | "activityTable">,
  after: { startedAt: string; id: string } | null = null,
): Promise<ChroniclePage> {
  const names = Object.fromEntries(CHRONICLE_COLUMNS.map((c, i) => [`#c${i}`, c]))
  const items: RunListItem[] = []
  let start = after
  for (let reads = 0; reads < CHRONICLE_MAX_READS; reads++) {
    const out = (await deps.ddb.send(
      new QueryCommand({
        TableName: deps.activityTable,
        IndexName: "byUserAndStart",
        KeyConditionExpression: "#u = :u",
        ExpressionAttributeNames: { "#u": "userId", ...names },
        ExpressionAttributeValues: { ":u": userId },
        ProjectionExpression: Object.keys(names).join(", "),
        ScanIndexForward: false,
        Limit: CHRONICLE_PAGE_SIZE,
        ...(start ? { ExclusiveStartKey: { userId, startedAt: start.startedAt, id: start.id } } : {}),
      }),
    )) as { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> }

    for (const raw of out.Items ?? []) {
      // `0287`: a tombstoned activity leaves the list (`02` §4.7); its cells and XP do not.
      if (typeof raw.id !== "string" || typeof raw.startedAt !== "string" || isTombstoned(raw)) continue
      const r = raw as ChronicleRow
      items.push({
        activityId: r.id,
        startedAt: r.startedAt,
        startedAtLocal: r.startedAtLocal ?? r.startedAt,
        name: r.name ?? null,
        kind: r.kind ?? "other",
        distanceM: num(r.distanceM) ?? null,
        durationS: num(r.movingS) ?? num(r.elapsedS) ?? null,
        newCellCount: num(r.newCellCount) ?? null,
        traced: isTraced(r),
        sets: chronicleSets(r.sets),
      })
    }

    const last = out.LastEvaluatedKey
    start =
      last && typeof last.startedAt === "string" && typeof last.id === "string"
        ? { startedAt: last.startedAt, id: last.id }
        : null
    if (items.length > 0 || !start) break
  }
  return { items, next: start ? encodeChronicleCursor(start) : null }
}

/**
 * EVERY PAST ROUTE — the permanent web's inputs. Ticket `0085`, D-299. `06-ui-ux.md` §3.5 rule 2.
 *
 * One `GetObject` of the object the ingest worker maintains, under the key rebuilt from the session's
 * uid like every read here. No object is an empty web: a new account, or one whose runs predate the
 * object and have not been rebuilt into it (`tools/trace-web/rebuild-trace-web.ts`).
 */
export async function traceWebRuns(userId: string, deps: FogReadDeps): Promise<WebRunInput[]> {
  const bytes = await getObject(traceWebKey(userId), deps)
  if (bytes === undefined) return []
  const web = JSON.parse(new TextDecoder().decode(bytes)) as Partial<TraceWeb>
  if (web.v !== 1 || typeof web.runs !== "object" || web.runs === null) return []
  return Object.entries(web.runs).map(([activityId, run]) => ({
    activityId,
    startedAt: run.startedAt,
    lines: run.lines,
  }))
}
