import { createHash } from "node:crypto"

import type {
  Activity,
  ActivityKind,
  GeoPoint,
  NormalizedIngest,
  RawArchiveRef,
  Trace,
} from "@/src/domain/activity"
import { computeActivityId } from "@/src/domain/activity-id"

import type { IngestJob } from "../types"
import { assertStreamsAligned, openRawEnvelope, type StravaStream } from "./raw-envelope"
import { sanitizeTracePoints } from "./sanitize"

/**
 * THE MIGRATION SEAM. Ticket 0036.
 *
 * The only place in this codebase that understands Strava's wire format, and the only
 * function here written on the assumption that Strava will one day be gone.
 *
 * ─── WHY PURITY IS A REQUIREMENT AND NOT A STYLE ────────────────────────────
 *
 * `02-data-model.md` §8.3 step 2 and roadmap §4.3 describe a rebuild drill: replay the S3
 * archive years from now and assert the same cell count and the same Total XP come back.
 * By then D-102/D-121's athlete cap may already have removed API access, so the drill
 * **cannot call Strava**. Everything this function needs therefore arrives in its three
 * arguments:
 *
 *   `raw` — the archived envelope bytes, exactly as `sealRawEnvelope` wrote them
 *   `ref` — the `RawArchiveRef`, which carries `archivedAt`. **This is the clock.**
 *   `job` — `userId`, `source`, `externalId`, and the adapter's private `meta`
 *
 * No network, no AWS SDK, no `Date.now()`, no randomness. `src/adapters/normalize-purity.ts`
 * proves it by traps rather than by review, and `normalize.test.ts` additionally walks this
 * module's import graph statically — a runtime stub only catches a call that actually
 * happens, and the impure branch is always the one the fixture did not take.
 *
 * ─── THE FOUR TRANSFORMATIONS, EACH OF WHICH IS A DOCUMENTED TRAP ───────────
 *
 * 1. Strava's `time` stream is **relative** (seconds since start); `GeoPoint.t` is
 *    **absolute epoch milliseconds** (contract conflict 2). The adapter converts, because
 *    converting down is trivial and recovering up is not.
 * 2. `start_date_local` is local wall-clock time serialized with a `Z` that is **a lie**.
 *    Strip it; parsing it as UTC double-shifts the run into the wrong day.
 * 3. `timezone` arrives as `"(GMT-08:00) America/Los_Angeles"`. Strip the prefix — and
 *    never do arithmetic with it; see `bareIanaZone`.
 * 4. Ids stay **strings**, always. `parseWithExactIds` (via `openRawEnvelope`) is what
 *    makes that true for the digits; this module never coerces one to a number.
 *
 * Trace sanitation — the implausible-speed filter and the segment split — is **0037**, not
 * this ticket. What lands here is the shape, the times, the ids and the streams.
 */

/**
 * How long a gap between consecutive samples has to be before it is a GAP.
 *
 * The contract, `01-architecture.md` §3 and `src/domain/activity.ts` all name
 * `GAP_THRESHOLD_MS` and **none of them give it a value** — it was carried as a symbol
 * through three documents without ever being decided. Settled here as D-195.
 *
 * 30 seconds, because `05-fog-of-war.md` §2.2 records the `latlng` stream as nominally
 * ~1 Hz. Thirty consecutive missing samples is a stop, a tunnel or a dropout; it is not a
 * watch throttling under tree cover, which is the false positive that would make the fog
 * renderer break a corridor the operator actually ran. Under-revealing is recoverable and
 * over-revealing is permanent (D-020), but a spurious gap is not under-revealing — it is a
 * dotted line on a route that was continuous, and §9.5 says to measure the real traces
 * before touching constants like this one.
 */
export const GAP_THRESHOLD_MS = 30_000

