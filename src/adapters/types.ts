/**
 * THE ADAPTER INTERFACE — the source-facing half of the D-100 boundary.
 * `src/domain/activity.ts` is the other half; nothing but `NormalizedIngest` crosses
 * between them.
 *
 * Transcribed from `docs/contracts/ingestion-contract.md` §3, which wins wherever
 * `01-architecture.md` §3 disagrees (D-140). TYPES ONLY — this module emits no runtime
 * code, and it names no concrete adapter. That is `registry.ts`'s single job.
 *
 * §3 specifies `SourceAdapter` and `IngestCommand` completely but only *references*
 * `InboundRequest`, `AckResult` and `IngestJob`. Their shapes are settled here, and the
 * reasoning is recorded on each one rather than left to be re-derived.
 *
 * Ticket 0026.
 */

import type { NormalizedIngest, RawArchiveRef, SourceId } from "@/src/domain/activity"

/** Re-exported so an adapter imports its whole vocabulary from one module. */
export type { RawArchiveRef }

/**
 * What the public endpoint hands `accept()`. Transport-agnostic on purpose: the same
 * adapter is driven by an API route, a Lambda URL and a test, and none of their request
 * objects should reach an adapter.
 *
 * `rawBody` is BYTES, never parsed JSON. A webhook signature is computed over the exact
 * bytes the source sent, so a body that has been through `JSON.parse` + `stringify` can
 * no longer be verified — the round trip reorders keys and drops insignificant
 * whitespace. Parsing is the adapter's job, after it has checked the signature.
 */
export interface InboundRequest {
  source: SourceId
  method: string
  /** Lower-cased keys. Node, Next and Lambda disagree on casing; adapters should not care. */
  headers: Readonly<Record<string, string>>
  query: Readonly<Record<string, string>>
  rawBody: Buffer
}

/**
 * Which of the two job-carrying intents an `IngestJob` represents.
 *
 * `IngestJob.command` is this NARROW union and not `IngestCommand`, because
 * `IngestCommand`'s `ingest`/`reingest` variants carry an `IngestJob` — a job holding a
 * full command would nest without end. `retract` and `disconnect` carry no job at all,
 * so they cannot appear here.
 */
export type IngestCommandKind = "ingest" | "reingest"

/**
 * What the endpoint layer produces and the queue carries. Serialisable — it round-trips
 * through SQS as JSON, so no `Buffer`, no `Date`, no class instances.
 *
 * NOTHING VENDOR-SPECIFIC. `meta` is the pressure valve and it is deliberately opaque:
 * the moment a field here is named after something only one source has, the boundary has
 * moved into the queue and D-100 is decoration. `check-boundaries.mjs` catches the
 * obvious version of that slip; the honest version is not adding the field.
 */
export interface IngestJob {
  /** Idempotency key, computed at `accept()` — before anything has been fetched. */
  ingestKey: string
  userId: string
  source: SourceId
  /** ALWAYS a string. Some sources' ids are int64 and `JSON.parse` corrupts them past 2^53. */
  externalId: string
  command: IngestCommandKind
  /** Adapter-private hints: an event's aspect type, an uploaded file's S3 key, a page cursor. */
  meta: unknown
  enqueuedAt: string
}

/**
 * Intents, never side effects. Exactly four variants — a fifth means the pipeline grew a
 * new verb and the design should say so first.
 */
export type IngestCommand =
  | { kind: "ingest"; job: IngestJob }
  | { kind: "reingest"; job: IngestJob }
  | { kind: "retract"; source: SourceId; externalId: string }
  | { kind: "disconnect"; source: SourceId; userId: string }

/**
 * What `accept()` returns: the response to send the source right now, plus the intents to
 * enqueue.
 *
 * `commands`, not `jobs` (D-187). `01-architecture.md` §3 had `jobs: IngestJob[]`, which
 * cannot express a deletion or a revoked authorisation — and classifying an inbound
 * payload is precisely what phase 1 is for. An empty array is a valid, meaningful result:
 * accepted and intentionally dropped.
 */
export interface AckResult {
  /** HTTP status to return to the source, immediately. */
  status: number
  body?: unknown
  commands: IngestCommand[]
}

/**
 * One source, four phases. The phase comments are load-bearing — each one names a thing
 * the implementation must NOT do, and those are the constraints that make the boundary
 * survivable rather than merely tidy.
 *
 * Generic in `TCreds` and holding no credential shape of its own: what a source needs to
 * authenticate is that source's business, and a union of every vendor's token shape here
 * would be a Strava-shaped type in all but name.
 */
export interface SourceAdapter<TCreds = unknown> {
  readonly id: SourceId

  /**
   * PHASE 1 — runs in the public endpoint. LATENCY-CRITICAL (Strava: <2s hard deadline).
   * MUST NOT call the source API, refresh tokens, or touch S3. Validation and command
   * construction only.
   */
  accept(req: InboundRequest): Promise<AckResult>

