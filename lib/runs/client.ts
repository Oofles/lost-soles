import { EMPTY_COLLECTION, RUNS_LATEST_PATH, type RunFeatureCollection } from "./wire"

/**
 * THE BROWSER HALF OF `/api/runs/latest`. Ticket `0057`. `05-fog-of-war.md` §4.4.
 *
 * One call, behind a seam, for the same reason `lib/fog/transport.ts` gives: the hook that owns
 * *when* to ask is worth testing with no network and no Next.js. There is no `since` and no ETag
 * — `0195`'s route explains why it has no cache key worth conditioning on.
 *
 * **This module must never import `lib/runs/server.ts`.** That file constructs a DynamoDB and an
 * S3 client at module scope; the shared shape lives in `wire.ts` precisely so this one does not
 * have to reach for it.
 */

type Fetch = typeof globalThis.fetch

export class RunFetchError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "RunFetchError"
  }
}

/**
 * The caller's latest traced run, or the empty collection.
 *
 * ─── 404 IS "SIGNED OUT", AND IT IS NOT AN ERROR HERE ───────────────────────
 *
 * `middleware.ts` answers a signed-out request with a 404 and `0195`'s route returns a
 * byte-identical body for a session it cannot read. Neither is a fault: `/` is the signed-out
 * landing route, so a signed-out map asking this question and being told nothing is the normal
 * path through the app. Every other non-2xx IS a fault and throws, so a broken deploy does not
 * present as a permanently missing line.
 */
export async function fetchLatestRun(
  fetchImpl: Fetch = globalThis.fetch,
): Promise<RunFeatureCollection> {
  const response = await fetchImpl(RUNS_LATEST_PATH, {
    credentials: "same-origin",
    /**
     * `no-store`, matching the route's own `Cache-Control`. The body is a precise record of
     * where one person ran (§9.10) and it has no revalidation token, so the browser holding a
     * copy could only ever make the answer older.
     */
    cache: "no-store",
  })

  if (response.status === 404) return EMPTY_COLLECTION
  if (!response.ok) {
    throw new RunFetchError(response.status, `GET ${RUNS_LATEST_PATH} returned ${response.status}`)
  }

  const body = (await response.json()) as RunFeatureCollection
  // A malformed body is treated as "no line" rather than allowed to reach MapLibre, which throws
  // from inside its own render loop on a bad `geojson` source and takes the whole map with it.
  if (!body || body.type !== "FeatureCollection" || !Array.isArray(body.features)) {
    return EMPTY_COLLECTION
  }
  return body
}
