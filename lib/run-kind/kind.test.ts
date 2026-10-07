import { describe, expect, it } from "vitest"

import { BUNDLED_RULES } from "@/rules/xp-rules.bundled"
import type { RuleSet } from "@/src/rules/schema"

import { kindChangeLine, kindChoices, kindLabel, wasKind } from "./kind"

const name = (id: string) => ({ athletics: "Athletics", wayfaring: "Wayfaring" })[id] ?? id

describe("wasKind — `0243`'s note on when to say \"was X\"", () => {
  it("is null with no override", () => {
    expect(wasKind({ kind: "run", derivedKind: "run", kindOverride: null })).toBeNull()
  })
  it("names the derived kind when an override moved it", () => {
    expect(wasKind({ kind: "walk", derivedKind: "run", kindOverride: { kind: "walk" } })).toBe("run")
  })
  it("is null when an override was set back to the derived kind", () => {
    expect(wasKind({ kind: "run", derivedKind: "run", kindOverride: { kind: "run" } })).toBeNull()
  })
  it("reads a pre-0243 row's missing derivedKind as kind", () => {
    expect(wasKind({ kind: "run", derivedKind: null, kindOverride: { kind: "run" } })).toBeNull()
  })
})

describe("kindChoices — from the rules, not from code (D-031)", () => {
  it("is every kind the newest bundled ruleset's enabled activity rows match, sorted", () => {
    const newest = Math.max(...Object.keys(BUNDLED_RULES).map(Number))
    const rules = BUNDLED_RULES[newest] as RuleSet
    const expected = new Set(rules.skills.filter((s) => s.kind === "activity" && s.enabled).flatMap((s) => s.match?.kinds ?? []))
    expect(kindChoices(rules)).toEqual([...expected].sort())
    expect(kindChoices(rules).length).toBeGreaterThan(1)
  })
  it("picks up a kind a new data row adds, with no code change", () => {
    const rules = { skills: [{ id: "x", kind: "activity", enabled: true, match: { kinds: ["paddle"] } }] } as never
    expect(kindChoices(rules)).toEqual(["paddle"])
  })
})

describe("kindChangeLine — the XP result in plain words", () => {
  const base = { outcome: "applied", kind: "run", gained: [], retained: [], cellsRevealed: 0 }

  it("says what was added to which skill", () => {
    expect(kindChangeLine({ ...base, gained: [{ skillId: "athletics", xp: 1200 }] }, name)).toBe("Now Run. +1,200 Athletics XP.")
  })
  it("says nothing changed because XP never goes down", () => {
    expect(kindChangeLine(base, name)).toBe("Now Run. No XP changed: no skill earns more from it as a run, and XP never goes down.")
  })
  it("names a skill that kept XP it would otherwise have lost", () => {
    expect(kindChangeLine({ ...base, kind: "ride", gained: [{ skillId: "x", xp: 5 }], retained: [{ skillId: "wayfaring", xp: 12 }] }, name)).toBe(
      "Now Ride. +5 x XP. Wayfaring keeps the 12 XP it had from this; XP never goes down.",
    )
  })
  it("mentions revealed ground", () => {
    expect(kindChangeLine({ ...base, cellsRevealed: 45 }, name)).toMatch(/45 cells of map revealed\.$/)
  })
  it("reports an unchanged outcome", () => {
    expect(kindChangeLine({ ...base, outcome: "unchanged" }, name)).toBe("Already Run. Nothing changed.")
  })
  it("labels a kind by raising its first letter", () => {
    expect(kindLabel("walk")).toBe("Walk")
  })
})