/**
 * `sport_type` → what the activity physically WAS. Never a skill (contract conflict 7):
 * which skill a walk trains is decided by the 0029 matcher reading YAML, so that reversing
 * the Walk/Hike policy call in `03-integrations.md` §2.6 is one line in `rules/` and no
 * line here.
 *
 * **`sport_type`, never `type`.** Both fields are on every activity. `type` is the legacy
 * 37-value enum and it is LOSSY: a `TrailRun` appears there as a plain `Run`, and 19 modern
 * sport types collapse to the single value `Workout`. This table is the only reason to read
 * either field, and it reads the current one.
 *
 * A DATA TABLE, not a `switch` — D-031/D-141. Adding a sport type is a row.
 *
 * TWO ROWS WORTH DEFENDING:
 *
 * `Workout` maps to `other`, not to `strength`, even though §2.6 groups it with the
 * strength-shaped types. It is Strava's catch-all: 19 distinct modern sport types collapse
 * into it, most of which are not strength at all. `other` says "we did not classify this",
 * which is true; `strength` would be a claim, and D-060 means a wrong strength row is a
 * claim about reps this system can never have.
 *
 * `Ride` maps to `ride` rather than being dropped. §2.6's table calls it *(ignored)*, but
 * that column is about INGEST POLICY, not about physics — a ride is a ride whether or not
 * anything scores it. Emitting the honest kind and letting the rules layer award nothing
 * is the D-141 shape; collapsing it to `other` here would hide a decision inside an adapter.
 * Which kinds enter the ledger at all is 0037's call, made on this value.
 */
const SPORT_TYPE_TO_KIND: Readonly<Record<string, ActivityKind>> = {
  Run: "run",
  TrailRun: "run",
  // Zwift, Peloton, a footpod. A real run with distance and XP and no fog, and it needs no
  // special case here: it simply arrives with no `latlng`, so no Trace is built.
  VirtualRun: "run",
  Walk: "walk",
  Hike: "hike",
  Ride: "ride",
  VirtualRide: "ride",
  EBikeRide: "ride",
  GravelRide: "ride",
  MountainBikeRide: "ride",
  Handcycle: "ride",
  Velomobile: "ride",
  WeightTraining: "strength",
  Crossfit: "strength",
  HighIntensityIntervalTraining: "strength",
}

/**
 * An unknown `sport_type` is `other`, and that is deliberate rather than defensive.
 *
 * Strava adds sport types. §2.6: *"Unknown `sport_type` values must not crash the adapter.
 * Default to 'ignored', log the raw string in `sourceTypeRaw`, and archive the payload
 * anyway. A new sport type is a backlog ticket, not a page."* The verbatim string survives
 * on `SourceRef.sourceTypeRaw`, so the activity can be re-mapped from the archive later
 * without ever having called Strava again.
 */
export function mapSportTypeToKind(sportType: unknown): ActivityKind {
  if (typeof sportType !== "string") return "other"
  return SPORT_TYPE_TO_KIND[sportType] ?? "other"
}

/**
 * `start_date_local` → a naive local wall clock with **no `Z` and no offset**.
 *
 * The `Z` Strava puts on this field is not a timezone designator, it is a formatting
 * accident: `2026-03-14T07:30:00Z` in this field means 07:30 *local*. Anything that parses
 * it as UTC and then converts has shifted the run twice.
 *
 * All game-day bucketing reads this value's date component, so getting it wrong moves a
 * late-evening run to the following day, permanently, in an append-only ledger.
 */
export function stripLyingZ(startDateLocal: unknown): string {
  if (typeof startDateLocal !== "string") {
    throw new StravaNormalizeError("start_date_local is missing or not a string")
  }

  const naive = startDateLocal.replace(/(?:Z|[+-]\d{2}:?\d{2})$/, "")

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(naive)) {
    throw new StravaNormalizeError(
      `start_date_local is not a naive "YYYY-MM-DDTHH:mm:ss" after stripping its offset: ` +
        `${JSON.stringify(startDateLocal)}`,
    )
  }

  return naive
}

