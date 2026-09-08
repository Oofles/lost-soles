import type { H3Index } from "h3-js"

import { RES } from "./fog"

/**
 * D-120'S SCORING RULE, AS A PURE FUNCTION. Ticket `0048`. `05-fog-of-war.md` §3.1–§3.3,
 * §9.2; `02-data-model.md` T3 and T6; I-1, I-12, I-14.
 *
 * D-120 verbatim, and the whole of it:
 *
 *   - Never-seen ground → **full** discovery credit.
 *   - Ground run within the last 6 months → **zero** credit.
 *   - Ground last run more than 6 months ago → **50%**, and the cell re-arms.
 *
 * ─── NO CLOCK. NOT AS A PREFERENCE — AS THE POINT (I-12) ────────────────────
 *
 * Scoring time is `activity.startedAt`, always, and it arrives as the `at` parameter.
 * A run uploaded three days late must score as it would have on the day it happened, and
 * a replay must reproduce the original answer exactly (04 §7.4). A single `Date.now()`
 * anywhere in this path breaks I-1 and I-14 together and does it *silently* — every test
 * still passes, and the damage only shows up months later as a total nobody can
 * reconcile.
 *
 * This module therefore imports nothing that can tell the time, and `discovery.test.ts`
 * runs its whole suite with `Date.now()`, `performance.now()` and the **no-argument**
 * `Date` constructor stubbed to throw. `Date.parse(iso)` and `new Date(iso)` stay
 * available and are not exceptions to the rule: a function that can only answer a
 * question you already asked it cannot tell the time.
 *
 * ─── CLASSIFY FULLY, THEN WRITE ─────────────────────────────────────────────
 *
 * Every cell is classified against the store as it was **before this activity**. That is
 * why this function takes a `records` map read in one shot rather than a store handle it
 * could call per cell: with a handle, the obvious implementation interleaves reads and
 * writes, and the second half of a long run through new territory comes back "cooled"
 * because the first half already moved `lastRunAt`. It would halve the credit of exactly
 * the runs the game is built to reward, and nothing would look wrong.
 *
 * §3.2 enforces the separation by putting classify in phase 2 and writes in phase 4. Here
 * it is enforced by the type: there is no store in scope.
 */

/**
 * SIX MONTHS IS 183 DAYS, UTC. `05-fog-of-war.md` §9.2, which flags it *"only so nobody
 * later fixes it into `dateFns.addMonths`"*.
 *
 * Calendar months are ambiguous — August 31 plus six months is a question, not a date —
 * and they drift with month length, so the same cell would re-arm at different intervals
 * depending on when it was last run. 183 days is unambiguous, testable, and within a day
 * or two of every reasonable reading of "six months".
 */
export const SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000

/** Never seen. Full credit. */
export const CREDIT_NEW = 1.0
/** Last run more than `SIX_MONTHS_MS` ago. Half credit, and the cell re-arms. */
export const CREDIT_REARM = 0.5
/** Last run inside the window. **Zero** — written out for symmetry, per §3.1. */
export const CREDIT_COOLED = 0.0

/**
 * THE VERSION OF THIS ALGORITHM, and it is part of an idempotency key.
 *
 * `02-data-model.md` T8 builds the score-time receipt key as
 * `${source}#${externalId}#${hash}#v${FOG_ALGO_VERSION}`, and T3 stores it as
 * `fogAlgoVersion` on every activity. Both exist for the same reason: if this classifier
 * ever changes what it awards, the old activities must still say which rules produced
 * their numbers, and a re-score under new rules must not collide with the old receipt.
 *
 * **Bump it when the CLASSIFICATION changes, never for a refactor.** A bump invalidates
 * every score-time receipt, which is cheap; failing to bump when the answer moved is what
 * makes two activities scored under different rules indistinguishable forever.
 */
export const FOG_ALGO_VERSION = 1

/** The three classes. Disjoint, exhaustive, and the only vocabulary downstream may use. */
export type Discovery = "new" | "rearmed" | "cooled"

