/**
 * What deserves a celebration (capability `09`, ticket 0065). D-146; `06-ui-ux.md` §5.4, §10.5.
 *
 * ─── A NEW SKILL MINTS A FREE TOTAL LEVEL POINT ─────────────────────────────
 *
 * Total Level is Σ level over every enabled skill, and an untrained skill is level 1. So the
 * moment a ruleset adds a row, Total Level rises by one with no work done. The scorer is RIGHT
 * to count it — the level genuinely is 1 — and clamping it there would make
 * `displayedXp == SUM(ledger)` false (I-15). So the scorer keeps telling the truth, and this
 * module, which decides what to CELEBRATE, is where the guard lives. It is the only place it
 * lives: `celebrate.test.ts` greps for it.
 *
 * ─── "MINTED" KEYS ON THE RULESET, NEVER ON XP OR THE CLOCK ─────────────────
 *
 * A skill is minted for a `before → after` diff when its row's `introducedIn` is later than the
 * ruleset `before` was computed under — the row did not exist when the user last looked. Not
 * "XP == 0": a skill can sit untrained at level 1 for years and its first level-up is still
 * real. And `>`, not "equals the version being applied": if two versions ship between runs, a
 * row from the first is as unearned as a row from the second.
 *
 * A row that EXISTED at the baseline but did not COUNT — shipped `enabled: false`, switched on
 * later — mints the same free point (`0222`, D-300): `totalLevel` counts enabled rows only, so the
 * flip alone raises it by one. So the baseline also carries the skill ids that counted when it was
 * taken, and "minted" is "introduced after it, or not counted in it".
 *
 * A minted skill yields no level-up event at ANY level, and none of its levels count toward the
 * celebrable delta — including XP it earned in the very activity that first scored it. The next
 * diff, computed from a `before` under the new ruleset, treats it like any other skill.
 *
 * Pure: no I/O, no clock. The consumer — the level-up cards in `12-post-run-moment` — persists
 * the snapshot and the last celebrated milestone; this module only answers from them.
 */

import type { RuleCurve, RuleSkill } from "@/src/rules/schema"

import { levelForXp, totalLevel } from "./levels"

/** What a "minted" judgement is made against: a ruleset version, and the skills that counted under it. */
export interface Baseline {
  rulesVersion: number
  /** Ids of the skills enabled when the baseline was taken — the ones Total Level counted. */
  countedSkills: ReadonlySet<string>
}

/** The baseline a ruleset defines: its version, and its enabled rows. */
export function baselineOf(rules: { version: number; skills: readonly Pick<RuleSkill, "id" | "enabled">[] }): Baseline {
  return { rulesVersion: rules.version, countedSkills: new Set(rules.skills.filter((s) => s.enabled).map((s) => s.id)) }
}

/** What the user last saw: every skill's XP, and the ruleset — and counted skills — it was computed under. */
export interface LevelSnapshot extends Baseline {
  /** Absent means zero XP — level 1 if the skill is enabled. */
  xpBySkill: ReadonlyMap<string, number>
}

/** The ruleset `after` is computed under. */
export interface CelebrationRegistry {
  curve: Pick<RuleCurve, "maxLevel">
  skills: readonly Pick<RuleSkill, "id" | "enabled" | "introducedIn">[]
}

export interface LevelUp {
  skillId: string
  from: number
  to: number
}

/**
 * ─── THE D-146 GUARD ────────────────────────────────────────────────────────
 *
 * Was this skill's row added to the ruleset after `baseline`, or did it not count in it (enabled
 * since, D-300)? Either way its level 1 is a point nobody earned. THE ONE PREDICATE: every suppression in this module — and the level-up cards of
 * `12-post-run-moment` (`0082`) — asks it, and nothing else in the codebase compares `introducedIn`
 * with a version (`celebrate.test.ts` and `d146-guard.test.ts` grep for a second copy).
 */
