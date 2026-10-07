/**
 * THE PANEL IN YEAR TEN. Ticket 0075, `06-ui-ux.md` §5.3.
 *
 * The newest bundled ruleset grown to fifteen enabled skills, the way the registry grows: rows
 * appended after the highest `displayOrder`, as a new version, and nothing existing touched.
 * Five more activity skills and one more meta, so both sections lengthen and no new one appears.
 *
 * TEST-ONLY. Never written to `rules/`. Each added row is a copy of an existing row of the same
 * kind with a new id and name: the panel reads `id`, `name`, `kind`, `enabled` and
 * `displayOrder`, and the rest only has to be a valid row. The names are long on purpose, so the
 * narrow-window checks are made against the worst a real name is likely to be.
 */

import { BUNDLED_RULES } from "@/rules/xp-rules.bundled"
import type { RuleSet, RuleSkill } from "@/src/rules/schema"

export const BASE_RULES = BUNDLED_RULES[Math.max(...Object.keys(BUNDLED_RULES).map(Number))] as RuleSet

const ADDED: readonly { id: string; name: string; kind: RuleSkill["kind"] }[] = [
  { id: "yr10-swim", name: "Mountaineering", kind: "activity" },
  { id: "yr10-row", name: "Oarsmanship", kind: "activity" },
  { id: "yr10-climb", name: "Escalade", kind: "activity" },
  { id: "yr10-ski", name: "Snowcraft", kind: "activity" },
  { id: "yr10-skate", name: "Gliding", kind: "activity" },
  { id: "yr10-meta", name: "Steadfastness", kind: "meta" },
]

/** `base` plus `rows`, appended in order as the next ruleset version (§5.3 rule 2). */
export function appendSkills(base: RuleSet, rows: readonly { id: string; name: string; kind: RuleSkill["kind"] }[]): RuleSet {
  const version = base.version + 1
  let order = Math.max(...base.skills.map((s) => s.displayOrder))
  const added = rows.map((r): RuleSkill => {
    const template = base.skills.find((s) => s.kind === r.kind && s.enabled)!
    order += 10
    return { ...structuredClone(template), id: r.id, name: r.name, introducedIn: version, displayOrder: order }
  })
  return { ...structuredClone(base), version, skills: [...structuredClone(base.skills), ...added] }
}

export const FIFTEEN = appendSkills(BASE_RULES, ADDED)
