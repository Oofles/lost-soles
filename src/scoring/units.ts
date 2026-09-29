/**
 * THE SCORER, LINE ONE — an activity to per-skill unit counts. Ticket 0060.
 *
 * `02-data-model.md` §3.1's J1 (selection) and J2 (measurement), and nothing after them.
 * Rating (`xpPerUnit`, soft caps, the degenerate-case floors of `04` §3.5), ground multipliers
 * (`0061`), propagation (`0064`) and the ledger (`0062`) each read what this returns.
 *
 * J1 is `selectActivitySkills`, built in `0029` and re-exported from this module rather than
 * reimplemented: two matchers is how selection starts meaning two things.
 *
 * J2 is `match.measure`, read as DATA. The skill id is carried through as an opaque string
 * and never inspected — `no-skill-names.test.ts` and this module's own test hold that line
 * (D-031, D-141, I-25). What IS dispatched on is the measure's kernel, which `02` §3.7 fixes
 * as a closed set: adding a skill over an existing measure is a YAML row, adding a measure is
 * code, and that asymmetry is meant to be loud.
 *
 * Pure, total over a validated ruleset, and deterministic (`04` §7.4): no clock, no RNG, the
 * registry an argument. A replay months later must count the same units the original did.
 */

import type { Activity } from "@/src/domain/activity"
import type { Measure, RuleSkill } from "@/src/rules/schema"
import { selectActivitySkills } from "@/src/rules/select-activity-skills"

/** The subset of an `Activity` the scorer reads: what the matcher reads, plus the work. */
export type ScorableActivity = Pick<Activity, "kind" | "hasTrace" | "source" | "distanceM" | "sets">

/** Raw work done for one skill, before any rating. `skillId` is opaque — never branched on. */
export interface SkillUnits {
  skillId: string
  measure: Measure
  units: number
}

/**
 * The J2 kernels a measure can name, keyed by the measure's kernel prefix. `02` §3.7's
 * `trace`, `reps` and `duration` kernels; `derived` (`cells`, `share`) is deliberately
 * absent, because those units come from another subsystem, never off the activity.
 */
const KERNELS: Record<string, (a: ScorableActivity, exercise: string) => number> = {
  distanceKm: (a) => (a.distanceM ?? 0) / 1000,
  reps: (a, exercise) => sumSets(a, exercise, (s) => s.reps),
  seconds: (a, exercise) => sumSets(a, exercise, (s) => s.durationS),
}

function sumSets(
  a: ScorableActivity,
  exercise: string,
  field: (s: Activity["sets"][number]) => number | undefined,
): number {
  let total = 0
  for (const set of a.sets) if (set.exercise === exercise) total += field(set) ?? 0
  return total
}

/**
 * How many units of `measure` this activity carries. `reps:pushup` → Σ pushup reps.
 *
 * Throws on a measure with no kernel here. A validated ruleset can only reach that with an
 * activity row naming a `derived` measure, and the right response is a loud failure, not a
 * zero that silently drops the skill.
 */
export function measureUnits(activity: ScorableActivity, measure: Measure): number {
  const colon = measure.indexOf(":")
  const kernel = colon === -1 ? measure : measure.slice(0, colon)
  const exercise = colon === -1 ? "" : measure.slice(colon + 1)

  const extract = KERNELS[kernel]
  if (!extract) {
    throw new Error(
      `measure ${JSON.stringify(measure)} has no extractor on an Activity. ` +
        "`cells` and `share` are derived by another subsystem (02 §3.7) and cannot be the " +
        "measure of an activity skill.",
    )
  }

  const units = extract(activity, exercise)
  // XP never decreases (D-135), so a corrupt count that reached the ledger could never be
  // taken back. Negative or non-finite input is an upstream bug and fails here, loudly.
  if (!Number.isFinite(units) || units < 0) {
    throw new Error(
      `measure ${JSON.stringify(measure)} produced ${units} units — a count must be finite ` +
        "and non-negative. The activity carries corrupt work; refusing to score it.",
    )
  }
  return units
}

/**
 * Which skills this activity trains, and how much of each: one entry per distinct measure,
 * in the matcher's measure order.
 *
 * **A skill whose measure is zero on this activity is DROPPED, not returned at `units: 0`.**
 * Selection groups by measure, not by what was actually logged, so a pushups-only session
 * still selects the situp and plank skills, and a treadmill run with no distance still selects
 * a distance skill. Returning those would put zero-XP rows into an append-only ledger for work
 * nobody did. Operator decision, 2026-09-28.
 */
export function scoreUnits(
  activity: ScorableActivity,
  registry: { skills: RuleSkill[] },
): SkillUnits[] {
  const out: SkillUnits[] = []
  for (const skill of selectActivitySkills(activity, registry)) {
    const measure = skill.match!.measure
    const units = measureUnits(activity, measure)
    if (units > 0) out.push({ skillId: skill.id, measure, units })
  }
  return out
}