/**
 * `"(GMT-08:00) America/Los_Angeles"` → `"America/Los_Angeles"`.
 *
 * **The prefix is decoration and must never be used for arithmetic.** Strava reports a
 * zone's STANDARD-time offset there regardless of whether the activity fell in DST — the
 * `run-dst-boundary` fixture is labelled `(GMT-08:00)` while its own `start_date` and
 * `start_date_local` are seven hours apart, because the run happened after the clocks went
 * forward. A reader who trusted the label would land the run an hour early; one who trusted
 * it near midnight would land it on the wrong day. The IANA id is the only part of this
 * string that carries a real rule set, and `startedAtLocal` is already correct without it.
 */
export function bareIanaZone(timezone: unknown): string | null {
  if (typeof timezone !== "string") return null
  const bare = timezone.replace(/^\(GMT[+-]\d{2}:\d{2}\)\s*/, "").trim()
  return bare === "" ? null : bare
}

export class StravaNormalizeError extends Error {
  constructor(message: string) {
    super(`Strava normalize: ${message}`)
    this.name = "StravaNormalizeError"
  }
}

/** What this module reads off a detail response. Partial on purpose — see `adapter.ts`. */
interface StravaDetail {
  name?: unknown
  sport_type?: unknown
  start_date?: unknown
  start_date_local?: unknown
  timezone?: unknown
  elapsed_time?: unknown
  moving_time?: unknown
  distance?: unknown
  total_elevation_gain?: unknown
}

/** A finite number, or `undefined`. Strava sends `null` for fields it has no value for. */
function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/**
 * `revision`, from the job — **never invented here**.
 *
 * It lives in the adapter-private `meta` rather than on `IngestJob` (D-196): only the
 * re-ingest path has anything to say about it, and a field on the generic job type would
 * put one adapter's concern into the shape every adapter's queue messages share, which is
 * the D-100 boundary moving into the queue.
 *
 * Absent means 1. A first ingest genuinely is revision 1, and the alternative — throwing —
 * would make every `create` job carry a constant.
 */
function revisionFrom(job: IngestJob): number {
  const meta = job.meta
  if (meta !== null && typeof meta === "object") {
    const value = (meta as { revision?: unknown }).revision
    if (typeof value === "number" && Number.isInteger(value) && value >= 1) return value
  }
  return 1
}

/**
 * REJECTION COUNTS, AS PROVENANCE RATHER THAN AS A LOG LINE — D-197.
 *
 * `03-integrations.md` §2.2 says *"Log rejection counts per activity. A sudden rise means a
 * hardware or firmware change worth knowing about."* `normalize` is pure and cannot log, and
 * a `console.log` here would be the first side effect on the migration seam.
 *
 * So the count rides on `SourceRef.meta`, which the contract already types as
 * `Record<string, string | number | boolean>` and already calls provenance. Two things come
 * free that a log line would not have given: it is durable, so "a sudden rise" is a query
 * over stored activities rather than a CloudWatch search that ages out; and it survives a
 * replay from the archive, so a rebuild years later reports the same number.
 *
 * OMITTED ENTIRELY WHEN THERE IS NO TRACE, and omitted rather than set to 0 when nothing was
 * rejected — an absent key means "nothing to say", and a `0` on a treadmill run would read as
 * "we sanitized a trace and it was clean", which is a claim about a trace that never existed.
 */
function sourceMeta(rejected: number | undefined): { meta?: Record<string, number> } {
  if (rejected === undefined || rejected === 0) return {}
  return { meta: { rejectedPoints: rejected } }
}

