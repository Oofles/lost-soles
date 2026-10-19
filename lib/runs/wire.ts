/**
 * THE RUN-GEOMETRY WIRE SHAPE, WHERE THE BROWSER CAN SEE IT. Ticket `0057`.
 * `05-fog-of-war.md` §4.4; `02-data-model.md` §5.1 (S-7).
 *
 * `0195` put this interface in `lib/runs/server.ts`, which was right while the only caller was
 * the route handler next door. `0057` gives it a SECOND caller in the browser, and that module
 * cannot import from `server.ts` at any price: `server.ts` pulls in `@aws-sdk/client-dynamodb`
 * and `@aws-sdk/client-s3` at module scope, and a client component importing it drags both into
 * the page bundle — a few hundred KB of signing code to describe a line on a map.
 *
 * So the shape moves here, `lib/fog/wire.ts` is the precedent, and `server.ts` imports it back.
 * Nothing in this file has a runtime dependency on anything.
 */

/**
 * Re-exported rather than restated. `segmentsToGeometry` in `src/pipeline/route-trace-store.ts`
 * is what WRITES this, so a second declaration here would be a copy that can silently disagree
 * with the writer — the failure `fixtures must come from the shipped writer` names.
 *
 * `export type` is fully erased at compile time, so this does NOT pull `@aws-sdk/client-s3`
 * (which that module imports for its `PutObjectCommand`) into a browser bundle. A value import
 * would; `import type` is the load-bearing keyword in this file.
 */
import type { RouteTraceGeometry } from "@/src/pipeline/route-trace-store"
import type { RunClasses } from "@/src/domain/discovery"
import type { BackfillMark } from "@/lib/backfill/batch"

export type { RouteTraceGeometry }

/** What `/api/runs/latest` serves. GeoJSON, so MapLibre consumes it with no translation layer. */
export interface RunFeature {
  type: "Feature"
  geometry: RouteTraceGeometry
  properties: {
    activityId: string
    startedAt: string
    name: string | null
    /**
     * `0086`. What the plinth's last-run line reads (`06` §2.2 row 7), carried on the same feature
     * the map already fetches so the line and the camera can never name different runs — and so
     * `/` gains no second query path for activity data (`0186`). Optional: a body from before
     * `0086` lacks them, and a row that predates a column has none to give.
     */
    startedAtLocal?: string | null
    distanceM?: number | null
    newCellCount?: number | null
    /**
     * `0087`. This run's NEW cell ids (`0251`'s server verdict, D-294), so `/` can hold an unseen
     * run's discoveries back until its sequence plays (`06` §2.4, "territory as of before the
     * run"). `null` for a run never classified: hide nothing.
     */
    newCells?: string[] | null
    /**
     * `0257`. The run came in with a historical import (`lib/backfill/batch.ts`): it is never "new",
     * on any device — the import's one aggregate reveal stands for it. Absent otherwise.
     */
    backfilled?: true
  }
}

export interface RunFeatureCollection {
  type: "FeatureCollection"
  features: RunFeature[]
  /**
   * `0257`. The account's historical-import record, without its ids (`markOf`): what the next map
   * visit's aggregate reveal plays from. `null`: the account has none. ABSENT (`undefined`): the
   * answer predates `0257` — a cached body, say — and says nothing either way.
   */
  backfill?: BackfillMark | null
}

/**
 * The empty answer, and it is a NORMAL one — `latestRun` sets out the three situations that
 * produce it. The renderer draws it as "no line", never as an error.
 */
export const EMPTY_COLLECTION: RunFeatureCollection = { type: "FeatureCollection", features: [] }

/** The endpoint `0195` built. Named here so the client and its test cannot disagree on the path. */
export const RUNS_LATEST_PATH = "/api/runs/latest"

/** `0085`, D-299. Every past route, as the inputs `lib/trace-web/web.ts` builds the web from. */
export const RUNS_WEB_PATH = "/api/runs/web"

/**
 * `0101`. THE FACTS A CLICK ON A ROUTE LINE SHOWS (`06` §4.5): date · distance · new cells, for the
 * runs the click hit. `GET /api/runs/summary?ids=a,b,c`, session-gated, `no-store, private`.
 */
export const RUNS_SUMMARY_PATH = "/api/runs/summary"
export const RUNS_SUMMARY_IDS_PARAM = "ids"
/**
 * At most this many ids per request — one base-table `Query` each. The card shows five rows and
 * scrolls; a street run a hundred times asks in several requests (`fetchRunFacts` chunks), so a
 * single request can never fan out into an unbounded number of reads.
 */
export const RUNS_SUMMARY_MAX_IDS = 25
/** An activity id as the query string may carry one: I-5's hex digest, or any id-safe string. */
export const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export interface RunFacts {
  activityId: string
  startedAt: string
  /** The naive wall clock (I-13), which the date is read from. */
  startedAtLocal: string
  distanceM: number | null
  newCellCount: number
}

/**
 * The `ids` parameter, parsed: unique, each well-formed, between one and `RUNS_SUMMARY_MAX_IDS`.
 * `null` for anything else, which the route answers with a 400.
 */
