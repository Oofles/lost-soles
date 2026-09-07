import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb"
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb"

import type { SourceId } from "@/src/domain/activity"

/**
 * T8 `IngestReceipt` — THE THING THAT MAKES REPLAY UNABLE TO DOUBLE-AWARD.
 * Ticket 0040, `02-data-model.md` T8, `01-architecture.md` §4 (steps 3 and 12).
 *
 * ─── WHY THIS SHIPS AT THE FIRST IMPORT ─────────────────────────────────────
 *
 * Not because duplicates are likely yet — there is no webhook and no queue until
 * 0042. Because idempotency CANNOT BE RETROFITTED onto an append-only XP ledger.
 * D-135 says XP never decreases; corrections may only add. So once two awards exist
 * for one run there is no operation that removes the wrong one, and no way to tell
 * which of the two was the duplicate. The structure has to exist before the first
 * row does.
 *
 * ─── THE FOUR LAYERS, AND WHICH ONES LIVE HERE ──────────────────────────────
 *
 * `01-architecture.md` §4 assumes all four will fire:
 *
 *   1. Accept gate      — `acceptIngest`, HERE. Kills a redelivery before SQS.
 *   2. Score gate       — `claimForScoring`, HERE. A redelivered message loses this
 *                         race and exits BEFORE any XP is written.
 *   3. Transactional    — `doneTransactItem`, HERE, but EXECUTED BY 0041. The receipt
 *      commit             transition to DONE rides inside the same `TransactWriteItems`
 *                         as the `Activity` put, so XP and the receipt commit or fail
 *                         together. There is no window where one exists without the other.
 *   4. Set semantics    — not here at all, and it is the backstop that makes the rest
 *                         safe: `delta = newCells \ explored` is empty on a replay, so a
 *                         re-run awards nothing even if layers 1–3 all failed.
 *
 * Layer 4 is why the 90-day TTL below is safe. A replay after a receipt has aged out
 * re-derives cells that are already present and awards nothing.
 *
 * ─── WHAT THIS MODULE DOES NOT DO ───────────────────────────────────────────
 *
 * It never executes the DONE transition. `doneTransactItem` returns a DESCRIPTOR and
 * nothing else, because 0041's `persistActivity` owns the transaction and layer 3 is
 * only true if that write is one atomic act. A `markDone()` here that issued its own
 * `UpdateItem` would be a second, non-atomic way to reach the same state — which is
 * exactly the window layer 3 exists to close.
 */

/**
 * Explicit, not CDK-generated, for the reason `LostSolesCaptureGuard` records: the
 * accept gate's first caller is the Sync action (0043) on Amplify's SSR compute, which
 * is not a `defineFunction` Lambda and has no CloudFormation output to be handed a
 * generated name through. `amplify/backend.ts` states the identical literal and a test
 * asserts the two agree.
 */
export const INGEST_RECEIPT_TABLE = "LostSolesIngestReceipt"

/** T8: "90 days. Safe to expire" — layer 4 is the permanent backstop. */
export const RECEIPT_TTL_DAYS = 90

/**
 * How long a `PROCESSING` receipt is honoured before a retry may steal it.
 *
 * THIS NUMBER IS THE LAMBDA TIMEOUT AND MUST STAY THAT (§4 layer 2: "a
 * `processingStartedAt` older than the 15-minute timeout is reclaimable by the next
 * attempt"). 0042 configures `process-activity` at 900 s; if that ever changes, this
 * changes with it. Too short and two invocations score the same activity concurrently;
 * too long and a crashed invocation locks the receipt until the value elapses.
 *
 * Stated here rather than in the Lambda config because this is the module that
 * depends on the relationship — the timeout is one of two settings, and a constant
 * living beside only the other one is how they drift.
 */
export const PROCESSING_STALE_MS = 15 * 60 * 1000

