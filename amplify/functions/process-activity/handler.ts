import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { S3Client } from "@aws-sdk/client-s3"
import { ChangeMessageVisibilityCommand, SQSClient } from "@aws-sdk/client-sqs"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"

import RULES_V1 from "@/rules/xp-rules-v1.json"

import { log } from "@/lib/log"
import { oauthCredentialsFor } from "@/lib/sources/adapter-credentials"
import {
  SourceNeedsReauthError,
  SourceNotConnectedError,
  SourceRateLimitedError,
} from "@/src/adapters/errors"
import { getAdapter } from "@/src/adapters/registry"
import type { IngestJob } from "@/src/adapters/types"
import { computeActivityId } from "@/src/domain/activity-id"
import { EXPLORED_CELL_TABLE } from "@/src/pipeline/explored-cells"
import type { RuleSet } from "@/src/rules/schema"
import { assertValidRuleSet } from "@/src/rules/validate"
import { recordFailure } from "@/src/pipeline/ingest-receipt"
import {
  archiveCompletedBy,
  processActivity,
  type IngestPhase,
} from "@/src/pipeline/process-activity"

/**
 * THE QUEUE HALF. Ticket 0042.
 *
 * `src/pipeline/process-activity.ts` is the six phases and knows nothing about SQS. This
 * file is everything that IS about SQS — receipt handles, visibility timeouts, and what
 * a thrown error means to a redrive policy — plus the wiring of real AWS clients into
 * the deps that module takes.
 *
 * The rules below are `01-architecture.md` §4 "Failure handling" transcribed, and the
 * ticket is explicit that they must not be reinvented here. There are three:
 *
 *   1. Three receive attempts, then the DLQ (14-day retention).
 *   2. A 401 refreshes once, retries once, then fails to the DLQ. It does not loop.
 *   3. A 429 returns the message to the queue WITH A DELAY.
 *
 * Only the third one needs code in this file. The first is the queue's redrive policy in
 * `amplify/backend.ts` and the only thing this handler owes it is to THROW when the work
 * did not happen — an SQS event source deletes a message when the handler returns
 * normally, so a swallowed error is a silently dropped activity, which on a map that
 * cannot re-fog is permanent.
 *
 * The second is already built and lives where it belongs: the adapter's own client
 * refreshes once on a 401, retries once, and on a second 401 writes `NEEDS_REAUTH` and
 * throws `SourceNeedsReauthError`. What stops the LOOP is that write, not this file —
 * every later delivery refuses at the credential store before any HTTP happens, so the
 * remaining two attempts cost nothing and the message reaches the DLQ.
 */

/**
 * SET WHEN THE MODULE IS EVALUATED — that is, once per execution environment. Criterion
 * 8 asks for cold-start and warm-path timings so 0044 has something to alarm on, and the
 * difference between the two is only visible from a value that survives invocations.
 *
 * Lambda's OWN init duration is not reachable from inside a handler — it appears in the
 * REPORT line for a cold start and nowhere in the event — so what this supports is the
 * cold/warm distinction plus the gap between module load and first use. See
 * `sinceInitMs` below, which says exactly what it measures and nothing more.
 */
const MODULE_LOADED_AT = Date.now()
let invocations = 0

/**
 * MODULE SCOPE, so a warm invocation reuses the connections. Each of these opens TLS on
 * first use, and paying that per activity would show up in exactly the warm-path number
 * criterion 8 asks us to record.
 */
const s3 = new S3Client({})
const sqs = new SQSClient({})
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  /** An unset optional on an `Activity` row is absent, not `{NULL:true}` (0041's T3 shape). */
  marshallOptions: { removeUndefinedValues: true },
})

/**
 * THE RULESET, LOADED ONCE PER COLD START AND VALIDATED EVERY TIME. D-189, D-217,
 * ticket `0047`.
 *
 * ─── WHY A `.json` IMPORT AND NOT `loadRuleSet()` ───────────────────────────
 *
 * `src/rules/load.ts` resolves the YAML from `import.meta.url`, which after esbuild
 * bundling points at the bundle rather than at the repo — the read finds nothing. T5, the
 * `RuleSkill` table the browser reads, does not exist until capability 09. And the worker
 * cannot simply go without: D-189 makes `revealsGround` the field that decides whether an
 * activity's cells are written at all, and a cell written by mistake is permanent (D-020).
 *
 * esbuild inlines a JSON import with no loader and no bundling configuration, so
 * `rules/xp-rules-v*.json` — generated from the YAML by `scripts/build-rules-json.mjs`
 * and kept honest by a `--check` gate — is the one form that reaches here intact.
 *
 * ─── VALIDATED, NOT TRUSTED ─────────────────────────────────────────────────
 *
 * `assertValidRuleSet` runs at module load, so a malformed ruleset fails the cold start
 * rather than the activity — every message goes to the DLQ with one clear error instead
 * of each one failing differently deep inside the matcher. It costs microseconds once.
 * The generator does not validate on purpose: a build step that silently refuses to emit
 * is harder to debug than a runtime that refuses to start.
 *
 * PINNED TO v1 by the import path, which is honest about what this is: replay against an
 * older `rulesVersion` (04 §7.6) needs T5 and belongs to capability 09. The pipeline
 * takes the registry as an argument precisely so that day changes this line and nothing
 * else.
 */
