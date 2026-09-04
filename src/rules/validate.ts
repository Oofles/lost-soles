/**
 * The rules-file validator. `02-data-model.md` §3.8 requires this to run **in CI and again
 * in the seeder**, failing the build on any violation — which is why it is TypeScript here
 * rather than a plain-node script under `scripts/`: the seeder is Amplify TypeScript, and a
 * check written twice is a check that will disagree with itself.
 *
 * This ticket (0028) implements §3.8 checks **1 and 2** plus the structural rejections in
 * its own criterion 6. Checks 3 and 4 (totality, determinism) need the matcher and belong
 * to `0029`; check 5 (the D-132 regression) to `0030`; check 6 (the skill-name grep) is
 * `no-skill-names.test.ts` alongside this file.
 *
 * `0029` extends this validator with the ambiguity check — two rows at equal
 * `matchPriority` and equal `measure` — so failures accumulate rather than short-circuit,
 * and every one names the rows involved.
 *
 * Ticket 0028.
 */

import { runWithPurityTraps } from "@/src/purity/traps"

import {
  candidatesByMeasure,
  selectActivitySkills,
  type MatchableActivity,
} from "./select-activity-skills"
import {
  ACTIVITY_KINDS,
  FIXED_MEASURES,
  LOG_MODES,
  MEASURE_PREFIXES,
  type RuleSet,
  type RuleSkill,
} from "./schema"

export interface RuleError {
  /** Dotted path to the offending value, e.g. `skills[1].match.kinds[0]`. */
  path: string
  message: string
}

export class RuleValidationError extends Error {
  readonly errors: RuleError[]

