import { describe, expect, it } from "vitest"

import type { CachedSkill } from "@/lib/log/optimistic"
import { BUNDLED_RULES } from "@/rules/xp-rules.bundled"
import type { RuleSet } from "@/src/rules/schema"
import { cumulativeXp } from "@/src/scoring/levels"

import {
  lowPrecision,
  RECENT_ROWS,
  rulesSentence,
  skillDetail,
  SKILL_MILESTONES,
  type DetailLedgerRow,
  type PlaceMilestone,
} from "./detail"
import { median } from "./next"

/**
 * Ticket 0074 — the sheet's model. Skill ids are named because this is a test (I-25's exemption)
 * and some assertions are about particular rows; nothing under test names them.
 */

const rules = BUNDLED_RULES[Math.max(...Object.keys(BUNDLED_RULES).map(Number))] as RuleSet
const V = rules.version
const NOW = Date.parse("2026-10-07T12:00:00Z")
const DAY = 86_400_000
const enabled = rules.skills.filter((s) => s.enabled)

/** One activity's rows for `skillId`, `daysAgo` before NOW. */
function activity(skillId: string, n: number, daysAgo: number, parts: [reason: string, units: number, xp: number][]): DetailLedgerRow[] {
  const startedAt = new Date(NOW - daysAgo * DAY).toISOString()
  return parts.map(([reason, units, xp], i) => ({
    skillId,
    activityId: `act-${n}`,
    reason,
    units,
    xpAwarded: xp,
    xpRulesVersion: V,
    isFloor: false,
    seq: `${startedAt}#act-${n}#${String(i).padStart(2, "0")}`,
  }))
}

/** `count` 5 km runs of 500 XP, one every two days, newest first. */
function runs(skillId: string, count: number): DetailLedgerRow[] {
  return Array.from({ length: count }, (_, i) => activity(skillId, i, 1 + i * 2, [["new_ground", 5, 500]])).flat()
}

const standingFor = (skillId: string, ledger: readonly DetailLedgerRow[]): CachedSkill[] => [
  { skillId, xp: ledger.filter((r) => r.skillId === skillId).reduce((s, r) => s + r.xpAwarded, 0), rulesVersionLastComputed: V },
]

describe("skillDetail — header (4L²)", () => {
  it("shows level, xp / next and XP to L+1, all from the curve", () => {
    const xp = cumulativeXp(47) + 1_000
    const d = skillDetail(rules, "wayfaring", [{ skillId: "wayfaring", xp }], [], [], NOW)!
    expect(d.level).toBe(47)
    expect(d.xp).toBe(xp)
    expect(d.nextXp).toBe(cumulativeXp(48))
    expect(d.xpToNext).toBe(cumulativeXp(48) - xp)
    expect(d.xpToNext).toBe(4 * 47 * 47 - 1_000)
  })

  it("honours levelHighWater, like the tile under it", () => {
    const d = skillDetail(rules, "wayfaring", [{ skillId: "wayfaring", xp: cumulativeXp(10), levelHighWater: 12 }], [], [], NOW)!
    expect(d.level).toBe(12)
  })

  it("at the curve's top shows no next level and no estimate", () => {
    const d = skillDetail(rules, "wayfaring", [{ skillId: "wayfaring", xp: cumulativeXp(rules.curve.maxLevel) + 5 }], runs("wayfaring", 3), [], NOW)!
    expect(d.atMax).toBe(true)
    expect(d.sessionsToNext).toBeNull()
    expect(d.ahead).toEqual([])
  })
})

describe("skillDetail — ~N runs to L+1 (04 §4.1)", () => {
  it("is the XP still needed over the trailing MEDIAN session, not the mean", () => {
    const ledger = [
      ...activity("wayfaring", 1, 1, [["new_ground", 5, 400]]),
      ...activity("wayfaring", 2, 2, [["new_ground", 5, 500]]),
      ...activity("wayfaring", 3, 3, [["new_ground", 50, 9_000]]), // one outlier moves a mean, not a median
    ]
    const xp = cumulativeXp(20)
    const d = skillDetail(rules, "wayfaring", [{ skillId: "wayfaring", xp }], ledger, [], NOW)!
    expect(median([400, 500, 9_000])).toBe(500)
    expect(d.sessionsToNext).toBe(`~${Math.ceil(d.xpToNext / 500)} runs`)
  })

  it("sums an activity's reasons into one session (a run over new and familiar ground is one run)", () => {
    const ledger = activity("wayfaring", 1, 1, [["new_ground", 3, 300], ["recent_ground", 4, 200]])
    const d = skillDetail(rules, "wayfaring", [{ skillId: "wayfaring", xp: cumulativeXp(25) }], ledger, [], NOW)!
    expect(d.sessionsToNext).toBe(`~${Math.ceil(d.xpToNext / 500)} runs`)
  })

  it("is shown for EVERY registry skill with one session, with the noun from logMode", () => {
    for (const s of enabled) {
      const ledger = activity(s.id, 1, 1, [["distance", 1, 10]])
      const d = skillDetail(rules, s.id, standingFor(s.id, ledger), ledger, [], NOW)!
      expect(d.sessionsToNext, s.id).toMatch(s.logMode === "trace" ? /^~\d+ runs?$/ : /^~\d+ sessions?$/)
    }
  })

  it("is omitted — null, never zero — for a skill with no session", () => {
    for (const s of enabled) {
      const d = skillDetail(rules, s.id, [], [], [], NOW)!
      expect(d.sessionsToNext, s.id).toBeNull()
    }
  })

  it("goes down by about one when one more usual session lands (the operator's check)", () => {
    const before = runs("wayfaring", 10)
    const xp = cumulativeXp(30) + 100
    const one = skillDetail(rules, "wayfaring", [{ skillId: "wayfaring", xp }], before, [], NOW)!
    const after = [...activity("wayfaring", 99, 0, [["new_ground", 5, 500]]), ...before]
    const two = skillDetail(rules, "wayfaring", [{ skillId: "wayfaring", xp: xp + 500 }], after, [], NOW)!
    const n = (s: string | null) => Number(/~(\d+)/.exec(s!)![1])
    expect(n(one.sessionsToNext) - n(two.sessionsToNext)).toBe(1)
  })
})

