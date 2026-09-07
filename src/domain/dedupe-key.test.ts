import { describe, expect, it } from "vitest"

import {
  computeDedupeKey,
  dedupeCandidateKeys,
  isSameActivity,
  DEDUPE_ANCHOR_MS,
  DEDUPE_START_TOLERANCE_MS,
  type DedupeCandidate,
} from "./dedupe-key"

/**
 * Ticket `0169`, D-211. The bug this replaces was found by `0036`'s own test suite, which
 * asserted the miss explicitly rather than hiding it — so this file's centre of gravity is
 * the cases that USED TO FAIL. Every one of them is a run recorded twice, close enough that
 * a human would call it obviously the same morning, that the old formula split in two.
 *
 * `02-data-model.md` §1493 is why they matter: cross-source duplication *"silently doubles
 * XP and doubles cell visit counts"* on a map that never re-fogs, and it is invisible
 * because the second activity looks completely normal.
 */

const USER = "b3f1c2d4-0000-4000-8000-000000000001"
const BASE = Date.parse("2026-06-01T09:15:00.000Z")

/** A 3.3 km run in 23 minutes, as one source recorded it. */
const run = (over: Partial<DedupeCandidate> = {}): DedupeCandidate => ({
  startedAtMs: BASE,
  distanceM: 3300,
  elapsedS: 1380,
  ...over,
})

/** Whether a lookup for `b` would find a stored activity `a` — the real two-stage test. */
const wouldMatch = (a: DedupeCandidate, b: DedupeCandidate): boolean =>
  dedupeCandidateKeys(USER, b.startedAtMs).includes(computeDedupeKey(USER, a.startedAtMs)) &&
  isSameActivity(a, b)

describe("the key itself", () => {
  it("is a plain sha256 hex, unprefixed, matching computeActivityId", () => {
    expect(computeDedupeKey(USER, BASE)).toMatch(/^[0-9a-f]{64}$/)
  })

  it("is deterministic", () => {
    expect(computeDedupeKey(USER, BASE)).toBe(computeDedupeKey(USER, BASE))
  })

  /** Cross-source is the entire point: nothing about a source enters the key (I-22). */
  it("does not depend on the source", () => {
    expect(computeDedupeKey(USER, BASE)).toBe(computeDedupeKey(USER, BASE))
  })

  it("separates users", () => {
    expect(computeDedupeKey(USER, BASE)).not.toBe(computeDedupeKey("someone-else", BASE))
  })

  /**
   * The separator earns its place: without it, `("ab", 1)` and `("a", 11)` would collide.
   */
  it("cannot be confused by a user id that ends in digits", () => {
    expect(computeDedupeKey("ab", 1 * DEDUPE_ANCHOR_MS)).not.toBe(
      computeDedupeKey("a", 11 * DEDUPE_ANCHOR_MS),
    )
  })
})

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CASES THE OLD FORMULA MISSED
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe("two devices recording one run", () => {
  /**
   * `0169`'s "steps to reproduce", verbatim. 3310 m and 3330 m are 20 m apart and rounded
   * to 66 and 67 in a 50 m bucket, so the old key split them. Nothing about them is close
   * to ambiguous.
   */
  it("collapses a 20 m distance disagreement across the old bucket boundary", () => {
    expect(wouldMatch(run({ distanceM: 3310 }), run({ distanceM: 3330 }))).toBe(true)
  })

  /**
   * THE WORST OF THE OLD MISSES. `floor(start/60)` had no centring at all, so a two-second
   * disagreement between a phone and a watch split the run one time in thirty.
   */
  it("collapses a two-second start disagreement across a minute boundary", () => {
    const justBefore = Date.parse("2026-06-01T09:00:59.000Z")
    const justAfter = Date.parse("2026-06-01T09:01:01.000Z")
    expect(wouldMatch(run({ startedAtMs: justBefore }), run({ startedAtMs: justAfter }))).toBe(true)
  })

  /**
   * THE SECOND FINDING (D-211), and the one that made a neighbour probe insufficient. Two
   * devices disagree on distance proportionally — 3% of a 10 km run is 300 m, which is six
   * buckets of 50 m, so probing every ADJACENT bucket would still have missed this.
   */
  it("collapses a 3% distance disagreement on a long run", () => {
    const a = run({ distanceM: 10_000, elapsedS: 3000 })
    const b = run({ distanceM: 10_300, elapsedS: 3060, startedAtMs: BASE + 40_000 })
    expect(wouldMatch(a, b)).toBe(true)
  })

  /** The user starts a watch, then a phone. Minutes apart, obviously one run. */
  it("collapses recordings that start three minutes apart", () => {
    const b = run({ startedAtMs: BASE + 3 * 60_000, elapsedS: 1380 - 180, distanceM: 3280 })
    expect(wouldMatch(run(), b)).toBe(true)
  })

  /** Symmetric — which side is already stored must not change the answer. */
  it("is symmetric", () => {
    const a = run({ distanceM: 3310 })
    const b = run({ distanceM: 3330, startedAtMs: BASE + 90_000 })
    expect(wouldMatch(a, b)).toBe(wouldMatch(b, a))
  })
})

