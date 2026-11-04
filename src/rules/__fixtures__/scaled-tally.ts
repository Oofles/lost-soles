/**
 * ONE MEASURE, MANY EXERCISES — the shape D-483 needs, before any shipped ruleset uses it.
 * Ticket 0341. TEST-ONLY: never written to `rules/`.
 *
 * The newest bundled ruleset with Might turned into a `seconds:` tally, which is how v5
 * (`0343`) ships it: strength minutes count once a second, and a pushup is 8 s of work, so at
 * 0.5 XP/s a pushup is still the 4 XP it was.
 */

import { loadRuleSet } from "@/src/rules/load"
import type { RuleSet } from "@/src/rules/schema"

export const TALLY_SKILL = "might"
export const TALLY_MEASURE = "seconds:might"
export const WORKOUT_EXERCISE = "tally-workout"

export function scaledTallyRuleSet(): RuleSet {
  const rules = structuredClone(loadRuleSet(4))
  const might = rules.skills.find((s) => s.id === TALLY_SKILL)!
  might.logMode = "duration"
  might.unit = "second"
  might.match = { ...might.match!, measure: TALLY_MEASURE }
  might.xpPerUnit = 0.5
  might.softCapUnits = 3600
  might.sanityCeilingUnits = 10800
  might.minUnitsForCredit = 8
  might.exercises = [
    { id: WORKOUT_EXERCISE, label: "Strength workout", entry: "minutes", quickValues: [30, 45, 60], scale: 1 },
    { id: "pushup", label: "Pushups", entry: "count", quickValues: [10, 20, 25, 50], scale: 8 },
  ]
  return rules
}
