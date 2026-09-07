import type { IngestJob, SourceAdapter } from "@/src/adapters/types"

import type { ArchiveDeps } from "./archive"
import { fetchArchiveNormalize } from "./fetch-archive-normalize"
import {
  claimForScoring,
  recordDelivery,
  type ReceiptDeps,
  type ReceiptStatus,
} from "./ingest-receipt"
import { persistActivity, type PersistDeps } from "./persist"

/**
 * THE WORKER, AS A FUNCTION. Ticket 0042, `01-architecture.md` §4 steps 6-15.
 *
 * ─── WHAT THIS IS AND IS NOT ────────────────────────────────────────────────
 *
 * It is the six phases in the one order they are allowed to run in. It is NOT the
 * Lambda: nothing here knows a queue exists, and that separation is the reason the
 * ordering can be tested at all. `amplify/functions/process-activity/handler.ts` is the
 * half that owns SQS — receipt handles, visibility timeouts, what a thrown error means
 * to a redrive policy — and it holds no pipeline logic in return.
 *
 * The split matters more than it looks. The failure rules in §4 ("refresh once, retry
 * once, then fail to the DLQ"; "return the message to the queue with a delay") are
 * statements about a QUEUE, and a queue is exactly the thing this project may end up
 * replacing when capability 14 adds a second producer. Putting them here would make the
 * pipeline's tests depend on SQS semantics for a rule that is not about ingestion.
 *
 * ─── THE ORDER, AND WHY EACH STEP IS WHERE IT IS ────────────────────────────
 *
 *   credentials → fetch → archive → normalize → score gate → persist
 *
 * The middle three are one call, `fetchArchiveNormalize`, and that is not an aesthetic
 * grouping: D-101 forbids normalizing bytes that have not been archived, and 0039's own
 * note is that `Promise.all([archive, normalize])` would pass every test and destroy the
 * guarantee the first time an archive PUT failed. That module exists to make the
 * ordering a seam with a test rather than a convention in a handler that has five other
 * things to do.
 *
 * THE SCORE GATE COMES AFTER NORMALIZE, not before, and it costs a fetch on the
 * duplicate path. §4 step 12 puts it there deliberately: the claim is what must be held
 * across the write, so claiming early and then spending seconds on the network widens
 * the window in which a crash leaves a `PROCESSING` receipt behind. The wasted fetch is
 * paid for by layer 1 — the accept gate (§4 step 3) already refused the ordinary
 * duplicate before it was ever enqueued — so what reaches this gate is a genuine SQS
 * redelivery, which is rare. The archive PUT on that path is content-addressed and
 * conditional, so it writes nothing the second time.
 *
 * NOTHING HERE NAMES A SOURCE. `check-boundaries.mjs` enforces that over this whole
 * directory, and the adapter arrives as an argument for the same reason: swapping the
 * primary source must not produce a diff in this file (D-100, D-121.1).
 */

/**
 * Per-phase wall-clock, in milliseconds. Criterion 8 — 0044 alarms on these, and an
 * alarm needs a number that means one thing.
 *
 * `archiveMs` IS DERIVED BY SUBTRACTION, and that is worth stating rather than hiding.
 * The fetch, the archive PUT and the normalize happen inside `fetchArchiveNormalize`,
 * which takes no instrumentation hook — deliberately, because every argument that
 * function grows is another thing a future edit could reorder. So the adapter is wrapped
 * to time its own two phases and the archive is what is left over. The error that
 * introduces is one subtraction's worth of loop overhead, which is nothing against a
 * network call, and the alternative was a callback parameter on the one function in this
 * pipeline that must stay boring.
 */
export interface PhaseTimings {
  credentialsMs: number
  fetchMs: number
  archiveMs: number
  normalizeMs: number
  gateMs: number
  persistMs: number
  totalMs: number
}

/**
 * WHAT HAPPENED, AS A VALUE — never as a thrown error for the benign cases.
 *
 * A redelivery that loses the claim is a NORMAL outcome of at-least-once delivery, not a
 * fault, and modelling it as an exception would make the handler's `catch` the place
 * where "this worked" and "this broke" are told apart. Three of the four outcomes below
 * are dispositions the caller has to choose between, so they are returned and the
 * choosing is done where the queue is understood.
 */
export type ProcessResult =
  /** Claimed, scored and committed. The only outcome that wrote an `Activity` row. */
  | { outcome: "persisted"; activityId: string; timings: PhaseTimings }
  /**
   * A previous delivery finished this activity. The winner's numbers, read off the
   * receipt rather than recomputed — with rules that may have changed in between,
   * recomputing would not be the same answer (§4).
   */
  | { outcome: "already-done"; xpAwarded: number; newCellCount: number }
  /**
   * The receipt is in a state this delivery may not claim: another invocation holds it,
   * or a previous one recorded a failure. NOT success and NOT an exception — the caller
   * decides, and for an SQS consumer the answer is "let it be redelivered".
   */
  | { outcome: "not-claimable"; status: ReceiptStatus }

