/**
 * The error vocabulary shared across the OAuth boundary. Ticket 0033.
 *
 * WHY A SEPARATE MODULE. `types.ts` states plainly that it emits no runtime code, and
 * an error class is runtime code. But both halves of the boundary need to agree about
 * these two conditions: the adapter is what learns them (it is the one talking to the
 * provider), and `lib/sources/` is what acts on them (it is the one holding the row).
 *
 * The alternative — the adapter exporting its own named error and the storage layer
 * matching on it — is exactly what D-100 forbids. `lib/sources/token-refresh.ts` cannot
 * import `StravaOAuthError` without putting a vendor's name in generic code, and
 * `check-boundaries.mjs` would be right to fail it.
 */

import type { SourceId } from "@/src/domain/activity"

/**
 * A non-2xx or unparseable response from a provider's OAuth endpoints.
 *
 * THE RESPONSE BODY IS NOT ATTACHED AND NOT LOGGED. An OAuth error body routinely
 * echoes the request back, which on a token endpoint means the client secret — so the
 * one place it would be most useful for debugging is the one place it must not be
 * (O-005, `08-security-privacy.md` §7.4).
 */
export class OAuthProviderError extends Error {
  readonly step: string
  readonly status: number

  constructor(provider: string, step: string, status: number) {
    super(`${provider} ${step} failed with HTTP ${status}`)
    this.name = "OAuthProviderError"
    this.step = step
    this.status = status
  }

  /**
   * Whether this status means THE CREDENTIAL IS DEAD rather than the provider is
   * having a bad minute. The distinction decides between `NEEDS_REAUTH` — which stops
   * the connection and asks a human to act — and a retry.
   *
   * 400 and 401 from a TOKEN endpoint are the dead cases: RFC 6749 §5.2 specifies
   * `invalid_grant` as a 400, and that is what a provider returns for a refresh token
   * that has been rotated away, revoked, or expired. Everything else — 429, 500, 502,
   * a timeout — is transient, and marking `NEEDS_REAUTH` on one of those would send the
   * operator through a full re-authorization to fix a five-minute outage.
   *
   * Getting this backwards in either direction is a real bug. Too eager, and a blip
   * costs a reconnect. Too reluctant, and a genuinely dead connection retry-storms
   * against the provider forever while the settings screen claims to be healthy.
   */
  get credentialIsDead(): boolean {
    return this.status === 400 || this.status === 401
  }
}

/**
 * The connection cannot be used and no amount of retrying will change that: a human
 * has to re-authorize. Thrown once, by whichever layer discovers it, and never
 * retried by the caller — the whole point of `status: NEEDS_REAUTH` is to convert an
 * unbounded retry loop into one row and one "reconnect" button (`02-data-model.md` T7,
 * `01-architecture.md` §4).
 */
export class SourceNeedsReauthError extends Error {
  readonly source: SourceId
  /** Why, in words, for the log line. Never carries a credential. */
  readonly detail: string

  constructor(source: SourceId, detail: string) {
    super(`Source "${source}" needs re-authorization: ${detail}`)
    this.name = "SourceNeedsReauthError"
    this.source = source
    this.detail = detail
  }
}

/**
 * There is no usable connection for this (user, source) at all — never connected, or
 * disconnected. Distinct from `SourceNeedsReauthError` because the two mean different
 * things to a caller: one is a connection that broke, the other is a connection that
 * was never there. A sweep over "every connected source" treating them alike would
 * either re-prompt for sources the user deliberately removed, or swallow a real break.
 */
export class SourceNotConnectedError extends Error {
  readonly source: SourceId

  constructor(source: SourceId) {
    super(`No active connection for source "${source}"`)
    this.name = "SourceNotConnectedError"
    this.source = source
  }
}
