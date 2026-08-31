# CANONICAL — Ingestion Contract

> **This file is the single source of truth for `Activity`, `Trace` and `SourceAdapter`.**
> `01-architecture.md` §3 and `03-integrations.md` §1 each defined these independently
> (they were written in parallel). Where they disagree, **this file wins.** Both have been
> annotated to point here.
>
> Reconciled 2026-08-30. Every conflict resolution is recorded below with its reasoning,
> so a future reader can overrule a call without re-deriving the argument.

---

## 1. The eight conflicts and how they were settled

| # | Conflict | Winner | Why |
|---|---|---|---|
| 1 | `AdapterId` open union vs `SourceId` closed union | **Both** | Enumerate known sources for documentation value, but keep `(string & {})` widening so adding a source never edits the domain (D-100). |
| 2 | Trace point time: absolute epoch ms vs seconds-since-start | **Absolute** (01) | Relative time loses information, makes cross-source merging lossy, and D-120's 6-month cooldown is inherently absolute. Strava's `time` stream is relative — the adapter converts. Converting down is trivial; recovering up is not. |
| 3 | `startedAt` ISO-with-offset vs UTC + naive-local + IANA zone | **Three fields** (03) | An offset is not a timezone: it loses DST, so "which day did I run" breaks twice a year. Game-day bucketing uses `startedAtLocal`. |
| 4 | Trace embedded in the activity vs referenced by S3 key | **Both — different layers** | `NormalizedIngest` is the in-flight adapter output; `traceRef` is the persisted pointer. Never in conflict; the docs were describing different moments. |
| 5 | `gaps` + `simplified` vs `bbox` + `pointCount` | **All four** | `gaps` prevents the renderer drawing a corridor through a tunnel and prevents distance summing across a pause. `simplified` is a standing guard against the `summary_polyline` trap (D-121.4). `bbox` is a cheap prefilter. |
| 6 | `activityId` as sha256 vs ULID | **sha256** (01) | Deterministic ids make re-ingest idempotent for free. A ULID would mint a duplicate on every webhook replay — and Strava retries 3x. `revision` (03) still tracks edits. |
| 7 | `kind` (physical) vs `skill` (game) on `Activity` | **`kind` only** | Putting `skill` here couples ingestion to game rules. What the activity *physically was* is a fact; which skill it trains is a design decision that will change. The kind→skill map lives in the game layer (`04-game-design.md`). |
| 8 | `SourceAdapter`: 3-phase vs list/fetch/event | **Merged** | 01's `accept`/`fetchRaw`/`normalize` split is the better core — a **pure** `normalize()` is the migration seam, which both docs independently identified as load-bearing. But 03 is right that `listSince` is **mandatory, not optional**: it is the reconciliation sweep covering silently-dropped webhooks. 03's `IngestCommand` supplies retract/disconnect semantics that 01 lacked. |

---

## 2. `src/domain/activity.ts` — the contract

```ts
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
```

## 3. `src/adapters/types.ts` — the adapter interface

```ts
export interface SourceAdapter<TCreds = unknown> {
  readonly id: SourceId

  /** PHASE 1 — runs in the public endpoint. LATENCY-CRITICAL (Strava: <2s hard deadline).
   *  MUST NOT call the source API, refresh tokens, or touch S3. Validation + job construction. */
  accept(req: InboundRequest): Promise<AckResult>

  /** PHASE 2 — runs in the worker. May use the network.
   *  Returns raw bytes EXACTLY as the source gave them. No transformation.
   *  The pipeline archives these to S3 BEFORE normalize() is ever called (D-121.2). */
  fetchRaw(job: IngestJob, creds: TCreds): Promise<{ body: Buffer; contentType: string; ext: string }>

  /** PHASE 3 — PURE. No network, no AWS SDK, no clock, no randomness.
   *  THIS IS THE MIGRATION SEAM. Unit-testable from a checked-in fixture with zero mocking,
   *  and the only place a vendor's wire format is understood.
   *  At migration, client code dies and this function survives to replay the S3 archive. */
  normalize(raw: Buffer, ref: RawArchiveRef, job: IngestJob): NormalizedIngest

  /** MANDATORY, not optional. Push adapters may return empty and rely on events, but every
   *  adapter implements this: it is the reconciliation sweep that covers SILENTLY DROPPED
   *  webhooks. Strava retries 3x then drops with no DLQ and no replay. */
  listSince(userId: string, watermark: string, creds: TCreds): AsyncIterable<IngestJob>

  refreshCredentials?(creds: TCreds): Promise<TCreds>
}

/** Intents, never side effects. */
export type IngestCommand =
  | { kind: "ingest";     job: IngestJob }
  | { kind: "reingest";   job: IngestJob }                              // edit ⇒ bump revision
  | { kind: "retract";    source: SourceId; externalId: string }        // deleted at source
  | { kind: "disconnect"; source: SourceId; userId: string }
```

`src/adapters/registry.ts` is **the one file that names concrete adapters.**

## 4. The pipeline

```
accept()                                   → ack the source in <2s, enqueue
  → fetchRaw()
  → 1. ARCHIVE raw bytes to S3             (D-101/D-121.2 — before anything trusts them)
  → 2. normalize()  [PURE]                 (vendor types die here)
  → 3. DEDUPE on dedupeKey                 (cross-source, not just intra-source)
  → 4. SANITIZE trace                      (speed-gate implausible jumps; honour `gaps`)
  → 5. PROJECT to H3 res 10 cells          (D-115)
  → 6. SCORE fog + XP                      (D-120: full / half / 50% re-arm)
  → 7. PERSIST activity + cell deltas      (DynamoDB, D-082; append-only, D-020)
```

## 5. CI checks that prove the boundary holds (D-100)

1. `grep -ri strava src/domain src/pipeline` returns **nothing**.
2. Swapping the primary source touches **one directory + one registry line**.
3. Cross-adapter equivalence: the same physical run ingested via two adapters yields the
   **same H3 cell set** (within tolerance).
4. `normalize()` is pure — enforced by running it with network and clock stubbed to throw.
5. **Fidelity floor**: assert points-per-km above a threshold, to catch a silent
   source-side decimation (the `summary_polyline` failure mode) before it permanently
   corrupts the map.