/**
 * THE SPARSE INDEX OVER FAILURES. Ticket 0044, criterion 4.
 *
 * `failedUserId` is written ONLY by `recordFailure` and removed again by
 * `claimForScoring`, so the index holds one entry per outstanding failure and nothing
 * else — normally zero. That is what makes "what failed for this user?" a Query over an
 * empty index rather than a Scan of the whole table.
 *
 * A NON-SPARSE INDEX ON `userId` WOULD ALSO WORK TODAY and is the reason to say why it
 * was not chosen: at ~250 live rows either is free. But the Sync action runs this query
 * on every press, and an index that grows with total imports is one whose cost is a
 * function of how long the app has been used, while this one's cost is a function of
 * how much is currently broken. Those are different curves and only one of them is
 * bounded.
 *
 * `amplify/backend.ts` states the identical literal, for the same reason the table name
 * is stated twice — the SSR compute reads it at runtime and has no CloudFormation
 * output to be handed a generated name through. A test asserts the two agree.
 */
export const FAILED_BY_USER_INDEX = "failedByUser"

/** T8. Every transition is a conditional update; there is no unguarded status write. */
export type ReceiptStatus = "QUEUED" | "PROCESSING" | "DONE" | "FAILED"

/**
 * Which gate minted this key. Two shapes coexist in one table (T8):
 *
 *   ACCEPT — `sha256("<source>:<ownerId>:<externalId>:<aspectType>")`, built by the
 *            adapter, because only the adapter knows what its events look like.
 *   SCORE  — `${source}#${externalId}#${hash(points, startedAt)}#v${FOG_ALGO_VERSION}`,
 *            built in 0050. Carrying the algorithm version means a deliberate scoring
 *            change invalidates every key and forces an auditable rescore.
 *
 * Only ACCEPT keys are written at this stage; the union is declared now so the SCORE
 * half is a value and not a schema change.
 */
export type ReceiptKeyKind = "ACCEPT" | "SCORE"

export interface IngestReceipt {
  ingestKey: string
  keyKind: ReceiptKeyKind
  status: ReceiptStatus
  userId: string
  /** Deterministic (I-5) — `computeActivityId`, never a ULID. */
  activityId: string
  source: SourceId
  attempts: number
  acceptedAt: string
  processingStartedAt?: string
  /** Written on DONE, so a duplicate returns the winner's numbers (T8). */
  xpAwarded?: number
  newCellCount?: number
  ttl: number

  /*
   * ─── THE FAILURE FIELDS (ticket 0044) ──────────────────────────────────────
   *
   * All four are written together by `recordFailure` and removed together by
   * `claimForScoring`. They exist on a receipt if and only if it is FAILED, which is
   * what lets `failedUserId` back a sparse index.
   */

  /**
   * The user's id, DUPLICATED FROM `userId` — and the duplication is the whole point.
   * This is the partition key of `FAILED_BY_USER_INDEX`, and an index keyed on `userId`
   * itself would contain every receipt ever written rather than only the broken ones.
   */
  failedUserId?: string
  failedAt?: string
  /**
   * An error CLASS, never a stack and never a provider's response body (criterion 2).
   * `SourceNeedsReauthError`, `TypeError`, `TimeoutError` — the name and nothing else.
   * A message can quote the request that produced it, which on a token endpoint means
   * the client secret (O-005, `08-security-privacy.md` §7.4).
   */
  errorClass?: string
  /**
   * WHETHER THE RAW BYTES REACHED S3 BEFORE THIS FAILED, and the ticket calls it
   * load-bearing: if they landed, the failure is replayable forever from the archive
   * (D-101). If they did not, the only copy is still on the source's servers, and a
   * source that later deletes the activity takes the run with it. Those are two
   * different urgencies and the runbook branches on this field.
   */
  rawArchived?: boolean
}

/**
 * The document-client surface these functions use, and nothing more.
 *
 * A structural type rather than `DynamoDBDocumentClient` so a test passes a one-method
 * stub — the same reasoning `archive.ts` applies to S3, and the same reason this
 * directory injects dependencies rather than using the module-level `__setDocClient`
 * idiom that `lib/sources/*-store.ts` uses. Both work; `src/pipeline` is consistent
 * with itself, and an injected client has no cross-test global to reset.
 */