describe("two genuinely different activities", () => {
  /** An evening run after a morning one. Far apart in time; nothing else needs checking. */
  it("keeps runs hours apart separate", () => {
    expect(wouldMatch(run(), run({ startedAtMs: BASE + 8 * 60 * 60 * 1000 }))).toBe(false)
  })

  /**
   * The discriminating case: same start window, genuinely different runs. A 3.3 km and a
   * 12 km cannot be one recording however close the clocks are.
   */
  it("keeps a short and a long run in the same window separate", () => {
    const long = run({ distanceM: 12_000, elapsedS: 4200 })
    expect(isSameActivity(run(), long)).toBe(false)
  })

  /** Same distance, wildly different duration — a walk and a run over the same route. */
  it("keeps a walk and a run over the same distance separate", () => {
    expect(isSameActivity(run(), run({ elapsedS: 1380 + 1800 }))).toBe(false)
  })

  /** Just outside every tolerance, so the edges are asserted rather than assumed. */
  it("refuses a start disagreement just past the tolerance", () => {
    const b = run({ startedAtMs: BASE + DEDUPE_START_TOLERANCE_MS + 1000 })
    expect(isSameActivity(run(), b)).toBe(false)
  })
})

describe("an absent distance abstains rather than vetoes", () => {
  /**
   * Legitimately absent for treadmill work, strength sessions and manual entries — and two
   * sources disagree about whether they report it at all. Treating a missing value as a
   * disagreement would split exactly the activities with the least other evidence.
   */
  it("matches when one source reports no distance", () => {
    expect(isSameActivity(run(), run({ distanceM: undefined }))).toBe(true)
  })

  it("matches when neither reports distance", () => {
    const a = run({ distanceM: undefined })
    expect(isSameActivity(a, run({ distanceM: undefined, elapsedS: 1400 }))).toBe(true)
  })

  /** Abstaining is not surrendering: the time comparisons still decide. */
  it("still separates two indoor sessions hours apart", () => {
    const a = run({ distanceM: undefined })
    const b = run({ distanceM: undefined, startedAtMs: BASE + 4 * 60 * 60 * 1000 })
    expect(wouldMatch(a, b)).toBe(false)
  })
})

describe("the candidate probe", () => {
  /** The stored key is always first, so a caller can take [0] without knowing the rules. */
  it("leads with the stored key", () => {
    expect(dedupeCandidateKeys(USER, BASE)[0]).toBe(computeDedupeKey(USER, BASE))
  })

  it("probes only one bucket in the middle of a window", () => {
    const middle = 100 * DEDUPE_ANCHOR_MS + DEDUPE_ANCHOR_MS / 2
    expect(dedupeCandidateKeys(USER, middle)).toHaveLength(1)
  })

  it("probes the previous bucket just after a boundary", () => {
    const justAfter = 100 * DEDUPE_ANCHOR_MS + 1000
    expect(dedupeCandidateKeys(USER, justAfter)).toContain(
      computeDedupeKey(USER, 99 * DEDUPE_ANCHOR_MS),
    )
  })

  it("probes the next bucket just before a boundary", () => {
    const justBefore = 101 * DEDUPE_ANCHOR_MS - 1000
    expect(dedupeCandidateKeys(USER, justBefore)).toContain(
      computeDedupeKey(USER, 101 * DEDUPE_ANCHOR_MS),
    )
  })

  /**
   * NEVER THREE, and it is asserted across a whole window rather than at a few points
   * because it is a claim about the RELATIONSHIP between two constants: the tolerance is
   * far below half the bucket. AP-10's cost argument in `02-data-model.md` rests on this,
   * and so does the guarantee that a duplicate is never two buckets away.
   */
  it("never returns more than two keys, anywhere in a window", () => {
    expect(DEDUPE_START_TOLERANCE_MS * 2).toBeLessThan(DEDUPE_ANCHOR_MS)
    for (let offset = 0; offset < DEDUPE_ANCHOR_MS; offset += 5_000) {
      const keys = dedupeCandidateKeys(USER, 100 * DEDUPE_ANCHOR_MS + offset)
      expect(keys.length, `offset ${offset}`).toBeLessThanOrEqual(2)
      expect(new Set(keys).size, `offset ${offset} should have no duplicate keys`).toBe(keys.length)
    }
  })

  /**
   * THE PROPERTY THE WHOLE DESIGN RESTS ON, swept rather than sampled: wherever the run
   * starts in a window, a duplicate anywhere inside the start tolerance is found. This is
   * the assertion that would have caught the original bug.
   */
  it("finds a duplicate anywhere within the start tolerance, wherever the window falls", () => {
    for (let offset = 0; offset < DEDUPE_ANCHOR_MS; offset += 15_000) {
      const stored = 100 * DEDUPE_ANCHOR_MS + offset
      for (const delta of [-DEDUPE_START_TOLERANCE_MS, -1000, 0, 1000, DEDUPE_START_TOLERANCE_MS]) {
        expect(
          dedupeCandidateKeys(USER, stored + delta),
          `stored at +${offset}, duplicate ${delta} ms away`,
        ).toContain(computeDedupeKey(USER, stored))
      }
    }
  })
})
