import { knownKinds } from "@/src/rules/known-kinds"
import type { RuleSkill } from "@/src/rules/schema"

/**
 * THE RUN PAGE'S KIND, AS WORDS. Ticket `0244`. Pure: the component renders these strings and
 * branches on nothing a kind is.
 *
 * No `switch` on a kind anywhere (D-031): the choices are `knownKinds` over the user's ruleset,
 * and a kind's label is the kind with its first letter raised. A new kind in the YAML is a new
 * choice here with no diff.
 */

/** What `Activity` carries about its kind. `derivedKind` is absent on rows written before `0243`. */
export interface ActivityKindRow {
  kind: string
  derivedKind?: string | null
  kindOverride?: { kind: string } | null
}

export const kindLabel = (kind: string): string => (kind ? kind[0]!.toUpperCase() + kind.slice(1) : kind)

/** The kinds a user may choose: every kind an enabled activity row matches on, alphabetical. */
export function kindChoices(registry: { skills: readonly RuleSkill[] }): string[] {
  return [...knownKinds(registry)].sort()
}

/**
 * The kind it replaced, or `null`. Only when an override exists AND moved the kind: an override
 * set back to the derived kind leaves a non-null mirror (`0243`'s note), and "Run (was Run)" would
 * be noise.
 */
export function wasKind(row: ActivityKindRow): string | null {
  if (!row.kindOverride) return null
  const derived = row.derivedKind ?? row.kind
  return derived !== row.kind ? derived : null
}

export interface KindChangeResult {
  outcome: string
  kind: string
  gained: readonly { skillId: string; xp: number }[]
  retained: readonly { skillId: string; xp: number }[]
  cellsRevealed: number
}

/**
 * The plain-words report criterion 4 asks for: what each skill gained, or that nothing moved
 * because XP never goes down (D-135). A retained skill is named, so a run corrected to a walk
 * says why its Athletics did not fall.
 */
export function kindChangeLine(r: KindChangeResult, skillName: (id: string) => string): string {
  const now = kindLabel(r.kind)
  if (r.outcome === "unchanged") return `Already ${now}. Nothing changed.`
  const parts: string[] = [`Now ${now}.`]
  if (r.gained.length > 0) {
    parts.push(r.gained.map((g) => `+${g.xp.toLocaleString("en-US")} ${skillName(g.skillId)} XP`).join(", ") + ".")
  } else {
    parts.push("No XP changed: no skill earns more from it as a " + r.kind + ", and XP never goes down.")
  }
  if (r.retained.length > 0) {
    const kept = r.retained.map((f) => `${skillName(f.skillId)} keeps the ${f.xp.toLocaleString("en-US")} XP it had from this`).join(", ")
    parts.push(`${kept[0]!.toUpperCase()}${kept.slice(1)}; XP never goes down.`)
  }
  if (r.cellsRevealed > 0) parts.push(`${r.cellsRevealed.toLocaleString("en-US")} cells of map revealed.`)
  return parts.join(" ")
}