export interface ReceiptDdb {
  send(
    command: PutCommand | UpdateCommand | GetCommand | QueryCommand,
  ): Promise<Record<string, unknown>>
}

export interface ReceiptDeps {
  ddb: ReceiptDdb
  /** Injected so the TTL and the stale cutoff are testable without waiting 15 minutes. */
  now?: () => Date
}

const nowOf = (deps: ReceiptDeps) => deps.now?.() ?? new Date()

/** T8's `ttl`: epoch SECONDS, not milliseconds. DynamoDB ignores a millisecond value. */
export function receiptTtl(now: Date): number {
  return Math.floor(now.getTime() / 1000) + RECEIPT_TTL_DAYS * 24 * 60 * 60
}

/** LAYER 1's two outcomes. A duplicate is a normal result, not an error. */
export type AcceptResult = { kind: "accepted" } | { kind: "duplicate" }

/**
 * LAYER 2's outcomes. `claimed` means this caller owns the work; anything else means
 * it must stop without writing.
 *
 * The `duplicate` case carries the winner's numbers WHEN THEY EXIST — that is, when
 * the winner has already reached DONE. While the winner is still PROCESSING there are
 * no numbers to carry, and the honest answer is the status, not a fabricated zero.
 */
export type ClaimResult =
  | { kind: "claimed"; attempts: number }
  | {
      kind: "duplicate"
      status: ReceiptStatus
      xpAwarded?: number
      newCellCount?: number
    }

const isConditionalFailure = (error: unknown): boolean =>
  error instanceof ConditionalCheckFailedException ||
  (error as { name?: string })?.name === "ConditionalCheckFailedException"

/**
 * LAYER 1 — the accept gate (§4 step 3). Runs in the endpoint, on the 2-second budget.
 *
 * A conditional `PutItem` and nothing else: one round trip, no read-then-write. The
 * condition IS the check — reading first and then putting would be two calls and a
 * race between them, which on a source that redelivers is a race that will be lost.
 *
 * `attempts` starts at ZERO, not one. An accept is not a delivery; `recordDelivery`
 * counts those, and starting at one would make every activity look like it had already
 * been retried.
 */
export async function acceptIngest(
  receipt: {
    ingestKey: string
    userId: string
    activityId: string
    source: SourceId
    keyKind?: ReceiptKeyKind
  },
  deps: ReceiptDeps,
): Promise<AcceptResult> {
  const now = nowOf(deps)
  const item: IngestReceipt = {
    ingestKey: receipt.ingestKey,
    keyKind: receipt.keyKind ?? "ACCEPT",
    status: "QUEUED",
    userId: receipt.userId,
    activityId: receipt.activityId,
    source: receipt.source,
    attempts: 0,
    acceptedAt: now.toISOString(),
    ttl: receiptTtl(now),
  }

  try {
    await deps.ddb.send(
      new PutCommand({
        TableName: INGEST_RECEIPT_TABLE,
        Item: item,
        ConditionExpression: "attribute_not_exists(ingestKey)",
      }),
    )
    return { kind: "accepted" }
  } catch (error) {
    if (isConditionalFailure(error)) return { kind: "duplicate" }
    throw error
  }
}

/**
 * Counts ONE SQS delivery. Called before `claimForScoring`, unconditionally on the
 * status.
 *
 * ─── WHY THIS IS A SEPARATE WRITE ───────────────────────────────────────────
 *
 * T8 says `attempts` is `ADD 1` per delivery and that "≥ 4 means the DLQ has it".
 * Folding the increment into `claimForScoring`'s conditional `UpdateItem` would break
 * that sentence, because a failed `ConditionExpression` WRITES NOTHING — the delivery
 * that lost the race would not be counted, which is precisely the delivery worth
 * counting. So the count is its own call, and the claim keeps its condition.
 *
 * The cost is one extra write per message: ~800 a year at this volume, comfortably
 * inside the free tier, in exchange for `attempts` meaning what T8 says it means and
 * 0044 having a real signal to alarm on.
 *
 * IT IS STILL CONDITIONAL ON THE ROW EXISTING. `UpdateItem` upserts, so an
 * unguarded `ADD` would CREATE a receipt for a job that never passed the accept gate —
 * a phantom row in the table whose entire purpose is knowing what was accepted. That
 * cannot happen on a correct path (0043 accepts before it enqueues, and SQS retention
 * is 14 days against a 90-day TTL), so it is an anomaly and it throws.
 */