export interface ProcessDeps<TCreds> {
  /**
   * Resolved by the CALLER, through `getAdapter(job.source)`. Passed in rather than
   * looked up here so a test needs no registry, and so this module imports nothing that
   * knows a concrete source exists.
   */
  adapter: SourceAdapter<TCreds>
  /**
   * A FUNCTION, and it is handed the job. Credentials are per (user, source), they
   * rotate, and resolving them may itself refresh and write back — so a value captured
   * before this call would be a credential frozen at some earlier instant, which is the
   * thing `lib/sources/token-refresh.ts` exists to stop anyone doing.
   */
  credentials(job: IngestJob): Promise<TCreds>
  archive: ArchiveDeps
  receipt: ReceiptDeps
  persist: PersistDeps
  /** Injected so timings are assertable. Wall clock; only differences are ever used. */
  clock?: () => number
}

export async function processActivity<TCreds>(
  job: IngestJob,
  deps: ProcessDeps<TCreds>,
): Promise<ProcessResult> {
  const clock = deps.clock ?? (() => Date.now())
  const startedAt = clock()

  /**
   * COUNTED FIRST, BEFORE ANYTHING CAN FAIL. T8's `attempts` is "ADD 1 per delivery" and
   * 0040's note is explicit that folding it into the claim would break that sentence,
   * because a failed `ConditionExpression` writes nothing — so the delivery worth
   * counting is precisely the one that would go uncounted.
   *
   * It is also the first thing that touches the receipt row, which makes it the natural
   * place for a message that never passed the accept gate to be rejected: `recordDelivery`
   * is conditional on the row existing and throws when it does not. A hand-crafted or
   * long-expired message therefore fails here, having spent no network call on the
   * source and written nothing.
   */
  const attempt = await recordDelivery(job.ingestKey, deps.receipt)

  const t0 = clock()
  const creds = await deps.credentials(job)
  const credentialsMs = clock() - t0

  /**
   * The timing wrapper. `id` and `listSince` come through the spread untouched; only the
   * two phases this call actually uses are instrumented, and each records even when it
   * throws so a failed fetch still reports how long it spent failing.
   */
  let fetchMs = 0
  let normalizeMs = 0
  const timedAdapter: SourceAdapter<TCreds> = {
    ...deps.adapter,
    fetchRaw: async (j, c) => {
      const at = clock()
      try {
        return await deps.adapter.fetchRaw(j, c)
      } finally {
        fetchMs = clock() - at
      }
    },
    normalize: (raw, ref, j) => {
      const at = clock()
      try {
        return deps.adapter.normalize(raw, ref, j)
      } finally {
        normalizeMs = clock() - at
      }
    },
  }

  const t1 = clock()
  const { ingest } = await fetchArchiveNormalize(timedAdapter, job, creds, deps.archive)
  const archiveMs = Math.max(0, clock() - t1 - fetchMs - normalizeMs)

  /**
   * THE SCORE GATE (§4 step 12, layer 2). Everything above this line is repeatable and
   * writes nothing that a second run would corrupt; everything below it is the award.
   */
  const t2 = clock()
  const claim = await claimForScoring(job.ingestKey, deps.receipt)
  const gateMs = clock() - t2

  if (claim.kind === "duplicate") {
    if (claim.status === "DONE") {
      return {
        outcome: "already-done",
        xpAwarded: claim.xpAwarded ?? 0,
        newCellCount: claim.newCellCount ?? 0,
      }
    }
    return { outcome: "not-claimable", status: claim.status }
  }

  /**
   * `attempt` is read but not branched on: the retry budget belongs to the queue's
   * redrive policy, not to this function (§4 "Failure handling"). Two counters deciding
   * when to give up is how a message gets abandoned before the DLQ has seen it.
   */
  void attempt

  /**
   * CELLS ARE NOT WRITTEN HERE, and their absence is load-bearing rather than pending.
   * I-10 fixes the ordering — cells first, OUTSIDE and BEFORE the transaction (D-144) —
   * and capability 07 is what adds the writer. When it does, it goes above this line and
   * `persistActivity`'s `assertNoCellWrites` is what stops it going below.
   */
  const t3 = clock()
  await persistActivity(ingest.activity, { ingestKey: job.ingestKey }, deps.persist)
  const persistMs = clock() - t3

  return {
    outcome: "persisted",
    activityId: ingest.activity.activityId,
    timings: {
      credentialsMs,
      fetchMs,
      archiveMs,
      normalizeMs,
      gateMs,
      persistMs,
      totalMs: clock() - startedAt,
    },
  }
}