const RULES: RuleSet = (() => {
  assertValidRuleSet(RULES_V1)
  return RULES_V1
})()

/**
 * The SQS record fields this handler reads, DELIBERATELY PARTIAL — the same choice
 * `05-strava-adapter` recorded as D-203. Declaring the whole event shape would mean
 * either taking a dependency on `@types/aws-lambda` for four fields, or maintaining a
 * transcription of it that nothing checks.
 */
interface SqsRecord {
  messageId: string
  receiptHandle: string
  body: string
  /**
   * OPTIONAL, and it is optional because this type is a transcription and a transcription
   * can be wrong. Every real SQS event carries `ApproximateReceiveCount`; a handwritten
   * test event or a future event-source setting might not, and defaulting to 1 fails
   * SAFE — it makes a delivery look early, so the worst case is a terminal failure that
   * goes unrecorded for one delivery rather than a live `PROCESSING` claim stomped by a
   * premature one.
   */
  attributes?: { ApproximateReceiveCount?: string }
}
interface SqsEvent {
  Records: SqsRecord[]
}

/**
 * Read at USE, not at module load. A missing variable should fail the invocation with a
 * message naming the variable — failing at import instead turns it into an
 * initialization error whose stack points at nothing useful, and takes the log line with
 * it.
 */
function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set on process-activity. It is wired in amplify/backend.ts; ` +
        "a missing value means the function was deployed outside that stack.",
    )
  }
  return value
}

/**
 * The claim was held by someone else, or a previous delivery recorded a failure. Thrown
 * rather than returned so the message goes back to the queue: the pipeline reports this
 * as a value because it is not a fault, and the queue is where "wait and try again"
 * exists as a mechanism.
 */
class ReceiptNotClaimableError extends Error {
  constructor(ingestKey: string, status: string) {
    super(`Receipt ${ingestKey} is ${status}; this delivery may not claim it`)
    this.name = "ReceiptNotClaimableError"
  }
}

/**
 * THE QUEUE'S RETRY BUDGET, RESTATED. Ticket 0044.
 *
 * It must equal `maxReceiveCount` on `ActivityIngestQueue` in `amplify/backend.ts`, and
 * `process-activity-stack.test.ts` asserts the two agree rather than trusting them to
 * stay in step — the same guard `PROCESSING_STALE_MS` carries against the Lambda timeout,
 * and for the same reason: a constant living beside only one of the two settings it
 * relates is how they drift.
 *
 * It is here and not in `src/pipeline` because it is a statement about a QUEUE. "This
 * delivery is the last one the redrive policy allows" is not a fact the pipeline can see,
 * and moving it there would put SQS semantics in the module whose whole point is not
 * having any.
 */
const MAX_RECEIVE_COUNT = 3

/**
 * WHICH FAILURES ARE TERMINAL — the decision 0042's note left to this ticket, taken
 * deliberately rather than by marking everything.
 *
 * Two ways to be terminal, and only two:
 *
 *   1. THE CREDENTIAL IS DEAD. `SourceNeedsReauthError` and `SourceNotConnectedError`
 *      cannot be repaired by retrying — a human has to re-authorize — so recording the
 *      failure on the first delivery is what turns three silent redeliveries into a
 *      sentence on the Sync screen. Criterion 5 is exactly this: a revoked authorization
 *      surfaces as a distinct reconnect state, not as a generic failure.
 *
 *   2. THIS WAS THE LAST DELIVERY. Anything else that fails on receive number
 *      `MAX_RECEIVE_COUNT` is about to reach the DLQ, and a failure nobody records on its
 *      way there is the silence this whole ticket exists to end.
 *
 * WHAT IS DELIBERATELY NOT TERMINAL:
 *
 *   - A transient fault on an early delivery. Recording it would make the Sync line
 *     report a failure the queue is about to retry successfully, which is a lie with a
 *     shorter half-life than the truth it displaced but a lie all the same.
 *   - `SourceRateLimitedError`. It never reaches this function: rule 3 returns the
 *     message with a delay and rethrows above. A 429 is a schedule, not a failure.
 *   - `ReceiptNotClaimableError`, and this one MATTERS. It means another invocation holds
 *     a live `PROCESSING` claim on this receipt. `recordFailure` is guarded on `<> DONE`,
 *     so marking here would stomp a working import with a FAILED status it would then
 *     have to clear — reporting a failure to the operator while the activity imports
 *     successfully behind it.
 */
function isTerminalFailure(error: unknown, receiveCount: number): boolean {
  if (error instanceof ReceiptNotClaimableError) return false
  if (error instanceof SourceNeedsReauthError) return true
  if (error instanceof SourceNotConnectedError) return true
  return receiveCount >= MAX_RECEIVE_COUNT
}

/** An error CLASS. Never a message: a provider's can quote the request that made it. */
function errorClassOf(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError"
}

/** SQS's ceiling. A daily-bucket 429 can ask for longer than this; see `delayMessage`. */
const MAX_VISIBILITY_SECONDS = 12 * 60 * 60

/**
 * THE ONLY THING RULE 3 NEEDS. `ChangeMessageVisibility` on this delivery's receipt
 * handle, then rethrow so the message is not deleted — it reappears when the extended
 * timeout expires rather than after the queue's default 16 minutes.
 *
 * TWO HONEST LIMITATIONS, both recorded rather than papered over:
 *
 *   - It still spends a receive attempt. Nothing in SQS can return a message without
 *     one, short of deleting it and sending a copy, which would forge a new message id
 *     and lose the redrive count that is the only thing standing between a permanently
 *     rate-limited source and an infinite loop. §4 says a 429 "should never fire" at
 *     three to five runs a week; if it fires three times in a row, the DLQ is the
 *     correct destination.
 *   - A 429 on the DAILY bucket asks to wait until 00:00 UTC, up to 24 hours, and SQS
 *     caps a visibility timeout at 12. The message therefore comes back early and is
 *     refused again. That is acceptable and the alternative is worse: capping at 12
 *     hours costs at most one extra refused call, and the retry budget is what makes it
 *     terminate.
 */
async function delayMessage(record: SqsRecord, retryAfterMs: number): Promise<void> {
  const seconds = Math.min(MAX_VISIBILITY_SECONDS, Math.max(0, Math.ceil(retryAfterMs / 1000)))
  await sqs.send(
    new ChangeMessageVisibilityCommand({
      QueueUrl: required("ACTIVITY_INGEST_QUEUE_URL"),
      ReceiptHandle: record.receiptHandle,
      VisibilityTimeout: seconds,
    }),
  )
}

async function handleRecord(record: SqsRecord, coldStart: boolean): Promise<void> {
  const job = JSON.parse(record.body) as IngestJob
  const startedAt = Date.now()

  /**
   * WHICH DELIVERY THIS IS, from SQS rather than from the receipt's `attempts`.
   *
   * The two disagree in exactly the case that matters. `attempts` only ever increases —
   * an activity that failed three times and was then redriven arrives with `attempts` at
   * 3, and reading terminality off it would mark the redriven message terminal before it
   * had tried anything. `ApproximateReceiveCount` RESETS on a redrive, because the move
   * re-sends the message, so it says what is actually being asked: how many chances are
   * left for THIS attempt at recovery.
   */
  const receiveCount = Number(record.attributes?.ApproximateReceiveCount ?? "1") || 1

  /** The last phase the pipeline announced; see `ProcessDeps.onPhase`. */
  let phase: IngestPhase | undefined

  const base = {
    at: "process-activity",
    messageId: record.messageId,
    source: job.source,
    externalId: job.externalId,
    ingestKey: job.ingestKey,
    coldStart,
    /**
     * Milliseconds between this module finishing evaluation and the first invocation
     * starting — NOT Lambda's init duration, which is already on the REPORT line and is
     * not reachable from inside a handler. Corrected after the first live invocation
     * logged `initMs: 29` beside `Init Duration: 349.43 ms`; a field claiming to be the
     * init duration and reporting a twelfth of it is worse than no field, because 0044
     * would alarm on the wrong number.
     *
     * It is still worth having: a large value here means the environment sat warm-but-
     * idle before its first message, which is a different story from a slow init.
     */
    sinceInitMs: coldStart ? startedAt - MODULE_LOADED_AT : undefined,
  }

  try {
    const result = await processActivity(job, {
      adapter: getAdapter(job.source),
      credentials: async (j) => oauthCredentialsFor(j),
      archive: { s3, bucket: required("RAW_ARCHIVE_BUCKET") },
      /**
       * `0192`. Where a `command: "reingest"` job reads its bytes: the SAME archive, read back
       * instead of written. Supplied unconditionally because the verb belongs to the message, not
       * to the worker's configuration — a replay must not require a redeploy to become possible,
       * and `processActivity` throws rather than falling back if this is ever missing.
       */
      replay: { s3, bucket: required("RAW_ARCHIVE_BUCKET") },
      receipt: { ddb },
      cells: { ddb, table: EXPLORED_CELL_TABLE },
      /**
       * `0049`. The same physical bucket as the archive today — one `defineStorage`
       * bucket holds `raw/` and `users/` — but read from its own variable, because the
       * two prefixes are granted separately in `amplify/backend.ts` and a single name
       * would make a future split a search-and-replace across two unrelated concerns.
       *
       * `ddb` is shared: the generation counter is a T6 item (D-218).
       */
      blobs: {
        s3,
        bucket: required("USER_DATA_BUCKET"),
        ddb,
        table: EXPLORED_CELL_TABLE,
        /**
         * `0051`. `PROFILE_TABLE` IS NOT SET, and that is the accurate state of the world —
         * T1 arrives with the XP engine (capability 09), so `mirrorGeneration` answers
         * `"no-table"` and the publish is unaffected. `required()` is deliberately NOT used:
         * the manifest is authoritative (`02` §6.4) and the mirror is only the AppSync
         * subscription's push channel, so its absence must not fail a cold start. Ticket
         * `0182` wires it.
         */
        mirror: { ddb, table: process.env.PROFILE_TABLE },
      },
      registry: RULES,
      persist: { ddb, activityTable: required("ACTIVITY_TABLE") },
      onPhase: (entered) => {
        phase = entered
      },
    })

    if (result.outcome === "not-claimable") {
      throw new ReceiptNotClaimableError(job.ingestKey, result.status)
    }

    /**
     * §3.6's LAST BULLET, and it is a `warn` rather than a field on the line below because it
     * is the one ingest outcome that looks completely normal and is not. Ticket `0180`.
     *
     * A watch emitting 2,000 fixes at 60 m accuracy produces an activity indistinguishable
     * from a treadmill run — zero cells, zero credit, no error — and the cause gets diagnosed
     * a month later, if at all. `rejects !== null` means a projection actually ran, so a
     * genuinely traceless activity logs nothing: it is not a fault.
     *
     * ONE LINE, NOT ONE PER SAMPLE. The counts are already aggregated by `traceToCells`; a
     * per-sample log would bury the signal it exists to raise and cost more than the ingest.
     */
    if (
      result.outcome === "persisted" &&
      // `!= null`, loosely: "a projection ran and reported counts". A traceless activity has
      // `null` and is not a fault; anything else absent means there is nothing to warn about.
      result.rejects != null &&
      result.award.cellCount === 0
    ) {
      log.warn({
        ...base,
        outcome: "trace-yielded-no-cells",
        activityId: result.activityId,
        rejects: result.rejects,
      })
    }

    /**
     * CRITERION 8. One line per invocation carrying the phase breakdown — this is what
     * 0044 alarms on, and it is why the pipeline returns timings rather than logging
     * them itself: a module that logs cannot be called twice in a test without noise.
     *
     * `log.info` and not `console.log`, so the credential-shaped redaction in
     * `lib/log.ts` applies. Nothing here should carry a token; that is exactly why the
     * last line of defence is at the log call and not at each call site.
     */
    log.info({
      ...base,
      outcome: result.outcome,
      totalMs: Date.now() - startedAt,
      ...(result.outcome === "persisted"
        ? {
            activityId: result.activityId,
            timings: result.timings,
            /**
             * `null` and `{advanced: 0, …}` are different stories and the log must be
             * able to tell them: the first is D-189 refusing to open the map for this
             * activity, the second is a run whose every cell was already known.
             */
            cells: result.cells ?? "revealsGround=false",
            /**
             * The generation the client will fetch, and what it cost. `null` means no
             * generation was bumped — a traceless activity must leave every cached client
             * exactly where it was (tickets `0069`, `0159`).
             */
            blobs: result.blobs,
            /** `0180`. Null for a traceless activity; zeros for a clean one. */
            rejects: result.rejects,
          }
        : { xpAwarded: result.xpAwarded, newCellCount: result.newCellCount }),
    })
  } catch (error) {
    /**
     * RULE 3. Caught by the shared, source-agnostic type rather than by a status code,
     * because `src/pipeline` may not name a vendor and neither may this file — the
     * adapter is what read the provider's headers and decided how long to wait.
     */
    if (error instanceof SourceRateLimitedError) {
      await delayMessage(record, error.retryAfterMs)
      log.warn({
        ...base,
        outcome: "rate-limited",
        step: error.step,
        retryAfterMs: error.retryAfterMs,
        totalMs: Date.now() - startedAt,
      })
      throw error
    }

    /**
     * RULE 2's visible half, and criterion 5's. The refresh-and-retry already happened
     * inside the adapter; by the time this is thrown the connection is marked
     * `NEEDS_REAUTH` and a human has to act. It keeps a distinct `outcome` because it is
     * the one failure the settings screen can repair, and telling it apart from an outage
     * is the difference between "reconnect" and "try again later".
     *
     * NOT A RETRY STORM, and the reason is upstream of this file: every later delivery
     * refuses at the credential store before any HTTP happens, so the two remaining
     * receives cost a DynamoDB read each and the message reaches the DLQ.
     */
    const needsReauth =
      error instanceof SourceNeedsReauthError || error instanceof SourceNotConnectedError

    /**
     * CRITERION 2 AND 3, TOGETHER — and they are one block on purpose. The receipt write
     * and the log line have to agree about what happened, and the surest way to keep two
     * records of one event in step is to derive both from the same values.
     */
    const terminal = isTerminalFailure(error, receiveCount)
    const rawArchived = archiveCompletedBy(phase)
    const errorClass = errorClassOf(error)

    /**
     * WRITTEN BEFORE THE LOG LINE, so the line can carry `attempts` off the row it just
     * wrote rather than guessing. `recordFailure` returns `undefined` when the receipt
     * reached DONE or aged out; the line still goes out, because a failure that could not
     * be recorded is MORE worth reading, not less.
     *
     * IT MUST NOT MASK THE ORIGINAL ERROR. If the receipt write itself throws, the thing
     * a human needs is still the failure that got us here — so its class is logged
     * alongside and the original is what propagates to the queue.
     */
    let receipt
    if (terminal) {
      try {
        receipt = await recordFailure(
          job.ingestKey,
          { userId: job.userId, errorClass, rawArchived },
          { ddb },
        )
      } catch (writeError) {
        log.error({ ...base, outcome: "failure-not-recorded", error: errorClassOf(writeError) })
      }
    }

    /**
     * ONE STRUCTURED LINE PER TERMINAL FAILURE (criterion 3), carrying every field the
     * runbook needs to decide what to do — and `rawArchived` is the one it branches on.
     *
     * `activityId` is COMPUTED, not read off the receipt, so the line is complete even
     * when there is no receipt to read: it is deterministic from (user, source, external
     * id) by I-5, which is the entire reason ids are derived rather than minted.
     *
     * `attempts` prefers the receipt's own counter — the number T8 defines and the
     * runbook quotes — and falls back to the delivery count when the row is gone.
     */
    log.error({
      ...base,
      event: terminal ? "ingest-failed" : "ingest-attempt-failed",
      outcome: needsReauth ? "needs-reauth" : "failed",
      terminal,
      userId: job.userId,
      activityId: computeActivityId(job.userId, job.source, job.externalId),
      attempts: receipt?.attempts ?? receiveCount,
      receiveCount,
      errorClass,
      phase: phase ?? "none",
      rawArchived,
      failureRecorded: terminal ? receipt !== undefined : false,
      ...(error instanceof SourceNeedsReauthError ? { detail: error.detail } : {}),
      totalMs: Date.now() - startedAt,
    })
    throw error
  }
}

/**
 * `batchSize: 1`, so this loop runs once. It is a loop anyway because the alternative —
 * `event.Records[0]` — would silently process one message and delete the rest if the
 * batch size were ever raised, and a dropped activity is permanent.
 *
 * NO `reportBatchItemFailures`. At a batch of one it would be ceremony: a thrown error
 * already fails the only message there is, and adding the response shape would make the
 * handler's contract depend on an event-source setting stated in another file.
 */
export const handler = async (event: SqsEvent): Promise<void> => {
  invocations += 1
  const coldStart = invocations === 1

  for (const record of event.Records) {
    await handleRecord(record, coldStart)
  }
}