export async function recordDelivery(
  ingestKey: string,
  deps: ReceiptDeps,
): Promise<number> {
  const result = await deps.ddb.send(
    new UpdateCommand({
      TableName: INGEST_RECEIPT_TABLE,
      Key: { ingestKey },
      UpdateExpression: "ADD attempts :one",
      ConditionExpression: "attribute_exists(ingestKey)",
      ExpressionAttributeValues: { ":one": 1 },
      ReturnValues: "UPDATED_NEW",
    }),
  )

  return (result.Attributes as { attempts?: number })?.attempts ?? 0
}

/**
 * LAYER 2 — the score gate (§4 step 12). Runs in the worker, before anything is scored.
 *
 * `status = "QUEUED" OR (status = "PROCESSING" AND processingStartedAt < :stale)`,
 * exactly as T8 writes it. The second disjunct is the crash-recovery clause: an
 * invocation killed mid-flight leaves `PROCESSING` behind, and without a way to
 * reclaim it that activity would never import again — the receipt would outlive the
 * work it was guarding and silently block its own retry.
 *
 * ON FAILURE IT READS. That is one extra call on the losing path only, and it buys the
 * thing criterion 7 asks for: a duplicate that finds a finished winner returns the
 * winner's numbers rather than recomputing them. A duplicate that finds an unfinished
 * winner gets the status and stops — SQS will redeliver, which is the mechanism that
 * already exists for waiting, and is why this function does not poll.
 *
 * ─── FAILED IS RECLAIMABLE. THIS REVERSES A 0040 DECISION (D-209, ticket 0044) ──
 *
 * 0040 matched `PROCESSING` only, deliberately, on the argument that "a crash is
 * transient and should retry, a recorded failure is a decision and should be visible
 * rather than quietly retried forever". The visibility half of that still holds and is
 * why `recordFailure` exists at all. The *lock* half turned out to be wrong, and the
 * way it was wrong is worth stating because it looked safe:
 *
 * A FAILED receipt that no delivery may claim makes a DLQ REDRIVE A SILENT NO-OP. The
 * operator's whole documented recovery path is "fix the cause, redrive from the SQS
 * console" — and with `FAILED` excluded here, the redriven message fetches, archives,
 * normalizes, loses the claim, throws, and lands back in the DLQ looking exactly like
 * the original failure. The one control the operator has would report success and do
 * nothing.
 *
 * NOTHING IS RETRIED FOREVER, because this table was never what bounded retries.
 * `maxReceiveCount: 3` on the queue is (§4), and it is unchanged: a receipt reclaimed
 * from FAILED gets whatever deliveries the queue still owes it and no more. What the
 * exclusion actually bounded was the operator's ability to intervene.
 *
 * THE REMOVE IS THE CLEARING STEP criterion 6 asks for. A claim wipes the four failure
 * fields, which drops the row out of `FAILED_BY_USER_INDEX` — so the Sync line stops
 * reporting a failure the moment a retry is genuinely underway, and reports it again if
 * `recordFailure` writes them back. `REMOVE` on absent attributes is a no-op, so the
 * ordinary QUEUED path pays nothing for this.
 */
