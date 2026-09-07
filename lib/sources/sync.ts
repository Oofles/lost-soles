import { computeActivityId } from "@/src/domain/activity-id"
import type { IngestJob, SourceAdapter } from "@/src/adapters/types"
import {
  acceptIngest,
  readReceipt,
  type ReceiptDeps,
} from "@/src/pipeline/ingest-receipt"

import { SWEEP_OVERLAP_SECONDS, nextListSinceWatermark } from "./list-since-watermark"

/**
 * THE SWEEP, AS A FUNCTION. Ticket 0043, `09-roadmap.md` §4.5.
 *
 * List everything since the watermark, put a receipt down for each activity, enqueue it,
 * and move the watermark to wherever the enqueues actually got to. `app/sync-action.ts`
 * is the authenticated wrapper; this is the part with the rules in it.
 *
 * ─── WHY THE SEAMS ARE INJECTED HERE AND NOT IN THE REST OF `lib/sources/` ──
 *
 * The two `*-store.ts` modules use a module-level document client with a
 * `__setDocClient` test hook, and `token-refresh.ts` follows them. This file does not,
 * because what needs testing is not a table — it is the ARITHMETIC of the watermark
 * under partial failure, which is `src/pipeline`'s kind of problem and takes
 * `src/pipeline`'s kind of seam. A test here has to be able to say "the fourth enqueue
 * fails" without a DynamoDB stub anywhere near it.
 *
 * ─── WHAT THIS IS DELIBERATELY NOT ──────────────────────────────────────────
 *
 * It does not fetch, normalize, score or persist. It enqueues ids and lets
 * `process-activity` do the work, so a large sweep spreads across invocations instead of
 * blowing the action's latency budget — the ticket's own note, and the reason the queue
 * exists at all.
 */

/**
 * HOW FAR BACK A FIRST SYNC LOOKS, when a connection has never been swept.
 *
 * `readListSinceWatermark` returns `null` for a new connection and its own comment says
 * the caller must not treat that as "swept and found nothing" — it is "the backfill
 * boundary decision". Nothing in the design decided it, so this is the decision, taken
 * with the operator in ticket 0043 and recorded here rather than in a magic number.
 *
 * THIRTY DAYS, AND THE CONSTRAINT IS THE RATE LIMIT, not taste. The connected account has
 * years of history; listing it is one cheap call per page, but ENQUEUEING it is two
 * provider requests per activity in the worker, against a budget of 100 reads per 15
 * minutes (`03-integrations.md` §2.5). An unbounded first sync is therefore ~3,200
 * requests — about eight hours of quota — and the 429 handling built in `0042` would
 * return each message to the queue with a delay until its three receives ran out and it
 * reached the DLQ. It would look like a broken import rather than a paced one.
 *
 * A month is ~15-20 runs here: comfortably inside one 15-minute window, and enough ground
 * to make the map worth looking at when capability 08 lands. **Full historical backfill
 * is a separate problem** — it needs budget pacing, resume across invocations and a
 * progress surface — and has its own ticket.
 */
export const FIRST_SYNC_LOOKBACK_DAYS = 30

export type SourceSyncOutcome =
  /** Activities were listed. `queued` may be 0 if every one was already in the ledger. */
  | { sourceId: string; kind: "queued"; queued: number; alreadyKnown: number }
  /** The source returned nothing in the window. Not an error, and the watermark holds. */
  | { sourceId: string; kind: "nothing-new" }
  /** `NEEDS_REAUTH`, or a credential that died mid-sweep. A human has to act. */
  | { sourceId: string; kind: "reconnect" }
  /** Never connected, or disconnected. Distinct from the above: nothing broke. */
  | { sourceId: string; kind: "not-connected" }
  /** Something else went wrong. `queued` is what did land before it did. */
  | { sourceId: string; kind: "failed"; queued: number; detail: string }

export interface SyncDeps {
  /** Resolved by the caller through `getAdapter`, so this module names no source. */
  adapter: SourceAdapter<unknown>
  /** Whatever that adapter takes. Opaque here — see `oauthCredentialsFor`. */
  credentials: unknown
  receipt: ReceiptDeps
  /**
   * Puts one job on the queue. MUST throw if the message did not land — the watermark
   * rule's entire correctness rests on this promise, because a silent failure here is
   * indistinguishable from success and would advance the watermark past a run that was
   * never imported.
   */
  enqueue(job: IngestJob): Promise<void>
  readWatermark(): Promise<string | null>
  advanceWatermark(value: string): Promise<void>
  now?: () => Date
}

