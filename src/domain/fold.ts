import type { H3Index } from "h3-js"

import {
  awardOf,
  OutOfOrderScoringError,
  SIX_MONTHS_MS,
  type ClassifiedCell,
  type Discovery,
  type DiscoveryAward,
} from "./discovery"

/**
 * THE CANONICAL SCORE OF A HISTORY. Ticket `0050`. `05-fog-of-war.md` §3.4;
 * `02-data-model.md` §8.3 step 5, §2.9; **I-14**.
 *
 * ─── WHAT "CANONICAL" MEANS HERE ────────────────────────────────────────────
 *
 * `05` §3.4 states the rule in one sentence: *"the canonical score of a user's history is a
 * deterministic fold over their activities sorted ascending by `startedAt`."* Everything the
 * ingest path does incrementally is an OPTIMISATION of this function, valid only while
 * activities arrive in order. When they do not (§3.4), the incremental answer is deferred and
 * this is what settles it.
 *
 * `02` §2.9 leans on the same thing from the storage side: this fold *"reproduces every
 * `ExploredCell` attribute exactly, from facts, in history order — which is what makes that
 * table honestly a cache."* T6 can be rebuilt; that claim is only true because this function
 * exists and is tested.
 *
 * ─── THREE PROPERTIES, AND EACH IS A TEST ───────────────────────────────────
 *
 *   1. **Deterministic.** Sorted ascending by `startedAt`, ties broken by `activityId` (04
 *      §7.4, I-14). The same activities in any input order produce byte-identical output —
 *      which is what makes a replay reproducible rather than merely repeatable.
 *   2. **Idempotent.** It is a pure function of a SET of activities, so running it twice over
 *      the same set is the same value. There is no accumulator to double.
 *   3. **Monotone in cells.** A fold over a superset of activities produces a superset of
 *      cells. This is D-020 as arithmetic: no input can cause a cell to be absent from the
 *      output that a smaller input produced — so a replay can rewrite `lastRunAt`,
 *      `firstRunAt` and `discoveryCount`, and can never un-reveal ground.
 *
 * ─── PURE, AND THEREFORE NOT THE REPLAY JOB ─────────────────────────────────
 *
 * This computes; it does not write. The job that reads T3, calls this, and rewrites T6 and the
 * ledger belongs to `0103` (the drill's step 5) and `0066` (the XP half) — both of which need
 * capabilities that do not exist yet. Keeping the arithmetic here means those two tickets share
 * one definition of "correct" rather than writing a second one, which is the failure `02` §2.9
 * would not survive.
 */

/** One activity, reduced to what the fold reads. Nothing else can influence a cell. */
export interface FoldActivity {
  activityId: string
  /** ISO 8601 UTC. The sort key and the scoring clock — never `now()` (I-12). */
  startedAt: string
  /**
   * The cells this activity covered, from `traceToCells`. In the drill these come from
   * `cells/<uid>/<activityId>.cells.bin` (`02` §8.3 step 4), which is precisely why that
   * object is written on every scored activity: the fold must not re-derive geometry, both
   * because it is expensive and because re-deriving it under a newer `fogAlgoVersion` would
   * silently change history.
   */
  cells: Iterable<H3Index>
}

/** A T6 cell item, as the fold reconstructs it. `02` T6's attribute list, exactly. */
export interface FoldedCell {
  firstRunAt: string
  firstRunId: string
  lastRunAt: string
  lastRunId: string
  visitCount: number
  discoveryCount: number
}

export interface FoldResult {
  /** Every cell in the history, with every attribute T6 stores. */
  cells: Map<H3Index, FoldedCell>
  /**
   * Per activity, what it earned — `02` §8.3 step 6 consumes THESE, *"not T6"*, and the
   * distinction is load-bearing: by the time a replay finishes, every cell is in the store and
   * re-reading them would classify the lot as cooled.
   */
  awards: Map<string, DiscoveryAward>
  /** Activity ids in the order the fold applied them. The audit trail for a replay. */
  order: string[]
}

/**
 * Ascending by `startedAt`, ties by `activityId`. **I-14, and the tie-break is not decoration**:
 * two activities that start in the same second must fold in a defined order or the same history
 * produces two different maps depending on which one the sort happened to see first.
 */
export function foldOrder(a: FoldActivity, b: FoldActivity): number {
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? -1 : 1
  if (a.activityId === b.activityId) return 0
  return a.activityId < b.activityId ? -1 : 1
}

