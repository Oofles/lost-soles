import { SKILL_MILESTONES } from "@/lib/skills/detail"
import { BUNDLED_RULES } from "@/rules/xp-rules.bundled"
import type { RuleSet } from "@/src/rules/schema"
import { baselineOf, earnedMilestonesCrossed, type Baseline } from "@/src/scoring/celebrate"
import { levelForXp, stepCoefficient, totalLevelCeiling, TOTAL_LEVEL_MILESTONES } from "@/src/scoring/levels"
import { PLACE_LEVELS, thresholdArc, type PlaceKind } from "@/src/scoring/places"

/**
 * THE LEVEL-UP CARD QUEUE. Ticket `0082`. `06-ui-ux.md` §3.2 beat 3, §6.4; `04` §4.2–4.3; D-146, D-297.
 *
 * Pure: an activity's XP, the standing before it, and the ruleset in; the cards it earns out, in the
 * order they play. `/run/:id`'s tally and `/log`'s rows both build their queue here, so the two
 * cannot disagree about what deserves a card.
 *
 * ─── EVERY CARD IS ATTRIBUTABLE TO THIS ACTIVITY'S XP ───────────────────────
 *
 * A skill card exists only for a level `xpBefore` did not buy and `xpBefore + xpGained` does — so a
 * skill this activity gave no XP has no card, whatever the ruleset did. A skill minted by a new
 * ruleset row sits at level 1 with no XP: it crosses nothing and makes nothing (the D-146 case).
 * Total Level milestones are judged on the EARNED total (`earnedMilestonesCrossed`, the guard's
 * module), so a milestone reachable only through a minted point is suppressed, never celebrated.
 *
 * No skill id is named here (D-031).
 */

export type { PlaceKind }

export type LevelCard =
  | {
      kind: "skill"
      skillId: string
      from: number
      to: number
      /** §4.3's tier name at a milestone level; `null` otherwise. */
      tier: string | null
      /** §4.3: 50 places a landmark where it was earned, 99 a shrine at the exact cell. */
      place: PlaceKind | null
      /**
       * WHERE IT WAS EARNED, as a fraction of this activity's XP for the skill: the threshold's
       * share of the gain. Beat 3 walks the route by this arc to find the cell (D-297: an estimate,
       * apportioned evenly along the run). `0248` records the landmark at this same arc (D-301).
       */
      arc: number
    }
  | { kind: "total"; milestone: number }

/**
 * THE BASELINE (D-297). "Minted" means added to the ruleset after the user started — which, for this
 * single-user app, is the first ruleset that ever shipped. One rule, on every page, with no read.
 * It carries that ruleset's enabled rows too, so a row switched on later is minted as well (D-300).
 */
export const BASELINE_VERSION = Math.min(...Object.keys(BUNDLED_RULES).map(Number))
export const BASELINE: Baseline = baselineOf(BUNDLED_RULES[BASELINE_VERSION] as RuleSet)

export function skillCards(
  skillId: string,
  xpBefore: number,
  xpGained: number,
  curve: RuleSet["curve"],
): LevelCard[] {
  if (xpGained <= 0) return []
  const from = levelForXp(xpBefore, curve)
  const to = levelForXp(xpBefore + xpGained, curve)
  const k = stepCoefficient(curve)
  const cards: LevelCard[] = []
  for (let l = from + 1; l <= to; l++) {
    cards.push({
      kind: "skill",
      skillId,
      from: l - 1,
      to: l,
      tier: SKILL_MILESTONES.find((m) => m.level === l)?.name ?? null,
      place: PLACE_LEVELS[l] ?? null,
      arc: thresholdArc(l, xpBefore, xpGained, k),
    })
  }
  return cards
}

/** The Total Level ladder with its computed ceiling appended (§4.3, D-145 — 693 today, never typed). */
export function totalLadder(rules: Pick<RuleSet, "curve" | "skills">): number[] {
  const ceiling = totalLevelCeiling(rules.skills, rules.curve)
  return [...TOTAL_LEVEL_MILESTONES.filter((m) => m < ceiling), ceiling]
}

export function totalCards(
  before: Readonly<Record<string, number>>,
  gained: Readonly<Record<string, number>>,
  rules: Pick<RuleSet, "curve" | "skills">,
  baseline: Baseline = BASELINE,
): LevelCard[] {
  const b = new Map(Object.entries(before))
  const a = new Map(b)
  for (const [id, xp] of Object.entries(gained)) if (xp > 0) a.set(id, (a.get(id) ?? 0) + xp)
  return earnedMilestonesCrossed(b, a, rules, baseline, totalLadder(rules)).map((milestone) => ({ kind: "total", milestone }))
}

/**
 * The whole queue for one activity: each skill's cards in `order` (the tally's row order), then the
 * Total Level milestones. `/log` plays it at once; the tally plays each skill's cards when its row
 * finishes counting, and the Total Level cards after its last line.
 */
export function levelUpQueue(
  before: Readonly<Record<string, number>>,
  gained: Readonly<Record<string, number>>,
  rules: Pick<RuleSet, "curve" | "skills">,
  order: readonly string[] = Object.keys(gained),
  baseline: Baseline = BASELINE,
): LevelCard[] {
  return [
    ...order.flatMap((id) => skillCards(id, before[id] ?? 0, gained[id] ?? 0, rules.curve)),
    ...totalCards(before, gained, rules, baseline),
  ]
}
