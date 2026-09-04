import { log } from "@/lib/log"
import { getOAuthClientCredentials } from "@/lib/sources/oauth-credentials"
import {
  acquireRefreshLease,
  loadCredentials,
  markNeedsReauth,
  releaseRefreshLease,
  rotateTokens,
} from "@/lib/sources/source-account-store"
import {
  OAuthProviderError,
  SourceNeedsReauthError,
  SourceNotConnectedError,
} from "@/src/adapters/errors"
import type { OAuthConnector } from "@/src/adapters/types"

/**
 * THE TOKEN LIFECYCLE. Ticket 0033. `03-integrations.md` §2.2, `02-data-model.md` T7.
 *
 * One exported function — `accessTokenFor` — and everything else here is in service of
 * the one guarantee it makes:
 *
 *   THE TOKEN IT RETURNS IS ALREADY PERSISTED.
 *
 * That sentence is the ticket. A caller cannot use a refreshed access token before its
 * partner refresh token is durable, because the value does not exist outside this
 * module until the write has succeeded. Criterion 6 asks for that to be asserted by
 * ordering rather than by comment, and the ordering is structural: the `return` is
 * downstream of the `await` on the write, so there is no code path that skips it and no
 * future edit that can accidentally reorder them without deleting a line.
 *
 * SOURCE-AGNOSTIC, and that is not incidental. Nothing here names a provider, a scope,
 * a host or a token TTL. The connector supplies the exchange and the required scopes;
 * the store supplies the row. Swapping the primary source (D-121.1) does not touch this
 * file, which is the claim `check-boundaries.mjs` exists to keep honest.
 */

/**
 * REFRESH AT `expiresAt - 300s`. Criterion 5, and `03-integrations.md` §2.2's rule.
 *
 * Five minutes is a skew budget, not a guess about how long a refresh takes. It has to
 * cover the gap between "we checked the clock" and "the provider evaluates the token",
 * which spans this process's clock error, network time, and however long the caller
 * sits between getting a token and using it. Anything smaller starts losing the race to
 * ordinary clock drift on a Lambda.
 *
 * WHY PROACTIVE AND NOT ON-401: a 401 mid-consume costs a wasted request, a refresh,
 * and a retry — three round trips against a provider whose read budget is 100 per 15
 * minutes (§2.5). Doing it before the call costs zero extra requests in the common case
 * because the refresh was going to happen anyway.
 *
 * NOTE THIS IS A DIFFERENT NUMBER FROM T7's "sweeps anything within 4 h", and they do
 * not conflict. That is the scheduled `token-refresh` Lambda (01 resource #14, ticket
 * 0094) keeping connections warm on a timer; this is the last-moment check by the
 * caller about to use the token. Both must exist: the sweep alone leaves a token that
 * expired between sweeps, and this alone leaves a connection that is never touched
 * between runs going stale unnoticed.
 */
export const REFRESH_SKEW_SECONDS = 300

/** See `acquireRefreshLease` for why fifteen. */
export const LEASE_SECONDS = 15

/**
 * How long a refresher that LOST the lease waits before giving up on the winner and
 * trying itself. Four polls at 250 ms — one second total, comfortably longer than a
 * token exchange and short enough that a user-facing Sync does not feel it.
 */
const LOSER_POLL_MS = 250
const LOSER_POLLS = 4

/**
 * The seams. Both default to the real thing and exist so the concurrency tests are
 * deterministic rather than timing-dependent — a race test that depends on a real clock
 * is a test that fails on a loaded CI box and gets deleted.
 */
