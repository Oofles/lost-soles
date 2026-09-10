import { gzipSync } from "node:zlib"

import { PutObjectCommand } from "@aws-sdk/client-s3"

import type { GeoPoint } from "@/src/domain/activity"

/**
 * THE PER-ACTIVITY ROUTE GEOMETRY, WRITTEN ONCE PER INGEST. Ticket `0195`.
 * `02-data-model.md` §5.1 access pattern **S-7**; `05-fog-of-war.md` §2.2.
 *
 * What `traceToSegments` produced — §2.2 steps 1-3, the path the runner actually took —
 * stored as GeoJSON so the map can draw it. `0057` draws it above the fog; `0085` accumulates
 * every past one into the permanent record.
 *
 * ─── WHY THIS IS NOT CALLED WHAT `02` §5.1 CALLS IT ─────────────────────────
 *
 * §5.1 names the object `traces/<activityId>.polyline.gz`, and that name cannot exist in this
 * directory. `scripts/check-boundaries.mjs`'s STRICT tier bans `/polyline/i` throughout
 * `src/domain` and `src/pipeline` (D-100, D-121) — in code and in prose — so the key string
 * alone would fail CI, and the available dodges (define it one directory away and import it,
 * or add an exemption) are the "a guard that has to be dodged is a guard that gets disabled"
 * failure that `check-design-tokens.mjs` and `.githooks/pre-commit` both warn about.
 *
 * THE PRECEDENT IS ALREADY SET, one function away. §2.2's step-5 helper was specified as
 * `distancePointToPolyline`; the same gate caught it, and the DESIGN DOC was corrected rather
 * than the code, because the argument is not a polyline — it is the list of segments step 3
 * produced. Identical here. D-121's substance is that a `summary_polyline` is a DEGRADED
 * trace which permanently corrupts a map that cannot re-fog; naming our own full-fidelity
 * artefact after the thing the guard exists to keep out is precisely the confusion it exists
 * to prevent. `02` §5.1 is amended to match (D-235).
 */

/**
 * `users/<uid>/traces/<activityId>.segments.json.gz`.
 *
 * Under `users/<uid>/` like everything else the user owns, for the reason `objectKeys.runCells`
 * already records: `02` §6.1 and `05` §7.3 put every per-user object there — *"including
 * `traces/`"* — and the worker's S3 grant is scoped to that prefix, so a top-level `traces/`
 * would need a second grant for nothing.
 *
 * `<uid>` is the Cognito `sub` (T1), which is NOT the identity-pool id
 * `amplify/storage/resource.ts` scopes browser access by. That is why `/api/runs/latest` reads
 * this server-side rather than handing the browser a key — the same gap ticket `0181` tracks
 * for the explored blob.
 */
export const routeTraceKey = (userId: string, activityId: string): string =>
  `users/${userId}/traces/${activityId}.segments.json.gz`

/**
 * SIX DECIMAL PLACES, ~0.11 m at the equator.
 *
 * Two orders of magnitude below the GPS error the sanitiser already tolerates (`MAX_ACC_M`),
 * three below the 65 m reveal radius, and it roughly halves the object against JavaScript's
 * default 15-17 significant digits — `-81.38712399999999` costs 18 bytes to say nothing.
 *
 * IT DOES NOT WEAKEN THE "ONE COMPUTATION" GUARANTEE. That guarantee is about the SANITATION
 * PATH: the cells and this geometry come from the same `traceToSegments` call, so they can
 * never disagree about which fixes were dropped, where the trace was split, or where a dwell
 * was collapsed. Rounding the surviving vertices for transport is a different axis entirely,
 * and 11 cm of it is invisible at every zoom the map has.
 */
const COORD_DP = 6
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6

/** GeoJSON is `[lng, lat]`, and getting that backwards puts Florida in Somalia. */
type Position = [number, number]

