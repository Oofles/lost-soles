import type { SourceSyncOutcome } from "./sync"

/**
 * THE RESULT LINE. Ticket 0043 criterion 6: *"a plain result line ('3 activities queued'
 * / 'nothing new')"*.
 *
 * ─── WHY THIS IS A MODULE AND NOT THREE TERNARIES IN THE COMPONENT ──────────
 *
 * It is the only thing the person pressing the button actually receives, and every branch
 * of it is a claim about what happened to their data. "Nothing new" when an enqueue
 * silently failed is a lie that costs a run on a map that cannot re-fog, so the mapping
 * from outcome to sentence is somewhere a test can read it.
 *
 * NO VENDOR NAME. `displayName` comes from the connector, the same way `/settings` does
 * it, so the screen and the registry cannot disagree about what a source is called
 * (D-100 — `check-boundaries.mjs` scans `app/` and `components/`).
 *
 * DELIBERATELY UGLY. `09-roadmap.md` §2.3 puts this milestone at "unstyled chrome"; the
 * post-run moment with its tally and its cards is capability 12. One sentence is the
 * whole surface.
 */
export function syncResultLine(
  outcomes: readonly SourceSyncOutcome[],
  displayName: (sourceId: string) => string,
): string {
  if (outcomes.length === 0) return "No sources are connected."

  const lines = outcomes.map((outcome) => {
    const name = displayName(outcome.sourceId)
    switch (outcome.kind) {
      case "queued":
        /**
         * ZERO IS NOT "NOTHING NEW". Activities were listed and every one was already in
         * the ledger — which is what the second press of Sync looks like, and saying
         * "nothing new" there would be indistinguishable from a sweep that found an empty
         * window. The distinction is the whole of criterion 5.
         */
        if (outcome.queued === 0) return "Nothing new."
        return `${outcome.queued} ${outcome.queued === 1 ? "activity" : "activities"} queued.`
      case "nothing-new":
        return "Nothing new."
      case "reconnect":
        return `Reconnect ${name} in Settings.`
      case "not-connected":
        return `${name} is not connected.`
      case "failed":
        /**
         * THE PARTIAL CASE IS NAMED. A sweep that queued four and then broke has done
         * real work, and reporting only the failure would make the next press look
         * unnecessary when it is not. The watermark has already been pinned below the one
         * that failed, so pressing again is the correct response and the sentence says so.
         */
        return outcome.queued > 0
          ? `${outcome.queued} queued, then ${name} stopped responding. Try again.`
          : `Could not reach ${name}. Try again.`
    }
  })

  return lines.join(" ")
}
