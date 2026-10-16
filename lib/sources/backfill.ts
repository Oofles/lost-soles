import type { IngestJob, SourceAdapter } from "@/src/adapters/types"
import type { ReceiptDeps } from "@/src/pipeline/ingest-receipt"

import { needsEnqueue } from "./sync"

/**
 * THE HISTORICAL BACKFILL, AS A FUNCTION. Ticket 0177, `03-integrations.md` §2.5.
 *
 * A first Sync looks back 30 days (`FIRST_SYNC_LOOKBACK_DAYS`, ticket 0043). This reaches the
 * rest: the whole history, listed oldest first, put on the ordinary ingest queue in batches
 * sized to the read budget, with a sleep to the next window between batches. It is run BY HAND,
 * once, through `tools/backfill/backfill.ts`. The operator chose a CLI over a scheduled job
 * because one user runs it once, and the account holds about 115 activities, which is about three
 * budget windows.
 *
 * ─── IT KEEPS NO CHECKPOINT, AND RESUME IS RE-RUNNING IT ────────────────────────
 *
 * The cursor lives in memory for the length of one run. A killed run is resumed by running it
 * again from the beginning. Every activity the first run accepted is then a duplicate at the
 * receipt gate (`needsEnqueue`, shared with the Sync), which costs one conditional write and no
 * provider read. The extra list calls for re-listing a 115-activity account cost one read per
 * 200 activities. At this size a stored checkpoint would buy nothing (operator decision).
 *
 * `beginWindow` drains the ingest queue before every listing. A message enqueued just before a
 * kill has therefore been delivered by the time a re-run lists it again. Its receipt shows
 * `attempts > 0` and it is not enqueued a second time.
 *
 * ─── IT NEVER TOUCHES `listSinceWatermark` ─────────────────────────────────────
 *
 * The watermark is the Sync's COMPLETION marker (`list-since-watermark.ts`). This module neither
 * reads nor writes it, and it stores nothing at all. That is why a backfill and a manual Sync
 * running at the same time cannot corrupt each other's watermark. The only shared state is the
 * receipt table, and its conditional `PutItem` lets exactly one of them enqueue a given activity.
 *
 * ─── OLDEST FIRST, AND THAT IS A SCORING DECISION ──────────────────────────────
 *
 * Importing newest first would make every historical run older than the one imported just
 * before it. Every cell the two shared would classify `deferred` (D-221) and earn nothing until a
 * replay. Importing oldest first defers only the cells a historical run shares with the recent
 * month that is already scored. The XP replay the operator runs after the import settles those
 * (D-271). The replay is not part of this module.
 */

/** Where the listing starts: the beginning of the account. */
export const BACKFILL_ORIGIN = "1970-01-01T00:00:00.000Z"

/** Woken this far past a window boundary, so the provider's clock has certainly rolled over. */
export const BACKFILL_WAKE_GRACE_MS = 5_000

export type BackfillPaceDecision =
  | { action: "proceed"; allowance: number }
  | { action: "sleep"; untilMs: number; reason: string }
  | { action: "fail"; reason: string }

export interface BackfillTally {
  /** Activities this run put on the queue, and ones the receipt table already held. */
  queued: number
  alreadyKnown: number
  /** `startedAt` of the oldest and newest activity this run enqueued. */
  importedFrom?: string
  importedTo?: string
}

export interface BackfillWindowReport extends BackfillTally {
  window: number
  /** ISO. How far the listing has got: `listSince` resumes strictly after this. */
  cursor: string
  queuedThisWindow: number
  knownThisWindow: number
  /** Set when the window ended on the budget rather than at the end of the list. */
  sleepUntilMs?: number
  reason?: string
  completed: boolean
}

