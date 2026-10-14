import type { RuleCurve } from "@/src/rules/schema"

import { cumulativeXp, levelForXp, stepCoefficient } from "./levels"

/**
 * THE MILESTONES THAT PUT SOMETHING ON THE MAP. Ticket `0248`. `04-game-design.md` §4.3; D-031, D-301.
 *
 * *"Every milestone that can be a landmark should be a landmark."* 50 places a landmark where it
 * was earned, 99 a shrine at the exact cell. Which levels are place-bound is THIS TABLE — a row in
 * the ladder, never a branch on a skill id — and the level-up card (`lib/level-up/cards.ts`), the
 * pipeline's landmark write (`src/pipeline/landmarks.ts`) and the backfill all read it, so the card
 * that flies into the map and the record it leaves cannot disagree about which levels count.
 */

export type PlaceKind = "landmark" | "shrine"

export const PLACE_LEVELS: Readonly<Record<number, PlaceKind>> = { 50: "landmark", 99: "shrine" }

export interface PlaceCrossing {
  level: number
  place: PlaceKind
  /**
   * WHERE ON THE ROUTE, as a fraction of this activity's XP for the skill: the threshold's share of
   * the gain (D-297). The XP is apportioned evenly along the run, so this is also the fraction of
   * the route walked — `lanternPath(route).at(arc)` is the point (D-301).
   */
  arc: number
}

/** The arc of level `level`'s threshold within a gain of `gained` on top of `xpBefore`. */
export function thresholdArc(level: number, xpBefore: number, gained: number, k: number): number {
  return Math.min(1, Math.max(0, (cumulativeXp(level, k) - xpBefore) / gained))
}

/** Place-bound levels in `(levelForXp(xpBefore), levelForXp(xpBefore + gained)]`, ascending. */
export function placesCrossed(
  xpBefore: number,
  gained: number,
  curve: Pick<RuleCurve, "maxLevel"> & Partial<Pick<RuleCurve, "stepFormula">>,
): PlaceCrossing[] {
  if (gained <= 0) return []
  const from = levelForXp(xpBefore, curve)
  const to = levelForXp(xpBefore + gained, curve)
  const k = stepCoefficient(curve)
  return Object.entries(PLACE_LEVELS)
    .map(([level, place]) => ({ level: Number(level), place }))
    .filter(({ level }) => level > from && level <= to)
    .sort((a, b) => a.level - b.level)
    .map(({ level, place }) => ({ level, place, arc: thresholdArc(level, xpBefore, gained, k) }))
}
