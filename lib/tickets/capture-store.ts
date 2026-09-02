import {
  ConditionalCheckFailedException,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb"
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb"

/**
 * The server-side state the capture endpoint needs and cannot hold in memory:
 * idempotency records (§6.4/9) and rate-limit counters (§6.4/5). Ticket 0019.
 *
 * WHY NOT MODULE MEMORY. It is tempting, because 0018 already caches the PAT that
 * way. But a Lambda scales OUT: a counter in module scope is per-execution-
 * environment, so "30 per hour" silently becomes "30 per hour per warm container"
 * under exactly the burst it exists to stop, and an idempotency key recorded in one
 * container is invisible to the retry that lands in another. Both controls would
 * appear to work in every test and neither would work in production.
 *
 * ONE TABLE, TWO ITEM SHAPES, distinguished by a key prefix. Splitting them into
 * two tables would double the CDK surface, the IAM grant and the operator's mental
 * model to separate two items that are written on the same request path.
 *
 *   IDEM#<userId>#<idempotencyKey>   state: pending|done, path, commitSha  TTL 24 h
 *   RATE#<userId>#hour:<YYYY-MM-DDTHH>   count                             TTL  2 h
 *   RATE#<userId>#day:<YYYY-MM-DD>       count                             TTL  2 d
 *
 * FAIL CLOSED. Every function here throws rather than returning a permissive
 * default when DynamoDB cannot answer, and the route turns that into a 503. This
 * is D-176 at the level of a control: a rate limiter that cannot read its counter
 * has NOT found the caller to be under the limit, it has failed to look, and those
 * two must not produce the same outcome. The cost is real and accepted — a capture
 * bounces during a DynamoDB outage — and it is why 0022's retry queue exists.
 */

/**
 * Explicit, not CDK-generated. The SSR compute reads this name at runtime and has
 * no CloudFormation output to read it from — the same reason `github.ts` hard-codes
 * its SSM parameter path. `amplify/backend.ts` sets the identical literal, and the
 * two are asserted equal by a test rather than trusted to stay in step.
 */
export const CAPTURE_GUARD_TABLE = "LostSolesCaptureGuard"

/** §6.4/5. A human capture endpoint has no legitimate burst above these. */
export const RATE_PER_HOUR = 30
export const RATE_PER_DAY = 200

const IDEM_TTL_SECONDS = 24 * 60 * 60

/**
 * How long a `pending` claim blocks a retry of the same key before it is treated as
 * abandoned. Long enough that a genuinely in-flight GitHub call is not stolen from,
 * short enough that a Lambda killed mid-commit does not lock the operator out of
 * re-sending a note for 24 hours.
 */
const CLAIM_STALE_MS = 120_000

let cachedDoc: DynamoDBDocumentClient | null = null

function doc(): DynamoDBDocumentClient {
  cachedDoc ??= DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    // An absent optional field is absent, not an empty string. The GitHub commit
    // sha is only written once the commit exists, and "" would read as a real one.
    marshallOptions: { removeUndefinedValues: true },
  })
  return cachedDoc
}

/** Exported for tests only — swaps in a stub client and resets between cases. */
export function __setDocClient(client: DynamoDBDocumentClient | null): void {
  cachedDoc = client
}

const idemKey = (userId: string, key: string) => `IDEM#${userId}#${key}`
/**
 * The window marker is joined to its date with `:`, not with the `#` used between
 * the other segments, and that is not stylistic. `#` immediately before digits
 * produces `#2026`, which is a syntactically valid hex colour, and
 * `scripts/check-design-tokens.mjs` correctly reads it as one and fails the deploy.
 *
 * The clash is structural rather than incidental — `01-architecture.md` §2's own
 * key format is `U#<uid>#C#<res6parent>` and an H3 cell id is hex — so ticket 0146
 * carries the scanner fix. This file simply does not need to be the one that
 * argues about it.
 */
const hourKey = (userId: string, now: Date) =>
  `RATE#${userId}#hour:${now.toISOString().slice(0, 13)}`
const dayKey = (userId: string, now: Date) =>
  `RATE#${userId}#day:${now.toISOString().slice(0, 10)}`

export interface CaptureResult {
  path: string
  commitSha: string
}

export type ClaimOutcome =
  /** This request owns the key. Proceed to commit. */
  | { kind: "claimed" }
  /** This exact key already committed. Replay the original; do NOT commit again. */
  | { kind: "replay"; result: CaptureResult }
  /** A different request holds the key right now. */
  | { kind: "in-flight" }

/**
 * §6.4/9, and the reason 0022's retry queue is safe to build on.
 *
 * A conditional put, not a read-then-write. Read-then-write has a window in which
 * two copies of the same retried request both see "no record" and both commit, and
 * that window is precisely when it matters — a flaky connection producing a rapid
 * double send is the scenario the whole mechanism is for.
 *
 * A stale `pending` is taken over rather than honoured forever, and the takeover is
 * ITSELF conditional on the claim not having changed since it was read. Otherwise
 * two requests could both decide the same stale claim was theirs.
 */
