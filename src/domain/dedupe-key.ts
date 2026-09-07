import { createHash } from "node:crypto"

/**
 * THE CROSS-SOURCE NATURAL KEY. `03-integrations.md` §2.7, I-22, D-211. Ticket `0169`.
 *
 * ─── THE PROBLEM THIS SOLVES, AND THE ONE THE OLD FORMULA HAD ───────────────
 *
 * `activityId` is `sha256(userId:source:externalId)`, which collapses a run that arrives
 * three times from ONE source. It cannot collapse a run that arrives from TWO — Strava
 * and Health Connect have different ids for the same morning, neither can see the other's,
 * and I-22 says there must still be one activity. `02-data-model.md` §1493 names the
 * failure: cross-source duplication *"silently doubles XP and doubles cell visit counts"*
 * on a map that never re-fogs, and it is invisible because the second activity looks
 * completely normal.
 *
 * §2.7 originally answered this by hashing a composite of rounded components:
 *
 *   sha256([userId, floor(start/60), round(distance/50), round(elapsed/30)].join('|'))
 *
 * **Those are buckets, not tolerances, and the difference is the bug.** Two recordings
 * collide only when every component lands in the same bucket, so two that straddle a
 * boundary do not collide *however close they are*: 3310 m and 3330 m are 20 m apart and
 * round to 66 and 67. The start time was worst — `floor` has no centring at all, so a
 * two-second disagreement between a phone and a watch missed one time in thirty.
 *
 * A HASH CANNOT BE PROBED FOR NEARNESS, which is the property that makes this a class of
 * bug rather than a tuning problem. `sha256` destroys locality by design, so an exact-match
 * lookup on a hashed composite can only ever ask "same bucket?" — never "close enough?".
 *
 * ─── WHY THE BUCKETS WERE ALSO TOO FINE (the second finding, D-211) ─────────
 *
 * Widening the buckets or re-centring them would have moved the boundary rather than
 * removed it, and it would not have been enough anyway. Two devices recording one run
 * disagree on distance by roughly 1–3% — 100 to 300 m on a 10 km run, which is two to six
 * buckets of 50 m. Even probing every adjacent bucket would have missed a long run.
 *
 * The components that genuinely agree and the ones that genuinely do not are different:
 *
 *   START TIME agrees to within a few minutes. Both clocks are NTP-synced; the spread is
 *              how long the user takes to start the second device.
 *   DISTANCE   disagrees proportionally. GPS is GPS.
 *   ELAPSED    disagrees by however long sat between the two start presses.
 *
 * ─── THE SHAPE: A COARSE ANCHOR, THEN A REAL TOLERANCE COMPARISON ───────────
 *
 * So the key stops trying to be the whole answer. It anchors on the ONE component that
 * agrees — start time, in a deliberately coarse 30-minute bucket — and the duplicate
 * decision moves to `isSameActivity`, which compares real tolerances over the handful of
 * candidates the anchor returns. There is no bucket anywhere in the comparison, so there
 * is no boundary to straddle.
 *
 * The anchor still has a boundary, and that is what `dedupeCandidateKeys` is for: it emits
 * the neighbouring bucket too whenever the start time is near enough to an edge for a
 * duplicate to have landed on the other side. Because the tolerance is far smaller than the
 * bucket, that is never more than two keys — see the assertion in the tests.
 *
 * ─── WHAT LIVES HERE AND WHY IT IS NOT IN AN ADAPTER ────────────────────────
 *
 * `0169` criterion 3: *"whatever replaces or keeps the formula is written in exactly one
 * place and used by every adapter; two implementations of a dedupe key is worse than a
 * coarse one."* It was previously a private function inside the Strava adapter, where a
 * second adapter could not have reached it and would have had to reimplement it — and two
 * implementations of a cross-source key agree right up until the day they matter.
 *
 * It sits beside `computeActivityId` for the reason that module records: `activity.ts` is
 * types only and emits no runtime code, so importing an `Activity` type can never drag
 * `node:crypto` into a client bundle.
 *
 * PURE. No clock, no randomness, no I/O.
 */

/**
 * The anchor bucket, 30 minutes.
 *
 * COARSE ON PURPOSE. It is not trying to discriminate — `isSameActivity` does that. Its
 * only job is to put two recordings of one run in the same partition of the search space
 * while keeping the candidate set small enough to fetch. At one user's volume (~400
 * activities a year, `02-data-model.md` T3) a 30-minute window holds one activity or none
 * on almost every day of the year.
 *
 * IT MUST STAY MUCH LARGER THAN `DEDUPE_START_TOLERANCE_MS`. That relationship is what
 * bounds `dedupeCandidateKeys` to two keys; if the two ever approached each other, a
 * duplicate could sit two buckets away and the probe would miss it. A test asserts it.
 */
export const DEDUPE_ANCHOR_MS = 30 * 60 * 1000

/**
 * How far apart two recordings of the same run may start. Five minutes, which is a
 * generous estimate of how long someone takes to start a watch and then a phone.
 */
export const DEDUPE_START_TOLERANCE_MS = 5 * 60 * 1000

/**
 * Distance tolerance: the LARGER of 100 m and 3% of the run.
 *
 * Proportional, because the disagreement is: GPS error accumulates over a track rather
 * than being a fixed offset, so 100 m is right for a 3 km run and hopeless for a 30 km
 * one. The flat floor exists because 3% of a 500 m walk is 15 m, which is finer than two
 * devices can agree on at any distance.
 */
