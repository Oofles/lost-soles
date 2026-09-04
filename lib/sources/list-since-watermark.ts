/**
 * THE RECONCILIATION WATERMARK. Ticket 0034. `02-data-model.md` T7,
 * `03-integrations.md` §2.3.
 *
 * `listSinceWatermark` is a COMPLETION MARKER, NOT A PROGRESS MARKER, and every rule
 * below follows from that one sentence. It records *"everything at or before this
 * instant is definitely in the ledger"* — not *"this is the newest thing I have seen"*.
 *
 * The two are identical until a sweep dies halfway through a page, which is exactly when
 * the difference costs something permanent:
 *
 *   A sweep lists 200 activities, enqueues 137, and the Lambda is killed. If the
 *   watermark advanced to the newest thing SEEN, the 63 that were never enqueued are now
 *   behind it. The next sweep asks for activities after that point and will never look at
 *   them again. They are not "missing until someone notices" — they are missing, and on a
 *   map that by D-020 never re-fogs, that is ground that can never be revealed.
 *
 * So the advance rule is built around an asymmetry rather than around precision:
 *
 *   Re-listing work costs ONE list call, which §2.5 rates as effectively free.
 *   Skipping work costs a run that never lands, permanently.
 *
 * It therefore always fails toward re-doing. Re-listing is SAFE because dedupe lives
 * downstream — `IngestReceipt` keyed on `ingestKey` (`01-architecture.md` §3) — and not
 * because this function is careful. If that receipt ever stops being idempotent, this
 * design is wrong rather than merely wasteful.
 *
 * WHAT THE WATERMARK IS ACTUALLY FOR, then, is bounding work: a sweep asks Strava for
 * `?after=<watermark>` instead of eight years of history every six hours. Its value shows
 * when a connection falls behind — three weeks without a successful sweep and the next one
 * lists three weeks, because that is genuinely what needs re-checking.
 *
 * PURE. No clock, no I/O, no vendor. The caller supplies everything, which is what lets
 * the interesting cases be tested as arithmetic rather than as a scenario.
 */

/**
 * The 6-hourly sweep's look-back. `03-integrations.md` §2.3: *"the 48-hour overlap
 * absorbs clock skew and late edits."*
 *
 * THE MARGIN IS NOT REDUNDANT WITH THE ADVANCE RULE, and it is worth saying why, because
 * they look like the same safety twice. The advance rule protects against work we know we
 * did not finish. The margin protects against work we never saw: `start_date` is when the
 * user RAN, not when the activity APPEARED. Record on Sunday, upload on Tuesday, and a
 * watermark sitting at Monday skips it — correctly by its own rule, and wrongly in fact.
 */
export const SWEEP_OVERLAP_SECONDS = 48 * 60 * 60

/** The nightly slower net. §2.3, and §2.7's "an edit older than 14 days will be missed". */
export const NIGHTLY_OVERLAP_SECONDS = 14 * 24 * 60 * 60

export interface WatermarkAdvance {
  /** The watermark this sweep ran with. Returned unchanged when there is no evidence. */
  previous: string
  /** ISO start dates of activities the consumer CONFIRMED were enqueued. */
  confirmed: readonly string[]
  /**
   * ISO start dates of activities that were listed and NOT confirmed — the page the crash
   * interrupted. One entry here pins the watermark below it, whatever else succeeded.
   */
  unconfirmed: readonly string[]
  /** `SWEEP_OVERLAP_SECONDS` or `NIGHTLY_OVERLAP_SECONDS`. */
  overlapSeconds: number
}

/**
 * Where the watermark should sit after a sweep.
 *
 * Passed the two lists separately rather than a single "how far did you get", because the
 * consumer is the only thing that knows which enqueues actually landed — and asking it for
 * a boundary instead of the facts would move this decision to the place least able to make
 * it.
 */
export function nextListSinceWatermark(input: WatermarkAdvance): string {
  const { previous, confirmed, unconfirmed, overlapSeconds } = input

  /**
   * NOTHING WAS SEEN. An empty page is not evidence of progress — it is evidence that
   * nothing is there, which is also what a broken request looks like from here. Advancing
   * on it would walk the watermark forward one sweep at a time on a connection that is
   * silently returning nothing.
   */
  if (confirmed.length === 0 && unconfirmed.length === 0) return previous

  /**
   * THE BOUNDARY. An unconfirmed activity pins it, because everything from that instant
   * onward has to be listed again — including anything confirmed that happens to be NEWER
   * than it, which is why this is the oldest unconfirmed and not "the newest confirmed
   * before the first gap". Re-listing a handful of already-enqueued activities is the
   * cheap half of the asymmetry above.
   */
  const boundary =
    unconfirmed.length > 0
      ? oldest(unconfirmed)
      : newest(confirmed)

  /**
   * NOT CLAMPED TO MOVE FORWARD, and that is deliberate rather than an oversight.
   *
   * In steady state this lands at roughly `now - 48h`, which is usually BEHIND the
   * previous value — so the watermark oscillates rather than advancing monotonically. That
   * is the margin doing its job: the sweep is meant to keep re-examining the last two days.
   * A `Math.max(previous, …)` here would look tidier and would quietly delete the overlap.
   */
  return new Date((boundary - overlapSeconds) * 1000).toISOString()
}

/** Epoch seconds, floor. ISO in, number out, so the arithmetic above reads as arithmetic. */
function seconds(iso: string): number {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) throw new Error(`Not an ISO 8601 instant: ${JSON.stringify(iso)}`)
  return Math.floor(ms / 1000)
}

const oldest = (isos: readonly string[]) => Math.min(...isos.map(seconds))
const newest = (isos: readonly string[]) => Math.max(...isos.map(seconds))