export async function claimForScoring(
  ingestKey: string,
  deps: ReceiptDeps,
): Promise<ClaimResult> {
  const now = nowOf(deps)
  try {
    const result = await deps.ddb.send(
      new UpdateCommand({
        TableName: INGEST_RECEIPT_TABLE,
        Key: { ingestKey },
        UpdateExpression:
          "SET #status = :processing, processingStartedAt = :now " +
          "REMOVE failedUserId, failedAt, errorClass, rawArchived",
        ConditionExpression:
          "attribute_exists(ingestKey) AND (#status = :queued OR #status = :failed OR " +
          "(#status = :processing AND processingStartedAt < :stale))",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":processing": "PROCESSING",
          ":queued": "QUEUED",
          ":failed": "FAILED",
          ":now": now.toISOString(),
          ":stale": new Date(now.getTime() - PROCESSING_STALE_MS).toISOString(),
        },
        ReturnValues: "ALL_NEW",
      }),
    )

    const attributes = result.Attributes as IngestReceipt | undefined
    return { kind: "claimed", attempts: attributes?.attempts ?? 0 }
  } catch (error) {
    if (!isConditionalFailure(error)) throw error

    const existing = await readReceipt(ingestKey, deps)
    /**
     * The row vanished between the failed condition and this read — only possible via
     * TTL expiry, and then the condition failed for a reason we can no longer see.
     * Reported as FAILED rather than guessed at: layer 4 makes a re-run harmless.
     *
     * Note this is now the ONLY way this function reports FAILED, since 0044 made that
     * status claimable above. It is a sentinel for "cannot claim, cannot say why", not a
     * reading of the row — there is no row.
     */
    if (!existing) return { kind: "duplicate", status: "FAILED" }

    return {
      kind: "duplicate",
      status: existing.status,
      xpAwarded: existing.xpAwarded,
      newCellCount: existing.newCellCount,
    }
  }
}

/**
 * LAYER 3 — the DONE transition, AS A DESCRIPTOR. Ticket 0041 puts this inside the
 * `TransactWriteItems` that also carries the `Activity` put, and later the
 * `SkillState` `ADD`s and the `XpLedgerEntry` conditional puts.
 *
 * IT IS NOT EXECUTED HERE, DELIBERATELY. §4 layer 3: "XP and the receipt commit or
 * fail together. There is no window in which XP is awarded and the receipt is not
 * advanced." A function here that issued its own `UpdateItem` would open that window
 * the first time someone called it — so the only thing this module offers is an item
 * that has to be composed into somebody else's transaction.
 *
 * `xpAwarded` and `newCellCount` are written on the transition rather than after it,
 * so a duplicate arriving later reads the winner's numbers instead of recomputing
 * them — which, with rules that may have changed in between, would not be the same
 * answer (§4: "XP is derived and stored, not recomputed on read").
 *
 * Guarded on `status = "PROCESSING"`, so a transaction built from a receipt this
 * caller never claimed fails the whole transaction rather than half-committing.
 */
export function doneTransactItem(input: {
  ingestKey: string
  xpAwarded: number
  newCellCount: number
}): NonNullable<TransactWriteCommandInput["TransactItems"]>[number] {
  return {
    Update: {
      TableName: INGEST_RECEIPT_TABLE,
      Key: { ingestKey: input.ingestKey },
      UpdateExpression:
        "SET #status = :done, xpAwarded = :xpAwarded, newCellCount = :newCellCount",
      ConditionExpression: "#status = :processing",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":done": "DONE",
        ":processing": "PROCESSING",
        ":xpAwarded": input.xpAwarded,
        ":newCellCount": input.newCellCount,
      },
    },
  }
}

/** What `recordFailure` is told, beyond the key. Never a message, never a stack. */
export interface FailureFacts {
  /** From the job, not from the row — the write must work on a receipt it never read. */
  userId: string
  /** `error.name`. See `IngestReceipt.errorClass` for why it is only ever the name. */
  errorClass: string
  /** Whether the raw archive PUT completed before this failed. */
  rawArchived: boolean
}

