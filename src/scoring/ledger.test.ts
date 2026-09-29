import { describe, expect, expectTypeOf, it } from "vitest"

import { loadRuleSet } from "@/src/rules/load"
import {
  FLOOR_ACTIVITY_ID,
  LEDGER_REASONS,
  ledgerEntries,
  ledgerId,
  ledgerSeq,
  RESERVED_REASONS,
  scoreGround,
  scoreUnits,
  sumXp,
  xpBySkill,
  type GroundReason,
  type LedgerReason,
  type ScorableActivity,
  type UnratedRow,
  type XpLedgerEntry,
} from "@/src/scoring"

/**
 * Ticket 0062. `02-data-model.md` §4.1–4.2, I-15, I-19.
 *
 * The property tests use a seeded PRNG rather than a property-testing library: the repo has
 * none, and a fixed seed makes a failure reproducible from the test name alone.
 */

const RULES = loadRuleSet(1)
const ACTIVITY = { activityId: "a-1", userId: "u-1", startedAt: "2026-09-06T03:00:00.000Z" }
const AWARDED_AT = "2026-09-06T09:00:02.000Z"
const ctx = { activity: ACTIVITY, rules: RULES, awardedAt: AWARDED_AT }

/** mulberry32. Small, seedable, good enough to shuffle and sample. */
function prng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(xs: readonly T[], rand: () => number): T[] {
  const out = [...xs]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

describe("the reason vocabulary (02 §4.2, D-122)", () => {
  it("is closed: the ten MVP reasons, plus the ReplayRun audit row's (D-258)", () => {
    expect([...LEDGER_REASONS]).toEqual([
      "new_ground",
      "rearmed_ground",
      "recent_ground",
      "distance",
      "reps",
      "duration",
      "cells_new",
      "cells_rearmed",
      "constitution_share",
      "retained_floor",
      "replay_run",
    ])
  })

  it("reserves slayer_win / slayer_loss / boss_phase and keeps them OUT of the writable type", () => {
    expect([...RESERVED_REASONS]).toEqual(["slayer_win", "slayer_loss", "boss_phase"])
    for (const r of RESERVED_REASONS) expect(LEDGER_REASONS).not.toContain(r)
    expectTypeOf<"slayer_win">().not.toMatchTypeOf<LedgerReason>()
  })

  it("everything the ground step emits is in it", () => {
    expectTypeOf<GroundReason>().toMatchTypeOf<LedgerReason>()
  })
})

describe("the deterministic id (§4.1)", () => {
  it("is `${activityId}#${skillId}#${reason}#v${xpRulesVersion}`", () => {
    expect(
      ledgerId({ activityId: "a-1", skillId: "wayfaring", reason: "new_ground", xpRulesVersion: 1 }),
    ).toBe("a-1#wayfaring#new_ground#v1")
  })

  it("is a template over opaque strings: a skill no ruleset has ever named works the same way", () => {
    expect(
      ledgerId({ activityId: "x", skillId: "some-future-skill", reason: "reps", xpRulesVersion: 7 }),
    ).toBe("x#some-future-skill#reps#v7")
  })

  it.each([0, -1, 1.5, NaN, null as unknown as number])(
    "refuses xpRulesVersion %s — the row is meaningless without a real one (I-19)",
    (v) => {
      expect(() =>
        ledgerId({ activityId: "a", skillId: "s", reason: "distance", xpRulesVersion: v }),
      ).toThrow(/xpRulesVersion/)
    },
  )

  it("the floor sentinel is `__floor__`", () => {
    expect(FLOOR_ACTIVITY_ID).toBe("__floor__")
  })
})

describe("seq (§4.1)", () => {
  it("is `<startedAt>#<activityId>#<nn>` with a two-digit nn", () => {
    expect(ledgerSeq("2026-09-06T03:00:00.000Z", "a-1", 3)).toBe("2026-09-06T03:00:00.000Z#a-1#03")
  })

  it("sorts in replay order: earlier startedAt first, then activityId, then nn", () => {
    const seqs = [
      ledgerSeq("2026-09-06T03:00:00.000Z", "b", 0),
      ledgerSeq("2026-09-05T03:00:00.000Z", "z", 1),
      ledgerSeq("2026-09-06T03:00:00.000Z", "a", 10),
      ledgerSeq("2026-09-06T03:00:00.000Z", "a", 2),
    ]
    expect([...seqs].sort()).toEqual([seqs[1], seqs[3], seqs[2], seqs[0]])
  })
})

describe("ledgerEntries", () => {
  const row = (over: Partial<UnratedRow> = {}): UnratedRow => ({
    skillId: "wayfaring",
    reason: "new_ground",
    units: 5.123,
    unitsEffective: 5.123,
    ...over,
  })

  it("writes every §4.1 attribute, rated at the row's xpPerUnit and rounded once", () => {
    const [entry] = ledgerEntries([row()], ctx)
    expect(entry).toEqual<XpLedgerEntry>({
      id: "a-1#wayfaring#new_ground#v1",
      userId: "u-1",
      activityId: "a-1",
      skillId: "wayfaring",
      reason: "new_ground",
      units: 5.123,
      unitsEffective: 5.123,
      xpAwarded: 512, // 5.123 × 100 = 512.3
      xpRulesVersion: 1,
      isFloor: false,
      seq: "2026-09-06T03:00:00.000Z#a-1#00",
      awardedAt: AWARDED_AT,
    })
  })

  it("rates from unitsEffective, not units: recent ground pays half (D-120)", () => {
    const [entry] = ledgerEntries([row({ reason: "recent_ground", units: 4, unitsEffective: 2 })], ctx)
    expect(entry!.xpAwarded).toBe(200)
    expect(entry!.units).toBe(4)
  })

  it("drops a row that rounds to zero XP (§4.2: a zero-XP row carries no information)", () => {
    const entries = ledgerEntries(
      [row({ units: 0.004, unitsEffective: 0.004 }), row({ reason: "recent_ground" })],
      ctx,
    )
    expect(entries.map((e) => e.reason)).toEqual(["recent_ground"])
    expect(entries[0]!.seq.endsWith("#00")).toBe(true)
  })

  it("refuses a duplicate (skill, reason): the second row's XP would vanish into the id condition", () => {
    expect(() => ledgerEntries([row(), row()], ctx)).toThrow(/duplicate row/)
  })

  it("refuses a skill the ruleset does not have", () => {
    expect(() => ledgerEntries([row({ skillId: "nope" })], ctx)).toThrow(/not in ruleset v1/)
  })

  it("stamps isFloor: false on every row it writes (floors are the replay job's, 0066)", () => {
    const entries = ledgerEntries(
      [row(), row({ reason: "recent_ground" }), row({ skillId: "might", reason: "reps", units: 30, unitsEffective: 30 })],
      ctx,
    )
    expect(entries.every((e) => e.isFloor === false)).toBe(true)
  })
})

describe("I-19 — the property tests", () => {
  /**
   * Every row the SCORER emits, not rows made up for the test: random activities through
   * `scoreUnits` → `scoreGround` → `ledgerEntries` with the real v1 ruleset.
   */
  function randomActivity(rand: () => number): ScorableActivity {
    const kinds = ["run", "walk", "hike", "ride", "strength", "other"] as const
    const kind = kinds[Math.floor(rand() * kinds.length)]!
    return {
      kind,
      hasTrace: rand() < 0.7,
      source: { source: rand() < 0.5 ? "manual" : "gpslogger" },
      distanceM: rand() < 0.1 ? null : rand() * 42_000,
      sets:
        kind === "strength"
          ? [
              { exercise: "pushup", reps: Math.floor(rand() * 80) },
              { exercise: "situp", reps: Math.floor(rand() * 80) },
              { exercise: "plank", durationS: Math.floor(rand() * 400) },
            ]
          : [],
    } as unknown as ScorableActivity
  }

  function scorerRows(rand: () => number, n: number): XpLedgerEntry[] {
    const all: XpLedgerEntry[] = []
    for (let i = 0; i < n; i++) {
      const activity = randomActivity(rand)
      const split =
        rand() < 0.2 ? null : { new: rand() * 5000, rearmed: rand() * 5000, recent: rand() * 5000 }
      const rows = scoreGround(scoreUnits(activity, RULES), RULES, split)
      all.push(
        ...ledgerEntries(rows, {
          activity: { ...ACTIVITY, activityId: `a-${i}` },
          rules: RULES,
          awardedAt: AWARDED_AT,
        }),
      )
    }
    return all
  }

  it.each([1, 2, 3, 42, 2026])("seed %i: every emitted row's xpAwarded is an integer", (seed) => {
    const rows = scorerRows(prng(seed), 300)
    expect(rows.length).toBeGreaterThan(100)
    for (const r of rows) expect(Number.isInteger(r.xpAwarded), r.id).toBe(true)
  })

  it.each([7, 8, 9])("seed %i: summing a ledger in random order gives the same total", (seed) => {
    const rand = prng(seed)
    const rows = scorerRows(rand, 300)
    const total = sumXp(rows)
    const bySkill = xpBySkill(rows)
    for (let k = 0; k < 20; k++) {
      const shuffled = shuffle(rows, rand)
      expect(sumXp(shuffled)).toBe(total)
      expect(xpBySkill(shuffled)).toEqual(bySkill)
    }
  })

  it("the per-skill sums add up to the grand total", () => {
    const rows = scorerRows(prng(11), 200)
    expect([...xpBySkill(rows).values()].reduce((a, b) => a + b, 0)).toBe(sumXp(rows))
  })
})
