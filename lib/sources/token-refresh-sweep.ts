import { log } from "@/lib/log"
import { listRefreshCandidates } from "@/lib/sources/source-account-store"
import {
  accessTokenFor,
  REFRESH_SKEW_SECONDS,
  type RefreshDeps,
} from "@/lib/sources/token-refresh"
import { SourceNeedsReauthError, SourceNotConnectedError } from "@/src/adapters/errors"
import { OAUTH_CONNECTORS } from "@/src/adapters/registry"
import type { OAuthConnector } from "@/src/adapters/types"
import type { SourceId } from "@/src/domain/activity"

/**
 * THE SCHEDULED SWEEP. Ticket 0094. `03-integrations.md` §2.2, `02-data-model.md` T7,
 * `01-architecture.md` §2 resource #14.
 *
 * This file is the schedule's half of the token lifecycle and nothing else. The refresh
 * exchange, the lease, the conditional rotation write-back and the dead-grant marking
 * are all `accessTokenFor` (ticket 0033), called here with a wider "is it due" window.
 * There is no second HTTP exchange and no second write path, which is the point: the
 * rotation discipline that ticket fought for is inherited, not re-implemented.
 *
 * WHY IT EXISTS when `accessTokenFor` already refreshes at `expiresAt - 300s`: that check
 * runs inside whichever caller is about to use the token, and the caller most likely to
 * be first after an expiry is `process-activity`, on a webhook's clock. If the token
 * endpoint has a bad minute right then, the ingest fails. The sweep moves the exchange
 * off that path entirely — by the time a webhook arrives the token is already fresh, and
 * the worker issues zero token calls.
 */

/**
 * The schedule, in seconds. MUST MATCH `amplify/functions/token-refresh/resource.ts`'s
 * `schedule`; the synth test asserts the rule against this number.
 */
export const SWEEP_INTERVAL_SECONDS = 4 * 60 * 60

/**
 * "The next window plus margin" (ticket 0094 criterion 2). Anything expiring before the
 * NEXT run, plus the five-minute skew `accessTokenFor` would refresh at anyway, is
 * refreshed now — so no token can reach its last-moment check between two runs.
 *
 * Against Strava's six-hour tokens that means a token is refreshed at the first run that
 * finds it with less than 4 h 05 m left — so it always has at least five minutes left
 * when the sweep reaches it, and the inline check never fires in normal running.
 *
 * WHAT A TRANSIENT FAILURE COSTS, honestly: the next run is four hours later, by which
 * time that token is inside its last five minutes or past expiry. Nothing is lost — the
 * refresh token is still good, so the next run refreshes it, and any caller in between
 * falls back to `accessTokenFor`'s own inline refresh. But between those two points the
 * schedule is not protecting the worker; one failed run reopens the window it closes.
 */
export const SWEEP_HORIZON_SECONDS = SWEEP_INTERVAL_SECONDS + REFRESH_SKEW_SECONDS

/** What one run did, per connection. Carries no credential, by construction. */
export type SweepOutcome = "refreshed" | "needsReauth" | "skipped" | "failed"

export interface SweepResult {
  examined: number
  refreshed: number
  needsReauth: number
  skipped: number
  failed: number
}

export interface SweepDeps extends RefreshDeps {
  /** The connector for a source, or `undefined` for one that does not use OAuth. */
  connectorFor?: (sourceId: string) => OAuthConnector | undefined
}

const registryConnector = (sourceId: string): OAuthConnector | undefined =>
  OAUTH_CONNECTORS[sourceId as SourceId]

/**
 * One pass over every connection due a refresh.
 *
 * NEVER THROWS FOR ONE CONNECTION. A failure on one row is classified, logged without
 * any credential, and the loop moves on. It does throw if the candidate scan itself
 * fails — that is a real error worth an invocation failure in CloudWatch, and it has
 * touched no row.
 *
 * NO RETRY WITHIN A RUN, for either failure kind (criteria 7 and 8):
 *  - a dead grant is marked `NEEDS_REAUTH` by `accessTokenFor` and will never be offered
 *    to a later run either (`listRefreshCandidates` reads `ACTIVE` only);
 *  - a transient failure leaves the row exactly as it was — `accessTokenFor` releases its
 *    lease and rethrows — and the next scheduled run, four hours on, is the retry (see
 *    `SWEEP_HORIZON_SECONDS` for what that gap costs).
 */
export async function sweepExpiringTokens(deps: SweepDeps = {}): Promise<SweepResult> {
  const now = deps.now ?? (() => new Date())
  const connectorFor = deps.connectorFor ?? registryConnector

  const cutoff = Math.floor(now().getTime() / 1000) + SWEEP_HORIZON_SECONDS
  const candidates = await listRefreshCandidates({ expiringBefore: cutoff })

  const result: SweepResult = {
    examined: candidates.length,
    refreshed: 0,
    needsReauth: 0,
    skipped: 0,
    failed: 0,
  }

  for (const candidate of candidates) {
    const outcome = await refreshOne(candidate, connectorFor, deps)
    result[outcome] += 1
  }

  log.info("token-refresh sweep complete", result)
  return result
}

async function refreshOne(
  candidate: { userId: string; sourceId: string },
  connectorFor: (sourceId: string) => OAuthConnector | undefined,
  deps: RefreshDeps,
): Promise<SweepOutcome> {
  const { userId, sourceId } = candidate
  const connector = connectorFor(sourceId)
  if (connector === undefined) {
    log.warn("token-refresh: a connection row names a source with no OAuth connector", {
      source: sourceId,
    })
    return "skipped"
  }

  try {
    /**
     * THE RETURNED TOKEN IS DISCARDED, unread. `accessTokenFor` has already persisted it
     * (and its partner refresh token, rotated or not) before returning — that is its
     * contract — so the sweep has nothing to do with the value, and not holding it in a
     * variable is the simplest way to guarantee it is never logged.
     */
    await accessTokenFor(
      { userId, sourceId, connector, refreshWithinSeconds: SWEEP_HORIZON_SECONDS },
      deps,
    )
    return "refreshed"
  } catch (err) {
    if (err instanceof SourceNeedsReauthError) {
      // Already marked by `accessTokenFor`; the plinth's reconnect line reads that mark.
      log.warn("token-refresh: connection needs re-authorization", {
        source: sourceId,
        detail: err.detail,
      })
      return "needsReauth"
    }
    if (err instanceof SourceNotConnectedError) {
      // Disconnected between the scan and the load. Nothing to do, and nothing to say.
      return "skipped"
    }
    /**
     * TRANSIENT. The row is untouched; the next run retries. Only the message is logged —
     * every error on this path is built from a provider name, a step and a status, and
     * `log` redacts by key name on top of that.
     */
    log.warn("token-refresh: transient failure, leaving for the next run", {
      source: sourceId,
      error: err instanceof Error ? err.message : String(err),
    })
    return "failed"
  }
}
