/**
 * A WORKOUT TYPE NOTHING IN THE CODEBASE HAS EVER HEARD OF. Ticket 0072, I-24, D-031.
 *
 * Pull-ups, arriving exactly as `06-ui-ux.md` §6.5 says a new type arrives:
 *
 * 1. a row in the registry, shipped the only way a registry row CAN ship once rule versions are
 *    immutable (D-282), as a new bundled version: the newest ruleset plus one row;
 * 2. one sigil in `rules/sigils.json`;
 * 3. nothing else.
 *
 * TEST-ONLY. It is never written to `rules/`, and `new-workout-type.test.tsx` asserts that no
 * production ruleset or sigil set carries it. The ids below are also fed to the I-25 grep
 * (`no-skill-names.test.ts`), so the day a source file names this skill, the build fails.
 *
 * The skill is called Ascent and its exercise Pull-ups, so a test can tell the tile's name from
 * the row's label: they are two registry fields, and a component that conflated them would pass
 * a fixture where the two strings were equal.
 */

import type { RuleSet, RuleSkill } from "@/src/rules/schema"

export const NEW_SKILL_ID = "pullup"
export const NEW_EXERCISE_ID = "pullup"
/** For the I-25 grep: every id this fixture introduces. */
export const NEW_IDS: readonly string[] = [NEW_SKILL_ID, NEW_EXERCISE_ID]

/** The row, minus the two fields that depend on the ruleset it joins. */
const ROW: Omit<RuleSkill, "introducedIn" | "displayOrder"> = {
  id: NEW_SKILL_ID,
  name: "Ascent",
  kind: "activity",
  enabled: true,
  logMode: "reps",
  unit: "rep",
  match: { kinds: ["strength", "other"], requiresTrace: "any", sources: "any", measure: `reps:${NEW_EXERCISE_ID}` },
  matchPriority: 100,
  xpPerUnit: 6,
  softCapUnits: 60,
  sanityCeilingUnits: 400,
  minUnitsForCredit: 1,
  groundMultipliers: null,
  revealsGround: false,
  feeds: [{ skill: "constitution", rate: 0.3333 }],
  exercises: [{ id: NEW_EXERCISE_ID, label: "Pull-ups", entry: "count", quickValues: [5, 8, 10, 15] }],
}

/** Monoline, on the 24-unit box: a bar and a figure hanging from it. */
export const NEW_SIGIL: readonly string[] = ["M3 4 L21 4", "M8 4 L8 9 L12 12 L16 9 L16 4", "M12 12 L12 20", "M9 20 L15 20"]

/**
 * `base` plus the new row, as the next ruleset version. Appended: the highest `displayOrder`
 * in the file plus ten, because §5.3 rule 2 says new skills append and existing skills never move.
 */
export function withNewWorkoutType(base: RuleSet): RuleSet {
  const version = base.version + 1
  const displayOrder = Math.max(...base.skills.map((s) => s.displayOrder)) + 10
  return {
    ...structuredClone(base),
    version,
    skills: [...structuredClone(base.skills), { ...structuredClone(ROW), introducedIn: version, displayOrder }],
  }
}