/**
 * FOLD A HISTORY INTO THE CELL STATE IT IMPLIES.
 *
 * @param activities in ANY order. They are sorted here, because a caller that had to sort
 *                   correctly first would be a second place for I-14 to be got wrong.
 */
export function foldActivities(activities: Iterable<FoldActivity>): FoldResult {
  const sorted = [...activities].sort(foldOrder)

  const cells = new Map<H3Index, FoldedCell>()
  const awards = new Map<string, DiscoveryAward>()
  const order: string[] = []

  for (const activity of sorted) {
    const at = activity.startedAt
    const atMs = Date.parse(at)
    if (Number.isNaN(atMs)) {
      throw new Error(`foldActivities: unparseable startedAt "${at}" on ${activity.activityId}`)
    }

    /**
     * Classified against the map as it was BEFORE this activity, exactly as §3.2 phase 2
     * requires of the incremental path — and for the same reason. Mutating inside the loop
     * would make the second half of a long run through new territory come back cooled.
     */
    const classified: ClassifiedCell[] = []
    const seen = new Set<H3Index>()

    for (const cell of activity.cells) {
      // A cell crossed twice in one activity is one cell (§3.3). The incremental path gets
      // this from `traceToCells` returning a `Set`; the fold cannot assume its input is one.
      if (seen.has(cell)) continue
      seen.add(cell)

      const prev = cells.get(cell)
      if (prev === undefined) {
        classified.push({ cell, discovery: "new" })
        continue
      }

      const delta = atMs - Date.parse(prev.lastRunAt)
      /**
       * IN THE FOLD THIS IS A BUG, NOT AN ARRIVAL ORDER. The list is sorted ascending, so a
       * cell's `lastRunAt` can never be ahead of the activity being applied — unless the sort
       * did not happen. §3.4's guard, at the one place where it means a defect rather than a
       * backfill.
       */
      if (delta < 0) throw new OutOfOrderScoringError(cell, at, prev.lastRunAt)
      classified.push({
        cell,
        discovery: delta < SIX_MONTHS_MS ? "cooled" : "rearmed",
        record: { lastRunAt: prev.lastRunAt },
      })
    }

    awards.set(activity.activityId, awardOf(classified))
    order.push(activity.activityId)

    // Phase 4: apply. Every attribute `02` T6 lists, written the way T6's expressions write it.
    for (const { cell, discovery } of classified) {
      const prev = cells.get(cell)
      if (prev === undefined) {
        cells.set(cell, {
          firstRunAt: at,
          firstRunId: activity.activityId,
          lastRunAt: at,
          lastRunId: activity.activityId,
          visitCount: 1,
          discoveryCount: 1,
        })
        continue
      }
      // `min` and `max`, expressed as the comparisons T6 expresses as conditions. Monotonic
      // here by the sort, and written as a comparison anyway so the two agree by inspection.
      if (at < prev.firstRunAt) {
        prev.firstRunAt = at
        prev.firstRunId = activity.activityId
      }
      if (at > prev.lastRunAt) {
        prev.lastRunAt = at
        prev.lastRunId = activity.activityId
      }
      prev.visitCount += 1
      if (awardsCredit(discovery)) prev.discoveryCount += 1
    }
  }

  return { cells, awards, order }
}

/**
 * `discoveryCount` counts *"how many times it awarded credit"* (`02` §2.4). The fold can never
 * produce `"deferred"` — that class exists only for the incremental path — so this is the same
 * predicate `explored-cells.ts` uses, stated locally to keep the fold readable beside §8.3's
 * pseudocode.
 */
const awardsCredit = (discovery: Discovery): boolean =>
  discovery === "new" || discovery === "rearmed"

/**
 * The total discovery credit a folded history earns — the number `0066`'s XP replay multiplies
 * by the Cartography rate, and the one the drill's step-8 verification compares against.
 *
 * Summed from the per-activity awards rather than recomputed from the cell map, because those
 * awards are what `02` §8.3 step 6 consumes and a second derivation could disagree with them.
 * Rounded for the reason `awardOf` rounds: every reachable total is a multiple of 0.5, but
 * summing a thousand floats can land on 64.99999999999999.
 */
export function totalCredits(result: FoldResult): number {
  let total = 0
  for (const award of result.awards.values()) total += award.discoveryCredits
  return Math.round(total * 10) / 10
}
