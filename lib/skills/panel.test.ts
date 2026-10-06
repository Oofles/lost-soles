import { describe, expect, it } from "vitest"

import { BUNDLED_RULES } from "@/rules/xp-rules.bundled"
import type { RuleSet } from "@/src/rules/schema"
import { cumulativeXp, levelForXp, totalLevelCeiling } from "@/src/scoring/levels"

import { skillsPanel } from "./panel"

/**
 * Ticket 0073 — the panel's arithmetic and sections, against every bundled ruleset. No skill id
 * is written here: the skills are read from the registry, so this cannot go stale on a new row.
 */

const versions = Object.keys(BUNDLED_RULES).map(Number)

describe.each(versions)("skillsPanel under ruleset v%i", (v) => {
  const rules = BUNDLED_RULES[v] as RuleSet
  const enabled = rules.skills.filter((s) => s.enabled).sort((a, b) => a.displayOrder - b.displayOrder)
  const activity = enabled.filter((s) => s.kind === "activity")
  const meta = enabled.filter((s) => s.kind === "meta")
  const trainedAll = enabled.map((s, i) => ({ skillId: s.id, xp: cumulativeXp(10 + i) + 7 }))

  it("shows every enabled skill exactly once, and no disabled one", () => {
    for (const standing of [[], trainedAll]) {
      const m = skillsPanel(rules, standing)
      const ids = [...m.activity, ...m.meta, ...m.untrained].map((t) => t.skillId)
      expect(ids.sort()).toEqual(enabled.map((s) => s.id).sort())
    }
    const disabled = rules.skills.filter((s) => !s.enabled)
    const m = skillsPanel(rules, disabled.map((s) => ({ skillId: s.id, xp: 9999 })))
    const shown = new Set([...m.activity, ...m.meta, ...m.untrained].map((t) => t.skillId))
    for (const s of disabled) expect(shown.has(s.id), s.id).toBe(false)
  })

  it("puts trained skills in ACTIVITY or META by kind, in registry order, never by level", () => {
    // Levels RISE along registry order, so a highest-first sort would reverse every section.
    const standing = enabled.map((s, i) => ({ skillId: s.id, xp: cumulativeXp(10 + i) }))
    const m = skillsPanel(rules, standing)
    expect(m.activity.map((t) => t.skillId)).toEqual(activity.map((s) => s.id))
    expect(m.meta.map((t) => t.skillId)).toEqual(meta.map((s) => s.id))
    expect(m.untrained).toEqual([])
  })

  it("collapses never-trained skills of either kind into Untrained, at level 1, in registry order", () => {
    const [first] = activity
    const m = skillsPanel(rules, [{ skillId: first!.id, xp: 50 }])
    expect(m.activity.map((t) => t.skillId)).toEqual([first!.id])
    expect(m.meta).toEqual([])
    expect(m.untrained.map((t) => t.skillId)).toEqual(enabled.filter((s) => s !== first).map((s) => s.id))
    expect(m.untrained.every((t) => t.level === 1 && t.fraction === 0)).toBe(true)
  })

  it("Total Level is Σ displayed level over the enabled registry, meta and untrained included", () => {
    const m = skillsPanel(rules, trainedAll)
    const expected = trainedAll.reduce((sum, s) => sum + levelForXp(s.xp, rules.curve), 0)
    expect(m.totalLevel).toBe(expected)
    expect(m.totalXp).toBe(trainedAll.reduce((sum, s) => sum + s.xp, 0))
    expect(skillsPanel(rules, []).totalLevel).toBe(enabled.length)
  })

  it("counts levelHighWater, so the panel agrees with Profile.totalLevel after a stingier replay", () => {
    const [s] = activity
    const m = skillsPanel(rules, [{ skillId: s!.id, xp: cumulativeXp(5), levelHighWater: 9 }])
    expect(m.activity[0]!.level).toBe(9)
    expect(m.totalLevel).toBe(9 + enabled.length - 1)
  })

  it("at the ceiling reads enabled rows × maxLevel — computed, never a remembered number (D-192)", () => {
    const m = skillsPanel(rules, enabled.map((s) => ({ skillId: s.id, xp: Number.MAX_SAFE_INTEGER })))
    expect(m.totalLevel).toBe(totalLevelCeiling(rules.skills, rules.curve))
    expect(m.totalLevel).toBe(enabled.length * rules.curve.maxLevel)
    expect(m.rung.fraction).toBe(1)
  })

  it("ignores standing for a skill the registry does not carry", () => {
    expect(skillsPanel(rules, [{ skillId: "not-a-skill", xp: 1e9 }]).totalXp).toBe(0)
  })
})
