import { SourceNeedsReauthError } from "../errors"

/**
 * The authenticated HTTP client. Ticket 0033, `03-integrations.md` §2.1/§2.2.
 *
 * WHAT IS VENDOR-SPECIFIC HERE, and therefore why this file is in the adapter rather
 * than in `lib/`: the API host, and the convention that an expired credential is
 * signalled by 401. Neither is universal — a provider is perfectly free to answer 403,
 * or 200 with an error body — and a generic client that assumed Strava's answer would
 * be a Strava-shaped assumption living outside the adapter, which is the thing D-100
 * forbids.
 *
 * WHAT IS NOT HERE, deliberately:
 *
 *   - Where tokens are stored. `deps.accessToken` is a function; this file does not
 *     know a DynamoDB table exists.
 *   - When to refresh. The `expiresAt - 300s` decision is `lib/sources/token-refresh.ts`'s,
 *     because it is a rule about a stored row and not about HTTP.
 *   - Rate limiting and backoff. §2.5's read-budget handling is a separate concern with
 *     its own ticket; adding it here would make this file two things.
 *
 * The 401 policy IS here, because it is the half of the token lifecycle that only shows
 * up as an HTTP response.
 */

const API_BASE = "https://www.strava.com/api/v3"

/**
 * Everything the client needs from the outside world, as functions. This is the seam
 * that keeps the file testable without a network or a database, and it is also the
 * boundary that keeps the adapter free of storage.
 */
export interface StravaClientDeps {
  /**
   * Returns a usable access token, refreshing first if necessary. `knownStale` is
   * passed on the retry after a 401 and means "the row still holding THIS value is
   * stale" — see `AccessTokenRequest.knownStale` for why that is a value and not a
   * boolean.
   */
  accessToken(opts?: { knownStale?: string }): Promise<string>
  /** Marks the connection as needing a human. Called at most once per request. */
  markNeedsReauth(detail: string): Promise<void>
  /** Injectable for tests. Defaults to the platform `fetch`. */
  fetch?: typeof fetch
}

export interface StravaClient {
  /** `path` is relative to the v3 API root, e.g. `/athlete/activities`. */
  get(path: string, query?: Record<string, string>): Promise<Response>
}

export function createStravaClient(deps: StravaClientDeps): StravaClient {
  const doFetch = deps.fetch ?? fetch

  return {
    async get(path, query) {
      const url = new URL(`${API_BASE}${path}`)
      for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v)

      /**
       * FIRST ATTEMPT. `accessToken()` has already refreshed proactively if the stored
       * token was inside its skew window, so on the ordinary path this 401 branch never
       * runs — which is the point of refreshing on the clock rather than on failure
       * (§2.5's read budget is 100 per 15 minutes; a 401-then-retry spends three
       * requests where one would do).
       */
      const token = await deps.accessToken()
      const first = await doFetch(url, authorized(token))
      if (first.status !== 401) return first

      /**
       * A 401 ANYWAY. The stored token was inside its window and the provider still
       * refused it — a token revoked at the provider's end, a clock further out than the
       * skew allows for, or a refresh that landed elsewhere. All three are repaired the
       * same way: refresh once, keyed on the value that just failed.
       *
       * `accessToken({ knownStale })` may return WITHOUT refreshing, if a concurrent
       * refresher already replaced the row's token. That is the correct outcome and not
       * a missed refresh — the token that failed is gone either way.
       */
      const retryToken = await deps.accessToken({ knownStale: token })
      const second = await doFetch(url, authorized(retryToken))
      if (second.status !== 401) return second

      /**
       * TWO 401s ACROSS A REFRESH (criterion 10). The credential is dead in a way a
       * refresh does not fix, and this is where the retrying stops — not after five
       * attempts with backoff, not on a schedule. Once.
       *
       * WHY STOPPING IS THE FEATURE. A retry loop here would hammer a provider whose
       * rate limit is shared across every athlete using this app, to obtain a credential
       * that no amount of asking will produce, while the settings screen shows a healthy
       * connection. Writing `NEEDS_REAUTH` converts an unbounded loop into one row and
       * one button: the next call refuses at the store before any HTTP happens, and the
       * operator sees "reconnect" instead of a spinner (`02-data-model.md` T7).
       */
      const detail = "two consecutive 401s across a refresh"
      await deps.markNeedsReauth(detail)
      throw new SourceNeedsReauthError("strava", detail)
    },
  }
}

/**
 * The Authorization header, built in one place.
 *
 * `Bearer <token>` is the ONE shape `lib/log.ts`'s pattern list can catch on its own,
 * which is a small piece of defence in depth for the one credential form that travels
 * as a bare string rather than as a named field.
 */
function authorized(accessToken: string): RequestInit {
  return {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    },
  }
}