export function isMinted(skill: Pick<RuleSkill, "id" | "introducedIn">, baseline: Baseline): boolean {
  return skill.introducedIn > baseline.rulesVersion || !baseline.countedSkills.has(skill.id)
}

/** Enabled skills that counted when `before` was taken — the only ones that can celebrate. */
function earnedSkills(before: LevelSnapshot, registry: CelebrationRegistry) {
  return registry.skills.filter((s) => s.enabled && !isMinted(s, before))
}

/**
 * Per-skill level-ups worth a card, in registry order. A skill minted since `before` never
 * yields one; every other skill in the same diff does, normally.
 */
export function celebrableLevelUps(
  before: LevelSnapshot,
  after: LevelSnapshot,
  registry: CelebrationRegistry,
): LevelUp[] {
  const ups: LevelUp[] = []
  for (const s of earnedSkills(before, registry)) {
    const from = levelForXp(before.xpBySkill.get(s.id) ?? 0, registry.curve)
    const to = levelForXp(after.xpBySkill.get(s.id) ?? 0, registry.curve)
    if (to > from) ups.push({ skillId: s.id, from, to })
  }
  return ups
}

/**
 * The Total Level change the notification layer may announce: the real delta minus every level
 * a skill minted since `before` contributes. Zero when the only change was new rows.
 */
export function totalLevelDelta(
  before: LevelSnapshot,
  after: LevelSnapshot,
  registry: CelebrationRegistry,
): number {
  return celebrableLevelUps(before, after, registry).reduce((sum, u) => sum + (u.to - u.from), 0)
}

/**
 * Total Level milestones to celebrate, ascending. `ladder` is 04 §4.3's list (plus the computed
 * ceiling, if the caller wants it) and `lastCelebrated` the highest one already fired — both the
 * caller's to keep, so no milestone value is written down here.
 *
 * A milestone fires when the displayed Total Level is at or past it, it has not fired before,
 * and this diff carries at least one EARNED point. So a milestone crossed only by a minted point
 * is suppressed, and fires on the next diff with a genuine level in it — even though that point
 * no longer crosses it, because the minted one already did.
 */
export function celebrableMilestones(
  before: LevelSnapshot,
  after: LevelSnapshot,
  registry: CelebrationRegistry,
  ladder: readonly number[],
  lastCelebrated: number,
): number[] {
  if (totalLevelDelta(before, after, registry) <= 0) return []
  const total = totalLevel(after.xpBySkill, registry.skills, registry.curve)
  return [...ladder].filter((m) => m > lastCelebrated && m <= total).sort((a, b) => a - b)
}

/**
 * ─── EARNED TOTAL LEVEL (`0082`, D-297) ─────────────────────────────────────
 *
 * The level-up cards judge Total Level milestones on this, not on `totalLevel`: the real Total
 * Level minus the free level 1 of every enabled skill minted since `baseline` (trained or
 * not — its first level was free either way). The DISPLAYED Total Level is untouched; this number
 * is never shown. It needs no memory of what was celebrated: a milestone fires on the activity that
 * carries the earned total across it, so one crossed only by a minted point does not fire, and fires
 * later when earned XP gets there (criterion 9) — on every device, and identically on a Relive.
 */
export function earnedTotalLevel(
  xpBySkill: ReadonlyMap<string, number>,
  registry: CelebrationRegistry,
  baseline: Baseline,
): number {
  const minted = registry.skills.filter((s) => s.enabled && isMinted(s, baseline)).length
  return totalLevel(xpBySkill, registry.skills, registry.curve) - minted
}

/** Total Level milestones in `(earned before, earned after]`, ascending. */
export function earnedMilestonesCrossed(
  before: ReadonlyMap<string, number>,
  after: ReadonlyMap<string, number>,
  registry: CelebrationRegistry,
  baseline: Baseline,
  ladder: readonly number[],
): number[] {
  const from = earnedTotalLevel(before, registry, baseline)
  const to = earnedTotalLevel(after, registry, baseline)
  return [...new Set(ladder)].filter((m) => m > from && m <= to).sort((a, b) => a - b)
}
