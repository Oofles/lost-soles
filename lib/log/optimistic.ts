/**
 * THE OPTIMISTIC RESULT A ROW SHOWS THE INSTANT IT IS CLICKED. Ticket 0068, `06` §6.4.
 *
 * `MIGHT 30 pushups · Might +120 → L31`: units, XP and the resulting level, rendered before the
 * write has left the browser — it is held for its undo window first (D-282), so waiting for the
 * server's answer would mean the row could not confirm anything for eight seconds.
 *
 * It is computed by THE SAME `scoreActivity` the server runs, under the same ruleset, on a
 * synthetic activity shaped like the one the manual adapter builds. So the number shown and the
 * number awarded can only differ where the server knows something this tab does not (another
 * device's log since the cache was filled). The server stays the authority (I-20): nothing
 * computed here is ever sent.
 */

import type { WorkoutEntry } from "@/lib/log/workout-entry"
import { entryActivityFields } from "@/lib/log/workout-entry"
import { BUNDLED_RULES } from "@/rules/xp-rules.bundled"
import type { RuleSet } from "@/src/rules/schema"
import { cumulativeXp, levelForXp, stepCoefficient } from "@/src/scoring/levels"
import { scoreActivity } from "@/src/scoring/score-activity"

/** One skill's standing, as the client caches it from `SkillState` (T2). */
export interface CachedSkill {
  skillId: string
  /** `displayedXp` — what the user has been shown, which is what a level is read from. */
  xp: number
  rulesVersionLastComputed?: number
  /** I-17's ratchet. The displayed level is never below it (`levelProgress`, 0073). */
  levelHighWater?: number
}

/** XP per skill that one log adds. Every skill it touches, feeds included. */
export type Award = Record<string, number>

/**
 * The ruleset this user's ledger is on, by the reading the worker takes (`rulesForUser`): the
 * highest `rulesVersionLastComputed` across their skills, else the newest bundled.
 *
 * Restated rather than imported: `src/pipeline/worker-rules.ts` imports the DynamoDB client at
 * module scope, and this runs in the browser. Not validated either — the worker validates the
 * same bundle at cold start and `xp-rules-v*.test.ts` on every build, and nothing computed here
 * is an award. The `Profile` fallback is skipped for the same reason: it only matters for a user
 * with no T2 rows, and a wrong guess for them costs a preview, not XP. A version this build does
 * not carry falls back to the newest, so the row still confirms something.
 */
export function rulesForSkills(skills: readonly CachedSkill[]): RuleSet {
  const have = Object.keys(BUNDLED_RULES).map(Number).sort((a, b) => a - b)
  const versions = skills.map((s) => s.rulesVersionLastComputed).filter((v): v is number => typeof v === "number")
  const want = versions.length > 0 ? Math.max(...versions) : have[have.length - 1]
  return (BUNDLED_RULES[want] ?? BUNDLED_RULES[have[have.length - 1]]) as RuleSet
}

/** What one entry is worth, per skill, under `rules`. Mirrors the manual adapter's activity. */
export function awardFor(entry: WorkoutEntry, rules: RuleSet): Award {
  const { startedAt, sets } = entryActivityFields(entry)
  const rows = scoreActivity(
    {
      activityId: `optimistic:${entry.idempotencyKey}`,
      userId: "self",
      startedAt,
      kind: "strength",
      hasTrace: false,
      source: { source: "manual", externalId: entry.idempotencyKey, sourceTypeRaw: entry.exerciseId, fetchedAt: startedAt },
      sets,
    },
    rules,
    null,
    { newCellCount: 0, rearmedCellCount: 0 },
    startedAt,
  )
  const award: Award = {}
  for (const r of rows) award[r.skillId] = (award[r.skillId] ?? 0) + r.xpAwarded
  return award
}

/** The sum of several awards — the cached XP plus every log still waiting to flush. */
export function addAwards(...awards: readonly Award[]): Award {
  const out: Award = {}
  for (const a of awards) for (const [k, v] of Object.entries(a)) out[k] = (out[k] ?? 0) + v
  return out
}

/** What the row says after a click: this skill's gain and the level it now stands at. */
export interface RowResult {
  xpGained: number
  level: number
  /** 0–1 through the current level, for the skill bar's wipe. */
  progress: number
}

export function rowResult(
  skillId: string,
  award: Award,
  standing: { xp: number },
  rules: RuleSet,
): RowResult {
  const xpGained = award[skillId] ?? 0
  const xp = standing.xp + xpGained
  const level = levelForXp(xp, rules.curve)
  const floor = cumulative(level, rules)
  const next = cumulative(level + 1, rules)
  return { xpGained, level, progress: next > floor ? Math.min(1, (xp - floor) / (next - floor)) : 1 }
}

function cumulative(level: number, rules: RuleSet): number {
  return cumulativeXp(level, stepCoefficient(rules.curve))
}