describe("rulesSentence — generated from the registry", () => {
  const row = (id: string) => rules.skills.find((s) => s.id === id)!

  it("reads Wayfaring's row as §5.5 writes it", () => {
    expect(rulesSentence(rules, row("wayfaring"))).toBe("100 XP per kilometre; half on ground you have run before.")
  })

  it("Vigil's row (groundMultipliers: null) does NOT claim half on ground run before (from 0076)", () => {
    const s = rulesSentence(rules, row("vigil"))
    expect(s).toBe("100 XP per kilometre.")
    expect(s).not.toMatch(/half|ground/)
  })

  it("changing xpPerUnit in the data changes the sentence, with no source edit", () => {
    const edited: RuleSet = { ...rules, skills: rules.skills.map((s) => (s.id === "wayfaring" ? { ...s, xpPerUnit: 140 } : s)) }
    expect(rulesSentence(edited, edited.skills.find((s) => s.id === "wayfaring")!)).toBe(
      "140 XP per kilometre; half on ground you have run before.",
    )
  })

  it("changing a multiplier changes the clause", () => {
    const edited = { ...row("wayfaring"), groundMultipliers: { new: 1, rearmed: 0.25, recent: 0.25 } }
    expect(rulesSentence(rules, edited)).toBe("100 XP per kilometre; a quarter on ground you have run before.")
  })

  it("states a soft cap, and a fed skill's feeders, from their rows", () => {
    expect(rulesSentence(rules, row("might"))).toBe("4 XP per rep; full rate up to 100 reps in one session, tapering after.")
    const fed = rulesSentence(rules, row("constitution"))
    expect(fed).toMatch(/^A third of the XP earned in /)
    for (const s of enabled.filter((s) => s.feeds.some((f) => f.skill === "constitution"))) expect(fed).toContain(s.name)
  })

  it("every enabled skill gets a non-empty sentence", () => {
    for (const s of enabled) expect(rulesSentence(rules, s), s.id).toMatch(/^[A-Z0-9].+\.$/)
  })
})

describe("RECENT — ten rows, not a history", () => {
  it("shows at most ten activities, newest first, and counts the rest", () => {
    const ledger = runs("wayfaring", 14)
    const d = skillDetail(rules, "wayfaring", standingFor("wayfaring", ledger), ledger, [], NOW)!
    expect(d.recent).toHaveLength(RECENT_ROWS)
    expect(d.more).toBe(4)
    expect(d.recent.map((r) => r.activityId)).toEqual(Array.from({ length: 10 }, (_, i) => `act-${i}`))
  })

  it("groups an activity's rows into one row, keeping the rows underneath inspectable", () => {
    const ledger = activity("wayfaring", 1, 1, [["new_ground", 3.2, 320], ["recent_ground", 5.2, 260]])
    const d = skillDetail(rules, "wayfaring", standingFor("wayfaring", ledger), ledger, [], NOW)!
    expect(d.recent).toHaveLength(1)
    expect(d.recent[0]).toMatchObject({ units: "8.4 km", xp: 580 })
    expect(d.recent[0]!.parts).toEqual([
      { reason: "new_ground", units: "3.2 km", xp: 320 },
      { reason: "recent_ground", units: "5.2 km", xp: 260 },
    ])
  })

  it("I-15: RECENT plus the older rows plus carried XP equals the level bar's XP", () => {
    // The live shape (2026-10-07): a floor written by the v1→v2 replay, stamped v2, under a v3
    // ledger — it still counts. So does a tombstoned activity's row kept under an older version.
    const floor: DetailLedgerRow = {
      skillId: "wayfaring", activityId: "__floor__", reason: "retained_floor", units: 0, xpAwarded: 13_342,
      xpRulesVersion: V - 1, isFloor: true, seq: "9999-12-31T00:00:00Z#__floor__#wayfaring#r1",
    }
    const kept = activity("wayfaring", 500, 400, [["new_ground", 9, 900]]).map((r) => ({ ...r, xpRulesVersion: V - 1 }))
    const ledger = [...runs("wayfaring", 23), floor, ...kept]
    const d = skillDetail(rules, "wayfaring", standingFor("wayfaring", ledger), ledger, [], NOW)!

    const shown = d.recent.reduce((s, r) => s + r.xp, 0)
    const shownIds = new Set(d.recent.map((r) => r.activityId))
    const older = ledger.filter((r) => !r.isFloor && !shownIds.has(r.activityId)).reduce((s, r) => s + r.xpAwarded, 0)
    expect(d.carried).toBe(13_342)
    expect(d.more).toBe(14) // 23 + the kept activity − 10
    expect(shown + older + d.carried).toBe(d.ledgerXp)
    expect(d.ledgerXp).toBe(d.xp)
  })

  it("the session estimate reads only the current ruleset's rows", () => {
    const old = activity("wayfaring", 1, 1, [["new_ground", 50, 50_000]]).map((r) => ({ ...r, xpRulesVersion: V - 1 }))
    const ledger = [...old, ...activity("wayfaring", 2, 2, [["new_ground", 5, 500]])]
    const d = skillDetail(rules, "wayfaring", [{ skillId: "wayfaring", xp: cumulativeXp(30) }], ledger, [], NOW)!
    expect(d.sessionsToNext).toBe(`~${Math.ceil(d.xpToNext / 500)} runs`)
  })

  it("a meta skill's share rows show no units", () => {
    const ledger = activity("constitution", 1, 1, [["constitution_share", 500, 167]])
    const d = skillDetail(rules, "constitution", standingFor("constitution", ledger), ledger, [], NOW)!
    expect(d.recent[0]).toMatchObject({ units: null, xp: 167 })
  })
})

