import { describe, expect, it } from "vitest"

import { skillCards } from "@/lib/level-up/cards"
import { loadRuleSet } from "@/src/rules/load"

import { cumulativeXp, stepCoefficient } from "./levels"
import { PLACE_LEVELS, placesCrossed } from "./places"

/** Ticket `0248`. `04` §4.3; D-031, D-301. */

const CURVE = loadRuleSet(1).curve
const K = stepCoefficient(CURVE)

describe("placesCrossed", () => {
  it("is 04 §4.3's table: 50 a landmark, 99 a shrine — and nothing else", () => {
    expect(PLACE_LEVELS).toEqual({ 50: "landmark", 99: "shrine" })
  })

  it("returns 50 when a gain carries the level from 49 to 51, at the threshold's share of the gain", () => {
    const before = cumulativeXp(50, K) - 300
    expect(placesCrossed(before, 1200, CURVE)).toEqual([{ level: 50, place: "landmark", arc: 0.25 }])
  })

  it("returns both, ascending, when one gain crosses 50 and 99", () => {
    const before = cumulativeXp(49, K)
    const gained = cumulativeXp(99, K) - before
    expect(placesCrossed(before, gained, CURVE).map((c) => [c.level, c.place, c.arc])).toEqual([
      [50, "landmark", (cumulativeXp(50, K) - before) / gained],
      [99, "shrine", 1],
    ])
  })

  it("an exact landing on the threshold crosses it; already being there does not", () => {
    const at50 = cumulativeXp(50, K)
    expect(placesCrossed(at50 - 10, 10, CURVE).map((c) => c.level)).toEqual([50])
    expect(placesCrossed(at50, 10, CURVE)).toEqual([])
  })

  it("no gain crosses nothing (a minted skill at level 1, D-146)", () => {
    expect(placesCrossed(cumulativeXp(50, K) - 1, 0, CURVE)).toEqual([])
  })

  it("agrees with the level-up card, so the landmark stands where the card flew (D-297, D-301)", () => {
    const before = cumulativeXp(50, K) - 77
    const card = skillCards("a-skill", before, 500, CURVE).find((c) => c.kind === "skill" && c.place !== null)
    expect(card).toMatchObject({ to: 50, place: "landmark" })
    expect(placesCrossed(before, 500, CURVE)).toEqual([{ level: 50, place: "landmark", arc: (card as { arc: number }).arc }])
  })
})