/**
 * The §2.7 composite key. **Cross-source, not just intra-source** — the same run arriving
 * via Strava and via Health Connect must collapse to one activity, and neither adapter can
 * see the other's ids. Time to the minute, distance to 50 m, elapsed to 30 s: coarse enough
 * that two devices' recordings of one run agree, fine enough that two real runs do not.
 *
 * Plain hex, matching `computeActivityId`. `03-integrations.md` §3's example JSON shows a
 * `"sha256:"` prefix, but §2.7's formula — which is the normative one — has no prefix, and
 * a key that is sometimes prefixed is a key that sometimes misses.
 */
function computeDedupeKey(
  userId: string,
  startedAtMs: number,
  distanceM: number | undefined,
  elapsedS: number,
): string {
  const parts = [
    userId,
    Math.floor(startedAtMs / 1000 / 60),
    Math.round((distanceM ?? 0) / 50),
    Math.round(elapsedS / 30),
  ]
  return createHash("sha256").update(parts.join("|")).digest("hex")
}

/** One stream's `data`, or `undefined` when the key is absent. Never indexes blindly. */
function streamData(streams: Record<string, StravaStream>, key: string): unknown[] | undefined {
  const data = streams[key]?.data
  return Array.isArray(data) ? data : undefined
}

/**
 * Is what Strava sent a DECIMATED view of the recording?
 *
 * `simplified` is the standing guard against the `summary_polyline` trap (D-121.4): a
 * permanent map cannot be built from a lossy trace, so a trace that IS lossy has to say so
 * rather than be silently trusted. Two independent signals, because either alone can be
 * absent:
 *
 *   - `data.length < original_size` — the response is telling you it dropped samples.
 *   - `resolution` is anything but `"high"` — `low` and `medium` are downsampled by
 *     definition.
 *
 * `fetchRaw` (0035) never sends `resolution`, so a full stream comes back `"high"` with
 * `original_size === data.length` and this returns false. If that ever stops being true,
 * this is the line that notices.
 */
function isDecimated(stream: StravaStream | undefined, pointCount: number): boolean {
  if (!stream) return false
  const originalSize = optionalNumber(stream.original_size)
  if (originalSize !== undefined && pointCount < originalSize) return true
  return typeof stream.resolution === "string" && stream.resolution !== "high"
}

/**
 * Zip the index-aligned streams into `GeoPoint[]` and measure the result.
 *
 * `assertStreamsAligned` has already run, so the lengths agree — but this still reads
 * `time` and `altitude` by INDEX with an explicit presence check rather than assuming, and
 * it checks for the `latlng` KEY before touching it. A treadmill run comes back with `time`,
 * `distance` and the two heart-rate-shaped streams and no `latlng` at all, with no flag
 * anywhere on the summary object; `streams.latlng.data[0]` is the crash that ships if this
 * is skipped.
 */
