/**
 * THE DOMAIN CONTRACT. Transcribed from `docs/contracts/ingestion-contract.md` §2,
 * which is the **single source of truth** for these types (D-140).
 *
 * `01-architecture.md` §3 and `03-integrations.md` §1 each define them independently —
 * they were written in parallel — and **where any of them disagree with the contract,
 * the contract wins.** Do not reconcile them again. Do not invent variants. If something
 * here looks wrong, file a ticket against the contract rather than fixing it here: a
 * domain that quietly disagrees with its contract is worse than either being wrong,
 * because the disagreement is invisible.
 *
 * TYPES ONLY — this module emits no runtime code. `computeActivityId` lives in
 * `./activity-id.ts` so that importing these types can never pull `node:crypto` into a
 * client bundle. See that file's header.
 *
 * Ticket 0025.
 */

/** Known sources, widened so adding one never edits the domain (D-100). */
export type SourceId =
  | "strava"          // MVP (D-121)
  | "gpslogger"       // D-112
  | "health-connect"  // D-113
  | "file-upload"     // GPX/FIT drop, incl. Strava bulk export (D-101)
  | "manual"          // D-060/D-061
  | "suunto" | "polar"// D-117, contingent on hardware
  | (string & {})

/** What the activity physically WAS. Not which skill it trains — see conflict #7. */
export type ActivityKind =
  | "run" | "walk" | "hike" | "ride"
  | "strength"        // D-060: reps/sets, no Trace
  | "other"

/** One GPS sample. The only geospatial primitive the domain knows. */
export interface GeoPoint {
  lat: number                 // WGS84 degrees
  lng: number
  /** Epoch MILLISECONDS, UTC, absolute. Never relative to start — see conflict #2. */
  t: number
  altM?: number               // present only if the source gives it; never synthesised
  accuracyM?: number          // absent = unknown, NOT zero
}

/** Ordered, de-duplicated, monotonic in time. Adapters guarantee it; the pipeline asserts it. */
export interface Trace {
  points: GeoPoint[]
  /** [startIdx, endIdx] pairs marking gaps > GAP_THRESHOLD_MS (tunnel, pause, signal loss).
   *  The fog renderer MUST NOT draw a corridor across a gap.
   *  Distance MUST NOT be summed across one. */
  gaps: Array<[number, number]>
  /** True if the source is known lossy. Strava's summary_polyline would be true — which is
   *  exactly why D-121.4 forbids it. A permanent map cannot be built from a decimated trace. */
  simplified: boolean
  /** [minLng, minLat, maxLng, maxLat] — cheap prefilter before H3 projection. */
  bbox: [number, number, number, number]
  pointCount: number
}

/** Immutable raw bytes archived at ingest. D-101, D-121.2 — this is what makes Strava reversible. */
export interface RawArchiveRef {
  bucket: string
  key: string                 // raw/<userId>/<source>/<externalId>/<sha256>.<ext>
  contentType: string
  bytes: number
  sha256: string
  archivedAt: string          // ISO 8601 UTC
}

/** Provenance. The ONLY place a source is named in the domain. */
export interface SourceRef {
  source: SourceId
  /** Opaque to the domain. ALWAYS a string — Strava ids are int64 and JSON.parse
   *  silently corrupts them past 2^53. See 03-integrations §2.7. */
  externalId: string
  /** The vendor's own type string, verbatim, for debugging and re-mapping.
   *  e.g. "TrailRun", "ExerciseSessionRecord:EXERCISE_TYPE_RUNNING".
   *  NEVER branched on outside the adapter. */
  sourceTypeRaw: string
  fetchedAt: string
  meta?: Readonly<Record<string, string | number | boolean>>
}

export interface WorkoutSet {
  exercise: string            // "pushup" | "situp" | "plank" | future — data, not code (D-031)
  reps?: number
  durationS?: number          // planks
  weightKg?: number
}

export interface Activity {
  /** sha256(`${userId}:${source}:${externalId}`). Deterministic ⇒ re-ingest is idempotent. */
  activityId: string
  userId: string
  kind: ActivityKind

  /** UTC instant. Storage and sort key. Always trustworthy. */
  startedAt: string           // ISO 8601 with a real Z
  /** Naive local wall clock, NO offset. ALL game-day bucketing uses this. */
  startedAtLocal: string      // "YYYY-MM-DDTHH:mm:ss"
  /** Bare IANA id or null. e.g. "America/Denver". Never a "(GMT-07:00) " prefixed string. */
  timezone: string | null

  elapsedS: number
  movingS?: number
  distanceM?: number          // from the source if given, else computed from the Trace
  elevationGainM?: number
  name?: string               // free text from the source, display only

  source: SourceRef
  /** Null only for `manual`. */
  raw: RawArchiveRef | null
  /** S3 key of the normalized trace. Null is a NORMAL outcome: treadmill, manual, strength. */
  traceRef: string | null
  hasTrace: boolean

  /** D-062: sets deferred from the MVP UI, but carried in the model from day one. */
  sets: WorkoutSet[]

  /** Composite natural key for CROSS-source dedupe (same run via Strava and Health Connect). */
  dedupeKey: string
  ingestedAt: string
  /** Monotonic per (source, externalId). Bumped on re-ingest of a source-side edit. */
  revision: number
}

/** What an adapter hands the pipeline. Nothing else crosses the boundary. */
export interface NormalizedIngest {
  activity: Activity
  trace?: Trace               // absent for strength/manual
}
