/**
 * WHAT A SYNC PRESS MAY SAY ON `/`. Ticket `0087`, `06-ui-ux.md` §2.3–§2.4, D-013.
 *
 * `syncResultLine` (`lib/sources/sync-message.ts`, `0043`/`0044`) is the whole truth about a sweep
 * and it stays the server's record. The plinth shows far less of it, because on the home screen a
 * Strava silence is not an event:
 *
 * | Outcome                               | On `/`                                       |
 * |---------------------------------------|----------------------------------------------|
 * | activities queued (also a partial)    | `N activities queued.`                       |
 * | nothing new                           | nothing — the screen does not change          |
 * | provider failed / unreachable         | nothing — no user-visible error               |
 * | not connected                         | nothing here (the connect line is the model's)|
 * | old failed imports (`failedCount`)    | nothing — not a broken token                  |
 * | broken token (`reconnect`)            | no text here; the source id goes to the       |
 * |                                       | plinth's single ink reconnect line            |
 *
 * NO VENDOR NAME: the queued sentence names no source, and the reconnect line is named from the
 * server's `displayName` (`lib/plinth/connections.ts`).
 */

import type { SyncSummary } from "@/app/sync-action"

export interface PlinthSyncResult {
  /** The one caption, or `null` for "say nothing". */
  line: string | null
  /** Sources the sweep found needing re-authorisation. */
  reconnect: string[]
}

export function plinthSyncResult(summary: Pick<SyncSummary, "outcomes"> | null): PlinthSyncResult {
  if (!summary) return { line: null, reconnect: [] }
  let queued = 0
  const reconnect: string[] = []
  for (const outcome of summary.outcomes) {
    if (outcome.kind === "queued" || outcome.kind === "failed") queued += outcome.queued
    if (outcome.kind === "reconnect") reconnect.push(outcome.sourceId)
  }
  return {
    line: queued > 0 ? `${queued} ${queued === 1 ? "activity" : "activities"} queued.` : null,
    reconnect,
  }
}
