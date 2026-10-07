import { describe, expect, it } from "vitest"

import { BUNDLED_RULES } from "@/rules/xp-rules.bundled"
import type { RuleSet } from "@/src/rules/schema"
import { cumulativeXp, levelForXp, totalLevelCeiling } from "@/src/scoring/levels"

import { appendSkills, FIFTEEN } from "./__fixtures__/fifteen-skills"
import { skillsPanel, type SkillsPanelModel } from "./panel"

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

/**
 * Ticket 0075 — §5.3's rules at fifteen skills, not nine. Positions are asserted as indices:
 * "the tile did not move" is a claim about an array, and a screenshot cannot make it.
 */
describe("the panel in year ten (0075)", () => {
  const rules = FIFTEEN
  const enabled = rules.skills.filter((s) => s.enabled).sort((a, b) => a.displayOrder - b.displayOrder)
  const ids = (m: SkillsPanelModel) => ({
    activity: m.activity.map((t) => t.skillId),
    meta: m.meta.map((t) => t.skillId),
    untrained: m.untrained.map((t) => t.skillId),
  })
  // A seeded shuffle, so a failure reproduces.
  const shuffled = <T,>(xs: readonly T[], seed: number): T[] => {
    const out = [...xs]
    let s = seed
    for (let i = out.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) % 2 ** 31
      const j = s % (i + 1)
      ;[out[i], out[j]] = [out[j]!, out[i]!]
    }
    return out
  }

  it("the fixture is fifteen enabled skills of the two kinds that already exist", () => {
    expect(enabled).toHaveLength(15)
    expect(new Set(enabled.map((s) => s.kind))).toEqual(new Set(["activity", "meta"]))
  })

  it("draws the same tile order whether levels descend, ascend or are random (rule 2)", () => {
    const n = enabled.length
    const descending = enabled.map((s, i) => ({ skillId: s.id, xp: cumulativeXp(60 - i) }))
    const ascending = enabled.map((s, i) => ({ skillId: s.id, xp: cumulativeXp(10 + i) }))
    const random = shuffled(enabled, 7).map((s, i) => ({ skillId: s.id, xp: cumulativeXp(2 + ((i * 37) % 80)) }))
    const expected = skillsPanel(rules, ascending)
    for (const standing of [descending, random, shuffled(ascending, 3)]) {
      expect(ids(skillsPanel(rules, standing))).toEqual(ids(expected))
    }
    expect(ids(expected).activity.length + ids(expected).meta.length).toBe(n)
    // And the order is the registry's even when the file lists rows out of order.
    expect(ids(skillsPanel({ ...rules, skills: shuffled(rules.skills, 11) }, ascending))).toEqual(ids(expected))
    expect([...ids(expected).activity, ...ids(expected).meta]).toEqual([
      ...enabled.filter((s) => s.kind === "activity").map((s) => s.id),
      ...enabled.filter((s) => s.kind === "meta").map((s) => s.id),
    ])
  })

  it("a new skill appends within its section and moves no existing tile's index (rules 1–2)", () => {
    const standing = enabled.map((s) => ({ skillId: s.id, xp: 500 }))
    const before = ids(skillsPanel(rules, standing))
    for (const kind of ["activity", "meta"] as const) {
      const grown = appendSkills(rules, [{ id: `yr11-${kind}`, name: "Newcomer", kind }])
      const after = ids(skillsPanel(grown, [...standing, { skillId: `yr11-${kind}`, xp: 500 }]))
      const section = kind === "activity" ? "activity" : "meta"
      const other = kind === "activity" ? "meta" : "activity"
      before[section].forEach((id, i) => expect(after[section].indexOf(id), id).toBe(i))
      expect(after[section]).toEqual([...before[section], `yr11-${kind}`])
      expect(after[other]).toEqual(before[other])
    }
  })

  it("collapses every zero-XP skill into Untrained, counted, at level 1 (rule 3)", () => {
    const trained = enabled.filter((_, i) => i % 3 === 0)
    const m = skillsPanel(rules, trained.map((s) => ({ skillId: s.id, xp: 900 })))
    const never = enabled.filter((s) => !trained.includes(s))
    expect(m.untrained.map((t) => t.skillId)).toEqual(never.map((s) => s.id))
    expect(m.untrained).toHaveLength(15 - trained.length)
    for (const t of m.untrained) expect([t.name, t.level]).toEqual([enabled.find((s) => s.id === t.skillId)!.name, 1])
  })

  it("keys Untrained on lifetime XP == 0, and nothing else", () => {
    const [s] = enabled
    // A ratchet without XP is not training; an XP of 1 with no level gained is.
    expect(skillsPanel(rules, [{ skillId: s!.id, xp: 0, levelHighWater: 4 }]).untrained.map((t) => t.skillId)).toContain(s!.id)
    expect(skillsPanel(rules, [{ skillId: s!.id, xp: 1 }]).untrained.map((t) => t.skillId)).not.toContain(s!.id)
  })

  it("a first award moves a skill out of Untrained for good, into its registry position (rule 3)", () => {
    const xp = new Map<string, number>()
    // Train in a random order; after every award each section is still a registry-order subsequence.
    for (const s of shuffled(enabled, 5)) {
      const wasUntrained = new Set(skillsPanel(rules, [...xp].map(([skillId, x]) => ({ skillId, xp: x }))).untrained.map((t) => t.skillId))
      expect(wasUntrained.has(s.id)).toBe(true)
      xp.set(s.id, (xp.get(s.id) ?? 0) + 40)
      const m = ids(skillsPanel(rules, [...xp].map(([skillId, x]) => ({ skillId, xp: x }))))
      expect(m.untrained).not.toContain(s.id)
      expect(m[s.kind]).toContain(s.id)
      for (const section of ["activity", "meta", "untrained"] as const) {
        expect(m[section]).toEqual(enabled.map((r) => r.id).filter((id) => m[section].includes(id)))
      }
      // Nothing trained ever returns.
      for (const id of xp.keys()) expect(m.untrained).not.toContain(id)
    }
    expect(skillsPanel(rules, [...xp].map(([skillId, x]) => ({ skillId, xp: x }))).untrained).toEqual([])
  })
})
