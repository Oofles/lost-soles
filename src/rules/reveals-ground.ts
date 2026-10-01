import { measureUnits, type ScorableActivity } from "@/src/scoring/units"

import { selectActivitySkills } from "./select-activity-skills"
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
 *
 * ─── TOO SHORT TO COUNT: `minUnitsForCredit` (ticket `0232`, D-269) ────────
 *
 * A revealing row opens the map only if the activity carries at least the row's
 * `minUnitsForCredit` of its measure — 0.25 km on the distance rows. `04` §3.5: a sub-250 m
 * run is almost always a mis-started recording, and a reveal cannot be taken back. It
 * **gates discovery, not XP**: the activity's own row still pays in full, because that
 * reading of the field lives here and nowhere in scoring.
 *
 * The gate sits on the REVEAL, not on Cartography, on purpose. Writing the cells and then
 * zeroing the award would spend their discovery value for nothing — they would no longer be
 * `new` when a real run covered them. Refuse the reveal and Cartography follows, because
 * the award is empty. Ingest, the XP replay and T3 repair all ask this one function, so
 * none of them can reveal or credit what another refused.
 *
 * This is why the input is a `ScorableActivity` and not the matcher's `MatchableActivity`.
 * The matcher's narrowing still holds — distance never influences WHICH skills match — but
 * whether the matched row's threshold is met is a question about the work done.
 * On a `revealsGround: false` row the threshold is never read (D-269).
 */
export function revealsGround(
  activity: ScorableActivity,
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
    return skill.revealsGround && measureUnits(activity, skill.match!.measure) >= skill.minUnitsForCredit
  })
}
