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
