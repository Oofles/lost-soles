import { log } from "@/lib/log"
import { markDisconnected } from "@/lib/sources/source-account-store"
import { accessTokenFor } from "@/lib/sources/token-refresh"
import { SourceNeedsReauthError, SourceNotConnectedError } from "@/src/adapters/errors"
import { getOAuthConnector } from "@/src/adapters/registry"
import type { DisconnectMessage } from "@/src/pipeline/disconnect-message"

/**
 * A DEAUTHORIZATION, CONFIRMED BEFORE IT IS BELIEVED. Ticket 0093, D-348 (operator Q1 = A′).
 *
 * The webhook turns a provider's "this athlete revoked you" event into a `DisconnectMessage`
 * (`src/pipeline/disconnect-message.ts`). The event is unsigned (`08-security-privacy.md` §4.1),
 * and anyone who knows the athlete id (public) and the subscription id (a small integer) can send
 * one. Acting on it blindly would let a stranger delete our tokens and force a reconnect: no data
 * lost (§6.5), but §4.1's promise that a forged event is WORTHLESS would be false for this one.
 *
 * So the claim is checked against the one party that knows: the provider. A FORCED REFRESH of the
 * stored refresh token, through `accessTokenFor` — the same lease (`acquireRefreshLease`), the
 * same conditional rotation, the same write-back as every other refresh, so this path can never
 * race the worker or the refresh sweep into losing a rotated token.
 *
 *   - The provider REJECTS it as dead (`credentialIsDead`, surfaced as `SourceNeedsReauthError`):
 *     the revocation is real. Mark the row `DISCONNECTED`, tokens removed (`markDisconnected`,
 *     §6.5 — the map, ledger and history are not touched).
 *   - The provider ACCEPTS it: the event was forged, or stale. The rotated tokens are already
 *     persisted by the refresh, the connection stays `ACTIVE`, and the event is dropped and logged.
 *   - There is nothing to refresh (`SourceNotConnectedError`): already disconnected — a Strava
 *     retry of an event we already acted on. Nothing to do.
 *   - Anything else (a 5xx, a timeout, a lease never released) is THROWN, so SQS redelivers and
 *     a transient fault cannot be mistaken for either answer.
 *
 * A row already in `NEEDS_REAUTH` refuses at load with `SourceNeedsReauthError` too, and is
 * disconnected: that state is only written when the provider has already rejected the credential
 * (or the grant lacks a required scope), so there is no live token a forgery could cost us.
 */
export type DeauthorizationOutcome = "disconnected" | "forged-or-stale" | "already-disconnected"

export interface DeauthorizationDeps {
  /** Forces a refresh through the lease; resolves if the credential is live. */
  forceRefresh(input: { userId: string; source: string }): Promise<void>
  markDisconnected(input: { userId: string; sourceId: string; now?: Date }): Promise<void>
  now?: () => Date
}

/**
 * Any window wider than a token's whole life makes `accessTokenFor` treat the stored token as
 * due, which is how a refresh is forced without a second refresh path.
 */
const FORCE_REFRESH_WINDOW_SECONDS = Number.MAX_SAFE_INTEGER

export const defaultDeauthorizationDeps: DeauthorizationDeps = {
  async forceRefresh({ userId, source }) {
    await accessTokenFor({
      userId,
      sourceId: source,
      connector: getOAuthConnector(source as DisconnectMessage["source"]),
      refreshWithinSeconds: FORCE_REFRESH_WINDOW_SECONDS,
    })
  },
  markDisconnected,
}

export async function handleDeauthorization(
  message: DisconnectMessage,
  deps: DeauthorizationDeps = defaultDeauthorizationDeps,
): Promise<DeauthorizationOutcome> {
  const { userId, source } = message
  let outcome: DeauthorizationOutcome
  try {
    await deps.forceRefresh({ userId, source })
    outcome = "forged-or-stale"
  } catch (error) {
    if (error instanceof SourceNotConnectedError) {
      outcome = "already-disconnected"
    } else if (error instanceof SourceNeedsReauthError) {
      await deps.markDisconnected({ userId, sourceId: source, now: deps.now?.() })
      outcome = "disconnected"
    } else {
      throw error
    }
  }
  // The outcome and the source only. Never a token, never a provider message.
  log.info({ at: "process-activity", event: "deauthorization", source, outcome })
  return outcome
}