function buildTrace(
  streams: unknown,
  startedAtMs: number,
  kind: ActivityKind,
): { trace: Trace; rejected: number } | undefined {
  if (streams === null || typeof streams !== "object" || Array.isArray(streams)) return undefined

  assertStreamsAligned(streams)

  const byKey = streams as Record<string, StravaStream>

  /**
   * CHECK FOR THE KEY, DO NOT INDEX INTO IT. §2.6: a watch-recorded indoor run comes back
   * 200 with `time`, `distance` and its heart-rate-shaped streams and **no `latlng` key at
   * all**, with no flag anywhere on the summary object to warn you. `streams.latlng.data[0]`
   * is the crash that ships if this line is skipped, and it ships on a treadmill run, which
   * is the most ordinary thing the operator does in winter.
   *
   * No trace is a NORMAL outcome here, not an error path.
   */
  const latlng = streamData(byKey, "latlng")
  if (!latlng || latlng.length === 0) return undefined

  const time = streamData(byKey, "time")
  const altitude = streamData(byKey, "altitude")

  const zipped: GeoPoint[] = latlng.map((pair, i) => {
    if (!Array.isArray(pair) || typeof pair[0] !== "number" || typeof pair[1] !== "number") {
      throw new StravaNormalizeError(`latlng[${i}] is not a [lat, lng] pair`)
    }

    // TRAP 1. Strava's `time` is SECONDS SINCE START; `GeoPoint.t` is absolute epoch
    // milliseconds. A stream whose first entry is 0 must produce exactly `start_date`.
    const offsetS = optionalNumber(time?.[i])
    if (time && offsetS === undefined) {
      throw new StravaNormalizeError(`time[${i}] is not a number`)
    }

    const point: GeoPoint = {
      lat: pair[0],
      lng: pair[1],
      t: startedAtMs + (offsetS ?? i) * 1000,
    }

    // NEVER SYNTHESISED. An altitude the source did not give is absent, not zero and not
    // interpolated from its neighbours — `altM?` means "unknown" and a fabricated 0 would
    // read downstream as "sea level", which is a different and wrong claim.
    const altM = optionalNumber(altitude?.[i])
    if (altM !== undefined) point.altM = altM

    // `accuracyM` is deliberately never set. Strava's stream carries no accuracy at all
    // (05-fog-of-war.md §2.2), and absent means unknown — NOT zero, which would read as
    // a perfect fix.

    return point
  })

  /**
   * SANITATION RUNS BEFORE ANYTHING IS MEASURED. `gaps`, `bbox` and `pointCount` all
   * describe the trace that will be projected to H3, so measuring the unsanitized array
   * would put a rejected fix inside the bounding box and report a point count nothing
   * downstream ever sees.
   */
  const { points, breaks, rejected } = sanitizeTracePoints(zipped, kind)

  /**
   * `gaps` CARRIES BOTH MEANINGS — D-198. A time interval over `GAP_THRESHOLD_MS` (a pause,
   * a tunnel, a dropout) AND a sanitation break where a fix was thrown away. The contract's
   * original wording named only the first, which left the second with nowhere to go: an
   * outlier dropped between two 2-second samples breaks the trace without crossing any time
   * threshold, and the renderer would draw straight through it.
   *
   * One field rather than two, because both answer exactly one question — *may a corridor be
   * drawn across this?* — and a renderer that honoured `gaps` but forgot `breaks` would
   * leave a permanent scar on a map that never re-fogs.
   */
  const gapIndices = new Set<number>()
  for (let i = 1; i < points.length; i++) {
    if (points[i].t - points[i - 1].t > GAP_THRESHOLD_MS) gapIndices.add(i - 1)
  }
  for (const [from] of breaks) gapIndices.add(from)

  const gaps: Array<[number, number]> = [...gapIndices]
    .sort((a, b) => a - b)
    .map((i) => [i, i + 1])

  // Every fix rejected. A trace with no points is not a trace — see `sanitizeTracePoints`'s
  // note on a bad first anchor, and `0172`.
  if (points.length === 0) return undefined

  let minLng = points[0].lng
  let minLat = points[0].lat
  let maxLng = points[0].lng
  let maxLat = points[0].lat
  for (const p of points) {
    if (p.lng < minLng) minLng = p.lng
    if (p.lng > maxLng) maxLng = p.lng
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
  }

  return {
    trace: {
      points,
      gaps,
      // Measured against the ORIGINAL stream length, not the sanitized one. Dropping a
      // bogus fix does not make the source lossy — `simplified` is a statement about what
      // Strava sent, and conflating the two would make every sanitized trace look decimated.
      simplified: isDecimated(byKey.latlng, zipped.length),
      bbox: [minLng, minLat, maxLng, maxLat],
      pointCount: points.length,
    },
    rejected,
  }
}

/**
 * PHASE 3. Archived bytes in, canonical `{ activity, trace }` out. Synchronous, total in
 * its arguments, and reproducible forever.
 */
