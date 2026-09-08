import type { Activity } from "@/src/domain/activity"

import { selectActivitySkills, type MatchableActivity } from "./select-activity-skills"
import type { RuleSkill } from "./schema"

/**
 * DOES THIS ACTIVITY OPEN THE MAP? D-189, `02-data-model.md` §3 `revealsGround`,
 * ticket `0047`.
 *
 * The one question that must be asked before a single `ExploredCell` is written, and the
 * one whose wrong answer is permanent: the map never re-fogs (D-020), so a cell revealed
 * by a ride is revealed forever and there is no operation that takes it back.
 *
 * **It is a data lookup, never a `switch` on `ActivityKind`** (D-031/D-141). A road ride
 * has a real trace and real geometry and must write none of it; the thing that says so is
 * a column on the matched skill row, not a branch in this file.
 * `src/rules/no-skill-names.test.ts` fires on any code that names a skill, which is what
 * keeps that honest — the answer here is whatever the YAML says, and today the YAML says
 * exactly one activity row is `true`.
 *
 * ─── WHY `some`, AND NOT "the first skill" ──────────────────────────────────
 *
 * `selectActivitySkills` returns one winner per `measure` — that is what lets one strength
 * session train two skills. An activity therefore has a *set* of skills, and the question
 * "does this reveal ground" is a property of the activity, not of one row in that set. If
 * any matched skill says the map opens, it opens. Today no activity matches two rows with
 * disagreeing values, and if one ever does, revealing is the answer that matches the
 * user's experience: they were there.
 *
 * ─── NO DEFAULT, AND A THROW RATHER THAN A GUESS ────────────────────────────
 *
 * D-189 is explicit that the field is **required on every `kind: activity` row with
 * deliberately no default**, because a cell revealed by an omitted line is permanent. A
 * `null` reaching here means a ruleset the validator should have rejected, and both
 * silent readings are wrong in the same way — `false` means the map quietly stops filling,
 * `true` means D-189 never happened. So it throws, and the ingest fails loudly onto a
 * queue that will retry it once the ruleset is fixed.
 */
export function revealsGround(
  activity: MatchableActivity,
  registry: { skills: RuleSkill[] },
): boolean {
  const matched = selectActivitySkills(activity, registry)

  return matched.some((skill) => {
    if (skill.revealsGround === null || skill.revealsGround === undefined) {
      throw new Error(
        `D-189: skill "${skill.id}" matched an activity but carries no revealsGround. ` +
          "The field is required on every activity row and has no default — a cell " +
          "revealed by an omitted line is permanent (D-020).",
      )
    }
    return skill.revealsGround
  })
}

/**
 * The three fields the matcher reads, lifted off a full `Activity`.
 *
 * A named function rather than an inline object literal at the call site, because the
 * matcher's input is deliberately narrow (`MatchableActivity`) and the narrowing is a
 * statement: nothing about distance, duration or elevation may influence which skills an
 * activity trains, and a structural type would let a caller widen it by accident.
 */
export function matchable(activity: Activity): MatchableActivity {
  return {
    kind: activity.kind,
    hasTrace: activity.hasTrace,
    source: { source: activity.source.source },
  }
}