describe("AHEAD — the ladder, estimated low", () => {
  it("lists only milestones above the current level and within the curve, with 04 §4.3's names", () => {
    const d = skillDetail(rules, "wayfaring", [{ skillId: "wayfaring", xp: cumulativeXp(47) }], [], [], NOW)!
    const expected = SKILL_MILESTONES.filter((m) => m.level > 47 && m.level <= rules.curve.maxLevel)
    expect(d.ahead.map((a) => [a.level, a.name])).toEqual(expected.map((m) => [m.level, m.name]))
    expect(d.ahead.map((a) => a.name)).toEqual(["Adept", "Veteran", "Elder", "Mastery"])
  })

  it("estimates in months or years — never a date — and nothing without sessions", () => {
    const ledger = runs("wayfaring", 10)
    const d = skillDetail(rules, "wayfaring", [{ skillId: "wayfaring", xp: cumulativeXp(20) }], ledger, [], NOW)!
    for (const a of d.ahead) expect(a.estimate).toMatch(/^(under a month|~\d+ months?|~\d+ years?)$/)
    const none = skillDetail(rules, "wayfaring", [{ skillId: "wayfaring", xp: cumulativeXp(20) }], [], [], NOW)!
    for (const a of none.ahead) expect(a.estimate).toBeNull()
  })

  it("estimates later rungs as further away", () => {
    const ledger = runs("wayfaring", 10)
    const d = skillDetail(rules, "wayfaring", [{ skillId: "wayfaring", xp: cumulativeXp(20) }], ledger, [], NOW)!
    const days = (s: string) => (s === "under a month" ? 0 : Number(/\d+/.exec(s)![0]) * (s.includes("year") ? 365 : 30))
    const est = d.ahead.map((a) => days(a.estimate!))
    expect([...est].sort((a, b) => a - b)).toEqual(est)
  })

  it("lowPrecision rounds to months under a year and a half, then years", () => {
    expect(lowPrecision(10)).toBe("under a month")
    expect(lowPrecision(31)).toBe("~1 month")
    expect(lowPrecision(120)).toBe("~4 months")
    expect(lowPrecision(1095)).toBe("~3 years")
    expect(lowPrecision(4015)).toBe("~11 years")
  })
})

describe("ON THE MAP, and the unknown", () => {
  it("passes place-bound milestones through, lowest level first", () => {
    const places: PlaceMilestone[] = [
      { level: 50, label: "Cairn at Level 50", lng: 1, lat: 2 },
      { level: 25, label: "Cairn at Level 25", lng: 3, lat: 4 },
    ]
    const d = skillDetail(rules, "wayfaring", [], [], places, NOW)!
    expect(d.places.map((p) => p.level)).toEqual([25, 50])
  })

  it("an unknown or disabled skill id is null, not a throw", () => {
    expect(skillDetail(rules, "no-such-skill", [], [], [], NOW)).toBeNull()
    const disabled = rules.skills.find((s) => !s.enabled)
    if (disabled) expect(skillDetail(rules, disabled.id, [], [], [], NOW)).toBeNull()
  })

  it("works for every enabled registry skill, activity and meta", () => {
    for (const s of enabled) {
      const d = skillDetail(rules, s.id, [{ skillId: s.id, xp: cumulativeXp(15) + 7 }], runs(s.id, 3), [], NOW)
      expect(d, s.id).not.toBeNull()
      expect(d!.name).toBe(s.name)
    }
  })
})