  /**
   * PHASE 2 — runs in the worker. May use the network.
   * Returns raw bytes EXACTLY as the source gave them. No transformation.
   * The pipeline archives these to S3 BEFORE `normalize()` is ever called (D-121.2).
   */
  fetchRaw(job: IngestJob, creds: TCreds): Promise<{ body: Buffer; contentType: string; ext: string }>

  /**
   * PHASE 3 — PURE. No network, no AWS SDK, no clock, no randomness.
   *
   * THIS IS THE MIGRATION SEAM. Unit-testable from a checked-in fixture with zero
   * mocking, the only place a vendor's wire format is understood, and the function that
   * outlives the client code to replay the S3 archive.
   *
   * Synchronous by signature, so purity is structurally encouraged and not merely
   * documented: a `Promise` return would make an `await fetch` inside it invisible.
   */
  normalize(raw: Buffer, ref: RawArchiveRef, job: IngestJob): NormalizedIngest

  /**
   * MANDATORY, not optional (D-140). A push adapter may return nothing and rely on its
   * events, but EVERY adapter implements it: this is the reconciliation sweep that covers
   * SILENTLY DROPPED webhooks. Strava retries 3x, then drops with no DLQ and no replay.
   * It is also what the manual Sync path in capability `06` runs on.
   */
  listSince(userId: string, watermark: string, creds: TCreds): AsyncIterable<IngestJob>

  /** The ONLY optional member. Called by token-refresh for sources with rotating credentials. */
  refreshCredentials?(creds: TCreds): Promise<TCreds>
}

/**
 * ─── OAUTH ───────────────────────────────────────────────────────────────────
 *
 * Ticket 0032. Connecting a source is a DIFFERENT lifecycle from ingesting from
 * one, and the types are separated for that reason rather than for tidiness.
 *
 * The four phases above run per activity, in a queue worker, forever. What follows
 * runs three times in the life of a connection — connect, re-authorise, disconnect
 * — from a route handler with a signed-in browser attached. `contracts/ingestion-
 * contract.md` §3 specifies `SourceAdapter` as the four phases and says nothing
 * about authorisation, which is the contract agreeing.
 *
 * WHAT IS DELIBERATELY NOT HERE: any notion of where credentials are stored, any
 * clock, and any HTTP framework type. A connector builds a URL, exchanges a code,
 * judges a grant and revokes it. Everything else — the state nonce, the DynamoDB
 * row, the redirect — belongs to the generic route and the generic store, and that
 * is what lets `app/api/auth/[source]/` stay free of any vendor's name.
 */

/**
 * The client credentials the app holds for a source. Read at runtime from SSM by
 * `lib/sources/oauth-credentials.ts`; never an environment variable (0017/D-166,
 * Amplify renders those into build artifacts in plaintext) and never sent to a
 * browser.
 */
export interface OAuthClientCredentials {
  clientId: string
  clientSecret: string
}

/**
 * What a code exchange yields, normalised. The vendor's response shape stays inside
 * the adapter; this is what the store is allowed to see.
 *
 * `externalOwnerId` is a STRING even where the vendor sends an integer — the same
 * rule `IngestJob.externalId` states, and for the same reason: some sources' ids are
 * int64 and `JSON.parse` silently corrupts them past 2^53.
 *
 * `expiresAt` is epoch seconds FROM THE RESPONSE. There is no TTL constant anywhere
 * in this flow, deliberately: a hardcoded six hours is right until the day it is not,
 * and the failure is a token treated as live after it has died.
 */
export interface OAuthGrant {
  externalOwnerId: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  scopes: readonly string[]

  /**
   * WHERE `scopes` CAME FROM. Ticket 0165.
   *
   * Not diagnostics for their own sake. A provider may state the granted scopes in
   * its token response, or only on the callback that preceded it, and the two are
   * different levels of evidence: `"response"` is the grant describing itself,
   * `"callback"` is the authorization describing what it was about to become.
   *
   * It exists because assuming the first is what broke the connect flow in 0032, and
   * a value carried on the grant is a fact the next real connect can settle — as
   * against a design doc corrected on an inference.
   */
  scopeSource: "response" | "callback"
}

/**
 * What a REFRESH yields. Ticket 0033.
 *
 * Deliberately NOT `OAuthGrant`. A refresh response is a different and smaller thing
 * than a code exchange: there is no athlete, and in Strava's case no scope either.
 * Reusing `OAuthGrant` would force an adapter to invent an `externalOwnerId` and a
 * `scopeSource` it was never told, and an invented identity on a credential path is
 * how the wrong athlete's runs end up on a map that never re-fogs.
 *
 * `refreshToken` IS ALWAYS PRESENT AND MAY BE NEW. Strava's docs: "The refresh token
 * may or may not be the same refresh token used to make the request." An adapter whose
 * provider omits the field on an unchanged token echoes the one it was given, so the
 * storage layer above never has to reason about absence — it always has the value that
 * is now authoritative, and the conditional write does the rest.
 */
export interface OAuthRefresh {
  accessToken: string
  refreshToken: string
  /** Epoch seconds, FROM THE RESPONSE. There is no TTL constant on this path either. */
  expiresAt: number
}