export interface RefreshDeps {
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface AccessTokenRequest {
  userId: string
  sourceId: string
  connector: OAuthConnector
  /**
   * THE TOKEN THAT JUST GOT A 401, when there was one.
   *
   * Not a `force: boolean`, and the difference matters. A boolean says "refresh no
   * matter what", which under concurrency means a second refresher discards the token a
   * first one just fetched and refreshes again — a retry storm built out of two
   * correct-looking components. Passing the STALE VALUE instead asks the precise
   * question: is the row still holding the token that failed? If another refresher has
   * already replaced it, the answer is no and there is nothing to do.
   */
  knownStale?: string
}

/**
 * Returns a usable access token for one connection, refreshing if it is within the skew
 * window — and never returning one that has not been written to the row first.
 *
 * Throws `SourceNotConnectedError` when there is nothing to use, and
 * `SourceNeedsReauthError` when a human has to act. Both are terminal for the caller:
 * neither should be retried, which is the whole point of the second one existing.
 */
export async function accessTokenFor(
  request: AccessTokenRequest,
  deps: RefreshDeps = {},
): Promise<string> {
  const now = deps.now ?? (() => new Date())
  const sleep = deps.sleep ?? realSleep

  const load = await loadCredentials({
    userId: request.userId,
    sourceId: request.sourceId,
    requiredScopes: request.connector.requiredScopes,
    now: now(),
  })
  if (!load.ok) throw refusal(request.sourceId, load.reason, load.detail)

  if (isUsable(load.credentials.accessToken, load.credentials.expiresAt, now(), request.knownStale)) {
    return load.credentials.accessToken
  }

  return refresh(request, { now, sleep })
}

/**
 * TWO QUESTIONS, ONE FUNCTION, and which one is asked depends on why we are here.
 *
 * On the ordinary path there is no stale token and the question is about time: is the
 * stored token still comfortably inside its life? On the post-401 path the clock is
 * irrelevant — the provider has already told us the token does not work, whatever
 * `expiresAt` claims — and the only question that matters is whether the row still
 * holds the value that failed.
 *
 * Answering the time question on the 401 path is the subtle bug this avoids: the row
 * would look fresh, the same dead token would come back, and the caller would 401
 * again against a connection that is now permanently broken in a way nothing detects.
 */
function isUsable(
  storedToken: string,
  expiresAt: number,
  now: Date,
  knownStale: string | undefined,
): boolean {
  if (knownStale !== undefined) return storedToken !== knownStale
  return Math.floor(now.getTime() / 1000) < expiresAt - REFRESH_SKEW_SECONDS
}

function refusal(
  sourceId: string,
  reason: "not-connected" | "needs-reauth",
  detail: string,
): Error {
  return reason === "needs-reauth"
    ? new SourceNeedsReauthError(sourceId, detail)
    : new SourceNotConnectedError(sourceId)
}

/**
 * The refresh itself, serialized by the lease and made safe by the condition.
 *
 * THE LOOP IS NOT A RETRY LOOP. Each pass is one of two distinct outcomes — we hold the
 * lease and refresh, or we do not and we wait for whoever does. It is bounded by
 * `LOSER_POLLS` so that a lease-holder who dies cannot make a caller wait forever; once
 * the lease expires, the next pass takes it and proceeds normally.
 */
async function refresh(
  request: AccessTokenRequest,
  deps: { now: () => Date; sleep: (ms: number) => Promise<void> },
): Promise<string> {
  const { userId, sourceId, connector } = request

  for (let attempt = 0; attempt <= LOSER_POLLS; attempt += 1) {
    const gotLease = await acquireRefreshLease({
      userId,
      sourceId,
      leaseSeconds: LEASE_SECONDS,
      now: deps.now(),
    })

    if (!gotLease) {
      /**
       * SOMEONE ELSE IS REFRESHING. Criterion 9's "waits or no-ops": we do not issue a
       * second exchange. We sleep, re-read, and take their result the moment it lands.
       */
      await deps.sleep(LOSER_POLL_MS)
      const published = await reread(request, deps.now())
      if (published !== null) return published
      continue
    }

    /**
     * RE-READ UNDER THE LEASE, before spending an exchange. Between the load in
     * `accessTokenFor` and this line, another refresher may have completed and released
     * — in which case the row already holds a fresh token and the correct number of
     * network calls to the provider is zero.
     *
     * One read, not two: it settles both "has someone else already done this?" and
     * "what refresh token do I key the conditional write on?", and those must be the
     * same read or the answer to the second is stale by the time it is used.
     */
    const current = await loadCredentials({
      userId,
      sourceId,
      requiredScopes: connector.requiredScopes,
      now: deps.now(),
    })
    if (!current.ok) {
      await release(userId, sourceId)
      throw refusal(sourceId, current.reason, current.detail)
    }

    const alreadyFresh = isUsable(
      current.credentials.accessToken,
      current.credentials.expiresAt,
      deps.now(),
      request.knownStale,
    )
    if (alreadyFresh) {
      await release(userId, sourceId)
      return current.credentials.accessToken
    }

    /**
     * THE VALUE THE CONDITIONAL WRITE WILL BE KEYED ON. Captured here, before the
     * network call, because that is what makes the condition mean "nothing changed
     * while I was away".
     */
    const previousRefreshToken = current.credentials.refreshToken

    let rotatedTokens
    try {
      rotatedTokens = await connector.refreshTokens({
        refreshToken: previousRefreshToken,
        credentials: await getOAuthClientCredentials(connector),
      })
    } catch (err) {
      await release(userId, sourceId)
      throw await classifyRefreshFailure(userId, sourceId, err, deps.now())
    }

    /**
     * ─────────────────────────────────────────────────────────────────────────
     * THE ORDERING THAT IS THE POINT OF THIS TICKET (criterion 6).
     * ─────────────────────────────────────────────────────────────────────────
     *
     * The provider has answered. `rotatedTokens.refreshToken` may be a NEW value, and
     * if it is, the one in the row above is already dead at the provider. The very next
     * thing that happens is the write. Not a log line, not a metric, not a helpful
     * early return — the write.
     *
     * WHAT A CRASH HERE COSTS, honestly (criterion 8, as amended). If this process dies
     * between the response arriving and the write landing, the row still holds the OLD
     * refresh token and status `ACTIVE`. Nothing has been blanked and nothing is
     * half-written, so the next attempt re-uses it — and if the provider had not
     * actually rotated, everything simply works. What no code on this side can fix is a
     * provider that killed the old token the instant it issued the new one: then the
     * connection genuinely needs re-authorization, and it will discover that on the next
     * attempt via a 400 and say so.
     *
     * That residual window cannot be closed from here — it is the at-least-once problem
     * with a third party holding the other half — and it is made as small as it can be
     * by there being literally nothing between the two statements.
     */
    let outcome
    try {
      outcome = await rotateTokens({
        userId,
        sourceId,
        previousRefreshToken,
        accessToken: rotatedTokens.accessToken,
        refreshToken: rotatedTokens.refreshToken,
        expiresAt: rotatedTokens.expiresAt,
        now: deps.now(),
      })
    } catch (err) {
      /**
       * The write itself failed — throttling, a network fault, the process being torn
       * down. The lease is handed back so the NEXT attempt is not stuck behind it for
       * fifteen seconds, and the error is rethrown untouched: nothing is marked, nothing
       * is blanked, and the row still holds the refresh token it had.
       *
       * A HARD CRASH cannot run this, and that is what the lease's expiry is for. This
       * covers the far commoner case of an error that unwinds normally.
       */
      await release(userId, sourceId)
      throw err
    }

    if (outcome.won) return rotatedTokens.accessToken

    /**
     * WE LOST THE RACE despite the lease — which is possible, because a lease can expire
     * while its holder is mid-exchange. Criterion 7's "the loser retries against the
     * winner's value rather than overwriting it": the write was already REFUSED by the
     * condition, so nothing was overwritten, and now we read what the winner stored.
     *
     * The token we hold is discarded unused. That is correct and not wasteful: using it
     * would mean using a credential whose partner refresh token is not in the row.
     */
    log.info("refresh lost the rotation race; using the winner's token", { source: sourceId })
    const winners = await reread(request, deps.now(), { ignoreExpiry: true })
    if (winners !== null) return winners
  }

  /**
   * Every pass was blocked by a lease that never published a result. Rare, and it means
   * something is genuinely stuck rather than merely contended — so it fails loudly
   * instead of looping, and the caller's own retry (if it has one) finds the lease
   * expired by then.
   */
  throw new Error(`Timed out waiting for a token refresh on source "${sourceId}"`)
}

/**
 * Re-reads the row and returns the stored access token IF another refresher has
 * published one we can use; `null` otherwise.
 *
 * `ignoreExpiry` is for the lost-race path, where the winner has just written and the
 * only question is whose value is in the row — asking about the clock there would
 * reject a token written half a second ago on a stale `knownStale` comparison.
 */
async function reread(
  request: AccessTokenRequest,
  now: Date,
  opts: { ignoreExpiry?: boolean } = {},
): Promise<string | null> {
  const load = await loadCredentials({
    userId: request.userId,
    sourceId: request.sourceId,
    requiredScopes: request.connector.requiredScopes,
    now,
  })
  if (!load.ok) throw refusal(request.sourceId, load.reason, load.detail)

  if (opts.ignoreExpiry) return load.credentials.accessToken
  return isUsable(load.credentials.accessToken, load.credentials.expiresAt, now, request.knownStale)
    ? load.credentials.accessToken
    : null
}

/**
 * A failed release is swallowed. The lease expires on its own in fifteen seconds, so
 * the cost of losing this call is a short delay; the cost of letting it mask the real
 * error underneath — which is always something more interesting — is a debugging
 * session spent on the wrong exception.
 */
async function release(userId: string, sourceId: string): Promise<void> {
  try {
    await releaseRefreshLease({ userId, sourceId })
  } catch (err) {
    log.warn("could not release the refresh lease; it will expire on its own", { source: sourceId }, err)
  }
}

/**
 * DEAD CREDENTIAL OR BAD MINUTE? The single most consequential branch on this path.
 *
 * `credentialIsDead` is the adapter's judgement, carried across the boundary on the
 * error (see `src/adapters/errors.ts` for why 400 and 401 and nothing else). A dead
 * credential marks the row and stops everything; anything else is rethrown untouched so
 * the caller's ordinary error handling — and, later, its backoff — sees a transient
 * failure as transient.
 *
 * Marking `NEEDS_REAUTH` on a 500 would send the operator through a full OAuth flow to
 * repair a five-minute outage that fixed itself.
 */
async function classifyRefreshFailure(
  userId: string,
  sourceId: string,
  err: unknown,
  now: Date,
): Promise<unknown> {
  if (err instanceof OAuthProviderError && err.credentialIsDead) {
    const detail = `the provider rejected the refresh token with HTTP ${err.status}`
    await markNeedsReauth({ userId, sourceId, detail, now })
    log.warn("connection needs re-authorization", { source: sourceId, detail })
    return new SourceNeedsReauthError(sourceId, detail)
  }
  return err
}
