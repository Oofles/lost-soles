import type { RuleCurve } from "@/src/rules/schema"

import { FLOOR_ACTIVITY_ID, type XpLedgerEntry } from "./ledger"
import { levelForXp } from "./levels"

/**
 * D-135, ENFORCED INSIDE THE LEDGER. Ticket `0066`. `02-data-model.md` §4.4 step 5, §4.6;
 * D-142, I-15, I-16, I-17.
 *
 * **This is the only place in the system permitted to invent a ledger row.** Every other row is
 * derived from an activity by the rules; a `retained_floor` row is derived from what the user was
 * *shown*, and nothing else. Keep it that way: one function, deterministic, and the floor amount
 * is `waterline − recomputed − existingFloors` and nothing more.
 *
 * ─── WHY A ROW AND NOT A CLAMP ──────────────────────────────────────────────
 *
 * A clamped `displayedXp` would disagree with its own ledger (breaking I-15), hide the
 * discrepancy, and compound across successive rebalances. A floor row keeps
 * `displayedXp == SUM(ledger)` true, is auditable ("14,800 XP retained from ruleset v1"), and is
 * idempotent: its id is deterministic in `(skill, from, to)`, and a re-run finds it among
 * `existingFloors` and computes a gap of zero.
 *
 * Nothing here may ever be rewritten as a `max` of the old and new XP. If that expression shows up
 * in the replay's write path, the ticket that built this failed regardless of its tests.
 */

/** What the user had been shown for one skill, before the replay. §4.4 step 0. */
export interface WaterlineMark {
  xp: number
  /** `max(level, levelHighWater)` — the DISPLAYED level, which is what I-17 protects. */
  level: number
}

/** Per skill. A plain record so it serialises into `ReplayRun.waterline` as-is. */
export type Waterline = Record<string, WaterlineMark>

/** Floor rows sort after every real row, so a chronological view shows them after their history. */
export const FLOOR_SEQ_PREFIX = "9999-12-31T00:00:00Z#__floor__#"

/** §4.6. Deterministic in `(skill, fromVersion, toVersion)`, which is what makes a re-run a no-op. */
export function floorId(skillId: string, fromVersion: number, toVersion: number): string {
  return `${FLOOR_ACTIVITY_ID}#${skillId}#v${fromVersion}-${toVersion}`
}

export interface ReconcileInput {
  userId: string
  waterline: Waterline
  /** Σ `xpAwarded` of the rows the replay just wrote, per skill (`isFloor: false` only). */
  recomputed: ReadonlyMap<string, number>
  /** Σ `xpAwarded` of the `isFloor: true` rows that survived step 2, per skill. */
  existingFloors: ReadonlyMap<string, number>
  fromVersion: number
  toVersion: number
  /** The replay's wall clock. Audit only (§4.1). */
  awardedAt: string
}

/**
 * STEP 5. One floor row per skill whose recomputed total falls short of the waterline, carrying
 * exactly the gap. Skills are visited in id order so the output is byte-identical run to run.
 *
 * A skill present in the waterline and absent from the new ruleset — renamed, disabled — has a
 * recomputed total of 0, and its whole displayed XP is retained. That is the rule, not an edge.
 */
export function reconcile(input: ReconcileInput): XpLedgerEntry[] {
  const { userId, waterline, recomputed, existingFloors, fromVersion, toVersion, awardedAt } = input
  const out: XpLedgerEntry[] = []

  for (const skillId of Object.keys(waterline).sort()) {
    const shown = waterline[skillId]!.xp
    const gap = shown - ((recomputed.get(skillId) ?? 0) + (existingFloors.get(skillId) ?? 0))
    if (gap <= 0) continue
    if (!Number.isSafeInteger(gap)) {
      throw new Error(`reconcile: ${skillId}'s gap ${gap} is not an integer (I-19)`)
    }
    out.push({
      id: floorId(skillId, fromVersion, toVersion),
      userId,
      activityId: FLOOR_ACTIVITY_ID,
      skillId,
      reason: "retained_floor",
      units: 0,
      unitsEffective: 0,
      xpAwarded: gap,
      xpRulesVersion: toVersion,
      supersedesRulesVersion: fromVersion,
      isFloor: true,
      seq: `${FLOOR_SEQ_PREFIX}${skillId}`,
      awardedAt,
    })
  }
  return out
}

/** The slice of a `SkillState` row the waterline reads. */
export interface ShownState {
  skillId: string
  displayedXp: number
  level?: number
  levelHighWater?: number
}

/**
 * STEP 0 — THE D-135 WATERLINE, from `SkillState` as it stands.
 *
 * `level` is read when present and recomputed under the FROM curve when not: ingest does not
 * write it until `0219`, and the level a user was shown is the one the from-curve gives their XP.
 */
export function waterlineOf(
  states: Iterable<ShownState>,
  fromCurve: Pick<RuleCurve, "maxLevel" | "stepFormula">,
): Waterline {
  const out: Waterline = {}
  for (const s of states) {
    const level = s.level ?? levelForXp(s.displayedXp, fromCurve)
    out[s.skillId] = { xp: s.displayedXp, level: Math.max(level, s.levelHighWater ?? 0) }
  }
  return out
}

/**
 * I-17, the second ratchet: `levelHighWater = max(levelHighWater, computedLevel)`. The waterline
 * level already folds in the old high-water, so it is the only prior the ratchet needs.
 */
export function ratchetLevel(waterlineLevel: number | undefined, computedLevel: number): number {
  return Math.max(waterlineLevel ?? 0, computedLevel)
}