export interface BackfillDeps {
  adapter: SourceAdapter<unknown>
  credentials: unknown
  receipt: ReceiptDeps
  /** Must throw if the message did not land, as for `SyncDeps.enqueue`. */
  enqueue(job: IngestJob): Promise<void>
  /**
   * Called before every listing. The CLI waits here for the ingest queue to drain and forgets
   * the last budget reading. Each window is then paced on a fresh reading, taken after the
   * previous window's reads have been spent.
   */
  beginWindow(): Promise<void>
  /** How many more activities this window may enqueue, given how many it already has. */
  pace(enqueuedThisWindow: number): BackfillPaceDecision
  sleep(ms: number): Promise<void>
  report(line: BackfillWindowReport): void
  now?: () => Date
}

/** Where the cursor goes after a window. It never moves backwards and never passes an activity that was not confirmed. */
export function nextBackfillCursor(previous: string, confirmed: readonly string[]): string {
  if (confirmed.length === 0) return previous
  const newest = Math.max(...confirmed.map((iso) => Date.parse(iso)))
  // One second behind the newest, so a same-second sibling the window stopped before is
  // re-listed (`after` is exclusive). Re-listing is free at the receipt gate.
  const candidate = Math.floor(newest / 1000) * 1000 - 1000
  return new Date(Math.max(candidate, Date.parse(previous))).toISOString()
}

/** `name` is set by the shared adapter errors. It is matched by name so this module names no source. */
function isRateLimited(error: unknown): error is { retryAfterMs: number } {
  return (error as { name?: unknown })?.name === "SourceRateLimitedError"
}

/**
 * Runs until the listing reaches the end of the account. It throws on anything it cannot pace
 * around: a dead credential, a queue that refuses a message, or a budget it cannot read. A
 * re-run picks up where this one stopped, at the price of re-listing.
 */
export async function runBackfill(userId: string, deps: BackfillDeps): Promise<BackfillTally> {
  const now = () => deps.now?.() ?? new Date()
  const tally: BackfillTally = { queued: 0, alreadyKnown: 0 }
  let cursor = BACKFILL_ORIGIN

  for (let window = 1; ; window += 1) {
    await deps.beginWindow()

    const confirmed: string[] = []
    let queuedThisWindow = 0
    let knownThisWindow = 0
    let stop: { untilMs: number; reason: string } | undefined

    try {
      for await (const job of deps.adapter.listSince(userId, cursor, deps.credentials)) {
        // Judged AFTER the first `next()`, because the list call has to be made before its
        // headers can be read. Checked again before every enqueue in the window.
        const pace = deps.pace(queuedThisWindow)
        if (pace.action === "fail") throw new Error(pace.reason)
        if (pace.action === "sleep") {
          stop = { untilMs: pace.untilMs, reason: pace.reason }
          break
        }

        if (await needsEnqueue(job, userId, deps)) {
          await deps.enqueue(job)
          queuedThisWindow += 1
          tally.importedFrom = earlier(tally.importedFrom, job.startedAt)
          tally.importedTo = later(tally.importedTo, job.startedAt)
        } else {
          knownThisWindow += 1
        }
        confirmed.push(job.startedAt)
      }
    } catch (error) {
      // A 429 on the list call means somebody else spent the window. Sleep it out; nothing is lost.
      if (!isRateLimited(error)) throw error
      stop = { untilMs: now().getTime() + error.retryAfterMs, reason: "the list call was rate-limited" }
    }

    cursor = nextBackfillCursor(cursor, confirmed)
    tally.queued += queuedThisWindow
    tally.alreadyKnown += knownThisWindow
    const completed = stop === undefined

    deps.report({
      ...tally,
      window,
      cursor,
      queuedThisWindow,
      knownThisWindow,
      completed,
      ...(stop ? { sleepUntilMs: stop.untilMs, reason: stop.reason } : {}),
    })

    if (completed) return tally
    await deps.sleep(Math.max(0, stop!.untilMs - now().getTime()) + BACKFILL_WAKE_GRACE_MS)
  }
}

const earlier = (a: string | undefined, b: string) => (a === undefined || Date.parse(b) < Date.parse(a) ? b : a)
const later = (a: string | undefined, b: string) => (a === undefined || Date.parse(b) > Date.parse(a) ? b : a)