/**
 * RECORDS A TERMINAL FAILURE ON THE RECEIPT. Ticket 0044, criterion 2. This replaces
 * 0040's `markFailed`, which had no caller anywhere and could not have had one.
 *
 * ─── WHY THE GUARD IS `<> DONE` AND NOT `= PROCESSING` ──────────────────────
 *
 * `markFailed` was guarded on `PROCESSING`, which is the state a caller holding a claim
 * is in — and 0042's own note is the finding that killed it: **almost no terminal
 * failure happens while a claim is held.** The order in `process-activity.ts` is
 * credentials → fetch → archive → normalize → SCORE GATE → persist, so a revoked
 * authorization, a 4xx or a malformed payload all fail with the receipt still `QUEUED`.
 * A `PROCESSING` guard would no-op on precisely the failures worth recording.
 *
 * So the guard is inverted: anything that is not already `DONE` may be marked failed.
 * `DONE` is excluded because it is the one state that means XP was awarded inside a
 * transaction, and overwriting it would make the ledger's own commit record lie.
 *
 * ─── IT DOES NOT DECIDE WHAT IS TERMINAL ────────────────────────────────────
 *
 * That decision belongs to the handler, because it is a statement about a QUEUE — "this
 * delivery was the last one the redrive policy allows" is not a fact `src/pipeline` can
 * see. This function writes what it is told. Calling it on a transient failure would
 * make the Sync line report a failure the queue is about to retry successfully, which
 * is the failure mode the ticket's note warns about.
 *
 * Returns the row AS WRITTEN, so the caller's log line gets `attempts` and the stored
 * `activityId` without a second read.
 */
export async function recordFailure(
  ingestKey: string,
  facts: FailureFacts,
  deps: ReceiptDeps,
): Promise<IngestReceipt | undefined> {
  const now = nowOf(deps)
  try {
    const result = await deps.ddb.send(
      new UpdateCommand({
        TableName: INGEST_RECEIPT_TABLE,
        Key: { ingestKey },
        UpdateExpression:
          "SET #status = :failed, failedUserId = :userId, failedAt = :now, " +
          "errorClass = :errorClass, rawArchived = :rawArchived",
        ConditionExpression: "attribute_exists(ingestKey) AND #status <> :done",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":failed": "FAILED",
          ":done": "DONE",
          ":userId": facts.userId,
          ":now": now.toISOString(),
          ":errorClass": facts.errorClass,
          ":rawArchived": facts.rawArchived,
        },
        ReturnValues: "ALL_NEW",
      }),
    )
    return result.Attributes as IngestReceipt | undefined
  } catch (error) {
    /**
     * Losing this race is not an error worth propagating: it means the receipt reached
     * DONE, or aged out, so either the work finished or there is nothing left to mark.
     * Throwing here would mask the ORIGINAL failure that led the caller to call this,
     * which is the one a human actually needs to read.
     */
    if (!isConditionalFailure(error)) throw error
    return undefined
  }
}

/**
 * EVERY OUTSTANDING FAILURE FOR ONE USER. Ticket 0044, criterion 4 — the Sync action
 * calls this so the result line can say "1 activity failed to import" instead of
 * reporting nothing at all.
 *
 * A Query against the sparse index, which normally returns zero items, so the ordinary
 * press of Sync pays one empty Query. `limit` exists because the line only ever renders
 * a count and a runaway failure does not need to be enumerated to be reported — but
 * note the count is then a floor, and `syncResultLine` is written to say so.
 *
 * NOT CONSISTENT-READ, because a GSI cannot be. A failure recorded moments ago may not
 * appear until the next press. That is acceptable for a report and would not be for a
 * gate — which is why no gate reads this.
 */
export async function listFailedReceipts(
  userId: string,
  deps: ReceiptDeps,
  limit = 25,
): Promise<IngestReceipt[]> {
  const result = await deps.ddb.send(
    new QueryCommand({
      TableName: INGEST_RECEIPT_TABLE,
      IndexName: FAILED_BY_USER_INDEX,
      KeyConditionExpression: "failedUserId = :userId",
      ExpressionAttributeValues: { ":userId": userId },
      Limit: limit,
      /** Newest failure first: the one the operator is most likely asking about. */
      ScanIndexForward: false,
    }),
  )

  return (result.Items ?? []) as IngestReceipt[]
}

export async function readReceipt(
  ingestKey: string,
  deps: ReceiptDeps,
): Promise<IngestReceipt | undefined> {
  const result = await deps.ddb.send(
    new GetCommand({ TableName: INGEST_RECEIPT_TABLE, Key: { ingestKey }, ConsistentRead: true }),
  )

  return result.Item as IngestReceipt | undefined
}