  constructor(errors: RuleError[]) {
    super(
      `rules file failed validation (${errors.length} error(s)):\n` +
        errors.map((e) => `  ${e.path}: ${e.message}`).join("\n"),
    )
    this.name = "RuleValidationError"
    this.errors = errors
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * A source id shape, not a source id ALLOWLIST — and the distinction is D-100.
 *
 * `SourceId` is deliberately open (`| (string & {})`) so that adding a source never edits
 * the domain. Validating against the enumerated members would reintroduce exactly the edit
 * that widening exists to avoid: `sources: [garmin]` is a perfectly valid `SourceId` today,
 * and a validator that rejected it would make adding a source a code change.
 *
 * `kinds` is the opposite case and IS enumerated, because `ActivityKind` is closed.
 */
const SOURCE_ID_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/

function isMeasure(v: unknown): boolean {
  if (typeof v !== "string") return false
  if ((FIXED_MEASURES as readonly string[]).includes(v)) return true
  return MEASURE_PREFIXES.some((p) => v.startsWith(p) && v.length > p.length)
}

function validateMatch(skill: RuleSkill, i: number, errs: RuleError[]): void {
  const at = `skills[${i}].match`
  const m = skill.match

  if (skill.kind === "meta") {
    // Meta skills are NEVER matched — they arrive via `feeds` and via the fog subsystem's
    // derived award (02 §3.4). A match block on one is dead config that reads as intent.
    if (m !== null && m !== undefined) {
      errs.push({ path: at, message: "must be null on a `kind: meta` row" })
    }
    return
  }

  if (!isObject(m)) {
    errs.push({ path: at, message: "every `kind: activity` row requires a match block (D-141)" })
    return
  }

  if (m.kinds !== undefined && m.kinds !== null) {
    if (!Array.isArray(m.kinds)) {
      errs.push({ path: `${at}.kinds`, message: "must be an array of ActivityKind, or absent for any" })
    } else {
      m.kinds.forEach((k, j) => {
        if (!(ACTIVITY_KINDS as readonly string[]).includes(k as string)) {
          errs.push({
            path: `${at}.kinds[${j}]`,
            message: `${JSON.stringify(k)} is not an ActivityKind (${ACTIVITY_KINDS.join(", ")})`,
          })
        }
      })
    }
  }

  if (!(m.requiresTrace === true || m.requiresTrace === false || m.requiresTrace === "any")) {
    errs.push({
      path: `${at}.requiresTrace`,
      message: `must be true, false or "any" — got ${JSON.stringify(m.requiresTrace)}`,
    })
  }

  if (m.sources !== "any") {
    if (!Array.isArray(m.sources)) {
      errs.push({ path: `${at}.sources`, message: 'must be "any" or an array of source ids' })
    } else {
      m.sources.forEach((s, j) => {
        if (typeof s !== "string" || !SOURCE_ID_SHAPE.test(s)) {
          errs.push({
            path: `${at}.sources[${j}]`,
            message:
              `${JSON.stringify(s)} is not a source id. Expected lower-kebab-case. ` +
              "Note the enumerated SourceId members are NOT enforced: the union is open " +
              "(D-100) so that adding a source never edits code.",
          })
        }
      })
    }
  }

  if (!isMeasure(m.measure)) {
    errs.push({
      path: `${at}.measure`,
      message:
        `${JSON.stringify(m.measure)} is not a measure. Expected one of ` +
        `${FIXED_MEASURES.join(", ")}, or a ${MEASURE_PREFIXES.join("/")}<exerciseId> form ` +
        "(02 §3.7 — the extractor set is closed; a new one is a new logMode kernel, i.e. code).",
    })
  }

  if (typeof skill.matchPriority !== "number") {
    errs.push({
      path: `skills[${i}].matchPriority`,
      message: "every `kind: activity` row requires a numeric matchPriority",
    })
  }
}

/**
 * D-189 — `revealsGround` is required on every activity row, and forbidden on meta rows.
 *
 * Required rather than defaulted, deliberately. A default would make "opens the map" the
 * silent consequence of forgetting a line, and the map NEVER RE-FOGS (D-020) — a cell
 * revealed by an omission is revealed for ever. Whichever way the default fell it would be
 * wrong for half the rows, so the file must say.
 */
function validateRevealsGround(skill: RuleSkill, i: number, errs: RuleError[]): void {
  const at = `skills[${i}].revealsGround`
  const v = skill.revealsGround

  if (skill.kind === "meta") {
    if (v !== null && v !== undefined) {
      errs.push({ path: at, message: "must be null on a `kind: meta` row — meta skills never match" })
    }
    return
  }

  if (typeof v !== "boolean") {
    errs.push({
      path: at,
      message:
        "required on every `kind: activity` row: true or false. There is no default, because " +
        "the map never re-fogs (D-020) and a cell revealed by an omitted line is permanent.",
    })
  }
}

/** §3.8 check 2 — `feeds` has no cycles. Constitution feeds nothing (04 §1.1). */
function findFeedCycle(skills: RuleSkill[]): string[] | null {
  const byId = new Map(skills.map((s) => [s.id, s]))
  const state = new Map<string, "open" | "done">()
  const stack: string[] = []

  function walk(id: string): string[] | null {
    if (state.get(id) === "done") return null
    if (state.get(id) === "open") return [...stack.slice(stack.indexOf(id)), id]

    state.set(id, "open")
    stack.push(id)
    for (const f of byId.get(id)?.feeds ?? []) {
      if (!byId.has(f.skill)) continue // reported separately by check 1
      const cycle = walk(f.skill)
      if (cycle) return cycle
    }
    stack.pop()
    state.set(id, "done")
    return null
  }

  for (const s of skills) {
    const cycle = walk(s.id)
    if (cycle) return cycle
  }
  return null
}


/**
 * §3.8 CHECK 3 — TOTALITY, and §3.8 CHECK 4 — DETERMINISM. Ticket 0029.
 *
 * These fire at SEED TIME, not run time (invariant I-26): an ambiguous ruleset is a deploy
 * failure, not a 6am-Sunday failure. A ruleset that cannot be scored unambiguously must never
 * reach the table, because by the time it does the only symptom is XP quietly landing in the
 * wrong skill — and D-135 says XP never decreases, so the correction can only add.
 *
 * The grid is GENERATED from `ACTIVITY_KINDS` rather than hand-listed, so adding a kind to the
 * domain automatically widens the check instead of silently leaving a hole.
 */
function validateSelection(ruleSet: RuleSet, errs: RuleError[]): void {
  for (const kind of ACTIVITY_KINDS) {
    for (const hasTrace of [true, false]) {
      const activity: MatchableActivity = {
        kind,
        hasTrace,
        // A source that is deliberately NOT in any row's `sources` allowlist. Every row in a
        // sane ruleset uses `sources: any`, so this must not change the answer — and if some
        // row does narrow by source, the grid should exercise the general case, not a
        // privileged one.
        source: { source: "any-source" },
      }

      // CHECK 4 — the matcher runs with the clock and RNG stubbed to throw, mirroring the
      // contract §5 purity check on normalize(). Same trap definition, deliberately: two
      // implementations of "pure" would eventually trap different things.
      const selected = runWithPurityTraps(
        "selectActivitySkills()",
        "  04-game-design.md §7.4 — replay soundness. A recomputation must select the SAME\n" +
          "  skills as the original run, or it rewrites history instead of reproducing it.\n" +
          "  Reading a clock or an RNG makes the answer depend on WHEN it ran.",
        () => selectActivitySkills(activity, ruleSet),
      )

      // CHECK 3a — never two skills for one measure AT EQUAL PRIORITY.
      //
      // Inspects the CANDIDATES, not the matcher's return value. `selectActivitySkills` has
      // already applied the tie-break by then and returns one confident-looking answer — so
      // the first version of this check, which read the winners, found nothing. Ambiguity is
      // only visible before it is resolved.
      //
      // Unequal priorities are fine: that is what `matchPriority` is FOR. Only a tie is a
      // defect, because then which skill scores depends on alphabetical order rather than on
      // anyone's intent.
      for (const [measure, group] of candidatesByMeasure(activity, ruleSet)) {
        const top = Math.max(...group.map((s) => s.matchPriority ?? 0))
        const ids = group.filter((s) => (s.matchPriority ?? 0) === top).map((s) => s.id).sort()
        if (ids.length > 1) {
          errs.push({
            path: `selection[${kind}/hasTrace=${hasTrace}]`,
            message:
              `ambiguous: ${ids.join(" and ")} match measure ${JSON.stringify(measure)} at the ` +
              `same matchPriority (${top}). Which one scores would depend on alphabetical order. ` +
              "Give one a higher matchPriority, or narrow a match block so they are mutually " +
              "exclusive — as requiresTrace does for the running and cycling pairs.",
          })
        }
      }

      // CHECK 3b — never ZERO distance skills for a kind that can carry distance.
      //
      // NARROWED, deliberately, and this is a real divergence from §3.8's wording (D-190).
      // §3.8 says zero matches for measurable work fails the build. Taken literally that
      // includes `other` WITH a trace — and no distance skill claims `other`, on purpose:
      // §3.7 says an open-water swim gets its own row when someone adds it. `other` is the
      // catch-all kind, so requiring a skill for it means requiring a skill for every activity
      // nobody has classified yet, which is not a property any ruleset can hold.
      //
      // So: strict for the five KNOWN kinds, exempt for `other`. The exemption is named here
      // rather than achieved by weakening the rule, because a check that silently tolerates a
      // gap is the check that stops finding them.
      if (kind !== "other" && !DISTANCELESS_KINDS.includes(kind)) {
        const distanceSkills = selected.filter((s) => s.match!.measure === "distanceKm")
        if (distanceSkills.length === 0) {
          errs.push({
            path: `selection[${kind}/hasTrace=${hasTrace}]`,
            message:
              `no skill measures distance for a ${kind} with hasTrace=${hasTrace}. ` +
              "Real distance would be recorded and score nothing. Widen a match block's " +
              "`kinds`, or flip its `requiresTrace`.",
          })
        }
      }
    }
  }
}

/** Kinds that carry no distance by nature, so a distance skill for them would be the bug. */
const DISTANCELESS_KINDS: readonly string[] = ["strength"]

/**
 * Validate a parsed rules file. Returns EVERY error rather than the first: a rules file
 * with three mistakes should take one edit to fix, not three build cycles.
 */
export function validateRuleSet(ruleSet: unknown): RuleError[] {
  const errs: RuleError[] = []

  if (!isObject(ruleSet)) {
    return [{ path: "", message: "rules file must parse to an object" }]
  }
  if (!Array.isArray(ruleSet.skills)) {
    return [{ path: "skills", message: "must be an array" }]
  }
  if (!isObject(ruleSet.curve)) {
    errs.push({ path: "curve", message: "one RuleCurve entry is required (D-130/D-131)" })
  }

  const skills = ruleSet.skills as RuleSkill[]

  // §3.8 check 1a — skillId unique within a version.
  const seen = new Map<string, number>()
  skills.forEach((s, i) => {
    if (typeof s?.id !== "string" || s.id.length === 0) {
      errs.push({ path: `skills[${i}].id`, message: "required, non-empty string" })
      return
    }
    const first = seen.get(s.id)
    if (first !== undefined) {
      errs.push({
        path: `skills[${i}].id`,
        message: `duplicate skillId ${JSON.stringify(s.id)} — already defined at skills[${first}]`,
      })
    } else {
      seen.set(s.id, i)
    }
  })

  skills.forEach((s, i) => {
    if (!isObject(s)) {
      errs.push({ path: `skills[${i}]`, message: "must be an object" })
      return
    }
    if (s.kind !== "activity" && s.kind !== "meta") {
      errs.push({ path: `skills[${i}].kind`, message: 'must be "activity" or "meta"' })
    }
    if (!(LOG_MODES as readonly string[]).includes(s.logMode)) {
      errs.push({
        path: `skills[${i}].logMode`,
        message: `${JSON.stringify(s.logMode)} is not a logMode (${LOG_MODES.join(", ")})`,
      })
    }
    validateMatch(s, i, errs)
    validateRevealsGround(s, i, errs)

    // §3.8 check 1b — feeds[].skill resolves to an existing `kind: meta` row.
    const feeds = s.feeds
    if (feeds !== undefined && !Array.isArray(feeds)) {
      errs.push({ path: `skills[${i}].feeds`, message: "must be an array" })
    } else {
      ;(feeds ?? []).forEach((f, j) => {
        const path = `skills[${i}].feeds[${j}].skill`
        const targetIndex = seen.get(f?.skill)
        if (targetIndex === undefined) {
          errs.push({ path, message: `${JSON.stringify(f?.skill)} does not resolve to any skill row` })
        } else if (skills[targetIndex]!.kind !== "meta") {
          errs.push({
            path,
            message: `${JSON.stringify(f.skill)} resolves to a \`kind: activity\` row — feeds may only target meta skills`,
          })
        }
        if (typeof f?.rate !== "number") {
          errs.push({
            path: `skills[${i}].feeds[${j}].rate`,
            message: "required — a share is an attribute of the feeder row, never a constant in code",
          })
        }
      })
    }
  })

  // Selection checks run only once the shape is sound: the matcher reads `match.measure` and
  // would report noise on a ruleset that has not yet earned a coherent one.
  if (errs.length === 0) {
    validateSelection(ruleSet as unknown as RuleSet, errs)
  }

  const cycle = findFeedCycle(skills)
  if (cycle) {
    errs.push({
      path: "skills[].feeds",
      message: `feeds contain a cycle: ${cycle.join(" -> ")}. XP would propagate for ever.`,
    })
  }

  return errs
}

/** Throwing wrapper, for the seeder and for CI. */
export function assertValidRuleSet(ruleSet: unknown): asserts ruleSet is RuleSet {
  const errs = validateRuleSet(ruleSet)
  if (errs.length > 0) throw new RuleValidationError(errs)
}
