import { readFileSync } from "node:fs"

import { parse } from "yaml"
import { describe, expect, it } from "vitest"

import { loadRuleSet } from "./load"
import type { RuleSkill } from "./schema"
import { validateRuleSet } from "./validate"

/**
 * Ticket 0031, criterion 8: "the YAML in the amended §1.3 parses with the 0028 validator — the
 * doc's example must not itself be invalid."
 *
 * Asserted mechanically rather than by having read it once. `04-game-design.md` §1.3 is the
 * document a future session opens to learn the schema; an example that has quietly drifted from
 * the shipped file teaches the wrong shape with full authority. That is not hypothetical — §1.3
 * shipped for weeks WITHOUT a `match` block, which is the defect D-141 exists to record, and it
 * survived because nothing checked it.
 *
 * Same instrument as `src/domain/contract-drift.test.ts` uses for the ingestion contract §2.
 */

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const DOC = `${ROOT}/docs/04-game-design.md`

/** The first ```yaml block inside §1.3, and nothing else. */
function schemaBlock(): string {
  const md = readFileSync(DOC, "utf8").split("\n")
  const from = md.findIndex((l) => l.startsWith("### 1.3 "))
  const to = md.findIndex((l, i) => i > from && l.startsWith("### 1.4 "))
  expect(from, "§1.3 heading not found — did the section get renamed?").toBeGreaterThan(-1)
  const section = md.slice(from, to === -1 ? md.length : to)
  const open = section.findIndex((l) => l === "```yaml")
  const close = section.findIndex((l, i) => i > open && l === "```")
  expect(open, "no ```yaml block in §1.3").toBeGreaterThan(-1)
  expect(close).toBeGreaterThan(open)
  return section.slice(open + 1, close).join("\n")
}

describe("04-game-design.md §1.3's schema example", () => {
  const parsed = parse(schemaBlock()) as { skills: RuleSkill[]; curve: unknown }

  it("is a real ruleset, not prose that looks like one", () => {
    expect(Array.isArray(parsed.skills)).toBe(true)
    expect(parsed.skills.length).toBeGreaterThan(4)
    expect(parsed.curve).toBeDefined()
  })

  it("PASSES the 0028 validator — the doc's example is itself valid", () => {
    // Includes the seed-time selection checks, which is why the excerpt has to carry all four
    // distance skills: an example that dropped one would fail totality, and a doc example that
    // could not be seeded is a doc example that is lying.
    expect(validateRuleSet(parsed)).toEqual([])
  })

  it("declares `match` and `matchPriority` on every activity row (D-141)", () => {
    // The specific defect this section was amended to fix. If a future edit trims the example
    // back to "the interesting fields", this is what stops selection quietly disappearing again.
    const activities = parsed.skills.filter((s) => s.kind === "activity")
    expect(activities.length).toBeGreaterThan(0)
    for (const s of activities) {
      expect(s.match, s.id).not.toBeNull()
      expect(Object.keys(s.match!).sort(), s.id).toEqual([
        "kinds",
        "measure",
        "requiresTrace",
        "sources",
      ])
      expect(typeof s.matchPriority, s.id).toBe("number")
    }
  })

  it("carries exactly ONE measure per row (0031, the resolved open item)", () => {
    for (const s of parsed.skills.filter((x) => x.kind === "activity")) {
      expect(typeof s.match!.measure, s.id).toBe("string")
    }
  })

  it("nests `exercises` in their skill, never at the top level (02 §3.2)", () => {
    expect(parsed).not.toHaveProperty("exercises")
    const withExercises = parsed.skills.filter((s) => s.exercises?.length)
    expect(withExercises.length).toBeGreaterThan(0)
    for (const s of withExercises) {
      for (const e of s.exercises!) expect(Object.keys(e)).not.toContain("skill")
    }
  })

  it("agrees with the shipped file on every row it chooses to show", () => {
    // The excerpt may OMIT rows — it says so — but it must not CONTRADICT one. This is the
    // assertion that turns "copy the shape shipped" from an instruction into a property.
    const shipped = new Map(loadRuleSet(1).skills.map((s) => [s.id, s]))
    for (const doc of parsed.skills) {
      const real = shipped.get(doc.id)
      expect(real, `§1.3 shows "${doc.id}", which is not in rules/xp-rules-v1.yaml`).toBeDefined()
      for (const field of [
        "kind",
        "enabled",
        "displayOrder",
        "logMode",
        "unit",
        "matchPriority",
        "xpPerUnit",
        "revealsGround",
        "minUnitsForCredit",
      ] as const) {
        expect(doc[field], `${doc.id}.${field}`).toEqual(real![field])
      }
      expect(doc.match, `${doc.id}.match`).toEqual(real!.match)
      expect(doc.groundMultipliers, `${doc.id}.groundMultipliers`).toEqual(real!.groundMultipliers)
      expect(doc.feeds, `${doc.id}.feeds`).toEqual(real!.feeds)
    }
  })

  it("shows all four distance skills, so the D-141 proof is visible in one screen", () => {
    const distance = parsed.skills.filter((s) => s.match?.measure === "distanceKm")
    expect(distance).toHaveLength(4)
    // Two traced, two not — the pair-of-pairs that makes selection legible without code.
    expect(distance.filter((s) => s.match!.requiresTrace === true)).toHaveLength(2)
    expect(distance.filter((s) => s.match!.requiresTrace === false)).toHaveLength(2)
  })
})