export async function claimIdempotencyKey(
  userId: string,
  key: string,
  now: Date,
): Promise<ClaimOutcome> {
  const pk = idemKey(userId, key)
  const claimedAt = now.getTime()
  const ttl = Math.floor(claimedAt / 1000) + IDEM_TTL_SECONDS

  try {
    await doc().send(
      new PutCommand({
        TableName: CAPTURE_GUARD_TABLE,
        Item: { pk, state: "pending", claimedAt, ttl },
        ConditionExpression: "attribute_not_exists(pk)",
      }),
    )
    return { kind: "claimed" }
  } catch (err) {
    if (!(err instanceof ConditionalCheckFailedException)) throw err
  }

  const existing = await doc().send(
    new GetCommand({ TableName: CAPTURE_GUARD_TABLE, Key: { pk }, ConsistentRead: true }),
  )
  const item = existing.Item as
    | { state?: string; path?: string; commitSha?: string; claimedAt?: number }
    | undefined

  // Gone between the put and the get — expired, or released by a failed attempt.
  // Recursing once is safe: the second put either wins or finds a real record.
  if (!item) return claimIdempotencyKey(userId, key, now)

  if (item.state === "done" && typeof item.path === "string") {
    return { kind: "replay", result: { path: item.path, commitSha: item.commitSha ?? "" } }
  }

  const heldFor = claimedAt - (item.claimedAt ?? 0)
  if (heldFor < CLAIM_STALE_MS) return { kind: "in-flight" }

  try {
    await doc().send(
      new PutCommand({
        TableName: CAPTURE_GUARD_TABLE,
        Item: { pk, state: "pending", claimedAt, ttl },
        ConditionExpression: "claimedAt = :seen",
        ExpressionAttributeValues: { ":seen": item.claimedAt },
      }),
    )
    return { kind: "claimed" }
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return { kind: "in-flight" }
    throw err
  }
}

/** The commit happened. Later sends of the same key replay this without committing. */
export async function recordIdempotentResult(
  userId: string,
  key: string,
  result: CaptureResult,
  now: Date,
): Promise<void> {
  await doc().send(
    new PutCommand({
      TableName: CAPTURE_GUARD_TABLE,
      Item: {
        pk: idemKey(userId, key),
        state: "done",
        path: result.path,
        commitSha: result.commitSha,
        claimedAt: now.getTime(),
        ttl: Math.floor(now.getTime() / 1000) + IDEM_TTL_SECONDS,
      },
    }),
  )
}

/**
 * Drop a claim that will never become a commit — rate-limited, guard-rejected, or a
 * GitHub failure. Without this a note that bounced for a recoverable reason would be
 * un-resendable under its own key for 24 hours, which turns one transient failure
 * into permanent loss of a note dictated once.
 *
 * Deliberately swallows its own errors: it runs on a path that is ALREADY returning
 * a failure to the caller, and replacing a useful 429 with an opaque 500 because the
 * cleanup failed would be strictly worse. The claim expires on its own regardless.
 */
export async function releaseIdempotencyKey(userId: string, key: string): Promise<void> {
  try {
    await doc().send(
      new DeleteCommand({ TableName: CAPTURE_GUARD_TABLE, Key: { pk: idemKey(userId, key) } }),
    )
  } catch {
    /* the TTL is the backstop */
  }
}

export type RateOutcome = { ok: true } | { ok: false; window: "hour" | "day" }

/**
 * §6.4/5. Two windows, both conditional increments.
 *
 * The condition is what keeps this honest under a runaway retry loop: the counter
 * REFUSES to go past the cap rather than climbing to 4,000 and being compared
 * afterwards. A conditional-check failure is the 429 — the same signal, one round
 * trip, and no unbounded number to store.
 *
 * The TTL is written with `if_not_exists` so it is stamped by the first request in
 * a window and never pushed forward by later ones. A TTL refreshed on every write
 * is a row that never expires, which is criterion 8's "the counter row carries a
 * TTL" satisfied in letter and defeated in fact.
 *
 * Buckets are wall-clock calendar windows (`...T14`, `2026-09-02`), not rolling
 * ones. A rolling window needs the request timestamps kept; a calendar bucket needs
 * one integer. The cost is that a caller can spend 30 at :59 and 30 at :00 — for a
 * cap whose purpose is "a human does not burst", entirely acceptable.
 */
export async function consumeRateBudget(userId: string, now: Date): Promise<RateOutcome> {
  const hour = await bump(hourKey(userId, now), RATE_PER_HOUR, now, 2 * 60 * 60)
  if (!hour) return { ok: false, window: "hour" }

  const day = await bump(dayKey(userId, now), RATE_PER_DAY, now, 2 * 24 * 60 * 60)
  if (!day) return { ok: false, window: "day" }

  return { ok: true }
}

async function bump(
  pk: string,
  max: number,
  now: Date,
  ttlSeconds: number,
): Promise<boolean> {
  try {
    await doc().send(
      new UpdateCommand({
        TableName: CAPTURE_GUARD_TABLE,
        Key: { pk },
        UpdateExpression: "ADD #count :one SET #ttl = if_not_exists(#ttl, :ttl)",
        ConditionExpression: "attribute_not_exists(#count) OR #count < :max",
        ExpressionAttributeNames: { "#count": "count", "#ttl": "ttl" },
        ExpressionAttributeValues: {
          ":one": 1,
          ":max": max,
          ":ttl": Math.floor(now.getTime() / 1000) + ttlSeconds,
        },
      }),
    )
    return true
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false
    throw err
  }
}
