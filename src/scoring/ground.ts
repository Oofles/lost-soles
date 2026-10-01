/**
 * GROUND MULTIPLIERS — distance weighted by the state of the ground it covered. Ticket 0061.
 *
 * `02-data-model.md` §3.1's J3 for a `groundMultipliers` row, and `04-game-design.md` §8.1
 * steps 5–7, which is the method: for each segment of the filtered path, take its midpoint,
 * find that point's H3 cell, classify the cell, and accumulate the segment's length into the
 * cell's class. The three class distances then carry the row's `groundMultipliers` into up
 * to three ledger reasons — `new_ground`, `rearmed_ground`, `recent_ground` (D-120, D-021).
 *
 * ─── EVERY MULTIPLIER IS READ OFF THE ROW ───────────────────────────────────
 *
 * No rate lives in this file. `groundMultipliers: null` is a THIRD state, not `{1,1,1}`: the
 * skill is not ground-scored at all, and emits one `distance` row at its own `units` (Vigil).
 *
 * ─── THE CLASSIFIER IS INJECTED, NOT OWNED ──────────────────────────────────
 *
 * Classification is `classifyCells` (`0048`), unchanged. This module takes a `GroundLookup`
 * built from its output, because the ingest path classifies against `ExploredCell` (a cache)
 * and the replay path must classify against the fold of `cells.bin` in `startedAt` order
 * (`02` §4.4 step 3b). One function, two sources of pre-run state, so replay cannot drift.
 *
 * ─── DISCOVERY CREDIT IS NOT HERE ───────────────────────────────────────────
 *
 * Cartography is scored per CELL by the fog subsystem (`05` §8.2) and propagated by `0064`.
 * This module rates ACTIVITY XP per METRE, and the two are asymmetric on purpose: recent
 * ground pays half here and nothing there.
 *
 * Pure and deterministic (`04` §7.4): no clock, no RNG. The six-month clock is
 * `activity.startedAt`, and it was applied upstream by `classifyCells`. Nothing is rounded —
 * integer XP happens once, at ledger write time (I-19, `0062`).
 */

import { latLngToCell, type H3Index } from "h3-js"

import type { GeoPoint } from "@/src/domain/activity"
import type { ClassifiedCell, Discovery } from "@/src/domain/discovery"
import { RES } from "@/src/domain/fog"
import { metresBetween } from "@/src/domain/geo"
import type { Multipliers, RuleSkill } from "@/src/rules/schema"

import { softCap } from "./soft-cap"
import type { SkillUnits } from "./units"

/** The three ground states, named as `groundMultipliers` names them. */
export type Ground = keyof Multipliers

/** `02` §4.2's reason vocabulary, as far as this module writes it. */
export type GroundReason =
  | "new_ground"
  | "rearmed_ground"
  | "recent_ground"
  | "distance"
  | "reps"
  | "duration"

const REASON: Record<Ground, GroundReason> = {
  new: "new_ground",
  rearmed: "rearmed_ground",
  recent: "recent_ground",
}

/**
 * THE REASON OF AN UNGROUNDED ROW, BY MEASURE KERNEL. `02` §4.2: `distance` is traceless
 * distance (Vigil), `reps` is `logMode: reps`, `duration` is `logMode: duration`.
 *
 * Keyed on the measure's KERNEL — the part before the colon — so `reps:pushup` and a future
 * `reps:squat` share one entry and adding an exercise is still a data row (D-031). `0061`
 * returned `distance` for every ungrounded skill, which filed Might's pushups under distance;
 * `0062` found it when the ledger started writing the reason down.
 */
const UNGROUNDED_REASON: Record<string, GroundReason> = {
  distanceKm: "distance",
  reps: "reps",
  seconds: "duration",
}

function ungroundedReason(measure: string): GroundReason {
  const kernel = measure.split(":", 1)[0]!
  const reason = UNGROUNDED_REASON[kernel]
  if (!reason) throw new Error(`no ledger reason for measure ${JSON.stringify(measure)} (02 §4.2)`)
  return reason
}

/** Bucket order. Fixed, so output is deterministic and the remainder always lands last. */
const GROUNDS: readonly Ground[] = ["new", "rearmed", "recent"]

/** A cell's pre-run verdict for THIS activity. `undefined` means the cell was never classified. */
export type GroundLookup = (cell: H3Index) => Discovery | undefined

/** Metres of filtered path over each ground state. */
export type GroundSplit = Record<Ground, number>

/**
 * One ledger-row-to-be. `units` is raw work; `unitsEffective` is after the soft cap (`0218`)
 * and the multiplier.
 */
export interface GroundedUnits {
  skillId: string
  reason: GroundReason
  units: number
  unitsEffective: number
}

/**
 * Fog's four discovery classes onto the three ground states.
 *
 * `cooled` is D-120's "recent". `deferred` — a cell whose `lastRunAt` is after this
 * activity's `startedAt`, so the replay must decide it (`05` §3.4) — is rated as RECENT, the
 * lowest rate. XP never decreases (D-135): the replay can then only raise it. Operator
 * decision, 2026-09-28.
 */
const GROUND_OF: Record<Discovery, Ground> = {
  new: "new",
  rearmed: "rearmed",
  cooled: "recent",
  deferred: "recent",
}

