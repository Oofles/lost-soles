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
