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

export type { RouteTraceGeometry }

/** What `/api/runs/latest` serves. GeoJSON, so MapLibre consumes it with no translation layer. */
export interface RunFeature {
  type: "Feature"
  geometry: RouteTraceGeometry
  properties: { activityId: string; startedAt: string; name: string | null }
}

export interface RunFeatureCollection {
  type: "FeatureCollection"
  features: RunFeature[]
}

/**
 * The empty answer, and it is a NORMAL one — `latestRun` sets out the three situations that
 * produce it. The renderer draws it as "no line", never as an error.
 */
export const EMPTY_COLLECTION: RunFeatureCollection = { type: "FeatureCollection", features: [] }

/** The endpoint `0195` built. Named here so the client and its test cannot disagree on the path. */
export const RUNS_LATEST_PATH = "/api/runs/latest"

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
  /** The run's line, or the empty collection for an untraced activity. */
  route: RunFeatureCollection
}

/** One row of the Chronicle's run list. Ticket `0078` adds only the link; `0088` builds the sheet. */
export interface RunListItem {
  activityId: string
  startedAtLocal: string
  name: string | null
  kind: string
  distanceM: number | null
}

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