export function parseSummaryIds(raw: string | null): string[] | null {
  if (raw === null) return null
  const ids = [...new Set(raw.split(",").filter((id) => id.length > 0))]
  if (ids.length === 0 || ids.length > RUNS_SUMMARY_MAX_IDS) return null
  return ids.every((id) => RUN_ID_PATTERN.test(id)) ? ids : null
}

/**
 * ONE RUN, AS `/run/:activityId` RENDERS IT. Ticket `0078`. `06-ui-ux.md` §3.3.
 *
 * The facts the end state's route stats and ledger summary read, plus the run's own geometry for
 * the map. Read on the server, ownership-checked (`runById`), and handed to the page as props —
 * nothing here is computed; every field is a column `persist.ts` wrote.
 */
export interface RunSummary {
  activityId: string
  /** ISO 8601 UTC. */
  startedAt: string
  /** Naive wall clock (I-13). The DATE the run happened is read from this, never from UTC. */
  startedAtLocal: string
  name: string | null
  kind: string
  distanceM: number | null
  elapsedS: number
  movingS: number | null
  /** The adapter id (`AdapterId`) — display only; nothing branches on it (D-100). */
  source: string
  newCellCount: number
  rearmedCellCount: number
  /** Every cell the run touched, all classes (`0083`'s new-ground share). `null` on a row that predates the column. */
  cellCount: number | null
  /**
   * `0090`: the two classes that earn nothing, as the projection stored them — so the derived feed
   * (`lib/stats/derived.ts`) can surface every count without reclassifying. Optional: absent on a
   * row that predates the column, and on fixtures written before it.
   */
  cooledCellCount?: number | null
  deferredCellCount?: number | null
  /** The run's line, or the empty collection for an untraced activity. */
  route: RunFeatureCollection
  /**
   * WHAT THIS RUN REVEALED. Ticket `0251`; D-294. The run's own new and re-armed cell ids, as
   * classified at ingest (or by the fold) and stored beside its cell record — beat 1's reveal set.
   * The server's verdict, served as-is: the browser's explored blob cannot tell this run's
   * discoveries from ground an earlier run cleared, so the client derives no membership.
   *
   * Empty lists for an untraced activity, and for a run never classified (before `0253`'s backfill
   * reached it) — "reveal nothing" is the safe reading of both; familiar ground is never fogged.
   */
  reveal: RunClasses
}

/**
 * ONE ROW OF THE CHRONICLE. Ticket `0078` added the link; `0088` the rest. `06-ui-ux.md` §2.5.
 *
 * Every field is a T3 column `persist.ts` already wrote, read with a projection — nothing is
 * computed for the list. `newCellCount` is the stored discovery award (`05` §8.2): the same number
 * the run page and the plinth's last-run line read, so the three can never disagree.
 */
export interface RunListItem {
  activityId: string
  /** ISO 8601 UTC — the sort key, and half of the paging cursor. */
  startedAt: string
  /** Naive wall clock (I-13). The row's DATE is read from this. */
  startedAtLocal: string
  name: string | null
  kind: string
  distanceM: number | null
  /** Moving time, else elapsed. `null` on a row that has neither. */
  durationS: number | null
  /** The stored award. `null` on a row that predates the column. */
  newCellCount: number | null
  /** Whether the activity has a line on the map. Only a traced run can be an UNSEEN import. */
  traced: boolean
  /** A logged session's sets (`WorkoutSet`, D-062), narrowed to what the row's summary reads. */
  sets: readonly ChronicleSet[]
  /** `0257`. Came in with a historical import, so never the gold row (`chronicleWithBackfill`). */
  backfilled?: true
}

export interface ChronicleSet {
  /** An exercise id from the registry — data, never branched on (D-031). */
  exercise: string
  reps?: number
  durationS?: number
  distanceM?: number
}

/** One page of the Chronicle, newest first. `next` is the opaque cursor for the page after, or `null` at the end. */
export interface ChroniclePage {
  items: RunListItem[]
  next: string | null
}

/** `0088`. The Chronicle's later pages. The first is rendered on the server with the route. */
export const RUNS_CHRONICLE_PATH = "/api/runs/chronicle"

/** The query parameter carrying `ChroniclePage.next`. */
export const CHRONICLE_AFTER_PARAM = "after"

/** Rows per page. A desktop window shows ~15; fifty is three screens of scrolling per fetch. */
export const CHRONICLE_PAGE_SIZE = 50

/**
 * THE ONE WRITER OF A `/run/:id` LINK.
 *
 * `play` is the entry point's AUTOPLAY INTENT (§3.1): the plinth's new-run line asks for the
 * sequence, the Chronicle does not. It is the only way the route learns it — not the run's age,
 * not the `seen` flag (`0084` owns that) — and the page drops it from the address bar once read,
 * so a reload or a shared link opens the end state rather than replaying.
 */
export const PLAY_PARAM = "play"

export function runHref(activityId: string, opts: { play?: boolean } = {}): string {
  const path = `/run/${encodeURIComponent(activityId)}`
  return opts.play ? `${path}?${PLAY_PARAM}=1` : path
}
