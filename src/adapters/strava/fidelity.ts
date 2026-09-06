import type { GeoPoint } from "@/src/domain/activity"

/**
 * THE FIDELITY FLOOR. Ticket 0038, `contracts/ingestion-contract.md` §5 check 5, D-200.
 *
 * A trace that is a DECIMATED view of a recording must never be projected to H3. The map
 * never re-fogs (D-020), so a sparse trace does not draw a slightly worse corridor — it
 * permanently reveals a wrong one, and there is no operation that takes it back. D-121
 * names the concrete failure: `summary_polyline` instead of the full `latlng` stream.
 *
 * Hence a LOUD FAILURE and not a warning. Refusing to ingest one activity costs a re-run
 * of the job; ingesting a bad one costs the map.
 *
 * ─── WHY THE THRESHOLD IS A SAMPLING RATE AND NOT POINTS-PER-KM ─────────────
 *
 * §5 check 5 and `03-integrations.md` §2.5 originally specified points-per-KM, and ticket
 * 0038 justified it: *"At 1 Hz a 6 min/km run gives ~360 points/km; summary_polyline would
 * give ~10-30."* The second number is wrong, and it was wrong in the unsafe direction.
 * Measured against real captured responses from the connected account (D-200):
 *
 *   real full streams   182 - 684 points/km   (the 182 is a 20 km/h bike ride)
 *   real summary_polyline  20 -  49 points/km
 *   real map.polyline      37 -  56 points/km
 *
 * A points-per-km floor therefore has to fit between 49 and 182, and points-per-km is a
 * function of SPEED: at 1 Hz, 100 points/km is exactly 36 km/h, so such a floor rejects a
 * fast descent as though it were a corrupted trace. `xp-rules-v1.yaml` already carries
 * `kinds: [ride]`, so that is a supported activity, not a hypothetical.
 *
 * A sampling RATE is invariant under speed. The same measurements:
 *
 *   real full streams      0.94 - 0.99 points/second
 *   real summary_polyline  0.05 - 0.11 points/second
 *
 * Nine to twenty-one times of separation, and 0.3 sits roughly three times from each side.
 */
export const MIN_POINTS_PER_SECOND = 0.3

/** The same threshold as an interval, which is the form the check actually applies. */
const MAX_SAMPLE_INTERVAL_MS = 1000 / MIN_POINTS_PER_SECOND

/**
 * Below this, the ratio is measuring noise rather than a sampling rate, and a handful of
 * fixes reveals almost no fog. A 60-second floor on the floor.
 */
const MIN_MEASURABLE_MS = 60_000

/**
 * The MEDIAN interval, not the mean, and this is the whole reason the check works on real
 * activities.
 *
 * The mean is `duration / points`, which a PAUSE destroys. A 40-minute run with a
 * 20-minute stop at a level crossing has 2,400 samples across 3,600 seconds — a mean of
 * 0.67 points/second on a trace that was recorded at a perfect 1 Hz throughout. Push the
 * pause out far enough and a genuine full-resolution trace fails the floor and stops
 * ingesting. The median is untouched by any number of gaps, because a gap moves a few
 * intervals to the end of the sorted list and nothing else.
 */
function medianIntervalMs(points: readonly GeoPoint[]): number {
  const intervals: number[] = []
  for (let i = 1; i < points.length; i++) intervals.push(points[i].t - points[i - 1].t)
  intervals.sort((a, b) => a - b)
  const mid = intervals.length >> 1
  return intervals.length % 2 ? intervals[mid] : (intervals[mid - 1] + intervals[mid]) / 2
}

/**
 * Returns a failure message, or `null` when the trace is dense enough to draw on a map that
 * cannot be redrawn. The CALLER throws — `StravaNormalizeError` is declared in
 * `normalize.ts`, and importing it here would make the two modules circular for the sake of
 * one constructor. Returning the message also makes this function pure and directly
 * testable without a try/catch around every case.
 *
 * `hasTimeStream` is not a convenience — it is HALF THE CHECK, and without it the other
 * half is decorative. `buildTrace` derives each point's timestamp as
 * `startedAt + (offsetS ?? i) * 1000`: with no `time` stream it falls back to the array
 * INDEX, which fabricates a flawless 1 Hz cadence out of nothing. A trace decoded from a
 * `summary_polyline` has no time stream at all, so it would arrive here with perfectly
 * spaced synthetic timestamps and pass a sampling-rate floor with room to spare — the
 * check reporting "clean" for the exact input it exists to reject.
 *
 * So an absent time stream is itself the failure. It is also the correct rule on its own
 * terms: a trace whose timestamps were invented carries no evidence about how it was
 * sampled, and "no evidence" must not resolve to "fine" (D-176).
 */
export function fidelityFloorViolation(
  points: readonly GeoPoint[],
  hasTimeStream: boolean,
): string | null {
  if (points.length < 2) return null

  if (!hasTimeStream) {
    return (
      "the trace carries no time stream, so its sampling rate cannot be verified and its " +
      "timestamps were synthesised from the array index. This is the shape a " +
      "summary_polyline arrives in (D-121), and the map cannot re-fog (D-020)"
    )
  }

  const span = points[points.length - 1].t - points[0].t
  if (span < MIN_MEASURABLE_MS) return null

  const median = medianIntervalMs(points)
  if (median <= MAX_SAMPLE_INTERVAL_MS) return null

  const rate = median > 0 ? 1000 / median : 0
  return (
    `trace fails the fidelity floor — median sampling interval ${(median / 1000).toFixed(1)}s ` +
    `(${rate.toFixed(2)} points/second) is below the ${MIN_POINTS_PER_SECOND} points/second ` +
    "minimum. A decimated trace permanently reveals the wrong corridor on a map that never " +
    "re-fogs (D-020, D-121)"
  )
}
