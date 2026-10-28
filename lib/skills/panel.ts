/**
 * THE SKILLS PANEL, AS DATA. Ticket 0073, `06-ui-ux.md` §5.2–5.3.
 *
 * `skillsPanel(rules, standing)` is everything `/skills` draws, computed from the registry and the
 * cached `SkillState` — no component decides a level, a section or an order. No skill id appears
 * here (I-25): a tile is a registry row, so a new YAML row is a new tile.
 *
 * - **Sections** (§5.3 rule 1): `kind: activity` → `ACTIVITY`, `kind: meta` → `META`, and any
 *   enabled skill with zero lifetime XP → `Untrained` (rule 3), whatever its kind.
 * - **Registry order, forever** (rule 2): `displayOrder`, never level, recency or frequency.
 * - **Total Level** sums the DISPLAYED level of every enabled skill, meta included and untrained
 *   counting 1 — the same `max(level, levelHighWater)` the replay writes to `Profile.totalLevel`
 *   (`src/pipeline/xp-replay.ts` step 6), so the home plinth and this header cannot disagree.
 */

import type { CachedSkill } from "@/lib/log/optimistic"
import type { RuleSet, RuleSkill } from "@/src/rules/schema"
import { levelProgress, totalLevelCeiling, totalLevelRung, type Rung } from "@/src/scoring/levels"

export interface SkillTile {
  skillId: string
  name: string
  kind: RuleSkill["kind"]
  xp: number
  level: number
  /** 0..1 toward `level + 1` (§5.2's 3dp bar). */
  fraction: number
  xpToNext: number
  /**
   * `0324`. The tile's accessible name, and the quick-view row's (06 §9.4): `Wayfaring, level 47,
   * 88 percent to 48, activity skill`, or `…, level 99, maximum level, activity skill` at the curve's
   * cap. Built here, once, so `/skills` and the home quick-view cannot disagree. See `skillLabel`.
   */
  label: string
}

/**
 * `0324`. 06 §9.4's announcement. The percent is FLOORED from the same `fraction` the bar draws, so
 * speech never claims "100 percent to 48" while the skill is still 47 — and at the cap, where no next
 * level exists, it says so instead of "100 percent to 100" (the tile there is a full bar and nothing
 * else). No XP: the quick-view's rule is level and progress only. The kind stays, last (`0077`): an
 * Untrained tile sits outside the `ACTIVITY`/`META` regions, so its name is the only place the
 * distinction reaches assistive technology without colour.
 */
export function skillLabel(tile: Pick<SkillTile, "name" | "kind" | "level" | "fraction">, maxLevel: number): string {
  const progress =
    tile.level >= maxLevel
      ? "maximum level"
      : `${Math.floor(Math.min(Math.max(tile.fraction, 0), 1) * 100)} percent to ${tile.level + 1}`
  return `${tile.name}, level ${tile.level}, ${progress}, ${tile.kind} skill`
}

export interface SkillsPanelModel {
  totalLevel: number
  totalXp: number
  ceiling: number
  /** The header bar: from the last Total Level milestone passed to the next (04 §4.3). */
  rung: Rung
  activity: SkillTile[]
  meta: SkillTile[]
  untrained: SkillTile[]
}

export function skillsPanel(rules: RuleSet, standing: readonly CachedSkill[]): SkillsPanelModel {
  const bySkill = new Map(standing.map((s) => [s.skillId, s]))
  const enabled = rules.skills.filter((s) => s.enabled).sort((a, b) => a.displayOrder - b.displayOrder)

  const tiles = enabled.map((skill): SkillTile => {
    const held = bySkill.get(skill.id)
    const xp = held?.xp ?? 0
    const p = levelProgress(xp, rules.curve, held?.levelHighWater ?? 1)
    const tile = { skillId: skill.id, name: skill.name, kind: skill.kind, xp, level: p.level, fraction: p.fraction, xpToNext: p.xpToNext }
    return { ...tile, label: skillLabel(tile, rules.curve.maxLevel) }
  })

  // Lifetime XP, and nothing else (0075): a row added last week and a row ignored for five years
  // are the same thing here. XP never decreases (D-135), so leaving this group is permanent.
  const trained = (t: SkillTile) => t.xp > 0
  const totalLevel = tiles.reduce((sum, t) => sum + t.level, 0)
  const ceiling = totalLevelCeiling(rules.skills, rules.curve)

  return {
    totalLevel,
    totalXp: tiles.reduce((sum, t) => sum + t.xp, 0),
    ceiling,
    rung: totalLevelRung(totalLevel, ceiling),
    activity: tiles.filter((t) => trained(t) && t.kind === "activity"),
    meta: tiles.filter((t) => trained(t) && t.kind === "meta"),
    untrained: tiles.filter((t) => !trained(t)),
  }
}