/**
 * A GeoJSON `MultiLineString` — one line per segment, in order.
 *
 * **`MultiLineString`, never `LineString`, even for the overwhelmingly common single-segment
 * run.** A renderer that has to branch on the geometry type is a renderer that will one day be
 * handed a split trace and draw the chord across it. One shape, always, and the gap between
 * two lines is a hole in the geometry rather than something a consumer has to remember to
 * honour — which is the whole of `0057`'s "no chord drawn across the gap".
 */
export interface RouteTraceGeometry {
  type: "MultiLineString"
  coordinates: Position[][]
}

/**
 * ALTITUDE AND TIME ARE DROPPED, deliberately.
 *
 * GeoJSON permits a third ordinate and this could carry `altM`, but nothing draws elevation
 * and the raw archive holds the full-fidelity record forever (D-101) — so this stays the
 * smallest thing that answers "where did the line go". `0080`'s lantern traverses the vertices
 * in order and needs no clock to do it.
 *
 * A segment of fewer than two points cannot be a line and is dropped. `splitImplausible` can
 * leave a single-fix segment behind when an outlier sits between two other outliers; it
 * qualifies cells (a point still reveals ground around it) but there is no line to draw.
 */
export function segmentsToGeometry(segments: readonly GeoPoint[][]): RouteTraceGeometry {
  return {
    type: "MultiLineString",
    coordinates: segments
      .filter((segment) => segment.length >= 2)
      .map((segment) => segment.map((p): Position => [round6(p.lng), round6(p.lat)])),
  }
}

/** The S3 surface this module uses. Narrowed so a test needs a one-method stub, not a client. */
export interface RouteTraceS3 {
  send(command: PutObjectCommand): Promise<{ ETag?: string }>
}

export interface RouteTraceDeps {
  s3: RouteTraceS3
  bucket: string
}

/**
 * Write the geometry and return the key, or `null` when there is no line to store.
 *
 * **`null` IS A NORMAL OUTCOME AND MUST STAY ONE.** A treadmill run, a manual entry, a strength
 * session, a trace so degraded that §2.2 left nothing two points long — `05` §3.6 is explicit
 * that none of these is an error. The caller writes `traceRef: null` and the row is complete;
 * `activity.types.test.ts` already asserts the column is nullable for exactly this reason.
 *
 * ─── NOT `immutable`, AND §5.1 SAYS "one immutable GET" ─────────────────────
 *
 * The key carries no revision, and T3's `revision` field exists precisely because a source-side
 * edit re-ingests the same activity — which rewrites this object under the same name. An
 * `immutable` year-long cache header on an object that can be rewritten is the pmtiles trap
 * `lib/basemap.ts` sets out at length: the stale copy is not detectably stale, it is just
 * wrong. `no-cache` costs a conditional request on an object served once per activity view.
 *
 * The PUT is idempotent by construction — deterministic key, deterministic body — which is what
 * lets this sit above the transaction like `cells` and `blobs` do: a failure here leaves the
 * receipt `PROCESSING` and no `Activity` row, and redelivery repeats the whole set.
 */
export async function writeRouteTrace(
  input: { userId: string; activityId: string; segments: readonly GeoPoint[][] },
  deps: RouteTraceDeps,
): Promise<string | null> {
  const geometry = segmentsToGeometry(input.segments)
  if (geometry.coordinates.length === 0) return null

  const key = routeTraceKey(input.userId, input.activityId)
  await deps.s3.send(
    new PutObjectCommand({
      Bucket: deps.bucket,
      Key: key,
      Body: gzipSync(Buffer.from(JSON.stringify(geometry), "utf8")),
      ContentType: "application/geo+json",
      ContentEncoding: "gzip",
      CacheControl: "no-cache",
    }),
  )
  return key
}

/** Exported for the test that asserts the rounding is the documented one, not whatever it is. */
export const COORDINATE_DECIMAL_PLACES = COORD_DP
