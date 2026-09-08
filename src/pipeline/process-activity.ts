import type { IngestJob, SourceAdapter } from "@/src/adapters/types"
import type { Activity, Trace } from "@/src/domain/activity"
import {
  awardOf,
  classifyCells,
  NO_CELLS,
  type DiscoveryAward,
} from "@/src/domain/discovery"
import { traceToCells } from "@/src/domain/fog"
import { matchable, revealsGround } from "@/src/rules/reveals-ground"
import type { RuleSkill } from "@/src/rules/schema"

import type { ArchiveDeps } from "./archive"
import {
  readCells,
  writeCells,
  type CellReadDeps,
  type CellWriteDeps,
  type CellWriteResult,
} from "./explored-cells"
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
 * THE PHASES, IN ORDER. Ticket 0044 — exported as an ordered array because the only
 * question anyone asks of it is a COMPARISON: "did we get as far as the archive?"
 *
 * The handler's failure log has to answer that (criterion 3's `rawArchived`, which the
 * ticket calls load-bearing: raw in S3 means the run is replayable forever from the
 * archive under D-101, raw missing means the only copy is still on the source's
 * servers). Nothing else in the pipeline can answer it — by the time an exception
 * reaches the handler, everything that knew how far it got is gone.
 */
export const INGEST_PHASES = [
  "credentials",
  "fetch",
  "archive",
  "normalize",
  "gate",
  /**
   * ITS OWN PHASE, ADDED BY `0047`, and not folded into `persist`.
   *
   * It sits BETWEEN the gate and the transaction because I-10 fixes it there (D-144), and
   * it is named separately because a failure here and a failure in the transaction mean
   * opposite things to an operator: a cell-write failure leaves the map ahead and the
   * receipt still `PROCESSING`, which self-heals on redelivery; a transaction failure
   * leaves nothing written at all. Reporting both as "persist" would erase the one
   * distinction §4's failure handling turns on. `persistMs` would also have quietly
   * become two numbers under one name.
   */
  "cells",
  "persist",
] as const

export type IngestPhase = (typeof INGEST_PHASES)[number]

/** Whether reaching `phase` means the archive PUT completed. */
export function archiveCompletedBy(phase: IngestPhase | undefined): boolean {
  if (phase === undefined) return false
  return INGEST_PHASES.indexOf(phase) >= INGEST_PHASES.indexOf("normalize")
}

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
  /** The 40–130 conditional `UpdateItem`s. Zero when the activity reveals no ground. */
  cellsMs: number
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
  | {
      outcome: "persisted"
      activityId: string
      timings: PhaseTimings
      /**
       * What the cell writes did. `null` when the activity reveals no ground — which is
       * NOT the same as `{advanced: 0, ...}`, and the difference is the whole of D-189: a
       * traced ride that wrote nothing because the rules said so must not look like a run
       * whose cells all happened to be replays.
       */
      cells: CellWriteResult | null
      /**
       * THE DISCOVERY AWARD (`0048`, §3.2). Never `null`: §3.6 requires a record even for
       * a treadmill run, so a no-cell activity carries `NO_CELLS` rather than nothing, and
       * the T3 row shape never varies. It is written, not returned for recomputation —
       * asking for it again once the cells are in the store gives a different answer.
       */
      award: DiscoveryAward
    }
  /**
   * A previous delivery finished this activity. The winner's numbers, read off the
   * receipt rather than recomputed — with rules that may have changed in between,
   * recomputing would not be the same answer (§4).
   */
  | { outcome: "already-done"; xpAwarded: number; newCellCount: number }
  /**
   * The receipt is in a state this delivery may not claim: another invocation is holding
   * it right now. NOT success and NOT an exception — the caller decides, and for an SQS
   * consumer the answer is "let it be redelivered".
   *
   * `FAILED` NO LONGER REACHES HERE (D-209, ticket 0044). It used to, and that made a
   * DLQ redrive a silent no-op — the redriven message did all the work and then lost the
   * claim to the very failure it was sent back to repair. The gate now reclaims it.
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
  cells: CellWriteDeps & CellReadDeps
  persist: PersistDeps
  /**
   * THE RULESET, AS AN ARGUMENT. D-189, D-217.
   *
   * Passed in rather than loaded here for the reason `selectActivitySkills` states: a
   * recomputation runs against the `rulesVersion` the activity was scored under, which may
   * not be the current one, and a module-level import would freeze that choice at build
   * time. It is also the only way this file stays testable without a filesystem.
   *
   * The handler reads it from `rules/xp-rules-v1.json`, the build artefact `0047` added
   * (D-217) — the YAML cannot be read from inside a bundled Lambda, and T5 does not exist
   * until capability 09.
   */
  registry: { skills: RuleSkill[] }
  /** Injected so timings are assertable. Wall clock; only differences are ever used. */
  clock?: () => number
  /**
   * CALLED AS EACH PHASE IS ENTERED. Ticket 0044.
   *
   * An OBSERVER, not a return value, because the caller that needs it is the one
   * handling an exception — and an exception carries nothing this function chose to
   * return. The handler keeps the last phase it was told about and reads it in its
   * `catch`.
   *
   * ─── WHY NOT ATTACH THE PHASE TO THE ERROR ──────────────────────────────────
   *
   * Wrapping the throw in an `IngestPhaseError` was the obvious alternative and it is
   * wrong here: the handler matches `SourceRateLimitedError` and `SourceNeedsReauthError`
   * with `instanceof` to apply §4's failure rules, and a wrapper breaks both matches.
   * Rewriting those to unwrap a cause would make two queue rules depend on this module
   * not forgetting to wrap. An observer changes no error contract at all.
   *
   * MUST NOT THROW. It is called on the success path too, and an observer that can fail
   * the import it is observing is worse than no observability.
   */
  onPhase?(phase: IngestPhase): void
}