export const DEDUPE_DISTANCE_TOLERANCE_M = 100
export const DEDUPE_DISTANCE_TOLERANCE_FRACTION = 0.03

/** Elapsed tolerance: five minutes, for the same reason as the start tolerance. */
export const DEDUPE_ELAPSED_TOLERANCE_S = 5 * 60

/** The anchor bucket index a start instant falls in. */
const anchorOf = (startedAtMs: number): number => Math.floor(startedAtMs / DEDUPE_ANCHOR_MS)

const hash = (userId: string, anchor: number): string =>
  // The separator matters, exactly as in `computeActivityId`: without it ("ab", 1) and
  // ("a", 11) would collide. A `|` cannot appear in a Cognito sub.
  createHash("sha256").update(`${userId}|${anchor}`).digest("hex")

/**
 * The key STORED on the activity, and the GSI2 sort key (`02-data-model.md` T3).
 *
 * One activity has exactly one of these. The breadth lives in the lookup, not in the row —
 * storing several keys per activity would have meant a row per key and a second way for
 * the index and the table to disagree.
 */
export function computeDedupeKey(userId: string, startedAtMs: number): string {
  return hash(userId, anchorOf(startedAtMs))
}

/**
 * The keys to LOOK UP when asking whether this activity is already present — the stored
 * key plus, when the start time is near a bucket edge, the bucket on the other side.
 *
 * ONE OR TWO, NEVER THREE, and that is a consequence of `DEDUPE_START_TOLERANCE_MS` being
 * well under half of `DEDUPE_ANCHOR_MS` rather than a coincidence worth relying on quietly.
 * A duplicate may start at most the tolerance away; if that puts it in another bucket, the
 * start time must be within the tolerance of that bucket's edge.
 *
 * The first element is always the stored key, so a caller that only wants the exact match
 * can take `[0]` without knowing this function's rules.
 */
export function dedupeCandidateKeys(userId: string, startedAtMs: number): string[] {
  const anchor = anchorOf(startedAtMs)
  const keys = [hash(userId, anchor)]

  /**
   * THE COMPARISONS ARE ASYMMETRIC, AND THAT ASYMMETRY IS THE WHOLE CORRECTNESS ARGUMENT.
   * A duplicate stored at `t` is reachable from a lookup at `t'` when `|t - t'| <= TOL`:
   *
   *   previous bucket — needs `t < anchor·A` and `t >= t' - TOL`, so `offset <  TOL`
   *   next bucket     — needs `t >= (anchor+1)·A` and `t <= t' + TOL`, so `offset >= A - TOL`
   *
   * The second one is `>=` and not `>`. Written as `>` it missed a duplicate stored EXACTLY
   * the tolerance ahead — the sweep in `dedupe-key.test.ts` is what caught it, which is the
   * same class of off-by-one at a boundary that this module exists to remove.
   */
  const offset = startedAtMs - anchor * DEDUPE_ANCHOR_MS
  if (offset < DEDUPE_START_TOLERANCE_MS) keys.push(hash(userId, anchor - 1))
  else if (offset >= DEDUPE_ANCHOR_MS - DEDUPE_START_TOLERANCE_MS) keys.push(hash(userId, anchor + 1))

  return keys
}

/**
 * The comparable facts, and nothing else. A structural type rather than `Activity` so this
 * can be called on a projected index row without materializing one.
 */
export interface DedupeCandidate {
  startedAtMs: number
  /** Absent for a treadmill run, strength work, or a manual entry. See `isSameActivity`. */
  distanceM?: number
  elapsedS: number
}

/**
 * ARE THESE TWO RECORDINGS THE SAME PHYSICAL ACTIVITY? Every comparison is a tolerance and
 * none is a bucket, which is the whole point of D-211.
 *
 * ─── AN ABSENT DISTANCE ABSTAINS, IT DOES NOT VETO ──────────────────────────
 *
 * `distanceM` is legitimately absent for a treadmill run, strength work and manual entries
 * (`03-integrations.md` §2.1: "false is a NORMAL outcome"). Two sources also disagree about
 * whether they report it at all — Health Connect reports distance for an indoor session
 * that Strava leaves blank. Treating a missing value as a disagreement would therefore
 * split exactly the activities that have the least other evidence to go on, so when either
 * side is absent this component simply says nothing and the time comparisons decide.
 *
 * ─── WHAT IT DELIBERATELY DOES NOT COMPARE ──────────────────────────────────
 *
 * THE ACTIVITY KIND. Two sources routinely classify one session differently — a trail run
 * against a run, a "workout" against strength — and the mapping tables that reconcile that
 * are per-source data (D-031/D-141). A kind veto here would split duplicates on a
 * disagreement about vocabulary, which is the failure mode `0169` exists to remove. If it
 * turns out to be needed it is a decision with its own reasoning, not a condition to add
 * quietly to this list.
 */
export function isSameActivity(a: DedupeCandidate, b: DedupeCandidate): boolean {
  if (Math.abs(a.startedAtMs - b.startedAtMs) > DEDUPE_START_TOLERANCE_MS) return false
  if (Math.abs(a.elapsedS - b.elapsedS) > DEDUPE_ELAPSED_TOLERANCE_S) return false

  if (a.distanceM === undefined || b.distanceM === undefined) return true

  const tolerance = Math.max(
    DEDUPE_DISTANCE_TOLERANCE_M,
    DEDUPE_DISTANCE_TOLERANCE_FRACTION * Math.max(a.distanceM, b.distanceM),
  )
  return Math.abs(a.distanceM - b.distanceM) <= tolerance
}
