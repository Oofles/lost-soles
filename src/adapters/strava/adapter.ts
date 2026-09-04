import { createHash } from "node:crypto"

import type { NormalizedIngest } from "@/src/domain/activity"

import type { AckResult, IngestJob, SourceAdapter } from "../types"
import { createStravaClient, type StravaClientDeps } from "./client"
import { parseWithExactIds } from "./json-ids"

/**
 * THE STRAVA ADAPTER. Ticket 0034 builds one of its four phases: `listSince`.
 *
 * `listSince` is MANDATORY, not optional (D-140, contract §3), and it is worth being
 * precise about what it defends against. Strava's webhook delivery is weak by design:
 * 200 within 2 seconds or the delivery failed, three retries, then the event is dropped
 * **permanently and silently** — no dead-letter queue, no replay, no notification
 * (`03-integrations.md` §2.3). Webhooks are a latency optimisation. THIS is the ingestion
 * path of record, and without it a missing run is undetectable.
 *
 * It is also the producer the manual Sync button runs on (roadmap §4.5), which is why it
 * is built before the webhook rather than after: it is required either way, and building
 * it first reaches the first-usable milestone about a capability sooner.
 */

/** §2.1's reconciliation call. 200 is the maximum; eight years of history is ~8 pages. */
const PER_PAGE = 200

/**
 * A guard, not a limit. A short page ends the loop, so this is only reachable if Strava
 * stops honouring `per_page` or a bug makes the page counter stand still — and an
 * infinite loop against a provider with a shared rate limit (§2.5) is a far worse failure
 * than a thrown error. 100 pages is 20,000 activities, about twelve times the five-year
 * worst case.
 */
const MAX_PAGES = 100

/**
 * What an `IngestJob` from this adapter carries in `meta`.
 *
 * IN `meta`, NOT AS FIELDS ON `IngestJob`. The contract calls `meta` "adapter-private
 * hints: an event's aspect type, an uploaded file's S3 key, a page cursor", which is
 * exactly this. Promoting `hasGpsHint` to the generic job type would put a signal one
 * adapter derives into the shape every adapter's queue messages share — the boundary
 * moving into the queue, which is the D-100 failure `check-boundaries.mjs` exists to
 * catch and could not catch here, because the word would be innocent.
 */
export interface StravaIngestMeta {
  /**
   * `"create"` for every job this sweep produces, and that is load-bearing rather than a
   * placeholder — see `ingestKeyFor`.
   */
  aspectType: "create"
  /**
   * WHETHER THIS ACTIVITY HAS GPS AT ALL, decided from the LIST response so that ticket
   * 0035 can skip the stream call entirely rather than spend one to learn nothing.
   *
   * That matters against §2.5's budget: the list endpoint is effectively free and the
   * stream calls are the entire cost, so every treadmill run this flag catches is a read
   * that never happens.
   */
  hasGpsHint: boolean
  /**
   * The activity's `start_date`, ISO 8601. THE WATERMARK BOUNDARY — the consumer needs it
   * to work out how far it got, and it is on the job because the job is the only thing
   * that survives the trip through the queue.
   */
  startedAt: string
  /** Strava's `sport_type`. Carried for §2.6's mapping, which is another ticket's work. */
  sportType?: string
}

/**
 * The credentials this adapter runs on: exactly `createStravaClient`'s dependencies.
 *
 * `SourceAdapter` is generic in `TCreds` precisely so a source can name what it needs, and
 * what this one needs is a way to get a live access token — not a token itself. Ticket
 * 0033's `accessTokenFor` refreshes proactively, serialises with a lease and persists a
 * rotation before returning, so taking the FUNCTION rather than a string inherits all of
 * that. A `{ accessToken: string }` here would be a credential captured at some earlier
 * instant, which is the thing 0033 exists to stop anyone doing.
 */
export type StravaCreds = StravaClientDeps & {
  /** Injectable clock, for `enqueuedAt`. Defaults to the real one. */
  now?: () => Date
}

export class StravaApiError extends Error {
  readonly status: number

