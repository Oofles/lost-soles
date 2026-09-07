import { getOAuthConnector } from "@/src/adapters/registry"
import type { IngestJob } from "@/src/adapters/types"

import { markNeedsReauth } from "./source-account-store"
import { accessTokenFor } from "./token-refresh"

/**
 * THE MISSING HALF OF STEP 7. Ticket 0042, `01-architecture.md` §4 step 7.
 *
 * §4 says the worker's first act is *"read `{accessToken, refreshToken, expiresAt}` …
 * if `expiresAt` is within 5 min, refresh inline and write back"*, and every piece of
 * that already existed — `accessTokenFor` does the whole thing, lease and rotation
 * included. What did not exist was anything that turns a job into the object an adapter
 * takes as its credentials. `src/pipeline` cannot do it: it would have to reach the
 * connector registry and the credential store, and the second of those is a `lib/`
 * concern by construction.
 *
 * ─── THE SHAPE, AND THE ASSUMPTION IN IT ────────────────────────────────────
 *
 * `SourceAdapter<TCreds>` is generic precisely so no vendor's token shape becomes a
 * shared type, and this function returns ONE shape — two functions. That is an
 * assumption, and it is worth naming rather than leaving implicit: **an adapter that
 * authenticates with a rotating bearer token needs a way to get a fresh one and a way
 * to say the connection is dead, and nothing else.** Everything vendor-specific —
 * which endpoint, what a 401 means, how the token is presented — stays inside the
 * adapter's own client.
 *
 * It is FUNCTIONS rather than a token string for the reason 0033 records: a string here
 * would be a credential captured at some earlier instant, and the refresh-on-401 retry
 * inside the adapter's client needs to be able to ask again with `knownStale`.
 *
 * It lives in `lib/sources/` rather than in the contract for the same reason: if a
 * future adapter authenticates some other way, this function does not fit it and should
 * not be bent to. The contract stays generic; this is the concrete wiring for the
 * adapters that hold an OAuth connection, and `getOAuthConnector` is what refuses one
 * that does not.
 */
export interface OAuthAdapterCredentials {
  accessToken(opts?: { knownStale?: string }): Promise<string>
  markNeedsReauth(detail: string): Promise<void>
}

/**
 * Throws `UnknownAdapterError` for a source with no OAuth connection, and
 * `SourceNotConnectedError` / `SourceNeedsReauthError` — from `accessTokenFor`, lazily,
 * on first use — for one that is connected but unusable. All three are terminal for the
 * worker: none should be retried against the provider, which is what stops a revoked
 * authorisation becoming a retry storm.
 */
export function oauthCredentialsFor(job: IngestJob): OAuthAdapterCredentials {
  const connector = getOAuthConnector(job.source)

  return {
    accessToken: (opts) =>
      accessTokenFor({
        userId: job.userId,
        sourceId: job.source,
        connector,
        knownStale: opts?.knownStale,
      }),
    markNeedsReauth: (detail) =>
      markNeedsReauth({ userId: job.userId, sourceId: job.source, detail }),
  }
}