export async function processActivity<TCreds>(
  job: IngestJob,
  deps: ProcessDeps<TCreds>,
): Promise<ProcessResult> {
  const clock = deps.clock ?? (() => Date.now())
  const phase = (name: IngestPhase) => deps.onPhase?.(name)
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

  phase("credentials")
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
      phase("fetch")
      const at = clock()
      let raw
      try {
        raw = await deps.adapter.fetchRaw(j, c)
      } finally {
        fetchMs = clock() - at
      }
      /**
       * The fetch returned, so `fetchArchiveNormalize` calls `archiveRaw` next — which
       * is why this is announced HERE and not inside that function. It takes no
       * instrumentation hook, deliberately (D-101: every argument it grows is another
       * thing a future edit could reorder), so the phase is inferred from the two calls
       * on either side of it. Reaching `normalize` below is what proves it completed.
       */
      phase("archive")
      return raw
    },
    normalize: (raw, ref, j) => {
      phase("normalize")
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
  phase("gate")
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
   * THE CELLS, FIRST AND OUTSIDE THE TRANSACTION. I-10, D-144, ticket `0047`.
   *
   * Above `persistActivity`, always. The skew this ordering chooses is **map ahead of XP,
   * never the reverse**: revealed-but-unscored ground self-heals because the receipt never
   * reached `DONE` and a redelivery re-runs these writes as conditional no-ops, whereas
   * scored-but-unrevealed ground could only be repaired by re-fogging, which D-020 forbids
   * outright. `persistActivity`'s `assertNoCellWrites` is what stops the writes ever
   * migrating below this line into the transaction, where the 100-item cap would start
   * failing them silently on exactly the longest runs.
   *
   * A THROW HERE IS SAFE, and that is why nothing catches it: the transaction has not run,
   * so there is no `Activity` row and no `DONE` receipt, and the redelivery repeats the
   * whole set idempotently.
   */
  phase("cells")
  const t3c = clock()
  const { cells, award } = await projectCells(ingest, deps)
  const cellsMs = clock() - t3c

  phase("persist")
  const t3 = clock()
  /**
   * THE AWARD GOES IN THE TRANSACTION, not in a write of its own. §3.2: *"the award is
   * stored, not recomputed"* — and it is stored in the same atomic commit that closes the
   * receipt, so there is no state in which an activity is `DONE` and its cell counts are
   * missing. `newCellCount` also lands on the receipt, which is how a later duplicate
   * answers without reclassifying against a store that has since changed.
   */
  await persistActivity(
    ingest.activity,
    { ingestKey: job.ingestKey, newCellCount: award.newCellCount },
    deps.persist,
    [],
    award,
  )
  const persistMs = clock() - t3

  return {
    outcome: "persisted",
    activityId: ingest.activity.activityId,
    cells,
    award,
    timings: {
      credentialsMs,
      fetchMs,
      archiveMs,
      normalizeMs,
      gateMs,
      cellsMs,
      persistMs,
      totalMs: clock() - startedAt,
    },
  }
}