/** The subset of a T6 record this classifier reads. Nothing else may influence credit. */
export interface CellRecord {
  /** ISO 8601 UTC. THE D-120 clock. A presence bit here is the bug D-120 prevents. */
  lastRunAt: string
}

/** One cell and what this activity did to it. */
export interface ClassifiedCell {
  cell: H3Index
  discovery: Discovery
  /**
   * The record read in phase 2, CARRIED rather than re-read. §3.3's last bullet: a write
   * phase that re-reads sees this run's own effects. Absent for a new cell.
   */
  record?: CellRecord
}

/**
 * WHAT THIS RUN DID TO THE MAP. §3.2's `award`, minus the XP.
 *
 * XP is deliberately absent. `cartographyXp` and `wayfaringXp` appear in §3.2's pseudocode
 * but belong to capability 09 — §3.6 is explicit that activity-skill XP *"is not the fog
 * subsystem's business"*. Fog contributes exactly one input to it, `newShare`, and this
 * record carries the two numbers that produce it.
 *
 * **STORED, NOT RECOMPUTED.** Everything the UI says about a run — "41 new cells" — reads
 * this back off the T3 row. Recomputing it later gives a different answer, because by then
 * the cells are in the store and every one of them would classify as cooled. R3 §4(e)
 * makes the same point about XP.
 */
export interface DiscoveryAward {
  cellCount: number
  newCellCount: number
  rearmedCellCount: number
  cooledCellCount: number
  /**
   * `new × 1.0 + rearmed × 0.5`. Capability 09 multiplies it by the Cartography rate
   * (13 XP/cell, D-215) — this subsystem never names an XP number.
   */
  discoveryCredits: number
  /** Always 10. Present because a blob or a ledger row read in five years must say so. */
  res: number
  algoVersion: number
}

/**
 * Thrown when `at − lastRunAt` is negative. §3.4's guard, as a type.
 *
 * A negative delta means an activity is being classified against a cell whose `lastRunAt`
 * is in its future — which can only happen if the replay queue (`0050`) let an
 * out-of-order activity onto the incremental path instead of enqueuing a fold. The naive
 * comparison would quietly call it "cooled", award zero credit, and be wrong in a way that
 * survives into a permanent ledger. Failing the job is the cheap outcome: the message is
 * redelivered and, once the replay path exists, handled correctly.
 */
export class OutOfOrderScoringError extends Error {
  constructor(
    readonly cell: H3Index,
    readonly at: string,
    readonly lastRunAt: string,
  ) {
    super(
      `05 §3.4: cell ${cell} has lastRunAt ${lastRunAt}, which is AFTER this activity's ` +
        `startedAt ${at}. An out-of-order activity reached the incremental scorer instead ` +
        `of the replay queue. Refusing to score it as "cooled".`,
    )
    this.name = "OutOfOrderScoringError"
  }
}

/**
 * CLASSIFY EVERY CELL AGAINST PRE-RUN STATE. §3.2 phase 2.
 *
 * @param cells   this run's cell set, from `traceToCells`. A `Set`, so §3.3's whole
 *                edge-case list — out-and-backs, loops, figure-eights, crossing your own
 *                path — is already handled and no code here knows those cases exist.
 * @param records what the store held **before** this activity, keyed by cell id.
 * @param at      `activity.startedAt`. NEVER `now()` (I-12).
 *
 * Iteration order is irrelevant: the classes are disjoint and no cell's verdict depends on
 * another's.
 */