/** The ingest path's lookup: the verdicts `classifyCells` already produced, keyed by cell. */
export function lookupFromClassified(classified: readonly ClassifiedCell[]): GroundLookup {
  const byCell = new Map(classified.map((c) => [c.cell, c.discovery] as const))
  return (cell) => byCell.get(cell)
}

/**
 * THE SEGMENT WALK. `04` §8.1 steps 5–6: each consecutive pair of points is a segment, its
 * midpoint names its cell, and its length goes to that cell's class.
 *
 * `segments` is `traceToSegments`'s output — the same path the fog measured cells against, so
 * the ground a metre is rated on is ground that metre revealed. The chords between segments
 * are members of neither and contribute nothing, as they contribute nothing to the fog.
 *
 * The midpoint is the arithmetic mean of the endpoints. Over a segment of a few hundred
 * metres that is well inside a res-11 cell of the true great-circle midpoint.
 *
 * **A midpoint cell with no verdict throws.** It cannot happen: the midpoint lies on the path,
 * its cell's centre is within the cell's circumradius (~25 m at res 11) of it, and every cell
 * within `REVEAL_R_M` (65 m) of the path is in the classified set. Reaching it means the lookup
 * came from a different trace, and scoring against the wrong map would be permanent.
 */
export function groundSplit(segments: readonly GeoPoint[][], ground: GroundLookup): GroundSplit {
  const split: GroundSplit = { new: 0, rearmed: 0, recent: 0 }
  for (const segment of segments) {
    for (let i = 1; i < segment.length; i++) {
      const a = segment[i - 1]!
      const b = segment[i]!
      const metres = metresBetween(a, b)
      if (metres === 0) continue

      const cell = latLngToCell((a.lat + b.lat) / 2, (a.lng + b.lng) / 2, RES)
      const discovery = ground(cell)
      if (discovery === undefined) {
        throw new Error(
          `groundSplit: segment midpoint cell ${cell} has no ground verdict. Every cell on the ` +
            "path is in the classified set, so the lookup was built from a different trace.",
        )
      }
      split[GROUND_OF[discovery]] += metres
    }
  }
  return split
}

/**
 * J3's ground step for one skill. `units` is the activity's own measure (`0060`), APPORTIONED
 * across the three states by the split's distance shares, so the buckets add up to the raw
 * `units` exactly — the filtered path's length and the source's `distanceM` never agree to the
 * metre, and the ledger must itemise the distance the user was told they ran (`04` §8.2).
 *
 * `capped` is `units` after the row's soft cap (`softCap`, `0218`). It scales `unitsEffective`
 * only — `units` stays the raw measurement, so the ledger shows what was logged next to what
 * it was paid for. Defaults to `units`: no cap.
 *
 * - `groundMultipliers: null` → one `distance` row, `unitsEffective = capped`.
 * - A ground-scored skill with no path at all (every sample filtered) is known ground: one
 *   `recent_ground` row. `05` §3.6's default for `newShare = 0`, and the lowest rate, so a
 *   later correction can only add (D-135).
 *
 * Empty buckets are dropped, as `scoreUnits` drops empty skills: an append-only ledger does
 * not get rows for work nobody did.
 */
export function rateGround(
  scored: SkillUnits,
  multipliers: Multipliers | null,
  split: GroundSplit | null,
  capped: number = scored.units,
): GroundedUnits[] {
  const { skillId, units } = scored
  if (multipliers === null) {
    return [{ skillId, reason: ungroundedReason(scored.measure), units, unitsEffective: capped }]
  }
  // What fraction of the work is paid for. `scoreUnits` never emits `units: 0`, but a
  // division by it would write NaN into a ledger that cannot take it back.
  const paid = units === 0 ? 0 : capped / units

  const total = split === null ? 0 : split.new + split.rearmed + split.recent
  const shares: GroundSplit =
    total === 0 ? { new: 0, rearmed: 0, recent: 1 } : {
      new: split!.new / total,
      rearmed: split!.rearmed / total,
      recent: split!.recent / total,
    }

  const present = GROUNDS.filter((g) => shares[g] > 0)
  const out: GroundedUnits[] = []
  let assigned = 0
  for (const [i, g] of present.entries()) {
    // The last bucket takes the remainder, so Σ units is `units` exactly, not to within 1e-15.
    const bucket = i === present.length - 1 ? units - assigned : units * shares[g]
    assigned += bucket
    out.push({ skillId, reason: REASON[g], units: bucket, unitsEffective: bucket * paid * multipliers[g] })
  }
  return out
}

/**
 * Every scored skill of one activity through the soft cap and the ground step. `registry`
 * supplies each row's `softCapUnits` and `groundMultipliers`; `split` is `null` for an
 * activity with no path.
 *
 * The cap is applied HERE, on the whole activity's units and before they are split across
 * ground, so it is per activity (`04` §3.5) and no caller of the scorer can skip it.
 */
export function scoreGround(
  scored: readonly SkillUnits[],
  registry: { skills: RuleSkill[] },
  split: GroundSplit | null,
): GroundedUnits[] {
  const rows = new Map(registry.skills.map((s) => [s.id, s] as const))
  return scored.flatMap((s) => {
    const row = rows.get(s.skillId)
    if (!row) throw new Error(`scoreGround: ${JSON.stringify(s.skillId)} is not in the registry`)
    return rateGround(s, row.groundMultipliers, split, softCap(s.units, row.softCapUnits))
  })
}