  constructor(step: string, status: number) {
    super(`Strava ${step} failed with HTTP ${status}`)
    this.name = "StravaApiError"
    this.status = status
  }
}

class NotYetImplemented extends Error {
  constructor(phase: string, ticket: string) {
    super(`Strava adapter phase "${phase}" is not built yet — ticket ${ticket}`)
    this.name = "NotYetImplemented"
  }
}

/**
 * The activity fields this ticket reads. Deliberately partial: an adapter that declares
 * the vendor's whole schema has to be edited every time the vendor adds a field, and
 * §2.6's mapping is not this ticket's job.
 */
interface StravaSummaryActivity {
  id?: unknown
  athlete?: { id?: unknown }
  start_date?: unknown
  sport_type?: unknown
  manual?: unknown
  map?: { summary_polyline?: unknown }
}

/**
 * `sha256("<source>:<owner>:<object>:<aspect>")` — `01-architecture.md` §3 step 3, the
 * formula the webhook path uses.
 *
 * THE COLLISION IS THE POINT, and it looks like a bug until you see it. A sweep that finds
 * activity 42 and a webhook `create` for activity 42 produce the SAME `ingestKey`, so the
 * conditional `PutItem` on `IngestReceipt` accepts whichever arrives first and silently
 * drops the second. That is the entire reason the sweep can run every six hours over a
 * 48-hour window without ingesting everything eight times.
 *
 * It is also why `aspectType` is `"create"` here rather than something honest-looking like
 * `"sweep"`: a distinct aspect would mint a distinct key, and the sweep would duplicate
 * every activity the webhook already delivered.
 */
export function ingestKeyFor(externalOwnerId: string, externalId: string): string {
  return createHash("sha256")
    .update(`strava:${externalOwnerId}:${externalId}:create`)
    .digest("hex")
}

/**
 * HAS THIS ACTIVITY ANY GPS AT ALL? §2.6's "indoor / treadmill runs with no GPS".
 *
 * `summary_polyline` HAS EXACTLY TWO LEGITIMATE USES (D-121.4): a cheap bounding-box
 * prefilter, and this — has-GPS-at-all. This is one of them. **Rendering it, decoding it,
 * or projecting it to H3 is not**, because it is a decimated trace and a permanent map
 * built from one is permanently wrong.
 *
 * The value is read and DISCARDED. Nothing but this boolean leaves the function, so the
 * string never reaches an `IngestJob`, never reaches the queue, and never reaches anything
 * that could be tempted to decode it. `adapter.test.ts` asserts that directly, and also
 * that the identifier appears nowhere outside this directory.
 */
function hasGps(activity: StravaSummaryActivity): boolean {
  // A manual activity was typed in by hand. There was never a recording.
  if (activity.manual === true) return false
  const polyline = activity.map?.summary_polyline
  return typeof polyline === "string" && polyline.length > 0
}

/** Strava sends ids as JSON numbers; `parseWithExactIds` has already made them strings. */
function idToString(value: unknown, what: string): string {
  if (typeof value === "string" && /^\d+$/.test(value)) return value
  throw new Error(`Strava returned a ${what} that is not an exact integer id`)
}