/**
 * TRACE → CELLS → CLASSIFY → T6, or nothing at all. Tickets `0047` and `0048`;
 * `05-fog-of-war.md` §3.2; D-189, D-120, D-020.
 *
 * THREE WAYS TO WRITE NOTHING, and they are not the same thing:
 *
 *   1. **No trace.** A treadmill run, a manual entry, a strength session — `05` §3.6,
 *      verbatim: no trace ⇒ no projection ⇒ no cells ⇒ no `ExploredCell` write and no
 *      Cartography award. It falls out with no field and no branch of its own.
 *   2. **The rules say this activity does not open the map** (D-189). A road ride has a
 *      real trace and real geometry and must write **none** of it. The write result is
 *      `null` rather than an empty one so the caller can tell the two apart — the log line
 *      for "the rules refused" and for "every cell was a replay" must not be identical.
 *   3. **An empty cell set** from a trace too short or too degraded to qualify anything.
 *      A real result with zero writes, because the map was consulted and had nothing to
 *      add. §3.6 treats an entirely-filtered trace as no-GPS, which is what this is.
 *
 * **The award is `NO_CELLS` in all three, never absent.** §3.6 requires the record to be
 * written with `cellCount: 0` even for a treadmill run, so the idempotency gate covers
 * no-GPS activities and re-import stays a no-op — and so no reader ever has to tell
 * "absent" from "none".
 *
 * `revealsGround` is a DATA LOOKUP on the matched skill row, never a `switch` on
 * `ActivityKind` (D-031/D-141) — see `src/rules/reveals-ground.ts`.
 *
 * ─── READ, CLASSIFY, THEN WRITE. THE ORDER IS THE ALGORITHM ─────────────────
 *
 * §3.3's last bullet: every cell is classified against the store as it was **before this
 * activity**, so the read is one shot up front and the classifier gets a map rather than a
 * store handle. Interleaving them makes the second half of a long run through new
 * territory come back "cooled" — the first half having already moved `lastRunAt` — which
 * silently halves the credit of exactly the runs the game exists to reward.
 */
async function projectCells<TCreds>(
  ingest: { activity: Activity; trace?: Trace },
  deps: ProcessDeps<TCreds>,
): Promise<{ cells: CellWriteResult | null; award: DiscoveryAward }> {
  const { activity, trace } = ingest
  const nothing = { cells: null, award: NO_CELLS }

  if (!revealsGround(matchable(activity), deps.registry)) return nothing
  if (!trace) return { cells: null, award: NO_CELLS }

  const cells = traceToCells(trace)
  if (cells.size === 0) {
    // A trace with points but nothing that survived §2.2 is no-GPS (§3.6). Distinguished
    // from "no trace" only in the log; both award nothing and write nothing.
    return { cells: { advanced: 0, backfilled: 0, unchanged: 0 }, award: NO_CELLS }
  }

  // 2. CLASSIFY, against pre-run state, in one read.
  const records = await readCells(cells, activity.userId, deps.cells)
  const classified = classifyCells(cells, records, activity.startedAt)
  const award = awardOf(classified)

  // 4. WRITE, carrying each cell's verdict. Never re-reading.
  return { cells: await writeCells(classified, activity, deps.cells), award }
}
