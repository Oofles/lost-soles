/**
 * THE MATCHER — the code half of D-141, and the function that must never name a skill.
 *
 * `02-data-model.md` §3.4 is normative and its pseudocode is transcribed below literally.
 * Ticket 0029.
 *
 * Pure, total and deterministic (`04-game-design.md` §7.4): same activity + same
 * `rulesVersion` ⇒ same skills, always, no clock, no RNG. Replay soundness depends on it —
 * a recomputation that selected different skills than the original run would rewrite history
 * rather than reproduce it.
 *
 * The registry is an ARGUMENT, never a module-level import of the YAML. A recomputation runs
 * against the `rulesVersion` the activity was scored under, which may not be the current one.
 */

import type { Activity } from "@/src/domain/activity"

import type { RuleSkill } from "./schema"

/** The subset of an `Activity` the matcher reads. Nothing else influences selection. */
export interface MatchableActivity {
  kind: Activity["kind"]
  hasTrace: boolean
  source: { source: string }
}

function matches(skill: RuleSkill, activity: MatchableActivity): boolean {
  if (skill.kind !== "activity" || !skill.enabled) return false

  const m = skill.match
  // A `kind: activity` row without a match block cannot select anything. The validator makes
  // this unreachable in a seeded ruleset; treated as "matches nothing" rather than thrown so
  // the matcher stays total for a hand-built registry in a test.
  if (!m) return false

  // Empty or absent `kinds` means ANY — not none. Getting this backwards would silently stop
  // every skill matching, and every test using a fully-specified fixture would still pass.
  if (m.kinds && m.kinds.length > 0 && !m.kinds.includes(activity.kind)) return false

  if (m.requiresTrace !== "any" && m.requiresTrace !== activity.hasTrace) return false

  if (m.sources !== "any" && !m.sources.includes(activity.source.source)) return false

  return true
}

/**
 * Which activity skills does this activity train? **One per distinct `measure`.**
 *
 * The one-per-measure grouping is the part that is easy to get wrong and hard to notice: it is
 * what lets a single strength session train Might AND Fortitude — two different measures, reps
 * of `pushup` and reps of `situp` — while a run trains exactly one distance skill. Returning a
 * flat "best match" would silently halve strength scoring, and every single-skill test would
 * still pass.
 *
 * Returned in `measure` order so the output is stable for snapshotting and for the ledger's
 * `seq`; within a measure, ties at equal `matchPriority` break on `skillId` ASCENDING.
 */
export function selectActivitySkills(
  activity: MatchableActivity,
  registry: { skills: RuleSkill[] },
): RuleSkill[] {
  return [...candidatesByMeasure(activity, registry).entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, group]) => {
      // Sort rather than scan for a maximum: an explicit total order makes the tie-break a
      // property of the code, not of the input's order in the YAML file.
      const [winner] = [...group].sort((x, y) => {
        const byPriority = (y.matchPriority ?? 0) - (x.matchPriority ?? 0)
        if (byPriority !== 0) return byPriority
        return x.id < y.id ? -1 : x.id > y.id ? 1 : 0
      })
      return winner!
    })
}

/**
 * Every matching skill, grouped by `measure`, BEFORE the tie-break picks a winner.
 *
 * Exported for the seed-time ambiguity check (`02` §3.8 check 3) and for nothing else.
 * `selectActivitySkills` cannot serve that check: by the time it returns, the tie-break has
 * already resolved the ambiguity into a single plausible-looking answer — which is exactly
 * the situation the check exists to prevent from reaching the table. The first version of
 * that check inspected the winners and found nothing.
 */
export function candidatesByMeasure(
  activity: MatchableActivity,
  registry: { skills: RuleSkill[] },
): Map<string, RuleSkill[]> {
  const byMeasure = new Map<string, RuleSkill[]>()

  for (const skill of registry.skills) {
    if (!matches(skill, activity)) continue
    const measure = skill.match!.measure
    const group = byMeasure.get(measure)
    if (group) group.push(skill)
    else byMeasure.set(measure, [skill])
  }

  return byMeasure
}
