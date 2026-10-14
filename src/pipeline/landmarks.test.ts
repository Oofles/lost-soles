import { describe, expect, it } from "vitest"

import { loadRuleSet } from "@/src/rules/load"
import { cumulativeXp, FLOOR_ACTIVITY_ID, ledgerSeq, stepCoefficient } from "@/src/scoring"

import { landmarksFromLedger, type WalkRow } from "./landmarks"

/** Ticket `0248` — the backfill's ledger walk. Skill ids are named because this is a test (I-25). */

const CURVE = loadRuleSet(1).curve
const K = stepCoefficient(CURVE)
const AT50 = cumulativeXp(50, K)

const row = (skillId: string, activityId: string, day: number, xpAwarded: number, nn = 0): WalkRow => ({
  skillId,
  activityId,
  xpAwarded,
  seq: ledgerSeq(`2026-01-${String(day).padStart(2, "0")}T08:00:00.000Z`, activityId, nn),
})

describe("landmarksFromLedger", () => {
  it("names the activity whose XP carried the skill past 50, in activity order — not row order", () => {
    const rows = [
      row("wayfaring", "a-3", 3, 400), // listed first, happened last
      row("wayfaring", "a-1", 1, AT50 - 100),
      row("wayfaring", "a-2", 2, 150, 0),
      row("wayfaring", "a-2", 2, 50, 1), // the same activity, a second reason
    ]
    expect(landmarksFromLedger(rows, CURVE)).toEqual([
      { skillId: "wayfaring", level: 50, place: "landmark", activityId: "a-2", earnedAt: "2026-01-02T08:00:00.000Z", arc: 0.5 },
    ])
  })

  it("each skill is walked on its own sum", () => {
    const rows = [row("wayfaring", "a-1", 1, AT50 - 1), row("roving", "a-1", 1, 10), row("roving", "a-2", 2, AT50)]
    expect(landmarksFromLedger(rows, CURVE).map((c) => [c.skillId, c.activityId])).toEqual([["roving", "a-2"]])
  })

  it("a floor counts toward the sum but places nothing — it belongs to no activity", () => {
    const rows = [row("wayfaring", "a-1", 1, AT50 - 10), row("wayfaring", FLOOR_ACTIVITY_ID, 2, 20), row("wayfaring", "a-3", 3, 99)]
    expect(landmarksFromLedger(rows, CURVE)).toEqual([])
  })

  it("a skill short of 50 has none", () => {
    expect(landmarksFromLedger([row("wayfaring", "a-1", 1, AT50 - 1)], CURVE)).toEqual([])
  })
})
