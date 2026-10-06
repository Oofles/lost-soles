/**
 * Level maths (capability `09`, ticket 0063). `04-game-design.md` §1.2 and §2.1, D-130, D-145.
 *
 * Pure arithmetic over a skill's XP: no I/O, no clock, no registry singleton — the curve and the
 * skill rows are always passed in. `levelHighWater` is not WRITTEN here; it is a write-time
 * ratchet owned by the replay job (`src/scoring/reconcile.ts`, 0066). `levelProgress` only reads
 * it, to show the displayed level.
 *
 * The curve is `4L²` to advance from `L` to `L+1`, so the cumulative XP to BE level `L` is
 * `C(L) = 2(L−1)L(2L−1)/3` — an integer for every `L`, since `(L−1)L(2L−1)` is always divisible
 * by 6. Runescape's exponential was evaluated and rejected (§2.1); do not reintroduce it.
 *
 * Nothing here names a level cap or a Total Level ceiling as a number. Both come from the
 * ruleset, so a new skill row moves them with no source change (D-192).
 *
 * `curve.stepFormula` is HONOURED, not decorative (ticket 0066, I-17). The grammar is exactly
 * `"<k> * L^2"` — the one family D-130 chose — and anything else throws rather than being read
 * as `4L²`. A curve with no `stepFormula` (a test passing `{ maxLevel }`) is D-130's `k = 4`.
 */

import type { RuleCurve, RuleSkill } from "@/src/rules/schema"

/** D-130's coefficient. What a curve without a `stepFormula` means. */
export const D130_STEP_COEFFICIENT = 4

type CurveLike = Pick<RuleCurve, "maxLevel"> & Partial<Pick<RuleCurve, "stepFormula">>

/**
 * `k` from `"<k> * L^2"`. A curve change (I-17) is a change to `k`; a formula outside that family
 * is refused, because a level computed from a misread formula would be stamped into
 * `levelHighWater` for ever.
 */
export function stepCoefficient(curve: Partial<Pick<RuleCurve, "stepFormula">>): number {
  if (curve.stepFormula === undefined) return D130_STEP_COEFFICIENT
  const m = /^\s*(\d+)\s*\*\s*L\s*\^\s*2\s*$/.exec(curve.stepFormula)
  const k = m ? Number(m[1]) : NaN
  if (!Number.isSafeInteger(k) || k < 1) {
    throw new Error(`stepFormula ${JSON.stringify(curve.stepFormula)} is not "<k> * L^2" (D-130)`)
  }
  return k
}

/** XP to advance from level `L` to `L + 1`. */
export function xpToAdvance(level: number, k = D130_STEP_COEFFICIENT): number {
  return k * level * level
}

/** Cumulative XP to BE level `L`. `C(1) = 0`. Integer: `(L−1)L(2L−1)` is divisible by 6. */
export function cumulativeXp(level: number, k = D130_STEP_COEFFICIENT): number {
  return (k * ((level - 1) * level * (2 * level - 1))) / 6
}

/**
 * The level `xp` buys, clamped at `curve.maxLevel`: the largest `L` with `C(L) ≤ xp`.
 *
 * `C(L) ≈ kL³/3` gives the estimate; the two loops correct it in integers, so a boundary never
 * depends on a cube root rounding the right way.
 */
export function levelForXp(xp: number, curve: CurveLike): number {
  const k = stepCoefficient(curve)
  let level = Math.max(1, Math.floor(Math.cbrt((3 * Math.max(0, xp)) / k)))
  while (level > 1 && cumulativeXp(level, k) > xp) level--
  while (cumulativeXp(level + 1, k) <= xp) level++
  return Math.min(level, curve.maxLevel)
}

type EnabledRow = Pick<RuleSkill, "id" | "enabled">

function enabledRows(skills: readonly EnabledRow[]): EnabledRow[] {
  return skills.filter((s) => s.enabled)
}

/**
 * Σ level over every ENABLED skill in the ruleset, meta skills included (D-033). An untrained
 * skill — absent from `xpBySkill` — contributes its level 1; a disabled one contributes nothing,
 * even if it has XP.
 */
export function totalLevel(
  xpBySkill: ReadonlyMap<string, number>,
  skills: readonly EnabledRow[],
  curve: CurveLike,
): number {
  let total = 0
  for (const s of enabledRows(skills)) total += levelForXp(xpBySkill.get(s.id) ?? 0, curve)
  return total
}

/** Σ XP over every enabled skill. The number that goes up every session without exception. */
export function totalXp(xpBySkill: ReadonlyMap<string, number>, skills: readonly EnabledRow[]): number {
  let total = 0
  for (const s of enabledRows(skills)) total += xpBySkill.get(s.id) ?? 0
  return total
}

/** `enabledSkillCount × maxLevel` (D-145, D-192). Computed, never written down. */
export function totalLevelCeiling(skills: readonly EnabledRow[], curve: Pick<RuleCurve, "maxLevel">): number {
  return enabledRows(skills).length * curve.maxLevel
}

/**
 * The Total Level milestone ladder, `04-game-design.md` §4.3. Ticket 0073.
 *
 * The ceiling is NOT on it — it is appended by `totalLevelRung` from `totalLevelCeiling`, so a new
 * skill row moves the last rung with no source change (D-192). The gap above 500 is real and
 * recorded in §4.3; closing it is a pacing decision, not something to patch here.
 *
 * Kept here rather than in the ruleset: the ladder is a presentation of Total Level, not an XP
 * rule, and versioning it with the rules would make a new rung look like a rescore.
 * `celebrableMilestones` takes the same list from its caller.
 */
export const TOTAL_LEVEL_MILESTONES: readonly number[] = [100, 150, 200, 250, 300, 400, 500]

/** Where `total` sits between the rung below it and the next one. `fraction` is 1 at the ceiling. */
export interface Rung {
  from: number
  to: number
  fraction: number
}

/** The header bar of `/skills` (`06` §5.2): progress from the last rung passed to the next. */
export function totalLevelRung(total: number, ceiling: number, ladder: readonly number[] = TOTAL_LEVEL_MILESTONES): Rung {
  const rungs = [...ladder.filter((m) => m < ceiling), ceiling].sort((a, b) => a - b)
  const to = rungs.find((m) => m > total)
  if (to === undefined) return { from: ceiling, to: ceiling, fraction: 1 }
  const from = [...rungs].reverse().find((m) => m <= total) ?? 0
  return { from, to, fraction: (total - from) / (to - from) }
}

/** One skill's place on its own curve: the displayed level, and how far into it `xp` reaches. */
export interface LevelProgress {
  level: number
  /** XP still needed for `level + 1`. 0 at `maxLevel`. */
  xpToNext: number
  /** 0..1 toward `level + 1`. 1 at `maxLevel`. */
  fraction: number
}

/**
 * `levelForXp`, raised to `levelHighWater` when a ruleset change left the ratchet above the
 * computed level — the DISPLAYED level of `reconcile.ts` (I-17). Never shows a skill lower than
 * it has been shown.
 */
export function levelProgress(xp: number, curve: CurveLike, levelHighWater = 1): LevelProgress {
  const k = stepCoefficient(curve)
  const level = Math.min(Math.max(levelForXp(xp, curve), levelHighWater), curve.maxLevel)
  if (level >= curve.maxLevel) return { level, xpToNext: 0, fraction: 1 }
  const floor = cumulativeXp(level, k)
  const next = cumulativeXp(level + 1, k)
  const into = Math.min(Math.max(xp - floor, 0), next - floor)
  return { level, xpToNext: Math.max(next - Math.max(xp, floor), 0), fraction: into / (next - floor) }
}