/** The window a never-swept connection starts from. */
export function firstSyncBoundary(now: Date): string {
  return new Date(now.getTime() - FIRST_SYNC_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Whether this job needs to go on the queue.
 *
 * ─── THE ACCEPT GATE, AND THE HOLE IT LEAVES ────────────────────────────────
 *
 * `acceptIngest` is a conditional `PutItem` on `ingestKey` (§4 step 3, layer 1). A
 * `duplicate` normally means "already in the ledger, skip" — that is what makes pressing
 * Sync twice cost one conditional write per activity and nothing else, which the ticket
 * relies on.
 *
 * But accept-then-enqueue is two operations, and a failure between them leaves a receipt
 * with no message. Every later sweep would then see `duplicate`, skip, and the activity
 * would be **permanently blocked** — never imported, never in the DLQ, never anywhere a
 * human looks. On a map that by D-020 cannot re-fog, that is ground lost for good.
 *
 * So a duplicate is checked rather than trusted: a receipt still `QUEUED` with `attempts`
 * of zero was accepted and never delivered, and is re-enqueued. One extra read on the
 * duplicate path only, which is the path the 48-hour overlap makes common and cheap.
 *
 * `attempts > 0` means a delivery happened, so the message reached the worker and the
 * queue's redrive policy owns it from there — re-enqueueing would duplicate work the DLQ
 * is already accounting for.
 */
async function needsEnqueue(
  job: IngestJob,
  userId: string,
  deps: SyncDeps,
): Promise<boolean> {
  const accepted = await acceptIngest(
    {
      ingestKey: job.ingestKey,
      userId,
      activityId: computeActivityId(userId, job.source, job.externalId),
      source: job.source,
    },
    deps.receipt,
  )
  if (accepted.kind === "accepted") return true

  const existing = await readReceipt(job.ingestKey, deps.receipt)
  return existing?.status === "QUEUED" && (existing.attempts ?? 0) === 0
}

/**
 * One source, one sweep.
 *
 * NOTHING IS THROWN FOR AN EXPECTED FAILURE. Every outcome is a value, because the caller
 * is a button and "the provider was slow" has to render as a sentence rather than as a
 * stack trace. What is NOT swallowed is the watermark: it advances on the same evidence
 * whether the sweep finished or died halfway, which is the only reason a partial sweep is
 * safe to retry.
 */
export async function syncSource(
  userId: string,
  sourceId: string,
  deps: SyncDeps,
): Promise<SourceSyncOutcome> {
  const now = deps.now?.() ?? new Date()
  const previous = (await deps.readWatermark()) ?? firstSyncBoundary(now)

  /**
   * ISO start dates, split by whether the enqueue is KNOWN to have landed. This is the
   * whole input to the watermark rule, and the split is the reason `IngestJob` carries
   * `startedAt` at all (D-208).
   */
  const confirmed: string[] = []
  const unconfirmed: string[] = []
  let queued = 0
  let alreadyKnown = 0
  let failure: string | undefined

  try {
    for await (const job of deps.adapter.listSince(userId, previous, deps.credentials)) {
      try {
        if (await needsEnqueue(job, userId, deps)) {
          await deps.enqueue(job)
          queued += 1
        } else {
          alreadyKnown += 1
        }
        confirmed.push(job.startedAt)
      } catch (error) {
        /**
         * ONE ACTIVITY FAILED, AND THE SWEEP CONTINUES. The rest of the page may be
         * fine, and each one that lands is a run on the map. The failure is recorded as
         * `unconfirmed`, which pins the watermark below it — including below anything
         * NEWER that succeeded, which is exactly what the rule is for.
         */
        unconfirmed.push(job.startedAt)
        failure ??= describe(error)
      }
    }
  } catch (error) {
    /**
     * THE SOURCE ITSELF STOPPED — a rate limit, an outage, a dead credential. Thrown by
     * the generator, so it lands here rather than in the loop body.
     *
     * Everything already confirmed still counts, and that is safe rather than optimistic:
     * `listSince` pages oldest-first, so activities we never saw are NEWER than everything
     * we did, and a watermark at `newest(confirmed) − overlap` cannot skip one.
     */
    if (isReauth(error)) return { sourceId, kind: "reconnect" }
    failure ??= describe(error)
  }

  /**
   * NOTHING SEEN AT ALL. Reported as its own outcome rather than as "0 queued", because
   * the two mean different things to whoever pressed the button — and the watermark rule
   * refuses to advance on an empty result for the same reason.
   */
  if (confirmed.length === 0 && unconfirmed.length === 0) {
    return failure === undefined
      ? { sourceId, kind: "nothing-new" }
      : { sourceId, kind: "failed", queued, detail: failure }
  }

  /**
   * THE ADVANCE, AND IT HAPPENS EVEN ON A PARTIAL SWEEP. `nextListSinceWatermark` is
   * built to be handed the facts of a half-finished run — that is what `unconfirmed` is
   * for — so withholding the call after a failure would keep the watermark at a value the
   * next sweep has already re-listed from, and lose the progress that did happen.
   *
   * `SWEEP_OVERLAP_SECONDS` (48h) rather than the criterion's floor of one hour. §2.3's
   * reason is upload lag: `start_date` is when the user RAN, not when the activity
   * APPEARED, so a run recorded Sunday and uploaded Tuesday sits behind a watermark that
   * only backs off an hour. The extra window costs one list call.
   */
  const next = nextListSinceWatermark({
    previous,
    confirmed,
    unconfirmed,
    overlapSeconds: SWEEP_OVERLAP_SECONDS,
  })
  await deps.advanceWatermark(next)

  if (failure !== undefined) return { sourceId, kind: "failed", queued, detail: failure }
  return { sourceId, kind: "queued", queued, alreadyKnown }
}

/** `NEEDS_REAUTH` reaches here as a thrown error from the credential resolver. */
function isReauth(error: unknown): boolean {
  const name = (error as { name?: unknown })?.name
  return name === "SourceNeedsReauthError" || name === "SourceNotConnectedError"
}

/**
 * A short, human-safe description. NEVER the error object and never a stack — this string
 * is rendered on a page, and an error from a token exchange can quote the request that
 * produced it (O-005, `08-security-privacy.md` §7.4).
 */
function describe(error: unknown): string {
  return error instanceof Error ? error.name : "unknown error"
}