/**
 * Whether a grant is good enough to store. NOT a boolean, because the interesting
 * case carries information the user has to be told.
 *
 * A consent screen lets the user untick individual scopes, and the provider will
 * hand back a working token with less than was asked for. The resulting connection
 * looks healthy and returns degraded data — which, for a map that never re-fogs
 * (D-020), is a permanent defect written one run at a time. So the refusal names the
 * consequence in words, supplied by the adapter that knows what the consequence is.
 */
export type GrantCheck =
  | { ok: true }
  | { ok: false; missing: readonly string[]; consequence: string }

/**
 * One source's OAuth handshake. Registered in `registry.ts` and reached only through
 * it, exactly as `SourceAdapter` is.
 */
export interface OAuthConnector {
  readonly source: SourceId

  /** The vendor's own name, for the one screen that has to say it out loud. */
  readonly displayName: string

  /**
   * The scopes without which this source's data is not worth storing. Named on the
   * connector rather than inside `authorizeUrl` so the callback can check the
   * returned grant against the same list the request was built from — the two
   * drifting apart is how a scope downgrade goes unnoticed.
   */
  readonly requiredScopes: readonly string[]

  /**
   * The SSM parameter LEAF names holding this source's client credentials. The path
   * prefix is the app's, so it lives with the generic loader; the leaf is the
   * vendor's, so it lives here.
   */
  readonly credentialParameters: { clientId: string; clientSecret: string }

  /**
   * What to tell the user when a required scope is missing, in words that mean
   * something to someone standing outside after a run. Also what `GrantCheck` carries
   * on a refusal — one string, so the screen and the check cannot disagree about what
   * the user was told.
   */
  readonly scopeConsequence: string

  /**
   * PURE. Builds the provider's authorize URL. No network, no clock, no randomness —
   * the nonce is generated and stored by the caller and passed in, so this function
   * is a total function of its arguments and testable as one.
   *
   * `force` requests a fresh consent screen rather than silently re-issuing the
   * previous grant. It is what makes "you declined a scope, try again" actionable:
   * without it the provider re-approves the same reduced grant without showing the
   * user anything to change.
   */
  authorizeUrl(input: {
    clientId: string
    redirectUri: string
    state: string
    force: boolean
  }): string

  /**
   * PURE. Reads and judges the scope string the provider put on the CALLBACK URL,
   * before any code has been exchanged.
   *
   * THIS IS THE CHECK THAT MATTERS, and the one that is easy to leave out. A refusal
   * here means no token is ever minted, so there is nothing to store by mistake and
   * nothing to revoke on the way out.
   *
   * It returns the parsed list as well as the verdict because the caller needs both:
   * the verdict decides whether to continue, and the list is carried into
   * `exchangeCode` as the scopes this authorization is known to have granted. Two
   * separate calls would be two chances for them to disagree.
   *
   * The parameter is the RAW string, or null when the provider sent none, because
   * how a source spells a scope list (comma-separated, space-separated, absent) is
   * the source's business and not the route's.
   */
  readCallbackScopes(rawScope: string | null): { scopes: string[]; check: GrantCheck }

  /**
   * NETWORK. Exchanges an authorization code for a grant.
   *
   * `grantedScopes` is what `readCallbackScopes` verified a moment earlier. A
   * provider that restates the scopes in its token response is believed over it —
   * that is the grant describing itself, and it is the only thing that could catch a
   * downgrade between the callback and the token. A provider that says nothing there
   * does not get read as having granted nothing (ticket 0165: that assumption
   * refused every good grant and revoked it).
   */
  exchangeCode(input: {
    code: string
    redirectUri: string
    credentials: OAuthClientCredentials
    grantedScopes: readonly string[]
  }): Promise<OAuthGrant>

  /**
   * NETWORK. Exchanges a refresh token for a fresh access token. Ticket 0033.
   *
   * THE ONE RULE THIS SIGNATURE ENFORCES: it takes a refresh token and returns a
   * refresh token, and the caller must assume they differ. There is no "did it
   * rotate?" flag, because a boolean invites a branch that skips the write on the
   * common path — and the common path being right 99 times is what makes the 100th,
   * where it did rotate and nobody persisted it, so expensive. Always persist.
   *
   * Throws `OAuthProviderError` (`./errors`) on a non-2xx. Its `credentialIsDead`
   * decides whether the caller re-authorizes or retries, so an adapter must set the
   * status faithfully rather than collapsing every failure to one code.
   */
  refreshTokens(input: {
    refreshToken: string
    credentials: OAuthClientCredentials
  }): Promise<OAuthRefresh>

  /** PURE. Is this grant good enough to store? See `GrantCheck`. */
  checkGrant(grant: OAuthGrant): GrantCheck

  /**
   * NETWORK. Revokes at the provider. Called before the row is marked disconnected,
   * so that a failure here is visible rather than leaving a live token behind a row
   * that claims to be dead.
   */
  revoke(input: { accessToken: string; credentials: OAuthClientCredentials }): Promise<void>
}