export const stravaAdapter: SourceAdapter<StravaCreds> = {
  id: "strava",

  /**
   * THE OTHER THREE PHASES ARE STUBS, and stubs that throw rather than return something
   * empty. `listSince` is what this ticket builds; `accept`, `fetchRaw` and `normalize`
   * are named tickets of their own.
   *
   * They exist at all because criterion 1 asks for `listSince` on an object that satisfies
   * `SourceAdapter` WITHOUT A CAST, and a cast is exactly how a half-built adapter gets
   * mistaken for a whole one. This object type-checks, and calling an unbuilt phase says
   * which ticket builds it.
   *
   * FOR THE SAME REASON IT IS NOT IN `registry.ts`'s `ADAPTERS` YET. `getAdapter("strava")`
   * should never hand back something that throws on three of its four phases; registration
   * lands with `normalize` in 0036.
   */
  accept(): Promise<AckResult> {
    throw new NotYetImplemented("accept", "0093")
  },

  fetchRaw(): Promise<{ body: Buffer; contentType: string; ext: string }> {
    throw new NotYetImplemented("fetchRaw", "0035")
  },

  normalize(): NormalizedIngest {
    throw new NotYetImplemented("normalize", "0036")
  },

  /**
   * `GET /api/v3/athlete/activities?after=&page=&per_page=200`, paged until a short page.
   *
   * AN ASYNC GENERATOR, and the two reasons are both in the ticket. A consumer can `break`
   * and the loop stops — no further HTTP — because `for await` calls `return()` on the
   * generator, which unwinds at the `yield`. And a backfill never materialises 1,600 jobs
   * in memory, because each one is produced on demand.
   *
   * IT DOES NOT ADVANCE THE WATERMARK, and it structurally cannot: it knows what Strava
   * returned and has no idea what reached the queue. Advancing on the strength of a list
   * call succeeding is precisely the mistake `lib/sources/list-since-watermark.ts` is
   * written to prevent. The two consumers that DO know — the manual Sync (ticket 0043) and
   * the scheduled sweep (ticket 0095) — call `nextListSinceWatermark` and then
   * `advanceListSinceWatermark` once their enqueues have landed.
   */
  async *listSince(userId: string, watermark: string, creds: StravaCreds): AsyncIterable<IngestJob> {
    const client = createStravaClient(creds)
    const now = creds.now ?? (() => new Date())

    const afterMs = Date.parse(watermark)
    if (Number.isNaN(afterMs)) {
      throw new Error(`listSince watermark is not an ISO 8601 instant: ${JSON.stringify(watermark)}`)
    }
    // Strava's `after` is EXCLUSIVE and in epoch seconds. The overlap margin that makes
    // the boundary forgiving is applied to the watermark by the caller, not here — this
    // function is a faithful reading of whatever window it was handed.
    const after = Math.floor(afterMs / 1000)

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const res = await client.get("/athlete/activities", {
        after: String(after),
        page: String(page),
        per_page: String(PER_PAGE),
      })

      if (!res.ok) throw new StravaApiError("activity list", res.status)

      /**
       * `.text()` and not `.json()`, because `parseWithExactIds` needs the source
       * characters to keep an int64 id exact. `res.json()` would corrupt the id before
       * this code ever saw it — silently, which §2.7 opens by warning about.
       */
      const activities = parseWithExactIds(await res.text())
      if (!Array.isArray(activities)) {
        throw new Error("Strava's activity list was not a JSON array")
      }

      for (const activity of activities as StravaSummaryActivity[]) {
        yield toIngestJob(userId, activity, now())
      }

      // A short page is the end of the list. Checked AFTER yielding, so the final page's
      // activities are delivered rather than dropped by an early return.
      if (activities.length < PER_PAGE) return
    }

    throw new Error(
      `Strava's activity list did not end within ${MAX_PAGES} pages of ${PER_PAGE}; refusing to page further`,
    )
  },
}

function toIngestJob(userId: string, activity: StravaSummaryActivity, now: Date): IngestJob {
  const externalId = idToString(activity.id, "activity id")
  const externalOwnerId = idToString(activity.athlete?.id, "athlete id")

  const startedAt = activity.start_date
  if (typeof startedAt !== "string" || Number.isNaN(Date.parse(startedAt))) {
    throw new Error(`Strava activity ${externalId} carried no usable start_date`)
  }

  const meta: StravaIngestMeta = {
    aspectType: "create",
    hasGpsHint: hasGps(activity),
    startedAt: new Date(startedAt).toISOString(),
    ...(typeof activity.sport_type === "string" ? { sportType: activity.sport_type } : {}),
  }

  return {
    ingestKey: ingestKeyFor(externalOwnerId, externalId),
    userId,
    source: "strava",
    externalId,
    command: "ingest",
    meta,
    enqueuedAt: now.toISOString(),
  }
}
