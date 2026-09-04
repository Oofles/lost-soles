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
