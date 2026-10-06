/**
 * THE `NEXT` CARD'S ONE LINE. Ticket 0073, `06-ui-ux.md` §5.2, `04-game-design.md` §4.1.
 *
 * `~9 runs to Wayfaring 48` — "nine runs away" reads as a plan where a 1.8% bar reads as nothing.
 * The estimate is the XP still needed over that skill's own TRAILING MEDIAN SESSION (§5.5), so
 * it is honest and improves as you do.
 *
 * WHICH SKILL (operator, 2026-10-06, D-283): the trained activity skill fewest sessions away from
 * its next level; ties go to registry order. A skill with no session history has no honest
 * estimate and is skipped; with none at all there is no line, and the card is not drawn.
 *
 * THE NOUN comes from `logMode`, never a skill id (I-25): a `trace` skill is counted in runs,
 * anything hand-logged in sessions.
 *
 * Exactly one line, never a list — this returns a string, not an array, so it cannot grow into
 * one.
 */

import type { RuleSet } from "@/src/rules/schema"

import type { SkillTile } from "./panel"

/** How many recent sessions the median is taken over. */
export const TRAILING_SESSIONS = 10

/** One `XpLedgerEntry`, as much of it as the line needs. Read from `byUserAndSeq` (GSI2). */
export interface SkillLedgerRow {
  skillId: string
  activityId: string
  xpAwarded: number
  xpRulesVersion: number
  isFloor: boolean
  /** `<startedAt>#<activityId>#<nn>` — activity time, so newest-first is a string sort. */
  seq: string
}

/**
 * One skill's recent sessions, newest first: the XP each ACTIVITY earned it, summed across reasons
 * (`recent_ground` + `familiar_ground` is one run). Floor rows, replay markers and other ruleset
 * versions are not sessions.
 */
export function recentSessions(skillId: string, rows: readonly SkillLedgerRow[], version: number): number[] {
  const byActivity = new Map<string, { xp: number; seq: string }>()
  for (const r of rows) {
    if (r.skillId !== skillId || r.isFloor || r.xpRulesVersion !== version) continue
    if (r.activityId.startsWith("__")) continue // `__floor__`, `__replay__`: bookkeeping, not effort
    const s = byActivity.get(r.activityId) ?? { xp: 0, seq: r.seq }
    s.xp += r.xpAwarded
    if (r.seq > s.seq) s.seq = r.seq
    byActivity.set(r.activityId, s)
  }
  return [...byActivity.values()]
    .filter((s) => s.xp > 0)
    .sort((a, b) => (a.seq < b.seq ? 1 : a.seq > b.seq ? -1 : 0))
    .slice(0, TRAILING_SESSIONS)
    .map((s) => s.xp)
}

export function median(values: readonly number[]): number {
  const v = [...values].sort((a, b) => a - b)
  const mid = v.length >> 1
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2
}

/** The line, or `null` when no skill has an honest estimate. */
export function nextLine(
  rules: RuleSet,
  activity: readonly SkillTile[],
  sessions: Readonly<Record<string, readonly number[]>>,
): string | null {
  const mode = new Map(rules.skills.map((s) => [s.id, s.logMode]))
  let best: { runs: number; tile: SkillTile } | undefined
  for (const tile of activity) {
    const recent = sessions[tile.skillId] ?? []
    if (recent.length === 0 || tile.xpToNext <= 0) continue
    const runs = Math.max(1, Math.ceil(tile.xpToNext / median(recent)))
    if (!best || runs < best.runs) best = { runs, tile }
  }
  if (!best) return null
  const noun = mode.get(best.tile.skillId) === "trace" ? "run" : "session"
  return `~${best.runs} ${noun}${best.runs === 1 ? "" : "s"} to ${best.tile.name} ${best.tile.level + 1}`
}