export function classifyCells(
  cells: Iterable<H3Index>,
  records: ReadonlyMap<H3Index, CellRecord>,
  at: string,
): ClassifiedCell[] {
  const atMs = Date.parse(at)
  if (Number.isNaN(atMs)) throw new Error(`classifyCells: unparseable startedAt "${at}"`)

  const out: ClassifiedCell[] = []
  for (const cell of cells) {
    const record = records.get(cell)

    if (record === undefined) {
      out.push({ cell, discovery: "new" })
      continue
    }

    const delta = atMs - Date.parse(record.lastRunAt)
    if (delta < 0) throw new OutOfOrderScoringError(cell, at, record.lastRunAt)

    // `< SIX_MONTHS_MS` is cooled, so exactly 183 days is RE-ARMED. §3.2's comparison,
    // transcribed rather than reasoned about: "more than 6 months ago" re-arms, and the
    // boundary belongs to the generous side because D-013 says nothing is ever taken away.
    out.push({ cell, discovery: delta < SIX_MONTHS_MS ? "cooled" : "rearmed", record })
  }
  return out
}

/** The credit one classified cell earns. The only place the three constants are read. */
export function creditOf(discovery: Discovery): number {
  if (discovery === "new") return CREDIT_NEW
  if (discovery === "rearmed") return CREDIT_REARM
  return CREDIT_COOLED
}

/**
 * Does this cell's write increment `discoveryCount`? §2.4: *"how many times it awarded
 * credit"* — so new and re-armed, and never cooled.
 *
 * A predicate rather than `creditOf(d) > 0` at each call site, because the two questions
 * are only accidentally the same. If a future rule ever awards partial credit without
 * re-arming, this is the one that has to change.
 */
export const awardsDiscovery = (discovery: Discovery): boolean => discovery !== "cooled"

/**
 * THE AWARD, SUMMED. §3.2 phase 4.
 *
 * `cellCount` is the length of the classified list rather than a separate input, so the
 * three class counts cannot fail to add up to it — a property `discovery.test.ts` asserts
 * rather than assumes.
 */
export function awardOf(classified: readonly ClassifiedCell[]): DiscoveryAward {
  let newCellCount = 0
  let rearmedCellCount = 0
  let cooledCellCount = 0
  let discoveryCredits = 0

  for (const { discovery } of classified) {
    if (discovery === "new") newCellCount++
    else if (discovery === "rearmed") rearmedCellCount++
    else cooledCellCount++
    discoveryCredits += creditOf(discovery)
  }

  return {
    cellCount: classified.length,
    newCellCount,
    rearmedCellCount,
    cooledCellCount,
    /**
     * Rounded to one place. `CREDIT_REARM` is 0.5, so every reachable total is a multiple
     * of 0.5 — but summing 130 floats in a loop can land on 64.99999999999999, and this
     * number is written to a permanent record that a later replay compares against.
     */
    discoveryCredits: Math.round(discoveryCredits * 10) / 10,
    res: RES,
    algoVersion: FOG_ALGO_VERSION,
  }
}

/**
 * The award for an activity that produced no cells. §3.6, and it is NOT an empty object.
 *
 * A treadmill run, a strength session, or a trace whose every sample was filtered out all
 * land here. The record is still written, with `cellCount: 0`, for two reasons §3.6 gives:
 * the idempotency gate then covers no-GPS activities too, so re-import stays a no-op; and
 * the T3 row shape never varies, so no reader has to distinguish "absent" from "none".
 */
export const NO_CELLS: DiscoveryAward = Object.freeze({
  cellCount: 0,
  newCellCount: 0,
  rearmedCellCount: 0,
  cooledCellCount: 0,
  discoveryCredits: 0,
  res: RES,
  algoVersion: FOG_ALGO_VERSION,
})

/**
 * The share of this run that was new ground — the ONE number fog hands the XP engine
 * (§3.6, D-021).
 *
 * Capability 09 blends Wayfaring with it: a run that is half new ground earns 75%, full
 * rate on the new half and half rate on the known half. Defined here rather than there
 * because the scorer and any future route planner must agree on it (§8.4's reuse point),
 * and because `0/0` is a real case — a treadmill run — that must be 0 and not `NaN`.
 */
export const newShare = (award: DiscoveryAward): number =>
  award.cellCount === 0 ? 0 : award.newCellCount / award.cellCount