export function normalizeStrava(
  raw: Buffer,
  ref: RawArchiveRef,
  job: IngestJob,
): NormalizedIngest {
  const { detail: rawDetail, streams } = openRawEnvelope(raw)

  if (rawDetail === null || typeof rawDetail !== "object" || Array.isArray(rawDetail)) {
    throw new StravaNormalizeError("the archived envelope carries no detail object")
  }
  const detail = rawDetail as StravaDetail

  if (typeof detail.start_date !== "string") {
    throw new StravaNormalizeError("start_date is missing or not a string")
  }
  // Parsing a timestamp is pure and is NOT what the purity traps forbid — they trap the
  // zero-argument `new Date()` and `Date.now()`. This is the distinction that makes the
  // harness satisfiable instead of routed around.
  const startedAtMs = Date.parse(detail.start_date)
  if (Number.isNaN(startedAtMs)) {
    throw new StravaNormalizeError(`start_date is not a parseable instant: ${detail.start_date}`)
  }
  const startedAt = new Date(startedAtMs).toISOString()

  const elapsedS = optionalNumber(detail.elapsed_time)
  if (elapsedS === undefined) {
    throw new StravaNormalizeError("elapsed_time is missing or not a number")
  }

  const distanceM = optionalNumber(detail.distance)

  // The kind is needed BEFORE the trace, because the outlier gate is per-kind (D-197).
  const kind = mapSportTypeToKind(detail.sport_type)
  const built = buildTrace(streams, startedAtMs, kind)
  const trace = built?.trace

  const activity: Activity = {
    // Deterministic, which is the whole idempotency story: a webhook replayed three times
    // recomputes one id and overwrites, rather than leaving three copies of one run on a
    // map that cannot re-fog.
    activityId: computeActivityId(job.userId, job.source, job.externalId),
    userId: job.userId,
    kind,

    startedAt,
    startedAtLocal: stripLyingZ(detail.start_date_local),
    timezone: bareIanaZone(detail.timezone),

    elapsedS,
    movingS: optionalNumber(detail.moving_time),
    distanceM,
    elevationGainM: optionalNumber(detail.total_elevation_gain),
    name: typeof detail.name === "string" ? detail.name : undefined,

    source: {
      source: job.source,
      // VERBATIM, from the job. `openRawEnvelope` parses with exact ids so the detail's own
      // `id` is a string too, but the job's is the one the queue keyed on and they must not
      // be allowed to differ.
      externalId: job.externalId,
      // The vendor's own string, kept for debugging and for re-mapping an unknown sport
      // type out of the archive later. NEVER branched on outside this directory.
      sourceTypeRaw: typeof detail.sport_type === "string" ? detail.sport_type : "",
      // D-196: the archive PUT happens immediately after the fetch and BEFORE this function
      // runs (0039), so `archivedAt` is the closest true fetch instant a pure function can
      // see. `job.enqueuedAt` is the moment the job was QUEUED — before anything was
      // fetched — and would understate by however long the queue was backed up.
      fetchedAt: ref.archivedAt,
      ...sourceMeta(built?.rejected),
    },
    raw: ref,

    // BOTH ARE THE PIPELINE'S TO FILL. `traceRef` is the S3 key of the normalized trace,
    // which does not exist yet at the moment this runs — the contract's conflict 4 is
    // exactly this: `NormalizedIngest` is the in-flight output, `traceRef` is the persisted
    // pointer, and they are different moments rather than a disagreement.
    traceRef: null,
    hasTrace: trace !== undefined,

    // D-062: sets are carried in the model from day one and never come from Strava, which
    // has no concept of reps or exercise detail anywhere in its API (D-060).
    sets: [],

    dedupeKey: computeDedupeKey(job.userId, startedAtMs, distanceM, elapsedS),
    // THE CLOCK IS `ref.archivedAt`. Reaching for `Date.now()` here is the single most
    // common way this function stops being pure, and it would not survive a rebuild drill.
    ingestedAt: ref.archivedAt,
    revision: revisionFrom(job),
  }

  return trace ? { activity, trace } : { activity }
}
