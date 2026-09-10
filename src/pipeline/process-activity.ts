import type { IngestJob, SourceAdapter } from "@/src/adapters/types"
import type { H3Index } from "h3-js"

import type { Activity, Trace } from "@/src/domain/activity"
import {
  awardOf,
  classifyCells,
  needsReplay,
  NO_CELLS,
  type DiscoveryAward,
} from "@/src/domain/discovery"
import { traceToCells, traceToSegments, type TraceRejects } from "@/src/domain/fog"
import { matchable, revealsGround } from "@/src/rules/reveals-ground"
import type { RuleSkill } from "@/src/rules/schema"

import type { ArchiveDeps } from "./archive"
import {
  lastRunDay,
  readCells,
  writeAggregates,
  writeCells,
  type CellReadDeps,
  type CellWriteDeps,
  type CellWriteResult,
} from "./explored-cells"
import {
  appendCellsToRun,
  regenerateExplored,
  type BlobStoreDeps,
  type RegenerateResult,
} from "./explored-blob-store"
import { markReplayPending } from "./explored-generation"
import { replayAdapter, type ReplayDeps } from "./replay"
import { fetchArchiveNormalize } from "./fetch-archive-normalize"
import {
  claimForScoring,
  recordDelivery,
  type ReceiptDeps,
  type ReceiptStatus,
} from "./ingest-receipt"
import { persistActivity, type PersistDeps } from "./persist"
import { writeRouteTrace, type RouteTraceDeps } from "./route-trace-store"

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
  /**
   * THE PUBLISH, ADDED BY `0049`, and it sits BETWEEN the cells and the transaction for
   * the reason the cells sit above it (`02` §2.10, §6.4).
   *
   * If it ran after `persist`, a failure here would leave the receipt `DONE` with the
   * activity's cells in T6 but in no blob — and the next run merges from the last
   * PUBLISHED generation, so those cells would be absent from every generation after it,
   * permanently, until an AP-17 repair. Running it first makes the failure self-healing:
   * the receipt is still `PROCESSING`, and a redelivery re-merges the same cell set.
   *
   * The skew it chooses is the same one D-144 chose — map ahead of XP, never the reverse.
   */
  "blobs",
  /**
   * THE ROUTE GEOMETRY, ADDED BY `0195` (`02` §5.1's S-7). Above the transaction, for the
   * reason `cells` and `blobs` are: the PUT is idempotent under a deterministic key, so a
   * failure here leaves the receipt `PROCESSING` with no `Activity` row and redelivery
   * repeats the whole set. Below the transaction it would leave rows carrying a `traceRef`
   * pointing at an object that was never written.
   *
   * Its own phase rather than folded into `persist` for `cells`' reason: a failure here means
   * "the map has the ground but not the line", which self-heals, and a transaction failure
   * means nothing was written at all. One name for both would erase that.
   */
  "traces",
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
  /**
   * The §2.10 regeneration: two S3 GETs, four PUTs, and one merge over 20k–150k cells.
   * R3 §6 budgets it under 100 ms at the five-year worst case. Zero when nothing revealed.
   */
  blobsMs: number
  /**
   * `0195`. One gzip and one S3 PUT of a few KB. Zero when the activity carries no trace —
   * a treadmill run, a manual entry, a strength session.
   */
  tracesMs: number
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
      /**
       * What the client will see, and when. `null` when nothing revealed ground — a
       * treadmill run must not bump a generation, because every cached client would refetch
       * a 300 KB blob identical to the one it holds (tickets `0069`, `0159`).
       */
      blobs: RegenerateResult | null
      /**
       * `0180`. `null` when nothing was projected — no trace, or D-189 refused. Non-null with
       * `award.cellCount === 0` is §3.6's silently-garbage recording, and the handler warns.
       */
      rejects: TraceRejects | null
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
  /**
   * REPLAY'S BYTE SOURCE. Ticket `0192`. Required for a `command: "reingest"` job and unused by an
   * ordinary one — a `reingest` that arrives without it fails loudly rather than quietly falling
   * back to the network, which is the whole point of `replay.ts`.
   */
  replay?: ReplayDeps
  receipt: ReceiptDeps
  cells: CellWriteDeps & CellReadDeps
  /** S3 + the generation counter. `0049`, `02` §2.10. */
  blobs: BlobStoreDeps
  /**
   * `0195`. Where the per-activity route geometry is written (`02` §5.1, S-7).
   *
   * OPTIONAL, and its absence is a no-op rather than a throw. The rebuild drill (`0102`/`0103`)
   * re-derives cells over thousands of archived activities and has no reason to rewrite geometry
   * that is already there; `required()` would make it provide a bucket to skip the work.
   * `traceRef` is then left as `normalize()` produced it, which is exactly what a re-derivation
   * that did not touch the object should do.
   */
  traces?: RouteTraceDeps
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
   * `reingest` — THE REPLAY VERB. Ticket `0192`.
   *
   * `IngestCommandKind` has declared `"ingest" | "reingest"` since `0026` and nothing read it until
   * now, so this is completing the contract rather than extending it. Two things change and nothing
   * else does: the bytes come from the S3 archive instead of the source (`replay.ts` — a re-fetch
   * could return DIFFERENT bytes and reveal different ground on a map that never re-fogs), and the
   * score gate will re-claim a `DONE` receipt.
   *
   * It is read from the job rather than from a deps flag so that the deployed worker needs no
   * configuration to serve one: a replay is a property of the message, which is what makes it
   * auditable in the queue.
   */
  const isReplay = job.command === "reingest"
  if (isReplay && !deps.replay) {
    throw new Error(
      `job ${job.ingestKey} is a reingest but no replay deps were supplied. Refusing to fall back ` +
        "to the source: replaying different bytes can reveal different ground permanently (D-020).",
    )
  }

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
  const source = isReplay ? replayAdapter(deps.adapter, deps.replay!) : deps.adapter
  const timedAdapter: SourceAdapter<TCreds> = {
    ...source,
    fetchRaw: async (j, c) => {
      phase("fetch")
      const at = clock()
      let raw
      try {
        raw = await source.fetchRaw(j, c)
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
        // `source.normalize` IS `deps.adapter.normalize` even under replay — `replayAdapter`
        // replaces `fetchRaw` and nothing else, so there is exactly one normalizer in the system.
        return source.normalize(raw, ref, j)
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
  const claim = await claimForScoring(job.ingestKey, deps.receipt, { replay: isReplay })
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
  const { cells, award, touched, rejects } = await projectCells(ingest, deps)
  const cellsMs = clock() - t3c

  /**
   * THE PUBLISH. Above the transaction; see the `blobs` phase note on `INGEST_PHASES`.
   *
   * `touched` is EVERY cell the run crossed, not just the new ones: the merge works out
   * which are new by itself, and the sidecar needs the whole set to advance `lastRunDay` on
   * ground that was re-run. `day` comes from `activity.startedAt` (I-12), never the clock.
   */
  phase("blobs")
  const t3b = clock()
  const blobs =
    touched === null || touched.size === 0
      ? null
      : await regenerateExplored(
          {
            userId: ingest.activity.userId,
            touched,
            day: lastRunDay(ingest.activity.startedAt),
          },
          deps.blobs,
        )
  const blobsMs = clock() - t3b

  /**
   * `0195` — THE ROUTE GEOMETRY (`02` §5.1's S-7). See the `traces` note on `INGEST_PHASES`.
   *
   * WRITTEN FOR ANY ACTIVITY WITH A TRACE, whether or not it revealed ground. `traceRef` is a
   * fact about the recording — *"here is where this went"* — not a game-layer verdict, and T3
   * documents its null case as *"treadmill, manual, strength"*, which is a statement about
   * having a trace and not about `revealsGround`. A traced ride that D-189's rules refuse still
   * has a line worth drawing; deciding otherwise here would put a rules question in the store.
   *
   * `traceToSegments` runs a SECOND TIME here — `traceToCells` already ran it internally, and
   * the function is pure so the answer is identical. Steps 1-3 are one linear pass over the
   * points; step 4's densify-and-`gridDisk` and step 5's point-to-segment filter dominate the
   * projection by orders of magnitude. Threading the segments out of `projectCells` to save it
   * would widen two signatures to dodge a cost that does not show up in `cellsMs`.
   */
  phase("traces")
  const t3t = clock()
  const traceRef =
    ingest.trace && deps.traces
      ? await writeRouteTrace(
          {
            userId: ingest.activity.userId,
            activityId: ingest.activity.activityId,
            segments: traceToSegments(ingest.trace).segments,
          },
          deps.traces,
        )
      : null
  const tracesMs = clock() - t3t

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
    /**
     * `traceRef` REACHES T3 HERE AND NOWHERE ELSE. `normalize()` sets it to `null` and says the
     * pipeline fills it in (`strava/normalize.ts`); until `0195` nothing did, so the column was
     * null on every row ever written. `null` stays `null` when there was no trace to store.
     */
    traceRef === null ? ingest.activity : { ...ingest.activity, traceRef },
    { ingestKey: job.ingestKey, newCellCount: award.newCellCount },
    deps.persist,
    [],
    award,
    rejects ?? undefined,
  )
  const persistMs = clock() - t3

  return {
    outcome: "persisted",
    activityId: ingest.activity.activityId,
    cells,
    award,
    blobs,
    rejects,
    timings: {
      credentialsMs,
      fetchMs,
      archiveMs,
      normalizeMs,
      gateMs,
      cellsMs,
      blobsMs,
      tracesMs,
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
): Promise<{
  cells: CellWriteResult | null
  award: DiscoveryAward
  /**
   * Every cell the run crossed, or `null` when it crossed none. Handed on to the publish
   * phase — which needs the whole set, not just the new part, because `lastRunDay` advances
   * on re-run ground too. `null` and an empty set mean the same thing to that phase and are
   * distinguished only for the reasons the three cases below are.
   */
  touched: ReadonlySet<H3Index> | null
  /**
   * Why the projection dropped what it dropped (`0180`, §3.6). `null` when no projection ran
   * at all — no trace, or the rules refused — which is what lets the handler tell "there was
   * nothing to project" from "there was something and it all failed the gates".
   */
  rejects: TraceRejects | null
}> {
  const { activity, trace } = ingest
  const nothing = { cells: null, award: NO_CELLS, touched: null, rejects: null }

  if (!revealsGround(matchable(activity), deps.registry)) return nothing
  if (!trace) return nothing

  const cells = traceToCells(trace)
  if (cells.size === 0) {
    // A trace with points but nothing that survived §2.2 is no-GPS (§3.6). Distinguished
    // from "no trace" only in the log; both award nothing and write nothing.
    return {
      cells: { advanced: 0, backfilled: 0, unchanged: 0 },
      award: NO_CELLS,
      touched: null,
      // The case §3.6's last bullet is about: points went in, nothing came out. The counts
      // are the only thing that says why, and the handler warns on exactly this shape.
      rejects: cells.rejects,
    }
  }

  // 2. CLASSIFY, against pre-run state, in one read.
  const records = await readCells(cells, activity.userId, deps.cells)
  const classified = classifyCells(cells, records, activity.startedAt)
  const award = awardOf(classified)

  // 4. WRITE, carrying each cell's verdict. Never re-reading.
  const written = await writeCells(classified, activity, deps.cells)

  /**
   * 5. THE AGGREGATE ITEMS, AFTER the cells and never before. T6 item type B exists so
   * AP-17 can enumerate this user's res-6 partitions without a `Scan`, and an aggregate
   * naming a partition whose cells failed to write would send the repair path looking for
   * something that is not there. `writeCells` throws on partial failure, so reaching this
   * line means every cell landed.
   */
  await writeAggregates(classified, activity, deps.cells)

  /**
   * 6. THE PER-RUN CELL RECORD (`0050`; `02` §8.3 step 4, `05` §3.5). Written for every scored
   * activity, so a revision can be un-awarded and a fold can be run without re-deriving
   * geometry under a `fogAlgoVersion` that has since moved.
   */
  await appendCellsToRun(activity.userId, activity.activityId, cells, deps.blobs)

  /**
   * 7. IF ANY CELL COULD NOT BE SCORED, MARK THE USER FOR A REPLAY (§3.4).
   *
   * The cells are already written and the deferred ones earned zero, so the map is correct and
   * the XP is deliberately low. D-135 permits only additions, so a replay can raise this and
   * never lower it. The marker is a conditional `min`, so the earliest activity needing one
   * wins and two backfills in flight cannot stomp each other.
   */
  if (needsReplay(award)) {
    await markReplayPending(activity.userId, activity.startedAt, deps.cells)
  }

  return { cells: written, award, touched: cells, rejects: cells.rejects }
}
