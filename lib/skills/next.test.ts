import { describe, expect, it } from "vitest"

import { BUNDLED_RULES } from "@/rules/xp-rules.bundled"
import type { RuleSet } from "@/src/rules/schema"
import { cumulativeXp } from "@/src/scoring/levels"

import { median, nextLine, recentSessions, TRAILING_SESSIONS, type SkillLedgerRow } from "./next"
import { skillsPanel } from "./panel"

/** Ticket 0073 — the `NEXT` card's line. Skills are read from the registry, never named. */

const rules = BUNDLED_RULES[Math.max(...Object.keys(BUNDLED_RULES).map(Number))] as RuleSet
const byOrder = rules.skills.filter((s) => s.enabled && s.kind === "activity").sort((a, b) => a.displayOrder - b.displayOrder)
const traced = byOrder.filter((s) => s.logMode === "trace")
const logged = byOrder.filter((s) => s.logMode !== "trace")

const row = (activityId: string, skillId: string, _reason: string, xp: number, at: string, v = rules.version): SkillLedgerRow => ({
  skillId,
  activityId,
  xpAwarded: xp,
  xpRulesVersion: v,
  isFloor: activityId === "__floor__",
  seq: `${at}#${activityId}#00`,
})

describe("recentSessions", () => {
  const s = traced[0]!.id

  it("sums one activity's reasons into one session, newest first", () => {
    const rows = [
      row("a1", s, "recent_ground", 100, "2026-09-01T00:00:00Z"),
      row("a1", s, "familiar_ground", 50, "2026-09-01T00:00:00Z"),
      row("a2", s, "new_ground", 300, "2026-09-03T00:00:00Z"),
    ]
    expect(recentSessions(s, rows, rules.version)).toEqual([300, 150])
  })

  it("ignores other skills' rows", () => {
    const other = traced[1]!.id
    expect(recentSessions(s, [row("a1", other, "recent_ground", 100, "2026-09-01T00:00:00Z")], rules.version)).toEqual([])
  })

  it("skips floor rows, replay markers, zero sessions and other ruleset versions", () => {
    const rows = [
      row("__floor__", s, "retained_floor", 900, "2026-09-05T00:00:00Z"),
      row("__replay__", s, "replay_run", 0, "2026-09-05T00:00:00Z"),
      row("a3", s, "recent_ground", 0, "2026-09-04T00:00:00Z"),
      row("a4", s, "recent_ground", 80, "2026-09-04T00:00:00Z", rules.version - 1),
      row("a5", s, "recent_ground", 70, "2026-09-02T00:00:00Z"),
    ]
    expect(recentSessions(s, rows, rules.version)).toEqual([70])
  })

  it("keeps only the trailing window", () => {
    const rows = Array.from({ length: TRAILING_SESSIONS + 5 }, (_, i) =>
      row(`a${i}`, s, "recent_ground", i + 1, `2026-09-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
    )
    const recent = recentSessions(s, rows, rules.version)
    expect(recent).toHaveLength(TRAILING_SESSIONS)
    expect(recent[0]).toBe(TRAILING_SESSIONS + 5)
  })
})

describe("median", () => {
  it("is the middle value, or the mean of the middle two", () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })
})

describe("nextLine", () => {
  const at = (level: number, extra = 0) => cumulativeXp(level) + extra

  it("picks the activity skill fewest sessions away, counted in runs for a trace skill", () => {
    const [a, b] = traced
    const m = skillsPanel(rules, [
      { skillId: a!.id, xp: at(20) },
      { skillId: b!.id, xp: at(20) },
    ])
    const toNext = cumulativeXp(21) - cumulativeXp(20)
    const line = nextLine(rules, m.activity, { [a!.id]: [toNext / 9], [b!.id]: [toNext / 3] })
    expect(line).toBe(`~3 runs to ${b!.name} 21`)
  })

  it("breaks a tie by registry order, never by level or recency", () => {
    const [a, b] = traced
    const m = skillsPanel(rules, [
      { skillId: a!.id, xp: at(20) },
      { skillId: b!.id, xp: at(20) },
    ])
    const toNext = cumulativeXp(21) - cumulativeXp(20)
    expect(nextLine(rules, m.activity, { [b!.id]: [toNext / 4], [a!.id]: [toNext / 4] })).toBe(`~4 runs to ${a!.name} 21`)
  })

  it("counts a hand-logged skill in sessions, and says one session in the singular", () => {
    const [h] = logged
    const m = skillsPanel(rules, [{ skillId: h!.id, xp: at(5) }])
    expect(nextLine(rules, m.activity, { [h!.id]: [1e6] })).toBe(`~1 session to ${h!.name} 6`)
  })

  it("uses the median, so one huge outlier does not make the plan look short", () => {
    const [a] = traced
    const m = skillsPanel(rules, [{ skillId: a!.id, xp: at(20) }])
    const toNext = cumulativeXp(21) - cumulativeXp(20)
    expect(nextLine(rules, m.activity, { [a!.id]: [toNext / 10, toNext / 10, toNext * 50] })).toBe(`~10 runs to ${a!.name} 21`)
  })

  it("is null with no session history, and skips a skill at its cap", () => {
    const [a] = traced
    const m = skillsPanel(rules, [{ skillId: a!.id, xp: Number.MAX_SAFE_INTEGER }])
    expect(nextLine(rules, m.activity, {})).toBeNull()
    expect(nextLine(rules, m.activity, { [a!.id]: [100] })).toBeNull()
  })

  it("is one line: a string, never a list", () => {
    const [a] = traced
    const m = skillsPanel(rules, [{ skillId: a!.id, xp: at(3) }])
    const line = nextLine(rules, m.activity, { [a!.id]: [10] })
    expect(typeof line).toBe("string")
    expect(line).not.toMatch(/\n/)
  })
})
