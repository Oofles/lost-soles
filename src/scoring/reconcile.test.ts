import { describe, expect, it } from "vitest"

import { FLOOR_ACTIVITY_ID, cumulativeXp, levelForXp, sumXp } from "@/src/scoring"
import { FLOOR_SEQ_PREFIX, floorId, ratchetLevel, reconcile, waterlineOf } from "@/src/scoring/reconcile"

/**
 * Ticket 0066. `02-data-model.md` §4.6, I-16, I-17.
 *
 * AT THE TOP, AS THE TICKET ASKS: the one function allowed to invent a ledger row.
 */

const base = {
  userId: "u-1",
  fromVersion: 1,
  toVersion: 2,
  awardedAt: "2026-09-29T00:00:00.000Z",
}

describe("reconcile — the only step that may add rows (§4.6)", () => {
  it("writes the shortfall, and exactly the shortfall, as one floor row per short skill", () => {
    const rows = reconcile({
      ...base,
      waterline: { wayfaring: { xp: 412_900, level: 47 }, vigil: { xp: 1_000, level: 7 } },
      recomputed: new Map([
        ["wayfaring", 398_100],
        ["vigil", 1_200],
      ]),
      existingFloors: new Map(),
    })
    expect(rows).toEqual([
      {
        id: "__floor__#wayfaring#v1-2",
        userId: "u-1",
        activityId: FLOOR_ACTIVITY_ID,
        skillId: "wayfaring",
        reason: "retained_floor",
        units: 0,
        unitsEffective: 0,
        xpAwarded: 14_800,
        xpRulesVersion: 2,
        supersedesRulesVersion: 1,
        isFloor: true,
        seq: `${FLOOR_SEQ_PREFIX}wayfaring`,
        awardedAt: base.awardedAt,
      },
    ])
  })

  it("counts floors that survived step 2, so successive rebalances top up and never compound", () => {
    // v1→v2 retained 14,800. v2→v3 leaves the recomputed total 2,000 shorter still.
    const rows = reconcile({
      ...base,
      fromVersion: 2,
      toVersion: 3,
      waterline: { wayfaring: { xp: 412_900, level: 47 } },
      recomputed: new Map([["wayfaring", 396_100]]),
      existingFloors: new Map([["wayfaring", 14_800]]),
    })
    expect(rows.map((r) => [r.id, r.xpAwarded])).toEqual([["__floor__#wayfaring#v2-3", 2_000]])
  })

  it("is idempotent: a re-run that finds its own floor computes a gap of zero (I-16c)", () => {
    const first = reconcile({
      ...base,
      waterline: { wayfaring: { xp: 500, level: 5 } },
      recomputed: new Map([["wayfaring", 300]]),
      existingFloors: new Map(),
    })
    const second = reconcile({
      ...base,
      waterline: { wayfaring: { xp: 500, level: 5 } },
      recomputed: new Map([["wayfaring", 300]]),
      existingFloors: new Map([["wayfaring", sumXp(first)]]),
    })
    expect(first).toHaveLength(1)
    expect(second).toEqual([])
  })

  it("retains the whole displayed XP of a skill the new ruleset no longer scores", () => {
    const rows = reconcile({
      ...base,
      waterline: { retired: { xp: 777, level: 6 } },
      recomputed: new Map(),
      existingFloors: new Map(),
    })
    expect(rows.map((r) => r.xpAwarded)).toEqual([777])
  })

  it("writes nothing when the new rules are as generous or more, and never a negative row", () => {
    const rows = reconcile({
      ...base,
      waterline: { a: { xp: 100, level: 3 }, b: { xp: 100, level: 3 } },
      recomputed: new Map([
        ["a", 100],
        ["b", 250],
      ]),
      existingFloors: new Map(),
    })
    expect(rows).toEqual([])
  })

  it("is deterministic: skills are visited in id order whatever order the waterline has", () => {
    const run = (order: string[]) =>
      reconcile({
        ...base,
        waterline: Object.fromEntries(order.map((s) => [s, { xp: 10, level: 1 }])),
        recomputed: new Map(),
        existingFloors: new Map(),
      }).map((r) => r.skillId)
    expect(run(["c", "a", "b"])).toEqual(["a", "b", "c"])
    expect(run(["b", "c", "a"])).toEqual(["a", "b", "c"])
  })

  it("keeps displayedXp == SUM(ledger): recomputed + floors lands exactly on the waterline (I-15)", () => {
    const waterline = { s: { xp: 9_999, level: 20 } }
    const recomputed = new Map([["s", 4_321]])
    const existingFloors = new Map([["s", 1_000]])
    const rows = reconcile({ ...base, waterline, recomputed, existingFloors })
    expect(4_321 + 1_000 + sumXp(rows)).toBe(9_999)
  })

  it("floor ids are deterministic in (skill, from, to)", () => {
    expect(floorId("might", 3, 4)).toBe("__floor__#might#v3-4")
  })
})

describe("the waterline (§4.4 step 0)", () => {
  const V1 = { maxLevel: 99, stepFormula: "4 * L^2" }

  it("takes the displayed level: max(level, levelHighWater)", () => {
    const w = waterlineOf(
      [
        { skillId: "a", displayedXp: 100, level: 3, levelHighWater: 5 },
        { skillId: "b", displayedXp: 100, level: 4, levelHighWater: 2 },
      ],
      V1,
    )
    expect(w).toEqual({ a: { xp: 100, level: 5 }, b: { xp: 100, level: 4 } })
  })

  it("computes the level under the FROM curve when the row carries none (pre-0219 rows)", () => {
    const xp = cumulativeXp(30) + 7
    expect(waterlineOf([{ skillId: "a", displayedXp: xp }], V1).a).toEqual({ xp, level: 30 })
  })
})

describe("levelHighWater — the second ratchet (I-17)", () => {
  it("is max(levelHighWater, computedLevel)", () => {
    expect(ratchetLevel(30, 27)).toBe(30)
    expect(ratchetLevel(30, 31)).toBe(31)
    expect(ratchetLevel(undefined, 4)).toBe(4)
  })

  it("holds a level a curve change would lower at unchanged XP", () => {
    const xp = cumulativeXp(30)
    const before = levelForXp(xp, { maxLevel: 99, stepFormula: "4 * L^2" })
    const after = levelForXp(xp, { maxLevel: 99, stepFormula: "5 * L^2" })
    expect(after).toBeLessThan(before)
    expect(ratchetLevel(before, after)).toBe(before)
  })
})
